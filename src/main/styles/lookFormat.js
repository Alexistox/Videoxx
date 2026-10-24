const IGNORED = new Set(["format", "sheet.cols"]);
function canon(v, at = "") {
  if (Array.isArray(v)) return v.map((x) => canon(x));
  if (!v || typeof v !== "object") return v;
  const out = {};
  for (const k of Object.keys(v).sort()) {
    const p = at ? `${at}.${k}` : k;
    if (IGNORED.has(p)) continue;
    const c = canon(v[k], p);
    if (c === void 0 || (c && typeof c === "object" && !Array.isArray(c) && !Object.keys(c).length)) continue;
    out[k] = c;
  }
  return out;
}
const sameButFormat = (a, b) => JSON.stringify(canon(a ?? {})) === JSON.stringify(canon(b ?? {}));
export function withFormat(settings, format, base, cols) {
  if (!settings || !format || settings.format === format) return settings;
  const s = { ...settings, format };
  if (base === "collage") s.sheet = { ...(settings.sheet || {}), cols: cols ?? (format === "vertical" ? 2 : 4) };
  return s;
}
export const lookInFormat = (look, looks, format) =>
  !format || look.settings?.format === format
    ? look
    : (looks.find((m) => m.id !== look.id && m.builtin && m.settings?.format === format && sameButFormat(m.settings, look.settings)) ??
      look);
