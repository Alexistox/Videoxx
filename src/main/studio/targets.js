import path from "node:path";
import fs from "node:fs";
import { log } from "../core/log";
import { IMAGE_COST, ledger, makeImage } from "../images/makeImage";
import { activeProvider } from "../images/providers";
import { FILL_MARK, VIEW_NAME, notifyStudio, readVersions, requireStudio, setActivity } from "./stages";
import { mainView } from "./runChecks";
import { ff } from "../pipeline/ff";
import { kindOf, listRefs } from "../projects/references";
import { projectUrl } from "../projects/fileServer";

const MAX_TARGETS = 8;
const TARGET_ID = /^t\d{1,3}$/;
const targetsFile = (dir) => path.join(dir, ".suite", "studio", "targets.json");
export const targetMaster = (id) => `.suite/studio/targets/${id}.jpg`;
export const targetCopy = (id) => `reference/targets/${id}.jpg`;
const clip = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const isMust = (studio, view) => !!studio.views[view]?.expect || /^mustfail/i.test(view);
export function readTargets(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(targetsFile(dir), "utf8"));
    return Array.isArray(j?.targets) ? j.targets.filter((t) => t && TARGET_ID.test(String(t.id)) && typeof t.view === "string") : [];
  } catch {
    return [];
  }
}
function writeTargets(dir, list) {
  const f = targetsFile(dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ targets: list }, null, 1));
  fs.renameSync(tmp, f);
}
export function ensureTargetCopies(dir) {
  const list = readTargets(dir),
    d = path.join(dir, "reference", "targets");
  for (const t of list) {
    const m = path.join(dir, targetMaster(t.id)),
      c = path.join(dir, targetCopy(t.id));
    try {
      if (fs.existsSync(m) && (!fs.existsSync(c) || fs.statSync(c).size !== fs.statSync(m).size)) {
        fs.mkdirSync(d, { recursive: true });
        fs.copyFileSync(m, c);
      }
    } catch (e) {
      log("studio", "target copy failed", t.id, e?.message);
    }
  }
  try {
    for (const f of fs.readdirSync(d))
      if (/^t\d+\.jpg$/i.test(f) && !list.some((t) => `${t.id}.jpg` === f.toLowerCase())) fs.rmSync(path.join(d, f), { force: true });
  } catch {}
  return list;
}
const withUrl = (projectId, dir, t) => {
  let m = 0;
  try {
    m = Math.round(fs.statSync(path.join(dir, targetMaster(t.id))).mtimeMs);
  } catch {}
  return { ...t, file: targetMaster(t.id), url: m ? `${projectUrl(projectId, targetMaster(t.id))}?m=${m}` : null };
};
export function listTargets(projectId) {
  const { dir } = requireStudio(projectId);
  return ensureTargetCopies(dir).map((t) => withUrl(projectId, dir, t));
}
function shotMids(dir, view, aspect) {
  const last2 = readVersions(dir).slice(-1)[0],
    by = new Map();
  for (const f of last2?.renders?.[aspect]?.frames ?? [])
    if (f.view === view && f.shot != null) {
      const l = by.get(f.shot) ?? [];
      l.push(f.t);
      by.set(f.shot, l);
    }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, ts]) => +((Math.min(...ts) + Math.max(...ts)) / 2).toFixed(2));
}
function placeFor(dir, studio, o, index) {
  const views = Object.keys(studio.views ?? {}).filter((v) => !isMust(studio, v));
  const view = o.view && VIEW_NAME.test(o.view) && views.includes(o.view) ? o.view : (mainView(studio) ?? views[0]);
  if (!view) throw new Error("This workspace has no view to match a target to.");
  const aspect = studio.aspects.includes(o.aspect) ? o.aspect : studio.aspects[0];
  const end = +studio.views[view].end,
    clampT = (t) => +Math.max(0, Math.min(end - 0.02, t)).toFixed(2);
  if (typeof o.t === "number" && isFinite(o.t)) return { view, aspect, t: clampT(o.t) };
  const mids = shotMids(dir, view, aspect);
  if (!mids.length) return { view, aspect, t: clampT(end * (o.frac ?? 0.5)) };
  if (o.frac != null && isFinite(o.frac)) {
    const want = o.frac * end;
    return { view, aspect, t: mids.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) };
  }
  return { view, aspect, t: mids[index % mids.length] };
}
const nextId = (list) => `t${list.reduce((n, t) => Math.max(n, +t.id.slice(1) || 0), 0) + 1}`;
async function grab(dir, src, t, id) {
  const out = path.join(dir, targetMaster(id)),
    tmp = out.replace(/\.jpg$/, ".tmp.jpg");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await ff([
    ...(t != null ? ["-ss", t.toFixed(3)] : []),
    "-i",
    src,
    "-frames:v",
    "1",
    "-vf",
    "scale=w='min(1920,iw)':h=-2",
    "-q:v",
    "2",
    tmp,
  ]);
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 300) {
    fs.rmSync(tmp, { force: true });
    throw new Error("No picture could be read from that file.");
  }
  fs.renameSync(tmp, out);
}
export async function addTarget(projectId, o) {
  const { dir, studio } = requireStudio(projectId),
    list = readTargets(dir);
  if (list.length >= MAX_TARGETS) throw new Error(`A workspace takes up to ${MAX_TARGETS} target frames: remove one first.`);
  let src = "",
    srcT = null,
    source,
    from,
    frac = null;
  if (o?.refId) {
    const ref = (await listRefs(projectId)).find((r) => r.id === String(o.refId));
    if (!ref) throw new Error("That reference is not in this workspace any more.");
    if (!ref.exists) throw new Error(`${ref.tag} is missing: ${ref.path} is not there any more. Relink it first.`);
    if (ref.kind !== "image" && ref.kind !== "video") throw new Error(`${ref.tag} has no picture to match.`);
    src = ref.path;
    source = "reference";
    from = ref.tag;
    if (ref.kind === "video") {
      const dur = ref.probe?.duration ?? 0;
      srcT = Math.max(0, Math.min(Math.max(0, dur - 0.05), +(o.t ?? ref.ranges?.[0]?.start ?? 0) || 0));
      frac = dur ? srcT / dur : null;
    }
  } else if (o?.path) {
    const raw = String(o.path);
    if (!path.isAbsolute(raw)) throw new Error("Pick the file again (the path is not complete).");
    const p = path.resolve(raw);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error(`${clip(raw, 200)} does not exist.`);
    const k = kindOf(p);
    if (k !== "image" && k !== "video") throw new Error("A target frame is an image (or a frame of a video).");
    src = p;
    source = "file";
    from = path.basename(p);
    if (k === "video") srcT = Math.max(0, +(o.t ?? 0) || 0);
  } else throw new Error("Pick an image, or a reference, for the target frame.");
  const id = nextId(list);
  setActivity(projectId, "target: reading the picture");
  try {
    await grab(dir, src, srcT, id);
  } finally {
    setActivity(projectId, null);
  }
  const place = placeFor(dir, studio, { view: o.view, aspect: o.aspect, t: o.at, frac }, list.length);
  const t = {
    id,
    source,
    from,
    srcT,
    ...place,
    label: clip(o.label || (from ? `${from}${srcT != null ? ` @ ${srcT.toFixed(1)} s` : ""}` : id), 80),
    prompt: null,
    createdAt: new Date().toISOString(),
  };
  writeTargets(dir, [...list, t]);
  ensureTargetCopies(dir);
  notifyStudio(projectId);
  return withUrl(projectId, dir, t);
}
export function updateTarget(projectId, id, patch) {
  const { dir, studio } = requireStudio(projectId),
    list = readTargets(dir),
    t = list.find((x) => x.id === String(id));
  if (!t) throw new Error(`There is no target ${clip(id, 10)}.`);
  if (patch?.view !== void 0) {
    const v = String(patch.view);
    if (!VIEW_NAME.test(v) || !studio.views[v] || isMust(studio, v))
      throw new Error(`"${clip(v, 40)}" is not a view a target can be matched to.`);
    t.view = v;
  }
  if (patch?.aspect !== void 0) {
    if (!studio.aspects.includes(patch.aspect)) throw new Error(`This workspace renders ${studio.aspects.join(" and ")} only.`);
    t.aspect = patch.aspect;
  }
  const end = +studio.views[t.view].end;
  if (patch?.t !== void 0) {
    const n = Number(patch.t);
    if (!isFinite(n)) throw new Error("The time must be a number of seconds.");
    t.t = +Math.max(0, Math.min(end - 0.02, n)).toFixed(2);
  } else t.t = +Math.max(0, Math.min(end - 0.02, t.t)).toFixed(2);
  if (patch?.label !== void 0) t.label = clip(patch.label, 80) || t.id;
  writeTargets(dir, list);
  notifyStudio(projectId);
  return withUrl(projectId, dir, t);
}
export function removeTarget(projectId, id) {
  const { dir } = requireStudio(projectId),
    list = readTargets(dir),
    t = list.find((x) => x.id === String(id));
  if (!t) return listTargets(projectId);
  writeTargets(
    dir,
    list.filter((x) => x !== t),
  );
  fs.rmSync(path.join(dir, targetMaster(t.id)), { force: true });
  fs.rmSync(path.join(dir, targetCopy(t.id)), { force: true });
  notifyStudio(projectId);
  return listTargets(projectId);
}
function styleNotes(dir, studio) {
  let md = "";
  try {
    md = fs.readFileSync(path.join(dir, "skill", studio.mode === "look" ? "LOOK.md" : "STYLE_GUIDE.md"), "utf8");
  } catch {}
  const body = md
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^#/.test(l) && !l.includes(FILL_MARK) && !/^\s*[-*]?\s*_\(/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return [clip(studio.description, 600), clip(body, 700)].filter(Boolean).join(" ");
}
function wordsAround(dir, t) {
  try {
    const tl = JSON.parse(fs.readFileSync(path.join(dir, "audio", "timeline.json"), "utf8"));
    return (Array.isArray(tl) ? tl : [])
      .flatMap((p) => p?.words ?? [])
      .filter((w) => +w.s >= t - 2.5 && +w.s <= t + 1.5)
      .map((w) => String(w.w))
      .join(" ")
      .slice(0, 300);
  } catch {
    return "";
  }
}
export function generateQuote(projectId, count) {
  const { dir, studio } = requireStudio(projectId),
    l = ledger(dir),
    n = Math.max(1, Math.min(4, Math.round(+count || 1)));
  const left = Math.max(0, studio.imageCap - l.count),
    room = MAX_TARGETS - readTargets(dir).length;
  return {
    count: n,
    each: IMAGE_COST,
    cost: +(n * IMAGE_COST).toFixed(3),
    used: l.count,
    cap: studio.imageCap,
    left,
    room,
    fits: n <= left && n <= room,
    provider: !!activeProvider(dir),
    notes: styleNotes(dir, studio).length >= 20,
  };
}
export async function generateTargets(projectId, count) {
  const { dir, studio } = requireStudio(projectId),
    q = generateQuote(projectId, count);
  if (!q.provider)
    throw new Error(
      "Target frames are made on your image account (Higgsfield or Fal.ai): add a key in Settings > Media > Image generation first.",
    );
  if (!q.notes)
    throw new Error(
      "There is nothing to draw them from yet: write the description in the Brief, or let the look / style guide stage fill its notes first.",
    );
  if (q.room < q.count) throw new Error(`A workspace takes up to ${MAX_TARGETS} target frames: remove some first.`);
  if (q.left < q.count)
    throw new Error(`That is more than the picture cap leaves (${q.left} of ${q.cap}): raise the cap in the Brief first.`);
  const notes = styleNotes(dir, studio),
    made = [];
  try {
    for (let k = 0; k < q.count; k++) {
      const list = readTargets(dir),
        id = nextId(list),
        place = placeFor(dir, studio, {}, list.length);
      setActivity(projectId, `target: making ${k + 1} of ${q.count}`);
      const words = /^sample/i.test(place.view) ? wordsAround(dir, place.t) : "";
      const prompt = clip(
        `One frame of a video in this visual style: ${notes}${words ? ` The frame shows what the narration says here: "${words}".` : ""} ${place.aspect === "9:16" ? "A vertical 9:16" : "A wide 16:9"} composition with a clear subject, the style's own colours, light and finish.`,
        1400,
      );
      const r = await makeImage(dir, { name: `studio_target_${id}`, prompt, kind: "texture", aspect: place.aspect });
      await grab(dir, r.file, null, id);
      const t = {
        id,
        source: "generated",
        from: `assets/${r.rel}`,
        srcT: null,
        ...place,
        label: `Made ${id}`,
        prompt,
        createdAt: new Date().toISOString(),
      };
      writeTargets(dir, [...readTargets(dir), t]);
      made.push(withUrl(projectId, dir, t));
      log("studio", "target made", projectId, id, r.cached ? "(cached)" : `$${r.entry.cost}`);
    }
  } finally {
    setActivity(projectId, null);
    ensureTargetCopies(dir);
    notifyStudio(projectId);
  }
  return made;
}
