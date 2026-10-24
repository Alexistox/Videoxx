import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import cp from "node:child_process";
import { log } from "../core/log";
import { q, uid } from "../db/db";
import { ffmpegBin, probe } from "../pipeline/ffmpeg";
import { findTranscriber } from "../voice/speechSetup";
import { MODEL_EXT, SIDE_EXT, importModels, modelNote } from "../characters/modelImport";
import { projectUrl, serverUrl } from "./fileServer";

const EXT = {
  image: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif", "heic"],
  video: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mpg", "mpeg", "wmv", "flv", "ts", "mts", "m2ts", "3gp", "ogv"],
  audio: ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "wma", "aif", "aiff"],
  pdf: ["pdf"],
  model: MODEL_EXT,
  other: [],
};
export const REF_EXTENSIONS = EXT;
const TAG = { image: "img", video: "vid", audio: "aud", pdf: "doc", model: "mdl", other: "doc" };
const POOL = 4;
const DEFAULT_SECONDS = 20,
  MAX_FRAMES = 24,
  FRAME_W = 768,
  SHEET_TILE = 320;
export function kindOf(file) {
  const e = path.extname(file).slice(1).toLowerCase();
  for (const k of ["image", "video", "audio", "pdf", "model"]) if (EXT[k].includes(e)) return k;
  return "other";
}
const isWin = process.platform === "win32";
export const normPath = (p) => {
  const r = path.resolve(p);
  return isWin ? r.toLowerCase() : r;
};
function dirOf(projectId) {
  const row = q.get("SELECT path FROM projects WHERE id=?", projectId);
  if (!row) throw new Error("Project not found");
  return row.path;
}
const pjFile = (dir) => path.join(dir, "project.json");
function readPj(dir) {
  try {
    return JSON.parse(fs.readFileSync(pjFile(dir), "utf8"));
  } catch {
    return {};
  }
}
function writeRefs(dir, refs, counters) {
  const pj = readPj(dir);
  pj.references = refs;
  if (counters) pj.refCounters = counters;
  fs.writeFileSync(pjFile(dir), JSON.stringify(pj, null, 1));
}
const stored = (dir) => {
  const r = readPj(dir).references;
  return Array.isArray(r) ? r.filter((x) => x && typeof x.id === "string" && typeof x.path === "string") : [];
};
const refsDir = (dir, refId) => path.join(dir, ".suite", "refs", ...(refId ? [refId.replace(/[^\w-]/g, "")] : []));
const probeCache = new Map();
export async function probeRef(file) {
  const kind = kindOf(file);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return { exists: false, kind, size: 0 };
  }
  if (!st.isFile()) return { exists: false, kind, size: 0 };
  const key2 = `${normPath(file)}|${st.mtimeMs}|${st.size}`,
    hit = probeCache.get(key2);
  if (hit) return hit;
  const base = { exists: true, kind, size: st.size, mtime: Math.round(st.mtimeMs) };
  if (kind === "image" || kind === "video" || kind === "audio") {
    try {
      const p = await probe(file);
      if (kind !== "audio") {
        base.width = p.width;
        base.height = p.height;
      }
      if (kind !== "image") {
        base.duration = Math.round(p.duration * 1e3) / 1e3;
        base.hasAudio = p.audio;
      }
      if (kind === "video") base.fps = p.fps;
    } catch (e) {
      log("references probe failed", file, e?.message);
    }
  }
  probeCache.set(key2, base);
  return base;
}
async function full(s) {
  const probe2 = await probeRef(s.path);
  return {
    id: s.id,
    tag: s.tag,
    kind: s.kind,
    path: s.path,
    name: path.basename(s.path),
    label: s.label ?? "",
    note: s.note ?? "",
    exists: probe2.exists,
    missing: !probe2.exists,
    probe: probe2,
    ranges: Array.isArray(s.ranges) ? s.ranges : [],
    addedAt: s.addedAt,
    ...(s.model ? { model: s.model } : {}),
  };
}
export async function listRefs(projectId) {
  return Promise.all(stored(dirOf(projectId)).map(full));
}
function findStored(dir, refId) {
  const s = stored(dir).find((r) => r.id === refId);
  if (!s) throw new Error("That reference is no longer in this project.");
  return s;
}
async function getRef(projectId, refId) {
  const dir = dirOf(projectId);
  return { dir, ref: await full(findStored(dir, refId)) };
}
async function refByTag(projectId, tag) {
  const s = stored(dirOf(projectId)).find((r) => r.tag.toLowerCase() === tag.toLowerCase());
  return s ? full(s) : null;
}
export function referencePaths(projectDir) {
  return stored(projectDir).map((r) => r.path);
}
let changed = () => {};
let progress = () => {};
export function onReferences(o) {
  if (o.changed) changed = o.changed;
  if (o.progress) progress = o.progress;
}
export async function addRefs(projectId, paths, opts = {}) {
  const dir = dirOf(projectId),
    list = stored(dir),
    pj = readPj(dir);
  const counters = { img: 0, vid: 0, aud: 0, doc: 0, ...(pj.refCounters || {}) };
  for (const r of list) {
    const m = /^([a-z]+)(\d+)$/.exec(r.tag);
    if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 0, +m[2]);
  }
  const files = [];
  for (const raw of Array.isArray(paths) ? paths : []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const p = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!path.isAbsolute(p)) throw new Error(`${p} is not a full path to a file.`);
    let st = null;
    try {
      st = fs.statSync(p);
    } catch {}
    if (!st) throw new Error(`${p} does not exist.`);
    if (st.isDirectory()) {
      if (!opts.folders) continue;
      for (const n of fs.readdirSync(p).sort()) {
        const f = path.join(p, n);
        if (kindOf(f) !== "other")
          try {
            if (fs.statSync(f).isFile()) files.push(f);
          } catch {}
      }
    } else {
      if (kindOf(p) === "other" && !SIDE_EXT.includes(path.extname(p).slice(1).toLowerCase()))
        throw new Error(`${path.basename(p)} is not a picture, video, sound, PDF or 3D model.`);
      files.push(path.resolve(p));
    }
  }
  const out = [];
  const models = files.filter((f) => kindOf(f) === "model");
  if (models.length) {
    const modelDirs = new Set(models.map((f) => normPath(path.dirname(f))));
    const isResource = (f) =>
      kindOf(f) !== "model" && modelDirs.has(normPath(path.dirname(f))) && SIDE_EXT.includes(path.extname(f).slice(1).toLowerCase());
    const imported = await importModels(
      dir,
      files.filter((f) => kindOf(f) === "model" || isResource(f)),
    );
    for (const m of imported) {
      counters.mdl = (counters.mdl ?? 0) + 1;
      const r = {
        id: uid("ref_"),
        tag: `mdl${counters.mdl}`,
        kind: "model",
        path: m.file,
        label: "",
        note: "",
        ranges: [],
        addedAt: new Date().toISOString(),
        probe: await probeRef(m.file),
        model: {
          converted: m.converted,
          source: m.source,
          about: modelNote(m),
          thumb: m.thumb,
          humanoid: !!m.info?.humanoid,
          ...(m.error ? { error: m.error } : {}),
        },
      };
      list.push(r);
      out.push(r);
    }
    for (let i = files.length - 1; i >= 0; i--) if (kindOf(files[i]) === "model" || isResource(files[i])) files.splice(i, 1);
  }
  for (const f of files) {
    if (kindOf(f) === "other") continue;
    const have = list.find((r2) => normPath(r2.path) === normPath(f));
    if (have) {
      if (!out.includes(have)) out.push(have);
      continue;
    }
    const kind = kindOf(f),
      t = TAG[kind];
    counters[t] = (counters[t] ?? 0) + 1;
    const r = {
      id: uid("ref_"),
      tag: `${t}${counters[t]}`,
      kind,
      path: f,
      label: "",
      note: "",
      ranges: [],
      addedAt: new Date().toISOString(),
      probe: await probeRef(f),
    };
    list.push(r);
    out.push(r);
  }
  writeRefs(dir, list, counters);
  if (out.length) changed(projectId);
  return Promise.all(out.map(full));
}
export function removeRef(projectId, refId) {
  const dir = dirOf(projectId),
    list = stored(dir),
    i = list.findIndex((r) => r.id === refId);
  if (i < 0) return true;
  cancelRef(projectId, refId);
  list.splice(i, 1);
  writeRefs(dir, list);
  fs.rmSync(refsDir(dir, refId), { recursive: true, force: true });
  changed(projectId);
  return true;
}
const num = (v) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() ? parseTime(v) : NaN);
export async function updateRef(projectId, refId, patch) {
  const dir = dirOf(projectId),
    list = stored(dir),
    r = list.find((x) => x.id === refId);
  if (!r) throw new Error("That reference is no longer in this project.");
  if (typeof patch?.label === "string") r.label = patch.label.slice(0, 200);
  if (typeof patch?.note === "string") r.note = patch.note.slice(0, 4e3);
  if (Array.isArray(patch?.ranges)) {
    if (r.kind !== "video" && r.kind !== "audio") r.ranges = [];
    else {
      const dur = (await probeRef(r.path)).duration || Infinity;
      r.ranges = patch.ranges.slice(0, 50).map((x) => {
        let s = Math.max(0, num(x?.start)),
          e = Math.min(dur, num(x?.end));
        if (!(s >= 0) || !(e > s)) throw new Error("A range needs a start before its end.");
        s = Math.round(s * 1e3) / 1e3;
        e = Math.round(e * 1e3) / 1e3;
        return {
          id: typeof x?.id === "string" && /^rng_\w+$/.test(x.id) ? x.id : uid("rng_"),
          start: s,
          end: e,
          ...(x?.note ? { note: String(x.note).slice(0, 2e3) } : {}),
          ...(x?.label ? { label: String(x.label).slice(0, 200) } : {}),
        };
      });
    }
  }
  writeRefs(dir, list);
  changed(projectId);
  return full(r);
}
export async function relinkRef(projectId, refId, newPath) {
  const dir = dirOf(projectId),
    list = stored(dir),
    r = list.find((x) => x.id === refId);
  if (!r) throw new Error("That reference is no longer in this project.");
  if (typeof newPath !== "string" || !path.isAbsolute(newPath) || !fs.existsSync(newPath) || !fs.statSync(newPath).isFile())
    throw new Error("Pick the file where it is now.");
  if (kindOf(newPath) !== r.kind)
    throw new Error(
      `${path.basename(newPath)} is not ${r.kind === "image" ? "a picture" : r.kind === "video" ? "a video" : r.kind === "audio" ? "a sound" : "a PDF"} like ${r.tag}.`,
    );
  r.path = path.resolve(newPath);
  r.probe = await probeRef(r.path);
  writeRefs(dir, list);
  fs.rmSync(refsDir(dir, refId), { recursive: true, force: true });
  changed(projectId);
  return full(r);
}
const jobs = new Map();
const jobKey = (p, r) => `${p}:${r}`;
export function cancelRef(projectId, refId) {
  for (const [k, set] of jobs)
    if (k.startsWith(projectId + ":") && (!refId || k === jobKey(projectId, refId)))
      for (const j of set) {
        j.cancelled = true;
        for (const p of j.procs)
          try {
            p.kill();
          } catch {}
      }
  return true;
}
function ff(args, job, cwd) {
  return new Promise((res, rej) => {
    if (job?.cancelled) return rej(new Error("cancelled"));
    const p = cp.spawn(ffmpegBin(), ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], {
      windowsHide: true,
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    job?.procs.add(p);
    let err = "";
    p.stderr.on("data", (d) => {
      if (err.length < 4e3) err += d;
    });
    p.on("error", (e) => {
      job?.procs.delete(p);
      rej(new Error(/ENOENT/.test(String(e)) ? "ffmpeg is not installed (or not on PATH)." : String(e)));
    });
    p.on("close", (code) => {
      job?.procs.delete(p);
      if (job?.cancelled) rej(new Error("cancelled"));
      else if (code === 0) res();
      else rej(new Error(err.trim().split("\n").slice(-2).join(" ") || `ffmpeg exited ${code}`));
    });
  });
}
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}
async function frameAt(file, t, out, w, opts = {}) {
  const vf = opts.h
    ? `scale=${w}:${opts.h}:force_original_aspect_ratio=decrease,pad=${w}:${opts.h}:(ow-iw)/2:(oh-ih)/2`
    : `scale='min(${w},iw)':-2`;
  const pre = opts.keyframe ? ["-skip_frame", "nokey", "-noaccurate_seek"] : [];
  const tt = Math.max(0, t).toFixed(3);
  try {
    await ff([...pre, "-ss", tt, "-i", file, "-map", "0:v:0", "-frames:v", "1", "-vf", vf, "-q:v", "4", out], opts.job);
  } catch (e) {
    if (e?.message === "cancelled") throw e;
    await ff(["-ss", tt, "-i", file, "-map", "0:v:0", "-frames:v", "1", "-vf", vf, "-q:v", "4", out], opts.job);
  }
  if (!fs.existsSync(out)) throw new Error(`no frame at ${tt} s`);
}
const keyOf = (...a) => crypto.createHash("sha1").update(a.join("|")).digest("hex").slice(0, 12);
const fileUrl = (projectId, dir, f) => projectUrl(projectId, path.relative(dir, f).split(path.sep).map(encodeURIComponent).join("/"));
function needVisual(ref) {
  if (!ref.exists) throw new Error(`${ref.tag} is missing: ${ref.path} is not there any more. Relink it to where the file is now.`);
  if (ref.kind !== "video" && ref.kind !== "image") throw new Error(`${ref.tag} has no picture.`);
}
export async function thumbRef(projectId, refId, t = 0, w = 320) {
  const { dir, ref } = await getRef(projectId, refId);
  if (ref.kind === "model" && ref.model?.thumb && fs.existsSync(ref.model.thumb))
    return { url: fileUrl(projectId, dir, ref.model.thumb), file: ref.model.thumb };
  needVisual(ref);
  w = Math.max(32, Math.min(1920, Math.round(+w || 320)));
  t = Math.max(0, Math.min(+t || 0, Math.max(0, (ref.probe?.duration ?? 0) - 0.05)));
  const d = path.join(refsDir(dir, refId), "thumbs");
  fs.mkdirSync(d, { recursive: true });
  const out = path.join(d, `${keyOf(ref.path, ref.probe?.mtime, ref.probe?.size, ref.kind === "video" ? t.toFixed(2) : 0, w)}.jpg`);
  if (!fs.existsSync(out)) {
    const tmp = out.replace(/\.jpg$/, `.${process.pid}.tmp.jpg`);
    await frameAt(ref.path, ref.kind === "video" ? t : 0, tmp, w);
    fs.renameSync(tmp, out);
  }
  return { url: fileUrl(projectId, dir, out), file: out };
}
export async function stripRef(projectId, refId, n = 24) {
  const { dir, ref } = await getRef(projectId, refId);
  needVisual(ref);
  n = Math.max(1, Math.min(120, Math.round(+n || 24)));
  const dur = ref.kind === "video" ? ref.probe?.duration || 0 : 0,
    W = ref.probe?.width || 16,
    H = ref.probe?.height || 9;
  const tileH = 90,
    tileW = Math.max(16, Math.round((tileH * W) / H / 2) * 2);
  const times = Array.from({ length: n }, (_, k) => Math.round((dur ? ((k + 0.5) * dur) / n : 0) * 1e3) / 1e3);
  const d = path.join(refsDir(dir, refId), `strip-${keyOf(ref.path, ref.probe?.mtime, ref.probe?.size, n, tileW)}`),
    out = path.join(d, "strip.jpg");
  if (!fs.existsSync(out)) {
    fs.mkdirSync(d, { recursive: true });
    const job = { procs: new Set(), cancelled: false },
      set = jobs.get(jobKey(projectId, refId)) ?? new Set();
    set.add(job);
    jobs.set(jobKey(projectId, refId), set);
    try {
      if (ref.kind === "image") {
        await frameAt(ref.path, 0, path.join(d, "t_000.jpg"), tileW, { h: tileH });
        for (let k = 1; k < n; k++) fs.copyFileSync(path.join(d, "t_000.jpg"), path.join(d, `t_${String(k).padStart(3, "0")}.jpg`));
      } else
        await pool(times, POOL, async (t, k) => {
          await frameAt(ref.path, t, path.join(d, `t_${String(k).padStart(3, "0")}.jpg`), tileW, { keyframe: true, job, h: tileH }).catch(
            (e) => {
              if (e?.message === "cancelled") throw e;
            },
          );
        });
      for (let k = 0; k < n; k++) {
        const f = path.join(d, `t_${String(k).padStart(3, "0")}.jpg`);
        if (!fs.existsSync(f)) {
          const near = [...Array(n).keys()].map((i) => path.join(d, `t_${String(i).padStart(3, "0")}.jpg`)).find((x) => fs.existsSync(x));
          if (!near) throw new Error(`Could not read any frame of ${ref.name}.`);
          fs.copyFileSync(near, f);
        }
      }
      await ff(["-framerate", "1", "-i", "t_%03d.jpg", "-vf", `tile=${n}x1`, "-frames:v", "1", "-q:v", "4", "strip.tmp.jpg"], job, d);
      fs.renameSync(path.join(d, "strip.tmp.jpg"), out);
      for (const f of fs.readdirSync(d)) if (/^t_\d+\.jpg$/.test(f)) fs.rmSync(path.join(d, f), { force: true });
    } finally {
      set.delete(job);
    }
  }
  return { url: fileUrl(projectId, dir, out), file: out, times, tileW, tileH, n };
}
export async function mediaRef(projectId, refId) {
  const { ref } = await getRef(projectId, refId);
  if (!ref.exists) throw new Error(`${ref.tag} is missing: ${ref.path} is not there any more.`);
  return { url: `${serverUrl()}/r/${encodeURIComponent(projectId)}/${encodeURIComponent(refId)}/${encodeURIComponent(ref.name)}` };
}
export function servedRefFile(projectId, refId) {
  if (!/^ref_[0-9a-f]+$/.test(refId)) return null;
  let dir;
  try {
    dir = dirOf(projectId);
  } catch {
    return null;
  }
  const r = stored(dir).find((x) => x.id === refId);
  if (!r || kindOf(r.path) === "other") return null;
  try {
    return fs.statSync(r.path).isFile() ? r.path : null;
  } catch {
    return null;
  }
}
function parseTime(s) {
  const t = String(s).trim();
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(t)) return NaN;
  return t.split(":").reduce((a, x) => a * 60 + parseFloat(x), 0);
}
export const fmtTime = (s) => {
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    x = s % 60,
    ss = (Math.round(x * 10) / 10).toString().padStart(x < 10 ? 1 : 2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x < 10 ? "0" : ""}${ss}` : `${m}:${x < 10 ? "0" : ""}${ss}`;
};
async function extractDir(dir, ref, s, e) {
  return path.join(
    refsDir(dir, ref.id),
    `r${Math.round(s * 1e3)}-${Math.round(e * 1e3)}-${keyOf(ref.path, ref.probe?.mtime, ref.probe?.size)}`,
  );
}
const frameCount = (len, cap = MAX_FRAMES) => Math.max(1, Math.min(cap, Math.ceil(len <= 8 ? len * 2 : len)));
const inflight = new Map();
export async function extractRef(projectId, refId, which, opts = {}) {
  const { dir, ref } = await getRef(projectId, refId);
  if (!ref.exists) throw new Error(`${ref.tag} is missing: ${ref.path} is not there any more. Relink it to where the file is now.`);
  const dur = ref.probe?.duration ?? 0;
  let s = 0,
    e = 0,
    rangeId = "whole";
  if (ref.kind === "video" || ref.kind === "audio") {
    const saved = typeof which === "string" ? ref.ranges.find((r) => r.id === which) : null;
    if (typeof which === "string" && !saved) throw new Error("That range is no longer on the reference.");
    if (saved) {
      s = saved.start;
      e = saved.end;
      rangeId = saved.id;
    } else if (which && typeof which === "object") {
      s = +which.start;
      e = +which.end;
      rangeId = "adhoc";
    } else if (ref.ranges[0]) {
      s = ref.ranges[0].start;
      e = ref.ranges[0].end;
      rangeId = ref.ranges[0].id;
    } else {
      s = 0;
      e = Math.min(DEFAULT_SECONDS, dur || DEFAULT_SECONDS);
      rangeId = "default";
    }
    if (dur) {
      s = Math.max(0, Math.min(s, dur));
      e = Math.min(e, dur);
    }
    if (!(e > s))
      throw new Error(`${ref.tag}: the range ${fmtTime(s)}-${fmtTime(e)} is empty${dur ? ` (the file is ${fmtTime(dur)} long)` : ""}.`);
  }
  const count = ref.kind === "video" ? Math.max(1, Math.min(60, Math.round(opts.count ?? frameCount(e - s)))) : 1;
  const out =
    ref.kind === "image" || ref.kind === "pdf"
      ? path.join(refsDir(dir, ref.id), `whole-${keyOf(ref.path, ref.probe?.mtime, ref.probe?.size)}`)
      : await extractDir(dir, ref, s, e);
  const k = `${out}|${count}|${opts.transcript ? 1 : 0}|${opts.clip ? 1 : 0}`;
  if (inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    const done = path.join(out, `done-${count}.json`);
    try {
      const j = JSON.parse(fs.readFileSync(done, "utf8"));
      if (j.frames.every((f) => fs.existsSync(f)) && (!opts.transcript || j.transcript || !j.audio) && (!opts.clip || j.clip))
        return withTranscript(j);
    } catch {}
    fs.mkdirSync(out, { recursive: true });
    const job = { procs: new Set(), cancelled: false },
      set = jobs.get(jobKey(projectId, refId)) ?? new Set();
    set.add(job);
    jobs.set(jobKey(projectId, refId), set);
    const tick = (done2, total, stage) => progress({ projectId, refId, rangeId, done: done2, total, stage });
    try {
      const frames = [],
        times = [];
      if (ref.kind === "pdf") {
        const r2 = {
          frames: [],
          times: [],
          sheet: "",
          summary: `${ref.tag} is a PDF: read it with the Read tool at ${ref.path}.`,
          dir: out,
          range: { start: 0, end: 0 },
        };
        fs.writeFileSync(done, JSON.stringify(r2));
        return r2;
      }
      if (ref.kind === "image") {
        const f = path.join(out, "f_001.jpg");
        await frameAt(ref.path, 0, f, 1280, { job });
        frames.push(f);
        times.push(0);
      } else if (ref.kind === "video") {
        const len = e - s,
          ts = Array.from({ length: count }, (_, i) => Math.round((s + ((i + 0.5) * len) / count) * 1e3) / 1e3);
        let n = 0;
        tick(0, count, "frames");
        await pool(ts, POOL, async (t, i) => {
          const f = path.join(out, `f_${String(i + 1).padStart(3, "0")}.jpg`);
          if (!fs.existsSync(f)) await frameAt(ref.path, t, f, FRAME_W, { job });
          tick(++n, count, "frames");
        });
        ts.forEach((t, i) => {
          frames.push(path.join(out, `f_${String(i + 1).padStart(3, "0")}.jpg`));
          times.push(t);
        });
      }
      let sheet = "";
      if (frames.length) {
        const cols = Math.min(6, frames.length),
          rows = Math.ceil(frames.length / cols);
        await ff(
          [
            "-framerate",
            "1",
            "-i",
            "f_%03d.jpg",
            "-vf",
            `scale=${SHEET_TILE}:-2,tile=${cols}x${rows}:padding=4:color=0x202020`,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            "sheet.jpg",
          ],
          job,
          out,
        );
        sheet = path.join(out, "sheet.jpg");
        tick(1, 1, "sheet");
      }
      let audio, clip;
      if ((ref.kind === "audio" || ref.probe?.hasAudio) && e > s) {
        audio = path.join(out, "audio.wav");
        if (!fs.existsSync(audio))
          await ff(
            ["-ss", s.toFixed(3), "-t", (e - s).toFixed(3), "-i", ref.path, "-vn", "-ac", "1", "-ar", "16000", "audio.wav"],
            job,
            out,
          );
        tick(1, 1, "audio");
      }
      if (opts.clip && ref.kind === "video") {
        clip = path.join(out, "clip.mp4");
        if (!fs.existsSync(clip))
          await ff(
            [
              "-ss",
              s.toFixed(3),
              "-t",
              (e - s).toFixed(3),
              "-i",
              ref.path,
              "-vf",
              "scale='min(640,iw)':-2",
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "30",
              "-c:a",
              "aac",
              "-b:a",
              "64k",
              "clip.mp4",
            ],
            job,
            out,
          );
      }
      const r = {
        frames,
        times,
        sheet,
        ...(audio ? { audio } : {}),
        ...(clip ? { clip } : {}),
        dir: out,
        range: { start: s, end: e },
        summary:
          ref.kind === "image"
            ? `${ref.tag} (${ref.name}): the picture, ${ref.probe?.width ?? "?"}x${ref.probe?.height ?? "?"}.`
            : `${ref.tag} (${ref.name}) ${fmtTime(s)}-${fmtTime(e)} (${Math.round((e - s) * 10) / 10} s${dur ? ` of ${fmtTime(dur)}` : ""}): ${frames.length} frames${frames.length ? ` (${(frames.length / (e - s)).toFixed(1)} per second)` : ""}${audio ? ", audio snippet" : ""}.`,
      };
      fs.writeFileSync(done, JSON.stringify(r));
      if (audio && e - s <= 120 && findTranscriber()) {
        const tp = transcribe(audio, job);
        if (opts.transcript) await tp.catch(() => {});
        else tp.catch(() => {});
      }
      tick(1, 1, "done");
      return withTranscript(r);
    } finally {
      set.delete(job);
    }
  })();
  inflight.set(k, p);
  try {
    return await p;
  } finally {
    inflight.delete(k);
  }
}
function withTranscript(r) {
  const t = r.audio ? r.audio.replace(/\.wav$/, ".txt") : "";
  return t && fs.existsSync(t) ? { ...r, transcript: t } : r;
}
const transcribing = new Map();
function transcribe(audio, job) {
  const txt = audio.replace(/\.wav$/, ".txt");
  if (fs.existsSync(txt)) return Promise.resolve();
  if (transcribing.has(audio)) return transcribing.get(audio);
  const tr = findTranscriber();
  const p = new Promise((res, rej) => {
    const c = cp.spawn(tr.python, [tr.script, audio, ...tr.args], { windowsHide: true, cwd: path.dirname(audio), stdio: "ignore" });
    job.procs.add(c);
    const kill = setTimeout(() => {
      try {
        c.kill();
      } catch {}
    }, 18e4);
    c.on("error", (err) => {
      clearTimeout(kill);
      rej(err);
    });
    c.on("close", (code) => {
      clearTimeout(kill);
      job.procs.delete(c);
      code === 0 && fs.existsSync(txt) ? res() : rej(new Error(`transcription exited ${code}`));
    });
  }).finally(() => transcribing.delete(audio));
  transcribing.set(audio, p);
  return p;
}
export async function framesFor(projectId, tag, start, end, count) {
  const ref = await refByTag(projectId, tag.replace(/^@/, ""));
  if (!ref) throw new Error(`There is no reference ${tag} in this project.`);
  const range =
    (ref.kind === "video" || ref.kind === "audio") && start != null && isFinite(+start)
      ? { start: +start, end: end != null && isFinite(+end) ? +end : +start + DEFAULT_SECONDS }
      : null;
  return { ref, ...(await extractRef(projectId, ref.id, range, { count })) };
}
const T_ = "(\\d+(?::\\d{1,2}){0,2}(?:\\.\\d+)?)";
const MENTION = new RegExp(`@(img|vid|aud|doc|mdl)(\\d+)(?:\\[\\s*${T_}\\s*-\\s*${T_}\\s*\\]|@${T_}\\s*-\\s*${T_})?`, "gi");
function parseMentions(text) {
  const out = [];
  MENTION.lastIndex = 0;
  for (const m of String(text || "").matchAll(MENTION)) {
    const a = m[3] ?? m[5],
      b = m[4] ?? m[6],
      s = a != null ? parseTime(a) : NaN,
      e = b != null ? parseTime(b) : NaN;
    out.push({ tag: `${m[1].toLowerCase()}${+m[2]}`, ...(isFinite(s) && isFinite(e) && e > s ? { start: s, end: e } : {}), text: m[0] });
  }
  return out;
}
const REFERENCE_RULE =
  "Read these frames (image Read tool) and match this EXACT look/composition/colour/lighting/typography/camera/pacing, using our own subject matter; do not copy faces/logos/copyrighted content verbatim; credit nothing from these files in the video unless told.";
export async function referencesBlock(projectId, text, opts = {}) {
  let refs;
  try {
    refs = await listRefs(projectId);
  } catch {
    return "";
  }
  if (!refs.length) return "";
  const byTag = new Map();
  for (const m of parseMentions(text)) byTag.set(m.tag, [...(byTag.get(m.tag) ?? []), m]);
  const used = new Set(),
    parts = [];
  for (const [tag, ms] of byTag) {
    const ref = refs.find((r) => r.tag === tag);
    if (!ref) {
      parts.push(`@${tag}: there is no such reference in this project (ignore it).`);
      continue;
    }
    used.add(ref.id);
    const head = [
      `${ms
        .map((m) => m.text)
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(", ")} = ${ref.tag}: ${ref.kind} at ${ref.path} (a pointer to the user's own file, read-only)`,
      ref.label ? `label: ${ref.label}` : "",
      ref.note ? `note: ${ref.note}` : "",
    ].filter(Boolean);
    if (ref.kind === "model") {
      parts.push(
        modelBlock(
          ref,
          ms.map((m) => m.text),
        ),
      );
      continue;
    }
    if (!ref.exists) {
      parts.push(head.join("\n") + "\nThe file is MISSING (moved or deleted): say so in your summary and build without it.");
      continue;
    }
    if (ref.kind === "pdf") {
      parts.push(head.join("\n") + "\nRead the PDF with the Read tool.");
      continue;
    }
    const explicit = ms
      .filter((m) => m.start != null)
      .map((m) => ({ start: m.start, end: m.end }))
      .filter((r, i, a) => a.findIndex((x) => x.start === r.start && x.end === r.end) === i);
    const ranges =
      ref.kind === "image"
        ? [null]
        : explicit.length
          ? explicit.slice(0, 6)
          : ref.ranges.length
            ? ref.ranges.slice(0, 4)
            : [{ start: 0, end: Math.min(DEFAULT_SECONDS, ref.probe?.duration || DEFAULT_SECONDS) }];
    const lines = [...head];
    for (const rg of ranges) {
      try {
        opts.onNote?.(`Pulling ${rg ? `${fmtTime(rg.start)}-${fmtTime(rg.end)} of ` : ""}${ref.tag} (${ref.name}) for Claude.`);
        const x = await extractRef(projectId, ref.id, rg ? { start: rg.start, end: rg.end } : null);
        lines.push(
          `range: ${rg ? `${fmtTime(x.range.start)}-${fmtTime(x.range.end)} (${x.range.start}-${x.range.end} s)${rg.label ? ` "${rg.label}"` : ""}${rg.note ? ` - ${rg.note}` : ""}` : "the whole picture"}`,
          `contact sheet: ${x.sheet}`,
          `frames (${x.frames.length}):`,
          ...x.frames.map((f, i) => `  ${f}${x.times.length > 1 ? `  (${fmtTime(x.times[i])})` : ""}`),
          ...(x.audio ? [`audio of the range: ${x.audio}`] : []),
          ...(x.transcript ? [`words spoken in the range: ${x.transcript}`] : []),
        );
      } catch (err) {
        lines.push(`range: could not be extracted (${err?.message || err}).`);
      }
    }
    parts.push(lines.join("\n"));
  }
  const rest = refs.filter((r) => !used.has(r.id));
  const out = ["REFERENCES (the user pointed at these files: the biggest quality lever of this build)"];
  if (parts.length) out.push(REFERENCE_RULE + " Read the contact sheet first, then the single frames you need.", ...parts);
  if (rest.length)
    out.push(
      `${parts.length ? "Also available" : "Available"} (not mentioned in this request; open one only if it helps, e.g. with reference_frames): ` +
        rest
          .map(
            (r) =>
              `${r.tag} ${r.kind}${r.label ? ` "${r.label}"` : ""}${r.missing ? " (MISSING)" : ""} ${r.path}${r.ranges.length ? ` ranges ${r.ranges.map((x) => `${fmtTime(x.start)}-${fmtTime(x.end)}`).join(", ")}` : ""}`,
          )
          .join("; "),
    );
  out.push(
    "More frames of any reference or range: the reference_frames tool (tag, start, end, count). The reference files are read-only: never edit, move or copy them into the project (3D models (mdl tags) are already project files in assets/models: use those).",
  );
  return out.join("\n\n");
}
const MODEL_RULE =
  "User 3D models live in assets/models/ (imported by the app as uncompressed .glb). To use one, load it with the style's own model loading (3D reconstruction: the engine's .glb loading; Low poly: lowpoly_asset / GLTFLoader with the project path; pixel/flat/other three.js styles: GLTFLoader from the vendored three if the engine has it, else import ./vendor/jsm/loaders/GLTFLoader.js after copying it from another style's vendor), replace the object the user means with it, scale it to the size of what it replaces, stand it on the ground (bounding box min y = 0), face it the right way, and keep the scene's look (e.g. 3D reconstruction's matte clay material override, Low poly's palette/texture snapping): the model's own colours only when the user asks. Rigged models keep their skeleton and animations (SkeletonUtils.clone for copies).";
function modelBlock(ref, said) {
  const m = ref.model,
    rel = "assets/models/" + path.basename(ref.path);
  const lines = [
    `${said.filter((x, i, a) => a.indexOf(x) === i).join(", ")} = ${ref.tag}: 3D model ${m?.converted === false && m?.error ? ref.path : rel} (imported into this project from ${m?.source || ref.path})`,
  ];
  if (ref.label) lines.push(`label: ${ref.label}`);
  if (ref.note) lines.push(`note: ${ref.note}`);
  if (!ref.exists) lines.push("The file is MISSING from assets/models: say so in your summary and build without it.");
  if (m?.about) lines.push(m.about);
  if (m?.thumb) lines.push(`preview picture: ${m.thumb}`);
  if (m?.humanoid)
    lines.push(
      "It is a rigged humanoid: for 3D reconstruction it can also be a character (the Characters picker library is <workspace>/assets/models; copy it there only if the user asks).",
    );
  lines.push(MODEL_RULE);
  return lines.join("\n");
}
export function isReferencePath(projectDir, target) {
  const t = normPath(target);
  return referencePaths(projectDir).some((p) => normPath(p) === t);
}
