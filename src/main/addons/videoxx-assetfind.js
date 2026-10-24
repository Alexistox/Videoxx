"use strict";
// Videoxx add-on: asset_find, Claude's online search for free 3D models (Poly Haven, Poly Pizza, Kenney, Quaternius).
// A found model is downloaded, checked (glTF binary, size, licence), turned into one .glb when it came as .gltf and
// saved into this computer's asset library with the app's own addAsset (licence rules, credits, index), so every later
// video finds it with lowpoly_asset search. Only CC0 / CC-BY models are offered; NC, ND, SA and unclear ones are not.
const electron = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const UA = "Videoxx/1.0 (free 3D asset search in a desktop video app; credits every asset)";
const MAX_GLB = 8e6;

// ---------------------------------------------------------------------------------------------------------------------
// small helpers
async function http(url, as = "text") {
  const r = await electron.net.fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered HTTP ${r.status}`);
  return as === "json" ? r.json() : as === "buffer" ? Buffer.from(await r.arrayBuffer()) : r.text();
}
const words = (q) => String(q || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const score = (hay, ws) => ws.reduce((s, w) => s + (hay.includes(w) ? (new RegExp(`\\b${w}`).test(hay) ? 2 : 1) : 0), 0);
const okLicence = (l) => /^(cc0|cc-?by[\s-]*[34](\.0)?|public domain)/i.test(String(l || "").trim()) && !/\b(nc|nd|sa)\b|non-?commercial|no-?deriv|share-?alike/i.test(String(l));

let CACHE_DIR = null;
const cacheDir = (libUser) => (CACHE_DIR ??= path.join(libUser, ".vx-cache"));
const memo = new Map();
async function cached(key, ms, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v;
  const v = await fn();
  memo.set(key, { at: Date.now(), v });
  return v;
}

// gltf + its files -> one .glb (binary glTF). Keeps only the base colour texture of each material (the library's rule:
// normal / roughness / occlusion maps are dropped), so a model stays light.
function packGlb(gltf, readUri) {
  const j = JSON.parse(JSON.stringify(gltf));
  for (const m of j.materials ?? []) { delete m.normalTexture; delete m.occlusionTexture; if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
  const usedTex = new Set((j.materials ?? []).map((m) => m.pbrMetallicRoughness?.baseColorTexture?.index).filter((i) => i != null));
  const usedImg = new Set([...usedTex].map((i) => j.textures?.[i]?.source).filter((i) => i != null));
  const chunks = [];
  let offset = 0;
  const push = (buf) => { const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; } const at = offset; chunks.push(buf); offset += buf.length; return at; };
  const bufferStart = (j.buffers ?? []).map((b) => push(b.uri?.startsWith("data:") ? Buffer.from(b.uri.split(",")[1], "base64") : readUri(b.uri)));
  for (const v of j.bufferViews ?? []) { v.byteOffset = (v.byteOffset ?? 0) + bufferStart[v.buffer ?? 0]; v.buffer = 0; }
  (j.images ?? []).forEach((im, i) => {
    if (!usedImg.has(i) || !im.uri) { if (!usedImg.has(i)) { im.uri = undefined; im.bufferView = undefined; } return; }
    const data = im.uri.startsWith("data:") ? Buffer.from(im.uri.split(",")[1], "base64") : readUri(im.uri);
    const at = push(data);
    j.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: data.length });
    im.bufferView = j.bufferViews.length - 1;
    im.mimeType = im.mimeType || (/\.png$/i.test(im.uri) ? "image/png" : /\.webp$/i.test(im.uri) ? "image/webp" : "image/jpeg");
    delete im.uri;
  });
  // images no material uses: point their textures nowhere (a texture must still have a valid source)
  if (j.images?.some((im) => im.bufferView == null && !im.uri)) {
    const keep = j.images.map((im, i) => (im.bufferView != null ? i : -1)).filter((i) => i >= 0);
    const remap = new Map(keep.map((old, n) => [old, n]));
    j.images = keep.map((i) => j.images[i]);
    const texKeep = (j.textures ?? []).map((t, i) => (remap.has(t.source) ? i : -1)).filter((i) => i >= 0);
    const texMap = new Map(texKeep.map((old, n) => [old, n]));
    j.textures = texKeep.map((i) => ({ ...j.textures[i], source: remap.get(j.textures[i].source) }));
    for (const m of j.materials ?? []) { const bt = m.pbrMetallicRoughness?.baseColorTexture; if (bt) { if (texMap.has(bt.index)) bt.index = texMap.get(bt.index); else delete m.pbrMetallicRoughness.baseColorTexture; } }
    if (!j.images.length) { delete j.images; delete j.textures; delete j.samplers; }
  }
  const bin = Buffer.concat(chunks);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  j.buffers = [{ byteLength: binPad.length }];
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, json, bh, binPad]);
}

const unzip = (zip, dir) => new Promise((res, rej) => {
  fs.mkdirSync(dir, { recursive: true });
  execFile("tar", ["-xf", zip, "-C", dir], { windowsHide: true, timeout: 5 * 60 * 1000 }, (e) => (e ? rej(new Error(`could not unpack ${path.basename(zip)}: ${e.message}`)) : res()));
});
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

// ---------------------------------------------------------------------------------------------------------------------
// Poly Haven (official API, CC0; asks for a User-Agent and a visible credit)
async function phSearch(ws, kind) {
  if (kind && !/prop|model|vehicle|set|any/.test(kind)) return [];
  const all = await cached("ph:models", 6 * 3600e3, () => http("https://api.polyhaven.com/assets?t=models", "json"));
  return Object.entries(all).map(([id, a]) => ({ a, id, s: score(`${id} ${a.name} ${(a.tags || []).join(" ")} ${(a.categories || []).join(" ")}`.toLowerCase(), ws) }))
    .filter((x) => x.s > 0).sort((x, y) => y.s - x.s || y.a.download_count - x.a.download_count).slice(0, 8)
    .map(({ id, a }) => ({ ref: `ph:${id}`, source: "Poly Haven", title: a.name, author: Object.keys(a.authors || {}).join(", "), licence: "CC0-1.0", page: `https://polyhaven.com/a/${id}`, thumb: a.thumbnail_url, note: `${a.polycount ? a.polycount + " tris, " : ""}${(a.categories || []).join("/")}` }));
}
async function phGet(id) {
  const files = await http(`https://api.polyhaven.com/files/${encodeURIComponent(id)}`, "json");
  const info = await http(`https://api.polyhaven.com/info/${encodeURIComponent(id)}`, "json");
  for (const res of ["1k", "2k"]) {
    const g = files.gltf?.[res]?.gltf;
    if (!g) continue;
    // a huge scan (trees, cliffs: 40-80 MB of mesh) never fits the 8 MB limit: say so before downloading it
    const total = (g.size || 0) + Object.values(g.include || {}).reduce((s, f) => s + (f.size || 0), 0);
    if (total > 4 * MAX_GLB) throw new Error(`${id} is ${(total / 1e6).toFixed(0)} MB at ${res}: too big for the library (8 MB)`);
    const base = g.url.slice(0, g.url.lastIndexOf("/") + 1);
    const gltf = await http(g.url, "json");
    const inc = {};
    for (const [rel, f] of Object.entries(g.include || {})) inc[rel] = f.url;
    const bufs = {};
    for (const u of [...(gltf.buffers || []).map((b) => b.uri), ...(gltf.images || []).map((i) => i.uri)].filter((u) => u && !u.startsWith("data:"))) bufs[u] = await http(inc[u] || base + u, "buffer");
    const glb = packGlb(gltf, (u) => bufs[u]);
    if (glb.length <= MAX_GLB || res === "2k") return { glb, title: info.name, author: Object.keys(info.authors || {}).join(", "), licence: "CC0-1.0", page: `https://polyhaven.com/a/${id}`, credit: `"${info.name}" by ${Object.keys(info.authors || {}).join(", ")}, CC0 via Poly Haven (https://polyhaven.com/a/${id})` };
  }
  throw new Error(`Poly Haven has no glTF of ${id}`);
}

// Poly Pizza (search page state; licence per model: CC0 or CC-BY only)
async function ppState(url) {
  const h = await http(url);
  const m = h.match(/window\.__SERVER_APP_STATE__ =\s*(\{[\s\S]*?\})\s*<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}
async function ppSearch(ws) {
  if (!ws.length) return [];
  const st = await ppState(`https://poly.pizza/search/${encodeURIComponent(ws.join(" "))}`);
  return (st?.initialData?.result || []).filter((r) => okLicence(r.licence)).slice(0, 8)
    .map((r) => ({ ref: `pp:${r.publicID || r.url.split("/").pop()}`, source: "Poly Pizza", title: r.title, author: r.creator?.username, licence: r.licence, page: `https://poly.pizza${r.url}`, thumb: r.previewUrl }));
}
async function ppGet(id) {
  const m = (await ppState(`https://poly.pizza/m/${encodeURIComponent(id)}`))?.initialData?.model;
  if (!m) throw new Error(`no Poly Pizza model ${id}`);
  if (!okLicence(m.Licence)) throw new Error(`Poly Pizza model ${id} is "${m.Licence}": only CC0 or CC-BY may be used`);
  const glb = await http(`https://static.poly.pizza/${m.ResourceID}.glb`, "buffer");
  const by = /by/i.test(m.Licence);
  return { glb, title: m.Title, author: m.Creator?.Username || "unknown", licence: by ? (/4/.test(m.Licence) ? "CC-BY 4.0" : "CC-BY 3.0") : "CC0", page: `https://poly.pizza/m/${id}`, credit: by ? `"${m.Title}" by ${m.Creator?.Username}, ${m.Licence} via Poly Pizza (https://poly.pizza/m/${id})` : "" };
}

// Kenney (CC0 kits: one zip each, .glb inside)
async function knKits() {
  return cached("kn:kits", 24 * 3600e3, async () => {
    const kits = new Set();
    for (let page = 1; page <= 12; page++) {
      const h = await http(`https://kenney.nl/assets/category:3D${page > 1 ? `/page:${page}` : ""}`).catch(() => "");
      const found = [...h.matchAll(/assets\/([a-z0-9]+(?:-[a-z0-9]+)+)/g)].map((x) => x[1]).filter((s) => !/^(category|tag|series)/.test(s));
      const before = kits.size; found.forEach((s) => kits.add(s));
      if (kits.size === before) break;
    }
    return [...kits];
  });
}
async function knSearch(ws, libUser) {
  const out = [];
  for (const k of await knKits()) {
    const s = score(k.replace(/-/g, " "), ws);
    const dir = path.join(cacheDir(libUser), "kenney", k);
    const models = fs.existsSync(dir) ? walk(dir).filter((f) => /\.glb$/i.test(f)) : [];
    const hits = models.map((f) => ({ f, s: score(path.basename(f, ".glb").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(), ws) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
    for (const h of hits) out.push({ ref: `kn:${k}/${path.basename(h.f, ".glb")}`, source: "Kenney", title: path.basename(h.f, ".glb"), author: "Kenney", licence: "CC0-1.0", page: `https://kenney.nl/assets/${k}`, note: "downloaded kit", _s: h.s + 1 });
    if (s > 0) out.push({ ref: `kn:${k}`, source: "Kenney", title: `${k} (whole kit: action "list" shows its models)`, author: "Kenney", licence: "CC0-1.0", page: `https://kenney.nl/assets/${k}`, _s: s });
  }
  return out.sort((a, b) => b._s - a._s).slice(0, 8).map(({ _s, ...r }) => r);
}
async function knKitDir(kit, libUser) {
  if (!/^[a-z0-9-]{3,60}$/.test(kit)) throw new Error("not a Kenney kit name");
  const dir = path.join(cacheDir(libUser), "kenney", kit);
  if (fs.existsSync(dir) && walk(dir).some((f) => /\.glb$/i.test(f))) return dir;
  const page = await http(`https://kenney.nl/assets/${kit}`);
  if (!/CC0/i.test(page)) throw new Error(`kenney.nl/assets/${kit} does not say CC0: not used`);
  const zipUrl = page.match(new RegExp(`https://kenney\\.nl/media/pages/assets/${kit}/[^"']+\\.zip`))?.[0];
  if (!zipUrl) throw new Error(`no download on kenney.nl/assets/${kit}`);
  const zip = path.join(cacheDir(libUser), `${kit}.zip`);
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  fs.writeFileSync(zip, await http(zipUrl, "buffer"));
  const tmp = `${dir}.unpack`;
  fs.rmSync(tmp, { recursive: true, force: true });
  await unzip(zip, tmp);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of walk(tmp).filter((f) => /\.glb$/i.test(f) && /gl(tf|b) format/i.test(f))) fs.copyFileSync(f, path.join(dir, path.basename(f)));
  // textures some kits reference from their .glb (Textures/colormap.png)
  for (const f of walk(tmp).filter((f) => /[\\/]textures?[\\/][^\\/]+\.(png|jpg)$/i.test(f) && /gl(tf|b) format/i.test(f))) { fs.mkdirSync(path.join(dir, "Textures"), { recursive: true }); fs.copyFileSync(f, path.join(dir, "Textures", path.basename(f))); }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  return dir;
}
async function knGet(ref, libUser) {
  const [kit, file] = ref.split("/");
  const dir = await knKitDir(kit, libUser);
  const f = path.join(dir, `${file}.glb`);
  if (!file || !fs.existsSync(f)) throw new Error(`no model "${file}" in the Kenney kit ${kit}: action "list" with ref kn:${kit} shows them`);
  let glb = fs.readFileSync(f);
  glb = embedGlbTextures(glb, dir);
  return { glb, title: file.replace(/([a-z])([A-Z])/g, "$1 $2"), author: "Kenney", licence: "CC0-1.0", page: `https://kenney.nl/assets/${kit}`, credit: "" };
}
// a .glb that points at an outside picture (Kenney's Textures/colormap.png): put the picture inside
function embedGlbTextures(glb, dir) {
  const jsonLen = glb.readUInt32LE(12), j = JSON.parse(glb.slice(20, 20 + jsonLen).toString());
  if (!(j.images || []).some((im) => im.uri && !im.uri.startsWith("data:"))) return glb;
  const binStart = 20 + jsonLen + 8, bin = glb.slice(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
  j.buffers = [{ uri: "bin" }];
  return packGlb(j, (u) => (u === "bin" ? bin : fs.readFileSync(path.join(dir, u.replace(/^\.\.?[\\/]/, "")))));
}

// Quaternius (CC0 packs on Google Drive, listed on quaternius.com)
async function qtPacks() {
  return cached("qt:packs", 24 * 3600e3, async () => [...new Set([...(await http("https://quaternius.com/")).matchAll(/\/packs\/([a-z0-9_-]+)\.html/g)].map((x) => x[1]))]);
}
async function qtSearch(ws) {
  return (await qtPacks()).map((p) => ({ p, s: score(p.replace(/(kit|pack|mega)/g, " $1 "), ws) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4)
    .map(({ p }) => ({ ref: `qt:${p}`, source: "Quaternius", title: `${p} (whole pack: action "list" shows its models)`, author: "Quaternius", licence: "CC0-1.0", page: `https://quaternius.com/packs/${p}.html` }));
}
async function driveList(id, rel = "", depth = 0) {
  if (depth > 4) return [];
  const html = await http(`https://drive.google.com/embeddedfolderview?id=${id}`);
  const out = [];
  for (const m of html.matchAll(/<a href="([^"]+)"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/g)) {
    const href = m[1].replace(/&amp;/g, "&"), name = m[2].replace(/&amp;/g, "&").replace(/&#39;/g, "'");
    const folder = href.match(/folders\/([\w-]+)/)?.[1];
    if (folder) out.push(...(await driveList(folder, rel ? `${rel}/${name}` : name, depth + 1)));
    else { const f = href.match(/file\/d\/([\w-]+)/)?.[1] || href.match(/id=([\w-]+)/)?.[1]; if (f) out.push({ id: f, rel: rel ? `${rel}/${name}` : name }); }
  }
  return out;
}
async function qtFiles(pack) {
  if (!/^[a-z0-9_-]{3,60}$/.test(pack)) throw new Error("not a Quaternius pack name");
  return cached(`qt:files:${pack}`, 24 * 3600e3, async () => {
    const page = await http(`https://quaternius.com/packs/${pack}.html`);
    if (!/publicdomain\/zero|CC0/i.test(page)) throw new Error(`quaternius.com/packs/${pack}.html does not say CC0: not used`);
    const folder = page.match(/drive\.google\.com\/drive\/folders\/([\w-]+)/)?.[1];
    if (!folder) throw new Error(`the ${pack} pack has no free Google Drive folder (newer Quaternius packs are only on itch.io / Patreon): take a model from Kenney / Poly Pizza / Poly Haven instead`);
    return driveList(folder);
  });
}
async function driveGet(id) {
  const b = await http(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, "buffer");
  // Drive answers a web page instead of the file when the file's daily download quota is used up (popular packs)
  if (/^\s*<!DOCTYPE html/i.test(b.slice(0, 64).toString())) {
    const quota = /Quota exceeded/i.test(b.slice(0, 600).toString());
    throw new Error(quota ? "Google Drive's daily download limit for this Quaternius pack is used up: try again tomorrow, or take a model from Kenney / Poly Pizza / Poly Haven (or the Quaternius models already in the library)" : "Google Drive answered a web page instead of the file");
  }
  return b;
}
async function qtGet(ref) {
  const [pack, ...rest] = ref.split("/"), name = rest.join("/");
  const files = await qtFiles(pack);
  const f = files.find((x) => /\.(glb|gltf)$/i.test(x.rel) && x.rel.replace(/\.(glb|gltf)$/i, "").toLowerCase().endsWith(name.toLowerCase()));
  if (!f) throw new Error(`no glTF model "${name}" in the Quaternius pack ${pack}: action "list" with ref qt:${pack} shows them`);
  let glb;
  if (/\.glb$/i.test(f.rel)) glb = await driveGet(f.id);
  else {
    const gltf = JSON.parse((await driveGet(f.id)).toString());
    const folder = f.rel.slice(0, f.rel.lastIndexOf("/") + 1), bufs = {};
    for (const u of [...(gltf.buffers || []).map((b) => b.uri), ...(gltf.images || []).map((i) => i.uri)].filter((u) => u && !u.startsWith("data:"))) {
      const want = (folder + decodeURIComponent(u)).replace(/\/\.\//g, "/");
      const hit = files.find((x) => x.rel === want) || files.find((x) => x.rel.endsWith("/" + path.basename(decodeURIComponent(u))));
      if (!hit) throw new Error(`the pack's ${path.basename(f.rel)} needs ${u}, which is not in its folder`);
      bufs[u] = await driveGet(hit.id);
    }
    glb = packGlb(gltf, (u) => bufs[u]);
  }
  return { glb, title: path.basename(f.rel).replace(/\.(glb|gltf)$/i, ""), author: "Quaternius", licence: "CC0-1.0", page: `https://quaternius.com/packs/${pack}.html`, credit: "" };
}

// ---------------------------------------------------------------------------------------------------------------------
// thumbnails, for Claude to choose by eye: the source's own picture of a model (Poly Haven, Poly Pizza) or of the kit /
// pack it comes from (Kenney, Quaternius); a library id works too (its source page's picture)
const THUMBS = new Map();
async function pageImage(url) {
  const h = await http(url);
  const src = h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  return src ? new URL(src, url).href : null;
}
async function thumbOf(ref, index) {
  if (THUMBS.has(ref)) return THUMBS.get(ref);
  let url = null;
  if (ref.startsWith("ph:")) url = (await cached("ph:models", 6 * 3600e3, () => http("https://api.polyhaven.com/assets?t=models", "json")))[ref.slice(3)]?.thumbnail_url;
  else if (ref.startsWith("pp:")) url = (await ppState(`https://poly.pizza/m/${encodeURIComponent(ref.slice(3))}`))?.initialData?.model?.PreviewUrl ?? null;
  else if (ref.startsWith("kn:")) url = await pageImage(`https://kenney.nl/assets/${ref.slice(3).split("/")[0]}`);
  else if (ref.startsWith("qt:")) url = await pageImage(`https://quaternius.com/packs/${ref.slice(3).split("/")[0]}.html`);
  else { const e = (index?.entries ?? []).find((x) => x.id === ref); if (e?.source_url) url = e.preview_url || (await pageImage(e.source_url).catch(() => null)); }
  THUMBS.set(ref, url);
  return url;
}
async function previews(refs, index) {
  const out = [];
  for (const ref of refs.slice(0, 4)) {
    try {
      const url = await thumbOf(ref, index);
      if (!url) { out.push({ ref, error: "no picture" }); continue; }
      const r = await electron.net.fetch(url, { headers: { "User-Agent": UA } });
      const type = (r.headers.get("content-type") || "").split(";")[0];
      if (!r.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) { out.push({ ref, error: `picture not usable (${r.status} ${type})` }); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 3e6) { out.push({ ref, error: "picture too big" }); continue; }
      out.push({ ref, mimeType: type, data: buf.toString("base64"), kit: /^(kn|qt):/.test(ref) });
    } catch (e) { out.push({ ref, error: e.message }); }
  }
  return out;
}

async function search(query, kind, libUser) {
  const ws = words(query);
  if (!ws.length) throw new Error("say what to look for (one to three plain English nouns)");
  const tries = await Promise.allSettled([phSearch(ws, kind), ppSearch(ws), knSearch(ws, libUser), qtSearch(ws)]);
  const rows = tries.flatMap((t) => (t.status === "fulfilled" ? t.value : []));
  for (const r of rows) if (r.thumb) THUMBS.set(r.ref, r.thumb);
  const errs = tries.map((t, i) => (t.status === "rejected" ? `${["Poly Haven", "Poly Pizza", "Kenney", "Quaternius"][i]}: ${t.reason?.message}` : null)).filter(Boolean);
  return { rows, errs };
}
async function list(ref, libUser) {
  if (ref.startsWith("kn:")) {
    const kit = ref.slice(3).split("/")[0], dir = await knKitDir(kit, libUser);
    return walk(dir).filter((f) => /\.glb$/i.test(f)).map((f) => `kn:${kit}/${path.basename(f, ".glb")}`);
  }
  if (ref.startsWith("qt:")) {
    const pack = ref.slice(3).split("/")[0];
    return (await qtFiles(pack)).filter((x) => /\.(glb|gltf)$/i.test(x.rel)).map((x) => `qt:${pack}/${x.rel.replace(/\.(glb|gltf)$/i, "")}`);
  }
  throw new Error('action "list" is for Kenney kits (kn:<kit>) and Quaternius packs (qt:<pack>)');
}
async function fetchModel(ref, libUser) {
  if (ref.startsWith("ph:")) return phGet(ref.slice(3));
  if (ref.startsWith("pp:")) return ppGet(ref.slice(3));
  if (ref.startsWith("kn:")) return knGet(ref.slice(3), libUser);
  if (ref.startsWith("qt:")) return qtGet(ref.slice(3));
  throw new Error("ref must come from a search (ph:, pp:, kn:, qt:)");
}

// The tool, in the shape of the app's suite tools ({ name, description, schema, handler }).
function toolDefs({ projectId, getProject, baseOf, text, z, lowpoly, changed }) {
  return [{
    name: "asset_find",
    description: `Find a free 3D model ONLINE when the asset library has nothing that fits (search the library first with lowpoly_asset action search). Sources: Poly Haven (CC0, realistic scanned props), Poly Pizza (CC0 / CC-BY low poly), Kenney kits (CC0, toy-like), Quaternius packs (CC0, stylised low poly). Only CC0 / CC-BY models are offered. action "search": query = 1-3 plain English nouns ("whale", "wooden chair"); answers refs (ph: / pp: / kn: / qt:). action "preview": refs = up to 4 refs (or library ids) -> their pictures, to choose by eye before adding (Kenney / Quaternius show their kit's picture). action "list": the models inside a Kenney kit or Quaternius pack (ref kn:<kit> or qt:<pack>; the first list downloads the kit). action "add": downloads ref, checks it and saves it into this computer's asset library under id (kind prefix: prop.<name>, animal.<name>, vehicle.<name>, set.<name>, character.<name>), name and tags; then use it by its id like any library model. Look at it in a frame before using it everywhere (size, facing, materials): give it its real height where it is placed.`,
    schema: {
      action: z.enum(["search", "preview", "list", "add"]),
      query: z.string().max(120).optional(),
      kind: z.string().max(20).optional(),
      ref: z.string().max(200).optional(),
      refs: z.array(z.string().max(200)).max(4).optional(),
      id: z.string().max(80).optional(),
      name: z.string().max(80).optional(),
      tags: z.array(z.string().max(30)).max(20).optional(),
    },
    handler: async (a) => {
      const p = getProject(projectId);
      const why = require("./videoxx-assets").gate(p, baseOf(p.style_id));
      if (why) return text(why);
      const L = lowpoly;
      const libUser = L.lowpolyDirs().user;
      try {
        if (a.action === "search") {
          const { rows, errs } = await search(a.query, a.kind, libUser);
          const body = rows.length ? rows.map((r) => `${r.ref}  ${r.title}  (${r.source}, ${r.licence}, by ${r.author || "?"})${r.note ? "  " + r.note : ""}  ${r.page}`).join("\n") : `Nothing online for "${a.query}". Try another noun or a broader word (the category).`;
          return text(`${body}${errs.length ? `\n(not reached: ${errs.join("; ")})` : ""}\nNext: action "add" with a ref (kn: / qt: kits: action "list" first to pick one model).`);
        }
        if (a.action === "preview") {
          const refs = a.refs?.length ? a.refs : a.ref ? [a.ref] : [];
          if (!refs.length) return text('action "preview" needs refs (up to 4, from a search) or library ids.');
          const shots = await previews(refs, L.lowpolyIndex());
          const content = [];
          for (const s of shots) {
            content.push({ type: "text", text: s.error ? `${s.ref}: ${s.error}` : `${s.ref}${s.kit ? " (the kit's picture, not this one model)" : ""}:` });
            if (!s.error) content.push({ type: "image", data: s.data, mimeType: s.mimeType });
          }
          return { content };
        }
        if (a.action === "list") {
          const refs = await list(String(a.ref || ""), libUser);
          return text(refs.length ? refs.slice(0, 300).join("\n") : "That kit has no glTF models.");
        }
        if (!a.ref || !a.id || !a.name) return text('action "add" needs ref (from a search or list), id (prop.<name>, ...) and name.');
        const m = await fetchModel(String(a.ref), libUser);
        if (m.glb.readUInt32LE(0) !== 0x46546c67) throw new Error("the download is not a glTF binary");
        if (m.glb.length > MAX_GLB) throw new Error(`the model is ${(m.glb.length / 1e6).toFixed(1)} MB: library models stay under 8 MB (pick a lighter one)`);
        // addAsset takes a .glb inside the project: hand it one there, it copies it into the library
        const rel = path.join("assets", ".vx-incoming", `${crypto.randomBytes(5).toString("hex")}.glb`);
        fs.mkdirSync(path.join(p.path, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(p.path, rel), m.glb);
        const kind = String(a.id).split(".")[0];
        try {
          const r = await L.addAsset({ id: a.id, kind, name: a.name, tags: a.tags || [], licence: m.licence, licence_quote: `${m.source || ""} ${m.licence}`.trim(), author: m.author, source_url: m.page, credit_text: m.credit || undefined, file: rel, note: `added by Claude (asset_find ${a.ref})` }, p.path);
          changed?.();
          const info = r.info || {};
          return text(`Saved to the asset library: ${r.entry.id} (${r.entry.licence}, by ${m.author}${info.size_m ? `, ${info.size_m.join(" x ")} m as made` : ""}${info.poly_count ? `, ${info.poly_count} triangles` : ""}). Use it by its id; give it its real height where you place it.${m.credit ? ` Credit (CC-BY, goes into the description): ${m.credit}` : ""}`);
        } finally {
          fs.rmSync(path.join(p.path, rel), { force: true });
        }
      } catch (e) {
        return text(`asset_find: ${e.message}`);
      }
    },
  }];
}

module.exports = { toolDefs, _test: { packGlb, okLicence, words, score, search, list, fetchModel, previews } };
