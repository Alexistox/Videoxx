import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import { log } from "../core/log";
import { cancel, encoders, ffmpegBin, runFF } from "../pipeline/ffmpeg";
import { getPersonal } from "./personalProjects";
import { playsDirect, readMedia, update } from "./media";

const queue = [];
export const jobs = new Map();
let running = false;
export function cancelProject(projectId) {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].projectId === projectId) queue.splice(i, 1);
  let p = null;
  try {
    p = getPersonal(projectId);
  } catch {
    return;
  }
  for (const m of readMedia(p)) {
    const j = jobs.get(m.id);
    if (j) cancel(j);
  }
}
export function playFailed(projectId, mediaId, why) {
  const m = readMedia(getPersonal(projectId)).find((x) => x.id === mediaId);
  if (!m || m.proxyState !== "direct") return;
  log("player cannot use the original, making a preview copy", m.name, why);
  update(projectId, mediaId, { proxyState: "pending", proxyError: void 0 });
  queueProxy(projectId, mediaId);
}
export function queueProxy(projectId, mediaId) {
  if (!queue.some((q) => q.mediaId === mediaId)) queue.push({ projectId, mediaId });
  pump();
}
export function resumeProxies(projectId) {
  const p = getPersonal(projectId);
  for (const m of readMedia(p)) {
    const ok = m.proxy && fs.existsSync(path.join(p.path, m.proxy));
    if (m.width && (m.proxyState === "pending" || m.proxyState === "working") && playsDirect(m.file, m.vcodec) && !m.proxyError) {
      const job = jobs.get(m.id);
      if (job) cancel(job);
      const i = queue.findIndex((q) => q.mediaId === m.id);
      if (i >= 0) queue.splice(i, 1);
      update(projectId, m.id, { proxyState: "direct", progress: void 0 });
      continue;
    }
    if (m.width && (m.proxyState === "pending" || m.proxyState === "working" || (m.proxyState === "ready" && !ok))) {
      if (m.proxyState !== "pending") update(projectId, m.id, { proxyState: "pending" });
      queueProxy(projectId, m.id);
    }
  }
}
async function pump() {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = true;
  try {
    await makeProxy(next.projectId, next.mediaId);
  } catch (e) {
    log("proxy failed", next.mediaId, e?.message);
  } finally {
    running = false;
    pump();
  }
}
async function makeProxy(projectId, mediaId) {
  let p;
  try {
    p = getPersonal(projectId);
  } catch {
    return;
  }
  const m = readMedia(p).find((x) => x.id === mediaId);
  if (!m || !fs.existsSync(m.file)) {
    if (m) update(projectId, mediaId, { proxyState: "failed", proxyError: "The file is missing." });
    return;
  }
  const rel = `.suite/proxy/${m.id}.mp4`,
    out = path.join(p.path, rel),
    tmp = out + ".part.mp4";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const e = await encoders(),
    job = { proc: null, cancelled: false };
  jobs.set(mediaId, job);
  update(projectId, mediaId, { proxyState: "working", progress: 0 });
  const g = String(Math.max(1, Math.round(Math.min(60, m.fps || 30) / 2)));
  const vf = `scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2${m.fps > 60 ? ",fps=60" : ""},format=yuv420p`;
  const venc = e.name.startsWith("NVIDIA")
    ? ["-c:v", "h264_nvenc", "-preset", "p3", "-rc", "vbr", "-cq", "26", "-b:v", "0", "-maxrate", "14M", "-bufsize", "28M", "-bf", "0"]
    : e.name.startsWith("Apple")
      ? ["-c:v", "h264_videotoolbox", "-b:v", "8M", "-allow_sw", "1"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-bf", "0"];
  let last2 = 0;
  const size = `w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const tiers = [
    ...(e.name.startsWith("NVIDIA")
      ? [
          {
            pre: ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"],
            vf: `scale_cuda=${size}:format=yuv420p${m.fps > 60 ? ",fps=60" : ""}`,
          },
        ]
      : []),
    ...(e.hwaccel.length ? [{ pre: e.hwaccel, vf }] : []),
    { pre: [], vf },
  ];
  const args = (t) => [
    ...t.pre,
    "-i",
    m.file,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    t.vf,
    ...venc,
    "-g",
    g,
    "-keyint_min",
    g,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    tmp,
  ];
  const onProgress = (f) => {
    if (f - last2 > 0.02 || f === 1) {
      last2 = f;
      update(projectId, mediaId, { progress: Math.round(f * 100) });
    }
  };
  try {
    for (let i = 0; ; i++) {
      try {
        await runFF(args(tiers[i]), { duration: m.duration, onProgress, job });
        break;
      } catch (err) {
        if (job.cancelled || i === tiers.length - 1) throw err;
        log("proxy: falling back", m.name, String(err.message).slice(0, 160));
      }
    }
    fs.renameSync(tmp, out);
    update(projectId, mediaId, { proxy: rel, proxyState: "ready", progress: 100, proxyError: void 0 });
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (!job.cancelled) update(projectId, mediaId, { proxyState: "failed", proxyError: String(err.message).slice(0, 300) });
  } finally {
    jobs.delete(mediaId);
  }
}
export async function waveform(projectId, mediaId) {
  const p = getPersonal(projectId),
    m = readMedia(p).find((x) => x.id === mediaId);
  if (!m || !m.audio) return null;
  const src = m.proxy && fs.existsSync(path.join(p.path, m.proxy)) ? path.join(p.path, m.proxy) : m.file;
  const cache = path.join(p.path, ".suite", `wave-${m.id}.json`);
  try {
    const c = JSON.parse(fs.readFileSync(cache, "utf8"));
    if (c.file === m.file) return c;
  } catch {}
  const perSecond = 100,
    rate = 8e3,
    hop = rate / perSecond;
  const peaks = await new Promise((res, rej) => {
    const pr = cp.spawn(ffmpegBin(), ["-v", "error", "-i", src, "-map", "0:a:0", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], {
      windowsHide: true,
    });
    const out = [];
    let carry = Buffer.alloc(0),
      max = 0,
      n = 0;
    pr.stdout.on("data", (d) => {
      const b = carry.length ? Buffer.concat([carry, d]) : d,
        len = b.length & -2;
      for (let i = 0; i < len; i += 2) {
        const v = Math.abs(b.readInt16LE(i));
        if (v > max) max = v;
        if (++n === hop) {
          out.push(Math.round(max / 327.68));
          max = 0;
          n = 0;
        }
      }
      carry = b.subarray(len);
    });
    pr.on("error", rej);
    pr.on("close", (c) => (c === 0 ? res(out) : rej(new Error("Could not read the audio for the waveform."))));
  });
  const w = { file: m.file, perSecond, peaks };
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(w));
  return w;
}
