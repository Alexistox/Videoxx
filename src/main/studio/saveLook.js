import path from "node:path";
import fs from "node:fs";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";
import { LOOK_ID, parseLook } from "../styles/manifest";
import { getStyle } from "../styles/catalog";
import { validateSettings } from "../styles/presets";
import { slugOf } from "../core/text";
import { loadStudioLooks, studioLooksRoot } from "../styles/packages";
import { readLessons } from "../projects/issues";
import { FILL_MARK, collectFacts, gateOf, notifyStudio, readVersions, requireStudio, stagesOf, writeStudio } from "./stages";
import { aspectTag, mainView, settingsFor } from "./runChecks";

const clip = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const templateLines = () => {
  try {
    return new Set(
      fs
        .readFileSync(path.join(templatesDir(), "studio", "templates", "LOOK.md"), "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
};
function section(md, ...names) {
  const lines = md.split(/\r?\n/),
    out = [],
    tpl = templateLines();
  let on = false;
  for (const l of lines) {
    const h = /^#{2,3}\s+(.*)$/.exec(l);
    if (h) {
      on = names.some((n) => h[1].toLowerCase().includes(n));
      continue;
    }
    if (on && !tpl.has(l.trim())) out.push(l);
  }
  return out.join("\n").split(FILL_MARK).join("").trim().slice(0, 4e3);
}
export function saveLook(projectId, o = {}) {
  const { dir, studio } = requireStudio(projectId);
  if (studio.mode !== "look") throw new Error("Only a look is saved this way (a style is published).");
  if (studio.stage !== "save") throw new Error("Approve the review first: a look is saved from the Save stage.");
  const order = stagesOf(studio.mode),
    facts = collectFacts(dir, studio);
  for (const s of order.slice(0, order.indexOf("save"))) {
    const g = gateOf(s, studio.mode, facts);
    if (!g.ok) throw new Error(`The ${s} stage is not finished: ${g.missing.join("; ")}.`);
  }
  const st = getStyle(studio.target);
  if (st.id !== studio.target || st.missing) throw new Error(`The style "${clip(studio.target, 40)}" is not installed any more.`);
  const name = clip(o.name || studio.saved?.name || studio.name, 60);
  if (!name) throw new Error("Give the look a name.");
  const description = clip(o.description ?? studio.description, 1e3);
  const settings = settingsFor(dir, studio, studio.aspects[0]);
  delete settings.graphics;
  const bad = validateSettings(settings, st.id);
  if (bad) throw new Error(`The look's settings are not valid for ${st.name}: ${bad}`);
  const root = studioLooksRoot();
  fs.mkdirSync(root, { recursive: true });
  let id = studio.saved?.lookId && LOOK_ID.test(studio.saved.lookId) ? studio.saved.lookId : "";
  if (!id) {
    const slug =
      (slugOf(name) || "look")
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 30) || "look";
    for (let k = 1; k < 500 && !id; k++) {
      const c = `look-${slug}${k > 1 ? `-${k}` : ""}`;
      if (!fs.existsSync(path.join(root, `${c}.json`))) id = c;
    }
    if (!id) throw new Error("Too many looks with that name: pick another name.");
  }
  let md = "";
  try {
    md = fs.readFileSync(path.join(dir, "skill", "LOOK.md"), "utf8");
  } catch {}
  const never = section(md, "never");
  const context = [section(md, "notes for the build", "build notes") || clip(description, 1e3), never ? `Never: ${never}` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4e3);
  const qualityBar = section(md, "quality bar");
  const pitfalls = readLessons(dir)
    .map((l) => clip(`${l.finding} -> ${l.lesson}`, 1e3))
    .slice(0, 100);
  const last2 = readVersions(dir).slice(-1)[0],
    view = mainView(studio);
  const frames = (last2?.renders?.[studio.aspects[0]]?.frames ?? []).filter((f2) => f2.view === view);
  const pick = frames[Math.floor(frames.length / 2)] ?? (last2?.renders?.[studio.aspects[0]]?.frames ?? [])[0];
  let preview;
  if (pick)
    try {
      fs.copyFileSync(path.join(dir, pick.file), path.join(root, `${id}.jpg`));
      preview = `${id}.jpg`;
    } catch (e) {
      log("studio", "look preview not saved", e?.message);
    }
  const look = {
    schema: 2,
    kind: "look",
    id,
    style: st.id,
    name,
    description,
    settings,
    notes: { context, qualityBar },
    pitfalls,
    ...(preview ? { preview } : {}),
    workspace: projectId,
    version: last2?.v ?? null,
    aspects: studio.aspects,
    saved: new Date().toISOString(),
  };
  const p = parseLook(look);
  if (!p.ok) throw new Error(`The look could not be saved: ${p.why}`);
  const f = path.join(root, `${id}.json`),
    tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(look, null, 2) + "\n");
  fs.renameSync(tmp, f);
  const seen = loadStudioLooks();
  if (!seen.includes(id)) throw new Error("The look was written but could not be loaded (see the log).");
  writeStudio(projectId, (s) => {
    s.saved = { lookId: id, name, at: look.saved, version: last2?.v ?? null };
    s.stages ??= {};
    s.stages.save = { status: "done", at: look.saved };
  });
  log("studio", "look saved", id, "for", st.id, preview ? `(preview ${pick?.file} ${aspectTag(studio.aspects[0])})` : "(no preview)");
  notifyStudio(projectId);
  return { lookId: id, presetId: id, name, style: st.id, styleName: st.name, preview: preview ?? null };
}
