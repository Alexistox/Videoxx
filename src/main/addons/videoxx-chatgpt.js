"use strict";
// Videoxx add-on: side features on ChatGPT. The original app sends a few one-shot text jobs straight to Claude (the
// help assistant and its bug report draft, "describe a toon character", "learn rules from my edits", channel
// insights) and forces web research of routines onto Claude. With the switch on (Settings > AI engines), side() runs
// them on the chosen ChatGPT model through the app's own codexText() (read-only, empty folder, no tools), and
// webOnChatGPT() lets a routine that already uses a ChatGPT model keep it for web research (Codex's web search).
// side() answers null whenever ChatGPT is off, not ready or fails, so the caller goes on with Claude as before.
const electron = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

const FEATURES = {
  help: "Help assistant and bug report draft",
  toon: "Describe a toon character in words",
  learn: "Learn rules from my edits",
  insights: "Channel insights (YouTube)",
  web: "Web research in routines that use a ChatGPT model",
};
const TIMEOUT_MS = 5 * 60 * 1000;

let deps = null; // { codexText, resolveEngine, models } handed over by the patch in the main code
function init(d) {
  deps = d;
}

const settingsFile = () => path.join(electron.app.getPath("userData"), "videoxx-chatgpt.json");
function readSettings() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) || {};
  } catch {}
  const features = {};
  for (const k of Object.keys(FEATURES)) features[k] = s.features?.[k] !== false;
  return { enabled: s.enabled === true, model: typeof s.model === "string" ? s.model : null, features };
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 1));
}

const models = () => (deps?.models ?? []).map((m) => ({ id: m.id, name: m.name }));
function modelOf(s) {
  const list = models();
  return list.some((m) => m.id === s.model) ? s.model : list[0]?.id ?? null;
}

function logLine(text) {
  try {
    const dir = path.join(electron.app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "main.log"), `${new Date().toISOString()} ${text}\n`);
  } catch {
    // logging must never break the app
  }
}

// data:image/... URLs (help screenshots) become files, since Codex takes pictures as local files
function imageFiles(images) {
  const urls = (images ?? []).filter((u) => typeof u === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(u)).slice(0, 4);
  if (!urls.length) return { dir: null, files: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vx-chatgpt-img-"));
  const files = urls.map((u, i) => {
    const ext = /^data:image\/(\w+)/.exec(u)[1].replace("jpeg", "jpg");
    const f = path.join(dir, `image-${i + 1}.${ext}`);
    fs.writeFileSync(f, Buffer.from(u.slice(u.indexOf(",") + 1), "base64"));
    return f;
  });
  return { dir, files };
}

// o: { system, prompt, images?: data URLs, look?: picture files, signal? }. Resolves to the answer text, or null =
// "use Claude". Throws only when the caller's own signal was aborted.
async function side(feature, o) {
  const s = readSettings();
  if (!s.enabled || !s.features[feature] || !deps) return null;
  const model = modelOf(s);
  if (!model) return null;
  const own = new AbortController();
  const timer = setTimeout(() => own.abort(), TIMEOUT_MS);
  const onAbort = () => own.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  let pics = { dir: null, files: [] };
  try {
    const route = await deps.resolveEngine("routine", `codex:${model}`, { signal: own.signal });
    if (route.engine !== "codex") {
      logLine(`videoxx-chatgpt: ${feature} stays on Claude: ${route.note || "ChatGPT is not ready"}`);
      return null;
    }
    pics = imageFiles(o.images);
    const text = await deps.codexText({ system: o.system, prompt: o.prompt, model: route.model, effort: null, look: [...(o.look ?? []), ...pics.files], signal: own.signal });
    if (!String(text ?? "").trim()) throw new Error("empty answer");
    logLine(`videoxx-chatgpt: ${feature} answered by ChatGPT (${model})`);
    return String(text);
  } catch (e) {
    if (o.signal?.aborted) throw e;
    logLine(`videoxx-chatgpt: ${feature} on ChatGPT failed, using Claude: ${String(e?.message ?? e).slice(0, 200)}`);
    return null;
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
    if (pics.dir) try {
      fs.rmSync(pics.dir, { recursive: true, force: true });
    } catch {}
  }
}

const webOnChatGPT = () => {
  const s = readSettings();
  return s.enabled && s.features.web;
};

function state() {
  const s = readSettings();
  return { enabled: s.enabled, model: modelOf(s), features: s.features, names: FEATURES, models: models() };
}
function save(input) {
  const s = readSettings();
  if (typeof input?.enabled === "boolean") s.enabled = input.enabled;
  if (typeof input?.model === "string") {
    if (!models().some((m) => m.id === input.model)) throw new Error("Unknown ChatGPT model.");
    s.model = input.model;
  }
  if (input?.features && typeof input.features === "object") {
    for (const [k, v] of Object.entries(input.features)) if (k in FEATURES && typeof v === "boolean") s.features[k] = v;
  }
  writeSettings(s);
  return state();
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  electron.ipcMain.handle("claude:vxChatgptGet", () => state());
  electron.ipcMain.handle("claude:vxChatgptSet", (_e, input) => save(input));
}

module.exports = { init, register, side, webOnChatGPT, FEATURES, _test: { readSettings, save, state } };
