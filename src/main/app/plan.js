import { q } from "../db/db";

const STANDARD_EXPORTS = 12;
const LABEL = {
  routines: "Routines",
  customStyles: "Custom styles",
  characters: "Designing characters with Claude",
  "4k": "4K export",
  ultraedit: "Ultraedit",
  languages: "Other languages",
  analytics: "YouTube Analytics and learning from your channel",
};
let plan = "premium";
let getWin = () => null;
export const initPlan = (w) => {
  getWin = w;
};
export const isPremium = () => plan === "premium";
function setPlan(p) {
  p = "premium";
  if (p === plan) return;
  plan = p;
  const w = getWin();
  if (w && !w.isDestroyed()) w.webContents.send("plan:changed", planInfo());
}
class PremiumError extends Error {}
export function requireFeature(f) {
  if (!isPremium()) throw new PremiumError(`${LABEL[f]} is a Premium feature.`);
}
const monthKey = () => `exports:${new Date().toISOString().slice(0, 7)}`;
const exportsUsed = () => {
  try {
    return Number(q.get("SELECT value FROM kv WHERE key=?", monthKey())?.value ?? 0) || 0;
  } catch {
    return 0;
  }
};
function requireExport() {
  if (isPremium()) return;
  if (exportsUsed() >= STANDARD_EXPORTS)
    throw new PremiumError(
      `You've used this month's ${STANDARD_EXPORTS} exports on Standard. They reset on the 1st; Premium has unlimited exports.`,
    );
}
function countExport() {
  if (isPremium()) return;
  q.run("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", monthKey(), String(exportsUsed() + 1));
  const w = getWin();
  if (w && !w.isDestroyed()) w.webContents.send("plan:changed", planInfo());
}
export const planInfo = () => ({ plan, exportsUsed: exportsUsed(), exportsLimit: isPremium() ? null : STANDARD_EXPORTS });
const CHANNEL_FEATURE = {
  "routines:run": "routines",
  "routines:resume": "routines",
  "routines:create": "routines",
  "routines:import": "routines",
  "routines:duplicate": "routines",
  // the Style Kit (styleImport.ts, styleKit.ts): importing, fixing, adding and re-checking a style, and the kit itself (custom styles)
  "styles:importStart": "customStyles",
  "styles:importFix": "customStyles",
  "styles:importInstall": "customStyles",
  "styles:kitMake": "customStyles",
  "styles:recheck": "customStyles",
  "characters:create": "characters",
  "characters:refine": "characters",
  "youtube:sync": "analytics",
  "youtube:overview": "analytics",
  "youtube:video": "analytics",
  "youtube:insights": "analytics",
  "youtube:insightsRun": "analytics",
  "youtube:insightAdd": "analytics",
  "youtube:insightUpdate": "analytics",
  "youtube:approved": "analytics",
};
export function checkCall(ch, a) {
  const f = CHANNEL_FEATURE[ch];
  if (f) requireFeature(f);
  if (ch.startsWith("studio:")) requireFeature("customStyles");
  if (ch === "render:export") {
    if (a[1]?.uhd) requireFeature("4k");
    if (a[1]?.from == null) requireExport();
  }
  if (ch === "personal:render") {
    if (/uhd|4k|2160/i.test(String(a[2] ?? ""))) requireFeature("4k");
    requireExport();
  }
  if (ch === "vertical:export" && fullVertical(a)) requireExport();
  if (
    ch === "claude:run" &&
    (a[0]?.kind === "ultra" ||
      (a[0]?.kind === "build" && Array.isArray(a[0]?.extras) && (a[0].extras.includes("ultra") || a[0].extras.includes("ultraplus"))))
  )
    requireFeature("ultraedit");
  if (ch === "config:set") {
    const m = a[0]?.language?.mode;
    if (m && m !== "english") requireFeature("languages");
  }
  if (ch === "speech:language" && a[0]?.mode === "multi") requireFeature("languages");
  if (ch === "projects:setMeta" && a[1]?.language && !/^en/i.test(String(a[1].language))) requireFeature("languages");
  if (ch === "projects:create" && a[0]?.language && !/^en/i.test(String(a[0].language))) requireFeature("languages");
  if (ch === "projects:create" && a[0]?.character?.describe) requireFeature("characters");
}
const fullVertical = (a) => a[1]?.length !== "trailer" && a[1]?.length !== "range";
export function afterCall(ch, a, r) {
  if (
    (ch === "render:export" && a[1]?.from == null && r && !r.cancelled) ||
    (ch === "personal:render" && r && !r.cancelled && !r.error) ||
    (ch === "vertical:export" && fullVertical(a) && r && !r.cancelled && !r.error)
  )
    countExport();
}
export function testSetPlan(p, used) {
  setPlan(p);
  if (used != null)
    q.run("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", monthKey(), String(used));
  const w = getWin();
  if (w && !w.isDestroyed()) w.webContents.send("plan:changed", planInfo());
  return planInfo();
}
