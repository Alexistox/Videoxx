import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import cp from "node:child_process";
import os from "node:os";
import { app } from "electron";
import { getConfig, setConfig } from "../core/config";
import { log } from "../core/log";
import { childPath, safeExecFile, spawnErrorText } from "../core/shellPath";
import { cleanEnv } from "./claudeCli";
import { CODEX_INSTALL, CODEX_UPDATE } from "../core/install";
import { openExternal } from "../core/openExternal";

const CODEX_SHELL = process.platform === "win32" ? "PowerShell" : "Terminal";
const CODEX_USAGE_URL = "https://chatgpt.com/codex/settings/usage";
export const NO_CODEX = `ChatGPT (Codex) is not installed. Install it in ${CODEX_SHELL}: ${CODEX_INSTALL} (needs Node.js), or press Install for me in Settings > AI engines.`;
export const codexFake = () => process.env.CZ_TEST_HOOKS === "1" && !!process.env.CZ_CODEX_FAKE;
const TRIPLES = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
};
process.platform === "win32" ? "codex.exe" : "codex";
const isFile = (f) => {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
};
const isScript = (f) => {
  try {
    const b = Buffer.alloc(2);
    const fd = fs.openSync(f, "r");
    fs.readSync(fd, b, 0, 2, 0);
    fs.closeSync(fd);
    return b.toString() === "#!";
  } catch {
    return true;
  }
};
function vendorBinaries(nodeModules, platform = process.platform, arch = process.arch) {
  const triple = TRIPLES[`${platform}-${arch}`],
    exe = platform === "win32" ? "codex.exe" : "codex",
    pkg = `@openai/codex-${platform}-${arch}`;
  if (!triple) return [];
  const out = [];
  for (const root of [path.join(nodeModules, "@openai", "codex", "node_modules", pkg), path.join(nodeModules, pkg)])
    for (const sub of ["bin", "codex"]) out.push(path.join(root, "vendor", triple, sub, exe));
  return out;
}
export function codexCandidates(home, pathDirs, platform = process.platform, arch = process.arch) {
  const exe = platform === "win32" ? "codex.exe" : "codex",
    cands = [];
  const add = (f) => {
    if (isFile(f) && !cands.includes(f) && !(platform !== "win32" && isScript(f))) cands.push(f);
  };
  const extra =
    platform === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".local", "bin")]
      : platform === "win32"
        ? [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm")]
        : [path.join(home, ".local", "bin")];
  const dirs = [...pathDirs.map((d) => d.replace(/^"|"$/g, "")), ...extra].filter(Boolean);
  for (const d of dirs) {
    add(path.join(d, exe));
    for (const nm of [path.join(d, "node_modules"), path.resolve(d, "..", "lib", "node_modules")])
      vendorBinaries(nm, platform, arch).forEach(add);
  }
  if (platform === "win32") require("./videoxx-auth").packagedCodexExes().forEach(add);
  return cands;
}
const cmpVer = (a, b) => {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
function run(exe, args, timeout = 2e4) {
  return new Promise((res) =>
    safeExecFile(exe, args, { env: codexEnv(), timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, out, se) =>
      res({
        code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        out:
          `${out}
${se}`.trim() || (err && !out && !se ? String(err.message || err) : ""),
      }),
    ),
  );
}
const versions = new Map();
async function versionOf(f) {
  const key2 = `${f}|${(() => {
    try {
      return fs.statSync(f).mtimeMs;
    } catch {
      return 0;
    }
  })()}`;
  if (versions.has(key2)) return versions.get(key2);
  const v = (await run(f, ["--version"], 1e4)).out.match(/(\d+\.\d+\.\d+)/)?.[1] ?? "0";
  versions.set(key2, v);
  return v;
}
let found = null;
export async function codexExecutable() {
  const override = getConfig().engines?.codex?.executable;
  if (override && isFile(override)) {
    let exe = override;
    try {
      exe = realCodex(override);
    } catch {}
    return { exe, version: await versionOf(exe) };
  }
  const cands = codexCandidates(os.homedir(), (process.env.PATH || "").split(path.delimiter));
  if (!app.isPackaged)
    vendorBinaries(path.join(app.getAppPath(), "node_modules"))
      .filter(isFile)
      .forEach((f) => {
        if (!cands.includes(f)) cands.push(f);
      });
  const key2 = cands
    .map((f) => {
      try {
        return f + fs.statSync(f).mtimeMs;
      } catch {
        return f;
      }
    })
    .join("|");
  if (found?.key === key2) return { exe: found.exe, version: found.version };
  const withV = await Promise.all(cands.map(async (f) => ({ f, v: await versionOf(f) })));
  const best = withV.sort((a, b) => cmpVer(b.v, a.v))[0];
  found = { key: key2, exe: best?.f ?? null, version: best?.v ?? null };
  return { exe: found.exe, version: found.version };
}
export function codexSafety(own = !!getConfig().claude?.userMcp) {
  const overrides = ["notify=[]", "sandbox_workspace_write.writable_roots=[]", ...require("./videoxx-auth").codexSandboxOverrides()];
  if (!own) {
    for (const f of [
      "apps",
      "plugins",
      "remote_plugin",
      "browser_use",
      "browser_use_external",
      "computer_use",
      "in_app_browser",
      "hooks",
      "memories",
      "skill_mcp_dependency_install",
      "tool_suggest",
    ])
      overrides.push(`features.${f}=false`);
    overrides.push("memories.use_memories=false", "memories.generate_memories=false");
  }
  return { flags: own ? ["--ignore-rules"] : ["--ignore-user-config", "--ignore-rules"], overrides };
}
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
function configHash() {
  let buf = "none";
  try {
    buf = fs.readFileSync(path.join(codexHome(), "config.toml"));
  } catch {}
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}
export function codexEnv() {
  const env = cleanEnv();
  for (const k of Object.keys(env))
    if (/^(OPENAI_API_KEY|CODEX_API_KEY|OPENAI_BASE_URL|OPENAI_ORG_ID|OPENAI_PROJECT_ID)$/i.test(k)) delete env[k];
  if (env.PATH) env.PATH = childPath(env.PATH);
  return env;
}
const SUPPORTED = process.platform === "win32" || process.platform === "darwin";
let state = {
  supported: SUPPORTED,
  installed: false,
  executable: null,
  version: null,
  tooOld: false,
  loggedIn: false,
  method: "unknown",
  sandbox: { ok: null, error: null, checking: false },
  ready: false,
  error: null,
  login: { running: false, mode: null, url: null, code: null, error: null },
  install: { running: false, error: null, ok: false },
  command: CODEX_INSTALL,
  update: CODEX_UPDATE,
  shell: CODEX_SHELL,
  usageUrl: CODEX_USAGE_URL,
  checkedAt: null,
};
let emit = () => {},
  emitLog = () => {};
export function onCodex(fns) {
  emit = fns.state;
  emitLog = fns.log;
}
const readyOf = (s) => s.supported && s.installed && !s.tooOld && s.loggedIn && s.method === "chatgpt" && s.sandbox.ok !== false;
function set(patch) {
  state = { ...state, ...patch };
  state.ready = readyOf(state);
  try {
    emit(state);
  } catch {}
}
export const codexState = () => state;
let fakeState = {};
export function setFakeCodexState(p) {
  fakeState = p ?? {};
  return refreshCodex();
}
export const probeKey = (exe, v) => {
  const s = codexSafety();
  return `${exe}|${v ?? "?"}|cfg:${configHash()}|${crypto
    .createHash("sha256")
    .update([...s.flags, ...s.overrides].join(" "))
    .digest("hex")
    .slice(0, 12)}`;
};
function sandboxOf(exe, v) {
  if (process.platform !== "win32" || !exe) return { ok: process.platform === "win32" ? null : true, error: null, checking: false };
  const p = getConfig().engines?.codex?.probe;
  return p && p.key === probeKey(exe, v) ? { ok: p.ok, error: p.error, checking: false } : { ok: null, error: null, checking: false };
}
let refreshing = null;
export function refreshCodex() {
  if (codexFake()) {
    set({
      installed: true,
      executable: "codex (test stand-in)",
      version: "0.162.1",
      tooOld: false,
      loggedIn: true,
      method: "chatgpt",
      sandbox: { ok: true, error: null, checking: false },
      error: null,
      checkedAt: new Date().toISOString(),
      test: true,
      ...fakeState,
    });
    return Promise.resolve(state);
  }
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      if (!SUPPORTED) {
        set({ installed: false, error: "ChatGPT (Codex) is offered on Windows and macOS.", checkedAt: new Date().toISOString() });
        return state;
      }
      const { exe, version } = await codexExecutable();
      if (!exe) {
        set({
          installed: false,
          executable: null,
          version: null,
          tooOld: false,
          loggedIn: false,
          method: "none",
          sandbox: sandboxOf(null, null),
          error: null,
          checkedAt: new Date().toISOString(),
        });
        return state;
      }
      const [probe, st] = await Promise.all([
        run(exe, ["exec", "--experimental-json", ...codexSafety(false).flags, "--help"], 15e3),
        run(exe, ["login", "status"], 2e4),
      ]);
      const tooOld = probe.code !== 0;
      const t = st.out;
      const method = /not logged in|not signed in|no credentials/i.test(t)
        ? "none"
        : /chatgpt/i.test(t)
          ? "chatgpt"
          : /api key|apikey/i.test(t)
            ? "apikey"
            : st.code === 0
              ? "unknown"
              : "none";
      set({
        installed: true,
        executable: exe,
        version,
        tooOld,
        loggedIn: method === "chatgpt" || method === "apikey" || method === "unknown",
        method,
        sandbox: sandboxOf(exe, version),
        error: tooOld
          ? `This Codex (${version ?? "unknown version"}) is too old for the app. Update it in ${CODEX_SHELL}: ${CODEX_UPDATE}`
          : null,
        checkedAt: new Date().toISOString(),
      });
      return state;
    } catch (e) {
      set({ error: String(e?.message || e), checkedAt: new Date().toISOString() });
      return state;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
export function notReadyWhy(s = state) {
  if (!s.supported) return "ChatGPT (Codex) is offered on Windows and macOS only.";
  if (!s.installed) return `ChatGPT (Codex) is not installed (Settings > AI engines).`;
  if (s.tooOld) return s.error || "Codex is too old for the app (Settings > AI engines).";
  if (s.method === "apikey")
    return "Codex is signed in with an OpenAI API key, which bills API credit, not your ChatGPT plan. In Settings > AI engines, sign out, then Sign in with ChatGPT.";
  if (!s.loggedIn) return "ChatGPT is not signed in (Settings > AI engines > Sign in with ChatGPT).";
  if (s.sandbox.ok === false)
    return `ChatGPT is off on this computer: ${s.sandbox.error || "its sandbox did not keep commands inside the project."}`;
  return null;
}
let probing = null;
export function ensureSandboxProbe(force = false) {
  if (process.platform !== "win32" || codexFake()) return Promise.resolve(state.sandbox);
  if (probing) return probing;
  probing = (async () => {
    const { exe, version } = await codexExecutable();
    if (!exe) return state.sandbox;
    const cached = sandboxOf(exe, version);
    if (!force && cached.ok !== null) {
      set({ sandbox: cached });
      return cached;
    }
    set({ sandbox: { ...state.sandbox, checking: true } });
    const r = await sandboxProbe(exe);
    setConfig({ engines: { codex: { probe: { key: probeKey(exe, version), ok: r.ok, error: r.error, at: new Date().toISOString() } } } });
    log("codex sandbox probe", exe, version, r.ok ? "ok" : `FAILED: ${r.error}`);
    set({ sandbox: { ok: r.ok, error: r.error, checking: false } });
    return state.sandbox;
  })().finally(() => {
    probing = null;
  });
  return probing;
}
export async function sandboxProbe(
  exe,
  base = probeBase(),
  elsewhere = path.join(docsDir(), `.cz-codex-probe-${process.pid}-${Date.now().toString(36)}`),
) {
  const proj = path.join(base, "project"),
    outside = path.join(base, "outside");
  const clean = () => {
    for (const d of [base, elsewhere])
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {}
  };
  try {
    clean();
    fs.mkdirSync(proj, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(elsewhere, { recursive: true });
  } catch (e) {
    clean();
    return { ok: false, error: `the check could not prepare its folders (${e?.message || e})` };
  }
  const inFile = path.join(proj, "inside.txt"),
    outFile = path.join(outside, "outside.txt"),
    farFile = path.join(elsewhere, "outside.txt");
  const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  const cmd = `Set-Content -LiteralPath ${q(inFile)} -Value in; foreach ($f in @(${q(outFile)}, ${q(farFile)})) { try { Set-Content -LiteralPath $f -Value out -ErrorAction Stop } catch { } }`;
  const res = await new Promise((resolve) => {
    let out = "",
      child;
    const cfg = codexSafety().overrides.flatMap((o) => ["-c", o]);
    try {
      child = cp.spawn(
        exe,
        ["sandbox", ...cfg, "-P", ":workspace", "-C", proj, "--", ps, "-NoProfile", "-NonInteractive", "-Command", cmd],
        { env: codexEnv(), windowsHide: true, cwd: proj },
      );
    } catch (e) {
      return resolve({ code: null, out: spawnErrorText(e, exe) });
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
    }, 9e4);
    child.stdout?.on("data", (d) => {
      out += d;
    });
    child.stderr?.on("data", (d) => {
      out += d;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, out: spawnErrorText(e, exe) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
  const inside = fs.existsSync(inFile),
    escaped = fs.existsSync(outFile) || fs.existsSync(farFile);
  clean();
  const detail = {
    code: res.code,
    inside,
    escaped,
    elsewhere,
    cleaned: !fs.existsSync(base) && !fs.existsSync(elsewhere),
    overrides: codexSafety().overrides.length,
    out: res.out.slice(0, 400),
  };
  if (escaped)
    return {
      ok: false,
      error:
        "a command run by Codex could write outside the project folder (its Windows sandbox did not hold), so ChatGPT is switched off here. Update Codex, then press Check again.",
      detail,
    };
  if (!inside)
    return {
      ok: false,
      error: `Codex's Windows sandbox did not start${res.out ? ` (${res.out.replace(/\s+/g, " ").trim().slice(0, 160)})` : ""}. Update Codex, then press Check again.`,
      detail,
    };
  return { ok: true, error: null, detail };
}
function probeBase() {
  const ud = app.getPath("userData"),
    tmp = os.tmpdir().toLowerCase();
  return ud.toLowerCase().startsWith(tmp) ? path.join(os.homedir(), `.cz-codex-probe-${process.pid}`) : path.join(ud, "codex-probe");
}
function docsDir() {
  try {
    return app.getPath("documents");
  } catch {
    return os.homedir();
  }
}
const plain = (s) =>
  s
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
let loginProc = null;
export async function codexLogin(mode) {
  if (loginProc) return state;
  if (codexFake()) {
    const url = mode === "device" ? "https://auth.openai.com/codex/device" : "https://auth.openai.com/oauth/authorize?client_id=test";
    set({ login: { running: false, mode, url, code: mode === "device" ? "TEST-12345" : null, error: null } });
    if (mode === "browser") await openExternal(url);
    return state;
  }
  const { exe } = await codexExecutable();
  if (!exe) throw new Error(NO_CODEX);
  let child;
  try {
    child = cp.spawn(exe, mode === "device" ? ["login", "--device-auth"] : ["login"], { env: codexEnv(), windowsHide: true });
  } catch (e) {
    throw new Error(spawnErrorText(e, exe));
  }
  loginProc = child;
  set({ login: { running: true, mode, url: null, code: null, error: null } });
  const feed = (d) =>
    plain(d.toString())
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((l) => {
        const url = l.match(/https:\/\/[^\s"'<>]+/)?.[0] ?? null;
        const code = mode === "device" ? (l.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,6}\b/)?.[0] ?? null) : null;
        if (url && !state.login.url) set({ login: { ...state.login, url } });
        if (code && !state.login.code) set({ login: { ...state.login, code } });
        emitLog(l);
      });
  child.stdout?.on("data", feed);
  child.stderr?.on("data", feed);
  const timer = setTimeout(
    () => {
      try {
        child.kill();
      } catch {}
    },
    (mode === "device" ? 16 : 10) * 60 * 1e3,
  );
  let ended = false;
  const end = async (err) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    loginProc = null;
    await refreshCodex();
    set({ login: { running: false, mode, url: null, code: null, error: state.loggedIn ? null : (err ?? null) } });
  };
  child.on("error", (e) => {
    void end(spawnErrorText(e, exe));
  });
  child.on("close", (code) => {
    void end(code === 0 ? void 0 : "The sign-in did not finish. Try again.");
  });
  return state;
}
export function cancelCodexLogin() {
  if (loginProc) {
    try {
      loginProc.kill();
    } catch {}
  }
  return state;
}
export function openCodexLoginPage() {
  const u = state.login.url;
  if (!u || !/^https:\/\/([a-z0-9-]+\.)*(openai\.com|chatgpt\.com)(\/|$)/i.test(u)) throw new Error("No sign-in page to open.");
  return openExternal(u);
}
export async function codexLogout() {
  if (codexFake()) {
    fakeState = { ...fakeState, loggedIn: false, method: "none" };
    return refreshCodex();
  }
  const { exe } = await codexExecutable();
  if (exe) await run(exe, ["logout"], 2e4);
  return refreshCodex();
}
let installProc = null;
export async function installCodex() {
  if (installProc) return state;
  if (codexFake()) {
    emitLog("(test) npm install -g @openai/codex");
    set({ install: { running: false, error: null, ok: true } });
    return refreshCodex();
  }
  const env = codexEnv();
  let child;
  try {
    child =
      process.platform === "win32"
        ? cp.spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"), ["/d", "/s", "/c", CODEX_INSTALL], {
            env,
            windowsHide: true,
          })
        : cp.spawn("npm", ["install", "-g", "@openai/codex"], { env, windowsHide: true });
  } catch (e) {
    set({ install: { running: false, error: spawnErrorText(e, "npm"), ok: false } });
    return state;
  }
  installProc = child;
  set({ install: { running: true, error: null, ok: false } });
  const tail = [];
  const feed = (d) =>
    plain(d.toString())
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((l) => {
        tail.push(l);
        if (tail.length > 40) tail.shift();
        emitLog(l);
      });
  child.stdout?.on("data", feed);
  child.stderr?.on("data", feed);
  const timer = setTimeout(
    () => {
      try {
        child.kill();
      } catch {}
    },
    10 * 60 * 1e3,
  );
  let ended = false;
  const end = async (code, err) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    installProc = null;
    found = null;
    const t = tail.join("\n");
    const why =
      err ??
      (code === 0
        ? null
        : /EACCES|permission denied/i.test(t)
          ? `npm could not write to its global folder (no permission). Run the command yourself in ${CODEX_SHELL}: ${CODEX_INSTALL}`
          : /not recognized|command not found|ENOENT/i.test(t)
            ? `npm was not found: install Node.js first (Settings > System), then try again.`
            : `The install stopped (npm exit ${code}). See the log above, or run it yourself in ${CODEX_SHELL}: ${CODEX_INSTALL}`);
    set({ install: { running: false, error: why, ok: !why } });
    await refreshCodex();
  };
  child.on("error", (e) => {
    void end(
      null,
      e?.code === "ENOENT" ? "npm was not found: install Node.js first (Settings > System), then try again." : spawnErrorText(e, "npm"),
    );
  });
  child.on("close", (code) => {
    void end(code);
  });
  return state;
}
export function setCodexPath(p) {
  const raw = p && String(p).trim() ? String(p).trim().replace(/^"|"$/g, "") : null;
  if (raw && !isFile(raw)) throw new Error("No file there. Paste the full path to codex (codex.exe on Windows).");
  const v = raw ? realCodex(raw) : null;
  setConfig({ engines: { codex: { executable: v } } });
  found = null;
  return refreshCodex();
}
export function realCodex(f, platform = process.platform, arch = process.arch) {
  const launcher = platform === "win32" ? !/\.exe$/i.test(f) : isScript(f);
  if (!launcher) return f;
  let real = f;
  try {
    real = fs.realpathSync(f);
  } catch {}
  const d = path.dirname(f);
  const roots = [
    path.join(d, "node_modules"),
    path.resolve(d, "..", "lib", "node_modules"),
    path.resolve(path.dirname(real), "..", "..", ".."),
  ];
  for (const nm of roots) {
    const hit = vendorBinaries(nm, platform, arch).find(isFile);
    if (hit) return hit;
  }
  throw new Error(
    platform === "win32"
      ? `That is npm's launcher (${path.basename(f)}), not Codex itself, and the real codex.exe was not found next to it. Paste the path to codex.exe, or leave this empty to find it automatically.`
      : `That is npm's launcher script, not Codex itself, and the real codex was not found next to it. Paste the path to the codex binary, or leave this empty to find it automatically.`,
  );
}
