import path from "node:path";
import fs from "node:fs";
import { getConfig } from "../core/config";
import { log } from "../core/log";
import { q } from "../db/db";
import { baseOf, getStyle } from "../styles/catalog";
import { hostState, layoutCheck } from "../render/workers";
import { isOpen, readIssues, readLessons } from "../projects/issues";
import { readVersions, studioOf } from "./stages";
import { rebuildIndex } from "../library/index";
import { getRow } from "../library/search";
import { libraryOff } from "../library/context";
import { patchWsEntry } from "../library/store";
import { engineVersion, getProject } from "../projects/projects";
import { ADD_SCHEMA, addEntry, libraryToolDefs } from "../agent/tools/libraryTools";
import { harvestCandidates } from "../library/harvest";

const MAX_PROPOSALS = 8;
const BUNDLE_CHARS = 46e3;
export const HARVEST_MODEL = "claude-opus-5-5",
  HARVEST_EFFORT = "medium",
  HARVEST_TURNS = 25;
export const HARVEST_DISALLOWED = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Task",
  "Agent",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
];
export const HARVEST_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "mcp__suite__library_search",
  "mcp__suite__library_get",
  "mcp__suite__library_propose",
]);
export const HARVEST_THREAD = "Library harvest";
export const HARVEST_SYSTEM = `You are running inside Videoxx as its Library harvester: a short, read-only pass over a video project that was
just made. You change nothing in the project: no file edits, no shell, no web, no pictures. You read the files the request names
(Read / Glob / Grep, inside the project), check the Library (library_search / library_get) and propose what later videos can reuse
with library_propose. The member accepts or rejects every proposal in the Library. Be selective: a few general, working,
well-described entries beat many narrow ones. Finish with one plain sentence saying what you proposed.`;
const clip = (s, n) => {
  const t = String(s ?? "").replace(/\r/g, "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const one = (s, n) =>
  clip(
    String(s ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    n,
  );
const kvGet = (k) => q.get("SELECT value FROM kv WHERE key=?", k)?.value ?? null;
const kvSet = (k, v) => q.run("INSERT OR REPLACE INTO kv(key, value) VALUES(?,?)", k, v);
const readText = (f) => {
  try {
    return fs.readFileSync(f, "utf8");
  } catch {
    return "";
  }
};
const growOn = () =>
  !libraryOff() && (process.env.CZ_TEST_HOOKS === "1" ? getConfig().library?.grow === true : getConfig().library?.grow !== false);
const active = new Map();
const pending = new Map();
const pumping = new Set();
let notify = () => {};
export const onHarvestEvent = (f) => {
  notify = f;
};
let runner = null;
export const setHarvestRunner = (r) => {
  runner = r;
};
export const harvestState = (projectId) =>
  projectId
    ? { queued: pending.has(projectId), running: active.has(projectId), editId: active.get(projectId)?.editId ?? null }
    : { queued: [...pending.keys()], running: [...active.keys()] };
const whyText = (w) =>
  w === "build"
    ? "the video was built"
    : w === "ultra"
      ? "an Ultraedit"
      : w === "loop"
        ? `the Style Studio's "Run until good" finished`
        : w === "publish"
          ? "the style was published"
          : 'the member asked for it ("Harvest now")';
const harvestLabel = (w) =>
  `Library harvest (${w === "build" ? "after the build" : w === "ultra" ? "after the Ultraedit" : w === "loop" ? "after Run until good" : w === "publish" ? "after publishing" : "Harvest now"})`;
function sourceEdit(projectId, id) {
  if (id) {
    const e = q.get("SELECT * FROM edits WHERE id=? AND project_id=?", id, projectId);
    if (e) return e;
  }
  return (
    q.get(
      "SELECT * FROM edits WHERE project_id=? AND status='done' AND COALESCE(kind,'') IN ('build','ultra') ORDER BY created_at DESC LIMIT 1",
      projectId,
    ) ??
    q.get(
      "SELECT * FROM edits WHERE project_id=? AND status='done' AND COALESCE(kind,'') != 'harvest' ORDER BY created_at DESC LIMIT 1",
      projectId,
    ) ??
    null
  );
}
const usedOf = (e) => {
  try {
    const l = JSON.parse(e?.lib_used || "[]");
    return Array.isArray(l) ? l.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
export function queueHarvest(projectId, why, o = {}) {
  let p;
  try {
    p = getProject(projectId);
  } catch {
    return { state: "skipped", reason: "no such project" };
  }
  if (p.kind === "personal") return { state: "skipped", reason: "Personal videos are edited from footage: nothing to harvest." };
  if (libraryOff()) return { state: "off", reason: "The Library is switched off." };
  if (!o.force && !growOn()) return { state: "off", reason: "Grow the library after builds is off (Settings > AI engines)." };
  if (!runner) return { state: "skipped", reason: "The app is still starting." };
  if (active.has(projectId)) return { state: "running" };
  pending.set(projectId, { why, sourceEditId: o.sourceEditId ?? null, at: Date.now() });
  notify({ type: "queued", projectId, why, sourceEditId: o.sourceEditId ?? null });
  log("library: harvest queued", projectId, why);
  pump(projectId);
  return { state: "queued" };
}
async function pump(projectId) {
  if (pumping.has(projectId)) return;
  pumping.add(projectId);
  try {
    const t0 = Date.now();
    while (pending.has(projectId)) {
      if (Date.now() - t0 > 3 * 36e5) {
        const w2 = pending.get(projectId);
        pending.delete(projectId);
        notify({ type: "skipped", projectId, why: w2.why, sourceEditId: w2.sourceEditId, reason: "the project stayed busy" });
        break;
      }
      if (active.has(projectId) || runner.busy(projectId)) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const w = pending.get(projectId);
      pending.delete(projectId);
      try {
        await start(projectId, w.why, w.sourceEditId);
      } catch (e) {
        active.delete(projectId);
        if (/already working/i.test(String(e?.message)) && !pending.has(projectId)) {
          pending.set(projectId, w);
          continue;
        }
        log("library: harvest not started", projectId, e?.message);
        notify({ type: "skipped", projectId, why: w.why, sourceEditId: w.sourceEditId, reason: String(e?.message || e) });
      }
    }
  } finally {
    pumping.delete(projectId);
  }
}
async function cleanCheck(projectId) {
  try {
    if (studioOf(projectId)) {
      const v = readVersions(getProject(projectId).path).slice(-1)[0],
        c = v?.checks;
      return c?.ran
        ? { boot: c.pairs.every((x) => x.boot), layout: c.open === 0, note: `the Studio checks of v${v.v}: ${c.open} open issue(s)` }
        : { boot: false, layout: null, note: "no Studio checks yet" };
    }
    const hs = await hostState(projectId, true);
    const errs = (hs.errors || []).filter((e) => e.level === "error");
    if (hs.bootError || errs.length)
      return { boot: false, layout: null, note: `the preview does not load cleanly: ${one(hs.bootError || errs[0]?.text, 200)}` };
    const r = await Promise.race([layoutCheck(projectId), new Promise((res) => setTimeout(() => res(null), 12e4))]);
    if (!r) return { boot: true, layout: null, note: "loads cleanly; no layout check for this engine" };
    return {
      boot: true,
      layout: r.issues.length === 0,
      note: r.issues.length
        ? `${r.issues.length} layout problem(s), e.g. ${r.issues
            .slice(0, 3)
            .map((i) => `${String(i.type).toUpperCase()} ${one(i.what, 60)}`)
            .join("; ")}`
        : `clean at ${r.times.length} steady frames`,
    };
  } catch (e) {
    return { boot: false, layout: null, note: `not checked (${one(e?.message, 120)})` };
  }
}
function harvestBundle(projectId, why, sourceEditId, clean) {
  const p = getProject(projectId),
    dir = p.path,
    st = getStyle(p.style_id),
    base = baseOf(p.style_id),
    ev = engineVersion(path.join(dir, "engine.js"));
  const src = sourceEdit(projectId, sourceEditId),
    used = usedOf(src);
  const parts = [];
  const add = (title, body, max) => {
    const b = clip(body.trim(), max);
    if (b)
      parts.push(`## ${title}
${b}`);
  };
  parts.push(`LIBRARY HARVEST of the project "${p.name}" (${st.name}, base ${base}${ev ? `, engine v${ev}` : ""}), after ${whyText(why)}.
Propose to the Library (library_propose, at most ${MAX_PROPOSALS} this run) what LATER videos can reuse. The member reviews each proposal.
- Look only at the files named below (Read / Glob / Grep inside this project). First library_search for each idea: skip what the Library has.
- Code: a module / material is a file that already stands alone (lib/*.js, a helper file) with exported builder functions taking parameters, not this
  story's names. A scene file that would work as a starting point for another video is a recipe (files: [the scene], usage: what to change).
  Code may import only the engine (../engine.js from scenes, ../../engine.js inside library/), lib/*.js, library/<id>/ and its own files;
  deterministic (no Math.random / Date.now), no web, no secrets, no absolute paths. You cannot edit files: skip code that would need extracting.
- Know-how: what cost time here (the failed / reverted edits, the Studio lessons, the progress notes' problems) as a solution or pitfall whose body
  is "Symptom: .. Cause: .. Fix: .. Detect: ..", worded for any video of this style (bases: ["${base}"]) or every style (["any"]).
- Titles say what it is ("Neon sign with flicker", not "scene 3 helper"); summary <= 200 characters; tags = the words someone would search.
- Never propose an entry this run already reused (listed below), a near-copy of one in the Library list, or anything only this video needs.`);
  if (src)
    add(
      "What was asked",
      `${one(src.instruction || "(a build)", 600)}${
        src.summary
          ? `
Claude's summary: ${one(src.summary, 900)}`
          : ""
      }`,
      1800,
    );
  if (src) {
    let files = [];
    try {
      files = JSON.parse(src.files || "[]");
    } catch {}
    add(
      `What changed in that run (${files.length} file${files.length === 1 ? "" : "s"})`,
      files
        .slice(0, 60)
        .map((f) => `${f.file} +${f.added ?? 0} −${f.removed ?? 0}`)
        .join("\n"),
      3e3,
    );
  }
  if (used.length)
    add(
      "Library entries that run already reused (do not propose these again)",
      used
        .slice(0, 30)
        .map((id) => {
          const r = getRow(id);
          return `${id}${r ? `: ${r.title}` : ""}`;
        })
        .join("\n"),
      2e3,
    );
  const listJs = (sub) => {
    try {
      return fs
        .readdirSync(path.join(dir, sub))
        .filter((f) => /\.m?js$/i.test(f))
        .map((f) => {
          let n = 0;
          try {
            n = fs.readFileSync(path.join(dir, sub, f), "utf8").split("\n").length;
          } catch {}
          return `${sub}/${f} (${n} lines)`;
        });
    } catch {
      return [];
    }
  };
  add("Code files", [...listJs("scenes"), ...listJs("lib")].slice(0, 80).join("\n"), 3e3);
  const sb = readText(path.join(dir, "storyboard.md"));
  if (sb) add("Storyboard (storyboard.md, start)", sb, 6e3);
  const prog = readText(path.join(dir, ".suite", "build-progress.md"));
  if (prog) add("Progress notes (.suite/build-progress.md, end)", prog.length > 6e3 ? "…" + prog.slice(-6e3) : prog, 6100);
  if (clean)
    add(
      "Checks (the app ran them now)",
      `${clean.boot ? "The preview loads cleanly" : "The preview does NOT load cleanly"}; ${clean.note}.`,
      600,
    );
  const w = studioOf(projectId);
  if (w) {
    const lessons = readLessons(w.dir).slice(-25);
    if (lessons.length)
      add(
        "Style Studio lessons (each is already a Library pitfall: propose only what they add up to, e.g. a solution)",
        lessons.map((l) => `- ${one(l.finding, 160)} -> ${one(l.lesson, 260)}`).join("\n"),
        5e3,
      );
    const scores = readVersions(w.dir)
      .filter((v) => v.score)
      .slice(-8)
      .map((v) => `v${v.v}: ${v.score.value}/10 ${one(v.score.summary, 160)}`);
    if (scores.length) add("Critic scores (latest last)", scores.join("\n"), 2e3);
    const open = readIssues(w.dir)
      .filter(isOpen)
      .slice(0, 12)
      .map((i) => `- [${i.severity}] ${one(i.title, 160)}`);
    if (open.length) add("Issues still open", open.join("\n"), 2e3);
  }
  const cand = harvestCandidates(projectId, 10);
  if (cand.length)
    add(
      "Failed or reverted edits (what went wrong: material for pitfalls / solutions, never code to save)",
      cand
        .map((c) => {
          let n = 0;
          try {
            n = JSON.parse(c.files || "[]").length;
          } catch {}
          return `- [${c.status}] ${one(c.instruction, 200)}${c.summary ? ` -> ${one(c.summary, 300)}` : ""}${n ? ` (${n} files)` : ""}`;
        })
        .join("\n"),
      5e3,
    );
  const have = q.all(
    "SELECT id, kind, title FROM lib_entries WHERE source IN ('seed','ws') AND status != 'retired' AND (' ' || bases || ' ' LIKE ? OR ' ' || bases || ' ' LIKE '% any %') ORDER BY kind, title LIMIT 400",
    `% ${base} %`,
  );
  if (have.length)
    add(`Already in the Library for ${base} (and any style)`, have.map((r) => `${r.id}: ${one(r.title, 80)}`).join("\n"), 9e3);
  let out = parts.join("\n\n");
  if (out.length > BUNDLE_CHARS) out = out.slice(0, BUNDLE_CHARS - 40) + "\n…(cut to stay small)";
  return out;
}
export function harvestToolDefs(projectId) {
  const look = { over: () => true, spend() {}, budgetText: () => "No pictures in a harvest: work from the text." };
  const lib = libraryToolDefs(projectId, look).filter((d) => d.name === "library_search" || d.name === "library_get");
  const text = (t) => ({ content: [{ type: "text", text: t }] });
  return [
    ...lib,
    {
      name: "library_propose",
      description: `Propose one entry for the Library (the member accepts or rejects it). Same fields and checks as library_add: kind, title, summary, tags, bases, files (project files; first .js = entry) or body (know-how: "Symptom: .. Cause: .. Fix: .. Detect: .."), usage, licence fields for others' work. At most ${MAX_PROPOSALS} a run; the same code as an entry already there only adds this project to it.`,
      schema: ADD_SCHEMA,
      handler: async (a) => {
        const ctx = active.get(projectId);
        try {
          if (ctx && ctx.calls >= MAX_PROPOSALS)
            return text(`library_propose: that is ${MAX_PROPOSALS} proposals for this run, the most one harvest makes. Finish now.`);
          if (ctx) ctx.calls++;
          const r = await addEntry(projectId, a, { by: "harvest" });
          const saved = /^Saved to the Library as ([\w.-]+) v\d+/.exec(r)?.[1],
            same = /^Already in the Library as ([\w.-]+)/.exec(r)?.[1];
          if (ctx) {
            if (saved) ctx.proposed.push(saved);
            else if (same) ctx.merged.push(same);
            else if (/^Refused/.test(r)) ctx.refused++;
          }
          return text(
            saved
              ? `Proposed: ${saved} (waits for the member in the Library).${/Similar entries/.test(r) ? " " + r.slice(r.indexOf("Similar entries")) : ""}`
              : r,
          );
        } catch (e) {
          if (ctx) ctx.refused++;
          return text(`library_propose: ${e?.message || e}`);
        }
      },
    },
  ];
}
async function start(projectId, why, sourceEditId) {
  const src = sourceEdit(projectId, sourceEditId);
  const ctx = {
    projectId,
    why,
    sourceEditId: src?.id ?? sourceEditId,
    editId: null,
    taskId: null,
    startedAt: new Date().toISOString(),
    proposed: [],
    merged: [],
    refused: 0,
    calls: 0,
    clean: { boot: false, layout: null, note: "" },
  };
  active.set(projectId, ctx);
  notify({ type: "started", projectId, why, sourceEditId: ctx.sourceEditId });
  ctx.clean = await cleanCheck(projectId);
  if (runner.busy(projectId)) throw new Error("Claude is already working on this project.");
  const bundle = harvestBundle(projectId, why, ctx.sourceEditId, ctx.clean);
  log("library: harvest", projectId, why, `bundle ${bundle.length} chars (~${Math.round(bundle.length / 4)} tokens)`, ctx.clean.note);
  const r = await runner.run(projectId, bundle, harvestLabel(why), (ev) => {
    if (ev.type === "done") finish(ctx, ev).catch((e) => log("library: harvest wrap-up failed", e?.message));
  });
  ctx.taskId = r.taskId;
  ctx.editId = r.editId;
}
async function finish(ctx, ev) {
  const projectId = ctx.projectId,
    accepted = [];
  try {
    if (ev.status === "done") kvSet(`lib_harvest_at:${projectId}`, ctx.startedAt);
    if (ctx.clean.boot && ctx.clean.layout === true)
      for (const id of ctx.proposed) {
        const k = id.split(".")[0];
        if (k !== "module" && k !== "recipe") continue;
        try {
          patchWsEntry(id, (e) => {
            if (e.status === "proposed") {
              e.status = "accepted";
              accepted.push(id);
            }
          });
        } catch {}
      }
    rebuildIndex();
  } catch (e) {
    log("library: harvest finish", e?.message);
  }
  const src = ctx.sourceEditId ? q.get("SELECT lib_used FROM edits WHERE id=?", ctx.sourceEditId) : null;
  const proposed = ctx.proposed.map((id) => {
    const r = getRow(id);
    return { id, title: r?.title ?? id, kind: r?.kind ?? id.split(".")[0], status: r?.status ?? "proposed" };
  });
  const rec = {
    at: new Date().toISOString(),
    projectId,
    projectName: (() => {
      try {
        return getProject(projectId).name;
      } catch {
        return "";
      }
    })(),
    why: ctx.why,
    sourceEditId: ctx.sourceEditId,
    editId: ev.editId ?? ctx.editId,
    status: String(ev.status),
    reused: usedOf(src).length,
    proposed,
    merged: ctx.merged,
    refused: ctx.refused,
    accepted,
    clean: ctx.clean.note,
  };
  try {
    kvSet("lib_harvest_last", JSON.stringify(rec));
    if (ctx.sourceEditId) kvSet(`lib_harvest_for:${ctx.sourceEditId}`, JSON.stringify(rec));
  } catch {}
  log(
    "library: harvest done",
    projectId,
    rec.status,
    `proposed ${proposed.length} (accepted ${accepted.length}), merged ${ctx.merged.length}, refused ${ctx.refused}`,
  );
  active.delete(projectId);
  notify({
    type: "done",
    projectId,
    why: ctx.why,
    sourceEditId: ctx.sourceEditId,
    editId: rec.editId,
    status: rec.status,
    reused: rec.reused,
    proposed,
    merged: ctx.merged,
    refused: ctx.refused,
    accepted,
  });
  if (pending.has(projectId)) pump(projectId);
}
export function lastHarvest() {
  let r = null;
  try {
    r = JSON.parse(kvGet("lib_harvest_last") || "null");
  } catch {}
  if (!r) return null;
  r.proposed = (r.proposed ?? []).map((x) => {
    const row = getRow(x.id);
    return row ? { id: x.id, title: row.title, kind: row.kind, status: row.status, summary: row.summary } : { ...x, status: "deleted" };
  });
  return r;
}
export const harvestFor = (editId) => {
  try {
    return JSON.parse(kvGet(`lib_harvest_for:${editId}`) || "null");
  } catch {
    return null;
  }
};
export const HARVEST_AFTER = new Set(["build", "ultra"]);
