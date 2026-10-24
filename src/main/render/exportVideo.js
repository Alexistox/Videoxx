import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import { getConfig } from "../core/config";
import { log } from "../core/log";
import { now, q, uid } from "../db/db";
import { GIF_WIDTH, baseOf, smoothScale } from "../styles/catalog";
import { exportSettings } from "../styles/graphicsControls";
import { voiceNotReady } from "../pipeline/steps";
import { fileStem } from "../core/fileStem";
import { HUNG, create, js } from "./workers";
import { projectDir } from "../projects/fileServer";

function ffmpeg(args, onSpawn) {
  return new Promise((res, rej) => {
    const p = cp.spawn(getConfig().tools.ffmpeg, ["-y", "-loglevel", "error", ...args], { windowsHide: true });
    onSpawn?.(p);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => rej(new Error(`ffmpeg not found (${e.message}). Install ffmpeg or set its path in Settings.`)));
    p.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg failed: " + err.slice(-400)))));
  });
}
const exportJobs = new Map();
export const exportsRunning = () => exportJobs.size;
export function exportUsing(projectId) {
  for (const [id, j] of exportJobs) if (id === projectId || j.uses.includes(projectId)) return id;
  return null;
}
export function cancelAllExports() {
  for (const id of [...exportJobs.keys()]) cancelExport(id);
}
export function cancelExport(projectId) {
  const j = exportJobs.get(projectId);
  if (!j || j.cancelled) return false;
  j.cancelled = true;
  j.kill?.();
  if (j.worker && !j.worker.win.isDestroyed()) j.worker.win.destroy();
  j.stop(new Error("Export cancelled"));
  return true;
}
export function beginExport(projectId, uses = []) {
  const job = { cancelled: false, rendering: false, uses };
  const stopped = new Promise((_, rej) => (job.stop = rej));
  stopped.catch(() => {});
  exportJobs.set(projectId, job);
  const ff = (args) => Promise.race([ffmpeg(args, (p) => (job.kill = () => p.kill())), stopped]);
  return {
    job,
    stopped,
    ff,
    end: () => {
      if (exportJobs.get(projectId) === job) exportJobs.delete(projectId);
    },
  };
}
export const NO_SHOTS =
  "This video has no shots to render: its scenes failed to load, or there are none yet. Fix the error the editor shows (or build the video) first.";
const sceneHung = (at, where) =>
  `A scene stopped responding at about ${at}${where ? ` (${where})` : ""} while the video was exporting, most likely a loop that never ends. Ask Claude to check the scene at ${at} for a loop that never finishes, then export again.`;
const mmss = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
};
export async function renderFrames(projectId, x, o, onFrame) {
  const w = (x.job.worker = create(projectId, o.settings, o.view, !!o.swenc));
  let watchdog,
    retry = false;
  try {
    await Promise.race([w.ready, x.stopped]);
    if (o.requireShots && !(await js(w.win, "window.suite && window.suite.info() ? window.suite.info().shots.length : 0", 15e3)))
      throw new Error(NO_SHOTS);
    x.job.rendering = true;
    let last2 = Date.now();
    let first = true,
      frame = 0,
      where = "";
    w.progress = (s) => {
      first = false;
      last2 = Date.now();
      const [head, shot = ""] = s.split(" |");
      const [, f, n, r] = head.split(" ");
      frame = +f;
      where = shot;
      onFrame(+f, +n, +r);
    };
    const stall = new Promise((_, rej) => {
      watchdog = setInterval(async () => {
        if (Date.now() - last2 <= (+process.env.CZ_EXPORT_STALL_MS || (first ? 18e4 : 12e4))) return;
        clearInterval(watchdog);
        const alive = await Promise.race([
          w.win.webContents.executeJavaScript("1").then(
            () => true,
            () => false,
          ),
          new Promise((r) => setTimeout(() => r(false), 5e3)),
        ]);
        const at = mmss(o.from + frame / o.fps);
        if (alive && !o.swenc) {
          retry = true;
          rej(new Error("retry with the software encoder"));
        } else if (alive)
          rej(
            new Error(
              `${HUNG.replace(" It will be restarted for the next job.", "")} It stopped at ${at}, even with the slower software video encoder.`,
            ),
          );
        else rej(new Error(sceneHung(at, where)));
      }, 5e3);
    });
    const res = await Promise.race([
      w.win.webContents.executeJavaScript(
        `window.suite.exportVideo(${JSON.stringify({
          name: o.name,
          fps: o.fps,
          from: o.from,
          to: o.to,
          bitrate: o.bitrate || 16e6,
          ...(o.clean ? { clean: o.clean } : {}),
        })})`,
      ),
      x.stopped,
      stall,
    ]);
    return { ...res, h264: path.join(projectDir(projectId), "out", `${o.name}.h264`) };
  } catch (e) {
    if (!retry || x.job.cancelled) throw e;
    log(`export ${o.name}: the graphics card's video encoder stopped answering; retrying with the software encoder`);
  } finally {
    clearInterval(watchdog);
    w.progress = void 0;
    x.job.rendering = false;
    if (!w.win.isDestroyed()) w.win.destroy();
  }
  return renderFrames(projectId, x, { ...o, swenc: true }, onFrame);
}
function soundtrack(dir) {
  const mt = (f) => {
    try {
      return fs.statSync(path.join(dir, f)).mtimeMs;
    } catch {
      return 0;
    }
  };
  const mixFresh = mt("audio/final_mix.wav") > 0 && mt("audio/final_mix.wav") >= mt("audio/clean.wav");
  return (
    [...(mixFresh ? ["audio/final_mix.wav"] : []), "audio/clean.wav"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f)) ?? null
  );
}
export function soundtrackCopy(dir, to) {
  const src = soundtrack(dir);
  if (!src) return null;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(src, to, fs.constants.COPYFILE_FICLONE);
  return to;
}
export async function exportVideo(projectId, opts, onProgress) {
  const dir = projectDir(projectId);
  const notReady = opts.internal ? null : voiceNotReady(dir, "video");
  if (notReady) throw new Error(notReady);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^\uFEFF/, ""));
  const base = fileStem(opts.name) || "video",
    fps = opts.fps || 30,
    from = opts.from || 0,
    to = opts.to || pj.end;
  const taken = (n) => [`${n}.mp4`, `${n}_4k.mp4`, `${n}.gif`].some((f) => fs.existsSync(path.join(dir, "out", f)));
  let name = base;
  if (!opts.internal) for (let i = 2; taken(name); i++) name = `${base}_${i}`;
  const id = uid("ren_");
  q.run(
    "INSERT INTO renders(id,project_id,kind,status,progress,created_at) VALUES(?,?,?,?,?,?)",
    id,
    projectId,
    opts.internal ? "style-preview" : "video",
    "running",
    0,
    now(),
  );
  const t0 = Date.now();
  const h264 = path.join(dir, "out", `${name}.h264`),
    mp4 = path.join(dir, "out", `${name}.mp4`),
    uhdFile = path.join(dir, "out", `${name}_4k.mp4`);
  const { job, stopped, ff, end } = beginExport(projectId);
  let mix = null;
  try {
    mix = soundtrackCopy(dir, path.join(dir, "out", `.${name}.soundtrack.wav`));
    const settings = baseOf(pj.style) === "recon" ? exportSettings(opts.quality, pj.settings) : null;
    const res = await renderFrames(
      projectId,
      { job, stopped },
      { name, fps, from, to, bitrate: opts.bitrate, ...(settings ? { settings } : {}) },
      (f, n, r) => {
        onProgress({ frame: f, frames: n, fps: r });
        q.run("UPDATE renders SET progress=? WHERE id=?", f / Math.max(1, n), id);
      },
    );
    onProgress({ frame: 1, frames: 1, fps: 0, phase: "Adding the soundtrack" });
    const audioIn = mix
      ? [
          ...(from > 0 ? ["-ss", from.toFixed(3)] : []),
          "-t",
          (to - from).toFixed(3),
          "-i",
          mix,
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-af",
          "apad",
          "-c:a",
          "aac",
          "-b:a",
          "256k",
          "-t",
          (to - from).toFixed(3),
        ]
      : [];
    await ff(["-r", String(fps), "-i", h264, ...audioIn, "-c:v", "copy", "-movflags", "+faststart", mp4]);
    fs.rmSync(h264, { force: true });
    let final = mp4;
    if (opts.uhd) {
      onProgress({ frame: 0, frames: 1, fps: 0, phase: "Upscaling to 4K" });
      const smooth = smoothScale(pj.style),
        vert = pj.settings?.format === "vertical" || (pj.style === "vox" && pj.settings?.format !== "landscape");
      const vf = [
        "-vf",
        vert ? "scale=2160:3840:flags=lanczos" : smooth ? "scale=3840:2160:flags=lanczos" : "scale=3840:2160:flags=neighbor",
      ];
      await ff([
        "-i",
        mp4,
        ...vf,
        ...(process.platform === "darwin"
          ? ["-c:v", "h264_videotoolbox", "-b:v", "45M"]
          : ["-c:v", "h264_nvenc", "-preset", "p5", "-b:v", "45M"]),
        "-maxrate",
        "60M",
        "-bufsize",
        "90M",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        uhdFile,
      ]).catch((e) => {
        if (job.cancelled) throw e;
        return ff([
          "-i",
          mp4,
          ...vf,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "16",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          uhdFile,
        ]);
      });
      final = uhdFile;
    }
    let gif = null;
    if (opts.gif) {
      onProgress({ frame: 0, frames: 1, fps: 0, phase: "Making the GIF" });
      gif = mp4.replace(/\.mp4$/, ".gif");
      await ff([
        "-i",
        mp4,
        "-vf",
        (smoothScale(pj.style)
          ? `fps=15,scale=${GIF_WIDTH.smooth}:-1:flags=lanczos,split`
          : `fps=15,scale=${GIF_WIDTH.hard}:-1:flags=neighbor,split`) +
          "[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
        "-loop",
        "0",
        gif,
      ]);
    }
    let srt = null;
    const cap = path.join(dir, "audio", "captions.srt");
    if (opts.captions && from === 0 && fs.existsSync(cap)) {
      srt = final.replace(/\.mp4$/, ".srt");
      fs.copyFileSync(cap, srt);
    }
    const secs = (Date.now() - t0) / 1e3;
    q.run(
      "UPDATE renders SET status=?, progress=1, path=?, seconds=?, message=?, finished_at=? WHERE id=?",
      "done",
      final,
      secs,
      `${res.frames} frames at ${res.fps} fps (${res.realtime}x realtime)${opts.uhd ? ", 4K upscale" : ""}${gif ? ", GIF" : ""}${mix ? "" : ", no audio"}${srt ? ", captions" : ""}`,
      now(),
      id,
    );
    q.run("UPDATE projects SET status='ready', updated_at=? WHERE id=?", now(), projectId);
    return { id, path: final, hd: mp4, srt, gif, frames: res.frames, fps: res.fps, realtime: res.realtime, seconds: secs, audio: !!mix };
  } catch (e) {
    if (job.cancelled) {
      for (const f of [h264, mp4, uhdFile, mp4.replace(/\.mp4$/, ".gif")]) fs.rmSync(f, { force: true });
      q.run("UPDATE renders SET status=?, message=?, finished_at=? WHERE id=?", "cancelled", "Cancelled", now(), id);
      throw new Error("Export cancelled");
    }
    q.run("UPDATE renders SET status=?, message=?, finished_at=? WHERE id=?", "failed", String(e.message || e), now(), id);
    throw e;
  } finally {
    end();
    if (mix) fs.rmSync(mix, { force: true });
  }
}
