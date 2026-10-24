const ERRORS = [];
export function noteError(text, where = "") {
  const t = String(text ?? "").trim();
  if (!t) return;
  const last = ERRORS[ERRORS.length - 1];
  if (last && last.text === t && Date.now() - last.at < 5e3) return;
  ERRORS.push({ text: t.slice(0, 1200), where, at: Date.now() });
  if (ERRORS.length > 8) ERRORS.shift();
}
export const recentErrors = (n = 3) =>
  ERRORS.filter((e) => Date.now() - e.at < 30 * 6e4)
    .slice(-n)
    .map((e) => (e.where ? `[${e.where}] ` : "") + e.text);
