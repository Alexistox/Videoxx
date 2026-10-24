export const STAGES = ["idea", "script", "voiceover", "building", "review", "ready", "scheduled", "published"];
export const STAGE_LABEL = {
  idea: "Idea",
  script: "Script",
  voiceover: "Voiceover",
  building: "Building",
  review: "Review",
  ready: "Ready",
  scheduled: "Scheduled",
  published: "Published",
};
export const CHANNEL_COLORS = [
  "#89bea4",
  "#84a9d8",
  "#b496db",
  "#d7b461",
  "#db9393",
  "#e0a46e",
  "#6fc3c9",
  "#c7d27a",
  "#d996c4",
  "#a3a3a3",
];
export const CHANNEL_COLOR_NAMES = {
  "#89bea4": "Green",
  "#84a9d8": "Blue",
  "#b496db": "Purple",
  "#d7b461": "Gold",
  "#db9393": "Red",
  "#e0a46e": "Orange",
  "#6fc3c9": "Teal",
  "#c7d27a": "Lime",
  "#d996c4": "Pink",
  "#a3a3a3": "Grey",
};
const pad = (n) => String(n).padStart(2, "0");
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dayStr(new Date());
export const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dayStr(d);
};
const dayNum = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(new Date(y, m - 1, d).getTime() / 864e5);
};
export const daysUntil = (due) => dayNum(due) - dayNum(today());
export function dueState(due, stage) {
  if (!due || stage === "published" || stage === "scheduled") return null;
  const n = daysUntil(due);
  return n < 0 ? "over" : n <= 1 ? "soon" : n <= 7 ? "week" : "later";
}
export function dueLabel(due, stage) {
  const n = daysUntil(due),
    [y, m, d] = due.split("-").map(Number),
    dt = new Date(y, m - 1, d);
  const date = () =>
    dt.toLocaleDateString(void 0, { day: "numeric", month: "short", ...(y !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  if (stage === "published" || stage === "scheduled") return "Due " + date();
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n === -1) return "1 day late";
  if (n < 0) return `${-n} days late`;
  return "Due " + (n < 7 ? dt.toLocaleDateString(void 0, { weekday: "short" }) : date());
}
export const dueChip = (due, stage) => {
  const s = dueLabel(due, stage).replace(/^Due /, "");
  return s[0].toUpperCase() + s.slice(1);
};
export function dateProblem(el, v) {
  if (el?.validity.badInput) return "That date is not complete: fill in the day, the month and the year.";
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "That date is not valid: the year has four digits.";
  return null;
}
export const DATE_LIMITS = { max: "9999-12-31" };
export const isEnter = (e) => e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;
export function swallowClicks(ms = 450) {
  const stop = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };
  for (const t of ["click", "dblclick", "auxclick"]) window.addEventListener(t, stop, true);
  setTimeout(() => {
    for (const t of ["click", "dblclick", "auxclick"]) window.removeEventListener(t, stop, true);
  }, ms);
}
