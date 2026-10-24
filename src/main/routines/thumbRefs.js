import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { app, nativeImage } from "electron";

export const MAX_THUMB_REFS = 5;
const refsRoot = () => path.join(app.getPath("userData"), "thumb-refs");
const ID = /^[a-f0-9]{16}\.(png|jpg|webp)$/;
export function refFile(id) {
  if (!ID.test(String(id ?? ""))) return null;
  const f = path.join(refsRoot(), id);
  return fs.existsSync(f) ? f : null;
}
export function addRefs(files) {
  fs.mkdirSync(refsRoot(), { recursive: true });
  const out = [];
  for (const src of files) {
    const ext = path.extname(src).toLowerCase().replace(".jpeg", ".jpg");
    if (![".png", ".jpg", ".webp"].includes(ext)) throw new Error(`${path.basename(src)}: use PNG, JPEG or WebP pictures.`);
    if (fs.statSync(src).size > 40 * 1024 * 1024) throw new Error(`${path.basename(src)} is over 40 MB.`);
    const buf = fs.readFileSync(src);
    if (ext !== ".webp" && nativeImage.createFromBuffer(buf).isEmpty())
      throw new Error(`${path.basename(src)} is not a picture the app can read.`);
    const id = `${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16)}${ext}`,
      f = path.join(refsRoot(), id);
    if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
    else fs.utimesSync(f, new Date(), new Date());
    out.push({ id, name: path.basename(src).slice(0, 120) });
  }
  return out;
}
export function refPreviews(ids) {
  return (Array.isArray(ids) ? ids : []).slice(0, 20).map((id) => {
    const f = refFile(String(id));
    if (!f) return { id: String(id), url: null };
    return { id: String(id), url: previewUrl(f) };
  });
}
export function previewUrl(f, width = 320) {
  let img = nativeImage.createFromPath(f);
  if (img.isEmpty()) return null;
  if (img.getSize().width > width) img = img.resize({ width, quality: "good" });
  return `data:image/jpeg;base64,${img.toJPEG(82).toString("base64")}`;
}
export const refIds = () => {
  try {
    return fs.readdirSync(refsRoot()).filter((f) => ID.test(f));
  } catch {
    return [];
  }
};
export function pruneRefs(inUse) {
  for (const e of refIds()) {
    if (inUse.has(e)) continue;
    const f = path.join(refsRoot(), e);
    try {
      if (Date.now() - fs.statSync(f).mtimeMs < 864e5) continue;
      fs.rmSync(f, { force: true });
    } catch {}
  }
}
