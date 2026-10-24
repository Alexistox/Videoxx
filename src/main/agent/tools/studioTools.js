import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { validateSettings } from "../../styles/presets";
import { renderStills } from "../../render/workers";
import { addIssue, isOpen, readIssues, recordLesson, updateIssue } from "../../projects/issues";
import { getStudio, notifyStudio, readVersions, requireStudio, setView, writeStudio } from "../../studio/stages";
import { addFont, aspectsOfStyle, fontLibrary } from "../../studio/workspace";
import { allowedFor } from "../../studio/writeCheck";
import { readTargets } from "../../studio/targets";
import { budgetLeft, budgetText, claudeImage, frameSide, onFramesRendered, pruneBatches, spend, tally, text } from "./suiteTools";
import { projectUrl } from "../../projects/fileServer";

const mergeSettings = (a, b) => {
  const o = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {}))
    o[k] =
      v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? { ...o[k], ...v } : v;
  return o;
};
const CRITIC_EVIDENCE =
  /\b(overlay|edges?|blend|side[- ]by[- ]side|crops?|frames?|render(ed)?|targets?|check_layout|checks?|measured|t\d+)\b|\d+(\.\d+)?\s?(px|%|°|deg|m|s)\b|#[0-9a-f]{6}\b/i;
const readProjectJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^﻿/, ""));
export function studioToolDefs(projectId, ledger) {
  const ws = () => requireStudio(projectId);
  const fail = (name, e) => text(`${name}: ${e?.message || e}`);
  return [
    {
      name: "studio_state",
      description:
        "The Style Studio workspace: mode (new style from scratch, style on top of another, or a look), the current stage and every stage's status, the gate the current stage must pass, the files this stage may write, the views (scene sets: hero, kit, sample, must-fail) with which one is shown, the frames (aspects), the open issues and the font library.",
      schema: {},
      handler: async () => {
        try {
          const g = getStudio(projectId),
            s = g.studio,
            open = readIssues(g.dir).filter(isOpen);
          return text(
            [
              `${s.mode === "look" ? "LOOK for" : s.mode === "scratch" ? "NEW STYLE from scratch on" : "NEW STYLE on top of"} ${s.target} (base ${s.base}${s.dim ? `, ${s.dim}` : ""}): "${s.name}"`,
              `stage: ${s.stage} (${g.stages.map((x) => `${x}${s.stages?.[x] ? " " + s.stages[x].status : ""}`).join(" > ")})`,
              `gate to leave ${s.stage}: ${g.gate.ok ? "passes" : g.gate.missing.join("; ")}`,
              `may write now: ${allowedFor(s, s.stage).join(", ") || "nothing"}`,
              `views (shown: ${s.view}): ${Object.entries(s.views)
                .map(([k, v]) => `${k} [${v.scenes.join(", ")}] ${v.end}s${v.expect ? ` must report ${v.expect}` : ""}`)
                .join(" | ")}`,
              `aspects: ${s.aspects.join(", ")} | image cap ${s.imageCap} | engine exports at the start: ${s.baseExports.length}${s.look ? ` | look settings: ${JSON.stringify(s.look.settings).slice(0, 400)}` : ""}`,
              `versions: ${g.versions}${g.latest ? ` (latest v${g.latest.v} "${g.latest.label}", checks ${g.latest.checked ? "ran" : "not run"})` : ""}`,
              ...(() => {
                const tg = readTargets(g.dir),
                  sc = readVersions(g.dir)
                    .filter((v) => v.score)
                    .map((v) => `v${v.v} ${v.score.value}`);
                return [
                  tg.length
                    ? `target frames (reference/targets/<id>.jpg): ${tg.map((t) => `${t.id} -> ${t.view} ${t.aspect} at ${t.t}s`).join(", ")}`
                    : "",
                  sc.length ? `critic scores: ${sc.join(", ")}` : "",
                ].filter(Boolean);
              })(),
              `open issues: ${open.length}${
                open.length
                  ? "\n" +
                    open
                      .slice(0, 20)
                      .map((i) => `- [${i.id}] ${i.severity} ${i.title}`)
                      .join("\n")
                  : ""
              }`,
              `font library: ${fontLibrary()
                .map((f) => f.id)
                .join(", ")}`,
            ].join("\n"),
          );
        } catch (e) {
          return fail("studio_state", e);
        }
      },
    },
    {
      name: "set_view",
      description:
        "Show one view of the workspace in the preview (a scene set: hero, kit, sample, or a must-fail scene). The view's scenes and length go into project.json for you; check_preview / check_layout / render_frames then work on it.",
      schema: { view: z.string().max(60) },
      handler: async ({ view }) => {
        try {
          const v = setView(projectId, view);
          return text(
            `Showing ${v.view}: scenes ${v.scenes.join(", ")}, ${v.end} s${v.expect ? ` (a must-fail view: check_layout must report ${v.expect})` : ""}.`,
          );
        } catch (e) {
          return fail("set_view", e);
        }
      },
    },
    {
      name: "render_view",
      description: `Render stills of one view in one frame (aspect "16:9" or "9:16", each the style renders) at the given times, with the current files and the look being made, and return them as images. scale 0.5 (default) = 960 px on the long side; 1 = full detail for 1-2 times. The frames stay in the conversation: look at what you changed. Counts against the run's frame budget like render_frames.`,
      schema: {
        view: z.string().max(60),
        aspect: z.enum(["16:9", "9:16"]).optional(),
        times: z.array(z.number().min(0)).min(1).max(6),
        scale: z.number().min(0.25).max(1).optional(),
      },
      handler: async ({ view, aspect, times, scale }) => {
        try {
          const L = ledger;
          if (L?.over) {
            tally(L, "render_view", { refused: 1 });
            return text(budgetText(L));
          }
          const w = ws(),
            a = aspect ?? w.studio.aspects[0];
          if (!w.studio.aspects.includes(a))
            return text(`render_view: this ${w.studio.mode === "look" ? "look" : "style"} renders ${w.studio.aspects.join(" and ")} only.`);
          const v = setView(projectId, view);
          const pj = readProjectJson(w.dir);
          let settings = mergeSettings(pj.settings, w.studio.look?.settings);
          if (aspectsOfStyle(w.studio.target).length > 1) settings = { ...settings, format: a === "9:16" ? "vertical" : "landscape" };
          const batch = `claude-studio-${Date.now().toString(36)}`,
            side = frameSide(times.length, scale ?? 0.5);
          const shots = await renderStills(
            projectId,
            times.map((t) => Math.min(t, Math.max(0, v.end - 0.01))),
            scale ?? 0.5,
            batch,
            settings,
          );
          pruneBatches(w.dir);
          onFramesRendered({
            projectId,
            frames: shots
              .filter((s) => s.file)
              .map((s) => ({ time: s.time, url: projectUrl(projectId, `.suite/frames/${batch}/${path.basename(s.file)}`) })),
          });
          const content = [];
          let tokens = 0,
            images = 0;
          for (const s of shots) {
            if (!s.file) {
              content.push({
                type: "text",
                text: `${view} ${a} t = ${s.time.toFixed(2)}s: rendering threw an error (check_preview shows it)`,
              });
              continue;
            }
            const im = claudeImage(Buffer.from(s.base64, "base64"), side);
            tokens += im.tokens;
            images++;
            content.push({ type: "text", text: `${view} ${a} t = ${s.time.toFixed(2)}s` }, im.block);
          }
          tally(L, "render_view", { images, tokens });
          if (L) {
            spend(L, tokens, images);
            const note = budgetLeft(L);
            if (note) content.push({ type: "text", text: note.trim() });
          }
          return { content };
        } catch (e) {
          return fail("render_view", e);
        }
      },
    },
    {
      name: "add_issue",
      description:
        "File a problem you found (in a frame, a check result or the code) as a Studio issue the user sees: title (what is wrong, short), severity (high: breaks the style or a check; medium; low: polish), meaning (why it is bad), fix (the exact change), and where (view, aspect, t seconds, file, line, element). The same finding again updates the existing issue.",
      schema: {
        title: z.string().min(3).max(200),
        severity: z.enum(["high", "medium", "low"]).optional(),
        meaning: z.string().max(1e3).optional(),
        fix: z.string().max(1e3).optional(),
        check: z.string().max(40).optional(),
        view: z.string().max(40).optional(),
        aspect: z.enum(["16:9", "9:16"]).optional(),
        t: z.number().min(0).optional(),
        file: z.string().max(200).optional(),
        line: z.number().int().min(0).optional(),
        element: z.string().max(120).optional(),
      },
      handler: async (a) => {
        try {
          const w = ws();
          const r = addIssue(w.dir, {
            source: "opus",
            severity: a.severity,
            check: a.check ?? null,
            title: a.title,
            meaning: a.meaning,
            fix: a.fix,
            round: w.studio.round,
            where: {
              view: a.view ?? w.studio.view,
              aspect: a.aspect ?? null,
              t: a.t ?? null,
              file: a.file ?? null,
              line: a.line ?? null,
              element: a.element ?? null,
            },
          });
          notifyStudio(projectId);
          return text(
            `${r.added ? "Filed" : "Already filed, updated"}: [${r.issue.id}] ${r.issue.severity} ${r.issue.title} (${r.issue.status}).`,
          );
        } catch (e) {
          return fail("add_issue", e);
        }
      },
    },
    {
      name: "resolve_issue",
      description: `Mark a Studio issue fixed (after you changed the files AND looked again: check_layout / render_view) with the lesson learned, one sentence a future style should follow ("Pins sit 12 px below a card's top edge so they never hide its title"); or wontfix for an issue you filed yourself that is not a real problem (say why in lesson). Issues the checks or the user filed are only closed by fixing them.`,
      schema: { id: z.string().max(40), status: z.enum(["fixed", "wontfix"]), lesson: z.string().max(1e3).optional() },
      handler: async ({ id, status, lesson }) => {
        try {
          const w = ws(),
            i = readIssues(w.dir).find((x) => x.id === id);
          if (!i) return text(`resolve_issue: there is no issue ${id} (studio_state lists them).`);
          if (status === "wontfix" && i.source !== "opus" && i.source !== "critic")
            return text(
              "resolve_issue: only the user can dismiss an issue a check or they filed. Fix it, or explain in your summary why it is not a problem.",
            );
          if (!lesson || lesson.trim().length < 8) return text("resolve_issue: write the lesson (one sentence) so it is never repeated.");
          if (status === "wontfix" && i.source === "critic" && (lesson.trim().length < 30 || !CRITIC_EVIDENCE.test(lesson)))
            return text(
              'resolve_issue: a critic issue can be rejected only with EVIDENCE: name the overlay, frame or check that shows it is wrong and what it shows (e.g. "the edge overlay of t1 shows the horizon matches the target within 5 px"). Otherwise apply the fix.',
            );
          const u = updateIssue(w.dir, id, { status: status === "fixed" ? "verify" : "wontfix", lesson });
          if (status === "fixed") {
            const last2 = readVersions(w.dir).slice(-1)[0];
            recordLesson(w.dir, w.studio.name, u, lesson, last2 ? `after v${last2.v}` : null);
          }
          notifyStudio(projectId);
          return text(
            status === "fixed"
              ? `[${u.id}] is marked fixed, to verify: ${u.source === "check" ? "it closes when the app's checks after your turn no longer report it" : u.source === "critic" ? "the next critic (or the user) confirms it" : "the user confirms it"}. Lesson written to skill/PITFALLS.md.`
              : u.source === "critic"
                ? `[${u.id}] is rejected with your evidence: the next critic judges it (and reopens it if the evidence does not hold).`
                : `[${u.id}] is dismissed (wontfix).`,
          );
        } catch (e) {
          return fail("resolve_issue", e);
        }
      },
    },
    {
      name: "set_look_settings",
      description: `Set the settings of the look being made (the style's own Look controls: the same names and ranges as its Look panel). Merged into what you set before; validated against the style before it is kept; rendered by render_view. Never written into project.json "settings".`,
      // (an open object, never z.record: its JSON schema's propertyNames makes Claude Code drop every suite tool: schemaProblems)
      schema: { settings: z.object({}).catchall(z.any()) },
      handler: async ({ settings }) => {
        try {
          const w = ws(),
            pj = readProjectJson(w.dir);
          const next = mergeSettings(w.studio.look?.settings, settings),
            merged = mergeSettings(pj.settings, next);
          const bad = validateSettings(merged, w.studio.target);
          if (bad) return text(`set_look_settings: not kept: ${bad}`);
          writeStudio(projectId, (s) => {
            s.look = { settings: next, at: new Date().toISOString() };
          });
          notifyStudio(projectId);
          return text(`Look settings kept (${Object.keys(next).length} top-level keys). Look at them with render_view.`);
        } catch (e) {
          return fail("set_look_settings", e);
        }
      },
    },
    {
      name: "add_font",
      description:
        "Add a typeface from the Studio's font library (free OFL fonts the app ships) to the style: the file goes into fonts/ and an entry into the engine's FONT_FILES. Without id: the library list. Then use the family name in the engine's font table.",
      schema: { id: z.string().max(60).optional() },
      handler: async ({ id }) => {
        try {
          if (!id)
            return text(
              fontLibrary()
                .map((f) => `${f.id}: ${f.family} ${f.weight} ${f.style} (${f.licence})`)
                .join("\n") || "The font library is empty.",
            );
          const w = ws();
          if (w.studio.mode === "look") return text("add_font: a look never changes the engine (fonts are part of the style).");
          if (!allowedFor(w.studio, w.studio.stage).includes("engine.js"))
            return text(
              `add_font: the ${w.studio.stage} stage does not change the engine (fonts come in the guide, kit, sample and review stages).`,
            );
          const r = addFont(w.dir, id);
          return text(
            `${r.added ? "Added" : "Already there"}: ${r.family} ${r.weight} ${r.style} = ${r.file}. Use the family '${r.family}' (weight ${r.weight}) in the engine's font table.`,
          );
        } catch (e) {
          return fail("add_font", e);
        }
      },
    },
  ];
}
