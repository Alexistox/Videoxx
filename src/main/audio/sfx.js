import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import { getConfig } from "../core/config";
import { templatesDir, ws } from "../core/workspace";
import { log } from "../core/log";
import { run } from "../pipeline/steps";

export const SFX_EXT = ["wav", "mp3", "ogg", "flac", "m4a", "aac", "opus"];
const AUDIO_RE = new RegExp(`\\.(${SFX_EXT.join("|")})$`, "i");
export const sfxDirs = () => ({
  builtin: path.join(templatesDir(), "lowpoly", "library", "sfx"),
  user: path.join(ws.root(), "assets", "sfx"),
});
const readEntries = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")).entries || [];
  } catch {
    return [];
  }
};
export const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
const STOP = new Set([
  "wav",
  "mp3",
  "ogg",
  "sfx",
  "fx",
  "sound",
  "sounds",
  "the",
  "and",
  "of",
  "a",
  "an",
  "in",
  "on",
  "final",
  "mix",
  "stereo",
  "mono",
  "master",
  "take",
  "edit",
  "version",
  "copy",
  "new",
  "old",
  "khz",
  "bit",
  "clip",
]);
function tagsFrom(name) {
  const words = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return [...new Set(words.filter((w) => w.length > 1 && !/^\d+$/.test(w) && !/^v\d+$/.test(w) && !STOP.has(w)))].slice(0, 12);
}
export async function analyse(file) {
  try {
    const r = await run(
      getConfig().tools.ffmpeg,
      ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"],
      os.tmpdir(),
    );
    const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.out),
      dur = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
    const I = [...r.out.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop(),
      P = [...r.out.matchAll(/Peak:\s+(-?[\d.]+|-inf) dBFS/g)].pop();
    let lufs = I ? +I[1] : null;
    if (lufs == null || lufs <= -69) lufs = P && P[1] !== "-inf" ? +(+P[1] - 10).toFixed(1) : null;
    const t = [...r.out.matchAll(/t:\s+([\d.]+)/g)].pop();
    return { duration: +(dur || (t ? +t[1] : 0)).toFixed(3), lufs };
  } catch (e) {
    log("sfx analyse failed", file, e?.message);
    return { duration: 0, lufs: null };
  }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}
let writing = 0;
function save(entries) {
  const { user } = sfxDirs();
  fs.mkdirSync(user, { recursive: true });
  const body = JSON.stringify(
    {
      version: 1,
      user: true,
      about: "Your own sound effects (Videoxx: Settings > Media > Sound effects library). Files are copies; edit tags in the app.",
      entries,
    },
    null,
    1,
  );
  const f = path.join(user, "index.json");
  try {
    if (fs.readFileSync(f, "utf8") === body) return;
  } catch {}
  writing = Date.now();
  fs.writeFileSync(f, body);
}
const userEntries = () => readEntries(sfxDirs().user).map((e) => ({ ...e, user: true }));
export function sfxList() {
  try {
    fs.mkdirSync(sfxDirs().user, { recursive: true });
  } catch {}
  const mine = userEntries().sort((a, b) => (b.added ?? 0) - (a.added ?? 0)),
    built = readEntries(sfxDirs().builtin).map((e) => ({ ...e, user: false }));
  const cats = [...new Set([...mine, ...built].map((e) => e.category))].sort();
  return { user: mine, builtin: built, categories: cats, dir: sfxDirs().user };
}
const fileOf = (e) => path.join(e.user ? sfxDirs().user : sfxDirs().builtin, e.file);
export function sfxEntry(id) {
  const e = [...userEntries(), ...readEntries(sfxDirs().builtin).map((x) => ({ ...x, user: false }))].find((x) => x.id === id);
  if (!e) return null;
  const p = fileOf(e),
    root = e.user ? sfxDirs().user : sfxDirs().builtin;
  return path.resolve(p).startsWith(path.resolve(root) + path.sep) && fs.existsSync(p) ? { ...e, path: p } : null;
}
function sidecar(file) {
  for (const f of [file + ".json", file.replace(/\.[^.\\/]+$/, "") + ".json"])
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {}
  return null;
}
const sameFile = (a, b) => {
  try {
    const x = fs.statSync(a),
      y = fs.statSync(b);
    if (x.size !== y.size) return false;
    const h = (p) => crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");
    return h(a) === h(b);
  } catch {
    return false;
  }
};
async function addOne(src, category, extraTags, entries) {
  const ext = path.extname(src).slice(1).toLowerCase();
  if (!SFX_EXT.includes(ext)) return "skipped";
  const side = sidecar(src) ?? {},
    cat = slug(side.category || category) || "misc",
    base = slug(path.basename(src, path.extname(src))) || "sound";
  const dir = path.join(sfxDirs().user, cat);
  fs.mkdirSync(dir, { recursive: true });
  let name = base,
    k = 1;
  while (fs.existsSync(path.join(dir, `${name}.${ext}`))) {
    if (sameFile(src, path.join(dir, `${name}.${ext}`))) return "same";
    name = `${base}_${++k}`;
  }
  const rel = `${cat}/${name}.${ext}`;
  fs.copyFileSync(src, path.join(sfxDirs().user, rel));
  const a = await analyse(path.join(sfxDirs().user, rel));
  const tags = [
    ...new Set(
      [...(Array.isArray(side.tags) ? side.tags.map((t) => slug(String(t))) : []), ...tagsFrom(path.basename(src)), ...extraTags].filter(
        Boolean,
      ),
    ),
  ].slice(0, 16);
  entries.push({
    id: `user.${cat}.${name}`,
    category: cat,
    tags,
    file: rel,
    duration: a.duration,
    lufs: a.lufs,
    name: path.basename(src).slice(0, 120),
    user: true,
    added: Date.now(),
    ...(side.author ? { author: String(side.author).slice(0, 200) } : {}),
    ...(side.licence || side.license ? { licence: String(side.licence || side.license).slice(0, 80) } : {}),
    ...(side.source_url ? { source_url: String(side.source_url).slice(0, 400) } : {}),
    ...(side.credit || side.credit_text ? { credit_text: String(side.credit || side.credit_text).slice(0, 300) } : {}),
  });
  return "added";
}
export async function importFolder(src) {
  const files = [],
    rootCat = slug(path.basename(src)) || "misc";
  const walk = (d, depth, rel) => {
    if (depth > 6 || files.length > 5e3) return;
    let items = [];
    try {
      items = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (it.name.startsWith(".")) continue;
      const p = path.join(d, it.name);
      if (it.isDirectory()) walk(p, depth + 1, [...rel, it.name]);
      else if (AUDIO_RE.test(it.name)) files.push({ f: p, cat: rel[0] ? slug(rel[0]) : rootCat, tags: rel.slice(1).flatMap(tagsFrom) });
    }
  };
  walk(src, 0, []);
  return importMany(files);
}
export async function importFiles(paths, category) {
  return importMany(
    paths
      .filter((p) => AUDIO_RE.test(p) && fs.existsSync(p))
      .map((f) => ({ f, cat: slug(category || "") || slug(path.basename(path.dirname(f))) || "misc", tags: [] })),
  );
}
async function importMany(files) {
  const entries = userEntries();
  let added = 0,
    same = 0;
  for (const x of files) {
    const r = await addOne(x.f, x.cat, x.tags, entries);
    if (r === "added") added++;
    else if (r === "same") same++;
  }
  save(entries);
  return { added, same, total: entries.length, ...sfxList() };
}
export async function rescan() {
  const { user } = sfxDirs();
  if (!fs.existsSync(user)) return sfxList();
  const entries = userEntries().filter((e) => fs.existsSync(path.join(user, e.file))),
    known = new Set(entries.map((e) => e.file.replace(/\\/g, "/")));
  const found = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    let it = [];
    try {
      it = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const x of it) {
      const p = path.join(d, x.name);
      if (x.isDirectory()) walk(p, depth + 1);
      else if (AUDIO_RE.test(x.name)) found.push(path.relative(user, p).replace(/\\/g, "/"));
    }
  };
  walk(user, 0);
  const fresh = found.filter((f) => !known.has(f));
  await pool(fresh, 4, async (rel) => {
    const a = await analyse(path.join(user, rel)),
      cat = rel.includes("/") ? slug(rel.split("/")[0]) : "misc",
      name = slug(path.basename(rel, path.extname(rel)));
    let id = `user.${cat}.${name}`;
    while (entries.some((e) => e.id === id)) id += "_";
    entries.push({
      id,
      category: cat,
      tags: tagsFrom(path.basename(rel)),
      file: rel,
      duration: a.duration,
      lufs: a.lufs,
      name: path.basename(rel),
      user: true,
      added: Date.now(),
    });
  });
  save(entries);
  return sfxList();
}
export function updateEntry(id, patch) {
  const entries = userEntries(),
    e = entries.find((x) => x.id === id);
  if (!e) throw new Error("That sound is not in your library.");
  if (Array.isArray(patch.tags)) e.tags = [...new Set(patch.tags.map((t) => slug(String(t))).filter(Boolean))].slice(0, 16);
  if (typeof patch.name === "string" && patch.name.trim()) e.name = patch.name.trim().slice(0, 120);
  if (typeof patch.category === "string" && slug(patch.category) && slug(patch.category) !== e.category) {
    const cat = slug(patch.category),
      { user } = sfxDirs(),
      base = path.basename(e.file);
    fs.mkdirSync(path.join(user, cat), { recursive: true });
    let to = `${cat}/${base}`,
      k = 1;
    while (fs.existsSync(path.join(user, to))) to = `${cat}/${path.basename(base, path.extname(base))}_${++k}${path.extname(base)}`;
    fs.renameSync(path.join(user, e.file), path.join(user, to));
    e.file = to;
    e.category = cat;
  }
  save(entries);
  return sfxList();
}
export function removeEntry(id) {
  const entries = userEntries(),
    e = entries.find((x) => x.id === id);
  if (!e) throw new Error("That sound is not in your library.");
  try {
    fs.rmSync(path.join(sfxDirs().user, e.file), { force: true });
  } catch {}
  save(entries.filter((x) => x.id !== id));
  return sfxList();
}
const MIME = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/ogg",
};
export function sfxAudio(id) {
  const e = sfxEntry(id);
  if (!e) throw new Error("That sound is not in the library any more.");
  return { bytes: fs.readFileSync(e.path), mime: MIME[path.extname(e.path).slice(1).toLowerCase()] ?? "audio/wav" };
}
export function sfxLibArgs() {
  const { user, builtin } = sfxDirs();
  return [...(fs.existsSync(path.join(user, "index.json")) && userEntries().length ? ["--sfx-lib", user] : []), "--sfx-lib", builtin];
}
let watcher = null,
  timer = null,
  watching = "";
export function watchSfx(onChange) {
  const { user } = sfxDirs();
  if (watching === user && watcher) return;
  watcher?.close();
  watcher = null;
  watching = user;
  try {
    fs.mkdirSync(user, { recursive: true });
  } catch {
    return;
  }
  try {
    watcher = fs.watch(user, { recursive: true }, (_ev, f) => {
      if (!f || /index\.json$/.test(String(f)) || Date.now() - writing < 1500) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        rescan().then(onChange, (e) => log("sfx rescan failed", e?.message));
      }, 1500);
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch (e) {
    log("sfx watch failed", e?.message);
  }
}
