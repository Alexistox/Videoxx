import path from "node:path";
import fs from "node:fs";
import { log } from "../core/log";
import { isOpen, issueSummary, readIssues, updateIssues } from "../projects/issues";
import { matchSettingsOf, notifyStudio, readVersions, requireStudio } from "./stages";
import { friendlyError, isProjectBusy, stopTask } from "../agent/sessions";
import { ensureCurrent, ensureMatch, studioSettled } from "./versions";
import { runCritic } from "./critic";

const loopFile = (dir) => path.join(dir, ".suite", "studio", "loop.json");
function readLoop(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(loopFile(dir), "utf8"));
    return j && typeof j === "object" && typeof j.status === "string" ? j : null;
  } catch {
    return null;
  }
}
function writeLoop(dir, s) {
  const f = loopFile(dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, f);
}
const IDLE = () => ({
  status: "idle",
  reason: "",
  pass: 0,
  phase: null,
  startedAt: null,
  updatedAt: new Date().toISOString(),
  taskId: null,
  history: [],
});
const active = new Map();
const critics = new Map();
export const studioJobBusy = (projectId) => active.has(projectId) || critics.has(projectId);
export const STUDIO_JOB_BUSY = "Run until good (or the critic) is working in this workspace: press Stop first, or wait for it.";
let runFix = null;
export const setLoopRunner = (f) => {
  runFix = f;
};
const waiters = new Map(),
  early = new Map();
export function loopTaskDone(ev) {
  if (!ev?.taskId) return;
  const w = waiters.get(ev.taskId);
  if (w) {
    waiters.delete(ev.taskId);
    w(ev);
    return;
  }
  if (!active.size) return;
  if (early.size > 20) early.clear();
  early.set(ev.taskId, ev);
}
const taskEnd = (taskId) =>
  new Promise((res) => {
    const e = early.get(taskId);
    if (e) {
      early.delete(taskId);
      res(e);
    } else waiters.set(taskId, res);
  });
export function loopState(projectId) {
  const { dir, studio } = requireStudio(projectId),
    s = readLoop(dir) ?? IDLE();
  if ((s.status === "running" || s.status === "stopping") && !active.has(projectId)) s.status = "interrupted";
  const scored = [...readVersions(dir)].reverse().find((v) => v.score);
  return {
    ...s,
    ...matchSettingsOf(studio),
    critic: critics.has(projectId),
    lastScore: scored?.score?.value ?? null,
    lastScoreV: scored?.v ?? null,
  };
}
function isGood(dir, threshold) {
  const last2 = readVersions(dir).slice(-1)[0],
    sum = issueSummary(dir);
  return {
    ok: !!last2?.score && last2.score.value >= threshold && sum.openHigh + sum.openMedium === 0,
    score: last2?.score?.value ?? null,
    open: sum.openHigh + sum.openMedium,
  };
}
async function critique(projectId, ac, label) {
  await studioSettled(projectId);
  await ensureCurrent(projectId, label);
  await ensureMatch(projectId);
  if (ac.signal.aborted) throw new Error("aborted");
  return runCritic(projectId, { signal: ac.signal });
}
export async function criticOnce(projectId) {
  const { studio } = requireStudio(projectId);
  if (studio.stage !== "review") throw new Error("The critic judges versions in the Review stage.");
  if (studioJobBusy(projectId)) throw new Error(STUDIO_JOB_BUSY);
  if (isProjectBusy(projectId))
    throw new Error("Claude is working in this workspace: wait for it to finish (or press Stop), then run the critic.");
  const ac = new AbortController();
  critics.set(projectId, ac);
  notifyStudio(projectId);
  try {
    return await critique(projectId, ac, "Critic");
  } catch (e) {
    if (ac.signal.aborted) throw new Error("The critic was stopped.");
    throw e;
  } finally {
    critics.delete(projectId);
    notifyStudio(projectId);
  }
}
export function startLoop(projectId, o = {}) {
  const { dir, studio } = requireStudio(projectId);
  if (studio.stage !== "review") throw new Error("Run until good works in the Review stage.");
  if (studioJobBusy(projectId)) throw new Error(STUDIO_JOB_BUSY);
  if (isProjectBusy(projectId))
    throw new Error("Claude is working in this workspace: wait for it to finish (or press Stop), then start the loop.");
  if (!runFix) throw new Error("The Studio is still starting: try again in a moment.");
  const prev = loopState(projectId),
    set = matchSettingsOf(studio);
  const resume = !!o.resume && ["stopped", "interrupted", "failed"].includes(prev.status) && prev.pass < set.cap;
  const now = new Date().toISOString();
  const s = resume
    ? {
        status: "running",
        reason: "",
        pass: prev.pass,
        phase: null,
        startedAt: prev.startedAt ?? now,
        updatedAt: now,
        taskId: null,
        history: prev.history ?? [],
        scores: prev.scores ?? [],
      }
    : { ...IDLE(), status: "running", startedAt: now };
  updateIssues(dir, (i) => (i.status === "fixing" ? { status: "open" } : null));
  const ctl = { stop: false, taskId: null, critic: null };
  active.set(projectId, ctl);
  writeLoop(dir, s);
  notifyStudio(projectId);
  log("studio", "loop", projectId, resume ? `resumed at pass ${s.pass}` : "started", JSON.stringify(set));
  run(projectId, ctl, s)
    .catch((e) => log("studio", "loop crashed", e?.message))
    .finally(() => {
      active.delete(projectId);
      notifyStudio(projectId);
      try {
        loopEnded(projectId, s.status);
      } catch {}
    });
  return loopState(projectId);
}
let loopEnded = () => {};
export const onLoopEnd = (f) => {
  loopEnded = f;
};
export function stopLoop(projectId) {
  const { dir } = requireStudio(projectId),
    ctl = active.get(projectId);
  if (ctl) {
    ctl.stop = true;
    const s = readLoop(dir);
    if (s) {
      s.status = "stopping";
      s.updatedAt = new Date().toISOString();
      writeLoop(dir, s);
    }
    if (ctl.taskId) stopTask(ctl.taskId);
    ctl.critic?.abort();
  } else {
    critics.get(projectId)?.abort();
    const s = readLoop(dir);
    if (s && (s.status === "running" || s.status === "stopping")) {
      s.status = "stopped";
      s.reason = "Stopped by you.";
      s.phase = null;
      s.taskId = null;
      s.updatedAt = new Date().toISOString();
      writeLoop(dir, s);
    }
  }
  notifyStudio(projectId);
  return loopState(projectId);
}
async function run(projectId, ctl, s) {
  const { dir } = requireStudio(projectId);
  const save = (patch) => {
    Object.assign(s, patch, { updatedAt: new Date().toISOString() });
    writeLoop(dir, s);
    notifyStudio(projectId);
  };
  const settings = () => matchSettingsOf(requireStudio(projectId).studio);
  const finish = (status, reason) => {
    save({ status, reason, phase: null, taskId: null });
    log("studio", "loop", projectId, status, reason);
  };
  const note = () => {
    const last2 = readVersions(dir).slice(-1)[0],
      sum = issueSummary(dir);
    s.history = [
      ...s.history,
      {
        pass: s.pass,
        v: last2?.v ?? null,
        score: last2?.score?.value ?? null,
        open: sum.open,
        openHighMed: sum.openHigh + sum.openMedium,
        at: new Date().toISOString(),
      },
    ].slice(-100);
    save({});
  };
  const critic = async () => {
    save({ phase: "critic" });
    const ac = new AbortController();
    ctl.critic = ac;
    critics.set(projectId, ac);
    try {
      const r = await critique(projectId, ac, "Run until good");
      save({ scores: [...(s.scores ?? []), r.value].slice(-50) });
      return r;
    } finally {
      ctl.critic = null;
      critics.delete(projectId);
    }
  };
  const verdict = () => {
    const g = isGood(dir, settings().threshold);
    return g.ok ? `the critic's score ${g.score} reached ${settings().threshold} with no open high or medium issue` : null;
  };
  const plateau = () => {
    const n = settings().plateau,
      l = (s.scores ?? []).slice(-n);
    if (n < 2 || l.length < n || Math.max(...l) - Math.min(...l) > 0.5) return null;
    return `The score plateaued at ${l[l.length - 1]} (the last ${n} critics: ${l.join(", ")}). More passes rarely help from here: look at the open issues (materials and light often need new assets), raise the plateau setting, or go on by hand.`;
  };
  try {
    if (ctl.stop) return finish("stopped", "Stopped by you.");
    save({ phase: "version" });
    await studioSettled(projectId);
    const v0 = await ensureCurrent(projectId, "Run until good");
    save({ phase: "overlays" });
    await ensureMatch(projectId);
    if (ctl.stop) return finish("stopped", "Stopped by you.");
    const had = readVersions(dir).find((x) => x.v === v0.v)?.score;
    if (!had) await critic();
    else if (!(s.scores ?? []).length) save({ scores: [had.value] });
    if (s.pass === 0) note();
    let good = verdict();
    if (good) return finish("done", `Good: ${good}.`);
    for (;;) {
      const set = settings();
      if (s.pass >= set.cap) return finish("done", `Reached the pass cap (${set.cap}) without the score ${set.threshold}.`);
      if (ctl.stop) return finish("stopped", "Stopped by you.");
      save({ pass: s.pass + 1, phase: "fix" });
      const open = readIssues(dir).filter(isOpen);
      if (open.length) {
        await studioSettled(projectId);
        if (isProjectBusy(projectId)) return finish("stopped", "Another Claude run started in this workspace.");
        const { taskId } = await runFix(projectId);
        ctl.taskId = taskId;
        save({ taskId });
        const ev = await taskEnd(taskId);
        ctl.taskId = null;
        save({ taskId: null });
        if (ctl.stop || ev?.status === "cancelled") return finish("stopped", "Stopped by you.");
        if (ev?.status === "failed")
          return finish("failed", `The fix round failed: ${String(ev.error || "no reason given").slice(0, 300)}`);
        save({ phase: "version" });
        await studioSettled(projectId);
      }
      if (ctl.stop) return finish("stopped", "Stopped by you.");
      if (s.pass % set.every === 0 || s.pass >= set.cap || !open.length || !readIssues(dir).some(isOpen)) {
        await critic();
        note();
        good = verdict();
        if (good) return finish("done", `Good: ${good}.`);
        const flat = plateau();
        if (flat) return finish("done", flat);
      } else note();
    }
  } catch (e) {
    if (ctl.stop) return finish("stopped", "Stopped by you.");
    finish("failed", friendlyError(String(e?.message ?? e)).slice(0, 400));
  }
}
