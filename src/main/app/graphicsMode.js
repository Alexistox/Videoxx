import path from "node:path";
import fs from "node:fs";
import { app, desktopCapturer, dialog } from "electron";
import { setConfig } from "../core/config";

const WIN = process.platform === "win32";
const isMode = (m) => m === "auto" || m === "software" || (m === "safe" && WIN);
const file = () => path.join(app.getPath("userData"), "config.json");
function readSaved() {
  try {
    const g = JSON.parse(fs.readFileSync(file(), "utf8")).graphics;
    if (g && isMode(g.mode)) return g;
  } catch {}
  return { mode: "auto" };
}
const writeSaved = (g) => {
  const o = readSaved();
  setConfig({
    graphics: {
      ...g,
      seen: g.seen ?? o.seen,
      cacheClearedAt: g.cacheClearedAt ?? o.cacheClearedAt,
      clearCache: g.clearCache ?? o.clearCache,
      inProcess: false,
      good: g.good ?? o.good,
      trial: g.trial ?? (g.mode === o.mode ? o.trial : 0),
    },
  });
};
const VERSION = app.getVersion();
const DAY = 24 * 36e5;
const argValue = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null;
const LAUNCH_ID = argValue("launch-id");
const LAUNCHED = !!argValue("launched-by");
const GPU_CACHES = [
  "GPUCache",
  "GPUPersistentCache",
  "ShaderCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "DawnCache",
];
function clearGpuCaches() {
  const ud = app.getPath("userData"),
    gone = [],
    held = [];
  for (const d of GPU_CACHES) {
    const p = path.join(ud, d);
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        gone.push(d);
      }
    } catch {
      held.push(d);
    }
  }
  return { gone, held };
}
let clearedThisStart = null;
const early = [];
const notes = [];
let active = "auto";
let forced = false;
let switchedThisRun = false;
let unproven = false;
let climbing = false;
const failures = [];
const startedAt = Date.now();
let cur = { phase: "starting", extra: {} };
let winState = {};
function writeStatus(phase, extra = {}) {
  cur = { phase, extra };
  try {
    fs.writeFileSync(
      path.join(app.getPath("userData"), "launch-status.json"),
      JSON.stringify({
        launchId: LAUNCH_ID,
        pid: process.pid,
        version: VERSION,
        mode: active,
        climbing,
        phase,
        ...winState,
        ...extra,
        at: new Date().toISOString(),
      }),
    );
  } catch {}
}
const currentPhase = () => cur.phase;
export function noteWindow(w) {
  if (w.isDestroyed()) return;
  let sourceId = null;
  try {
    sourceId = w.getMediaSourceId();
  } catch {}
  winState = { shown: true, visible: w.isVisible(), minimized: w.isMinimized(), sourceId };
  writeStatus(cur.phase, cur.extra);
}
export function noteFocused(argv) {
  const id = argv.find((a) => a.startsWith("--launch-id="))?.slice(12) ?? null;
  writeStatus(cur.phase, { ...cur.extra, focusedLaunchId: id, focusedAt: new Date().toISOString() });
}
export function graphicsQuit() {
  try {
    const s = readSaved();
    if (s.open === process.pid) writeSaved({ ...s, open: null });
  } catch {}
  writeStatus(restarting ? "restarting" : "quitting", { lastPhase: cur.phase, ...(cur.extra.member ? { member: cur.extra.member } : {}) });
}
let restarting = false;
export function flagMode(argv) {
  const lm = argv.find((a) => a.startsWith("--graphics-mode="))?.slice(16);
  if (lm === "auto" || lm === "software" || lm === "safe") return { mode: lm === "safe" && !WIN ? "software" : lm, by: "launcher" };
  if (argv.includes("--software-graphics")) return { mode: "software", by: null };
  if (argv.includes("--safe-graphics")) return { mode: WIN ? "safe" : "software", by: null };
  return null;
}
export function saveFlagMode(f) {
  writeSaved({
    mode: f.mode,
    auto: false,
    at: null,
    why: f.by ? "blank" : void 0,
    by: f.by,
    clearCache: true,
    trial: 0,
    climbFrom: null,
    keep: false,
  });
}
export function applyGraphicsSwitches() {
  const env = process.env.CZ_GRAPHICS;
  forced = isMode(env);
  try {
    decide();
  } catch (e) {
    notes.push("could not read or save the graphics setting (" + (e?.message || e) + ") - starting with the saved mode as it is");
    previous = null;
    try {
      active = forced ? env : (flagMode(process.argv)?.mode ?? readSaved().mode);
    } catch {
      active = flagMode(process.argv)?.mode ?? "auto";
    }
  }
  writeStatus("starting");
  const beat = setInterval(() => {
    if (cur.phase === "starting" || cur.phase === "gate") writeStatus(cur.phase, cur.extra);
    else clearInterval(beat);
  }, 5e3);
  beat.unref?.();
  setTimeout(() => clearInterval(beat), 10 * 6e4).unref?.();
  app.on("child-process-gone", (_e, d) =>
    early.push(`${new Date().toISOString()} ${d.type} ${d.reason} exit ${d.exitCode}${d.name ? " " + d.name : ""}`),
  );
  if (active === "software") {
    app.commandLine.appendSwitch("use-gl", "angle");
    app.commandLine.appendSwitch("use-angle", "swiftshader");
    app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  } else {
    app.commandLine.appendSwitch("ignore-gpu-blocklist");
    if (WIN) app.commandLine.appendSwitch("force_high_performance_gpu");
    if (active === "safe") {
      app.commandLine.appendSwitch("disable-gpu-compositing");
      app.commandLine.appendSwitch("disable-direct-composition");
    } else app.commandLine.appendSwitch("enable-gpu-rasterization");
    if (process.env.CZ_TEST_NO_WEBGL) app.commandLine.appendSwitch("use-gl", "disabled");
  }
}
let previous = null;
export const previousVersion = () => previous;
export function backupDone() {
  previous = null;
  try {
    const s = readSaved();
    if (s.pendingBackup) writeSaved({ ...s, pendingBackup: void 0 });
  } catch {}
}
function decide() {
  const env = process.env.CZ_GRAPHICS;
  const s0 = readSaved();
  if (s0.inProcess) {
    notes.push(`undid 0.16.3's "graphics inside the app" (mode was ` + s0.mode + ")");
    writeSaved({ ...s0, mode: s0.auto || s0.mode === "software" ? "auto" : s0.mode, auto: false, at: null, why: void 0, trial: 0 });
  }
  const unclean = !!s0.open && s0.open !== process.pid && (!process.env.CZ_HIDDEN || process.env.CZ_TEST_UNCLEAN === "1");
  const updated = s0.lastVersion !== VERSION;
  if (updated && s0.lastVersion && !forced && !s0.pendingBackup) writeSaved({ ...readSaved(), pendingBackup: s0.lastVersion });
  previous = readSaved().pendingBackup ?? null;
  notes.push(
    `start: version ${VERSION}${updated ? ` (last start: ${s0.lastVersion ?? "an older version"})` : ""}, saved mode ${s0.mode}${s0.auto ? " (picked by the app)" : ""}${s0.by ? " (picked by the launcher)" : ""}${s0.keep ? " (kept)" : ""}${unclean ? ", the last start did not quit" : ""}${LAUNCHED ? ", opened by the launcher" : ""}`,
  );
  const flag = flagMode(process.argv);
  if (flag) {
    saveFlagMode(flag);
    notes.push(`started with ${flag.by ? "--graphics-mode" : "a rescue flag"}: ${flag.mode}, GPU caches cleared`);
  } else {
    const s = readSaved(),
      good = s.good ?? "auto";
    if (s.auto && s.mode !== good) {
      const trial = (s.trial ?? 0) + 1;
      if (trial > 2) {
        notes.push(`${s.mode} (picked by the app) was never seen on screen in ${trial - 1} starts - back to ${good}`);
        writeSaved({
          mode: good,
          auto: false,
          at: null,
          trial: 0,
          climbFrom: null,
          ...(s.climbFrom ? { climbFails: (s.climbFails ?? 0) + 1, sinceClimb: 0 } : {}),
        });
      } else writeSaved({ ...s, trial });
    }
    const c = readSaved();
    if (updated && !forced && !c.keep && c.mode === "software" && (!c.auto || c.good === "software")) {
      const fails = c.climbFails ?? 0,
        since = (c.sinceClimb ?? 0) + 1;
      if (fails < 2 || since >= 5) {
        const to = WIN ? "safe" : "auto";
        notes.push(`trying ${to} after the update (software worked; ${to} must show on screen or it goes straight back)`);
        writeSaved({
          mode: to,
          auto: true,
          at: new Date().toISOString(),
          why: c.why ?? "blank",
          good: "software",
          trial: 0,
          climbFrom: "software",
          sinceClimb: 0,
          clearCache: true,
          by: null,
        });
      } else writeSaved({ ...c, sinceClimb: since });
    }
  }
  if ((updated || unclean) && !readSaved().clearCache) writeSaved({ ...readSaved(), clearCache: true });
  if (readSaved().clearCache) {
    const r = clearGpuCaches();
    clearedThisStart = r.gone;
    if (r.held.length) notes.push("could not clear " + r.held.join(", ") + " (in use) - again at the next start");
    writeSaved({ ...readSaved(), clearCache: r.held.length > 0, cacheClearedAt: new Date().toISOString() });
  }
  writeSaved({ ...readSaved(), ...(forced ? {} : { lastVersion: VERSION }), open: process.pid });
  unproven = updated || unclean || LAUNCHED;
  active = forced ? env : readSaved().mode;
  const s1 = readSaved();
  climbing = !forced && !!s1.climbFrom && !!s1.auto && s1.mode === active;
}
let mainWin = null;
let glog = (...a) => console.log(...a);
export function watchGpu(getWin, log = () => {}) {
  mainWin = getWin;
  glog = log;
  for (const n of notes.splice(0)) log("graphics:", n);
  for (const l of early.splice(0)) log("child process ended before the window:", l);
  let crashes = 0;
  app.on("child-process-gone", (_e, d) => {
    if (d.type !== "GPU") {
      if (d.reason !== "clean-exit") log("child process ended:", d.type, d.reason, "exit", d.exitCode, d.name || "");
      return;
    }
    log("graphics: the graphics process ended (" + d.reason + ", exit code " + d.exitCode + ")");
    if (d.reason === "clean-exit" || d.reason === "killed") return;
    if (++crashes >= 3) webglFailed("the graphics process crashed " + crashes + " times (" + d.reason + ")", getWin);
  });
}
export function graphicsState() {
  const s = readSaved(),
    gpu = app.getGPUFeatureStatus();
  return {
    mode: s.mode,
    active,
    forced,
    auto: !!s.auto,
    at: s.at ?? null,
    why: s.why ?? null,
    restartNeeded: !forced && s.mode !== active,
    webgl: gpu?.webgl ?? null,
    safeAvailable: WIN,
    failures: failures.slice(-5),
    inProcess: false,
    savedInProcess: !!s.inProcess,
    good: s.good ?? null,
    trial: s.trial ?? 0,
    keep: !!s.keep,
    climbing,
    climbFrom: s.climbFrom ?? null,
    by: s.by ?? null,
    goodVersion: s.goodVersion ?? null,
    lastVersion: s.lastVersion ?? null,
  };
}
export function setGraphicsMode(mode) {
  if (!isMode(mode)) throw new Error("Unknown graphics mode");
  writeSaved({
    mode,
    auto: false,
    at: null,
    trial: 0,
    climbFrom: null,
    by: null,
    why: void 0,
    ...(mode === "auto" ? { keep: false, climbFails: 0, sinceClimb: 0 } : {}),
  });
  climbing = false;
  return graphicsState();
}
export function setGraphicsKeep(keep) {
  writeSaved({ ...readSaved(), keep: !!keep });
  return graphicsState();
}
export function webglFailed(where, getWin, why = "webgl", to = "software") {
  failures.push(`${new Date().toISOString()} ${where}`);
  console.log("[graphics] WebGL failed:", where, "mode", active);
  if (active === "software" || forced) return { switched: false, software: active === "software" };
  if (to === active) to = "software";
  const first = !switchedThisRun;
  if (climbing) {
    const s = readSaved(),
      back = s.climbFrom ?? "software";
    if (first) {
      switchedThisRun = true;
      writeSaved({
        mode: back,
        auto: false,
        at: null,
        why: s.why,
        climbFrom: null,
        climbFails: (s.climbFails ?? 0) + 1,
        sinceClimb: 0,
        clearCache: true,
        trial: 0,
      });
    }
    if (first) {
      glog("graphics: " + active + " did not work after the update (" + where + ") - back to " + back);
      climbing = false;
      writeStatus("switching", { to: back, why: where });
    }
    if (first && Date.now() - startedAt < 6e4 && !process.env.CZ_TEST_HOOKS) restartApp();
    else if (first) {
      const w2 = (getWin ?? mainWin)?.();
      if (w2 && !w2.isDestroyed()) w2.webContents.send("graphics:switched", { where, to: back });
    }
    return { switched: true, first, software: false };
  }
  if (first) {
    switchedThisRun = true;
    writeSaved({ mode: to, auto: true, at: new Date().toISOString(), why, clearCache: true, by: null });
    writeStatus("switching", { to, why: where });
  }
  const w = (getWin ?? mainWin)?.();
  if (first && w && !w.isDestroyed()) w.webContents.send("graphics:switched", { where, to });
  return { switched: true, first, software: false };
}
export async function checkGpuAtStart(log, label) {
  if (clearedThisStart) log("graphics: cleared the GPU caches (" + (clearedThisStart.join(", ") || "none there") + ")");
  const t0 = Date.now(),
    noReport = process.env.CZ_TEST_GPU_SILENT === "1";
  const info = noReport
    ? null
    : await Promise.race([app.getGPUInfo("basic").catch(() => null), new Promise((r) => setTimeout(() => r(null), 1e4))]);
  let late = null;
  if (!info && !noReport) {
    log("graphics: no GPU info in 10 s - waiting 20 s more");
    late = await Promise.race([app.getGPUInfo("basic").catch(() => null), new Promise((r) => setTimeout(() => r(null), 2e4))]);
  }
  const gi = info ?? late,
    reported = !!gi;
  const tr = Date.now();
  let st = app.getGPUFeatureStatus() ?? {};
  while (st.webgl === "disabled_off" && reported && Date.now() - tr < 1e4) {
    await new Promise((r) => setTimeout(r, 250));
    st = app.getGPUFeatureStatus() ?? {};
  }
  const webgl = noReport
    ? "unknown (no GPU info in 30 s)"
    : reported || st.webgl !== "disabled_off"
      ? st.webgl
      : "unknown (no GPU info in 30 s)";
  log("graphics:", label, "· webgl", webgl, "(" + (Date.now() - t0) + " ms)");
  try {
    const devs = (gi?.gpuDevice ?? []).map(
      (d) =>
        `${(d.vendorId ?? 0).toString(16).padStart(4, "0")}:${(d.deviceId ?? 0).toString(16).padStart(4, "0")}${d.active ? " (in use)" : ""}${d.driverVersion ? " driver " + d.driverVersion : ""}${d.vendorString ? " " + d.vendorString : ""}${d.deviceString ? " " + d.deviceString : ""}`,
    );
    if (devs.length) log("graphics: gpu", devs.join(" | "));
  } catch {}
  if (webgl === "disabled_off")
    try {
      log("graphics: gpu status", JSON.stringify(st));
    } catch {}
  const test = process.env.CZ_TEST_GPU_OFF === "1" || noReport;
  const off = webgl === "disabled_off" || /^unknown/.test(webgl);
  if ((!off && !test) || (process.env.CZ_HIDDEN && !test) || process.env.CZ_TEST_NO_WEBGL || forced) return false;
  if (clearedThisStart && !test) {
    if (webgl === "disabled_off") {
      await new Promise((r) => setTimeout(r, 5e3));
      st = app.getGPUFeatureStatus() ?? {};
    }
    if (webgl === "disabled_off" && st.webgl === "disabled_off") {
      log("graphics: WebGL is off at start although the GPU caches were just cleared - switching to software for the next start");
      webglFailed("the graphics process could not start (" + webgl + ")");
    } else log("graphics: WebGL " + (st.webgl ?? "unknown") + " right after the GPU caches were cleared - leaving it to the window check");
    return false;
  }
  const s = readSaved(),
    today = (s.autoClears ?? []).filter((t) => Date.now() - Date.parse(t) < DAY);
  if (today.length >= 2 && !test) {
    log("graphics: WebGL is off and the GPU caches were already cleared twice today - a restart of the computer may help");
    return false;
  }
  log("graphics: WebGL is off at start (the graphics process cannot start) - clearing the GPU caches and restarting");
  writeSaved({ ...s, clearCache: true, autoClears: [...today, new Date().toISOString()] });
  if (test) return false;
  writeStatus("switching", { to: active, why: "GPU caches" });
  restartApp();
  return true;
}
const nextMode = () => (active === "auto" && WIN ? "safe" : "software");
let rebuilt = false;
export function watchFirstPaint(win, log, rebuild, late = false) {
  if (forced) return;
  const proofOnly = active === "software";
  const fake = process.env.CZ_TEST_NO_PAINT === "1";
  const fakeScreen = process.env.CZ_TEST_SCREEN_BLANK === "1";
  const hidden = !!process.env.CZ_HIDDEN;
  let tries = 0,
    bad = 0,
    screenBad = 0;
  const whenFocused = () => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      win.removeListener("focus", go);
      void check();
    };
    win.once("focus", go);
    setTimeout(go, 3e4);
  };
  const whenShown = () => {
    let done = false;
    const go = () => {
      if (done || win.isDestroyed()) return;
      done = true;
      win.removeListener("restore", go);
      win.removeListener("show", go);
      setTimeout(check, 1500);
    };
    win.once("restore", go);
    win.once("show", go);
    setTimeout(go, 3e4);
  };
  const check = async () => {
    if (win.isDestroyed()) return;
    if (!win.isVisible() || win.isMinimized()) return whenShown();
    if (++tries > 75) return log("graphics: first-paint check gave up (window never in view)");
    const shown = win.isVisible() && !win.isMinimized(),
      focused = hidden || win.isFocused();
    if (!shown) {
      setTimeout(check, 4e3);
      return;
    }
    const own = fake
      ? "blank"
      : await Promise.race([
          win.webContents.capturePage().then(
            (img) => (isFlat(img) ? "blank" : "drawn"),
            () => "blank",
          ),
          new Promise((r) => setTimeout(() => r("no frame"), 8e3)),
        ]);
    if (win.isDestroyed()) return;
    if (own !== "drawn") {
      if (!focused && !(late && rebuild && !rebuilt)) {
        bad = 0;
        return whenFocused();
      }
      if (++bad < 2) {
        setTimeout(check, 4e3);
        return;
      }
      writeStatus("blank", { own });
      if (rebuild && !rebuilt && !fake) {
        rebuilt = true;
        log("graphics: the window stayed blank (" + own + ") - putting a new window in its place");
        if (rebuild()) return;
      }
      if (!focused) {
        bad = 0;
        return whenFocused();
      }
      if (proofOnly) return log("graphics: the window stayed blank (" + own + ") in software mode");
      const to = nextMode();
      log("graphics: the window stayed blank (" + own + ") in mode " + active + " - switching to " + to);
      webglFailed("the window stayed blank (" + own + ")", () => win, "blank", to);
      if (fake) return log("graphics: test - restart skipped");
      return restartApp();
    }
    const s = readSaved(),
      t1 = Date.now();
    const proven = s.good === active && s.goodVersion === VERSION && !unproven;
    const seenNow = !!s.seen && s.seenVersion === VERSION;
    const screen = fakeScreen ? "blank" : WIN && !proven && (!seenNow || !!s.auto) ? await onScreen(win) : "skipped";
    if (screen !== "skipped" && Date.now() - t1 > 1500) log("graphics: Windows' capture of the window took", Date.now() - t1, "ms");
    if (win.isDestroyed()) return;
    if (screen !== "blank") {
      if (screen === "drawn" || !WIN) {
        const s2 = readSaved();
        const gl = climbing ? await settledWebgl() : "";
        if (win.isDestroyed()) return;
        if (climbing && !/^enabled/.test(gl)) {
          log(
            "graphics: " + active + " shows after the update but gives no 3D (webgl " + gl + ") - back to " + (s2.climbFrom ?? "software"),
          );
          writeStatus("switching", { own, screen });
          webglFailed("no 3D (WebGL) after the update", () => win, "webgl", s2.climbFrom ?? "software");
          return;
        }
        if (climbing) resolveClimb("seen on screen");
        else if (s2.good !== active || s2.trial || s2.goodVersion !== VERSION)
          writeSaved({ ...s2, good: active, goodVersion: VERSION, trial: 0 });
      }
      writeStatus("drawn", { own, screen });
      return log("graphics: the window drew (first-paint check" + (WIN ? ", on screen: " + screen : "") + ")");
    }
    if (!focused) {
      screenBad = 0;
      return whenFocused();
    }
    if (++screenBad < 2) {
      setTimeout(check, 4e3);
      return;
    }
    writeStatus("blank", { own, screen });
    if (climbing) {
      log(
        "graphics: the window looks empty on screen in " + active + " after the update - back to " + (readSaved().climbFrom ?? "software"),
      );
      webglFailed("the window looked empty on screen after the update", () => win, "blank", readSaved().climbFrom ?? "software");
      if (fakeScreen) return log("graphics: test - restart skipped");
      return Date.now() - startedAt < 6e4 ? restartApp() : void 0;
    }
    if (proofOnly || seenNow) return log("graphics: the window looks empty on screen (mode " + active + ")");
    log("graphics: the app draws but the window looks empty on screen (mode " + active + ") - asking");
    writeStatus("asking", { own, screen });
    void askEmpty(win, log, "the window looks empty on screen");
  };
  setTimeout(check, 6e3);
}
async function settledWebgl() {
  await Promise.race([app.getGPUInfo("basic").catch(() => null), new Promise((r) => setTimeout(r, 1e4))]);
  const t = Date.now();
  let gl = String(app.getGPUFeatureStatus()?.webgl ?? "");
  while (!/^enabled/.test(gl) && Date.now() - t < 1e4) {
    await new Promise((r) => setTimeout(r, 250));
    gl = String(app.getGPUFeatureStatus()?.webgl ?? "");
  }
  return gl;
}
function resolveClimb(how) {
  const s = readSaved();
  glog("graphics: " + active + " works after the update (" + how + ") - keeping it instead of " + (s.climbFrom ?? "software"));
  writeSaved({
    ...s,
    auto: false,
    at: null,
    why: void 0,
    by: null,
    climbFrom: null,
    climbFails: 0,
    good: active,
    goodVersion: VERSION,
    trial: 0,
  });
  climbing = false;
}
async function onScreen(win) {
  try {
    const id = win.getMediaSourceId();
    const srcs = await Promise.race([
      desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 480, height: 300 }, fetchWindowIcons: false }),
      new Promise((r) => setTimeout(() => r(null), 8e3)),
    ]);
    const s = srcs?.find((x) => x.id === id);
    if (!s) return "unknown";
    return isFlat(s.thumbnail) ? "blank" : "drawn";
  } catch {
    return "unknown";
  }
}
let asking = false,
  asked = false;
async function askEmpty(win, log, why) {
  const s0 = readSaved();
  if (asking || asked || active === "software" || (s0.seen && s0.seenVersion === VERSION)) return;
  asking = true;
  const to = nextMode();
  const fakeAnswer = process.env.CZ_TEST_EMPTY_ANSWER;
  const { response } = fakeAnswer
    ? { response: fakeAnswer === "fix" ? 0 : 1 }
    : await dialog.showMessageBox({
        type: "question",
        title: "Videoxx",
        buttons: ["It's dark or empty - fix it", "I can see Videoxx"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: "Is the Videoxx window dark or empty?",
        detail:
          to === "safe"
            ? 'On some graphics cards the window stays dark although the app is running. "Fix it" restarts Videoxx in Safe display mode: your videos and 3D previews still run on your graphics card, at full speed. Your projects are not touched.'
            : 'On some graphics cards the window stays dark although the app is running. "Fix it" restarts Videoxx in Software graphics mode: it always shows, but 3D previews and exports are slower. You can switch back in Settings > System > Graphics. Your projects are not touched.',
      });
  asking = false;
  asked = true;
  if (response !== 0) {
    log("graphics: the member can see the window - not asking again on this computer for this version");
    writeSaved({ ...readSaved(), seen: true, seenVersion: VERSION, good: active, goodVersion: VERSION, trial: 0 });
    if (climbing) resolveClimb("the member can see it");
    writeStatus("drawn", { member: "seen" });
    return;
  }
  log("graphics: the member says the window is empty (" + why + ") - switching to " + to);
  webglFailed("the window was empty (" + why + ")", () => win, "blank", to);
  if (fakeAnswer) return log("graphics: test - restart skipped");
  restartApp();
}
export function askOnRelaunch(win, log) {
  const s = readSaved();
  if (!WIN || active === "software" || forced || asked || (s.seen && s.seenVersion === VERSION) || Date.now() - startedAt > 10 * 6e4)
    return false;
  void askEmpty(win, log, "started again while open");
  return true;
}
function isFlat(img) {
  if (img.isEmpty()) return true;
  const b = img.toBitmap(),
    n = b.length >> 2;
  if (!n) return true;
  const step = Math.max(1, Math.floor(n / 2e4));
  let same = 0,
    total = 0;
  for (let i = 0; i < n; i += step) {
    const o = i << 2;
    total++;
    if (Math.abs(b[o] - b[0]) <= 8 && Math.abs(b[o + 1] - b[1]) <= 8 && Math.abs(b[o + 2] - b[2]) <= 8) same++;
  }
  return same / total > 0.998;
}
export function restartApp() {
  if (restarting) return;
  restarting = true;
  app.relaunch({ args: process.argv.slice(1).filter((a) => !/^--(safe|software)-graphics$/.test(a) && !a.startsWith("--graphics-mode=")) });
  app.quit();
}
export const WEBGL_FAIL = /WebGL context|WebGL is not (supported|available)|could not create a WebGL|webgl.*(unavailable|disabled)/i;
export function webglAdvice(software, mac = typeof process !== "undefined" && process.platform === "darwin") {
  if (software)
    return `Your computer could not start the 3D preview, even with software graphics. ${mac ? "Update macOS" : "Update Windows and your graphics driver"}, restart the computer, then open the app again.`;
  return "Your computer's graphics could not start the 3D preview. Switch to software graphics (slower, but works on unsupported graphics): Settings > System > Graphics > Software, then restart the app.";
}
