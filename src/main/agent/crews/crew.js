import path from "node:path";
import fs from "node:fs";
import { getConfig } from "../../core/config";
import { baseOf } from "../../styles/catalog";
import { isPixelCrew, pixelAgents } from "./pixelCrew";
import { isToonCrew, toonAgents } from "./toonCrew";
import { isStickCrew, stickAgents } from "./stickCrew";

export function dropCrewChecks(dir) {
  const CHECK = /^zz_(sets|check_[\w-]+)$/,
    pjf = path.join(dir, "project.json"),
    gone = [];
  try {
    const pj = JSON.parse(fs.readFileSync(pjf, "utf8")),
      listed = (pj.scenes || []).filter((s) => CHECK.test(String(s)));
    if (listed.length) {
      pj.scenes = pj.scenes.filter((s) => !CHECK.test(String(s)));
      fs.writeFileSync(pjf, JSON.stringify(pj, null, 1));
      gone.push(...listed);
    }
  } catch {}
  let files = [];
  try {
    files = fs.readdirSync(path.join(dir, "scenes"));
  } catch {}
  for (const f of files)
    if (/\.js$/.test(f) && CHECK.test(f.slice(0, -3))) {
      try {
        fs.rmSync(path.join(dir, "scenes", f));
        gone.push("scenes/" + f);
      } catch {}
    }
  return gone;
}
export const CREW_POOL = 3;
const CREW_WAVE = 4;
export const CREW_DIR = ".suite/crew";
const CREW_BASES = new Set(["recon", "pixel-art", "toon", "stickstory"]);
export function crewOn(kind, styleId, projectDir) {
  if ((kind !== "build" && kind !== "ultra") || !CREW_BASES.has(baseOf(styleId || ""))) return false;
  if (process.env.CZ_CREW === "0" || getConfig().claude?.crew === false) return false;
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8").replace(/^﻿/, "")).settings?.crew !== false;
  } catch {
    return true;
  }
}
const SK = ".claude/skills/recon-reconstruction";
const EFFORT = `PUT IN HIGH EFFORT. You may be running at a low reasoning setting: compensate by being deliberate. Before you write or
change anything, plan it in a few concrete lines (what, where in metres, what rests on what, which way it faces, the camera
move by name, which words it lands on). After each change, look, and judge honestly against the bar: the owner reviews every
frame. Quality over speed, but never loop on one detail: after two failed looks at the same flaw, note it and move on.`;
const OWN = (files) => `ONE WRITER PER FILE: other agents work on other files of this project at the same time. You may create or edit ONLY
${files}. NEVER edit project.json, scenes/c0_setup.js, lib/shared.js, models.js, engine.js, lib/camera.js, lib/props.js,
lib/contact.js, lib/collide.js, storyboard.md, DESCRIPTION.txt, .suite/build-progress.md or another chapter's files. If you need a
change there (a model or picture loaded in setup, a fix in a shared set), work around it in your own files and ask for it in
your final report. No agents of your own, no background commands.`;
const TOOLS = (
  who,
) => `TOOLS: render_frames always with who = "${who}" (your own "unchanged since you last looked" memory); check_layout with
from / to = your time range (the whole film is the director's); check_preview after each file change (only errors in YOUR
files are yours). Every image stays in your conversation: look at what you changed, not the whole chapter again.`;
const MAPS_BAR = `- MAPS AND EXTERIORS get the interiors' bar (they used to trail them: pale or foggy maps, a white void behind the glass,
  a plain block for a building). Engine v16 helpers, references/engine_api.md "Maps and exteriors":
  a MAP is regionMap(S, { center, radius }) from lib/maps.js: the look's map palette (dark in the Investigation look), the
  real roads, runways and taxiways from the data, the relief lit by a low sun, terminals standing; frame the place the story
  is about so it fills the frame (a radius of a few km, not the whole region) and mark it with marker() / strikeArc().
  Never a pale, washed-out or foggy sheet, never a hand-tinted map texture.
  An EXTERIOR has a sky and a horizon for its time of day (horizon(S) from lib/exterior.js: never a white or grey void), a
  real ground (apron concrete with stand markings, asphalt, sand), the real machines where they stand (apron(S) parks
  aircraft ON their wheels at stands, with jet bridges, service vehicles and light masts) and the building's real shape
  (terminal(S): glazing, roofline, canopy), lit so it reads in the look. Every window shows what is really outside
  (the shared set's horizon / apron behind the glass), never a void.`;
export function crewAgents(py = "python", styleId, o = {}) {
  if (isPixelCrew(styleId)) return pixelAgents(py, o);
  if (isToonCrew(styleId)) return toonAgents(o);
  if (isStickCrew(styleId)) return stickAgents(o);
  const no = ["Task", "Agent"];
  return {
    "scene-builder": {
      description:
        "Builds ONE chapter (one scene file, its shots) of a 3D reconstruction video to the full standard and signs it off: give it the chapter name, file, time range, its storyboard rows, the shared sets/assets to use, people and anything special. Launch all chapters in ONE message so they run at the same time.",
      model: "inherit",
      disallowedTools: no,
      maxTurns: 160,
      prompt: `You are a SCENE BUILDER in a crew build of a 3D reconstruction documentary in Videoxx (Three.js scenes, the
recon-reconstruction skill). The director planned the film and gives you ONE chapter: its scene file, its shots (exact
start times, anchor words, what each shows, camera, set, people) and the shared sets and assets that are ready. Other
builders build the other chapters at the same time.

${EFFORT}

READ FIRST, quickly: ${SK}/SKILL.md (skim), references/no_slop.md, references/quality.md (the hard rules), the parts of
references/engine_api.md you need, references/camera_moves.md and references/props.md, your rows in storyboard.md, and the
shared files you will use (scenes/c0_setup.js, lib/shared.js). The project's CLAUDE.md is already in your context.

${OWN("your scene file (scenes/<chapter>.js), your own helpers lib/<chapter>_*.js and new props lib/props/<name>.js")}

HOW YOU BUILD:
- Shot start times exactly as the director gave them (cutAt / cue on the given words): the cuts are the film's rhythm.
  Every event lands on its word (cue). Overlays in empty space, never on the subject.
- CAMERA: named moves from references/camera_moves.md (import { camera } from '../lib/camera.js'; const C = camera(S);
  C.move('dollyIn', { subject, t0, dur, from: 'MS', to: 'MCU' })). Customise its parameters; hand-written keyframes only when
  no move fits. Frame the subject; nothing abrupt.
- PROPS AND SETS: kit props (lib/props.js prop(kind)) put down with place() / arrange(): ON what holds them (desk, floor,
  shelf), FACING what they serve (a monitor faces its user, a chair its desk), never overlapping, never in pieces, never at a
  hand-computed y. A prop the kit lacks and no downloaded model fits: build it in lib/props/<name>.js to the PROP CONTRACT in
  props.md and check it alone with view_prop before it goes into a shot. A shared set: use the director's lib/shared.js
  function as it is.
- PEOPLE (both looks; ${SK}/references/characters.md, animations.md, hands.md when present): every person is figure(role)
  from lib/figures.js, never cast(), actor() or a downloaded person (legacy). Each role's body, finish and colour are the
  USER'S choice (Look > Characters) and the identity: the person the story follows is figure('main'); never pass rig /
  outfit / colors and never override a role pick (one look for a group: figureGroup() + figure(role, { group })). They act
  what is said with catalog clips (f.act / f.play / f.sequence, findAnims(tag), never an invented name); held things ONLY
  with lib/hands.js hold() and a grip from its VERIFIED table (handover() between two people, pick-up / put-down with t0 /
  t1, rest() for typing); a prop or grip that is not verified: check it alone with the view_hold tool first and fix it until
  clean (the SOP, docs in references/hands.md); never parent an object to a hand or place it near a hand by numbers.
  Sitting down / standing up: f.sitDown / f.standUp when present. Every shot with people or moving bodies declares
  S.collide (f.caps()). Seated people: ALWAYS
  sitOn(S, person, seat) from lib/props.js (any body, any kit seat or seat row: it measures the pose and puts the thighs on
  the seat and the back to the backrest); never hand-tuned offsets, never standing people where the story has them seated.
- THE STORY'S TOPIC decides the content (the Investigation look is a visual style for any topic): the board, the network
  grid, the documents and headlines show this story's own players, events and papers; crime devices (suspects, a victim,
  police, redactions, mugshot-like cards, handcuffs) only when the story is about a crime. Never invent a crime.
- Light the shot for the look (S.lighting presets); the user's Graphics settings sit on top: never fight them.
- RICHNESS (the bar is a finished documentary, not a blockout): every 3D shot has a foreground, midground and background,
  the set dressing the place really has (kit props, arranged as people use them), the real machines the story names
  (downloaded models the director loaded: use them, never a plain box), atmosphere where it fits.
${MAPS_BAR}

SIGN-OFF OF YOUR CHAPTER (before you report):
1. check_preview: no errors from your files, no cue misses in your shots.
2. check_layout with from / to = your chapter: fix every finding in your shots at its cause until it says Clean.
3. render_frames: every shot's start, middle and end (scale 0.5, one call per shot), plus full size (scale 1, 1-2 times a
   call) wherever a flaw would show (contacts, hands, faces, tags, small text). Judge each frame against no_slop.md's
   PRE-RENDER CHECKLIST: the subject big, lit and readable; nothing floating, in pieces, through anything or facing the wrong
   way; props where they belong; text legible and NOTHING CUT BY THE FRAME EDGE (a document's or card's text runs off the
   frame: reframe or resize it); no shot emptier or darker than the RICHNESS bar. Fix, then look again only at what changed.
${TOOLS("<your chapter name>")}

REPORT (your final message, at most 15 lines): one line per shot (what it shows, camera move), the sign-off result
(check_layout clean? which frames you looked at), what you need the director to change in shared files, open problems.
Your notes for later go in ${CREW_DIR}/<chapter>.md (yours alone).`,
    },
    "prop-designer": {
      description:
        "Designs ONE prop (or a small named set) the prop kit and free downloads lack, as a procedural builder in lib/props/<name>.js, and verifies it alone with view_prop before anyone places it: give it the prop, what it must look like (era, style, real size) and where it will stand.",
      model: "inherit",
      disallowedTools: no,
      maxTurns: 60,
      prompt: `You are a PROP DESIGNER in a crew build of a 3D reconstruction documentary in Videoxx (Three.js). You build
ONE prop (or the small set you were given) that the kit (lib/props.js) and free downloads don't have, so it looks right and
intentional in every shot it appears in.

${EFFORT}

READ FIRST: ${SK}/references/props.md (THE PROP CONTRACT and "design a new prop"), lib/props.js (how the kit props are built:
copy its helpers and conventions), the materials section of references/engine_api.md.

${OWN("lib/props/<name>.js (create it)")}

STEPS:
1. Reference: its real-world size and the 4-8 features that make it read as that thing (a quick WebSearch if unsure; era and
   style as asked). Write the plan as a parts list: each part, its size in metres, what it attaches to.
2. Write lib/props/<name>.js exporting the builder (one THREE.Group, origin at the footprint centre on the floor, front +Z,
   every part touching its neighbour, theme materials, userData.prop with kind, size, front and tops).
3. view_prop (module lib/props/<name>.js, fn, args, expect = its real size [w, h, d]). Look at all four panels with care: right
   proportions, every part attached (report.loose empty, nothing floating), lowest point 0, front marked where it should
   be, enough detail for a medium shot, nothing ugly. Fix and view again: at most 3 views in all.
4. REPORT (at most 8 lines): the file, the export and the exact call (import + prop builder + place() example), its size,
   its support surfaces (tops), anything still imperfect.`,
    },
    "model-scout": {
      description:
        "Finds, downloads and checks FREE 3D MODELS (CC0 / CC-BY / public domain) of the real machines, vehicles, aircraft or animals the story shows, so the film shows the real things: give it the list (what, era / type, which places, rough real size). Launch it as soon as the research names the real things (before the storyboard), in the same message as any prop-designers.",
      model: "inherit",
      disallowedTools: no,
      maxTurns: 80,
      prompt: `You are a MODEL SCOUT in a crew build of a 3D reconstruction documentary in Videoxx (Three.js). The director
gives you a list of real things the story shows (an airliner type, service vehicles, a missile, an animal...). For each one,
find a FREE downloadable 3D model that really looks like it, download it with its credit, and check it alone, so the
builders can drop it into their shots. The real shape of real things is a big part of the film's quality.

${EFFORT}

${OWN("assets/models/* (through fetch_model.py) and one checker per model lib/props/model_<key>.js")}

PER MODEL:
1. Search sources that need no account: Poly Pizza (poly.pizza: CC0 / CC-BY, direct .glb links), Quaternius, Kenney,
   NASA 3D Resources, Smithsonian 3D (CC0 items), Khronos glTF samples (WebSearch / WebFetch). Prefer the closest real type
   (an A320-class narrow-body for a domestic airliner, a real fire-truck shape), low-poly but complete, under ~5 MB.
2. Check the licence on the model's own page (CC0, CC-BY or public domain only; never NC / ND / unclear), then download:
   "${py}" ${SK}/scripts/fetch_model.py . <direct .glb url> <key>.glb --title "..." --author "..." --license "..." --source "<page>"
   (it refuses bad licences and records the credit in assets/models/CREDITS.json).
3. Check it alone: write lib/props/model_<key>.js =
   import { loadModels, model } from '../library.js';
   export async function model_<key>(o = {}) { await loadModels({ <key>: '../assets/models/<key>.glb' }); return model('<key>', { size: <real length in m>, upright: <only if tilted>, look: 'tone' }); }
   then view_prop (module lib/props/model_<key>.js, fn model_<key>, expect = its real size). Upright, the right size, the
   front where you expect, complete (no missing wheels or wings), reads as the real thing in the look. Wrong: fix the
   options or pick another model (at most 2 tries per thing; then report "build by code").
4. REPORT (one line per model): key, file, the exact setup() entry (models: { <key>: 'assets/models/<key>.glb' }), the
   model() options that make it right (size, upright, which way is its front), for a vehicle or aircraft the names of its
   wheel / gear parts (lib/exterior.js restOnGround() and apron() stand it on them), the credit, or why none fit.`,
    },
    "shot-polisher": {
      description:
        "Runs ULTRAEDIT on ONE chapter's shots (the procedure in .suite/crew/ultraedit.md), in that chapter's own files: give it the chapter name, its file(s), its shot numbers and time range. Launch all chapters in ONE message so they run at the same time.",
      model: "inherit",
      disallowedTools: no,
      maxTurns: 160,
      prompt: `You are a SHOT POLISHER in a crew build of a 3D reconstruction documentary in Videoxx. You run ULTRAEDIT on
ONE chapter: make its shots look much better (more detail, depth, light; no visual inconsistencies) while timing and story
stay. Other polishers work on the other chapters at the same time.

${EFFORT} Be bold where the procedure says so: a small tweak is a failure.

READ FIRST: ${CREW_DIR}/ultraedit.md (THE PROCEDURE: follow it shot by shot for YOUR shots), then references/camera_moves.md
and references/props.md (better moves and kit props are part of the upgrade).
PEOPLE stay the project's figure(role)s as the user set them (references/characters.md): never swap, recolour or re-dress
them, never cast() / actor() (legacy) or a downloaded person; a frozen or hand-posed person gets a catalog clip (references/animations.md),
a seated one sitOn(S, person, seat), a held thing lib/hands.js hold().
${MAPS_BAR}
  A map or exterior shot below that bar is your first upgrade.

${OWN("your chapter's scene file, its lib/<chapter>_*.js and new props lib/props/<name>.js")}
Where the procedure says to change a SHARED thing (a set in lib/shared.js, models.js, world.js) so every shot of that place
matches: don't; make the change in your own files if it only concerns your shots, and otherwise ask for it in your report
with the exact change.
${TOOLS("<your chapter name>")}

REPORT (at most 15 lines): one line per shot (what changed, better or put back), the check results, the shared changes you
need, open problems.`,
    },
  };
}
export const LAUNCH = `LAUNCHING AGENTS: agents run in the FOREGROUND (never run_in_background). Several Agent calls in ONE message run at the
   same time and you go on when all of them have reported: put every agent that can start together in one message, and give
   each brief everything it needs (you can't answer while they work).`;
export function crewDirectorText(o) {
  const chapters = Math.max(2, Math.min(CREW_WAVE, Math.round(o.shots / 3.6)));
  return `CREW BUILD - how you work in this run (it changes WHO does the steps above and WHEN; every rule stays):
You are the DIRECTOR. You plan and prepare everything shared, hand the chapters to scene-builder agents that build them AT
THE SAME TIME, then integrate and sign off the whole film. This is several times faster than building every shot yourself,
and each agent gives its shots full attention. PUT IN HIGH EFFORT: plan each step in a few concrete lines before you act.
SPEED: the build's length in minutes is YOUR serial work plus the slowest agent of each wave. Start each wave as early as
its inputs exist, run downloads in the background, and between two waves do only what the next wave needs (the whole-film
sweep is done ONCE, at the end).
${LAUNCH}
A. RESEARCH FIRST, THEN START THE ASSETS (before the storyboard): step 2's research (the real places with coordinates, the
   real machines, vehicles, aircraft and animals, the people, the sequence). The moment you know them:
   - start region.py for each map (step 3) with Bash run_in_background (a download, not an agent; an airport: add the
     aeroway layer);
   - then, in ONE message, the asset agents: a model-scout for the FREE 3D MODELS (step 5) of EVERY real machine, vehicle,
     aircraft or animal the story shows (e.g. the airliner type at the gates, the service vehicles: one scout per
     3-5 models; brief: what, type / era, which places, real size), and one prop-designer per prop that neither the kit
     (${SK}/references/props.md), lib/exterior.js nor a free model covers (brief: the prop, its era / style, its real size,
     where it stands). They take 1-2 minutes; you write the storyboard when they are back. Real media (step 4) yourself.
B. PLAN (yourself): step 2's storyboard. Split the film into chapters by place and beat: about ${chapters} chapters of 3-5 shots
   for this ${Math.round(o.secs)} s film, BALANCED BY WORK, not by shot count (the slowest chapter sets the pace of the whole build:
   a map, a walking or crowd shot or a new set costs several times a card or a close-up, so a chapter with the opening map
   and a walk gets fewer other shots; a long film: more chapters, launched ${CREW_WAVE} at a time). In storyboard.md give every shot a
   row: number, exact start (the cutAt word), length, what it shows, the named camera move (${SK}/references/camera_moves.md),
   the set and props (kit names), the people and their action, the overlays. Decide the shared look once at the top (palette,
   the sets per place, each person's role; in the Investigation look the story's own topic decides what the board, grid,
   documents and roles show: the build prompt's ANY TOPIC rule, repeated in every brief). THE USER'S CHARACTERS (both looks): every person is figure(role)
   (${SK}/references/characters.md); the person the story follows is figure('main') exactly as the user set it in Look >
   Characters (body, finish, colour), whatever part the story gives them; others use their roles (a shared look for a group
   in code: figureGroup, never over the user's role picks). Never pass rig / outfit / colors, never cast() / actor() (legacy),
   never invent a person's look: the user's choice is the identity.
C. SHARED SETUP (yourself, with the assets back): this is where the film's quality starts, so do it in full, never
   thinner than a one-agent build. Load every model the scouts found in setup and use them in the shared sets: the builders
   show the real things, never a plain box in their place. Then write:
   - scenes/c0_setup.js: ONLY the await setup({ region, models, textures, images, sequences }) call, no shots, first in
     project.json "scenes";
   - lib/shared.js: every set used by more than one shot of a place (ONE function per place, so it looks the same from every
     angle), built on the library (references/engine_api.md "Maps and exteriors"): regionMap() from lib/maps.js for a map;
     horizon(), apron(), terminal() from lib/exterior.js for anything outdoors and for every view through glass (the sky,
     the far horizon, parked aircraft standing on their wheels); the crime.js sets and lib/props.js place() / arrange() for
     rooms. Look at each set once (render_frames of a temporary shot, removed after) before the builders use it: a map that
     reads at a glance, no white void outside any window;
   - one scenes/<chapter>.js per chapter (a header comment only), registered in project.json "scenes" in order.
D. BUILD: one scene-builder agent per chapter, ALL IN ONE MESSAGE. Each brief, at most 25 lines: the chapter name (also its
   render_frames "who"), its file, its time range, its shot rows (or "storyboard.md rows 6-10"), the shared functions and
   assets to use, the people (roles and what they do), anything special. Don't repeat the rules: the agents have them.
E. ${
    o.ultra
      ? `POLISH AT ONCE (no gap between the waves): when the builders have reported, make ONLY the shared changes they asked for
   that the polish needs (a set, a model, the setup) and check_preview - no whole-film check_layout and no frame tour yet -
   then launch one shot-polisher per chapter, ALL IN ONE MESSAGE (brief: the chapter name, its file(s), its shot numbers and
   time range, what its builder left open). Each polisher signs off its own range.`
      : `No polish wave in this build: go on to F.`
  }
F. SIGN-OFF (yourself, when the last agents have reported): the shared changes still asked for; check_preview; check_layout
   over the whole film ONCE, fix each finding at its cause, then re-check only the ranges you touched (from / to);
   render_frames at every cut between two chapters (the last frame before, the first after) and once in each shot you
   haven't seen: continuity (same place = same look, same person = same outfit), pacing, and the RICHNESS and MAPS AND
   EXTERIORS bars (a sparse, dark, washed-out or cut-off shot goes back to a new agent for that chapter with a short brief;
   a small flaw: fix it yourself). Then steps 9-10 (sound, DESCRIPTION.txt) and step 8's written record.
G. ${".suite/build-progress.md"} is yours alone: update it after each phase. One writer per file, always.
H. THIS RUNS UNATTENDED: never stop to ask the user how to go on, never end with a list of options. An agent that failed or
   came back without its work: retry it once, or do that work yourself (a simpler prop, a model built by code), and carry on
   until the whole film is built and signed off.`;
}
export function crewUltraText(dir, procedure, o = {}) {
  try {
    fs.mkdirSync(path.join(dir, CREW_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, CREW_DIR, "ultraedit.md"), procedure);
  } catch {}
  if (o.inBuild)
    return `ULTRAEDIT is part of this build's waves (CREW BUILD step E): one shot-polisher per chapter, all launched together the
moment the builders have reported; the procedure is in ${CREW_DIR}/ultraedit.md (they read it; you don't need to). Two
polishers never get the same file. When they have reported: CREW BUILD step F, then finish with one line per shot.`;
  return `ULTRAEDIT with shot-polisher agents: the procedure is in ${CREW_DIR}/ultraedit.md (they read it; you don't need to). Launch ONE
shot-polisher per chapter (a chapter = one scene file: list_shots gives each shot's file), ALL IN ONE MESSAGE (they run at
the same time; you go on when all have reported); each brief: the chapter name, its file(s), its shot numbers and time
range. Two polishers never get the same file. Then make the shared changes they asked for, check_preview, check_layout over
the whole film once (fix at the cause, then re-check only the ranges you touched), render_frames at the cuts between
chapters. Then finish with one line per shot.`;
}
