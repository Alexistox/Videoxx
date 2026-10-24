import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import { templatesDir } from "../../core/workspace";
import { log } from "../../core/log";
import { parseManifest } from "../../styles/manifest";
import { layoutCheckWith } from "../../render/workers";
import { formatFindings } from "../staticCheck";
import { forClaude } from "../../agent/tools/suiteTools";
import { insideDir, isolatedRun } from "../../agent/sessions";
import { registerHiddenProject, unregisterHiddenProject } from "../../projects/fileServer";
import {
  LOCKED_FILES,
  MAX_ROUNDS,
  checkAll,
  fixesFile,
  getRun,
  importBusy,
  originalManifestFile,
  restoreAppOwned,
  restoreLocked,
  saveRun,
  setImportBusy,
  setImportStop,
  settingsOf,
  wsDir,
} from "./styleImport";

const FIX_MODEL = "claude-opus-5-5";
const FIX_EFFORT = "high";
const FIX_TOOLS = new Set(["Read", "Glob", "Grep", "Edit", "Write"]);
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const FIX_DISALLOWED = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Task",
  "Agent",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "MultiEdit",
  "TodoWrite",
  "Skill",
];
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};
const exists = (f) => {
  try {
    fs.statSync(f);
    return true;
  } catch {
    return false;
  }
};
const clip = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const ALLOW = [/^engine\.js$/, /^models\.js$/, /^lib\/[^\0]+$/, /^scenes\/[^\0]+$/, /^skill\/[^\0]+$/, /^looks\/[^\0]+$/, /^style\.json$/];
function fixWriteCheck(ws, target) {
  if (!target) return "No file was named.";
  if (!insideDir(ws, target)) return `The style fixer only writes inside the style being imported (${ws}). ${target} is outside it.`;
  const rel = path.relative(path.resolve(ws), path.resolve(ws, target)).split(path.sep).join("/");
  if (!rel || rel.startsWith("..")) return "That is the style folder itself, not a file in it.";
  if (LOCKED_FILES.includes(rel.toLowerCase()))
    return `Denied: ${rel} is one of the checks a style is judged by (hash-locked): fix the style so it passes, never the check. If a finding is wrong, say so in your summary.`;
  if (/^scenes\/mustfail_/i.test(rel))
    return "Denied: the must-fail scenes are the proof that the checks work: fix the engine or the style so they fail again, never the proof.";
  if (/^skill\/base\//i.test(rel)) return "Denied: skill/base/ is the documentation of the base engine the style was built on (read only).";
  if (ALLOW.some((r) => r.test(rel))) return null;
  return `Denied: the style fixer writes only engine.js, models.js, lib/, scenes/, skill/, looks/ and style.json. ${rel} is the app's (project.json, audio/, .suite/ and the rest).`;
}
function fixReadCheck(ws, target) {
  if (!target || insideDir(ws, target)) return null;
  const abs = path.resolve(ws, target);
  try {
    if (insideDir(templatesDir(), abs)) return null;
  } catch {}
  return `The style fixer reads only the style being imported (${ws}) and the app's own templates (base engines, the Style Kit docs). ${abs} is outside them.`;
}
const text = (t) => ({ content: [{ type: "text", text: t }] });
let jobN = 0;
function manifestOf(id) {
  const cur = parseManifest(readJson(path.join(wsDir(id), "style.json")));
  if (cur.ok) return cur.m;
  const o = parseManifest(readJson(originalManifestFile(id)));
  if (o.ok) return o.m;
  throw new Error("style.json is not readable");
}
function viewOf(id, view) {
  const views = readJson(path.join(wsDir(id), "project.json"))?.views ?? {};
  const v = views[view];
  return { v: v && Array.isArray(v.scenes) && +v.end > 0 ? { scenes: v.scenes, end: +v.end } : null, names: Object.keys(views) };
}
function fixToolDefs(id) {
  const ws = wsDir(id);
  const look = async (view, aspect, o) => {
    const m = manifestOf(id),
      a = aspect && m.aspects.includes(aspect) ? aspect : m.aspects[0],
      { v, names } = viewOf(id, view);
    if (!v) return { err: `There is no view "${clip(view, 40)}". Views: ${names.join(", ")}.`, a, r: null };
    const hid = `${id}-c${++jobN}`;
    registerHiddenProject(hid, ws);
    try {
      return {
        err: null,
        a,
        v,
        r: await layoutCheckWith(hid, settingsOf(m, a), v, {
          layout: o.layout,
          stills: o.stills
            ? () => ({ times: o.stills.times.map((t) => Math.max(0, Math.min(v.end - 0.02, t))), scale: o.stills.scale })
            : void 0,
        }),
      };
    } finally {
      unregisterHiddenProject(hid);
    }
  };
  const errorsOf = (r) => [
    ...(r?.bootError ? [`BOOT: ${r.bootError}`] : []),
    ...(r?.errors ?? [])
      .filter((e) => e.level === "error" || e.level === "warn")
      .slice(0, 12)
      .map((e) => `${e.level.toUpperCase()}: ${String(e.text).slice(0, 300)}`),
  ];
  return [
    {
      name: "render_view",
      description:
        'Render stills of one view of the style being imported (views: sample, hero, kit, mustfail_...) in one format ("16:9" or "9:16", each the style renders) at the given times, with the files as they are now, and return them as images, plus any error the page logged. scale 0.5 (default) or 1 for a close look.',
      schema: {
        view: z.string().max(60),
        aspect: z.enum(["16:9", "9:16"]).optional(),
        times: z.array(z.number().min(0)).min(1).max(6),
        scale: z.number().min(0.25).max(1).optional(),
      },
      handler: async ({ view, aspect, times, scale }) => {
        try {
          const o = await look(view, aspect, { stills: { times, scale: scale ?? 0.5 }, layout: false });
          if (o.err) return text(o.err);
          const side = times.length <= 2 ? 1280 : 800,
            content = [];
          for (const s of o.r.stills) {
            if (!s.png) {
              content.push({ type: "text", text: `${view} ${o.a} t = ${s.time.toFixed(2)}s: drawing threw an error` });
              continue;
            }
            content.push({ type: "text", text: `${view} ${o.a} t = ${s.time.toFixed(2)}s` }, forClaude(s.png, side));
          }
          const errs = errorsOf(o.r);
          if (errs.length)
            content.push({
              type: "text",
              text: `The page logged:
${errs.join("\n")}`,
            });
          return { content };
        } catch (e) {
          return text(`render_view failed: ${clip(e?.message || e, 300)}`);
        }
      },
    },
    {
      name: "check_layout",
      description:
        "The engine's own layout check (and the page's errors) on one view of the style being imported, in one format: the same check the import runs. A must-fail view must report its expected finding.",
      schema: { view: z.string().max(60), aspect: z.enum(["16:9", "9:16"]).optional() },
      handler: async ({ view, aspect }) => {
        try {
          const o = await look(view, aspect, { layout: true });
          if (o.err) return text(o.err);
          const issues = o.r.layout?.issues ?? [],
            errs = errorsOf(o.r);
          const lines = !o.r.layout
            ? ["This engine has no layout check (the import judges its frames instead)."]
            : !issues.length
              ? [`Clean: no layout issue in ${view} (${o.a}).`]
              : [
                  `${issues.length} issue${issues.length > 1 ? "s" : ""} in ${view} (${o.a}):`,
                  ...issues
                    .slice(0, 40)
                    .map(
                      (i) =>
                        `${(+i.t).toFixed(2)}s ${String(i.type).toUpperCase()} ${i.what}${i.other ? ` / ${i.other}` : ""}: ${String(i.detail ?? "").slice(0, 220)}`,
                    ),
                ];
          return text([...lines, ...(errs.length ? ["", "The page logged:", ...errs] : [])].join("\n"));
        } catch (e) {
          return text(`check_layout failed: ${clip(e?.message || e, 300)}`);
        }
      },
    },
  ];
}
const FIX_SYSTEM = `You are the style fixer inside Videoxx. A member made a video style in the Videoxx Style Kit and is importing it; the app's checks found problems. You fix exactly those problems in the style's files (your working directory, laid out like a project), with the smallest change that makes each check pass, keeping the style's look. You never loosen a check, never edit a check's code or a must-fail scene, and never touch files outside the style. You have Read, Glob, Grep, Edit, Write and the tools render_view and check_layout; no shell, no web, no helpers. The app runs every check again itself after you finish.`;
function fixPrompt(id, run) {
  const ws = wsDir(id),
    md = (f, n = 8e3) => {
      try {
        return (
          fs
            .readFileSync(path.join(ws, "skill", f), "utf8")
            .slice(0, n)
            .trim() || "(empty)"
        );
      } catch {
        return "(none)";
      }
    };
  let checks = "";
  try {
    checks = fs.readFileSync(path.join(templatesDir(), "stylekit", "docs", "CHECKS.md"), "utf8").slice(0, 4e4);
  } catch {
    checks = "(not available)";
  }
  const views = Object.keys(readJson(path.join(ws, "project.json"))?.views ?? {}),
    m = manifestOf(id);
  const open = run.findings.filter((f) => f.sev === "high" || f.sev === "medium");
  return `Fix the style "${m.name}" (${m.id}, built on the ${m.base} engine, formats ${m.aspects.join(" and ")}) so the import's checks pass. Round ${run.round} of at most ${MAX_ROUNDS} in a row.

## The findings (finding -> meaning -> fix), high first: fix every HIGH one; mediums only when the fix is small and safe
${formatFindings(open)}

## The folder (your working directory)
Findings name files the way the package holds them: engine/<file> is <file> here (engine/lib/x.js = lib/x.js), sample/scenes/<scene>.js is scenes/<scene>.js, sample/assets/ is assets/, sample/timeline.json is audio/timeline.json.
- engine.js, models.js, lib/  the style's engine. Exports may be added, never removed or renamed; ENGINE_KIND never changes; keep \`export const ENGINE_VERSION = N\` exactly in that form.
- scenes/  the sample views' scenes (views: ${views.join(", ")}). scenes/mustfail_*.js are the proof that the checks catch faults: never edit them.
- skill/  the style's own guide: STYLE_GUIDE.md, QUALITY.md, PITFALLS.md (add one line to PITFALLS.md per fix: a rule that holds outside this style). skill/base/ is the base engine's documentation (read only).
- looks/*.json, style.json  the looks and the manifest. The app owns id, base, from, kit, version, aspects, dim: changes to them are undone.
- assets/, audio/, project.json, .suite/  the app's (the sample's pictures, its narration timing, the views): read only.
You may write ONLY engine.js, models.js, lib/**, scenes/** (not mustfail_*), skill/** (not skill/base/), looks/**, style.json. Never lib/contact.js, lib/collide.js, lib/check.js or lib/scan.js (the checks themselves: fix what they find, never them), never a file outside this folder: those writes are refused.

## How to work
1. Read each file a finding names (file:line), and the style's skill files below.
2. Fix the cause with the smallest change. Frames are pure functions of the time t: no Math.random, Date.now, performance.now, timers, fetch of absolute URLs, DOM writes or browser storage (use the engine's seeded generator and t). Files are UTF-8 without BOM, LF line endings.
3. Look at your fix: render_view the view and moment the finding names (both formats when the style has two); check_layout a view whose layout finding you fixed; a must-fail view must still report its expected finding.
4. End your answer with one line per changed file: \`FIX: <file>: <why, in one line>\`.

## The style's guide (skill/STYLE_GUIDE.md)
${md("STYLE_GUIDE.md")}

## Its quality bar (skill/QUALITY.md)
${md("QUALITY.md")}

## Its known pitfalls (skill/PITFALLS.md)
${md("PITFALLS.md", 5e3)}

## Every check: what it means and how it is fixed (the Style Kit's docs/CHECKS.md)
${checks}
`;
}
const TEXT = /\.(m?js|json|md|txt|csv|svg)$/i;
function snap(ws) {
  const hash = new Map(),
    text2 = new Map();
  const walk = (rel) => {
    let es = [];
    try {
      es = fs.readdirSync(path.join(ws, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && ["out", ".suite", ".git", "node_modules"].includes(e.name)) continue;
      if (e.isDirectory()) {
        walk(r);
        continue;
      }
      if (!e.isFile()) continue;
      const b = fs.readFileSync(path.join(ws, r));
      hash.set(r, crypto.createHash("sha1").update(b).digest("hex"));
      if (TEXT.test(r) && b.length < 2e6 && !/^vendor\//.test(r)) text2.set(r, b.toString("utf8"));
    }
  };
  walk("");
  return { hash, text: text2 };
}
const changedBetween = (a, b) => [...new Set([...a.hash.keys(), ...b.hash.keys()])].filter((k) => a.hash.get(k) !== b.hash.get(k)).sort();
function lineDiff(file, before, after) {
  const A = before == null ? [] : before.replace(/\r\n?/g, "\n").split("\n"),
    B = after == null ? [] : after.replace(/\r\n?/g, "\n").split("\n");
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a = A.slice(s, A.length - e),
    b = B.slice(s, B.length - e),
    out = [];
  if (a.length * b.length <= 4e6) {
    const n = a.length,
      m = b.length,
      L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i2 = n - 1; i2 >= 0; i2--)
      for (let j2 = m - 1; j2 >= 0; j2--) L[i2][j2] = a[i2] === b[j2] ? L[i2 + 1][j2 + 1] + 1 : Math.max(L[i2 + 1][j2], L[i2][j2 + 1]);
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        out.push(` ${a[i]}`);
        i++;
        j++;
      } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) out.push(`+${b[j++]}`);
      else out.push(`-${a[i++]}`);
    }
  } else out.push(...a.map((l) => `-${l}`), ...b.map((l) => `+${l}`));
  const ctx = (k) => A.slice(Math.max(0, k - 3), k).map((l) => ` ${l}`),
    tail = A.slice(A.length - e, A.length - e + 3).map((l) => ` ${l}`);
  return [`--- a/${file}`, `+++ b/${file}`, `@@ -${Math.max(1, s - 2)} +${Math.max(1, s - 2)} @@`, ...ctx(s), ...out, ...tail].join("\n");
}
const diffOf = (a, b, files) =>
  files
    .map((f) =>
      TEXT.test(f)
        ? lineDiff(f, a.text.get(f), b.text.get(f))
        : `Binary file ${f} ${a.hash.has(f) ? (b.hash.has(f) ? "changed" : "removed") : "added"}`,
    )
    .join("\n");
async function claudeRound(id, run, ac) {
  const ws = wsDir(id),
    refused = new Set(),
    texts = [];
  const deny = (why) => ({ behavior: "deny", message: why });
  const noteRefused = (what) => {
    refused.add(clip(what, 160));
  };
  const activity = (s) => {
    if (run.fix) {
      run.fix.activity = clip(s, 200);
      saveRun(run);
    }
  };
  const relOf = (t) => {
    const r = path.relative(ws, path.resolve(ws, t)).split(path.sep).join("/");
    return r.startsWith("..") ? t : r;
  };
  const canUseTool = async (name, input) => {
    if (name === "mcp__suite__render_view" || name === "mcp__suite__check_layout") return { behavior: "allow", updatedInput: input };
    if (!FIX_TOOLS.has(name)) {
      return deny(`The style fixer has no ${name}: only Read, Glob, Grep, Edit, Write, render_view and check_layout.`);
    }
    if (EDITS.has(name)) {
      const t = String(input?.file_path ?? ""),
        why = fixWriteCheck(ws, t);
      if (why) {
        noteRefused(relOf(t));
        return deny(why);
      }
    } else {
      const t = String(input?.file_path ?? input?.path ?? ""),
        why = fixReadCheck(ws, t);
      if (why) return deny(why);
    }
    return { behavior: "allow", updatedInput: input };
  };
  const out = (why) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } });
  const confine = async (h) => {
    const t = String(h?.tool_input?.file_path ?? h?.tool_input?.notebook_path ?? ""),
      why = fixWriteCheck(ws, t);
    if (why) {
      noteRefused(relOf(t));
      return out(why);
    }
    return {};
  };
  const readGate = async (h) => {
    const t = String(h?.tool_input?.file_path ?? h?.tool_input?.path ?? ""),
      why = fixReadCheck(ws, t);
    return why ? out(why) : {};
  };
  activity("Claude is reading the findings and the style ...");
  let finished = false;
  for await (const m of isolatedRun({
    cwd: ws,
    prompt: fixPrompt(id, run),
    append: FIX_SYSTEM,
    model: FIX_MODEL,
    effort: FIX_EFFORT,
    maxTurns: 120,
    defs: fixToolDefs(id),
    canUseTool,
    disallowedTools: FIX_DISALLOWED,
    abort: ac,
    hooks: {
      PreToolUse: [
        { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [confine] },
        { matcher: "Read|Grep|Glob", hooks: [readGate] },
      ],
    },
  })) {
    if (m.type === "assistant")
      for (const b of m.message?.content ?? []) {
        if (b.type === "text" && b.text) texts.push(String(b.text));
        if (b.type === "tool_use") {
          const i = b.input ?? {},
            f = i.file_path ? relOf(String(i.file_path)) : "";
          activity(
            b.name === "Read"
              ? `Reading ${f}`
              : b.name === "Edit" || b.name === "Write"
                ? `Changing ${f}`
                : /render_view/.test(b.name)
                  ? `Looking at ${i.view} ${i.aspect ?? ""} at ${(i.times ?? []).join(", ")} s`
                  : /check_layout/.test(b.name)
                    ? `Checking the layout of ${i.view} ${i.aspect ?? ""}`
                    : /check_preview/.test(b.name)
                      ? `Checking that ${i.view ?? "the views"} load${i.view ? "s" : ""}`
                      : /^(Grep|Glob)$/.test(b.name)
                        ? "Searching the style's files ..."
                        : "Working on the fixes ...",
          );
        }
      }
    if (m.type === "result") finished = m.subtype === "success";
    if (ac.signal.aborted) break;
  }
  const all = texts.join("\n"),
    reasons = [...all.matchAll(/^\s*[-*]?\s*FIX:\s*(.+)$/gim)].map((x) => clip(x[1], 300));
  if (!reasons.length) {
    const last2 = texts[texts.length - 1] ?? "";
    if (last2.trim()) reasons.push(clip(last2.split("\n").find((l) => l.trim()) ?? "", 300));
  }
  return { reasons, refused: [...refused], finished };
}
function writeFixes(id, round, o) {
  const f = fixesFile(id);
  let s = exists(f)
    ? fs.readFileSync(f, "utf8")
    : `# Fixes made by Videoxx

When this style was imported, the app's Claude (a fixer that may change only the style's own files) fixed what the checks found. Each round: what it changed and why, then the exact change. Bring these into your Style Kit (Export package, then \`cz import-package <zip> --replace\`) and add the lessons to skill/PITFALLS.md.
`;
  s += `
## Round ${round} (${new Date().toISOString().slice(0, 16).replace("T", " ")})

High findings before: ${o.highBefore}. After: ${o.highAfter == null ? "not checked (stopped)" : o.highAfter}.

`;
  s += o.changed.length
    ? `Changed: ${o.changed.join(", ")}

`
    : "Nothing was changed.\n\n";
  if (o.reasons.length)
    s += `Why (Claude):
${o.reasons.map((r) => `- ${r}`).join("\n")}

`;
  if (o.refused.length)
    s += `Refused (outside what the fixer may write): ${o.refused.join(", ")}

`;
  if (o.putBack.length)
    s += `Put back as they came (the checks are hash-locked): ${o.putBack.join(", ")}

`;
  if (o.patch.trim())
    s += "```diff\n" + o.patch.slice(0, 6e4) + (o.patch.length > 6e4 ? "\n... (the rest of the diff is cut)\n" : "\n") + "```\n";
  fs.writeFileSync(f, s);
}
export function fixImport(id) {
  const run = getRun(id);
  if (!run) throw new Error("That import is gone.");
  if (run.checkOnly)
    throw new Error(
      "A re-check only shows what is wrong: fix it in the Style Kit (Export package, then cz import-package), or import the package again and let Claude fix it there.",
    );
  if (importBusy(id)) throw new Error("The import is still being checked: wait for the result.");
  if (run.status !== "needs-fix")
    throw new Error(
      run.status === "ready"
        ? "Nothing to fix: no high finding is left."
        : `There is nothing Claude can fix in this import now (${run.status}).`,
    );
  const ws = wsDir(id);
  if (!exists(path.join(ws, "project.json")))
    throw new Error(
      "Claude can fix only a package whose style.json, engine and sample views could be read: use Copy fix list and fix it in the Style Kit.",
    );
  setImportBusy(id, true);
  const ac = new AbortController();
  setImportStop(id, ac);
  run.status = "fixing";
  run.error = null;
  run.fix = { running: true, activity: "Starting Claude ...", rounds: run.fix?.rounds ?? [] };
  saveRun(run);
  (async () => {
    try {
      for (let k = 0; k < MAX_ROUNDS && !ac.signal.aborted; k++) {
        const highBefore = run.findings.filter((f) => f.sev === "high").length;
        if (!highBefore) break;
        run.round++;
        const s0 = snap(ws);
        let res = { reasons: [], refused: [], finished: false };
        try {
          res = await claudeRound(id, run, ac);
        } catch (e) {
          if (!ac.signal.aborted) {
            run.error = clip(e?.message || e, 400);
            log("style fix round failed", id, e?.stack || e?.message);
          }
        }
        const putBack = restoreLocked(id);
        restoreAppOwned(id);
        const s1 = snap(ws),
          changed = changedBetween(s0, s1),
          patch = changed.length ? diffOf(s0, s1, changed) : "";
        if (ac.signal.aborted && !changed.length) {
          run.round--;
          break;
        }
        const entry = { round: run.round, changed, reasons: res.reasons, highBefore, highAfter: null, refused: res.refused };
        run.fix.rounds.push(entry);
        saveRun(run);
        if (run.error && !changed.length) {
          writeFixes(id, run.round, { ...entry, putBack, patch });
          break;
        }
        if (!ac.signal.aborted) {
          run.fix.activity = "The app is checking everything again ...";
          saveRun(run);
          const whole = await checkAll(run, { initial: false, stopped: () => ac.signal.aborted });
          if (whole) entry.highAfter = run.findings.filter((f) => f.sev === "high").length;
        }
        writeFixes(id, run.round, { ...entry, putBack, patch });
        saveRun(run);
        if (!changed.length) break;
      }
    } catch (e) {
      run.error = clip(e?.message || e, 400);
      log("style fix failed", id, e?.stack || e?.message);
    } finally {
      const high = run.findings.filter((f) => f.sev === "high").length,
        stoppedEarly = ac.signal.aborted;
      run.status = high || (stoppedEarly && run.fix?.rounds.some((r) => r.highAfter == null)) ? "needs-fix" : "ready";
      if (run.fix) {
        run.fix.running = false;
        run.fix.activity = stoppedEarly
          ? "Stopped."
          : high
            ? `${high} high finding${high > 1 ? "s" : ""} left after ${run.fix.rounds.length} round${run.fix.rounds.length > 1 ? "s" : ""}.`
            : "Fixed: every check passes.";
      }
      setImportBusy(id, false);
      setImportStop(id, null);
      saveRun(run);
      log("style fix", id, run.status, `${run.round} rounds`);
    }
  })();
  return run;
}
export const fixesOf = (id) => {
  try {
    return fs.readFileSync(fixesFile(id), "utf8");
  } catch {
    return "";
  }
};
