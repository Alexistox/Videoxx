import fs from "node:fs";
import { BrowserWindow, dialog } from "electron";
import { sweepErrors } from "../render/workers";
import { grantedUpload } from "../channels/youtubeAuth";
import { clearCache, readerWindows, readersOpened, setTestBase } from "../channels/youtubeReader";
import { listChannels, signInChannel } from "../channels/youtubeSync";
import { DEFAULT_SETTINGS } from "../routines/nodes";
import { TEMPLATES } from "../routines/templates";
import { kokoroVoices } from "../voice/kokoro";
import { MAX_THUMB_REFS, addRefs, previewUrl, refPreviews } from "../routines/thumbRefs";
import { knownView, liveIds, testFeed, testLast } from "../channels/knownTopics";
import { analyzeThumbRefs, thumbTest } from "../routines/runners";
import {
  answerApproval,
  cancelRun,
  check,
  checkContext,
  createRoutine,
  deleteRoutine,
  deleteRun,
  duplicateRoutine,
  getRoutine,
  getRun,
  initRoutines,
  listRoutines,
  listRuns,
  resumeRun,
  saveRoutine,
  startEffortTest,
  startRun,
} from "../routines/routines";

export function registerRoutinesIpc(h, deps) {
  initRoutines(deps);
  h("routines:list", () => listRoutines());
  h("routines:get", (id) => getRoutine(String(id)));
  h("routines:create", (name, template) => {
    const t = template ? TEMPLATES.find((x) => x.id === template) : null;
    return createRoutine(name || t?.name || "Untitled routine", t ? t.make() : void 0);
  });
  h("routines:import", (data) => {
    if (!data || typeof data !== "object" || !data.graph) throw new Error("That file is not a routine exported from Videoxx.");
    const r = createRoutine(String(data.name || "Imported routine"), data.graph);
    return data.settings ? saveRoutine(r.id, { settings: data.settings }) : r;
  });
  h("routines:save", (id, patch) => saveRoutine(String(id), patch || {}));
  h("routines:duplicate", (id) => duplicateRoutine(String(id)));
  h("routines:delete", (id) => deleteRoutine(String(id)));
  h("routines:check", (graph) => check(graph));
  h("routines:context", () => {
    const c = checkContext();
    let yt = [];
    try {
      yt = listChannels()
        .filter((x) => x.own || x.access === "oauth")
        .map((x) => ({ id: x.id, title: x.title, signedIn: x.signedIn, upload: grantedUpload(x.id) }));
    } catch {}
    let kokoro = [];
    try {
      kokoro = kokoroVoices();
    } catch {}
    let ytAll = [];
    try {
      ytAll = listChannels().map((x) => ({
        id: x.id,
        title: x.title,
        own: x.own,
        videos: liveIds(x.id).size,
        syncing: x.syncing,
        failed: x.readFailed,
        read: !!x.fetchedAt,
      }));
    } catch {}
    return { ...c, yt, ytAll, kokoro };
  });
  h("routines:allowUpload", async () => {
    const r = await signInChannel(true);
    return { channels: r.channels.map((c) => c.id) };
  });
  h("routines:run", (id, parallel) => startRun(String(id), "manual", !!parallel));
  h("routines:effortTest", (id, variants, audio) =>
    startEffortTest(String(id), Array.isArray(variants) ? variants : [], Array.isArray(audio) ? audio.map(String) : void 0),
  );
  h("routines:runs", (routineId) => listRuns(String(routineId)));
  h("routines:runGet", (runId) => getRun(String(runId)));
  h("routines:cancel", (runId) => cancelRun(String(runId)));
  h("routines:approve", (runId, itemId, ok) => answerApproval(String(runId), String(itemId), !!ok));
  h("routines:resume", (runId, itemId) => resumeRun(String(runId), itemId ? String(itemId) : void 0));
  h("routines:runDelete", (runId) => deleteRun(String(runId)));
  h("routines:knownVideos", (ytChannel, channelId, refresh2, format) =>
    knownView(String(ytChannel ?? ""), String(channelId ?? ""), !!refresh2, format === "long" || format === "short" ? format : "both"),
  );
  h("routines:thumbRefsPick", async () => {
    const w = deps.getWin(),
      o = {
        title: "Add reference thumbnails",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp"] }],
      };
    const r = w ? await dialog.showOpenDialog(w, o) : await dialog.showOpenDialog(o);
    return r.canceled ? [] : addRefs(r.filePaths.slice(0, MAX_THUMB_REFS));
  });
  h("routines:thumbRefsGet", (ids) => refPreviews(ids));
  h("routines:thumbAnalyze", (ids, s) =>
    analyzeThumbRefs(
      new AbortController().signal,
      { ...DEFAULT_SETTINGS, model: String(s?.model ?? ""), effort: String(s?.effort ?? "") },
      Array.isArray(ids) ? ids.map(String) : [],
    ),
  );
  h("routines:thumbVariations", (runId, itemId) => {
    const it = getRun(String(runId)).items.find((x) => x.id === String(itemId)),
      list = it?.ctx?.thumbVariations ?? [];
    return {
      pick: it?.ctx?.thumbPick ?? null,
      list: list.map((v) => ({
        n: v.n,
        prompt: v.prompt,
        error: v.error,
        winner: v.winner,
        url: v.file && fs.existsSync(v.file) ? previewUrl(v.file, 480) : null,
      })),
    };
  });
  if (process.env.CZ_TEST_HOOKS === "1") {
    h("routines:testThumbRefs", (files) => addRefs(files.map(String)));
    h("routines:testThumb", () => thumbTest);
    h("routines:testSweep", (projectId) => sweepErrors(String(projectId)));
    h("routines:testFeed", (yt, vids) => {
      testFeed.set(String(yt), Array.isArray(vids) ? vids : []);
      return true;
    });
    h("routines:testLastPrompt", () => testLast.prompt);
    h("routines:testReader", (clear, base) => {
      if (clear) clearCache();
      if (base !== void 0) setTestBase(base || null);
      return {
        windows: readerWindows(),
        opened: readersOpened,
        all: BrowserWindow.getAllWindows().filter((w) => !w.isVisible()).length,
        search: testLast.search,
      };
    });
    h("routines:testCandidates", (titles) => {
      testLast.cands = Array.isArray(titles) ? titles.map(String) : null;
      return true;
    });
  }
}
