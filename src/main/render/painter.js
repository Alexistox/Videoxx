import path from "node:path";
import fs from "node:fs";
import { BrowserWindow } from "electron";
import { templatesDir } from "../core/workspace";

export const PW = 1080,
  PH = 1920,
  CAP_H = 360;
const PAINTER = String.raw`
const F = 'CzInter, Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
window.czFonts = async (b64s) => {
  const w = ['800', '600'];
  for (let i = 0; i < b64s.length; i++) { const bytes = Uint8Array.from(atob(b64s[i]), c => c.charCodeAt(0)); const f = new FontFace('CzInter', bytes.buffer, { weight: w[i] }); await f.load(); document.fonts.add(f); }
  return true;
};
// the pieces of the bundled fonts for letters Inter lacks (Japanese, Korean, Chinese, Thai, Hindi), under the same family
window.czScriptFonts = async (pieces) => {
  for (const p of pieces) { const bytes = Uint8Array.from(atob(p.b64), c => c.charCodeAt(0)).buffer;
    for (const weight of ['800', '600']) { const f = new FontFace('CzInter', bytes, { weight, unicodeRange: p.range }); await f.load(); document.fonts.add(f); } }
  return true;
};
const fit = (x, lines, weight, size, maxW) => { let s = size; for (; s > 24; s -= 2) { x.font = weight + ' ' + s + 'px ' + F; if (Math.max(...lines.map(l => x.measureText(l).width)) <= maxW) break; } return s; };
// one caption card state: 1-3 words on a line, the word being spoken yellow and lifted, the card at 'scale' (its pop);
// gaps[i] 0: no space after word i (Japanese, Chinese and Thai words sit together)
window.czCaption = (words, active, scale, gaps) => {
  const c = document.createElement('canvas'); c.width = ${PW}; c.height = ${CAP_H}; const x = c.getContext('2d');
  const gap = i => !gaps || gaps[i] !== 0 ? 1 : 0;
  const size = fit(x, [words.map((w, i) => w + (i < words.length - 1 && gap(i) ? ' ' : '')).join('')], 800, 104, 940), space = size * .27;
  x.font = '800 ' + size + 'px ' + F; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.miterLimit = 2;
  const ws = words.map(w => x.measureText(w).width), total = ws.reduce((a, b) => a + b, 0) + ws.slice(0, -1).reduce((a, _, i) => a + space * gap(i), 0);
  x.translate(${PW / 2}, ${CAP_H / 2}); x.scale(scale, scale);
  const at = []; let px = -total / 2; ws.forEach((w, i) => { at.push(px); px += w + space * gap(i); });
  const lift = i => i === active ? -4 : 0;
  x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 10; x.shadowOffsetY = 4; x.strokeStyle = '#1b1238'; x.lineWidth = size * .17;
  words.forEach((w, i) => x.strokeText(w, at[i], lift(i))); x.restore();
  x.strokeStyle = '#1b1238'; x.lineWidth = size * .17; words.forEach((w, i) => x.strokeText(w, at[i], lift(i)));
  words.forEach((w, i) => { x.fillStyle = i === active ? '#ffd23d' : '#ffffff'; x.fillText(w, at[i], lift(i)); });
  return c.toDataURL('image/png');
};
// the end card's words, each its own full-frame layer (they fade and rise in one after another), laid out around the
// picture: the block sits a little above the middle (the apps put their buttons over the bottom quarter)
window.czCard = (head, name, pic, accent) => {
  const mk = () => { const c = document.createElement('canvas'); c.width = ${PW}; c.height = ${PH}; return [c, c.getContext('2d')]; };
  const [m, mx] = mk();
  const hs = head.length ? fit(mx, head, 800, 132, 960) : 0, ns = name.length ? fit(mx, name, 600, 80, 940) : 0;
  const parts = [];
  if (pic) parts.push(['pic', pic.h]);
  if (head.length) parts.push(['head', head.length * hs * 1.12]);
  if (head.length && name.length) parts.push(['bar', 10]);
  if (name.length) parts.push(['name', name.length * ns * 1.2]);
  const gap = (a, b) => a === 'pic' ? 84 : a === 'head' || a === 'bar' ? 40 : 56;
  const total = parts.reduce((s, [k, h], i) => s + h + (i ? gap(parts[i - 1][0], k) : 0), 0);
  let y = Math.max(140, Math.round(880 - total / 2)); const pos = {};
  parts.forEach(([k, h], i) => { if (i) y += gap(parts[i - 1][0], k); pos[k] = y; y += h; });
  const out = { picTop: pos.pic ?? 0 };
  const text = (lines, weight, size, color, top, lh) => { const [c, x] = mk(); x.font = weight + ' ' + size + 'px ' + F; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 18; x.shadowOffsetY = 5; x.fillStyle = color;
    lines.forEach((l, i) => x.fillText(l, ${PW / 2}, top + (i + .5) * size * lh)); return c.toDataURL('image/png'); };
  if (head.length) out.head = text(head, 800, hs, '#ffffff', pos.head, 1.12);
  if (name.length) out.name = text(name, 600, ns, '#d3e5d9', pos.name, 1.2);
  if (pos.bar != null) { const [c, x] = mk(); x.fillStyle = accent; x.beginPath(); x.roundRect(${PW / 2} - 65, pos.bar, 130, 10, 5); x.fill(); out.bar = c.toDataURL('image/png'); }
  if (pic && pic.kind === 'cover') {                  // a play button on the video's picture
    const [c, x] = mk(), cx = ${PW / 2}, cy = pos.pic + pic.h / 2;
    x.shadowColor = 'rgba(0,0,0,.4)'; x.shadowBlur = 16; x.fillStyle = 'rgba(20,20,20,.72)'; x.beginPath(); x.arc(cx, cy, 56, 0, Math.PI * 2); x.fill();
    x.shadowColor = 'transparent'; x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 3; x.stroke();
    x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(cx - 16, cy - 26); x.lineTo(cx + 30, cy); x.lineTo(cx - 16, cy + 26); x.closePath(); x.fill();
    out.play = c.toDataURL('image/png');
  }
  return out;
};
// a picture ffmpeg can't read (an animated WebP, say) as a still PNG of its first frame, at most max px; null if Chromium can't either
window.czStill = async (src, max) => {
  try {
    const img = new Image(); img.src = src; await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/png');
  } catch { return null; }
};
true;`;
function scriptPieces(text, language) {
  const kind = (c) =>
    (c >= 2304 && c <= 2431) || (c >= 43232 && c <= 43263) || (c >= 7376 && c <= 7423)
      ? "deva"
      : c >= 3584 && c <= 3711
        ? "thai"
        : (c >= 4352 && c <= 4607) || (c >= 12592 && c <= 12687) || (c >= 43360 && c <= 43391) || (c >= 44032 && c <= 55295)
          ? "hangul"
          : (c >= 12352 && c <= 12543) || (c >= 12784 && c <= 12799)
            ? "kana"
            : c >= 11904
              ? "han"
              : null;
  const cps = new Set();
  for (const ch of String(text ?? "")) {
    const c = ch.codePointAt(0);
    if (c >= 2304 && kind(c)) cps.add(c);
  }
  if (!cps.size) return [];
  let man;
  const dir = path.join(templatesDir(), "host", "fonts");
  try {
    man = JSON.parse(fs.readFileSync(path.join(dir, "script", "scripts.json"), "utf8"));
  } catch {
    return [];
  }
  const has = (k) => [...cps].some((c) => kind(c) === k);
  const hanBy =
    language === "ja"
      ? "jp"
      : language === "ko"
        ? "kr"
        : language === "zh"
          ? "sc"
          : has("kana")
            ? "jp"
            : has("hangul") && !has("han")
              ? "kr"
              : "sc";
  const by = { deva: "deva", thai: "thai", hangul: "kr", kana: "jp", han: hanBy },
    want = new Map();
  for (const c of cps) {
    const id = by[kind(c)];
    want.set(id, [...(want.get(id) ?? []), c]);
  }
  const out = [];
  for (const id of [...want.keys()].sort((a, b) => Number(a === hanBy) - Number(b === hanBy))) {
    const font = man.fonts.find((f) => f.id === id);
    if (!font) continue;
    const need = font.slices.filter((s) => want.get(id).some((c) => s.cps.some(([a, b]) => c >= a && c <= b)));
    for (const s of need)
      out.push({
        b64: fs.readFileSync(path.join(dir, s.file)).toString("base64"),
        range: s.cps.map(([a, b]) => (a === b ? `U+${a.toString(16)}` : `U+${a.toString(16)}-${b.toString(16)}`)).join(","),
      });
  }
  return out;
}
export async function withPainter(fn, text = "", language) {
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const call = (expr, ms = 6e4) => {
    let timer;
    return Promise.race([
      win.webContents.executeJavaScript(expr),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error("Drawing the text took too long.")), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  };
  try {
    await win.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent('<!doctype html><meta charset="utf-8"><title>text</title><body></body>'),
    );
    await call(PAINTER);
    const fonts = ["inter-800.woff2", "inter-600.woff2"].map((f) =>
      fs.readFileSync(path.join(templatesDir(), "flat", "fonts", f)).toString("base64"),
    );
    await call(`window.czFonts(${JSON.stringify(fonts)})`);
    const pieces = scriptPieces(text, language);
    if (pieces.length) await call(`window.czScriptFonts(${JSON.stringify(pieces)})`);
    return await fn(call);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
export const savePng = (dataUrl, file) => fs.writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
