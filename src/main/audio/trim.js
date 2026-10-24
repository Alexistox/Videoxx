import path from "node:path";
import fs from "node:fs";

export const TRIM_DEFAULTS = { thr: -40, minMs: 350, amount: 70 };
export function toCut(t, cuts) {
  let removed = 0;
  for (const [a, b] of cuts) {
    if (t <= a) break;
    if (t < b) return a - removed;
    removed += b - a;
  }
  return t - removed;
}
export function fromCut(t, cuts) {
  let removed = 0;
  for (const [a, b] of cuts) {
    if (t < a - removed) break;
    removed += b - a;
  }
  return t + removed;
}
const readPj = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
  } catch {
    return {};
  }
};
export function trimOf(dir) {
  const t = readPj(dir).trim;
  return { ...TRIM_DEFAULTS, ...(t && typeof t === "object" ? t : {}), applied: !!t?.applied };
}
export function setTrim(dir, t) {
  const f = path.join(dir, "project.json"),
    pj = readPj(dir);
  pj.trim = { thr: +t.thr, minMs: +t.minMs, amount: +t.amount, applied: !!t.applied };
  fs.writeFileSync(f, JSON.stringify(pj, null, 1));
}
export function trimArgs(dir) {
  const t = trimOf(dir);
  if (!t.applied) return null;
  return ["--amount", String(t.amount), "--thr", String(t.thr), "--min-ms", String(t.minMs)];
}
function readWav(f) {
  const b = fs.readFileSync(f);
  let o = 12,
    sr = 48e3,
    ch = 1,
    bits = 16;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4),
      size = b.readUInt32LE(o + 4);
    if (id === "fmt ") {
      ch = b.readUInt16LE(o + 10);
      sr = b.readUInt32LE(o + 12);
      bits = b.readUInt16LE(o + 22);
    }
    if (id === "data") {
      if (bits !== 16) throw new Error("The voiceover copy is not 16-bit audio: clean the audio once first.");
      const n = Math.floor(Math.min(size, b.length - o - 8) / 2 / ch),
        x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + i * 2 * ch) / 32768;
      return { x, sr };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error("No audio data in the voiceover copy.");
}
export function trimView(dir) {
  const raw = path.join(dir, "audio", "raw.wav");
  if (!fs.existsSync(raw)) throw new Error("Clean the audio once first (Pipeline, Audio cleaned).");
  const { x, sr } = readWav(raw),
    fr = Math.round(sr * 0.01),
    nf = Math.floor(x.length / fr),
    db = [];
  for (let k = 0; k < nf; k++) {
    let s = 0;
    for (let i = k * fr; i < (k + 1) * fr; i++) s += x[i] * x[i];
    db.push(Math.round(10 * Math.log10(s / fr + 1e-12) * 10) / 10);
  }
  const P = 1500,
    per = x.length / P,
    peaks = [];
  for (let p = 0; p < P; p++) {
    let m = 0;
    for (let i = Math.floor(p * per); i < Math.floor((p + 1) * per); i++) {
      const v = Math.abs(x[i]);
      if (v > m) m = v;
    }
    peaks.push(Math.round(m * 1e3) / 1e3);
  }
  return { db, peaks, duration: x.length / sr, trim: trimOf(dir), keep: keptPauses(dir) };
}
function keptPauses(dir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, ".suite", "tts", "pauses.json"), "utf8"));
    return p.size === fs.statSync(path.join(dir, "audio", "source.wav")).size && Array.isArray(p.keep) ? p.keep : [];
  } catch {
    return [];
  }
}
export const readCuts = (dir) => {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, "audio", "cuts.json"), "utf8"));
    return Array.isArray(c) ? c : [];
  } catch {
    return [];
  }
};
export function remapTimings(dir, oldCuts, newCuts) {
  const m = (t) => Math.round(toCut(fromCut(t, oldCuts), newCuts) * 1e3) / 1e3;
  const tlf = path.join(dir, "audio", "timeline.json");
  if (!fs.existsSync(tlf)) return false;
  const tl = JSON.parse(fs.readFileSync(tlf, "utf8"));
  if (!Array.isArray(tl)) return false;
  for (const ph of tl) {
    ph.s = m(ph.s);
    ph.e = m(ph.e);
    for (const w of ph.words ?? []) {
      w.s = m(w.s);
      w.e = m(w.e);
    }
  }
  const cj = path.join(dir, "audio", "clean.json");
  try {
    const c = JSON.parse(fs.readFileSync(cj, "utf8"));
    for (const w of c.words ?? []) {
      w.start = m(w.start);
      w.end = m(w.end);
    }
    for (const s of c.segments ?? []) {
      s.start = m(s.start);
      s.end = m(s.end);
    }
    fs.writeFileSync(cj, JSON.stringify(c));
  } catch {}
  const srt = path.join(dir, "audio", "captions.srt");
  try {
    const t = (h, mi, s2, ms) => +h * 3600 + +mi * 60 + +s2 + +ms / 1e3;
    const ts = (x) => {
      const v = Math.max(0, Math.round(x * 1e3)),
        p = (n, w = 2) => String(n).padStart(w, "0");
      return `${p(Math.floor(v / 36e5))}:${p(Math.floor(v / 6e4) % 60)}:${p(Math.floor(v / 1e3) % 60)},${p(v % 1e3, 3)}`;
    };
    const s = fs
      .readFileSync(srt, "utf8")
      .split("\n")
      .map((l) =>
        !l.includes("-->")
          ? l
          : l.replace(/(\d+):(\d\d):(\d\d)[,.](\d{1,3})/g, (_, h, mi, se, ms) => ts(m(t(h, mi, se, ms.padEnd(3, "0"))))),
      )
      .join("\n");
    fs.writeFileSync(srt, s);
  } catch {}
  fs.writeFileSync(tlf, JSON.stringify(tl, null, 1));
  if (tl.length) {
    const f = path.join(dir, "project.json"),
      pj = readPj(dir);
    pj.end = +(tl.at(-1).e + 1.2).toFixed(2);
    fs.writeFileSync(f, JSON.stringify(pj, null, 1));
  }
  return true;
}
