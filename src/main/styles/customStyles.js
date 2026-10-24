import path from "node:path";
import fs from "node:fs";
import { ws } from "../core/workspace";
import { log } from "../core/log";
import { now, q } from "../db/db";
import { CUSTOM, getStyle } from "./catalog";
import { getPreset } from "./presets";
import { serverUrl } from "../projects/fileServer";
import { customControls, exportedObject } from "./controlsReader";

export const stylesRoot = () => path.join(ws.root(), "styles");
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name),
      b = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}
const firstSentence = (s) => (String(s || "").split(/(?<=[.!?])\s/)[0] || "").slice(0, 140);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const deepMerge = (a, b) => {
  const o = { ...a };
  for (const k in b || {}) o[k] = isObj(b[k]) && isObj(a?.[k]) ? deepMerge(a[k], b[k]) : b[k];
  return o;
};
export function engineDefaults(engineFile) {
  try {
    const v = exportedObject(fs.readFileSync(engineFile, "utf8"), "DEFAULTS");
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}
export function customLookSettings(engineFile, labSettings) {
  const vox = getPreset("collage-press")?.settings ?? {},
    defs = engineDefaults(engineFile) ?? {};
  const strip = (s, v) => {
    const o = {};
    for (const k in s || {}) {
      if (k === "format" || k === "sheet") {
        o[k] = s[k];
        continue;
      }
      if (isObj(s[k]) && isObj(v?.[k])) {
        const sub = strip(s[k], v[k]);
        if (Object.keys(sub).length) o[k] = sub;
      } else if (JSON.stringify(s[k]) !== JSON.stringify(v?.[k])) o[k] = s[k];
    }
    return o;
  };
  const out = deepMerge(defs, strip(labSettings || {}, vox));
  if (!isObj(out.post)) delete out.post;
  return { ...out, theme: "press" };
}
function upsertLooks(id, name, labSettings, engineFile = path.join(stylesRoot(), id, "engine.js")) {
  const base = customLookSettings(engineFile, labSettings);
  const looks = [
    {
      id: `${id}-default`,
      name: "Default",
      desc: `${name}, as designed in its lab.`,
      s: { ...base, format: base.format === "vertical" ? "landscape" : base.format || "landscape" },
    },
    {
      id: `${id}-vertical`,
      name: "Vertical",
      desc: `${name} for shorts (1080×1920), chapters two per row.`,
      s: { ...base, format: "vertical", sheet: { ...(base.sheet || {}), cols: 2 } },
    },
  ];
  for (const l of looks) {
    if (q.get("SELECT id FROM presets WHERE id=?", l.id))
      q.run(
        "UPDATE presets SET name=?, description=?, settings=?, style_id=?, updated_at=? WHERE id=?",
        l.name,
        l.desc,
        JSON.stringify(l.s),
        id,
        now(),
        l.id,
      );
    else
      q.run(
        "INSERT INTO presets(id,name,description,settings,builtin,style_id,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)",
        l.id,
        l.name,
        l.desc,
        JSON.stringify(l.s),
        id,
        now(),
        now(),
      );
  }
}
export function loadCustomStyles() {
  CUSTOM.length = 0;
  const root = stylesRoot();
  if (!fs.existsSync(root)) return CUSTOM;
  const base = getStyle("collage");
  for (const id of fs.readdirSync(root)) {
    const dir = path.join(root, id),
      sj = readJson(path.join(dir, "style.json"));
    if (!sj?.name || sj.id !== id || !fs.existsSync(path.join(dir, "engine.js"))) continue;
    const v = (f) =>
      fs.existsSync(path.join(dir, f)) ? `${serverUrl()}/s/${id}/${f}?v=${Math.round(fs.statSync(path.join(dir, f)).mtimeMs)}` : null;
    CUSTOM.push({
      ...base,
      id,
      name: sj.name,
      tagline: sj.tagline || firstSentence(sj.description) || "Your own style",
      description: sj.description || sj.tagline || "",
      brief: sj.brief || `${sj.name}: ${sj.description || ""} Follow this style's own rules (the skill's references/custom_style.md).`,
      base: "collage",
      custom: true,
      dir,
      lab: sj.lab ?? null,
      imageStyle: styleImageLine(sj.imageStyle, sj.description),
      defaultLook: `${id}-default`,
      // the style IS its colours: no base theme switch; a scenes-mode style has no page of panels (no "per row")
      controls: customControls(base.controls, sj.controls).filter(
        (c) => !(c.path === "sheet.cols" && engineDefaults(path.join(dir, "engine.js"))?.mode === "scenes"),
      ),
      preview: v("preview.mp4"),
      poster: v("preview.jpg"),
    });
    try {
      const d = q.get("SELECT settings FROM presets WHERE id=?", `${id}-default`);
      if (d) {
        const s = JSON.parse(d.settings),
          want = customLookSettings(path.join(dir, "engine.js"), s);
        if (
          !q.get("SELECT id FROM presets WHERE id=?", `${id}-vertical`) ||
          JSON.stringify(want) !== JSON.stringify({ ...s, format: want.format })
        )
          upsertLooks(id, sj.name, s, path.join(dir, "engine.js"));
      }
    } catch (e) {
      log("looks for", id, "failed", e.message);
    }
  }
  return CUSTOM;
}
export function styleImageLine(imageStyle, description) {
  const s = String(imageStyle || "").trim();
  if (s && !/^Vintage engraving illustration, fine black ink crosshatching, cut out of paper like a collage sticker\.?$/i.test(s)) return s;
  const d = String(description || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return d ? `Illustration in this style: ${d}` : "";
}
export function restoreStyleFromProject(dir) {
  const pj = readJson(path.join(dir, "project.json")),
    id = String(pj?.style || "");
  if (!id.startsWith("custom-") || !getStyle(id).missing) return false;
  const sj = readJson(path.join(dir, ".custom-style", "style.json"));
  if (!sj?.name || sj.id !== id || !fs.existsSync(path.join(dir, "engine.js"))) return false;
  const dst = path.join(stylesRoot(), id);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ["engine.js", "models.js"]) if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(dst, f));
  for (const d of ["fonts", "vendor"]) copyDir(path.join(dir, d), path.join(dst, d));
  const guide = path.join(dir, ".custom-style", "STYLE_GUIDE.md");
  fs.writeFileSync(
    path.join(dst, "STYLE.md"),
    fs.existsSync(guide)
      ? fs.readFileSync(guide, "utf8")
      : `# ${sj.name}
`,
  );
  fs.writeFileSync(
    path.join(dst, "style.json"),
    JSON.stringify({ ...sj, lab: null, restoredFrom: path.basename(dir), updated: now() }, null, 2),
  );
  if (!q.get("SELECT id FROM presets WHERE id=?", `${id}-default`)) upsertLooks(id, sj.name, pj.settings);
  loadCustomStyles();
  log("custom style restored from a project", id, dir);
  return true;
}
export function restoreMissingStyles() {
  let n = 0;
  for (const p of q.all("SELECT path FROM projects WHERE style_id LIKE 'custom-%'")) {
    try {
      if (fs.existsSync(p.path) && restoreStyleFromProject(p.path)) n++;
    } catch (e) {
      log("restore style failed", p.path, e.message);
    }
  }
  return n;
}
export function deleteCustomStyle(id) {
  const st = getStyle(id);
  if (!st.custom || st.id !== id) throw new Error("Only custom styles can be deleted.");
  const users = q.all("SELECT name FROM projects WHERE style_id=?", id).map((r) => `"${r.name}"`);
  if (users.length)
    throw new Error(
      `${users.length === 1 ? "A project uses" : `${users.length} projects use`} this style: ${users.slice(0, 5).join(", ")}${users.length > 5 ? " …" : ""}. Delete ${users.length === 1 ? "it" : "them"} first (Projects).`,
    );
  fs.rmSync(path.join(stylesRoot(), id), { recursive: true, force: true });
  q.run("DELETE FROM presets WHERE style_id=?", id);
  loadCustomStyles();
}
