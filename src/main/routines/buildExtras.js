export const SCRIPT_PRESETS = [
  { value: "balanced", label: "Balanced", detail: `` },
  {
    value: "deep",
    label: "Deep research, fact-checked",
    detail: `Research deeply before writing: read several independent sources (articles, blog posts, forums, papers, official pages, interviews), cross-reference every key claim, number, name and date in at least two of them, and dig past the first results for the lesser-known details that make the story worth watching. Double-check every fact once the script is written and fix anything you could not verify. Keep each fact with its sources in research.md.`,
  },
  {
    value: "fast",
    label: "Fast draft",
    detail: `Work fast: one short research pass for the key facts (a few searches), then write the script. No long polishing rounds; correct facts and the target length still matter.`,
  },
  {
    value: "human",
    label: "Human and conversational",
    detail: `Make it sound like one real person talking, not AI writing: vary the sentence length, use contractions and plain words, talk to the viewer ("you"), allow a little personality and humour where it fits. No clichés (delve, tapestry, testament, game-changer, in today's world), no lists of three, no em dashes, no "it's not X, it's Y". Read it aloud in your head and rewrite anything stiff.`,
  },
];
export const BUILD_COST = "Uses more Claude (a longer, costlier build) for a higher-quality video.";
const PIXEL_FOOTAGE = `Expand the color palette for easier visibility, enhance contrast and outlines, add more detail into the models. Up the resolution a little. Want to have tons and tons of real game footage, gifs and images. Search the web, youtube, forums, before downloading visually verify. Don't worry about copyrights it falls under fair use. - don't need to name sources. Every other scene must have at least one real game footage or asset. Try to avoid reusing the same scenes. Put in extra effort, visually verify your work, fix any inconsistencies or visibility issues.`;
export const BUILD_EXTRAS = [
  {
    key: "depth",
    label: "Real footage: more real media, richer look",
    short: "Real footage",
    detail: `More real media: real photos, screenshots and short clips of the actual things, people and places the narration names, found on the web. Check each one shows what its words say before you use it, never show the same one twice, and keep it readable in the frame.`,
    styles: {
      "pixel-art": { label: "Real footage: more real game footage and images, richer look", text: PIXEL_FOOTAGE },
      collage: { off: "Vox pictures are made with make_image: how many is the style's Pictures per minute setting." },
      flat: { off: "Flat explainer is drawn entirely in code: it shows no real media." },
      stickman: {
        off: `Real photos are the style's own "Use real images from the web" setting (New project, Project settings in the editor, or a routine's Create project).`,
      },
      lowpoly: { off: "Low poly shorts shows 3D library models, not real photos or footage." },
      toon: { off: "3D cartoon shorts builds its own cartoon characters, sets and props: it shows no real photos or footage." },
      stickstory: {
        off: "Stick stories draws everything itself (its stick people, sets, maps and graphics): it shows no real photos or footage.",
      },
      recon: {
        off: `Real photos and film are the style's own "Real photos and footage" setting (New project, Project settings in the editor, or a routine's Create project).`,
      },
      vox: { off: 'The old Vox editorial style draws its "photos" in code: it shows no real media.' },
    },
  },
  {
    key: "props",
    label: "Extra depth and props: more assets, more detailed scenes",
    short: "Extra depth and props",
    detail: `Find and build more assets: every scene gets more props, set dressing and background detail that belong to the story (no clutter for its own sake), and every model and prop gets more detail (shape, small parts, texture, shading). Check each new asset on its own at full size with render_frames before you use it in a scene: it must read clearly as what it is. Fix anything flat, broken or unclear.`,
    styles: {
      "pixel-art": {
        text: `EXTRA DEPTH AND PROPS: every scene gets more props and set dressing that belong to the story (furniture, machines, signs, background characters, terrain detail), and every model gets more parts and shape so it reads at the art resolution: clear silhouettes, palette ramps for form, outlines that separate it from what is behind. Check each new model alone with render_frames at full size before it goes into a scene.`,
      },
      collage: {
        text: `EXTRA DEPTH AND PROPS: richer panels built from the engine's own paper elements: torn paper layers, tape, stamps, typewriter labels, handwritten notes, arrows and background print, so every panel has a foreground, a subject and a background. Use the cut-outs you already have more fully (crops, repeats as small background pieces); stay within the Pictures per minute pace for new make_image pictures. Check every panel with render_frames and check_layout.`,
      },
      flat: {
        text: `EXTRA DEPTH AND PROPS: more procedural props, icons, background shapes and diagram detail in every shot, all by the flat rules (rounded primitives, one light from the top-left, one colour per concept). Every new element is checked alone at full size with render_frames before it goes into a shot, and check_layout must stay clean (nothing cut off, nothing really overlapping, nothing in the caption band).`,
      },
      stickman: {
        label: "Extra depth and props: more drawn characters and objects",
        text: `EXTRA DEPTH AND PROPS: more and better sprites: extra people, animals and objects where the story has them (made with make_sprites, each with a clear face and expression), varied backdrops so no two neighbouring pictures look alike, and the small visual jokes the style lives on. (The "More details" setting adds backdrop clutter; this is about the characters and objects.) Check every new sprite in its picture with render_frames.`,
      },
      lowpoly: {
        text: `EXTRA DEPTH AND PROPS: every set gets more library props and dressing that belong to the story (search the asset library with lowpoly_asset, add free CC0 / CC-BY finds with it), extras in the background where the place would have people (S.crowd), a real foreground, midground and background in every shot, and lamps, screens and signs that glow. Nothing passes through anything (check_layout).`,
      },
      toon: {
        text: `EXTRA DEPTH AND PROPS: every set is dressed even more densely with the engine's props that belong to the story (S.prop, S.scatter, the prop kit in the skill's references/props.md and the places in references/catalog.md): a real foreground, midground and background in every shot, background characters where the place would have people, clutter on every shelf, desk and wall, and lamps, screens and signs that glow. No bare floor or wall fills a frame. Nothing passes through anything (check_layout).`,
      },
      stickstory: {
        text: `EXTRA DEPTH AND PROPS: every set gets more of the engine's places and props that belong to the story (S.place, S.prop: the skill's references), drawn in the style's flat-vector look: a real foreground, midground and background card at real depths in every shot (parallax and depth of field), background people where the place would have them, clutter on desks, shelves and walls, and lamps, screens and windows that glow. The HUD graphics, maps and diagrams get their small details too (labels, icons, gridlines, markers). No flat backdrop fills a frame; nothing passes through anything (check_layout).`,
      },
      recon: {
        text: `EXTRA DEPTH AND PROPS: find more free 3D models (CC0 / public domain / CC-BY, credited) and build more procedural props, so every scene is a full, period-correct set: ground detail, vehicles, equipment, buildings, background people where they belong, real terrain under outdoor shots. Every model gets its small parts (hatches, rails, antennas, wheels, windows). Check each new asset alone at full size (front and side) before it goes into a shot; nothing generic, flat or floating.`,
      },
    },
  },
  {
    key: "polish",
    label: "Higher attention to detail and animation",
    short: "Detail and animation",
    detail: `Higher attention to detail and animation: every move eases in and out with follow-through, nothing snaps or pops, secondary motion where it makes sense, every on-screen event lands exactly on its word, camera moves have a purpose, and the small things are right (alignment, spacing, consistent colours and sizes). Go through each shot once more just for motion and polish.`,
    styles: {
      "pixel-art": {
        text: `HIGHER ATTENTION TO DETAIL AND ANIMATION: characters and props move with eased starts and stops and a little follow-through, nothing pops in or out (it enters, exits or transitions), the HUD (titles, labels, counters) lands exactly on its word, camera pushes are slow and purposeful, and motion stays pixel-stable (no shimmering edges). Go through each shot once more just for motion and timing.`,
      },
      collage: {
        text: `HIGHER ATTENTION TO DETAIL AND ANIMATION: every cut-out, label and line lands with the engine's own animators exactly on its word, handwriting and typewriter text finish before the next beat, no panel holds still for long, whip-pans between panels are clean, and sizes, angles and spacing are consistent across the page. Go through each panel once more just for motion and timing.`,
      },
      flat: {
        text: `HIGHER ATTENTION TO DETAIL AND ANIMATION: the character acts with real follow-through (anticipation, drag, squash and stretch, blinks), lines draw on and land, icons and labels arrive exactly on their word with a small overshoot, transitions carry motion from one shot into the next, and nothing snaps or pops. Follow the skill's QUALITY_STANDARD.md for every element. Go through each shot once more just for motion.`,
      },
      stickman: {
        label: "Higher attention to detail and timing",
        text: `HIGHER ATTENTION TO DETAIL AND TIMING (this style is still pictures, so it is about timing and drawing): every picture changes exactly on its clause and none stays up longer than about 4.5 s, faces and poses show what the words say, labels and date cards are spelled right and readable, beats (@word) land on their word, and no picture repeats an earlier one. Check with render_frames across the whole video.`,
      },
      lowpoly: {
        text: `HIGHER ATTENTION TO DETAIL AND ANIMATION: every person acts the clause with a library clip that fits it (gestures, walks at the clip's own speed, sits, phone calls, falls), changes expression on the right word (expr) and looks at what matters (lookAt); props move on their words with sfx on the frame; the camera move fits the beat (push-in, dutch insert, POV, fast pull-out); callouts and banners land exactly on their word.`,
      },
      toon: {
        text: `HIGHER ATTENTION TO DETAIL AND ANIMATION: every character acts the clause (a gesture landing just before the stressed word, walks with planted feet, hops, reactions), the face changes expression on the right word and the eyes look at what matters (look, headTo), secondary motion where it belongs, props move on their words with sfx on the frame, and the camera move fits the beat (creep, push, reveal, a quick reaction push-in). Smooth eased motion only: nothing snaps, pops or slides (the skill's references/motion.md).`,
      },
      stickstory: {
        text: `HIGHER ATTENTION TO DETAIL AND ANIMATION: every stick person acts the clause (a pose or gesture landing just before the stressed word, walks with planted feet, reactions, hand close-ups for what they touch), the eye and mouth shapes change on the right word, heads turn toward what matters, secondary motion where it belongs (clothes, a held prop, a breath), HUD graphics, counters, map routes and diagram parts arrive exactly on their words with eased motion, and the camera creeps, pushes or pans with the beat. Nothing snaps, pops or slides.`,
      },
      recon: {
        text: `HIGHER ATTENTION TO DETAIL AND ANIMATION: motion along arc-length curves with eased starts and stops, secondary motion (water, dust, smoke, cloth, bobbing, idle sway of people), hands and feet that really touch what they hold and stand on, physically plausible speeds and attitudes, cameras that follow after the subject moves and never swing on a wobbling heading, more camera angles where the story turns, every event on its word. Check moving moments with consecutive frames.`,
      },
    },
  },
  {
    key: "scenes",
    label: "Extra verification layer",
    short: "Extra verification",
    detail: `When the build is done, go through the video scene by scene: render frames of every shot (its start, middle and end) and look at each one. Nothing important may be covered, cut off by the frame, overlapping or hard to read (titles, labels, characters, footage, props). Fix every problem and look again until each scene is clean.`,
    styles: {
      "pixel-art": {
        text: `EXTRA VERIFICATION LAYER: when the build is done, go through the video scene by scene: render_frames at the start, middle and end of every shot and look at each at full size. Nothing important covered or cut off, every HUD text readable against what is behind it, every model reads as what it is at the art resolution, no shot blank or broken. Fix every problem and look again until each scene is clean.`,
      },
      collage: {
        text: `EXTRA VERIFICATION LAYER: when the build is done, run check_layout until it is Clean, then a second full review: render_frames at the start, middle and end of every panel and at every whip-pan. Nothing cut off, covered or overlapping, every text readable on its paper, no cut-out with leftover background or text inside it. Fix, run check_layout again and look again until every panel is clean.`,
      },
      flat: {
        text: `EXTRA VERIFICATION LAYER: when the build is done, run check_layout until it is Clean, then a second full review: render_frames at the start, middle and end of every shot, at full size. Nothing cut off, covered or really overlapping, nothing in the caption band, every label readable, the character on model in every shot. Fix, run check_layout again and look again until every shot is clean.`,
      },
      stickman: {
        text: `EXTRA VERIFICATION LAYER: when the build is done, check_preview must show no unknown names and no picture that stays too long; then render_frames across the whole video (8 per call) and look at every picture: it shows what its words say, nothing is cut off or covered, every label is readable, every person has a sprite. Fix and look again until every picture is right.`,
      },
      lowpoly: {
        text: `EXTRA VERIFICATION LAYER: after check_layout is Clean, a second full review: render_frames at the start, middle and end of every shot, plus 3 frames 0.1 s apart on every walk, gesture and fall (feet planted, hands on props, nothing through anything), and full-size looks at faces and callouts. Fix what is wrong and look again at what you changed.`,
      },
      toon: {
        text: `EXTRA VERIFICATION LAYER: after check_layout is Clean, a second full review: render_frames at the start, middle and end of every shot, plus 3 frames 0.1 s apart on every walk, gesture and hop (feet planted, hands on props, nothing through anything, no pops), and full-size looks at faces (readable, the right expression) and captions (never over a face). Fix what is wrong and look again at what you changed.`,
      },
      stickstory: {
        text: `EXTRA VERIFICATION LAYER: after check_layout is Clean, a second full review: render_frames at the start, middle and end of every shot, plus 3 frames 0.1 s apart on every walk, gesture and hand close-up (feet planted, hands on what they hold, nothing through anything, no pops), and full-size looks at faces (the right eye and mouth shapes) and at every HUD graphic, map and diagram (spelled right, readable, held long enough, nothing over a face). Fix what is wrong and look again at what you changed.`,
      },
      recon: {
        text: `EXTRA VERIFICATION LAYER: after check_layout is Clean, a second full review: render_frames at the start, middle and end of every shot AND at every transition, contact, effect and fast move (several consecutive times 1/30 s apart), at full size. Look for anything passing through anything, flicker, hidden or headless people, cut-off or covered elements, wrong facts on screen. Fix, run check_layout again, look again until every shot is clean, and write the checklist with what you fixed at the end of storyboard.md.`,
      },
    },
  },
  // Ultraedit: after the build, Opus goes through every shot itself: stills, why it looks bad, a bold fix, one check. The
  // procedure is written by sessions.ts (ultraText); this text only announces it. A build with it runs on Opus 5.5.
  // The editor's Ultraedit button runs the same pass on picked shots of a finished video.
  {
    key: "ultra",
    label: "Ultraedit: Opus upgrades every shot after the build",
    short: "Ultraedit",
    detail: `ULTRAEDIT: when the build is done and checked, run the ULTRAEDIT pass described at the end of this task: shot by shot, look at stills, say why it looks bad, fix it boldly (more detail and depth, no visual inconsistencies), check it once.`,
  },
  // Ultraedit+ (3D reconstruction only, docs/ULTRAEDIT_PLUS.md): a painted target frame per shot BEFORE each scene is built,
  // every scene built to match its targets, then the measured match loop per shot (sessions.ts ultraPlusText replaces the
  // Ultraedit pass). Tools: make_target / match_shot / critic_shot (claude/tools.ts, ultraplus.ts).
  {
    key: "ultraplus",
    label: "Ultraedit+: a painted target frame per shot, each shot rebuilt to match it",
    short: "Ultraedit+",
    only: ["recon"],
    onlyWhy: "Ultraedit+ is for 3D reconstruction videos for now.",
    detail: `ULTRAEDIT+ TARGETS: after storyboard.md is written and BEFORE you build any scene, call make_target once for every shot (its number, and a prompt with the subject, action, place, camera, light and mood the storyboard gives it; text-to-image). Look at each target. Then build every scene to match its shots' targets from the start (camera first, then the layout, poses, materials, light). The ULTRAEDIT+ match loop at the end of this task replaces the Ultraedit pass.`,
  },
];
export const HIGH_EFFORT_EXTRAS = [];
export const EFFORT_LAYERS = [
  { key: "props", name: "More depth", adds: "more props, set dressing and model detail in every scene" },
  { key: "polish", name: "Polished", adds: "smoother animation: eased moves, follow-through, every event on its word" },
  { key: "scenes", name: "Verified", adds: "a second full review: every shot checked at its start, middle and end, and fixed" },
  {
    key: "ultra",
    name: "Ultraedit",
    adds: "after the build, Opus goes through every shot: looks at stills, says why it looks bad, and fixes it boldly",
  },
  {
    key: "ultraplus",
    name: "Ultraedit+",
    adds: "a painted target frame per shot (your image service, about 1-5 cents each); every scene is built to match it, then Opus matches each shot pass by pass with a fresh critic scoring it (instead of the plain Ultraedit pass)",
  },
];
function qualityLevels(base) {
  const list = extrasFor(base),
    layers = EFFORT_LAYERS.filter((l) => list.some((x) => x.key === l.key && !x.off));
  return [
    { key: "standard", name: "Standard", adds: "A normal build: storyboard, every shot on its words, checked against rendered frames." },
    ...layers.map((l, i) => ({ key: l.key, name: l.name, adds: `${i ? "Everything before, plus " : "Adds "}${l.adds}.` })),
  ];
}
function levelExtras(level, base) {
  const lv = qualityLevels(base),
    i = lv.findIndex((l) => l.key === level);
  return i < 0 ? [] : lv.slice(1, i + 1).map((l) => l.key);
}
export function nodeLevel(s) {
  if (s?.level === "standard" || EFFORT_LAYERS.some((l) => l.key === s?.level)) return s.level;
  let k = "standard";
  for (const l of EFFORT_LAYERS) if (s?.[l.key]) k = l.key;
  return k;
}
export const levelName = (key2) => EFFORT_LAYERS.find((l) => l.key === key2)?.name ?? "Standard";
export const TIME_LIMIT_BASES = ["toon", "stickstory", "recon"];
export function timeLimitText(minutes, ultra, start = new Date()) {
  const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    end = new Date(start.getTime() + minutes * 6e4);
  return (
    `TIME LIMIT: you have ${minutes} minutes for this whole build${ultra ? ", the Ultraedit pass included" : ""}. It is ${hm(start)} now: finish by ${hm(end)} (run \`date\` between steps to check the clock). Work faster than usual to finish on time: plan once, build each part in one go, keep the checks short (render_frames on what changed, not every frame), and give every agent you start this deadline. ` +
    (ultra ? `In the Ultraedit pass, fix the weakest shots first and stop polishing when the time is up. ` : "") +
    `A complete, clean video on time beats a perfect half: never leave a shot unbuilt. Believe in yourself.`
  );
}
export const hideTimeLimit = (text) =>
  text.replace(/TIME LIMIT: you have (\d+) minutes[\s\S]*?Believe in yourself\./g, "($1 min limit)").trim();
export function nodeBuildExtras(s, base) {
  const list = extrasFor(base),
    media = list.find((x) => x.key === "depth");
  const extras = [...(s.depth && media && !media.off ? ["depth"] : []), ...levelExtras(nodeLevel(s), base)];
  return { extras, skipped: s.depth && media?.off ? [media] : [] };
}
export const extrasFor = (base) =>
  BUILD_EXTRAS.map((x) => {
    if (x.only && (!base || !x.only.includes(base)))
      return { key: x.key, label: x.label, short: x.short, detail: "", off: x.onlyWhy ?? "Not for this style." };
    const w = base ? x.styles?.[base] : void 0;
    if (w && "off" in w) return { key: x.key, label: x.label, short: x.short, detail: "", off: w.off };
    return { key: x.key, label: w?.label ?? x.label, short: x.short, detail: w?.text ?? x.detail, off: null };
  });
export const extrasText = (keys, base) =>
  extrasFor(base)
    .filter((x) => !x.off && keys?.includes(x.key))
    .map((x) => x.detail);
