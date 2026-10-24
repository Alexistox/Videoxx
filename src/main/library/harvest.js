import path from "node:path";
import fs from "node:fs";
import { nativeImage } from "electron";
import { log } from "../core/log";
import { q, uid } from "../db/db";
import { baseOf, getStyle } from "../styles/catalog";
import { studioLooksRoot } from "../styles/packages";
import { readIssues, readLessons } from "../projects/issues";
import { readVersions, studioOf } from "../studio/stages";
import { LIB_BASE_RX, LIB_ID_RX, LIB_SCOPE_RX, LibEntrySchema } from "./schema";
import { rebuildIndex } from "./index";
import { link } from "./search";
import { mainView } from "../studio/runChecks";
import { entryDirFor, findStoreEntry, patchWsEntry, sha1, writeWsEntry } from "./store";

const clip = (s, n) => {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const slugOf = (s, n = 48) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, n)
    .replace(/-+$/, "") || "entry";
const kvGet = (k) => q.get("SELECT value FROM kv WHERE key=?", k)?.value ?? null;
const kvSet = (k, v) => q.run("INSERT OR REPLACE INTO kv(key, value) VALUES(?,?)", k, v);
const grams = (s) => {
  const t = ` ${s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()} `,
    g = new Set();
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3));
  return g;
};
const jaccard = (a, b) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return a.size + b.size - i ? i / (a.size + b.size - i) : 0;
};
function studioLibBase(studio) {
  for (const b of [studio.target, studio.base]) if (b && LIB_BASE_RX.test(b)) return b;
  return "any";
}
function jpegOf(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const im = nativeImage.createFromPath(file);
    if (im.isEmpty()) return null;
    const s = im.getSize(),
      k = Math.min(1, 960 / Math.max(s.width, s.height, 1));
    return (k < 1 ? im.resize({ width: Math.round(s.width * k), quality: "best" }) : im).toJPEG(84);
  } catch {
    return null;
  }
}
function lessonPicture(dir, studio, issue, l) {
  const inside = (rel) => {
    if (!rel) return null;
    const f = path.resolve(dir, rel),
      r = path.relative(dir, f);
    return r && !r.startsWith("..") && !path.isAbsolute(r) ? f : null;
  };
  const own = jpegOf(inside(issue?.thumb));
  if (own) return own;
  const vs = readVersions(dir),
    want = /v(\d+)/.exec(String(l.version ?? ""))?.[1],
    v = (want ? vs.find((x) => x.v === +want) : null) ?? vs[vs.length - 1];
  if (!v) return null;
  const view = mainView(studio),
    aspect = studio.aspects?.[0],
    frames = (v.renders?.[aspect]?.frames ?? []).filter((f) => !view || f.view === view);
  const pick = frames[Math.floor(frames.length / 2)] ?? (v.renders?.[aspect]?.frames ?? [])[0];
  return jpegOf(inside(pick?.file));
}
export function syncStudioLessons(projectId) {
  const out = { added: [], accepted: [], updated: [], merged: [] };
  const w = studioOf(projectId);
  if (!w) return out;
  const { dir, studio } = w,
    lessons = readLessons(dir);
  if (!lessons.length) return out;
  const issues = new Map(readIssues(dir).map((i) => [i.id, i])),
    b = studioLibBase(studio);
  const pname = q.get("SELECT name FROM projects WHERE id=?", projectId)?.name ?? studio.name;
  let changed = false;
  for (const l of lessons) {
    const issue = issues.get(l.issue),
      key2 = `lib_lesson:${projectId}:${l.issue}`,
      want = issue?.status === "fixed" ? "accepted" : "proposed";
    const problem = {
      symptom: clip(l.finding, 1e3),
      cause: clip(l.meaning || "it breaks the style", 1e3),
      fix: clip(`${l.lesson}${l.fix && clip(l.fix, 400) !== clip(l.lesson, 400) ? ` (The fix then: ${l.fix})` : ""}`, 2e3),
      detect: l.check ? `the Style Studio's ${l.check.toUpperCase()} check` : void 0,
      scopeLetter: "R",
    };
    const mapped = kvGet(key2);
    try {
      if (mapped) {
        if (mapped === "-") continue;
        const rec = findStoreEntry(mapped);
        if (!rec || rec.origin !== "ws") {
          if (!rec) kvSet(key2, "-");
          continue;
        }
        const accept = want === "accepted" && rec.entry.status === "proposed",
          newFix = rec.entry.problem?.fix !== problem.fix;
        if (!accept && !newFix) continue;
        patchWsEntry(mapped, (e) => {
          if (accept) e.status = "accepted";
          if (newFix) e.problem = { ...(e.problem ?? {}), ...problem };
          e.summary = clip(l.lesson, 200);
        });
        (accept ? out.accepted : out.updated).push(mapped);
        changed = true;
        continue;
      }
      let id = `pitfall.${b}.${slugOf(l.finding)}`;
      if (!LIB_ID_RX.test(id)) continue;
      const same = findStoreEntry(id);
      if (same && same.origin === "ws" && clip(same.entry.title, 120).toLowerCase() === clip(l.finding, 120).toLowerCase()) {
        patchWsEntry(id, (e) => {
          e.provenance = [
            ...(e.provenance ?? []),
            { project: pname, projectId, issue: l.issue, check: l.check, version: l.version, by: "studio", at: l.at },
          ].slice(-100);
          if (want === "accepted" && e.status === "proposed") e.status = "accepted";
        });
        kvSet(key2, id);
        out.merged.push(id);
        changed = true;
        continue;
      }
      for (let k = 2; findStoreEntry(id) || fs.existsSync(entryDirFor(id, "ws")); k++) {
        if (k > 40) {
          id = "";
          break;
        }
        id = `pitfall.${b}.${slugOf(l.finding, 44)}-${k}`;
      }
      if (!id) continue;
      const entry = LibEntrySchema.parse({
        schema: 1,
        id,
        uid: uid("lib_"),
        kind: "pitfall",
        title: clip(l.finding, 120),
        summary: clip(l.lesson, 200),
        tags: [...new Set(["pitfall", "studio", ...(l.check ? [l.check.toLowerCase()] : []), b])].slice(0, 20),
        engines: [],
        scope: "global",
        status: want,
        version: 1,
        versions: [{ v: 1, hash: sha1(JSON.stringify(problem)).slice(0, 20), at: l.at, note: "Style Studio lesson" }],
        delivery: "copy",
        files: [],
        requires: [],
        problem,
        provenance: [{ project: pname, projectId, issue: l.issue, check: l.check, version: l.version, by: "studio", at: l.at }],
        licence: { id: "own" },
        related: [],
      });
      writeWsEntry(entry, [], lessonPicture(dir, studio, issue, l));
      kvSet(key2, id);
      out.added.push(id);
      changed = true;
      const mine = grams(`${entry.title} ${entry.tags.join(" ")}`);
      for (const r of q.all("SELECT id, title, tags FROM lib_entries WHERE kind='pitfall' AND source IN ('seed','ws') AND id!=?", id))
        if (r.id.split(".")[1] === b && jaccard(mine, grams(`${r.title} ${r.tags}`)) >= 0.6) link(id, r.id, "dup");
    } catch (e) {
      log("library: lesson not saved", projectId, l.issue, e?.message);
    }
  }
  if (changed) {
    try {
      rebuildIndex();
    } catch (e) {
      log("library: index after lessons", e?.message);
    }
    log("library: studio lessons", projectId, JSON.stringify(out));
  }
  return out;
}
let syncing = false;
export function lessonsChanged(dir) {
  if (syncing) return;
  syncing = true;
  try {
    const n = (x) => {
      const r = path.resolve(x);
      return process.platform === "linux" ? r : r.toLowerCase();
    };
    const p = q.all("SELECT id, path FROM projects WHERE lab_kind='studio'").find((x) => x.path && n(x.path) === n(dir));
    if (p && fs.existsSync(path.join(dir, ".suite", "studio", "pitfalls.jsonl"))) syncStudioLessons(p.id);
  } catch (e) {
    log("library: lesson sync failed", e?.message);
  } finally {
    syncing = false;
  }
}
export function lookToLibrary(lookId, projectId) {
  if (!/^look-[a-z0-9-]{1,60}$/.test(lookId)) throw new Error("not a Studio look id");
  const root = studioLooksRoot(),
    f = path.join(root, `${lookId}.json`);
  const look = JSON.parse(fs.readFileSync(f, "utf8"));
  const st = getStyle(look.style),
    b0 = baseOf(st.id),
    b = LIB_BASE_RX.test(st.id) ? st.id : LIB_BASE_RX.test(b0) ? b0 : "any";
  const id = `look.${b}.${slugOf(lookId.replace(/^look-/, ""))}`;
  if (!LIB_ID_RX.test(id)) throw new Error(`no library id for ${lookId}`);
  const notes =
    [
      `# ${look.name}`,
      look.description,
      look.notes?.context
        ? `## Notes for the build
${look.notes.context}`
        : "",
      look.notes?.qualityBar
        ? `## Quality bar
${look.notes.qualityBar}`
        : "",
      look.pitfalls?.length
        ? `## Pitfalls
${look.pitfalls.map((p) => `- ${p}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n") + "\n";
  const files = [
    { rel: "settings.json", buf: Buffer.from(JSON.stringify(look.settings ?? {}, null, 1) + "\n") },
    { rel: "LOOK.md", buf: Buffer.from(notes) },
  ];
  const hash = sha1(Buffer.concat(files.map((x) => x.buf))).slice(0, 20),
    at = new Date().toISOString();
  const pf = look.preview ? path.join(root, path.basename(String(look.preview))) : null,
    preview = jpegOf(pf);
  const prev = findStoreEntry(id),
    mine = prev?.origin === "ws" ? prev : null;
  if (mine && mine.entry.versions[mine.entry.versions.length - 1]?.hash === hash)
    return { id, version: mine.entry.version, changed: false };
  const version = mine ? mine.entry.version + 1 : 1;
  const scope = st.id !== b && LIB_SCOPE_RX.test(`style:${st.id}`) && st.id.startsWith("custom-") ? `style:${st.id}` : "global";
  const entry = LibEntrySchema.parse({
    ...(mine?.entry ?? {}),
    origin: void 0,
    preview: void 0,
    schema: 1,
    id,
    uid: mine?.entry.uid ?? uid("lib_"),
    kind: "look",
    title: clip(look.name, 120),
    summary: clip(look.description || `A look for ${st.name}, made in the Style Studio.`, 200),
    tags: [
      ...new Set([
        "look",
        "studio",
        b,
        ...String(look.name)
          .toLowerCase()
          .split(/\W+/)
          .filter((x) => x.length > 2),
      ]),
    ].slice(0, 20),
    engines: [],
    scope,
    status: mine && mine.entry.status !== "proposed" ? mine.entry.status : "accepted",
    version,
    versions: [
      ...(mine?.entry.versions ?? []),
      { v: version, hash, at, note: mine ? "saved again in the Style Studio" : "saved in the Style Studio" },
    ],
    delivery: "copy",
    files: files.map((x) => ({ path: x.rel, role: x.rel === "LOOK.md" ? "doc" : "data", bytes: x.buf.length, sha1: sha1(x.buf) })),
    requires: [],
    usage: `A look of ${st.name}: pick "${clip(look.name, 60)}" in New project or the Look panel (look id ${lookId}). Its settings are library/${id}/settings.json; merge "theme" and "post" into project.json "settings" (never "graphics").`,
    doc: {
      when: clip(look.notes?.context || look.description, 1e3),
      ...(look.pitfalls?.length ? { gotchas: look.pitfalls.slice(0, 20).map((p) => clip(p, 400)) } : {}),
      params: { lookId, style: st.id },
    },
    provenance: [
      ...(mine?.entry.provenance ?? []),
      {
        project: look.workspace ? (q.get("SELECT name FROM projects WHERE id=?", look.workspace)?.name ?? null) : null,
        projectId: projectId ?? look.workspace ?? null,
        version: look.version,
        by: "studio",
        at,
      },
    ].slice(-100),
    licence: { id: "own" },
    related: mine?.entry.related ?? [],
    created: mine?.entry.created ?? at,
    updated: at,
  });
  if (mine && !preview && mine.entry.preview) entry.preview = mine.entry.preview;
  writeWsEntry(entry, files, preview);
  rebuildIndex();
  log("library: look saved", id, `v${version}`);
  return { id, version, changed: true };
}
export function lowpolyChanged() {
  try {
    rebuildIndex();
  } catch (e) {
    log("library: index after a low poly find", e?.message);
  }
}
export function harvestCandidates(projectId, max = 10) {
  const since = kvGet(`lib_harvest_at:${projectId}`) ?? "";
  return q.all(
    "SELECT id, instruction, summary, status, files, created_at FROM edits WHERE project_id=? AND status IN ('failed','reverted') AND created_at > ? AND COALESCE(kind,'') != 'harvest' ORDER BY created_at DESC LIMIT ?",
    projectId,
    since,
    Math.max(1, Math.min(50, max)),
  );
}
