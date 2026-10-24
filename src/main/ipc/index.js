import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import { BrowserWindow, ClipboardItem, Notification, app, clipboard, dialog, ipcMain, nativeImage, shell } from "electron";
import { fileURLToPath } from "node:url";
import { getConfig, setConfig } from "../core/config";
import { ws } from "../core/workspace";
import { log, logPath } from "../core/log";
import { dbHealth, now, q, uid } from "../db/db";
import { pathInfo, pathProblemText, safeExecFile } from "../core/shellPath";
import {
  NO_CLAUDE,
  authStatus,
  claudeCandidates,
  claudeExecutable,
  lastStatus,
  login,
  loginCode,
  logout,
  versionInPath,
} from "../engines/claudeCli";
import { INSTALL, forgetMacStubs, isMacStub } from "../core/install";
import { CARRIED, allStyles, baseOf, getStyle, isMine, needsImageKey, qualityBarOf } from "../styles/catalog";
import { deletePreset, getPreset, listPresets, savePreset, validateSettings, writeSettings } from "../styles/presets";
import {
  afterLabTask,
  characterFile,
  charsRoot,
  deleteCharacter,
  listCharacters,
  randomCharacter,
  renameCharacter,
  setDefaultCharacter,
  setLabBusyCheck,
  startDesign,
} from "../characters/characterLab";
import { libraryFigures, useLibraryFigure } from "../characters/libraryFigures";
import { ANIM_EXT, animDirs, importAnims, listAnims, onAnims, removeAnim, startAnimWatch } from "../characters/anims";
import {
  charBones,
  charSheet,
  chars3dDir,
  listChars,
  onChars3d,
  removeChar,
  renameChar,
  setCharMapping,
  uploadChar,
} from "../characters/chars3d";
import { openExternal, openedSoFar } from "../core/openExternal";
import {
  cancelLogin,
  cliproxyState,
  disableGoogle,
  enableGoogle,
  googleModels,
  loginGoogle,
  onCliproxy,
  removeGoogle,
  retryGoogle,
  switchGoogle,
  testCliproxy,
} from "../engines/cliproxy";
import {
  cancelCodexLogin,
  codexCandidates,
  codexEnv,
  codexExecutable,
  codexLogin,
  codexLogout,
  codexState,
  ensureSandboxProbe,
  installCodex,
  onCodex,
  openCodexLoginPage,
  probeKey,
  realCodex,
  refreshCodex,
  sandboxProbe,
  setCodexPath,
  setFakeCodexState,
} from "../engines/codexCli";
import { describeMapped } from "../engines/codexMapper";
import { keyStatus as keyStatus$3 } from "../images/higgsfield";
import { keyStatus as keyStatus$2 } from "../images/fal";
import { setImageCacheForTest } from "../images/imageCache";
import { makeImage } from "../images/makeImage";
import {
  cancelCustomSetup,
  customState,
  onCustomState,
  readSetup,
  removeCustom,
  startCustomSetup,
  testInstall,
} from "../images/customProviders";
import { applyChoices, checkChoices, overridesOf, setOverrides, soundOf } from "../images/overrides";
import { flowReady } from "../images/flow";
import { activeProvider, defaultImageModel, globalImageModels, globalProviderSetting, providerStatus } from "../images/providers";
import {
  deletePackage,
  deleteStudioLook,
  installPackageVersion,
  loadPackages,
  loadStudioLooks,
  packageVersions,
  restoreMissingPackages,
  restorePackageFromProject,
  restorePrevious,
  studioLookPreview,
} from "../styles/packages";
import { withFormat } from "../styles/lookFormat";
import { changedFiles, diff, forgetGit, gitAvailable, log as log$1, rehash, snapshot } from "../core/gitSnapshots";
import { lang, langCode } from "../styles/languages";
import { MUSIC_EXT, addMusic, musicOf, setMusic } from "../audio/music";
import { readCuts, remapTimings, setTrim, trimOf, trimView } from "../audio/trim";
import { SFX_EXT, importFiles, importFolder, removeEntry, rescan, sfxAudio, sfxEntry, sfxList, updateEntry, watchSfx } from "../audio/sfx";
import { addClip, layersOf, remapLayers, saveLayers, wordsOf } from "../audio/layers";
import { scriptsHealth } from "../pipeline/pipelineScripts";
import {
  cancelStep,
  installPython,
  missingPython,
  projectLanguage,
  remix,
  runStep,
  stepKind,
  stepsRunning,
  waveform,
} from "../pipeline/steps";
import { graphicsState, restartApp, setGraphicsKeep, setGraphicsMode, webglFailed } from "../app/graphicsMode";
import { closeWorker, hostState, layoutCheck, markDirty, renderStills, setWorkerPool, sweepErrors } from "../render/workers";
import { cancelExport, exportUsing, exportVideo, exportsRunning } from "../render/exportVideo";
import { coverFile, ensureCovers, previewSettings, saveFrame, thumbnail } from "../render/covers";
import { addIssue, onIssuesWritten, readIssues, updateIssue } from "../projects/issues";
import {
  getStudio,
  kitElements,
  markKit,
  matchSettingsOf,
  notifyStudio,
  onStudioChanged,
  requireStudio,
  setStage,
  setView,
  writeStudio,
} from "../studio/stages";
import { LIB_SCOPE_RX, LIB_STATUSES } from "../library/schema";
import { libraryFts, onLibraryChanged, rebuildIndex, refreshIndex, setFtsForTest } from "../library/index";
import { libraryEntry, listLibrary, searchLibrary } from "../library/search";
import { createWorkspace } from "../studio/workspace";
import { settingsFor } from "../studio/runChecks";
import { patchWsEntry } from "../library/store";
import {
  importOwnSkill,
  importScriptSkill,
  ownSkill,
  pasteOwnSkill,
  pasteScriptSkill,
  projectsWithCopy,
  removeScriptSkill,
  scriptSkillState,
  setScriptSkillOn,
} from "../projects/scriptSkill";
import {
  STRUCTURE,
  createCharacterLab,
  createProject,
  deleteProject,
  duplicateProject,
  engineVersion,
  ensureSkill,
  exportZip,
  getProject,
  importProject,
  importZip,
  listProjects,
  projectStatus,
  renameProject,
  setLanguage,
  styleVersions,
  touchProject,
  upgradeEngine,
} from "../projects/projects";
import { writeContext, writeStyleFiles } from "../agent/projectContext";
import { addTarget, generateQuote, generateTargets, listTargets, removeTarget, updateTarget } from "../studio/targets";
import { harvestCandidates, lessonsChanged, lookToLibrary, syncStudioLessons } from "../library/harvest";
import { forClaude, onFrames, onImageBlock, onRuleSuggestion, setSelection, setShots, suiteToolDefs } from "../agent/tools/suiteTools";
import { bridgeInfo, setActiveProject, startBridge, stopBridge } from "../agent/tools/bridge";
import { codexClient, hideSpawn, spawnSeen, stopped, testFakeCodex, treeKills } from "../engines/runCodex";
import { setUsagePlan, testUsage, usageSummary } from "../agent/usage";
import { cancelProject } from "../personal/proxies";
import { afterCall, checkCall, planInfo, testSetPlan } from "../app/plan";
import { adoptNewProject, checkChannel, rememberNewProject } from "../channels/channels";
import { runStudy, studyBusy, studyStale, studyView } from "../studio/study";
import { HARVEST_AFTER, harvestFor, harvestState, lastHarvest, onHarvestEvent, queueHarvest, setHarvestRunner } from "../studio/harvest";
import {
  answerPermission,
  contextUsage,
  editCompare,
  getEdit,
  insideDir,
  isProjectBusy,
  isProjectBusyAny,
  isThreadBusy,
  listEdits,
  listThreads,
  projectClaude,
  projectThread,
  readOutsideCheck,
  reapplyEdit,
  reframePrompt,
  restoreBefore,
  revertEdit,
  runTask,
  runningTasks,
  setAudioBusyCheck,
  setProjectClaude,
  stopTask,
  testClaudeTurns,
  testEditTools,
  testFakeClaude,
  testFakeRunning,
  testLibraryPrompt,
  testTaskPrompt,
  testUltraPrompt,
  testUsageLimits,
  threadMessages,
} from "../agent/sessions";
import {
  autoSpeechSetup,
  cancelSpeechSetup,
  findTranscriber,
  onSpeechState,
  speechChanged,
  speechState,
  startSpeechSetup,
  startStableTs,
  testAccept,
  testPrompt,
} from "../voice/speechSetup";
import {
  REF_EXTENSIONS,
  addRefs,
  cancelRef,
  extractRef,
  listRefs,
  mediaRef,
  onReferences,
  probeRef,
  referencesBlock,
  relinkRef,
  removeRef,
  stripRef,
  thumbRef,
  updateRef,
} from "../projects/references";
import {
  browseLibrary,
  deleteEntry,
  emptyTrash,
  entryFileText,
  libraryDetail,
  proposedCount,
  restoreEntry,
  revealEntry,
  shipEntry,
  trashInfo,
} from "../library/browse";
import { closeStreamsUnder, forgetProject, projectUrl, serverUrl } from "../projects/fileServer";
import { unwatchProject, watchProject } from "../projects/watcher";
import { deleteGfxPreset, listGfxPresets, saveGfxPreset, saveProjectGraphics } from "../styles/gfxPresets";
import { askHelp, captureWindow, clean, createReport, draftReport, helpFeedback, listReports, searchKb, supportContext } from "../app/help";
import { describeToonChar, listToonChars, removeToonChar, saveToonChar } from "../characters/toonChars";
import { learnFromEdits, learnModel } from "../app/learnFromEdits";
import { applyZoom } from "../app/zoom";
import { canNotify, checkForUpdates, installNow, setBetaUpdates, updateStatus } from "../app/updater";
import { personalThumb, registerPersonalIpc } from "./personalIpc";
import { registerBoardsIpc } from "./boardsIpc";
import { STYLES_MOVED } from "../studio/import/styleImport";
import { registerStyleImportIpc } from "./styleImportIpc";
import { registerChannelsIpc } from "./channelsIpc";
import { registerYoutubeIpc } from "./youtubeIpc";
import { fishKeyStatus } from "../voice/fish";
import { cancelVoiceover, jobOf, stepSucceeded, sweepIncoming } from "../voice/voiceover";
import { grantPaths, isGranted } from "../voice/recordings";
import { keyStatus } from "../voice/elevenlabs";
import { kokoroFiles } from "../voice/kokoro";
import { registerVoiceIpc } from "./voiceIpc";
import { withPainter } from "../render/painter";
import {
  REFRAME_TASK,
  afterReframeTask,
  endCardPreview,
  exportVertical,
  makeReframe,
  reframeOf,
  reframeState,
  setLogo,
  verticalFrames,
  verticalInfo,
  verticalShots,
} from "../render/vertical";
import { deleteCustomStyle, loadCustomStyles, restoreMissingStyles, restoreStyleFromProject } from "../styles/customStyles";
import { routinesRunning } from "../routines/routines";
import { registerRoutinesIpc } from "./routinesIpc";
import { checkNow, compare, ensureMatch, listVersions, newVersion, rollback, studioSettled } from "../studio/versions";
import { afterTurn, forgetRun, noteRun } from "../studio/afterTurn";
import { notePublishHarvest, publishBusy, publishState, publishStyle } from "../studio/publish";
import { saveLook } from "../studio/saveLook";
import {
  STUDIO_JOB_BUSY,
  criticOnce,
  loopState,
  loopTaskDone,
  onLoopEnd,
  setLoopRunner,
  startLoop,
  stopLoop,
  studioJobBusy,
} from "../studio/criticLoop";

export function isAppUrl(url) {
  if (process.env.ELECTRON_RENDERER_URL) return url.startsWith(process.env.ELECTRON_RENDERER_URL);
  try {
    return new URL(url).protocol === "file:" && path.resolve(fileURLToPath(url)) === path.resolve(__dirname, "../renderer/index.html");
  } catch {
    return false;
  }
}
function vscodeExe() {
  const c =
    process.platform === "win32"
      ? [
          path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
          path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft VS Code", "Code.exe"),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", "/usr/local/bin/code"]
        : ["/usr/bin/code", "/snap/bin/code"];
  return c.find((f) => f && fs.existsSync(f)) ?? null;
}
export function registerIpc(getWin) {
  const send = (ch, payload) => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
  };
  const h = (ch, fn) =>
    ipcMain.handle(ch, async (e, ...a) => {
      const w = getWin();
      if (!w || e.sender !== w.webContents || e.senderFrame !== w.webContents.mainFrame || !isAppUrl(e.senderFrame?.url ?? ""))
        throw new Error("IPC from an untrusted frame");
      try {
        checkCall(ch, a);
        const r = await fn(...a);
        afterCall(ch, a, r);
        return r;
      } catch (e2) {
        log("ipc error", ch, e2?.stack || e2?.message || String(e2));
        throw new Error(e2?.message || String(e2));
      }
    });
  onRuleSuggestion((r) => send("rules:suggested", r));
  registerPersonalIpc(h, send);
  registerBoardsIpc(h, send, getWin);
  registerStyleImportIpc(h, send, getWin, () => {
    const r = nextPick;
    nextPick = null;
    return r;
  });
  registerChannelsIpc(h, send);
  registerYoutubeIpc(h, send);
  registerVoiceIpc(h, send, {
    dirOf: (id) => getProject(id).path,
    changed: (id) => {
      markDirty(id);
      writeContext(id);
    },
    busy: isProjectBusy,
  });
  setAudioBusyCheck((id, dir) => {
    const step = stepKind(dir),
      voicing = jobOf(id)?.status === "running";
    if (voicing || step === "voice")
      return "A voiceover is being made for this project. Ask Claude when it is finished (or press Stop in the Voiceover window): it replaces the narration and the timing Claude builds to.";
    if (step === "clean" || step === "timeline")
      return `${step === "clean" ? "The audio is being cleaned" : "The words are being timed"} for this project. Ask Claude when it is finished: it changes the timing Claude builds to.`;
    return null;
  });
  onFrames((f) => send("claude:frames", f));
  onStudioChanged((projectId) => send("studio:changed", { projectId }));
  onImageBlock((b) => send("images:blocked", b));
  h("app:info", () => ({
    version: app.getVersion(),
    preview: !!process.env.CZ_PREVIEW,
    testHooks: process.env.CZ_TEST_HOOKS === "1",
    workspace: ws.root(),
    server: serverUrl(),
    platform: process.platform,
    bridge: bridgeInfo(),
    structure: STRUCTURE,
    log: logPath(),
  }));
  h("config:get", () => getConfig());
  h("graphics:state", () => graphicsState());
  h("graphics:set", (mode) => setGraphicsMode(mode));
  h("graphics:failed", (where) => webglFailed(String(where || "the app").slice(0, 200), getWin));
  h("graphics:restart", () => {
    setTimeout(restartApp, 150);
    return true;
  });
  h("graphics:keep", (keep) => setGraphicsKeep(!!keep));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:restoreWindow", () => {
      const w = getWin();
      if (w && !w.isDestroyed() && w.isMinimized()) w.restore();
      return true;
    });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:crashWindow", () => {
      setTimeout(() => {
        const w = getWin();
        if (w && !w.isDestroyed()) w.webContents.forcefullyCrashRenderer();
      }, 300);
      return true;
    });
  if (process.env.CZ_TEST_HOOKS === "1") h("plan:testSet", (p, used) => testSetPlan(p === "standard" ? "standard" : "premium", used));
  h("plan:get", () => planInfo());
  h("update:status", () => updateStatus());
  h("update:check", () => checkForUpdates());
  h("update:install", () => {
    const busy22 = runningTasks().some((t) => t.kind !== "harvest")
      ? "Claude is still working"
      : routinesRunning()
        ? "A routine is still running"
        : exportsRunning()
          ? "An export is still running"
          : stepsRunning()
            ? "An audio step is still running"
            : "";
    if (busy22) throw new Error(`${busy22}. The update installs when you close the app, or restart once it is done.`);
    return installNow();
  });
  h("app:zoom", (z) => {
    const w = getWin();
    return w ? (typeof z === "number" ? applyZoom(w, z) : w.webContents.getZoomFactor()) : 1;
  });
  h("app:copy", async (text) => {
    await clipboard.writeText(String(text));
    return true;
  });
  h("app:copyImage", async (file) => {
    if (!/\.(png|jpe?g)$/i.test(file) || !fs.existsSync(file)) throw new Error("No image to copy.");
    const png = /\.png$/i.test(file) ? fs.readFileSync(file) : nativeImage.createFromPath(file).toPNG();
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
    return true;
  });
  h("app:diagnostics", async () => {
    const NL = String.fromCharCode(10);
    const tail = (() => {
      try {
        return fs.readFileSync(logPath(), "utf8").split(NL).slice(-60).join(NL);
      } catch {
        return "(no log)";
      }
    })();
    const c = getConfig();
    return [
      `Videoxx ${app.getVersion()} · update ${JSON.stringify(updateStatus())} · ${process.platform} ${process.arch} · Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · Node ${process.versions.node}`,
      `Workspace: ${ws.root()}`,
      `Claude: ${JSON.stringify(lastStatus() ?? (await authStatus()))}`,
      `Executable: ${claudeExecutable()}`,
      `Config: ${JSON.stringify({ claude: c.claude, bridge: c.bridge, tools: c.tools })}`,
      `Bridge: ${JSON.stringify(bridgeInfo())}`,
      `DB: ${JSON.stringify(dbHealth())}`,
      "--- log (last 60 lines) ---",
      tail,
    ].join(NL);
  });
  h("config:set", async (patch) => {
    if (patch && typeof patch === "object") {
      delete patch.experimental;
      delete patch.engines;
    }
    const before = getConfig();
    const c = setConfig(patch);
    if (patch.bridge && (patch.bridge.port !== void 0 || patch.bridge.enabled !== void 0)) {
      stopBridge();
      if (c.bridge.enabled) await startBridge();
    }
    if (patch.workspace && patch.workspace !== before.workspace) {
    }
    if (patch.updates && patch.updates.beta !== before.updates.beta) setBetaUpdates(c.updates.beta);
    if (patch.tools) speechChanged();
    return c;
  });
  h("shell:open", (p) => {
    const f = path.resolve(String(p)),
      roots = [ws.root(), ...listProjects().map((x) => x.path), path.dirname(logPath())];
    if (!roots.some((r) => insideDir(r, f))) throw new Error("That file is not part of the workspace.");
    if (!fs.existsSync(f)) throw new Error(`It is not there any more (moved or deleted?): ${f}`);
    if (!fs.statSync(f).isDirectory() && !/\.(mp4|mov|webm|gif|png|jpe?g|wav|mp3|m4a|srt|md|txt|json|log|zip)$/i.test(f))
      throw new Error("Only folders, media and text files can be opened from here.");
    return shell.openPath(f);
  });
  h("shell:reveal", (p) => shell.showItemInFolder(p));
  h("shell:source", (projectId, rel, line) => {
    const root = getProject(projectId).path,
      f = path.resolve(root, rel);
    if (!f.startsWith(root + path.sep) || !fs.existsSync(f)) throw new Error("File not found in the project.");
    const ln = Math.max(1, Math.floor(Number(line) || 1));
    const code = vscodeExe();
    if (!code) {
      shell.showItemInFolder(f);
      return "folder";
    }
    const p = cp.spawn(code, ["-g", `${f}:${ln}`], { detached: true, stdio: "ignore", windowsHide: true });
    p.on("error", () => shell.showItemInFolder(f));
    p.unref();
    return "vscode";
  });
  if (process.env.CZ_TEST_HOOKS === "1") h("test:opened", () => openedSoFar());
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:stuckQuit", () => {
      const w = new BrowserWindow({ show: false });
      w.on("close", (e) => e.preventDefault());
      setTimeout(() => {
        log("test: quit with a window that will not close");
        app.quit();
      }, 300);
      return true;
    });
  h("shell:external", (url) => (/^https?:\/\//.test(url) ? openExternal(url) : null));
  let nextPick = null;
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:nextPick", (paths) => {
      nextPick = Array.isArray(paths) ? paths.map(String) : null;
    });
  h("dialog:file", async (opts) => {
    if (nextPick) {
      const r2 = nextPick;
      nextPick = null;
      grantPaths(r2);
      return opts?.multiple ? r2 : (r2[0] ?? null);
    }
    const r = await dialog.showOpenDialog(getWin(), {
      title: opts?.title,
      properties: opts?.multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: opts?.filters,
    });
    if (!r.canceled) grantPaths(r.filePaths);
    return r.canceled ? null : opts?.multiple ? r.filePaths : r.filePaths[0];
  });
  ipcMain.on("files:dropped", (e, p) => {
    if (e.sender === getWin()?.webContents) grantPaths(p);
  });
  h("dialog:folder", async (opts) => {
    const r = await dialog.showOpenDialog(getWin(), { title: opts?.title, properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });
  onAnims({ changed: () => send("anims:changed", {}), progress: (p) => send("anims:progress", p) });
  try {
    startAnimWatch();
  } catch (e) {
    log("anims: inbox watch", e?.message);
  }
  h("anims:list", () => listAnims());
  h("anims:import", async (files) => {
    let list = Array.isArray(files) ? files.map(String) : null;
    if (!list) {
      if (nextPick) {
        list = nextPick;
        nextPick = null;
      } else {
        const r = await dialog.showOpenDialog(getWin(), {
          title: "Import character animations",
          message: "Pick FBX files (Mixamo) or GLB / GLTF animations",
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "Animations", extensions: ["fbx", "glb", "gltf"] }],
        });
        list = r.canceled ? [] : r.filePaths;
      }
    }
    return importAnims(list.filter((f) => ANIM_EXT.test(f)));
  });
  h("anims:remove", (id) => removeAnim(String(id)));
  h("anims:folder", (open) => {
    const d = animDirs();
    fs.mkdirSync(d.inbox, { recursive: true });
    if (open !== false) shell.openPath(d.user);
    return { dir: d.user, inbox: d.inbox };
  });
  onChars3d({ changed: () => send("chars:changed", {}), progress: (p) => send("chars:progress", p) });
  h("chars:list", () => ({ dir: chars3dDir(), characters: listChars() }));
  h("toonchars:list", () => listToonChars());
  h("toonchars:save", (c) => saveToonChar(c));
  h("toonchars:remove", (id) => removeToonChar(String(id)));
  h("toonchars:describe", (text) => describeToonChar(String(text ?? "")));
  h("chars:upload", async (file, o) => {
    let f = typeof file === "string" && file ? file : null;
    if (!f) {
      if (nextPick) {
        f = nextPick[0] ?? null;
        nextPick = null;
      } else {
        const r = await dialog.showOpenDialog(getWin(), {
          title: "Upload a character",
          message: "Pick a rigged humanoid: FBX, GLB, GLTF or VRM",
          properties: ["openFile"],
          filters: [{ name: "Characters", extensions: ["fbx", "glb", "gltf", "vrm"] }],
        });
        f = r.canceled ? null : r.filePaths[0];
      }
    }
    if (!f) return null;
    return uploadChar(f, { name: o?.name, licence: o?.licence });
  });
  h("chars:remove", (id) => removeChar(String(id)));
  h("chars:sheet", (id) => charSheet(String(id)));
  h("chars:bones", (id) => charBones(String(id)));
  h("chars:setMapping", (id, map) => setCharMapping(String(id), map));
  h("chars:rename", (id, o) => renameChar(String(id), o || {}));
  onReferences({ changed: (projectId) => send("references:changed", { projectId }), progress: (p) => send("references:progress", p) });
  const REF_FILTERS = [
    {
      name: "Pictures, videos, sounds, PDFs, 3D models",
      extensions: [
        ...REF_EXTENSIONS.image,
        ...REF_EXTENSIONS.video,
        ...REF_EXTENSIONS.audio,
        ...REF_EXTENSIONS.pdf,
        ...REF_EXTENSIONS.model,
      ],
    },
    { name: "Pictures", extensions: REF_EXTENSIONS.image },
    { name: "Videos", extensions: REF_EXTENSIONS.video },
    { name: "Sounds", extensions: REF_EXTENSIONS.audio },
    { name: "PDF", extensions: ["pdf"] },
    {
      name: "3D models (.glb .gltf .fbx .obj .dae .stl .ply .3mf .zip)",
      extensions: [...REF_EXTENSIONS.model, "bin", "mtl", "png", "jpg", "jpeg", "tga"],
    },
  ];
  h("references:pick", async (projectId) => {
    let files;
    if (nextPick) {
      files = nextPick;
      nextPick = null;
    } else {
      const r = await dialog.showOpenDialog(getWin(), {
        title: "Add references",
        properties: ["openFile", "multiSelections"],
        filters: REF_FILTERS,
      });
      if (r.canceled) return [];
      files = r.filePaths;
    }
    return addRefs(projectId, files);
  });
  h("references:add", (projectId, paths, opts) =>
    addRefs(projectId, Array.isArray(paths) ? paths.map(String) : [], { folders: !!opts?.folders }),
  );
  h("references:list", (projectId) => listRefs(projectId));
  h("references:remove", (projectId, refId) => removeRef(projectId, String(refId)));
  h("references:update", (projectId, refId, patch) => updateRef(projectId, String(refId), patch ?? {}));
  h("references:relink", (projectId, refId, newPath) => relinkRef(projectId, String(refId), String(newPath)));
  h("references:probe", (file) => probeRef(String(file)));
  h("references:thumb", async (projectId, refId, t, w) => ({
    url: (await thumbRef(projectId, String(refId), Number(t) || 0, Number(w) || 320)).url,
  }));
  h("references:strip", async (projectId, refId, n) => {
    const s = await stripRef(projectId, String(refId), Number(n) || 24);
    return { url: s.url, times: s.times, tileW: s.tileW, tileH: s.tileH, n: s.n };
  });
  h("references:media", (projectId, refId) => mediaRef(projectId, String(refId)));
  h("references:extract", (projectId, refId, range, opts) =>
    extractRef(
      projectId,
      String(refId),
      typeof range === "string" || range == null ? range : { start: Number(range.start), end: Number(range.end) },
      { count: opts?.count, transcript: !!opts?.transcript, clip: !!opts?.clip },
    ),
  );
  h("references:cancel", (projectId, refId) => cancelRef(projectId, refId ? String(refId) : void 0));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:refPrompt", async (projectId, instruction) => {
      const project = getProject(projectId);
      return { block: await referencesBlock(projectId, String(instruction)), dir: project.path };
    });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:refRead", (projectId, files) => files.map((f) => ({ file: f, why: readOutsideCheck(getProject(projectId).path, String(f)) })));
  const resyncSkill = (s) => {
    for (const p of projectsWithCopy(listProjects()))
      if (!isProjectBusy(p.id))
        try {
          writeContext(p.id);
        } catch (e) {
          log("scripting skill resync failed", e.message);
        }
    return s;
  };
  h("scriptskill:state", () => scriptSkillState());
  const pickSkillSource = async (what) => {
    if (nextPick) {
      const src = nextPick[0] ?? null;
      nextPick = null;
      return src;
    }
    const r = await dialog.showOpenDialog(
      getWin(),
      what === "folder"
        ? {
            title: "Pick your skill folder (the one with SKILL.md)",
            message: "Pick your skill folder (the one with SKILL.md)",
            properties: ["openDirectory"],
          }
        : {
            title: "Pick your scripting skill",
            message: "Pick your scripting skill: a SKILL.md, another .md file or a .txt file",
            properties: ["openFile"],
            filters: [{ name: "Skill or instructions", extensions: ["md", "markdown", "txt"] }],
          },
    );
    return r.canceled ? null : (r.filePaths[0] ?? null);
  };
  h("scriptskill:pick", async (what) =>
    resyncSkill(
      await (async () => {
        const src = await pickSkillSource(what);
        return src ? importScriptSkill(src) : scriptSkillState();
      })(),
    ),
  );
  h("scriptskill:ownPick", async (what) => {
    const src = await pickSkillSource(what);
    return src ? importOwnSkill(src) : null;
  });
  h("scriptskill:ownPaste", (text, name) => pasteOwnSkill(String(text ?? ""), name ? String(name) : void 0));
  h("scriptskill:ownGet", (id) => ownSkill(String(id ?? "")));
  h("scriptskill:paste", (text, name) => resyncSkill(pasteScriptSkill(String(text ?? ""), name ? String(name) : void 0)));
  h("scriptskill:set", (on) => resyncSkill(setScriptSkillOn(!!on)));
  h("scriptskill:remove", () => resyncSkill(removeScriptSkill()));
  h("health", async () => {
    forgetMacStubs();
    forgetGit();
    const which = (cmd, args) =>
      isMacStub(cmd)
        ? Promise.resolve(null)
        : new Promise((res) =>
            safeExecFile(cmd, args, { windowsHide: true, timeout: 8e3 }, (e, o, se) =>
              res(
                e
                  ? null
                  : String(o || se)
                      .trim()
                      .split("\n")[0],
              ),
            ),
          );
    const t = getConfig().tools;
    const [git, ffmpeg, python, node] = await Promise.all([
      which(t.git, ["--version"]),
      which(t.ffmpeg, ["-version"]),
      which(t.python, ["--version"]),
      which(process.platform === "win32" ? "node.exe" : "node", ["--version"]),
    ]);
    let db;
    try {
      db = dbHealth();
    } catch (e) {
      db = { ok: false, error: e.message };
    }
    const pyMissing = python ? await missingPython() : null;
    return {
      db,
      git,
      ffmpeg: ffmpeg?.replace(/ Copyright.*/, "") ?? null,
      python,
      node,
      pyMissing,
      speech: findTranscriber()?.label ?? null,
      claude: lastStatus() ?? (await authStatus()),
      executable: claudeExecutable(),
      server: serverUrl(),
      bridge: bridgeInfo(),
      workspace: ws.root(),
      install: INSTALL,
      pathInfo: process.platform === "win32" ? null : { ...pathInfo, path: process.env.PATH },
      pathProblem: pathProblemText(pathInfo.skipped ?? []) || null,
      scripts: scriptsHealth(),
    };
  });
  h("tools:installPython", (pkgs) => installPython(pkgs, (line) => send("pipeline:log", { projectId: "", step: "setup", line })));
  h("projects:list", () => {
    const list = listProjects();
    ensureCovers(
      list.filter((p) => p.kind !== "personal"),
      (id) => send("projects:covers", { projectId: id }),
    );
    return list.map((p) => ({ ...p, thumb: p.kind === "personal" ? personalThumb(p.id) : facelessThumb(p.id, p.path) }));
  });
  h("projects:create", async (o) => {
    if (o.character?.describe && !claudeExecutable()) throw new Error(NO_CLAUDE);
    const channelId = checkChannel(o.channelId);
    const choices = checkChoices(o.choices);
    const made = await createProject(o);
    if (applyChoices(made.id, choices)) writeContext(made.id);
    adoptNewProject(made.id, { channelId, ideaId: o.ideaId });
    rememberNewProject(channelId, { styleId: made.style_id, presetId: made.preset_id, length: o.length });
    if (channelId || o.ideaId) send("channels:changed", { what: "board" });
    const p = getProject(made.id);
    if (o.character?.describe && baseOf(p.style_id) === "flat") {
      try {
        const d = await designCharacter(String(o.character.describe));
        const f = path.join(p.path, "project.json"),
          pj = JSON.parse(fs.readFileSync(f, "utf8"));
        pj.character = { id: d.character.id, name: d.character.name, pending: true };
        fs.writeFileSync(f, JSON.stringify(pj, null, 1));
        fs.copyFileSync(characterFile(d.character.id), path.join(p.path, "character.js"));
        writeContext(p.id);
      } catch (e) {
        log("character design did not start", e.message);
        return { ...p, characterError: String(e.message || e) };
      }
    }
    return p;
  });
  h("projects:setMeta", (id, meta) => {
    if (typeof meta.scriptSkill === "boolean") {
      if (isProjectBusy(id))
        throw new Error("Claude is working on this video. Change this when it has finished (or press Stop in the Claude panel).");
      const f2 = path.join(getProject(id).path, "project.json"),
        pj2 = JSON.parse(fs.readFileSync(f2, "utf8"));
      if (meta.scriptSkill) delete pj2.scriptSkill;
      else pj2.scriptSkill = false;
      fs.writeFileSync(f2, JSON.stringify(pj2, null, 1));
      writeContext(id);
    }
    if (meta.language !== void 0) {
      const dir = getProject(id).path,
        step = stepKind(dir),
        from = projectLanguage(dir);
      if ((langCode(meta.language) ?? meta.language) !== from) {
        if (jobOf(id)?.status === "running" || step === "voice")
          throw new Error(
            `A voiceover is being made for this video in ${lang(from).name}. Change its language when it has finished (or press Stop in the Voiceover window).`,
          );
        if (step === "clean" || step === "timeline")
          throw new Error(
            `${step === "clean" ? "The audio is being cleaned" : "The words are being timed"} in ${lang(from).name}. Change the language when it has finished.`,
          );
        if (isProjectBusy(id))
          throw new Error("Claude is working on this video. Change its language when it has finished (or press Stop in the Claude panel).");
      }
      setLanguage(id, String(meta.language));
    }
    const f = path.join(getProject(id).path, "project.json"),
      pj = JSON.parse(fs.readFileSync(f, "utf8"));
    if (typeof meta.topic === "string") pj.topic = meta.topic.trim();
    if (meta.targetLength && meta.targetLength > 10) pj.targetLength = Math.round(meta.targetLength);
    fs.writeFileSync(f, JSON.stringify(pj, null, 1));
    return projectStatus(id);
  });
  const withStyle = (p) => {
    try {
      if (restoreStyleFromProject(p.path)) {
        q.run("UPDATE projects SET preset_id=? WHERE id=?", `${p.style_id}-default`, p.id);
        writeContext(p.id);
      }
    } catch (e) {
      log("restore style failed", e.message);
    }
    return getProject(p.id);
  };
  const intoChannel = (p, channelId) => {
    const ch = checkChannel(channelId);
    if (ch && !p.channel_id) {
      adoptNewProject(p.id, { channelId: ch });
      return getProject(p.id);
    }
    return p;
  };
  h("projects:import", async (dir, channelId) => intoChannel(withStyle(await importProject(dir)), channelId));
  h("projects:rename", (id, name) => renameProject(id, name));
  h("projects:duplicate", (id) => duplicateProject(id));
  h("projects:exportZip", async (id) => {
    const p = getProject(id);
    const r = await dialog.showSaveDialog(getWin(), {
      title: "Share project as .zip",
      defaultPath: path.join(app.getPath("documents"), `${p.slug}.zip`),
      filters: [{ name: "Zip", extensions: ["zip"] }],
    });
    return r.canceled || !r.filePath ? null : exportZip(id, r.filePath);
  });
  h("projects:exportZipTo", (id, dest) => {
    if (!/\.zip$/i.test(dest) || (fs.existsSync(dest) && !fs.statSync(dest).isFile()))
      throw new Error("The destination must be a .zip file.");
    return exportZip(id, dest);
  });
  h("projects:importZip", async (zip, channelId) => intoChannel(withStyle(await importZip(zip)), channelId));
  h("projects:delete", async (id, removeFiles) => {
    if (isProjectBusy(id)) throw new Error("Claude is working on this project. Stop it first, then delete.");
    await studioSettled(String(id));
    const ex = exportUsing(id);
    if (ex)
      throw new Error(
        ex === id
          ? "This video is being exported. Wait for the export to finish (or cancel it in its Export dialog), then delete it."
          : `${getProject(ex).name} is exporting this video right now. Wait for that export to finish (or cancel it in its Export dialog), then delete it.`,
      );
    closeWorker(id);
    unwatchProject(id);
    cancelProject(id);
    cancelVoiceover(id, getProject(id).path);
    closeStreamsUnder(getProject(id).path);
    await new Promise((r) => setTimeout(r, 150));
    await deleteProject(id, removeFiles);
    forgetProject(id);
  });
  h("projects:status", (id) => projectStatus(id));
  h("projects:open", async (id) => {
    const p = getProject(id);
    if (!fs.existsSync(p.path)) throw new Error(`The project folder is missing: ${p.path}`);
    if (getStyle(p.style_id).missing && fs.existsSync(path.join(p.path, ".style-pkg", "style.json"))) {
      try {
        if (restorePackageFromProject(p.path)) send("styles:changed", { id: p.style_id });
      } catch (e) {
        log("restore style package on open failed", e.message);
      }
    }
    touchProject(id);
    setConfig(p.kind === "personal" ? { lastPersonalProjectId: id } : { lastProjectId: id });
    setActiveProject(id);
    ensureSkill(p.path, p.style_id);
    sweepIncoming(p.path);
    watchProject(id, p.path, (pid, files, reload) => {
      if (reload) markDirty(pid);
      send("project:changed", { projectId: pid, files, reload });
    });
    return { status: projectStatus(id), host: projectUrl(id, "__suite/host.html"), base: projectUrl(id), git: await gitAvailable() };
  });
  h("projects:close", () => setActiveProject(null));
  h("projects:upgradeEngine", async (id) => {
    const p = getProject(id),
      st = getStyle(p.style_id);
    const own = !!st.pkg && !st.pkg.official,
      vers = own ? styleVersions(p.path, p.style_id) : null;
    if (own && isProjectBusy(id)) throw new Error("Claude is working on this video. Update the style when it has finished.");
    const before = own && (await gitAvailable()) ? await snapshot(p.path, "Before the style update").catch(() => null) : null;
    upgradeEngine(p.path, p.preset_id || st.defaultLook, p.style_id);
    markDirty(id);
    writeContext(id);
    if (own && before) {
      const label = `Updated the style "${st.name}" to v${st.pkg.manifest.version}${vers && vers.pinned !== st.pkg.manifest.version ? ` (was v${vers.pinned})` : ""}`;
      await rehash(p.path, ["engine.js", "models.js", "lib", "fonts", "vendor", "sprites", "assets/figures", ".style-pkg"]).catch(() => {});
      const after = await snapshot(p.path, label).catch(() => null);
      if (after && after !== before) {
        const files = await changedFiles(p.path, before, after).catch(() => []);
        q.run(
          "INSERT INTO edits(id,project_id,instruction,status,commit_before,commit_after,files,summary,created_at,finished_at,kind) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          uid("edt_"),
          id,
          label,
          "done",
          before,
          after,
          JSON.stringify(files),
          "Its engine, skill and look notes are the installed version now. Revert brings the earlier version back.",
          now(),
          now(),
          "style",
        );
      }
    }
    return projectStatus(id);
  });
  h("projects:shots", (id, shots) => {
    setShots(id, shots);
    writeContext(id, shots);
  });
  h("projects:selection", (id, items) => setSelection(id, items));
  h("projects:shotThumbs", async (id, times, files) => {
    const root = getProject(id).path,
      dir = path.join(root, ".suite", "frames", "shots"),
      idxF = path.join(dir, "index.json");
    const mt = (f) => {
      try {
        return fs.statSync(path.join(root, f)).mtimeMs;
      } catch {
        return 0;
      }
    };
    const libs = (() => {
      try {
        return fs.readdirSync(path.join(root, "lib")).map((f) => mt("lib/" + f));
      } catch {
        return [];
      }
    })();
    const shared = Math.max(mt("engine.js"), mt("models.js"), mt("project.json"), mt("audio/timeline.json"), ...libs);
    let idx = {};
    try {
      idx = JSON.parse(fs.readFileSync(idxF, "utf8"));
    } catch {}
    const name = (t) => `t${t.toFixed(2).replace(".", "_")}.png`,
      sig = (i) => `${shared}|${files?.[i] ? mt(files[i]) : 0}`;
    const todo = times
      .map((t, i) => i)
      .filter((i) => !files || idx[name(times[i])] !== sig(i) || !fs.existsSync(path.join(dir, name(times[i]))));
    const made = new Map();
    if (todo.length) {
      const out = await renderStills(
        id,
        todo.map((i) => times[i]),
        0.125,
        "shots",
      ).catch(() => todo.map((i) => ({ time: times[i], file: "", base64: "", error: true })));
      out.forEach((o, k) => {
        const i = todo[k];
        made.set(i, o.file ? path.basename(o.file) : "");
        if (o.file) idx[name(times[i])] = sig(i);
        else delete idx[name(times[i])];
      });
      try {
        fs.writeFileSync(idxF, JSON.stringify(idx));
      } catch {}
    }
    return times.map((t, i) => {
      const f = made.has(i) ? made.get(i) : name(t);
      return f ? projectUrl(id, ".suite/frames/shots/" + f) + "?v=" + (idx[f] ? encodeURIComponent(idx[f]) : Date.now()) : "";
    });
  });
  h("projects:thumbnail", (id, t) => thumbnail(id, t).then(() => projectUrl(id, ".suite/cover.jpg") + "?v=" + Date.now()));
  h("projects:waveform", (id, rel) => {
    const root = getProject(id).path,
      f = path.resolve(root, rel);
    return insideDir(root, f) && fs.existsSync(f) ? waveform(f) : null;
  });
  h("projects:timeline", (id) => {
    const d = getProject(id).path,
      read = (f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
        } catch {
          return null;
        }
      };
    return { phrases: read("audio/timeline.json") ?? [], events: read("audio/events.json"), beds: read("audio/beds.json")?.beds ?? [] };
  });
  h("projects:readText", (id, rel) => {
    const root = getProject(id).path,
      f = path.resolve(root, rel);
    return insideDir(root, f) && fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
  });
  h("projects:saveScript", (id, text) => {
    fs.writeFileSync(path.join(getProject(id).path, "script.txt"), String(text));
    return projectStatus(id);
  });
  h("projects:hostState", (id) => hostState(id, true));
  h("projects:layout", async (id, times) => {
    await hostState(id, true);
    return layoutCheck(id, times);
  });
  h("preview:kill", () => {
    const w = getWin();
    if (!w) return 0;
    const top = w.webContents.mainFrame,
      base = serverUrl();
    const pids = new Set(
      top.framesInSubtree
        .filter((f) => f !== top && f.url.startsWith(base))
        .map((f) => f.osProcessId)
        .filter((pid) => pid && pid !== top.osProcessId),
    );
    pids.forEach((pid) => {
      try {
        process.kill(pid);
      } catch {}
    });
    log("preview process ended after a hang", [...pids].join(","));
    return pids.size;
  });
  h("styles:list", () =>
    allStyles().map((s) => {
      const o = s.id === "starter" && process.env.CZ_SHOW_STARTER === "1" ? { ...s, name: "Starter (dev)", devPick: true } : { ...s };
      if (s.wip) o.hidden = process.env.CZ_PREVIEW !== "1" && process.env.CZ_SHOW_WIP !== "1";
      o.mine = isMine(s.id);
      o.needsImageKey = needsImageKey(s.id);
      if (s.pkg) {
        const ws2 = s.pkg.manifest.studio?.workspace;
        o.version = s.pkg.manifest.version;
        o.workspace = ws2 && q.get("SELECT id FROM projects WHERE id=? AND lab_kind='studio'", ws2) ? ws2 : null;
        if (o.mine) o.dir = s.pkg.dir;
        delete o.pkg;
      }
      return o;
    }),
  );
  h("styles:delete", (id) => {
    const st = getStyle(String(id));
    if (st.pkg && !st.pkg.official && st.id === id) {
      deletePackage(st.id);
      send("styles:changed", { id: st.id });
      return;
    }
    return deleteCustomStyle(id);
  });
  h("library:search", (o) => {
    refreshIndex();
    const p = o?.projectId ? getProject(String(o.projectId)) : null,
      base = o?.base ?? (p ? baseOf(p.style_id) : null);
    return searchLibrary({
      query: String(o?.query ?? "").slice(0, 200),
      kind: o?.kind ?? null,
      base,
      styleId: p?.style_id ?? null,
      projectId: p?.id ?? null,
      engineVersion: p ? engineVersion(path.join(p.path, "engine.js")) : null,
      scope: o?.scope === "all" ? "all" : "fit",
      limit: Math.min(50, +(o?.limit ?? 20) || 20),
      includeProposed: !!o?.includeProposed,
    });
  });
  h("library:get", (id) => libraryEntry(String(id)));
  h("library:list", (o) => {
    refreshIndex();
    return listLibrary(o ?? {});
  });
  h("library:update", (id, patch) => {
    const pt = patch ?? {},
      r = patchWsEntry(String(id), (e) => {
        if (pt.status !== void 0) {
          if (!LIB_STATUSES.includes(pt.status)) throw new Error("unknown status");
          e.status = pt.status;
        }
        if (pt.title !== void 0) {
          const t = String(pt.title).trim().slice(0, 120);
          if (!t) throw new Error("An entry needs a title");
          e.title = t;
        }
        if (pt.summary !== void 0) e.summary = String(pt.summary).slice(0, 400);
        if (pt.tags !== void 0)
          e.tags = [
            ...new Set((Array.isArray(pt.tags) ? pt.tags : []).map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean)),
          ].slice(0, 40);
        if (pt.scope !== void 0) {
          if (!LIB_SCOPE_RX.test(String(pt.scope))) throw new Error("unknown scope");
          e.scope = String(pt.scope);
        }
      });
    rebuildIndex();
    return libraryEntry(r.entry.id);
  });
  h("library:delete", (id) => deleteEntry(String(id)));
  h("library:browse", (o) => {
    refreshIndex();
    return browseLibrary(o ?? {});
  });
  h("library:detail", (id) => libraryDetail(String(id)));
  h("library:file", (id, rel) => entryFileText(String(id), String(rel ?? "")));
  h("library:reveal", (id) => revealEntry(String(id)));
  h("library:restore", (name) => restoreEntry(String(name)));
  h("library:trash", () => trashInfo());
  h("library:emptyTrash", () => emptyTrash());
  h("library:ship", (id) => shipEntry(String(id)));
  h("library:proposed", () => proposedCount());
  onLibraryChanged((sources) => send("library:changed", { sources, proposed: proposedCount() }));
  onIssuesWritten((dir) => lessonsChanged(dir));
  setHarvestRunner({
    run: (pid, instruction, label, emit) => runTask({ projectId: pid, kind: "harvest", instruction, label }, emit),
    busy: (pid) => isProjectBusyAny(pid) || studioJobBusy(pid),
  });
  onHarvestEvent((ev) => send("library:harvest", ev));
  onLoopEnd((pid, status) => {
    if (status === "done") queueHarvest(pid, "loop");
  });
  h("library:harvestNow", (projectId) => queueHarvest(String(projectId), "manual", { force: true }));
  h("library:harvestState", (projectId) => harvestState(projectId ? String(projectId) : null));
  h("library:lastHarvest", () => lastHarvest());
  h("library:harvestFor", (editId) => harvestFor(String(editId)));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:library", (op, a) =>
      op === "fts"
        ? setFtsForTest(!!a)
        : op === "rebuild"
          ? rebuildIndex(!!a)
          : op === "ftsOk"
            ? libraryFts()
            : op === "forget"
              ? Number(
                  q.run("DELETE FROM lib_uses WHERE entry_id LIKE ? OR entry_id LIKE '%zorblax%'", `%${String(a || "lib-test")}%`).changes,
                )
              : op === "offEnv"
                ? a
                  ? (process.env.CZ_LIBRARY_OFF = "1")
                  : (delete process.env.CZ_LIBRARY_OFF, "")
                : op === "lookToLibrary"
                  ? lookToLibrary(String(a?.lookId), a?.projectId ?? null)
                  : op === "candidates"
                    ? harvestCandidates(String(a))
                    : op === "lessons"
                      ? syncStudioLessons(String(a))
                      : op === "imageCache"
                        ? setImageCacheForTest(!!a)
                        : op === "makeImage"
                          ? makeImage(getProject(String(a?.projectId)).path, a?.req, async () => {
                              throw new Error("the image service was called: the picture cache missed");
                            }).then((r) => ({
                              cached: r.cached,
                              shared: r.shared ?? null,
                              entry: r.entry,
                              count: r.ledger.count,
                              spent: r.ledger.spent,
                            }))
                          : null,
    );
  h("studio:create", (brief) => {
    if (brief?.mode !== "look") throw new Error(STYLES_MOVED);
    return createWorkspace(brief);
  });
  if (process.env.CZ_TEST_HOOKS === "1") h("test:studioCreate", (brief) => createWorkspace(brief));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:seedChat", (projectId, n) => {
      const id = uid(),
        at = now();
      q.run(
        "INSERT INTO threads(id,project_id,title,kind,created_at,updated_at,engine,claude_session_id) VALUES(?,?,?,?,?,?,?,?)",
        id,
        projectId,
        "Build video",
        "edit",
        at,
        at,
        "claude",
        "seeded-" + id,
      );
      const md = (i) => `**Shot ${i}** is built.

- The camera moves from the aisle to the window
- The passengers sit in rows ${i}-${i + 4}
- \`scenes/s${i}.js\` checked: no overlaps

The frame at ${(i * 1.7).toFixed(1)} s reads clean.`;
      for (let i = 0; i < n; i++) {
        const r = i % 5;
        q.run(
          "INSERT INTO messages(thread_id, role, content, created_at) VALUES(?,?,?,?)",
          id,
          r === 0 ? "user" : r === 4 ? "assistant" : "tool",
          JSON.stringify(
            r === 0
              ? { text: `Fix shot ${i}: the passengers float above the seats`, selection: [], kind: "edit" }
              : r === 4
                ? { text: md(i) }
                : { summary: `Editing scenes/s${i}.js` },
          ),
          at,
        );
      }
      return id;
    });
  h("studio:state", (projectId) => getStudio(String(projectId)));
  h("studio:setStage", (projectId, stage, o) => setStage(String(projectId), stage, { force: !!o?.force }));
  h("studio:setView", (projectId, view) => setView(String(projectId), String(view)));
  h("studio:run", async (projectId, o) => {
    const { studio } = requireStudio(String(projectId)),
      issues = Array.isArray(o?.issues) ? o.issues.map(String).slice(0, 100) : null;
    if (studioJobBusy(String(projectId))) throw new Error(STUDIO_JOB_BUSY);
    if (publishBusy(String(projectId))) throw new Error("The app is publishing this style: wait for the checklist to finish.");
    if (isProjectBusy(String(projectId)))
      throw new Error("Claude is already working on this project. Wait for it to finish or press Stop.");
    if (o?.review && studio.stage !== "review") throw new Error("The frame review runs in the review stage.");
    await studioSettled(String(projectId));
    if (studyBusy(String(projectId))) throw new Error("The app is measuring the references: wait for it to finish.");
    if (studio.stage === "study" && !o?.fix && !o?.review && (await studyStale(String(projectId))))
      await runStudy(String(projectId)).catch((e) => log("studio study failed", e?.message));
    if (isProjectBusy(String(projectId)))
      throw new Error("Claude is already working on this project. Wait for it to finish or press Stop.");
    noteRun(String(projectId), { fix: !!o?.fix, issues });
    try {
      return await runTask(
        {
          projectId: String(projectId),
          kind: "studio",
          instruction: String(o?.instruction ?? "").slice(0, 8e3),
          studio: { stage: studio.stage, issues, fix: !!o?.fix, review: !!o?.review && !o?.fix },
        },
        emitTask,
      );
    } catch (e) {
      forgetRun(String(projectId));
      throw e;
    }
  });
  h("studio:previewSettings", (projectId, aspect) => {
    const w = requireStudio(String(projectId));
    const a = w.studio.aspects.includes(aspect) ? aspect : w.studio.aspects[0];
    return settingsFor(w.dir, w.studio, a);
  });
  h("studio:setBrief", (projectId, b) => {
    const pid = String(projectId);
    requireStudio(pid);
    const cap = b?.imageCap == null ? null : Math.round(Number(b.imageCap));
    if (cap != null && !(cap >= 0 && cap <= 500)) throw new Error("The image cap must be 0-500 pictures.");
    writeStudio(pid, (s, pj) => {
      if (typeof b?.description === "string")
        s.description = b.description
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
          .trim()
          .slice(0, 4e3);
      if (cap != null) {
        s.imageCap = cap;
        pj.imageBudget = cap;
      }
    });
    writeContext(pid);
    notifyStudio(pid);
    return getStudio(pid);
  });
  h("studio:stop", (taskId) => stopTask(String(taskId)));
  h("studio:issues", (projectId) => readIssues(requireStudio(String(projectId)).dir));
  h("studio:issueUpdate", (projectId, id, patch) => {
    const r = updateIssue(requireStudio(String(projectId)).dir, String(id), { status: patch?.status, severity: patch?.severity });
    notifyStudio(String(projectId));
    return r;
  });
  h("studio:issueAdd", (projectId, x) => {
    const w = requireStudio(String(projectId));
    let thumb = null;
    const m = typeof x?.thumb === "string" ? /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(x.thumb) : null;
    if (m && m[2].length < 4e6)
      try {
        const rel = `.suite/studio/pins/${uid("pin_")}.${m[1] === "png" ? "png" : "jpg"}`;
        fs.mkdirSync(path.join(w.dir, ".suite", "studio", "pins"), { recursive: true });
        fs.writeFileSync(path.join(w.dir, rel), Buffer.from(m[2], "base64"));
        thumb = rel;
      } catch (e) {
        log("studio", "pin frame not saved", e?.message);
      }
    if (
      !thumb &&
      typeof x?.thumb === "string" &&
      /^\.suite\/studio\/renders\/v\d+\/(16x9|9x16)\/[\w.-]+\.jpg$/.test(x.thumb) &&
      fs.existsSync(path.join(w.dir, x.thumb))
    )
      thumb = x.thumb;
    const r = addIssue(w.dir, {
      source: "user",
      title: x?.title,
      severity: x?.severity,
      meaning: x?.meaning,
      fix: x?.fix,
      where: x?.where,
      round: w.studio.round,
      thumb,
    });
    notifyStudio(String(projectId));
    return r.issue;
  });
  const studioIdle = (projectId, what) => {
    if (isProjectBusy(projectId))
      throw new Error(`Claude is working in this workspace: wait for it to finish (or press Stop), then ${what}.`);
    if (studioJobBusy(projectId)) throw new Error(STUDIO_JOB_BUSY);
    if (publishBusy(projectId)) throw new Error(`The app is publishing this style: wait for the checklist to finish, then ${what}.`);
  };
  const clipTxt = (s, n) =>
    String(s ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);
  h("studio:kitMark", (projectId, key2, status, note) => {
    const pid = String(projectId),
      w = requireStudio(pid),
      el = kitElements(w.dir, w.studio).find((e) => e.key === String(key2));
    if (!el) throw new Error("That kit element is not in the latest version any more.");
    if (status !== "approved" && status !== "flagged" && status !== null) throw new Error("unknown mark");
    let issue = null;
    if (status === "flagged") {
      const a = w.studio.aspects.find((x) => el.frames[x]) ?? w.studio.aspects[0],
        f = el.frames[a];
      issue = addIssue(w.dir, {
        source: "user",
        title: clipTxt(note, 200) || `Kit: ${el.name} is not right yet`,
        severity: "medium",
        meaning: `the kit element "${el.name}" is flagged in the gallery`,
        fix: clipTxt(note, 400) ? `in the kit shot "${el.name}": ${clipTxt(note, 400)}` : "",
        where: { view: el.view, aspect: a, t: el.t, shot: el.shot, element: el.name },
        round: w.studio.round,
        thumb: f?.file ?? null,
      }).issue.id;
    }
    return markKit(pid, el.key, status, { name: el.name, issue });
  });
  h("studio:publish", async (projectId) => {
    const pid = String(projectId);
    requireStudio(pid);
    if (getStudio(pid).studio.mode !== "look") throw new Error(STYLES_MOVED);
    studioIdle(pid, "publish");
    const run = await publishStyle(pid);
    if (run.status === "done") {
      send("styles:changed", { id: run.result?.id ?? null });
      try {
        run.harvest = queueHarvest(pid, "publish").state;
        notePublishHarvest(pid, run.harvest);
      } catch (e) {
        log("library: publish harvest not queued", e?.message);
      }
    }
    return run;
  });
  h("studio:publishState", (projectId) => publishState(String(projectId)));
  h("studio:study", async (projectId) => {
    const pid = String(projectId);
    requireStudio(pid);
    studioIdle(pid, "measure the references");
    await runStudy(pid);
    return studyView(pid);
  });
  h("studio:studyView", (projectId) => studyView(String(projectId)));
  h("studio:targets", (projectId) => listTargets(String(projectId)));
  h("studio:targetAdd", (projectId, o) => addTarget(String(projectId), o ?? {}));
  h("studio:targetUpdate", (projectId, id, patch) => updateTarget(String(projectId), String(id), patch ?? {}));
  h("studio:targetRemove", (projectId, id) => removeTarget(String(projectId), String(id)));
  h("studio:targetsQuote", (projectId, count) => generateQuote(String(projectId), +count));
  h("studio:targetsGenerate", (projectId, count) => generateTargets(String(projectId), +count));
  h("studio:matchNow", (projectId) => {
    studioIdle(String(projectId), "match the targets");
    return ensureMatch(String(projectId));
  });
  h("studio:matchSettings", (projectId, patch) => {
    const pid = String(projectId),
      cur = matchSettingsOf(requireStudio(pid).studio),
      p = patch ?? {};
    const next = matchSettingsOf({
      match: {
        threshold: p.threshold != null ? +p.threshold : cur.threshold,
        every: p.every != null ? Math.round(+p.every) : cur.every,
        cap: p.cap != null ? Math.round(+p.cap) : cur.cap,
        plateau: p.plateau != null ? Math.round(+p.plateau) : cur.plateau,
      },
    });
    writeStudio(pid, (s) => {
      s.match = next;
    });
    notifyStudio(pid);
    return next;
  });
  h("studio:loop", (projectId) => loopState(String(projectId)));
  h("studio:loopStart", (projectId, o) => startLoop(String(projectId), { resume: !!o?.resume }));
  h("studio:loopStop", (projectId) => stopLoop(String(projectId)));
  h("studio:critic", (projectId) => criticOnce(String(projectId)));
  h("studio:versions", (projectId) => listVersions(String(projectId)));
  h("studio:compare", (projectId, a, b) => compare(String(projectId), Math.round(+a), Math.round(+b)));
  h("studio:rollback", (projectId, v) => {
    studioIdle(String(projectId), "go back to a version");
    return rollback(String(projectId), Math.round(+v));
  });
  h("studio:newVersion", (projectId, label) => {
    studioIdle(String(projectId), "make a version");
    return newVersion(String(projectId), String(label ?? "").slice(0, 120) || "Next version", { mp4: true, reason: "explicit" });
  });
  h("studio:checks", (projectId) => {
    studioIdle(String(projectId), "run the checks");
    return checkNow(String(projectId));
  });
  h("studio:saveLook", (projectId, o) => {
    studioIdle(String(projectId), "save the look");
    const r = saveLook(String(projectId), o ?? {});
    try {
      lookToLibrary(r.lookId, String(projectId));
    } catch (e) {
      log("library: look not added", e?.message);
    }
    return r;
  });
  h("styles:figureLibrary", () => libraryFigures(true).map(({ file: _f, ...m }) => (void _f, m)));
  h("styles:useFigureModel", (projectId, id) => useLibraryFigure(getProject(projectId).path, String(id)));
  h("presets:list", () => listPresets().map((p) => (p.origin === "studio" ? { ...p, preview: studioLookPreview(p.id) } : p)));
  h("presets:save", (p) => savePreset(p));
  h("presets:delete", (id) => (getPreset(String(id))?.origin === "studio" ? deleteStudioLook(String(id)) : deletePreset(id)));
  const keepFormat = (p, settings) => {
    const base = baseOf(p.style_id);
    if (!["vox", "collage", "flat", "lowpoly", "toon", "stickstory", "starter", "recon"].includes(base)) return settings;
    let cur = {};
    try {
      cur = JSON.parse(fs.readFileSync(path.join(p.path, "project.json"), "utf8")).settings || {};
    } catch {}
    const out = withFormat(settings, cur.format || settings.format, base, cur.sheet?.cols);
    return base === "starter" && cur.dim && out.dim !== cur.dim ? { ...out, dim: cur.dim } : out;
  };
  h("presets:apply", (projectId, presetId) => {
    const p = getProject(projectId),
      pre = getPreset(presetId);
    if (!pre) throw new Error("Preset not found");
    if ((pre.style_id || "pixel-art") !== getStyle(p.style_id).id)
      throw new Error(`That look belongs to another style. Pick a ${getStyle(p.style_id).name} look.`);
    let cur = {};
    try {
      cur = JSON.parse(fs.readFileSync(path.join(p.path, "project.json"), "utf8")).settings || {};
    } catch {}
    const next = keepFormat(p, pre.settings),
      keepBrand = !pre.settings?.brand?.color && cur.brand?.color;
    const keepCast = !pre.settings?.figures && cur.figures && typeof cur.figures === "object";
    const keepGfx = !pre.settings?.graphics && cur.graphics && typeof cur.graphics === "object";
    writeSettings(p.path, {
      ...next,
      ...(keepBrand ? { brand: cur.brand } : {}),
      ...(keepCast ? { figures: cur.figures } : {}),
      ...(keepGfx ? { graphics: cur.graphics } : {}),
    });
    q.run("UPDATE projects SET preset_id=?, updated_at=? WHERE id=?", presetId, now(), projectId);
    writeContext(projectId);
    markDirty(projectId);
    return projectStatus(projectId);
  });
  h("presets:preview", async (projectId, settings, t) => {
    const p = getProject(projectId);
    settings = keepFormat(p, settings);
    const err = validateSettings(settings, getStyle(p.style_id).id);
    if (err) throw new Error(err);
    const [now2] = await renderStills(projectId, [t], 0.5, "look");
    return { before: "data:image/png;base64," + now2.base64, after: await previewSettings(projectId, settings, t) };
  });
  h("gfx:save", (projectId, values) => {
    const p = getProject(projectId);
    const g = saveProjectGraphics(p.path, values);
    markDirty(projectId);
    return g;
  });
  h("gfx:presets", () => listGfxPresets());
  h("gfx:savePreset", (name, values) => saveGfxPreset(name, values));
  h("gfx:deletePreset", (name) => deleteGfxPreset(String(name)));
  h("presets:applySettings", (projectId, settings) => {
    const p = getProject(projectId);
    settings = keepFormat(p, settings);
    if (settings && typeof settings === "object" && settings.graphics === void 0) {
      try {
        const g = JSON.parse(fs.readFileSync(path.join(p.path, "project.json"), "utf8")).settings?.graphics;
        if (g) settings = { ...settings, graphics: g };
      } catch {}
    }
    const err = validateSettings(settings, getStyle(p.style_id).id);
    if (err) throw new Error(err);
    writeSettings(p.path, settings);
    markDirty(projectId);
    writeContext(projectId);
    return projectStatus(projectId);
  });
  h("rules:list", () =>
    q.all(
      `SELECT r.*, p.name AS project_name FROM rules r LEFT JOIN projects p ON p.id=r.project_id ORDER BY r.status DESC, r.created_at DESC`,
    ),
  );
  h("rules:add", (r) => {
    if (!r.text?.trim()) throw new Error("Write the rule first.");
    const id = uid("rul_");
    q.run(
      "INSERT INTO rules(id,scope,project_id,text,enabled,status,created_at) VALUES(?,?,?,?,1,?,?)",
      id,
      r.scope,
      r.scope === "project" ? (r.projectId ?? null) : null,
      r.text.trim(),
      "active",
      now(),
    );
    writeStyleFiles();
    return id;
  });
  h("rules:update", (id, patch) => {
    const r = q.get("SELECT * FROM rules WHERE id=?", id);
    if (!r) throw new Error("Rule not found");
    q.run(
      "UPDATE rules SET text=?, enabled=?, status=?, scope=?, project_id=? WHERE id=?",
      patch.text ?? r.text,
      patch.enabled === void 0 ? r.enabled : +patch.enabled,
      patch.status ?? r.status,
      patch.scope ?? r.scope,
      patch.projectId !== void 0 ? patch.projectId : r.project_id,
      id,
    );
    writeStyleFiles();
  });
  h("rules:delete", (id) => {
    q.run("DELETE FROM rules WHERE id=?", id);
    writeStyleFiles();
  });
  h("rules:learn", () => learnFromEdits());
  h("help:ask", (history, question, images, place) => askHelp(history, question, images, place));
  h("help:feedback", (id, solved) => helpFeedback(id, solved));
  h("help:context", (place) => supportContext(place));
  h("help:clean", (text) => clean(String(text ?? ""), 8e3));
  h("help:draft", (history, images, place) => draftReport(history, images, place));
  h("help:create", (draft, includeInfo, images) => createReport(draft, !!includeInfo, images));
  h("help:reports", () =>
    listReports()
      .slice()
      .reverse()
      .map(({ shots, ...r }) => ({ ...r, shots: shots.length })),
  );
  h("help:post", () => {
    throw new Error("Posting reports is turned off in this build. Use Copy report instead.");
  });
  h("help:capture", () => captureWindow(getWin()));
  h("test:helpSearch", (text, platform, brand) =>
    process.env.CZ_TEST_HOOKS === "1" ? searchKb(String(text), 4, platform || process.platform, brand).map((a) => a.id) : [],
  );
  const emitTask = (ev) => {
    send("claude:event", ev);
    if (ev.type === "done") send("channels:changed", { what: "files" });
    const w = getWin();
    if (ev.type === "done" && w && !w.isFocused() && canNotify()) {
      const n = new Notification({
        title: ev.status === "done" ? "Claude finished" : ev.status === "no-change" ? "Claude finished (no changes)" : "Claude stopped",
        body: ev.error ? String(ev.error).slice(0, 160) : `${ev.files?.length ?? 0} file(s) changed in ${Math.round((ev.ms ?? 0) / 1e3)}s`,
      });
      n.on("click", () => {
        w.show();
        w.focus();
      });
      n.show();
    }
    if (ev.type === "done")
      afterLabTask(ev.projectId, ev.status, ev.error)
        .then((c) => {
          if (c) {
            send("characters:changed", c);
            markDirty(ev.projectId);
          }
        })
        .catch((e) => log("character save failed", e.message));
    if (ev.type === "done") afterTurn(ev.projectId, ev).catch((e) => log("studio", "after the turn failed", e?.message));
    if (ev.type === "done") loopTaskDone(ev);
    if (ev.type === "done" && ev.kind === "build" && ev.status === "done" && ev.projectId) buildSweep(String(ev.projectId));
    if (ev.type === "done" && ev.status === "done" && HARVEST_AFTER.has(ev.kind))
      queueHarvest(ev.projectId, ev.kind, { sourceEditId: ev.editId });
    if (ev.type === "done")
      afterReframeTask(ev.editId)
        .then((id) => {
          if (id) send("projects:covers", { projectId: id });
        })
        .catch((e) => log("9:16 cover", e.message));
    else if (ev.type === "tool" && labProjects.has(ev.projectId))
      send("characters:progress", { projectId: ev.projectId, step: ev.summary });
  };
  const labProjects = new Set();
  setLabBusyCheck(isProjectBusy);
  setLoopRunner(async (pid) => {
    const { studio } = requireStudio(pid);
    await studioSettled(pid);
    noteRun(pid, { fix: true, issues: null });
    try {
      return await runTask(
        {
          projectId: pid,
          kind: "studio",
          instruction: "Run until good: fix every open issue (the critic's too), then look again at the overlays.",
          studio: { stage: studio.stage, issues: null, fix: true, review: false },
        },
        emitTask,
      );
    } catch (e) {
      forgetRun(pid);
      throw e;
    }
  });
  async function designCharacter(description) {
    if (!claudeExecutable()) throw new Error(NO_CLAUDE);
    const d = await startDesign(description, (m) => createCharacterLab(m, description));
    labProjects.add(d.projectId);
    try {
      await runTask({ projectId: d.projectId, kind: "character", instruction: description.trim(), newSession: true }, emitTask);
    } catch (e) {
      await afterLabTask(d.projectId, "failed", String(e.message || e));
      throw e;
    }
    return d;
  }
  h("characters:list", async () => {
    const l = await listCharacters();
    l.forEach((c) => c.lab && labProjects.add(c.lab));
    return l;
  });
  h("characters:random", () => randomCharacter());
  h("characters:create", (description) => designCharacter(description));
  h("characters:setDefault", (id) => {
    setDefaultCharacter(id);
    return listCharacters();
  });
  h("characters:delete", (id) => deleteCharacter(id));
  h("characters:rename", (id, name) => renameCharacter(id, name));
  h("characters:refine", async (id, instruction) => {
    const meta = (await listCharacters()).find((c) => c.id === id);
    if (!meta) throw new Error("Character not found");
    if (id === "mo") throw new Error("Mo is built in. Make a random character or describe one to get a character of your own to change.");
    let projectId = meta.lab && q.get("SELECT id FROM projects WHERE id=?", meta.lab) ? meta.lab : null;
    if (!projectId) {
      const lab = await createCharacterLab(meta, `${meta.name}: ${meta.about}`);
      fs.copyFileSync(path.join(charsRoot(), id, "character.js"), path.join(lab.dir, "character.js"));
      const mf = path.join(charsRoot(), id, "character.json"),
        m = JSON.parse(fs.readFileSync(mf, "utf8"));
      m.lab = lab.projectId;
      fs.writeFileSync(mf, JSON.stringify(m, null, 1));
      projectId = lab.projectId;
    }
    labProjects.add(projectId);
    if (String(instruction || "").trim())
      await runTask({ projectId, kind: "edit", instruction: String(instruction).trim(), scope: "video" }, emitTask);
    return projectId;
  });
  h("claude:status", async () => {
    const s = await authStatus();
    autoSpeechSetup();
    return s;
  });
  h("claude:loginCode", (code) => loginCode(code));
  h("claude:login", async () => {
    const s = await login((l) => send("claude:login-log", l));
    autoSpeechSetup();
    return s;
  });
  onSpeechState((s) => send("speech:state", s));
  onCustomState((s) => send("customapi:state", s));
  const kindOf = (k) => (k === "voice" ? "voice" : "image");
  h("customapi:state", (k) => customState(kindOf(k)));
  h("customapi:setup", (k, brief, key2) => startCustomSetup(kindOf(k), String(brief ?? ""), key2 == null ? null : String(key2)));
  h("customapi:cancel", (k) => cancelCustomSetup(kindOf(k)));
  h("customapi:remove", (k) => {
    const s = removeCustom(kindOf(k));
    if (kindOf(k) === "image" && getConfig().images?.provider === "custom") setConfig({ images: { provider: "auto" } });
    return s;
  });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("customapi:testInstall", (k, source, key2) => testInstall(kindOf(k), String(source), "test", key2));
  onCliproxy({ state: (st) => send("experimental:state", st), loginLog: (l) => send("experimental:login-log", l) });
  h("experimental:state", () => cliproxyState());
  h("experimental:enable", (ack) => enableGoogle(ack === true));
  h("experimental:disable", () => disableGoogle());
  h("experimental:login", () => loginGoogle());
  h("experimental:cancelLogin", () => {
    cancelLogin();
    return cliproxyState();
  });
  h("experimental:models", () => googleModels());
  h("experimental:remove", () => removeGoogle());
  h("experimental:retry", () => retryGoogle());
  h("experimental:switch", () => switchGoogle());
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:cliproxyVerify", async (op, a) =>
      op === "claudeOnly"
        ? { learn: learnModel() ?? null, insights: (await import("../channels/insights")).insightsModel() ?? null }
        : testCliproxy(String(op), a),
    );
  onCodex({ state: (st) => send("engines:changed", st), log: (l) => send("engines:login-log", l) });
  h("engines:state", () => {
    const s = codexState();
    if (!s.checkedAt) void refreshCodex();
    return s;
  });
  h("engines:refresh", () => refreshCodex());
  h("engines:codexLogin", () => codexLogin("browser"));
  h("engines:codexDeviceLogin", () => codexLogin("device"));
  h("engines:codexCancelLogin", () => cancelCodexLogin());
  h("engines:codexOpenLogin", () => openCodexLoginPage());
  h("engines:codexLogout", () => codexLogout());
  h("engines:codexInstall", () => installCodex());
  h("engines:codexProbe", () => ensureSandboxProbe(true).then(() => codexState()));
  h("engines:codexPath", (p) => setCodexPath(typeof p === "string" ? p : null));
  if (process.env.CZ_TEST_HOOKS === "1") {
    h("test:codexMap", (events, projectDir, model) =>
      describeMapped(Array.isArray(events) ? events : [], {
        model: String(model || "gpt-6.1-sol"),
        inside: (p) => insideDir(String(projectDir), p),
      }),
    );
    h("test:fakeCodex", async (op, a) => (op === "state" ? setFakeCodexState(a ?? null) : testFakeCodex(String(op), a)));
    h("test:codexProbe", async () => {
      const { exe, version } = await codexExecutable();
      return process.platform !== "win32" || !exe
        ? { skipped: !exe ? "no codex installed" : "not Windows" }
        : { exe, version, ...(await sandboxProbe(exe)) };
    });
    h("test:codexSpawnHidden", async () => {
      hideSpawn(process.execPath);
      const { Codex } = await import("@openai/codex-sdk");
      let err = "";
      try {
        await new Codex(codexClient(process.execPath, { ELECTRON_RUN_AS_NODE: "1" })).startThread({ skipGitRepoCheck: true }).run("test");
      } catch (e) {
        err = String(e?.message || e).slice(0, 200);
      }
      return { seen: spawnSeen.filter((s) => s.cmd === process.execPath), err };
    });
    h("test:codexTreeKill", async () => {
      hideSpawn(process.execPath);
      const ac = new AbortController();
      const script =
        "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:process.env,stdio:'ignore',windowsHide:true});console.log('GRAND '+c.pid);setInterval(()=>{},1000)";
      const child = (await import("node:child_process")).spawn(process.execPath, ["-e", script], {
        env: { ...codexEnv(), ELECTRON_RUN_AS_NODE: "1" },
        signal: ac.signal,
        windowsHide: true,
      });
      const alive = (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      const grand = await new Promise((res) => {
        let t = "";
        const to = setTimeout(() => res(0), 15e3);
        child.stdout?.on("data", (d) => {
          t += d;
          const m = t.match(/GRAND (\d+)/);
          if (m) {
            clearTimeout(to);
            res(+m[1]);
          }
        });
      });
      if (!grand) {
        try {
          child.kill();
        } catch {}
        return { error: "the stand-in did not start its grandchild" };
      }
      const n = treeKills.length;
      ac.abort();
      await Promise.race([stopped(ac.signal), new Promise((r) => setTimeout(r, 12e3))]);
      await new Promise((r) => setTimeout(r, 300));
      const kill = treeKills.length > n ? treeKills[treeKills.length - 1] : null;
      const out = { kill, childAlive: alive(child.pid), grandAlive: alive(grand) };
      if (out.grandAlive)
        try {
          process.kill(grand);
        } catch {}
      return out;
    });
    h("test:codexProbeKey", () => {
      const home = fs.mkdtempSync(path.join(app.getPath("temp"), "cz-codexhome-")),
        was = process.env.CODEX_HOME;
      try {
        process.env.CODEX_HOME = home;
        fs.writeFileSync(path.join(home, "config.toml"), 'model = "a"\n');
        const a = probeKey("codex.exe", "0.162.1");
        fs.writeFileSync(path.join(home, "config.toml"), 'model = "a"\n[mcp_servers.x]\ncommand = "x"\n');
        const b = probeKey("codex.exe", "0.162.1");
        return { a, b };
      } finally {
        if (was === void 0) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = was;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
    h("test:codexRealPath", (f, platform, arch) => {
      try {
        return { path: realCodex(String(f), platform, String(arch)) };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    });
    h("test:codexCandidates", (home, dirs, platform, arch) =>
      codexCandidates(String(home), (dirs || []).map(String), platform, String(arch)),
    );
  }
  h("speech:state", () => speechState());
  h("speech:setup", (mode) => startSpeechSetup({ mode: mode === "multi" || mode === "english" ? mode : void 0 }));
  h("speech:stableTs", (mode, model, fake) =>
    startStableTs({
      mode,
      model: model === "small" ? "small" : "base",
      fake: process.env.CZ_TEST_HOOKS === "1" && fake?.module && fake?.python ? fake : void 0,
    }),
  );
  h("speech:cancel", () => cancelSpeechSetup());
  h("speech:language", (p) => {
    const cur = getConfig().language,
      mode = p?.mode === "multi" || p?.mode === "english" ? p.mode : cur.mode;
    const def = p?.default !== void 0 ? langCode(p.default) : cur.default;
    if (!def) throw new Error("That language is not one the app offers.");
    setConfig({ language: { mode, default: def } });
    autoSpeechSetup();
    speechChanged();
    return speechState();
  });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:stickmanSprites", async (projectId) => (await import("../characters/sprites")).makeSprites(getProject(projectId).path));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:stickmanWeb", async (projectId, query, name) =>
      (await import("../characters/sprites")).webImage(getProject(projectId).path, query, name),
    );
  if (process.env.CZ_TEST_HOOKS === "1") h("test:speechAccept", (cand, mode) => testAccept(cand, mode));
  if (process.env.CZ_TEST_HOOKS === "1") h("test:speechPrompt", (mode) => testPrompt(mode === "multi" ? "multi" : "english"));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:lang", async (fn, ...args) => {
      const L = await import("../styles/languages"),
        ok = [
          "countWords",
          "wordsIn",
          "matchUnits",
          "otherScriptLanguage",
          "scriptLanguage",
          "styleDraws",
          "whoCanDraw",
          "charsetNote",
          "wordUnit",
          "screenTextNote",
          "lang",
        ];
      if (!ok.includes(fn)) throw new Error("not a language helper");
      return L[fn](...args);
    });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:pathSafe", async (list, badEntry) => {
      const S = await import("../core/shellPath"),
        Sp = await import("../voice/speechSetup");
      const thrown = await new Promise((res) =>
        S.safeExecFile("bad\0cmd", [], { windowsHide: true }, (e) => res(e ? String(e.code ?? e.message) : "no error")),
      );
      const enotdir = Object.assign(new Error("spawn ENOTDIR"), { code: "ENOTDIR", syscall: "spawn nvidia-smi", path: "nvidia-smi" });
      return {
        sanitized: S.sanitizePath(list),
        problems: S.pathProblems(list),
        problemText: S.pathProblemText(S.pathProblems(list)),
        thrown,
        nvm: S.nvmVersions([".DS_Store", "v20.11.0", "v18.2.1", "alias", "v22.1.0"]),
        setupText: Sp.setupErrorText(enotdir),
        probes: await Sp.testProbes("bad\0cmd", badEntry),
      };
    });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:claudeCandidates", (home, appData, dirs, exe) =>
      claudeCandidates(home, appData, dirs, exe).map((f) => ({ f, v: versionInPath(f) })),
    );
  if (process.env.CZ_TEST_HOOKS === "1") h("test:labDone", (projectId, status) => afterLabTask(projectId, status, null));
  if (process.env.CZ_TEST_HOOKS === "1") h("test:fakeRunning", (projectId, agoMs) => testFakeRunning(projectId, agoMs));
  if (process.env.CZ_TEST_HOOKS === "1") h("test:fakeClaude", (cfg) => testFakeClaude(cfg));
  if (process.env.CZ_TEST_HOOKS === "1") h("test:claudeTurns", (editId) => testClaudeTurns(String(editId)));
  if (process.env.CZ_TEST_HOOKS === "1") h("test:editTools", (editId) => testEditTools(String(editId)));
  const gridOf = (im) => {
    const { width: w, height: h2 } = im.getSize(),
      b = im.toBitmap(),
      cols = new Set();
    let u = 0,
      n = 0;
    for (let y = 0; y + 1 < h2; y += 2)
      for (let x = 0; x + 1 < w; x += 2) {
        const i = (y * w + x) * 4,
          p = b.readUInt32LE(i);
        n++;
        if (cols.size < 5e3) cols.add(p);
        if (p === b.readUInt32LE(i + 4) && p === b.readUInt32LE(i + w * 4) && p === b.readUInt32LE(i + w * 4 + 4)) u++;
      }
    return { grid: n ? Math.round((u / n) * 1e3) / 1e3 : 0, colours: cols.size };
  };
  const sizeOf = (c) => {
    if (c.type !== "image") return { type: c.type, text: String(c.text ?? "").slice(0, 200) };
    const im = nativeImage.createFromBuffer(Buffer.from(c.data, "base64"));
    return {
      type: "image",
      mimeType: c.mimeType,
      ...im.getSize(),
      kb: Math.round((c.data.length * 0.75) / 1024),
      ...(c.mimeType === "image/png" ? gridOf(im) : {}),
    };
  };
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:suiteTool", async (projectId, name, args) => {
      const d = suiteToolDefs(String(projectId)).find((x) => x.name === name);
      if (!d) throw new Error(`no suite tool ${name}`);
      return (await d.handler(args ?? {})).content.map(sizeOf);
    });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:workerPool", (projectId, n) => {
      setWorkerPool(String(projectId), +n || 1);
      return true;
    });
  if (process.env.CZ_TEST_HOOKS === "1") h("test:forClaude", (file, side, alpha) => sizeOf(forClaude(String(file), +side, !!alpha)));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:taskPrompt", (projectId, kind, language, extras, shots) =>
      kind === "ultra"
        ? testUltraPrompt(projectId, shots)
        : testTaskPrompt(projectId, kind === "build" ? "build" : "script", "", language, extras),
    );
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:libraryPrompt", (projectId, kind, instruction) =>
      testLibraryPrompt(String(projectId), kind === "edit" ? "edit" : "build", String(instruction ?? "")),
    );
  if (process.env.CZ_TEST_HOOKS === "1") h("test:usageLimits", (projectId) => testUsageLimits(String(projectId)));
  if (process.env.CZ_TEST_HOOKS === "1") h("test:reframeDone", (editId) => afterReframeTask(editId));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:paintCaption", (words, language) =>
      withPainter(
        (call) => call(`window.czCaption(${JSON.stringify(words.map(String))},-1,1,${JSON.stringify(words.map(() => 0))})`),
        words.join(""),
        language,
      ),
    );
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:claudeDone", (projectId, instruction) => {
      send("claude:event", { type: "done", projectId, status: "done", edit: { instruction } });
      return true;
    });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:reloadStyles", (restore) => {
      loadPackages();
      loadCustomStyles();
      const n = restore ? restoreMissingStyles() + restoreMissingPackages() : 0;
      loadStudioLooks();
      return n;
    });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:installPackage", (src, id) => installPackageVersion(String(src), id ? { id: String(id) } : {}));
  if (process.env.CZ_TEST_HOOKS === "1") h("test:restorePrevious", (id, n) => restorePrevious(String(id), Number(n)));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:packageVersions", (id) => packageVersions(String(id)).map((v) => ({ version: v.version, engineVersion: v.engineVersion })));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:styleOf", (id) => {
      const s = getStyle(String(id));
      return {
        id: s.id,
        name: s.name,
        base: baseOf(s.id),
        missing: !!s.missing,
        pkg: !!s.pkg,
        carried: CARRIED.get(String(id)) ?? null,
        needsImageKey: needsImageKey(s.id),
      };
    });
  if (process.env.CZ_TEST_HOOKS === "1") h("test:pwned", () => typeof globalThis.__pwned);
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:styleSnapshot", () => ({
      builtin: JSON.stringify(allStyles().filter((s) => !s.pkg)),
      presets: JSON.stringify(q.all("SELECT id,name,description,settings,builtin,style_id FROM presets WHERE origin IS NULL ORDER BY id")),
      packages: allStyles()
        .filter((s) => s.pkg)
        .map((s) => ({
          id: s.id,
          name: s.name,
          base: s.base,
          aspects: s.aspects,
          defaultLook: s.defaultLook,
          looks: s.looks,
          engineDir: s.pkg.engineDir,
          official: s.pkg.official,
          controls: s.controls.map((c) => c.path),
          formats: s.controls.find((c) => c.path === "format")?.options?.map((o) => o.value) ?? [],
          qualityBar: qualityBarOf(s.id),
          mine: isMine(s.id),
        })),
      packageLooks: q.all("SELECT id,style_id,origin,builtin FROM presets WHERE origin='package' ORDER BY id"),
      validate: (() => {
        const p = allStyles().find((s) => s.pkg);
        if (!p) return null;
        const base = getPreset(p.defaultLook)?.settings ?? {},
          validateSettings$1 = validateSettings;
        return {
          ok: validateSettings$1(base, p.id),
          badVignette: validateSettings$1({ ...base, post: { ...base.post, vignette: 5 } }, p.id),
          badFormat:
            p.aspects?.length === 1
              ? validateSettings$1({ ...base, format: p.aspects[0] === "9:16" ? "landscape" : "vertical" }, p.id)
              : "n/a",
        };
      })(),
    }));
  h("claude:logout", () => logout());
  h("claude:run", async (req) => {
    if (studioJobBusy(String(req?.projectId ?? ""))) throw new Error(STUDIO_JOB_BUSY);
    await studioSettled(String(req?.projectId ?? ""));
    return runTask(req, emitTask);
  });
  h("claude:stop", (taskId) => stopTask(taskId));
  h("claude:permission", (taskId, requestId, allow) => answerPermission(taskId, requestId, allow));
  h("claude:projectThread", (projectId) => projectThread(projectId)?.id ?? null);
  h("claude:projectModel", (projectId) => projectClaude(String(projectId)));
  h("claude:contextUsage", (projectId) => contextUsage(String(projectId)));
  h("claude:setProjectModel", (projectId, v) => setProjectClaude(String(projectId), { model: v?.model, effort: v?.effort }));
  const overridesView = (id) => {
    if (id) getProject(id);
    const cfg = getConfig(),
      snd = cfg.sound ?? {};
    return {
      own: id ? overridesOf(id) : {},
      global: { image: globalProviderSetting(), voice: cfg.voice?.provider || "auto", music: snd.music !== false, sfx: snd.sfx !== false },
      effective: { image: activeProvider(id), ...soundOf(id) },
      // the default image model: the global one per service, the Higgsfield models to pick from, the one used now
      models: {
        global: globalImageModels(),
        appDefault: providerStatus().defaultModel,
        higgsfield: providerStatus().higgsfieldModels,
        now: ((pr) => (pr ? defaultImageModel(pr, id) : null))(activeProvider(id)),
      },
      services: {
        higgsfield: keyStatus$3().hasKey,
        fal: keyStatus$2().hasKey,
        flow: flowReady(),
        customImage: readSetup("image")?.name ?? null,
        customVoice: readSetup("voice")?.name ?? null,
        elevenlabs: keyStatus().hasKey,
        fish: fishKeyStatus().hasKey,
        kokoro: !!kokoroFiles(),
      },
    };
  };
  h("projects:overrides", (projectId) => overridesView(String(projectId)));
  const musicDir = (id) => {
    const p = getProject(String(id));
    return { dir: p.path, style: baseOf(p.style_id) };
  };
  const musicView = (id) => {
    const { dir, style } = musicDir(id);
    return { ...musicOf(dir, style), mixed: fs.existsSync(path.join(dir, "audio", "final_mix.wav")) };
  };
  const remixNow = async (id) => {
    const { dir } = musicDir(id),
      log2 = (line) => send("pipeline:log", { projectId: id, step: "sound", line });
    const rep = await remix(dir, id, log2);
    if (rep) markDirty(id);
    return rep;
  };
  h("projects:music", (projectId) => musicView(projectId));
  h("projects:trimView", (projectId) => trimView(musicDir(projectId).dir));
  h("projects:trimApply", async (projectId, t) => {
    const { dir } = musicDir(projectId),
      old = readCuts(dir),
      cur = trimOf(dir);
    const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
    setTrim(
      dir,
      t
        ? { thr: num(t.thr, -70, -10, -40), minMs: num(t.minMs, 50, 3e3, 350), amount: num(t.amount, 0, 100, 70), applied: true }
        : { ...cur, applied: false },
    );
    const timed = (() => {
      try {
        return (
          fs.statSync(path.join(dir, "audio", "timeline.json")).mtimeMs >= fs.statSync(path.join(dir, "audio", "clean.wav")).mtimeMs - 1e3
        );
      } catch {
        return false;
      }
    })();
    await runStep("clean", dir, { tightenPauses: false, projectId }, (line) => send("pipeline:log", { projectId, step: "clean", line }));
    const now2 = readCuts(dir),
      moved = timed && remapTimings(dir, old, now2);
    remapLayers(dir, old, now2);
    markDirty(projectId);
    return { cuts: now2.length, removed: +now2.reduce((s, [a, b]) => s + b - a, 0).toFixed(2), moved, trim: trimOf(dir) };
  });
  h("projects:mainCharacter", (projectId, on) => {
    const p = getProject(String(projectId));
    if (baseOf(p.style_id) !== "flat") throw new Error("Only Flat explainer projects have a main character.");
    const f = path.join(p.path, "project.json"),
      pj = JSON.parse(fs.readFileSync(f, "utf8"));
    pj.character = { ...(pj.character ?? {}) };
    if (on) delete pj.character.none;
    else pj.character.none = true;
    fs.writeFileSync(f, JSON.stringify(pj, null, 1));
    writeContext(p.id);
    return { none: !!pj.character.none, name: pj.character.name ?? null };
  });
  h("projects:sfxOn", async (projectId, on) => {
    setOverrides(String(projectId), { sfx: on ? null : false });
    const report2 = await remixNow(projectId);
    return { ...musicView(projectId), report: report2, sfx: soundOf(projectId).sfx };
  });
  h("projects:musicPick", async (projectId) => {
    let src = null;
    if (nextPick) {
      src = nextPick[0] ?? null;
      nextPick = null;
    } else {
      const r = await dialog.showOpenDialog(getWin(), {
        title: "Add your own music",
        message: "Add your own music",
        properties: ["openFile"],
        filters: [{ name: "Music", extensions: MUSIC_EXT }],
      });
      src = r.canceled ? null : (r.filePaths[0] ?? null);
    }
    if (!src) return null;
    const { dir, style } = musicDir(projectId);
    addMusic(dir, src, style);
    const report2 = await remixNow(projectId);
    return { ...musicView(projectId), report: report2 };
  });
  h("projects:musicSet", async (projectId, patch) => {
    const { dir, style } = musicDir(projectId),
      before = musicOf(dir, style);
    const m = setMusic(
      dir,
      { gain: patch?.gain, duck: patch?.duck, use: patch?.use, remove: !!patch?.remove, sfxGain: patch?.sfxGain },
      style,
    );
    const needsSound = before.use !== m.use;
    const report2 = needsSound ? null : await remixNow(projectId);
    return { ...musicView(projectId), report: report2, needsSound };
  });
  const sfxChanged = () => send("sfxlib:changed", {});
  watchSfx(sfxChanged);
  h("sfxlib:list", () => {
    watchSfx(sfxChanged);
    return sfxList();
  });
  h("sfxlib:importFolder", async () => {
    let src = null;
    if (nextPick) {
      src = nextPick[0] ?? null;
      nextPick = null;
    } else {
      const r2 = await dialog.showOpenDialog(getWin(), {
        title: "Add a folder of sound effects",
        message: "Add a folder of sound effects",
        properties: ["openDirectory"],
      });
      src = r2.canceled ? null : (r2.filePaths[0] ?? null);
    }
    if (!src || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) return null;
    const r = await importFolder(src);
    sfxChanged();
    return r;
  });
  h("sfxlib:importFiles", async (dropped, category) => {
    let paths = Array.isArray(dropped) ? dropped.map(String).filter((p) => isGranted(p)) : [];
    if (!Array.isArray(dropped)) {
      if (nextPick) {
        paths = nextPick;
        nextPick = null;
      } else {
        const r2 = await dialog.showOpenDialog(getWin(), {
          title: "Add sound effects",
          message: "Add sound effects",
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "Sounds", extensions: SFX_EXT }],
        });
        paths = r2.canceled ? [] : r2.filePaths;
      }
    }
    if (!paths.length) return null;
    const r = await importFiles(paths, typeof category === "string" ? category : void 0);
    sfxChanged();
    return r;
  });
  h("sfxlib:rescan", async () => {
    const r = await rescan();
    return r;
  });
  h("sfxlib:update", (id, patch) =>
    updateEntry(String(id), {
      tags: Array.isArray(patch?.tags) ? patch.tags : void 0,
      category: typeof patch?.category === "string" ? patch.category : void 0,
      name: typeof patch?.name === "string" ? patch.name : void 0,
    }),
  );
  h("sfxlib:remove", (id) => removeEntry(String(id)));
  h("sfxlib:audio", (id) => sfxAudio(String(id)));
  const effectsModeOf = (dir) => {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")),
        m = pj.sound?.effects;
      return m === "auto" || m === "library" || m === "off" ? m : pj.settings?.theme === "investigation" ? "off" : "auto";
    } catch {
      return "auto";
    }
  };
  const layersView = (id) => {
    const { dir } = musicDir(id);
    let end = 0;
    try {
      end = +JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")).end || 0;
    } catch {}
    return {
      layers: layersOf(dir),
      end,
      words: wordsOf(dir),
      music: musicView(id),
      effects: effectsModeOf(dir),
      canMix: fs.existsSync(path.join(dir, "audio", "clean.wav")),
    };
  };
  h("projects:layers", (projectId) => layersView(String(projectId)));
  h("projects:layersSet", async (projectId, layers) => {
    const { dir } = musicDir(projectId);
    saveLayers(dir, layers);
    const report2 = await remixNow(projectId);
    return { ...layersView(projectId), report: report2 };
  });
  h("projects:layersAdd", async (projectId, o) => {
    const { dir } = musicDir(projectId);
    let src = null,
      name,
      libId = null;
    if (typeof o?.libId === "string") {
      const e = sfxEntry(o.libId);
      if (!e) throw new Error("That sound is not in the library any more.");
      src = e.path;
      name = e.name || path.basename(e.file);
      libId = e.id;
    } else if (nextPick) {
      src = nextPick[0] ?? null;
      nextPick = null;
    } else {
      const r = await dialog.showOpenDialog(getWin(), {
        title: "Add an audio layer",
        message: "Add an audio layer",
        properties: ["openFile"],
        filters: [{ name: "Audio", extensions: SFX_EXT }],
      });
      src = r.canceled ? null : (r.filePaths[0] ?? null);
    }
    if (!src) return null;
    const { clip } = await addClip(dir, src, {
      lane: typeof o?.lane === "string" ? o.lane : void 0,
      start: Number.isFinite(+o?.start) ? +o.start : 0,
      name,
      libId,
      anchorWord: !!o?.anchorWord,
    });
    const report2 = await remixNow(projectId);
    return { ...layersView(projectId), clip, report: report2 };
  });
  h("projects:layerWave", async (projectId, clipId) => {
    const { dir } = musicDir(projectId),
      c = layersOf(dir).clips.find((x) => x.id === clipId);
    if (!c) return null;
    return waveform(path.join(dir, c.file), 40).catch(() => null);
  });
  h("projects:sfxMode", (projectId, mode) => {
    if (!["auto", "library", "off"].includes(mode)) throw new Error("Unknown effects choice.");
    const { dir } = musicDir(projectId),
      f = path.join(dir, "project.json"),
      pj = JSON.parse(fs.readFileSync(f, "utf8"));
    pj.sound = { ...(pj.sound ?? {}), effects: mode };
    fs.writeFileSync(f, JSON.stringify(pj, null, 1));
    markDirty(projectId);
    return { effects: effectsModeOf(dir), needsSound: fs.existsSync(path.join(dir, "audio", "sfx_bed.wav")) };
  });
  h("projects:choiceDefaults", () => {
    const c = getConfig().claude;
    return { ...overridesView(null), claude: { globalModel: c.model || null, globalEffort: c.effort || "medium" } };
  });
  h("projects:setOverrides", (projectId, patch) => {
    setOverrides(String(projectId), patch && typeof patch === "object" ? patch : {});
    if (patch && ("image" in patch || "imageModel" in patch)) writeContext(String(projectId));
    return overridesView(String(projectId));
  });
  h("claude:running", () => runningTasks().filter((t) => t.kind !== "harvest"));
  h("claude:threads", (projectId) => listThreads(projectId));
  h("claude:messages", (threadId) => threadMessages(threadId));
  h("claude:deleteThread", (threadId) => {
    if (isThreadBusy(threadId)) throw new Error("Claude is still working in this conversation.");
    return q.run("DELETE FROM threads WHERE id=?", threadId);
  });
  h("edits:list", (projectId) =>
    listEdits(projectId).map((e) => ({
      ...e,
      files: JSON.parse(e.files || "[]"),
      selection: JSON.parse(e.selection || "[]"),
      compare: editCompare(projectId, e.id),
    })),
  );
  h("edits:revert", (id) => revertEdit(id));
  h("edits:reapply", (id) => reapplyEdit(id));
  h("edits:restore", (id) => restoreBefore(id));
  h("edits:diff", async (id) => {
    const e = getEdit(id);
    if (!e?.commit_before || !e.commit_after) return "";
    return diff(getProject(e.project_id).path, e.commit_before, e.commit_after);
  });
  h("edits:gitlog", (projectId) => log$1(getProject(projectId).path));
  h("stats", () =>
    q.get(`SELECT COUNT(*) AS edits, COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(duration_ms),0) AS ms,
      SUM(status IN ('done','no-change')) AS ok FROM edits`),
  );
  h("usage:summary", () => usageSummary());
  h("usage:setPlan", (kind, custom) => setUsagePlan(kind, custom));
  if (process.env.CZ_TEST_HOOKS === "1") h("test:usage", (mode, seed) => testUsage(mode, seed));
  h("edits:recent", () =>
    q.all(
      `SELECT e.id, e.instruction, e.status, e.created_at, e.project_id, p.name AS project_name FROM edits e JOIN projects p ON p.id=e.project_id ORDER BY e.created_at DESC LIMIT 8`,
    ),
  );
  const busy = new Set();
  h("pipeline:run", async (projectId, step, opts) => {
    const key2 = projectId + step;
    if (busy.has(key2)) throw new Error("That step is already running.");
    if ((step === "clean" || step === "timeline") && isProjectBusy(projectId))
      throw new Error(
        "Claude is working on this project. Run this when it has finished (or press Stop): it changes the timing Claude builds to.",
      );
    busy.add(key2);
    const p = getProject(projectId),
      log2 = (line) => send("pipeline:log", { projectId, step, line });
    try {
      const r = await runStep(step, p.path, { ...opts, projectId }, log2);
      markDirty(projectId);
      writeContext(projectId);
      if (step === "clean" || step === "timeline") stepSucceeded(projectId, step, (j) => send("voice:progress", j));
      return r ?? true;
    } finally {
      busy.delete(key2);
      send("channels:changed", { what: "files" });
    }
  });
  h("pipeline:cancel", (projectId) => cancelStep(getProject(projectId).path));
  const running2 = new Map();
  const exporting = async (projectId, kind, run) => {
    const key2 = projectId + "export";
    if (busy.has(key2)) throw new Error("An export is already running.");
    busy.add(key2);
    running2.set(projectId, { kind, prog: null });
    try {
      const r = await run((prog) => {
        running2.get(projectId).prog = prog;
        send("render:progress", { projectId, ...prog });
        getWin()?.setProgressBar(prog.pct ?? prog.frame / Math.max(1, prog.frames));
      });
      const w = getWin();
      if (w && !w.isFocused() && canNotify()) {
        const n = new Notification({
          title: "Export finished",
          body: `${path.basename(r.path)} · ${Math.round(r.seconds)}s (${r.realtime}× realtime)`,
        });
        n.on("click", () => {
          w.show();
          w.focus();
        });
        n.show();
      }
      send("render:done", { projectId, kind, result: r });
      return r;
    } catch (e) {
      if (e.message === "Export cancelled") {
        send("render:done", { projectId, kind, cancelled: true });
        return { cancelled: true };
      }
      send("render:done", { projectId, kind, error: e.message });
      throw e;
    } finally {
      running2.delete(projectId);
      busy.delete(key2);
      getWin()?.setProgressBar(-1);
      send("channels:changed", { what: "files" });
    }
  };
  const claudeFix = (projectId, instruction) =>
    new Promise((resolve, reject) => {
      const emit = (ev) => {
        emitTask(ev);
        if (ev.type === "done")
          ev.status === "done" || ev.status === "no-change" ? resolve() : reject(new Error(ev.error || "Claude could not fix it."));
      };
      runTask(
        { projectId, threadId: projectThread(projectId)?.id ?? null, kind: "edit", scope: "video", selection: [], instruction, auto: true },
        emit,
      ).catch(reject);
    });
  function buildSweep(projectId) {
    setTimeout(async () => {
      try {
        if (isProjectBusy(projectId)) return;
        const sw = await sweepErrors(projectId, 10);
        if (!sw?.errors.length) {
          log("build sweep clean", projectId, sw?.frames ?? 0, "frames");
          return;
        }
        log("build sweep", projectId, sw.errors.length, "frame(s) throw: auto-fix");
        const where = sw.errors
          .slice(0, 8)
          .map((x) => `- at ${x.t.toFixed(2)}s, ${x.where}: ${x.message}`)
          .join("\n");
        await claudeFix(
          projectId,
          `AFTER-BUILD CHECK: the app drew every frame the export will draw, and these frames throw an error (the export would fail there):
${where}
Fix the CAUSE in the scene code so every frame draws (a property of something that does not exist, a value out of range at a shot's first or last frame, a helper called with the wrong object), keeping each shot as intended. Then check_preview and render_frames at each of those times to confirm. Change nothing else.`,
        );
      } catch (e) {
        log("build sweep failed", projectId, e?.message || e);
      }
    }, 1500);
  }
  h("render:export", (projectId, opts) =>
    exporting(projectId, "video", async (prog) => {
      for (let round = 1; ; round++) {
        try {
          return await exportVideo(projectId, opts, prog);
        } catch (e) {
          const msg = String(e?.message || e);
          if (round > 2 || opts?.autofix === false || !/A scene throws an error/.test(msg) || isProjectBusy(projectId)) throw e;
          const at = /at (\d+:\d+(?:\.\d+)?)/.exec(msg)?.[1] ?? "";
          prog({
            frame: 0,
            frames: 1,
            fps: 0,
            phase: `A scene throws an error${at ? ` at ${at}` : ""}: Claude is fixing it (see the Claude panel), then the export starts again`,
          });
          log("export autofix", projectId, "round", round, msg.slice(0, 200));
          const sw = await sweepErrors(projectId).catch(() => null);
          const where = sw?.errors.length
            ? sw.errors
                .slice(0, 8)
                .map((x) => `- at ${x.t.toFixed(2)}s, ${x.where}: ${x.message}`)
                .join("\n")
            : `- ${msg}`;
          try {
            await claudeFix(
              projectId,
              `EXPORT AUTO-FIX: exporting this video failed because a scene throws an error at a frame the export draws (the preview may never show that moment: often frames right at a shot change). Every frame that throws:
${where}
Fix the CAUSE in the scene code so every frame draws (a property of something that does not exist, a value out of range at the shot's first or last frame, a helper called with the wrong object), keeping each shot as intended. Then check_preview and render_frames at each of those times to confirm. Change nothing else.`,
            );
          } catch (fx) {
            throw new Error(`${msg} (Claude tried to fix it automatically: ${String(fx?.message || fx).slice(0, 160)})`);
          }
          prog({ frame: 0, frames: 1, fps: 0, phase: "Fixed: exporting again" });
        }
      }
    }),
  );
  let runningLate = 0;
  h("render:running", async (projectId) => {
    if (runningLate) await new Promise((r) => setTimeout(r, runningLate));
    return running2.get(projectId) ?? null;
  });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:runningLate", (ms) => {
      runningLate = Math.max(0, Math.min(1e4, +ms || 0));
      return true;
    });
  h("vertical:info", (projectId) => verticalInfo(projectId));
  h("vertical:shots", (projectId, source) => verticalShots(projectId, source === "reframe" ? "reframe" : "cut"));
  h("vertical:frames", (projectId, source, times, captions) =>
    verticalFrames(
      projectId,
      source,
      (times || []).filter((t) => isFinite(t)),
      captions !== false,
    ),
  );
  h("vertical:card", (projectId, o) => endCardPreview(projectId, o));
  h("vertical:logo", (file) => setLogo(file ? String(file) : null));
  h("vertical:export", (projectId, o) =>
    exporting(projectId, o?.length === "trailer" ? "trailer" : o?.length === "range" ? "clip" : "vertical", (prog) =>
      exportVertical(projectId, o, prog),
    ),
  );
  const reframing = new Map();
  h("vertical:reframe", async (projectId, o) => {
    const earlier = reframing.get(projectId);
    if (earlier) return { ...(await earlier), started: false };
    const job = (async () => {
      if (!o?.dryRun && !claudeExecutable()) throw new Error(NO_CLAUDE);
      if (isProjectBusy(projectId) && !reframeOf(projectId))
        throw new Error(
          "Claude is still working on this video. Make the 9:16 version when it is done, so the copy has the finished scenes.",
        );
      const sib = await makeReframe(projectId);
      if (o?.dryRun && process.env.CZ_TEST_HOOKS === "1") {
        const pj = JSON.parse(fs.readFileSync(path.join(sib.path, "project.json"), "utf8")),
          st = getStyle(sib.style_id);
        return {
          project: sib,
          started: false,
          prompt: reframePrompt({ skill: st.skill, styleId: st.id, orig: pj.reframeOf?.title || "" }),
        };
      }
      if (reframeState(sib.id) === "running") return { project: sib, started: false };
      await runTask({ projectId: sib.id, kind: "reframe", instruction: REFRAME_TASK, newSession: !projectThread(sib.id) }, emitTask);
      return { project: sib, started: true };
    })();
    reframing.set(projectId, job);
    try {
      return await job;
    } finally {
      reframing.delete(projectId);
    }
  });
  h("render:cancel", (projectId) => cancelExport(projectId));
  registerRoutinesIpc(h, { send, getWin, emitTask, exporting });
  h("render:still", (projectId, t) => saveFrame(projectId, t));
  h("render:list", (projectId) =>
    q
      .all(
        `SELECT r.*, p.name AS project_name FROM renders r JOIN projects p ON p.id=r.project_id
      WHERE r.kind != 'style-preview' AND COALESCE(r.path, '') NOT LIKE '%style_preview.mp4' ${projectId ? "AND r.project_id=?" : ""} ORDER BY r.created_at DESC LIMIT 100`,
        ...(projectId ? [projectId] : []),
      )
      .map((r) => ({ ...r, exists: !!r.path && fs.existsSync(r.path) })),
  );
}
function facelessThumb(id, dir) {
  const f = coverFile(dir);
  return f ? projectUrl(id, ".suite/" + f) + "?v=" + Math.round(fs.statSync(path.join(dir, ".suite", f)).mtimeMs) : null;
}
