"use strict";
// Videoxx add-on: the 3D asset library for every 3D style, with a per-style switch to keep a style off it.
// The original app lets only the Low poly style search and add library models (the lowpoly_asset tool); the library
// itself (templates/lowpoly/library + <workspace>/assets/lowpoly) is already served to every project at __lib/.
// patches.js routes the tool's style check and its search answer through gate() and searchText() here.
const electron = require("electron");
const fs = require("fs");
const path = require("path");

// engines that can load library models: the three that ship a GLTFLoader, plus any style that carries the Videoxx
// asset loader (lib/vx-assets.js, e.g. Surreal Broll)
const LOADER_BASES = new Set(["lowpoly", "recon", "toon"]);
const STYLE_NAMES = { lowpoly: "Low poly shorts", recon: "3D reconstruction", toon: "3D cartoon shorts" };

const settingsFile = () => path.join(electron.app.getPath("userData"), "videoxx-assets.json");
function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    return { disabled: s && typeof s.disabled === "object" && s.disabled ? s.disabled : {} };
  } catch {
    return { disabled: {} };
  }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 1));
}

const hasLoader = (projectDir) => {
  try {
    return fs.existsSync(path.join(projectDir, "lib", "vx-assets.js"));
  } catch {
    return false;
  }
};
const usesLibrary = (styleId) => !readSettings().disabled[styleId];

// null = the tool may run; else the message Claude gets.
function gate(project, base) {
  const id = String(project?.style_id ?? "");
  if (!usesLibrary(id)) {
    return "The user switched library assets OFF for this style (Settings > Media > Asset library). Do not search, add or load library models in this project: build everything from the style's own elements and code.";
  }
  if (LOADER_BASES.has(base) || hasLoader(project?.path ?? "")) return null;
  return "This style cannot place library models (its engine has no model loader). Build it from the style's own elements.";
}

// The search answer for styles other than Low poly: where each file is served and how this engine loads it.
function searchText(rows, index, base, projectDir) {
  const byId = new Map((index?.entries ?? []).map((e) => [e.id, e]));
  const lines = rows.map((r) => {
    const e = byId.get(r.id) ?? {};
    const size = r.size_m ? `  ${r.size_m.map((v) => +(+v).toFixed(2)).join(" x ")} m` : "";
    return `${r.id}  [${r.kind}] ${r.name}${size}${r.clips ? `  ${r.clips} clips` : ""}  ${r.licence}${r.user ? "  (saved find)" : ""}${e.file ? `  file: __lib/${e.file}` : ""}`;
  });
  const how = hasLoader(projectDir)
    ? "Use it with the style's asset() element from models.js: asset(null, '<id>', { at: [x, z], height: <real height in m>, ry }). Write the id as a plain string in the scene file: the style preloads every id it finds there."
    : "Load it at the top of the scene file: import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js'; const g = await new GLTFLoader().loadAsync('../__lib/<file>'); then clone g.scene inside build (SkeletonUtils.clone for rigged models). Library conventions: metres, Y up, origin at the bottom centre, front +Z; size_m is its real size.";
  return `${lines.join("\n")}\n\n${how}\nCredits: action "credits" lists the description lines for every library asset the scenes use.`;
}

function state() {
  const s = readSettings();
  return { disabled: s.disabled, loaderBases: [...LOADER_BASES], names: STYLE_NAMES };
}
function setStyle(input) {
  const id = String(input?.styleId ?? "");
  if (!/^[a-z0-9-]{2,60}$/.test(id)) throw new Error("Unknown style.");
  const s = readSettings();
  if (input.use === false) s.disabled[id] = true;
  else delete s.disabled[id];
  writeSettings(s);
  return state();
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  electron.ipcMain.handle("styles:vxAssetsGet", () => state());
  electron.ipcMain.handle("styles:vxAssetsSet", (_e, input) => setStyle(input));
}

module.exports = { register, gate, searchText, usesLibrary, _test: { readSettings, setStyle, state } };
