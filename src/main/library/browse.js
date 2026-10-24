import path from "node:path";
import fs from "node:fs";
import { app, shell } from "electron";
import { log } from "../core/log";
import { q } from "../db/db";
import { charDir } from "../characters/characterLab";
import { lowpolyDirs, lowpolyIndex } from "../characters/lowpoly";
import { libraryFigures } from "../characters/libraryFigures";
import { imageFileOf } from "../images/imageCache";
import { libRoot } from "../characters/sprites";
import { sfxEntry } from "../audio/sfx";
import { LIB_ID_RX, LIB_TABS, STATUS_WEIGHT, isFedId } from "./schema";
import { libraryFts, rebuildIndex } from "./index";
import { engineRangeText, getRow, libraryEntry, outcomesOf, relevanceOf } from "./search";
import { entryDirFor, fileIn, filesOf, findStoreEntry, readEntryAt, seedRoot, trashWsEntry, versionDir, wsLibRoot } from "./store";
import { insideDir } from "../agent/sessions";
import { serverUrl } from "../projects/fileServer";

const IMG = /\.(png|jpe?g|webp|svg|gif)$/i;
const TEXT = /\.(m?js|json|md|txt|glsl|frag|vert|css|html?|svg|csv|py)$/i;
const own = (source) => source === "seed" || source === "ws";
const basesOf = (r) =>
  String(r.bases || "")
    .split(/\s+/)
    .filter(Boolean);
function thumbOf(r) {
  const u = (v) => `${serverUrl()}/lib/${encodeURIComponent(r.id)}/preview${v ? `?v=${encodeURIComponent(String(v).slice(0, 24))}` : ""}`;
  if (own(r.source)) return r.preview || r.kind === "texture" || r.kind === "image" || r.kind === "sprite" ? u(r.hash ?? r.updated) : null;
  if (r.source === "char" || r.source === "sprite") return u(r.updated);
  if (r.source === "lowpoly") return r.kind === "texture" ? u() : null;
  if (r.source === "img") return u(r.hash);
  return null;
}
export function browseLibrary(o = {}) {
  const query = String(o.query ?? "")
    .trim()
    .slice(0, 200);
  const rel = query ? relevanceOf(query) : null;
  let all = q.all(
    "SELECT id, kind, source, title, summary, tags, bases, scope, status, version, preview, licence, hash, updated, created FROM lib_entries",
  );
  if (rel) all = all.filter((r) => rel.has(r.id));
  const tabCount = { assets: 0, scenes: 0, knowhow: 0 };
  for (const r of all)
    if (r.status !== "retired") {
      for (const t of Object.keys(LIB_TABS)) if (LIB_TABS[t].includes(r.kind)) tabCount[t]++;
    }
  const tabKinds = o.tab && LIB_TABS[o.tab] ? LIB_TABS[o.tab] : null;
  if (tabKinds) all = all.filter((r) => tabKinds.includes(r.kind));
  const f = { kind: o.kind || null, base: o.base || null, scope: o.scope || null, status: o.status || null, source: o.source || null };
  const pass = (r, skip) =>
    (skip === "kind" || !f.kind || r.kind === f.kind) &&
    (skip === "base" || !f.base || basesOf(r).includes(f.base)) &&
    (skip === "scope" || !f.scope || r.scope === f.scope) &&
    (skip === "source" || !f.source || r.source === f.source) &&
    (skip === "status" ? true : f.status ? r.status === f.status : r.status !== "retired");
  const counts = { kind: {}, base: {}, scope: {}, status: {}, source: {} };
  for (const r of all)
    for (const k of Object.keys(f)) {
      if (!pass(r, k)) continue;
      const vals = k === "base" ? basesOf(r) : [r[k]];
      for (const v of vals) counts[k][v] = (counts[k][v] ?? 0) + 1;
    }
  const rows = all.filter((r) => pass(r, null));
  const SRC = { ws: 0, seed: 1 },
    KO = [
      "recipe",
      "look",
      "module",
      "material",
      "texture",
      "model",
      "image",
      "sprite",
      "anim",
      "pose",
      "font",
      "sound",
      "solution",
      "pitfall",
      "check",
    ];
  const ko = (k) => {
    const i = KO.indexOf(k);
    return i < 0 ? 99 : i;
  };
  if (rel)
    rows.sort(
      (a, b) =>
        rel.get(b.id) * (STATUS_WEIGHT[b.status] || 0.3) - rel.get(a.id) * (STATUS_WEIGHT[a.status] || 0.3) || (a.id < b.id ? -1 : 1),
    );
  else
    rows.sort(
      (a, b) =>
        (SRC[a.source] ?? 2) - (SRC[b.source] ?? 2) ||
        ko(a.kind) - ko(b.kind) ||
        String(b.updated ?? "").localeCompare(String(a.updated ?? "")) ||
        a.title.localeCompare(b.title),
    );
  const off = Math.max(0, +(o.offset ?? 0) || 0),
    lim = Math.max(1, Math.min(500, +(o.limit ?? 120) || 120));
  const page = rows.slice(off, off + lim),
    outs = outcomesOf(page.map((r) => r.id));
  const proposed = q.get("SELECT count(*) n FROM lib_entries WHERE status='proposed'").n;
  return {
    rows: page.map((r) => {
      const u = outs.get(r.id) ?? { wins: 0, fails: 0, uses: 0 };
      return { ...r, bases: basesOf(r), thumb: thumbOf(r), uses: u.uses, wins: u.wins, fails: u.fails };
    }),
    total: rows.length,
    counts,
    tabs: tabCount,
    proposed,
    fts: libraryFts(),
    dev: devBuild(),
  };
}
export const proposedCount = () => {
  try {
    return q.get("SELECT count(*) n FROM lib_entries WHERE status='proposed'").n;
  } catch {
    return 0;
  }
};
export function libraryDetail(id) {
  const d = libraryEntry(id),
    row = d.row;
  const relIds = [...new Set([...(d.entry?.related ?? []), ...(d.entry?.requires ?? []), ...d.links.map((l) => (l.a === id ? l.b : l.a))])]
    .filter((x) => x !== id)
    .slice(0, 40);
  const related = relIds.map((x) => {
    const r = getRow(x);
    return r
      ? { id: x, title: r.title, kind: r.kind, status: r.status, exists: true }
      : { id: x, title: x, kind: null, status: null, exists: false };
  });
  let fed = null;
  if (isFedId(id)) {
    const rest = id.slice(id.indexOf(":") + 1);
    if (row.source === "lowpoly") {
      const e = lowpolyIndex().entries.find((x) => x.id === rest);
      if (e)
        fed = {
          file: e.file,
          licence: e.licence,
          author: e.author,
          credit: e.credit_text,
          source_url: e.source_url,
          facts: [
            e.kind,
            e.size_m ? `${e.size_m.map((v) => +(+v).toFixed(2)).join(" x ")} m` : "",
            e.poly_count ? `${e.poly_count} polygons` : "",
            e.animations?.length
              ? `clips: ${e.animations
                  .map((a) => a.name)
                  .slice(0, 14)
                  .join(", ")}${e.animations.length > 14 ? "…" : ""}`
              : "",
            e.pack ? `pack ${e.pack}` : "",
          ].filter(Boolean),
        };
    } else if (row.source === "sfx") {
      const e = sfxEntry(rest);
      if (e)
        fed = {
          file: path.basename(e.path),
          licence: e.licence,
          author: e.author,
          credit: e.credit_text,
          source_url: e.source_url,
          facts: [e.category, `${(+e.duration || 0).toFixed(1)} s`, e.user ? "yours" : "built in"].filter(Boolean),
        };
    } else if (row.source === "fig") {
      const f = libraryFigures().find((x) => x.id === rest);
      if (f)
        fed = {
          file: path.basename(f.file),
          licence: f.license,
          author: f.author,
          credit: null,
          source_url: f.url,
          facts: [`${f.clips} animation clip${f.clips === 1 ? "" : "s"}`, f.from],
        };
    } else if (row.source === "sprite") {
      let poses = [];
      try {
        poses = Object.keys(JSON.parse(fs.readFileSync(path.join(libRoot(), "index.json"), "utf8"))?.[rest]?.sprites ?? {});
      } catch {}
      fed = { facts: poses.length ? [`poses: ${poses.slice(0, 20).join(", ")}${poses.length > 20 ? "…" : ""}`] : [] };
    } else if (row.source === "img") {
      const h = imageFileOf(rest);
      fed = h
        ? {
            file: h.e.file,
            facts: [
              `made for "${h.p.projectName}" as IMG.${h.e.name}`,
              `${h.e.kind}, ${h.e.aspect}${h.e.size ? `, ${h.e.size.join(" x ")} px` : ""}`,
              `prompt: ${h.e.prompt.slice(0, 400)}${h.e.prompt.length > 400 ? "…" : ""}`,
            ],
          }
        : { facts: [] };
    } else fed = { facts: [] };
  }
  const engines = row.engines
    ? basesOf(row)
        .filter((b) => b !== "any")
        .map((b) => engineRangeText(row.engines, b))
        .filter((x, i, a) => a.indexOf(x) === i)
    : [];
  return {
    ...d,
    related,
    fed,
    engines,
    thumb: thumbOf(row),
    fileBase: `${serverUrl()}/lib/${encodeURIComponent(id)}/file/`,
    editable: row.source === "ws",
    dev: devBuild(),
    canReveal: !!revealTarget(id),
  };
}
export function previewFile(id) {
  try {
    if (LIB_ID_RX.test(id)) {
      const rec = findStoreEntry(id);
      if (!rec) return null;
      if (rec.entry.preview) {
        const f = fileIn(rec.dir, rec.entry.preview);
        if (f && fs.existsSync(f)) return f;
      }
      const vd = versionDir(rec);
      if (!vd) return null;
      const pic = filesOf(vd, 60).find((f) => IMG.test(f));
      return pic ? fileIn(vd, pic) : null;
    }
    if (!isFedId(id)) return null;
    const pre = id.slice(0, id.indexOf(":")),
      rest = id.slice(id.indexOf(":") + 1);
    if (pre === "char") {
      const d = charDir(rest);
      const f = d ? path.join(d, "thumb.png") : null;
      return f && fs.existsSync(f) ? f : null;
    }
    if (pre === "sprite") {
      if (!/^[\w.-]{1,100}$/.test(rest)) return null;
      const s = JSON.parse(fs.readFileSync(path.join(libRoot(), "index.json"), "utf8"))?.[rest]?.sprites ?? {};
      const first = s.stand ?? Object.values(s)[0];
      if (!first?.file) return null;
      const root = path.join(libRoot(), rest),
        f = path.resolve(root, String(first.file));
      return insideDir(root, f) && fs.existsSync(f) ? f : null;
    }
    if (pre === "lp") {
      const e = lowpolyIndex().entries.find((x) => x.id === rest);
      if (!e?.file || !IMG.test(e.file)) return null;
      for (const root of [lowpolyDirs().user, lowpolyDirs().seed]) {
        const f = path.resolve(root, String(e.file));
        if (insideDir(root, f) && fs.existsSync(f)) return f;
      }
    }
    if (pre === "img") {
      const h = imageFileOf(rest);
      return h && IMG.test(h.file) ? h.file : null;
    }
  } catch (e) {
    log("library: preview", id, e?.message);
  }
  return null;
}
export function entryImage(id, rel) {
  if (!LIB_ID_RX.test(id) || !IMG.test(rel)) return null;
  const rec = findStoreEntry(id),
    vd = rec ? versionDir(rec) : null,
    f = vd ? fileIn(vd, rel) : null;
  return f && fs.existsSync(f) ? f : null;
}
export function entryFileText(id, rel) {
  if (!LIB_ID_RX.test(id)) throw new Error("Only the Library's own entries have files to read here.");
  const rec = findStoreEntry(id),
    vd = rec ? versionDir(rec) : null,
    f = vd ? fileIn(vd, String(rel)) : null;
  if (!f || !fs.existsSync(f)) throw new Error(`${rel} is not a file of ${id}`);
  if (!TEXT.test(f)) throw new Error("Not a text file");
  const st = fs.statSync(f),
    max = 3e5,
    buf = Buffer.alloc(Math.min(st.size, max));
  const fd = fs.openSync(f, "r");
  try {
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return { text: buf.toString("utf8"), bytes: st.size, truncated: st.size > max };
}
function revealTarget(id) {
  if (LIB_ID_RX.test(id)) {
    const rec = findStoreEntry(id);
    return rec ? path.join(rec.dir, "entry.json") : null;
  }
  const row = getRow(id);
  if (!row) return null;
  const rest = id.slice(id.indexOf(":") + 1);
  if (row.source === "lowpoly") {
    const e = lowpolyIndex().entries.find((x) => x.id === rest);
    if (!e?.file) return null;
    for (const root of [lowpolyDirs().user, lowpolyDirs().seed]) {
      const f = path.resolve(root, String(e.file));
      if (insideDir(root, f) && fs.existsSync(f)) return f;
    }
    return null;
  }
  if (row.source === "sfx") return sfxEntry(rest)?.path ?? null;
  if (row.source === "fig") return libraryFigures().find((x) => x.id === rest)?.file ?? null;
  if (row.source === "char") {
    const d = charDir(rest);
    return d && rest !== "mo" ? path.join(d, "character.js") : null;
  }
  if (row.source === "img") return imageFileOf(rest)?.file ?? null;
  return row.dir && fs.existsSync(row.dir) ? row.dir : null;
}
export function revealEntry(id) {
  const t = revealTarget(String(id));
  if (!t) throw new Error("That entry has no file on this computer to show.");
  shell.showItemInFolder(t);
  return t;
}
const trashRoot = () => path.join(wsLibRoot(), ".trash");
export function deleteEntry(id) {
  const to = trashWsEntry(String(id));
  rebuildIndex();
  return { trashed: to, name: path.basename(to) };
}
export function restoreEntry(name) {
  const m = /^(.+)-[0-9a-z]{6,12}$/.exec(String(name));
  if (!m || !LIB_ID_RX.test(m[1])) throw new Error("Not a deleted library entry");
  const from = path.join(trashRoot(), String(name)),
    to = entryDirFor(m[1], "ws");
  if (!insideDir(trashRoot(), from) || !fs.existsSync(from)) throw new Error("That entry is not in the library's deleted items any more");
  if (fs.existsSync(to)) throw new Error(`${m[1]} exists again: restore did nothing`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  rebuildIndex();
  return { id: m[1] };
}
export function trashInfo() {
  let n = 0;
  try {
    n = fs.readdirSync(trashRoot(), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch {}
  return { count: n, dir: trashRoot() };
}
export async function emptyTrash() {
  let n = 0;
  const root = trashRoot();
  for (const d of fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []) {
    const f = path.join(root, d.name);
    if (!insideDir(root, f)) continue;
    try {
      await shell.trashItem(f);
      n++;
    } catch (e) {
      log("library: trashItem failed", f, e?.message);
    }
  }
  return { moved: n, ...trashInfo() };
}
function devBuild() {
  try {
    return !app.isPackaged;
  } catch {
    return false;
  }
}
const shipRoot = () =>
  process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_LIBRARY_SHIP_DIR ? path.resolve(process.env.CZ_LIBRARY_SHIP_DIR) : seedRoot();
export function shipEntry(id) {
  if (!devBuild()) throw new Error("Ship with the app works only in a build run from the source code.");
  const src = entryDirFor(String(id), "ws"),
    r = readEntryAt(src, "ws");
  if (!r.rec) throw new Error(fs.existsSync(src) ? `${id}: ${r.error}` : `${id} is not one of your entries`);
  if (r.rec.entry.status === "proposed" || r.rec.entry.status === "flagged" || r.rec.entry.status === "retired")
    throw new Error(`Accept it first: a ${r.rec.entry.status} entry does not ship.`);
  const root = shipRoot(),
    kind = r.rec.entry.kind,
    dst = path.join(root, kind, r.rec.entry.id);
  if (!insideDir(root, dst)) throw new Error("library path escapes its folder");
  if (fs.existsSync(dst))
    throw new Error(`${id} is built in already: give the new one another name, or change the built-in one in the source.`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  const trashed = trashWsEntry(r.rec.entry.id);
  rebuildIndex();
  log("library: shipped", id, "->", dst);
  return { to: dst, trashed: path.basename(trashed) };
}
