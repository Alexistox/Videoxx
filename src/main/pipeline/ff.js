import cp from "node:child_process";
import { getConfig } from "../core/config";

export function ff(args, ms = 6e4) {
  return new Promise((res, rej) => {
    const p = cp.spawn(getConfig().tools.ffmpeg || "ffmpeg", ["-y", "-hide_banner", "-v", "error", ...args], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d;
      if (err.length > 8e3) err = err.slice(-4e3);
    });
    const timer = setTimeout(() => {
      try {
        p.kill();
      } catch {}
      rej(new Error("ffmpeg took too long (over " + Math.round(ms / 1e3) + " s)."));
    }, ms);
    p.on("error", (e) => {
      clearTimeout(timer);
      rej(new Error(`ffmpeg not found (${e.message}). Install ffmpeg or set its path in Settings.`));
    });
    p.on("close", (c) => {
      clearTimeout(timer);
      c === 0 ? res() : rej(new Error("ffmpeg failed: " + err.trim().slice(-400)));
    });
  });
}
