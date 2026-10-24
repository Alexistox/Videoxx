import { CLAUDE_EFFORTS } from "../src/renderer/src/engines/claudeModels";

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
const EFFORT_LAYERS = [
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
export function qualityLevels(base) {
  const list = extrasFor(base),
    layers = EFFORT_LAYERS.filter((l) => list.some((x) => x.key === l.key && !x.off));
  return [
    { key: "standard", name: "Standard", adds: "A normal build: storyboard, every shot on its words, checked against rendered frames." },
    ...layers.map((l, i) => ({ key: l.key, name: l.name, adds: `${i ? "Everything before, plus " : "Adds "}${l.adds}.` })),
  ];
}
export function levelExtras(level, base) {
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
export const levelName = (key) => EFFORT_LAYERS.find((l) => l.key === key)?.name ?? "Standard";
export const TIME_LIMIT_BASES = ["toon", "stickstory", "recon"];
export const TIME_LIMITS = [0, 20, 30, 45, 60];
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
export const SETTING_EXTRAS = {
  recon: {
    key: "depth",
    path: "media.on",
    label: "Real photos and footage",
    detail:
      "Claude finds real photographs and archive film of the event on Wikimedia Commons (free licences, credited) and shows them in print frames between the reconstructions. The same switch as Style settings > Real photos and footage.",
  },
  stickman: {
    key: "depth",
    path: "web.on",
    label: "Use real images from the web",
    detail:
      "Claude finds real photos on Wikimedia Commons (free licences, credited) and shows them as framed pictures. The same switch as Style settings > Use real images from the web.",
  },
};
export const extrasFor = (base) =>
  BUILD_EXTRAS.map((x) => {
    if (x.only && (!base || !x.only.includes(base)))
      return { key: x.key, label: x.label, short: x.short, detail: "", off: x.onlyWhy ?? "Not for this style." };
    const w = base ? x.styles?.[base] : void 0;
    if (w && "off" in w) return { key: x.key, label: x.label, short: x.short, detail: "", off: w.off };
    return { key: x.key, label: w?.label ?? x.label, short: x.short, detail: w?.text ?? x.detail, off: null };
  });
export function upstreamStyles(g, nodeId) {
  const byId = new Map(g.nodes.map((n) => [n.id, n])),
    seen = new Set(),
    out = new Set(),
    st = [nodeId];
  while (st.length) {
    const id = st.pop();
    for (const e of g.edges)
      if (e.to === id && !seen.has(e.from)) {
        seen.add(e.from);
        st.push(e.from);
        const n = byId.get(e.from);
        if (n?.type === "createProject" && !n.off) out.add(String(n.settings?.styleId || "flat"));
      }
  }
  return [...out];
}
const SCRIPT_SKILL_OPTS = [
  { value: "use", label: "Use my scripting skill" },
  { value: "off", label: "Don't use it" },
];
const WRITE_SKILL_OPTS = [
  { value: "use", label: "My scripting skill (Settings)" },
  { value: "own", label: "This node's own skill" },
  { value: "off", label: "None: the usual way" },
];
const SCRIPT_SKILL_HINT =
  "Your way of writing scripts: the one in Settings > AI engines > Your scripting skill (used while it is on there), or one only this node uses. The choice is kept with each video, so a rewrite in the editor follows it too.";
export function writeSkillLine(s, ctx) {
  const v = s.scriptSkill ?? "use";
  if (v === "off") return "No scripting skill";
  if (v === "own")
    return !s.ownSkill?.id
      ? "Own skill: not added yet"
      : ctx?.ownSkills && !ctx.ownSkills[s.ownSkill.id]
        ? `Own skill missing: ${s.ownSkill.name || "add it again"}`
        : `Own skill: ${s.ownSkill.name || "added"}`;
  return !ctx
    ? "My scripting skill (Settings)"
    : ctx.scriptSkill === "on"
      ? `My scripting skill: ${ctx.scriptSkillName || "Settings"}`
      : ctx.scriptSkill === "off"
        ? "Settings skill is off: the usual way"
        : "No skill in Settings: the usual way";
}
const YT_FORMAT_OPTS = [
  { value: "auto", label: "Same format as this routine's videos" },
  { value: "long", label: "Long-form" },
  { value: "short", label: "Shorts" },
  { value: "both", label: "Both" },
];
export function topicFormatOf(g, n) {
  const v = n.settings?.ytFormat;
  if (v === "long" || v === "short" || v === "both") return v;
  if (v !== "auto" || !g) return "both";
  const byId = new Map(g.nodes.map((x) => [x.id, x])),
    seen = new Set([n.id]),
    st = [n.id],
    kinds = new Set();
  while (st.length) {
    const id = st.pop();
    for (const e of g.edges)
      if (e.from === id && !seen.has(e.to)) {
        seen.add(e.to);
        st.push(e.to);
        const x = byId.get(e.to);
        if (x?.type === "createProject" && !x.off) kinds.add(x.settings?.format === "vertical" ? "short" : "long");
      }
  }
  return kinds.size === 1 ? [...kinds][0] : "both";
}
const FAIL_OPTS = [
  { value: "fix", label: "Ask Claude to fix it" },
  { value: "stop", label: "Stop this video" },
  { value: "warn", label: "Continue with a warning" },
];
const STAGE_OPTS = ["idea", "script", "voiceover", "building", "review", "ready", "scheduled", "published"].map((s) => ({
  value: s,
  label: s[0].toUpperCase() + s.slice(1),
}));
export const NODES = [
  // ---------- inputs ----------
  {
    type: "topic",
    label: "Topic",
    category: "input",
    icon: "Lightbulb",
    desc: "One video about one topic.",
    accepts: null,
    out: "topic",
    fields: [
      { key: "topic", label: "Topic", kind: "text", placeholder: "Why do cats purr?" },
      { key: "notes", label: "Notes for Claude", kind: "textarea", placeholder: "Angle, facts to include, tone…" },
    ],
    defaults: { topic: "", notes: "" },
  },
  {
    type: "topicList",
    label: "Topic list",
    category: "input",
    icon: "ListOrdered",
    desc: "One video per line.",
    accepts: null,
    out: "topics",
    fields: [
      { key: "topics", label: "Topics (one per line)", kind: "textarea", placeholder: "Why do cats purr?\nHow do bees see colour?" },
      { key: "notes", label: "Notes for every video", kind: "textarea" },
    ],
    defaults: { topics: "", notes: "" },
  },
  {
    type: "channelIdeas",
    label: "Channel ideas",
    category: "input",
    icon: "TvMinimalPlay",
    desc: "Takes the next idea cards of a channel. They become projects when their video starts.",
    accepts: null,
    out: "topics",
    fields: [
      { key: "channelId", label: "Channel", kind: "channel" },
      { key: "count", label: "How many", kind: "number", min: 1, max: 20, step: 1 },
    ],
    defaults: { channelId: "", count: 1 },
  },
  {
    type: "ideaGenerator",
    label: "Topic finder",
    category: "input",
    icon: "Sparkles",
    desc: "Reads the YouTube channel's public videos again, then Claude finds topics in the same vein (from your notes and its titles and views) and checks every one against all of them: a topic the channel already covers is replaced, so each video starts as a verified new topic.",
    accepts: null,
    out: "topics",
    claude: true,
    fields: [
      {
        key: "ytChannel",
        label: "Study this YouTube channel",
        kind: "ytfollow",
        hint: "Any channel you follow on the YouTube page: yours, or one you learn from.",
      },
      {
        key: "look",
        label: "Look at",
        kind: "select",
        options: [
          { value: "last", label: "Its latest videos" },
          { value: "all", label: "All its public videos" },
        ],
      },
      {
        key: "lastN",
        label: "How many of the latest",
        kind: "number",
        min: 1,
        max: 200,
        step: 1,
        unit: "videos",
        showIf: { key: "look", is: ["last"] },
      },
      {
        key: "ytFormat",
        label: "Never repeat these videos",
        kind: "select",
        options: YT_FORMAT_OPTS,
        unset: "both",
        hint: "Which of the channel's videos a new topic is checked against. Shorts are the channel's Shorts tab (vertical, up to 3 minutes).",
      },
      {
        key: "about",
        label: "What the channel is about",
        kind: "textarea",
        showIf: { key: "ytChannel", is: ["", void 0] },
        hint: "Only needed without a YouTube channel: with one, Claude learns it from its titles, views and description.",
        placeholder: "Retro gaming history: how old consoles and games pushed their hardware. Curious, nerdy, 10-15 min explainers.",
      },
      { key: "channelId", label: "Videos go to channel", kind: "channel", hint: "Its projects and ideas are not repeated either." },
      { key: "count", label: "New topics per run", kind: "number", min: 1, max: 20, step: 1 },
      { key: "web", label: "Research online too (what people search and ask)", kind: "toggle" },
      { key: "notes", label: "Extra notes", kind: "textarea" },
    ],
    // ytFormat 'auto' for new nodes; a node saved before it has none and keeps checking against both (topicFormatOf)
    defaults: { ytChannel: "", look: "last", lastN: 10, ytFormat: "auto", about: "", channelId: "", count: 1, web: true, notes: "" },
    newOnly: ["ytFormat"],
  },
  {
    type: "myScript",
    label: "My script",
    category: "input",
    icon: "FileText",
    desc: "Your own script: Claude does not write one.",
    accepts: null,
    out: "topic",
    fields: [
      { key: "title", label: "Title", kind: "text" },
      {
        key: "script",
        label: "Script",
        kind: "textarea",
        placeholder: 'Paste the narration. "## Section" lines are headings, not read aloud.',
      },
    ],
    defaults: { title: "", script: "" },
  },
  {
    type: "myAudio",
    label: "My audio",
    category: "input",
    icon: "AudioLines",
    desc: "Your own narration (several files are joined in order).",
    accepts: null,
    out: "topic",
    fields: [
      { key: "title", label: "Title", kind: "text" },
      { key: "files", label: "Recordings", kind: "files" },
      { key: "script", label: "Script (optional, makes timing exact)", kind: "textarea" },
    ],
    defaults: { title: "", files: [], script: "" },
  },
  {
    type: "schedule",
    label: "Schedule",
    category: "input",
    icon: "CalendarClock",
    desc: "Runs this routine by itself while the app is open. A run missed while it was closed runs once at the next start.",
    accepts: null,
    out: null,
    fields: [
      { key: "on", label: "On", kind: "toggle" },
      {
        key: "mode",
        label: "When",
        kind: "select",
        options: [
          { value: "daily", label: "Every day" },
          { value: "weekdays", label: "On these days" },
          { value: "hours", label: "Every few hours" },
        ],
      },
      { key: "time", label: "At", kind: "time", showIf: { key: "mode", is: ["daily", "weekdays"] } },
      { key: "days", label: "Days", kind: "days", showIf: { key: "mode", is: ["weekdays"] } },
      { key: "hours", label: "Every", kind: "number", min: 1, max: 168, step: 1, unit: "hours", showIf: { key: "mode", is: ["hours"] } },
    ],
    defaults: { on: true, mode: "daily", time: "09:00", days: [1, 2, 3, 4, 5], hours: 24 },
  },
  // ---------- production ----------
  {
    type: "createProject",
    label: "Create project",
    category: "production",
    icon: "FolderPlus",
    desc: "Makes the project (uses the topic's script or audio when it has one) and puts it on the channel's board.",
    accepts: ["topic", "topics"],
    out: "project",
    provides: ["project"],
    fields: [
      { key: "name", label: "Name", kind: "text", hint: "{topic}, {channel}, {n}, {date}" },
      { key: "channelId", label: "Channel", kind: "channel" },
      { key: "styleId", label: "Style", kind: "style" },
      { key: "presetId", label: "Look", kind: "look" },
      {
        key: "format",
        label: "Format",
        kind: "select",
        options: [
          { value: "landscape", label: "Wide 16:9" },
          { value: "vertical", label: "Tall 9:16" },
        ],
      },
      { key: "length", label: "Length", kind: "length" },
      { key: "language", label: "Language", kind: "language" },
      {
        key: "character",
        label: "Main character",
        kind: "select",
        onlyBase: ["flat"],
        options: [
          { value: "default", label: "My default" },
          { value: "random", label: "A new random one" },
          { value: "none", label: "No main character (decide later)" },
        ],
      },
      {
        key: "reconMedia",
        label: "Real photos and footage",
        kind: "toggle",
        onlyBase: ["recon"],
        detail:
          "Claude finds real photographs and archive film of the event on Wikimedia Commons (free licences, credited) and shows them between the reconstructions.",
      },
      {
        key: "reconPerMin",
        label: "Real pictures per minute",
        kind: "range",
        min: 0,
        max: 4,
        step: 1,
        onlyBase: ["recon"],
        showIf: { key: "reconMedia", is: [true] },
        hint: "1 is one real photo or film clip a minute.",
      },
      {
        key: "reconModels",
        label: "Free 3D models from the web",
        kind: "toggle",
        onlyBase: ["recon"],
        detail:
          "Real machines, vehicles and animals as free downloaded 3D models (CC0 / CC-BY, artists credited in the description), restyled to clay. Off: everything is modelled by code.",
      },
      {
        key: "reconMaps",
        label: "Real maps of the places",
        kind: "toggle",
        onlyBase: ["recon"],
        detail: "Maps and terrain of the real places from OpenStreetMap and elevation data (only what existed at the time).",
      },
      {
        key: "detail",
        label: "More details",
        kind: "toggle",
        onlyBase: ["stickman"],
        detail:
          "Busier pictures: the drawn backdrops get extra clouds, birds and ground clutter, and Claude adds 1-3 more props, labels or annotations to every shot.",
      },
      {
        key: "webImages",
        label: "Use real images from the web",
        kind: "toggle",
        onlyBase: ["stickman"],
        detail:
          "Claude looks up real photos of the places, objects, documents and people the narration names on Wikimedia Commons (free licences, credited in the project) and shows them as framed pictures.",
      },
      {
        key: "webPerMin",
        label: "Real images per minute",
        kind: "range",
        min: 0,
        max: 6,
        step: 1,
        onlyBase: ["stickman"],
        showIf: { key: "webImages", is: [true] },
        hint: "How aggressively real photos are used: 1 is a few, 6 is one every 10 seconds.",
      },
      {
        key: "brand",
        label: "Brand colour",
        kind: "color",
        hint: "Your channel's colour for the style's accents (cards, labels, highlights). Empty: the look's own colours.",
      },
      {
        key: "project",
        label: "This project's settings",
        kind: "projectChoices",
        hint: "The same as Project settings in the editor, stored with each project it makes. The routine's own Claude model and effort (Routine settings) still come first for its steps.",
      },
    ],
    defaults: {
      name: "{topic}",
      channelId: "",
      styleId: "flat",
      presetId: "",
      format: "landscape",
      length: 120,
      language: "",
      character: "default",
      detail: false,
      webImages: false,
      webPerMin: 2,
      reconMedia: true,
      reconPerMin: 1,
      reconModels: true,
      reconMaps: true,
      brand: "",
      project: {},
    },
  },
  {
    type: "writeScript",
    label: "Write script",
    category: "production",
    icon: "PenLine",
    desc: "Claude researches and writes the script (skipped when the video has one).",
    accepts: ["project"],
    out: "project",
    needs: ["project"],
    claude: true,
    fields: [
      { key: "preset", label: "How to write it", kind: "select", options: SCRIPT_PRESETS.map((p) => ({ value: p.value, label: p.label })) },
      { key: "notes", label: "Notes for Claude", kind: "textarea" },
      { key: "tolerance", label: "Length within", kind: "number", min: 2, max: 50, step: 1, unit: "%" },
      { key: "tries", label: "Rewrites when off", kind: "number", min: 0, max: 3, step: 1 },
      { key: "overwrite", label: "Write it even if there is a script", kind: "toggle" },
      { key: "scriptSkill", label: "Scripting skill", kind: "select", options: WRITE_SKILL_OPTS, hint: SCRIPT_SKILL_HINT },
      {
        key: "ownSkill",
        label: "This node's skill",
        kind: "scriptSkillOwn",
        showIf: { key: "scriptSkill", is: ["own"] },
        hint: "A skill folder (with SKILL.md), one .md or .txt file, or pasted text: only text, up to 1 MB. Kept with this routine; Settings is not changed.",
      },
    ],
    defaults: { preset: "balanced", notes: "", tolerance: 10, tries: 1, overwrite: false, scriptSkill: "use", ownSkill: null },
  },
  {
    type: "scriptRules",
    label: "Script rules",
    category: "check",
    icon: "ListChecks",
    desc: "Hard rules for every script: banned and required words, sentence and total length.",
    accepts: ["project"],
    out: "project",
    needs: ["project"],
    fields: [
      { key: "banned", label: "Banned words or phrases (one per line)", kind: "textarea" },
      { key: "required", label: "Required words or phrases (one per line)", kind: "textarea", placeholder: "subscribe" },
      { key: "maxSentence", label: "Longest sentence", kind: "number", min: 0, max: 200, step: 1, unit: "words", hint: "0 = no limit" },
      { key: "minWords", label: "At least", kind: "number", min: 0, max: 2e4, step: 10, unit: "words" },
      { key: "maxWords", label: "At most", kind: "number", min: 0, max: 2e4, step: 10, unit: "words", hint: "0 = no limit" },
      { key: "onFail", label: "When a rule fails", kind: "select", options: FAIL_OPTS },
      { key: "tries", label: "Fix attempts", kind: "number", min: 1, max: 3, step: 1, showIf: { key: "onFail", is: ["fix"] } },
      {
        key: "scriptSkill",
        label: "Scripting skill for the fixes",
        kind: "select",
        options: SCRIPT_SKILL_OPTS,
        showIf: { key: "onFail", is: ["fix"] },
        hint: "When Claude fixes the script: whether it also follows the video's scripting skill (its Write script node's own one, else Settings > AI engines).",
      },
    ],
    defaults: { banned: "", required: "", maxSentence: 0, minWords: 0, maxWords: 0, onFail: "fix", tries: 2, scriptSkill: "use" },
  },
  {
    type: "voiceover",
    label: "Voiceover",
    category: "production",
    icon: "Mic",
    desc: "Reads the script aloud (ElevenLabs, Fish Audio or the local voice), then cleans and times it. Skipped when the video has narration.",
    accepts: ["project"],
    out: "project",
    needs: ["project"],
    fields: [
      {
        key: "provider",
        label: "Voiceover service",
        kind: "select",
        options: [
          { value: "auto", label: "Automatic (ElevenLabs, else Fish Audio, else local)" },
          { value: "elevenlabs", label: "ElevenLabs" },
          { value: "fish", label: "Fish Audio" },
          { value: "kokoro", label: "Local voice (Kokoro)" },
        ],
      },
      { key: "kokoroVoice", label: "Local voice", kind: "kokoroVoice", showIf: { key: "provider", is: ["kokoro", "auto"] } },
      { key: "elevenVoice", label: "ElevenLabs voice", kind: "elevenVoice", showIf: { key: "provider", is: ["elevenlabs", "auto"] } },
      {
        key: "elevenModel",
        label: "ElevenLabs model",
        kind: "select",
        showIf: { key: "provider", is: ["elevenlabs", "auto"] },
        options: [
          { value: "", label: "The one picked last in the Voiceover window" },
          { value: "eleven_flash_v2_5", label: "Flash v2.5 (fast, half price)" },
          { value: "eleven_multilingual_v2", label: "Multilingual v2 (most stable)" },
          { value: "eleven_v3", label: "Eleven v3 (most expressive)" },
        ],
      },
      { key: "fishVoice", label: "Fish Audio voice", kind: "fishVoice", showIf: { key: "provider", is: ["fish"] } },
      {
        key: "fishModel",
        label: "Fish Audio model",
        kind: "select",
        showIf: { key: "provider", is: ["fish"] },
        options: [
          { value: "", label: "The one picked last in the Voiceover window" },
          { value: "drama-3", label: "Drama 3 (newest, most expressive)" },
          { value: "s2.1-pro", label: "S2.1 Pro" },
          { value: "s2-pro", label: "S2 Pro" },
          { value: "s1", label: "S1 (older, 13 languages)" },
        ],
      },
      { key: "speed", label: "Speed", kind: "number", min: 0.7, max: 1.3, step: 0.05 },
      { key: "minMatch", label: "Words timed at least", kind: "number", min: 0, max: 100, step: 5, unit: "%" },
    ],
    defaults: { provider: "auto", kokoroVoice: "", elevenVoice: "", elevenModel: "", fishVoice: "", fishModel: "", speed: 1, minMatch: 90 },
  },
  {
    type: "cleanAudio",
    label: "Clean audio",
    category: "production",
    icon: "AudioWaveform",
    desc: "Cleans the narration (noise, levels).",
    accepts: ["project"],
    out: "project",
    needs: ["project"],
    fields: [{ key: "tighten", label: "Tighten long pauses", kind: "toggle" }],
    defaults: { tighten: false },
  },
  {
    type: "timeWords",
    label: "Time words",
    category: "production",
    icon: "Timer",
    desc: "Times every word of the narration (what the build syncs to).",
    accepts: ["project"],
    out: "project",
    needs: ["project"],
    fields: [{ key: "minMatch", label: "Script words timed at least", kind: "number", min: 0, max: 100, step: 5, unit: "%" }],
    defaults: { minMatch: 90 },
  },
  {
    type: "buildVideo",
    label: "Build video",
    category: "production",
    icon: "Hammer",
    desc: "Claude builds every scene to the narration.",
    accepts: ["project"],
    out: "project",
    needs: ["project"],
    claude: true,
    // the same quality slider as the editor's Build dialog (level: qualityLevels keys); real footage stays its own switch.
    // No level in the defaults: a routine saved with the old switches loads at its nearest level (nodeLevel).
    fields: [
      { key: "depth", label: BUILD_EXTRAS[0].label, kind: "toggle", detail: BUILD_EXTRAS[0].detail, hint: BUILD_COST },
      { key: "level", label: "Build quality", kind: "quality" },
      // 3D cartoon shorts, 3D reconstruction: a time budget for the whole build (the Ultraedit pass included); Claude is told the deadline
      {
        key: "timeLimit",
        label: "Time limit",
        kind: "number",
        min: 0,
        max: 600,
        step: 5,
        unit: "min",
        onlyBase: TIME_LIMIT_BASES,
        hint: "0 = no limit. Claude gets the deadline as a clock time and works faster (the Ultraedit pass too) to finish on time.",
      },
      { key: "notes", label: "Your own instructions", kind: "textarea" },
    ],
    defaults: { depth: false, timeLimit: 0, notes: "" },
  },
  {
    type: "qualityCheck",
    label: "Quality check",
    category: "check",
    icon: "ShieldCheck",
    desc: "Plays every frame the export will draw (and every frame around each shot change) for scene errors, then layout problems under a limit, length near the target, no blank shots. What fails goes to Claude to fix, then it checks again.",
    accepts: ["project"],
    out: "project",
    needs: ["project"],
    fields: [
      {
        key: "maxLayout",
        label: "Layout problems allowed",
        kind: "number",
        min: 0,
        max: 50,
        step: 1,
        hint: "For the styles with a layout check: Vox, Flat explainer and 3D reconstruction (on 3D: overlaps, flicker, stacked surfaces).",
      },
      { key: "lengthTol", label: "Length within", kind: "number", min: 5, max: 100, step: 5, unit: "%" },
      { key: "frames", label: "Play every frame for scene errors", kind: "toggle" },
      { key: "blank", label: "Check for blank shots", kind: "toggle" },
      { key: "onFail", label: "When a check fails", kind: "select", options: FAIL_OPTS },
      { key: "tries", label: "Fix attempts", kind: "number", min: 1, max: 3, step: 1, showIf: { key: "onFail", is: ["fix"] } },
    ],
    defaults: { maxLayout: 0, lengthTol: 25, frames: true, blank: true, onFail: "fix", tries: 2 },
  },
  {
    type: "soundDesign",
    label: "Sound design",
    category: "production",
    icon: "Music",
    desc: "Music, ambience and effects, mixed under the voice (lowered once more if it buries the voice).",
    accepts: ["project"],
    out: "project",
    needs: ["project"],
    fields: [{ key: "strict", label: "Stop if the voice is not clearly above the music", kind: "toggle" }],
    defaults: { strict: false },
  },
  {
    type: "render",
    label: "Render",
    category: "production",
    icon: "Film",
    desc: "Exports the finished video.",
    accepts: ["project"],
    out: "video",
    needs: ["project"],
    provides: ["video"],
    fields: [
      {
        key: "quality",
        label: "Quality",
        kind: "select",
        options: [
          { value: "hd", label: "Full HD" },
          { value: "uhd", label: "4K" },
        ],
      },
      { key: "captions", label: "Captions file (.srt)", kind: "toggle" },
      { key: "name", label: "File name", kind: "text", hint: "{topic}, {project}, {n}, {date}" },
      { key: "fix", label: "If a scene breaks the export, Claude fixes it and it exports again", kind: "toggle" },
    ],
    defaults: { quality: "hd", captions: false, name: "{project}", fix: true },
  },
  {
    type: "vertical",
    label: "Vertical version",
    category: "production",
    icon: "Smartphone",
    desc: "A 9:16 version: cut from the wide video, or laid out again by Claude.",
    accepts: ["project", "video"],
    out: "video",
    needs: ["project"],
    provides: ["video"],
    fields: [
      {
        key: "source",
        label: "How",
        kind: "select",
        options: [
          { value: "cut", label: "Cut (crop or fit)" },
          { value: "reframe", label: "Reframe (Claude lays it out again)" },
        ],
      },
      {
        key: "fit",
        label: "Fit",
        kind: "select",
        options: [
          { value: "crop", label: "Crop to fill" },
          { value: "blur", label: "Fit on blur" },
        ],
        showIf: { key: "source", is: ["cut"] },
      },
      {
        key: "length",
        label: "Length",
        kind: "select",
        options: [
          { value: "full", label: "Full video" },
          { value: "trailer", label: "Trailer (first part)" },
        ],
      },
      {
        key: "max",
        label: "Trailer length",
        kind: "number",
        min: 10,
        max: 60,
        step: 5,
        unit: "s",
        hint: "Only these seconds are rendered, not the whole video (end card included, Shorts allow 60 s).",
        showIf: { key: "length", is: ["trailer"] },
      },
      { key: "captions", label: "Captions burned in", kind: "toggle" },
      { key: "endCard", label: "End card", kind: "toggle" },
    ],
    defaults: { source: "cut", fit: "crop", length: "full", max: 60, captions: true, endCard: true },
  },
  {
    type: "thumbnail",
    label: "Thumbnail",
    category: "production",
    icon: "Image",
    desc: "Makes the video's thumbnail as an AI picture: designed by Claude from the channel's own thumbnails, from reference thumbnails you add (Claude works out their formula), or from your prompt template. One or several variations, and Claude can pick the best. Or a frame of the video.",
    accepts: ["project", "video"],
    out: "image",
    needs: ["project"],
    provides: ["image"],
    claude: true,
    fields: [
      {
        key: "mode",
        label: "How",
        kind: "select",
        options: [
          { value: "claude", label: "AI picture designed by Claude" },
          { value: "refs", label: "AI picture in the style of my reference thumbnails" },
          { value: "ai", label: "AI picture from my prompt template" },
          { value: "frame", label: "A frame of the video" },
        ],
      },
      {
        key: "refImages",
        label: "Reference thumbnails (1-5)",
        kind: "thumbRefs",
        hint: "Thumbnails whose look you want. Claude reverse-engineers their formula once; every run writes new prompts from it.",
        showIf: { key: "mode", is: ["refs"] },
      },
      {
        key: "analysis",
        label: "Their formula, as Claude sees it",
        kind: "thumbAnalysis",
        hint: "Edit it freely: the prompts are written from this text. Empty: each run analyses the references again.",
        showIf: { key: "mode", is: ["refs"] },
      },
      {
        key: "ytSource",
        label: "Learn from the thumbnails of",
        kind: "ytfollow",
        hint: "Empty: the YouTube channel linked to the video's channel.",
        showIf: { key: "mode", is: ["claude"] },
      },
      {
        key: "learn",
        label: "How many of its thumbnails",
        kind: "number",
        min: 0,
        max: 20,
        step: 1,
        showIf: { key: "mode", is: ["claude"] },
      },
      {
        key: "refs",
        label: "Find reference pictures online (the real people, places and things in the video)",
        kind: "toggle",
        showIf: { key: "mode", is: ["claude"] },
      },
      { key: "style", label: "Notes (text on it, style, what to show)", kind: "textarea", showIf: { key: "mode", is: ["claude", "refs"] } },
      { key: "at", label: "Frame at", kind: "number", min: 0, max: 100, step: 5, unit: "%", showIf: { key: "mode", is: ["frame"] } },
      { key: "prompt", label: "Prompt template", kind: "textarea", hint: "{title}, {topic}", showIf: { key: "mode", is: ["ai"] } },
      {
        key: "styleKey",
        label: "Global style key",
        kind: "textarea",
        placeholder:
          "e.g. Bold MrBeast-style thumbnail, saturated colours, thick white outline around the subject, 3D lighting, no clutter.",
        hint: "Set once: added word for word to the end of every picture prompt, to lock the overall look. Empty: nothing is added.",
        showIf: { key: "mode", is: ["claude", "refs", "ai"] },
      },
      { key: "model", label: "Picture service and model", kind: "imageGen", showIf: { key: "mode", is: ["claude", "refs", "ai"] } },
      {
        key: "count",
        label: "Variations",
        kind: "number",
        min: 1,
        max: 8,
        step: 1,
        hint: "How many pictures to make (each one is a picture on your image service).",
        showIf: { key: "mode", is: ["claude", "refs", "ai"] },
      },
      {
        key: "pickBest",
        label: "Claude picks the best",
        kind: "toggle",
        hint: "With 2 or more variations: Claude looks at them all, judges them on the formula, how readable they are at small size and the topic, and the winner becomes the thumbnail (it says why). Off: the first one is used. All of them are kept in the exports folder.",
        showIf: { key: "mode", is: ["claude", "refs", "ai"] },
      },
    ],
    // (service/model/quality/resolution empty: Settings > Image generation's service and model, 2k, high, as before)
    defaults: {
      mode: "claude",
      ytSource: "",
      learn: 8,
      refs: true,
      style: "",
      at: 30,
      prompt: "A bold, high-contrast YouTube thumbnail about {topic}. No text.",
      refImages: [],
      analysis: "",
      styleKey: "",
      service: "",
      model: "",
      quality: "",
      resolution: "",
      count: 1,
      pickBest: true,
    },
  },
  {
    type: "titleDesc",
    label: "Title & description",
    category: "production",
    icon: "Type",
    desc: "Claude learns how the channel builds its titles from all its public videos (kept for later runs, learned again when new videos come out) and writes the new title to fit right in among them (3 options, the best one picked), the description in the channel's own layout with chapters, and tags. Saved in the project as publish.json.",
    accepts: ["project", "video", "image"],
    out: "text",
    needs: ["project"],
    provides: ["text"],
    claude: true,
    fields: [
      {
        key: "ytChannel",
        label: "Match the titles of",
        kind: "ytfollow",
        hint: "Empty: the channel the Topic finder studied, else the YouTube channel linked to the video's board.",
      },
      { key: "chapters", label: "Chapters in the description (from the script's sections)", kind: "toggle" },
      {
        key: "relearn",
        label: "Learn the title style again every run",
        kind: "toggle",
        hint: "Off: learned once and kept; learned again when the channel has 3 new videos.",
      },
      { key: "notes", label: "Notes (tone, links to add…)", kind: "textarea" },
    ],
    defaults: { ytChannel: "", chapters: true, relearn: false, notes: "" },
  },
  // ---------- flow / publishing ----------
  {
    type: "approval",
    label: "Approval",
    category: "publish",
    icon: "UserCheck",
    desc: "Waits until you press Approve or Reject in the run. Reject stops this video.",
    accepts: ["any"],
    out: "any",
    fields: [{ key: "note", label: "What to check", kind: "text" }],
    defaults: { note: "" },
  },
  {
    type: "moveStage",
    label: "Move to stage",
    category: "publish",
    icon: "Columns3",
    desc: "Moves the video's card on the channel board.",
    accepts: ["any"],
    out: "any",
    needs: ["project"],
    fields: [{ key: "stage", label: "Stage", kind: "select", options: STAGE_OPTS }],
    defaults: { stage: "review" },
  },
  {
    type: "notify",
    label: "Notify",
    category: "publish",
    icon: "Bell",
    desc: "The last step: tells you (in the app, and on the desktop when the app is in the background) and opens the folder with the exported video.",
    accepts: ["any"],
    out: "any",
    fields: [
      { key: "text", label: "Message", kind: "text", hint: "{topic}, {project}" },
      { key: "open", label: "Open the folder with the exports", kind: "toggle" },
    ],
    defaults: { text: "{project} is ready", open: true },
  },
  {
    type: "upload",
    label: "Upload to YouTube",
    category: "publish",
    icon: "Upload",
    desc: "Uploads the video with its thumbnail, title, description and tags.",
    accepts: ["video", "image", "text", "any"],
    out: "any",
    needs: ["project", "video"],
    fields: [
      { key: "ytChannel", label: "YouTube channel", kind: "ytchannel" },
      {
        key: "privacy",
        label: "Visibility",
        kind: "select",
        options: [
          { value: "private", label: "Private" },
          { value: "unlisted", label: "Unlisted" },
          { value: "public", label: "Public" },
          { value: "scheduled", label: "Scheduled" },
        ],
      },
      {
        key: "publishIn",
        label: "Publish after",
        kind: "number",
        min: 1,
        max: 720,
        step: 1,
        unit: "hours",
        showIf: { key: "privacy", is: ["scheduled"] },
      },
    ],
    defaults: { ytChannel: "", privacy: "private", publishIn: 24 },
  },
  {
    type: "note",
    label: "Note",
    category: "note",
    icon: "StickyNote",
    desc: "A note on the canvas.",
    accepts: null,
    out: null,
    fields: [{ key: "text", label: "Text", kind: "textarea" }],
    defaults: { text: "" },
  },
];
export const NODE = Object.fromEntries(NODES.map((n) => [n.type, n]));
export const CATEGORY_LABEL = { input: "Inputs", production: "Production", check: "Checks", publish: "Flow & publishing", note: "Notes" };
export const PORT_COLOR = {
  topic: "#f5d76e",
  topics: "#f5b86e",
  project: "#89bea4",
  video: "#84a9d8",
  image: "#c79be0",
  text: "#e08a8a",
  any: "#9a9a9a",
};
export const PORT_LABEL = {
  topic: "topic",
  topics: "topics",
  project: "project",
  video: "video",
  image: "thumbnail",
  text: "title & text",
  any: "anything",
};
export const IMAGE_SERVICE_NAMES = { higgsfield: "Higgsfield", fal: "Fal.ai", custom: "Custom API", flow: "Google Flow" };
export function serviceFor(want, has) {
  if (want === "higgsfield" || want === "fal" || want === "custom" || want === "flow") {
    if (has[want]) return want;
  }
  if (want === "flow") return null;
  if ((!want || want === "auto") && has.flow) return "flow";
  return has.higgsfield ? "higgsfield" : has.fal ? "fal" : null;
}
export const variantName = (v) =>
  `${v.level === "standard" ? "Standard" : levelName(v.level)} · ${CLAUDE_EFFORTS.find((e) => e.id === v.effort)?.name ?? v.effort}`;
export function connectProblem(from, to, edges = []) {
  if (!from || !to) return "Drop it on a node.";
  if (from.id === to.id) return "A node can't connect to itself.";
  const a = NODE[from.type],
    b = NODE[to.type];
  if (!a?.out) return `${a?.label ?? "This node"} has nothing to pass on.`;
  if (!b?.accepts) return `${b?.label ?? "That node"} takes no input${b?.category === "input" ? ": it starts videos itself" : ""}.`;
  const ok =
    a.out === "any" ||
    b.accepts.includes("any") ||
    b.accepts.includes(a.out) ||
    (a.out === "topics" && b.accepts.includes("topic")) ||
    (b.accepts.includes("project") && ["video", "image", "text"].includes(a.out));
  if (!ok) return `${b.label} takes ${b.accepts.map((t) => PORT_LABEL[t]).join(" or ")}, not ${PORT_LABEL[a.out]}.`;
  if (edges.some((e) => e.from === from.id && e.to === to.id)) return "They are connected already.";
  const seen = new Set(),
    stack = [to.id];
  while (stack.length) {
    const id = stack.pop();
    if (id === from.id) return "That would make a loop.";
    if (seen.has(id)) continue;
    seen.add(id);
    edges.filter((e) => e.from === id).forEach((e) => stack.push(e.to));
  }
  return null;
}
export function withDefaults(n) {
  const def = NODE[n.type],
    d = { ...(def?.defaults ?? {}) };
  if (n.settings && Object.keys(n.settings).length) for (const k of def?.newOnly ?? []) delete d[k];
  return { ...n, settings: { ...structuredCloneSafe(d), ...(n.settings ?? {}) } };
}
const structuredCloneSafe = (o) => JSON.parse(JSON.stringify(o));
export function nextRun(s, from) {
  if (!s?.on) return null;
  if (s.mode === "hours") return new Date(from.getTime() + Math.max(1, +s.hours || 24) * 36e5);
  const [hh, mm] = String(s.time || "09:00")
    .split(":")
    .map((x) => +x || 0);
  const days = s.mode === "weekdays" ? (Array.isArray(s.days) && s.days.length ? s.days : [1, 2, 3, 4, 5]) : [0, 1, 2, 3, 4, 5, 6];
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    if (d > from && days.includes(d.getDay())) return d;
  }
  return null;
}
let seq = 0;
const nn = (type, x, y, settings = {}) => ({
  id: `n_t${++seq}_${type}`,
  type,
  x,
  y,
  settings: { ...structuredCloneSafe(NODE[type].defaults), ...settings },
});
const chain = (nodes) => nodes.slice(1).map((n, i) => ({ id: `e_${nodes[i].id}_${n.id}`, from: nodes[i].id, to: n.id }));
const COL = 320,
  ROW = 240,
  PER = 4;
const row = (types) =>
  types.map((t, i) => {
    const x = (i % PER) * COL,
      y = Math.floor(i / PER) * ROW;
    return Array.isArray(t) ? nn(t[0], x, y, t[1]) : nn(t, x, y);
  });
export const TEMPLATES = [
  {
    id: "next-video",
    name: "Next video for my channel",
    desc: "Claude studies your channel, finds a new topic, then script → voice → build → check → sound → render → thumbnail.",
    make: () => {
      const ns = row([
        ["ideaGenerator", { count: 1 }],
        "createProject",
        ["writeScript", { preset: "deep" }],
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        "notify",
      ]);
      return { nodes: ns, edges: chain(ns) };
    },
  },
  {
    id: "explainer",
    name: "Explainer from a topic",
    desc: "Topic → script → voice → build → check → sound → render → thumbnail.",
    make: () => {
      const ns = row([
        "topic",
        "createProject",
        "writeScript",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        "notify",
      ]);
      return { nodes: ns, edges: chain(ns) };
    },
  },
  {
    id: "batch",
    name: "Batch: topic list to videos",
    desc: "One finished video per line of a list, one after another.",
    make: () => {
      const ns = row([
        "topicList",
        "createProject",
        "writeScript",
        "scriptRules",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        ["moveStage", { stage: "review" }],
        "notify",
      ]);
      return { nodes: ns, edges: chain(ns) };
    },
  },
  {
    id: "daily-short",
    name: "Daily Short for my channel",
    desc: "Every day: Claude finds a new topic for the channel and makes a 9:16 Flat video of it.",
    make: () => {
      const sch = nn("schedule", -COL, 0);
      const ns = row([
        ["ideaGenerator", { count: 1 }],
        ["createProject", { styleId: "flat", format: "vertical", length: 45 }],
        "writeScript",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        ["moveStage", { stage: "ready" }],
        "notify",
      ]);
      return { nodes: [sch, ...ns], edges: chain(ns) };
    },
  },
  {
    id: "my-script",
    name: "My script to finished video",
    desc: "Your script → voice → build → check → sound → render.",
    make: () => {
      const ns = row([
        "myScript",
        "createProject",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        "titleDesc",
        "notify",
      ]);
      return { nodes: ns, edges: chain(ns) };
    },
  },
  {
    id: "autopilot",
    name: "Full channel autopilot",
    desc: "Claude finds ideas, makes the videos, waits for your approval, uploads them privately.",
    make: () => {
      const sch = nn("schedule", -COL, 0);
      const ns = row([
        ["ideaGenerator", { count: 1 }],
        "createProject",
        "writeScript",
        "scriptRules",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        "titleDesc",
        "approval",
        "upload",
        "notify",
      ]);
      const v = nn("vertical", PER * COL, 2 * ROW),
        m = nn("moveStage", PER * COL, 3 * ROW + ROW, { stage: "scheduled" });
      return {
        nodes: [sch, ...ns, v, m],
        edges: [...chain(ns), { id: "e_v", from: ns[8].id, to: v.id }, { id: "e_m", from: ns[11].id, to: m.id }],
      };
    },
  },
];
