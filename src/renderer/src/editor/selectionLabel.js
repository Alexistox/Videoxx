import { fmtTime } from "../lib/format";

export const STYLES_MOVED = "Making whole styles moved to the Style Kit (Styles > Get the Style Kit).";
export const selLabel = (s) => {
  const el = s.element || {};
  if (s.kind === "object") return `${el.name || el.key || el.kind || "object"}${s.shot ? ` · shot ${s.shot.index + 1}` : ""}`;
  if (s.kind === "hud") return el.text ? `"${String(el.text).slice(0, 28)}"` : el.type === "card" ? `card ${el.key ?? ""}` : "HUD box";
  if (s.kind === "shot") return `Shot ${(s.shot?.index ?? 0) + 1}: ${(s.shot?.name ?? "").replace(/^\d+[a-z]?:\s*/i, "").slice(0, 30)}`;
  if (s.kind === "phrase") return `"${String(el.text ?? "").slice(0, 30)}"`;
  if (s.kind === "cue") return `cue "${String(el.word ?? "").slice(0, 24)}" @ ${fmtTime(el.t ?? 0)}`;
  if (s.kind === "range") return `${fmtTime(s.range[0])}–${fmtTime(s.range[1])}`;
  return "selection";
};
