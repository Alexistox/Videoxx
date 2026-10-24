export function cacheUrl(thumbUrl, file) {
  if (!file) return null;
  if (/^(https?|file|data):/.test(file)) return file;
  const at = thumbUrl?.indexOf("/.suite/refs/") ?? -1,
    m = /[\\/]\.suite[\\/]refs[\\/](.+)$/.exec(file);
  if (at < 0 || !m) return null;
  return thumbUrl.slice(0, at) + "/.suite/refs/" + m[1].split(/[\\/]/).map(encodeURIComponent).join("/");
}
const MENTION_RE = /@((?:img|vid|aud|doc|mdl)\d+)(?:\[([0-9:.]+)\s*-\s*([0-9:.]+)\]|@([0-9:.]+)\s*-\s*([0-9:.]+))?/g;
export function parseMentions(text) {
  const out = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const before = m.index > 0 ? text[m.index - 1] : "";
    if (before && /[\w@]/.test(before)) continue;
    const s0 = m[2] ?? m[4],
      s1 = m[3] ?? m[5];
    const a = s0 != null ? parseTime(s0) : null,
      b = s1 != null ? parseTime(s1) : null;
    const has = s0 != null,
      ok = has && a != null && b != null && b > a;
    out.push({ start: m.index, end: m.index + m[0].length, tag: m[1], raw: m[0], range: ok ? [a, b] : null, badRange: has && !ok });
  }
  return out;
}
export function parseTime(s) {
  const t = String(s).trim().replace(",", ".");
  if (!t) return null;
  if (!/^\d+(?:\.\d+)?$|^\d+:\d{1,2}(?:\.\d+)?$|^\d+:\d{1,2}:\d{1,2}(?:\.\d+)?$/.test(t)) return null;
  const p = t.split(":").map(Number);
  if (p.some((x) => !isFinite(x))) return null;
  if (p.length > 1 && p.slice(1).some((x) => x >= 60)) return null;
  return p.reduce((a, x) => a * 60 + x, 0);
}
export function fmtT(sec, dec, long) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const d = dec ?? (Math.abs(sec - Math.round(sec)) > 1e-3 ? 1 : 0);
  const r = +sec.toFixed(d),
    h = Math.floor(r / 3600),
    m = Math.floor((r % 3600) / 60),
    s = r - h * 3600 - m * 60;
  const ss = (s < 10 ? "0" : "") + s.toFixed(d);
  return h || long ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
export function fmtSpan(sec) {
  if (sec < 60) return `${sec.toFixed(1)} s`;
  if (sec < 3600) {
    const m2 = Math.floor(sec / 60),
      s = Math.round(sec - m2 * 60);
    return s ? `${m2} min ${s} s` : `${m2} min`;
  }
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec - h * 3600) / 60);
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}
export const mentionOf = (tag, r) => (r ? `@${tag}[${fmtT(r.start)}-${fmtT(r.end)}]` : `@${tag}`);
const fmtBytes = (n) =>
  !n
    ? ""
    : n < 1e6
      ? `${Math.max(1, Math.round(n / 1e3))} KB`
      : n < 1e9
        ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`
        : `${(n / 1e9).toFixed(1)} GB`;
export const KIND_WORD = { image: "Image", video: "Video", audio: "Audio", pdf: "PDF", model: "3D model", other: "File" };
export function refMeta(r) {
  const p = r.probe;
  if (!p) return KIND_WORD[r.kind];
  return (
    [p.duration ? fmtT(p.duration, 0) : null, p.width && p.height ? `${p.width}×${p.height}` : null, fmtBytes(p.size)]
      .filter(Boolean)
      .join(" · ") || KIND_WORD[r.kind]
  );
}
export function shortPath(p, max = 46) {
  if (p.length <= max) return p;
  const sep = p.includes("\\") ? "\\" : "/",
    parts = p.split(/[\\/]/);
  let tail = parts.pop(),
    head = parts.shift() ?? "";
  while (parts.length && (head + sep + "…" + sep + parts[parts.length - 1] + sep + tail).length <= max) tail = parts.pop() + sep + tail;
  return head + sep + "…" + sep + tail;
}
