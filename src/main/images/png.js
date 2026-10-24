import zlib from "node:zlib";

export function matte(src, { tol = 30, soft = 26, pad = 6 } = {}) {
  const { data, w, h } = src,
    n = w * h;
  const border = [];
  for (let x = 0; x < w; x += 2) {
    border.push(px(data, x, 0, w), px(data, x, h - 1, w));
  }
  for (let y = 0; y < h; y += 2) {
    border.push(px(data, 0, y, w), px(data, w - 1, y, w));
  }
  const bg = [0, 1, 2].map((c) => border.map((p) => p[c]).sort((a, b) => a - b)[border.length >> 1]);
  const dist = (i) => Math.max(Math.abs(data[i * 4] - bg[0]), Math.abs(data[i * 4 + 1] - bg[1]), Math.abs(data[i * 4 + 2] - bg[2]));
  const isBg = new Uint8Array(n),
    stack = new Int32Array(n);
  let sp = 0;
  const seed = (i) => {
    if (!isBg[i] && dist(i) <= tol) {
      isBg[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (sp) {
    const i = stack[--sp],
      x = i % w,
      y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  const seen = new Uint8Array(n),
    region = new Int32Array(n),
    holeTol = Math.min(10, tol / 3),
    minArea = n * 8e-4;
  for (let s = 0; s < n; s++) {
    if (isBg[s] || seen[s] || dist(s) > holeTol) continue;
    let len = 0,
      qp = 0;
    region[len++] = s;
    seen[s] = 1;
    while (qp < len) {
      const i = region[qp++],
        x = i % w,
        y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (j >= 0 && !seen[j] && !isBg[j] && dist(j) <= holeTol) {
          seen[j] = 1;
          region[len++] = j;
        }
    }
    if (len >= minArea) for (let k = 0; k < len; k++) isBg[region[k]] = 1;
  }
  const out = Buffer.alloc(n * 4);
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1,
    cover = 0;
  for (let i = 0; i < n; i++) {
    if (isBg[i]) continue;
    const x = i % w,
      y = (i / w) | 0;
    const edge = (x > 0 && isBg[i - 1]) || (x < w - 1 && isBg[i + 1]) || (y > 0 && isBg[i - w]) || (y < h - 1 && isBg[i + w]);
    let a = 1;
    if (edge) a = Math.min(1, Math.max(0.15, (dist(i) - tol) / soft + 0.35));
    const o = i * 4;
    for (let c = 0; c < 3; c++) out[o + c] = a >= 1 ? data[o + c] : clamp((data[o + c] - bg[c] * (1 - a)) / a);
    out[o + 3] = Math.round(a * 255);
    cover++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return { data: out, w, h, cover: 0 };
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1,
    ch = y1 - y0 + 1,
    crop = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.copy(crop, y * cw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4);
  return { data: crop, w: cw, h: ch, cover: cover / n };
}
const px = (d, x, y, w) => {
  const o = (y * w + x) * 4;
  return [d[o], d[o + 1], d[o + 2]];
};
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export function shrink(src, max) {
  const k = Math.max(src.w, src.h) / max;
  if (k <= 1) return src;
  const w = Math.max(1, Math.round(src.w / k)),
    h = Math.max(1, Math.round(src.h / k)),
    out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * k),
        sx1 = Math.min(src.w, Math.floor((x + 1) * k)),
        sy0 = Math.floor(y * k),
        sy1 = Math.min(src.h, Math.floor((y + 1) * k));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        cnt = 0;
      for (let yy = sy0; yy < sy1; yy++)
        for (let xx = sx0; xx < sx1; xx++) {
          const o2 = (yy * src.w + xx) * 4,
            al = src.data[o2 + 3];
          r += src.data[o2] * al;
          g += src.data[o2 + 1] * al;
          b += src.data[o2 + 2] * al;
          a += al;
          cnt++;
        }
      const o = (y * w + x) * 4;
      if (a) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / Math.max(1, cnt));
    }
  return { data: out, w, h };
}
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b) => {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, "ascii"), body]),
    crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
export function encodePng({ data, w, h }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export function bgraToRgba(b) {
  for (let i = 0; i < b.length; i += 4) {
    const t = b[i];
    b[i] = b[i + 2];
    b[i + 2] = t;
  }
  return b;
}
