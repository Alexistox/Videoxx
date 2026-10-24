import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { getConfig } from "../core/config";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";
import { suiteVenvPython } from "../core/install";
import { runFF } from "../pipeline/ffmpeg";
import { ensureNamedSkill } from "../projects/projects";
import { getPersonal, readPlan } from "./personalProjects";
import { addDerived, readMedia, removeMedia } from "./media";
import { readEdit, saveEdit } from "./edit";
import { findTranscriber } from "../voice/speechSetup";

const PERSONAL_SKILLS = ["talking-head-edit", "intro-edit"];
export const PERSONAL_SYSTEM = `You are running inside Videoxx, in a Personal Brand project: the creator's own footage (a screen recording
with the good microphone audio, facecam clips, maybe an intro) edited into one video. The project's CLAUDE.md (in your
context) maps the files. The cut is made with the talking-head-edit skill, end to end: it renders the edited screen
recording and ONE continuous facecam (out/edit/), passes every quality gate and writes work/delivery.json; the Suite then
puts those two files on its timeline as one clip each and composes the final video from them.
- Work only inside the project folder. Never modify, move or re-encode the footage in media.json.
- Your replies appear in a narrow side panel: plain, short sentences; progress in a few words while long steps run.
- The session ends when your turn ends, and anything still running is killed then. Never end your turn while a command you
  started is still running (renders, transcription): wait for it in the foreground, then finish the work and report.`;
function python() {
  const v = suiteVenvPython();
  return process.platform !== "win32" && fs.existsSync(v) ? v : getConfig().tools.python;
}
function asr() {
  const t = findTranscriber();
  if (t) return { py: t.python, script: t.script };
  return { py: python(), script: path.join(templatesDir(), "skill", "talking-head-edit", "scripts", "asr_whisper.py") };
}
export function personalEnv(p, kind) {
  const a = asr(),
    skill = kind === "intro" ? "intro-edit" : "talking-head-edit";
  const env = {
    CZ_PYTHON: python(),
    CZ_ASR_PYTHON: a.py,
    CZ_ASR_SCRIPT: a.script,
    CZ_SKILL: path.join(p.path, ".claude", "skills", skill),
    CZ_PROJECT: p.path,
    CZ_OUT: path.join(p.path, "out", "edit"),
  };
  const sfx = getConfig().personal?.sfxDir;
  if (sfx && fs.existsSync(sfx)) env.CZ_SFX_DIR = sfx;
  return env;
}
export function ensurePersonalSkills(dir) {
  if (changedScripts(dir).length) {
    log("talking-head-edit scripts differ from the Suite copy: reinstalling");
    dropSkill(dir);
  }
  for (const s of PERSONAL_SKILLS) ensureNamedSkill(dir, s);
  runStart.set(runKey(dir), scriptHashes(dir));
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const hasCut = (p) => fs.existsSync(path.join(p.path, "work", "script.md")) && fs.existsSync(path.join(p.path, "work", "delivery.json"));
export function personalPrompt(p, kind, instruction) {
  const media = readMedia(p),
    plan = readPlan(p);
  const line = (m) =>
    `- ${m.role}: ${m.file} (${mmss(m.duration)}${m.width ? `, ${m.width}x${m.height} ${Math.round(m.fps)} fps` : ""}${m.audio ? "" : ", no audio"})`;
  const list = media.map((m) => line(m) + (m.derived ? " [made by the Suite from an earlier run: not an input]" : "")).join("\n");
  const order = ["screen", "facecam", "other"],
    raw = media
      .filter((m) => !m.derived && m.role !== "intro")
      .sort(
        (a, b) =>
          order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name, void 0, { numeric: true, sensitivity: "base" }),
      );
  const screens = raw.filter((m) => m.role === "screen").length;
  const inputs =
    raw.map(line).join("\n") +
    (screens > 1
      ? `
The ${screens} screen recordings are parts of one recording, in the order listed: cut them as one, joined in that order.`
      : "") +
    (raw.some((m) => m.role === "other") ? '\nFiles marked "other" are extra footage: use them only where the user notes ask for it.' : "");
  const about = `Video: "${plan.title}"${plan.concept ? `. Core concept: ${plan.concept}` : ""}${plan.thumbnailIdea ? `. Thumbnail idea: ${plan.thumbnailIdea}` : ""}`;
  if (kind === "cut")
    return `Edit this video's footage with the talking-head-edit skill, end to end. Read .claude/skills/talking-head-edit/SKILL.md
first (its "Inside Videoxx" section included), then references/editing-doctrine.md before you decide the cut.
Ultra high effort, no hand-holding, no shortcuts: read the WHOLE transcript and write work/script.md with only the
sentences the video needs (each from its last clean take), render the edit with the skill's scripts and pass every
check. Never change the skill's scripts: the Suite refuses a delivery made with modified scripts. The run only counts when finalize.py prints DELIVERED:
the Suite then loads the edited screen recording and the one facecam file you rendered. ${hasCut(p) ? "There is an earlier cut in work/: start fresh from the footage (a new work/ run), unless the user notes say otherwise." : ""}
${about}
Footage to edit (the intro read has its own workflow and is not part of this cut):
${inputs}
Notes from the user: ${instruction || "(none)"}`;
  if (kind === "intro")
    return `Edit this video's intro with the intro-edit skill (read .claude/skills/intro-edit/SKILL.md first, including its
"Inside Videoxx" section): an Apple-launch style edit of the intro read, then the sound-effects pass, delivered as
work/intro/output.mp4 + work/intro/output.sfx.wav. The Suite puts it at the start of the timeline when you finish.
${about}
Footage (media.json):
${list}
Notes from the user: ${instruction || "(none)"}`;
  const e = readEdit(p);
  const clips = e.clips
    .slice(0, 400)
    .map((c, i) => `${i + 1}. ${media.find((m) => m.id === c.src)?.role ?? c.src} ${c.in.toFixed(2)}-${c.out.toFixed(2)}`)
    .join("\n");
  const how =
    kind === "ask"
      ? "\nThis is a question: answer it without editing files. The cut is described by work/script.md (the lines the video\nis built from), work/utt.txt (the raw transcript) and work/timeline.json (source -> output time of every piece)."
      : hasCut(p)
        ? `
This changes the cut made with the talking-head-edit skill. Do it the skill's way ("Re-cuts" in
.claude/skills/talking-head-edit/SKILL.md): change work/script.md (find the utterances in work/utt.txt; work/timeline.json
maps output time to source time), then run build_cut.py, render_audio.py, check_edit.py, segrender.py screen + cam, mux.py,
verify_sync.py, contact.py and finalize.py from work/ with "$CZ_PYTHON" "$CZ_SKILL/scripts/...". Same checks, same
standard, never change the scripts. Never edit edit.json or the rendered files by hand: the Suite reloads the edit when
finalize.py delivers.`
        : `
To change the edit, edit edit.json (keep its format; the editor reloads it live). Keep every other clip exactly as it is.`;
  return `${instruction.trim()}
${how}
${about}
Footage:
${list}
Current timeline (clip, source, in-out seconds; one clip = the rendered cut):
${clips || "(empty)"}`;
}
const skillScripts = (dir) => path.join(dir, ".claude", "skills", "talking-head-edit", "scripts");
const runKey = (dir) => path.resolve(dir).toLowerCase();
const runStart = new Map();
function hashesOf(scriptsDir) {
  const out = {};
  if (fs.existsSync(scriptsDir)) {
    for (const n of fs.readdirSync(scriptsDir))
      if (n.endsWith(".py"))
        out[n] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join(scriptsDir, n)))
          .digest("hex");
  }
  return out;
}
const scriptHashes = (dir) => hashesOf(skillScripts(dir));
const differ = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((n) => a[n] !== b[n]).sort();
function changedScripts(projectDir) {
  const src = path.join(templatesDir(), "skill", "talking-head-edit", "scripts");
  return fs.existsSync(src) ? differ(hashesOf(src), scriptHashes(projectDir)) : [];
}
const dropSkill = (projectDir) =>
  fs.rmSync(path.join(projectDir, ".claude", "skills", "talking-head-edit"), { recursive: true, force: true });
function lockedScripts(projectDir) {
  const start = runStart.get(runKey(projectDir));
  const bad = start ? differ(start, scriptHashes(projectDir)) : changedScripts(projectDir);
  if (!bad.length) return;
  dropSkill(projectDir);
  throw new Error(
    `The editing skill's scripts were changed during the run (${bad.join(", ")}), so the checks cannot be trusted and the cut was not loaded. The original scripts are restored for the next run: start Cut the footage again.`,
  );
}
async function applyDelivery(projectId, startedAt = 0) {
  const p = getPersonal(projectId),
    f = path.join(p.path, "work", "delivery.json");
  if (!fs.existsSync(f) || fs.statSync(f).mtimeMs < startedAt - 2e3) return false;
  lockedScripts(p.path);
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const k of ["screen", "facecam"]) if (d[k] && !fs.existsSync(d[k])) throw new Error(`The delivered ${k} file is missing: ${d[k]}`);
  if (!d.screen) throw new Error("delivery.json has no screen recording.");
  const scr = await addDerived(projectId, d.screen, "screen", "Screen recording (edited by Claude)");
  const cam = d.facecam ? await addDerived(projectId, d.facecam, "facecam", "Facecam (edited by Claude)") : null;
  if (!cam) {
    for (const m of readMedia(getPersonal(projectId))) if (m.derived && m.role === "facecam") removeMedia(projectId, m.id);
  }
  const media = readMedia(getPersonal(projectId)),
    e = readEdit(getPersonal(projectId));
  const intro = e.clips.find((c) => media.find((m) => m.id === c.src)?.role === "intro");
  saveEdit(
    projectId,
    {
      ...e,
      clips: [...(intro ? [intro] : []), { id: "cut", src: scr.id, in: 0, out: scr.duration }],
      cams: cam ? { [cam.id]: { m: 0, c: 0, start: 0, end: Math.min(scr.duration, cam.duration) } } : {},
      signedOff: null,
    },
    "claude",
  );
  return true;
}
export async function afterPersonalTask(projectId, kind, startedAt = 0) {
  if (kind === "cut") {
    if (!(await applyDelivery(projectId, startedAt)))
      throw new Error(
        "Claude stopped before the cut was delivered (finalize.py did not pass, so nothing reached the timeline). Ask it to finish: fix what finalize.py lists and run it again. Or start Cut the footage again.",
      );
    return;
  }
  if (kind === "edit") {
    await applyDelivery(projectId, startedAt);
    return;
  }
  if (kind !== "intro") return;
  const p = getPersonal(projectId),
    dir = path.join(p.path, "work", "intro"),
    out = path.join(dir, "output.mp4");
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < startedAt - 2e3)
    throw new Error(
      "Claude stopped before the intro was rendered (work/intro/output.mp4 is missing). Ask it to finish the render and the sound pass, or start Edit the intro again.",
    );
  if (!fs.existsSync(path.join(dir, "output.sfx.wav"))) log("intro finished without a sound-effects stem: using the intro as it is");
  const sfx = path.join(dir, "output.sfx.wav");
  let file = out;
  if (fs.existsSync(sfx)) {
    const fin = path.join(dir, "intro-final.mov"),
      mix = (lim) =>
        runFF([
          "-i",
          out,
          "-i",
          sfx,
          "-filter_complex",
          `[0:a][1:a]amix=inputs=2:normalize=0:duration=first${lim ? ",alimiter=limit=0.95:attack=2:release=50:level=0:latency=1" : ""}[a]`,
          "-map",
          "0:v",
          "-map",
          "[a]",
          "-c:v",
          "copy",
          "-c:a",
          "pcm_s24le",
          "-ar",
          "48000",
          fin,
        ]);
    try {
      await mix(true);
    } catch {
      await mix(false);
    }
    file = fin;
  }
  const raw = readMedia(p).filter((m2) => m2.role === "intro" && !m2.derived);
  const m = await addDerived(projectId, file, "intro", "Intro (edited by Claude)");
  const e = readEdit(getPersonal(projectId)),
    rawIds = new Set(raw.map((r) => r.id)),
    ids = new Set(readMedia(getPersonal(projectId)).map((x) => x.id));
  const rest = e.clips.filter((c) => c.src !== m.id && !rawIds.has(c.src) && ids.has(c.src));
  saveEdit(projectId, { ...e, clips: [{ id: "intro", src: m.id, in: 0, out: m.duration }, ...rest] }, "claude");
}
