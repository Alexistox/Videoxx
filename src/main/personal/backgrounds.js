import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { templatesDir, ws } from "../core/workspace";

const userBgDir = () => path.join(ws.root(), "backgrounds");
const builtinBgDir = () => path.join(templatesDir(), "personal", "backgrounds");
export function listBackgrounds() {
  const b = fs.existsSync(builtinBgDir())
    ? fs
        .readdirSync(builtinBgDir())
        .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
        .map((f) => ({ id: `builtin:${f.replace(/\.[^.]+$/, "")}`, name: f.replace(/\.[^.]+$/, ""), builtin: true }))
    : [];
  const u = fs.existsSync(userBgDir())
    ? fs
        .readdirSync(userBgDir())
        .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
        .map((f) => ({ id: `user:${f}`, name: f.replace(/^[0-9a-f]{8}-/, "").replace(/\.[^.]+$/, ""), builtin: false }))
    : [];
  return [...b, ...u];
}
export function addBackground(file) {
  if (!/\.(jpe?g|png|webp)$/i.test(file) || !fs.existsSync(file)) throw new Error("Pick a JPG, PNG or WebP image.");
  const h = crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
  const name = `${h}-${path.basename(file).replace(/[^\w.-]+/g, "_")}`;
  fs.mkdirSync(userBgDir(), { recursive: true });
  fs.copyFileSync(file, path.join(userBgDir(), name));
  return `user:${name}`;
}
function backgroundFile(ref) {
  if (!ref) return null;
  const [kind, name] = ref.split(/:(.+)/);
  if (!name || name.includes("..") || /[\\/]/.test(name)) return null;
  const f =
    kind === "builtin"
      ? ["jpg", "png", "webp"].map((e) => path.join(builtinBgDir(), `${name}.${e}`)).find((x) => fs.existsSync(x))
      : kind === "user"
        ? path.join(userBgDir(), name)
        : null;
  return f && fs.existsSync(f) ? f : null;
}
const bgCache = new Map();
export function backgroundData(ref) {
  const f = backgroundFile(ref);
  if (!f) return null;
  const key2 = f + fs.statSync(f).mtimeMs;
  if (bgCache.has(key2)) return bgCache.get(key2);
  const ext = path.extname(f).slice(1).toLowerCase().replace("jpg", "jpeg");
  const d = `data:image/${ext};base64,${fs.readFileSync(f).toString("base64")}`;
  bgCache.set(key2, d);
  return d;
}
