import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { compactGraphics, validateGraphics } from "./graphicsControls";
import { quietWrite } from "../projects/watcher";

const file = () => path.join(app.getPath("userData"), "graphics-presets.json");
const checked = (values) => {
  const raw = Object.fromEntries(Object.entries(values || {}).filter(([, v]) => v !== null && v !== void 0));
  const err = validateGraphics(raw);
  if (err) throw new Error(err);
  return compactGraphics(raw);
};
export function saveProjectGraphics(projectDir, values) {
  const g = checked(values);
  const f = path.join(projectDir, "project.json"),
    pj = JSON.parse(fs.readFileSync(f, "utf8"));
  pj.settings = pj.settings && typeof pj.settings === "object" ? pj.settings : {};
  if (JSON.stringify(pj.settings.graphics || {}) === JSON.stringify(g)) return g;
  if (Object.keys(g).length) pj.settings.graphics = g;
  else delete pj.settings.graphics;
  quietWrite("project.json");
  fs.writeFileSync(f, JSON.stringify(pj, null, 1));
  return g;
}
export function listGfxPresets() {
  try {
    const l = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Array.isArray(l) ? l.filter((p) => p && typeof p.name === "string" && !validateGraphics(p.values)) : [];
  } catch {
    return [];
  }
}
const write = (l) => {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(l, null, 1));
  return l;
};
export function saveGfxPreset(name, values) {
  const n = String(name || "")
    .trim()
    .slice(0, 40);
  if (!n) throw new Error("Give the preset a name.");
  const g = checked(values);
  const l = listGfxPresets().filter((p) => p.name.toLowerCase() !== n.toLowerCase());
  if (l.length >= 50) throw new Error("You have 50 graphics presets: delete one first.");
  return write([...l, { name: n, values: g, at: Date.now() }].sort((a, b) => a.name.localeCompare(b.name)));
}
export function deleteGfxPreset(name) {
  return write(listGfxPresets().filter((p) => p.name !== name));
}
