import { getConfig } from "../core/config";
import { q } from "../db/db";
import { isEffort, isModelId } from "../engines/models";
import { MODELS } from "./higgsfield";

const IMAGE_MODEL_SERVICES = ["higgsfield", "custom"];
export function cleanImageModels(v) {
  const o = v && typeof v === "object" ? v : {},
    out = {};
  for (const k of IMAGE_MODEL_SERVICES) {
    const m = typeof o[k] === "string" ? o[k].replace(/\s+/g, " ").trim().slice(0, 100) : "";
    if (m) out[k] = m;
  }
  return out;
}
const IMAGE_CHOICES = ["auto", "higgsfield", "fal", "custom", "flow"];
const VOICE_CHOICES = ["auto", "file", "elevenlabs", "fish", "kokoro", "custom"];
function cleanOverrides(v) {
  const o = v && typeof v === "object" ? v : {},
    out = {};
  if (IMAGE_CHOICES.includes(o.image)) out.image = o.image;
  if (VOICE_CHOICES.includes(o.voice)) out.voice = o.voice;
  if (typeof o.music === "boolean") out.music = o.music;
  if (typeof o.sfx === "boolean") out.sfx = o.sfx;
  const im = cleanImageModels(o.imageModel);
  if (Object.keys(im).length) out.imageModel = im;
  return out;
}
export function overridesOf(project) {
  if (!project) return {};
  try {
    const r = q.get("SELECT overrides FROM projects WHERE id=? OR path=?", project, project);
    return r?.overrides ? cleanOverrides(JSON.parse(r.overrides)) : {};
  } catch {
    return {};
  }
}
export function setOverrides(projectId, patch) {
  if (!q.get("SELECT id FROM projects WHERE id=?", projectId)) throw new Error("Project not found.");
  const clean = patchOverrides(overridesOf(projectId), patch);
  q.run("UPDATE projects SET overrides=? WHERE id=?", Object.keys(clean).length ? JSON.stringify(clean) : null, projectId);
  return clean;
}
function patchOverrides(cur, patch) {
  const cur2 = { ...cur };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null || v === void 0 || v === "") {
      delete cur2[k];
      continue;
    }
    if (k === "imageModel") {
      const m = mergeModels(cur2.imageModel, v);
      if (Object.keys(m).length) cur2.imageModel = m;
      else delete cur2.imageModel;
      continue;
    }
    const ok =
      k === "image"
        ? IMAGE_CHOICES.includes(v)
        : k === "voice"
          ? VOICE_CHOICES.includes(v)
          : k === "music" || k === "sfx"
            ? typeof v === "boolean"
            : false;
    if (!ok) throw new Error("That choice is not one the app offers.");
    cur2[k] = v;
  }
  return cleanOverrides(cur2);
}
export function checkChoices(v) {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("That choice is not one the app offers.");
  const { model, effort, ...rest } = v;
  if (model && !isModelId(model)) throw new Error("That model is not one the app offers.");
  if (effort && !isEffort(effort)) throw new Error("That effort level is not one the app offers.");
  const known = Object.fromEntries(Object.entries(rest).filter(([k]) => ["image", "voice", "music", "sfx", "imageModel"].includes(k)));
  return { overrides: patchOverrides({}, known), model: model || null, effort: effort || null };
}
export function applyChoices(projectId, c) {
  if (!c) return false;
  if (Object.keys(c.overrides).length) q.run("UPDATE projects SET overrides=? WHERE id=?", JSON.stringify(c.overrides), projectId);
  if (c.model || c.effort) q.run("UPDATE projects SET claude_model=?, claude_effort=? WHERE id=?", c.model, c.effort, projectId);
  return !!(c.overrides.image || c.overrides.imageModel);
}
export function mergeModels(cur, patch) {
  if (!patch || typeof patch !== "object") throw new Error("That choice is not one the app offers.");
  const next = { ...(cur ?? {}) };
  for (const [s, m] of Object.entries(patch)) {
    if (!IMAGE_MODEL_SERVICES.includes(s)) throw new Error("That choice is not one the app offers.");
    if (m === null || m === void 0 || m === "") {
      delete next[s];
      continue;
    }
    if (typeof m !== "string" || (s === "higgsfield" && !MODELS.some((x) => x.id === m)))
      throw new Error("That choice is not one the app offers.");
    next[s] = m;
  }
  return cleanImageModels(next);
}
export function soundOf(project) {
  const o = overridesOf(project),
    g = getConfig().sound ?? {};
  return { music: o.music ?? g.music !== false, sfx: o.sfx ?? g.sfx !== false };
}
