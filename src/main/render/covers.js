import path from "node:path";
import fs from "node:fs";
import { BrowserWindow, nativeImage } from "electron";
import { closeWorker, hostState, js, renderStills, seal, workers } from "./workers";
import { projectDir, projectUrl } from "../projects/fileServer";

export async function previewSettings(projectId, settings, t) {
  const win = seal(
    new BrowserWindow({
      show: false,
      width: 960,
      height: 540,
      webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true },
    }),
  );
  try {
    await win.loadURL(projectUrl(projectId, `__suite/host.html?mode=render&settings=${encodeURIComponent(JSON.stringify(settings))}`));
    for (let i = 0; i < 600 && !(await js(win, "window.ready === true", 15e3)); i++) await new Promise((r) => setTimeout(r, 100));
    const err = await js(win, "window.bootError || null", 5e3);
    if (err) throw new Error(err);
    const [url] = await js(win, `window.suite.stills([${t}], .5)`, 3e4);
    return url;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
export async function saveFrame(projectId, t) {
  const [s] = await renderStills(projectId, [t], 1, "saved");
  const m = Math.floor(t / 60),
    sec = (t - m * 60).toFixed(2).padStart(5, "0").replace(".", "_");
  const dst = path.join(projectDir(projectId), "out", `frame_${m}m${sec}s.png`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(s.file, dst);
  return dst;
}
export async function thumbnail(projectId, t) {
  const [s] = await renderStills(projectId, [t], 0.5, "thumb");
  if (!s.file) throw new Error("That frame threw an error.");
  const sd = path.join(projectDir(projectId), ".suite"),
    dst = path.join(sd, "cover.jpg"),
    tmp = dst + ".part";
  let img = nativeImage.createFromPath(s.file);
  const { width, height } = img.getSize();
  if (Math.max(width, height) > 640) img = img.resize(width >= height ? { width: 640, quality: "good" } : { height: 640, quality: "good" });
  fs.writeFileSync(tmp, img.toJPEG(80));
  fs.renameSync(tmp, dst);
  fs.rmSync(path.join(sd, "thumb.png"), { force: true });
  fs.rmSync(path.join(sd, "frames", "thumb"), { recursive: true, force: true });
  return dst;
}
export function coverFile(dir) {
  const s = path.join(dir, ".suite");
  if (!fs.existsSync(s)) return null;
  const files = fs.readdirSync(s);
  return files.find((f) => /^thumbnail\.(png|jpe?g|webp)$/i.test(f)) ?? ["cover.jpg", "thumb.png"].find((f) => files.includes(f)) ?? null;
}
export async function refreshCover(projectId) {
  const had = workers.has(projectId);
  try {
    const st = await hostState(projectId, true);
    if (!st.info?.shots?.length || st.bootError) return false;
    await thumbnail(projectId, Math.min((st.info.end || 0) * 0.3, 20));
    return true;
  } finally {
    if (!had) closeWorker(projectId);
  }
}
const coverTried = new Set(),
  coverQueue = [];
let coverBusy = false;
export function ensureCovers(projects, done) {
  const fresh = [];
  for (const p of projects)
    if (!coverTried.has(p.id) && ((p.shots ?? 0) > 0 || (p.duration ?? 0) > 0) && fs.existsSync(p.path) && !coverFile(p.path)) {
      coverTried.add(p.id);
      fresh.push(p.id);
    }
  coverQueue.unshift(...fresh);
  if (coverBusy) return;
  coverBusy = true;
  (async () => {
    for (let id; (id = coverQueue.shift());) {
      const had = workers.has(id);
      try {
        const st = await hostState(id);
        if (st.info?.shots?.length && !st.bootError && !st.errors?.some((e) => e.level === "error")) {
          await thumbnail(id, Math.min((st.info.end || 0) * 0.3, 20));
          done(id);
        }
      } catch {}
      if (!had) closeWorker(id);
    }
  })().finally(() => {
    coverBusy = false;
  });
}
