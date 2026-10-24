import * as electron from "electron";
const INVOKE = /^(help:(ask|feedback|context|clean|draft|create|reports|post|capture)|test:helpSearch|anims:(list|import|remove|folder)|chars:(list|upload|remove|sheet|bones|setMapping|rename)|toonchars:(list|save|remove|describe)|app:info|app:zoom|app:copy|app:copyImage|app:diagnostics|config:(get|set)|graphics:(state|set|failed|restart|keep)|test:crashWindow|test:restoreWindow|gfx:(save|presets|savePreset|deletePreset)|plan:(get|testSet)|shell:(open|reveal|external|source)|dialog:(file|folder)|health|stats|usage:(summary|setPlan)|speech:(state|setup|cancel|language|stableTs)|customapi:\w+|experimental:(state|enable|disable|login|cancelLogin|models|remove|retry|switch)|test:cliproxyVerify|engines:(state|refresh|codexLogin|codexDeviceLogin|codexCancelLogin|codexOpenLogin|codexLogout|codexInstall|codexProbe|codexPath)|test:(codexMap|fakeCodex|codexProbe|codexSpawnHidden|codexCandidates|codexTreeKill|codexProbeKey|codexRealPath)|sfxlib:\w+|scriptskill:(state|pick|paste|set|remove|ownPick|ownPaste|ownGet)|tools:installPython|projects:\w+|presets:\w+|styles:\w+|characters:\w+|rules:\w+|claude:\w+|edits:\w+|pipeline:(run|cancel)|preview:kill|render:(export|cancel|list|still|running)|vertical:(info|shots|frames|card|logo|export|reframe)|update:(status|check|install)|personal:\w+|layouts:\w+|boards:\w+|higgsfield:\w+|images:\w+|channels:\w+|youtube:\w+|voice:\w+|routines:\w+|references:\w+|studio:\w+|library:(search|get|list|update|delete|browse|detail|file|reveal|restore|trash|emptyTrash|ship|proposed|harvestNow|harvestState|lastHarvest|harvestFor)|test:library|test:refPrompt|test:refRead|test:personalAfter|test:personalStart|test:speechAccept|test:stickmanSprites|test:stickmanWeb|test:speechPrompt|test:taskPrompt|test:libraryPrompt|test:usageLimits|test:studioCreate|test:seedChat|test:reloadStyles|test:styleSnapshot|test:installPackage|test:restorePrevious|test:packageVersions|test:styleImport|test:styleOf|test:pwned|test:fakeRunning|test:fakeClaude|test:claudeTurns|test:editTools|test:suiteTool|test:workerPool|test:forClaude|test:reframeDone|test:paintCaption|test:runningLate|test:claudeDone|test:labDone|test:claudeCandidates|test:pathSafe|test:fakeProjects|test:clearFakeProjects|test:projectStage|test:setStatus|test:externalUrls|test:ytTick|test:ytPrompt|test:ytStubDelay|test:ytStubFail|test:scriptPrompt|test:nextPick|test:opened|test:stuckQuit|test:lang|test:usage)$/;
const EVENTS = new Set(["help:report", "anims:changed", "anims:progress", "chars:changed", "chars:progress", "plan:changed", "graphics:switched", "claude:frames", "claude:event", "characters:changed", "characters:progress", "claude:login-log", "project:changed", "projects:covers", "pipeline:log", "render:progress", "render:done", "rules:suggested", "library:changed", "library:harvest", "ui:zoom", "update:status", "personal:media", "personal:job", "personal:changed", "higgsfield:job", "speech:state", "customapi:state", "experimental:state", "experimental:login-log", "engines:changed", "engines:login-log", "images:blocked", "channels:changed", "youtube:changed", "youtube:sync", "voice:progress", "voice:install", "routines:changed", "routines:item", "routines:run", "routines:notice", "routines:finding", "sfxlib:changed", "references:changed", "references:progress", "studio:changed", "styles:changed", "styles:importChanged"]);
electron.contextBridge.exposeInMainWorld("suite", {
  invoke: (channel, ...args) => {
    if (!INVOKE.test(channel)) return Promise.reject(new Error(`blocked channel ${channel}`));
    return electron.ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) throw new Error(`blocked event ${channel}`);
    const l = (_e, p) => cb(p);
    electron.ipcRenderer.on(channel, l);
    return () => electron.ipcRenderer.removeListener(channel, l);
  },
  platform: process.platform,
  // a file the user really dropped (a page cannot make one up): main notes that this path may be read (recordings)
  pathForFile: (f) => {
    try {
      const p = electron.webUtils.getPathForFile(f);
      if (p) electron.ipcRenderer.send("files:dropped", p);
      return p;
    } catch {
      return "";
    }
  }
});
