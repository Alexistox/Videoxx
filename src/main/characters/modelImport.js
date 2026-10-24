import path from "node:path";
import fs from "node:fs";
import { BrowserWindow } from "electron";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";

export const MODEL_EXT = ["glb", "gltf", "fbx", "obj", "dae", "stl", "ply", "3mf", "zip"];
export const SIDE_EXT = ["bin", "mtl", "png", "jpg", "jpeg", "tga", "bmp", "webp", "gif"];
const MAX_BYTES = 400 * 1024 * 1024;
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const isModelFile = (f) => MODEL_EXT.includes(extOf(f));
const slug = (s) =>
  s
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 60) || "model";
function freeName(dir, name, ext) {
  for (let i = 1; ; i++) {
    const f = path.join(dir, `${name}${i > 1 ? `-${i}` : ""}${ext}`);
    if (!fs.existsSync(f)) return f;
  }
}
function resourcesOf(file, dropped) {
  const out = new Set(dropped.filter((f) => SIDE_EXT.includes(extOf(f))));
  const scan = (d, depth) => {
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      return;
    }
    if (names.length > 300) return;
    for (const n of names) {
      const f = path.join(d, n);
      let st;
      try {
        st = fs.statSync(f);
      } catch {
        continue;
      }
      if (st.isFile() && SIDE_EXT.includes(extOf(n))) out.add(f);
      else if (st.isDirectory() && depth === 0 && /tex|image|material|map/i.test(n)) scan(f, 1);
    }
  };
  if (["gltf", "obj", "fbx", "dae"].includes(extOf(file))) scan(path.dirname(file), 0);
  return [...out];
}
function plainGlb(file) {
  try {
    const b = fs.readFileSync(file);
    if (b.readUInt32LE(0) !== 1179937895) return false;
    const len = b.readUInt32LE(12),
      json = JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
    const used = json.extensionsUsed || [];
    return !used.some((e) => /draco|meshopt|texture_basisu|texture_webp|texture_avif/i.test(e));
  } catch {
    return false;
  }
}
let queue = Promise.resolve();
async function convertInWindow(main, resources) {
  const files = {};
  let total = 0;
  for (const f of [main, ...resources]) {
    const st = fs.statSync(f);
    total += st.size;
    if (total > MAX_BYTES) break;
    files[path.basename(f)] = fs.readFileSync(f).toString("base64");
  }
  const win = new BrowserWindow({
    show: false,
    width: 300,
    height: 300,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  try {
    await win.loadFile(path.join(templatesDir(), "modelconv", "convert.html"));
    for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript("window.ready === true")); i++)
      await new Promise((r2) => setTimeout(r2, 100));
    const job = win.webContents.executeJavaScript(`window.convert(${JSON.stringify({ main: path.basename(main), files })})`);
    const r = await Promise.race([
      job,
      new Promise((_, rej) => setTimeout(() => rej(new Error("the conversion took longer than 3 minutes")), 18e4)),
    ]);
    return { glb: Buffer.from(r.glb, "base64"), thumb: r.thumb, info: r.info };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
export function importModels(projectDir, paths) {
  const run = async () => {
    const dest = path.join(projectDir, "assets", "models");
    fs.mkdirSync(dest, { recursive: true });
    const out = [];
    for (const src of paths.filter(isModelFile)) {
      const name = slug(path.basename(src)),
        e = extOf(src);
      try {
        if (fs.statSync(src).size > MAX_BYTES) throw new Error("the file is bigger than 400 MB");
        if (e === "glb" && plainGlb(src)) {
          const f2 = freeName(dest, name, ".glb");
          fs.copyFileSync(src, f2);
          let info, thumb;
          try {
            const r2 = await convertInWindow(src, []);
            info = r2.info;
            thumb = saveThumb(projectDir, f2, r2.thumb);
          } catch {}
          out.push({ source: src, file: f2, converted: false, info, thumb });
          continue;
        }
        const r = await convertInWindow(src, resourcesOf(src, paths));
        const f = freeName(dest, name, ".glb");
        fs.writeFileSync(f, r.glb);
        out.push({ source: src, file: f, converted: true, info: r.info, thumb: saveThumb(projectDir, f, r.thumb) });
      } catch (err) {
        log("model import: could not convert", src, err?.message);
        const od = freeName(path.join(dest, "originals"), name, "");
        fs.mkdirSync(od, { recursive: true });
        for (const f of [src, ...(e === "zip" ? [] : resourcesOf(src, paths))])
          try {
            fs.copyFileSync(f, path.join(od, path.basename(f)));
          } catch {}
        out.push({
          source: src,
          file: path.join(od, path.basename(src)),
          converted: false,
          error: String(err?.message || err).replace(/^Error invoking remote method[^:]*:\s*/, ""),
        });
      }
    }
    return out;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
function saveThumb(projectDir, glb, dataUrl) {
  if (!dataUrl?.startsWith("data:image/png;base64,")) return void 0;
  const d = path.join(projectDir, ".suite", "models");
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, path.basename(glb, ".glb") + ".png");
  fs.writeFileSync(f, Buffer.from(dataUrl.split(",")[1], "base64"));
  return f;
}
export function modelNote(m) {
  if (m.error)
    return `Could not be converted automatically (${m.error}). The original is kept at ${m.file}: convert it to an uncompressed .glb in assets/models yourself (three.js loaders + GLTFExporter in node, or any tool already installed), then use that.`;
  const i = m.info;
  if (!i) return "Already an uncompressed .glb.";
  return (
    `${i.meshes} mesh${i.meshes === 1 ? "" : "es"}, ${i.triangles} triangles, size ${i.size.join(" x ")} (model units)` +
    (i.skinned ? `, rigged (${i.bones} bones${i.humanoid ? ", looks like a humanoid character" : ""})` : "") +
    (i.animations.length ? `, animations: ${i.animations.slice(0, 12).join(", ")}` : "") +
    (i.missing.length ? `; textures not found: ${i.missing.slice(0, 8).join(", ")}` : "")
  );
}
