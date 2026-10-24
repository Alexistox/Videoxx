import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import cp from "node:child_process";
import os from "node:os";
import { shell } from "electron";
import { getConfig } from "../core/config";
import { templatesDir, ws } from "../core/workspace";
import { now, q, uid } from "../db/db";
import { GIF_WIDTH, aspectOf, baseOf, engineDirOf, getStyle, pinnedManifest, smoothScale } from "../styles/catalog";
import { brandError, normHex } from "../styles/brand";
import { figuresError } from "../styles/figures";
import { getPreset, listPresets, writeSettings } from "../styles/presets";
import { slugOf } from "../core/text";
import { characterForProject } from "../characters/characterLab";
import { seedSprites } from "../characters/sprites";
import { carriedIsSameStyle, carryPackage, installCarriedAsNew, noteCarried, restorePackageFromProject } from "../styles/packages";
import { lookInFormat, withFormat } from "../styles/lookFormat";
import { ensureIgnore, ensureRepo } from "../core/gitSnapshots";
import { cantDrawWhy, countWords, lang, langCode, languagesFor, otherScriptLanguage, styleDraws, whoCanDraw } from "../styles/languages";
import { spokenScript } from "../voice/spokenScript";
import { SAME_RUN_MS } from "../pipeline/steps";
import { coverFile } from "../render/covers";
import { VERTICAL_KINDS, VERTICAL_NAME } from "../render/verticalPlan";
import { projectSkillName } from "./scriptSkill";
import { writeContext } from "../agent/projectContext";

export const STRUCTURE = `project.json      title, length, scene order, images, engine settings (managed by the Suite)
CLAUDE.md         project context Claude reads first (the Suite regenerates the marked block)
STYLE.md          project style rules (managed in Memory)
storyboard.md     sections, time ranges and the visual for every sentence
engine.js         Suite engine (settings-driven, pickable)
models.js         shared model library;  world.js (optional) project models
scenes/           one file per section, listed in project.json
audio/            source, clean.wav, timeline.json, captions.srt, beds.json, events.json, final_mix.wav
assets/           real-world images (credits in assets/credits.json)
out/              exports
.suite/           app cache: thumbnails, rendered frames, waveform`;
const slugify = (s) => slugOf(s) || "project";
function uniqueDir(base) {
  const taken = (d) => fs.existsSync(d) || !!q.get("SELECT 1 AS x FROM projects WHERE lower(path)=lower(?)", d);
  let dir = path.join(ws.projects(), base),
    i = 2;
  while (taken(dir)) dir = path.join(ws.projects(), `${base}-${i++}`);
  return dir;
}
function copyDir(src, dst, skip, rel = "") {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (skip(r, e.isDirectory())) continue;
    const s = path.join(src, e.name),
      d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, skip, r);
    else fs.copyFileSync(s, d);
  }
}
export const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
};
export function listProjects() {
  return q
    .all("SELECT * FROM projects ORDER BY COALESCE(opened_at, updated_at) DESC")
    .map((p) => ({ ...p, exists: fs.existsSync(p.path), ...labOf(p) }));
}
function labOf(p) {
  if (p.lab_kind === "studio") return { lab: true, labKind: "studio" };
  if (p.style_id !== "collage" && p.style_id !== "flat") return { lab: false, labKind: null };
  const pj = readJson(path.join(p.path, "project.json"));
  return pj?.styleLab
    ? { lab: true, labKind: "style" }
    : pj?.characterLab
      ? { lab: true, labKind: "character" }
      : { lab: false, labKind: null };
}
export function getProject(id) {
  const p = q.get("SELECT * FROM projects WHERE id=?", id);
  if (!p) throw new Error("Project not found");
  return p;
}
function installEngine(dir, force = false, styleId) {
  const st = getStyle(styleId),
    t = engineDirOf(styleId);
  if (!fs.existsSync(dir))
    throw new Error(`This video's folder is not there any more (${dir}). If you moved or renamed it, use Import to bring it back.`);
  const lost = ["engine.js", "models.js"].filter((f) => !fs.existsSync(path.join(t, f)));
  if (lost.length)
    throw new Error(
      `The app's ${st.name} engine files are missing (${lost.join(", ")} in ${t}). Reinstall Videoxx; if it happens again, allow its install folder in your antivirus.`,
    );
  for (const f of ["engine.js", "models.js"])
    if (force || !fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(t, f), path.join(dir, f));
  for (const sub of ["vendor", "fonts", "lib", ...(st.pkg && !st.pkg.official ? ["sprites"] : [])])
    if (fs.existsSync(path.join(t, sub))) copyDir(path.join(t, sub), path.join(dir, sub), () => false);
  const figs = path.join(t, "assets", "figures");
  if (fs.existsSync(figs))
    copyDir(
      figs,
      path.join(dir, "assets", "figures"),
      (r, isDir) =>
        !isDir &&
        fs.existsSync(path.join(dir, "assets", "figures", r)) &&
        fs.statSync(path.join(dir, "assets", "figures", r)).size === fs.statSync(path.join(figs, r)).size,
    );
  const appFigs = path.join(templatesDir(), "recon", "assets", "figures");
  if (st.pkg && baseOf(st.id) === "recon" && path.resolve(figs) !== path.resolve(appFigs) && fs.existsSync(appFigs))
    copyDir(appFigs, path.join(dir, "assets", "figures"), (r, isDir) => !isDir && fs.existsSync(path.join(dir, "assets", "figures", r)));
  ensureSkill(dir, st.id);
}
const skipSkill = (r) => r.startsWith("evals") || r.includes("__pycache__");
function treeStamp(dir, rel = "") {
  let out = "";
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (skipSkill(r)) continue;
    const f = path.join(dir, e.name);
    out += e.isDirectory()
      ? treeStamp(f, r)
      : `${r}:${fs.statSync(f).size}:${Math.round(fs.statSync(f).mtimeMs)}
`;
  }
  return out;
}
function pinnedStyle(dir, st) {
  if (!st.pkg || st.pkg.official) return st;
  const m = pinnedManifest(dir, st.id);
  return m ? { ...st, pkg: { ...st.pkg, dir: path.join(dir, ".style-pkg"), manifest: m } } : st;
}
export function ensureSkill(dir, styleId) {
  const st = getStyle(styleId),
    pin = st.pkg ? pinnedStyle(dir, st) : st;
  const baseSnap = pin.pkg ? path.join(pin.pkg.dir, "skill", "base") : null;
  if (baseSnap && fs.existsSync(path.join(baseSnap, "SKILL.md"))) {
    ensureNamedSkill(dir, st.skill, baseSnap);
    const appScripts = path.join(templatesDir(), "skill", st.skill, "scripts");
    if (fs.existsSync(appScripts)) copyDir(appScripts, path.join(dir, ".claude", "skills", st.skill, "scripts"), skipSkill);
  } else ensureNamedSkill(dir, st.skill);
  if (pin.pkg) ensurePackageSkill(dir, pin);
  const lab = !st.custom && st.id === "collage" ? readJson(path.join(dir, "project.json"))?.styleLab : null;
  if (!(st.custom && st.dir) && !lab) return;
  const skill = path.join(dir, ".claude", "skills", st.skill);
  if (!fs.existsSync(skill)) return;
  const name = lab ? String(lab.name || "this style") : st.name,
    rulesFile = st.dir ? path.join(st.dir, "STYLE.md") : "";
  const rules = lab
    ? `# ${name} (being designed in this style lab)

The style's rules are STYLE_GUIDE.md in the project folder, which you write from the user's description and references.
The user's description: ${String(lab.description || "").replace(/\s+/g, " ")}
`
    : fs.existsSync(rulesFile)
      ? `# Custom style: ${name}

${fs.readFileSync(rulesFile, "utf8")}`
      : `# Custom style: ${name}

${st.description || ""}
`;
  const src = (f) => {
    try {
      return fs.readFileSync(path.join(templatesDir(), "skill", st.skill, f), "utf8");
    } catch {
      return "";
    }
  };
  const scenes = /mode: 'scenes'/.test(
    (() => {
      try {
        return fs.readFileSync(path.join(dir, "engine.js"), "utf8");
      } catch {
        return "";
      }
    })(),
  );
  const want = customSkillFiles(name, src("SKILL.md"), !!lab, scenes || !!lab);
  const files = [
    ["references/custom_style.md", rules],
    ["SKILL.md", want.skill],
    ["references/style_guide.md", want.guide],
    ["references/pitfalls.md", want.pitfalls],
    ["references/sound_design.md", src("references/sound_design.md").replace(/^# Sound design \(.*\)/, `# Sound design (${name})`)],
  ];
  for (const [rel, txt] of files) {
    const f = path.join(skill, rel);
    let has = "";
    try {
      has = fs.readFileSync(f, "utf8");
    } catch {}
    if (has !== txt) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, txt);
    }
  }
}
function customSkillFiles(name, baseSkill, lab = false, scenes = true) {
  const sop = (/## SOP[\s\S]*?(?=\n## Non-negotiables)/.exec(baseSkill)?.[0] ?? "").trim();
  const skill = `---
name: vox-collage-video
description: Build a video in the custom style "${name}" in Videoxx from a timed voiceover, on the Suite's Three.js scene engine (full-frame scenes, cut-out pictures made with make_image, engine typography, word-synced cues, smooth camera). The look is entirely the style's own (references/custom_style.md).
---

# ${name} (a custom style, Videoxx)

**${name}** is the user's own style. ${lab ? "This project is its style lab: you design the look here, on a neutral base." : "It was designed in a style lab from the user's description and references."}
Everything visual comes from the style: colours, backgrounds, fonts, textures, picture art, borders and outlines, which
kinds of elements exist at all, and how things move. Read references/custom_style.md first: it is the look, and it wins
over everything else here. This project's engine.js is the style's own copy: its DEFAULTS (mode 'scenes', post finish,
look switches) and THEMES.press (the palette) are the style.

${
  scenes
    ? `Engine structure (scenes mode): every chapter is a full-frame scene, \`panel(i, { bg })\` (bg: a palette name, '#hex' or a
make_image background); the camera frames it with \`shot()\` and slides to the next scene (DEFAULTS look.between); there
is no finale page (don't call finale()).`
    : `Engine structure: this style's engine predates scenes mode, so every chapter is a panel on one large page
(\`panel(slot, { bg })\`), the camera travels between panels with \`shot()\`, and \`finale()\` pulls back over all of them at
the end, drawn the way this style's engine draws it.`
} Elements: \`cutout\` (pictures), \`headline\`, \`label\`, \`counter\`, \`mark\`, \`dots\`,
\`drawn\` (anything on a canvas), \`photo\`, \`paperPiece\` (a card/shape to compose on); see references/engine_api.md.

The app has already done the setup: \`engine.js\`, \`models.js\`, \`fonts/\`, \`vendor/\` exist; \`audio/clean.wav\`,
\`audio/timeline.json\` and \`audio/script_timed.txt\` are ready (a lab has no audio); \`project.json\` has \`end\` and the look.
You write \`storyboard.md\`, the image list, the images (with the \`make_image\` tool), the scene files in \`scenes/\`
(listed in \`project.json\` "scenes"), new helpers in \`models.js\`, and \`audio/beds.json\`. The app renders, mixes, exports.

Read first:
- \`references/custom_style.md\` - THE LOOK: this style's rules, what it uses and what it never uses
- \`references/style_guide.md\` - the quality bar that holds in every style (framing, overlaps, readability, timing)
- \`references/engine_api.md\` - every building block with its options
- \`references/pitfalls.md\` - engine and tool lessons
- \`references/sound_design.md\` - beds.json

## Workflow
1. Read \`audio/script_timed.txt\`. Split it into chapters, one scene each: as many as the build prompt's PACING line says (from the look's
   Pictures per minute and the length; 5-9 for about a minute), with that many pictures. Write \`storyboard.md\`: per chapter the
   scene, its 1-3 camera framings, and what lands on which word, using only the kinds of elements custom_style.md uses.
2. Write the image list at the end of \`storyboard.md\`: every image once, \`name | kind | what it shows\`.
3. Keep \`project.json\` "imageStyle" exactly as it is: it is this style's art line and goes in front of every prompt, so
   describe only the subject. Make the images with \`make_image\` (kind "cutout" for subjects, "background" for
   full-scene backgrounds). Leave its aspect out: a background or full-scene picture then comes at the video's own frame
   (16:9, or 9:16 in a vertical video); never 1:1 or 3:2 for a picture that fills a scene. Look at each one.
4. PLAN EVERY FRAME (the SOP below), then build scene by scene in \`scenes/s1_*.js\` ...
5. VERIFY every scene (the SOP below): \`check_preview\`, then \`check_layout\` until clean, then the visual pass, where you
   also ask: does this frame look like ${name} as custom_style.md describes it? Fix what doesn't.
6. Write \`audio/beds.json\` (music mood + room tone in the mood of this style). Don't mix or export.

${sop.replace(/panel/g, "scene")}

## Non-negotiables
- Every fact and date on screen is exactly right and matches the narration. Check them.
- No text inside any image. All text is animated typography from the engine, in this style's fonts.
- The look is this style's in every scene (custom_style.md): its palette, its fonts, its picture art, nothing it doesn't use.
- Keep image generation cheap: plan first, make each image once, reuse images across scenes.
`;
  const guide = `# The quality bar (custom style "${name}")

The LOOK of this style is references/custom_style.md (colours, fonts, backgrounds, elements, motion, and what it never
uses). This file is only what holds in every style on this engine.

## PROHIBITED in every style
- **Anything cut by the frame edge**, or a frame that shows past its scene. Everything is fully in or fully out.
- **Accidental overlaps.** Every overlap is a decision (\`over\`), never an accident.
- **Invisible or pointless text.** If it can't be read, give it a backing or make it bigger; if it isn't relevant, drop it.
- **Imprecision.** Marks around their word (\`mark({ around, word })\`, \`wordBox\`), nothing placed by eye.
- **Rushed camera.** Leave the engine's transition durations; no snap zooms.
- **Slapped-on motion.** Nothing slams in big and tilted.
- **Off-style elements.** Only the element kinds, fonts and colours custom_style.md uses.

## Structure
- 5-9 chapters, 5-9 s each, each its own full-frame scene; the camera slides from one scene to the next.
- Inside a scene: 1-3 framings, calm. One hero subject, big; supporting pieces smaller; 0.4 units of air everywhere.
- Land every element on its spoken word (\`cue()\`), 0-0.15 s before the word. One new thing at a time.

## Layers
backgrounds and cards < pictures (0) < type (1) < labels, counters (2) < marks (3) < top (4).
`;
  const pitfalls = `# Pitfalls (engine and tools)

## No pictures, no video
If \`make_image\` says image generation is not working (no Higgsfield / Fal.ai key, no connection, key rejected, no credits),
STOP making images. Never stand in hand-drawn shapes, emoji, coloured boxes or big text for the pictures. Finish only what
needs no new image, then tell the user plainly that the pictures could not be made, why, and how to fix it.

## Images
- **A style reference leaks its subject.** Don't use \`ref\`; the shared \`imageStyle\` keeps the look consistent.
- **Transparency** is made locally from a flat white background: one subject, on white, with margin. Enclosed gaps are
  removed only when flat pure white.
- **Text in images** can't be edited: "no labels, no names, no writing".
- **Budget.** About $0.013 an image; 15-25 for a minute; the same name + prompt again is free.

## Selection and precision
- Every element carries its own selection key; something built by hand (a raw THREE object) needs \`userData._st\` and a
  \`name\`, or a click selects the whole scene.
- Never place a circle, underline or arrow by eye: \`mark({ around, word })\`, \`wordBox()\`.

## Layout and camera
- **Frame 0 shows the hero** (\`at <= 0\`).
- **A zoomed shot must stay inside its scene**: x within +-(8 - 8/zoom), y within +-(4.5 - 4.5/zoom) (16:9).
- **Drift shrinks the frame** over the shot (zoom x (1 + drift)); elements near the edge need more air, or drift 0.
- Elements that slide in from outside a scene are seen over the neighbouring scene during a transition: start them after it.

## Timing
- Transitions are centred on the shot's \`at\`: put the incoming scene's hero at \`at - .5\` or earlier.
- Transcripts mishear words: \`cue()\` needs the word as it is in audio/timeline.json.
`;
  return { skill, guide, pitfalls };
}
function packageSkillText(st) {
  const m = st.pkg.manifest,
    base = getStyle(st.base),
    files = (() => {
      const d = path.join(st.pkg.dir, "skill");
      const out = [];
      const walk = (a, rel) => {
        if (!fs.existsSync(a)) return;
        for (const e of fs.readdirSync(a, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(path.join(a, e.name), r);
          else if (e.isFile()) out.push(r);
        }
      };
      walk(d, "");
      return out.filter((f) => f !== "SKILL.md" && !f.startsWith("base/"));
    })();
  const desc = `The look of the style "${st.name}" in Videoxx (built on ${base.name}). Read it before building or editing any scene of a project in this style: its look wins over the look references of the ${base.skill} skill.`;
  return {
    files,
    text: `---
name: style-${st.id}
description: ${JSON.stringify(desc)}
---

# ${st.name} (a style package, Videoxx)

${m.description || m.tagline || ""}

This project's style is "${st.name}", built on ${base.name}. Its engine works like ${base.name}'s: the engine API, the workflow,
the checks and the quality gates of the ${base.skill} skill all apply.

THE LOOK is this style's own: its palette, type, backgrounds, elements and motion come from the files below and from this
project's engine (its DEFAULTS and colours). Where the ${base.skill} skill's look references (style guide, palette, example
looks) say something else, this style wins.${
      m.prompts.ignoreBaseRefs.length
        ? `
Ignore these ${base.skill} references for the look: ${m.prompts.ignoreBaseRefs.join(", ")}.`
        : ""
    }

## Files
${files.length ? files.map((f) => `- \`${f}\``).join("\n") : "- (none: the look is this project's engine)"}
`,
  };
}
function ensurePackageSkill(dir, st) {
  const src = path.join(st.pkg.dir, "skill"),
    dst = path.join(dir, ".claude", "skills", `style-${st.id}`),
    stampFile = path.join(dst, ".suite-stamp");
  const { text } = packageSkillText(st);
  const stamp = crypto
    .createHash("sha1")
    .update(text)
    .update(fs.existsSync(src) ? treeStamp(src) : "")
    .digest("hex");
  let have = "";
  try {
    have = fs.readFileSync(stampFile, "utf8").trim();
  } catch {}
  if (have === stamp && fs.existsSync(path.join(dst, "SKILL.md"))) return;
  fs.rmSync(dst, { recursive: true, force: true });
  if (fs.existsSync(src))
    copyDir(
      src,
      dst,
      (r, isDir) => skipSkill(r) || r === "base" || r.startsWith("base/") || (!isDir && !fs.lstatSync(path.join(src, r)).isFile()),
    );
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(dst, "SKILL.md"), text);
  fs.writeFileSync(stampFile, stamp);
}
export function ensureNamedSkill(dir, name, skillSrc = path.join(templatesDir(), "skill", name)) {
  const projSkill = path.join(dir, ".claude", "skills", name),
    stampFile = path.join(projSkill, ".suite-stamp");
  if (fs.existsSync(skillSrc)) {
    const stamp = crypto.createHash("sha1").update(treeStamp(skillSrc)).digest("hex");
    let have = "";
    try {
      have = fs.readFileSync(stampFile, "utf8").trim();
    } catch {}
    if (have !== stamp || !fs.existsSync(path.join(projSkill, "SKILL.md"))) {
      fs.rmSync(projSkill, { recursive: true, force: true });
      copyDir(skillSrc, projSkill, skipSkill);
      fs.writeFileSync(stampFile, stamp);
    }
  }
  try {
    ensureIgnore(dir);
  } catch {}
}
export function engineVersion(file) {
  try {
    const s = fs.readFileSync(file, "utf8");
    const m = s.match(/export const ENGINE_VERSION = (\d+)/);
    return m ? +m[1] : s.includes("export const SUITE") ? 1 : 0;
  } catch {
    return 0;
  }
}
export const latestEngine = (styleId) => engineVersion(path.join(engineDirOf(styleId), "engine.js"));
export function engineLanguage(dir) {
  let e = "";
  try {
    e = fs.readFileSync(path.join(dir, "engine.js"), "utf8");
  } catch {}
  return {
    accents: e.includes("normalize('NFKD').replace(/\\p{M}/gu, '')"),
    fmt: e.includes("__CZ_LANG"),
    /** a cue may span several timed words (Japanese, Chinese, Thai: pixel v7, Vox v7, flat v6, recon v5, stick figures v4) */
    across: e.includes("joined until they hold it"),
  };
}
export function engineBrand(dir, styleId) {
  let e = "";
  try {
    e = fs.readFileSync(path.join(dir, "engine.js"), "utf8");
  } catch {}
  return e.includes("export const BRAND") ? "yes" : getStyle(styleId).custom || baseOf(styleId) === "vox" ? "own" : "old";
}
export function styleVersions(dir, styleId) {
  const st = getStyle(styleId);
  if (!st.pkg || st.pkg.official) return null;
  const installed = st.pkg.manifest.version,
    pinned = pinnedManifest(dir, st.id)?.version ?? installed;
  return { pinned, installed, newer: installed > pinned };
}
export function engineIsCurrent(dir, styleId) {
  return (
    getStyle(styleId).missing ||
    (engineVersion(path.join(dir, "engine.js")) >= latestEngine(styleId) && !styleVersions(dir, styleId)?.newer)
  );
}
export function upgradeEngine(dir, presetId, styleId) {
  if (getStyle(styleId).missing)
    throw new Error("The custom style of this project is not installed on this computer, so its engine stays as it is.");
  carryStyle(dir, styleId);
  const old = path.join(dir, "engine.js"),
    pkg = getStyle(styleId).pkg;
  if (fs.existsSync(old)) {
    fs.mkdirSync(path.join(dir, ".suite"), { recursive: true });
    fs.copyFileSync(old, path.join(dir, ".suite", "engine.before-upgrade.js"));
  }
  installEngine(dir, !!pkg && !pkg.official, styleId);
  fs.copyFileSync(path.join(engineDirOf(styleId), "engine.js"), old);
  const pj = readJson(path.join(dir, "project.json")) || {};
  if (!pj.settings) writeSettings(dir, getPreset(presetId).settings);
}
function register(dir, name, presetId, styleId = "pixel-art") {
  const id = uid("prj_"),
    t = now();
  q.run(
    "INSERT INTO projects(id,name,slug,path,preset_id,style_id,status,created_at,updated_at,opened_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    id,
    name,
    path.basename(dir),
    dir,
    presetId,
    getStyle(styleId).id,
    "draft",
    t,
    t,
    t,
  );
  return getProject(id);
}
export async function createProject(opts) {
  const name = opts.name.trim() || "Untitled video";
  const language = opts.language == null ? null : langCode(opts.language);
  if (opts.language != null && !language) throw new Error("That language is not one the app offers.");
  if (language) assertDraws(opts.styleId, language);
  const dir = uniqueDir(slugify(name));
  for (const d of ["scenes", "audio", "assets", "out", ".suite"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const style = getStyle(opts.styleId);
  installEngine(dir, true, style.id);
  const asked = getPreset(opts.presetId);
  const picked = asked && (asked.style_id || "pixel-art") === style.id ? asked : getPreset(style.defaultLook) || getPreset("hidetail");
  const formats = style.controls.find((c) => c.path === "format")?.options?.map((o) => o.value) ?? [];
  const format = opts.format && formats.includes(opts.format) ? opts.format : null;
  const preset = lookInFormat(
    picked,
    listPresets().filter((p2) => (p2.style_id || "pixel-art") === style.id),
    format,
  );
  const settings = withFormat(preset.settings, format, baseOf(style.id));
  if (opts.settings)
    for (const [k, v] of Object.entries(opts.settings))
      settings[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(settings[k] ?? {}), ...v } : v;
  if (opts.brand !== void 0) {
    const hex = normHex(opts.brand);
    if (hex === void 0) throw new Error("Brand colour must be a hex colour like #e6007e.");
    if (hex) settings.brand = { ...(settings.brand ?? {}), color: hex };
    else delete settings.brand;
  }
  const bad = brandError(settings) ?? (baseOf(style.id) === "recon" ? figuresError(settings.figures) : null);
  if (bad) throw new Error(bad);
  if (baseOf(style.id) === "stickman") seedSprites(dir);
  if (baseOf(style.id) === "collage" && opts.pace != null && +opts.pace >= 4 && +opts.pace <= 30)
    settings.pace = { ...(settings.pace ?? {}), perMinute: Math.round(+opts.pace) };
  const chosen =
    baseOf(style.id) === "flat"
      ? await characterForProject(dir, {
          id: opts.character?.none ? null : opts.character?.id,
          random: !opts.character?.none && !!opts.character?.random,
        })
      : null;
  const character = chosen && opts.character?.none ? { ...chosen, none: true } : chosen;
  fs.writeFileSync(
    path.join(dir, "project.json"),
    JSON.stringify(
      {
        title: name,
        style: style.id,
        ...(style.imageStyle ? { imageStyle: style.imageStyle } : {}),
        ...(language ? { language } : {}),
        targetLength: Math.round(opts.length || getConfig().video.length),
        ...(opts.topic?.trim() ? { topic: opts.topic.trim() } : {}),
        end: 0,
        timeline: "audio/timeline.json",
        scenes: [],
        images: {},
        previewAudio: "audio/clean.wav",
        settings,
        ...(character ? { character } : {}),
        ...(opts.scriptSkill === false ? { scriptSkill: false } : {}),
      },
      null,
      1,
    ),
  );
  if (opts.audioPath)
    fs.copyFileSync(opts.audioPath, path.join(dir, "audio", "source" + (path.extname(opts.audioPath).toLowerCase() || ".wav")));
  if (opts.script?.trim()) fs.writeFileSync(path.join(dir, "script.txt"), opts.script.trim() + "\n");
  if (opts.brief?.trim())
    fs.writeFileSync(
      path.join(dir, "brief.md"),
      `# Brief

${opts.brief.trim()}
`,
    );
  fs.writeFileSync(
    path.join(dir, "storyboard.md"),
    `# ${name} - storyboard

(Claude writes this when building the video.)
`,
  );
  carryStyle(dir, style.id);
  const p = register(dir, name, preset.id, style.id);
  writeContext(p.id);
  await ensureRepo(dir);
  return getProject(p.id);
}
export function assertDraws(styleId, code) {
  const st = getStyle(styleId),
    base = baseOf(st.id);
  if (styleDraws(base, code)) return;
  const L = lang(code),
    ok = languagesFor(base).map((l) => l.name);
  throw new Error(
    `${st.name} can't write ${L.name}: ${cantDrawWhy(base, code)}. ${whoCanDraw(code)} ${st.name} writes ${ok.slice(0, 5).join(", ")} and ${ok.length - 5} more.`,
  );
}
export function setLanguage(id, code) {
  const p = getProject(id),
    c = langCode(code);
  if (!c) throw new Error("That language is not one the app offers.");
  assertDraws(p.style_id, c);
  const f = path.join(p.path, "project.json"),
    pj = readJson(f);
  if (!pj) throw new Error("This project has no project.json.");
  if ((langCode(pj.language) ?? "en") !== c) {
    pj.language = c;
    fs.writeFileSync(f, JSON.stringify(pj, null, 1));
    writeContext(id);
  }
}
function carryStyle(dir, styleId) {
  const st = getStyle(styleId);
  if (st.pkg && !st.pkg.official) {
    carryPackage(dir, st);
    return;
  }
  if (!st.custom || !st.dir) return;
  const d = path.join(dir, ".custom-style");
  fs.mkdirSync(d, { recursive: true });
  for (const [from, to] of [
    ["style.json", "style.json"],
    ["STYLE.md", "STYLE_GUIDE.md"],
  ])
    if (fs.existsSync(path.join(st.dir, from))) fs.copyFileSync(path.join(st.dir, from), path.join(d, to));
}
export async function createCharacterLab(meta, description) {
  const dir = uniqueDir(slugify("character lab " + description.split(/\s+/).slice(0, 5).join(" ")));
  copyDir(path.join(templatesDir(), "flat", "charlab"), dir, () => false);
  for (const d of ["scenes", "audio", "assets", "out", ".suite"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  installEngine(dir, true, "flat");
  const preset = getPreset(getStyle("flat").defaultLook),
    pj = readJson(path.join(dir, "project.json"));
  pj.title = `Character lab: ${description.slice(0, 60)}`;
  pj.settings = { ...preset.settings, format: "vertical", captions: { ...preset.settings.captions, on: false } };
  pj.characterLab = { id: meta.id, description, created: now() };
  pj.character = { id: meta.id, name: meta.name };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(pj, null, 1));
  const p = register(dir, pj.title, preset.id, "flat");
  q.run("UPDATE projects SET status=?, duration=? WHERE id=?", "editing", pj.end || 0, p.id);
  writeContext(p.id);
  await ensureRepo(dir);
  return { projectId: p.id, dir };
}
const IMPORT_SKIP = (rel, isDir) =>
  rel === "node_modules" ||
  rel === ".git" ||
  rel === "package-lock.json" ||
  rel === "render.mjs" ||
  (rel.startsWith("out/") && (isDir || /\.(h264|png)$/i.test(rel))) ||
  rel.endsWith(".h264");
const UNTRUSTED_CONFIG = [".claude/settings.json", ".claude/settings.local.json", ".mcp.json"];
function importedLook(src) {
  const f = path.join(src, "engine.js"),
    e = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  if (/ENGINE_VERSION/.test(e)) return "hidetail";
  const aw = +(e.match(/\bAW\s*=\s*(\d+)/)?.[1] ?? 0);
  return aw >= 640 ? "crisp" : aw >= 480 ? "hidetail" : "classic";
}
export async function importProject(src, presetId = importedLook(src)) {
  const pj = readJson(path.join(src, "project.json"));
  if (!pj) throw new Error("That folder has no project.json, so it is not a Videoxx project.");
  const exists = q.get("SELECT * FROM projects WHERE path=? OR source=?", src, path.resolve(src));
  if (exists && fs.existsSync(exists.path)) return exists;
  const name = pj.title || path.basename(src);
  let styleId = getStyle(pj.style).id;
  if (styleId !== "pixel-art" && getPreset(presetId)?.style_id !== styleId) presetId = getStyle(styleId).defaultLook;
  const theme = pj.settings?.theme,
    themed =
      styleId === "recon" && theme ? listPresets().find((x) => x.builtin && x.style_id === styleId && x.settings?.theme === theme) : null;
  if (themed && getPreset(presetId)?.settings?.theme !== theme) presetId = themed.id;
  const dir = uniqueDir(slugify(name));
  await fs.promises.cp(src, dir, {
    recursive: true,
    preserveTimestamps: true,
    filter: (s) => {
      const rel = path.relative(src, s).split(path.sep).join("/");
      return !rel || !IMPORT_SKIP(rel, fs.statSync(s).isDirectory());
    },
  });
  for (const d of ["scenes", "audio", "assets", "out", ".suite"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const f of UNTRUSTED_CONFIG) fs.rmSync(path.join(dir, f), { force: true });
  if (pj.reframedAs || pj.reframeOf) {
    const f = path.join(dir, "project.json"),
      j = readJson(f);
    if (j) {
      delete j.reframedAs;
      delete j.reframeOf;
      fs.writeFileSync(f, JSON.stringify(j, null, 1));
    }
  }
  const carriedF = path.join(dir, ".custom-style", "style.json"),
    carried = String(pj.style || "").startsWith("custom-") && !getStyle(pj.style).missing ? readJson(carriedF) : null;
  const local = carried ? readJson(path.join(engineDirOf(pj.style), "style.json")) : null;
  if (carried?.created && local?.created && carried.created !== local.created) {
    let nid = `${pj.style}-2`;
    for (let n = 3; fs.existsSync(path.join(ws.root(), "styles", nid)) || (getStyle(nid).id === nid && !getStyle(nid).missing); n++)
      nid = `${pj.style}-${n}`;
    fs.writeFileSync(carriedF, JSON.stringify({ ...carried, id: nid, name: `${carried.name} (shared)`, lab: null }, null, 2));
    const pjf = path.join(dir, "project.json"),
      pj2 = readJson(pjf);
    pj2.style = nid;
    fs.writeFileSync(pjf, JSON.stringify(pj2, null, 1));
    const { restoreStyleFromProject } = await import("../styles/customStyles");
    if (restoreStyleFromProject(dir)) {
      styleId = nid;
      presetId = `${nid}-default`;
    }
  }
  if (String(pj.style || "").startsWith("custom-") && getStyle(styleId).pkg && !carriedIsSameStyle(dir, styleId)) {
    const nid = installCarriedAsNew(dir, styleId);
    if (nid) {
      styleId = nid;
      presetId = getStyle(nid).defaultLook;
    }
  }
  if (getStyle(styleId).missing && fs.existsSync(path.join(dir, ".style-pkg", "style.json"))) {
    if (restorePackageFromProject(dir)) presetId = getStyle(styleId).defaultLook;
    else noteCarried(dir);
  }
  const own = getStyle(styleId);
  if (own.missing || own.custom || (own.pkg && !own.pkg.official)) {
    if (fs.existsSync(path.join(dir, "engine.js"))) ensureSkill(dir, styleId);
    else installEngine(dir, false, styleId);
  } else if (!engineIsCurrent(dir, styleId)) upgradeEngine(dir, presetId, styleId);
  else installEngine(dir, false, styleId);
  const p = register(dir, name, presetId, styleId);
  q.run(
    "UPDATE projects SET status=?, duration=?, source=? WHERE id=?",
    pj.scenes?.length ? "editing" : "draft",
    pj.end || 0,
    path.resolve(src),
    p.id,
  );
  writeContext(p.id);
  await ensureRepo(dir);
  return getProject(p.id);
}
const ZIP_SKIP = ["out", ".suite", ".git", "node_modules"];
const exec = (cmd, args) =>
  new Promise((res, rej) =>
    cp.execFile(
      cmd,
      args,
      { windowsHide: true, maxBuffer: 1 << 24, env: { ...process.env, COPYFILE_DISABLE: "1" } },
      // COPYFILE_DISABLE: macOS tar adds no ._* metadata files
      (e, _o, se) =>
        e
          ? rej(
              new Error(
                `${path.basename(cmd)} failed: ${String(se || e.message)
                  .trim()
                  .slice(-300)}`,
              ),
            )
          : res(),
    ),
  );
const bsdtar = () =>
  process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "/usr/bin/tar";
export async function exportZip(id, dest) {
  const p = getProject(id);
  fs.rmSync(dest, { force: true });
  if (process.platform === "linux")
    await exec("sh", [
      "-c",
      `cd "$1" && zip -r -q "$2" . ${ZIP_SKIP.map((d) => `-x '${d}/*'`).join(" ")} -x '*.incoming'`,
      "sh",
      p.path,
      dest,
    ]);
  else
    await exec(bsdtar(), [
      ...(process.platform === "win32" ? ["-a"] : ["--format", "zip"]),
      "-c",
      "-f",
      dest,
      "-C",
      p.path,
      ...[...ZIP_SKIP, ...UNTRUSTED_CONFIG].flatMap((d) => ["--exclude", `./${d}`]),
      "--exclude",
      "*.incoming",
      ...(process.platform === "darwin" ? ["--exclude", ".DS_Store"] : []),
      ".",
    ]);
  return dest;
}
export async function importZip(zip) {
  const known = q.get("SELECT * FROM projects WHERE source=?", path.resolve(zip));
  if (known && fs.existsSync(known.path)) return known;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-import-"));
  try {
    if (process.platform === "linux") await exec("unzip", ["-q", zip, "-d", tmp]);
    else await exec(bsdtar(), ["-x", "-f", zip, "-C", tmp]);
    const root = fs.existsSync(path.join(tmp, "project.json"))
      ? tmp
      : fs
          .readdirSync(tmp)
          .map((d) => path.join(tmp, d))
          .find((d) => fs.existsSync(path.join(d, "project.json")));
    if (!root) throw new Error("That zip has no project.json at its top level, so it is not a Suite project.");
    const p = await importProject(root);
    q.run("UPDATE projects SET source=? WHERE id=?", path.resolve(zip), p.id);
    return getProject(p.id);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
export async function duplicateProject(id, as) {
  const src = getProject(id);
  const name = as || `${src.name} (copy)`,
    dir = uniqueDir(slugify(name));
  let p;
  try {
    await fs.promises.cp(src.path, dir, {
      recursive: true,
      preserveTimestamps: true,
      filter: (s) => {
        const top = path.relative(src.path, s).split(path.sep)[0];
        return top !== "out" && top !== ".suite" && !s.endsWith(".incoming");
      },
    });
    for (const d of ["out", ".suite"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
    const card = coverFile(src.path);
    if (card) fs.copyFileSync(path.join(src.path, ".suite", card), path.join(dir, ".suite", card));
    const pjf = path.join(dir, "project.json"),
      pj = readJson(pjf);
    if (pj?.styleLab) pj.styleLab = { ...pj.styleLab, styleId: null, saved: null };
    if (pj?.characterLab) delete pj.characterLab;
    if (pj) {
      delete pj.reframedAs;
      delete pj.reframeOf;
    }
    if (pj) {
      pj.title = name;
      fs.writeFileSync(pjf, JSON.stringify(pj, null, 1));
    }
    p = register(dir, name, src.preset_id || getStyle(src.style_id).defaultLook, src.style_id);
  } catch (e) {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }).catch(() => {});
    throw e;
  }
  q.run(
    "UPDATE projects SET status=?, duration=?, shots=?, channel_id=?, plan_note=?, overrides=?, claude_model=?, claude_effort=? WHERE id=?",
    src.status,
    src.duration,
    src.shots,
    src.channel_id ?? null,
    src.plan_note ?? null,
    src.overrides ?? null,
    src.claude_model ?? null,
    src.claude_effort ?? null,
    p.id,
  );
  q.all("SELECT * FROM rules WHERE scope='project' AND project_id=?", id).forEach((r) =>
    q.run(
      "INSERT INTO rules(id,scope,project_id,text,enabled,status,created_at) VALUES(?,?,?,?,?,?,?)",
      uid("rul_"),
      "project",
      p.id,
      r.text,
      r.enabled,
      r.status,
      now(),
    ),
  );
  writeContext(p.id);
  return getProject(p.id);
}
export function renameProject(id, name) {
  const p = getProject(id);
  const f = path.join(p.path, "project.json");
  if (!fs.existsSync(p.path))
    throw new Error(`The project's folder is missing (${p.path}). Put it back, or connect its drive, then rename it.`);
  const pj = readJson(f);
  if (pj) {
    pj.title = name;
    fs.writeFileSync(f, JSON.stringify(pj, null, 1));
  }
  q.run("UPDATE projects SET name=?, updated_at=? WHERE id=?", name, now(), id);
  writeContext(id);
}
export async function deleteProject(id, removeFiles) {
  const p = getProject(id);
  q.run("DELETE FROM rules WHERE project_id=?", id);
  q.run("DELETE FROM projects WHERE id=?", id);
  if (removeFiles && fs.existsSync(p.path))
    await Promise.race([
      trashWithRetry(p.path),
      new Promise((_, rej) =>
        setTimeout(
          () =>
            rej(
              new Error(
                "The project was removed from the Suite, but its folder is still in use (a player or another program has a file open). Close it and delete the folder by hand.",
              ),
            ),
          2e4,
        ),
      ),
    ]);
}
async function trashWithRetry(dir) {
  for (let i = 0; ; i++) {
    try {
      await shell.trashItem(dir);
      return;
    } catch (err) {
      if (i >= 5 || !fs.existsSync(dir)) throw err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}
export function touchProject(id) {
  q.run("UPDATE projects SET opened_at=? WHERE id=?", now(), id);
}
export function exportOutdated(d) {
  const mt = (f) => {
    try {
      return fs.statSync(path.join(d, f)).mtimeMs;
    } catch {
      return 0;
    }
  };
  let exports = [],
    audio = [];
  try {
    exports = fs.readdirSync(path.join(d, "out")).filter((f) => f.endsWith(".mp4"));
  } catch {
    return false;
  }
  try {
    audio = fs.readdirSync(path.join(d, "audio"));
  } catch {}
  const src = audio.find((f) => /^source\.\w+$/.test(f));
  return (
    exports.length > 0 &&
    Math.max(...exports.map((f) => mt(`out/${f}`))) <
      Math.max(src ? mt(`audio/${src}`) : 0, mt("audio/clean.wav"), mt("audio/final_mix.wav"))
  );
}
export function facelessPipeline(d, pj, cheap = false, id) {
  const has = (f) => fs.existsSync(path.join(d, f));
  const audioSrc = fs.existsSync(path.join(d, "audio")) ? fs.readdirSync(path.join(d, "audio")).find((f) => /^source\.\w+$/.test(f)) : null;
  const mt = (f) => {
    try {
      return f ? fs.statSync(path.join(d, f)).mtimeMs : 0;
    } catch {
      return 0;
    }
  };
  const tSrc = mt(audioSrc ? `audio/${audioSrc}` : null),
    tClean = mt("audio/clean.wav"),
    tTl = mt("audio/timeline.json"),
    tMix = mt("audio/final_mix.wav");
  let tlOk = false;
  if (cheap) {
    try {
      tlOk = fs.statSync(path.join(d, "audio/timeline.json")).size > 2;
    } catch {}
  } else {
    try {
      const tl = JSON.parse(fs.readFileSync(path.join(d, "audio/timeline.json"), "utf8"));
      tlOk = Array.isArray(tl) && tl.length > 0;
    } catch {}
  }
  const voiceNew = !!audioSrc && tSrc > tClean;
  const cleanDone = tClean > 0 && tClean >= tSrc,
    tlDone = cleanDone && tlOk && (pj.end || 0) > 0 && tTl >= tClean - SAME_RUN_MS,
    mixDone = tMix > 0 && tMix >= tClean && tMix >= tSrc;
  const scenes = Array.isArray(pj.scenes) ? pj.scenes : [];
  const newestScene = cheap ? 0 : Math.max(0, ...scenes.map((s) => mt(`scenes/${s}.js`)));
  const kindOf = new Map(
    id
      ? q
          .all("SELECT path, kind FROM renders WHERE project_id=? AND path IS NOT NULL ORDER BY created_at", id)
          .map((r) => [path.basename(r.path).toLowerCase(), r.kind])
      : [],
  );
  const vertical = (f) => {
    const k = kindOf.get(f.toLowerCase());
    return k ? VERTICAL_KINDS.includes(k) : VERTICAL_NAME.test(f);
  };
  const exports = fs.existsSync(path.join(d, "out"))
    ? fs.readdirSync(path.join(d, "out")).filter((f) => f.endsWith(".mp4") && !vertical(f))
    : [];
  const scriptText = (() => {
    try {
      return fs.readFileSync(path.join(d, "script.txt"), "utf8");
    } catch {
      return "";
    }
  })();
  const language = langCode(pj.language) ?? "en",
    words = countWords(scriptText, language);
  const steps = [
    { id: "script", label: "Script written", done: words >= 30 },
    { id: "voice", label: "Voiceover added", done: !!audioSrc || has("audio/clean.wav") },
    { id: "clean", label: "Audio cleaned", done: cleanDone },
    { id: "timeline", label: "Words timed", done: tlDone },
    {
      id: "storyboard",
      label: "Storyboard written",
      done: (() => {
        try {
          return fs.statSync(path.join(d, "storyboard.md")).size > 200;
        } catch {
          return false;
        }
      })(),
    },
    { id: "scenes", label: "Scenes built", done: scenes.length > 0 && scenes.every((s) => has(`scenes/${s}.js`)) },
    { id: "sound", label: "Sound design mixed", done: mixDone, stale: mixDone && newestScene > tMix },
    // scenes changed since the mix
    // the narration or its sound changed after the last export: that video has the old one
    { id: "export", label: "Video exported", done: exports.length > 0, stale: exportOutdated(d) },
  ];
  return { steps, exports, words, mixDone, scenes, audioSrc, cleanDone, tlDone, voiceNew, scriptText, language, mt };
}
export function projectStatus(id) {
  const p = getProject(id),
    d = p.path,
    has = (f) => fs.existsSync(path.join(d, f));
  const pj = readJson(path.join(d, "project.json")) || {};
  const { steps, exports, words, mixDone, scenes, audioSrc, cleanDone, tlDone, voiceNew, scriptText, language, mt } = facelessPipeline(
    d,
    pj,
    false,
    id,
  );
  const previewAudio =
    [
      mixDone ? "audio/final_mix.wav" : null,
      cleanDone && pj.previewAudio !== "audio/final_mix.wav" ? pj.previewAudio : null,
      cleanDone ? "audio/clean.wav" : null,
      audioSrc ? `audio/${audioSrc}` : null,
    ].find((f) => f && has(f)) || null;
  return {
    project: p,
    title: pj.title || p.name,
    end: pj.end || 0,
    style: getStyle(p.style_id).id,
    styleBase: baseOf(p.style_id),
    styleName: getStyle(p.style_id).name,
    hardPixels: !smoothScale(p.style_id),
    gifWidth: GIF_WIDTH[smoothScale(p.style_id) ? "smooth" : "hard"],
    // what the export's 4K / GIF scaling does (render.ts), for its dialog
    styleLab: pj.styleLab
      ? {
          name: pj.styleLab.name,
          styleId: pj.styleLab.styleId ?? null,
          saved: pj.styleLab.saved ?? null,
          refs: (pj.styleLab.refs || []).length,
        }
      : null,
    characterLab: pj.characterLab ? { id: pj.characterLab.id, description: pj.characterLab.description } : null,
    character: pj.character ?? null,
    aspect: aspectOf(p.style_id, pj.settings),
    targetLength: pj.targetLength || getConfig().video.length,
    topic: pj.topic || "",
    scriptWords: words,
    scenes,
    images: pj.images || {},
    settings: pj.settings || null,
    language,
    // the narration's language (ISO 639-1)
    scriptSkill: pj.scriptSkill !== false,
    // this video's scripts may follow the member's scripting skill (Settings decides whether there is one)
    scriptSkillOwn: pj.scriptSkill && typeof pj.scriptSkill === "object" ? projectSkillName(p.path) : null,
    // a routine's own skill this video follows (its name)
    // the language script.txt is clearly in when it is not the video's (an English script left in a video made Spanish):
    // the editor says so, before the voice, the timing and the build follow the wrong one
    scriptLanguage: words >= 25 ? otherScriptLanguage(spokenScript(scriptText, language), language) : null,
    langEngine: engineLanguage(d),
    // what its engine does for another language (older ones: nothing)
    engineCurrent: !fs.existsSync(d) || engineIsCurrent(d, p.style_id),
    engineVersion: engineVersion(path.join(d, "engine.js")),
    latestEngine: latestEngine(p.style_id),
    steps,
    exports,
    previewAudio,
    // a style package: the version THIS project keeps (its .style-pkg) and the installed one, so the editor can offer the
    // newer one (mine: the member's own; official packages update with the app)
    stylePkg: (() => {
      const st = getStyle(p.style_id);
      if (!st.pkg) return null;
      const v = styleVersions(d, p.style_id);
      return {
        name: st.name,
        version: v?.pinned ?? st.pkg.manifest.version,
        latest: st.pkg.manifest.version,
        newer: !!v?.newer,
        mine: !st.pkg.official,
      };
    })(),
    previewAudioAt: Math.round(mt(previewAudio)),
    // the player reloads it when it changes (same name, new voice)
    voiceNew,
    scriptAt: Math.round(mt("script.txt")),
    // scriptAt: the Voiceover window's estimate follows a script changed elsewhere
    untimed: !!previewAudio && !tlDone && (voiceNew || cleanDone),
    // what the player plays is not timed yet: the phrases and the end belong to an older voiceover
    files: { script: has("script.txt"), brief: has("brief.md"), beds: has("audio/beds.json"), events: has("audio/events.json") },
  };
}
