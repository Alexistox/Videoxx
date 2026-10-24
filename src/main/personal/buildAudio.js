import fs from "node:fs";
import cp from "node:child_process";
import { ffmpegBin } from "../pipeline/ffmpeg";

const SR = 48e3,
  CH = 2;
let Reader = class Reader {
  // frames delivered so far (source frame index)
  constructor(file, mixWith, job) {
    this.file = file;
    this.mixWith = mixWith;
    this.job = job;
  }
  file;
  mixWith;
  job;
  proc = null;
  chunks = [];
  have = 0;
  ended = false;
  waiter = null;
  pos = 0;
  open(from) {
    this.close();
    this.pos = from;
    this.chunks = [];
    this.have = 0;
    this.ended = false;
    if (!this.file) {
      this.ended = true;
      return;
    }
    const ss = ["-ss", (from / SR).toFixed(6)];
    const args = this.mixWith
      ? [
          "-v",
          "error",
          ...ss,
          "-i",
          this.file,
          ...ss,
          "-i",
          this.mixWith,
          "-filter_complex",
          `[0:a]aresample=${SR}[a];[1:a]aresample=${SR}[b];[a][b]amix=inputs=2:normalize=0:duration=first`,
          "-ac",
          String(CH),
          "-f",
          "s16le",
          "-",
        ]
      : ["-v", "error", ...ss, "-i", this.file, "-map", "0:a:0", "-ac", String(CH), "-ar", String(SR), "-f", "s16le", "-"];
    const p = cp.spawn(ffmpegBin(), args, { windowsHide: true });
    this.proc = p;
    p.stdout.on("data", (d) => {
      this.chunks.push(d);
      this.have += d.length;
      if (this.have > 16 << 20) p.stdout.pause();
      this.waiter?.();
    });
    p.on("close", () => {
      this.ended = true;
      this.waiter?.();
    });
    p.on("error", () => {
      this.ended = true;
      this.waiter?.();
    });
  }
  close() {
    try {
      this.proc?.kill();
    } catch {}
    this.proc = null;
  }
  async take(bytes) {
    while (this.have < bytes && !this.ended) {
      if (this.job.cancelled) throw new Error("Cancelled");
      this.proc?.stdout?.resume();
      await new Promise((r) => {
        this.waiter = r;
      });
      this.waiter = null;
    }
    const all = Buffer.concat(this.chunks),
      n = Math.min(bytes, all.length);
    const out = Buffer.alloc(bytes);
    all.copy(out, 0, 0, n);
    this.chunks = n < all.length ? [all.subarray(n)] : [];
    this.have = all.length - n;
    if (this.have < 8 << 20) this.proc?.stdout?.resume();
    return out;
  }
  /** Frames [from, from + n) as interleaved floats. */
  async read(from, n) {
    if ((!this.proc && !this.ended) || from < this.pos || from - this.pos > SR * 30) this.open(from);
    if (from > this.pos) {
      let skip = (from - this.pos) * CH * 2;
      while (skip > 0) {
        const b2 = await this.take(Math.min(skip, 4 << 20));
        skip -= b2.length;
      }
      this.pos = from;
    }
    const b = await this.take(n * CH * 2);
    this.pos += n;
    const f = new Float32Array(n * CH);
    for (let i = 0; i < f.length; i++) f[i] = b.readInt16LE(i * 2) / 32768;
    return f;
  }
};
class WavWriter {
  constructor(file) {
    this.file = file;
    this.fd = fs.openSync(file, "w");
    fs.writeSync(this.fd, Buffer.alloc(44));
  }
  file;
  fd;
  frames = 0;
  write(f) {
    const b = Buffer.alloc(f.length * 2);
    for (let i = 0; i < f.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767))), i * 2);
    fs.writeSync(this.fd, b);
    this.frames += f.length / CH;
  }
  close() {
    const data = this.frames * CH * 2,
      h = Buffer.alloc(44);
    h.write("RIFF", 0);
    h.writeUInt32LE(36 + data, 4);
    h.write("WAVE", 8);
    h.write("fmt ", 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(CH, 22);
    h.writeUInt32LE(SR, 24);
    h.writeUInt32LE(SR * CH * 2, 28);
    h.writeUInt16LE(CH * 2, 32);
    h.writeUInt16LE(16, 34);
    h.write("data", 36);
    h.writeUInt32LE(data, 40);
    fs.writeSync(this.fd, h, 0, 44, 0);
    fs.closeSync(this.fd);
    return this.frames;
  }
}
export async function buildAudio(edit, segs, files, out, job, onProgress) {
  const XF = Math.round((edit.xfade ?? 0.02) * SR),
    readers = new Map(),
    w = new WavWriter(out);
  const reader = (id) => {
    let r = readers.get(id);
    if (!r) {
      const f = files[id];
      r = new Reader(f?.audio ? f.file : null, f?.mixWith ?? null, job);
      readers.set(id, r);
    }
    return r;
  };
  const fi = new Float32Array(XF),
    fo = new Float32Array(XF);
  for (let k = 0; k < XF; k++) {
    fi[k] = Math.sin(((k / XF) * Math.PI) / 2);
    fo[k] = Math.cos(((k / XF) * Math.PI) / 2);
  }
  let tail = null;
  try {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i],
        c = s.clip,
        a = Math.round(c.in * SR),
        b = Math.round(c.out * SR),
        n = b - a;
      const pcm = await reader(c.src).read(a, n);
      let start = 0;
      if (tail) {
        const m = new Float32Array(XF * CH);
        for (let k = 0; k < XF; k++)
          for (let ch = 0; ch < CH; ch++)
            m[k * CH + ch] = tail[k * CH + ch] * fo[k] + (k * CH + ch < pcm.length ? pcm[k * CH + ch] * fi[k] : 0);
        w.write(m);
        start = XF;
        tail = null;
      }
      const end = s.cutAfter ? Math.max(start, n - XF) : n;
      if (end > start) w.write(pcm.subarray(start * CH, end * CH));
      if (s.cutAfter) {
        const t = new Float32Array(XF * CH);
        t.set(pcm.subarray(end * CH, Math.min(n, end + XF) * CH));
        tail = t;
      }
      onProgress?.((i + 1) / segs.length);
    }
    if (tail) w.write(tail);
  } finally {
    readers.forEach((r) => r.close());
  }
  return w.close() / SR;
}
