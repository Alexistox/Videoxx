import { getStyle } from "../styles/catalog";
import { isOpen, readIssues } from "../projects/issues";
import { collectFacts, gateOf, matchSettingsOf, readVersions, stagesOf } from "./stages";
import { libraryOff } from "../library/context";
import { allowedFor } from "./writeCheck";
import { readTargets, targetCopy } from "./targets";
import { studyBlock } from "./study";

const DOCS = ".claude/skills/studio";
const STAGE = {
  brief: () => ['the brief in project.json "studio" (name, description, aspects)', "nothing (the brief is the app's form)", "none"],
  study: () => [
    `reference/stats.json and the contact sheets the app made (APP STUDY below), the references themselves (reference_frames gives more frames of any range)${libraryOff() ? " (the Library is off: write that in Reuse)" : ", the Library (library_search) for the Reuse section"}`,
    "reference/ANALYSIS.md, every section of its template filled with measured numbers (hex colours, seconds, shot shares)",
    "every section of reference/ANALYSIS.md filled, at least 5 hex colours, the Pacing section in numbers when a reference is a video",
  ],
  guide: (s, skill) => [
    `reference/ANALYSIS.md, the description, the ${s.target} engine (.claude/skills/${skill}/references/engine_api.md, ${DOCS}/bases/${s.base}/extend.md)`,
    "skill/STYLE_GUIDE.md and skill/QUALITY.md filled in, the engine restyled (THEMES / DEFAULTS / palette / fonts) and scenes/hero.js showing 3 hero frames of the style",
    "every heading of STYLE_GUIDE.md filled (numbers, not adjectives), QUALITY.md filled, scenes/hero.js with 3 shots (the hero frames) loading in every aspect with no high issue open on them; the user approves the direction from those frames",
  ],
  kit: (s) => [
    "skill/STYLE_GUIDE.md, the approved hero frames",
    `every element the style needs, built in the engine (lib/ or engine.js, ${DOCS}/bases/${s.base}/extend.md) and shown ALONE in scenes/kit*.js (one element per shot, the shot named after the element, full size; on a light and on a dark background when the style uses both)`,
    "a kit scene exists, check_layout Clean on the kit view; the user approves or flags every element in the kit gallery (a flag is an issue on that element)",
  ],
  sample: () => [
    "the kit, the sample narration (audio/timeline.json: narration tool; script.txt)",
    "scenes/sample*.js: a 15-30 s sample built from the kit only, every element on its spoken word",
    "a sample scene exists, loading in every aspect, check_preview clean, no high issue open on it",
  ],
  review: () => [
    "the open issues (studio_state, the request below), the renders of every view",
    "fixes for exactly those issues (and resolve_issue with the lesson for each one fixed)",
    "no open high-severity issue",
  ],
  publish: () => [
    "the finished workspace, the publish checklist's failed items (the request below)",
    "only style.json text (name, tagline, description, prompts) and STYLE_GUIDE.md / QUALITY.md wording if asked: the app runs the publish checklist and installs the style",
    "the app's checklist: style.json valid with a name no other style has, every engine export kept, no banned calls, every frame loads and exports 5 s, no high issue open, the must-fail scenes still fail, the looks validate",
  ],
  look: (s) => [
    `reference/ANALYSIS.md, the description, the ${s.target} style's settings (its Look controls; set_look_settings validates them)`,
    "the look: settings through set_look_settings, and skill/LOOK.md filled in (what it changes and why, its own quality bar and pitfalls)",
    "settings set, LOOK.md filled; render_view sample in every aspect",
  ],
  save: () => ["the finished look", "nothing: the app saves it", "the app's checklist (later version)"],
};
const issueLine = (i) =>
  `- [${i.id}] ${i.severity.toUpperCase()}${i.source === "critic" ? " (critic)" : i.source === "user" ? " (the user)" : ""} ${i.title}${i.where?.view ? ` (view ${i.where.view}${i.where.aspect ? ` ${i.where.aspect}` : ""}${i.where.t != null ? ` at ${i.where.t}s` : ""}${i.where.file ? `, ${i.where.file}${i.where.line ? ":" + i.where.line : ""}` : ""})` : ""}${i.meaning ? ` -> ${i.meaning}` : ""}${i.fix ? ` -> fix: ${i.fix}` : ""}`;
const REVIEW_RUN = [
  "every view of the workspace (studio_state lists them) in every aspect, skill/QUALITY.md, skill/PITFALLS.md, the brief, NO_SLOP.md",
  "add_issue for every fault you see in the frames at full size (render_view each view at its shots' start, middle and end, in every aspect): where (view, aspect, t, element), severity, what it means, the exact fix. Change NO files in this run",
  "nothing to pass: the user picks what to fix (Fix it / Fix all open)",
];
function matchBlock(dir, studio, open) {
  const targets = readTargets(dir),
    vs = readVersions(dir),
    last2 = vs[vs.length - 1],
    scores = vs.filter((v) => v.score).map((v) => `v${v.v} ${v.score.value}`);
  const critic = open.some((i) => i.source === "critic");
  if (!targets.length && !critic && !scores.length) return "";
  const m = last2?.match?.targets ?? [],
    set = matchSettingsOf(studio);
  return [
    targets.length
      ? `MATCH: the member's TARGET frames (the style must match them): ${targets.map((t) => `${targetCopy(t.id)} = ${t.id} (view ${t.view}, ${t.aspect}, at ${t.t} s)`).join("; ")}.`
      : "",
    m.length
      ? `The overlays of the latest version v${last2.v} (Read them before and after you change things; they are made again for every version): ${m.map((x) => `${x.id}: ${x.side} (target | render), ${x.blend}, ${x.edges} (target edges in cyan over the render), ${x.crops.map((c) => c.file).join(", ")} (zoomed crops)${x.regionsFile ? `, ${x.regionsFile} (mean colours of 12 regions, target vs render)` : ""}`).join("; ")}. Verify every critic claim on them before you act.`
      : "",
    scores.length
      ? `The critic's score history: ${scores.join(", ")} (the loop stops at ${set.threshold} with no open high or medium issue).`
      : "",
    critic
      ? 'CRITIC ISSUES (marked "(critic)"): a fresh critic filed them from the overlays. Apply every valid one. You may reject one only with resolve_issue status "wontfix" and a lesson that names the EVIDENCE (the overlay, frame or check that shows it is wrong, e.g. "the edge overlay of t1 shows the horizon matches within 5 px"); a rejection without evidence is refused, and the next critic judges your evidence.'
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
export function studioPrompt(dir, studio, request) {
  const st = getStyle(studio.target),
    skill = st.skill,
    stage = request.stage;
  const [inputs, output, gate2] = request.review && !request.fix ? REVIEW_RUN : STAGE[stage](studio, skill);
  const allow = allowedFor(studio, stage);
  const what =
    studio.mode === "look"
      ? `a LOOK for the style "${st.name}" (settings + notes on its own engine, which you never change)`
      : studio.mode === "scratch"
        ? `a NEW STYLE from scratch on the plain starter engine (${studio.dim ?? "2d"})`
        : `a NEW STYLE on top of "${st.name}" (its engine, reshaped; base ${studio.base})`;
  const all = readIssues(dir),
    open = all.filter(isOpen),
    picked = request.issues?.length ? open.filter((i) => request.issues.includes(i.id)) : open;
  const g = gateOf(stage, studio.mode, collectFacts(dir, studio));
  return [
    `STYLE STUDIO - ${request.fix ? "FIX ROUND of the review" : request.review ? "FRAME REVIEW (the review stage: look and file issues, change nothing)" : `STAGE: ${stage.toUpperCase()}`} (stages: ${stagesOf(studio.mode).join(" > ")}).`,
    `You are building ${what}, named "${studio.name}"${studio.description ? `: ${studio.description}` : ""}. Frames: ${studio.aspects.join(" and ")}.`,
    `Read first: ${DOCS}/AUTHORING.md, ${DOCS}/stages/${request.fix ? "fix" : stage}.md, ${DOCS}/bases/${studio.base}/extend.md and dont.md, ${DOCS}/NO_SLOP.md. The base engine's API: .claude/skills/${skill}/references/engine_api.md (where it has one).`,
    `INPUTS: ${inputs}.`,
    `YOUR ONE OUTPUT: ${output}.`,
    `GATE (what the app checks before the next stage): ${gate2}. Now: ${g.ok ? "passes" : g.missing.join("; ")}.`,
    `YOU MAY WRITE ONLY: ${allow.length ? allow.join(", ") : "nothing (this stage writes no files)"}. Everything else is refused by the app (project.json, .suite/, .claude/, reference/ except ANALYSIS.md, audio/, the must-fail scenes, vendor/, fonts/: use add_font, the check libraries lib/contact.js, lib/collide.js, lib/check.js, lib/scan.js). Never remove or rename an engine export (the app diffs them after every turn: ${studio.baseExports.length} at the start). After your turn the app saves a version and runs its own checks (errors, layout, blank / dark frames, banned calls, removed exports, must-fail scenes): what they find becomes issues.`,
    `TOOLS: studio_state (stage, views, gate, allowed files), set_view / render_view (view, aspect, times) to look, check_preview and check_layout after every change, add_issue for what you find and resolve_issue (with the lesson) for what you fixed${studio.mode === "look" ? ", set_look_settings for the look" : ", add_font for a new typeface"}. No shell, no web, no helper agents.`,
    studio.placeholderSamples
      ? "NOTE: this base has no Studio sample yet; scenes/hero.js, kit.js and sample.js are placeholders the stages replace."
      : "",
    request.review && !request.fix
      ? `ISSUES already filed (${open.length} open: never file one of these again):
${open.map(issueLine).join("\n") || "- none open"}`
      : request.fix || stage === "review"
        ? `ISSUES to fix (${picked.length} of ${open.length} open):
${picked.map(issueLine).join("\n") || "- none open"}`
        : "",
    request.fix || stage === "review" ? matchBlock(dir, studio, open) : "",
    stage === "study" && !request.fix && !request.review
      ? studyBlock(dir) || "APP STUDY: the app measured nothing (no picture or video reference could be read): work from reference_frames."
      : "",
    "Finish with 1-3 short sentences: what you made or fixed and what the user should look at.",
    `User notes: ${String(request.instruction || "").trim() || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}
