import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import cp from "node:child_process";
import netMod from "node:net";
import { app, net } from "electron";
import { getConfig, setConfig } from "../core/config";
import { log } from "../core/log";
import { getSecret, setSecret } from "../core/secrets";
import { cleanEnv } from "./claudeCli";
import { CLIPROXY_ASSETS, CLIPROXY_RELEASE_URL, CLIPROXY_VERSION } from "./cliproxyRelease";
import { openExternal } from "../core/openExternal";

const KEY = "cliproxy-client-key";
const PORT_FROM = 8317,
  PORT_TO = 8417,
  LOGIN_PORT = 51121,
  MAX_DOWNLOAD = 150 * 1024 * 1024,
  MAX_LOG = 2 * 1024 * 1024;
const testHooks = () => process.env.CZ_TEST_HOOKS === "1";
const fakeScript = () => (testHooks() && process.env.CZ_CLIPROXY_FAKE ? path.resolve(process.env.CZ_CLIPROXY_FAKE) : null);
const root = () => path.join(app.getPath("userData"), "cliproxy");
const binDir = () => path.join(root(), "bin");
const authDir = () => path.join(root(), "auth");
const cfgFile = () => path.join(root(), "config.yaml");
const logFile = () => path.join(root(), "proxy.log");
const pidFile = () => path.join(root(), "proxy.pid");
const versionFile = () => path.join(binDir(), "VERSION");
const platformAsset = (key2 = `${process.platform}-${process.arch}`) => CLIPROXY_ASSETS[key2] ?? null;
const binPath = () => {
  const a = platformAsset();
  return a ? path.join(binDir(), a.bin) : null;
};
const proxyInstalled = () =>
  fakeScript() ? fs.existsSync(root()) : !!binPath() && fs.existsSync(binPath()) && readText(versionFile()) === CLIPROXY_VERSION;
function readText(f) {
  try {
    return fs.readFileSync(f, "utf8").trim();
  } catch {
    return null;
  }
}
const g = () => getConfig().experimental?.google ?? { enabled: false, ack: null, port: null, models: [] };
let status = "off",
  port = null,
  error = null;
let proc = null,
  stopping = false,
  restarts = 0,
  starting = null;
let login = { proc: null, error: null };
let emit = () => {};
let emitLog = () => {};
export function onCliproxy(fns) {
  emit = fns.state;
  emitLog = fns.loginLog;
}
const changed = () => {
  try {
    emit(cliproxyState());
  } catch {}
};
const set = (s, err = null) => {
  status = s;
  error = err;
  changed();
};
export function cliproxyState() {
  const c = g();
  return {
    supported: !!platformAsset() || !!fakeScript(),
    enabled: !!c.enabled,
    ack: c.ack ?? null,
    status: c.enabled ? status : "off",
    port: status === "running" ? port : null,
    error,
    accounts: accounts(),
    models: Array.isArray(c.models) ? c.models : [],
    login: { running: !!login.proc, error: login.error },
    installed: proxyInstalled(),
    version: CLIPROXY_VERSION,
  };
}
function accounts() {
  try {
    return fs
      .readdirSync(authDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const e = JSON.parse(fs.readFileSync(path.join(authDir(), f), "utf8"))?.email;
          return typeof e === "string" && e.length < 200 ? e : null;
        } catch {
          return null;
        }
      })
      .filter((e) => !!e)
      .sort();
  } catch {
    return [];
  }
}
function clientKey() {
  let k = getSecret(KEY);
  if (!k) {
    k = crypto.randomBytes(32).toString("hex");
    setSecret(KEY, k);
  }
  return k;
}
function verifyArchive(file, asset) {
  const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (sha !== asset.sha256)
    throw new Error(
      `The CLIProxyAPI download did not match its known checksum, so it was not installed (expected ${asset.sha256.slice(0, 12)}…, got ${sha.slice(0, 12)}…). Try again later.`,
    );
}
const tarExe = () =>
  process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "/usr/bin/tar";
function run(exe, args) {
  return new Promise((res, rej) => {
    const p = cp.spawn(exe, args, { windowsHide: true });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("error", rej);
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${path.basename(exe)} failed (${c}): ${out.trim().slice(-300)}`))));
  });
}
const blockedMsg = () =>
  process.platform === "darwin"
    ? "macOS or your security software may have blocked or removed CLIProxyAPI. Allow it and try again."
    : "Your antivirus may have blocked or removed CLIProxyAPI. Allow it and try again.";
function plainError(e) {
  const m = String(e?.message ?? e ?? ""),
    code = String(e?.code ?? "");
  const http = Number(e?.httpStatus) || 0;
  if (http === 403 || http === 429)
    return `GitHub is limiting downloads from your network right now (HTTP ${http}), so CLIProxyAPI could not be downloaded. Wait an hour, then press Try again.`;
  if (http === 404) return "The CLIProxyAPI version this app installs is no longer on GitHub (HTTP 404). Update Videoxx, then try again.";
  if (http >= 500) return `GitHub had a problem (HTTP ${http}) while downloading CLIProxyAPI. Try again in a few minutes.`;
  if (http) return `Could not download CLIProxyAPI (HTTP ${http}). Try again later.`;
  if (code === "ENOSPC" || /ENOSPC|no space left/i.test(m))
    return "Your disk is full, so CLIProxyAPI could not be installed. Free some space, then try again.";
  if (/^(EPERM|EACCES|EBUSY|ENOENT|UNKNOWN)$/.test(code) || /\b(EPERM|EACCES|EBUSY)\b/.test(m)) return blockedMsg();
  if (
    /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_\w+|NETWORK_\w+|TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_\w+|TUNNEL_\w+|SSL_\w+|CERT_\w+)|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/.test(
      m,
    )
  )
    return "Could not reach GitHub to download CLIProxyAPI. Check your internet connection, then press Try again.";
  if (/net::ERR_ABORTED/.test(m)) return "The CLIProxyAPI download was stopped.";
  return m.replace(/^Error:\s*/, "") || "Something went wrong.";
}
const IDLE_MS = 3e4;
let dlAbort = null,
  installing = null;
const ensureInstalled = () =>
  proxyInstalled()
    ? Promise.resolve()
    : (installing ??= install().finally(() => {
        installing = null;
      }));
async function install() {
  const asset = platformAsset();
  if (!asset)
    throw new Error(
      process.platform === "linux"
        ? "Google models via CLIProxyAPI are offered on Windows and macOS only."
        : `This computer (${process.platform} ${process.arch}) is not one CLIProxyAPI is offered for here: Windows (64-bit) and macOS only.`,
    );
  fs.mkdirSync(root(), { recursive: true });
  const tmp = path.join(root(), "dl.tmp");
  fs.rmSync(tmp, { force: true });
  set("downloading");
  const local = testHooks() ? process.env.CZ_CLIPROXY_SOURCE : null;
  if (local) fs.copyFileSync(local, tmp);
  else {
    const ac = new AbortController();
    dlAbort = ac;
    let idle = false;
    let timer = setTimeout(() => {
      idle = true;
      ac.abort();
    }, IDLE_MS);
    const poke = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle = true;
        ac.abort();
      }, IDLE_MS);
    };
    try {
      const r = await net.fetch(CLIPROXY_RELEASE_URL + asset.asset, { signal: ac.signal });
      if (!r.ok || !r.body) throw Object.assign(new Error(`HTTP ${r.status}`), { httpStatus: r.status || 500 });
      const fd = fs.openSync(tmp, "w");
      let size = 0;
      try {
        const reader = r.body.getReader();
        for (;;) {
          poke();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_DOWNLOAD) {
            await reader.cancel();
            throw new Error("The CLIProxyAPI download was far bigger than expected, so it was stopped.");
          }
          fs.writeSync(fd, value);
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      if (idle)
        throw new Error(
          "The CLIProxyAPI download stalled (nothing arrived for 30 seconds). Check your internet connection, then press Try again.",
        );
      if (ac.signal.aborted) throw new Error("The CLIProxyAPI download was stopped.");
      throw new Error(plainError(e));
    } finally {
      clearTimeout(timer);
      if (dlAbort === ac) dlAbort = null;
    }
  }
  try {
    verifyArchive(tmp, asset);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  try {
    fs.rmSync(binDir(), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.mkdirSync(binDir(), { recursive: true });
    await run(tarExe(), [process.platform === "win32" ? "-xf" : "-xzf", tmp, "-C", binDir()]);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(
      /ENOSPC|space/i.test(String(e?.message)) || e?.code ? plainError(e) : `CLIProxyAPI could not be unpacked. ${blockedMsg()}`,
    );
  }
  fs.rmSync(tmp, { force: true });
  const bin = path.join(binDir(), asset.bin);
  if (!fs.existsSync(bin)) throw new Error(`The CLIProxyAPI program is missing after unpacking. ${blockedMsg()}`);
  if (process.platform !== "win32") fs.chmodSync(bin, 493);
  fs.writeFileSync(versionFile(), CLIPROXY_VERSION);
  log("cliproxy installed", CLIPROXY_VERSION, asset.asset);
}
function cliproxyConfig(p, key2, auth) {
  return `# Written by Videoxx on every start (Settings > Experimental). Changes here are overwritten.
config-version: 8
server:
  host: "127.0.0.1"
  port: ${p}
management:
  allow-remote: false
  secret-key: ""
  disable-control-panel: true
access:
  api-keys:
    - ${JSON.stringify(key2)}
routing:
  retry:
    request-retry: 0
    max-retry-interval: 0
oauth:
  auth-dir: ${JSON.stringify(auth)}
  providers:
    antigravity:
      antigravity-credits: false
upstream:
  claude:
    disable-claude-cloak-mode: true
observability:
  logs:
    debug: false
    logging-to-file: false
    request-log: false
  usage:
    usage-statistics-enabled: false
`;
}
function writeConfig(p) {
  fs.mkdirSync(authDir(), { recursive: true });
  fs.writeFileSync(cfgFile(), cliproxyConfig(p, clientKey(), authDir()));
}
const portFree = (p, host = "127.0.0.1") =>
  new Promise((res) => {
    const s = netMod.createServer();
    s.once("error", () => res(false));
    s.listen(p, host, () => s.close(() => res(true)));
  });
async function answers(p, key2, ms = 1500) {
  try {
    const r = await fetch(`http://127.0.0.1:${p}/v1/models`, {
      headers: { Authorization: `Bearer ${key2}` },
      signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) return { ok: false };
    const j = await r.json().catch(() => ({}));
    const models = (Array.isArray(j?.data) ? j.data : [])
      .filter((m) => typeof m?.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(m.id))
      .map((m) => ({ id: m.id, name: String(m.display_name || m.id).slice(0, 80) }));
    return { ok: true, models };
  } catch {
    return { ok: false };
  }
}
function proxyEnv() {
  const env = cleanEnv();
  for (const k of Object.keys(env))
    if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|ELECTRON_RUN_AS_NODE)/.test(k)) delete env[k];
  return env;
}
function appendLog(d) {
  try {
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > MAX_LOG) {
      const keep = fs.readFileSync(f).subarray(-MAX_LOG / 2);
      fs.writeFileSync(f, keep);
    }
    fs.appendFileSync(f, d);
  } catch {}
}
let fakeMode = "";
function spawnProxy(args) {
  const fake = fakeScript();
  const env = { ...proxyEnv(), ...(fake ? { ELECTRON_RUN_AS_NODE: "1", ...(fakeMode ? { MOCK_MODE: fakeMode } : {}) } : {}) };
  return fake
    ? cp.spawn(process.execPath, [fake, ...args], { cwd: root(), env, windowsHide: true })
    : cp.spawn(binPath(), args, { cwd: root(), env, windowsHide: true });
}
function authFiles() {
  try {
    return fs.readdirSync(authDir()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}
function authProblem() {
  const files = authFiles();
  if (files.length > 1)
    return `More than one Google account is signed in (${files.length} sign-in files in ${authDir()}). Videoxx uses one account only: press Switch account, or delete the extra files, then press Try again.`;
  for (const f of files) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(authDir(), f), "utf8"))?.type;
      if (t && t !== "antigravity")
        return `The sign-in file ${f} in ${authDir()} is not a Google (Antigravity) sign-in. Only one Google sign-in is used here: press Switch account, or delete that file, then press Try again.`;
    } catch {}
  }
  return null;
}
const waitExit = (p, ms = 5e3) =>
  new Promise((res) => {
    if (p.exitCode !== null || p.signalCode !== null) return res();
    const t = setTimeout(res, ms);
    p.once("exit", () => {
      clearTimeout(t);
      res();
    });
  });
const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
};
async function refreshModels(p) {
  const a = await answers(p, clientKey(), 4e3);
  if (a.ok && a.models) {
    setConfig({ experimental: { google: { models: a.models } } });
    changed();
  }
}
let adopted = null,
  resetTimer = null;
const cancelled = () => stopping || !g().enabled;
function startProxy() {
  if (!g().enabled) return Promise.resolve(false);
  if (status === "running" && port && proc) return Promise.resolve(true);
  return (starting ??= (async () => {
    try {
      stopping = false;
      const key2 = clientKey();
      if (status === "running" && port && !proc) {
        if ((await answers(port, key2)).ok) return true;
        log("cliproxy: the adopted proxy on port", port, "stopped answering");
        adopted = null;
        port = null;
        status = "stopped";
      }
      await ensureInstalled();
      if (cancelled()) return false;
      fs.mkdirSync(root(), { recursive: true });
      const bad = authProblem();
      if (bad) throw new Error(bad);
      const last2 = Number(g().port) || null;
      if (last2 && !proc && (await answers(last2, key2)).ok) {
        if (cancelled()) return false;
        const pid = Number(readText(pidFile()));
        adopted = pid > 0 ? { pid, port: last2 } : null;
        port = last2;
        set("running");
        log("cliproxy adopted on port", last2, "pid", pid || "?");
        refreshModels(last2);
        return true;
      }
      let p = 0;
      for (let x = PORT_FROM; x <= PORT_TO && !p; x++) if (await portFree(x)) p = x;
      if (!p)
        throw new Error(
          `No free port between ${PORT_FROM} and ${PORT_TO} on this computer for CLIProxyAPI. Close some programs, then press Try again.`,
        );
      if (cancelled()) return false;
      set("starting");
      writeConfig(p);
      let spawnErr = null,
        child;
      try {
        child = spawnProxy(["-config", cfgFile()]);
      } catch (e) {
        log("cliproxy spawn threw", e?.code, e?.message);
        throw new Error(blockedMsg());
      }
      proc = child;
      port = p;
      adopted = null;
      try {
        fs.writeFileSync(pidFile(), String(child.pid ?? ""));
      } catch {}
      child.stdout?.on("data", appendLog);
      child.stderr?.on("data", appendLog);
      child.on("error", (e) => {
        log("cliproxy spawn error", e?.code, e?.message);
        spawnErr = /^(ENOENT|EPERM|EACCES|UNKNOWN|EBUSY)$/.test(String(e?.code))
          ? blockedMsg()
          : `CLIProxyAPI could not be started (${e?.code || e?.message}).`;
        if (proc === child) {
          proc = null;
          try {
            fs.rmSync(pidFile(), { force: true });
          } catch {}
        }
      });
      child.on("exit", (code) => {
        if (proc !== child) return;
        proc = null;
        try {
          fs.rmSync(pidFile(), { force: true });
        } catch {}
        if (resetTimer) {
          clearTimeout(resetTimer);
          resetTimer = null;
        }
        if (cancelled()) {
          if (g().enabled) set("stopped");
          return;
        }
        log("cliproxy exited", code, "restarts so far", restarts);
        if (status !== "running") return;
        if (restarts >= 3) {
          set(
            "failed",
            `CLIProxyAPI stopped by itself (code ${code}) and did not stay up after 3 restarts. Press Try again; if it keeps stopping, see ${logFile()}.`,
          );
          return;
        }
        restarts++;
        set("starting");
        setTimeout(
          () => {
            if (!cancelled()) startProxy().catch(() => {});
          },
          (fakeScript() ? 200 : 2e3) * 2 ** (restarts - 1),
        );
      });
      for (const t0 = Date.now(); Date.now() - t0 < 1e4;) {
        if (proc !== child || cancelled()) break;
        if ((await answers(p, key2, 1e3)).ok) {
          if (cancelled()) break;
          setConfig({ experimental: { google: { port: p } } });
          set("running");
          log("cliproxy running on port", p);
          refreshModels(p);
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = setTimeout(() => {
            restarts = 0;
            resetTimer = null;
          }, 6e4);
          return true;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      if (cancelled()) return false;
      if (proc === child) {
        stopping = true;
        child.kill();
        proc = null;
        stopping = false;
      }
      if (spawnErr) throw new Error(spawnErr);
      if (child.exitCode !== null)
        throw new Error(
          `CLIProxyAPI stopped right after it started (code ${child.exitCode}). Press Try again; if it keeps stopping, see ${logFile()}.`,
        );
      throw new Error(
        `CLIProxyAPI did not answer on port ${p} within 10 seconds. Press Try again; if it keeps happening, see ${logFile()}.`,
      );
    } catch (e) {
      log("cliproxy start failed", e?.message);
      if (!cancelled()) set("failed", plainError(e));
      return false;
    } finally {
      starting = null;
    }
  })());
}
export async function stopProxy() {
  stopping = true;
  dlAbort?.abort();
  cancelLogin();
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
  const p = proc,
    savedPort = port ?? (Number(g().port) || null);
  const wasAdopted = adopted;
  proc = null;
  adopted = null;
  port = null;
  if (status !== "off") set("stopped");
  if (p) {
    try {
      p.kill();
    } catch {}
  } else if (wasAdopted) {
    try {
      process.kill(wasAdopted.pid);
    } catch {}
  } else {
    const pid = Number(readText(pidFile()));
    if (pid > 0 && savedPort && getSecret(KEY) && (await answers(savedPort, getSecret(KEY))).ok) {
      try {
        process.kill(pid);
      } catch {}
    }
  }
  try {
    fs.rmSync(pidFile(), { force: true });
  } catch {}
  if (p) await waitExit(p);
  else if (wasAdopted) for (let i = 0; i < 25 && pidAlive(wasAdopted.pid); i++) await new Promise((r) => setTimeout(r, 200));
}
export const proxyReady = () => !!g().enabled && status === "running" && !!port;
export async function googleEndpoint() {
  if (!g().enabled) return null;
  if (!(await startProxy()) || !port) return null;
  return { baseUrl: `http://127.0.0.1:${port}`, key: clientKey() };
}
export async function enableGoogle(ack) {
  if (ack !== true) throw new Error('Tick "I understand the risks and use a separate Google account" first.');
  if (!platformAsset() && !fakeScript()) throw new Error("Google models via CLIProxyAPI are offered on Windows (64-bit) and macOS only.");
  setConfig({ experimental: { google: { enabled: true, ack: new Date().toISOString() } } });
  restarts = 0;
  error = null;
  changed();
  (starting ?? Promise.resolve(false)).then(() => startProxy()).catch(() => {});
  return cliproxyState();
}
export function retryGoogle() {
  if (!g().enabled) throw new Error("Turn on Google models first.");
  restarts = 0;
  error = null;
  changed();
  (starting ?? Promise.resolve(false)).then(() => startProxy()).catch(() => {});
  return cliproxyState();
}
export async function disableGoogle() {
  setConfig({ experimental: { google: { enabled: false } } });
  await stopProxy();
  status = "off";
  error = null;
  changed();
  return cliproxyState();
}
export async function removeGoogle() {
  setConfig({ experimental: { google: { enabled: false } } });
  await stopProxy();
  await installing?.catch(() => {});
  let err = null;
  try {
    fs.rmSync(root(), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch (e) {
    err = e;
  }
  setSecret(KEY, null);
  setConfig({ experimental: { google: { enabled: false, ack: null, port: null, models: [] } } });
  status = "off";
  error = null;
  changed();
  if (fs.existsSync(root())) {
    log("cliproxy remove left the folder", err?.code, err?.message);
    throw new Error(
      `Could not delete everything in ${root()} (${err?.code === "EBUSY" || err?.code === "EPERM" ? "a file is still in use" : err?.code || "still there"}). Restart the app and press Remove again, or delete that folder yourself.`,
    );
  }
  return cliproxyState();
}
export async function googleModels() {
  if (status === "running" && port) await refreshModels(port);
  return cliproxyState().models;
}
export async function switchGoogle() {
  if (!g().enabled) throw new Error("Turn on Google models first.");
  if (login.proc) throw new Error("A Google sign-in is already open: finish it in your browser, or cancel it.");
  await starting?.catch(() => false);
  const wasUp = status === "running" || !!proc || !!adopted;
  if (wasUp) await stopProxy();
  for (const f of authFiles()) {
    try {
      fs.rmSync(path.join(authDir(), f), { force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      throw new Error(`Could not sign out ${f} (${e?.code || e?.message}). Close other programs using it and try again.`);
    }
  }
  setConfig({ experimental: { google: { models: [] } } });
  log("cliproxy switch account: signed out");
  changed();
  restarts = 0;
  await startProxy();
  return loginGoogle();
}
export async function loginGoogle() {
  if (!g().enabled) throw new Error("Turn on Google models first.");
  if (login.proc) throw new Error("A Google sign-in is already open: finish it in your browser, or cancel it.");
  if (authFiles().length >= 1)
    throw new Error("A Google account is already signed in, and Videoxx uses one account only. To use another one, press Switch account.");
  await ensureInstalled();
  if (!g().enabled) throw new Error("Google models were turned off.");
  if (!(await portFree(LOGIN_PORT)))
    throw new Error(
      `Port ${LOGIN_PORT} on this computer is in use by another program (often another Antigravity or Gemini sign-in), so the Google sign-in can't receive its answer. Close that program and try again.`,
    );
  fs.mkdirSync(root(), { recursive: true });
  if (!fs.existsSync(cfgFile())) writeConfig(port || PORT_FROM);
  login = { proc: null, error: null };
  let child;
  try {
    child = spawnProxy(["-antigravity-login", "-no-browser", "-config", cfgFile()]);
  } catch (e) {
    log("cliproxy login spawn threw", e?.code, e?.message);
    throw new Error(blockedMsg());
  }
  login.proc = child;
  changed();
  let opened = false,
    out = "";
  const onData = (d) => {
    const s = String(d);
    out = (out + s).slice(-4e3);
    appendLog(d);
    for (const line of s.split(/\r?\n/)) {
      const url = line.match(/https:\/\/[^\s"'<>]+/)?.[0];
      if (url && !opened) {
        opened = true;
        openExternal(url).catch(() => {});
        emitLog("Your browser opened Google's sign-in page. Sign in there with the separate Google account.");
      } else if (line.trim() && !/token|ya29\.|1\/\/|secret|code=/i.test(line)) emitLog(line.trim().slice(0, 200));
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  const timer = setTimeout(() => {
    login.error = "The Google sign-in was not finished within 5 minutes. Try again.";
    child.kill();
  }, 5 * 6e4);
  return new Promise((res) => {
    const done = (code) => {
      clearTimeout(timer);
      if (login.proc !== child) return;
      login.proc = null;
      if (code !== 0 && !login.error)
        login.error = /cancel/i.test(out) ? null : `The Google sign-in did not finish${code != null ? ` (code ${code})` : ""}.`;
      log("cliproxy login ended", code, accounts().length, "account(s)");
      changed();
      if (status === "running" && port) setTimeout(() => refreshModels(port).catch(() => {}), 1500);
      res(cliproxyState());
    };
    child.on("exit", done);
    child.on("error", (e) => {
      log("cliproxy login spawn error", e?.code, e?.message);
      login.error = /^(ENOENT|EPERM|EACCES|UNKNOWN|EBUSY)$/.test(String(e?.code)) ? blockedMsg() : plainError(e);
      done(null);
    });
  });
}
export function cancelLogin() {
  const p = login.proc;
  if (!p) return;
  login.proc = null;
  login.error = null;
  try {
    p.kill();
  } catch {}
  changed();
}
export function startExperimental() {
  if (g().enabled) startProxy().catch(() => {});
}
export function testCliproxy(op, a) {
  if (op === "verify") {
    try {
      verifyArchive(String(a?.file), platformAsset(a?.key) ?? platformAsset("win32-x64"));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  if (op === "config") {
    const t = readText(cfgFile()) ?? "";
    const v = (re) => t.match(re)?.[1] ?? null;
    return {
      exists: !!t,
      host: v(/^server:[\s\S]*?^\s+host:\s*"([^"]*)"/m),
      port: Number(v(/^server:[\s\S]*?^\s+port:\s*(\d+)/m)),
      secretKey: v(/^management:[\s\S]*?secret-key:\s*"([^"]*)"/m),
      allowRemote: v(/allow-remote:\s*(\w+)/),
      keyIsSecret: !!getSecret(KEY) && t.includes(JSON.stringify(getSecret(KEY))),
      dir: root(),
      authDir: authDir(),
    };
  }
  if (op === "portOpen") return portFree(Number(a)).then((free) => !free);
  if (op === "fakeMode") {
    fakeMode = /^(exit|slow)$/.test(String(a)) ? String(a) : "";
    return fakeMode;
  }
  if (op === "retries") {
    const t = readText(cfgFile()) ?? "";
    return { requestRetry: t.match(/^routing:[\s\S]*?request-retry:\s*(-?\d+)/m)?.[1] ?? null };
  }
  return null;
}
