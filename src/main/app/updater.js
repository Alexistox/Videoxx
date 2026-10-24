import path from "node:path";
import fs from "node:fs";
import { Notification, app, net, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { getConfig } from "../core/config";
import { log } from "../core/log";
import { handOverUpdate, launcherInstalled } from "./launcher";

let status = { state: "off", reason: "not started" };
let getWin = () => null;
let timer = null;
const HOURS = 3;
function set(s) {
  status = s;
  getWin()?.webContents.send("update:status", s);
}
export const updateStatus = () => {
  if (status.state !== "off" || status.reason !== "not started") return status;
  const why = updatable();
  return why ? { state: "off", reason: why } : { state: "idle" };
};
function updatable() {
  if (!app.isPackaged) return "development build";
  if (process.env.CZ_USERDATA) return "test instance";
  if (process.env.CZ_NO_UPDATE)
    return "paused by the Videoxx Launcher after going back to an earlier version (open the launcher to resume them)";
  if (!fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) return "this build has no update source";
  if (!installedCopy()) return "not an installed copy";
  return null;
}
export function installedCopy() {
  if (!app.isPackaged || process.env.CZ_USERDATA) return false;
  if (process.platform === "darwin") return app.isInApplicationsFolder();
  if (process.platform !== "win32") return true;
  try {
    return fs.readdirSync(path.dirname(process.execPath)).some((f) => /^Uninstall .*\.exe$/i.test(f));
  } catch {
    return false;
  }
}
export const canNotify = () => (process.platform !== "win32" || installedCopy()) && Notification.isSupported();
const notesText = (n) =>
  typeof n === "string"
    ? n.replace(/<[^>]+>/g, "").trim()
    : Array.isArray(n)
      ? n.map((x) => `${x.version}: ${notesText(x.note)}`).join("\n\n")
      : "";
const semverParts = (v) => {
  const [core, pre] = v.replace(/^v/, "").split("-");
  return { n: core.split(".").map(Number), pre: pre ?? null };
};
export function cmpVersion(a, b) {
  const x = semverParts(a),
    y = semverParts(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) - (y.n[i] ?? 0);
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, void 0, { numeric: true });
}
function pickMacRelease(list, current, beta, arch) {
  const r = list
    .filter((x) => !x.draft && (beta || !x.prerelease) && /^v?\d+\.\d+\.\d+/.test(x.tag_name))
    .sort((a, b) => cmpVersion(b.tag_name, a.tag_name))[0];
  if (!r || cmpVersion(r.tag_name, current) <= 0) return null;
  const dmgs = (r.assets || []).filter((a) => /\.dmg$/i.test(a.name));
  const dmg = dmgs.find((a) => (arch === "arm64" ? /arm64|apple/i.test(a.name) : !/arm64|apple/i.test(a.name))) ?? dmgs[0];
  return { version: r.tag_name.replace(/^v/, ""), notes: String(r.body || "").trim(), download: dmg?.browser_download_url || r.html_url };
}
function macSource() {
  try {
    const y = fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8");
    const owner = y.match(/^owner:\s*(\S+)/m)?.[1],
      repo = y.match(/^repo:\s*(\S+)/m)?.[1];
    return owner && repo ? { owner, repo } : null;
  } catch {
    return null;
  }
}
async function checkMac() {
  const src = macSource();
  if (!src) return;
  if (status.state !== "ready") set({ state: "checking" });
  try {
    const res = await net.fetch(`https://api.github.com/repos/${src.owner}/${src.repo}/releases?per_page=20`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "videoxx" },
    });
    if (!res.ok) throw new Error(res.status === 404 ? "404" : `HTTP ${res.status}`);
    const r = pickMacRelease(await res.json(), app.getVersion(), !!getConfig().updates?.beta, process.arch);
    if (r) {
      log("mac update available", r.version);
      set({ state: "ready", ...r, viaLauncher: launcherInstalled() });
    } else set({ state: "none", checkedAt: new Date().toISOString() });
  } catch (e) {
    log("mac update check failed", e?.message);
    set({ state: "error", message: friendly(e?.message || String(e)) });
  }
}
export function initUpdater(win) {
  getWin = win;
  const why = "Automatic updates are turned off in this build.";
  if (why) {
    set({ state: "off", reason: why });
    return;
  }
  if (process.platform === "darwin") {
    set({ state: "idle" });
    setTimeout(() => checkForUpdates(), 8e3);
    timer = setInterval(() => checkForUpdates(), HOURS * 36e5);
    return;
  }
  autoUpdater.logger = {
    info: (m) => log("updater", String(m)),
    warn: (m) => log("updater warn", String(m)),
    error: (m) => log("updater error", String(m)),
    debug: () => {},
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = !!getConfig().updates?.beta;
  autoUpdater.on("checking-for-update", () => {
    if (status.state !== "ready" && status.state !== "downloading") set({ state: "checking" });
  });
  autoUpdater.on("update-not-available", () => set({ state: "none", checkedAt: new Date().toISOString() }));
  autoUpdater.on("update-available", (i) => set({ state: "downloading", version: i.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => {
    if (status.state === "downloading") set({ ...status, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (i) => {
    log("update ready", i.version);
    set({ state: "ready", version: i.version, notes: notesText(i.releaseNotes) });
  });
  autoUpdater.on("error", (e) => {
    log("update failed", e?.message);
    if (status.state !== "ready") set({ state: "error", message: friendly(e?.message || String(e)) });
  });
  set({ state: "idle" });
  setTimeout(() => checkForUpdates(), 8e3);
  timer = setInterval(() => checkForUpdates(), HOURS * 36e5);
}
const friendly = (m) =>
  /ENOTFOUND|ETIMEDOUT|ECONNRE|net::|getaddrinfo|network/i.test(m)
    ? "Could not reach the update server (offline?)."
    : /404|Unable to find latest/i.test(m)
      ? "No releases published yet."
      : m.split("\n")[0].slice(0, 200);
export async function checkForUpdates() {
  if (status.state === "off" || status.state === "ready" || status.state === "downloading") return updateStatus();
  if (process.platform === "darwin") {
    await checkMac();
    return status;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    set({ state: "error", message: friendly(e?.message || String(e)) });
  }
  return status;
}
export function setBetaUpdates(on) {
  if (status.state === "off") return;
  if (process.platform === "darwin") {
    if (status.state !== "ready") checkForUpdates();
    return;
  }
  autoUpdater.allowPrerelease = on;
  if (status.state !== "ready" && status.state !== "downloading") checkForUpdates();
}
export async function installNow() {
  if (status.state !== "ready") return false;
  if (status.download) {
    const s = status;
    if (await handOverUpdate(s.version)) {
      log("update: the launcher installs", s.version);
      if (timer) clearInterval(timer);
      setTimeout(() => app.quit(), 300);
      return true;
    }
    if (s.viaLauncher) set({ ...s, viaLauncher: false });
    shell.openExternal(s.download);
    return true;
  }
  if (timer) clearInterval(timer);
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}
