import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { hostState } from "../../render/workers";
import { getProject } from "../../projects/projects";
import { criticShot, makeTarget, matchShot, providerName, scoresOf, targetRel } from "../ultraPlusTargets";
import { budgetText, claudeImage, getShots, onFramesRendered, spend, text } from "./suiteTools";
import { projectUrl } from "../../projects/fileServer";

const ultraClock = new Map();
export function ultraClockReset(projectId, minutes) {
  ultraClock.set(projectId, { minutes: minutes || null, started: new Map() });
}
function ultraTime(projectId, shot) {
  const c = ultraClock.get(projectId);
  if (!c?.minutes) return "";
  if (!c.started.has(shot)) c.started.set(shot, Date.now());
  const used = (Date.now() - c.started.get(shot)) / 1e3,
    limit = c.minutes * 60,
    mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
  return used >= limit
    ? `

TIME: ${mmss(used)} used of this shot's ${mmss(limit)} limit. Time is up: no new pass; finish the current change, check_preview, then the next shot.`
    : `

TIME: ${mmss(used)} used of this shot's ${mmss(limit)} limit (${mmss(limit - used)} left).${limit - used < 60 ? " Under a minute left: make this the last change." : ""}`;
}
export function ultraPlusToolDefs(projectId, ledger) {
  const shotsNow = async () => {
    let s = getShots(projectId);
    if (!s.length) {
      const st = await hostState(projectId);
      s = st.info?.shots ?? [];
    }
    return s;
  };
  const url = (rel) => `${projectUrl(projectId, rel)}?v=${Date.now().toString(36)}`;
  const pic = (file, side) => {
    if (ledger?.over) return null;
    const im = claudeImage(file, side);
    if (ledger) spend(ledger, im.tokens, 1);
    return im.block;
  };
  const fail = (name, e) => text(`${name}: ${e?.message || e}`);
  return [
    {
      name: "make_target",
      description:
        "Ultraedit+ (3D reconstruction): have the user's image service paint the IDEAL frame of one shot in this project's look (the app puts the recon look line - Studio or Investigation - in front of your prompt and adds the shot's narration). shot = the shot number (as list_shots / the storyboard number it). prompt = what the frame shows: subject, action, place, camera (angle, distance, lens), light and mood, foreground / midground / background, in plain words; never text in the picture. from_still: true = image-to-image from the shot's current render (keeps its camera and layout; for a shot that already exists), else text-to-image. Saved as assets/targets/shot<N>.jpg; counts against the project's image budget (about 1-5 cents). Make each target once.",
      schema: { shot: z.number().int().min(1).max(999), prompt: z.string().min(10).max(1500), from_still: z.boolean().optional() },
      handler: async (a) => {
        try {
          const s = await shotsNow(),
            r = await makeTarget(projectId, s, a);
          onFramesRendered({
            projectId,
            frames: [],
            match: { shot: a.shot, pass: null, target: url(r.rel), side: null, diff: null, issues: null, score: null },
          });
          const im = pic(r.file, 1024),
            tm = ultraTime(projectId, a.shot);
          return {
            content: [
              {
                type: "text",
                text:
                  (tm ? tm.trim() + "\n" : "") +
                  `${r.cached ? "Already made (no cost)" : `Made on ${r.model === "test-stub" ? "the test stand-in" : providerName(projectId)} (${r.fromStill ? "image-to-image from the current still" : "text-to-image"})`}: ${r.rel}. Project images: ${r.count} of ${r.budget}, about $${(+r.spent || 0).toFixed(2)}. Look at it: a target with text, warped people or a layout a 3D scene can't hold is remade once with a clearer prompt; else build / fix the shot to match it, then match_shot.`,
              },
              ...(im ? [im] : []),
            ],
          };
        } catch (e) {
          return fail("make_target", e);
        }
      },
    },
    {
      name: "match_shot",
      description:
        "Ultraedit+ (3D reconstruction): one measured pass of a shot against its target (make_target first). Renders the frame at t (default: the middle of the shot) at full size and writes the overlays into .suite/match/shot<N>/pass<K>/: target, render, side by side (target LEFT), 50/50 blend (misplaced masses show double), edges (the target's edges in cyan over the darkened render), zoomed crops of the centre and the regions that differ most, and the region colour table. Returns the mean difference (0-1, lower = closer), the region table (grade errors in numbers), the layout checker's issues at that moment, the file paths (Read the edges, blend and crops you need) and the side by side as an image.",
      schema: { shot: z.number().int().min(1).max(999), t: z.number().min(0).optional() },
      handler: async (a) => {
        try {
          const r = await matchShot(projectId, await shotsNow(), a);
          onFramesRendered({
            projectId,
            frames: [],
            match: {
              shot: a.shot,
              pass: r.pass,
              target: url(targetRel(a.shot)),
              side: url(r.files.side),
              diff: r.diff,
              issues: r.issues.length,
              score: null,
            },
          });
          const im = pic(r.abs(r.files.side), 1280);
          const lines = [
            `Shot ${a.shot}, pass ${r.pass} at ${r.t} s: mean difference ${r.diff} (0 = identical).`,
            `Layout issues at this moment: ${r.issues.length}${
              r.issues.length
                ? "\n" +
                  r.issues
                    .slice(0, 20)
                    .map((x) => "- " + x)
                    .join("\n")
                : ""
            }`,
            `Files: ${Object.entries(r.files)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k} ${v}`)
              .join(" | ")}`,
            r.regions.trim(),
            "Verify every difference on the edges overlay before you act on it. A critic every 2 passes: critic_shot." +
              ultraTime(projectId, a.shot),
          ];
          return { content: [{ type: "text", text: lines.join("\n\n") }, ...(im ? [im] : [{ type: "text", text: budgetText(ledger) }])] };
        } catch (e) {
          return fail("match_shot", e);
        }
      },
    },
    {
      name: "critic_shot",
      description:
        "Ultraedit+ (3D reconstruction): a FRESH read-only Opus critic (no memory of earlier rounds; it can only Read the last match_shot pass of this shot) scores the shot 1-10 against its target and ranks the top problems with concrete 3D fixes. Run match_shot first. Critics are reliable on materials, light and poses and unreliable on hidden geometry: check each claim on the edges overlay before acting.",
      schema: { shot: z.number().int().min(1).max(999) },
      handler: async (a) => {
        try {
          const r = await criticShot(projectId, a),
            all = scoresOf(projectId, a.shot);
          const last2 = (() => {
            try {
              return JSON.parse(
                fs.readFileSync(path.join(getProject(projectId).path, ".suite", "match", `shot${a.shot}`, "history.json"), "utf8"),
              ).pop();
            } catch {
              return null;
            }
          })();
          onFramesRendered({
            projectId,
            frames: [],
            match: {
              shot: a.shot,
              pass: r.pass,
              target: url(targetRel(a.shot)),
              side: last2?.side ? url(last2.side) : null,
              diff: last2?.diff ?? null,
              issues: last2?.issues ?? null,
              score: r.score,
              summary: r.summary,
            },
          });
          const flat = all.length >= 3 && Math.max(...all.slice(-3)) - Math.min(...all.slice(-3)) <= 0.5;
          return text(
            [
              `Critic score for shot ${a.shot} (pass ${r.pass}): ${r.score}/10. ${r.summary}`,
              `Scores so far: ${all.join(" -> ")}${flat ? " (3 flat scores: stop this shot, keep the best version)" : ""}${r.score >= 8 && !last2?.issues ? " (8+ and 0 layout issues: this shot is done)" : ""}`,
              ...r.problems.map(
                (p) => `${p.rank}. ${p.title}${p.region ? ` [${p.region}]` : ""}: ${p.evidence}${p.fix ? ` FIX: ${p.fix}` : ""}`,
              ),
            ].join("\n") + ultraTime(projectId, a.shot),
          );
        } catch (e) {
          return fail("critic_shot", e);
        }
      },
    },
  ];
}
