import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fromCut, toCut } from "./trim";
import { SFX_EXT, analyse, slug } from "./sfx";

const REF_LUFS = -16;
const LANE_DEFAULTS = {
  music: { gain: -14, duck: 6, loop: true, fadeIn: 1, fadeOut: 2 },
  // ~14 dB under the voice, a little lower while someone speaks
  effects: { gain: -6, duck: 0, loop: false, fadeIn: 0, fadeOut: 0.05 },
  ambience: { gain: -22, duck: 3, loop: true, fadeIn: 1, fadeOut: 1.5 },
  free: { gain: -10, duck: 0, loop: false, fadeIn: 0, fadeOut: 0.05 },
};
const DEFAULT_LANES = [
  { id: "music", name: "Music", kind: "music", gain: 0, mute: false, solo: false },
  { id: "effects", name: "Effects", kind: "effects", gain: 0, mute: false, solo: false },
  { id: "ambience", name: "Ambience", kind: "ambience", gain: 0, mute: false, solo: false },
];
const num = (v, lo, hi, d) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const r3 = (v) => Math.round(v * 1e3) / 1e3;
const LAYER_FILE = /^audio\/layers\/[a-z0-9_.-]+\.[a-z0-9]+$/;
const readPj = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
  } catch {
    return {};
  }
};
function sanitize(dir, raw) {
  const lanes = [];
  for (const l of Array.isArray(raw?.lanes) ? raw.lanes : DEFAULT_LANES) {
    const id = slug(l?.id) || `lane${lanes.length + 1}`;
    if (lanes.some((x) => x.id === id) || lanes.length >= 12) continue;
    const kind = ["music", "effects", "ambience", "free"].includes(l?.kind) ? l.kind : "free";
    lanes.push({ id, name: String(l?.name || id).slice(0, 40), kind, gain: num(l?.gain, -40, 12, 0), mute: !!l?.mute, solo: !!l?.solo });
  }
  for (const d of DEFAULT_LANES) if (!lanes.some((l) => l.id === d.id)) lanes.splice(DEFAULT_LANES.indexOf(d), 0, { ...d });
  const clips = [];
  for (const c of Array.isArray(raw?.clips) ? raw.clips : []) {
    if (typeof c?.file !== "string" || !LAYER_FILE.test(c.file) || !fs.existsSync(path.join(dir, c.file))) continue;
    const lane = lanes.find((l) => l.id === c.lane)?.id ?? "effects",
      srcDur = num(c.srcDur, 0, 36e3, 0);
    const a =
      c.anchor && Number.isInteger(c.anchor.word) && c.anchor.word >= 0
        ? { word: c.anchor.word, text: String(c.anchor.text ?? "").slice(0, 60), offset: r3(num(c.anchor.offset, -30, 30, 0)) }
        : null;
    clips.push({
      id: slug(c.id) || crypto.randomBytes(4).toString("hex"),
      lane,
      file: c.file,
      name: String(c.name || path.basename(c.file)).slice(0, 120),
      start: r3(num(c.start, 0, 36e3, 0)),
      in: r3(num(c.in, 0, 36e3, 0)),
      len: c.len == null ? null : r3(num(c.len, 0.02, 36e3, 1)),
      loop: !!c.loop,
      fadeIn: r3(num(c.fadeIn, 0, 30, 0)),
      fadeOut: r3(num(c.fadeOut, 0, 30, 0)),
      gain: num(c.gain, -60, 12, 0),
      pan: num(c.pan, -1, 1, 0),
      duck: num(c.duck, 0, 11, 0),
      anchor: a,
      srcDur,
      lufs: typeof c.lufs === "number" && isFinite(c.lufs) ? c.lufs : null,
      libId: typeof c.libId === "string" ? c.libId.slice(0, 120) : null,
    });
  }
  return { lanes, clips };
}
export function layersOf(dir) {
  return sanitize(dir, readPj(dir).audioLayers ?? {});
}
export function saveLayers(dir, raw) {
  const L = sanitize(dir, raw),
    f = path.join(dir, "project.json"),
    pj = readPj(dir);
  pj.audioLayers = L;
  fs.writeFileSync(f, JSON.stringify(pj, null, 1));
  return L;
}
export function wordsOf(dir) {
  try {
    const tl = JSON.parse(fs.readFileSync(path.join(dir, "audio", "timeline.json"), "utf8"));
    return (Array.isArray(tl) ? tl : []).flatMap((p) => p.words ?? []);
  } catch {
    return [];
  }
}
const clean = (w) =>
  String(w || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
function startOf(c, words) {
  if (!c.anchor || !words.length) return c.start;
  const want = clean(c.anchor.text),
    at = words[c.anchor.word];
  if (at && (!want || clean(at.w) === want)) return Math.max(0, at.s + c.anchor.offset);
  let best = -1,
    bd = 1e9;
  words.forEach((w, i) => {
    if (clean(w.w) === want && Math.abs(i - c.anchor.word) < bd) {
      bd = Math.abs(i - c.anchor.word);
      best = i;
    }
  });
  return best >= 0 ? Math.max(0, words[best].s + c.anchor.offset) : c.start;
}
const lenOf = (c, start, end) => Math.max(0.02, c.len ?? (c.loop ? Math.max(0.02, end - start) : Math.max(0.02, c.srcDur - c.in)));
export async function addClip(dir, src, o) {
  const ext = path.extname(src).slice(1).toLowerCase();
  if (!SFX_EXT.includes(ext)) throw new Error(`That file is not audio the app can use (${SFX_EXT.join(", ")}).`);
  const buf = fs.readFileSync(src),
    h = crypto.createHash("md5").update(buf).digest("hex").slice(0, 8);
  const rel = `audio/layers/${(slug(path.basename(src, path.extname(src))) || "sound").slice(0, 40)}-${h}.${ext}`,
    abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf);
  const a = await analyse(abs),
    L = layersOf(dir),
    lane = L.lanes.find((l) => l.id === o.lane) ?? L.lanes.find((l) => l.id === "effects"),
    d = LANE_DEFAULTS[lane.kind];
  const start = r3(Math.max(0, o.start ?? 0)),
    words = wordsOf(dir);
  let anchor = null;
  if (o.anchorWord !== false && words.length && lane.kind !== "music" && lane.kind !== "ambience") {
    let bi = -1,
      bd = 0.25;
    words.forEach((w, i) => {
      const dd = Math.abs(w.s - start);
      if (dd < bd) {
        bd = dd;
        bi = i;
      }
    });
    if (bi >= 0 && o.anchorWord) anchor = { word: bi, text: words[bi].w, offset: r3(start - words[bi].s) };
  }
  const clip = {
    id: crypto.randomBytes(4).toString("hex"),
    lane: lane.id,
    file: rel,
    name: (o.name || path.basename(src)).slice(0, 120),
    start,
    in: 0,
    len: null,
    loop: d.loop,
    fadeIn: d.fadeIn,
    fadeOut: d.fadeOut,
    gain: d.gain,
    pan: 0,
    duck: d.duck,
    anchor,
    srcDur: a.duration,
    lufs: a.lufs,
    libId: o.libId ?? null,
  };
  const out = saveLayers(dir, { ...L, clips: [...L.clips, clip] });
  return { layers: out, clip: out.clips.find((c) => c.id === clip.id) };
}
export function layersMixFile(dir) {
  const L = layersOf(dir),
    f = path.join(dir, "audio", "layers_mix.json"),
    end = +readPj(dir).end || 0,
    words = wordsOf(dir);
  const solo = L.lanes.some((l) => l.solo),
    on = new Set(L.lanes.filter((l) => !l.mute && (!solo || l.solo)).map((l) => l.id));
  const clips = L.clips
    .filter((c) => on.has(c.lane))
    .map((c) => {
      const lane = L.lanes.find((l) => l.id === c.lane),
        start = startOf(c, words),
        len = lenOf(c, start, end || start + c.srcDur);
      return {
        file: path.join(dir, c.file),
        start: r3(start),
        in: c.in,
        len: r3(len),
        loop: c.loop,
        fadeIn: c.fadeIn,
        fadeOut: c.fadeOut,
        pan: c.pan,
        duck: c.duck,
        gain: +(c.gain + lane.gain + (c.lufs != null ? Math.max(-24, Math.min(24, REF_LUFS - c.lufs)) : 0)).toFixed(2),
      };
    })
    .filter((c) => c.gain > -59);
  if (!clips.length) {
    fs.rmSync(f, { force: true });
    return null;
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ clips }, null, 1));
  return f;
}
export const hasLayers = (dir) => layersOf(dir).clips.length > 0;
export function remapLayers(dir, oldCuts, newCuts) {
  const pj = readPj(dir);
  if (!pj.audioLayers?.clips?.length) return false;
  const L = layersOf(dir);
  let moved = false;
  for (const c of L.clips)
    if (!c.anchor) {
      const t = r3(toCut(fromCut(c.start, oldCuts), newCuts));
      if (t !== c.start) {
        c.start = t;
        moved = true;
      }
    }
  if (moved) saveLayers(dir, L);
  return moved;
}
