"use strict";
// Videoxx: a library of named connections for pictures and voice. Part of the original code.
//
// The original app has ONE active slot per kind:
//   - built-in services keep their key in userData/secrets.json (names in BUILTIN below)
//   - the Custom API slot is userData/custom-api/<kind>/adapter.mjs (+ setup.json) with its key
//     in secrets.json as "custom-<kind>-key"
// Using a connection here fills that slot; the renderer then points the app's provider setting
// at it (config images.provider / voice.provider).
const electron = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const KINDS = ["image", "voice"];
const BUILTIN = {
  elevenlabs: { kind: "voice", secret: "elevenlabs", provider: "elevenlabs", label: "ElevenLabs" },
  fish: { kind: "voice", secret: "fishaudio", provider: "fish", label: "Fish Audio" },
  higgsfield: { kind: "image", secret: "higgsfield", provider: "higgsfield", label: "Higgsfield (API key)" },
  fal: { kind: "image", secret: "fal", provider: "fal", label: "Fal.ai" },
};
const TEMPLATES = {
  "higgsfield-cli-image": { kind: "image", file: "higgsfield-cli-image.mjs", label: "Higgsfield CLI: pictures", notes: "Higgsfield CLI signed in on this computer; no API key" },
  "higgsfield-cli-voice": { kind: "voice", file: "higgsfield-cli-voice.mjs", label: "Higgsfield CLI: voice", notes: "Higgsfield CLI signed in on this computer (Text to Speech V2); no API key" },
};
const AUTHS = ["apikey", "local", "cli"];

const userData = () => electron.app.getPath("userData");
const root = () => path.join(userData(), "videoxx-connectors");
const indexFile = () => path.join(root(), "index.json");
const appSecrets = () => path.join(userData(), "secrets.json");
const appSlot = (kind) => path.join(process.env.CZ_CUSTOM_API_DIR || path.join(userData(), "custom-api"), kind);
const templatesDir = () => path.join(__dirname, "connector-templates");

function readJson(f, fallback) {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return fallback;
  }
}
function writeJson(f, o) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(o, null, 1));
}

const seal = (v) => {
  if (!electron.safeStorage.isEncryptionAvailable()) throw new Error("This computer has no secure key storage, so the key cannot be saved.");
  return electron.safeStorage.encryptString(v).toString("base64");
};
const open = (s) => {
  if (!s) return null;
  try {
    return electron.safeStorage.decryptString(Buffer.from(s, "base64"));
  } catch {
    return null;
  }
};

// The app's own secrets file (same format and encryption as the app writes).
function appSecret(name, value) {
  const o = readJson(appSecrets(), {});
  if (value === undefined) return open(o[name]);
  if (value) o[name] = seal(value);
  else delete o[name];
  writeJson(appSecrets(), o);
  return value;
}

const db = () => {
  const d = readJson(indexFile(), null) || {};
  return { connectors: Array.isArray(d.connectors) ? d.connectors : [], active: d.active || {}, drafts: d.drafts || {} };
};
const save = (d) => writeJson(indexFile(), d);
const newId = () => crypto.randomBytes(5).toString("hex");
const dirOf = (id) => path.join(root(), id);
const cleanName = (s, fallback) => String(s || "").replace(/[\r\n]+/g, " ").trim().slice(0, 60) || fallback;

function publicView(c, d) {
  const key = open(c.key);
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    via: c.via,
    provider: c.provider || null,
    template: c.template || null,
    auth: c.auth || null,
    url: c.url || null,
    cliPath: c.cliPath || null,
    settings: c.settings || {},
    keyHint: key ? `…${key.slice(-4)}` : null,
    active: d.active[c.kind] === c.id,
    createdAt: c.createdAt,
  };
}

function list() {
  const d = db();
  return {
    connectors: d.connectors.map((c) => publicView(c, d)),
    active: d.active,
    builtin: Object.entries(BUILTIN).map(([id, b]) => ({ id, kind: b.kind, label: b.label })),
    templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, kind: t.kind, label: t.label })),
    higgsfieldCli: higgsfieldCli(),
  };
}

function find(d, id) {
  const c = d.connectors.find((x) => x.id === id);
  if (!c) throw new Error("That connection no longer exists.");
  return c;
}

function higgsfieldCli() {
  const tries = [
    process.env.VX_HIGGSFIELD_CLI,
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@higgsfield", "cli", "vendor", "hf.exe"),
  ].filter(Boolean);
  return tries.find((p) => fs.existsSync(p)) || null;
}

// A built-in service with its own key (several keys per service are fine: pick one at a time).
function addBuiltin(input) {
  const b = BUILTIN[input?.provider];
  if (!b) throw new Error("Unknown service.");
  const key = String(input.key || "").trim();
  if (key.length < 8) throw new Error(`Paste the ${b.label} API key.`);
  const d = db();
  const c = { id: newId(), name: cleanName(input.name, b.label), kind: b.kind, via: "builtin", provider: input.provider, key: seal(key), createdAt: new Date().toISOString() };
  d.connectors.push(c);
  save(d);
  return publicView(c, d);
}

// A ready-made connector shipped with Videoxx (Higgsfield CLI).
function addTemplate(input) {
  const t = TEMPLATES[input?.template];
  if (!t) throw new Error("Unknown connector template.");
  const d = db();
  const c = { id: newId(), name: cleanName(input.name, t.label), kind: t.kind, via: "adapter", template: input.template, auth: "cli", settings: sanitizeSettings(input.template, input.settings), createdAt: new Date().toISOString() };
  writeAdapter(c, fs.readFileSync(path.join(templatesDir(), t.file), "utf8"), { name: c.name, notes: t.notes });
  d.connectors.push(c);
  save(d);
  return publicView(c, d);
}

function sanitizeSettings(template, s) {
  const o = s && typeof s === "object" ? s : {};
  if (template === "higgsfield-cli-image") return { model: /^[a-z0-9_]{2,60}$/.test(o.model || "") ? o.model : "nano_banana_flash" };
  if (template === "higgsfield-cli-voice") return { variant: ["elevenlabs", "minimax", "seed_speech", "vibe_voice", "cozy_voice"].includes(o.variant) ? o.variant : "elevenlabs" };
  return {};
}

function writeAdapter(c, source, setup) {
  const dir = dirOf(c.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "adapter.mjs"), source);
  writeJson(path.join(dir, "setup.json"), { name: setup.name, notes: setup.notes || "", brief: setup.brief || "", verifiedAt: new Date().toISOString() });
  writeJson(path.join(dir, "connector.json"), { ...(c.settings || {}), ...(c.cliPath ? { cliPath: c.cliPath } : {}), ...(c.url ? { url: c.url } : {}) });
}

function updateSettings(input) {
  const d = db();
  const c = find(d, input?.id);
  if (input.name !== undefined) c.name = cleanName(input.name, c.name);
  if (c.template && input.settings) c.settings = sanitizeSettings(c.template, input.settings);
  if (c.via === "builtin" && typeof input.key === "string" && input.key.trim()) c.key = seal(input.key.trim());
  if (c.via === "adapter" && fs.existsSync(path.join(dirOf(c.id), "adapter.mjs"))) {
    writeJson(path.join(dirOf(c.id), "connector.json"), { ...(c.settings || {}), ...(c.cliPath ? { cliPath: c.cliPath } : {}), ...(c.url ? { url: c.url } : {}) });
    const setup = readJson(path.join(dirOf(c.id), "setup.json"), {});
    writeJson(path.join(dirOf(c.id), "setup.json"), { ...setup, name: c.name });
  }
  save(d);
  if (d.active[c.kind] === c.id) activate({ id: c.id });
  return publicView(c, db());
}

// The brief the app's own "Claude writes the connector" job gets for a new connection.
function beginCustom(input) {
  const kind = KINDS.includes(input?.kind) ? input.kind : null;
  if (!kind) throw new Error("Pick pictures or voice.");
  const auth = AUTHS.includes(input.auth) ? input.auth : "apikey";
  const what = String(input.description || "").trim();
  if (what.length < 10) throw new Error("Describe the service or tool: its name, the model, and a link to its docs if you have one.");
  const id = newId();
  const lines = [what];
  if (auth === "local") {
    const url = String(input.url || "").trim();
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|[\w.-]+\.local)(:\d+)?(\/|$)/i.test(url)) throw new Error("A local tool's address looks like http://127.0.0.1:8188 (it must run on this computer or your local network).");
    lines.push(`It is a tool running locally at ${url}: call it there over HTTP. It needs no API key (CUSTOM_API_KEY is empty).`);
  } else if (auth === "cli") {
    const cli = String(input.cliPath || "").trim();
    if (!cli || !fs.existsSync(cli)) throw new Error("Pick the command-line tool's program file (an .exe, or the .cmd/.ps1 that starts it).");
    process.env[`VX_CLI_${id.toUpperCase()}`] = cli;
    lines.push(`It is a command-line tool that is already installed and signed in on this computer. Its program path is in the environment variable VX_CLI_${id.toUpperCase()} (read process.env.VX_CLI_${id.toUpperCase()}; never hard-code the path). Run it with child_process (execFile for an .exe; for a .cmd/.ps1 use shell: true and quote the path). It needs no API key (CUSTOM_API_KEY is empty). Use its --help to learn the commands.`);
  } else {
    lines.push("It uses an API key, given to the adapter in process.env.CUSTOM_API_KEY.");
  }
  const d = db();
  adoptCurrent(d, { via: "adapter", kind }); // the app's setup job replaces whatever is in its slot now
  d.drafts[kind] = { id, kind, name: cleanName(input.name, "Custom connection"), auth, url: auth === "local" ? String(input.url).trim() : null, cliPath: auth === "cli" ? String(input.cliPath).trim() : null, startedAt: new Date().toISOString() };
  save(d);
  return { draftId: id, brief: lines.join("\n\n"), key: auth === "apikey" ? String(input.key || "").trim() || null : "" };
}

// After the app's setup job wrote and verified the adapter into its slot: keep it as a connection.
function capture(input) {
  const kind = KINDS.includes(input?.kind) ? input.kind : null;
  const d = db();
  const draft = kind && d.drafts[kind];
  if (!draft) throw new Error("There is no new connection waiting to be saved.");
  const slot = appSlot(kind);
  if (!fs.existsSync(path.join(slot, "adapter.mjs"))) throw new Error("The app has no finished connector to save yet.");
  const c = { id: draft.id, name: draft.name, kind, via: "adapter", auth: draft.auth, url: draft.url, cliPath: draft.cliPath, createdAt: new Date().toISOString() };
  const key = appSecret(`custom-${kind}-key`);
  if (draft.auth === "apikey" && key) c.key = seal(key);
  const setup = readJson(path.join(slot, "setup.json"), {});
  writeAdapter(c, fs.readFileSync(path.join(slot, "adapter.mjs"), "utf8"), { name: c.name, notes: setup.notes, brief: setup.brief });
  d.connectors.push(c);
  delete d.drafts[kind];
  d.active[kind] = c.id;
  save(d);
  return publicView(c, d);
}

// Before a slot is overwritten: whatever the user set up in the app's own Settings and is not in
// the library yet is kept as a connection "(from Settings)", so switching never loses it.
function adoptCurrent(d, c) {
  if (c.via === "builtin") {
    const current = appSecret(BUILTIN[c.provider].secret);
    if (!current || d.connectors.some((x) => x.via === "builtin" && x.provider === c.provider && open(x.key) === current)) return;
    d.connectors.push({ id: newId(), name: `${BUILTIN[c.provider].label} (from Settings)`, kind: c.kind, via: "builtin", provider: c.provider, key: seal(current), createdAt: new Date().toISOString() });
    return;
  }
  const slot = appSlot(c.kind);
  const adapter = path.join(slot, "adapter.mjs");
  if (!fs.existsSync(adapter)) return;
  const source = fs.readFileSync(adapter, "utf8");
  const known = d.connectors.some((x) => x.via === "adapter" && x.kind === c.kind && fs.existsSync(path.join(dirOf(x.id), "adapter.mjs")) && fs.readFileSync(path.join(dirOf(x.id), "adapter.mjs"), "utf8") === source);
  if (known) return;
  const setup = readJson(path.join(slot, "setup.json"), {});
  const kept = { id: newId(), name: `${cleanName(setup.name, "Custom API")} (from Settings)`, kind: c.kind, via: "adapter", auth: "apikey", createdAt: new Date().toISOString() };
  const key = appSecret(`custom-${c.kind}-key`);
  if (key) kept.key = seal(key);
  writeAdapter(kept, source, { name: kept.name, notes: setup.notes, brief: setup.brief });
  d.connectors.push(kept);
}

// Puts a connection into the app's active slot; returns what the renderer must set in the config.
function activate(input) {
  const d = db();
  const c = find(d, input?.id);
  adoptCurrent(d, c);
  if (c.via === "builtin") {
    const key = open(c.key);
    if (!key) throw new Error("This connection's key can no longer be read on this computer: paste it again.");
    appSecret(BUILTIN[c.provider].secret, key);
    d.active[c.kind] = c.id;
    save(d);
    return { kind: c.kind, provider: BUILTIN[c.provider].provider, connection: publicView(c, d) };
  }
  const src = dirOf(c.id), slot = appSlot(c.kind);
  if (!fs.existsSync(path.join(src, "adapter.mjs"))) throw new Error("This connection's files are missing: remove it and add it again.");
  if (c.cliPath) process.env[`VX_CLI_${c.id.toUpperCase()}`] = c.cliPath;
  fs.rmSync(slot, { recursive: true, force: true });
  fs.mkdirSync(slot, { recursive: true });
  for (const f of ["adapter.mjs", "setup.json", "connector.json"]) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(slot, f));
  appSecret(`custom-${c.kind}-key`, open(c.key) || null);
  d.active[c.kind] = c.id;
  save(d);
  logLine(`videoxx-connectors: ${c.kind} now uses "${c.name}"`);
  return { kind: c.kind, provider: "custom", connection: publicView(c, d) };
}

function remove(input) {
  const d = db();
  const c = find(d, input?.id);
  d.connectors = d.connectors.filter((x) => x.id !== c.id);
  const wasActive = d.active[c.kind] === c.id;
  if (wasActive) delete d.active[c.kind];
  save(d);
  fs.rmSync(dirOf(c.id), { recursive: true, force: true });
  return { removed: c.id, wasActive, kind: c.kind, via: c.via };
}

// Runs a connection's adapter on a small sample, the way the app runs it (spends a little credit).
function test(input) {
  const d = db();
  const c = find(d, input?.id);
  if (c.via !== "adapter") return Promise.resolve({ ok: true, message: "Built-in services are checked by the app when you use them." });
  const dir = dirOf(c.id);
  const work = fs.mkdtempSync(path.join(require("os").tmpdir(), "vx-conn-"));
  const out = path.join(work, c.kind === "image" ? "out.png" : "voices.json");
  const req = c.kind === "image" ? { kind: "image", prompt: "A red apple on a white table, studio light", aspect: "1:1", refs: [], out } : { kind: "voices", out };
  fs.writeFileSync(path.join(work, "request.json"), JSON.stringify(req));
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", CUSTOM_API_KEY: open(c.key) || "" };
  if (c.cliPath) env[`VX_CLI_${c.id.toUpperCase()}`] = c.cliPath;
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(dir, "adapter.mjs"), path.join(work, "request.json")], { cwd: dir, env, windowsHide: true, timeout: 12 * 60 * 1000 }, (err, stdout) => {
      const ok = !err && fs.existsSync(out) && fs.statSync(out).size > 0;
      let message;
      if (!ok) message = String(stdout || err?.message || "no output").trim().split(/\r?\n/).filter((l) => !l.startsWith("RESULT ")).pop() || "failed";
      else if (c.kind === "image") message = `It made a ${Math.round(fs.statSync(out).size / 1024)} KB picture.`;
      else message = `It lists ${readJson(out, []).length} voices.`;
      fs.rmSync(work, { recursive: true, force: true });
      resolve({ ok, message: String(message).slice(0, 300) });
    });
  });
}

// Higgsfield models for the pickers (cached for the session).
let hfModels = null;
function higgsfieldModels() {
  if (hfModels) return Promise.resolve(hfModels);
  const cli = higgsfieldCli();
  if (!cli) return Promise.resolve({ image: [], audio: [], error: "Higgsfield CLI not found." });
  return new Promise((resolve) => {
    execFile(cli, ["model", "list", "--json"], { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ image: [], audio: [], error: String(err.message).slice(0, 200) });
      try {
        const j = JSON.parse(String(stdout).replace(/^﻿/, ""));
        const all = (Array.isArray(j) ? j : j.models || j.data || []).map((m) => ({ id: m.job_type, name: m.display_name || m.job_type, type: m.type }));
        // pictures from a prompt only: no upscalers, background removers, outpaint or retouch tools
        const tool = /upscale|remover|outpaint|topaz|autosprite|jutsu|relight|skin|stylist|shots|soul_cast|soul_location/i;
        const images = all.filter((m) => m.type === "image" && !tool.test(m.id));
        const dup = (m) => images.filter((x) => x.name === m.name).length > 1;
        hfModels = { image: images.map((m) => (dup(m) ? { ...m, name: `${m.name} (${m.id})` } : m)), audio: all.filter((m) => m.type === "audio") };
        resolve(hfModels);
      } catch (e) {
        resolve({ image: [], audio: [], error: e.message });
      }
    });
  });
}

function logLine(text) {
  try {
    const dir = path.join(userData(), "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "main.log"), `${new Date().toISOString()} ${text}\n`);
  } catch {
    // logging must never break the app
  }
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  const h = (ch, fn) => electron.ipcMain.handle(ch, (_e, input) => fn(input));
  h("customapi:vxList", () => list());
  h("customapi:vxAddBuiltin", addBuiltin);
  h("customapi:vxAddTemplate", addTemplate);
  h("customapi:vxUpdate", updateSettings);
  h("customapi:vxBegin", beginCustom);
  h("customapi:vxCapture", capture);
  h("customapi:vxActivate", activate);
  h("customapi:vxRemove", remove);
  h("customapi:vxTest", test);
  h("customapi:vxHfModels", () => higgsfieldModels());
  electron.app.whenReady().then(() => {
    // CLI connections created by Claude read their program path from VX_CLI_<id>
    for (const c of db().connectors) if (c.cliPath) process.env[`VX_CLI_${c.id.toUpperCase()}`] = c.cliPath;
    const cli = higgsfieldCli();
    if (cli && !process.env.VX_HIGGSFIELD_CLI) process.env.VX_HIGGSFIELD_CLI = cli;
    logLine(`videoxx-connectors: ready (${db().connectors.length} connections)`);
  });
}

module.exports = { register, _test: { list, addBuiltin, addTemplate, updateSettings, beginCustom, capture, activate, remove, test } };
