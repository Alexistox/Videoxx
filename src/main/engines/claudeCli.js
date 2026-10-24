import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";
import { app } from "electron";
import { getConfig } from "../core/config";
import { childPath, safeExecFile, spawnErrorText } from "../core/shellPath";

export const CLAUDE_INSTALL =
  process.platform === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash";
export const CLAUDE_SHELL = process.platform === "win32" ? "PowerShell" : "Terminal";
export const NO_CLAUDE = `Claude Code is not installed. Install it (in ${CLAUDE_SHELL}): ${CLAUDE_INSTALL}  - then restart the Suite. Already installed? Run ${process.platform === "win32" ? "where.exe claude" : "which claude"} in ${CLAUDE_SHELL} and paste the path into Settings > System > Tool paths > claude.`;
const cmpVer = (a, b) => {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
let found = null;
export const versionInPath = (f) => f.match(/claude-code[\\/](\d+(?:\.\d+)+)[\\/]/)?.[1] ?? null;
const probed = new Map();
let probing = null;
const stamp = (f) => {
  try {
    return f + "|" + fs.statSync(f).mtimeMs;
  } catch {
    return f;
  }
};
const mtime = (f) => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
};
const versionOf = (f) => versionInPath(f) ?? probed.get(stamp(f)) ?? null;
function probeClaudeVersions() {
  return (probing ??= Promise.all(
    installs()
      .filter((f) => versionOf(f) === null)
      .map(
        (f) =>
          new Promise((res) =>
            safeExecFile(f, ["--version"], { timeout: 8e3, windowsHide: true }, (err, out) => {
              probed.set(stamp(f), err ? "0" : (out.match(/\d+(?:\.\d+)+/)?.[0] ?? "0"));
              res();
            }),
          ),
      ),
  )
    .then(() => {
      found = null;
    })
    .finally(() => {
      probing = null;
    }));
}
const isFile = (f) => {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
};
export function claudeCandidates(home, appData, pathDirs, exe) {
  const cands = [];
  const add = (f) => {
    if (isFile(f) && !cands.includes(f)) cands.push(f);
  };
  const dirs = [
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
    ...pathDirs.map((d) => d.replace(/^"|"$/g, "")),
  ].filter(Boolean);
  for (const d of dirs) {
    add(path.join(d, exe));
    for (const nm of [path.join(d, "node_modules"), path.join(d, "..", "lib", "node_modules")])
      add(path.resolve(nm, "@anthropic-ai", "claude-code", "bin", "claude.exe"));
  }
  for (const desk of [path.join(appData, "Claude", "claude-code"), ...require("./videoxx-auth").packagedClaudeDirs()])
    try {
      for (const v of fs.readdirSync(desk))
        if (/^\d+(\.\d+)*$/.test(v)) {
          const inside = (dir) => [path.join(dir, exe), path.join(dir, "claude.app", "Contents", "MacOS", "claude")];
          let files = inside(path.join(desk, v));
          try {
            for (const sub of fs.readdirSync(path.join(desk, v))) files = files.concat(inside(path.join(desk, v, sub)));
          } catch {}
          const f = files.find(isFile);
          if (f) add(f);
        }
    } catch {}
  return cands;
}
export function claudeExecutable() {
  const override = getConfig().claude.executable;
  if (override && fs.existsSync(override)) return override;
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const roots = [
    path.join(app.getAppPath(), "node_modules"),
    path.join(app.getAppPath().replace("app.asar", "app.asar.unpacked"), "node_modules"),
  ];
  for (const r of roots) {
    const f = path.join(r, pkg, exe);
    if (fs.existsSync(f)) return f.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
  }
  const cands = installs();
  const key2 = cands.map(stamp).join("|");
  if (found?.key === key2) return found.exe;
  const all = cands.map((f) => ({ f, v: versionOf(f), t: mtime(f) }));
  if (all.some((x) => x.v === null)) {
    void probeClaudeVersions();
    return all.sort((a, b) => b.t - a.t)[0]?.f ?? null;
  }
  const best = all.sort((a, b) => cmpVer(b.v, a.v) || b.t - a.t)[0];
  found = { key: key2, exe: best?.f ?? null };
  return found.exe;
}
function installs() {
  let appData = process.env.APPDATA || "";
  try {
    appData = app.getPath("appData");
  } catch {}
  return claudeCandidates(
    os.homedir(),
    appData,
    (process.env.PATH || "").split(path.delimiter),
    process.platform === "win32" ? "claude.exe" : "claude",
  );
}
const STRIP =
  /^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|HOST_SESSION_ID|CHILD_SESSION|MESSAGING_.*|SDK_HAS_HOST_AUTH_REFRESH|OAUTH_SCOPES|EXECPATH|SESSION_ATTENDED|EAGER_FLUSH|EMIT_TOOL_USE_SUMMARIES|DESKTOP_APP_VERSION|TERMINAL_MCP_TOOLS|REPORT_FINDINGS|ENABLE_.*|DISABLE_.*)|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|CLAUDE_AGENT_SDK_VERSION|ANTHROPIC_BASE_URL|ANTHROPIC_API_KEY|USE_LOCAL_OAUTH|USE_STAGING_OAUTH)$/;
const ignoredApiKey = () => !!process.env.ANTHROPIC_API_KEY;
export function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== void 0 && !STRIP.test(k)) env[k] = v;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = `videoxx/${app.getVersion()}`;
  require("./videoxx-auth").applyAuth(env);
  if (env.PATH) env.PATH = childPath(env.PATH);
  return env;
}
let last = null;
export const lastStatus = () => last;
function exec(args, timeout = 2e4) {
  const exe = claudeExecutable();
  if (!exe) return Promise.reject(new Error(NO_CLAUDE));
  return new Promise((res, rej) =>
    safeExecFile(exe, args, { env: cleanEnv(), timeout, windowsHide: true }, (err, stdout, stderr) =>
      err
        ? rej(new Error(String(stderr || (err.syscall?.startsWith("spawn") ? spawnErrorText(err, exe) : err.message)).trim()))
        : res(String(stdout)),
    ),
  );
}
export async function authStatus() {
  if (!getConfig().claude.executable) await probeClaudeVersions();
  const executable = claudeExecutable();
  const base = { executable, checkedAt: new Date().toISOString(), ignoredKey: ignoredApiKey() };
  try {
    const [ver, st] = await Promise.all([exec(["--version"]).catch(() => ""), exec(["auth", "status", "--json"])]);
    const j = JSON.parse(st);
    last = {
      ...base,
      ok: !!j.loggedIn,
      loggedIn: !!j.loggedIn,
      method: j.authMethod || "none",
      keySource: j.apiKeySource,
      version: ver.trim().split(" ")[0] || null,
    };
  } catch (e) {
    last = { ...base, ok: false, loggedIn: false, method: "none", version: null, error: e.message };
  }
  return last;
}
const plain = (s) =>
  s
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
let loginRun = null;
export function login(onLine) {
  if (loginRun) return loginRun.done;
  const exe = claudeExecutable();
  if (!exe) return Promise.reject(new Error(NO_CLAUDE));
  let proc;
  try {
    proc = cp.spawn(exe, ["auth", "login"], { env: cleanEnv(), windowsHide: true });
  } catch (e) {
    return Promise.reject(new Error(spawnErrorText(e, exe)));
  }
  const done = new Promise((resolve) => {
    const feed = (d) =>
      plain(d.toString())
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach(onLine);
    proc.stdout.on("data", feed);
    proc.stderr.on("data", feed);
    const timer = setTimeout(() => proc.kill(), 5 * 60 * 1e3);
    const end = async () => {
      clearTimeout(timer);
      loginRun = null;
      resolve(await authStatus());
    };
    proc.on("close", end);
    proc.on("error", (e) => {
      onLine(e.message);
      end();
    });
  });
  loginRun = { done, proc };
  return done;
}
export function loginCode(code) {
  const c = String(code || "").trim();
  if (!loginRun || !c || c.length > 2e3) return false;
  loginRun.proc.stdin?.write(c + "\n");
  return true;
}
export async function logout() {
  await exec(["auth", "logout"]).catch(() => {});
  return authStatus();
}
