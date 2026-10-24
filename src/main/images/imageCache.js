import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { getConfig } from "../core/config";
import { log } from "../core/log";
import { now, q } from "../db/db";

let testCache = false;
export const setImageCacheForTest = (on) => {
  testCache = !!on;
  return testCache;
};
export const imageCacheOn = () =>
  process.env.CZ_LIBRARY_OFF !== "1" && !getConfig().library?.off && (process.env.CZ_TEST_HOOKS !== "1" || testCache);
const imageKey = (kind, aspect, fullPrompt) =>
  crypto
    .createHash("sha1")
    .update(`${kind}|${aspect}|${String(fullPrompt).trim()}`)
    .digest("hex")
    .slice(0, 16);
const memo = new Map();
const mtimeOf = (f) => {
  try {
    const s = fs.statSync(f);
    return `${s.size}:${Math.round(s.mtimeMs)}`;
  } catch {
    return "";
  }
};
function assetFile(dir, rel) {
  if (!rel || path.isAbsolute(rel) || /(^|[\\/])\.\.([\\/]|$)/.test(rel)) return null;
  const root = path.resolve(dir, "assets"),
    f = path.resolve(root, rel),
    r = path.relative(root, f);
  return r && !r.startsWith("..") && !path.isAbsolute(r) ? f : null;
}
function readLedger(dir) {
  const f = path.join(dir, "assets", "images.json"),
    sig = mtimeOf(f);
  if (!sig) {
    memo.delete(dir);
    return [];
  }
  const m = memo.get(dir);
  if (m && m.sig === sig) return m.images;
  let j = null;
  try {
    j = JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {}
  const images = [];
  for (const [name, e] of Object.entries(j?.images ?? {})) {
    if (!e || typeof e !== "object" || typeof e.prompt !== "string" || typeof e.file !== "string" || !/^[a-z0-9_-]{1,48}$/.test(name))
      continue;
    images.push({
      name,
      file: e.file,
      prompt: e.prompt,
      kind: String(e.kind ?? ""),
      aspect: String(e.aspect ?? ""),
      ref: e.ref ?? null,
      model: String(e.model ?? ""),
      at: String(e.at ?? ""),
      size: e.size,
      cover: e.cover,
      raw: e.raw,
      matte: e.matte,
      from: e.from,
    });
  }
  memo.set(dir, { sig, images });
  return images;
}
function projectImages() {
  const out = [];
  for (const p of q.all("SELECT id, name, path, style_id, kind FROM projects WHERE kind != 'personal' ORDER BY updated_at DESC")) {
    if (!p.path) continue;
    const images = readLedger(p.path);
    if (images.length) out.push({ projectId: p.id, projectName: p.name, style: p.style_id ?? null, dir: p.path, images });
  }
  return out;
}
export const imagesSig = () =>
  q
    .all("SELECT path FROM projects WHERE kind != 'personal' ORDER BY id")
    .map((p) => `${p.path}:${mtimeOf(path.join(p.path, "assets", "images.json"))}`)
    .join(";");
export function imageEntries() {
  const byKey = new Map();
  for (const p of projectImages())
    for (const e of p.images) {
      if (e.ref) continue;
      const key2 = imageKey(e.kind, e.aspect, e.prompt),
        had = byKey.get(key2);
      if (!had || String(e.at) > String(had.e.at)) byKey.set(key2, { key: key2, p, e });
    }
  return [...byKey.values()];
}
export function imageFileOf(key2) {
  if (!/^[0-9a-f]{16}$/.test(key2)) return null;
  const hit = imageEntries().find((x) => x.key === key2);
  if (!hit) return null;
  const f = assetFile(hit.p.dir, hit.e.file);
  return f && fs.existsSync(f) ? { file: f, ...hit } : null;
}
const samePath = (a, b) => {
  const n = (x) => {
    const r = path.resolve(x);
    return process.platform === "win32" || process.platform === "darwin" ? r.toLowerCase() : r;
  };
  return n(a) === n(b);
};
export function findCachedImage(kind, aspect, fullPrompt, o = {}) {
  const key2 = imageKey(kind, aspect, fullPrompt);
  let best = null;
  for (const p of projectImages())
    for (const e of p.images) {
      if (e.ref || (o.exceptDir && o.exceptName && e.name === o.exceptName && samePath(p.dir, o.exceptDir))) continue;
      if (o.model && e.model !== o.model) continue;
      if (imageKey(e.kind, e.aspect, e.prompt) !== key2) continue;
      const f = assetFile(p.dir, e.file);
      if (!f || !fs.existsSync(f)) continue;
      const raw = e.raw ? path.resolve(p.dir, e.raw) : null,
        rawOk = raw && path.relative(path.join(p.dir, ".suite", "raw"), raw).split(path.sep)[0] !== ".." && fs.existsSync(raw) ? raw : null;
      if (!best || String(e.at) > String(best.e.at)) best = { key: key2, file: f, raw: rawOk, p, e };
    }
  return best;
}
export function projectIdOfDir(dir) {
  for (const p of q.all("SELECT id, path FROM projects")) if (p.path && samePath(p.path, dir)) return p.id;
  return null;
}
export function logImageUse(key2, projectId, note) {
  try {
    q.run(
      "INSERT INTO lib_uses(entry_id, version, project_id, edit_id, kind, outcome, note, at) VALUES(?,?,?,?,?,?,?,?)",
      `img:${key2}`,
      null,
      projectId,
      null,
      "use",
      null,
      note.slice(0, 1e3),
      now(),
    );
  } catch (e) {
    log("library: image use not logged", e?.message);
  }
}
