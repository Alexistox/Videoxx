import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { app, nativeImage } from "electron";
import { templatesDir } from "../../core/workspace";
import { log } from "../../core/log";
import { PKG_BASES, PKG_ID, controlsFor, formatOfAspect, parseLook, parseManifest, validateByControls } from "../../styles/manifest";
import { PACKAGES, STYLES, baseOf, engineDirOf, getStyle } from "../../styles/catalog";
import { getPreset } from "../../styles/presets";
import { seedSprites } from "../../characters/sprites";
import {
  installPackageVersion,
  loadPackages,
  memberRoot,
  packageEngineSha,
  packageInstallTarget,
  packageVersions,
  restorePrevious,
} from "../../styles/packages";
import { layoutCheckWith, withThrowawayWorker } from "../../render/workers";
import { beginExport, renderFrames } from "../../render/exportVideo";
import {
  BASES,
  BLANK_LIMIT,
  LIMITS,
  MEANING,
  RENDER_MEANING,
  baseDebt,
  declaredSeverities,
  engineKindOf,
  formatFindings,
  imageEntryProblem,
  layoutSeverity,
  packageRoot,
  repeatMoments,
  repeatSeverity,
  skippedReason,
  staticCheck,
  structureOf,
  unsafeName,
} from "../staticCheck";
import { RECON_COLLIDE_PROBE, diffOf, frameStat } from "../runChecks";
import { latestEngine } from "../../projects/projects";
import { ff } from "../../pipeline/ff";
import { hiddenMisses, projectUrl, registerHiddenProject, unregisterHiddenProject } from "../../projects/fileServer";
import { readZip, writeZip } from "../../core/zip";

export const STYLES_MOVED = "Making whole styles moved to the Style Kit (Styles > Get the Style Kit).";
const IMPORT_ITEMS = [
  ["unpack", "Unpack the package"],
  ["static", "Files, manifest, engine contract, code and text"],
  ["workspace", "Set up a private check copy"],
  ["boot", "Every view loads in every format"],
  ["layout", "The layout checks pass (sample, hero, kit)"],
  ["frames", "Frames show something and move"],
  ["mustfail", "Every must-fail view is still caught"],
  ["export", "A 5 s export in every format"],
  ["repeat", "The same moment always looks the same"],
  ["summary", "Result"],
];
const isDark = (m) => m.mean < 0.1 && m.hi < 0.35;
const BAD_WARN = /not loaded|fallback|fall back|falls back|failed|missing|stand-in|instead|could not|cannot|unknown/i;
const IGNORE =
  /^\[\.WebGL-[^\]]*\]\s*GL_INVALID|GPU stall due to ReadPixels|Automatic fallback to software WebGL has been deprecated|^No timeline yet/i;
const ENGINE_PARTS = ["engine.js", "models.js", "lib", "fonts", "vendor", "sprites", "assets/figures"];
const ID_RX = /^imp_[a-z0-9]{6,24}$/;
const VIEW_RX = /^[A-Za-z][\w-]{0,40}$/;
export const MAX_ROUNDS = 3;
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const deepMerge = (a, b) => {
  const o = { ...(a ?? {}) };
  for (const k in b || {}) o[k] = isObj(b[k]) && isObj(a?.[k]) ? deepMerge(a[k], b[k]) : b[k];
  return o;
};
const clip = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const exists = (f) => {
  try {
    fs.statSync(f);
    return true;
  } catch {
    return false;
  }
};
const isMustFail = (n, v) => !!v?.expect || /^mustfail/i.test(n);
const aspectTag = (a) => a.replace(":", "x");
const incomingRoot = () => path.join(memberRoot(), ".incoming");
const runDir = (id) => {
  if (!ID_RX.test(String(id))) throw new Error("That is not an import of this app.");
  return path.join(incomingRoot(), id);
};
export const wsDir = (id) => path.join(runDir(id), "ws");
const pkgDir = (id) => path.join(runDir(id), "pkg");
const checkedDir = (id) => path.join(runDir(id), "checked");
export const fixesFile = (id) => path.join(runDir(id), "FIXES.md");
const runs = new Map();
const busy = new Set();
const stops = new Map();
let changed = () => {};
export const onImportChanged = (f) => {
  changed = f;
};
export const importBusy = (id) => busy.has(id);
export const setImportStop = (id, ac) => {
  if (ac) stops.set(id, ac);
  else stops.delete(id);
};
export const setImportBusy = (id, on) => {
  if (on) busy.add(id);
  else busy.delete(id);
};
export function saveRun(run, t0) {
  if (run.status === "cancelled") return;
  if (t0) run.ms = Date.now() - t0;
  try {
    fs.mkdirSync(runDir(run.id), { recursive: true });
    fs.writeFileSync(path.join(runDir(run.id), "run.json"), JSON.stringify(run, null, 1));
  } catch {}
  try {
    changed(run);
  } catch {}
}
export function getRun(id) {
  const r = runs.get(id);
  if (r) return r;
  let j = null;
  try {
    j = readJson(path.join(runDir(id), "run.json"));
  } catch {
    return null;
  }
  if (!j || !Array.isArray(j.items)) return null;
  if ((j.status === "running" || j.status === "fixing") && !busy.has(id)) {
    j.status = "failed";
    j.error = "The app was closed while this import was being checked: start the import again.";
    for (const i of j.items)
      if (i.status === "running") {
        i.status = "fail";
        i.detail = "The app was closed.";
      }
    if (j.fix) j.fix.running = false;
  }
  if (exists(wsDir(id))) registerHiddenProject(id, wsDir(id));
  runs.set(id, j);
  return j;
}
export function listRuns() {
  let names = [];
  try {
    names = fs.readdirSync(incomingRoot()).filter((n) => ID_RX.test(n));
  } catch {}
  for (const id of runs.keys()) if (!names.includes(id)) names.push(id);
  return names
    .map((n) => getRun(n))
    .filter((r) => !!r)
    .sort((a, b) => b.at.localeCompare(a.at));
}
const item = (run, id) => run.items.find((i) => i.id === id);
function setItem(run, id, status, detail = "") {
  Object.assign(item(run, id), { status, detail: clip(detail, 700) });
  saveRun(run);
}
const NEVER_COPIED = new Set([".versions", ".publishing", ".incoming", "__MACOSX", ".DS_Store", "Thumbs.db"]);
function unpack(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  const leftOut = [],
    root = path.resolve(dst);
  const put = (rel, data) => {
    const out = path.resolve(root, rel);
    if (!out.startsWith(root + path.sep)) throw new Error(`The file name "${rel.slice(0, 120)}" climbs out of the package (..).`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
  };
  let st;
  try {
    st = fs.statSync(src);
  } catch {
    throw new Error(`${src} does not exist (moved or deleted?).`);
  }
  if (st.isFile()) {
    if (!/\.zip$/i.test(src)) throw new Error("Pick the package's .zip file (made by cz package), or its folder.");
    if (st.size > LIMITS.totalBytes)
      throw new Error(`The zip is ${Math.round(st.size / 1048576)} MB; a package may be at most ${LIMITS.totalBytes / 1048576} MB.`);
    const files = readZip(fs.readFileSync(src), LIMITS);
    for (const f of files) {
      const parts = f.name.split("/");
      if (parts.some((p) => NEVER_COPIED.has(p))) continue;
      const why = skippedReason(f.name.replace(/^[^/]+\/(?=.*\/)/, "")) ?? skippedReason(f.name);
      if (why) {
        leftOut.push(`${f.name} (${why})`);
        continue;
      }
      put(f.name, f.data);
    }
  } else if (st.isDirectory()) {
    let n = 0,
      total = 0;
    const walk = (abs, rel, fn) => {
      for (const e of fs.readdirSync(abs)) {
        if (NEVER_COPIED.has(e)) continue;
        const a = path.join(abs, e),
          r = rel ? `${rel}/${e}` : e,
          s = fs.lstatSync(a);
        if (s.isSymbolicLink()) throw new Error(`${r} is a link (symlink / shortcut), not a file: a package holds only plain files.`);
        const bad = unsafeName(r);
        if (bad) throw new Error(`The file name "${r.slice(0, 120)}" is not allowed: ${bad}.`);
        if (s.isDirectory()) walk(a, r, fn);
        else if (s.isFile()) fn(a, r, s);
      }
    };
    walk(src, "", (_a, _r, s) => {
      n++;
      total += s.size;
      if (n > LIMITS.files) throw new Error(`The folder holds more than ${LIMITS.files} files.`);
      if (total > LIMITS.totalBytes) throw new Error(`The folder is over ${LIMITS.totalBytes / 1048576} MB.`);
    });
    walk(src, "", (a, r, s) => {
      const why = skippedReason(r);
      if (why) {
        leftOut.push(`${r} (${why})`);
        return;
      }
      if (s.size > LIMITS.fileBytes)
        throw new Error(`${r} is ${Math.round(s.size / 1048576)} MB; one file may be at most ${LIMITS.fileBytes / 1048576} MB.`);
      put(r, fs.readFileSync(a));
    });
  } else throw new Error(`${src} is not a file or a folder.`);
  return { root: packageRoot(dst), leftOut };
}
const baseStyle = (base) => STYLES.find((s) => s.id === base && !s.legacy) ?? null;
export function settingsOf(m, aspect) {
  const base = baseStyle(m.base);
  if (!base) return { format: formatOfAspect(aspect) };
  const dimLook = m.dim
    ? [base.defaultLook, ...(base.looks ?? [])].map((id) => getPreset(id)).find((p) => p?.settings?.dim === m.dim)
    : null;
  const look = (dimLook ?? getPreset(base.defaultLook))?.settings ?? {};
  return { ...deepMerge(look, m.defaults || {}), format: formatOfAspect(aspect) };
}
function staticOpts(base) {
  const b = base ? baseStyle(base) : null,
    eng = b ? engineDirOf(b.id) : void 0;
  return {
    validateManifest: (raw) => {
      const p = parseManifest(raw);
      return p.ok ? { ok: true } : { ok: false, why: p.why };
    },
    validateLook: (raw, manifest) => {
      const p = parseLook(raw);
      if (!p.ok) return { ok: false, why: p.why };
      const mm = parseManifest(manifest);
      if (!mm.ok) return { ok: true };
      const bs = baseStyle(mm.m.base);
      if (!bs) return { ok: true };
      const controls = controlsFor(bs.controls, mm.m.controls, mm.m.aspects),
        def = settingsOf(mm.m, mm.m.aspects[0]);
      const e = validateByControls({ ...def, ...p.m.settings, format: formatOfAspect(mm.m.aspects[0]) }, controls, mm.m.aspects);
      return e ? { ok: false, why: e } : { ok: true };
    },
    baseEngineDir: eng,
    baseSkillDir: b ? path.join(templatesDir(), "skill", b.skill) : void 0,
    baseSampleDir: b ? path.join(templatesDir(), "studio", "samples", b.id) : void 0,
    baseEngineVersion: b ? latestEngine(b.id) : void 0,
    baseKind: eng
      ? (engineKindOf(fs.readFileSync(path.join(eng, "engine.js"), "utf8")) ?? (b.id === "pixel-art" ? "pixel" : void 0))
      : void 0,
    baseName: b?.name,
  };
}
const order = { high: 0, medium: 1, low: 2, info: 3 };
const sortFindings = (l) => l.slice().sort((a, b) => order[a.sev] - order[b.sev]);
const highOf = (l) => l.filter((f) => f.sev === "high");
const leftOutFinding = (leftOut) => ({
  id: "files",
  sev: "low",
  where: {},
  finding: `${leftOut.length} file${leftOut.length > 1 ? "s are" : " is"} left out of the style: ${leftOut.slice(0, 6).join("; ")}${leftOut.length > 6 ? " ..." : ""}.`,
  meaning: MEANING.files,
  fix: "Nothing to do if that is what you want; move a file the style really needs to a name without key/secret/token.",
});
function viewsOf(root) {
  const vj = readJson(path.join(root, "sample", "views.json")),
    out = {};
  for (const [n, v] of Object.entries(vj?.views ?? {}))
    if (VIEW_RX.test(n) && Array.isArray(v?.scenes) && v.scenes.length && +v.end > 0)
      out[n] = {
        scenes: v.scenes.filter((s) => typeof s === "string" && /^[A-Za-z0-9][\w-]{0,60}$/.test(s)),
        end: +v.end,
        ...(v.expect ? { expect: String(v.expect) } : {}),
      };
  return out;
}
function copyTree(src, dst, skip, rel = "") {
  let st;
  try {
    st = fs.lstatSync(src);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) return;
  if (st.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return;
  }
  if (!st.isDirectory()) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src)) {
    const r = rel ? `${rel}/${e}` : e;
    if (skip?.(r)) continue;
    copyTree(path.join(src, e), path.join(dst, e), skip, r);
  }
}
function listRel(dir, rel = "", out = []) {
  let es = [];
  try {
    es = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of es) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listRel(dir, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}
const fallbacksFile = (id) => path.join(runDir(id), "fallbacks.json");
const fallbacksOf = (id) => {
  const j = readJson(fallbacksFile(id));
  return Array.isArray(j) ? j.filter((x) => typeof x === "string") : [];
};
const APP_OWNED = [
  "schema",
  "kind",
  "id",
  "base",
  "from",
  "kit",
  "version",
  "aspects",
  "dim",
  "official",
  "aliases",
  "studio",
  "created",
  "updated",
];
export const originalManifestFile = (id) => path.join(runDir(id), "manifest.json");
function buildWorkspace(id, root, m, raw, views) {
  const ws = wsDir(id);
  fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  for (const d of ["scenes", "audio", "assets", "skill", "looks", "out"]) fs.mkdirSync(path.join(ws, d), { recursive: true });
  if (exists(path.join(root, "engine"))) copyTree(path.join(root, "engine"), ws);
  copyTree(path.join(root, "sample", "scenes"), path.join(ws, "scenes"));
  copyTree(path.join(root, "sample", "assets"), path.join(ws, "assets"));
  if (exists(path.join(root, "sample", "timeline.json")))
    fs.copyFileSync(path.join(root, "sample", "timeline.json"), path.join(ws, "audio", "timeline.json"));
  if (exists(path.join(root, "sample", "script.txt")))
    fs.copyFileSync(path.join(root, "sample", "script.txt"), path.join(ws, "script.txt"));
  copyTree(path.join(root, "skill"), path.join(ws, "skill"));
  copyTree(path.join(root, "looks"), path.join(ws, "looks"));
  fs.writeFileSync(path.join(ws, "style.json"), JSON.stringify(raw, null, 2) + "\n");
  fs.writeFileSync(originalManifestFile(id), JSON.stringify(raw, null, 2) + "\n");
  const fb = [],
    base = m.base;
  if (base === "recon") {
    const af = path.join(templatesDir(), "recon", "assets", "figures");
    for (const r of listRel(af)) {
      const d = path.join(ws, "assets", "figures", r);
      if (!exists(d)) {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(path.join(af, r), d);
        fb.push(`assets/figures/${r}`);
      }
    }
  }
  if (base === "flat" && !exists(path.join(ws, "character.js"))) {
    fs.copyFileSync(path.join(templatesDir(), "flat", "character.js"), path.join(ws, "character.js"));
    fb.push("character.js");
  }
  if (base === "stickman" && !exists(path.join(ws, "assets", "sprites", "index.json"))) {
    const before = new Set(listRel(ws));
    seedSprites(ws);
    for (const r of listRel(ws)) if (!before.has(r)) fb.push(r);
  }
  fs.writeFileSync(fallbacksFile(id), JSON.stringify(fb));
  const first = views.sample ? "sample" : Object.keys(views)[0],
    vj = readJson(path.join(root, "sample", "views.json")),
    images = {};
  for (const [k, v] of Object.entries(isObj(vj?.images) ? vj.images : {})) {
    const f = path.resolve(ws, String(v));
    if (!imageEntryProblem(k, v) && f.startsWith(path.resolve(ws, "assets") + path.sep) && exists(f)) images[k] = v;
  }
  fs.writeFileSync(
    path.join(ws, "project.json"),
    JSON.stringify(
      {
        title: m.name,
        style: m.id,
        language: "en",
        end: +(views[first]?.end ?? 0),
        timeline: "audio/timeline.json",
        scenes: [...(views[first]?.scenes ?? [])],
        images,
        previewAudio: "audio/clean.wav",
        settings: settingsOf(m, m.aspects[0]),
        views,
        view: first,
      },
      null,
      1,
    ),
  );
  const lock = {};
  for (const r of LOCKED_FILES)
    if (exists(path.join(ws, r)))
      lock[r] = crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(ws, r)))
        .digest("hex");
  fs.mkdirSync(path.join(runDir(id), "locked"), { recursive: true });
  for (const r of Object.keys(lock)) {
    const d = path.join(runDir(id), "locked", r);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(path.join(ws, r), d);
  }
  fs.writeFileSync(path.join(runDir(id), "locked.json"), JSON.stringify(lock));
}
export const LOCKED_FILES = ["lib/contact.js", "lib/collide.js", "lib/check.js", "lib/scan.js"];
export function restoreLocked(id) {
  const ws = wsDir(id),
    lock = readJson(path.join(runDir(id), "locked.json")) ?? {},
    back = [];
  for (const r of LOCKED_FILES) {
    const f = path.join(ws, r),
      had = lock[r],
      now = exists(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") : null;
    if (had && now !== had) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.copyFileSync(path.join(runDir(id), "locked", r), f);
      back.push(r);
    } else if (!had && now) {
      fs.rmSync(f, { force: true });
      back.push(r);
    }
  }
  return back;
}
export function restoreAppOwned(id) {
  const f = path.join(wsDir(id), "style.json"),
    orig = readJson(originalManifestFile(id)) ?? {};
  let cur = readJson(f);
  if (!isObj(cur)) cur = { ...orig };
  for (const k of APP_OWNED) {
    if (k in orig) cur[k] = orig[k];
    else delete cur[k];
  }
  const text = JSON.stringify(cur, null, 2) + "\n";
  if (fs.readFileSync(f, "utf8") !== text) fs.writeFileSync(f, text);
}
async function assemble(id, outDir, o = {}) {
  const ws = wsDir(id),
    root = packageRoot(pkgDir(id)),
    fb = new Set(fallbacksOf(id));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  restoreAppOwned(id);
  fs.copyFileSync(path.join(ws, "style.json"), path.join(outDir, "style.json"));
  for (const part of ENGINE_PARTS) {
    const s = path.join(ws, part);
    if (exists(s)) copyTree(s, path.join(outDir, "engine", part), (r) => fb.has(`${part}/${r}`));
  }
  for (const r of fb) fs.rmSync(path.join(outDir, "engine", r), { force: true });
  copyTree(path.join(ws, "skill"), path.join(outDir, "skill"));
  copyTree(path.join(ws, "looks"), path.join(outDir, "looks"));
  const vf = path.join(root, "sample", "views.json");
  if (exists(vf)) {
    fs.mkdirSync(path.join(outDir, "sample"), { recursive: true });
    fs.copyFileSync(vf, path.join(outDir, "sample", "views.json"));
  }
  copyTree(path.join(ws, "scenes"), path.join(outDir, "sample", "scenes"));
  if (exists(path.join(ws, "audio", "timeline.json")))
    fs.copyFileSync(path.join(ws, "audio", "timeline.json"), path.join(outDir, "sample", "timeline.json"));
  if (exists(path.join(ws, "script.txt"))) fs.copyFileSync(path.join(ws, "script.txt"), path.join(outDir, "sample", "script.txt"));
  copyTree(
    path.join(ws, "assets"),
    path.join(outDir, "sample", "assets"),
    (r) =>
      r === "figures" ||
      r.startsWith("figures/") ||
      fb.has(`assets/${r}`) ||
      (r === "sprites" && [...fb].some((x) => x.startsWith("assets/sprites/"))),
  );
  if (exists(path.join(root, "reference", "ANALYSIS.md"))) {
    fs.mkdirSync(path.join(outDir, "reference"), { recursive: true });
    fs.copyFileSync(path.join(root, "reference", "ANALYSIS.md"), path.join(outDir, "reference", "ANALYSIS.md"));
  }
  if (exists(path.join(root, "CREDITS.json"))) fs.copyFileSync(path.join(root, "CREDITS.json"), path.join(outDir, "CREDITS.json"));
  const fixes = exists(fixesFile(id)) ? fixesFile(id) : exists(path.join(root, "FIXES.md")) ? path.join(root, "FIXES.md") : null;
  if (fixes) fs.copyFileSync(fixes, path.join(outDir, "FIXES.md"));
  if (o.preview) {
    const ex = ["16:9", "9:16"].map((a) => path.join(ws, "out", `czcheck_${aspectTag(a)}.mp4`)).find(exists);
    if (ex) {
      const tall = /9x16/.test(ex);
      try {
        await ff([
          "-i",
          ex,
          "-vf",
          tall ? "scale=360:-2" : "scale=640:-2",
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "28",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          path.join(outDir, "preview.mp4"),
        ]);
        await ff([
          "-ss",
          "2.5",
          "-i",
          ex,
          "-frames:v",
          "1",
          "-vf",
          tall ? "scale=360:-2" : "scale=640:-2",
          "-q:v",
          "3",
          path.join(outDir, "poster.jpg"),
        ]);
      } catch (e) {
        log("style import: no preview", e?.message);
      }
    }
  } else {
    const old = root;
    for (const f of ["preview.mp4", "poster.jpg"]) if (exists(path.join(old, f))) fs.copyFileSync(path.join(old, f), path.join(outDir, f));
  }
  return outDir;
}
const F = (id, sev, where, finding, fix) => ({
  id,
  sev,
  where,
  finding: String(finding).slice(0, 400),
  meaning: RENDER_MEANING[id] ?? "",
  fix,
});
function qualityOf(ws) {
  let t = "";
  try {
    t = fs.readFileSync(path.join(ws, "skill", "QUALITY.md"), "utf8");
  } catch {}
  return declaredSeverities(t);
}
function parseWhat(what) {
  const m = /^(.*?)\s*\(([^():]+):(\d+)\)\s*$/.exec(String(what).trim());
  return m ? { element: m[1].trim() || null, file: m[2], line: +m[3] } : { element: String(what).trim() || null, file: null, line: null };
}
function parseErr(text) {
  const m = /^shot (\d+) \(([^():]+):(\d+)\) at ([\d.]+)s: (.*)$/s.exec(text),
    ld = /^scene ([\w-]+\.js) failed to load: (.*)$/s.exec(text);
  return {
    file: m ? m[2] : ld ? `scenes/${ld[1]}` : null,
    line: m ? +m[3] : null,
    t: m ? +m[4] : null,
    msg: (m ? m[5] : ld ? ld[2] : text).trim(),
  };
}
async function pool(items, n, f) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const k = next++;
        if (k >= items.length) return;
        out[k] = await f(items[k], k);
      }
    }),
  );
  return out;
}
const clampT = (t, end) => +Math.max(0, Math.min(end - 0.02, t)).toFixed(2);
async function renderChecks(ctx, run, stopped) {
  const { id, ws, views, aspects, base } = ctx,
    findings = [],
    seen = new Set();
  const sevQ = qualityOf(ws),
    sevOf = (type) => layoutSeverity(type, sevQ);
  const add = (f) => {
    const k = `${f.id}|${f.where.view}|${f.where.aspect}|${f.where.file ?? ""}:${f.where.line ?? ""}|${f.finding.replace(/\d+(\.\d+)?/g, "#")}`;
    if (seen.has(k)) return;
    seen.add(k);
    findings.push(f);
  };
  const cur = parseManifest(readJson(path.join(ws, "style.json"))),
    mm = cur.ok ? cur.m : ctx.m,
    settings = (a) => settingsOf(mm, a);
  setItem(run, "boot", "running", "Loading every view in every format in hidden render windows ...");
  const jobs = [];
  for (const [n, v] of Object.entries(views)) {
    const must2 = isMustFail(n, v);
    for (const a of must2 ? aspects.slice(0, 1) : aspects) jobs.push({ n, v, a, must: must2 });
  }
  const probe = base === "recon" ? RECON_COLLIDE_PROBE : null,
    framesOut = [];
  let done = 0;
  const results = await pool(jobs, 3, async (j, k) => {
    if (stopped()) return { r: null, misses: [] };
    const hid = `${id}-j${k}`;
    registerHiddenProject(hid, ws);
    try {
      const r = await layoutCheckWith(
        hid,
        settings(j.a),
        { scenes: j.v.scenes, end: j.v.end },
        {
          sweepFps: !j.must && /^sample/i.test(j.n) && j.a === aspects[0] ? 4 : null,
          probe: probe && !j.must && j.a === aspects[0] ? probe : null,
          stills: (info) => {
            const shots = info?.shots ?? [],
              end = j.v.end;
            const mids = shots.map((s) => clampT(s.t0 + ((s.t1 ?? end) - s.t0) * 0.5, end));
            if (j.must) return { times: [...new Set(mids)].slice(0, 6), scale: 0.5 };
            const ends = shots.map((s) => clampT(s.t0 + ((s.t1 ?? end) - s.t0) * 0.88, end)),
              starts = shots.map((s) => clampT(s.t0 + ((s.t1 ?? end) - s.t0) * 0.12, end));
            return { times: [...new Set([...mids, ...ends, ...starts])].slice(0, 30).sort((a, b) => a - b), scale: 0.5 };
          },
        },
      );
      return { r, misses: hiddenMisses(hid) };
    } catch (e) {
      return {
        r: { bootError: String(e?.message || e), info: null, layout: null, stills: [], sweep: null, errors: [], ms: 0 },
        misses: hiddenMisses(hid),
      };
    } finally {
      unregisterHiddenProject(hid);
      done++;
      if (done % 2 === 0 || done === jobs.length) setItem(run, "boot", "running", `${done} of ${jobs.length} view x format looks done ...`);
    }
  });
  if (stopped()) return findings;
  const layoutViews = new Set(),
    frameViews = new Set();
  for (let k = 0; k < jobs.length; k++) {
    const j = jobs[k],
      { r, misses } = results[k],
      where = { view: j.n, aspect: j.a },
      scene0 = `scenes/${j.v.scenes[0]}.js`;
    if (!r) continue;
    if (r.bootError) {
      add(
        F(
          "boot",
          "high",
          { ...where, file: scene0 },
          `The ${j.n} view does not load (${j.a}): ${r.bootError}`,
          "Fix the error it names (cz preview shows it with its line).",
        ),
      );
      continue;
    }
    for (const e of r.errors ?? []) {
      if (IGNORE.test(e.text) || /^PROGRESS/.test(e.text) || (e.level !== "error" && e.level !== "warn")) continue;
      const p = parseErr(e.text),
        cue = /cue miss/i.test(e.text);
      if (e.level === "error")
        add(
          F(
            "boot",
            "high",
            { ...where, file: p.file ?? scene0, line: p.line, t: p.t },
            `${j.n} (${j.a}) logged an error: ${p.msg}`,
            "Fix the error it names (the line is in the message).",
          ),
        );
      else if (cue)
        add(
          F(
            "layout",
            "medium",
            { ...where, file: p.file, line: p.line },
            `CUE: ${e.text}`,
            "Cue a word that is in the narration (audio/timeline.json).",
          ),
        );
      else
        add(
          F(
            "boot",
            BAD_WARN.test(e.text) ? "high" : "low",
            { ...where, file: p.file, line: p.line },
            `${j.n} (${j.a}) warned: ${e.text}`,
            BAD_WARN.test(e.text)
              ? "Make the part it names load (a missing file, a wrong path, an asset the style must carry): a stand-in is never shipped."
              : "Look at the warning; fix it if it is the style's.",
          ),
        );
    }
    for (const m of misses)
      add(
        F(
          "boot",
          "high",
          { ...where, file: m.rel },
          `${j.n} (${j.a}) requested a file that is not there: HTTP ${m.status} /${m.rel}`,
          "Put the file into the style (or fix the path that asks for it): the app serves exactly the same files.",
        ),
      );
    for (const e of r.sweep?.errors ?? []) {
      const p = parseErr(`${e.where}: ${e.message}`);
      add(
        F(
          "boot",
          "high",
          { ...where, file: p.file, line: p.line, t: e.t },
          `A frame of ${j.n} throws at ${e.t}s${e.where ? ` (${e.where})` : ""}: ${e.message}`,
          "Fix the scene code at that line: an export draws that frame too.",
        ),
      );
    }
    const stats = new Map();
    for (const s of r.stills) {
      if (!s.png) {
        add(
          F(
            "boot",
            "high",
            { ...where, t: s.time, file: scene0 },
            `${j.n} (${j.a}) throws at ${s.time}s`,
            "Fix the scene code that throws at that moment (cz stills renders it).",
          ),
        );
        continue;
      }
      const st = frameStat(s.png);
      if (st) stats.set(s.time, st);
    }
    if (j.must) {
      const types = [...new Set((r.layout?.issues ?? []).map((i) => String(i.type)))],
        want = String(j.v.expect ?? "");
      if (!r.layout) {
        for (const m of stats.values())
          for (const ft of [structureOf(m.small).blank ? "BLANK" : null, isDark(m) ? "DARK" : null])
            if (ft && !types.includes(ft)) types.push(ft);
      }
      if (!want || !types.some((t) => t.toLowerCase() === want.toLowerCase()))
        add(
          F(
            "mustfail",
            "high",
            { ...where, file: scene0 },
            `${j.n} no longer reports ${want || "(no expected check)"} (it reports ${types.join(", ") || "nothing"}).`,
            `Restore the ${want} check in the engine (engine.js layoutIssues / lib) so ${j.n} fails again; never edit a must-fail scene.`,
          ),
        );
      continue;
    }
    if (r.layout) layoutViews.add(j.n);
    for (const i of r.layout?.issues ?? []) {
      const type = String(i.type ?? "layout"),
        p = parseWhat(String(i.what ?? "")),
        o = i.other ? parseWhat(String(i.other)) : null;
      const element = o?.element ? [p.element, o.element].filter(Boolean).sort().join(" + ") : p.element;
      const det = String(i.detail ?? ""),
        cut = det.indexOf(": ");
      add(
        F(
          "layout",
          sevOf(type),
          { ...where, t: +i.t, file: p.file ?? o?.file ?? null, line: p.line ?? o?.line ?? null },
          `${type.toUpperCase()}: ${element ?? ""} ${cut > 0 ? det.slice(0, cut) : det} (at ${(+i.t).toFixed(2)}s)`
            .replace(/\s+/g, " ")
            .trim(),
          cut > 0 ? det.slice(cut + 2) : "Fix the element it names at that moment.",
        ),
      );
    }
    for (const p of Array.isArray(r.probe) ? r.probe : []) {
      const n = (+p.i || 0) + 1,
        file = /^[\w./-]+\.js$/.test(String(p.file)) ? String(p.file) : null;
      if (+p?.figures > 0 && !p.collide)
        add(
          F(
            "layout",
            "high",
            { ...where, t: p.t, file, line: +p.line || null },
            `COLLISION NOT DECLARED: shot ${n}${p.name ? ` (${String(p.name).slice(0, 60)})` : ""} shows ${p.figures} figure${p.figures === 1 ? "" : "s"} but declares no S.collide = { bodies, solids }`,
            `In the shot's build: S.collide = { bodies: () => [{ name, caps: personCaps(p) }], solids: [the closed meshes they stand at or sit in] } (lib/collide.js; engine_api.md "S.collide").`,
          ),
        );
      for (const b of Array.isArray(p?.support) ? p.support : []) {
        const cm = Math.round(Math.abs(+b.gap) * 100),
          up = +b.gap > 0;
        add(
          F(
            "layout",
            "high",
            { ...where, t: p.t, file, line: +p.line || null },
            `${up ? "SUPPORT" : "SUNK"}: ${String(b.name).slice(0, 60)} in shot ${n} ${up ? `hangs ${cm} cm above what is under it` : `is ${cm} cm into the surface under it`}`,
            up
              ? "Rest the body on the surface (within 3 cm), or mark a body that really flies, falls or swims { airborne: true } in S.collide.bodies."
              : "Lift the body (or its feet) onto the surface: nothing of it may go into the floor or the seat.",
          ),
        );
      }
    }
    frameViews.add(j.n);
    const shots = r.info?.shots ?? [],
      end = j.v.end,
      motion = /^sample/i.test(j.n) && base !== "stickman",
      structures = [];
    shots.forEach((s, k2) => {
      const t1 = s.t1 ?? end,
        mid = clampT(s.t0 + (t1 - s.t0) * 0.5, end),
        m = stats.get(mid),
        w = { ...where, t: mid, file: s.file ?? null, line: s.line ?? null };
      if (!m) return;
      const S = structureOf(m.small);
      structures.push(S);
      if (S.blank)
        add(
          F(
            "frames",
            "high",
            w,
            `BLANK: shot ${k2 + 1} of ${j.n} shows nothing but its background at ${mid}s (structure ${S.full.toFixed(2)}, centre ${S.centre.toFixed(2)}: a frame that shows something measures ${BLANK_LIMIT.full}+ overall or ${BLANK_LIMIT.centre}+ in its centre).`,
            "Make the shot draw its elements (check they are inside the frame and visible).",
          ),
        );
      else if (!r.layout && isDark(m))
        add(
          F(
            "frames",
            "high",
            w,
            `DARK: shot ${k2 + 1} of ${j.n} is too dark to read at ${mid}s (mean ${m.mean.toFixed(3)}, brightest 2 % ${m.hi.toFixed(2)}).`,
            "Light the subject or lighten the background (never by turning text up).",
          ),
        );
      if (motion && t1 - s.t0 >= 2.5) {
        const a = stats.get(clampT(s.t0 + (t1 - s.t0) * 0.12, end)),
          b = stats.get(clampT(s.t0 + (t1 - s.t0) * 0.88, end));
        if (a && b && diffOf(a, m) < 2e-3 && diffOf(m, b) < 2e-3)
          add(
            F(
              "frames",
              sevOf("frozen"),
              w,
              `FROZEN: nothing moves in shot ${k2 + 1} of ${j.n} (${(t1 - s.t0).toFixed(1)} s).`,
              "Bring elements in on their spoken words, or move the camera / an element over the shot.",
            ),
          );
      }
      const pv = k2 > 0 ? shots[k2 - 1] : null;
      if (pv) {
        const pm = stats.get(clampT(pv.t0 + ((pv.t1 ?? end) - pv.t0) * 0.5, end));
        if (pm && diffOf(pm, m) < 15e-4)
          add(
            F(
              "frames",
              sevOf("same"),
              w,
              `SAME: shots ${k2} and ${k2 + 1} of ${j.n} look the same.`,
              "Change what the second shot shows (a new subject, framing or layout), or merge the two shots.",
            ),
          );
      }
    });
    if (structures.length)
      log(
        "style import: frame structure",
        j.n,
        j.a,
        "lowest full",
        Math.min(...structures.map((s) => s.full)).toFixed(2),
        "centre",
        Math.min(...structures.map((s) => s.centre)).toFixed(2),
        `(${structures.length} shots)`,
      );
    if (/^sample/i.test(j.n)) {
      const fd = path.join(ws, ".suite", "import", aspectTag(j.a));
      fs.mkdirSync(fd, { recursive: true });
      for (const s of r.stills)
        if (
          s.png &&
          shots.some((x) => clampT(x.t0 + ((x.t1 ?? end) - x.t0) * 0.5, end) === s.time) &&
          framesOut.filter((f) => f.aspect === j.a).length < 8
        ) {
          const rel = `.suite/import/${aspectTag(j.a)}/${j.n}_t${s.time.toFixed(2).replace(".", "_")}.jpg`;
          try {
            fs.writeFileSync(path.join(ws, rel), nativeImage.createFromBuffer(s.png).toJPEG(84));
            framesOut.push({ aspect: j.a, view: j.n, t: s.time, url: projectUrl(id, rel) });
          } catch {}
        }
    }
  }
  run.frames = framesOut;
  const cnt = (fid) => {
    const l = findings.filter((f) => f.id === fid);
    return { high: l.filter((f) => f.sev === "high").length, all: l.length };
  };
  const normal = jobs.filter((j) => !j.must).length,
    must = jobs.filter((j) => j.must);
  {
    const c = cnt("boot");
    setItem(
      run,
      "boot",
      c.high ? "fail" : "ok",
      c.high
        ? `${c.high} problem${c.high > 1 ? "s" : ""}: ${findings.find((f) => f.id === "boot" && f.sev === "high").finding}`
        : `${jobs.length} view x format looks, no errors, no missing files${c.all ? ` (${c.all} note${c.all > 1 ? "s" : ""})` : ""}`,
    );
  }
  {
    const c = cnt("layout");
    setItem(
      run,
      "layout",
      !layoutViews.size ? "skip" : c.high ? "fail" : "ok",
      !layoutViews.size
        ? "this engine has no layout check (the frame checks cover it)"
        : c.high
          ? `${c.high} high: ${findings.find((f) => f.id === "layout" && f.sev === "high").finding}`
          : `${layoutViews.size} views clean${c.all ? ` (${c.all} medium / low note${c.all > 1 ? "s" : ""})` : ""}`,
    );
  }
  {
    const c = cnt("frames");
    setItem(
      run,
      "frames",
      !frameViews.size ? "fail" : c.high ? "fail" : "ok",
      !frameViews.size
        ? "no view rendered"
        : c.high
          ? `${c.high} high: ${findings.find((f) => f.id === "frames" && f.sev === "high").finding}`
          : `${normal} view x format looks show something${c.all ? ` (${c.all} note${c.all > 1 ? "s" : ""})` : ""}`,
    );
  }
  {
    const c = cnt("mustfail");
    setItem(
      run,
      "mustfail",
      !must.length ? "fail" : c.high ? "fail" : "ok",
      !must.length
        ? "there is no must-fail view"
        : c.high
          ? findings.find((f) => f.id === "mustfail").finding
          : `${must.length} must-fail view${must.length > 1 ? "s" : ""} caught (${must.map((j) => j.v.expect).join(", ")})`,
    );
  }
  if (stopped()) return findings;
  const sample = Object.entries(views).find(([n]) => n === "sample") ?? Object.entries(views).find(([n, v]) => !isMustFail(n, v));
  setItem(run, "export", "running", "Exporting 5 s of the sample in every format ...");
  const exports = {};
  if (!sample) setItem(run, "export", "fail", "there is no sample view to export");
  else {
    for (const a of aspects) {
      if (stopped()) break;
      const where = { view: sample[0], aspect: a },
        hid = `${id}-x${aspectTag(a)}`,
        out = path.join(ws, "out", `czcheck_${aspectTag(a)}.mp4`),
        poster = path.join(ws, "out", `czcheck_${aspectTag(a)}.jpg`);
      registerHiddenProject(hid, ws);
      const { job, stopped: st, ff: fff, end } = beginExport(hid);
      try {
        fs.rmSync(out, { force: true });
        const res = await renderFrames(
          hid,
          { job, stopped: st },
          {
            name: `czcheck_${aspectTag(a)}`,
            fps: 30,
            from: 0,
            to: Math.min(5, sample[1].end),
            settings: settings(a),
            view: { scenes: sample[1].scenes, end: sample[1].end },
            requireShots: true,
          },
          () => {},
        );
        await fff(["-r", "30", "-i", res.h264, "-c:v", "copy", "-movflags", "+faststart", out]);
        fs.rmSync(res.h264, { force: true });
        await ff(["-ss", String(Math.min(2.5, Math.min(5, sample[1].end) / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", poster]);
        const img = nativeImage.createFromPath(poster),
          sz = img.getSize(),
          want = a === "9:16" ? [1080, 1920] : [1920, 1080];
        if (img.isEmpty()) throw new Error("no frame could be decoded from the video");
        if (sz.width !== want[0] || sz.height !== want[1])
          throw new Error(`the video is ${sz.width}x${sz.height}, not ${want[0]}x${want[1]} (${a})`);
        exports[a] = projectUrl(id, `out/czcheck_${aspectTag(a)}.mp4`);
      } catch (e) {
        add(
          F(
            "export",
            "high",
            where,
            `A 5 s export of ${sample[0]} in ${a} failed: ${clip(e?.message || e, 300)}`,
            "Fix what it names (a scene that throws while exporting names its line), then check again.",
          ),
        );
      } finally {
        end();
        unregisterHiddenProject(hid);
      }
    }
    run.exports = exports;
    const c = cnt("export");
    setItem(
      run,
      "export",
      c.high ? "fail" : "ok",
      c.high
        ? findings.find((f) => f.id === "export").finding
        : `${Object.keys(exports).join(" and ")}: 5 s of ${sample[0]} exported and played back`,
    );
  }
  if (stopped()) return findings;
  setItem(run, "repeat", "running", "Drawing the same moments in a different order ...");
  if (!sample) setItem(run, "repeat", "skip", "there is no sample view");
  else {
    const [vn, v] = sample,
      a = aspects[0],
      end = v.end,
      where = { view: vn, aspect: a },
      hid = `${id}-r`;
    let moments = [];
    registerHiddenProject(hid, ws);
    try {
      await withThrowawayWorker(hid, settings(a), { scenes: v.scenes, end }, async (js2) => {
        const info = await js2("window.suite ? window.suite.info() : null", 15e3).catch(() => null);
        moments = repeatMoments(info?.shots ?? [], end);
        for (const t of moments) {
          const far = [+(end * 0.95).toFixed(2), +(end * 0.1).toFixed(2), clampT(t + 1.3, end), 0, +(end * 0.55).toFixed(2)];
          const lead = Array.from({ length: 10 }, (_, k) => +Math.max(0, t - 1 + k * 0.1).toFixed(3));
          const fresh = await js2(`window.suite.stills([${t}], .5)`, 6e4);
          for (const [how, before] of [
            ["after jumping to other moments (a scrubbed preview, a still)", far],
            ["after playing the second before it (an export, a playing preview)", [...far.slice(0, 2), ...lead]],
          ]) {
            const order2 = [...before, t];
            const again = await js2(`window.suite.stills(${JSON.stringify(order2)}, .5)`, 6e4 + order2.length * 3e3);
            const A = fresh[0],
              B = again[again.length - 1];
            if (!A || !B) {
              add(
                F(
                  "repeat",
                  "high",
                  { ...where, t },
                  `The frame at ${t}s of ${vn} could not be drawn twice.`,
                  "Fix the error the boot check names, then check again.",
                ),
              );
              break;
            }
            if (A === B) continue;
            const pa = nativeImage.createFromDataURL(A).toBitmap(),
              pb = nativeImage.createFromDataURL(B).toBitmap();
            if (pa.length !== pb.length) {
              add(
                F(
                  "repeat",
                  "high",
                  { ...where, t },
                  `The frame at ${t}s of ${vn} is not the frame drawn there first when it is drawn ${how}: a different size.`,
                  "Draw everything from the frame time t alone.",
                ),
              );
              continue;
            }
            let n = 0,
              big = 0,
              huge = 0,
              max = 0;
            for (let i = 0; i < pa.length; i += 4) {
              const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
              if (d) n++;
              if (d > 16) big++;
              if (d > 48) huge++;
              if (d > max) max = d;
            }
            const px = pa.length / 4,
              changedF = n / px;
            if (repeatSeverity({ big: big / px, huge }) === "high")
              add(
                F(
                  "repeat",
                  "high",
                  { ...where, t },
                  `The frame at ${t}s of ${vn} is not the frame drawn there first when it is drawn ${how}: ${(changedF * 100).toFixed(2)} % of pixels differ, by up to ${max} levels.`,
                  "Draw everything from the frame time t alone: no state carried between frames (counters, accumulated positions, particles, an animation mixer advanced by the time since the last frame instead of set to t, a wipe drawn before the camera moved).",
                ),
              );
            else if (n)
              add(
                F(
                  "repeat",
                  "low",
                  { ...where, t },
                  `The frame at ${t}s of ${vn} differs very slightly when it is drawn ${how} (${(changedF * 100).toFixed(2)} % of pixels, ${huge} of them by more than 48 levels, at most ${max}).`,
                  "Probably GPU rounding; if it is visible, look for state carried between frames.",
                ),
              );
          }
        }
      });
    } catch (e) {
      add(
        F(
          "repeat",
          "high",
          where,
          `The repeat check could not run on ${vn}: ${clip(e?.message || e, 300)}`,
          "Fix the error it names, then check again.",
        ),
      );
    } finally {
      unregisterHiddenProject(hid);
    }
    const c = cnt("repeat");
    setItem(
      run,
      "repeat",
      c.high ? "fail" : "ok",
      c.high
        ? findings.find((f) => f.id === "repeat" && f.sev === "high").finding
        : `${moments.length} moment${moments.length === 1 ? "" : "s"} of ${vn} (one per shot) drawn fresh, after jumping and after playing: the same${c.all ? " (tiny GPU rounding noted)" : ""}`,
    );
  }
  return findings;
}
function applyBaseDebt(findings, base, engineVersion) {
  const lowered = new Set();
  for (const f of findings) {
    const debt = f.sev === "high" ? baseDebt(base, f.id, engineVersion) : null;
    if (debt) {
      f.sev = "medium";
      f.finding += ` This is a known fault of the base engine itself (${debt.why}), not of your style: it does not block the import, and it goes away when you rebase onto the fixed engine.`;
      lowered.add(f.id);
    }
  }
  return lowered;
}
function pkgInfo(m, id, checkOnly) {
  const info = { name: m.name, base: m.base, aspects: [...m.aspects], styleId: m.id };
  if (checkOnly) {
    const inst22 = getStyle(m.id),
      prev2 = inst22.pkg && !inst22.pkg.official && inst22.id === m.id ? inst22.pkg.manifest.version : null;
    return {
      ...info,
      version: prev2 != null ? Math.max(prev2 + 1, m.version) : m.version,
      isUpdate: prev2 != null,
      prevVersion: prev2,
      installAs: null,
      asNew: null,
    };
  }
  const orig = packageRoot(pkgDir(id)),
    om = parseManifest(readJson(path.join(orig, "style.json"))),
    t = packageInstallTarget(om.ok ? om.m : m, packageEngineSha(orig));
  const inst = getStyle(t.id),
    prev = t.update && inst.pkg && !inst.pkg.official && inst.id === t.id ? inst.pkg.manifest.version : null;
  const nameAs = t.id === m.id ? m.name : prev != null ? inst.name : `${m.name.slice(0, 50)} (${/-(\d+)$/.exec(t.id)?.[1] ?? 2})`;
  return {
    ...info,
    name: nameAs,
    version: prev != null ? Math.max(prev + 1, m.version) : m.version,
    isUpdate: prev != null,
    prevVersion: prev,
    installAs: t.id !== m.id ? t.id : null,
    asNew: t.clash
      ? `A different style called "${t.clash.name}" is already installed as ${t.clash.id}. ${prev != null ? `This package updates "${nameAs}", the earlier import of it` : `This one is added as a new style, "${nameAs}"`}; "${t.clash.name}" stays as it is.`
      : null,
  };
}
export async function checkAll(run, o) {
  const id = run.id;
  for (const i of run.items)
    if (i.id !== "unpack" && (o.initial ? true : i.id !== "workspace")) {
      i.status = "wait";
      i.detail = "";
    }
  const findings = [];
  setItem(run, "static", "running", "Reading the package: files, manifest, engine contract, banned calls, text, sample, looks ...");
  const root = o.initial ? packageRoot(pkgDir(id)) : await assemble(id, checkedDir(id));
  const raw = readJson(path.join(root, "style.json")),
    pm = parseManifest(raw),
    base = pm.ok && BASES.includes(pm.m.base) ? pm.m.base : null;
  const st = await staticCheck(root, staticOpts(base));
  findings.push(...st);
  const leftOut = readJson(path.join(runDir(id), "leftout.json")) ?? [];
  if (leftOut.length) findings.push(leftOutFinding(leftOut));
  const sh = highOf(st);
  if (o.initial) run.findings = sortFindings(findings);
  setItem(
    run,
    "static",
    sh.length ? "fail" : "ok",
    sh.length
      ? `${sh.length} high: ${sh[0].finding}`
      : `clean${st.length ? ` (${st.filter((f) => f.sev === "medium").length} medium, ${st.filter((f) => f.sev === "low" || f.sev === "info").length} low / info)` : ""}`,
  );
  const views = viewsOf(root);
  if (pm.ok) run.pkg = pkgInfo(pm.m, id, run.checkOnly);
  const renderable = pm.ok && !!base && Object.keys(views).length > 0 && exists(path.join(root, "engine", "engine.js"));
  if (!renderable) {
    for (const i of run.items)
      if (["workspace", "boot", "layout", "frames", "mustfail", "export", "repeat"].includes(i.id) && i.status === "wait") {
        i.status = "skip";
        i.detail = "needs a readable style.json, its engine and sample/views.json first";
      }
  } else {
    const m = pm.m;
    if (o.initial) {
      setItem(run, "workspace", "running", "Copying the package into a private check copy ...");
      buildWorkspace(id, root, m, raw, views);
      setItem(
        run,
        "workspace",
        "ok",
        `${Object.keys(views).length} views (${Object.keys(views).join(", ")}) in ${m.aspects.join(" and ")}`,
      );
    }
    registerHiddenProject(id, wsDir(id));
    const ctx = { id, dir: runDir(id), ws: wsDir(id), m, views, aspects: m.aspects, base: m.base };
    const rf = await renderChecks(ctx, run, o.stopped);
    for (const fid of applyBaseDebt(rf, m.base, m.from?.engineVersion)) {
      const it = run.items.find((i) => i.id === fid);
      if (it && it.status === "fail" && !rf.some((f) => f.id === fid && f.sev === "high"))
        setItem(
          run,
          fid,
          "ok",
          `a known fault of the ${getStyle(m.base).name} engine itself (not blocking): ${rf.find((f) => f.id === fid).finding.slice(0, 200)}`,
        );
    }
    findings.push(...rf);
  }
  if (o.stopped()) {
    for (const i of run.items)
      if (i.status === "wait" || i.status === "running") {
        i.status = "skip";
        i.detail = "stopped";
      }
    saveRun(run);
    return false;
  }
  run.findings = sortFindings(findings);
  const high = highOf(run.findings).length,
    med = run.findings.filter((f) => f.sev === "medium").length;
  setItem(
    run,
    "summary",
    high ? "fail" : "ok",
    high
      ? `${high} high finding${high > 1 ? "s" : ""} to fix (${med} medium)`
      : `Ready: no high finding${med ? ` (${med} medium to look at)` : ""}`,
  );
  return true;
}
export function startImport(src, opts = {}) {
  const source = path.resolve(String(src || ""));
  if (!src || !exists(source)) throw new Error("Pick the package's .zip file or its folder.");
  if (opts.checkOnly && !PKG_ID.test(opts.checkOnly)) throw new Error("Only your own styles can be re-checked.");
  const id = `imp_${crypto.randomBytes(6).toString("hex")}`;
  const run = {
    id,
    status: "running",
    checkOnly: opts.checkOnly ?? null,
    source,
    at: new Date().toISOString(),
    ms: 0,
    items: IMPORT_ITEMS.map(([i, label]) => ({ id: i, label, status: "wait", detail: "" })),
    findings: [],
    round: 0,
    maxRounds: MAX_ROUNDS,
    pkg: null,
    result: null,
    error: null,
    fix: null,
    frames: [],
    exports: {},
  };
  runs.set(id, run);
  busy.add(id);
  const ac = new AbortController();
  stops.set(id, ac);
  fs.mkdirSync(runDir(id), { recursive: true });
  saveRun(run);
  (async () => {
    const t0 = Date.now();
    try {
      setItem(run, "unpack", "running", source);
      let up;
      try {
        up = unpack(source, pkgDir(id));
      } catch (e) {
        const msg = clip(e?.message || e, 400);
        run.findings = [
          {
            id: "files",
            sev: "high",
            where: {},
            finding: msg,
            meaning: MEANING.files,
            fix: /link/.test(msg)
              ? "Replace the link with the real file (or remove it), then package again."
              : /zip64|split|encrypted|compression|damaged|not a zip/i.test(msg)
                ? "Make the package again with `cz package <style>` and import its .zip."
                : "Make the package again with `cz package <style>` (it never writes such files), then import it.",
          },
        ];
        setItem(run, "unpack", "fail", msg);
        for (const i of run.items)
          if (i.status === "wait") {
            i.status = "skip";
            i.detail = "the package could not be unpacked";
          }
        run.status = "failed";
        run.error = `The package was refused: ${msg}`;
        return;
      }
      fs.writeFileSync(path.join(runDir(id), "leftout.json"), JSON.stringify(up.leftOut));
      setItem(
        run,
        "unpack",
        "ok",
        `${listRel(up.root).length} files${up.leftOut.length ? `, ${up.leftOut.length} left out (${up.leftOut.slice(0, 3).join("; ")})` : ""}`,
      );
      await checkAll(run, { initial: true, stopped: () => ac.signal.aborted });
      if (ac.signal.aborted) return;
      run.status = highOf(run.findings).length ? "needs-fix" : "ready";
    } catch (e) {
      run.status = "failed";
      run.error = clip(e?.message || e, 400);
      for (const i of run.items)
        if (i.status === "running") {
          i.status = "fail";
          i.detail = run.error;
        }
      log("style import failed", id, e?.stack || e?.message);
    } finally {
      busy.delete(id);
      stops.delete(id);
      if (run.status !== "cancelled") saveRun(run, t0);
      else run.ms = Date.now() - t0;
      log("style import", id, run.status, `${run.findings.length} findings`, `${Math.round((Date.now() - t0) / 1e3)} s`);
    }
  })();
  return run;
}
export function stopImport(id) {
  const run = getRun(id);
  if (!run) throw new Error("That import is gone.");
  stops.get(id)?.abort();
  return run;
}
function removeRunDir(id) {
  try {
    fs.rmSync(runDir(id), { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (e) {
    log("style import: folder not removed yet", id, e?.message);
    setTimeout(() => {
      try {
        fs.rmSync(runDir(id), { recursive: true, force: true, maxRetries: 4, retryDelay: 500 });
      } catch {}
    }, 5e3);
  }
}
export async function cancelImport(id) {
  const run = getRun(id);
  if (!run) return null;
  stops.get(id)?.abort();
  for (let t = Date.now(); busy.has(id) && Date.now() - t < 2e4;) await new Promise((r) => setTimeout(r, 150));
  if (run.status !== "installed") run.status = "cancelled";
  unregisterHiddenProject(id);
  removeRunDir(id);
  try {
    changed(run);
  } catch {}
  runs.delete(id);
  return run;
}
export async function installImport(id) {
  const run = getRun(id);
  if (!run) throw new Error("That import is gone.");
  if (run.checkOnly) throw new Error("A re-check never installs: the style is installed already.");
  if (busy.has(id)) throw new Error("The import is still being checked: wait for the result.");
  if (run.status === "installed") throw new Error("This style was added already.");
  if (run.status !== "ready" || highOf(run.findings).length)
    throw new Error("Fix the high findings first (Let Claude fix it, or Copy fix list for Claude Code), then add the style.");
  busy.add(id);
  try {
    const m = parseManifest(readJson(originalManifestFile(id)));
    if (!m.ok) throw new Error(`style.json is not valid: ${m.why}`);
    const out = await assemble(id, path.join(runDir(id), "install", m.m.id), { preview: true });
    const info = pkgInfo(m.m, id, null);
    if (info.installAs) {
      const sj = readJson(path.join(out, "style.json"));
      fs.writeFileSync(path.join(out, "style.json"), JSON.stringify({ ...sj, id: info.installAs, name: info.name }, null, 2) + "\n");
      const ld = path.join(out, "looks");
      if (exists(ld))
        for (const n of fs.readdirSync(ld).filter((x) => x.endsWith(".json"))) {
          const j = readJson(path.join(ld, n));
          if (j && j.style === m.m.id) fs.writeFileSync(path.join(ld, n), JSON.stringify({ ...j, style: info.installAs }, null, 2) + "\n");
        }
    }
    const r = installPackageVersion(out, info.installAs ? { id: info.installAs } : {});
    run.pkg = info;
    run.status = "installed";
    run.result = { id: r.id, version: r.version };
    saveRun(run);
    unregisterHiddenProject(id);
    removeRunDir(id);
    log("style import installed", id, r.id, `v${r.version}`);
    return run;
  } finally {
    busy.delete(id);
  }
}
export function fixList(id) {
  const run = getRun(id);
  if (!run) throw new Error("That import is gone.");
  const name = (run.pkg?.styleId ?? "custom-style").replace(/^custom-/, ""),
    high = highOf(run.findings),
    rest = run.findings.filter((f) => f.sev !== "high" && f.sev !== "info");
  const lines = [
    `Videoxx could not add the style "${run.pkg?.name ?? name}" yet: the import found ${high.length} high finding${high.length === 1 ? "" : "s"}${rest.length ? ` (and ${rest.length} medium / low)` : ""}.`,
    "Fix each one in styles/" + name + "/ (docs/CHECKS.md explains every check id), then run the checks again and package it:",
    "",
    formatFindings(run.findings.filter((f) => f.sev !== "info")),
    "",
    `After fixing: run \`./cz check ${name}\` (PowerShell: \`.\\cz.cmd check ${name}\`) until it says READY, then \`./cz package ${name}\` and import dist/${run.pkg?.styleId ?? `custom-${name}`}.zip in Videoxx again.`,
  ];
  return lines.join("\n");
}
export function exportPackage(styleId, toFile) {
  const st = getStyle(styleId);
  if (!st.pkg || st.pkg.official || st.id !== styleId || !PKG_ID.test(styleId))
    throw new Error("Only your own styles can be exported as a package.");
  if (!/\.zip$/i.test(toFile)) throw new Error("The package is saved as a .zip file.");
  const dir = st.pkg.dir,
    entries = [];
  for (const r of listRel(dir)) {
    const parts = r.split("/");
    if (parts.some((p) => NEVER_COPIED.has(p)) || skippedReason(r) || /mixamo|y[\s_-]?bot/i.test(r) || r === "preview.jpg") continue;
    entries.push({ name: `${styleId}/${r}`, data: fs.readFileSync(path.join(dir, r)) });
  }
  fs.mkdirSync(path.dirname(path.resolve(toFile)), { recursive: true });
  fs.writeFileSync(toFile, writeZip(entries));
  return { file: path.resolve(toFile), files: entries.length, bytes: fs.statSync(toFile).size };
}
const NO_SAMPLE =
  "This style was made before the Style Kit: it has no sample to check. Export package and open it in the Style Kit (cz import-package) to add one.";
export function recheck(styleId) {
  const st = getStyle(styleId);
  if (!st.pkg || st.pkg.official || st.id !== styleId) throw new Error("Only your own styles can be re-checked.");
  if (!exists(path.join(st.pkg.dir, "sample", "views.json"))) {
    const id = `imp_${crypto.randomBytes(6).toString("hex")}`;
    const run = {
      id,
      status: "failed",
      checkOnly: styleId,
      source: st.pkg.dir,
      at: new Date().toISOString(),
      ms: 0,
      noSample: true,
      items: IMPORT_ITEMS.map(([i, label]) => ({ id: i, label, status: "skip", detail: i === "unpack" ? "no sample/ in this style" : "" })),
      findings: [],
      round: 0,
      maxRounds: MAX_ROUNDS,
      pkg: {
        name: st.name,
        base: st.pkg.manifest.base,
        aspects: [...st.pkg.manifest.aspects],
        version: st.pkg.manifest.version,
        isUpdate: false,
        prevVersion: st.pkg.manifest.version,
        styleId,
        installAs: null,
        asNew: null,
      },
      result: null,
      error: NO_SAMPLE,
      fix: null,
      frames: [],
      exports: {},
    };
    runs.set(id, run);
    saveRun(run);
    return run;
  }
  return startImport(st.pkg.dir, { checkOnly: styleId });
}
export function versions(styleId) {
  const st = getStyle(styleId);
  if (!st.pkg || st.pkg.official || st.id !== styleId) throw new Error("Only your own styles have versions.");
  return {
    id: styleId,
    name: st.name,
    current: st.pkg.manifest.version,
    kept: packageVersions(styleId).map((v) => ({ version: v.version, engineVersion: v.engineVersion, updated: v.m.updated ?? null })),
  };
}
export function restoreVersion(styleId, n) {
  const r = restorePrevious(styleId, Number(n));
  loadPackages();
  return r;
}
export function styleKitInfo() {
  const engines = {};
  for (const b of PKG_BASES) engines[b] = latestEngine(b);
  const styles = PACKAGES.filter((s) => s.pkg && !s.pkg.official).map((s) => {
    const m = s.pkg.manifest,
      base = baseOf(s.id),
      builtOn = m.kit?.baseEngine ?? m.from?.engineVersion ?? null,
      now = engines[base] ?? 0,
      up = builtOn != null && now > builtOn;
    return {
      id: s.id,
      name: s.name,
      base,
      version: m.version,
      builtOn,
      baseEngine: now,
      engineUpdate: up,
      note: up ? `${getStyle(base).name} engine v${now} is available (yours: v${builtOn}). Update it in the Style Kit: cz rebase.` : null,
    };
  });
  return { appVersion: app.getVersion(), engines, styles };
}
