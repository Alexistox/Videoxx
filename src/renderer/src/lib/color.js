export function normHex(v) {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return void 0;
  let s = v.trim().toLowerCase();
  if (!s) return null;
  if (!s.startsWith("#")) s = "#" + s;
  if (/^#[0-9a-f]{3}$/.test(s)) s = "#" + [...s.slice(1)].map((c) => c + c).join("");
  return /^#[0-9a-f]{6}$/.test(s) ? s : void 0;
}
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
}
const contrast = (a, b) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
export const textOn = (hex) => (contrast("#ffffff", hex) >= contrast("#111111", hex) ? "#ffffff" : "#111111");
