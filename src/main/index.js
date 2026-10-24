import path from "node:path";
import { BrowserWindow, Menu, app, nativeTheme, screen, session } from "electron";
import { getConfig, setConfig } from "./core/config";
import { ensureWorkspace, resourcesDir, ws } from "./core/workspace";
import { initLog, log } from "./core/log";
import { importSecrets } from "./core/secrets";
import { closeDb, dailyBackup, openDb, recoverInterrupted } from "./db/db";
import { fixPath } from "./core/shellPath";
import { authStatus } from "./engines/claudeCli";
import { adoptSuitePython } from "./core/install";
import { seedPresets } from "./styles/presets";
import { openExternal } from "./core/openExternal";
import { startExperimental, stopProxy } from "./engines/cliproxy";
import { refreshCodex } from "./engines/codexCli";
import { loadPackages, loadStudioLooks, restoreMissingPackages } from "./styles/packages";
import {
  applyGraphicsSwitches,
  askOnRelaunch,
  backupDone,
  checkGpuAtStart,
  flagMode,
  graphicsQuit,
  noteFocused,
  noteWindow,
  previousVersion,
  restartApp,
  saveFlagMode,
  watchFirstPaint,
  watchGpu,
} from "./app/graphicsMode";
import { closeAllWorkers } from "./render/workers";
import { cancelAllExports } from "./render/exportVideo";
import { startLibrary } from "./library/index";
import { writeStyleFiles } from "./agent/projectContext";
import { startBridge, stopBridge } from "./agent/tools/bridge";
import { initPlan } from "./app/plan";
import { startBackground } from "./channels/youtubeSync";
import { recoverInterruptedEdits, runningTasks, stopTask } from "./agent/sessions";
import { autoSpeechSetup } from "./voice/speechSetup";
import { serverUrl, startServer, stopServer } from "./projects/fileServer";
import { unwatch } from "./projects/watcher";
import { installZoom } from "./app/zoom";
import { ensureLauncher, liftStalePause, startWatcher, versionBackup } from "./app/launcher";
import { initUpdater } from "./app/updater";
import { stopAllVoiceovers } from "./voice/voiceover";
import { sweepLeftovers } from "./render/vertical";
import { loadCustomStyles, restoreMissingStyles } from "./styles/customStyles";
import { recoverRoutines, resumeRun, startScheduler, stopRoutines } from "./routines/routines";
import { isAppUrl, registerIpc } from "./ipc/index";

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
const PREVIEW = !!process.env.CZ_PREVIEW;
const MAC = process.platform === "darwin";
if (process.platform === "win32") app.setAppUserModelId(PREVIEW ? "com.videoxx.suite.preview" : "com.videoxx.suite");
if (process.env.CZ_USERDATA) app.setPath("userData", process.env.CZ_USERDATA);
if (process.platform === "darwin" && process.env.CZ_TEST_HOOKS) app.commandLine.appendSwitch("use-mock-keychain");
const PRIMARY = app.requestSingleInstanceLock();
if (!PRIMARY) app.exit(0);
else {
  applyGraphicsSwitches();
  startWatcher();
}
let win = null;
let started = false;
const HIDDEN = !!process.env.CZ_HIDDEN;
if (HIDDEN) app.commandLine.appendSwitch("mute-audio");
app.on("second-instance", (_e, argv) => {
  if (HIDDEN && !(process.env.CZ_TEST_SLOW_START_MS && !started)) {
    noteFocused(argv);
    return;
  }
  const flag = flagMode(argv);
  if (flag) {
    saveFlagMode(flag);
    log("graphics: restart (started again with " + flag.mode + (flag.by ? " by the launcher" : "") + ")");
    return restartApp();
  }
  noteFocused(argv);
  const viaLauncher = argv.some((a) => a.startsWith("--launched-by="));
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (!viaLauncher) askOnRelaunch(win, log);
  } else if (started) createWindow();
  else log("started again while starting: the window comes when this start is ready");
});
let windowShown = () => {};
const firstShown = new Promise((r) => {
  windowShown = r;
});
const replaced = new WeakSet();
function rebuildWindow() {
  const old = win;
  if (!old || old.isDestroyed()) return null;
  replaced.add(old);
  createWindow();
  old.destroy();
  return win;
}
function createWindow() {
  nativeTheme.themeSource = "dark";
  const saved = getConfig().window;
  const onScreen =
    saved.x !== void 0 &&
    screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return saved.x >= b.x - 50 && saved.y >= b.y - 50 && saved.x < b.x + b.width - 100 && saved.y < b.y + b.height - 100;
    });
  const offRight = Math.max(...screen.getAllDisplays().map((d) => d.bounds.x + d.bounds.width)) + 400;
  const place = HIDDEN ? { x: offRight, y: 0 } : onScreen ? { x: saved.x, y: saved.y } : {};
  win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...place,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#171717",
    title: PREVIEW ? "Videoxx PREVIEW" : "Videoxx",
    skipTaskbar: HIDDEN,
    fullscreenable: !HIDDEN,
    // a test's full-screen preview stays inside the parked window
    icon: path.join(resourcesDir(), "resources", "icon.png"),
    // Windows: our own title bar with native buttons painted top-right. macOS: the traffic lights sit inside the
    // sidebar's top corner (the renderer moves the logo down for them, see .app.mac)
    titleBarStyle: "hidden",
    ...(MAC ? { trafficLightPosition: { x: 23, y: 24 } } : { titleBarOverlay: { color: "#171717", symbolColor: "#a8a8a8", height: 34 } }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  installZoom(win);
  if (PREVIEW) win.on("page-title-updated", (e) => e.preventDefault());
  let shown = false;
  const showWin = (late) => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true;
    windowShown();
    if (late) log("graphics: the window never said it was ready (no first frame in 15 s) - showing it anyway");
    watchFirstPaint(win, log, rebuildWindow, late);
    if (HIDDEN) {
      win.showInactive();
      if (process.env.CZ_TEST_START_MINIMIZED === "1") win.minimize();
      return noteWindow(win);
    }
    if (saved.maximized) win.maximize();
    win.show();
    noteWindow(win);
  };
  for (const ev of ["minimize", "restore", "show", "hide"])
    win.on(ev, () => {
      const w = win;
      if (w && shown) noteWindow(w);
    });
  win.once("ready-to-show", () => showWin(false));
  setTimeout(() => showWin(true), 15e3);
  win.on("close", () => {
    if (!win || HIDDEN) return;
    const b = win.getNormalBounds();
    setConfig({ window: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() } });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  win.webContents.on("will-frame-navigate", (e) => {
    if (!e.isMainFrame && !e.url.startsWith(serverUrl() + "/") && !/^about:(blank|srcdoc)$/.test(e.url)) e.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(__dirname, "../renderer/index.html"));
  const me = win;
  me.on("closed", () => {
    if (replaced.has(me)) return;
    win = null;
    app.quit();
  });
  me.webContents.on("render-process-gone", (_e, d) => {
    log("window: the page ended (" + d.reason + ", exit code " + d.exitCode + ")");
    if (d.reason === "clean-exit" || quitting || replaced.has(me) || me !== win || me.isDestroyed()) return;
    if (++pageRebuilds > 3) return log("window: the page keeps ending - not putting up another window (restart the app)");
    log("window: putting a new window in its place");
    rebuildWindow();
  });
  me.on("session-end", () => graphicsQuit());
}
let pageRebuilds = 0;
require("./videoxx-auth").register();
require("./videoxx-connectors").register();
require("./videoxx-assets").register();
require("./videoxx-chatgpt").register();
app.whenReady().then(async () => {
  if (!PRIMARY) return;
  Menu.setApplicationMenu(
    MAC
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "fileMenu" },
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          { label: "View", submenu: [{ role: "togglefullscreen" }] },
          { role: "windowMenu" },
        ])
      : null,
  );
  const ownFullscreen = (wc, perm, mainFrame) => perm === "fullscreen" && mainFrame && !!wc && wc === win?.webContents;
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, d) => cb(ownFullscreen(wc, perm, d.isMainFrame)));
  session.defaultSession.setPermissionCheckHandler((wc, perm, _origin, d) => ownFullscreen(wc, perm, d.isMainFrame));
  initLog();
  fixPath(log);
  adoptSuitePython(log);
  ensureWorkspace();
  importSecrets();
  {
    const prev = previousVersion();
    if (prev)
      try {
        const d = versionBackup(prev, ws.db());
        if (d) log("kept the settings and database of", prev, "in", d);
        backupDone();
      } catch (e) {
        log("version backup failed (tried again next start)", e.message);
      }
  }
  openDb(ws.db());
  const recovered = recoverInterrupted();
  if (recovered) log("recovered", recovered, "interrupted renders");
  try {
    const n = sweepLeftovers();
    if (n) log("removed", n, "leftovers of unfinished vertical exports");
  } catch (e) {
    log("vertical sweep failed", e.message);
  }
  await recoverInterruptedEdits()
    .then((n) => n && log("recovered", n, "interrupted edits"))
    .catch((e) => log("recover edits failed", e.message));
  try {
    dailyBackup(ws.root());
  } catch (e) {
    log("backup failed", e.message);
  }
  seedPresets();
  writeStyleFiles();
  await startServer();
  try {
    loadPackages();
  } catch (e) {
    log("style packages failed to load", e.message);
  }
  try {
    loadCustomStyles();
    const n = restoreMissingStyles();
    if (n) log("restored", n, "custom style(s) from their projects");
  } catch (e) {
    log("custom styles failed to load", e.message);
  }
  try {
    const n = restoreMissingPackages();
    if (n) log("restored", n, "style package(s) from their projects");
  } catch (e) {
    log("style package restore failed", e.message);
  }
  try {
    loadStudioLooks();
  } catch (e) {
    log("studio looks failed to load", e.message);
  }
  startLibrary(firstShown);
  try {
    const n = recoverRoutines();
    if (n) log("routines: marked", n, "interrupted run(s)");
  } catch (e) {
    log("recover routines failed", e.message);
  }
  if (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_TEST_SLOW_START_MS)
    await new Promise((r) => setTimeout(r, Number(process.env.CZ_TEST_SLOW_START_MS)));
  initPlan(() => win);
  registerIpc(() => win);
  started = true;
  watchGpu(() => win, log);
  createWindow();
  if (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_TEST_BLOCK_MS) {
    const until = Date.now() + Number(process.env.CZ_TEST_BLOCK_MS);
    let n = 0;
    while (Date.now() < until) n++;
    log("test: main thread was busy", n > 0);
  }
  void checkGpuAtStart(
    log,
    app.commandLine.getSwitchValue("use-angle") === "swiftshader"
      ? "software (SwiftShader)"
      : app.commandLine.hasSwitch("disable-gpu-compositing")
        ? "graphics card, safe display"
        : "graphics card",
  );
  watchStalls(log);
  void firstShown.then(() => {
    const t0 = Date.now();
    if (getConfig().bridge.enabled) startBridge();
    startExperimental();
    setTimeout(() => {
      void refreshCodex();
    }, 4e3);
    authStatus()
      .then(() => autoSpeechSetup())
      .catch(() => {});
    startScheduler();
    if (process.env.CZ_PREVIEW && process.env.CZ_RESUME_RUNS)
      setTimeout(() => {
        for (const id of process.env.CZ_RESUME_RUNS.split(",")
          .map((s) => s.trim())
          .filter(Boolean))
          resumeRun(id)
            .then(() => log("preview: resumed", id))
            .catch((e) => log("preview: resume failed", id, e?.message));
      }, 3e3);
    startBackground();
    liftStalePause(log);
    initUpdater(() => win);
    setTimeout(() => {
      void ensureLauncher(log);
    }, 15e3).unref?.();
    if (Date.now() - t0 > 1e3) log("startup: the work after the window took", Date.now() - t0, "ms");
    if (process.env.CZ_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
  });
});
function watchStalls(log2) {
  let last2 = Date.now();
  const t = setInterval(() => {
    const now = Date.now(),
      gap = now - last2 - 500;
    last2 = now;
    if (gap > 2e3) log2("startup: the main thread was stuck for", gap, "ms");
  }, 500);
  setTimeout(() => clearInterval(t), 10 * 6e4).unref?.();
}
let quitting = false;
app.on("before-quit", () => {
  if (quitting) return;
  quitting = true;
  log("quitting");
  graphicsQuit();
  stopProxy();
  stopRoutines();
  for (const t of runningTasks()) stopTask(t.taskId);
  stopAllVoiceovers();
  cancelAllExports();
  unwatch();
  closeAllWorkers();
  stopBridge();
  stopServer();
  closeDb();
  setTimeout(() => {
    log("quit did not finish in 4 s: exiting");
    app.exit(0);
  }, 4e3);
});
app.on("window-all-closed", () => app.quit());
