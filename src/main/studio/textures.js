import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { nativeImage } from "electron";
import { log } from "../core/log";
import { uid } from "../db/db";
import { baseOf } from "../styles/catalog";
import { PROVIDER_NAMES, activeProvider, generatePicture } from "../images/providers";
import { LIB_BASE_RX, LIB_ID_RX, LibEntrySchema } from "../library/schema";
import { rebuildIndex } from "../library/index";
import { findStoreEntry, sha1, writeWsEntry } from "../library/store";

const TEXTURE_BASES = new Set(["recon", "lowpoly", "pixel-art", "vox"]);
export function flowTextures(project, styleId) {
  try {
    return TEXTURE_BASES.has(baseOf(styleId)) && activeProvider(project) === "flow";
  } catch {
    return false;
  }
}
export function flowTextureNote(project, styleId, indent = "") {
  if (!flowTextures(project, styleId)) return "";
  return [
    `PICTURES ON GOOGLE FLOW (free for this project, made while you build, never ahead): for BIG visible surfaces (floor, walls,`,
    `table tops, counters, sofas, beds) use make_texture { name, material, tile_m } instead of a procedural canvas material: a`,
    `seamless 2K texture, applied with RepeatWrapping and repeat = surface metres / tile_m (the tool returns the 3 lines). Keep the`,
    `stylized 3D look: textures subtle, never photo-real. Small things keep the procedural materials. Small details and pictures`,
    `(framed art, posters, signs without text, screens, photos on a desk, food, packaging without labels) come from make_image as`,
    `image planes (upscale: true for one seen big). One picture per request; look at each once and remake it only when it is wrong.`,
  ]
    .map((l) => indent + l)
    .join("\n");
}
const readJson$a = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return d;
  }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
};
const clip$a = (s, n) => {
  const t = String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
function texturePrompt(material) {
  return `A flat, evenly lit, straight top-down (orthographic) seamless tileable texture of ${clip$a(material, 300)}, filling the whole square frame edge to edge; the pattern runs off every edge so tiles join with no visible seam. Made for a stylized 3D render: clean, subtle surface detail and gentle colour variation, not photographic noise. No shadows, no highlights, no perspective, no vignette, no objects, no text, no letters, no numbers, no watermark.`;
}
function makeSeamless(bmp, w, h) {
  const ramp = (i, n) => {
    const d = Math.abs((2 * (i + 0.5)) / n - 1);
    const t = Math.min(1, Math.max(0, (d - 0.5) / 0.5));
    return t * t * (3 - 2 * t);
  };
  const a = Buffer.from(bmp),
    b = Buffer.alloc(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = ramp(x, w),
        o = (y * w + x) * 4,
        r = (y * w + ((x + (w >> 1)) % w)) * 4;
      for (let c = 0; c < 3; c++) b[o + c] = Math.round(a[o + c] * (1 - k) + a[r + c] * k);
      b[o + 3] = 255;
    }
  for (let y = 0; y < h; y++) {
    const k = ramp(y, h),
      ry = (y + (h >> 1)) % h;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4,
        r = (ry * w + x) * 4;
      for (let c = 0; c < 3; c++) a[o + c] = Math.round(b[o + c] * (1 - k) + b[r + c] * k);
      a[o + 3] = 255;
    }
  }
  return a;
}
function textureSnippet(name, tile, recon) {
  const key2 = name.replace(/-/g, "_"),
    t = +tile.toFixed(3);
  return recon
    ? [
        `await setup({ textures: { ${key2}: 'assets/textures/${name}.jpg' } });   // merge into the first scene file's setup() -> TEXTURES.${key2} (sRGB)`,
        `const T = TEXTURES.${key2}.clone(); T.wrapS = T.wrapT = THREE.RepeatWrapping; T.repeat.set(W / ${t}, H / ${t}); T.needsUpdate = true;   // W x H = the surface in metres`,
        `const mat = new THREE.MeshStandardMaterial({ map: T, roughness: .8 });   // one clone per surface size; box UVs: the face it is on`,
      ].join("\n")
    : [
        `const T = new THREE.TextureLoader().load((typeof ROOT === 'string' ? ROOT : '') + 'assets/textures/${name}.jpg'); T.colorSpace = THREE.SRGBColorSpace; T.anisotropy = 8;`,
        `T.wrapS = T.wrapT = THREE.RepeatWrapping; T.repeat.set(W / ${t}, H / ${t});   // W x H = the surface in metres (repeat = size / tile)`,
        `const mat = new THREE.MeshStandardMaterial({ map: T, roughness: .8 });`,
      ].join("\n");
}
const ledgerFile = (dir) => path.join(dir, "assets", "textures", "textures.json");
const textureLedger = (dir) => readJson$a(ledgerFile(dir), { spent: 0, count: 0, textures: {} });
const libIdOf = (styleId, name) => {
  const b0 = baseOf(styleId),
    b = LIB_BASE_RX.test(String(styleId)) ? String(styleId) : LIB_BASE_RX.test(b0) ? b0 : "any";
  const id = `texture.${b}.${
    name
      .replace(/_/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 48) || "texture"
  }`;
  return LIB_ID_RX.test(id) ? id : null;
};
export async function makeTexture(dir, styleId, req, gen = generatePicture) {
  if (activeProvider(dir) !== "flow")
    throw new Error(
      "make_texture works only when this project's image service is Google Flow (Settings > Media > Image generation). Use the procedural materials instead.",
    );
  const name = String(req.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!name) throw new Error("Give the texture a short name (letters, digits, _ or -).");
  const material = clip$a(req.material, 300);
  if (material.length < 3) throw new Error('Say what the material is (material: "worn oak floor planks").');
  const tile = Number(req.tile_m) > 0 ? Math.min(50, Number(req.tile_m)) : 1,
    seamless = req.seamless !== false;
  const prompt = texturePrompt(material),
    hash = crypto
      .createHash("sha1")
      .update([prompt, seamless ? "seamless" : ""].join("|"))
      .digest("hex")
      .slice(0, 16);
  const rel = `assets/textures/${name}.jpg`,
    out = path.join(dir, rel),
    recon = baseOf(styleId) === "recon";
  const save = (e2, counted) => {
    const l = textureLedger(dir);
    l.textures[name] = e2;
    if (counted) {
      l.count++;
      l.spent = +(l.spent + e2.cost).toFixed(4);
    }
    writeJson(ledgerFile(dir), l);
    return l;
  };
  const prev = textureLedger(dir).textures[name];
  if (prev && prev.hash === hash && fs.existsSync(out)) {
    if (prev.tile_m !== tile) save({ ...prev, tile_m: tile }, false);
    return { name, rel, file: out, entry: { ...prev, tile_m: tile }, cached: "project", snippet: textureSnippet(name, tile, recon) };
  }
  const libId = libIdOf(styleId, name);
  const lib = libId ? findStoreEntry(libId) : null,
    libFile =
      lib?.origin === "ws" && lib.entry.doc?.params?.hash === hash ? path.join(lib.dir, `v${lib.entry.version}`, `${name}.jpg`) : null;
  if (libFile && fs.existsSync(libFile)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(libFile, out);
    const s = nativeImage.createFromPath(out).getSize();
    const e2 = {
      file: rel,
      material,
      prompt,
      tile_m: tile,
      provider: "library",
      model: lib.entry.doc?.params?.model ?? "flow",
      cost: 0,
      size: [s.width, s.height],
      hash,
      upscaled: true,
      from: libId,
      at: new Date().toISOString(),
    };
    save(e2, false);
    return { name, rel, file: out, entry: e2, cached: "library", snippet: textureSnippet(name, tile, recon) };
  }
  const r = await gen({ prompt, aspect: "1:1", refs: [], upscale2k: true }, dir);
  if (r.provider !== "flow") throw new Error("make_texture works only on Google Flow; nothing was made.");
  const im = nativeImage.createFromBuffer(r.buf);
  if (im.isEmpty()) throw new Error("The texture came back in a format the app cannot read.");
  const { width: w, height: h } = im.getSize();
  const jpg = seamless
    ? nativeImage.createFromBitmap(makeSeamless(Buffer.from(im.toBitmap()), w, h), { width: w, height: h }).toJPEG(90)
    : r.buf[0] === 255
      ? r.buf
      : im.toJPEG(90);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, jpg);
  const e = {
    file: rel,
    material,
    prompt,
    tile_m: tile,
    provider: PROVIDER_NAMES.flow,
    model: r.model,
    cost: r.cost,
    size: [w, h],
    hash,
    upscaled: !!r.upscaled,
    ...(r.note ? { note: r.note } : {}),
    at: new Date().toISOString(),
  };
  if (libId)
    try {
      e.library = toLibrary(libId, name, e, jpg, dir);
    } catch (x) {
      log("library: texture not saved", libId, x?.message);
    }
  save(e, true);
  return { name, rel, file: out, entry: e, cached: false, snippet: textureSnippet(name, tile, recon) };
}
function toLibrary(id, name, e, jpg, dir) {
  const prev = findStoreEntry(id),
    mine = prev?.origin === "ws" ? prev : null;
  if (mine && mine.entry.doc?.params?.hash === e.hash) return id;
  const version = mine ? mine.entry.version + 1 : 1,
    at = e.at,
    file = `${name}.jpg`;
  const preview = (() => {
    const im = nativeImage.createFromBuffer(jpg),
      s = im.getSize();
    return (s.width > 512 ? im.resize({ width: 512, quality: "best" }) : im).toJPEG(84);
  })();
  const words = e.material
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length > 2)
    .slice(0, 14);
  const entry = LibEntrySchema.parse({
    ...(mine?.entry ?? {}),
    origin: void 0,
    preview: void 0,
    schema: 1,
    id,
    uid: mine?.entry.uid ?? uid("lib_"),
    kind: "texture",
    title: clip$a(`${e.material} (seamless texture)`, 120),
    summary: clip$a(`A seamless 2K tileable texture of ${e.material}, one tile covers ${e.tile_m} m. Made on Google Flow.`, 400),
    tags: [...new Set(["texture", "tileable", "seamless", "material", ...words])].slice(0, 20),
    engines: [],
    scope: "global",
    status: "accepted",
    version,
    versions: [...(mine?.entry.versions ?? []), { v: version, hash: e.hash, at, note: "made with make_texture" }],
    delivery: "copy",
    files: [{ path: file, role: "asset", bytes: jpg.length, sha1: sha1(jpg) }],
    requires: [],
    usage: {
      example: `make_texture { name: '${name}', material: '${clip$a(e.material, 120).replace(/'/g, "")}', tile_m: ${e.tile_m} } in a project on Google Flow copies it for free; else copy ${file} into assets/textures/ and:
${textureSnippet(name, e.tile_m, true)}`,
    },
    doc: {
      when: clip$a(`Big visible ${e.material} surfaces in a stylized 3D scene.`, 1e3),
      params: { material: e.material, tile_m: e.tile_m, hash: e.hash, model: e.model, prompt: e.prompt },
    },
    provenance: [...(mine?.entry.provenance ?? []), { project: path.basename(dir), by: "make_texture", at }].slice(-100),
    licence: { id: "own" },
    related: mine?.entry.related ?? [],
    created: mine?.entry.created ?? at,
    updated: at,
  });
  writeWsEntry(entry, [{ rel: file, buf: jpg }], preview);
  try {
    rebuildIndex();
  } catch (x) {
    log("library: index after a texture", x?.message);
  }
  log("library: texture saved", id, `v${version}`);
  return id;
}
