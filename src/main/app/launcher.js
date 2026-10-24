import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";
import { app } from "electron";
import { cmpVersion, installedCopy } from "./updater";

const WIN = process.platform === "win32",
  MAC = process.platform === "darwin";
const LAUNCHER_EXE = () =>
  WIN
    ? path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
        "Programs",
        "videoxx-launcher",
        "Videoxx Launcher.exe",
      )
    : "/Applications/Videoxx Launcher.app/Contents/MacOS/Videoxx Launcher";
const LAUNCHER_RES = () =>
  WIN ? path.join(path.dirname(LAUNCHER_EXE()), "resources") : "/Applications/Videoxx Launcher.app/Contents/Resources";
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
export const launcherInstalled = () => fs.existsSync(LAUNCHER_EXE());
function launcherVersion() {
  const noAsar = process.noAsar;
  process.noAsar = true;
  let fd = -1;
  try {
    fd = fs.openSync(path.join(LAUNCHER_RES(), "app.asar"), "r");
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4),
      jsonLen = head.readUInt32LE(12);
    if (jsonLen <= 0 || jsonLen > 64 << 20) return null;
    const json = Buffer.alloc(jsonLen);
    fs.readSync(fd, json, 0, jsonLen, 16);
    const node = JSON.parse(json.toString("utf8"))?.files?.["package.json"];
    if (!node || node.unpacked || typeof node.size !== "number" || node.size > 1 << 20) return null;
    const data = Buffer.alloc(node.size);
    fs.readSync(fd, data, 0, node.size, 8 + headerSize + Number(node.offset));
    return JSON.parse(data.toString("utf8")).version ?? null;
  } catch {
    return null;
  } finally {
    if (fd >= 0)
      try {
        fs.closeSync(fd);
      } catch {}
    process.noAsar = noAsar;
  }
}
const ownArgs = () =>
  Buffer.from(
    JSON.stringify(
      process.argv
        .slice(1)
        .filter(
          (a) =>
            !/^--(safe|software)-graphics$|^--graphics-mode=|^--launch-id=|^--launched-by=|^--remote-debugging-port=|^--inspect/.test(a),
        ),
    ),
  ).toString("base64");
export function startWatcher() {
  try {
    const test = process.env.CZ_TEST_HOOKS === "1" ? process.env.CZ_TEST_WATCHER : void 0;
    if (!test && (!app.isPackaged || process.env.CZ_USERDATA || process.env.CZ_PREVIEW || process.env.CZ_HIDDEN || !launcherInstalled()))
      return;
    if (!test && !installedCopy()) return;
    const cmd = test ? process.env.CZ_TEST_WATCHER_ELECTRON || process.execPath : LAUNCHER_EXE();
    const args = [
      ...(test ? [test] : []),
      "--watch",
      `--pid=${process.pid}`,
      `--userdata=${app.getPath("userData")}`,
      `--app=${process.execPath}`,
      `--app-args=${ownArgs()}`,
      `--app-version=${app.getVersion()}`,
    ];
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^ELECTRON_RUN_AS_NODE$/.test(k) || (!test && k.startsWith("CZ_LAUNCHER_"))) delete env[k];
    if (test)
      Object.assign(env, {
        CZ_LAUNCHER_TEST: "1",
        CZ_LAUNCHER_FAST: "1",
        CZ_LAUNCHER_USERDATA: path.join(os.tmpdir(), "cz-launcher-test-" + (arg("cz-test") || "none")),
        CZ_LAUNCHER_MATCH: arg("cz-test") || "cz-none",
      });
    const child = cp.spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true, env, cwd: os.tmpdir() });
    child.on("error", () => {});
    if (WIN && child.pid)
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {}
    child.unref();
  } catch {}
}
export function versionBackup(prev, dbPath) {
  if (!/^\d+\.\d+\.\d+([-.][\w.]+)?$/.test(prev) || !fs.existsSync(dbPath)) return null;
  if (cmpVersion(prev, app.getVersion()) > 0) return null;
  const root = path.join(path.dirname(dbPath), "backups", "versions"),
    dir = path.join(root, prev),
    part = dir + ".partial";
  fs.rmSync(part, { recursive: true, force: true });
  fs.mkdirSync(part, { recursive: true });
  for (const f of ["suite.db", "suite.db-wal", "suite.db-shm"]) {
    const p = path.join(path.dirname(dbPath), f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(part, f));
  }
  const cfg = path.join(app.getPath("userData"), "config.json");
  if (fs.existsSync(cfg)) fs.copyFileSync(cfg, path.join(part, "config.json"));
  fs.writeFileSync(
    path.join(part, "about.json"),
    JSON.stringify({ version: prev, keptBy: app.getVersion(), at: new Date().toISOString() }),
  );
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(part, dir);
  const kept = (back) =>
    fs
      .readdirSync(root)
      .filter((d) => !d.endsWith(".partial") && d.endsWith("-before-going-back") === back && fs.existsSync(path.join(root, d, "suite.db")))
      .map((d) => ({
        d,
        t: (() => {
          try {
            return (
              Date.parse(JSON.parse(fs.readFileSync(path.join(root, d, "about.json"), "utf8")).at) ||
              fs.statSync(path.join(root, d, "suite.db")).mtimeMs
            );
          } catch {
            return fs.statSync(path.join(root, d, "suite.db")).mtimeMs;
          }
        })(),
      }))
      .sort((a, b) => b.t - a.t);
  for (const x of [...kept(false).slice(3), ...kept(true).slice(2)]) fs.rmSync(path.join(root, x.d), { recursive: true, force: true });
  return dir;
}
const run = (cmd, args, ms = 10 * 6e4) =>
  new Promise((res) =>
    cp.execFile(cmd, args, { windowsHide: true, timeout: ms }, (e) => res(e ? (typeof e.code === "number" ? e.code : 1) : 0)),
  );
export async function ensureLauncher(log) {
  try {
    if (!installedCopy() || process.env.CZ_NO_LAUNCHER) return;
    await startNeverRun(log);
  } catch (e) {
    log("launcher: not started (" + (e?.message || e) + ")");
  }
}
async function startNeverRun(log) {
  if (!launcherInstalled()) return;
  try {
    if (JSON.parse(fs.readFileSync(path.join(app.getPath("appData"), "Videoxx Launcher", "settings.json"), "utf8")).autostart !== void 0)
      return;
  } catch {}
  if (await launcherRunning()) return;
  log("launcher: installed but never started - starting it in the tray");
  const c = WIN
    ? cp.spawn(LAUNCHER_EXE(), ["--tray"], { detached: true, stdio: "ignore", windowsHide: true })
    : cp.spawn("/usr/bin/open", ["-g", "-a", "/Applications/Videoxx Launcher.app", "--args", "--tray"], {
        detached: true,
        stdio: "ignore",
      });
  c.on("error", (e) => log("launcher: could not start it", e.message));
  c.unref();
}
const runOut = (cmd, args) =>
  new Promise((res) => cp.execFile(cmd, args, { windowsHide: true, timeout: 15e3 }, (_e, out) => res(String(out || ""))));
async function launcherRunning() {
  if (WIN) return /Videoxx Launcher\.exe/i.test(await runOut("tasklist.exe", ["/FI", "IMAGENAME eq Videoxx Launcher.exe", "/NH"]));
  return (await runOut("/usr/bin/pgrep", ["-f", "Videoxx Launcher.app/Contents/MacOS"])).trim().length > 0;
}
export function liftStalePause(log) {
  if (!process.env.CZ_NO_UPDATE || process.env.CZ_USERDATA) return;
  const f = WIN
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Videoxx Launcher", "updates-paused.json")
    : path.join(os.homedir(), "Library", "Application Support", "Videoxx Launcher", "updates-paused.json");
  let p = null;
  try {
    p = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return;
  }
  if (!p?.version || cmpVersion(app.getVersion(), p.version) <= 0) return;
  log("updates: paused for", p.version, "but this is", app.getVersion(), "- resuming them");
  delete process.env.CZ_NO_UPDATE;
  if (!WIN) {
    try {
      fs.rmSync(f, { force: true });
    } catch {}
    return;
  }
  cp.execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::SetEnvironmentVariable('CZ_NO_UPDATE', $null, 'User')"],
    { windowsHide: true, timeout: 3e4 },
    (e) => {
      if (e) return log("updates: could not clear the pause (tried again next start)", e.message);
      try {
        fs.rmSync(f, { force: true });
      } catch {}
    },
  );
}
export function handOverUpdate(version) {
  if (!MAC || !launcherInstalled() || !installedCopy()) return Promise.resolve(false);
  return new Promise((res) => {
    try {
      const child = cp.spawn(LAUNCHER_EXE(), ["--update", `--target=${version}`, `--pid=${process.pid}`], {
        detached: true,
        stdio: "ignore",
        cwd: os.tmpdir(),
      });
      child.once("spawn", () => {
        child.unref();
        res(true);
      });
      child.once("error", () => res(false));
    } catch {
      res(false);
    }
  });
}
