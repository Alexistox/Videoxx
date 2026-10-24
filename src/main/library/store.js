import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { templatesDir, ws } from "../core/workspace";
import { LIB_ID_RX, LIB_KINDS, LibEntrySchema } from "./schema";
import { stripJs } from "../studio/runChecks";
import { insideDir } from "../agent/sessions";

export const seedRoot = () =>
  process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_LIBRARY_SEED
    ? path.resolve(process.env.CZ_LIBRARY_SEED)
    : path.join(templatesDir(), "library");
export const wsLibRoot = () => path.join(ws.root(), "library");
const rootOf = (o) => (o === "seed" ? seedRoot() : wsLibRoot());
export function assertId(id) {
  if (typeof id !== "string" || !LIB_ID_RX.test(id))
    throw new Error(`"${String(id).slice(0, 80)}" is not a library id (<kind>.<base>.<name>, e.g. module.recon.glow-person)`);
}
export function entryDirFor(id, origin) {
  assertId(id);
  const root = rootOf(origin),
    d = path.join(root, id.split(".")[0], id);
  if (!insideDir(root, d)) throw new Error("library path escapes its folder");
  return d;
}
export function fileIn(dir, rel) {
  if (!rel || /(^|[\\/])\.\.([\\/]|$)/.test(rel) || path.isAbsolute(rel)) return null;
  const f = path.resolve(dir, rel);
  return insideDir(dir, f) ? f : null;
}
export const versionDir = (rec, v = rec.entry.version) => fileIn(rec.dir, `v${v}`);
const readJson$b = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
export function readEntryAt(dir, origin) {
  let raw;
  try {
    raw = readJson$b(path.join(dir, "entry.json"));
  } catch (e) {
    return { error: `entry.json unreadable: ${e?.message || e}` };
  }
  const r = LibEntrySchema.safeParse(raw);
  if (!r.success)
    return {
      error: r.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  if (r.data.id !== path.basename(dir)) return { error: `id ${r.data.id} is not its folder name ${path.basename(dir)}` };
  if (r.data.kind !== path.basename(path.dirname(dir)))
    return { error: `kind ${r.data.kind} is not its folder ${path.basename(path.dirname(dir))}` };
  return { rec: { entry: { ...r.data, origin }, dir, origin } };
}
export function scanStore(origin) {
  const root = rootOf(origin),
    recs = [],
    errors = [];
  for (const kind of LIB_KINDS) {
    let ids = [];
    try {
      ids = fs.readdirSync(path.join(root, kind), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of ids) {
      if (!d.isDirectory() || !LIB_ID_RX.test(d.name) || !d.name.startsWith(kind + ".")) continue;
      const dir = path.join(root, kind, d.name);
      if (!fs.existsSync(path.join(dir, "entry.json"))) continue;
      const r = readEntryAt(dir, origin);
      if (r.rec) recs.push(r.rec);
      else errors.push({ dir, error: r.error });
    }
  }
  return { recs, errors };
}
export function storeSig(origin) {
  const h = crypto.createHash("sha1"),
    root = rootOf(origin);
  let n = 0;
  const walk = (d, depth) => {
    let es = [];
    try {
      es = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (++n > 5e4 || e.name === ".trash" || e.name === ".incoming") continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 5) walk(f, depth + 1);
      } else {
        try {
          const s = fs.statSync(f);
          h.update(`${path.relative(root, f)}|${s.size}|${Math.round(s.mtimeMs)}
`);
        } catch {}
      }
    }
  };
  walk(root, 0);
  return h.digest("hex");
}
export function findStoreEntry(id) {
  if (!LIB_ID_RX.test(id)) return null;
  for (const o of ["ws", "seed"]) {
    const d = entryDirFor(id, o);
    if (fs.existsSync(path.join(d, "entry.json"))) {
      const r = readEntryAt(d, o);
      if (r.rec) return r.rec;
    }
  }
  return null;
}
export function seedRefDir(id) {
  if (!LIB_ID_RX.test(id)) return null;
  const d = entryDirFor(id, "seed"),
    r = fs.existsSync(path.join(d, "entry.json")) ? readEntryAt(d, "seed") : null;
  return r?.rec?.entry.delivery === "ref" ? d : null;
}
export function filesOf(dir, max = 400) {
  const out = [];
  const walk = (d, rel) => {
    let es = [];
    try {
      es = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es) {
      if (out.length >= max) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}
export const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
export function hashDir(dir) {
  const h = crypto.createHash("sha1");
  for (const r of filesOf(dir)) {
    h.update(r + "\0");
    try {
      h.update(fs.readFileSync(path.join(dir, r)));
    } catch {}
    h.update("\0");
  }
  return h.digest("hex");
}
export const codeHash = (src) => sha1(stripJs(src, true).replace(/\s+/g, "")).slice(0, 20);
export function entryCodeHash(rec) {
  if (!rec.entry.entry || !/\.m?js$/i.test(rec.entry.entry)) return null;
  const vd = versionDir(rec),
    f = vd ? fileIn(vd, rec.entry.entry) : null;
  try {
    return f ? codeHash(fs.readFileSync(f, "utf8")) : null;
  } catch {
    return null;
  }
}
const nowIso = () => new Date().toISOString();
function writeEntryJson(dir, entry) {
  const { origin: _o, ...data } = entry;
  fs.writeFileSync(path.join(dir, "entry.json"), JSON.stringify(data, null, 1) + "\n");
}
export function writeWsEntry(entry, files, preview) {
  const dir = entryDirFor(entry.id, "ws"),
    vd = fileIn(dir, `v${entry.version}`);
  if (!vd) throw new Error("bad version folder");
  if (fs.existsSync(vd)) throw new Error(`${entry.id} v${entry.version} already exists (version folders never change)`);
  fs.mkdirSync(vd, { recursive: true });
  for (const f of files) {
    const t = fileIn(vd, f.rel);
    if (!t) throw new Error(`bad file path ${f.rel}`);
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, f.buf);
  }
  if (preview) {
    fs.writeFileSync(path.join(dir, "preview.jpg"), preview);
    entry.preview = "preview.jpg";
  }
  entry.created ??= nowIso();
  entry.updated = nowIso();
  writeEntryJson(dir, entry);
  return dir;
}
export function patchWsEntry(id, mutate) {
  const dir = entryDirFor(id, "ws"),
    r = readEntryAt(dir, "ws");
  if (!r.rec) throw new Error(fs.existsSync(dir) ? `${id}: ${r.error}` : `${id} is not in your library (built-in entries are read-only)`);
  mutate(r.rec.entry);
  r.rec.entry.updated = nowIso();
  const ok = LibEntrySchema.safeParse(r.rec.entry);
  if (!ok.success)
    throw new Error(
      ok.error.issues
        .slice(0, 2)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  writeEntryJson(dir, ok.data);
  return { ...r.rec, entry: ok.data };
}
export function trashWsEntry(id) {
  const dir = entryDirFor(id, "ws");
  if (!fs.existsSync(dir)) throw new Error(`${id} is not in your library (built-in entries can't be deleted)`);
  const t = path.join(wsLibRoot(), ".trash");
  fs.mkdirSync(t, { recursive: true });
  const to = path.join(t, `${id}-${Date.now().toString(36)}`);
  fs.renameSync(dir, to);
  return to;
}
