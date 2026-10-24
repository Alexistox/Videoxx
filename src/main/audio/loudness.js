const clamp16 = (v) => (v >= 32767 ? 32767 : v <= -32768 ? -32768 : Math.round(v));
const fadeLength = (len, rate, ms = 8) => Math.max(0, Math.min(Math.round((ms * rate) / 1e3), Math.floor(len / 4)));
export function fadeEdges(x, rate, ms = 8) {
  const n = fadeLength(x.length, rate, ms),
    L = x.length;
  for (let i = 0; i < n; i++) {
    const g = Math.sin(((Math.PI / 2) * (i + 0.5)) / n);
    x[i] = clamp16(x[i] * g);
    x[L - 1 - i] = clamp16(x[L - 1 - i] * g);
  }
  return x;
}
const ZEROS = 40,
  BETA = 8.6,
  CUT = 0.94,
  RES = 512;
function bessel0(x) {
  let s = 1,
    t = 1;
  for (let k = 1; k < 50; k++) {
    t *= (x / (2 * k)) ** 2;
    s += t;
    if (t < 1e-12 * s) break;
  }
  return s;
}
let TABLE = null;
function table() {
  if (TABLE) return TABLE;
  const t = new Float64Array(ZEROS * RES + 2),
    i0 = bessel0(BETA);
  for (let i = 0; i < t.length; i++) {
    const u = i / RES,
      r = u / ZEROS;
    t[i] = r >= 1 ? 0 : ((u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)) * bessel0(BETA * Math.sqrt(1 - r * r))) / i0;
  }
  return (TABLE = t);
}
function kWeighting(rate) {
  let K = Math.tan((Math.PI * 1681.974450955533) / rate),
    Q = 0.7071752369554196;
  const Vh = 10 ** (3.999843853973347 / 20),
    Vb = Vh ** 0.4996667741545416,
    a0 = 1 + K / Q + K * K;
  const shelf = [
    (Vh + (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q + K * K) / a0,
  ];
  K = Math.tan((Math.PI * 38.13547087602444) / rate);
  Q = 0.5003270373238773;
  const d = 1 + K / Q + K * K;
  return [shelf, [1, -2, 1, (2 * (K * K - 1)) / d, (1 - K / Q + K * K) / d]];
}
export function loudnessBlocks(x, rate) {
  const [f, g] = kWeighting(rate),
    hop = Math.max(1, Math.round(rate / 10)),
    segs = [];
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0,
    u1 = 0,
    u2 = 0,
    v1 = 0,
    v2 = 0,
    sum = 0,
    all = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] / 32768;
    const y = f[0] * xi + f[1] * x1 + f[2] * x2 - f[3] * y1 - f[4] * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = y;
    const v = g[0] * y + g[1] * u1 + g[2] * u2 - g[3] * v1 - g[4] * v2;
    u2 = u1;
    u1 = y;
    v2 = v1;
    v1 = v;
    sum += v * v;
    all += v * v;
    if ((i + 1) % hop === 0) {
      segs.push(sum);
      sum = 0;
    }
  }
  if (segs.length < 4) return x.length ? [all / x.length] : [];
  const out = [];
  for (let k = 0; k + 4 <= segs.length; k++) out.push((segs[k] + segs[k + 1] + segs[k + 2] + segs[k + 3]) / (4 * hop));
  return out;
}
export function gatedLoudness(blocks) {
  const L = (ms) => -0.691 + 10 * Math.log10(ms);
  const loud = blocks.filter((p) => p > 0 && L(p) > -70);
  if (!loud.length) return null;
  const rel = L(loud.reduce((s, p) => s + p, 0) / loud.length) - 10,
    kept = loud.filter((p) => L(p) > rel);
  return L(kept.reduce((s, p) => s + p, 0) / kept.length);
}
export function gainInPlace(x, gain) {
  for (let i = 0; i < x.length; i++) x[i] = clamp16(x[i] * gain);
  return x;
}
export function resample(x, from, to) {
  if (from === to || !x.length) return x;
  const n = Math.round((x.length * to) / from),
    y = new Int16Array(n),
    step = from / to,
    tb = table();
  const scale = Math.min(1, to / from) * CUT;
  const half = ZEROS / scale;
  const kStep = scale * RES;
  for (let i = 0; i < n; i++) {
    const p = i * step,
      k0 = Math.max(0, Math.ceil(p - half)),
      k1 = Math.min(x.length - 1, Math.floor(p + half));
    let s = 0;
    for (let k = k0; k <= k1; k++) {
      const f = Math.abs(p - k) * kStep,
        j = f | 0,
        w = j + 1 < tb.length ? tb[j] + (tb[j + 1] - tb[j]) * (f - j) : 0;
      s += x[k] * w;
    }
    y[i] = clamp16(s * scale);
  }
  return y;
}
