import path from "node:path";
import fs from "node:fs";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";
import { q } from "../db/db";
import { ASPECTS, PKG_BASES } from "../styles/manifest";
import { baseOf, engineDirOf, getStyle } from "../styles/catalog";
import { slugOf } from "../core/text";
import { snapshot } from "../core/gitSnapshots";
import { VIEW_NAME, getStudio, notifyStudio } from "./stages";
import { withoutLibraryLines } from "../library/context";
import { createProject, engineVersion, getProject } from "../projects/projects";
import { writeContext } from "../agent/projectContext";
import { addRefs } from "../projects/references";

const studioDir = () => path.join(templatesDir(), "studio");
const clean = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
export function aspectsOfStyle(styleId) {
  const st = getStyle(styleId);
  if (st.pkg && st.aspects?.length) return [...st.aspects];
  const f = st.controls.find((c) => c.path === "format")?.options?.map((o) => o.value) ?? [];
  const out = f.map((v) => (v === "vertical" ? "9:16" : v === "landscape" ? "16:9" : null)).filter(Boolean);
  return out.length ? out : ["16:9"];
}
const DIM_OF_BASE = { flat: "2d", collage: "2d", stickman: "2d", recon: "3d", lowpoly: "3d", "pixel-art": "3d" };
export function exportNames(src) {
  const out = new Set();
  for (const m of src.matchAll(/^[ \t]*export[ \t]+(?:async[ \t]+)?(?:function[ \t]*\*?|class)[ \t]+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of src.matchAll(/^[ \t]*export[ \t]+(?:const|let|var)[ \t]+([^\n]*)/gm)) {
    const line = m[1];
    let depth = 0,
      start = 0,
      quote = "";
    const parts = [];
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      else if (c === "," && depth === 0) {
        parts.push(line.slice(start, i));
        start = i + 1;
      } else if (c === ";" && depth === 0) {
        break;
      }
    }
    parts.push(line.slice(start));
    parts.forEach((p, k) => {
      const n = /^\s*([A-Za-z_$][\w$]*)\s*=(?!=)/.exec(p)?.[1];
      if (n && (k === 0 || !/[:]/.test(p.split("=")[0]))) out.add(n);
    });
  }
  for (const m of src.matchAll(/^[ \t]*export[ \t]*\{([^}]*)\}/gm))
    for (const part of m[1].split(",")) {
      const n = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (n && /^[A-Za-z_$][\w$]*$/.test(n)) out.add(n);
    }
  return [...out].sort();
}
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name),
      d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}
function put(file, text) {
  let has = null;
  try {
    has = fs.readFileSync(file, "utf8");
  } catch {}
  if (has === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
export function syncStudioDocs(dir, base) {
  const src = studioDir(),
    dst = path.join(dir, ".claude", "skills", "studio");
  put(
    path.join(dst, "SKILL.md"),
    `---
name: studio
description: The Videoxx Style Studio playbook (stages, gates, what may be written, the no-slop list, this base's extension points and pitfalls). Read AUTHORING.md first in every Studio run.
---

# Style Studio

Read AUTHORING.md, then stages/<the current stage>.md, then bases/${base}/extend.md and bases/${base}/dont.md. NO_SLOP.md applies to every frame.
`,
  );
  const md = (p) => (/\.md$/i.test(p) ? withoutLibraryLines(fs.readFileSync(p, "utf8")) : fs.readFileSync(p, "utf8"));
  for (const f of ["AUTHORING.md", "NO_SLOP.md", "style.schema.json"]) {
    const s = path.join(src, f);
    if (fs.existsSync(s)) put(path.join(dst, f), md(s));
  }
  for (const sub of ["stages", "templates", path.join("bases", base)]) {
    const s = path.join(src, sub);
    if (!fs.existsSync(s)) continue;
    for (const f of fs.readdirSync(s)) {
      const p = path.join(s, f);
      if (fs.statSync(p).isFile() && !(sub === "stages" && f === "critic.md")) put(path.join(dst, sub, f), md(p));
    }
  }
}
function placeholderScenes(dir, base, hasShot) {
  const views = { hero: { scenes: ["hero"], end: 6 }, kit: { scenes: ["kit"], end: 6 }, sample: { scenes: ["sample"], end: 20 } };
  for (const name of Object.keys(views)) {
    const body = hasShot
      ? `import { shot } from '../engine.js';
// PLACEHOLDER (${base}): the Style Studio has no ${name} sample for this base yet. The ${name} stage replaces this file.
shot({ t0: 0, build(S) { return {}; } });
`
      : `// PLACEHOLDER (${base}): the Style Studio has no ${name} sample for this base yet. The ${name} stage replaces this file.
export {};
`;
    fs.writeFileSync(path.join(dir, "scenes", `${name}.js`), body);
  }
  return views;
}
function copySamples(dir, base, dim) {
  const root = path.join(studioDir(), "samples", base),
    sub = dim && fs.existsSync(path.join(root, dim, "views.json")) ? path.join(root, dim) : root;
  const vf = path.join(sub, "views.json");
  if (!fs.existsSync(vf)) return false;
  const vj = JSON.parse(fs.readFileSync(vf, "utf8")),
    views = vj.views;
  for (const f of fs.readdirSync(sub)) if (f.endsWith(".js")) fs.copyFileSync(path.join(sub, f), path.join(dir, "scenes", f));
  if (fs.existsSync(path.join(sub, "assets"))) copyTree(path.join(sub, "assets"), path.join(dir, "assets"));
  const tdir = path.resolve(templatesDir()),
    adir = path.resolve(dir, "assets");
  for (const [to, from] of Object.entries(vj.copy ?? {})) {
    const src = path.resolve(tdir, String(from)),
      dst = path.resolve(dir, String(to));
    if (!src.startsWith(tdir + path.sep) || !dst.startsWith(adir + path.sep) || !fs.existsSync(src) || !fs.statSync(src).isFile()) {
      log("studio", "sample copy skipped", String(to), String(from));
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  for (const [k, v] of Object.entries(views)) if (!VIEW_NAME.test(k) || !Array.isArray(v?.scenes)) delete views[k];
  return views;
}
function copyNarration(dir, base) {
  for (const b of [base, "starter"]) {
    const t = path.join(studioDir(), "samples", b, "timeline.json");
    if (!fs.existsSync(t)) continue;
    fs.copyFileSync(t, path.join(dir, "audio", "timeline.json"));
    const s = path.join(studioDir(), "samples", b, "script.txt");
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dir, "script.txt"));
    return;
  }
}
export async function createWorkspace(raw) {
  const b = raw ?? {};
  const mode = b.mode;
  if (!["scratch", "derived", "look"].includes(mode))
    throw new Error("A Studio workspace is a new style from scratch, a style on top of another, or a look.");
  const name = clean(b.name, 60);
  if (!name) throw new Error("Give the style a name.");
  const description = clean(b.description, 4e3);
  const imageCap = Math.round(Number(b.imageCap ?? 40));
  if (!(imageCap >= 0 && imageCap <= 500)) throw new Error("The image cap must be 0-500 pictures.");
  const refs = Array.isArray(b.refs) ? b.refs.filter((x) => typeof x === "string" && x.trim()).slice(0, 40) : [];
  for (const r of refs) if (!path.isAbsolute(r.trim()) || !fs.existsSync(r.trim())) throw new Error(`${clean(r, 200)} does not exist.`);
  const target = mode === "scratch" ? "starter" : String(b.target ?? "");
  const st = getStyle(target);
  if (st.id !== target || st.missing || st.legacy || (mode !== "scratch" && st.id === "starter"))
    throw new Error(`"${clean(target, 60)}" is not a style the Studio can build on.`);
  const base = baseOf(st.id);
  if (!PKG_BASES.includes(base)) throw new Error(`${st.name} can't be a Studio base.`);
  const can = aspectsOfStyle(st.id),
    asked = (Array.isArray(b.aspects) ? b.aspects : []).filter((a, i, l) => ASPECTS.includes(a) && l.indexOf(a) === i);
  const aspects = asked.filter((a) => can.includes(a));
  if (!aspects.length) throw new Error(`${st.name} renders ${can.join(" and ")}: pick ${can.length > 1 ? "one of them" : "that"}.`);
  const dim =
    mode === "scratch" ? (b.dim === "3d" ? "3d" : "2d") : base === "starter" ? (st.pkg?.manifest.dim ?? "2d") : (DIM_OF_BASE[base] ?? null);
  const format = can.length > 1 ? (aspects[0] === "9:16" ? "vertical" : "landscape") : null;
  const presetId = mode === "scratch" ? (dim === "3d" ? "starter-plain-3d" : "starter-plain") : st.defaultLook;
  const p = await createProject({ name: `Studio: ${name}`, presetId, styleId: st.id, format, length: 20, brief: description || null });
  const dir = p.path;
  try {
    for (const d of ["scenes", "audio", "assets", "skill", "reference", ".suite/studio"])
      fs.mkdirSync(path.join(dir, d), { recursive: true });
    const engineSrc = fs.readFileSync(path.join(dir, "engine.js"), "utf8"),
      baseExports = exportNames(engineSrc);
    let views = copySamples(dir, base, dim),
      placeholder = false;
    if (!views) {
      views = placeholderScenes(dir, base, baseExports.includes("shot"));
      placeholder = true;
      log("studio", "no sample for base", base, "- placeholder scenes written");
    }
    copyNarration(dir, base);
    const tpl = (f) =>
      fs
        .readFileSync(path.join(studioDir(), "templates", f), "utf8")
        .replace(/\{\{NAME\}\}/g, name)
        .replace(/\{\{TARGET\}\}/g, st.name)
        .replace(/\{\{BASE\}\}/g, base);
    fs.writeFileSync(path.join(dir, "reference", "ANALYSIS.md"), tpl("STUDY.md"));
    for (const f of mode === "look" ? ["LOOK.md", "QUALITY.md", "PITFALLS.md"] : ["STYLE_GUIDE.md", "QUALITY.md", "PITFALLS.md"])
      fs.writeFileSync(path.join(dir, "skill", f), tpl(f));
    if (mode !== "look") {
      const id = `custom-${
        (slugOf(name) || "style")
          .replace(/[^a-z0-9-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || "style"
      }`;
      fs.writeFileSync(
        path.join(dir, "style.json"),
        JSON.stringify(
          {
            schema: 2,
            kind: "style",
            id,
            name,
            tagline: "",
            description,
            base,
            from: { style: st.id, engineVersion: engineVersion(path.join(engineDirOf(st.id), "engine.js")) },
            version: 1,
            ...(dim ? { dim } : {}),
            aspects,
            controls: { keep: [], add: [], remove: [] },
            defaults: {},
            capabilities: { needsImageKey: base === "collage" || !!st.pkg?.manifest.capabilities?.needsImageKey },
            banned: ["Math.random(", "Date.now(", "performance.now("],
            prompts: { brief: "", build: "", context: "", qualityBar: "", reframe: "", imageStyle: "", ignoreBaseRefs: [] },
          },
          null,
          2,
        ) + "\n",
      );
    }
    const first = mode === "look" ? (views.sample ? "sample" : Object.keys(views)[0]) : views.hero ? "hero" : Object.keys(views)[0];
    const now = new Date().toISOString();
    const studio = {
      schema: 1,
      mode,
      name,
      description,
      target: st.id,
      base,
      dim,
      aspects,
      packageId: null,
      stage: "brief",
      stages: { brief: { status: "done", at: now } },
      view: first,
      views,
      baseExports,
      imageCap,
      round: 1,
      look: null,
      placeholderSamples: placeholder || void 0,
      created: now,
    };
    const pjf = path.join(dir, "project.json"),
      pj = JSON.parse(fs.readFileSync(pjf, "utf8"));
    pj.title = `Studio: ${name}`;
    pj.studio = studio;
    pj.imageBudget = imageCap;
    pj.scenes = [...views[first].scenes];
    pj.end = +views[first].end;
    if (dim && base === "starter") pj.settings = { ...(pj.settings ?? {}), dim };
    fs.writeFileSync(pjf, JSON.stringify(pj, null, 1));
    q.run("UPDATE projects SET lab_kind='studio', status='editing', duration=? WHERE id=?", pj.end, p.id);
    if (refs.length) await addRefs(p.id, refs);
    syncStudioDocs(dir, base);
    writeContext(p.id);
    await snapshot(dir, `Style Studio: ${mode === "look" ? "look" : "style"} "${name}" started`);
  } catch (err) {
    try {
      q.run("DELETE FROM projects WHERE id=?", p.id);
    } catch {}
    throw err;
  }
  notifyStudio(p.id);
  return { project: getProject(p.id), ...getStudio(p.id) };
}
export function fontLibrary() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(studioDir(), "fonts", "fonts.json"), "utf8"));
    return Array.isArray(j?.fonts) ? j.fonts : [];
  } catch {
    return [];
  }
}
export function addFont(dir, id) {
  const f = fontLibrary().find((x) => x.id === id);
  if (!f)
    throw new Error(
      `"${clean(id, 40)}" is not in the font library. Fonts: ${fontLibrary()
        .map((x) => x.id)
        .join(", ")}.`,
    );
  const src = path.resolve(templatesDir(), f.file);
  if (!src.startsWith(path.resolve(templatesDir()) + path.sep) || !fs.existsSync(src) || !/\.woff2$/i.test(src))
    throw new Error("That library font is missing from the app.");
  const name = path.basename(src),
    rel = `fonts/${name}`;
  const eng = path.join(dir, "engine.js"),
    s = fs.readFileSync(eng, "utf8");
  const at = s.indexOf("export const FONT_FILES = [");
  if (at < 0)
    throw new Error(
      "This engine has no literal FONT_FILES list to add a font to (it builds it elsewhere): load the font from the engine's own font table instead.",
    );
  const open = at + "export const FONT_FILES = ".length;
  let depth = 0,
    end = -1;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (!depth) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error("The engine's FONT_FILES list is not closed.");
  const list = s.slice(open, end + 1);
  const ENTRY = /\[\s*'([^']+)'\s*,\s*'fonts\/([\w.-]+)'\s*,\s*'([\d ]+)'\s*,\s*'(normal|italic)'\s*\]/g;
  const rest = list.slice(1, -1).replace(ENTRY, "").replace(/[\s,]/g, "");
  if (rest) throw new Error("The engine's FONT_FILES list holds more than plain font entries: add the font there by hand.");
  const have = [...list.matchAll(ENTRY)];
  if (!fs.existsSync(path.join(dir, rel)) || fs.statSync(path.join(dir, rel)).size !== fs.statSync(src).size) {
    fs.mkdirSync(path.join(dir, "fonts"), { recursive: true });
    fs.copyFileSync(src, path.join(dir, rel));
  }
  if (have.some((m) => m[2] === name)) return { family: f.family, weight: f.weight, style: f.style, file: rel, added: false };
  const entry = `['${f.family.replace(/'/g, "")}', '${rel}', '${f.weight}', '${f.style}']`;
  const next = have.length ? list.slice(0, -1).replace(/\s*$/, "") + `, ${entry}]` : `[${entry}]`;
  const out = s.slice(0, open) + next + s.slice(end + 1);
  if ([...next.matchAll(ENTRY)].length !== have.length + 1 || exportNames(out).join() !== exportNames(s).join())
    throw new Error("Adding the font would have broken the engine; nothing was changed.");
  fs.writeFileSync(eng, out);
  return { family: f.family, weight: f.weight, style: f.style, file: rel, added: true };
}
