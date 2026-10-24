export const fmtTime = (s, dec = 1) => {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(dec).padStart(dec ? 3 + dec : 2, "0")}`;
};
export const ago = (iso) => {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1e3;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(void 0, { month: "short", day: "numeric" });
};
export const money = (n) => (n < 0.01 && n > 0 ? "<$0.01" : `$${(n || 0).toFixed(2)}`);
export const secs = (ms) => (ms < 6e4 ? `${Math.round(ms / 1e3)}s` : `${Math.floor(ms / 6e4)}m ${Math.round((ms % 6e4) / 1e3)}s`);
export const fmtLength = (s) => {
  const t = Math.max(0, Math.round(+s || 0)),
    h = Math.floor(t / 3600),
    m = Math.floor((t % 3600) / 60),
    sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
export const fmtPlayed = (s) => fmtLength(Math.floor(+s || 0));
export const unheardWords = (j) =>
  j.autoTime && j.timing && j.timing.total >= 8 && j.timing.matched < j.timing.total * 0.85 ? j.timing.total - j.timing.matched : 0;
export function parseLength(v) {
  const t = v.trim().toLowerCase();
  let m;
  if ((m = t.match(/^(\d+):(\d{1,2}):(\d{1,2})$/))) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  if ((m = t.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*m(in)?$/))) return Math.round(+m[1] * 60);
  if ((m = t.match(/^(\d+)\s*s?$/))) return +m[1];
  return null;
}
export const brief = (e) => {
  const first = String(e ?? "")
    .split(/(?<=[.!?])\s/)[0]
    .trim();
  return first && first.length <= 140 ? `: ${first.replace(/[.!?]$/, "")}.` : ". Open it to see why.";
};
