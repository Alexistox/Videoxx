import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { nativeImage } from "electron";
import { unaccent } from "../core/text";
import { bgraToRgba, encodePng, matte, shrink } from "./png";
import { findCachedImage, imageCacheOn, logImageUse, projectIdOfDir } from "./imageCache";
import { activeProvider, defaultImageModel, generatePicture } from "./providers";

export const IMAGE_MODEL = "marketing-studio/image/flare",
  IMAGE_QUALITY = "low",
  IMAGE_RES = "1k",
  IMAGE_COST = 0.0126;
export const DEFAULT_BUDGET = 40;
const MATTE_VERSION = 2;
const SUFFIX = {
  cutout:
    "Single isolated subject, centered, fully inside the frame with generous margin, on a flat pure white (#FFFFFF) background. No shadow on the ground, no border, no frame, no text, no letters, no numbers, no watermark.",
  background:
    "Full-bleed texture filling the whole frame edge to edge, evenly lit, no objects, no text, no letters, no numbers, no watermark.",
  texture: "Full-bleed, filling the whole frame, no text, no letters, no numbers, no watermark.",
};
export function promptSubject(full, kind, style) {
  let s = String(full).trim(),
    st = String(style || "").trim();
  if (st && s.startsWith(st + " ")) s = s.slice(st.length + 1);
  const suf = SUFFIX[kind];
  if (suf) {
    const i = s.indexOf(" " + suf);
    if (i >= 0) s = s.slice(0, i);
  }
  return s.trim();
}
const readJson$e = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return d;
  }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
};
const chains = new Map();
const serial = (key2, fn) => {
  const p = (chains.get(key2) ?? Promise.resolve()).then(fn, fn);
  chains.set(
    key2,
    p.catch(() => {}),
  );
  return p;
};
export function ledger(dir) {
  return readJson$e(path.join(dir, "assets", "images.json"), { spent: 0, count: 0, images: {} });
}
export async function makeImage(dir, req, gen = generatePicture) {
  const name = unaccent(String(req.name || ""))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!name) throw new Error("Give the image a short name (letters, digits, _ or -).");
  const pj = readJson$e(path.join(dir, "project.json"), null);
  if (!pj || typeof pj !== "object")
    throw new Error(
      "project.json can't be read (it must be valid JSON), so no picture was made and nothing was spent. Repair project.json first.",
    );
  const style = String(pj.imageStyle || "").trim();
  const refNote = req.ref
    ? "Image 1 is ONLY a reference for the drawing technique, line work and paper colour: do not copy its subject, figures or objects."
    : "";
  const full = [style, String(req.prompt).trim(), SUFFIX[req.kind], refNote].filter(Boolean).join(" ");
  let refFile = null;
  if (req.ref) {
    const r = ledger(dir).images[req.ref];
    refFile = r ? path.join(dir, "assets", r.file) : null;
    if (!refFile || !fs.existsSync(refFile))
      throw new Error(`No image named "${req.ref}" to use as the style reference (make it first, or leave ref out).`);
  }
  const asked = typeof req.model === "string" && req.model.trim() ? req.model.trim() : void 0;
  const prov = activeProvider(dir),
    picked = asked ?? (prov ? defaultImageModel(prov, dir) : null);
  const hash = crypto
    .createHash("sha1")
    .update(
      [
        IMAGE_MODEL,
        IMAGE_QUALITY,
        IMAGE_RES,
        req.kind,
        req.aspect,
        full,
        refFile ? path.basename(refFile) : "",
        ...(picked ? [picked] : []),
        ...(req.upscale ? ["2k"] : []),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);
  const rel = `img/${name}.png`,
    out = path.join(dir, "assets", rel);
  const cached = ledger(dir).images[name];
  const shapeOk = (size, aspect) => {
    if (req.kind === "cutout" || !aspect || !Array.isArray(size) || !size[0] || !size[1]) return true;
    const [a, b] = aspect.split(":").map(Number);
    return !(a > 0 && b > 0) || Math.abs(Math.log(size[0] / size[1] / (a / b))) < 0.25;
  };
  if (cached && cached.hash === hash && fs.existsSync(out) && shapeOk(cached.size, req.aspect)) {
    const raw = cached.raw && path.join(dir, cached.raw);
    if (cached.kind === "cutout" && (cached.matte ?? 1) < MATTE_VERSION && raw && fs.existsSync(raw)) {
      const r = processImage(fs.readFileSync(raw), cached.kind);
      fs.writeFileSync(out, encodePng(r.rgba));
      const entry22 = { ...cached, cover: r.cover, size: [r.rgba.w, r.rgba.h], matte: MATTE_VERSION };
      const l2 = await serial(dir, async () => {
        const cur = ledger(dir);
        cur.images[name] = entry22;
        writeJson(path.join(dir, "assets", "images.json"), cur);
        return cur;
      });
      return { name, file: out, rel, entry: entry22, cached: true, ledger: l2 };
    }
    return { name, file: out, rel, entry: cached, cached: true, ledger: ledger(dir) };
  }
  if (!req.ref && !req.upscale && imageCacheOn()) {
    const hit = findCachedImage(req.kind, req.aspect, full, { exceptDir: dir, exceptName: name, model: asked });
    if (hit && shapeOk(hit.e.size, req.aspect)) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(hit.file, out);
      let rawRel2;
      if (hit.raw)
        try {
          rawRel2 = `.suite/raw/${name}-${hash}.img`;
          fs.mkdirSync(path.join(dir, ".suite", "raw"), { recursive: true });
          fs.copyFileSync(hit.raw, path.join(dir, rawRel2));
        } catch {
          rawRel2 = void 0;
        }
      const e = hit.e,
        entry22 = {
          file: rel,
          prompt: full,
          kind: req.kind,
          aspect: req.aspect,
          ref: null,
          hash,
          model: e.model,
          cost: 0,
          at: new Date().toISOString(),
          ...(e.cover != null ? { cover: e.cover } : {}),
          size: Array.isArray(e.size) ? e.size : [0, 0],
          ...(rawRel2 ? { raw: rawRel2 } : {}),
          ...(e.matte != null ? { matte: e.matte } : {}),
        };
      entry22.from = { project: hit.p.projectName, image: e.name };
      const l2 = await serial(dir, async () => {
        const cur = ledger(dir);
        cur.images[name] = entry22;
        writeJson(path.join(dir, "assets", "images.json"), cur);
        const p = readJson$e(path.join(dir, "project.json"), null);
        if (p && typeof p === "object") {
          p.images = { ...(p.images || {}), [name]: rel };
          writeJson(path.join(dir, "project.json"), p);
        }
        return cur;
      });
      logImageUse(hit.key, projectIdOfDir(dir), `copied "${e.name}" from ${hit.p.projectName} as "${name}"`);
      return { name, file: out, rel, entry: entry22, cached: true, shared: { project: hit.p.projectName, image: e.name }, ledger: l2 };
    }
  }
  const l0 = ledger(dir),
    budget = Number(pj.imageBudget) > 0 ? Number(pj.imageBudget) : DEFAULT_BUDGET;
  if (activeProvider(dir) !== "flow" && l0.count >= budget)
    throw new Error(
      `This project has used its image budget (${l0.count} of ${budget} images, about $${l0.spent.toFixed(2)}). Reuse existing images, or ask the user to raise "imageBudget" in project.json.`,
    );
  const { buf, model, cost, upscaled, note } = await gen(
    {
      prompt: full,
      refs: refFile ? [refFile] : [],
      aspect: req.aspect,
      ...(asked ? { model: asked } : {}),
      ...(req.upscale ? { upscale2k: true } : {}),
      ...(req.kind === "cutout" ? { extra: { background: "transparent" } } : {}),
    },
    dir,
  );
  const rawRel = `.suite/raw/${name}-${hash}.img`;
  fs.mkdirSync(path.join(dir, ".suite", "raw"), { recursive: true });
  fs.writeFileSync(path.join(dir, rawRel), buf);
  const { rgba, cover } = processImage(buf, req.kind, upscaled ? 2752 : 0);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePng(rgba));
  const entry = {
    file: rel,
    prompt: full,
    kind: req.kind,
    aspect: req.aspect,
    ref: req.ref ?? null,
    hash,
    model,
    cost,
    at: new Date().toISOString(),
    cover,
    size: [rgba.w, rgba.h],
    raw: rawRel,
    matte: MATTE_VERSION,
    ...(note ? { note } : {}),
  };
  const l = await serial(dir, async () => {
    const cur = ledger(dir);
    cur.images[name] = entry;
    cur.count++;
    cur.spent = +(cur.spent + cost).toFixed(4);
    writeJson(path.join(dir, "assets", "images.json"), cur);
    const p = readJson$e(path.join(dir, "project.json"), null);
    if (p && typeof p === "object") {
      p.images = { ...(p.images || {}), [name]: rel };
      writeJson(path.join(dir, "project.json"), p);
    }
    return cur;
  });
  return { name, file: out, rel, entry, cached: false, ledger: l, budget };
}
let bgra = null;
function bitmapIsBgra() {
  if (bgra == null) {
    const px = nativeImage.createFromBuffer(encodePng({ data: Buffer.from([255, 0, 0, 255]), w: 1, h: 1 })).toBitmap();
    bgra = px[2] > 200 && px[0] < 50;
  }
  return bgra;
}
function processImage(buf, kind, maxSide = 0) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error("The image came back in a format the app cannot read.");
  const { width: w, height: h } = img.getSize();
  const bmp = Buffer.from(img.toBitmap());
  let rgba = { data: bitmapIsBgra() ? bgraToRgba(bmp) : bmp, w, h },
    cover;
  if (kind === "cutout") {
    let clear = 0;
    for (let i = 3; i < rgba.data.length; i += 4 * 97) if (rgba.data[i] < 16) clear++;
    if (clear > (rgba.data.length / (4 * 97)) * 0.05) {
      let n = 0;
      for (let i = 3; i < rgba.data.length; i += 4) if (rgba.data[i] > 16) n++;
      cover = +(n / (w * h)).toFixed(3);
      rgba = shrink(rgba, 1024);
    } else {
      const m = matte(rgba);
      cover = +m.cover.toFixed(3);
      rgba = shrink(m, maxSide || 1024);
    }
  } else rgba = shrink(rgba, maxSide || 1600);
  return { rgba, cover };
}
export function cutoutWarning(e) {
  if (e.kind !== "cutout" || e.cover == null) return null;
  if (e.cover > 0.9)
    return 'The background was not removed (it was not flat white, or the subject fills the frame). Regenerate with a plainer background, or use kind "texture".';
  if (e.cover < 0.03) return "Almost nothing was left after removing the background (a very pale subject?). Check the image.";
  return null;
}
