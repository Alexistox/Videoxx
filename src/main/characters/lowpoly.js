import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { templatesDir, ws } from "../core/workspace";
import { log } from "../core/log";

export const lowpolyDirs = () => ({
  seed: path.join(templatesDir(), "lowpoly", "library"),
  user: path.join(ws.root(), "assets", "lowpoly"),
});
const readEntries = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")).entries || [];
  } catch {
    return [];
  }
};
let cache = null;
export function lowpolyIndex() {
  const { seed, user } = lowpolyDirs(),
    mt = (d) => {
      try {
        return fs.statSync(path.join(d, "index.json")).mtimeMs;
      } catch {
        return 0;
      }
    };
  const key2 = `${seed}|${mt(seed)}|${user}|${mt(user)}`;
  if (cache?.key === key2) return cache.idx;
  const u = readEntries(user).map((e) => ({ ...e, user: true })),
    ids = new Set(u.map((e) => e.id));
  const idx = {
    version: 1,
    about: "Merged low-poly library: the app seed + this computer's own finds.",
    entries: [...readEntries(seed).filter((e) => !ids.has(e.id)), ...u],
  };
  cache = { key: key2, idx };
  return idx;
}
const scanMod = () => import(/* @vite-ignore */ pathToFileURL(path.join(templatesDir(), "lowpoly", "lib", "scan.js")).href);
const libMod = () => import(/* @vite-ignore */ pathToFileURL(path.join(lowpolyDirs().seed, "tools", "lib.mjs")).href);
export async function usedAssets(dir) {
  let pj = {};
  try {
    pj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
  } catch {}
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      return "";
    }
  };
  const sources = [...(pj.scenes || []).map((s) => read(`scenes/${s}.js`)), read("models.js")];
  const { scanIds } = await scanMod();
  return scanIds(sources, lowpolyIndex().entries);
}
const BEGIN = "--- 3D asset credits (kept up to date by Videoxx) ---",
  END = "--- end of asset credits ---";
export async function updateCredits(dir) {
  try {
    const ids = await usedAssets(dir),
      { creditsText } = await scanMod();
    const text = ids.length ? creditsText(ids, lowpolyIndex().entries) : "";
    const f = path.join(dir, "DESCRIPTION.txt");
    let prev = "";
    try {
      prev = fs.readFileSync(f, "utf8");
    } catch {}
    const block = text
      ? `${BEGIN}
${text}
${END}`
      : "";
    let out =
      prev.includes(BEGIN) && prev.includes(END)
        ? prev.slice(0, prev.indexOf(BEGIN)) + block + prev.slice(prev.indexOf(END) + END.length)
        : (prev.trim() ? prev.replace(/\s*$/, "\n\n") : "") + block;
    out = out.replace(/\n{3,}/g, "\n\n").replace(/^\s+/, "");
    if (block && out.trim() !== prev.trim()) fs.writeFileSync(f, out.endsWith("\n") ? out : out + "\n");
    return text;
  } catch (e) {
    log("lowpoly credits failed", e?.message);
    return "";
  }
}
export function normLicence(s) {
  const t = String(s || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  if (/\bNC\b|NON.?COMMERCIAL|\bND\b|NO.?DERIV|\bSA\b|SHARE.?ALIKE|PERSONAL|EDITORIAL|MIXAMO|STANDARD LICEN/.test(t)) return null;
  if (/CC0|CC-0|CC ZERO|CREATIVE COMMONS ZERO/.test(t)) return "CC0-1.0";
  if (/PUBLIC DOMAIN|^PD$/.test(t)) return "PD";
  if (/CC.?BY.?4|ATTRIBUTION 4/.test(t)) return "CC-BY-4.0";
  if (/CC.?BY.?3|ATTRIBUTION 3/.test(t)) return "CC-BY-3.0";
  if (/^CC.?BY$|CREATIVE COMMONS ATTRIBUTION$/.test(t)) return "CC-BY-4.0";
  return null;
}
export function inspectGlb(buf) {
  if (buf.readUInt32LE(0) !== 1179937895) throw new Error("not a binary glTF (.glb) file");
  const len = buf.readUInt32LE(12),
    j = JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
  const bad = (j.extensionsRequired || []).filter((x) => /draco|meshopt|basisu|ktx/i.test(x));
  if (bad.length) throw new Error(`uses ${bad.join(", ")}, which the engine cannot decode: find an uncompressed .glb (or another model)`);
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const trs = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1],
      [sx, sy, sz] = n.scale || [1, 1, 1],
      [tx, ty, tz] = n.translation || [0, 0, 0];
    return [
      (1 - 2 * (y * y + z * z)) * sx,
      2 * (x * y + z * w) * sx,
      2 * (x * z - y * w) * sx,
      0,
      2 * (x * y - z * w) * sy,
      (1 - 2 * (x * x + z * z)) * sy,
      2 * (y * z + x * w) * sy,
      0,
      2 * (x * z + y * w) * sz,
      2 * (y * z - x * w) * sz,
      (1 - 2 * (x * x + y * y)) * sz,
      0,
      tx,
      ty,
      tz,
      1,
    ];
  };
  const min = [1e9, 1e9, 1e9],
    max = [-1e9, -1e9, -1e9];
  let tris = 0;
  const visit = (i, M) => {
    const n = j.nodes[i],
      W = mul(M, trs(n));
    if (n.mesh != null)
      for (const p of j.meshes[n.mesh].primitives) {
        const a = j.accessors[p.attributes.POSITION];
        if (!a?.min) continue;
        const q = a.normalized ? 1 / { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 1;
        tris += Math.round((p.indices != null ? j.accessors[p.indices].count : a.count) / 3);
        for (let k = 0; k < 8; k++) {
          const v = [k & 1 ? a.max[0] : a.min[0], k & 2 ? a.max[1] : a.min[1], k & 4 ? a.max[2] : a.min[2]].map((x) => x * q);
          for (let r = 0; r < 3; r++) {
            const w = W[r] * v[0] + W[4 + r] * v[1] + W[8 + r] * v[2] + W[12 + r];
            min[r] = Math.min(min[r], w);
            max[r] = Math.max(max[r], w);
          }
        }
      }
    for (const c of n.children || []) visit(c, W);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of j.scenes?.[j.scene ?? 0]?.nodes || []) visit(r, I);
  const animations = (j.animations || []).map((a) => ({
    name: String(a.name || "clip").replace(/^.*\|/, ""),
    duration: +Math.max(0, ...a.samplers.map((s) => j.accessors[s.input]?.max?.[0] ?? 0)).toFixed(3),
  }));
  const boneNames = new Set((j.skins || []).flatMap((s) => s.joints.map((k) => j.nodes[k].name)));
  return {
    size_m: min[0] < 1e8 ? [0, 1, 2].map((r) => +(max[r] - min[r]).toFixed(3)) : null,
    min,
    max,
    poly_count: tris,
    animations,
    skeleton: (j.skins || []).length
      ? ["pelvis", "Head", "thigh_l", "hand_r"].every((b) => boneNames.has(b))
        ? "ue5-mannequin-65"
        : "own"
      : null,
  };
}
async function fetchTo(url, dest) {
  if (!/^https:\/\//i.test(url)) throw new Error("only https downloads");
  const ac = new AbortController(),
    tm = setTimeout(() => ac.abort(), 12e4);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow" });
    if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 25e6) throw new Error("the file is over 25 MB: too heavy for a short, find a lighter model");
    fs.writeFileSync(dest, buf);
  } finally {
    clearTimeout(tm);
  }
}
export async function addAsset(a, projectDir) {
  const { user } = lowpolyDirs();
  fs.mkdirSync(user, { recursive: true });
  const id = String(a.id || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_");
  if (!/^(prop|animal|vehicle|set|character|texture)\./.test(id))
    throw new Error("id must start with its kind: prop.<name>, animal.<name>, vehicle.<name>, set.<name>, character.<name>");
  if (lowpolyIndex().entries.some((e) => e.id === id)) throw new Error(`${id} is already in the library: use it, or pick another id`);
  const licence = normLicence(a.licence);
  if (!licence)
    throw new Error(
      `licence "${a.licence}" is not allowed: only CC0, public domain, CC-BY 3.0 / 4.0 (no NC, ND, SA, personal-use or unclear licences)`,
    );
  if (!a.author || !a.source_url) throw new Error("author and source_url (the page that states the licence) are required");
  if (/^CC-BY/.test(licence) && !a.credit_text)
    throw new Error("a CC-BY model needs credit_text: the exact line for the video description (title, author, licence, link)");
  const tmpDir = path.join(user, ".incoming");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(
    tmpDir,
    crypto.randomBytes(6).toString("hex") + (a.kind === "texture" ? path.extname(a.url || a.file || ".png") : ".glb"),
  );
  try {
    if (a.url) await fetchTo(a.url, tmp);
    else if (a.file) {
      const f = path.resolve(projectDir, a.file);
      if (!f.startsWith(path.resolve(projectDir) + path.sep)) throw new Error("file must be inside the project folder");
      fs.copyFileSync(f, tmp);
    } else throw new Error("give url (a direct https link to the .glb) or file (a .glb inside the project)");
    const buf = fs.readFileSync(tmp);
    let info = {};
    if (a.kind !== "texture") {
      info = inspectGlb(buf);
      if (buf.length > 8e6)
        throw new Error(`the model is ${(buf.length / 1e6).toFixed(1)} MB: keep library models under 8 MB (find a lower-poly one)`);
    }
    const lib = await libMod();
    const kindName = a.kind === "character" ? "character" : a.kind;
    const entry = {
      id,
      kind: kindName,
      name: a.name,
      tags: [...new Set([...(a.tags || []), ...a.name.toLowerCase().split(/\W+/).filter(Boolean), "user-find"])],
      licence,
      licence_quote: a.licence_quote || a.licence,
      author: a.author,
      source_url: a.source_url,
      ...(a.credit_text ? { credit_text: a.credit_text } : {}),
      size_m: a.size_m || info.size_m,
      poly_count: info.poly_count,
      animations: info.animations?.length ? info.animations : void 0,
      skeleton: info.skeleton || void 0,
      forward: a.forward || "+Z",
      note: a.note || "added by Claude (lowpoly_asset)",
      ...(a.url ? { download_url: a.url } : {}),
    };
    const out = lib.add(entry, tmp, {
      dir: user,
      relPath: `${kindName === "character" ? "characters" : kindName + "s"}/${id}${path.extname(tmp)}`,
    });
    cache = null;
    return { entry: out, info };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
export async function searchAssets(query, kind, limit = 20) {
  const { searchEntries } = await scanMod();
  return searchEntries({ query, kind: kind || void 0, limit }, lowpolyIndex().entries).map((e) => ({
    id: e.id,
    kind: e.kind,
    name: e.name,
    size_m: e.size_m,
    clips: (e.animations || []).length || void 0,
    licence: e.licence,
    user: !!e.user,
    tags: (e.tags || []).slice(0, 8),
  }));
}
