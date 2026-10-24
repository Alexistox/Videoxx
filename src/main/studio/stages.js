import path from "node:path";
import fs from "node:fs";
import { templatesDir } from "../core/workspace";
import { markDirty } from "../render/workers";
import { isOpen, issueSummary, readIssues } from "../projects/issues";
import { getProject } from "../projects/projects";
import { kindOf, referencePaths } from "../projects/references";
import { projectUrl } from "../projects/fileServer";

const STYLE_STAGES = ["brief", "study", "guide", "kit", "sample", "review", "publish"];
const LOOK_STAGES = ["brief", "study", "look", "review", "save"];
export const stagesOf = (mode) => (mode === "look" ? LOOK_STAGES : STYLE_STAGES);
const MATCH_DEFAULTS = { threshold: 8, every: 3, cap: 12, plateau: 3 };
export function matchSettingsOf(studio) {
  const m = studio.match ?? {},
    n = (v, lo, hi, d) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const p = Math.round(n(m.plateau, 0, 6, MATCH_DEFAULTS.plateau));
  return {
    threshold: n(m.threshold, 1, 10, MATCH_DEFAULTS.threshold),
    every: Math.round(n(m.every, 1, 20, MATCH_DEFAULTS.every)),
    cap: Math.round(n(m.cap, 1, 60, MATCH_DEFAULTS.cap)),
    plateau: p === 1 ? 2 : p,
  };
}
export const FILL_MARK = "_(to fill)_";
const readPj = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};
let changed = () => {};
export const onStudioChanged = (f) => {
  changed = f;
};
export const notifyStudio = (projectId) => {
  try {
    changed(projectId);
  } catch {}
};
const activity = new Map();
export const setActivity = (projectId, what) => {
  if (what) activity.set(projectId, what);
  else activity.delete(projectId);
  notifyStudio(projectId);
};
const activityOf = (projectId) => activity.get(projectId) ?? null;
export const versionsFile = (dir) => path.join(dir, ".suite", "studio", "versions.json");
export function readVersions(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(versionsFile(dir), "utf8"));
    return Array.isArray(j?.versions) ? j.versions : [];
  } catch {
    return [];
  }
}
export function studioOf(projectId) {
  const p = getProject(projectId);
  if (p.lab_kind !== "studio") return null;
  const pj = readPj(p.path),
    s = pj?.studio;
  if (!s || typeof s !== "object" || s.schema !== 1)
    throw new Error('This Style Studio workspace has lost its project.json "studio" block.');
  return { dir: p.path, studio: s };
}
export function requireStudio(projectId) {
  const w = studioOf(projectId);
  if (!w) throw new Error("This project is not a Style Studio workspace.");
  return w;
}
export function writeStudio(projectId, mutate) {
  const { dir } = requireStudio(projectId),
    f = path.join(dir, "project.json"),
    pj = readPj(dir);
  mutate(pj.studio, pj);
  fs.writeFileSync(f, JSON.stringify(pj, null, 1));
  return pj.studio;
}
const need = (cond, why, out) => {
  if (!cond) out.push(why);
};
export function gateOf(stage, mode, f) {
  const m = [];
  switch (stage) {
    case "brief":
      break;
    // the brief is the app's form: done when made
    case "study":
      if (f.refs > 0) {
        if (f.analysis) m.push(...f.analysis);
        else need(!!f.filled["reference/ANALYSIS.md"], "reference/ANALYSIS.md is not filled in (every section of the template)", m);
      }
      break;
    case "guide":
      need(!!f.filled["skill/STYLE_GUIDE.md"], "skill/STYLE_GUIDE.md is not filled in", m);
      need(!!f.filled["skill/QUALITY.md"], "skill/QUALITY.md is not filled in", m);
      need(!!f.exists["scenes/hero.js"], "scenes/hero.js (the hero frames) is missing", m);
      if (f.guide) m.push(...f.guide);
      break;
    case "kit":
      need(f.kit > 0, "there is no kit scene (scenes/kit*.js)", m);
      if (f.kit > 0 && f.kitGaps) m.push(...f.kitGaps);
      break;
    case "sample":
      need(f.samples > 0, "there is no sample scene (scenes/sample*.js)", m);
      if (f.samples > 0 && f.sampleGaps) m.push(...f.sampleGaps);
      break;
    case "look":
      need(f.lookSettings, "the look has no settings yet (set_look_settings)", m);
      need(!!f.filled["skill/LOOK.md"], "skill/LOOK.md is not filled in", m);
      break;
    case "review":
      need(f.checked, "the machine checks have not run on the latest version (Run checks)", m);
      need(f.openHigh === 0, `${f.openHigh} high-severity issue(s) are still open`, m);
      break;
    case "save":
      need(!!f.saved, "the look is not saved yet (Save look)", m);
      break;
    case "publish":
      need(!!f.published, "the style is not published yet (Publish runs the checklist)", m);
      break;
  }
  return { ok: !m.length, missing: m };
}
export const hasFillMark = (t) => t.replace(/"_\(to fill\)_"/g, "").includes(FILL_MARK);
const GATE_FILES = ["reference/ANALYSIS.md", "skill/STYLE_GUIDE.md", "skill/QUALITY.md", "skill/LOOK.md", "scenes/hero.js"];
function sections(md) {
  const out = [];
  for (const l of md.replace(/\r/g, "").split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) out.push({ head: h[1], body: [] });
    else if (out.length) out[out.length - 1].body.push(l);
  }
  return out;
}
function analysisGaps(text, template, o) {
  if (text == null) return ["reference/ANALYSIS.md is missing"];
  const tpl = sections(template),
    own = (s) => {
      const desc = new Set((tpl.find((t) => t.head === s.head)?.body ?? []).map((l) => l.trim()).filter((l) => l && l !== FILL_MARK));
      return s.body.map((l) => l.trim()).filter((l) => l && !desc.has(l));
    };
  const secs = sections(text),
    out = [];
  const empty = secs.filter((s) => !own(s).length || s.body.some(hasFillMark)).map((s) => `"${s.head}"`);
  if (!secs.length) out.push('reference/ANALYSIS.md has none of its "## " sections');
  else if (empty.length === secs.length) return ["reference/ANALYSIS.md is not written yet (every section is empty)"];
  else if (empty.length)
    out.push(`reference/ANALYSIS.md: fill ${empty.slice(0, 4).join(", ")}${empty.length > 4 ? ` and ${empty.length - 4} more` : ""}`);
  else if (hasFillMark(text)) out.push('reference/ANALYSIS.md still has "_(to fill)_"');
  if (o.visual) {
    const hex = new Set((text.match(/#[0-9a-f]{6}\b/gi) ?? []).map((h) => h.toLowerCase()));
    if (hex.size < 5)
      out.push(`reference/ANALYSIS.md names ${hex.size} hex colour${hex.size === 1 ? "" : "s"} (at least 5: background, ink, accents)`);
  }
  if (o.video) {
    const p = secs.find((s) => /pacing/i.test(s.head)) ?? secs.find((s) => /shot/i.test(s.head));
    if (
      (p
        ? (own(p)
            .join(" ")
            .replace(/#[0-9a-f]{3,8}\b/gi, " ")
            .match(/\d+(?:\.\d+)?/g) ?? [])
        : []
      ).length < 2
    )
      out.push("reference/ANALYSIS.md: the Pacing section needs the measured numbers (cuts per minute, median shot length in s)");
  }
  return out;
}
const studyTemplate = () => {
  try {
    return fs.readFileSync(path.join(templatesDir(), "studio", "templates", "STUDY.md"), "utf8");
  } catch {
    return "";
  }
};
const guideTemplate = () => {
  try {
    return fs.readFileSync(path.join(templatesDir(), "studio", "templates", "STYLE_GUIDE.md"), "utf8");
  } catch {
    return "";
  }
};
function guideGaps(text, template) {
  if (text == null) return ["skill/STYLE_GUIDE.md is missing"];
  const tpl = sections(template),
    secs = sections(text),
    heads = tpl.map((t) => t.head);
  const own = (s) => {
    const desc = new Set((tpl.find((t) => t.head === s.head)?.body ?? []).map((l) => l.trim()).filter((l) => l && l !== FILL_MARK));
    return s.body.map((l) => l.trim()).filter((l) => l && !desc.has(l) && !/^\|[\s|:-]*\|$/.test(l) && !/^\|\s*_\(to fill\)_\s*\|/.test(l));
  };
  const gone = heads.filter((h) => !secs.some((s) => s.head === h)).map((h) => `"${h}"`);
  const empty = secs.filter((s) => heads.includes(s.head) && (!own(s).length || s.body.some(hasFillMark))).map((s) => `"${s.head}"`);
  const out = [];
  if (gone.length)
    out.push(
      `skill/STYLE_GUIDE.md lacks the heading${gone.length === 1 ? "" : "s"} ${gone.slice(0, 4).join(", ")}${gone.length > 4 ? ` and ${gone.length - 4} more` : ""}`,
    );
  if (empty.length)
    out.push(`skill/STYLE_GUIDE.md: fill ${empty.slice(0, 4).join(", ")}${empty.length > 4 ? ` and ${empty.length - 4} more` : ""}`);
  return out;
}
const isMustFailView = (name, v) => !!v?.expect || /^mustfail/i.test(name);
const viewsOf = (studio, kind) =>
  Object.keys(studio.views ?? {}).filter((n) => n.toLowerCase().startsWith(kind) && !isMustFailView(n, studio.views[n]));
function viewGaps(dir, studio, kind, last2, open) {
  const names = viewsOf(studio, kind),
    out = [];
  if (!names.length) return [`there is no ${kind} view`];
  if (!last2?.checks?.ran) return [`the ${kind} frames are not rendered yet (Run checks, or Claude's next turn makes a version)`];
  for (const n of names)
    for (const a of studio.aspects) {
      const p = last2.checks.pairs.find((x) => x.view === n && x.aspect === a);
      if (!p) out.push(`the ${n} view was not checked in ${a} (Run checks)`);
      else if (!p.boot) out.push(`the ${n} view does not load in ${a}`);
      if (kind === "hero" && p?.boot) {
        const shots = new Set((last2.renders?.[a]?.frames ?? []).filter((f) => f.view === n && f.shot != null).map((f) => f.shot));
        if (shots.size < 3) out.push(`the ${n} view shows ${shots.size} hero frame${shots.size === 1 ? "" : "s"} in ${a} (3 are needed)`);
      }
    }
  const high = open.filter((i) => i.severity === "high" && names.includes(String(i.where?.view ?? "")));
  if (high.length) out.push(`${high.length} high-severity issue${high.length === 1 ? " is" : "s are"} open on the ${kind} frames`);
  return out;
}
const shotName = (s) => {
  const n = String(s ?? "")
    .replace(/^(?:(?:kit|hero|sample)\s*)?\d+[a-z]?\s*[:.-]\s*/i, "")
    .trim()
    .slice(0, 60);
  return /^Shot \d+$/.test(n) ? "" : n;
};
export function kitElements(dir, studio, vs = readVersions(dir), issues = readIssues(dir)) {
  const last2 = vs[vs.length - 1];
  if (!last2) return [];
  const a0 = studio.aspects[0],
    open = issues.filter(isOpen),
    out = [];
  for (const view of viewsOf(studio, "kit")) {
    let shots = last2.renders?.[a0]?.shots?.[view] ?? [];
    if (!shots.length) {
      const fr = (last2.renders?.[a0]?.frames ?? []).filter((f) => f.view === view && f.shot != null);
      shots = [...new Set(fr.map((f) => f.shot))]
        .sort((a, b) => a - b)
        .map((k) => {
          const ts = fr.filter((f) => f.shot === k).map((f) => f.t);
          return { t0: Math.min(...ts), t1: Math.max(...ts), name: "" };
        });
    }
    shots.forEach((s, k) => {
      const name = shotName(s.name) || `Element ${k + 1}`,
        key2 = `${view}#${shotName(s.name) || k + 1}`,
        mid = s.t0 + (s.t1 - s.t0) / 2;
      const frames = {};
      for (const a of studio.aspects) {
        const fr = (last2.renders?.[a]?.frames ?? []).filter(
          (f) => f.view === view && (f.shot === k || (f.shot == null && f.t >= s.t0 && f.t < s.t1)),
        );
        frames[a] = fr.sort((x, y) => Math.abs(x.t - mid) - Math.abs(y.t - mid))[0] ?? null;
      }
      const on = open
        .filter(
          (i) =>
            i.where?.view === view &&
            (i.where.shot === k || (i.where.shot == null && typeof i.where.t === "number" && i.where.t >= s.t0 - 1e-6 && i.where.t < s.t1)),
        )
        .map((i) => ({ id: i.id, title: i.title, severity: i.severity, source: i.source, check: i.check }));
      out.push({
        key: key2,
        view,
        shot: k,
        name,
        t: +mid.toFixed(2),
        t0: s.t0,
        t1: s.t1,
        frames,
        issues: on,
        mark: studio.kit?.[key2] ?? null,
      });
    });
  }
  return out;
}
function kitGaps(els, last2) {
  if (!last2?.checks?.ran) return ["the kit is not rendered yet (Run checks, or Claude's next turn makes a version)"];
  if (!els.length) return ["the kit view shows no elements (one element per kit shot)"];
  const flagged = els.filter((e) => e.mark?.status === "flagged"),
    todo = els.filter((e) => e.mark?.status !== "approved" && e.mark?.status !== "flagged");
  const out = [];
  if (todo.length)
    out.push(
      `${todo.length} of ${els.length} kit element${els.length === 1 ? "" : "s"} not approved yet (Approve or Flag each one in the gallery)`,
    );
  if (flagged.length)
    out.push(
      `${flagged.length} flagged kit element${flagged.length === 1 ? "" : "s"} (${flagged
        .slice(0, 3)
        .map((e) => e.name)
        .join(", ")}): fix, then approve`,
    );
  return out;
}
export function collectFacts(dir, studio) {
  const exists = {},
    filled = {};
  for (const rel of GATE_FILES) {
    let t = null;
    try {
      t = fs.readFileSync(path.join(dir, rel), "utf8");
    } catch {}
    exists[rel] = t != null;
    filled[rel] = t != null && t.trim().length > 40 && !hasFillMark(t);
  }
  let scenes = [];
  try {
    scenes = fs.readdirSync(path.join(dir, "scenes"));
  } catch {}
  const vs = readVersions(dir),
    last2 = vs[vs.length - 1],
    refs = referencePaths(dir);
  let analysis;
  if (refs.length) {
    let t = null;
    try {
      t = fs.readFileSync(path.join(dir, "reference", "ANALYSIS.md"), "utf8");
    } catch {}
    const kinds = refs.map(kindOf);
    analysis = analysisGaps(t, studyTemplate(), {
      visual: kinds.some((k) => k === "image" || k === "video"),
      video: kinds.includes("video"),
    });
  }
  let guide, kitG, sampleG;
  if (studio.mode !== "look") {
    const issues = readIssues(dir),
      open = issues.filter(isOpen);
    let g = null;
    try {
      g = fs.readFileSync(path.join(dir, "skill", "STYLE_GUIDE.md"), "utf8");
    } catch {}
    guide = [...guideGaps(g, guideTemplate()), ...viewGaps(dir, studio, "hero", last2, open)];
    kitG = [...kitGaps(kitElements(dir, studio, vs, issues), last2)];
    sampleG = viewGaps(dir, studio, "sample", last2, open);
  }
  return {
    analysis,
    exists,
    filled,
    kit: scenes.filter((f) => /^kit[\w-]*\.js$/i.test(f)).length,
    samples: scenes.filter((f) => /^sample[\w-]*\.js$/i.test(f)).length,
    refs: refs.length,
    openHigh: issueSummary(dir).openHigh,
    lookSettings: !!studio.look && Object.keys(studio.look.settings ?? {}).length > 0,
    checked: !!last2?.checks?.ran,
    saved: !!studio.saved?.lookId,
    guide,
    kitGaps: kitG,
    sampleGaps: sampleG,
    published: !!studio.published?.id,
  };
}
export function getStudio(projectId) {
  const { dir, studio } = requireStudio(projectId);
  const order = stagesOf(studio.mode),
    i = order.indexOf(studio.stage),
    facts = collectFacts(dir, studio);
  const vs = readVersions(dir),
    last2 = vs[vs.length - 1] ?? null;
  const kit =
    studio.mode === "look"
      ? []
      : kitElements(dir, studio, vs).map((e) => ({
          ...e,
          frames: Object.fromEntries(
            Object.entries(e.frames).map(([a, f]) => [a, f ? { ...f, url: projectUrl(projectId, f.file) } : null]),
          ),
        }));
  return {
    projectId,
    dir,
    studio,
    stages: order,
    next: order[i + 1] ?? null,
    gate: gateOf(studio.stage, studio.mode, facts),
    issues: issueSummary(dir),
    versions: vs.length,
    latest: last2
      ? { v: last2.v, label: last2.label, at: last2.at, checked: !!last2.checks?.ran, open: last2.open, openHigh: last2.openHigh }
      : null,
    activity: activityOf(projectId),
    kit,
    publish: studio.mode === "look" ? null : publishOf(projectId),
  };
}
let publishOf = () => null;
export const onPublishState = (f) => {
  publishOf = f;
};
export function markKit(projectId, key2, status, extra = {}) {
  const { dir, studio } = requireStudio(projectId);
  if (studio.mode === "look") throw new Error("A look has no kit.");
  const el = kitElements(dir, studio).find((e) => e.key === key2);
  if (!el) throw new Error("That kit element is not in the latest version any more.");
  writeStudio(projectId, (s) => {
    s.kit ??= {};
    if (status)
      s.kit[key2] = {
        status,
        at: new Date().toISOString(),
        name: extra.name ?? el.name,
        issue: extra.issue ?? null,
        v: extra.v ?? readVersions(dir).slice(-1)[0]?.v ?? null,
      };
    else delete s.kit[key2];
  });
  notifyStudio(projectId);
  return { ...el, mark: requireStudio(projectId).studio.kit?.[key2] ?? null };
}
export function setStage(projectId, to, o = {}) {
  const { dir, studio } = requireStudio(projectId),
    order = stagesOf(studio.mode);
  const i = order.indexOf(studio.stage),
    j = order.indexOf(to);
  if (j < 0) throw new Error(`"${String(to).slice(0, 20)}" is not a stage of this ${studio.mode === "look" ? "look" : "style"}.`);
  if (j === i) return getStudio(projectId);
  const at = new Date().toISOString();
  if (j > i && !(o.force && process.env.CZ_TEST_HOOKS === "1")) {
    const facts = collectFacts(dir, studio);
    for (let k = i; k < j; k++) {
      const g = gateOf(order[k], studio.mode, facts);
      if (!g.ok) throw new Error(`The ${order[k]} stage is not finished: ${g.missing.join("; ")}.`);
    }
  }
  writeStudio(projectId, (s) => {
    s.stages ??= {};
    if (j > i) for (let k = i; k < j; k++) s.stages[order[k]] = { status: "approved", at };
    else
      for (let k = j + 1; k < order.length; k++) {
        const st = s.stages[order[k]];
        if (st && st.status !== "idle") s.stages[order[k]] = { status: "stale", at };
      }
    if (j < i && s.stages[to]?.status === "approved") s.stages[to] = { status: "done", at };
    s.stage = to;
  });
  notifyStudio(projectId);
  return getStudio(projectId);
}
export function markStage(projectId, stage, status) {
  try {
    writeStudio(projectId, (s) => {
      s.stages ??= {};
      s.stages[stage] = { status, at: new Date().toISOString() };
    });
    notifyStudio(projectId);
  } catch {}
}
export const VIEW_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const SCENE_NAME = /^[A-Za-z0-9][\w-]{0,60}$/;
export function setView(projectId, view) {
  const { studio } = requireStudio(projectId);
  const v = VIEW_NAME.test(String(view)) ? studio.views?.[view] : void 0;
  if (!v)
    throw new Error(
      `"${String(view).slice(0, 40)}" is not a view of this workspace (views: ${Object.keys(studio.views ?? {}).join(", ")}).`,
    );
  if (!Array.isArray(v.scenes) || !v.scenes.length || !v.scenes.every((s) => SCENE_NAME.test(s)) || !(+v.end > 0))
    throw new Error(`The view "${view}" is broken in project.json.`);
  writeStudio(projectId, (s, pj) => {
    pj.scenes = [...v.scenes];
    pj.end = +v.end;
    s.view = view;
  });
  markDirty(projectId);
  notifyStudio(projectId);
  return { view, ...v };
}
