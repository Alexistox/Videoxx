export const isMac = (window.suite?.platform ?? navigator.platform) === "darwin" || /Mac/i.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";
export const ALT = isMac ? "⌥" : "Alt";
export const keys = (k) => (isMac ? `${MOD}${k}` : `${MOD} ${k}`);
