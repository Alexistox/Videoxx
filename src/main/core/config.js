import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

const DEFAULTS = () => ({
  workspace: process.env.CZ_WORKSPACE || path.join(app.getPath("documents"), "Videoxx"),
  claude: {
    executable: null,
    model: null,
    permissions: "auto",
    autoVerify: true,
    userMcp: false,
    maxTurns: 60,
    effort: "medium",
    workflowModel: "claude-opus-5-5",
  },
  video: { length: 120 },
  ui: { zoom: 1, brand: "faceless", channel: "all", listChannel: "all", listChannelPersonal: "all", previewQuality: "full" },
  updates: { beta: false },
  bridge: { enabled: true, port: 47913 },
  images: { provider: "auto" },
  voice: {
    provider: "auto",
    autoTime: true,
    gap: 0.5,
    elevenlabs: {
      voiceId: null,
      voiceName: null,
      modelId: "eleven_multilingual_v2",
      stability: 0.5,
      similarity: 0.75,
      style: 0,
      speed: 1,
      speakerBoost: true,
    },
    kokoro: { voice: "af_heart", speed: 1 },
    fish: { voiceId: null, voiceName: null, model: "s2.1-pro", speed: 1 },
  },
  sound: { music: true, sfx: true },
  language: { mode: "english", default: "en" },
  tools: { python: process.platform === "win32" ? "python" : "python3", ffmpeg: "ffmpeg", git: "git", parakeet: null },
  claudePlan: { kind: null, custom: null, detected: null },
  scriptSkill: { on: false, name: null, added: null },
  graphics: { mode: "auto" },
  lastProjectId: null,
  lastPersonalProjectId: null,
  window: { width: 1600, height: 1e3, maximized: false },
});
const file = () => path.join(app.getPath("userData"), "config.json");
let cache = null;
function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    const b = base[k],
      o = over[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && o && typeof o === "object" ? merge(b, o) : o;
  }
  return out;
}
export function getConfig() {
  if (cache) return cache;
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {}
  cache = merge(DEFAULTS(), saved);
  return cache;
}
export function setConfig(patch) {
  cache = merge(getConfig(), patch);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const text = JSON.stringify(cache, null, 2),
    tmp = file() + ".tmp";
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file());
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    fs.writeFileSync(file(), text);
  }
  return cache;
}
