import path from "node:path";
import fs from "node:fs";
import { log } from "../core/log";
import { now, q, uid } from "../db/db";
import { cancel, encoders, runFF } from "../pipeline/ffmpeg";
import { camTime, layoutTimeline } from "./timeline";
import { getPersonal, readPlan } from "./personalProjects";
import { readMedia } from "./media";
import { mediaInfo, readEdit } from "./edit";
import { buildAudio } from "./buildAudio";

function camCrop(vw, vh, bw, bh, zoom, fx, fy) {
  const a = bw / bh;
  let cw = vw,
    ch = vw / a;
  if (ch > vh) {
    ch = vh;
    cw = vh * a;
  }
  cw /= zoom;
  ch /= zoom;
  const cx = Math.min(vw - cw / 2, Math.max(cw / 2, fx * vw)),
    cy = Math.min(vh - ch / 2, Math.max(ch / 2, fy * vh));
  return { sx: cx - cw / 2, sy: cy - ch / 2, sw: cw, sh: ch };
}
export const PRESETS = [
  { id: "yt1080", label: "YouTube 1080p (H.264)", height: 1080, codec: "h264", maxrate: 24 },
  { id: "yt1440", label: "YouTube 1440p (H.264, sharper on YouTube)", height: 1440, codec: "h264", maxrate: 40 },
  { id: "uhd", label: "4K (HEVC)", height: 2160, codec: "hevc", maxrate: 60 },
  { id: "small", label: "Small file 1080p (HEVC)", height: 1080, codec: "hevc", maxrate: 12 },
];
const jobs = new Map();
export function cancelRender(projectId) {
  const j = jobs.get(projectId);
  if (!j) return false;
  j.cancelled = true;
  for (const s of j.subs) cancel(s);
  return true;
}
const dataUrlToFile = (d, f) => {
  const m = /^data:image\/png;base64,(.+)$/.exec(d);
  if (!m) throw new Error("Bad render asset");
  fs.writeFileSync(f, Buffer.from(m[1], "base64"));
};
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
const ranges = (list) => (list.length ? list.map(([a, b]) => `between(n\\,${a}\\,${b - 1})`).join("+") : "0");
function planChunks(segs, F, chunkSec = 60) {
  const max = Math.max(F * 2, Math.round(chunkSec * F)),
    items = [];
  for (const s of segs) {
    const k0 = Math.round(s.start * F),
      k1 = Math.round(s.end * F);
    for (let a = k0; a < k1; a += max) items.push({ s, k0: a, k1: Math.min(k1, a + max), off: a - k0 });
  }
  const chunks = [];
  let cur = [],
    n = 0;
  for (const it of items) {
    if (cur.length && (n + it.k1 - it.k0 > max * 1.25 || cur.length >= 40)) {
      chunks.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(it);
    n += it.k1 - it.k0;
  }
  if (cur.length) chunks.push(cur);
  return { chunks, frames: items.length ? items[items.length - 1].k1 : 0 };
}
function buildChunk(items, media, cams, A, F, gpu = false) {
  const W = A.W,
    H = A.H,
    sb = A.screen,
    cb = A.cam,
    K0 = items[0].k0,
    N = items[items.length - 1].k1 - K0;
  const scr = [],
    cam = [],
    full = [],
    camOn = [],
    fullOn = [];
  for (const { s, k0: a0, k1: a1, off } of items) {
    const k0 = a0 - K0,
      k1 = a1 - K0,
      n = k1 - k0;
    if (n <= 0) continue;
    const m = media.get(s.clip.src),
      tin = s.clip.in + off / F;
    if (s.role === "screen") {
      scr.push({ src: m.id, t: tin, n });
      full.push({ src: null, t: 0, n });
      const sync = s.cam ? cams[s.cam] : null,
        cm = s.cam ? media.get(s.cam) : null;
      if (A.camVisible && sync && cm) {
        const a = Math.max(tin, sync.start),
          b = Math.min(tin + n / F, sync.end);
        const ka = Math.min(k1, Math.max(k0, k0 + Math.round((a - tin) * F))),
          kb = Math.max(ka, Math.min(k1, k0 + Math.round((b - tin) * F)));
        if (ka > k0) cam.push({ src: null, t: 0, n: ka - k0 });
        if (kb > ka) {
          cam.push({ src: cm.id, t: camTime(sync, a), n: kb - ka });
          camOn.push([ka, kb]);
        }
        if (k1 > kb) cam.push({ src: null, t: 0, n: k1 - kb });
      } else cam.push({ src: null, t: 0, n });
    } else {
      scr.push({ src: null, t: 0, n });
      cam.push({ src: null, t: 0, n });
      full.push({ src: m.id, t: tin, n });
      fullOn.push([k0, k1]);
    }
  }
  const inputs = [],
    inputOf = new Map();
  for (const p of [...scr, ...cam, ...full])
    if (p.src) {
      const i = inputOf.get(p.src);
      if (i === void 0) {
        inputOf.set(p.src, inputs.length);
        inputs.push({ file: media.get(p.src).file, ss: p.t });
      } else inputs[i].ss = Math.min(inputs[i].ss, p.t);
    }
  for (const inp of inputs) inp.ss = Math.max(0, Math.floor((inp.ss - 1) * 1e3) / 1e3);
  const filler = (w, h, n) => `color=c=black:s=${w}x${h}:r=${F},trim=end_frame=${n},setsar=1,format=yuv420p`;
  const piece = (n, f0) =>
    `trim=start_frame=${f0}:end_frame=${f0 + n},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${n},trim=end_frame=${n},setsar=1,format=yuv420p`;
  const parts = [];
  const track = (name, list, w, h, prep) => {
    const bySrc = new Map();
    list.forEach((p, i) => {
      if (p.src) {
        const a = bySrc.get(p.src) ?? [];
        a.push(i);
        bySrc.set(p.src, a);
      }
    });
    for (const [src, idxs] of bySrc) {
      const m = media.get(src),
        i = inputOf.get(src),
        outs = idxs.map((k) => `[${name}s${k}]`);
      parts.push(
        gpu
          ? `[${i + 3}:v]${prep(m)},fps=${F}:start_time=0,setsar=1,format=yuv420p,split=${idxs.length}${outs.join("")}`
          : `[${i + 3}:v]fps=${F}:start_time=0,${prep(m)},setsar=1,format=yuv420p,split=${idxs.length}${outs.join("")}`,
      );
    }
    const labels = [];
    list.forEach((p, k) => {
      labels.push(`[${name}p${k}]`);
      parts.push(
        p.src
          ? `[${name}s${k}]${piece(p.n, Math.max(0, Math.round((p.t - inputs[inputOf.get(p.src)].ss) * F)))}[${name}p${k}]`
          : `${filler(w, h, p.n)}[${name}p${k}]`,
      );
    });
    parts.push(`${labels.join("")}concat=n=${list.length}:v=1:a=0[${name}]`);
  };
  const gpuTo = (sw, sh, tw, th) => {
    const steps = [];
    let w = sw,
      h = sh;
    while (w / 2 >= tw && h / 2 >= th) {
      w = even(w / 2);
      h = even(h / 2);
      steps.push(`scale_cuda=w=${w}:h=${h}:interp_algo=bilinear`);
    }
    steps.push(`scale_cuda=w=${tw}:h=${th}:interp_algo=${tw > w ? "lanczos" : "bilinear"}:format=yuv420p`);
    return steps.join(",") + ",hwdownload,format=yuv420p";
  };
  const down = (m, bw, bh, mode) => {
    if (!m.width || !m.height)
      return `scale_cuda=w=${bw}:h=${bh}:force_original_aspect_ratio=${mode}:force_divisible_by=2:interp_algo=bilinear:format=yuv420p,hwdownload,format=yuv420p`;
    const k = mode === "decrease" ? Math.min(bw / m.width, bh / m.height) : Math.max(bw / m.width, bh / m.height);
    return gpuTo(
      m.width,
      m.height,
      Math.min(mode === "decrease" ? bw : 1e9, even(m.width * k)),
      Math.min(mode === "decrease" ? bh : 1e9, even(m.height * k)),
    );
  };
  const fitScreen = (m) =>
    A.screenFit === "cover"
      ? `${gpu ? down(m, sb.w, sb.h, "increase") : `scale=${sb.w}:${sb.h}:force_original_aspect_ratio=increase:flags=lanczos`},crop=${sb.w}:${sb.h}`
      : `${gpu ? down(m, sb.w, sb.h, "decrease") : `scale=${sb.w}:${sb.h}:force_original_aspect_ratio=decrease:flags=lanczos`},pad=${sb.w}:${sb.h}:(ow-iw)/2:(oh-ih)/2:black`;
  const fitCam = (m) => {
    const c = camCrop(m.width, m.height, cb.w, cb.h, A.camCrop.zoom, A.camCrop.fx, A.camCrop.fy);
    if (!gpu) return `crop=${even(c.sw)}:${even(c.sh)}:${Math.round(c.sx)}:${Math.round(c.sy)},scale=${cb.w}:${cb.h}:flags=lanczos`;
    const k = cb.w / c.sw,
      fw = Math.max(cb.w, even(m.width * k)),
      fh = Math.max(cb.h, even(m.height * k));
    const x = Math.min(fw - cb.w, Math.max(0, Math.round(c.sx * k))),
      y = Math.min(fh - cb.h, Math.max(0, Math.round(c.sy * k)));
    return `${gpuTo(m.width, m.height, fw, fh)},crop=${cb.w}:${cb.h}:${x}:${y}`;
  };
  const fitFull = (m) =>
    `${gpu ? down(m, W, H, "decrease") : `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos`},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`;
  const hasScr = scr.some((p) => p.src),
    hasCam = camOn.length > 0,
    hasFull = fullOn.length > 0;
  if (hasScr) track("S", scr, sb.w, sb.h, fitScreen);
  if (hasCam) track("C", cam, cb.w, cb.h, fitCam);
  if (hasFull) track("F", full, W, H, fitFull);
  parts.push(`[0:v]trim=end_frame=${N},setpts=PTS-STARTPTS,format=yuv420p[plate]`);
  let last2 = "plate";
  if (hasScr) {
    parts.push(
      `[1:v]format=gray,trim=end_frame=${N}[smask]`,
      `[S][smask]alphamerge[Sa]`,
      `[plate][Sa]overlay=x=${sb.x}:y=${sb.y}:eof_action=pass:format=auto[v1]`,
    );
    last2 = "v1";
  }
  if (hasCam) {
    parts.push(
      `[2:v]format=gray,trim=end_frame=${N}[cmask]`,
      `[C][cmask]alphamerge[Ca]`,
      `[${last2}][Ca]overlay=x=${cb.x}:y=${cb.y}:eof_action=pass:format=auto:enable='${ranges(camOn)}'[v2]`,
    );
    last2 = "v2";
  }
  if (hasFull) {
    parts.push(`[${last2}][F]overlay=0:0:eof_action=pass:enable='${ranges(fullOn)}'[v3]`);
    last2 = "v3";
  }
  parts.push(`[${last2}]format=yuv420p[vout]`);
  return { graph: parts.join(";\n"), inputs, frames: N };
}
export async function renderEdit(projectId, A, presetId, onProgress) {
  if (jobs.has(projectId)) throw new Error("This video is already rendering.");
  const p = getPersonal(projectId),
    preset = PRESETS.find((x) => x.id === presetId) ?? PRESETS[0];
  const list = readMedia(p),
    media = new Map(list.map((m) => [m.id, m])),
    edit = readEdit(p);
  const { segs, duration } = layoutTimeline(edit, mediaInfo(list));
  if (!segs.length) throw new Error("The timeline is empty: add footage first.");
  for (const s of segs) {
    const m = media.get(s.clip.src);
    if (!m || !fs.existsSync(m.file))
      throw new Error(`A clip's file is missing: ${m?.file ?? s.clip.src}. Relink or remove it in Footage.`);
  }
  const screen = list.find((m) => m.role === "screen"),
    F = Math.min(60, Math.round(screen?.fps || list.find((m) => m.width)?.fps || 30)) || 30;
  const work = path.join(p.path, ".suite", "render");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const plan = readPlan(p),
    slug =
      (plan.title || "video")
        .toLowerCase()
        .replace(/[^\w]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "video";
  fs.mkdirSync(path.join(p.path, "out"), { recursive: true });
  let out = path.join(p.path, "out", `${slug}-${preset.id}.mp4`),
    k = 2;
  while (fs.existsSync(out)) out = path.join(p.path, "out", `${slug}-${preset.id}-${k++}.mp4`);
  const job = { renderId: uid("rnd_"), cancelled: false, subs: new Set() };
  jobs.set(projectId, job);
  const sub = () => {
    const j = { proc: null, cancelled: job.cancelled };
    job.subs.add(j);
    return j;
  };
  q.run(
    "INSERT INTO renders(id,project_id,kind,status,progress,created_at) VALUES(?,?,?,?,?,?)",
    job.renderId,
    projectId,
    "personal",
    "running",
    0,
    now(),
  );
  const t0 = Date.now();
  try {
    for (const [k2, f] of [
      ["base", "base.png"],
      ["screenMask", "smask.png"],
      ["camMask", "cmask.png"],
    ])
      dataUrlToFile(A[k2], path.join(work, f));
    onProgress({ phase: "Audio", progress: 0 });
    const wav = path.join(work, "program.wav"),
      files = {};
    for (const m of list) files[m.id] = { file: m.file, audio: m.audio, mixWith: null };
    const secs = await buildAudio(edit, segs, files, wav, sub(), (f) => onProgress({ phase: "Audio", progress: f * 0.1 }));
    log("personal render audio", secs.toFixed(3), "s for", duration.toFixed(3), "s of timeline");
    const chunkSec = process.env.CZ_TEST_HOOKS === "1" && +(process.env.CZ_RENDER_CHUNK ?? 0) > 0 ? +process.env.CZ_RENDER_CHUNK : 60;
    const { chunks, frames } = planChunks(segs, F, chunkSec);
    const e = await encoders(),
      venc = preset.codec === "hevc" ? e.hevc : e.h264;
    const cap = e.name.startsWith("CPU") ? [] : ["-maxrate", `${preset.maxrate}M`, "-bufsize", `${preset.maxrate * 2}M`];
    const parallel = e.name.startsWith("NVIDIA") ? 3 : e.name.startsWith("Apple") ? 2 : 1;
    const done = new Array(chunks.length).fill(0),
      sizes = chunks.map((c) => c[c.length - 1].k1 - c[0].k0);
    const report2 = () => {
      const f = done.reduce((a, d, i) => a + d * sizes[i], 0) / Math.max(1, frames),
        el = (Date.now() - t0) / 1e3;
      onProgress({ phase: "Video", progress: 0.1 + f * 0.85, speed: (f * duration) / Math.max(0.1, el) });
      q.run("UPDATE renders SET progress=? WHERE id=?", 0.1 + f * 0.85, job.renderId);
    };
    const renderChunk = async (ci) => {
      const tiers = [...(e.name.startsWith("NVIDIA") ? ["gpu"] : []), ...(e.hwaccel.length ? ["hw"] : []), "cpu"];
      const cf = path.join(work, `chunk-${String(ci).padStart(4, "0")}.mp4`),
        j = sub(),
        prog = (f) => {
          done[ci] = f;
          report2();
        };
      let n = 0;
      for (let t = 0; t < tiers.length; t++) {
        const tier = tiers[t],
          built = buildChunk(chunks[ci], media, edit.cams, A, F, tier === "gpu");
        n = built.frames;
        const gfile = path.join(work, `graph-${ci}.txt`);
        fs.writeFileSync(gfile, built.graph);
        const pre = tier === "gpu" ? ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] : tier === "hw" ? e.hwaccel : [];
        const args = [
          "-loop",
          "1",
          "-framerate",
          String(F),
          "-i",
          path.join(work, "base.png"),
          "-loop",
          "1",
          "-framerate",
          String(F),
          "-i",
          path.join(work, "smask.png"),
          "-loop",
          "1",
          "-framerate",
          String(F),
          "-i",
          path.join(work, "cmask.png"),
          ...built.inputs.flatMap((inp) => [...pre, ...(inp.ss > 0 ? ["-ss", inp.ss.toFixed(3)] : []), "-i", inp.file]),
          "-filter_complex_script",
          gfile,
          "-map",
          "[vout]",
          ...venc,
          ...cap,
          "-pix_fmt",
          "yuv420p",
          "-r",
          String(F),
          "-g",
          String(F * 2),
          "-frames:v",
          String(n),
          "-an",
          "-video_track_timescale",
          String(F * 1e3),
          cf,
        ];
        try {
          await runFF(args, { duration: n / F, onProgress: prog, job: j });
          break;
        } catch (err) {
          if (job.cancelled || t === tiers.length - 1) throw err;
          log("personal render: chunk", ci, tier, "failed, next way", String(err.message).slice(0, 300));
        }
      }
      done[ci] = 1;
      report2();
      job.subs.delete(j);
      return { file: cf, frames: n };
    };
    const outs = new Array(chunks.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(parallel, chunks.length) }, async () => {
        while (next < chunks.length && !job.cancelled) {
          const ci = next++;
          outs[ci] = await renderChunk(ci);
        }
      }),
    );
    if (job.cancelled) throw new Error("Cancelled");
    onProgress({ phase: "Finishing", progress: 0.96 });
    const listFile = path.join(work, "chunks.txt");
    fs.writeFileSync(
      listFile,
      outs
        .map(
          (o) => `file '${o.file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'
duration ${(o.frames / F).toFixed(6)}`,
        )
        .join("\n") + "\n",
    );
    await runFF(
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-i",
        wav,
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-ar",
        "48000",
        "-frames:v",
        String(frames),
        "-t",
        (frames / F).toFixed(6),
        "-video_track_timescale",
        String(F * 1e3),
        "-movflags",
        "+faststart",
        out + ".part.mp4",
      ],
      { job: sub() },
    );
    fs.renameSync(out + ".part.mp4", out);
    fs.rmSync(work, { recursive: true, force: true });
    const took = (Date.now() - t0) / 1e3;
    log("personal render", chunks.length, "chunks,", parallel, "at once,", (duration / took).toFixed(1) + "x realtime");
    q.run(
      "UPDATE renders SET status=?, progress=1, path=?, seconds=?, message=?, finished_at=? WHERE id=?",
      "done",
      out,
      took,
      `${preset.label} · ${e.name} · ${(duration / took).toFixed(1)}× realtime`,
      now(),
      job.renderId,
    );
    return {
      path: out,
      seconds: took,
      duration,
      realtime: duration / took,
      encoder: e.name,
      preset: preset.label,
      size: fs.statSync(out).size,
    };
  } catch (err) {
    fs.rmSync(out + ".part.mp4", { force: true });
    q.run(
      "UPDATE renders SET status=?, message=?, finished_at=? WHERE id=?",
      job.cancelled ? "cancelled" : "failed",
      job.cancelled ? "Cancelled" : String(err.message).slice(0, 400),
      now(),
      job.renderId,
    );
    throw job.cancelled ? new Error("Render cancelled") : err;
  } finally {
    jobs.delete(projectId);
  }
}
