import path from "node:path";
import cp from "node:child_process";
import { getConfig } from "../core/config";

export const ffmpegBin = () => getConfig().tools.ffmpeg || "ffmpeg";
export function ffprobeBin() {
  const f = ffmpegBin();
  if (!/[\\/]/.test(f)) return "ffprobe";
  return path.join(path.dirname(f), path.basename(f).replace(/ffmpeg/i, "ffprobe"));
}
export function probe(file) {
  return new Promise((res, rej) =>
    cp.execFile(
      ffprobeBin(),
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { windowsHide: true, maxBuffer: 8 << 20 },
      (e, out) => {
        if (e) return rej(new Error(`Could not read ${path.basename(file)}: ${String(e.message).split("\n")[0]}`));
        try {
          const j = JSON.parse(out),
            v = j.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic),
            a = j.streams.find((s) => s.codec_type === "audio");
          const rate = (r) => {
            const [n, d] = String(r || "0/1")
              .split("/")
              .map(Number);
            return d ? n / d : n;
          };
          const fps = v ? rate(v.avg_frame_rate) || rate(v.r_frame_rate) : 0;
          res({
            duration: +j.format.duration || +(v?.duration ?? 0) || 0,
            width: v?.width ?? 0,
            height: v?.height ?? 0,
            fps: Math.round(fps * 1e3) / 1e3,
            vcodec: v?.codec_name ?? null,
            pixfmt: v?.pix_fmt ?? null,
            audio: !!a,
            achannels: a?.channels ?? 0,
            arate: +(a?.sample_rate ?? 0),
            size: +j.format.size || 0,
            bitrate: +j.format.bit_rate || 0,
          });
        } catch (err) {
          rej(new Error(`Could not read ${path.basename(file)}: ${err.message}`));
        }
      },
    ),
  );
}
let enc = null;
const tryEncoder = (codec) =>
  new Promise((res) =>
    cp.execFile(
      ffmpegBin(),
      ["-v", "error", "-f", "lavfi", "-i", "color=black:s=256x256:r=30", "-frames:v", "3", "-c:v", codec, "-f", "null", "-"],
      { windowsHide: true, timeout: 2e4 },
      (e) => res(!e),
    ),
  );
export function encoders() {
  return (enc ??= (async () => {
    if (process.platform === "darwin" && (await tryEncoder("h264_videotoolbox")))
      return {
        name: "Apple VideoToolbox",
        gpu: true,
        hwaccel: ["-hwaccel", "videotoolbox"],
        h264: ["-c:v", "h264_videotoolbox", "-q:v", "62", "-allow_sw", "1", "-profile:v", "high"],
        hevc: ["-c:v", "hevc_videotoolbox", "-q:v", "58", "-allow_sw", "1", "-tag:v", "hvc1"],
      };
    if (process.platform !== "darwin" && (await tryEncoder("h264_nvenc")))
      return {
        name: "NVIDIA NVENC",
        gpu: true,
        hwaccel: ["-hwaccel", "cuda"],
        h264: [
          "-c:v",
          "h264_nvenc",
          "-preset",
          "p5",
          "-tune",
          "hq",
          "-rc",
          "vbr",
          "-cq",
          "19",
          "-b:v",
          "0",
          "-spatial-aq",
          "1",
          "-temporal-aq",
          "1",
          "-rc-lookahead",
          "32",
          "-profile:v",
          "high",
        ],
        hevc: [
          "-c:v",
          "hevc_nvenc",
          "-preset",
          "p5",
          "-tune",
          "hq",
          "-rc",
          "vbr",
          "-cq",
          "21",
          "-b:v",
          "0",
          "-spatial-aq",
          "1",
          "-temporal-aq",
          "1",
          "-rc-lookahead",
          "32",
          "-tag:v",
          "hvc1",
        ],
      };
    return {
      name: "CPU (x264)",
      gpu: false,
      hwaccel: [],
      h264: ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-profile:v", "high"],
      hevc: ["-c:v", "libx265", "-preset", "medium", "-crf", "21", "-tag:v", "hvc1"],
    };
  })());
}
export function runFF(args, o = {}) {
  return new Promise((res, rej) => {
    if (o.job?.cancelled) return rej(new Error("Cancelled"));
    const p = cp.spawn(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...args], {
      windowsHide: true,
      cwd: o.cwd,
    });
    if (o.job) o.job.proc = p;
    let err = "",
      buf = "",
      t0 = Date.now();
    p.stderr.on("data", (d) => {
      err = (err + d).slice(-4e3);
    });
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && o.duration && o.onProgress) {
          const s = +m[1] / 1e6;
          o.onProgress(Math.min(1, s / o.duration), s / Math.max(1e-3, (Date.now() - t0) / 1e3));
        }
      }
    });
    p.on("error", (e) => rej(new Error(`ffmpeg not found (${e.message}). Install ffmpeg or set its path in Settings.`)));
    p.on("close", (c) => {
      if (o.job) o.job.proc = null;
      if (o.job?.cancelled) rej(new Error("Cancelled"));
      else if (c === 0) res();
      else rej(new Error("ffmpeg failed: " + err.trim().split("\n").slice(-3).join(" | ").slice(-500)));
    });
  });
}
export function cancel(job) {
  job.cancelled = true;
  try {
    job.proc?.kill();
  } catch {}
}
