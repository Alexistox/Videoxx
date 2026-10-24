import { api } from "../lib/api";

export const SCALE = { full: 1, half: 0.5, quarter: 0.25, auto: 1 };
export const PQ_OPTIONS = [
  { value: "full", label: "Full", hint: "Every pixel of the video (default)" },
  { value: "half", label: "Half", hint: "Half the width and height: plays smoothly on most computers" },
  { value: "quarter", label: "Quarter", hint: "For slow computers: a rough picture that keeps up" },
  { value: "auto", label: "Auto", hint: "Full, and smaller while playing when frames come too slowly" },
];
const PQ_KEY = "cz-preview-quality";
export function getPreviewQuality() {
  try {
    const v = localStorage.getItem(PQ_KEY);
    if (v && v in SCALE) return v;
  } catch {}
  return "full";
}
export function setPreviewQuality(q, save = true) {
  try {
    localStorage.setItem(PQ_KEY, q);
  } catch {}
  if (save) return api.setConfig({ ui: { previewQuality: q } });
}
