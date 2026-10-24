import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { templatesDir, ws } from "../core/workspace";
import { log } from "../core/log";
import { now, q } from "../db/db";
import { LOOK_ID, OFFICIAL_ID, PKG_ID, controlsFor, formatOfAspect, parseLook, parseManifest } from "./manifest";
import { CARRIED, PACKAGES, STYLES, getStyle, pinnedManifest } from "./catalog";
import { getPreset, validateSettings } from "./presets";
import { serverUrl } from "../projects/fileServer";

const officialRoot = () => path.join(templatesDir(), "styles");
export const memberRoot = () => path.join(ws.root(), "styles");
const readJson$c = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const deepMerge = (a, b) => {
  const o = { ...a };
  for (const k in b || {}) o[k] = isObj(b[k]) && isObj(a?.[k]) ? deepMerge(a[k], b[k]) : b[k];
  return o;
};
function inside(root, p) {
  try {
    const r = path.relative(fs.realpathSync(root), fs.realpathSync(p));
    return !!r && !r.startsWith("..") && !path.isAbsolute(r);
  } catch {
    return false;
  }
}
const isFile = (f) => {
  try {
    return fs.lstatSync(f).isFile();
  } catch {
    return false;
  }
};
const firstSentence = (s) => (String(s || "").split(/(?<=[.!?])\s/)[0] || "").slice(0, 140);
function scan(root, official) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "looks" || e.name.startsWith(".")) continue;
    const dir = path.join(root, e.name),
      raw = readJson$c(path.join(dir, "style.json"));
    if (!raw || raw.schema !== 2) continue;
    const bad = (why) => log("style package skipped:", dir, "-", why);
    const p = parseManifest(raw);
    if (!p.ok) {
      bad(`style.json: ${p.why}`);
      continue;
    }
    const m = p.m;
    if (m.id !== e.name) {
      bad(`its id "${m.id}" is not its folder name`);
      continue;
    }
    if (official ? !(OFFICIAL_ID.test(m.id) && !m.id.startsWith("custom-")) : !PKG_ID.test(m.id)) {
      bad(`"${m.id}" is not a valid ${official ? "official" : "member"} package id`);
      continue;
    }
    if (!official && m.aliases.length) {
      bad("only official packages may carry aliases");
      continue;
    }
    const engineDir = path.join(dir, "engine");
    if (!inside(root, dir) || !inside(dir, engineDir)) {
      bad("the folder or its engine/ resolves outside its styles folder");
      continue;
    }
    if (!isFile(path.join(engineDir, "engine.js")) || !isFile(path.join(engineDir, "models.js"))) {
      bad("engine/engine.js or engine/models.js is missing");
      continue;
    }
    out.push({ id: m.id, dir, official, m: { ...m, official } });
  }
  return out;
}
function packageLooks(f) {
  const d = path.join(f.dir, "looks"),
    out = [];
  if (!fs.existsSync(d) || !inside(f.dir, d)) return out;
  for (const n of fs
    .readdirSync(d)
    .filter((x) => x.endsWith(".json"))
    .sort()) {
    const p = parseLook(readJson$c(path.join(d, n)));
    if (!p.ok) {
      log("style package look skipped:", path.join(d, n), "-", p.why);
      continue;
    }
    if (p.m.style && p.m.style !== f.id) {
      log("style package look skipped:", path.join(d, n), "- it belongs to", p.m.style);
      continue;
    }
    out.push({ id: `${f.id}-${p.m.id.replace(/^look-/, "")}`, name: p.m.name, description: p.m.description, settings: p.m.settings });
  }
  return out;
}
function seedLooks(st, f, base) {
  const fmt = formatOfAspect(st.aspects[0]);
  const dimLook = f.m.dim
    ? [base.defaultLook, ...(base.looks ?? [])].map((id) => getPreset(id)).find((p) => p?.settings?.dim === f.m.dim)
    : null;
  const baseLook = (dimLook ?? getPreset(base.defaultLook))?.settings ?? {};
  const defaults = { ...deepMerge(baseLook, f.m.defaults || {}), format: fmt };
  const looks = [
    { id: `${f.id}-default`, name: "Default", description: `${st.name}, as designed.`, settings: defaults },
    ...packageLooks(f).map((l) => ({ ...l, settings: deepMerge(defaults, l.settings) })),
  ];
  const byId = new Map(looks.map((l) => [l.id, l]));
  const seeded = [];
  for (const l of byId.values()) {
    const err = validateSettings(l.settings, st.id);
    if (err) {
      log("style package look skipped:", l.id, "-", err);
      continue;
    }
    const row = q.get("SELECT * FROM presets WHERE id=?", l.id),
      json = JSON.stringify(l.settings);
    if (row && row.origin !== "package") {
      log("style package look skipped:", l.id, "- that look id is taken");
      continue;
    }
    if (!row)
      q.run(
        "INSERT INTO presets(id,name,description,settings,builtin,style_id,created_at,updated_at,origin) VALUES(?,?,?,?,1,?,?,?,?)",
        l.id,
        l.name,
        l.description,
        json,
        st.id,
        now(),
        now(),
        "package",
      );
    else if (row.name !== l.name || row.description !== l.description || row.settings !== json || row.style_id !== st.id || !row.builtin)
      q.run(
        "UPDATE presets SET name=?, description=?, settings=?, style_id=?, builtin=1, updated_at=? WHERE id=?",
        l.name,
        l.description,
        json,
        st.id,
        now(),
        l.id,
      );
    seeded.push(l.id);
  }
  for (const r of q.all("SELECT id FROM presets WHERE origin='package' AND style_id=?", st.id))
    if (!seeded.includes(r.id) && seeded.length) {
      q.run("UPDATE projects SET preset_id=? WHERE preset_id=?", seeded[0], r.id);
      q.run("DELETE FROM presets WHERE id=?", r.id);
    }
  return seeded;
}
export function loadPackages() {
  PACKAGES.length = 0;
  const found = [...scan(officialRoot(), true), ...scan(memberRoot(), false)],
    byId = new Map();
  const taken = (id) => STYLES.some((s) => s.id === id) || byId.has(id) || [...byId.values()].some((f) => f.m.aliases.includes(id));
  for (const f of found) {
    if (taken(f.id) || f.m.aliases.some((a) => taken(a))) {
      log("style package skipped:", f.dir, "- its id is taken");
      continue;
    }
    byId.set(f.id, f);
  }
  const builtinBase = (f) => {
    let b = f.m.base;
    const seen = new Set([f.id]);
    while (!STYLES.some((s) => s.id === b)) {
      const up = byId.get(b);
      if (!up || seen.has(b)) return null;
      seen.add(b);
      b = up.m.base;
    }
    return b;
  };
  for (const f of byId.values()) {
    const b = builtinBase(f),
      base = b ? STYLES.find((s) => s.id === b) : null;
    if (!base || base.legacy) {
      log("style package skipped:", f.dir, `- its base "${f.m.base}" is not a style this app has`);
      continue;
    }
    let name = f.m.name.trim();
    if (!f.official && [...STYLES, ...PACKAGES].some((s) => s.name.toLowerCase() === name.toLowerCase())) name = `${name} (custom)`;
    const file = (...ns) => {
      const n = ns.find((x) => !f.official && isFile(path.join(f.dir, x)));
      return n ? `${serverUrl()}/s/${f.id}/${n}?v=${Math.round(fs.statSync(path.join(f.dir, n)).mtimeMs)}` : null;
    };
    const st = {
      ...base,
      id: f.id,
      name,
      tagline: f.m.tagline || firstSentence(f.m.description) || `A style built on ${base.name}`,
      description: f.m.description || f.m.tagline || "",
      brief: f.m.prompts.brief || `${name} (a style built on ${base.name}): ${f.m.description || f.m.tagline || ""}`.trim(),
      base: base.id,
      legacy: void 0,
      custom: void 0,
      dir: void 0,
      lab: null,
      missing: void 0,
      hidden: void 0,
      imageStyle: f.m.prompts.imageStyle || base.imageStyle,
      aspects: [...f.m.aspects],
      defaultLook: `${f.id}-default`,
      looks: void 0,
      controls: controlsFor(base.controls, f.m.controls, f.m.aspects),
      preview: file("preview.mp4"),
      poster: file("poster.jpg", "preview.jpg"),
      pkg: { id: f.id, dir: f.dir, engineDir: path.join(f.dir, "engine"), official: f.official, declaredBase: f.m.base, manifest: f.m },
    };
    PACKAGES.push(st);
    let looks = [];
    try {
      looks = seedLooks(st, f, base);
    } catch (e) {
      log("style package looks failed:", f.id, e.message);
    }
    if (!looks.length) {
      PACKAGES.splice(PACKAGES.indexOf(st), 1);
      log("style package skipped:", f.dir, "- none of its looks is valid");
      continue;
    }
    const want = f.m.defaultLook ? `${f.id}-${f.m.defaultLook.replace(/^look-/, "")}` : `${f.id}-default`;
    st.defaultLook = looks.includes(want) ? want : looks[0];
    st.looks = looks;
  }
  try {
    q.run(
      `DELETE FROM presets WHERE origin='package' AND style_id NOT IN (${PACKAGES.map(() => "?").join(",") || "''"})
      AND id NOT IN (SELECT preset_id FROM projects WHERE preset_id IS NOT NULL)`,
      ...PACKAGES.map((s) => s.id),
    );
  } catch (e) {
    log("style package looks cleanup failed", e.message);
  }
  try {
    loadStudioLooks();
  } catch (e) {
    log("studio looks failed to load", e.message);
  }
  CARRIED.clear();
  try {
    for (const p of q.all("SELECT path FROM projects WHERE style_id LIKE 'custom-%'")) noteCarried(p.path);
  } catch (e) {
    log("carried styles failed", e.message);
  }
  return PACKAGES;
}
function builtinBaseOfManifest(m) {
  for (const b of [m.base, m.kit?.base, m.from?.style]) {
    if (!b) continue;
    const s = STYLES.find((x) => x.id === b && !x.legacy);
    if (s) return s.id;
    const up = PACKAGES.find((x) => x.id === b);
    if (up?.base) return up.base;
  }
  return null;
}
export function noteCarried(dir) {
  const m = pinnedManifest(dir);
  if (!m || !PKG_ID.test(m.id)) return;
  if (getStyle(m.id).pkg) {
    CARRIED.delete(m.id);
    return;
  }
  const base = builtinBaseOfManifest(m);
  if (base) CARRIED.set(m.id, { name: m.name, base });
}
export function deletePackage(id) {
  const st = getStyle(id);
  if (!st.pkg || st.pkg.official || st.id !== id || !PKG_ID.test(id)) throw new Error("Only your own styles can be deleted.");
  const users = q
    .all("SELECT name FROM projects WHERE style_id=? AND (lab_kind IS NULL OR lab_kind != 'studio')", id)
    .map((r) => `"${r.name}"`);
  if (users.length)
    throw new Error(
      `${users.length === 1 ? "A project uses" : `${users.length} projects use`} this style: ${users.slice(0, 5).join(", ")}${users.length > 5 ? " …" : ""}. Delete ${users.length === 1 ? "it" : "them"} first (Projects).`,
    );
  const dir = path.join(memberRoot(), id);
  if (!inside(memberRoot(), dir)) throw new Error("That style folder is not in your styles folder.");
  fs.rmSync(dir, { recursive: true, force: true });
  q.run("DELETE FROM presets WHERE style_id=? AND origin='package'", id);
  loadPackages();
  log("style package deleted", id);
}
export const studioLooksRoot = () => path.join(memberRoot(), "looks");
export function studioLookPreview(id) {
  if (!LOOK_ID.test(id)) return null;
  const f = path.join(studioLooksRoot(), `${id}.jpg`);
  return isFile(f) ? `${serverUrl()}/s/looks/${id}.jpg?v=${Math.round(fs.statSync(f).mtimeMs)}` : null;
}
export function loadStudioLooks() {
  const root = studioLooksRoot(),
    seen = [];
  if (fs.existsSync(root))
    for (const n of fs
      .readdirSync(root)
      .filter((x) => x.endsWith(".json"))
      .sort()) {
      const f = path.join(root, n);
      if (!isFile(f) || !inside(root, f)) continue;
      const p = parseLook(readJson$c(f));
      if (!p.ok) {
        log("studio look skipped:", f, "-", p.why);
        continue;
      }
      const m = p.m,
        style = String(m.style || ""),
        st = getStyle(style);
      if (n !== `${m.id}.json`) {
        log("studio look skipped:", f, "- its id is not its file name");
        continue;
      }
      if (!style || st.id !== style || st.missing) {
        seen.push(m.id);
        continue;
      }
      const err = validateSettings(m.settings, style);
      if (err) {
        log("studio look skipped:", f, "-", err);
        continue;
      }
      const row = q.get("SELECT * FROM presets WHERE id=?", m.id),
        json = JSON.stringify(m.settings);
      if (row && row.origin !== "studio") {
        log("studio look skipped:", m.id, "- that look id is taken");
        continue;
      }
      if (!row)
        q.run(
          "INSERT INTO presets(id,name,description,settings,builtin,style_id,created_at,updated_at,origin) VALUES(?,?,?,?,1,?,?,?,?)",
          m.id,
          m.name,
          m.description,
          json,
          style,
          now(),
          now(),
          "studio",
        );
      else if (row.name !== m.name || row.description !== m.description || row.settings !== json || row.style_id !== style || !row.builtin)
        q.run(
          "UPDATE presets SET name=?, description=?, settings=?, style_id=?, builtin=1, updated_at=? WHERE id=?",
          m.name,
          m.description,
          json,
          style,
          now(),
          m.id,
        );
      seen.push(m.id);
    }
  try {
    q.run(
      `DELETE FROM presets WHERE origin='studio' AND id NOT IN (${seen.map(() => "?").join(",") || "''"}) AND id NOT IN (SELECT preset_id FROM projects WHERE preset_id IS NOT NULL)`,
      ...seen,
    );
  } catch (e) {
    log("studio looks cleanup failed", e.message);
  }
  return seen;
}
export function deleteStudioLook(id) {
  const row = q.get("SELECT * FROM presets WHERE id=?", id);
  if (!row || row.origin !== "studio" || !LOOK_ID.test(id)) throw new Error("That is not a look made in the Style Studio.");
  for (const ext of ["json", "jpg"]) {
    const f = path.join(studioLooksRoot(), `${id}.${ext}`);
    if (isFile(f) && inside(studioLooksRoot(), f)) fs.rmSync(f, { force: true });
  }
  q.run("UPDATE projects SET preset_id=? WHERE preset_id=?", getStyle(row.style_id).defaultLook, id);
  q.run("DELETE FROM presets WHERE id=?", id);
  log("studio look deleted", id);
}
export function studioLookNotes(presetId) {
  if (!presetId || !LOOK_ID.test(presetId)) return null;
  const row = q.get("SELECT origin FROM presets WHERE id=?", presetId);
  if (row?.origin !== "studio") return null;
  const p = parseLook(readJson$c(path.join(studioLooksRoot(), `${presetId}.json`)));
  if (!p.ok) return null;
  return { name: p.m.name, context: p.m.notes?.context ?? "", qualityBar: p.m.notes?.qualityBar ?? "", pitfalls: p.m.pitfalls ?? [] };
}
const CARRY = ["style.json", "skill", "looks"];
function copyFiles(src, dst) {
  if (!fs.existsSync(src)) return;
  if (isFile(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return;
  }
  if (!fs.lstatSync(src).isDirectory()) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src)) copyFiles(path.join(src, e), path.join(dst, e));
}
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const fileSha = (f) => {
  try {
    return sha1(fs.readFileSync(f));
  } catch {
    return "";
  }
};
export function carryPackage(dir, st) {
  if (!st.pkg) return;
  const d = path.join(dir, ".style-pkg");
  fs.rmSync(d, { recursive: true, force: true });
  for (const n of CARRY) copyFiles(path.join(st.pkg.dir, n), path.join(d, n));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "engine.sha1"), fileSha(path.join(st.pkg.engineDir, "engine.js")) + "\n");
}
const ENGINE_PARTS = ["engine.js", "models.js", "lib", "fonts", "vendor", "sprites", path.join("assets", "figures")];
export function restorePackageFromProject(dir) {
  const pj = readJson$c(path.join(dir, "project.json")),
    id = String(pj?.style || "");
  if (!PKG_ID.test(id) || !getStyle(id).missing) return false;
  const p = parseManifest(readJson$c(path.join(dir, ".style-pkg", "style.json")));
  if (!p.ok || p.m.id !== id || p.m.official) return false;
  if (!isFile(path.join(dir, "engine.js")) || !isFile(path.join(dir, "models.js"))) return false;
  const dst = path.join(memberRoot(), id);
  if (fs.existsSync(dst)) return false;
  fs.mkdirSync(path.join(dst, "engine"), { recursive: true });
  for (const n of CARRY) copyFiles(path.join(dir, ".style-pkg", n), path.join(dst, n));
  for (const n of ENGINE_PARTS) copyFiles(path.join(dir, n), path.join(dst, "engine", n));
  const sj = readJson$c(path.join(dst, "style.json"));
  fs.writeFileSync(path.join(dst, "style.json"), JSON.stringify({ ...sj, restoredFrom: path.basename(dir), updated: now() }, null, 2));
  loadPackages();
  log("style package restored from a project", id, dir);
  return !getStyle(id).missing;
}
export function restoreMissingPackages() {
  let n = 0;
  for (const p of q.all("SELECT path FROM projects WHERE style_id LIKE 'custom-%'")) {
    try {
      if (fs.existsSync(path.join(p.path, ".style-pkg", "style.json")) && restorePackageFromProject(p.path)) n++;
    } catch (e) {
      log("restore style package failed", p.path, e.message);
    }
  }
  return n;
}
const canon = (v) =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v ?? null);
const versionPrint = (m, engineSha) => {
  const { updated: _u, official: _o, ...rest } = m;
  return sha1(`${canon(rest)}|${engineSha}`);
};
export function packageVersions(id) {
  if (!PKG_ID.test(id)) return [];
  const vd = path.join(memberRoot(), id, ".versions");
  if (!fs.existsSync(vd) || !inside(memberRoot(), vd)) return [];
  const out = [];
  for (const n of fs.readdirSync(vd)) {
    const k = /^v(\d+)$/.exec(n);
    if (!k) continue;
    const dir = path.join(vd, n),
      p = parseManifest(readJson$c(path.join(dir, "style.json")));
    if (!p.ok) continue;
    out.push({ version: +k[1], engineVersion: engineVersionOf(path.join(dir, "engine", "engine.js")), dir, m: p.m });
  }
  return out.sort((a, b) => b.version - a.version);
}
export function carriedIsSameStyle(dir, id) {
  const c = pinnedManifest(dir, id),
    local = getStyle(id);
  if (!c || !local.pkg || local.pkg.official || local.id !== id) return true;
  let cSha = "";
  try {
    cSha = fs.readFileSync(path.join(dir, ".style-pkg", "engine.sha1"), "utf8").trim();
  } catch {
    cSha = fileSha(path.join(dir, "engine.js"));
  }
  const mine = versionPrint(c, cSha);
  const cands = [
    { m: local.pkg.manifest, engine: path.join(local.pkg.engineDir, "engine.js") },
    ...packageVersions(id).map((v) => ({ m: v.m, engine: path.join(v.dir, "engine", "engine.js") })),
  ];
  const same = cands.find((k) => k.m.version === c.version);
  if (same) return versionPrint(same.m, fileSha(same.engine)) === mine;
  return !!c.created && c.created === local.pkg.manifest.created;
}
function freeStyleId(id) {
  const head = id.slice(0, 7 + 36);
  for (let n = 2; n < 200; n++) {
    const t = `${head}-${n}`;
    if (PKG_ID.test(t) && !fs.existsSync(path.join(memberRoot(), t)) && !(getStyle(t).id === t && !getStyle(t).missing)) return t;
  }
  return null;
}
export function packageInstallTarget(m, engineSha) {
  const local = getStyle(m.id);
  if (!local.pkg || local.pkg.official || local.id !== m.id) return { id: m.id, update: false, clash: null };
  const mine = versionPrint(m, engineSha);
  const cands = [
    { m: local.pkg.manifest, engine: path.join(local.pkg.engineDir, "engine.js") },
    ...packageVersions(m.id).map((v) => ({ m: v.m, engine: path.join(v.dir, "engine", "engine.js") })),
  ];
  const same =
    cands.some((k) => k.m.version === m.version && versionPrint(k.m, fileSha(k.engine)) === mine) ||
    (m.created ? cands.some((k) => k.m.created === m.created) : m.base === local.pkg.manifest.base);
  if (same) return { id: m.id, update: true, clash: null };
  const clash = { id: m.id, name: local.name };
  const head = m.id.slice(0, 7 + 36);
  if (m.created)
    for (let n = 2; n < 200; n++) {
      const t = `${head}-${n}`,
        st = getStyle(t);
      if (!PKG_ID.test(t) || st.id !== t || !st.pkg || st.pkg.official) continue;
      if (st.pkg.manifest.created === m.created || packageVersions(t).some((v) => v.m.created === m.created))
        return { id: t, update: true, clash };
    }
  const nid = freeStyleId(m.id);
  if (!nid)
    throw new Error(
      `Another style is already installed as "${m.id}" and no free id is left for this one: rename the style in the Style Kit (cz new with another name).`,
    );
  return { id: nid, update: false, clash };
}
export const packageEngineSha = (pkgRoot) => fileSha(path.join(pkgRoot, "engine", "engine.js"));
export function installCarriedAsNew(dir, id) {
  const c = pinnedManifest(dir, id);
  if (!c) return null;
  const nid = freeStyleId(id);
  if (!nid) return null;
  const sj = readJson$c(path.join(dir, ".style-pkg", "style.json"));
  fs.writeFileSync(
    path.join(dir, ".style-pkg", "style.json"),
    JSON.stringify({ ...sj, id: nid, name: `${String(c.name).slice(0, 50)} (shared)`, studio: void 0 }, null, 2) + "\n",
  );
  const ld = path.join(dir, ".style-pkg", "looks");
  if (fs.existsSync(ld))
    for (const n of fs.readdirSync(ld).filter((x) => x.endsWith(".json"))) {
      const j = readJson$c(path.join(ld, n));
      if (j?.style === id) fs.writeFileSync(path.join(ld, n), JSON.stringify({ ...j, style: nid }, null, 2) + "\n");
    }
  const pjf = path.join(dir, "project.json"),
    pj = readJson$c(pjf);
  if (!pj) return null;
  pj.style = nid;
  fs.writeFileSync(pjf, JSON.stringify(pj, null, 1));
  log("style package: a shared project carries a different style with the id", id, "- installed as", nid);
  return restorePackageFromProject(dir) ? nid : null;
}
const KEEP_VERSIONS = 3;
const engineVersionOf = (f) => {
  try {
    const s = fs.readFileSync(f, "utf8"),
      m = /export const ENGINE_VERSION = (\d+)/.exec(s);
    return m ? +m[1] : 0;
  } catch {
    return 0;
  }
};
const NOT_INSTALLED = new Set([".versions", ".publishing", ".git", "node_modules", "out", ".suite"]);
function swapIn(tmp, dst, stage) {
  if (!fs.existsSync(dst)) {
    fs.renameSync(tmp, dst);
    return null;
  }
  const old = path.join(stage, `${path.basename(dst)}-old-${Date.now().toString(36)}`);
  try {
    fs.renameSync(dst, old);
  } catch (e) {
    log("style install: the folder is in use, copying over", e?.message);
    copyFiles(tmp, dst);
    return null;
  }
  try {
    fs.renameSync(tmp, dst);
    return old;
  } catch (e) {
    log("style install: rename failed, copying over", e?.message);
    if (!fs.existsSync(dst)) fs.renameSync(old, dst);
    copyFiles(tmp, dst);
    return null;
  }
}
export function installPackageVersion(src, opts = {}) {
  const p = parseManifest(readJson$c(path.join(src, "style.json")));
  if (!p.ok) throw new Error(`style.json is not valid: ${p.why}`);
  const id = opts.id ?? p.m.id;
  if (!PKG_ID.test(id))
    throw new Error(`"${id}" is not an id for one of your own styles (custom-, then lowercase letters, digits and dashes).`);
  if (STYLES.some((s) => s.id === id)) throw new Error(`"${id}" is a built-in style.`);
  if (!isFile(path.join(src, "engine", "engine.js")) || !isFile(path.join(src, "engine", "models.js")))
    throw new Error("The package has no engine/engine.js or engine/models.js.");
  const root = memberRoot(),
    dst = path.join(root, id),
    stage = path.join(root, ".publishing");
  const pp = parseManifest(readJson$c(path.join(dst, "style.json"))),
    prev = pp.ok ? pp.m : null;
  if (fs.existsSync(dst) && !prev)
    throw new Error(
      `Your styles folder already has a folder "${id}" that is not a style package (an older custom style?). Move it away first.`,
    );
  if (prev?.official) throw new Error(`"${id}" is an official style.`);
  const version = prev ? Math.max(prev.version + 1, p.m.version) : p.m.version;
  const engineV = prev
    ? Math.max(engineVersionOf(path.join(dst, "engine", "engine.js")) + 1, engineVersionOf(path.join(src, "engine", "engine.js")))
    : Math.max(engineVersionOf(path.join(src, "engine", "engine.js")), 1);
  fs.mkdirSync(stage, { recursive: true });
  const tmp = path.join(stage, `${id}-${Date.now().toString(36)}`);
  let old = null;
  try {
    fs.mkdirSync(tmp, { recursive: true });
    for (const e of fs.readdirSync(src)) if (!NOT_INSTALLED.has(e)) copyFiles(path.join(src, e), path.join(tmp, e));
    const ef = path.join(tmp, "engine", "engine.js"),
      es = fs.readFileSync(ef, "utf8");
    fs.writeFileSync(
      ef,
      /export const ENGINE_VERSION = \d+/.test(es)
        ? es.replace(/export const ENGINE_VERSION = \d+/, `export const ENGINE_VERSION = ${engineV}`)
        : `${es.replace(/\s*$/, "")}
export const ENGINE_VERSION = ${engineV};   // (Videoxx: projects of this style get Update when it rises)
`,
    );
    const at = new Date().toISOString(),
      m = { ...p.m, id, version, official: false, aliases: [], created: prev?.created ?? p.m.created ?? at, updated: at };
    if (opts.studio) m.studio = opts.studio;
    else delete m.studio;
    fs.writeFileSync(path.join(tmp, "style.json"), JSON.stringify(m, null, 2) + "\n");
    if (prev) {
      const vd = path.join(tmp, ".versions"),
        keep = path.join(vd, `v${prev.version}`);
      if (fs.existsSync(path.join(dst, ".versions"))) copyFiles(path.join(dst, ".versions"), vd);
      fs.rmSync(keep, { recursive: true, force: true });
      for (const e of fs.readdirSync(dst)) if (e !== ".versions") copyFiles(path.join(dst, e), path.join(keep, e));
      const all = fs
        .readdirSync(vd)
        .map((n) => /^v(\d+)$/.exec(n))
        .filter((x) => !!x)
        .map((x) => +x[1])
        .sort((a, b) => b - a);
      for (const n of all.slice(KEEP_VERSIONS)) fs.rmSync(path.join(vd, `v${n}`), { recursive: true, force: true });
    }
    old = swapIn(tmp, dst, stage);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  loadPackages();
  const st = getStyle(id);
  if (!st.pkg || st.id !== id || st.pkg.manifest.version !== version) {
    if (old && fs.existsSync(old)) {
      const bad = `${old}-failed`;
      try {
        fs.renameSync(dst, bad);
        fs.renameSync(old, dst);
        fs.rmSync(bad, { recursive: true, force: true });
      } catch (e) {
        log("style install: could not put the old version back", e?.message);
      }
      loadPackages();
    }
    throw new Error("The style was copied but does not load (the app log says why). Nothing else changed.");
  }
  if (old) fs.rmSync(old, { recursive: true, force: true });
  try {
    if (!fs.readdirSync(stage).length) fs.rmdirSync(stage);
  } catch {}
  log("style package installed", id, `v${version}`, `engine v${engineV}`, prev ? `(was v${prev.version})` : "(new)");
  return { id, name: st.name, version, engineVersion: engineV, previous: prev?.version ?? null, dir: dst };
}
export function restorePrevious(id, n) {
  const st = getStyle(id);
  if (!PKG_ID.test(id) || !st.pkg || st.pkg.official || st.id !== id) throw new Error("Only your own styles have older versions.");
  const v = packageVersions(id).find((x) => x.version === n);
  if (!v) throw new Error(`Version ${n} of "${st.name}" is not kept any more (the last ${KEEP_VERSIONS} versions are).`);
  return installPackageVersion(v.dir, { id, studio: st.pkg.manifest.studio ?? v.m.studio ?? null });
}
