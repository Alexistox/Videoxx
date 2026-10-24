"use strict";
// Videoxx: lets Claude run on an Anthropic API key or a Claude Code OAuth token
// (`claude setup-token`) instead of the Claude account login. Part of the original code.
const electron = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

const MODES = ["account", "apikey", "token"];
const file = () => path.join(electron.app.getPath("userData"), "videoxx-auth.json");

function read() {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    return { mode: "account" };
  }
}

function write(o) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(o, null, 1));
}

function open(sealed) {
  if (!sealed) return null;
  try {
    return electron.safeStorage.decryptString(Buffer.from(sealed, "base64"));
  } catch {
    return null;
  }
}

function seal(value) {
  if (!electron.safeStorage.isEncryptionAvailable()) throw new Error("This computer has no secure key storage, so the key cannot be saved.");
  return electron.safeStorage.encryptString(value).toString("base64");
}

// The chosen credential ("account" when the chosen key or token is missing).
function chosen(s = read()) {
  if (s.mode === "apikey" && open(s.apikey)) return { mode: "apikey", value: open(s.apikey) };
  if (s.mode === "token" && open(s.token)) return { mode: "token", value: open(s.token) };
  return { mode: "account", value: null };
}

// Fallback: while the Claude plan (account or token) is out of usage, run on the saved API key
// until the plan resets. Never switches between plans or accounts.
const onFallback = (s = read()) => !!(s.fallback && open(s.apikey) && chosen(s).mode !== "apikey" && s.limitedUntil > Date.now());

// Which credential Claude runs on right now.
function active() {
  const s = read();
  if (onFallback(s)) return { mode: "apikey", value: open(s.apikey), fallback: true };
  if (s.limitedUntil && s.limitedUntil <= Date.now()) {
    delete s.limitedUntil;
    write(s);
    logLine("videoxx-auth: plan usage reset, back on the Claude plan");
  }
  return chosen(s);
}

function planLimited(until, why) {
  const s = read();
  if (chosen(s).mode === "apikey") return; // already paying per token: nothing to fall back to
  if (onFallback(s)) return; // limits reported while on the key are the key's, not the plan's
  s.limitedUntil = Math.max(until, Date.now() + 6e4);
  write(s);
  logLine(`videoxx-auth: Claude plan out of usage (${why}) until ${new Date(s.limitedUntil).toISOString()}${s.fallback && open(s.apikey) ? ", using the API key meanwhile" : ""}`);
}

// Called from notePlan() with every rate_limit_event of a Claude run.
function notePlanLimit(i) {
  if (!i || typeof i !== "object" || String(i.status) !== "rejected") return;
  const r = +i.resetsAt > 0 ? (+i.resetsAt < 1e12 ? +i.resetsAt * 1e3 : +i.resetsAt) : Date.now() + 5 * 36e5;
  planLimited(r, i.rateLimitType || "rate limit");
}

// Called with the error text of a failed Claude run.
function noteError(msg) {
  const m = String(msg ?? "");
  const reset = m.match(/usage limit reached\|(\d{9,})/i);
  if (reset) planLimited(+reset[1] * 1e3, "usage limit");
  else if (/usage limit|out of (extra )?usage/i.test(m)) planLimited(Date.now() + 36e5, "usage limit, reset time unknown");
}

// Called from cleanEnv(): every Claude run and `claude auth status` gets the chosen credential.
function applyAuth(env) {
  const a = active();
  if (a.mode === "apikey") {
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    env.ANTHROPIC_API_KEY = a.value;
  } else if (a.mode === "token") {
    delete env.ANTHROPIC_API_KEY;
    env.CLAUDE_CODE_OAUTH_TOKEN = a.value;
  }
  return env;
}

const hint = (v) => (v ? `…${v.slice(-4)}` : null);

function state() {
  const a = active();
  const s = read();
  return {
    mode: MODES.includes(s.mode) ? s.mode : "account",
    active: a.mode,
    fallback: !!s.fallback,
    onFallback: !!a.fallback,
    limitedUntil: s.limitedUntil || null,
    apikey: hint(open(s.apikey)),
    token: hint(open(s.token)),
  };
}

function save(input) {
  const s = read();
  const i = input && typeof input === "object" ? input : {};
  if (i.mode !== undefined) {
    if (!MODES.includes(i.mode)) throw new Error("Unknown sign-in mode.");
    s.mode = i.mode;
  }
  if (typeof i.apikey === "string") {
    const v = i.apikey.trim();
    if (/^sk-ant-oat/.test(v)) throw new Error("That is a Claude Code token: pick “Claude Code token” and paste it there.");
    if (v && !/^sk-ant-[\w-]{20,}$/.test(v)) throw new Error('That does not look like an Anthropic API key (it starts with "sk-ant-").');
    s.apikey = v ? seal(v) : undefined;
  }
  if (typeof i.fallback === "boolean") s.fallback = i.fallback;
  if (i.backToPlan === true) delete s.limitedUntil;
  if (typeof i.token === "string") {
    const v = i.token.trim();
    if (v && !/^sk-ant-oat[\w-]{20,}$/.test(v)) throw new Error('That does not look like a Claude Code token (it starts with "sk-ant-oat", from claude setup-token).');
    s.token = v ? seal(v) : undefined;
  }
  write(s);
  return state();
}

// Checks the saved API key against the Anthropic API (listing models costs nothing).
async function testKey() {
  const key = open(read().apikey);
  if (!key) return { ok: false, message: "No API key saved." };
  try {
    const res = await electron.net.fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (res.ok) return { ok: true, message: "The API key works." };
    if (res.status === 401) return { ok: false, message: "Anthropic rejected this API key (401)." };
    return { ok: false, message: `Anthropic answered HTTP ${res.status}.` };
  } catch (e) {
    return { ok: false, message: `Could not reach Anthropic: ${e.message}` };
  }
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

// Claude desktop from the Microsoft Store (MSIX) keeps its claude.exe in the package's private
// copy of AppData\Roaming, which apps started from Explorer cannot see at the usual path.
function packagedClaudeDirs() {
  const root = path.join(process.env.LOCALAPPDATA || "", "Packages");
  try {
    return fs.readdirSync(root)
      .filter((d) => /^Claude_/i.test(d))
      .map((d) => path.join(root, d, "LocalCache", "Roaming", "Claude", "claude-code"))
      .filter((d) => fs.existsSync(d));
  } catch {
    return [];
  }
}

// Codex desktop from the Microsoft Store carries the command-line codex.exe inside its package
// (C:\Program Files\WindowsApps\OpenAI.Codex_<version>_...\app\resources). The folder name changes
// with every Codex update, so it is looked up in the registry, not remembered.
const STORE_PACKAGES = "HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages";
let storeCodex = { at: 0, exes: [] };
function packagedCodexExes() {
  if (process.platform !== "win32") return [];
  const fresh = storeCodex.exes.length ? storeCodex.exes.every((f) => fs.existsSync(f)) : Date.now() - storeCodex.at < 60000;
  if (storeCodex.at && fresh) return storeCodex.exes;
  const exes = [];
  try {
    const { execFileSync } = require("child_process");
    const keys = execFileSync("reg", ["query", STORE_PACKAGES, "/f", "OpenAI.Codex_", "/k"], { encoding: "utf8", windowsHide: true, timeout: 5000 })
      .split(/\r?\n/)
      .filter((l) => /\\OpenAI\.Codex_[^\\]+$/.test(l.trim()));
    for (const key of keys) {
      const out = execFileSync("reg", ["query", key.trim(), "/v", "PackageRootFolder"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
      const rootDir = out.match(/PackageRootFolder\s+REG_SZ\s+(.+)/)?.[1]?.trim();
      const exe = rootDir && path.join(rootDir, "app", "resources", "codex.exe");
      if (exe && fs.existsSync(exe)) exes.push(exe);
    }
  } catch {
    // no Store Codex (reg query finds nothing and exits 1)
  }
  storeCodex = { at: Date.now(), exes };
  return exes;
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  electron.ipcMain.handle("claude:vxAuthGet", () => state());
  electron.ipcMain.handle("claude:vxAuthSet", (_e, input) => save(input));
  electron.ipcMain.handle("claude:vxAuthTest", () => testKey());
  electron.app.whenReady().then(() => logLine(`videoxx-auth: ready (claude runs on: ${active().mode})`));
}

// The app starts Codex with --ignore-user-config, which also drops [windows] sandbox from ~/.codex/config.toml.
// Without a Windows sandbox Codex refuses every shell command ("blocked by policy"), even reads. So the sandbox
// mode is handed over again, always "unelevated": the "elevated" one runs commands as a separate Windows user that
// cannot open the app's own folders (the app's sandbox check in AppData fails with CreateProcessWithLogonW 267).
// Both keep writes inside the project.
function codexSandboxOverrides() {
  return process.platform === "win32" ? ['windows.sandbox="unelevated"'] : [];
}

module.exports = { applyAuth, register, notePlanLimit, noteError, packagedClaudeDirs, packagedCodexExes, codexSandboxOverrides };
