import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getConfig } from "../core/config";
import { log } from "../core/log";
import { run } from "../pipeline/steps";
import { AUDIO_EXT, PLAIN_AUDIO, PLAYABLE, copyAsNew, wavDuration } from "./voiceover";

const granted = new Set();
const norm = (f) => {
  const r = path.resolve(String(f));
  return process.platform === "linux" ? r : r.toLowerCase();
};
export function grantPaths(paths) {
  for (const p of Array.isArray(paths) ? paths : [paths]) if (typeof p === "string" && p) granted.add(norm(p));
}
export const notGranted = (files) => files.filter((f) => !granted.has(norm(f)));
export const isGranted = (f) => granted.has(norm(f));
export const MAX_FILES = 500;
const natural = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
export function expandDropped(paths) {
  const files = [],
    folders = [];
  for (const p of paths.map(String)) {
    let dir = false;
    try {
      dir = granted.has(norm(p)) && fs.statSync(p).isDirectory();
    } catch {}
    if (!dir) {
      files.push(p);
      continue;
    }
    let inside = [];
    try {
      inside = fs
        .readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isFile() && AUDIO_EXT.test(d.name) && !d.name.startsWith("."))
        .map((d) => d.name);
    } catch {}
    inside.sort(natural.compare);
    const full = inside.map((n) => path.join(p, n));
    grantPaths(full);
    files.push(...full);
    folders.push({ name: path.basename(p), count: full.length });
  }
  return { files, folders };
}
export async function probe(files) {
  if (notGranted(files || []).length) throw new Error("Add the recordings by choosing or dropping them in this window.");
  return probeFiles(files || []);
}
export async function probeFiles(files) {
  const list = files.slice(0, MAX_FILES),
    out = new Array(list.length);
  let next = 0;
  const one = async (i) => {
    const f = path.resolve(String(list[i])),
      name = path.basename(f);
    if (!fs.existsSync(f)) {
      out[i] = { file: f, name, duration: null, audio: false, error: "not found" };
      return;
    }
    const r = await run(getConfig().tools.ffmpeg, ["-hide_banner", "-i", f], os.tmpdir()).catch((e) => ({
      code: 1,
      out: String(e.message),
      missing: true,
    }));
    const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.out);
    const error = r.missing ? "ffmpeg is missing" : !/Input #0/.test(r.out) ? "unreadable" : void 0;
    const codec = /Stream #[^\n]*?Audio: (\w+)/.exec(r.out)?.[1] ?? "";
    out[i] = {
      file: f,
      name,
      duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null,
      audio: !error && !!codec,
      keep: PLAIN_AUDIO.test(path.extname(f)) && PLAYABLE.test(codec),
      ...(error ? { error } : {}),
    };
  };
  await Promise.all(
    Array.from({ length: Math.min(6, list.length) }, async () => {
      while (next < list.length) await one(next++);
    }),
  );
  return out;
}
export async function useRecordings(dir, files, gap, job, state, emit, pads) {
  const a = path.join(dir, "audio");
  fs.mkdirSync(a, { recursive: true });
  const info = await probe(files);
  const silent = info.find((i) => !i.audio);
  if (silent)
    throw new Error(
      silent.error === "ffmpeg is missing"
        ? "ffmpeg was not found. Install it or set its path in Settings > System > Tool paths."
        : silent.error === "unreadable"
          ? `${silent.name} could not be read (it may be damaged, or not really audio).`
          : silent.error === "not found"
            ? `${silent.name} is no longer there.`
            : `${silent.name} has no sound in it.`,
    );
  const ext = path.extname(files[0]).toLowerCase();
  job.sections.forEach((s) => (s.state = "run"));
  emit(job);
  if (files.length === 1 && info[0].keep && !pads?.some((p) => p > 0)) {
    const tmp2 = path.join(a, `source${ext}.incoming`);
    copyAsNew(files[0], tmp2);
    job.sections.forEach((s) => (s.state = "done"));
    emit(job);
    return { tmp: tmp2, ext };
  }
  const tmp = path.join(a, "source.wav.incoming"),
    n = files.length,
    BATCH = 40;
  const fades = (d) =>
    n > 1 && d && d > 0.1 ? `,afade=t=in:d=0.008:curve=qsin,afade=t=out:st=${(d - 8e-3).toFixed(4)}:d=0.008:curve=qsin` : "";
  const padAt = (i) => (pads ? +(pads[i] ?? 0).toFixed(3) : i < n - 1 ? gap : 0);
  const join = async (list, pad, out, durs2 = []) => {
    const chains = list.map(
      (_, i) =>
        `[${i}:a:0]aresample=48000:filter_size=64:cutoff=0.95,aformat=sample_fmts=s16:channel_layouts=mono${fades(durs2[i])}${pad(i) > 0 ? `,apad=pad_dur=${pad(i)}` : ""}[a${i}]`,
    );
    const graph = `${chains.join(";")};${list.map((_, i) => `[a${i}]`).join("")}concat=n=${list.length}:v=0:a=1[out]`;
    const r = await run(
      getConfig().tools.ffmpeg,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        ...list.flatMap((f) => ["-i", f]),
        "-filter_complex",
        graph,
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        out,
      ],
      dir,
    );
    if (state.cancelled) {
      fs.rmSync(out, { force: true });
      throw new Error("cancelled");
    }
    if (r.code !== 0 || !fs.existsSync(out)) {
      fs.rmSync(out, { force: true });
      log("join failed", r.out.slice(-1500));
      throw new Error(`Joining the recordings failed: ${r.out.trim().split(/\r?\n/).pop()?.slice(0, 200) || `ffmpeg exit ${r.code}`}`);
    }
  };
  const durs = info.map((i) => i.duration);
  if (n <= BATCH) await join(files, padAt, tmp, durs);
  else {
    const work = path.join(dir, ".suite", "join");
    fs.mkdirSync(work, { recursive: true });
    const parts = [];
    try {
      for (let k = 0; k < n; k += BATCH) {
        const part = path.join(work, `part-${parts.length}.wav`);
        await join(files.slice(k, k + BATCH), (i) => padAt(k + i), part, durs.slice(k, k + BATCH));
        parts.push(part);
        job.sections.slice(k, k + BATCH).forEach((s) => (s.state = "done"));
        emit(job);
      }
      await join(parts, () => 0, tmp);
    } finally {
      for (const p of parts) fs.rmSync(p, { force: true });
    }
  }
  job.sections.forEach((s) => (s.state = "done"));
  emit(job);
  return { tmp, ext: ".wav" };
}
export async function durationOf(file) {
  if (/\.wav$/i.test(file)) {
    const d = wavDuration(file);
    if (d != null) return d;
  }
  return (await probeFiles([file]))[0]?.duration ?? void 0;
}
