import fs from "node:fs";

const IGNORED = /^(\.git|\.suite|out|node_modules)([\\/]|$)|\.(h264|tmp|swp)$|~$/;
const RELOADS = /\.(js|json|md|png|jpe?g|webp|svg|gif|mp4|webm|mov|mp3|ogg|ttf|otf|woff2?)$/i;
let watcher = null,
  timer = null,
  watching = null;
let pending = new Set();
const quiet = new Map();
export function quietWrite(rel, ms = 2500) {
  quiet.set(rel.replace(/\\/g, "/"), Date.now() + ms);
}
const isQuiet = (f) => (quiet.get(f) ?? 0) > Date.now();
export function watchProject(projectId, dir, onChange) {
  if (watching === projectId) return;
  unwatch();
  watching = projectId;
  try {
    watcher = fs.watch(dir, { recursive: true }, (_ev, file) => {
      if (!file) return;
      const rel = String(file).replace(/\\/g, "/");
      if (IGNORED.test(rel)) return;
      pending.add(rel);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const files = [...pending];
        pending = new Set();
        const reload = files.some(
          (f) =>
            (!isQuiet(f) && RELOADS.test(f) && !/^(CLAUDE|STYLE|storyboard)\.md$/.test(f) && !f.startsWith("audio/")) ||
            f === "audio/timeline.json",
        );
        onChange(projectId, files, reload);
      }, 350);
    });
    watcher.on("error", (err) => {
      console.warn("file watcher error, watching again:", err?.message);
      unwatch();
      setTimeout(() => {
        if (!watching && fs.existsSync(dir)) watchProject(projectId, dir, onChange);
      }, 500);
    });
  } catch {
    watching = null;
  }
}
export function unwatchProject(projectId) {
  if (watching === projectId) unwatch();
}
export function unwatch() {
  watcher?.close();
  watcher = null;
  watching = null;
  if (timer) clearTimeout(timer);
  pending = new Set();
}
