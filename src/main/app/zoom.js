import { getConfig, setConfig } from "../core/config";

const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const TITLE_BAR = 34;
const MIN_CSS = { w: 1050, h: 640 };
const nearest = (z) => ZOOM_STEPS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
const fitMax = (win) => {
  const [w, h] = win.getContentSize();
  const m = Math.min(w / MIN_CSS.w, h / MIN_CSS.h);
  return [...ZOOM_STEPS].reverse().find((s) => s <= m + 1e-3) ?? ZOOM_STEPS[0];
};
export function applyZoom(win, z, announce = true) {
  z = nearest(z);
  const shown = Math.min(z, Math.max(1, fitMax(win)));
  if (Math.abs(win.webContents.getZoomFactor() - shown) > 1e-3) {
    win.webContents.setZoomFactor(shown);
    try {
      win.setTitleBarOverlay({ height: Math.round(TITLE_BAR * shown) });
    } catch {}
  }
  if (getConfig().ui.zoom !== z) setConfig({ ui: { zoom: z } });
  if (announce) win.webContents.send("ui:zoom", { zoom: shown, capped: shown < z });
  return shown;
}
function stepZoom(win, dir) {
  if (dir === 0) return applyZoom(win, 1);
  const cur = win.webContents.getZoomFactor();
  const i = ZOOM_STEPS.indexOf(nearest(cur));
  const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))];
  if (dir > 0 && next > Math.max(1, fitMax(win))) {
    win.webContents.send("ui:zoom", { zoom: cur, capped: true });
    return cur;
  }
  return applyZoom(win, next);
}
export function installZoom(win) {
  const wc = win.webContents;
  wc.on("did-finish-load", () => applyZoom(win, getConfig().ui.zoom, false));
  let t;
  win.on("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => applyZoom(win, getConfig().ui.zoom, false), 150);
  });
  wc.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
    const k = input.key,
      c = input.code;
    const dir =
      k === "=" || k === "+" || c === "NumpadAdd"
        ? 1
        : k === "-" || k === "_" || c === "NumpadSubtract"
          ? -1
          : k === "0" || c === "Numpad0"
            ? 0
            : null;
    if (dir === null) return;
    e.preventDefault();
    stepZoom(win, dir);
  });
  wc.on("zoom-changed", (_e, d) => stepZoom(win, d === "in" ? 1 : -1));
}
