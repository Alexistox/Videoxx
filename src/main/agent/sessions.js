import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getConfig } from "../core/config";
import { templatesDir, ws } from "../core/workspace";
import { log, logPath } from "../core/log";
import { now, q, uid } from "../db/db";
import { NO_CLAUDE, claudeExecutable, cleanEnv } from "../engines/claudeCli";
import {
  INV_ANY_TOPIC,
  QUALITY_BAR,
  aspectOf,
  baseOf,
  getStyle,
  hasLayoutCheck,
  invCrimeTopic,
  invTopicNote,
  manifestOf,
  needsImageKey,
  pkgPrompt,
  qualityBarOf,
} from "../styles/catalog";
import { brandNote } from "../styles/brand";
import { NO_MAIN_CHARACTER, characterPrompt, noMainCharacter, waitForCharacter } from "../characters/characterLab";
import { speechPace, visualPlan } from "../styles/pace";
import { engineOf, isClaudeModelId, isEffort, isModelId, modelName } from "../engines/models";
import { checkEngineModel, engineEnv, needsProxyStart, resolveEngine } from "../engines/resolveEngine";
import { hasImageKey } from "../images/providers";
import { studioLookNotes } from "../styles/packages";
import { changedFiles, gitAvailable, reapplyRange, restoreTo, revertRange, snapshot } from "../core/gitSnapshots";
import { lang, langCode, otherScriptLanguage, screenTextNote, wordUnit } from "../styles/languages";
import { spokenScript } from "../voice/spokenScript";
import { markDirty, renderStills, setWorkerPool } from "../render/workers";
import { markStage, studioOf } from "../studio/stages";
import { libraryLabel } from "../library/search";
import { LIBRARY_NOTE, LIBRARY_SYSTEM_LINE, LIBRARY_ULTRA, libraryBlocks, libraryOff } from "../library/context";
import { syncStudioDocs } from "../studio/workspace";
import { flowTextureNote, flowTextures } from "../studio/textures";
import { SCRIPT_SKILL_PROMPT, scriptSkillReady } from "../projects/scriptSkill";
import { assertDraws, engineBrand, getProject, setLanguage } from "../projects/projects";
import { rulesText, writeContext } from "./projectContext";
import { studioWriteCheck } from "../studio/writeCheck";
import { describeSelection, frameBudget, getShots, newLedger, readImageCheck, schemaProblems, suiteToolDefs } from "./tools/suiteTools";
import { ultraClockReset } from "./tools/ultraPlusTools";
import { runCodex } from "../engines/runCodex";
import { writeAgentsMd } from "./agentsMd";
import { crewAgents, crewDirectorText, crewOn, crewUltraText, dropCrewChecks } from "./crews/crew";
import { crewEnv, crewPool, isPixelCrew, pixelDirectorText } from "./crews/pixelCrew";
import { isToonCrew, toonDirectorText, toonShots } from "./crews/toonCrew";
import { isStickCrew, stickDirectorText, stickShots } from "./crews/stickCrew";
import { noteSubscription } from "./usage";
import { writePersonalContext } from "../personal/personalProjects";
import { PERSONAL_SYSTEM, afterPersonalTask, ensurePersonalSkills, personalEnv, personalPrompt } from "../personal/personalAgent";
import { approvedFor } from "../channels/insights";
import { HIGH_EFFORT_EXTRAS, extrasFor, extrasText, hideTimeLimit } from "../routines/buildExtras";
import { studioPrompt } from "../studio/studioPrompt";
import {
  HARVEST_DISALLOWED,
  HARVEST_EFFORT,
  HARVEST_MODEL,
  HARVEST_SYSTEM,
  HARVEST_THREAD,
  HARVEST_TOOLS,
  HARVEST_TURNS,
  harvestToolDefs,
} from "../studio/harvest";
import { isReferencePath, referencePaths, referencesBlock } from "../projects/references";
import { projectUrl } from "../projects/fileServer";

const WORKFLOW_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"];
export const ULTRA_MODEL = "claude-opus-5-5";
export const STUDIO_MODEL = "claude-opus-5-5";
export const STUDIO_DISALLOWED = ["Bash", "BashOutput", "KillShell", "Task", "Agent", "WebFetch", "WebSearch", "NotebookEdit"];
const STUDIO_TOOLS = new Set(["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "TodoWrite", "Skill"]);
const STUDIO_KINDS = new Set(["studio", "edit", "ask"]);
const STUDIO_SYSTEM = `You are running inside Videoxx's Style Studio: a workspace where a video STYLE (or a look) is built stage by
stage. The workspace root is the style's live engine (engine.js, models.js, lib/), scenes/ holds the hero, kit, sample and must-fail scenes, skill/ the
style's written rules. The app runs every render, check and analysis as a tool; there is no shell and no web.
- Read .claude/skills/studio/AUTHORING.md and the current stage's doc before anything else; the request names the stage, its one output and its gate.
- Write only the files the stage allows (the app refuses the rest and says why). Never remove or rename an engine export.
- After every change: check_preview, then check_layout, then look with render_view (each aspect the style renders). A finding is written
  "finding -> what it means -> exact fix" in the words the check prints.
- Your replies appear in a narrow side panel: finish with 1-3 short plain sentences. No headers, no long lists.`;
const running = new Map();
export const runningTasks = () =>
  [...running.entries()].map(([taskId, r]) => ({
    taskId,
    projectId: r.projectId,
    threadId: r.threadId,
    editId: r.editId,
    kind: r.kind,
    startedAt: r.startedAt,
    model: r.model,
    engine: r.engine ?? "claude",
    permissions: [...r.asks.entries()].map(([requestId, a]) => ({ requestId, ...a })),
  }));
export function testFakeRunning(projectId, agoMs = 0) {
  for (const id of [...running.keys()]) if (id.startsWith("test_")) running.delete(id);
  if (!projectId) return null;
  const taskId = `test_${Date.now()}`;
  running.set(taskId, {
    abort: new AbortController(),
    editId: "test",
    threadId: "test",
    projectId,
    kind: "edit",
    pending: new Map(),
    asks: new Map(),
    startedAt: Date.now() - agoMs,
    model: "claude-test-model",
  });
  return taskId;
}
let sdk = null;
async function loadSdk() {
  return (sdk ??= await import("@anthropic-ai/claude-agent-sdk"));
}
const SYSTEM = `You are running inside Videoxx, a desktop editor for explainer videos (Three.js engines,
word-synced shots; this project's style is described in its CLAUDE.md). The user edits by selecting things in a live preview and timeline and describing the change.
- Work only inside the current project folder. Its CLAUDE.md (already in your context) maps the project. A request
  starts with the current shot list and the user's style rules whenever they changed (list_shots has the shots too).
- Long jobs (builds, reframes, Ultraedit) keep their notes in .suite/build-progress.md. When the conversation was summarised
  or starts fresh, re-read that file and CLAUDE.md before doing anything else: the files are the source of truth.
- Keep edits minimal and local to the request and its scope. Don't reformat or restructure unrelated code.
- The live preview hot-reloads when you save. Use the suite tools: check_preview after editing, render_frames to
  look at the result (and fix what looks wrong), get_selection / list_shots / narration for context.
- Never edit project.json "settings" (render presets) unless explicitly asked.
- Your replies appear in a narrow side panel: finish with 1-3 short plain sentences saying what changed. No headers,
  no long lists, no code unless asked.
- If the request reveals a preference that should apply to future edits, call remember_rule once with a short rule.`;
const SYSTEM_LIB = `${SYSTEM}
${LIBRARY_SYSTEM_LINE}`,
  STUDIO_SYSTEM_LIB = `${STUDIO_SYSTEM}
${LIBRARY_SYSTEM_LINE}`;
const studioSystem = () => (libraryOff() ? STUDIO_SYSTEM : STUDIO_SYSTEM_LIB);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export function reframePrompt(meta, notes = "") {
  const flat = baseOf(meta.styleId) === "flat",
    collage = baseOf(meta.styleId) === "collage",
    lowpoly = baseOf(meta.styleId) === "lowpoly",
    toon = baseOf(meta.styleId) === "toon",
    starter = baseOf(meta.styleId) === "starter";
  const sticks = baseOf(meta.styleId) === "stickstory";
  return `This project is the 9:16 version of "${meta.orig || "the original video"}": a copy of its files, which were laid out for a 16:9
frame (1920 × 1080). project.json "settings.format" is now "vertical", so the engine renders 1080 × 1920. Lay every scene out
again for the tall frame, with the ${meta.skill} skill (read its references first: ${flat ? "QUALITY_STANDARD.md, STYLE_GUIDE.md, engine_api.md" : starter ? "RULES.md and engine_api.md" : lowpoly ? "references/style.md, references/engine_api.md and references/sop.md" : toon ? "SKILL.md, references/engine_api.md and references/qa.md" : sticks ? "SKILL.md, references/sop.md and references/engine_api.md" : "style_guide.md and engine_api.md"}).
Keep exactly: the narration and everything in audio/, every shot's start time (t0) and order, every cue('word', near) call and
what happens on it, the transitions, the story, what each shot shows and its colours. Change only the layout: positions, sizes,
line breaks and camera framing.
How a wide shot becomes a tall one:
- side-by-side compositions stack (top and bottom); rows of more than three things wrap into two rows
- the main subject gets bigger (the frame is about half as wide as before); details that only worked wide can go
- titles and labels wrap into 2-3 lines; nothing important in the top 200 px or the bottom 420 px (the apps' own buttons and
  captions cover them), and nothing cut by the frame edge
${
  flat
    ? `- use W, H, GY, BAND, ZONE and TITLE (they have their vertical values now) instead of numbers; replace every x/y that
  assumed a 1920-wide stage. The caption band is reserved: nothing important there.`
    : starter
      ? `- use W, H, SAFE, ZONE, BAND and TITLE (they have their vertical values now) instead of numbers; replace every x/y that
  assumed a 1920-wide stage. 3D: re-aim S.view / S.move so the subject fills the tall frame, and move HUD text out of the
  caption band. The caption band is reserved: nothing important there.`
      : collage
        ? `- a panel is now 9 × 16 units (origin at its centre): redo positions in panel units and every shot({ panel, x, y, zoom })
  framing. Reuse the images in assets/ (IMG[...]); make a new one only if one truly can't work tall (at most a few).`
        : lowpoly
          ? `- the 3D is the same: re-aim every camera (S.camera on / fill / side, keyed cameras) so the subject fills the tall
  frame, move callouts / panels (they are in 1080 x 1920 frame units now) out of the caption band, and check what the
  taller frame shows above and below (ceilings, the end of the ground).`
          : toon
            ? `- the 3D is the same: re-aim every camera (S.camera on / frame / place, keyed and fly cameras) so the characters fill the
  tall frame with their faces readable and clear of the captions, dress what the taller frame now shows above and below
  (walls up to the ceiling, more floor and foreground props: no empty strips), and move labels into the tall frame.`
            : sticks
              ? `- the cut-out theatre is the same: re-aim every camera (S.camera on / frame, keyed cameras) so the people fill the tall
  frame with their faces readable, extend what the taller frame now shows above and below (sky, ceiling, more floor and
  foreground cards: no empty strips), and stack side-by-side graphics (HUD panels, maps, diagrams, counters) top and bottom
  inside the tall frame.`
              : `- the board is 9 × 16 at zoom 1: redo positions in frame units and the camera moves.`
}
Work scene file by scene file in project.json "scenes" order. After each file: check_preview, then${flat || collage || lowpoly || toon || sticks || starter ? " check_layout until it says Clean, then" : ""}
render_frames at the middle of each of its shots (up to 8 per call), and fix what looks wrong (cut off, overlapping, too
small, half the frame empty).
Don't change project.json (settings, scenes, end), audio/, the timeline or beds.json. Don't render, mix or export.
Finish with 2-3 short sentences: how you adapted the layout and which shots needed a bigger rethink.
User notes: ${notes || "(none)"}`;
}
const withExtras = (r, base) =>
  r.kind === "build" && r.extras?.length
    ? {
        ...r,
        instruction: [...extrasText(r.extras, base).map((t) => "BUILD EXTRA - " + t), String(r.instruction || "").trim()]
          .filter(Boolean)
          .join("\n\n"),
      }
    : r;
const LAYOUT_CHECK = new Set(["recon", "flat", "collage", "lowpoly", "toon", "stickstory", "starter"]);
function ultraTargets(projectId, picked) {
  const shots = getShots(projectId),
    want = picked?.length ? new Set(picked) : null,
    files = new Map();
  for (const s of shots)
    if (!want || want.has(s.index)) {
      const f = String(s.file || "scenes");
      files.set(f, [...(files.get(f) ?? []), s]);
    }
  return files;
}
const ULTRA_MAX_COMPARE = 16;
async function ultraFrames(projectId, cmpDir, editId, shots, which) {
  const list = shots.slice(0, ULTRA_MAX_COMPARE),
    times = list.map((s) => +((+s.t0 + +s.t1) / 2).toFixed(2));
  if (!list.length) return;
  fs.mkdirSync(cmpDir, { recursive: true });
  const stills = await renderStills(projectId, times, 0.5, `ultra-${editId}-${which}`);
  stills.forEach((st, k) => {
    if (st.file) fs.copyFileSync(st.file, path.join(cmpDir, `${editId}-u${k}-${which}.png`));
  });
  try {
    fs.rmSync(path.dirname(stills[0].file || path.join(cmpDir, "x", "y")), { recursive: true, force: true });
  } catch {}
  if (which === "before")
    fs.writeFileSync(
      path.join(cmpDir, `${editId}.json`),
      JSON.stringify({
        time: times[0],
        ultra: list.map((s, k) => ({ k, time: times[k], index: s.index, name: shotTitle(s.name), file: s.file })),
      }),
    );
}
function markUltraedited(projectDir, shots, editId) {
  const f = path.join(projectDir, "ultraedit.json");
  let cur = { shots: [] };
  try {
    cur = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!Array.isArray(cur.shots)) cur = { shots: [] };
  } catch {}
  const key2 = (x) => `${x.file}|${x.name}`,
    at = new Date().toISOString();
  const add = shots.map((s) => ({ file: s.file, name: shotTitle(s.name), t0: +(+s.t0).toFixed(2), at, editId }));
  const keys = new Set(add.map(key2));
  fs.writeFileSync(f, JSON.stringify({ shots: [...cur.shots.filter((x) => !keys.has(key2(x))), ...add] }, null, 1));
}
const shotTitle = (name) => String(name || "").replace(/^\d+[a-z]?[:.]\s*/i, "");
function ultraProcedure(projectId, base, picked, plus = false, minutes = null) {
  const files = ultraTargets(projectId, picked);
  if (!files.size) throw new Error("There are no shots to upgrade yet: build the video first.");
  const all = getShots(projectId),
    mid = (x) => ((+x.t0 + +x.t1) / 2).toFixed(1);
  const shots = [...files.values()].reduce((a, ss) => a + ss.length, 0);
  const near = (s) =>
    [all[s.index - 1], all[s.index + 1]]
      .filter(Boolean)
      .map((x) => `shot ${x.index + 1} at ${mid(x)} s`)
      .join(", ");
  const list = [...files.entries()]
    .map(
      ([f, ss]) => `- ${f}:
${ss.map((s) => `    shot ${s.index + 1}: ${(+s.t0).toFixed(1)}-${(+s.t1).toFixed(1)} s, "${shotTitle(s.name)}", line ${s.line}${near(s) ? `; neighbours: ${near(s)}` : ""}`).join("\n")}`,
    )
    .join("\n");
  const pjm = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(getProject(projectId).path, "project.json"), "utf8"));
    } catch {
      return {};
    }
  })();
  if (plus && base === "recon")
    return ultraPlusText(
      `these ${shots} shot(s) (the shot numbers below are the ones make_target / match_shot / critic_shot take)`,
      list,
      "still",
      pjm.settings?.theme === "investigation",
      flowTextures(projectId, getProject(projectId).style_id),
      minutes,
      pjm.topic || "",
    );
  return ultraText(
    base,
    `these ${shots} shot(s)`,
    list,
    pjm.settings || {},
    customName(pjm.style),
    getProject(projectId).style_id,
    getProject(projectId).preset_id,
    pjm.topic || "",
    getProject(projectId).path,
  );
}
const customBar = (name) =>
  `the user's own custom style "${name}" exactly as .claude/skills/vox-collage-video/references/custom_style.md describes it (its palette, fonts, picture art, element kinds and motion, and nothing it does not use; never the built-in newspaper collage look), with the shared rules of references/style_guide.md: nothing cut by the frame edge, no accidental overlaps, every text readable, every element on its word, eased camera.`;
const customName = (styleId) => {
  const st = getStyle(styleId);
  return st.custom ? st.name : null;
};
const INV_BEATS_ANY = [
  [
    `cold open: "It's [Month Year], [sensory detail]." The moment it all comes to a head; the stakes + the key player or institution by second 30`,
    95,
  ],
  ['the hook from an unexpected side: who the protagonist really is + a list of three things they did; "This is their story."', 85],
  ["title sting: no narration (a burst of cuts, one black frame, the title)", 0],
  ["setup A: the protagonist's origin; plant object 1", 200],
  ['first set piece, step by step ("X is essentially...")', 205],
  ["escalation: a bigger goal, the motive, the partner; plant object 2", 170],
  ["plant + foreshadow: the precaution or plan that won't be enough, the foreshadow line, then [BREAK 4s]", 110],
  ["context hinge / second storyline; the withheld identity or fact revealed as the last words of a sentence", 205],
  ["setup B: the second protagonist, the rival or the people who found out", 95],
  ["climax: the big target, calling back the cold open's words", 245],
  ["the turn: the planted object or habit decides it", 95],
  ["the outcome (the win, the fall or the verdict of history) in 4-8 word sentences, then [BREAK 8-12s]", 140],
  ["aftermath (past tense from here)", 65],
  ["coda: the moral, a dated fact with a big number, one line to the viewer; no summary", 60],
];
const INV_SHORT_ANY = [
  ["cold open: date + sensory detail, the stakes", 15],
  ["setup", 15],
  ["the central event, then [BREAK 2s]", 20],
  ["the turn and the clue", 20],
  ["the reveal of the withheld identity or fact as the last words of a sentence", 15],
  ["aftermath + coda (the moral, a dated fact with a number, one line to the viewer)", 15],
];
const INV_BEATS = [
  [`cold open: "It's [Month Year], [sensory detail]." The night it comes to a head; stakes + the institution by second 30`, 95],
  ['perpetrator inversion + a list of three things they did; "This is their story."', 85],
  ["title sting: no narration (a burst of cuts, one black frame, the title)", 0],
  ["setup A: the protagonist's origin; plant object 1", 200],
  ['first crime set piece, step by step ("X is essentially...")', 205],
  ["escalation: a bigger target, the motive, the partner; plant object 2", 170],
  ["plant + foreshadow: the precaution that won't be enough, the foreshadow line, then [BREAK 4s]", 110],
  ["context hinge / second storyline; the withheld identity revealed as the last words of a sentence", 205],
  ["setup B: the second protagonist or the investigators", 95],
  ["climax: the big target, calling back the cold open's words", 245],
  ["hubris: the planted object or habit betrays them", 95],
  ["downfall: raid, arrest, charges in 4-8 word sentences, then [BREAK 8-12s]", 140],
  ["aftermath (past tense from here)", 65],
  ["coda: the moral, a dated fact with a big number, one line to the viewer; no summary", 60],
];
const INV_SHORT = [
  ["cold open: date + sensory detail, the stakes", 15],
  ["setup", 15],
  ["the crime, then [BREAK 2s]", 20],
  ["the investigation and the clue", 20],
  ["the reveal of the withheld identity as the last words of a sentence", 15],
  ["aftermath + coda (the moral, a dated fact with a number, one line to the viewer)", 15],
];
const investigationScript = (words, seconds, unit, topic = "") => {
  const crime = invCrimeTopic(topic),
    list = seconds < 240 ? (crime ? INV_SHORT : INV_SHORT_ANY) : crime ? INV_BEATS : INV_BEATS_ANY,
    total = list.reduce((a, [, w]) => a + w, 0);
  return `INVESTIGATION LOOK (a dark, cinematic investigative documentary): write it as .claude/skills/recon-reconstruction/references/investigation_script.md
says (read it first: the beats, the 32 writing rules, the visual tags, the breaks), in this story's own terms.
${INV_ANY_TOPIC}
${invTopicNote(topic)}
In short:
- Beats, in this order, with their share of the ${unit}:
${list.map(([b, w], i) => `  ${i + 1}. ${b}${w ? ` - about ${Math.round((w / total) * words)} ${unit}` : ""}`).join("\n")}
- Narrator rhythm: historical present (past tense only for the aftermath), median sentence ~12 words, long-long-short with a
  2-5 word punch ending each micro-beat, "[role], [name]" on first mention, a hard fact every ~8 s, every chapter opening
  with a date and a place; no hype words, no "little did they know", no gore (a headline carries it).
- Visual tags: start every sentence with its tag in brackets ([MANNEQUIN], [PHOTO name], [DOC], [HEADLINE], [UI], [GRID],
  [BOARD], [PLACE+DATE], [STOCK], [ARCHIVE], [SIDEVIEW], [MAP], [QUOTE: name]); [BREAK 4s] on its own line after a
  cliffhanger, [BREAK 8-12s] after the climax and the outcome${crime ? " (the arrest)" : ""}. Brackets are never read aloud and don't count toward the
  length; the build plans its shots from them.`;
};
const RECON_INVESTIGATION_BAR =
  "INVESTIGATION LOOK (a dark, cinematic investigative mood for any topic, never high key, but ALWAYS VISIBLE: the mood comes from contrast and colour, never underexposure; every shot passes the visibility gates of references/no_slop.md): the project's figure(role) mannequins (each role's body, finish and colour from Look > Characters) playing mocap clips in furnished, lit dioramas, a written three-point setup per scene (motivated key - a monitor, window or lamp -, fill at 25-50 % of it, rim) plus practicals and a lit set behind the subject, true blacks only in the background, desaturated, shallow depth of field on the subject, vignette and grain from the look, highlights capped (only a flash frame goes white), one crimson accent (red = threat, tension or digital, blue = a mind) and no other saturated colour except each role's colour, which is the same in every shot (the colour is the identity); real proportions, everything resting on what holds it, nothing passing through anything, hands IK-attached to whatever is carried, lifted or opened; eased camera moves (a push >= 2.5 s); every real asset with its numbered source credit, highlights on real footage and documents; light text on the dark at readable sizes, settled and held >= 1.5 s, never over the subject or cut by the frame edge; the picture lands on its word, never cut faster than it can be read; no gore.";
const NO_SLOP_BANS = `BANNED IN EVERY STYLE (the owner's no-slop rules): never a red stamp / plaque / verdict overlay (rubber stamps or boxed red words slammed on: 'CLOSED', 'LOCKED', 'DENIED', 'CASE CLOSED', 'THE END' - "prohibited, straight slop"; show the fact with real media and a highlight instead), and never a notice that the voice is AI ('AI-generated voice' or anything like it). No sound effects the user did not supply. Every frame must read: subject lit and visible, text held >= 1.5 s after it settles, eased camera moves, hands on what they hold.`;
const RECON_NO_SLOP =
  "MANDATORY: read .claude/skills/recon-reconstruction/references/no_slop.md (the no-slop SOP: failure catalogue, PRE-RENDER CHECKLIST, lighting with visibility gates, interaction with IK-attached hands, camera easing, readability holds, pacing) and follow it; it outranks every pacing number. Answer its PRE-RENDER CHECKLIST at the end of storyboard.md.";
const ultraText = (
  base,
  what = "every shot of the video (list_shots gives them with their files, lines and neighbours)",
  list = "",
  settings = {},
  custom = null,
  styleId = null,
  presetId = null,
  topic = "",
  dir = null,
) => {
  const layout = styleId ? hasLayoutCheck(styleId, base) : LAYOUT_CHECK.has(base),
    py = getConfig().tools.python || "python",
    recon = base === "recon",
    lowpoly = base === "lowpoly",
    toon = base === "toon",
    sticks = base === "stickstory";
  const realModels = recon && settings?.models?.on !== false;
  const inv = recon && settings?.theme === "investigation";
  const pkgBar = styleId && getStyle(styleId).pkg ? qualityBarOf(styleId, dir) : void 0;
  const bar0 = pkgBar
    ? pkgBar
    : inv
      ? RECON_INVESTIGATION_BAR
      : custom
        ? customBar(custom)
        : ((styleId ? qualityBarOf(styleId) : QUALITY_BAR[base]) ?? "the style's own rules in CLAUDE.md and STYLE.md.");
  const ln = studioLookNotes(presetId),
    bar = ln?.qualityBar ? `${bar0} The look "${ln.name}" adds: ${ln.qualityBar}` : bar0;
  const people = recon
    ? `PEOPLE (both looks): the project's characters, figure(role) from lib/figures.js (references/characters.md): each role's
   body, finish and colour are the user's (Look > Characters); never pass rig / outfit / colors, never swap or recolour a role
   in one shot (the colour is the identity: grep the other scenes for that role). New or replaced people are figures, never a
   downloaded person, cast() or actor() (legacy: only an old project's existing people). They act what is said with a catalog
   clip (f.act / f.play / f.sequence, references/animations.md: findAnims(tag), never an invented name; walks with f.walkAt
   turning toward where they go${inv ? "; 'cuffed' only in a crime story" : ""}), blended when the action changes, seated people with sitOn(S, person,
   seat) (lib/props.js), held things with lib/hands.js hold() (references/hands.md when present), feet planted (no sliding),
   bodies never through furniture, vehicles or each other (S.collide with f.caps()).`
    : lowpoly
      ? `PEOPLE AND ANIMALS: library bodies with library clips only (the skill's references/motion.md): the clip that fits the
   clause (walk() along a path, never moved by hand; G_Point_*, G_Shrug, G_Facepalm, Idle_TalkingPhone_Loop, sit() on a seat,
   Hit_Knockback for a fall), an expression that matches (expr), heads turning toward what matters (lookAt), props in the
   hand with hold(), fingers() for tickling / typing / pointing hands. A face close-up uses cam 'face' (the face sits above the
   caption by itself). Feet on the floor, no sliding (walk() follows the clip's own gait: never add speed by hand), nobody
   through furniture or each other, no hair / hat / glasses into a face (check_layout measures all of it: feet, through,
   bodies, worn).`
      : toon
        ? `CHARACTERS: the cast of lib/cast.js only (S.char('main') is "you"; S.char('<id>') the others): each acts the clause
   with the engine's animation (a.gesture landing just before the stressed word, a.walk along a path with planted feet,
   a.hop, a.sit, a.hold), changes face on the word (a.face), looks and turns toward what matters (a.look, a.headTo, a.turn).
   Faces readable: the camera on the front of the face in close shots, never the back of the head, never behind the
   caption. Never frozen in one pose for the whole shot, never sliding, nobody through anyone or anything.`
        : sticks
          ? `PEOPLE: the stick people of lib/cast.js (S.char('main') is "you"; others by their cast id or look, the same look as in
   the other shots): black silhouettes with white eye and mouth shapes, coloured clothes and a coloured rim light. Each acts the
   clause (a pose or gesture landing just before the stressed word, walks with planted feet, reactions, a hand close-up for
   what they touch), the eye and mouth shapes change on the word, heads turn toward what matters. Never frozen in one pose for
   the whole shot, never sliding, nobody through anyone or anything.`
          : base === "flat"
            ? `CHARACTERS: the main character (character.js) acts the words: anticipation, follow-through, blinks, gestures and
   expressions that change on the right word, never frozen in one pose for the whole shot.`
            : `CHARACTERS AND PEOPLE: whoever is on screen moves with life: eased starts and stops, follow-through, small idle motion,
   poses and gestures that match the words, never frozen or sliding.`;
  const assets = lowpoly
    ? `
   LIBRARY MODELS: every crude stand-in (boxes or cylinders standing for a real object, vehicle, animal or piece of furniture)
   becomes an asset-library model: lowpoly_asset action search first (thousands of props, vehicles, animals, sets). Nothing
   close: a free model from the web (Poly Pizza, Quaternius, Kenney, Sketchfab downloadable: CC0 / CC-BY / public domain only,
   the licence checked on its own page), saved with lowpoly_asset action add (it stays in the library for later videos), then
   used by its id. Their credits go into DESCRIPTION.txt by themselves.`
    : toon
      ? `
   SET DRESSING: every set is DENSE: the engine's places and props (S.place, S.prop, S.scatter: the skill's references/catalog.md + props.md)
   in a foreground, midground and background, clutter on every shelf, desk and wall, a lamp or screen that glows; no bare
   floor or wall fills the frame. Build what the kit lacks in the toon look (rounded shapes, toonMat, ink outlines with
   addOutline); never a downloaded model or a photo-real texture: the whole video keeps one cartoon look.`
      : sticks
        ? `
   SET DRESSING: every place is a dressed flat-vector set (S.place, S.prop and the engine's shape kit: the skill's references)
   with a foreground, midground and background card at real depths (parallax, depth of field), the story's props, lamps,
   screens and windows that glow; no flat backdrop fills the frame. Graphics (HUD panels, maps, diagrams, counters) get their
   small details (labels, icons, gridlines, markers). Build what the kit lacks with the shape kit in the style's flat-vector
   look; never a photo or a downloaded model: the whole video keeps one drawn look.`
        : realModels
          ? `
   REAL MODELS: every real vehicle, machine, ship, aircraft or animal in the shot that is built from code (boxes, cylinders,
   lathes - however carefully made) is replaced by a free downloaded 3D model of the right type and era (e.g. a 1930s sedan,
   not a generic car). Always search before deciding: at least Poly Pizza and Sketchfab (downloadable). No exact match: the
   nearest free one (a 1940s classic car beats a coded car). Keep the coded one only when both searches found nothing close,
   and say so in your summary with what you searched. Already
   downloaded ones (assets/models/, CREDITS.json) first; else find one with WebSearch / WebFetch (Poly Pizza, Sketchfab
   downloadable, NASA, Smithsonian, Quaternius, Kenney: CC0, public domain or CC-BY only), check the licence on its own page, then
   "${py}" .claude/skills/recon-reconstruction/scripts/fetch_model.py . <direct .glb url> <file.glb> --title "..." --author "..." --license "..." --source "<page>"
   (it refuses NC / ND / unclear licences and records the credit), load it with setup({ models }) and place it with
   model(key, { length | height, look: 'clay' }) at its real size; look at it front and side before you keep it. Add its
   credit (title, author, licence, source) to the credits in DESCRIPTION.txt (create the file with a "Credits" list if missing).`
          : "";
  const contact = lowpoly
    ? `
   SPATIAL CONSISTENCY: everything rests on what holds it and nothing passes through anything: people stand on the floor
   (feet planted), sit on seats with sit(), hold props with hold(); props rest on tables and floors. check_layout measures it
   (through / bodies / feet / support / seat / self / hand / floating / sunk / scale / camera / ceiling / covered / offframe /
   small / coplanar / thin / look / edge): every finding in this shot is part of your fix.`
    : toon
      ? `
   SPATIAL CONSISTENCY: feet on the floor, props on the tables and floors that hold them, held props in the hand, nothing
   passing through anything. check_layout measures it (offscreen / caption / through / floating / backface / dark / empty):
   every finding in this shot is part of your fix.`
      : sticks
        ? `
   SPATIAL CONSISTENCY: feet on the floor, props on what holds them, held props in the hand, nothing passing through anything,
   no label or HUD graphic over a face. check_layout measures it (offscreen / cropped / covered / through / floating / held /
   dark / empty): every finding in this shot is part of your fix.`
        : recon
          ? `
   SPATIAL CONSISTENCY - what makes it look high end: everything touches what holds it. Stones, debris, crates and cars rest
   on the surface under them (bottom on the surface, a contact shadow), fence rails reach their posts, signs touch their
   poles, nothing hangs a few cm in the air, nothing passes through anything, no gaps where parts should meet. check_layout
   measures it (floating / through, with each object and its gap): every finding in this shot is part of your fix - rest it
   (its bottom on the surface y: hitAlong or a ray down), make the parts meet, or move it so it touches without passing
   through. Something that really flies, falls or is thrown: obj.userData.airborne = true.`
          : "";
  const sound = lowpoly
    ? `
   SOUND: every new event you add (a coin, a win, a fall, a crash, a phone) gets sfx(type, t) on its frame (the engine_api
   list: whoosh impact thud coin cash win slot cards chips phone glass explosion ...), under the narration.`
    : toon
      ? `
   SOUND: every new event you add (a pop, a hit, a fall, a splash, a door) gets S.sfx(type, t) on its frame (whoosh pop
   impact thud click ding swish splash ...), under the narration.`
      : sticks
        ? `
   SOUND: every new visible action you add (a pop-in graphic, a door, a step, a hit, a phone) gets S.sfx(type, t) on its frame
   (whoosh pop click ding swish impact thud door footstep phone typing ...), under the narration.`
        : inv
          ? `
   SOUND: no sound effects unless the user supplied them (the kit's overlays are silent by default): add no sfx() calls.`
          : recon
            ? `
   SOUND: every new impact, splash, falling debris, creak or alarm you add gets sfx(type, t) on the frame it happens
   (whoosh impact thud splash rumble creak tick beep alarm bubbles), at a gain that sits under the narration.`
            : "";
  return `ULTRAEDIT - make ${what} look much better: more detail, more depth, no visual inconsistencies. Timing and story stay.${list ? "\n" + list : ""}
QUALITY BAR for this style${inv ? " (Investigation look)" : ""}: ${bar}${
    inv
      ? `
${INV_ANY_TOPIC}
${invTopicNote(topic)}`
      : ""
  }
${NO_SLOP_BANS}${recon ? "\n" + RECON_NO_SLOP : ""}${libraryOff() ? "" : "\n" + LIBRARY_ULTRA}
Work shot by shot, in order, and keep it quick: no long reading first (the project's CLAUDE.md is already in your context;
look up an engine or library helper only when you need it). Do every step yourself, in the foreground: no agents, no Task
tool and no background commands (a search or download you start, you wait for).
1. LOOK, one quick round:
   - render_frames at 6 times spread evenly across the shot (scale 0.5, one call), plus one still at the middle of the shot
     before it and of the shot after it (the neighbours: your result must still match them at the cuts);
   - the narration tool from the shot's start to its end: what is said is what the shot must show;
   - where people, animals or vehicles move: 3 stills 0.3 s apart at their key moment, to see the motion;${
     recon
       ? `
   - check_layout with those 6 times: what floats, what passes through what, what flickers, already in this shot;`
       : lowpoly
         ? `
   - check_layout with those 6 times: bodies through things, feet and seats, hands, props floating / sunk / scaled, covered or cut text, the camera, z-fighting, already in this shot;`
         : toon
           ? `
   - check_layout with those 6 times: characters out of frame or through each other, faces behind the caption or turned away, floating feet, dark or empty frames, already in this shot;`
           : sticks
             ? `
   - check_layout with those 6 times: the subject out of frame or its face cut, a label over a face, people through each other, floating feet, held props off the hand, dark or empty frames, already in this shot;`
             : ""
   }
   - read the shot's block (from its "// ---- title ----" line to the next shot) and keep its text: it goes back if your result
     is not clearly better.
2. CRITIQUE: assume it looks really bad - it lacks detail and depth. Against the quality bar and the narration, write 3-8 short
   lines: why exactly, and what you will add or fix. Think of: empty or flat areas, set dressing and props the story has,
   models missing their small parts, no foreground / midground / background, ground and water detail, contact shadows,
   atmosphere (haze, smoke, spray, wake, dust, lights), weak framing, things floating, clipping or passing through each other,
   covered or unreadable text, gaps where parts should meet (a rail short of its post), things not resting on what holds them,
   a look that doesn't match the neighbours, ${realModels ? "real vehicles, machines or animals built from code instead of a downloaded model, " : ""}and
   people or animals that are frozen, stiff, sliding or posed wrong for what is said.
3. FIX it in that shot's block. Be bold - a small tweak is a failure: 6-12 new elements that belong to the story, a real
   foreground, midground and background, refined main models. The subject stays at least as big and as readable as before.
   New helpers go as local functions in the block or right above its title line.${assets}
   ${people}
   RECURRING THINGS: before you replace or re-rig something that can appear elsewhere (a vehicle, a person, a building, a
   ship), grep the other scene files for it. If other shots show it too, change it where they share it (one helper in lib/ or
   models.js that all of them use) so it looks the same everywhere, and look at one still of each shot that changed; if they
   don't share code, list those shots under "Ultraedit next" in your summary. Never leave the video with two versions of one
   thing side by side.
   KEEP IT LIGHT: the preview must stay smooth. Repeated objects as one InstancedMesh, shared geometries and materials, no
   more than about 2,000 particles in a shot, no new shadow-casting lights, downloaded models under about 5 MB (check the file
   size first: a heavy model is the wrong model).${contact}${sound}
4. CHECK: check_preview; then render_frames at the same 6 times as in LOOK and judge them side by side with your LOOK frames:
   clearly better on every frame, the subject at least as big and readable, nothing new broken (clipped, floating, passing
   through, covered text), still matching the neighbours. Where people or animals move: the 3 motion stills again (feet
   planted, hands on what they hold, no sliding).${recon || lowpoly || toon || sticks ? " check_layout again with the same 6 times: no floating or through left in this shot." : ""} Then the middle at scale 1. Not clearly better: put the original block back.
   Broken: fix it (one more round at most). Then the next shot. Budget: about 6 minutes per shot (a model download included);
   past it, keep what is clearly better, say what is left, and move on.
At the end: check_preview (no errors, no cue misses)${layout ? ", and check_layout once with times = the start, middle and end of the shots you changed (never the whole film: that takes minutes); fix only what YOUR change caused" : ""}.
A problem that was there before you touched the shot (a flicker in a transition, a neighbouring shot) is not yours to hunt:
one line about it in your summary, no investigating.
Never: change a shot's start time, its cue words or what happens on them; change narration, facts or the order of events;
edit the checks (lib/contact.js, lib/collide.js: a finding you think is wrong goes in your summary); render, mix or export
(the app makes the before / after stills itself).
Finish with one short line per shot: what changed; then "Ultraedit next:" with the shots that should get the same upgrade to
stay consistent (or "none").`;
};
const ULTRAPLUS_PASSES = 4,
  ULTRAPLUS_EXTRA = 2;
const fmtMinutes = (m) => (m < 1 ? `${Math.round(m * 60)} seconds` : `${+m.toFixed(1)} minute${m === 1 ? "" : "s"}`);
const ultraPlusText = (
  what,
  list,
  targets,
  inv,
  flowTex = false,
  minutes = null,
  topic = "",
) => `ULTRAEDIT+ - match ${what} to a painted target frame, shot by shot, through the measured match loop.${list ? "\n" + list : ""}${
  minutes
    ? `
TIME LIMIT: about ${fmtMinutes(minutes)} per shot, from its make_target until you move on (the user's choice: it beats the pass counts
below). make_target, match_shot and critic_shot say how much of it the shot has used. Plan to fit: ${minutes <= 2 ? "ONE pass with the biggest light and material moves, no critic unless time is left" : minutes <= 5 ? "two passes, the critic once at the end" : "as many of the passes below as fit"}.
When a tool says the time is up: no new pass; finish the change you are making, check_preview, then the next shot.`
    : ""
}
Read .claude/skills/recon-reconstruction/references/ultraedit_plus.md first (the loop, the tools, the stop rule, the pitfalls),
and ${libraryOff() ? "the skill's no_slop.md" : "library_search for the recon modules, recipes and pitfalls it names (glow-person, canvas-materials, rig-pose, the props, look.recon.shot-match-neutral, the solutions order-of-work / critic-protocol / overlay-pack-per-pass)"}.
THE CAST IS FIXED: the people (figures, bodies, finishes, colours, glow, poses and how many) stay exactly as they are,
even when a target paints them differently. Ultraedit+ upgrades the ENVIRONMENT only: set dressing, props, background detail,
materials and textures, lighting (practicals, shadows, bounce, atmosphere), depth and grade. Never swap, dress or restyle a figure.
Do every step yourself in the foreground (no agents, no Task tool). Per shot, in order:
1. TARGET: ${targets === "have" ? "assets/targets/shot<N>.jpg was made before the build (make_target only for a shot that has none)." : "ALWAYS make a NEW target in this run: make_target with from_still true (image-to-image from the shot as it is now; an existing assets/targets file is from an earlier run with older rules, never reuse it) and a short prompt about the ENVIRONMENT of the ideal frame, written like a director of photography: what the subject is and where the eye must go, the LIGHTING PLAN (the motivated key on the subject and where it comes from, fill, rim, which practicals glow and where their small pools land, what stays dark), the mood, and at most 2-3 props or details worth adding. The app already keeps it a stylized Blender / Cinema 4D-style 3D render and keeps the people unchanged: never ask for realism, clutter or new looks for people."} Look at
   it: one with text, photo-realism, clutter that steals focus, a set a 3D scene can't hold, or people that changed a lot is
   remade once with a clearer prompt; any remaining
   difference in the people is ignored (match the environment only).${
     inv
       ? ` The Investigation look stays: dark mood, always visible.
   The target prompt describes this shot's own subject (what the narration says, in this story's field) in the look's visual
   terms (near-black room, one motivated key, glossy faceless mannequins, one accent colour), never a genre label; ${invCrimeTopic(topic) ? "crime props (an evidence board, police tape, case files) only where this crime story has them" : "no crime props (evidence boards of suspects, police tape, case files, mugshots): this story is not about a crime unless the narration says so"}.`
       : ""
   }
2. PASS: match_shot (renders the middle of the shot, writes the overlays, measures the difference, runs the layout check there).
3. FIX. First write a numbered GAP LIST (build-progress.md) of what the TARGET has that the render lacks: EVERY light source in the
   target, background ones included (each lamp, bulb, string light, sign, window, screen: where it is and where its light lands),
   the brightness and colour of each region (region table), atmosphere, then materials and textures, then every missing prop and
   detail. Each pass works through the list and ticks items off; nothing on it may be silently skipped. Each pass changes LIGHT AND
   at least one of materials / detail, as big visible moves, never scalar nudges:
   a. LIGHT (the main thing a target adds): build EVERY light the target shows as a real light: a SpotLight or PointLight
      with soft shadows under every lamp so its pool lands where the target's does, emissive bulbs and shades (toneMapped false so
      the grade can't grey them), string lights as small emissive points, window or city light as a cool rim on the cast, darker
      corners where the target is dark, haze-beam where it has atmosphere. Contrast comes from WHERE light falls: when a
      check says DARK or a region is too dark, add or aim a key / rim / wall wash at it; never raise ambient, hemisphere,
      environment or exposure across the frame (that greys and blows out the whole picture). Compare the region table each pass: the lit regions must
      get brighter and warmer and the dark ones darker until they are close to the target's numbers.
   b. MATERIALS AND TEXTURES (canvas-materials: wood grain, fabric, brick, glass, metal; colours from the region table, sRGB -> linear).${
     flowTex
       ? `
      On Google Flow (free): BIG visible surfaces (floor, walls, table tops, counters, sofas) get make_texture instead of a canvas
      material (subtle, stylized, never photo-real; repeat = surface metres / tile_m); small things keep canvas-materials. Small
      details and pictures the target shows (framed art, posters, signs without text, screens, desk photos, food, label-free
      packaging): make_image as image planes. One picture per request; look at each once, remake only a wrong one.`
       : ""
   }
   c. SET DRESSING AND DETAIL the target has and the set lacks (props, background, depth layers).
   Camera and layout only if the edges overlay is off (it usually isn't: the target was painted from this frame).
   ONE PLACE = ONE LOOK: lights, practicals, materials, textures, props and set dressing belong to the PLACE, so they go into the
   shared set function (world.js cafe(), street(), ...) that every shot in that place uses, never into one shot's block: the next
   shot of the same place (another camera angle) must already show the same lighting and detail. Only what is truly about this
   framing stays in the shot block (camera, a light that exists only for this close-up, a prop only this angle sees). Before
   starting a shot, check which shots share its set (list_shots / the scenes) and after changing a set, look at one of those
   shots (render_frames) so nothing there breaks. Keep timing, cues, narration and the story.
4. CRITIC: critic_shot after pass 2 and pass 4 (a fresh read-only Opus: it never remembers earlier rounds). Keep a short
   accepted / rejected ledger of its claims in .suite/build-progress.md; reject a claim only with the overlay that disproves it.
5. STOP the shot after ${ULTRAPLUS_PASSES} passes${minutes ? " or when its time is up" : ""}, or earlier when the critic says 8 or more AND match_shot shows 0 layout issues.
   Speed matters: ${ULTRAPLUS_PASSES} meaningful passes, each one visibly better. Only if the pass-4 critic is below 8 AND a big gap-list
   item (a light, a material, a set piece) is still open may you run up to ${ULTRAPLUS_EXTRA} more passes; say which items they fix
   first. Never more. Then check_preview and the next shot.
Never: change a shot's start time, its cue words, the narration or the order of events; edit the checks; render, mix or export.
Finish with one line per shot: passes, first and last critic score, what changed; then the shots that hit the pass limit.`;
function buildPrompt(r, verify, meta) {
  const parts = [],
    L = lang(meta.language),
    foreign = L.code !== "en",
    N = lang(meta.narration ?? L.code);
  if (r.kind === "reframe") parts.push(reframePrompt({ ...meta, orig: meta.orig || "" }));
  else if (r.kind === "script") {
    const wpm = Math.round(L.wpm * speechPace(baseOf(meta.styleId)));
    const words = Math.round((meta.targetLength / 60) * wpm),
      unit = wordUnit(L.code);
    const inv = baseOf(meta.styleId) === "recon" && meta.settings?.theme === "investigation";
    parts.push(`Write the narration script for ${inv ? "a dark, cinematic investigative documentary" : "an explainer video"}${meta.topic ? ` about: ${meta.topic}` : ""}.${
      foreign
        ? `
LANGUAGE: write the whole script in ${L.name} (${L.native}): natural spoken ${L.name} for a native audience, not a translation
of an English text (the topic and notes may be in English).${L.writing ? ` Write it as ${L.writing}.` : ""} Research in any language; keep sources in research.md as they are.`
        : ""
    }
Target: about ${mmss(meta.targetLength)} of narration, roughly ${words} ${unit} (voiceovers ${foreign ? `in ${L.name} ` : ""}run ~${wpm} ${unit} per minute${L.unit === "char" ? `; count the ${L.name} characters, not punctuation or spaces` : L.spaced === false ? `; count words as a ${L.name} word breaker would` : ""}).
Visual style of the video: ${meta.styleBrief}${
      scriptSkillReady(getProject(r.projectId).path)
        ? `
${SCRIPT_SKILL_PROMPT}`
        : ""
    }${
      inv
        ? `
${investigationScript(words, meta.targetLength, unit, meta.topic)}`
        : ""
    }
1. Research first with WebSearch / WebFetch. Prefer primary sources (papers, official docs, first-hand accounts) and check
   the key numbers, names and dates in at least two places. Write research.md: the facts you use, each with its source link.
2. Write script.txt: only what the narrator says, in plain spoken sentences, grouped into sections with "## Section title"
   lines (headings are not read aloud${foreign ? `; write them in ${L.name} too` : ""}). Write numbers, units and symbols the way they are spoken (${foreign ? `in ${L.name}, as words` : '"four megabytes"'}).
   No stage directions, except as [short notes] on a line of their own${inv ? " (and the visual tags and [BREAK] lines above)" : ""}.
3. Open with a hook in the first ten seconds, keep one clear line of argument, and use concrete examples that can be
   shown on screen in this style.
4. Length is a hard requirement: the spoken ${unit} (not the ## headings or [notes]) must be between ${Math.round(words * 0.9)} and
   ${Math.round(words * 1.1)}. Count them before you finish (e.g. a one-line script) and cut or add until they fit.
${
  meta.lessons?.length
    ? `5. What works on this channel (lessons from its YouTube numbers and comments that the creator approved): follow them
   where they fit this topic.
${meta.lessons.map((x) => `   - ${x}`).join("\n")}
`
    : ""
}If script.txt already exists, revise it following the notes instead of starting over.${
      meta.scriptIn
        ? ` It is in ${lang(meta.scriptIn).name} now: write it
in ${L.name} (keep what works: the angle, the structure and the facts; natural ${L.name}, not a word-for-word translation).`
        : ""
    } Don't build scenes or touch audio.
Finish with 2-3 short sentences${foreign ? " in English (the app shows them to the user)" : ""}: the angle you chose, the ${L.unit === "char" ? "character" : "word"} count and the estimated length.
Notes from the user: ${r.instruction || "(none)"}`);
  } else if (r.kind === "build" && baseOf(meta.styleId) === "stickman") {
    const st = meta.settings || {},
      secs = meta.seconds ?? meta.targetLength,
      web = st.web?.on ? Math.max(0, Math.round((+(st.web.perMin ?? 2) * secs) / 60)) : 0;
    parts.push(`Build this video with the stickman-explainer skill, inside Videoxx (MS Paint stick figures).
Already done by the app - skip any setup: engine.js, lib/, vendor/ exist; audio/clean.wav, audio/timeline.json and
audio/script_timed.txt are ready. Shot times come from the narration: you never write times.
1. Read .claude/skills/stickman-explainer/SKILL.md, then references/style.md and references/script.md. Read
   references/catalog.md once: every name the library has.
2. Read audio/script_timed.txt and split the narration into shots: ONE CLAUSE = ONE NEW PICTURE, a new picture every
   2-3 seconds (never more than ~4.5 s on one picture; a 1-second punch picture is fine). Write storyboard.md: the
   cast (each person: name + what they look like) and the chapters (a short caps title each).
3. Write the scenes: one file per chapter in scenes/ (e.g. scenes/c1_the_myth.js), each calling script() from
   ../engine.js with its shots; register every file in project.json "scenes" (in order) and keep "end" as set.
   Every \`>\` line is that shot's narration copied word for word, in order, nothing left out (the app times the shot
   by finding these words in the voice). Stage each clause with the library (style.md: reaction close-ups after
   surprising facts, red/yellow cards for dates and numbers, diagrams for explanations, labels for names and places).
4. People and animals: give every person a cast line with desc="..." (what they look like: skin, hair, hat, clothes,
   one or two things that identify them; reuse \`narr\`, the built-in narrator, for asides and reactions), then run
   make_sprites. It draws only the poses the scenes use and keeps them for later videos; look at what it returns.
   A wrong sprite: change the pose/face in the scene (or the desc) and run it again.${
     web
       ? `
5. REAL IMAGES ARE ON: about ${st.web.perMin ?? 2} real photo(s) per minute, so about ${web} in this video. Use web_image for real places,
   objects, documents and people the narration names, then \`photo <pos> img=<name> text="caption"\`. Check each photo it
   returns shows what the words say; a wrong one: search again with another name.`
       : `
5. Real images are off: no web_image (everything is drawn).`
   }${
     st.detail
       ? `
   MORE DETAILS IS ON: every shot gets 1-3 extra props, labels or annotations beyond the bare minimum (the backdrops add
   their own clutter); still one idea per picture, nothing covering the faces or the labels.`
       : ""
   }
6. QA: check_preview after each scene file (unknown names with their file:line, shots that stay too long). Then look at
   the whole video with render_frames (up to 8 times per call, every shot once): does each picture show what its words
   say? Anything cut off, overlapping, floating, unreadable or empty? Fix and look again.
7. No music: this style runs on the voice alone (don't write audio/beds.json; the app mixes the narration by itself).
This runs unattended. Don't render, mix or export the final video - the app does that. Finish with a short summary.
Preferred length: about ${mmss(meta.targetLength)}; the narration sets the real length.
User notes: ${r.instruction || "(none)"}`);
  } else if (r.kind === "build" && baseOf(meta.styleId) === "lowpoly") {
    const st = meta.settings || {},
      secs = meta.seconds ?? meta.targetLength,
      S = ".claude/skills/lowpoly-shorts",
      cuts = Math.round((secs / 60) * (st.look === "moody" ? 24 : 30));
    parts.push(`Build this video with the lowpoly-shorts skill, inside Videoxx (low-poly 3D short, ${st.format === "landscape" ? "1920×1080" : "1080×1920"}, look ${st.look === "moody" ? "Moody" : "Bright"}).
Already done by the app - skip any setup: engine.js, models.js, lib/, vendor/, fonts/ exist; audio/clean.wav, audio/timeline.json and
audio/script_timed.txt are ready; project.json "end" is set. The asset library is served to the engine (no copying needed).
1. Read ${S}/SKILL.md, then references/style.md, script.md, engine_api.md, library.md, motion.md and qa.md. Skim PITFALLS.md.
2. Read audio/script_timed.txt and cut it into shots: ONE CLAUSE = ONE SHOT, 1.5-2.5 s each (about ${cuts} shots for this
   ${mmss(secs)} video; a 0.6-1 s punch shot is fine, never more than ~4 s on one shot unless the camera travels).
   Write storyboard.md: the cast (one recurring protagonist + roles, each a person() look), the sets, and per shot: the
   clause, what it shows (literally), set, camera move, callout / UI, transition. Plan the hook (frame 0 is a finished, lit,
   moving shot) and the ending (the last shot loops back to the first composition with loopShot(), or a punchline image).
3. ASSETS: ${libraryOff() ? "" : "library_search first (modules, recipes, looks, solutions), then "}search the asset library for everything the shots need (lowpoly_asset action search, several words each). Build by
   code only what the library and the engine's kit (KIT: roulette, cards, chips, cash, phone/laptop/CRT screens, LED digits,
   scoreboard, calendar, charts, organs, signs) don't have; a better free model from the web (CC0 / CC-BY / public domain,
   licence checked on its own page) is saved with lowpoly_asset action add and then used by its id.
4. Write the scenes: scenes/*.js files of shot({ say, set, build(S) {...}, cam, trans }) (one file per chapter of ~6-12
   shots), registered in project.json "scenes" in order. The cast definitions go in models.js. Word-synced events use
   S.at('word') inside a shot; sound effects with sfx(type, t) on picture events.
5. QA (references/qa.md): check_preview (no errors, no "say miss" / cue misses), check_layout until it says Clean, then
   render_frames over every shot (8 per call, scale 0.5) and look: literal picture of the clause, subject big and lit, people
   posed and acting, feet on the floor, props in hands, nothing through anything, callouts readable, captions clear. Fix
   and look again only at what you changed. Motion: 3 frames 0.1 s apart on every walk and gesture.
6. Sound: sfx(type, t) on picture events (references/sound_design.md). NO music bed: music is the user's choice (Project
   settings > Music); don't write a music bed in audio/beds.json unless the user asked for music. DESCRIPTION.txt: a 2-line summary at the top (the app keeps the asset credits below it).
This runs unattended. Don't render, mix or export the final video - the app does that. Finish with a short summary.
Preferred length: about ${mmss(meta.targetLength)}; the narration sets the real length.
User notes: ${r.instruction || "(none)"}`);
  } else if (r.kind === "build" && baseOf(meta.styleId) === "toon") {
    const st = meta.settings || {},
      secs = meta.seconds ?? meta.targetLength,
      S = ".claude/skills/toon-shorts",
      cuts = toonShots(secs);
    parts.push(`Build this video with the toon-shorts skill, inside Videoxx (3D cartoon short, ${st.format === "landscape" ? "1920×1080" : "1080×1920"}, look ${st.look === "clean" ? "Clean" : "Cinema"}, main character "${st.characters?.main || "milo"}").
Already done by the app - skip any setup: engine.js, models.js, lib/, vendor/, fonts/ exist; audio/clean.wav, audio/timeline.json and
audio/script_timed.txt are ready; project.json "end" is set.
1. Read ${S}/SKILL.md, then references/sop.md, references/engine_api.md, references/motion.md, references/catalog.md (every
   place, prop tag, effect, info kind, pose, gesture, expression), references/storyboard.md and references/qa.md (in that
   order; they are the procedure, the engine's API and the bar). references/props.md is the prop catalogue to search.
2. Read audio/script_timed.txt and cut it into shots: ONE CLAUSE = ONE SHOT (about ${cuts} shots for this ${mmss(secs)} video;
   a short punch shot is fine). Write storyboard.md: the cast ("you" is S.char('main'); others from lib/cast.js), the sets,
   and per shot: the clause, what it shows (the idea made LITERAL), the set and its dressing, who acts what on which word,
   the camera move, the transition.
3. Write the scenes: scenes/*.js files of shot({ say, build(S) {...}, cam, trans }) (one file per chapter of ~6-12 shots),
   registered in project.json "scenes" in order. EVERY SHOT IS A DENSELY DRESSED SET: a room or place with props in the
   foreground, midground and background (never an empty frame, never a bare floor or wall filling the shot). THE CHARACTERS
   ACT ON THEIR WORDS: gestures land on the stressed word, faces change on the word (S.at('word')), walks with planted feet,
   reactions. The camera always moves (creep, push, reveal, a quick push-in on a reaction). Captions are drawn by the engine:
   keep faces out of the caption band. Sound effects with S.sfx(type, t) on picture events.
4. QA: check_preview (no errors, no "say miss" / cue misses), then check_layout until it says Clean, then render_frames over
   every shot (8 per call, scale 0.5) and look: a literal picture of the clause, faces readable with the right expression,
   characters acting, the set dressed, nothing through anything, captions clear of faces. Fix and look again only at what
   you changed. Motion: 3-6 frames 1/30 s apart on every walk, gesture, sit, fall and hand-over (smooth, no pops, no sliding).
5. Sound: S.sfx(type, t) on picture events. NO music bed: music is the user's choice (Project settings > Music); don't write
   a music bed in audio/beds.json unless the user asked for music.
This runs unattended. Don't render, mix or export the final video - the app does that. Finish with a short summary.
Preferred length: about ${mmss(meta.targetLength)}; the narration sets the real length.
User notes: ${r.instruction || "(none)"}`);
  } else if (r.kind === "build" && baseOf(meta.styleId) === "stickstory") {
    const st = meta.settings || {},
      secs = meta.seconds ?? meta.targetLength,
      S = `.claude/skills/${meta.skill || "stickstory-videos"}`,
      cuts = stickShots(secs);
    parts.push(`Build this video with the stickstory-videos skill, inside Videoxx (Stick stories, ${st.format === "vertical" ? "1080×1920 vertical 9:16" : "1920×1080, 16:9"}, look ${st.look === "clean" ? "Clean" : "Story"}).
Already done by the app - skip any setup: engine.js, models.js, lib/, vendor/, fonts/ exist; audio/clean.wav, audio/timeline.json and
audio/script_timed.txt are ready; project.json "end" is set.
1. Read ${S}/SKILL.md, then references/sop.md (the procedure and its gates) and references/engine_api.md (the engine's API: every
   call with an example), and the other references SKILL.md sends you to. Read ${S}/PITFALLS.md: every mistake an earlier
   build made, and its fix.
2. Read audio/script_timed.txt and cut it into shots: ONE PICTURE PER CLAUSE (about ${cuts} shots for this ${mmss(secs)} video, ~2-3 s
   each; a 1 s punch shot is fine, never more than ~5 s on one picture unless the camera travels). Write storyboard.md: the
   cast ("you" is S.char('main'); every other person one look, the same in every shot), the recurring places, the devices
   (how each abstract idea becomes a picture: a hand close-up, a HUD graphic, a map, a diagram, a counter), and per shot: its
   say words, the literal picture of the clause, the place and framing, who acts what on which word, the camera, the transition.
3. Write the scenes: scenes/*.js files of shot({ say, build(S) {...}, cam, trans }) (one file per chapter; every scene file
   imports from ../engine.js, this video's own places and helpers go in models.js), registered in project.json "scenes" in
   order. EVERY SHOT IS A DRESSED PLACE in the flat-vector look with a foreground, midground and background at real depths.
   THE PEOPLE ACT ON THEIR WORDS: poses and gestures land on the stressed word (S.at('word')), the eye and mouth shapes change
   on the word, walks with planted feet. Facts and numbers land ON their words as HUD graphics, maps, diagrams, counters or
   hand close-ups, readable for at least 1.5 s and never over a face. The camera moves like the references: close-ups and
   inserts static, wides and mediums the short 'auto' nudge, big pushes only on emotion or a threat (the skill's style.md).
4. QA: check_preview (no errors, no "say miss" / cue misses), then check_layout until it says Clean, then render_frames over
   every shot (8 per call, scale 0.5) and look: a literal picture of the clause, the subject readable, people acting, the place
   dressed and lit, graphics readable and spelled right, nothing through anything. Fix and look again only at what you
   changed. Motion: 3 frames 1/24 s apart on every walk, gesture and hand close-up (smooth, no pops, no sliding).
5. Sound: S.sfx(type, t) on picture events (about 15-25 a minute). Music: a QUIET STORY BED under the voice, written in
   audio/beds.json as {"music": true, "beds": [...]}: one music bed per section of the story with its mood (warm, mystery,
   tense, dark, playful, quirky) at about -34 dB (-33 .. -36: the music ~19 dB under the voice, the whole bed with the
   effects ~15 dB under it), plus a room tone at -46 dB; the user's own music replaces it (Project
   settings > Music).
This runs unattended. Don't render, mix or export the final video - the app does that. Finish with a short summary.
Preferred length: about ${mmss(meta.targetLength)}; the narration sets the real length.
User notes: ${r.instruction || "(none)"}`);
  } else if (r.kind === "build" && baseOf(meta.styleId) === "recon") {
    const st = meta.settings || {},
      secs = meta.seconds ?? meta.targetLength,
      media = st.media?.on !== false ? Math.max(1, Math.round((+(st.media?.perMin ?? 1) * secs) / 60)) : 0;
    const py = getConfig().tools.python || "python",
      ffmpeg = getConfig().tools.ffmpeg || "ffmpeg",
      S = ".claude/skills/recon-reconstruction";
    const inv = st.theme === "investigation",
      shots = Math.max(4, Math.round((secs / 60) * 16));
    const figs =
      st.figures && typeof st.figures === "object"
        ? [["main", st.figures.main], ...Object.entries(st.figures.roles || {})]
            .filter(([, c]) => c && typeof c === "object")
            .map(
              ([role, c]) =>
                `${role}: ${[c.body, c.finish, c.color].filter(Boolean).join(" ") || (c.rig || c.outfit ? "an older pick" : "default")}`,
            )
            .join("; ")
        : "";
    parts.push(`Build this video with the recon-reconstruction skill, inside Videoxx (3D reconstruction documentary, ${st.format === "vertical" ? "1080×1920 VERTICAL 9:16 (frame subjects vertically, key content and text in the centre column; see the skill)" : "1920×1080"}${inv ? ", INVESTIGATION LOOK: a dark, cinematic investigative documentary" : ""}).
Already done by the app - skip any setup: engine.js, models.js, lib/, vendor/, fonts/ exist; audio/clean.wav, audio/timeline.json
and audio/script_timed.txt are ready; project.json "end" is set.
1. Read ${S}/SKILL.md, then references/quality.md, references/signoff.md and references/engine_api.md. Skim
   references/failures.md (every defect seen so far, its cause and its fix).${
     inv
       ? `
   INVESTIGATION LOOK (settings.theme 'investigation'): also read references/investigation_shots.md and
   references/investigation_script.md, and follow SKILL.md "Investigation look": it replaces the Studio look's storyboard
   rhythm, media and high-key rules (quality.md "The Investigation look" is the bar: a dark mood that is always visible).
   ${INV_ANY_TOPIC}
   ${invTopicNote(meta.topic)}`
       : ""
   }
   ${RECON_NO_SLOP}${((n) => (n ? "\n" + n : ""))(flowTextureNote(r.projectId, meta.styleId, "   "))}
2. Research the event (research.md if there is one, else WebSearch): exact dates, times, places with coordinates, people, sequence.
   ${
     inv
       ? `Write storyboard.md with the cut-planning rules (investigation_shots.md): read script.txt for its visual tags ([MANNEQUIN],
   [PHOTO name], [DOC], [HEADLINE], [UI], [GRID], [BOARD], [PLACE+DATE], [STOCK], [ARCHIVE], [SIDEVIEW], [MAP], [QUOTE: name],
   [CHAPTER: title], [BREAK Ns]) beside audio/script_timed.txt (tag the sentences yourself where the script has none). One row
   per shot: start + anchor word, length, shot type, words, picture, transition in, camera, real asset + credit number.
   Cut ~1 frame before the word (shot t0 = cutAt('word', near)); a named person's photo lands on the name with lowerThird();
   one shot per list item (0.6-0.8 s); burst then hold (3-12 cuts under a second, then a 3-19 s hold); keyboard stutter (3 x
   ~0.65 s typing close-ups) when someone goes to work; black and chapter cards only in narration pauses ([BREAK] or a real
   gap in audio/timeline.json). Aim at the reference pacing: median shot ~2.3 s, about ${shots} shots for this ${mmss(secs)} video,
   but never cut faster than a shot can be read (no_slop.md P1-P4): fast bursts only of strong, well-lit frames.`
       : `Write storyboard.md: one shot per narration beat (a new shot every 4-8 s), what it shows, camera, overlays, real assets.`
   }
3. ${
      st.maps?.on !== false
        ? `REAL MAPS ARE ON: for each real place run
   "${py}" -u ${S}/scripts/region.py . <name> --lat <lat> --lon <lon> --half <km> --layers <only layers that existed then: coast,water,rivers,roads,parks,border,aeroway (airports)>
   (--water-level 0 for a coast; ~2-5 min, it retries on busy servers). Then await setup({ region: '<name>' }) in the first scene.`
        : "Real maps are off: no region maps (the studio and models only)."
    }
4. ${
      media && inv
        ? `REAL MEDIA IS ON (Investigation B-roll): about ${st.media?.perMin ?? 1} real picture(s) per minute, so about ${media} in this video, mostly
   FULL SCREEN with broll() (references/engine_api.md "Engine v7"): archive film of the real event, period photos of the people
   and places named, stock for general or present-day statements. Photos with the web_image tool (Wikimedia Commons, credited
   for you). Archive film: a public-domain or CC video file from Wikimedia Commons, downloaded with "${py}" (urllib) into
   assets/footage/, cut to numbered jpgs with "${ffmpeg}" -ss <s> -t <s> -i <file> -vf fps=15,scale=1280:-1 assets/footage/<name>/%03d.jpg,
   credited in assets/credits.txt, loaded with setup({ sequences }). Declare every source once, in order, with sources('Outlet -
   Title (Year)', ...) and give each broll() its credit (cite() on a 3D shot that shows a real fact): a numbered credit on every
   real asset. Pixel-censor (broll censor rects) faces of minors and anything graphic. Check every picture shows what the words say.`
        : media
          ? `REAL MEDIA IS ON: about ${st.media?.perMin ?? 1} real photo or film clip per minute, so about ${media} in this video. Photos with
   the web_image tool (Wikimedia Commons, credited for you), shown with photo(name, { caption, credit }). Archive film: a public-domain or
   CC video file from Wikimedia Commons, downloaded with "${py}" (urllib) into assets/footage/, cut to numbered jpgs with
   "${ffmpeg}" -ss <s> -t <s> -i <file> -vf fps=15,scale=640:-1 assets/footage/<name>/%03d.jpg, credited in assets/credits.txt,
   loaded with setup({ sequences }) and shown with footage(). Check every picture shows what the words say.`
          : "Real media is off: no photos or footage (everything is reconstructed)."
    }
5. ${
      st.models?.on !== false
        ? `FREE 3D MODELS ARE ON: real machines, vehicles and animals as downloaded models where a real shape matters. Find them with
   WebSearch / WebFetch (NASA 3D Resources, Smithsonian 3D CC0 items, Poly Pizza, Quaternius, Kenney - no sites that need an account),
   check the licence on the model's own page, then
   "${py}" ${S}/scripts/fetch_model.py . <direct .glb url> <file.glb> --title "..." --author "..." --license "..." --source "<page>"
   (it refuses NC / ND / unclear licences and records the credit). Load with setup({ models }) and model(key, { size, upright }).
   People are never downloaded: they are the project's figure(role)s (step 7). No good free model: build it by code.`
        : "Free 3D models are off: model everything by code (box, mesh, extrusions, lathe) from real proportions."
    }
6. Look at every new asset alone at full size (front and side) before it goes into a shot: a prop (or a downloaded model wrapped
   in a small builder) with the view_prop tool (engine v15+, references/props.md); otherwise a temporary close camera in its
   first shot + render_frames, fix it, put the camera back.
7. Write the scenes: one file per chapter in scenes/, registered in project.json "scenes" in order (first file starts with
   await setup(...)). Every event on its word (cue), every shot with people or moving bodies declares S.collide, overlays in
   empty space with leader lines, a source() credit line where real media or data is shown.
   PEOPLE (both looks; read references/characters.md, references/animations.md and references/hands.md when present): every
   person is figure(role, { parent: S.scene, x, z, ry, act, t }) from lib/figures.js, ${figs ? `the user's picks in Look > Characters: ${figs}` : "each role as Look > Characters sets it (the defaults so far)"}.
   The scene names the ROLE, never a look: no rig / outfit / colors, never override the user's role picks (one look for a
   group in code: figureGroup(name, { finish, color }) + figure(role, { group })); the person the story follows is figure('main').${
     inv
       ? ""
       : `
   Studio look: the same mannequins on the clay set, in the user's colours (matte suits the studio unless the user picked another finish).`
   }
   They act what is said: f.act / f.play('<catalog clip>') / f.sequence (lib/anims.js findAnims(tag); never an invented clip
   name); seated people ALWAYS sitOn(S, person, seat) (lib/props.js); held things with lib/hands.js hold(); the colour is the
   identity (never recolour a role per shot). Never cast(), actor() or a downloaded person for new people (legacy rigs).${
     inv
       ? `
   INVESTIGATION KIT (engine_api.md "Investigation kit"; the names are historical, the devices fit any topic): sets and devices
   from lib/crime.js (setBedroom / setOffice / setLobby / setStreet / setVoid, crimeBoard = a pinned board of the story's
   players or events, networkGrid = who connects to whom, sideView, evidence = documents and objects on a dark desk,
   darkSpace), cards from lib/crimeover.js (placeTag, lowerThird, statFloater, chapterCard, titleCard, quoteCard, headlineCard,
   creditsPanel, makeDoc) in shot({ flat: true }) when they fill the frame, transitions trans: 'cut' (default) | 'flash' |
   'glitch' | 'black' | 'iris'. Roles (people as above, figure(role)): ${invCrimeTopic(meta.topic) ? "defaults: main, suspect, victim, detective, witness, accomplice, official, prisoner, police, swat, unknown, extra" : "main, witness, official, unknown and extra fit any story; the crime roles of the defaults only if the story is about a crime"};
   a withheld identity stays the 'unknown' figure until the reveal. Colour: one crimson accent (red = threat, tension or digital, blue = a mind). No gore: a headline carries it.`
       : ""
   }
8. SIGN-OFF (references/signoff.md) - the video may not be rendered before this passes:
   check_preview (no errors, no cue misses) -> check_layout until it says Clean (coplanar surfaces, bodies through bodies or
   objects, z-fight flicker: fix each at its cause) -> render_frames at every shot's start, middle and end (scale 0.5, one
   call per shot), and at full size (scale 1, one or two times per call) wherever a flaw would show: contact points (feet on
   the ground, hands on what they hold, wheels and hulls), faces, tags and small text, and every moment something moves near
   something else: nobody hidden or headless, nothing cut off or floating, no card over the subject, never two tags at once.
   Fix and look again at the moments you changed. A check_layout finding is never left standing: fix it at its cause until
   it says Clean. A purely visual flaw still wrong after two more looks: write it in storyboard.md and move on. Moments you
   saw whose files did not change come back as text; the run's frame budget covers every shot of this check. Write what you
   checked and fixed at the end of storyboard.md.${
     inv
       ? ` Investigation: also signoff.md's look items (a numbered credit on every
   real asset, light readable text on the dark, the subject separated from the dark, each role's look the same in every shot).`
       : ""
   }
9. ${
      inv
        ? `Sound: NO sound effects unless the user supplied them (the kit's overlays are silent by default; add no sfx() calls);
   the voice is the user's ElevenLabs voice; the [BREAK] pauses are where the music carries alone.`
        : `Sound: audio/beds.json (wind outdoors, water at sea/caves, drone inside, space in orbit) and sfx(type, t) in the scenes on
   the frames the picture shows impacts, splashes, alarms, ticks.`
    }
10. DESCRIPTION.txt: a 2-line summary, then every credit (photos and footage from assets/credits.txt, 3D models from
   assets/models/CREDITS.json, map data: OpenStreetMap ODbL and AWS Terrain Tiles) and what is simplified.
This runs unattended. Don't render, mix or export the final video - the app does that. Finish with a short summary.
Preferred length: about ${mmss(meta.targetLength)}; the narration sets the real length.
User notes: ${r.instruction || "(none)"}`);
  } else if (r.kind === "build") {
    const flat = baseOf(meta.styleId) === "flat",
      vox = meta.styleId === "vox" || baseOf(meta.styleId) === "collage" || flat,
      collage = baseOf(meta.styleId) === "collage";
    const starter = baseOf(meta.styleId) === "starter",
      d3 = meta.settings?.dim === "3d";
    const custom = getStyle(meta.styleId).custom ? getStyle(meta.styleId).name : null;
    const noMain =
      flat &&
      (() => {
        try {
          return noMainCharacter(getProject(r.projectId).path);
        } catch {
          return false;
        }
      })();
    const pixelCrew =
      isPixelCrew(meta.styleId) &&
      (() => {
        try {
          return crewOn("build", meta.styleId, getProject(r.projectId).path);
        } catch {
          return false;
        }
      })();
    parts.push(`Build this video with the ${meta.skill} skill, inside Videoxx.${
      noMain
        ? `
CAST: ${NO_MAIN_CHARACTER}. The user chose no main character for this video: the skill's "main character" steps don't
apply; cast each scene's own people (randomLook looks) and objects, and never star character.js (a placeholder).`
        : ""
    }${
      custom
        ? `
STYLE: this video is in the user's own custom style "${custom}". Read the skill's references/custom_style.md before
anything else: its colours, fonts, backgrounds, elements, motion and image art are the look, and it wins over every other
reference. Use only the kinds of elements, fonts and colours it uses.`
        : ""
    }
Already done by the app - skip these skill steps: setup.py, init_project.py, audio_prep.py, transcribe.py, align.py
(engine.js, models.js, vendor/, fonts/ exist; audio/clean.wav, audio/timeline.json and audio/script_timed.txt are ready).
1. Read brief.md (if present) and audio/script_timed.txt; read the skill's style guide and engine API
   (.claude/skills/${meta.skill}/references).
2. Write storyboard.md.${
      collage
        ? `
   Then write the image list (every image, one line each: name, kind, what it shows) at the end of storyboard.md, ${
     getStyle(meta.styleId).custom
       ? `keep
   project.json "imageStyle" exactly as it is (it is this custom style's art line: describe only the subject in each prompt)`
       : `set
   project.json "imageStyle" to one line describing the shared look`
   }, and make the images with the make_image tool:
   the hero cut-out first, then the rest with ref set to it so the look stays consistent. Make each image ONCE
   (about $0.013 each on the user's account, budget in project.json "imageBudget"); no text inside any image.
   FRAME: this video is ${aspectOf(meta.styleId, meta.settings) < 1 ? "9:16 (vertical)" : "16:9 (landscape)"}: every background and every picture that fills a scene is made at aspect
   "${aspectOf(meta.styleId, meta.settings) < 1 ? "9:16" : "16:9"}" (leave make_image's aspect out and it is); only cut-outs are square, never 1:1 or 3:2 for a full-frame picture.${
     meta.pace
       ? `
   PACING (the user's setting: ${meta.pace.perMinute} pictures per minute, for this ${mmss(meta.seconds ?? meta.targetLength)} video): about
   ${meta.pace.chapters} chapters and about ${meta.pace.images} cut-outs in total, about ${meta.pace.perChapter} per chapter, a new picture
   landing about every ${meta.pace.every} s. This replaces the skill's fixed counts ("5-9 chapters", "2-4 cut-outs per chapter"),
   which are for a one-minute video: a long chapter gets more framings and more pieces landing on their words, so no
   stretch of narration holds the same picture. Reuse a picture only as a callback, never as a filler.`
       : ""
   }`
        : ""
    }
3. Build the scenes section by section in scenes/*.js (new models in models.js), registering each file in
   project.json "scenes" and keeping "end" as set. Put a title comment line above every shot
   (// ---- 2: the Thinkers light up ----), give model groups userData.kind and keep key objects on st.
4. ${
      flat
        ? `ELEMENTS FIRST (the skill's QUALITY_STANDARD): any new model you add to models.js is checked alone at full
   size before you use it in scenes (render_frames of a test shot that shows only it), shading cut from its outline.
   Then verify every scene: check_preview, then check_layout until it says Clean (it measures caption-band intrusions,
   cut-offs, overlaps, small text and shading drawn outside an element's form), then the visual pass with
   render_frames at each landing moment AND consecutive moments around every pose/expression change (nothing may snap;
   3 times 0.1 s apart in one call at scale 0.5 is enough).
   Also `
        : ""
    }${
      starter
        ? `ELEMENTS FIRST (the skill's RULES.md): any new element (registerElement in models.js) is shown alone with
   kitShot (lib/kit.js) on light and dark and checked (check_layout + render_frames) before it goes into a scene. Change the
   engine only through its extension points (THEMES, registerElement, LAYOUT_CHECKS, TRANSITIONS, POST_UNIFORMS / POST_GLSL).
   Then verify every scene: check_preview, then check_layout until it says Clean (cut-offs, the caption band, overlaps, small
   text, contrast, empty frames, DARK, ABRUPT camera${d3 ? ", floating, through, coplanar, flicker" : ""}), then the visual pass with render_frames.
   Also `
        : ""
    }${
      collage
        ? `Verify every chapter with the SOP in the skill: check_preview, then check_layout until it says Clean, then
   the visual pass with render_frames (ask what is out of place, in the way, not visible or not intended, and fix it).
   Also `
        : ""
    }QA every section with the suite render_frames tool (not render.mjs; up to 8 times per call, so split the skill's
   12-20 frame sheets over several calls) and fix what you see; call check_preview after each file. After a fix, look
   again only at the moments you changed, at most twice per fix (still wrong after that: note it in your summary and move
   on): every image stays in the conversation and costs the user's plan at each step, and the run has a frame budget.
5. Write audio/beds.json (${vox || starter ? "the music bed and room tone per section, see the skill references/sound_design.md" : "ambience per section"}).
${pixelCrew ? "Real images: the crew's asset-scout fetches them (CREW BUILD below)." : "This runs unattended: nobody can approve downloads, so don't fetch real-world images unless the brief asks for them."}
Don't render, mix or export the final video - the app does that. Finish with a short summary of the shots.
Preferred length for this video: about ${mmss(meta.targetLength)}; the narration sets the real length, so pace the shots to it.${
      meta.narration
        ? `
LANGUAGE: the narration (audio/script_timed.txt) is in ${N.name}, although the video is set to ${L.name}. Every word on screen
(titles, labels, cards, captions, numbers and dates) is in ${N.name}, the language spoken${N.code !== "en" ? ", spelled with its accents" : ""}; cue words come from
audio/script_timed.txt as written. Plan and comment in English if you like.`
        : foreign
          ? `
LANGUAGE: the narration is in ${L.name}. Every word on screen (titles, labels, cards, captions, numbers and dates) is in ${L.name},
spelled with its accents; cue words come from audio/script_timed.txt as written. Plan and comment in English if you like.${
              screenTextNote(L.code)
                ? `
${screenTextNote(L.code)}`
                : ""
            }`
          : ""
    }
User notes: ${r.instruction || "(none)"}`);
  } else {
    parts.push(r.instruction.trim());
    const sel = r.selection ?? [];
    if (sel.length)
      parts.push(`
Selected in the editor:
${describeSelection(sel)}`);
    const scope = r.scope ?? (sel.length ? "selection" : "video");
    if (r.kind === "edit")
      parts.push(
        {
          selection: "\nScope: change only the selected element(s) and whatever is needed to make that work.",
          shot: "\nScope: this change applies to the selected shot(s) only.",
          video: "\nScope: apply this across the whole video wherever it is relevant (every shot/scene file it affects), consistently.",
        }[scope],
      );
    if (r.kind === "ask") parts.push("\nThis is a question: answer it without editing files (edits are switched off for questions).");
    else if (verify)
      parts.push(
        "\nAfter editing: call check_preview, then render_frames at 2-4 times that show the change; fix anything that looks wrong (at most 3 rounds).",
      );
  }
  const pst = getStyle(meta.styleId);
  if ((r.kind === "build" || r.kind === "reframe") && pst.pkg) {
    const pdir = (() => {
        try {
          return getProject(r.projectId).path;
        } catch {
          return null;
        }
      })(),
      pm = manifestOf(pst.id, pdir) ?? pst.pkg.manifest;
    const ign = pm.prompts.ignoreBaseRefs.filter(Boolean),
      extra = pkgPrompt(pst.id, r.kind === "reframe" ? "reframe" : "build", pdir);
    parts.push(`
STYLE: this video is in the style "${pst.name}" (a style built on ${getStyle(baseOf(pst.id)).name}). Before step 1, read
.claude/skills/style-${pst.id}/SKILL.md and every file it lists: its look (palette, type, backgrounds, elements, motion) wins over
the look references of the ${meta.skill} skill${ign.length ? ` (ignore these for the look: ${ign.join(", ")})` : ""}; the ${meta.skill} skill's engine API, workflow and checks still apply.${
      extra
        ? `
${extra}`
        : ""
    }`);
  }
  if ((r.kind === "build" || r.kind === "reframe") && meta.brand) parts.push("\n" + meta.brand);
  if (r.kind === "build" || r.kind === "reframe") parts.push("\n" + NO_SLOP_BANS);
  if ((r.kind === "build" || r.kind === "reframe") && !libraryOff()) parts.push("\n" + LIBRARY_NOTE);
  if (
    (r.kind === "build" || r.kind === "edit" || r.kind === "routine") &&
    (() => {
      try {
        return referencePaths(getProject(r.projectId).path).length > 0;
      } catch {
        return false;
      }
    })()
  )
    parts.push(
      "\nReferences: when this request has a REFERENCES block, the frames listed there are the target look (every style): read the contact sheet and the frames before you design a scene, and match their composition, colour, light, typography, camera and pacing with our own subject (reference_frames pulls more frames of any reference or range).",
    );
  if (r.kind === "build" || r.kind === "reframe")
    parts.push("\n" + progressNote(r.kind === "reframe" ? "scene file" : "chapter / scene file"));
  const crewDir =
    r.kind === "build"
      ? (() => {
          try {
            const p = getProject(r.projectId);
            return crewOn(r.kind, meta.styleId, p.path) ? p.path : null;
          } catch {
            return null;
          }
        })()
      : null;
  const crewPolish = !!crewDir && !!r.extras?.includes("ultra") && !r.extras?.includes("ultraplus");
  if (crewDir && isPixelCrew(meta.styleId))
    parts.push(
      "\n" +
        pixelDirectorText({
          secs: meta.seconds ?? meta.targetLength,
          ultra: crewPolish,
          hibit: meta.settings?.color?.palette === "hibit",
          skill: meta.skill,
          py: getConfig().tools.python || "python",
        }),
    );
  else if (crewDir && isToonCrew(meta.styleId)) {
    const secs = meta.seconds ?? meta.targetLength;
    parts.push("\n" + toonDirectorText({ secs, shots: toonShots(secs), ultra: crewPolish, skill: meta.skill }));
  } else if (crewDir && isStickCrew(meta.styleId))
    parts.push("\n" + stickDirectorText({ secs: meta.seconds ?? meta.targetLength, ultra: crewPolish, skill: meta.skill }));
  else if (crewDir) {
    const secs = meta.seconds ?? meta.targetLength;
    parts.push(
      "\n" +
        crewDirectorText({
          secs,
          shots: Math.max(4, Math.round(secs / (meta.settings?.theme === "investigation" ? 3.75 : 6))),
          ultra: crewPolish,
        }),
    );
  }
  if (r.kind === "build") {
    if (r.extras?.includes("ultraplus") && baseOf(meta.styleId) === "recon")
      parts.push(
        "\nWhen everything above is done:\n" +
          ultraPlusText(
            "every shot of the video (list_shots gives them)",
            "",
            "have",
            meta.settings?.theme === "investigation",
            flowTextures(r.projectId, meta.styleId),
            null,
            meta.topic,
          ),
      );
    else if (r.extras?.includes("ultra")) {
      const u = ultraText(
        baseOf(meta.styleId),
        void 0,
        "",
        meta.settings || {},
        customName(meta.styleId),
        meta.styleId,
        (() => {
          try {
            return getProject(r.projectId).preset_id;
          } catch {
            return null;
          }
        })(),
        meta.topic,
        (() => {
          try {
            return getProject(r.projectId).path;
          } catch {
            return null;
          }
        })(),
      );
      parts.push(crewPolish ? "\n" + crewUltraText(crewDir, u, { inBuild: true }) : "\nWhen everything above is done:\n" + u);
    }
  }
  return parts.join("\n");
}
export function testScriptPrompt(projectId) {
  const project = getProject(projectId),
    sty = getStyle(project.style_id);
  const pjm = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(project.path, "project.json"), "utf8"));
    } catch {
      return {};
    }
  })();
  return buildPrompt({ projectId, kind: "script", instruction: "" }, false, {
    targetLength: pjm.targetLength || getConfig().video.length,
    topic: pjm.topic || "",
    styleBrief: sty.brief,
    skill: sty.skill,
    styleId: sty.id,
    language: lang(pjm.language).code,
    lessons: approvedFor({ projectId }),
  });
}
export function testUltraPrompt(projectId, shots, plus = false) {
  if (plus) {
    const project22 = getProject(projectId);
    return { prompt: ultraProcedure(projectId, baseOf(project22.style_id), shots, true) };
  }
  const project = getProject(projectId);
  getStyle(project.style_id);
  return { prompt: ultraProcedure(projectId, baseOf(project.style_id), shots) };
}
export function testTaskPrompt(projectId, kind, instruction = "", language, extras) {
  const project = getProject(projectId);
  if (kind === "script") writeContext(projectId);
  const pjm = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(project.path, "project.json"), "utf8"));
    } catch {
      return {};
    }
  })();
  const sty = getStyle(project.style_id),
    to = kind === "script" ? scriptLanguageOf(project.path, pjm, language) : { code: lang(pjm.language).code, scriptIn: null };
  return buildPrompt(withExtras({ projectId, kind, instruction, extras }, baseOf(project.style_id)), false, {
    targetLength: pjm.targetLength || getConfig().video.length,
    topic: pjm.topic || "",
    styleBrief: sty.brief,
    skill: sty.skill,
    styleId: sty.id,
    language: to.code,
    scriptIn: to.scriptIn,
    lessons: kind === "script" ? approvedFor({ projectId }) : [],
    settings: pjm.settings || {},
    narration: kind === "build" ? narrationLanguageOf(project.path, to.code) : null,
  });
}
export function testLibraryPrompt(projectId, kind = "build", instruction = "") {
  const project = getProject(projectId);
  writeContext(projectId);
  const blocks = libraryBlocks(projectId, kind, instruction),
    base = { targetLength: 60, topic: "t", styleBrief: "", skill: "skill", language: "en", styleId: project.style_id };
  let ultra = "";
  try {
    ultra = ultraProcedure(projectId, baseOf(project.style_id));
  } catch {}
  return {
    system: systemAppend(false),
    studioSystem: studioSystem(),
    blocks,
    lead: libraryLead(blocks, null),
    off: libraryOff(),
    build: kind === "build" ? testTaskPrompt(projectId, "build", instruction) : "",
    reframe: buildPrompt({ projectId, kind: "reframe", instruction: "" }, false, { ...base, orig: "x" }),
    lowpoly: buildPrompt({ projectId, kind: "build", instruction: "" }, false, { ...base, styleId: "lowpoly" }),
    ultra,
    tools: suiteToolDefs(projectId).map((d) => d.name),
    claudeMd: fs.readFileSync(path.join(project.path, "CLAUDE.md"), "utf8"),
  };
}
export function testUsageLimits(projectId) {
  const base = { targetLength: 60, topic: "t", styleBrief: "", skill: "skill", language: "en" };
  const prompts = {};
  for (const s of ["pixel-art", "collage", "flat", "stickman", "recon", "lowpoly", "toon", "stickstory", "vox", "starter"])
    prompts[s] = buildPrompt({ projectId, kind: "build", instruction: "" }, false, { ...base, styleId: s });
  prompts.reframe = buildPrompt({ projectId, kind: "reframe", instruction: "" }, false, { ...base, styleId: "flat", orig: "x" });
  prompts.ultra = `${ultraProcedure(projectId, "pixel-art", void 0)}
${progressNote("shot")}`;
  const budgets = Object.fromEntries(
    [120, 360].map((n) => [
      n,
      {
        build: frameBudget("build", n),
        verified: frameBudget("build", n, { verified: true }),
        recon: frameBudget("build", n, { recon: true }),
        ultraBuild: frameBudget("build", n, { ultraShots: n }),
        ultra: frameBudget("ultra", n, { ultraShots: n }),
        edit: frameBudget("edit", n),
      },
    ]),
  );
  return {
    budgets,
    compactWindow: COMPACT_WINDOW,
    freshAfter: FRESH_AFTER_TOKENS,
    progressFile: PROGRESS_FILE,
    system: SYSTEM.includes(PROGRESS_FILE),
    fresh: Object.fromEntries([12e4, 499e3, 501e3].map((n) => [n, startsFresh(n)])),
    progress: Object.fromEntries(
      Object.entries(prompts).map(([k, p]) => [k, p.includes(PROGRESS_FILE) && /after a summary of the conversation/i.test(p)]),
    ),
  };
}
function narrationLanguageOf(dir, code) {
  for (const f of ["audio/transcript.txt", "script.txt"]) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    if (text.trim()) return otherScriptLanguage(f === "script.txt" ? spokenScript(text, code) : text, code);
  }
  return null;
}
function scriptLanguageOf(dir, pjm, asked) {
  const code = langCode(asked) ?? lang(pjm.language).code;
  let text = "";
  try {
    text = fs.readFileSync(path.join(dir, "script.txt"), "utf8");
  } catch {}
  return { code, scriptIn: text ? otherScriptLanguage(spokenScript(text, code), code) : null };
}
const imageBlock = (url) => {
  const [meta, data] = url.split(",");
  return { type: "image", source: { type: "base64", media_type: meta.slice(5, meta.indexOf(";")), data } };
};
async function* userMessage(textPrompt, frame, images = [], time, hold) {
  const content = [];
  images
    .filter((u) => /^data:image\/(png|jpeg|webp|gif);base64,/.test(u))
    .slice(0, 4)
    .forEach((u, i) => {
      content.push({ type: "text", text: `Reference image ${i + 1} from the user:` });
      content.push(imageBlock(u));
    });
  if (frame?.startsWith("data:image/")) {
    const [meta, data] = frame.split(",");
    content.push({
      type: "text",
      text: `Preview frame${typeof time === "number" ? ` at t=${time.toFixed(2)}s` : ""} (what the user was looking at when asking; selections are outlined):`,
    });
    content.push(imageBlock(`${meta},${data}`));
  }
  content.push({ type: "text", text: textPrompt });
  yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" };
  if (hold) await hold;
}
const addMsg = (threadId, role, content) =>
  q.run("INSERT INTO messages(thread_id, role, content, created_at) VALUES(?,?,?,?)", threadId, role, JSON.stringify(content), now());
function toolSummary(name, input) {
  const n = name.replace(/^mcp__suite__/, "");
  const rel = (p) =>
    String(p || "")
      .split(/[\\/]/)
      .slice(-2)
      .join("/");
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(n))
    return `${n === "Write" ? "Writing" : "Editing"} ${rel(input?.file_path)}`;
  if (n === "Read") return `Reading ${rel(input?.file_path)}`;
  if (n === "Bash") return `Running ${String(input?.command || "").slice(0, 80)}`;
  if (n === "Grep" || n === "Glob") return `Searching ${String(input?.pattern || "").slice(0, 60)}`;
  if (n === "WebSearch") return `Searching the web ${String(input?.query || "").slice(0, 80)}`;
  if (n === "WebFetch")
    return `Reading ${String(input?.url || "")
      .replace(/^https?:\/\/(www\.)?/, "")
      .slice(0, 80)}`;
  if (n === "render_frames") return `Rendering frames at ${(input?.times || []).map((t) => t.toFixed(1) + "s").join(", ")}`;
  if (n === "check_preview") return "Checking the preview for errors";
  if (n === "Skill") return `Using skill ${input?.skill ?? ""}`;
  if (n === "TodoWrite") return "Planning";
  if (n === "Task" || n === "Agent")
    return `Agent ${input?.subagent_type || "helper"}: ${String(input?.description || input?.prompt || "")
      .split("\n")[0]
      .slice(0, 70)}`;
  if (n === "ToolSearch") return "Loading tools";
  if (n === "get_selection") return "Looking at your selection";
  if (n === "list_shots") return "Listing shots";
  if (n === "narration") return "Reading the narration timing";
  if (n === "remember_rule") return "Suggesting a style rule";
  if (n === "library_search") return `Library: searching "${String(input?.query || "").slice(0, 60)}"`;
  if (n === "library_get") return `Library: reading ${libraryLabel(input?.id)}`;
  if (n === "library_use") return `Library: using ${libraryLabel(input?.id)}`;
  if (n === "library_add") return `Library: saving "${String(input?.title || "").slice(0, 60)}"`;
  if (n === "library_note_outcome")
    return `Library: ${input?.outcome === "worked" ? "it worked" : input?.outcome === "failed" ? "it failed" : "partly worked"} (${libraryLabel(input?.id)})`;
  return n.replace(/_/g, " ");
}
const AUTH_RACE = /refresh(ing)? (the )?oauth token|another claude code process is refreshing/i;
let lastStart = 0;
async function startGate(gapMs = 4e3) {
  const at = Math.max(Date.now(), lastStart + gapMs);
  lastStart = at;
  if (at > Date.now()) await new Promise((res) => setTimeout(res, at - Date.now()));
}
export function friendlyError(msg, engine = "claude") {
  if (engine === "google") {
    if (/disabled in this account|violation of (the )?terms of service|PERMISSION_DENIED/i.test(msg))
      return "Google blocked this account for third-party use. Stop using it here; see Settings > Experimental.";
    if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg))
      return "Google's quota is used up for now. Try again later, or pick a Claude model.";
    if (/\b401\b|missing api key|invalid api key/i.test(msg))
      return "CLIProxyAPI refused the app's key. Turn Google models off and on again in Settings > Experimental.";
    if (/ECONNREFUSED|ECONNRESET|fetch failed|Unable to connect|connection error/i.test(msg))
      return "Could not reach CLIProxyAPI on this computer. Check Settings > Experimental (it should say Running).";
  }
  if (engine === "codex") {
    if (/^OUTSIDE_PROJECT: /.test(msg)) return msg.replace(/^OUTSIDE_PROJECT: /, "");
    if (/spawn\b.*\bENOENT|ENOENT.*codex|codex[^\n]{0,40}not (found|recognized)/i.test(msg))
      return "ChatGPT (Codex) is not installed or was moved. Install it in Settings > AI engines, then try again.";
    if (/unexpected argument|unrecognized (option|argument)|unknown (option|flag)|wasn't expected/i.test(msg))
      return "Your Codex is too old for the app. Update it in Settings > AI engines (or run: npm install -g @openai/codex@latest), then try again.";
    if (
      /not logged in|not signed in|please (run )?(`)?codex login|log ?in (again|required)|401|unauthori[sz]ed|token[^.\n]{0,30}(expired|invalid|revoked)|refresh[_ ]token/i.test(
        msg,
      )
    )
      return "ChatGPT is not signed in (or its sign-in ran out). Sign in with ChatGPT in Settings > AI engines, then try again.";
    if (/usage[_ ]limit|rate[_ ]limit|hit your (usage )?limit|limit (reached|exceeded)|too many requests|\b429\b|quota/i.test(msg)) {
      const when = msg.match(/try again (in|at) ([^.\n]{1,40})/i)?.[0];
      return `Your ChatGPT plan's Codex limit is used up for now (the 5-hour or the weekly limit)${when ? `; ${when.toLowerCase()}` : ""}. Pick a Claude model meanwhile, or see your usage in Settings > AI engines > Codex usage.`;
    }
    if (
      /model[^\n]{0,80}(not (supported|available|found)|does not exist|do not have access|isn't available|is unavailable)|model_not_found|unsupported model/i.test(
        msg,
      )
    )
      return "This ChatGPT model is not available on your plan (GPT-6 Astra needs Plus or higher; some models are Pro only). Pick another ChatGPT model, or a Claude one.";
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network error|stream disconnected|error sending request/i.test(msg))
      return "Could not reach ChatGPT. Check your internet connection and try again.";
    return msg.replace(/^Codex Exec exited with code \d+:\s*/i, "ChatGPT stopped: ").slice(0, 600);
  }
  require("./videoxx-auth").noteError(msg);
  const reset = msg.match(/usage limit reached\|(\d{9,})/i);
  if (reset)
    return `Your Claude usage limit is reached. It resets at ${new Date(+reset[1] * 1e3).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}. Edits made before this point (if any) are listed and can be reverted.`;
  if (/credit balance is too low/i.test(msg))
    return "Claude Code is signed in with an Anthropic API key that has no credit left, not your Claude plan. In Settings > AI engines, click Sign out, then Sign in with Claude.";
  if (/usage limit|out of (extra )?usage/i.test(msg))
    return "Your Claude usage limit is reached for now. Try again later, or pick a lighter model in Settings.";
  if (/overloaded|\b529\b/i.test(msg)) return "Claude is overloaded right now. Try again in a minute.";
  if (AUTH_RACE.test(msg))
    return "Claude Code could not refresh its sign-in because another Claude Code process was doing the same. Try again in a minute; if it keeps happening, close other Claude Code windows or sign in again in Settings > AI engines.";
  if (/not logged in|please run \/login|oauth token has expired/i.test(msg))
    return "Claude is not signed in (or its sign-in ran out). Sign in with Claude in Settings > AI engines, then try again.";
  if (/rate.?limit|\b429\b/i.test(msg)) return "Claude is rate-limiting requests right now. Try again in a minute.";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network error|getaddrinfo/i.test(msg))
    return "Could not reach Claude. Check your internet connection and try again.";
  return msg;
}
export function insideDir(root, target) {
  const real = (p) => {
    let cur = path.resolve(p),
      rest = "";
    for (;;) {
      try {
        return path.join(fs.realpathSync.native(cur), rest);
      } catch {
        const up = path.dirname(cur);
        if (up === cur) return path.resolve(p);
        rest = path.join(path.basename(cur), rest);
        cur = up;
      }
    }
  };
  const r = real(root),
    t = real(path.resolve(root, target)),
    cmp = process.platform === "win32" ? (x) => x.toLowerCase() : (x) => x;
  return cmp(t) === cmp(r) || cmp(t).startsWith(cmp(r) + path.sep);
}
export function readOutsideCheck(root, target) {
  if (!target || insideDir(root, target)) return null;
  const abs = path.resolve(root, target);
  if (isReferencePath(root, abs)) return null;
  const open = [
    templatesDir(),
    process.resourcesPath,
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    os.tmpdir(),
  ].filter(Boolean);
  if (
    open.some((d) => {
      try {
        return insideDir(d, abs);
      } catch {
        return false;
      }
    })
  )
    return null;
  const wsRoot = (() => {
    try {
      return ws.root();
    } catch {
      return "";
    }
  })();
  if (wsRoot && insideDir(wsRoot, abs)) {
    const other = q.all("SELECT path FROM projects").some((p) => p.path && !insideDir(root, p.path) && insideDir(p.path, abs));
    if (!other) return null;
  }
  return `Videoxx only lets this session read files inside this project folder (${root}), the references the user added (see REFERENCES) and the app's own templates. ${abs} is outside them.`;
}
export const projectThread = (projectId) =>
  q.get(
    "SELECT * FROM threads WHERE project_id=? AND claude_session_id IS NOT NULL AND COALESCE(kind,'') != 'harvest' ORDER BY updated_at DESC LIMIT 1",
    projectId,
  ) ?? null;
function sessionExists(id, engine) {
  if (engine === "codex") return true;
  if (fake && id.startsWith("fake-")) return true;
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  try {
    return fs.readdirSync(root).some((d) => fs.existsSync(path.join(root, d, `${id}.jsonl`)));
  } catch {
    return false;
  }
}
function runContext(projectId, personal) {
  const rules = rulesText(projectId);
  const shotList = personal
    ? ""
    : getShots(projectId)
        .slice(0, 150)
        .map((s) => `${s.index + 1}. ${(+s.t0).toFixed(2)}-${(+s.t1).toFixed(2)}s ${s.name} (${s.file}:${s.line})`)
        .join("\n");
  return [
    rules.global.length
      ? `Global style rules (the user's standing preferences):
${rules.global.map((x) => "- " + x).join("\n")}`
      : "",
    rules.project.length
      ? `Project style rules:
${rules.project.map((x) => "- " + x).join("\n")}`
      : "",
    shotList
      ? `Current shots (index, start-end in seconds, title, source):
${shotList}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
const systemAppend = (personal) => (personal ? PERSONAL_SYSTEM : libraryOff() ? SYSTEM : SYSTEM_LIB);
const sentLibrary = new Map();
function libraryLead(blocks, resume) {
  const prev = resume ? sentLibrary.get(resume) : void 0;
  return Object.entries(blocks)
    .filter(([k, v]) => v && prev?.[k] !== v)
    .map(([, v]) => v)
    .join("\n\n");
}
const sentContext = new Map();
const AGENT_KINDS = new Set(["build", "reframe", "character", "cut", "intro", "routine"]);
const COMPACT_WINDOW = 5e5;
const FRESH_AFTER_TOKENS = COMPACT_WINDOW;
const PROGRESS_FILE = ".suite/build-progress.md";
const startsFresh = (lastContext) => +lastContext >= FRESH_AFTER_TOKENS;
const progressNote = (
  what,
) => `PROGRESS FILE (${PROGRESS_FILE}): a long job can outgrow the conversation, which Claude Code then summarises. Keep
your working memory on disk: at the start create it (or add a section for this job to it), and after each ${what} update it with
what is done (and checked), the decisions to keep (palette and colours, character names and looks, camera rules, naming,
models and images made), open problems, and what is next. After a summary of the conversation (or in a fresh one), read it
first, with CLAUDE.md and storyboard.md, and carry on from "next"; don't redo finished work. Delete nothing in it until the job is done.`;
const afterCompactText = (context, task) =>
  [
    `The conversation was just summarised to stay under ${Math.round(COMPACT_WINDOW / 1e3)}k tokens. Before you continue: read ${PROGRESS_FILE} (if it exists), CLAUDE.md and storyboard.md; the files are the source of truth.`,
    context,
    task
      ? `YOUR TASK in this request, as it was given (repeated after the summary; carry on where the progress file says, don't start over):
${task}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
function recentWork(projectId) {
  const rows = q
    .all(
      "SELECT instruction, summary, status FROM edits WHERE project_id=? AND status IN ('done','no-change','reverted','failed') AND COALESCE(kind,'') != 'harvest' ORDER BY created_at DESC LIMIT 12",
      projectId,
    )
    .reverse();
  const one = (s, n) => {
    const t = String(s || "")
      .replace(/\s+/g, " ")
      .trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  };
  return rows
    .map(
      (x) =>
        `- ${one(x.instruction || "edit", 120)}${x.status === "reverted" ? " (reverted)" : x.status === "failed" ? " (failed)" : ""}${x.summary ? `: ${one(x.summary, 260)}` : ""}`,
    )
    .join("\n");
}
function toolUsage(calls, ledger) {
  const out = {};
  for (const [n, c] of calls) out[n] = { calls: c, images: 0, tokens: 0, cached: 0, refused: 0 };
  for (const [n, s] of Object.entries(ledger?.tools ?? {})) {
    const o = (out[n] ??= { calls: 0, images: 0, tokens: 0, cached: 0, refused: 0 });
    o.calls = Math.max(o.calls, s.calls);
    o.images += s.images;
    o.tokens += s.tokens;
    o.cached += s.cached;
    o.refused += s.refused;
  }
  return out;
}
function toolUsageLine(tools, ledger) {
  const list = Object.entries(tools).sort((a, b) => b[1].tokens - a[1].tokens || b[1].calls - a[1].calls);
  const img = list.reduce((a, [, s]) => a + s.tokens, 0);
  return `${list.map(([n, s]) => `${n} ${s.calls}${s.images ? ` (${s.images} images ~${Math.round(s.tokens / 1e3)}k tok)` : ""}${s.cached ? ` ${s.cached} cached` : ""}${s.refused ? ` ${s.refused} refused` : ""}`).join(", ") || "no tools"} | images ~${Math.round(img / 1e3)}k tok${ledger ? ` (frame budget ${Math.round(ledger.spent / 1e3)}k of ${Math.round(ledger.budget / 1e3)}k${ledger.over ? ", USED UP" : ""})` : ""}`;
}
function recordUsage(editId, kind, turns, resumed, fresh, tools, ledger) {
  const sum = (k, list = turns) => list.reduce((a, t) => a + t[k], 0);
  const main = turns.filter((t) => !t.agent),
    last2 = main[main.length - 1];
  const out = {
    cacheRead: sum("cache_read"),
    cacheWrite: sum("cache_write"),
    context: last2 ? last2.input + last2.cache_read + last2.cache_write : 0,
    images: sum("images"),
    turns: turns.length,
  };
  try {
    for (const t of turns)
      q.run(
        "INSERT INTO claude_turns(edit_id,n,at,model,agent,wake,input,cache_read,cache_write,output,images) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        editId,
        t.n,
        t.at,
        t.model,
        t.agent,
        t.wake,
        t.input,
        t.cache_read,
        t.cache_write,
        t.output,
        t.images,
      );
    q.run(
      "UPDATE edits SET cache_read=?, cache_write=?, tool_usage=? WHERE id=?",
      out.cacheRead,
      out.cacheWrite,
      tools ? JSON.stringify(tools) : null,
      editId,
    );
  } catch (err) {
    log("usage not recorded", err?.message);
  }
  if (tools && Object.keys(tools).length) log("usage tools", editId, kind, "|", toolUsageLine(tools, ledger));
  if (turns.length) {
    const all = out.cacheRead + out.cacheWrite + sum("input");
    log(
      "usage run",
      editId,
      kind,
      `${resumed ? "resumed" : fresh ? "fresh (long conversation)" : "new"} conversation |`,
      turns.length,
      "turns",
      `(${turns.length - main.length} agent, ${turns.filter((t) => t.wake).length} wake-ups) |`,
      "cache read",
      out.cacheRead,
      "cache write",
      out.cacheWrite,
      "input",
      sum("input"),
      "output",
      sum("output"),
      `| cached ${all ? Math.round((out.cacheRead / all) * 100) : 0}% | images`,
      out.images,
      "| context now",
      out.context,
    );
  }
  return out;
}
let planLimit = null;
function notePlan(i) {
  require("./videoxx-auth").notePlanLimit(i);
  if (!i || typeof i !== "object") return;
  const u =
    typeof i.utilization === "number" && isFinite(i.utilization)
      ? Math.max(0, Math.min(1, i.utilization > 1 ? i.utilization / 100 : i.utilization))
      : null;
  const r = +i.resetsAt > 0 ? (+i.resetsAt < 1e12 ? +i.resetsAt * 1e3 : +i.resetsAt) : null;
  planLimit = { type: i.rateLimitType ?? null, utilization: u, resetsAt: r, status: String(i.status ?? "allowed"), at: Date.now() };
}
const modelWindows = new Map();
const AMBER_AT = Math.round(COMPACT_WINDOW * 0.85);
const usageBase = () => ({ compactAt: COMPACT_WINDOW, amberAt: AMBER_AT, plan: planLimit });
const sumsOf = (r) => ({
  input: +r?.input || 0,
  cacheRead: +r?.cacheRead || 0,
  cacheWrite: +r?.cacheWrite || 0,
  output: +r?.output || 0,
  images: +r?.images || 0,
  turns: +r?.turns || 0,
});
const SUMS =
  "COALESCE(SUM(t.input),0) input, COALESCE(SUM(t.cache_read),0) cacheRead, COALESCE(SUM(t.cache_write),0) cacheWrite, COALESCE(SUM(t.output),0) output, COALESCE(SUM(t.images),0) images, COUNT(t.n) turns";
function sessionTotals(sessionId) {
  if (!sessionId) return null;
  const r = q.get(
    `SELECT ${SUMS}, COUNT(DISTINCT t.edit_id) runs FROM claude_turns t JOIN edits e ON e.id=t.edit_id WHERE e.session_id=?`,
    sessionId,
  );
  return r && +r.turns ? { ...sumsOf(r), runs: +r.runs || 0 } : null;
}
export function contextUsage(projectId) {
  const live = [...running.values()].find((t) => t.projectId === projectId && t.usage);
  if (live?.usage) {
    const u = live.usage();
    if (u.hasData) return u;
  }
  const th = projectThread(projectId);
  const none = {
    hasData: false,
    live: !!live,
    separate: false,
    context: null,
    window: null,
    model: null,
    run: null,
    conversation: null,
    cacheHit: null,
    freshNext: false,
    ...usageBase(),
  };
  if (!th) return none;
  const freshNext = startsFresh(th.context_tokens);
  const lastEdit = q.get(
    "SELECT e.id FROM edits e WHERE e.session_id=? AND EXISTS (SELECT 1 FROM claude_turns t WHERE t.edit_id=e.id) ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1",
    th.claude_session_id,
  );
  const last2 = lastEdit ? q.get("SELECT * FROM claude_turns WHERE edit_id=? AND agent=0 ORDER BY n DESC LIMIT 1", lastEdit.id) : null;
  if (!last2) return +th.context_tokens > 0 ? { ...none, hasData: true, context: +th.context_tokens, freshNext } : { ...none, freshNext };
  const ctx = last2.input + last2.cache_read + last2.cache_write;
  const run = sumsOf(q.get(`SELECT ${SUMS} FROM claude_turns t WHERE t.edit_id=?`, lastEdit.id));
  return {
    ...none,
    hasData: true,
    context: ctx,
    model: last2.model ?? null,
    window: last2.model ? (modelWindows.get(last2.model) ?? null) : null,
    run,
    conversation: sessionTotals(th.claude_session_id),
    cacheHit: ctx ? last2.cache_read / ctx : null,
    freshNext,
  };
}
let fake = null;
export function testFakeClaude(cfg) {
  if (process.env.CZ_TEST_HOOKS !== "1") return null;
  const calls = fake?.calls ?? [];
  fake = cfg
    ? {
        calls,
        context: Math.max(0, +(cfg.context ?? 2e4)),
        holdMs: Math.min(6e4, Math.max(0, +(cfg.holdMs ?? 0))),
        steps: Array.isArray(cfg.steps) ? cfg.steps.slice(0, 60) : [],
        imageBudget: cfg.imageBudget ? Math.max(1, +cfg.imageBudget) : null,
        plan: typeof cfg.plan === "number" ? cfg.plan : null,
        window: cfg.window ? +cfg.window : null,
        critic: cfg.critic == null ? null : Array.isArray(cfg.critic) ? cfg.critic.slice(0, 20) : cfg.critic,
        target: typeof cfg.target === "string" && cfg.target ? cfg.target : null,
      }
    : null;
  if (!cfg) {
    planLimit = null;
    modelWindows.clear();
  }
  return calls;
}
export const testTargetStub = () => (process.env.CZ_TEST_HOOKS === "1" ? (fake?.target ?? null) : null);
export async function testCriticAnswer(call, signal) {
  if (!fake) return void 0;
  if (!fake.critic) throw new Error("The test stand-in for Claude has no critic answer (test:fakeClaude { critic }).");
  fake.calls.push({ critic: true, ...call });
  if (fake.holdMs)
    await new Promise((res, rej) => {
      const t = setTimeout(res, fake.holdMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          rej(new Error("aborted"));
        },
        { once: true },
      );
    });
  if (signal?.aborted) throw new Error("aborted");
  const c = fake.critic;
  return Array.isArray(c) ? (c.length > 1 ? c.shift() : c[0]) : c;
}
export const testEditTools = (editId) => {
  const r = q.get("SELECT tool_usage FROM edits WHERE id=?", editId);
  let line = "";
  try {
    line =
      fs
        .readFileSync(logPath(), "utf8")
        .split("\n")
        .reverse()
        .find((l) => l.includes("usage tools") && l.includes(editId)) ?? "";
  } catch {}
  return { tools: r?.tool_usage ? JSON.parse(r.tool_usage) : null, logLine: line };
};
export const testClaudeTurns = (editId) => q.all("SELECT * FROM claude_turns WHERE edit_id=? ORDER BY n", editId);
function fakeQuery({ prompt, options }, defs = []) {
  const f = fake;
  return (async function* () {
    const first = await prompt[Symbol.asyncIterator]().next();
    const content = first.value?.message?.content || [];
    const sid = options.resume || `fake-${uid("")}`,
      model = options.model || "claude-fake";
    const ac = new AbortController(),
      asked = new Promise((res) =>
        setTimeout(() => {
          res("ask");
          ac.abort();
        }, 400),
      );
    const agents = await Promise.race([
      options.canUseTool?.("Agent", { description: "test", prompt: "test" }, { signal: ac.signal }).then(
        (d) => d.behavior,
        () => "error",
      ),
      asked,
    ]);
    const call = {
      projectCwd: options.cwd ?? null,
      effort: options.effort ?? null,
      maxTurns: options.maxTurns ?? null,
      append: options.systemPrompt?.append ?? "",
      resume: options.resume ?? null,
      sessionId: sid,
      model,
      disallowed: options.disallowedTools ?? [],
      agents,
      compactWindow: options.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? null,
      steps: [],
      tools: defs.map((d) => d.name),
      schemaProblems: schemaProblems(defs),
      text: content
        .filter((b2) => b2.type === "text")
        .map((b2) => b2.text)
        .join("\n"),
      images: content.filter((b2) => b2.type === "image").length,
    };
    f.calls.push(call);
    const usage = (read, write) => ({
      input_tokens: 6,
      cache_read_input_tokens: read,
      cache_creation_input_tokens: write,
      output_tokens: 50,
    });
    const a = uid("msg_"),
      b = uid("msg_"),
      tu = uid("toolu_");
    yield { type: "system", subtype: "init", session_id: sid, model };
    for (const s of f.steps) {
      if (s.touch) {
        try {
          fs.appendFileSync(
            path.join(options.cwd, s.touch),
            `
// touched ${Date.now()}
`,
          );
        } catch {}
      }
      const id = uid("toolu_"),
        m = uid("msg_");
      if (s.compact) {
        const hooks = (options.hooks?.SessionStart ?? []).filter((x) => new RegExp(`^(${x.matcher})$`).test("compact"));
        let ctx = "";
        for (const hk of hooks)
          for (const fn of hk.hooks) {
            const o = await fn({ hook_event_name: "SessionStart", source: "compact" });
            ctx += o?.hookSpecificOutput?.additionalContext ?? "";
          }
        call.steps.push({ compact: true, afterCompact: ctx });
        yield {
          type: "system",
          subtype: "compact_boundary",
          session_id: sid,
          compact_metadata: { trigger: "auto", pre_tokens: s.compact, post_tokens: 9e3 },
        };
        continue;
      }
      if (s.read) {
        const hooks = (options.hooks?.PreToolUse ?? []).filter((x) => new RegExp(`^(${x.matcher})$`).test("Read"));
        let deny = "";
        for (const hk of hooks)
          for (const fn of hk.hooks) {
            const o = await fn({ tool_name: "Read", tool_input: { file_path: s.read } });
            if (o?.hookSpecificOutput?.permissionDecision === "deny") deny = o.hookSpecificOutput.permissionDecisionReason;
          }
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          message: { id: m, model, content: [{ type: "tool_use", id, name: "Read", input: { file_path: s.read } }], usage: usage(0, 0) },
        };
        call.steps.push({ read: s.read, denied: deny || null });
        continue;
      }
      if (s.use) {
        const name = String(s.use.name),
          input = s.use.input ?? {};
        let decision = "allow",
          reason = "";
        if ((options.disallowedTools ?? []).includes(name)) {
          decision = "refused";
          reason = "not available (disallowedTools)";
        } else {
          for (const hk of (options.hooks?.PreToolUse ?? []).filter((x) => new RegExp(`^(${x.matcher})$`).test(name)))
            for (const fn of hk.hooks) {
              const o = await fn({ hook_event_name: "PreToolUse", tool_name: name, tool_input: input });
              if (o?.hookSpecificOutput?.permissionDecision === "deny") {
                decision = "deny";
                reason ||= o.hookSpecificOutput.permissionDecisionReason;
              }
            }
          if (decision === "allow" && options.canUseTool) {
            const ac2 = new AbortController(),
              wait = new Promise((res2) =>
                setTimeout(() => {
                  res2({ behavior: "ask" });
                  ac2.abort();
                }, 2e3),
              );
            const d2 = await Promise.race([options.canUseTool(name, input, { signal: ac2.signal }), wait]);
            if (d2?.behavior !== "allow") {
              decision = d2?.behavior === "ask" ? "ask" : "deny";
              reason = d2?.message || reason;
            }
          }
        }
        if (decision === "allow" && name === "Write" && input.file_path) {
          const f2 = path.resolve(options.cwd, String(input.file_path));
          fs.mkdirSync(path.dirname(f2), { recursive: true });
          fs.writeFileSync(f2, String(input.content ?? ""));
        }
        if (decision === "allow" && name === "Edit" && input.file_path) {
          const f2 = path.resolve(options.cwd, String(input.file_path));
          let s2 = "";
          try {
            s2 = fs.readFileSync(f2, "utf8");
          } catch {}
          if (input.old_string && s2.includes(String(input.old_string)))
            fs.writeFileSync(
              f2,
              s2.replace(String(input.old_string), () => String(input.new_string ?? "")),
            );
          else {
            decision = "error";
            reason = "old_string not found";
          }
        }
        yield {
          type: "assistant",
          parent_tool_use_id: null,
          message: { id: m, model, content: [{ type: "tool_use", id, name, input }], usage: usage(0, 0) },
        };
        call.steps.push({ use: name, target: String(input.file_path ?? input.command ?? ""), decision, reason });
        continue;
      }
      const d = defs.find((x) => x.name === s.tool);
      if (!d) {
        call.steps.push({ tool: s.tool, error: "no such tool" });
        continue;
      }
      yield {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          id: m,
          model,
          content: [{ type: "tool_use", id, name: `mcp__suite__${s.tool}`, input: s.input ?? {} }],
          usage: usage(0, 0),
        },
      };
      const res = await d.handler(s.input ?? {}).catch((err) => ({ content: [{ type: "text", text: "ERROR " + err?.message }] }));
      call.steps.push({
        tool: s.tool,
        texts: (res.content || []).filter((c) => c.type === "text").map((c) => c.text),
        images: (res.content || []).filter((c) => c.type === "image").length,
      });
      yield {
        type: "user",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: id,
              content: (res.content || []).map((c) =>
                c.type === "image" ? { type: "image", source: { type: "base64", media_type: c.mimeType, data: "" } } : c,
              ),
            },
          ],
        },
      };
    }
    yield {
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "message_start",
        message: { id: a, model, usage: usage(options.resume ? f.context - 2e3 : 0, options.resume ? 2e3 : 18e3) },
      },
    };
    yield {
      type: "assistant",
      parent_tool_use_id: null,
      message: { id: a, model, content: [{ type: "tool_use", id: tu, name: "mcp__suite__check_preview", input: {} }], usage: usage(0, 0) },
    };
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: tu,
            content: [
              { type: "text", text: "Loaded cleanly." },
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "" } },
            ],
          },
        ],
      },
    };
    if (f.plan !== null)
      yield {
        type: "rate_limit_event",
        session_id: sid,
        rate_limit_info: {
          status: f.plan >= 0.8 ? "allowed_warning" : "allowed",
          rateLimitType: "five_hour",
          utilization: f.plan,
          resetsAt: Math.floor(Date.now() / 1e3) + 7200,
        },
      };
    yield {
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "message_start", message: { id: b, model, usage: usage(options.resume ? f.context : 18e3, 600) } },
    };
    if (f.holdMs)
      await new Promise((res, rej) => {
        const t = setTimeout(res, f.holdMs),
          sig = options.abortController?.signal;
        if (sig?.aborted) {
          clearTimeout(t);
          rej(new Error("aborted"));
        } else
          sig?.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              rej(new Error("aborted"));
            },
            { once: true },
          );
      });
    yield {
      type: "assistant",
      parent_tool_use_id: null,
      message: { id: b, model, content: [{ type: "text", text: "Done (test stand-in, no Claude)." }], usage: usage(0, 0) },
    };
    yield {
      type: "result",
      subtype: "success",
      total_cost_usd: 0,
      usage: usage(f.context, 2600),
      ...(f.window ? { modelUsage: { [model]: { contextWindow: f.window } } } : {}),
    };
  })();
}
export async function* isolatedRun(o) {
  const exe = fake ? "claude-test-stand-in" : claudeExecutable();
  if (!exe) throw new Error(NO_CLAUDE);
  await startGate();
  const { query, createSdkMcpServer, tool } = await loadSdk();
  const server = createSdkMcpServer({
    name: "suite",
    version: "1.0.0",
    alwaysLoad: true,
    tools: o.defs.map((d) => tool(d.name, d.description, d.schema, d.handler)),
  });
  let release = () => {};
  const hold = new Promise((res) => {
    release = res;
  });
  o.abort.signal.addEventListener("abort", () => release(), { once: true });
  async function* input() {
    yield {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: o.prompt }] },
      parent_tool_use_id: null,
      session_id: "",
    };
    await hold;
  }
  const stream = (fake ? (a) => fakeQuery(a, o.defs) : query)({
    prompt: input(),
    options: {
      cwd: o.cwd,
      pathToClaudeCodeExecutable: exe,
      env: cleanEnv(),
      abortController: o.abort,
      model: o.model,
      maxTurns: o.maxTurns,
      effort: o.effort,
      settingSources: [],
      systemPrompt: { type: "preset", preset: "claude_code", append: o.append },
      mcpServers: { suite: server },
      strictMcpConfig: true,
      permissionMode: "default",
      canUseTool: o.canUseTool,
      hooks: o.hooks,
      disallowedTools: o.disallowedTools,
    },
  });
  try {
    for await (const m of stream) {
      yield m;
      if (m.type === "result") release();
    }
  } finally {
    release();
  }
}
const NO_IMAGE_KEY =
  "Vox videos and custom styles make their pictures on your own Higgsfield or Fal.ai account (about a cent per picture), so they need a Higgsfield or Fal.ai API key first. Add one in Settings > Media > Image generation, then start again.";
let audioBusy = () => null;
export const setAudioBusyCheck = (f) => {
  audioBusy = f;
};
export function projectClaude(p) {
  const row = typeof p === "string" ? getProject(p) : p,
    cfg = getConfig().claude;
  const model = isModelId(row.claude_model) ? row.claude_model : null,
    effort = isEffort(row.claude_effort) ? row.claude_effort : null;
  return {
    model,
    effort,
    globalModel: cfg.model || null,
    globalEffort: cfg.effort || "medium",
    effective: { model: model || cfg.model || null, effort: effort || cfg.effort || "medium" },
  };
}
const atLeastHigh = (e) => (e === "xhigh" || e === "max" ? e : "high");
export function setProjectClaude(projectId, v) {
  getProject(projectId);
  if (v.model !== void 0) {
    if (v.model && !isModelId(v.model)) throw new Error("That model is not one the app offers.");
    if (v.model) checkEngineModel(v.model);
    q.run("UPDATE projects SET claude_model=? WHERE id=?", v.model || null, projectId);
  }
  if (v.effort !== void 0) {
    if (v.effort && !isEffort(v.effort)) throw new Error("That effort level is not one the app offers.");
    q.run("UPDATE projects SET claude_effort=? WHERE id=?", v.effort || null, projectId);
  }
  return projectClaude(projectId);
}
export async function runTask(r, emit) {
  const cfg = getConfig().claude;
  const project = getProject(r.projectId),
    personal = project.kind === "personal";
  const own = projectClaude(project);
  const harvest = r.kind === "harvest";
  if (harvest && personal) throw new Error("Personal videos have nothing to harvest.");
  const studioWs = personal || harvest ? null : studioOf(r.projectId);
  if (r.kind === "studio" && !studioWs) throw new Error("This project is not a Style Studio workspace.");
  if (studioWs && !STUDIO_KINDS.has(r.kind))
    throw new Error("A Style Studio workspace runs its stages (and chat edits and questions), not video builds.");
  const studioStage = studioWs ? studioWs.studio.stage : null;
  if (r.kind === "studio" && r.studio?.stage && r.studio.stage !== studioStage)
    throw new Error(`The workspace is at the ${studioStage} stage, not ${String(r.studio.stage).slice(0, 20)}.`);
  if (r.kind !== "ask" && !harvest) {
    const why = audioBusy(r.projectId, project.path);
    if (why) throw new Error(why);
  }
  const exe = fake ? "claude-test-stand-in" : claudeExecutable();
  if (
    !personal &&
    (r.kind === "build" || (r.kind === "studio" && ["guide", "kit", "sample", "review", "look"].includes(String(studioStage)))) &&
    needsImageKey(project.style_id) &&
    !hasImageKey(r.projectId)
  )
    throw new Error(NO_IMAGE_KEY);
  if (!harvest) {
    const bg = [...running.entries()].filter(([, t]) => t.projectId === r.projectId && t.kind === "harvest");
    if (bg.length) {
      for (const [id] of bg) stopTask(id);
      for (
        const t0 = Date.now();
        Date.now() - t0 < 15e3 && [...running.values()].some((t) => t.projectId === r.projectId && t.kind === "harvest");
      )
        await new Promise((res) => setTimeout(res, 100));
      log("task", r.kind, "stopped the Library harvest of", r.projectId, "first");
    }
  }
  if ([...running.values()].some((t) => t.projectId === r.projectId))
    throw new Error("Claude is already working on this project. Wait for it to finish or press Stop.");
  let toLang = r.kind === "script" && !personal && r.language ? langCode(r.language) : null;
  if (r.kind === "script" && !personal && r.language && !toLang) throw new Error("That language is not one the app offers.");
  if (toLang) assertDraws(project.style_id, toLang);
  if (r.kind === "ultra" && (personal || !ultraTargets(r.projectId, r.shots).size))
    throw new Error("There are no shots to upgrade yet: build the video first.");
  if (r.kind === "ultra") {
    if (r.model && !isClaudeModelId(r.model)) throw new Error("That model is not one the app offers.");
    if (r.effort && !isEffort(r.effort)) throw new Error("That effort level is not one the app offers.");
    const m = Number(r.ultraMinutes);
    r.ultraMinutes = r.extras?.includes("ultraplus") && Number.isFinite(m) && m > 0 ? Math.min(60, Math.max(0.5, m)) : null;
    ultraClockReset(r.projectId, r.ultraMinutes);
  }
  const ultraExtras = r.kind === "build" && !!(r.extras?.includes("ultra") || r.extras?.includes("ultraplus"));
  const wantModel = harvest
    ? HARVEST_MODEL
    : studioWs
      ? STUDIO_MODEL
      : r.model
        ? r.model
        : r.kind === "ultra" || ultraExtras
          ? own.model || ULTRA_MODEL
          : r.kind === "character"
            ? "claude-opus-5-5"
            : r.kind === "cut" || r.kind === "intro" || (personal && r.kind === "edit")
              ? WORKFLOW_MODELS.includes(cfg.workflowModel) || (engineOf(cfg.workflowModel) !== "claude" && isModelId(cfg.workflowModel))
                ? cfg.workflowModel
                : "claude-opus-5-5"
              : own.model || cfg.model || void 0;
  const taskId = uid("tsk_"),
    editId = uid("edt_");
  let preAbort = null,
    route;
  if (needsProxyStart(wantModel)) {
    preAbort = new AbortController();
    running.set(taskId, {
      abort: preAbort,
      editId,
      threadId: "",
      projectId: r.projectId,
      kind: r.kind,
      pending: new Map(),
      asks: new Map(),
      startedAt: Date.now(),
      model: null,
    });
    const text = "Starting Google models… (CLIProxyAPI; the first time it also downloads it). Stop ends the wait.";
    try {
      emit({ taskId, threadId: null, editId, projectId: r.projectId, type: "starting", kind: r.kind, text });
    } catch {}
    log("task", r.kind, "waiting for the Google models proxy to start");
    try {
      route = await resolveEngine(r.kind, wantModel, { ultraExtras, signal: preAbort.signal });
    } catch (err) {
      running.delete(taskId);
      throw new Error(preAbort.signal.aborted ? "Stopped before Google models had started." : err?.message || String(err));
    }
    running.delete(taskId);
    if (preAbort.signal.aborted) throw new Error("Stopped before Google models had started.");
  } else route = await resolveEngine(r.kind, wantModel, { ultraExtras });
  const other = route.engine !== "claude",
    codex = route.engine === "codex";
  if (!exe && !codex) throw new Error(NO_CLAUDE);
  let threadId = harvest
      ? (q.get("SELECT id FROM threads WHERE project_id=? AND kind='harvest' ORDER BY updated_at DESC LIMIT 1", r.projectId)?.id ?? null)
      : r.newSession
        ? null
        : (r.threadId ?? projectThread(r.projectId)?.id ?? null),
    resume;
  let fresh = null;
  if (threadId && !harvest) {
    const th = q.get("SELECT * FROM threads WHERE id=? AND project_id=?", threadId, r.projectId);
    if (!th) threadId = null;
    else resume = th.claude_session_id && sessionExists(th.claude_session_id, th.engine) ? th.claude_session_id : void 0;
    if (th && resume && r.kind !== "ultra" && th.engine !== "codex" && route.engine !== "codex" && startsFresh(th.context_tokens)) {
      fresh = { tokens: +th.context_tokens, seed: recentWork(r.projectId) };
      resume = void 0;
    } else if (th && resume && r.kind !== "ultra" && (th.engine || "claude") !== route.engine) {
      fresh = { tokens: +th.context_tokens || 0, seed: recentWork(r.projectId), engineFrom: th.engine || "claude" };
      resume = void 0;
    }
  }
  const sdkResume = r.kind === "ultra" || harvest ? void 0 : resume;
  if (!threadId) {
    threadId = uid("thr_");
    q.run(
      "INSERT INTO threads(id,project_id,title,kind,created_at,updated_at,engine) VALUES(?,?,?,?,?,?,?)",
      threadId,
      r.projectId,
      (harvest
        ? HARVEST_THREAD
        : r.kind === "studio"
          ? `Style Studio: ${studioStage}`
          : r.kind === "build"
            ? "Build video"
            : r.kind === "ultra"
              ? "Ultraedit"
              : r.kind === "reframe"
                ? "Reframe for 9:16"
                : r.kind === "character"
                  ? "Design the character"
                  : r.kind === "script"
                    ? "Write the script"
                    : r.kind === "cut"
                      ? "Cut the footage"
                      : r.kind === "intro"
                        ? "Edit the intro"
                        : r.instruction
      ).slice(0, 90) || "Edit",
      r.kind,
      now(),
      now(),
      other ? route.engine : null,
    );
  }
  const abort = preAbort ?? new AbortController();
  const started = Date.now();
  const task = {
    abort,
    editId,
    threadId,
    projectId: r.projectId,
    kind: r.kind,
    pending: new Map(),
    asks: new Map(),
    startedAt: started,
    model: null,
    engine: route.engine,
  };
  running.set(taskId, task);
  const e = (ev) => emit({ taskId, threadId, editId, projectId: r.projectId, ...ev });
  const cmpDir = path.join(project.path, ".suite", "edits");
  try {
    q.run(
      "INSERT INTO edits(id,project_id,thread_id,instruction,scope,selection,status,created_at,kind,engine) VALUES(?,?,?,?,?,?,?,?,?,?)",
      editId,
      r.projectId,
      threadId,
      harvest
        ? String(r.label || "Library harvest").slice(0, 300)
        : r.kind === "cut" || r.kind === "intro"
          ? `${r.kind === "cut" ? "Cut the footage" : "Edit the intro"}${r.instruction ? ": " + r.instruction : ""}`
          : r.kind === "character"
            ? `Design the character: ${r.instruction}`.slice(0, 300)
            : r.kind === "ultra"
              ? `Ultraedit${r.shots?.length ? ` (${r.shots.length} shot${r.shots.length === 1 ? "" : "s"})` : " (every shot)"}${r.instruction ? ": " + r.instruction : ""}`.slice(
                  0,
                  300,
                )
              : hideTimeLimit(r.instruction || "") ||
                (r.kind === "studio"
                  ? `Style Studio: ${studioStage}${r.studio?.fix ? " (fix round)" : ""}`
                  : r.kind === "build"
                    ? "Build video"
                    : r.kind === "script"
                      ? "Write the script"
                      : ""),
      r.scope ?? null,
      JSON.stringify(r.selection ?? []),
      "running",
      now(),
      r.kind,
      other ? route.engine : null,
    );
    addMsg(threadId, "user", {
      text: harvest ? String(r.label || "Library harvest") : r.instruction,
      selection: r.selection ?? [],
      scope: r.scope,
      kind: r.kind,
      hasFrame: !!r.frame,
      images: r.images?.length ?? 0,
    });
    if (typeof r.time === "number" && r.kind === "edit") {
      fs.mkdirSync(cmpDir, { recursive: true });
      try {
        const [s] = await renderStills(r.projectId, [r.time], 0.5, `edit-${editId}-b`);
        fs.copyFileSync(s.file, path.join(cmpDir, `${editId}-before.jpg`));
        fs.rmSync(path.dirname(s.file), { recursive: true, force: true });
      } catch {
        const img = r.beforeFrame || r.frame;
        if (img?.startsWith("data:image/"))
          fs.writeFileSync(path.join(cmpDir, `${editId}-before.jpg`), Buffer.from(img.split(",")[1], "base64"));
      }
      fs.writeFileSync(path.join(cmpDir, `${editId}.json`), JSON.stringify({ time: r.time }));
    }
    e({ type: "started", kind: r.kind, engine: route.engine });
    if (route.note) {
      addMsg(threadId, "note", { text: route.note, warn: !!route.fallback });
      e({ type: "note", text: route.note, warn: !!route.fallback });
      log("task", r.kind, "engine fallback:", route.note);
    }
    if (fresh) {
      const text = fresh.engineFrom
        ? `Started a fresh conversation: this request runs on ${other ? modelName(wantModel ?? null) : `Claude (${modelName(route.model ?? null)})`}, and a conversation can't move between engines. It got a list of the earlier edits and reads the project's own notes (its progress file, CLAUDE.md and storyboard) first; every edit can still be reverted.`
        : `Started a fresh conversation: the last one had reached about ${Math.round(fresh.tokens / 1e3)}k tokens, the point where Claude summarises it anyway. Claude got a list of the earlier edits and reads the project's own notes (its progress file, CLAUDE.md and storyboard) first; every edit can still be reverted.`;
      addMsg(threadId, "note", { text });
      e({ type: "note", text });
      log(
        "task",
        r.kind,
        "fresh conversation:",
        fresh.engineFrom ? `engine ${fresh.engineFrom} -> ${route.engine}` : `the last one had ${fresh.tokens} tokens`,
      );
    }
  } catch (err) {
    running.delete(taskId);
    try {
      q.run("UPDATE edits SET status='failed', finished_at=? WHERE id=? AND status='running'", now(), editId);
    } catch {}
    throw err;
  }
  (async () => {
    let before = null,
      summary = "",
      status = "done",
      cost = 0,
      tin = 0,
      tout = 0,
      errMsg = "";
    const turns = new Map(),
      lastTurn = new Map();
    const toolCalls = new Map();
    let ledger;
    let pendingImages = (r.frame?.startsWith("data:image/") ? 1 : 0) + Math.min(4, r.images?.length ?? 0),
      results = 0;
    const turnOf = (id, model, agent, u) => {
      let t = turns.get(id);
      if (!t) {
        t = {
          n: turns.size + 1,
          at: now(),
          model,
          agent: agent ? 1 : 0,
          wake: results > 0 ? 1 : 0,
          input: 0,
          cache_read: 0,
          cache_write: 0,
          output: 0,
          images: pendingImages,
        };
        pendingImages = 0;
        turns.set(id, t);
      }
      const first = !t.input && !t.cache_read && !t.cache_write;
      if (u) {
        t.input = Math.max(t.input, +u.input_tokens || 0);
        t.cache_read = Math.max(t.cache_read, +u.cache_read_input_tokens || 0);
        t.cache_write = Math.max(t.cache_write, +u.cache_creation_input_tokens || 0);
        t.output = Math.max(t.output, +u.output_tokens || 0);
      }
      if (first && (t.cache_read || t.cache_write) && (t.wake || t.cache_write >= 2e4))
        log(
          "usage turn",
          editId,
          r.kind,
          `#${t.n}`,
          t.agent ? "agent" : "main",
          t.wake ? "WAKE-UP after a result" : "",
          "cache read",
          t.cache_read,
          "cache write",
          t.cache_write,
          "input",
          t.input,
          "images",
          t.images,
        );
      pushUsage();
      return t;
    };
    let convBase = null,
      usageTimer = null;
    const liveUsage = () => {
      const list = [...turns.values()],
        main = list.filter((t) => !t.agent),
        last2 = main[main.length - 1];
      const sum = (k) => list.reduce((a, t) => a + t[k], 0);
      const run = {
        input: sum("input"),
        cacheRead: sum("cache_read"),
        cacheWrite: sum("cache_write"),
        output: sum("output"),
        images: sum("images"),
        turns: list.length,
      };
      const ctx = last2 ? last2.input + last2.cache_read + last2.cache_write : 0,
        b = convBase;
      const model = last2?.model ?? task.model;
      return {
        hasData: !!last2 && ctx > 0,
        live: true,
        separate: r.kind === "ultra",
        context: last2 ? ctx : null,
        model,
        window: model ? (modelWindows.get(model) ?? null) : null,
        run,
        conversation: {
          input: (b?.input ?? 0) + run.input,
          cacheRead: (b?.cacheRead ?? 0) + run.cacheRead,
          cacheWrite: (b?.cacheWrite ?? 0) + run.cacheWrite,
          output: (b?.output ?? 0) + run.output,
          images: (b?.images ?? 0) + run.images,
          turns: (b?.turns ?? 0) + run.turns,
          runs: (b?.runs ?? 0) + 1,
        },
        cacheHit: ctx ? last2.cache_read / ctx : null,
        freshNext: false,
        ...usageBase(),
      };
    };
    task.usage = liveUsage;
    function pushUsage() {
      if (usageTimer) return;
      usageTimer = setTimeout(() => {
        usageTimer = null;
        if (running.has(taskId)) e({ type: "usage", usage: liveUsage() });
      }, 300);
    }
    const scriptNow = () => {
      try {
        return fs.readFileSync(path.join(project.path, "script.txt"), "utf8");
      } catch {
        return null;
      }
    };
    const scriptBefore = toLang ? scriptNow() : null;
    let language;
    try {
      let ctxBlock = null;
      if (personal) {
        writePersonalContext(r.projectId);
        ensurePersonalSkills(project.path);
      } else if (!harvest) ctxBlock = writeContext(r.projectId) ?? null;
      if (studioWs) {
        syncStudioDocs(project.path, studioWs.studio.base);
        if (r.kind === "studio") markStage(r.projectId, studioStage, "running");
      }
      if (
        codex &&
        writeAgentsMd(project.path, {
          system: harvest ? HARVEST_SYSTEM : studioWs ? studioSystem() : systemAppend(personal),
          block: ctxBlock,
          skill: personal ? null : getStyle(project.style_id).skill,
          personal,
        }) &&
        (r.kind === "ask" || harvest)
      ) {
        try {
          await snapshot(project.path, "ChatGPT instructions (AGENTS.md)");
        } catch (err) {
          log("task", "AGENTS.md not committed", err?.message);
        }
      }
      before = r.kind === "ask" || harvest ? null : await snapshot(project.path, `Before: ${r.instruction || r.kind}`);
      if (before) q.run("UPDATE edits SET commit_before=? WHERE id=?", before, editId);
      if (r.kind === "ultra") {
        e({
          type: "text",
          text: `Taking one still of ${r.shots?.length === 1 ? "the shot" : "each picked shot"} as it is now (the before picture).`,
          streamed: false,
        });
        try {
          await ultraFrames(r.projectId, cmpDir, editId, [...ultraTargets(r.projectId, r.shots).values()].flat(), "before");
        } catch (err) {
          log("ultra before frames failed", err?.message);
        }
      }
      const { query, createSdkMcpServer, tool } = await loadSdk();
      const pjm = (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(project.path, "project.json"), "utf8"));
        } catch {
          return {};
        }
      })();
      const sty = getStyle(personal ? null : project.style_id);
      const to =
        r.kind === "script" && !personal ? scriptLanguageOf(project.path, pjm, toLang) : { code: lang(pjm.language).code, scriptIn: null };
      const seconds = +pjm.end > 0 ? +pjm.end : pjm.targetLength || getConfig().video.length;
      const pace = !personal && baseOf(project.style_id) === "collage" ? visualPlan(seconds, pjm.settings?.pace?.perMinute) : null;
      if (pace && !(Number(pjm.imageBudget) >= pace.budget))
        try {
          pjm.imageBudget = pace.budget;
          fs.writeFileSync(path.join(project.path, "project.json"), JSON.stringify(pjm, null, 1));
        } catch {}
      const meta = {
        pace,
        seconds,
        targetLength: pjm.targetLength || getConfig().video.length,
        topic: pjm.topic || "",
        styleBrief: sty.brief,
        skill: sty.skill,
        styleId: sty.id,
        language: to.code,
        scriptIn: to.scriptIn,
        narration: r.kind === "build" && !personal ? narrationLanguageOf(project.path, to.code) : null,
        lessons: r.kind === "script" ? approvedFor({ projectId: r.projectId }) : [],
        orig: pjm.reframeOf?.title || "",
        settings: pjm.settings || {},
        brand: personal ? "" : brandNote(baseOf(project.style_id), pjm.settings, engineBrand(project.path, project.style_id)),
      };
      if (toLang && toLang === lang(pjm.language).code) toLang = null;
      const shotCount =
        getShots(r.projectId).length ||
        (isToonCrew(project.style_id) ? toonShots(seconds) : isStickCrew(project.style_id) ? stickShots(seconds) : Math.ceil(seconds / 5));
      const ultraCount =
        (r.kind === "ultra"
          ? [...ultraTargets(r.projectId, r.shots).values()].flat().length
          : r.kind === "build" && (r.extras?.includes("ultra") || r.extras?.includes("ultraplus"))
            ? shotCount
            : 0) * (r.extras?.includes("ultraplus") ? 2 : 1);
      ledger = newLedger(
        fake?.imageBudget ??
          frameBudget(r.kind, shotCount, {
            ultraShots: ultraCount,
            verified: r.kind === "build" && !!r.extras?.includes("scenes"),
            recon:
              baseOf(project.style_id) === "recon" ||
              (r.kind === "build" &&
                (isPixelCrew(project.style_id) || isToonCrew(project.style_id) || isStickCrew(project.style_id)) &&
                crewOn(r.kind, project.style_id, project.path)),
          }),
        (l) => {
          const text = `Claude has looked at ${l.frames} frames in this run (about ${Math.round(l.spent / 1e3)}k tokens of pictures, which it re-reads at every later step). To protect your Claude usage it was asked to stop looking and finish with the text checks. If a moment still needs a look, ask for it in a new request.`;
          log("usage frame budget used up", editId, r.kind, l.frames, "frames", l.spent, "tokens of", l.budget);
          try {
            addMsg(threadId, "note", { text });
          } catch {}
          e({ type: "note", text });
        },
      );
      if (harvest) {
        ledger.budget = 0;
        ledger.over = true;
      }
      const defs = personal ? [] : harvest ? harvestToolDefs(r.projectId) : suiteToolDefs(r.projectId, r.selection ?? [], ledger);
      {
        const bad = schemaProblems(defs);
        if (bad.length) log("suite tool schemas Claude Code drops (no suite tools this run)", editId, bad.join("; "));
      }
      const server = createSdkMcpServer({
        name: "suite",
        version: "1.0.0",
        alwaysLoad: true,
        tools: defs.map((d) => tool(d.name, d.description, d.schema, d.handler)),
      });
      const append = harvest ? HARVEST_SYSTEM : studioWs ? studioSystem() : systemAppend(personal),
        context = harvest ? "" : runContext(r.projectId, personal);
      const libBlocks = personal || harvest ? {} : libraryBlocks(r.projectId, r.kind, r.instruction || "");
      const lead = [
        fresh
          ? `A fresh conversation: the earlier one with this project reached the summarise point. The files are the source of truth: read ${PROGRESS_FILE} (if it exists), CLAUDE.md and storyboard.md first. What was done here so far (oldest first):
${fresh.seed || "(no earlier edits)"}`
          : "",
        !context
          ? ""
          : sdkResume && sentContext.get(sdkResume) === context
            ? "(Style rules and shot list: unchanged since your last request.)"
            : context,
        libraryLead(libBlocks, sdkResume),
      ]
        .filter(Boolean)
        .join("\n\n");
      const crew =
        !codex &&
        !personal &&
        !harvest &&
        !studioWs &&
        crewOn(r.kind, project.style_id, project.path) &&
        !(r.kind === "ultra" && r.extras?.includes("ultraplus"));
      const procedure = () =>
        ultraProcedure(
          r.projectId,
          baseOf(project.style_id),
          r.shots,
          !!r.extras?.includes("ultraplus"),
          r.extras?.includes("ultraplus") ? r.ultraMinutes : null,
        );
      const baseTask = harvest
        ? r.instruction
        : personal
          ? personalPrompt(project, r.kind, r.instruction)
          : r.kind === "studio"
            ? studioPrompt(project.path, studioOf(r.projectId).studio, {
                stage: studioStage,
                instruction: r.instruction,
                issues: r.studio?.issues,
                fix: !!r.studio?.fix,
                review: !!r.studio?.review,
              })
            : r.kind === "character"
              ? characterPrompt(project.path, r.instruction)
              : r.kind === "ultra"
                ? `${crew ? crewUltraText(project.path, procedure()) : procedure()}
${progressNote("shot")}
User notes: ${r.instruction || "(none)"}`
                : buildPrompt(withExtras(r, baseOf(project.style_id)), cfg.autoVerify && r.kind === "edit", meta);
      const refBlock =
        personal || harvest
          ? ""
          : await referencesBlock(r.projectId, r.instruction || "", { onNote: (text) => e({ type: "text", text, streamed: false }) }).catch(
              (err) => {
                log("references block failed", err?.message);
                return "";
              },
            );
      const taskText = refBlock
        ? `${baseTask}

${refBlock}`
        : baseTask;
      const promptText = lead
        ? `${lead}

---

${taskText}`
        : taskText;
      const policy = getConfig().claude.permissions;
      const SAFE = new Set(["Read", "Glob", "Grep", "TodoWrite", "Skill", "LS", ...(AGENT_KINDS.has(r.kind) ? ["Task", "Agent"] : [])]);
      const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
      const canUseTool = async (toolName, input, opts) => {
        if (r.kind === "ask" && EDITS.has(toolName))
          return {
            behavior: "deny",
            message: "This was asked as a question, so edits are off. Answer it; the user can ask for the change as an edit.",
          };
        if (harvest)
          return HARVEST_TOOLS.has(toolName)
            ? { behavior: "allow", updatedInput: input }
            : {
                behavior: "deny",
                message: `A Library harvest only reads the project and proposes entries (Read, Glob, Grep, library_search, library_get, library_propose): no ${toolName}.`,
              };
        if (crew && (toolName === "Agent" || toolName === "Task"))
          return { behavior: "allow", updatedInput: { ...input, run_in_background: false } };
        const target = EDITS.has(toolName) ? String(input?.file_path ?? input?.notebook_path ?? "") : "";
        if (studioWs) {
          if (!toolName.startsWith("mcp__suite__") && !STUDIO_TOOLS.has(toolName))
            return {
              behavior: "deny",
              message: `The Style Studio has no ${toolName}: the app runs every render, check and analysis as a suite tool (studio_state lists them).`,
            };
          const why = EDITS.has(toolName)
            ? studioWriteCheck(project.path, { mode: studioWs.studio.mode, stage: studioStage }, target)
            : null;
          return why ? { behavior: "deny", message: why } : { behavior: "allow", updatedInput: input };
        }
        if (target && !insideDir(project.path, target))
          return {
            behavior: "deny",
            message: `Videoxx only allows edits inside this project folder (${project.path}). ${target} is outside it.`,
          };
        if (
          toolName.startsWith("mcp__suite__") ||
          SAFE.has(toolName) ||
          policy === "auto" ||
          r.auto ||
          (policy === "ask-commands" && EDITS.has(toolName))
        )
          return { behavior: "allow", updatedInput: input };
        const requestId = uid("perm_");
        const ask = { summary: toolSummary(toolName, input), input: JSON.stringify(input).slice(0, 600) };
        task.asks.set(requestId, ask);
        e({ type: "permission", requestId, tool: toolName, ...ask });
        const allow = await new Promise((res) => {
          task.pending.set(requestId, res);
          opts.signal.addEventListener("abort", () => res(false));
        });
        task.pending.delete(requestId);
        task.asks.delete(requestId);
        return allow
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "The user declined this action in Videoxx." };
      };
      const confine = async (input) => {
        const ti = input?.tool_input ?? {},
          target = String(ti.file_path ?? ti.notebook_path ?? "");
        if (r.kind === "ask" || harvest)
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: harvest ? "A Library harvest does not edit files." : "Questions do not edit files.",
            },
          };
        if (target && /[\\/]lib[\\/](contact|collide)\.js$/i.test(target))
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason:
                "lib/contact.js and lib/collide.js are the sign-off checks: fix the scene so it passes, never the check. If a finding is wrong, say so in your summary.",
            },
          };
        if (studioWs) {
          const why = studioWriteCheck(project.path, { mode: studioWs.studio.mode, stage: studioStage }, target);
          return why
            ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } }
            : {};
        }
        if (!target || insideDir(project.path, target)) return {};
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Videoxx only allows edits inside this project folder (${project.path}).`,
          },
        };
      };
      const readGate = async (input) => {
        const why = readImageCheck(ledger, project.path, String(input?.tool_input?.file_path ?? ""));
        return why
          ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } }
          : {};
      };
      const readOutside = async (input) => {
        const ti = input?.tool_input ?? {},
          target = String(ti.file_path ?? ti.path ?? "");
        const why = readOutsideCheck(project.path, target);
        if (why) log("read outside the project refused", r.kind, target);
        return why
          ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } }
          : {};
      };
      const afterCompact = async () => ({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: afterCompactText(
            [runContext(r.projectId, personal), libraryLead(libBlocks, null)].filter(Boolean).join("\n\n"),
            taskText,
          ),
        },
      });
      if (r.kind === "build" && baseOf(project.style_id) === "flat")
        await waitForCharacter(project.path, abort.signal, () =>
          e({
            type: "text",
            text: "Waiting for Claude to finish designing the main character; the build starts right after.",
            streamed: false,
          }),
        );
      if (abort.signal.aborted) throw new Error("aborted");
      if (crew) {
        const n = crewPool(project.style_id);
        setWorkerPool(r.projectId, n);
        log("crew build", editId, "pool", n);
      }
      const effortWanted = harvest
        ? HARVEST_EFFORT
        : studioWs
          ? atLeastHigh(own.effort)
          : r.effort
            ? r.effort
            : r.kind === "build" &&
                extrasFor(baseOf(project.style_id)).some((x) => !x.off && HIGH_EFFORT_EXTRAS.includes(x.key) && r.extras?.includes(x.key))
              ? atLeastHigh(own.effort)
              : r.kind === "script"
                ? own.effort || "medium"
                : r.kind === "cut" || r.kind === "intro" || r.kind === "character" || (personal && r.kind === "edit")
                  ? "high"
                  : own.effort || cfg.effort || "medium";
      let codexResume = sdkResume;
      for (let attempt = 0; ; attempt++) {
        await startGate();
        let release = () => {};
        const hold = new Promise((res) => {
          release = res;
        });
        abort.signal.addEventListener("abort", () => release(), { once: true });
        let background = new Set(),
          idle = false,
          bgSeen = Date.now();
        let idleTimer = null;
        const settle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = null;
          if (!idle) return;
          if (!background.size) {
            idleTimer = setTimeout(() => {
              if (idle && !background.size) release();
            }, 3e3);
            return;
          }
          const silent = crew ? 10 * 6e4 : 9e4;
          idleTimer = setTimeout(function check() {
            if (!idle) return;
            if (!background.size || Date.now() - bgSeen > silent) {
              log("task", r.kind, `closing: background work silent for ${Math.round(silent / 1e3)} s`);
              release();
            } else idleTimer = setTimeout(check, 1e4);
          }, 1e4);
        };
        const stream = codex
          ? runCodex({
              projectDir: project.path,
              projectId: r.projectId,
              kind: r.kind,
              model: route.model,
              effort: effortWanted,
              prompt: promptText,
              frame: r.frame,
              time: r.time,
              images: r.images,
              resume: codexResume,
              signal: abort.signal,
              tools: !personal && !harvest,
              selection: r.selection ?? [],
              ledger,
              env: personal ? personalEnv(project, r.kind) : void 0,
              inside: (pth) => insideDir(project.path, pth),
            })
          : (fake ? (a) => fakeQuery(a, defs) : query)({
              prompt: userMessage(promptText, r.frame, r.images, r.time, hold),
              options: {
                // COMPACT_WINDOW: Claude Code summarises the conversation once it reaches this size. Opus 5.5 can hold ~1M tokens,
                // so a long build kept growing and every step late in it re-read 0.5-1M tokens (a third of a Max plan in two minutes
                // of frame checks). At COMPACT_WINDOW (500k) a whole build keeps its working context and a step stays under ~500k
                // (a Google model: the same Claude Code, pointed at the local proxy with its key and no Claude credential: engines/route.ts)
                // (a pixel crew launches every chapter's agent in one message: crewEnv lets Claude Code run them all at once)
                cwd: project.path,
                pathToClaudeCodeExecutable: exe,
                env: engineEnv(
                  {
                    ...(personal ? { ...cleanEnv(), ...personalEnv(project, r.kind) } : cleanEnv()),
                    CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(COMPACT_WINDOW),
                    ...(crew ? crewEnv(project.style_id) : {}),
                  },
                  route,
                ),
                abortController: abort,
                // the Personal Brand workflows run on Opus at high effort: every cut is an editorial judgement over the whole transcript
                // a change request on a Personal cut re-runs the skill's pipeline (re-render + every gate): workflow grade too
                // a character is designed on Opus: it stars in every video the user makes, and the design is an art-direction call
                // Ultraedit (alone or as a build extra) runs on Opus 5.5
                // otherwise: this project's own model (its Claude panel), else the global one (Settings)
                // a Style Studio workspace: Opus for every run (stages, chat edits, questions)
                // a Library harvest: Opus 5.5 at medium effort, 25 turns, a fresh session every time
                // (all of that is wantModel above; route.model is it, bare for another engine, or the Claude fallback)
                model: route.model,
                resume: sdkResume,
                maxTurns: harvest
                  ? HARVEST_TURNS
                  : r.kind === "build" ||
                      r.kind === "studio" ||
                      r.kind === "ultra" ||
                      r.kind === "reframe" ||
                      r.kind === "cut" ||
                      r.kind === "intro" ||
                      r.kind === "character"
                    ? 400
                    : personal && r.kind === "edit"
                      ? 250
                      : cfg.maxTurns,
                // (a project's own effort, picked in New project or Project settings, counts for the script and the build too;
                // high-effort extras only ever raise it)
                // (another engine: no effort; the proxy maps thinking itself, and Claude's effort levels mean nothing to it)
                effort: other ? void 0 : effortWanted,
                // project settings only: the user's own hooks, personal skills and CLAUDE.md are opt-in (Settings > Sessions), so a
                // hook or a skill that claims video work can't steer Suite edits. The project carries its style's skill.
                settingSources: cfg.userMcp ? ["user", "project", "local"] : ["project", "local"],
                systemPrompt: { type: "preset", preset: "claude_code", append },
                // strict = only the Suite's tools: connectors (mail, drive, ...) would join mid-session, bust the prompt cache and widen access
                mcpServers: personal ? {} : { suite: server },
                strictMcpConfig: !cfg.userMcp,
                permissionMode: "default",
                canUseTool,
                includePartialMessages: true,
                hooks: {
                  PreToolUse: [
                    { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [confine] },
                    ...(personal ? [] : [{ matcher: "Read|Grep|Glob", hooks: [readOutside] }]),
                    { matcher: "Read", hooks: [readGate] },
                  ],
                  SessionStart: [{ matcher: "compact", hooks: [afterCompact] }],
                },
                // Ultraedit works shot by shot in the foreground (its own session, never resumed: the tool list may differ)
                ...(crew
                  ? {
                      agents: crewAgents(getConfig().tools.python || "python", project.style_id, {
                        skill: sty.skill,
                        hibit: pjm.settings?.color?.palette === "hibit",
                      }),
                    }
                  : {}),
                ...(harvest
                  ? { disallowedTools: HARVEST_DISALLOWED }
                  : studioWs
                    ? { disallowedTools: STUDIO_DISALLOWED }
                    : r.kind === "ultra" && !crew
                      ? { disallowedTools: ["Task", "Agent"] }
                      : {}),
              },
              // cwd = this project; file edits are confined to it by canUseTool
            });
        let sawText = false,
          worked = false,
          thrown = null;
        try {
          for await (const m of stream) {
            if (
              m.type === "system" &&
              ["background_tasks_changed", "task_started", "task_notification", "task_progress", "task_updated"].includes(m.subtype)
            )
              bgSeen = Date.now();
            if (
              m.type !== "result" &&
              !(
                m.type === "system" &&
                ["background_tasks_changed", "task_notification", "task_progress", "task_updated"].includes(m.subtype)
              )
            ) {
              idle = false;
              settle();
            }
            if (m.type === "system" && m.subtype === "init") {
              if (r.kind === "ultra") log("ultraedit session", editId, m.session_id, m.model);
              if (r.kind !== "ultra" && !harvest)
                q.run(
                  "UPDATE threads SET claude_session_id=?, engine=?, updated_at=? WHERE id=?",
                  m.session_id,
                  other ? route.engine : null,
                  now(),
                  threadId,
                );
              if (m.session_id) {
                sentContext.set(m.session_id, context);
                sentLibrary.set(m.session_id, {
                  ...(sdkResume && m.session_id === sdkResume ? sentLibrary.get(sdkResume) : {}),
                  ...Object.fromEntries(Object.entries(libBlocks).filter(([, v]) => v)),
                });
              }
              if (m.session_id) {
                try {
                  convBase = sdkResume && m.session_id === sdkResume ? sessionTotals(m.session_id) : null;
                  q.run("UPDATE edits SET session_id=? WHERE id=?", m.session_id, editId);
                } catch (err) {
                  log("session id not recorded", err?.message);
                }
              }
              task.model = m.model ? (other ? `${route.engine}:${m.model}` : m.model) : null;
              if (!other)
                try {
                  stream
                    .accountInfo?.()
                    .then((a) => noteSubscription(a?.subscriptionType))
                    .catch(() => {});
                } catch {}
              e({ type: "init", model: task.model, sessionId: m.session_id });
            } else if (m.type === "stream_event") {
              idle = false;
              const ev = m.event,
                who = m.parent_tool_use_id || "";
              if (ev?.type === "message_start" && ev.message?.id) {
                lastTurn.set(who, ev.message.id);
                turnOf(ev.message.id, ev.message.model ?? null, !!who, ev.message.usage);
              } else if (ev?.type === "message_delta" && ev.usage && lastTurn.has(who))
                turnOf(lastTurn.get(who), null, !!who, { output_tokens: ev.usage.output_tokens });
              if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                e({ type: "delta", text: ev.delta.text });
                sawText = true;
              } else if (ev?.type === "message_start") e({ type: "turn" });
            } else if (m.type === "assistant") {
              if (m.message?.id) turnOf(m.message.id, m.message.model ?? null, !!m.parent_tool_use_id, m.message.usage);
              for (const b of m.message.content || []) {
                if (b.type === "text" && b.text.trim()) {
                  summary = b.text.trim();
                  addMsg(threadId, "assistant", { text: b.text });
                  e({ type: "text", text: b.text, streamed: sawText });
                } else if (b.type === "tool_use") {
                  worked = true;
                  const s = toolSummary(b.name, b.input);
                  const tn = String(b.name).replace(/^mcp__suite__/, "");
                  toolCalls.set(tn, (toolCalls.get(tn) ?? 0) + 1);
                  addMsg(threadId, "tool", { name: b.name, summary: s });
                  e({ type: "tool", id: b.id, name: b.name, summary: s });
                }
              }
              sawText = false;
            } else if (m.type === "user") {
              for (const b of Array.isArray(m.message?.content) ? m.message.content : [])
                if (b.type === "tool_result") {
                  e({ type: "tool_done", id: b.tool_use_id, error: !!b.is_error });
                  if (Array.isArray(b.content)) pendingImages += b.content.filter((c) => c?.type === "image").length;
                }
            } else if (m.type === "system" && m.subtype === "suite_note") {
              try {
                addMsg(threadId, "note", { text: m.text, warn: !!m.warn });
              } catch {}
              e({ type: "note", text: m.text, warn: !!m.warn });
              log("task", r.kind, editId, "codex guard:", m.text);
            } else if (m.type === "system" && m.subtype === "compact_boundary") {
              if (m.session_id) {
                sentContext.delete(m.session_id);
                sentLibrary.delete(m.session_id);
              }
              const pre = +m.compact_metadata?.pre_tokens || 0;
              log(
                "task",
                r.kind,
                editId,
                "conversation summarised by Claude Code",
                m.compact_metadata?.trigger ?? "",
                pre,
                "->",
                m.compact_metadata?.post_tokens ?? "?",
                "tokens",
              );
              const text = `Claude's conversation reached about ${Math.round(pre / 1e3)}k tokens and was summarised. It got the task, your style rules and the shot list again and re-reads the project's progress notes, then carries on.`;
              try {
                addMsg(threadId, "note", { text });
              } catch {}
              e({ type: "note", text });
            } else if (m.type === "rate_limit_event") {
              if (!other) notePlan(m.rate_limit_info);
              pushUsage();
            } else if (m.type === "system" && m.subtype === "background_tasks_changed") {
              background = new Set((m.tasks || []).filter((t) => !t.ambient).map((t) => t.task_id));
              settle();
            } else if (m.type === "system" && m.subtype === "task_started" && m.is_backgrounded) {
              background.add(m.task_id);
            } else if (m.type === "system" && m.subtype === "task_notification") {
              background.delete(m.task_id);
              settle();
            } else if (m.type === "result") {
              idle = true;
              settle();
              results++;
              status = "done";
              errMsg = "";
              for (const [k, v] of Object.entries(m.modelUsage ?? {})) if (+v?.contextWindow > 0) modelWindows.set(k, +v.contextWindow);
              cost = other ? 0 : (m.total_cost_usd ?? 0);
              tin = (m.usage?.input_tokens ?? 0) + (m.usage?.cache_read_input_tokens ?? 0) + (m.usage?.cache_creation_input_tokens ?? 0);
              tout = m.usage?.output_tokens ?? 0;
              if (m.subtype !== "success") {
                status = "failed";
                errMsg =
                  m.subtype === "error_max_turns" ? "Stopped: reached the turn limit." : m.errors?.join?.("; ") || m.result || m.subtype;
              } else if (m.is_error) {
                status = "failed";
                errMsg = String(m.result || "Claude returned an error");
              }
            }
          }
        } catch (err) {
          thrown = err;
        }
        release();
        if (background.size)
          log(
            "task",
            r.kind,
            editId,
            "closed with",
            background.size,
            'background task(s) still listed: the next request may first answer them (see "usage turn ... WAKE-UP")',
          );
        const why = thrown ? String(thrown?.message || thrown) : status === "failed" ? errMsg : "";
        if (
          codex &&
          codexResume &&
          !abort.signal.aborted &&
          !worked &&
          attempt < 1 &&
          /no (saved )?(rollout|session|thread|conversation)|(thread|session|rollout|conversation)[^.\n]{0,40}not found|could not find (the )?(thread|session|rollout)/i.test(
            why,
          )
        ) {
          log("task", r.kind, "codex thread not found, starting a fresh one:", codexResume, why.slice(0, 200));
          codexResume = void 0;
          status = "done";
          errMsg = "";
          const text =
            "Started a fresh ChatGPT conversation: Codex no longer had the earlier one. It reads the project's own notes (AGENTS.md, its progress file and storyboard) first; every edit can still be reverted.";
          try {
            addMsg(threadId, "note", { text });
          } catch {}
          e({ type: "note", text });
          continue;
        }
        if (!abort.signal.aborted && !worked && attempt < 3 && AUTH_RACE.test(why)) {
          log("task", r.kind, "sign-in refresh race, retry", attempt + 1);
          e({ type: "text", text: "Claude Code was busy refreshing its sign-in. Trying again...", streamed: false });
          status = "done";
          errMsg = "";
          await new Promise((res) => setTimeout(res, 6e3 + attempt * 6e3 + Math.random() * 4e3));
          continue;
        }
        if (thrown) throw thrown;
        break;
      }
      if (personal && status === "done") {
        try {
          await afterPersonalTask(r.projectId, r.kind, started);
        } catch (err) {
          log("personal wrap-up failed", err?.message);
          errMsg = String(err?.message ?? err);
          status = "failed";
        }
      }
    } catch (err) {
      if (abort.signal.aborted) {
        status = "cancelled";
        errMsg = "Stopped by you.";
      } else {
        status = "failed";
        errMsg = String(err?.message || err);
      }
    }
    let after = null,
      files = [],
      auth = false,
      compare = null;
    let usage = { cacheRead: 0, cacheWrite: 0, context: 0, images: 0, turns: 0 };
    try {
      if (toLang) {
        const now2 = scriptNow(),
          applied = status === "done" && !!now2?.trim() && now2 !== scriptBefore;
        if (applied) {
          try {
            setLanguage(r.projectId, toLang);
          } catch (err) {
            log("task", "language not set", err?.message);
          }
        }
        language = { to: toLang, applied };
      }
      if (status === "done" && (r.kind === "ultra" || (r.kind === "build" && r.extras?.includes("ultra")))) {
        try {
          const touched = (s) => {
            try {
              return fs.statSync(path.join(project.path, s.file)).mtimeMs > started;
            } catch {
              return false;
            }
          };
          const shots = [...ultraTargets(r.projectId, r.kind === "ultra" ? r.shots : null).values()].flat().filter(touched);
          if (shots.length) markUltraedited(project.path, shots, editId);
        } catch (err) {
          log("ultraedit marks failed", err?.message);
        }
      }
      if (r.kind === "studio" && studioStage) markStage(r.projectId, studioStage, status === "done" ? "done" : "idle");
      if (status === "done" && r.kind === "build") {
        const gone = dropCrewChecks(project.path);
        if (gone.length) log("task build", editId, "removed crew check files the director left:", gone.join(", "));
      }
      try {
        if (r.kind !== "ask" && before) {
          after = await snapshot(
            project.path,
            `${status === "done" ? "Edit" : status === "cancelled" ? "Stopped" : "Failed"}: ${r.instruction || r.kind}`,
          );
          files = after ? await changedFiles(project.path, before, after) : [];
        }
      } catch (err) {
        errMsg ||= "Versioning failed: " + err.message;
      }
      if (status === "done" && (r.kind === "edit" || r.kind === "ultra") && files.length === 0) status = "no-change";
      auth = !other && /authenticat|login|oauth|401|credential/i.test(errMsg);
      if (errMsg) {
        log("task", r.kind, status, errMsg);
        errMsg = friendlyError(errMsg, route.engine);
        try {
          addMsg(threadId, "error", { text: errMsg, auth });
        } catch {}
      }
      q.run(
        "UPDATE edits SET status=?, commit_before=?, commit_after=?, files=?, summary=?, cost_usd=?, tokens_in=?, tokens_out=?, duration_ms=?, finished_at=? WHERE id=?",
        status,
        before,
        after,
        JSON.stringify(files),
        (errMsg || summary).slice(0, 2e3),
        cost,
        tin,
        tout,
        Date.now() - started,
        now(),
        editId,
      );
      usage = recordUsage(editId, r.kind, [...turns.values()], !!sdkResume, !!fresh, toolUsage(toolCalls, ledger), ledger);
      if (r.kind !== "ultra" && !harvest && !codex && usage.context)
        q.run("UPDATE threads SET context_tokens=? WHERE id=?", usage.context, threadId);
      q.run("UPDATE threads SET updated_at=? WHERE id=?", now(), threadId);
      if (r.kind === "build" || r.kind === "reframe")
        q.run("UPDATE projects SET status='editing', updated_at=? WHERE id=?", now(), r.projectId);
      if (files.length) markDirty(r.projectId);
      if (files.length && status === "done" && r.kind === "ultra" && fs.existsSync(path.join(cmpDir, `${editId}-u0-before.png`))) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(cmpDir, `${editId}.json`), "utf8"));
          await ultraFrames(
            r.projectId,
            cmpDir,
            editId,
            meta.ultra.map((u) => ({ t0: u.time, t1: u.time, index: u.index, name: u.name, file: u.file })),
            "after",
          );
          compare = editCompare(r.projectId, editId);
        } catch (err) {
          log("ultra after frames failed", err?.message);
        }
      }
      if (files.length && status === "done" && fs.existsSync(path.join(cmpDir, `${editId}-before.jpg`))) {
        try {
          const [s] = await renderStills(r.projectId, [r.time], 0.5, `edit-${editId}`);
          fs.copyFileSync(s.file, path.join(cmpDir, `${editId}-after.png`));
          fs.rmSync(path.dirname(s.file), { recursive: true, force: true });
          compare = editCompare(r.projectId, editId);
        } catch (err) {
          log("compare render failed", err.message);
        }
      }
    } catch (err) {
      log("task wrap-up failed", err?.message || err);
    } finally {
      running.delete(taskId);
      if (usageTimer) clearTimeout(usageTimer);
      setWorkerPool(r.projectId, 1);
      e({
        type: "done",
        kind: r.kind,
        engine: route.engine,
        status,
        error: errMsg || null,
        auth,
        files,
        cost,
        tokens: {
          in: tin,
          out: tout,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
          context: usage.context,
          turns: usage.turns,
        },
        ms: Date.now() - started,
        edit: getEdit(editId),
        compare,
        language,
      });
    }
  })();
  return { taskId, editId, threadId, engine: route.engine };
}
export function stopTask(taskId) {
  const t = running.get(taskId);
  if (!t) return false;
  t.pending.forEach((res) => res(false));
  t.abort.abort();
  return true;
}
export function answerPermission(taskId, requestId, allow) {
  running.get(taskId)?.pending.get(requestId)?.(allow);
}
export function editCompare(projectId, editId) {
  const d = path.join(getProject(projectId).path, ".suite", "edits");
  if (fs.existsSync(path.join(d, `${editId}-u0-after.png`))) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(d, `${editId}.json`), "utf8"));
      const list = meta.ultra
        .filter(
          (u) => fs.existsSync(path.join(d, `${editId}-u${u.k}-before.png`)) && fs.existsSync(path.join(d, `${editId}-u${u.k}-after.png`)),
        )
        .map((u) => ({
          before: projectUrl(projectId, `.suite/edits/${editId}-u${u.k}-before.png`),
          after: projectUrl(projectId, `.suite/edits/${editId}-u${u.k}-after.png`),
          time: u.time,
          label: `Shot ${u.index + 1}${u.name ? ": " + u.name : ""}`,
        }));
      if (list.length) return { ...list[0], list };
    } catch {}
  }
  if (!fs.existsSync(path.join(d, `${editId}-before.jpg`)) || !fs.existsSync(path.join(d, `${editId}-after.png`))) return null;
  let time = 0;
  try {
    time = JSON.parse(fs.readFileSync(path.join(d, `${editId}.json`), "utf8")).time;
  } catch {}
  return {
    before: projectUrl(projectId, `.suite/edits/${editId}-before.jpg`),
    after: projectUrl(projectId, `.suite/edits/${editId}-after.png`),
    time,
  };
}
export const getEdit = (id) => q.get("SELECT * FROM edits WHERE id=?", id);
export const listEdits = (projectId, limit = 100) =>
  q.all("SELECT * FROM edits WHERE project_id=? ORDER BY created_at DESC LIMIT ?", projectId, limit);
export const listThreads = (projectId) =>
  q.all(
    "SELECT t.*, (SELECT COUNT(*) FROM messages m WHERE m.thread_id=t.id) AS n FROM threads t WHERE project_id=? ORDER BY updated_at DESC",
    projectId,
  );
export const threadMessages = (threadId) =>
  q.all("SELECT * FROM messages WHERE thread_id=? ORDER BY id", threadId).map((m) => ({ ...m, content: JSON.parse(m.content) }));
export async function recoverInterruptedEdits() {
  const rows = q.all(
    "SELECT e.id, e.instruction, e.commit_before, p.path FROM edits e JOIN projects p ON p.id=e.project_id WHERE e.status='running'",
  );
  for (const r of rows) {
    let files = [],
      after = null;
    try {
      if (r.commit_before && fs.existsSync(r.path) && (await gitAvailable())) {
        after = await snapshot(r.path, `Interrupted: ${r.instruction || "edit"}`);
        files = after && after !== r.commit_before ? await changedFiles(r.path, r.commit_before, after) : [];
      }
    } catch (e) {
      log("recover edit", r.id, e.message);
    }
    q.run(
      "UPDATE edits SET status='failed', commit_after=?, files=?, summary=COALESCE(summary,'') || ?, finished_at=? WHERE id=?",
      after,
      JSON.stringify(files),
      files.length
        ? `Interrupted: the app closed while Claude was working. ${files.length} file(s) were already changed; revert this edit to undo them.`
        : "Interrupted: the app closed while Claude was working.",
      now(),
      r.id,
    );
  }
  return rows.length;
}
const busyGuard = (projectId) => {
  if ([...running.values()].some((t) => t.projectId === projectId))
    throw new Error("Claude is editing this project right now. Try again when it finishes (or press Stop).");
};
export const isProjectBusy = (projectId) => [...running.values()].some((t) => t.projectId === projectId && t.kind !== "harvest");
export const isProjectBusyAny = (projectId) => [...running.values()].some((t) => t.projectId === projectId);
export const isThreadBusy = (threadId) => [...running.values()].some((t) => t.threadId === threadId);
export async function reapplyEdit(editId) {
  const ed = getEdit(editId);
  if (!ed) throw new Error("Edit not found");
  busyGuard(ed.project_id);
  if (ed.status !== "reverted") throw new Error("Only a reverted edit can be re-applied.");
  if (!(await gitAvailable())) throw new Error("Git is not installed.");
  const p = getProject(ed.project_id);
  await reapplyRange(p.path, ed.commit_before, ed.commit_after, ed.instruction);
  q.run("UPDATE edits SET status='done' WHERE id=?", editId);
  markDirty(ed.project_id);
  return getEdit(editId);
}
export async function restoreBefore(editId) {
  const ed = getEdit(editId);
  if (!ed) throw new Error("Edit not found");
  busyGuard(ed.project_id);
  if (!(await gitAvailable())) throw new Error("Git is not installed.");
  if (!ed.commit_before) throw new Error("This edit has no saved starting point.");
  const p = getProject(ed.project_id);
  await restoreTo(p.path, ed.commit_before, `before "${ed.instruction || "build"}"`);
  const later = q.run(
    "UPDATE edits SET status='reverted' WHERE project_id=? AND created_at>=? AND status IN ('done','failed','cancelled') AND files IS NOT NULL AND files<>'[]'",
    ed.project_id,
    ed.created_at,
  );
  markDirty(ed.project_id);
  return { undone: Number(later.changes) };
}
export async function revertEdit(editId) {
  const ed = getEdit(editId);
  if (!ed) throw new Error("Edit not found");
  busyGuard(ed.project_id);
  if (ed.status === "reverted") throw new Error("This edit is already undone (reverted or restored past). Use Re-apply to bring it back.");
  if (!(await gitAvailable())) throw new Error("Git is not installed, so edits cannot be reverted.");
  if (!ed.commit_before || !ed.commit_after || ed.commit_before === ed.commit_after) throw new Error("This edit changed no files.");
  const p = getProject(ed.project_id);
  await revertRange(p.path, ed.commit_before, ed.commit_after, ed.instruction);
  q.run("UPDATE edits SET status='reverted' WHERE id=?", editId);
  markDirty(ed.project_id);
  return getEdit(editId);
}
