import path from "node:path";
import fs from "node:fs";
import { Notification } from "electron";
import { log } from "../core/log";
import { now, q, uid } from "../db/db";
import { claudeExecutable } from "../engines/claudeCli";
import { allStyles, baseOf } from "../styles/catalog";
import { customReady } from "../images/customProviders";
import { hasImageKey, providerStatus } from "../images/providers";
import { ownSkillNames, pruneOwnSkills, scriptSkillState } from "../projects/scriptSkill";
import { duplicateProject, getProject } from "../projects/projects";
import { requireFeature } from "../app/plan";
import { listChannels as listChannels$1 } from "../channels/channels";
import { grantedUpload } from "../channels/youtubeAuth";
import { listChannels } from "../channels/youtubeSync";
import { DEFAULT_SETTINGS, NODE, isLevel, nextRun, topicFormatOf, validate, variantName, withDefaults } from "./nodes";
import { canNotify } from "../app/updater";
import { fishKeyStatus } from "../voice/fish";
import { isGranted } from "../voice/recordings";
import { keyStatus } from "../voice/elevenlabs";
import { kokoroFiles } from "../voice/kokoro";
import { pruneRefs, refIds } from "./thumbRefs";
import { RUNNERS } from "./runners";

let D;
export const initRoutines = (d) => {
  D = d;
  try {
    const inUse = new Set(),
      refsInUse = new Set();
    for (const r of [...q.all("SELECT graph FROM routines"), ...q.all("SELECT graph FROM routine_runs")])
      for (const n of parse(r.graph, { nodes: [] }).nodes ?? []) {
        if (n?.settings?.ownSkill?.id) inUse.add(String(n.settings.ownSkill.id));
        for (const x of Array.isArray(n?.settings?.refImages) ? n.settings.refImages : []) if (x?.id) refsInUse.add(String(x.id));
      }
    pruneOwnSkills(inUse);
    pruneRefs(refsInUse);
  } catch {}
};
const MAX_GRAPH = 4 * 1024 * 1024;
const parse = (s, d) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};
function cleanGraph(g, prev) {
  const nodes = (Array.isArray(g?.nodes) ? g.nodes : [])
    .filter((n) => n && typeof n.id === "string" && NODE[n.type])
    .map((n) =>
      withDefaults({
        id: n.id.slice(0, 64),
        type: n.type,
        x: Math.round(+n.x || 0),
        y: Math.round(+n.y || 0),
        settings: n.settings && typeof n.settings === "object" ? n.settings : {},
        ...(n.off ? { off: true } : {}),
      }),
    );
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(g?.edges) ? g.edges : [])
    .filter((e) => e && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e) => ({ id: String(e.id || uid("e_")).slice(0, 64), from: e.from, to: e.to }));
  const had = new Set(
    (prev?.nodes ?? []).flatMap((n) => (n.type === "myAudio" && Array.isArray(n.settings?.files) ? n.settings.files : [])),
  );
  for (const n of nodes)
    if (n.type === "myAudio")
      n.settings.files = (Array.isArray(n.settings.files) ? n.settings.files : []).filter(
        (f) => typeof f === "string" && (had.has(f) || isGranted(f)),
      );
  const v = g?.view;
  const view2 = v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z) ? { x: +v.x, y: +v.y, z: Math.min(4, Math.max(0.1, +v.z)) } : void 0;
  return { nodes, edges, ...(view2 ? { view: view2 } : {}) };
}
const cleanSettings = (s) => {
  const o = { ...DEFAULT_SETTINGS, ...(s && typeof s === "object" ? s : {}) };
  const int = (v, lo, hi, d) => {
    const n = Math.round(+v);
    return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    perRun: int(o.perRun, 1, 100, 10),
    perDay: int(o.perDay, 1, 500, 20),
    parallel: int(o.parallel, 1, 3, 1),
    onFailure: o.onFailure === "stop" ? "stop" : "skip",
    model: typeof o.model === "string" ? o.model : "",
    effort: EFFORTS.includes(o.effort) ? o.effort : "",
    ...(Array.isArray(o.test) ? { test: cleanVariants(o.test) } : {}),
    ...(isLevel(o.buildLevel) ? { buildLevel: o.buildLevel } : {}),
  };
};
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const cleanVariants = (v) =>
  v
    .filter((x) => isLevel(x?.level) && EFFORTS.includes(x?.effort))
    .slice(0, 8)
    .map((x) => ({ level: x.level, effort: x.effort }));
const scheduleOn = (n) => !!n && !n.off && !!n.settings?.on;
function view(r) {
  const graph = parse(r.graph, { nodes: [], edges: [] }),
    sch = graph.nodes.find((n) => n.type === "schedule");
  const next = scheduleOn(sch) ? nextRun(sch.settings, new Date(r.sched_at || r.created_at)) : null;
  const running2 = [...live.values()].find((l) => l.routineId === r.id);
  return {
    id: r.id,
    name: r.name,
    graph,
    settings: cleanSettings(parse(r.settings, {})),
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_run_at: r.last_run_at,
    nextRun: next ? next.toISOString() : null,
    running: running2?.runId ?? null,
  };
}
const row = (id) => {
  const r = q.get("SELECT * FROM routines WHERE id=?", id);
  if (!r) throw new Error("That routine no longer exists.");
  return r;
};
export const listRoutines = () =>
  q.all("SELECT * FROM routines ORDER BY created_at DESC").map((r) => {
    const v = view(r);
    return {
      id: v.id,
      name: v.name,
      updated_at: v.updated_at,
      last_run_at: v.last_run_at,
      nextRun: v.nextRun,
      running: v.running,
      nodes: v.graph.nodes.filter((n) => n.type !== "note").length,
      live: liveVideos(r.id),
    };
  });
function liveVideos(routineId) {
  const out = [];
  for (const l of live.values()) {
    if (l.routineId !== routineId) continue;
    if (!l.queue.length) {
      out.push({
        runId: l.runId,
        itemId: null,
        label: l.tag ? `Getting ready · ${l.tag}` : "Finding the topic…",
        status: "running",
        step: "",
        projectId: null,
      });
      continue;
    }
    for (const it of l.queue) {
      const curId = Object.keys(it.nodes).find((id) => ["running", "approval"].includes(it.nodes[id].status)),
        n = curId ? l.graph.nodes.find((x) => x.id === curId) : null;
      out.push({
        runId: l.runId,
        itemId: it.id,
        label: it.label + (l.tag ? ` · ${l.tag}` : ""),
        status: it.status,
        step: n ? (NODE[n.type]?.label ?? "") : "",
        projectId: it.projectId,
      });
    }
  }
  return out;
}
export const getRoutine = (id) => view(row(id));
const changed = () => D?.send("routines:changed", {});
export function createRoutine(name, graph) {
  const id = uid("rtn_"),
    t = now(),
    g = cleanGraph(graph ?? { nodes: [], edges: [] });
  const s = JSON.stringify(g);
  if (s.length > MAX_GRAPH) throw new Error("This routine is too big to save.");
  q.run(
    "INSERT INTO routines(id,name,graph,settings,sched_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    id,
    cleanName(name),
    s,
    JSON.stringify(DEFAULT_SETTINGS),
    t,
    t,
    t,
  );
  changed();
  return getRoutine(id);
}
const cleanName = (n) =>
  String(n ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Untitled routine";
export function saveRoutine(id, patch) {
  const r = row(id),
    t = now();
  let edited = patch.settings !== void 0 || (patch.name !== void 0 && cleanName(patch.name) !== r.name);
  if (patch.name !== void 0) q.run("UPDATE routines SET name=? WHERE id=?", cleanName(patch.name), id);
  if (patch.graph !== void 0) {
    const prev = parse(r.graph, { nodes: [], edges: [] }),
      g = cleanGraph(patch.graph, prev),
      s = JSON.stringify(g);
    if (JSON.stringify({ ...g, view: void 0 }) !== JSON.stringify({ ...prev, view: void 0 })) edited = true;
    if (s.length > MAX_GRAPH) throw new Error("This routine is too big to save (more than 4 MB).");
    const was = prev.nodes.find((n) => n.type === "schedule"),
      is = g.nodes.find((n) => n.type === "schedule");
    const fresh = scheduleOn(is) && (!scheduleOn(was) || JSON.stringify(was.settings) !== JSON.stringify(is.settings));
    q.run("UPDATE routines SET graph=?" + (fresh ? ", sched_at=?" : "") + " WHERE id=?", ...(fresh ? [s, t, id] : [s, id]));
  }
  if (patch.settings !== void 0) q.run("UPDATE routines SET settings=? WHERE id=?", JSON.stringify(cleanSettings(patch.settings)), id);
  if (edited) q.run("UPDATE routines SET updated_at=? WHERE id=?", t, id);
  changed();
  return getRoutine(id);
}
export function duplicateRoutine(id) {
  const r = getRoutine(id);
  const c = createRoutine(`${r.name} (copy)`, r.graph);
  return saveRoutine(c.id, { settings: r.settings });
}
export function deleteRoutine(id) {
  row(id);
  if ([...live.values()].some((l) => l.routineId === id)) throw new Error("This routine is running. Cancel its run first, then delete it.");
  q.run("DELETE FROM routines WHERE id=?", id);
  changed();
  return true;
}
export function checkContext() {
  let yt = [];
  try {
    yt = listChannels()
      .filter((c) => grantedUpload(c.id))
      .map((c) => c.id);
  } catch {}
  return {
    hasClaude: !!claudeExecutable(),
    hasEleven: keyStatus().hasKey,
    hasFish: fishKeyStatus().hasKey,
    hasKokoro: !!kokoroFiles(),
    hasImageKey: hasImageKey(),
    channels: listChannels$1().map((c) => c.id),
    ytUpload: yt,
    bases: Object.fromEntries(allStyles().map((s) => [s.id, baseOf(s.id)])),
    styleNames: Object.fromEntries(allStyles().map((s) => [s.id, s.name])),
    formats: Object.fromEntries(
      allStyles()
        .filter((s) => s.pkg)
        .map((s) => [s.id, (s.aspects ?? ["16:9"]).map((a) => (a === "9:16" ? "vertical" : "landscape"))]),
    ),
    scriptSkill: (() => {
      const s = scriptSkillState();
      return s.on ? "on" : s.has ? "off" : "none";
    })(),
    scriptSkillName: scriptSkillState().name,
    ownSkills: ownSkillNames(),
    images: (() => {
      const st = providerStatus();
      return {
        setting: st.setting,
        has: { higgsfield: st.higgsfield.hasKey, fal: st.fal.hasKey, custom: !!st.custom && customReady("image"), flow: st.flow.opened },
        models: st.higgsfieldModels.map((m) => m.id),
      };
    })(),
    thumbRefs: refIds(),
  };
}
export const check = (graph) => validate(graph, checkContext());
const live = new Map();
let expanding = Promise.resolve();
export const routinesRunning = () => live.size;
const toItem = (r) => ({
  id: r.id,
  runId: r.run_id,
  idx: r.idx,
  label: r.label ?? "",
  source: r.source ?? "",
  status: r.status,
  projectId: r.project_id,
  ctx: parse(r.context, {}),
  nodes: parse(r.nodes, {}),
  error: r.error,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});
function saveItem(it) {
  if (shuttingDown) return;
  q.run(
    "UPDATE routine_items SET status=?, project_id=?, context=?, nodes=?, error=?, started_at=?, finished_at=?, label=? WHERE id=?",
    it.status,
    it.projectId,
    JSON.stringify(it.ctx),
    JSON.stringify(it.nodes),
    it.error,
    it.startedAt,
    it.finishedAt,
    it.label,
    it.id,
  );
  D?.send("routines:item", it);
}
function runView(r) {
  const items = q.all("SELECT * FROM routine_items WHERE run_id=? ORDER BY idx", r.id).map(toItem);
  return {
    id: r.id,
    routineId: r.routine_id,
    status: r.status,
    trigger: r.trigger,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    summary: r.summary,
    graph: parse(r.graph, { nodes: [], edges: [] }),
    items,
    live: live.has(r.id),
  };
}
export const listRuns = (routineId) =>
  q.all("SELECT * FROM routine_runs WHERE routine_id=? ORDER BY started_at DESC LIMIT 30", routineId).map((r) => {
    const c = q.all("SELECT status, COUNT(*) n FROM routine_items WHERE run_id=? GROUP BY status", r.id);
    return {
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      summary: r.summary,
      counts: Object.fromEntries(c.map((x) => [x.status, x.n])),
      live: live.has(r.id),
    };
  });
export const getRun = (runId) => {
  const r = q.get("SELECT * FROM routine_runs WHERE id=?", runId);
  if (!r) throw new Error("That run no longer exists.");
  return runView(r);
};
function setRun(runId, status, summary) {
  if (shuttingDown) return;
  q.run(
    "UPDATE routine_runs SET status=?, finished_at=?, summary=COALESCE(?, summary) WHERE id=?",
    status,
    ["running", "waiting"].includes(status) ? null : now(),
    summary ?? null,
    runId,
  );
  D?.send("routines:run", { runId, status });
  changed();
}
export async function startRun(routineId, trigger = "manual", parallel = false) {
  requireFeature("routines");
  const r = getRoutine(routineId);
  if (r.running && !parallel) throw new Error("This routine is already running.");
  const problems = check(r.graph).filter((p) => !p.warn);
  if (problems.length) throw Object.assign(new Error(problems.map((p) => p.text).join("\n")), { problems });
  const runId = uid("run_"),
    t = now();
  q.run(
    "INSERT INTO routine_runs(id,routine_id,status,trigger,graph,settings,started_at) VALUES(?,?,?,?,?,?,?)",
    runId,
    routineId,
    "running",
    trigger,
    JSON.stringify(r.graph),
    JSON.stringify(r.settings),
    t,
  );
  q.run("UPDATE routines SET last_run_at=? WHERE id=?", t, routineId);
  const l = makeLive(runId, routineId, r.graph, r.settings);
  l.done = (async () => {
    const prev = expanding;
    let release;
    expanding = new Promise((res) => {
      release = res;
    });
    try {
      await prev;
      await expand(l);
    } catch (e) {
      log("routine expand failed", e?.message);
      setRun(runId, "failed", String(e?.message || e));
      live.delete(runId);
      changed();
      return;
    } finally {
      release();
    }
    await drive(l);
  })();
  changed();
  return { runId };
}
export async function startEffortTest(routineId, variants, audio) {
  requireFeature("routines");
  const r = getRoutine(routineId);
  if (r.running) throw new Error("This routine is already running. Wait for it, or cancel it, then start the effort test.");
  const seen = new Set(),
    list = cleanVariants(Array.isArray(variants) ? variants : []).filter((v) => {
      const k = v.level + "/" + v.effort;
      return !seen.has(k) && !!seen.add(k);
    });
  if (list.length < 2) throw new Error("Add at least two different builds to compare.");
  const build = r.graph.nodes.find((n) => n.type === "buildVideo" && !n.off);
  if (!build) throw new Error("This routine has no Build video step to test.");
  const files = (Array.isArray(audio) ? audio : []).map(String).filter((f) => isGranted(f) && fs.existsSync(f));
  if (Array.isArray(audio) && audio.length && files.length < audio.length)
    throw new Error("A recording is missing or was not picked here. Add it again.");
  if (files.length) return effortTestFromRecording(r, list, files, build);
  const problems = check(r.graph).filter((p) => !p.warn);
  if (problems.length) throw Object.assign(new Error(problems.map((p) => p.text).join("\n")), { problems });
  const lives = testLives(r, list),
    [first, ...rest] = lives;
  (async () => {
    const prev = expanding;
    let release;
    expanding = new Promise((res) => {
      release = res;
    });
    try {
      await prev;
      await expand(first);
    } catch (e) {
      log("routine expand failed", e?.message);
      for (const l of lives) {
        setRun(l.runId, "failed", String(e?.message || e));
        live.delete(l.runId);
      }
      changed();
      return;
    } finally {
      release();
    }
    if (!first.queue.length) {
      for (const l of rest) {
        setRun(l.runId, "done", "Nothing to make: the inputs gave no topics.");
        live.delete(l.runId);
      }
      changed();
      return;
    }
    for (const it of first.queue) {
      it.ctx.effortTag = first.tag;
      saveItem(it);
    }
    for (const l of rest) {
      for (const src of first.queue) {
        const it = {
          ...src,
          id: uid("itm_"),
          runId: l.runId,
          ctx: { ...JSON.parse(JSON.stringify(src.ctx)), effortTag: l.tag },
          nodes: JSON.parse(JSON.stringify(src.nodes)),
        };
        q.run(
          "INSERT INTO routine_items(id,run_id,idx,label,source,status,context,nodes) VALUES(?,?,?,?,?,?,?,?)",
          it.id,
          l.runId,
          it.idx,
          it.label,
          it.source,
          "waiting",
          JSON.stringify(it.ctx),
          JSON.stringify(it.nodes),
        );
        l.queue.push(it);
      }
      D.send("routines:run", { runId: l.runId, status: "running" });
    }
    for (const l of lives) l.done = drive(l);
  })();
  changed();
  return { runIds: lives.map((l) => l.runId) };
}
function testLives(r, list) {
  const t = now(),
    lives = list.map((v) => {
      const runId = uid("run_"),
        settings = { ...r.settings, effort: v.effort, buildLevel: v.level };
      q.run(
        "INSERT INTO routine_runs(id,routine_id,status,trigger,graph,settings,started_at) VALUES(?,?,?,?,?,?,?)",
        runId,
        r.id,
        "running",
        `test:${v.level}:${v.effort}`,
        JSON.stringify(r.graph),
        JSON.stringify(settings),
        t,
      );
      return makeLive(runId, r.id, r.graph, settings, variantName(v));
    });
  q.run("UPDATE routines SET last_run_at=? WHERE id=?", t, r.id);
  return lives;
}
function effortTestFromRecording(r, list, files, build) {
  const g = r.graph,
    create = g.nodes.find((n) => n.type === "createProject" && !n.off);
  if (!create) throw new Error("This routine has no Create project step: it makes the video project your recording goes into.");
  const src = g.nodes.find((n) => !n.off && NODE[n.type]?.accepts === null && NODE[n.type]?.out && orderFrom(g, n.id).includes(build.id));
  if (!src) throw new Error("Nothing in this routine leads to its Build video step.");
  const order = orderFrom(g, src.id),
    before = order.slice(0, order.indexOf(build.id));
  if (!before.includes(create.id)) throw new Error("Create project must come before Build video for an effort test with your recording.");
  const skip = new Set([src.id, ...before.filter((id) => id !== create.id)]);
  const problems = check(g).filter((p) => !p.warn && !(p.nodeId && skip.has(p.nodeId)));
  if (problems.length) throw Object.assign(new Error(problems.map((p) => p.text).join("\n")), { problems });
  const lives = testLives(r, list),
    [first] = lives,
    label = path.parse(files[0]).name.slice(0, 200);
  const failAll = (msg) => {
    for (const l of lives) {
      setRun(l.runId, l.abort.signal.aborted ? "cancelled" : "failed", msg);
      live.delete(l.runId);
    }
    changed();
  };
  (async () => {
    const say = (line) => {
      log("routine effort test", line);
      for (const l of lives) D.send("routines:finding", { runId: l.runId, line });
    };
    const cancels = new Set();
    for (const l of lives) l.cancels.set("prep", cancels);
    const abort = new AbortController();
    for (const l of lives) l.abort.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const ctx = { topic: label, title: label, audioFiles: files, effortTag: first.tag };
    let made;
    try {
      say(`Making one project with your recording (${files.length} file${files.length === 1 ? "" : "s"})`);
      const api = {
        item: { id: "prep", idx: 0, label, ctx, projectId: null },
        node: create,
        s: create.settings,
        settings: first.settings,
        signal: abort.signal,
        runId: first.runId,
        routineId: r.id,
        send: D.send,
        emitTask: D.emitTask,
        exporting: D.exporting,
        log: say,
        onCancel: (fn) => {
          cancels.add(fn);
          return () => cancels.delete(fn);
        },
        setProject: () => {},
        approve: async () => true,
      };
      made = await RUNNERS.createProject(api);
    } catch (e) {
      log("routine effort test prep failed", e?.message);
      failAll(abort.signal.aborted ? "Cancelled." : `Create project: ${String(e?.message || e)}`);
      return;
    } finally {
      for (const l of lives) l.cancels.delete("prep");
    }
    const leadId = made?.ctx?.projectId;
    if (!leadId) {
      failAll("Create project made no project.");
      return;
    }
    const leadName = getProject(leadId).name,
      baseName = leadName.endsWith(` · ${first.tag}`) ? leadName.slice(0, -` · ${first.tag}`.length) : leadName;
    const doneNodes = () =>
      Object.fromEntries([
        [src.id, { status: "done", note: "Your recording" }],
        ...before.map((id) => [
          id,
          {
            status: "done",
            note:
              id === create.id ? "Made once with your recording, the same for every build" : "Not needed: your recording is the voiceover",
          },
        ]),
      ]);
    for (const l of lives) {
      if (l.abort.signal.aborted) {
        setRun(l.runId, "cancelled");
        live.delete(l.runId);
        continue;
      }
      let pid = leadId;
      if (l !== first)
        try {
          say(`Copying it for ${l.tag}`);
          pid = (await duplicateProject(leadId, `${baseName} · ${l.tag}`)).id;
        } catch (e) {
          setRun(l.runId, "failed", `Could not copy the project: ${String(e?.message || e)}`);
          live.delete(l.runId);
          continue;
        }
      const it = {
        id: uid("itm_"),
        runId: l.runId,
        idx: 0,
        label,
        source: src.id,
        status: "waiting",
        projectId: pid,
        ctx: { ...ctx, ...made?.ctx, projectId: pid, effortTag: l.tag },
        nodes: doneNodes(),
        error: null,
        startedAt: null,
        finishedAt: null,
      };
      q.run(
        "INSERT INTO routine_items(id,run_id,idx,label,source,status,project_id,context,nodes) VALUES(?,?,?,?,?,?,?,?,?)",
        it.id,
        l.runId,
        0,
        label,
        src.id,
        "waiting",
        pid,
        JSON.stringify(it.ctx),
        JSON.stringify(it.nodes),
      );
      l.queue.push(it);
      D.send("routines:run", { runId: l.runId, status: "running" });
    }
    for (const l of lives) if (live.has(l.runId)) l.done = drive(l);
    changed();
  })();
  changed();
  return { runIds: lives.map((l) => l.runId) };
}
function makeLive(runId, routineId, graph, settings, tag) {
  const l = {
    runId,
    routineId,
    graph,
    settings,
    tag,
    abort: new AbortController(),
    queue: [],
    active: new Set(),
    approvals: new Map(),
    cancels: new Map(),
    stopAll: false,
    done: null,
  };
  live.set(runId, l);
  return l;
}
async function expand(l) {
  const g = l.graph,
    sources = g.nodes.filter((n) => !n.off && NODE[n.type]?.accepts === null && NODE[n.type]?.out && g.edges.some((e) => e.from === n.id));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const madeToday =
    q.get(
      `SELECT COUNT(*) n FROM routine_items i JOIN routine_runs r ON r.id=i.run_id WHERE r.routine_id=? AND r.started_at>=? AND i.run_id<>?`,
      l.routineId,
      today.toISOString(),
      l.runId,
    )?.n ?? 0;
  let room = Math.max(0, Math.min(l.settings.perRun, l.settings.perDay - madeToday));
  if (!room) {
    setRun(l.runId, "done", `Nothing made: this routine already made ${madeToday} videos today (its limit is ${l.settings.perDay}).`);
    live.delete(l.runId);
    return;
  }
  const taken = new Set(),
    takenTopics = new Set(),
    busy = new Set();
  for (const o of live.values())
    for (const it of o.queue) {
      if (it.ctx.ideaId) taken.add(it.ctx.ideaId);
      if (o.runId !== l.runId && !["failed", "cancelled", "skipped", "rejected"].includes(it.status)) {
        takenTopics.add(it.label);
        if (o.routineId === l.routineId) busy.add(it.label);
      }
    }
  let idx = 0;
  for (const n of sources) {
    if (!room) break;
    const lines = [];
    const seeds = await RUNNERS.seeds(n, {
      signal: l.abort.signal,
      settings: l.settings,
      taken,
      takenTopics,
      busy,
      max: room,
      format: topicFormatOf(g, n),
      log: (s) => {
        log("routine", s);
        lines.push(s);
        D.send("routines:finding", { runId: l.runId, line: s });
      },
    });
    for (const s of seeds.slice(0, room)) {
      const nodes = { [n.id]: { status: "done", note: s.note, log: lines.slice(-60) } };
      const id = uid("itm_"),
        it = {
          id,
          runId: l.runId,
          idx: idx++,
          label: s.label.slice(0, 200),
          source: n.id,
          status: "waiting",
          projectId: null,
          ctx: s.ctx,
          nodes,
          error: null,
          startedAt: null,
          finishedAt: null,
        };
      q.run(
        "INSERT INTO routine_items(id,run_id,idx,label,source,status,context,nodes) VALUES(?,?,?,?,?,?,?,?)",
        id,
        l.runId,
        it.idx,
        it.label,
        n.id,
        "waiting",
        JSON.stringify(it.ctx),
        JSON.stringify(nodes),
      );
      takenTopics.add(it.label);
      if (s.ctx.ideaId) taken.add(s.ctx.ideaId);
      l.queue.push(it);
      room--;
    }
  }
  if (!l.queue.length) {
    setRun(l.runId, "done", "Nothing to make: the inputs gave no topics (no ideas left on the channel?).");
    live.delete(l.runId);
    return;
  }
  D.send("routines:run", { runId: l.runId, status: "running" });
}
async function drive(l) {
  const pending = l.queue.filter((it) => !["done", "failed", "cancelled", "rejected", "skipped"].includes(it.status));
  const next = () => pending.shift();
  const worker = async () => {
    for (let it = next(); it; it = next()) {
      if (l.abort.signal.aborted || l.stopAll) {
        finishItem(
          it,
          "skipped",
          l.stopAll ? "Not started: an earlier video failed and this routine stops on failure." : "Not started: the run was cancelled.",
        );
        continue;
      }
      await runItem(l, it);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, l.settings.parallel) }, worker));
  const all = q.all("SELECT status FROM routine_items WHERE run_id=?", l.runId);
  const n = (s) => all.filter((x) => x.status === s).length;
  const status = l.abort.signal.aborted ? "cancelled" : n("failed") ? (n("done") ? "partial" : "failed") : "done";
  const summary =
    `${n("done")} of ${all.length} video${all.length === 1 ? "" : "s"} finished` +
    (n("failed") ? `, ${n("failed")} failed` : "") +
    (n("rejected") ? `, ${n("rejected")} rejected` : "") +
    (n("skipped") ? `, ${n("skipped")} not made` : "") +
    ".";
  live.delete(l.runId);
  setRun(l.runId, status, summary);
  notify(
    status === "done" ? "Routine finished" : status === "cancelled" ? "Routine cancelled" : "Routine finished with problems",
    `${getRoutineName(l.routineId)}: ${summary}`,
  );
}
const getRoutineName = (id) => q.get("SELECT name FROM routines WHERE id=?", id)?.name ?? "Routine";
function finishItem(it, status, error = null) {
  it.status = status;
  it.error = error;
  it.finishedAt = now();
  for (const [id, s] of Object.entries(it.nodes))
    if (s.status === "waiting" || s.status === "running" || s.status === "approval") it.nodes[id] = { ...s, status: "skipped" };
  saveItem(it);
}
function orderFrom(g, source) {
  const reach = new Set([source]),
    st = [source];
  while (st.length) {
    const id = st.pop();
    for (const e of g.edges)
      if (e.from === id && !reach.has(e.to)) {
        reach.add(e.to);
        st.push(e.to);
      }
  }
  const indeg = new Map([...reach].map((id) => [id, g.edges.filter((e) => e.to === id && reach.has(e.from)).length]));
  const out = [],
    ready = [...reach].filter((id) => !indeg.get(id));
  const pos = (id) => {
    const n = g.nodes.find((x) => x.id === id);
    return n.x * 10 + n.y / 1e3;
  };
  while (ready.length) {
    ready.sort((a, b) => pos(a) - pos(b));
    const id = ready.shift();
    out.push(id);
    for (const e of g.edges)
      if (e.from === id && reach.has(e.to)) {
        const d = indeg.get(e.to) - 1;
        indeg.set(e.to, d);
        if (!d) ready.push(e.to);
      }
  }
  return out.filter((id) => id !== source);
}
async function runItem(l, it) {
  const order = orderFrom(l.graph, it.source);
  it.status = "running";
  it.startedAt ??= now();
  it.error = null;
  it.nodes[it.source] = { ...(it.nodes[it.source] ?? {}), status: "done" };
  for (const id of order) if (!it.nodes[id] || !["done", "warn"].includes(it.nodes[id].status)) it.nodes[id] = { status: "waiting" };
  l.active.add(it.id);
  saveItem(it);
  const cancels = new Set();
  l.cancels.set(it.id, cancels);
  try {
    for (const id of order) {
      const st = it.nodes[id];
      if (st.status === "done" || st.status === "warn") continue;
      if (l.abort.signal.aborted) throw new Error("Cancelled.");
      const node = l.graph.nodes.find((n) => n.id === id),
        def = NODE[node.type];
      if (node.off) {
        it.nodes[id] = { status: "skipped", note: "Switched off." };
        saveItem(it);
        continue;
      }
      const run = RUNNERS[node.type];
      if (!run) {
        it.nodes[id] = { status: "done", note: "Nothing to do." };
        continue;
      }
      const state = { status: "running", startedAt: now(), log: [] };
      it.nodes[id] = state;
      saveItem(it);
      let lastSave = 0;
      const api = {
        item: it,
        node,
        s: node.settings,
        settings: l.settings,
        signal: l.abort.signal,
        runId: l.runId,
        routineId: l.routineId,
        send: D.send,
        emitTask: D.emitTask,
        exporting: D.exporting,
        log: (line) => {
          state.log = [...(state.log ?? []).slice(-60), String(line).slice(0, 400)];
          if (Date.now() - lastSave > 700) {
            lastSave = Date.now();
            saveItem(it);
          }
        },
        onCancel: (fn) => {
          cancels.add(fn);
          return () => cancels.delete(fn);
        },
        setProject: (pid) => {
          it.projectId = pid;
          it.ctx.projectId = pid;
          saveItem(it);
        },
        approve: () =>
          new Promise((res, rej) => {
            state.status = "approval";
            it.status = "approval";
            saveItem(it);
            notify("A video waits for your approval", `${it.label}: open Routines to approve or reject it.`);
            l.approvals.set(it.id, (ok) => {
              l.approvals.delete(it.id);
              it.status = "running";
              state.status = "running";
              saveItem(it);
              res(ok);
            });
            const off = () => rej(new Error("Cancelled."));
            if (l.abort.signal.aborted) off();
            else l.abort.signal.addEventListener("abort", off, { once: true });
          }),
      };
      try {
        const r = await run(api);
        state.status = r?.warn ? "warn" : "done";
        state.note = r?.note ?? r?.warn ?? state.note;
        state.finishedAt = now();
        if (r?.ctx) Object.assign(it.ctx, r.ctx);
        saveItem(it);
        if (r?.stop) {
          finishItem(it, r.stop === "rejected" ? "rejected" : "done", r.stop === "rejected" ? "Rejected by you." : null);
          return;
        }
      } catch (e) {
        state.status = "failed";
        state.error = String(e?.message || e);
        state.finishedAt = now();
        throw Object.assign(new Error(`${def.label}: ${state.error}`), { node: id });
      }
    }
    finishItem(it, "done");
    if (it.ctx.channelId || it.projectId) D.send("channels:changed", { what: "board" });
  } catch (e) {
    const cancelled = l.abort.signal.aborted;
    finishItem(it, cancelled ? "cancelled" : "failed", cancelled ? "Cancelled." : String(e?.message || e));
    if (!cancelled) {
      log("routine item failed", it.id, e?.message);
      notify("A routine video failed", `${it.label}: ${String(e?.message || e).slice(0, 140)}`);
      if (l.settings.onFailure === "stop") l.stopAll = true;
    }
  } finally {
    l.active.delete(it.id);
    l.cancels.delete(it.id);
  }
}
export function cancelRun(runId) {
  const l = live.get(runId);
  if (!l) {
    const r = q.get("SELECT status FROM routine_runs WHERE id=?", runId);
    if (r && ["interrupted", "waiting"].includes(r.status)) {
      setRun(runId, "cancelled");
      return true;
    }
    return false;
  }
  l.abort.abort();
  for (const set of l.cancels.values())
    for (const fn of set) {
      try {
        fn();
      } catch (e) {
        log("routine cancel hook", e?.message);
      }
    }
  return true;
}
export function answerApproval(runId, itemId, ok) {
  const l = live.get(runId),
    fn = l?.approvals.get(itemId);
  if (!fn) throw new Error("This video is not waiting for approval any more.");
  fn(!!ok);
  return true;
}
export async function resumeRun(runId, itemId) {
  if (live.has(runId)) {
    if (!itemId) throw new Error("This run is still going.");
    const l2 = live.get(runId),
      it = l2.queue.find((x) => x.id === itemId) ?? toItem(q.get("SELECT * FROM routine_items WHERE id=?", itemId));
    if (l2.active.has(itemId)) throw new Error("This video is being made right now.");
    retryReset(it);
    if (!l2.queue.includes(it)) l2.queue.push(it);
    runItem(l2, it).catch((e) => log("routine retry", e?.message));
    return true;
  }
  const r = q.get("SELECT * FROM routine_runs WHERE id=?", runId);
  if (!r) throw new Error("That run no longer exists.");
  if (!q.get("SELECT id FROM routines WHERE id=?", r.routine_id)) throw new Error("Its routine was deleted.");
  const g = parse(r.graph, { nodes: [], edges: [] }),
    now2 = parse(q.get("SELECT graph FROM routines WHERE id=?", r.routine_id)?.graph, { nodes: [] });
  const cur = new Map(now2.nodes.map((n) => [n.id, n]));
  g.nodes = g.nodes.map((n) => (cur.has(n.id) ? { ...n, settings: cur.get(n.id).settings, off: cur.get(n.id).off } : n));
  q.run("UPDATE routine_runs SET graph=? WHERE id=?", JSON.stringify(g), runId);
  const l = makeLive(runId, r.routine_id, g, cleanSettings(parse(r.settings, {})));
  const items = q.all("SELECT * FROM routine_items WHERE run_id=? ORDER BY idx", runId).map(toItem);
  for (const it of items) {
    if (itemId ? it.id === itemId : !["done", "rejected"].includes(it.status)) {
      retryReset(it);
      l.queue.push(it);
    }
  }
  if (!l.queue.length) {
    live.delete(runId);
    throw new Error("Every video of this run is finished.");
  }
  setRun(runId, "running");
  l.done = drive(l);
  return true;
}
function retryReset(it) {
  it.status = "waiting";
  it.error = null;
  it.finishedAt = null;
  for (const [id, s] of Object.entries(it.nodes)) if (!["done", "warn"].includes(s.status)) it.nodes[id] = { status: "waiting" };
  saveItem(it);
}
export function deleteRun(runId) {
  if (live.has(runId)) throw new Error("This run is still going. Cancel it first.");
  q.run("DELETE FROM routine_runs WHERE id=?", runId);
  changed();
  return true;
}
function notify(title, body) {
  D?.send("routines:notice", { title, body });
  const w = D?.getWin();
  if (w && !w.isFocused() && canNotify()) {
    const n = new Notification({ title, body: body.slice(0, 200) });
    n.on("click", () => {
      w.show();
      w.focus();
    });
    n.show();
  }
}
export function recoverRoutines() {
  const n = q.run(
    "UPDATE routine_runs SET status='interrupted', summary='The app closed while this run was going. Resume goes on where it stopped.' WHERE status IN ('running','waiting')",
  );
  q.run(
    "UPDATE routine_items SET status='interrupted' WHERE status IN ('running','approval','waiting') AND run_id IN (SELECT id FROM routine_runs WHERE status='interrupted')",
  );
  return Number(n.changes);
}
let timer = null;
export function startScheduler() {
  const tick = () => {
    for (const r of q.all("SELECT * FROM routines")) {
      try {
        const g = parse(r.graph, { nodes: [] }),
          sch = g.nodes.find((n) => n.type === "schedule");
        if (!scheduleOn(sch)) continue;
        const due = nextRun(sch.settings, new Date(r.sched_at || r.created_at));
        if (!due || due > new Date()) continue;
        q.run("UPDATE routines SET sched_at=? WHERE id=?", now(), r.id);
        if ([...live.values()].some((l) => l.routineId === r.id)) {
          log("routine schedule: still running, skipped", r.id);
          continue;
        }
        const missed = Date.now() - due.getTime() > 5 * 6e4;
        startRun(r.id, "schedule")
          .then(() => {
            if (missed) notify("A scheduled routine started", `${r.name} was due while the app was closed, so it runs now.`);
          })
          .catch((e) => {
            log("routine schedule failed", r.id, e?.message);
            notify("A scheduled routine could not start", `${r.name}: ${String(e?.message).split("\n")[0]}`);
          });
      } catch (e) {
        log("routine schedule tick", r.id, e?.message);
      }
    }
  };
  timer = setInterval(tick, 3e4);
  setTimeout(tick, 8e3);
}
let shuttingDown = false;
export function stopRoutines() {
  shuttingDown = true;
  if (timer) clearInterval(timer);
}
