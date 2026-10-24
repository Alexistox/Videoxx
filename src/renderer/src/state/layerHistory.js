import { api } from "../lib/api";
import { isMac } from "../help/keys";

export const REDO = isMac ? "⇧⌘Z" : "Ctrl+Shift+Z",
  UNDO = isMac ? "⌘Z" : "Ctrl+Z";
const hist = new Map();
export const LAYERS_EVENT = "cz-layers-changed";
const H = (id) => {
  let h = hist.get(id);
  if (!h) {
    h = { past: [], future: [] };
    hist.set(id, h);
  }
  return h;
};
export const announce = (projectId, view) => window.dispatchEvent(new CustomEvent(LAYERS_EVENT, { detail: { projectId, view } }));
export async function commitLayers(projectId, before, next) {
  const h = H(projectId);
  h.past.push(before);
  if (h.past.length > 60) h.past.shift();
  h.future = [];
  const r = await api.setLayers(projectId, next);
  announce(projectId, r);
  return r;
}
export async function stepLayers(projectId, cur, redo) {
  const h = H(projectId),
    from = redo ? h.future : h.past,
    to = redo ? h.past : h.future,
    prev = from.pop();
  if (!prev) return null;
  to.push(cur);
  const r = await api.setLayers(projectId, prev);
  announce(projectId, r);
  return r;
}
export const canStep = (projectId, redo) => (redo ? H(projectId).future : H(projectId).past).length > 0;
export const clone = (L) => JSON.parse(JSON.stringify(L));
const KIND_COL = { music: "#b496db", effects: "#d7b461", ambience: "#84a9d8", free: "#89bea4" };
export const laneColor = (kind) => KIND_COL[kind] ?? "#969696";
export const dB = (v) => `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10} dB`;
