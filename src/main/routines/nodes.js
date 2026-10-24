import { CLAUDE_EFFORTS } from "../engines/models";
import { cantDrawWhy, lang, styleDraws, whoCanDraw } from "../styles/languages";
import { BUILD_COST, BUILD_EXTRAS, EFFORT_LAYERS, SCRIPT_PRESETS, TIME_LIMIT_BASES, extrasFor, levelName } from "./buildExtras";

function upstreamStyles(g, nodeId) {
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
const NODES = [
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
const IMAGE_SERVICE_NAMES = { higgsfield: "Higgsfield", fal: "Fal.ai", custom: "Custom API", flow: "Google Flow" };
function serviceFor(want, has) {
  if (want === "higgsfield" || want === "fal" || want === "custom" || want === "flow") {
    if (has[want]) return want;
  }
  if (want === "flow") return null;
  if ((!want || want === "auto") && has.flow) return "flow";
  return has.higgsfield ? "higgsfield" : has.fal ? "fal" : null;
}
export const thumbCount = (s) => Math.min(8, Math.max(1, Math.round(+s?.count || 1)));
export const thumbMode = (s) => (["refs", "ai", "frame"].includes(s?.mode) ? s.mode : "claude");
export const thumbJudges = (s) => thumbMode(s) !== "frame" && thumbCount(s) > 1 && s?.pickBest !== false;
const thumbNeedsClaude = (s) => ["claude", "refs"].includes(thumbMode(s)) || thumbJudges(s);
export function withStyleKey(prompt, key2) {
  const p = String(prompt ?? "").trim(),
    k = String(key2 ?? "").trim();
  return !k ? p : !p ? k : `${p}${/[.!?]$/.test(p) ? "" : "."} ${k}`;
}
export const isLevel = (k) => k === "standard" || EFFORT_LAYERS.some((l) => l.key === k);
export const variantName = (v) =>
  `${v.level === "standard" ? "Standard" : levelName(v.level)} · ${CLAUDE_EFFORTS.find((e) => e.id === v.effort)?.name ?? v.effort}`;
export const DEFAULT_SETTINGS = { perRun: 10, perDay: 20, parallel: 1, onFailure: "skip", model: "", effort: "" };
export function validate(g, ctx = {}) {
  const out = [],
    byId = new Map(g.nodes.map((n) => [n.id, n]));
  const real = g.nodes.filter((n) => NODE[n.type] && n.type !== "note" && !n.off);
  if (!real.length)
    return [
      {
        nodeId: null,
        text: g.nodes.some((n) => n.off)
          ? "Every node is switched off."
          : "Add some nodes first: start with a Topic finder (or a Topic) and a Create project.",
      },
    ];
  const sources = real.filter((n) => NODE[n.type].accepts === null && NODE[n.type].out);
  if (!sources.length)
    out.push({
      nodeId: null,
      text: "Nothing starts a video: add a Topic finder, Topic, Topic list, Channel ideas, My script or My audio (or switch yours on).",
    });
  for (const e of g.edges)
    if (!byId.has(e.from) || !byId.has(e.to))
      out.push({ nodeId: null, text: "A cable points to a node that is gone (it is removed when you save).", warn: true });
  const ups = (id) =>
    g.edges
      .filter((e) => e.to === id)
      .map((e) => byId.get(e.from))
      .filter(Boolean);
  const memo = new Map();
  const have = (id, guard = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (guard.has(id)) return new Set();
    guard.add(id);
    const n = byId.get(id),
      def = NODE[n.type],
      s = new Set();
    const parents = ups(id);
    if (parents.length) {
      const sets = parents.map((p) => have(p.id, guard));
      for (const k of sets[0]) if (sets.every((x) => x.has(k))) s.add(k);
    }
    if (!n.off) (def?.provides ?? []).forEach((p) => s.add(p));
    memo.set(id, s);
    return s;
  };
  for (const n of real) {
    const def = NODE[n.type],
      s = n.settings ?? {};
    const parents = ups(n.id);
    if (def.accepts && !parents.length) out.push({ nodeId: n.id, text: `${def.label} is not connected: connect something into it.` });
    if (def.out && def.accepts === null && !g.edges.some((e) => e.from === n.id))
      out.push({ nodeId: n.id, text: `${def.label} goes nowhere: connect it to a Create project.` });
    if (parents.length) {
      const before = new Set();
      const sets = parents.map((p) => have(p.id));
      for (const k of sets[0] ?? []) if (sets.every((x) => x.has(k))) before.add(k);
      for (const need of def.needs ?? [])
        if (!before.has(need))
          out.push({
            nodeId: n.id,
            text: `${def.label} needs a ${need === "video" ? "rendered video (a Render or Vertical version before it)" : need === "project" ? "project (a Create project before it)" : need}.`,
          });
    }
    if (def.claude && ctx.hasClaude === false && !(n.type === "thumbnail" && !thumbNeedsClaude(s)))
      out.push({ nodeId: n.id, text: `${def.label} needs Claude: sign in to Claude in Settings.` });
    if (n.type === "topic" && !String(s.topic ?? "").trim()) out.push({ nodeId: n.id, text: "Topic: write the topic." });
    if (
      n.type === "topicList" &&
      !String(s.topics ?? "")
        .split(/\r?\n/)
        .some((l) => l.trim())
    )
      out.push({ nodeId: n.id, text: "Topic list: add at least one topic." });
    if (n.type === "topicList") {
      const l = String(s.topics ?? "")
        .split(/\r?\n/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      if (new Set(l).size < l.length) out.push({ nodeId: n.id, text: "Topic list: some topics are listed twice.", warn: true });
    }
    if (n.type === "channelIdeas" && !s.channelId) out.push({ nodeId: n.id, text: "Channel ideas: pick the channel." });
    if (
      (n.type === "channelIdeas" || n.type === "createProject" || n.type === "ideaGenerator") &&
      s.channelId &&
      ctx.channels &&
      !ctx.channels.includes(s.channelId)
    )
      out.push({ nodeId: n.id, text: `${def.label}: its channel was deleted. Pick another.` });
    if (n.type === "ideaGenerator" && !s.ytChannel && !s.channelId && !String(s.about ?? s.niche ?? "").trim())
      out.push({ nodeId: n.id, text: "Topic finder: pick a YouTube channel to study, or write what the channel is about." });
    if (
      (n.type === "writeScript" || (n.type === "scriptRules" && (s.onFail ?? "fix") === "fix")) &&
      (s.scriptSkill ?? "use") === "use" &&
      ctx.scriptSkill === "off"
    )
      out.push({
        nodeId: n.id,
        text: `${def.label}: your scripting skill is switched off in Settings > AI engines, so Claude writes the usual way. Switch it on there, or pick "Don't use it" here.`,
        warn: true,
      });
    if (
      (n.type === "writeScript" || n.type === "scriptRules") &&
      s.scriptSkill != null &&
      !(n.type === "writeScript" ? ["use", "own", "off"] : ["use", "off"]).includes(s.scriptSkill)
    )
      out.push({ nodeId: n.id, text: `${def.label}: pick whether to use your scripting skill.` });
    if (n.type === "writeScript" && s.scriptSkill === "own") {
      if (!s.ownSkill?.id)
        out.push({
          nodeId: n.id,
          text: "Write script: add this node's own scripting skill (a file, a folder or pasted text), or pick another Scripting skill.",
        });
      else if (ctx.ownSkills && !ctx.ownSkills[s.ownSkill.id])
        out.push({
          nodeId: n.id,
          text: `Write script: its own scripting skill "${s.ownSkill.name || "skill"}" is not on this computer (a routine from another one?). Add it again in the node.`,
        });
    }
    if (n.type === "myScript" && !String(s.script ?? "").trim()) out.push({ nodeId: n.id, text: "My script: paste the script." });
    if (n.type === "myAudio" && !(Array.isArray(s.files) && s.files.length))
      out.push({ nodeId: n.id, text: "My audio: add the recording(s)." });
    if (n.type === "voiceover") {
      const p = s.provider || "auto";
      if (p === "elevenlabs" && ctx.hasEleven === false)
        out.push({ nodeId: n.id, text: "Voiceover: add your ElevenLabs key in Settings > Media > Voiceover, or pick the local voice." });
      if (p === "kokoro" && ctx.hasKokoro === false)
        out.push({ nodeId: n.id, text: "Voiceover: the local voice is not installed (Settings > Media > Voiceover)." });
      if (p === "fish" && ctx.hasFish === false)
        out.push({ nodeId: n.id, text: "Voiceover: add your Fish Audio key in Settings > Media > Voiceover, or pick another voice." });
      if (p === "auto" && ctx.hasEleven === false && ctx.hasFish === false && ctx.hasKokoro === false)
        out.push({
          nodeId: n.id,
          text: "Voiceover: no voice is set up. Add an ElevenLabs or Fish Audio key or install the local voice in Settings > Media > Voiceover.",
        });
    }
    if (n.type === "thumbnail" && s.mode !== "frame" && ctx.hasImageKey === false)
      out.push({ nodeId: n.id, text: "Thumbnail: AI pictures need a Higgsfield or Fal.ai key (Settings > Media > Image generation)." });
    if (n.type === "thumbnail" && thumbMode(s) === "refs") {
      const refs = Array.isArray(s.refImages) ? s.refImages : [];
      if (!refs.length) out.push({ nodeId: n.id, text: "Thumbnail: add 1-5 reference thumbnails (or pick another How)." });
      else if (refs.length > 5) out.push({ nodeId: n.id, text: `Thumbnail: ${refs.length} reference thumbnails; use at most 5.` });
      const gone = ctx.thumbRefs ? refs.filter((r) => !ctx.thumbRefs.includes(String(r?.id))) : [];
      if (gone.length)
        out.push({
          nodeId: n.id,
          text: `Thumbnail: ${gone.length === 1 ? `the reference "${gone[0]?.name || "thumbnail"}" is` : `${gone.length} reference thumbnails are`} not on this computer (a routine from another one?). Add ${gone.length === 1 ? "it" : "them"} again in the node.`,
        });
      if (refs.length && !gone.length && !String(s.analysis ?? "").trim())
        out.push({
          nodeId: n.id,
          text: "Thumbnail: the reference thumbnails are not analysed yet. Press Analyse in the node to see and edit their formula (otherwise every run analyses them again).",
          warn: true,
        });
    }
    if (n.type === "thumbnail" && thumbMode(s) !== "frame" && ctx.images) {
      const im = ctx.images,
        want = s.service || im.setting,
        eff = serviceFor(want, im.has);
      if (eff && (want === "higgsfield" || want === "fal" || want === "custom") && eff !== want)
        out.push({
          nodeId: n.id,
          text: `Thumbnail: ${IMAGE_SERVICE_NAMES[want]} ${want === "custom" ? "is not set up" : "has no key yet"} (Settings > Media > Image generation): the pictures are made on ${IMAGE_SERVICE_NAMES[eff]} until then.`,
          warn: true,
        });
      if (eff === "higgsfield" && s.model && im.models.length && !im.models.includes(s.model))
        out.push({ nodeId: n.id, text: `Thumbnail: the image model "${s.model}" is not one the app knows. Pick the model.` });
      if (s.model && eff === "fal" && s.service !== "fal")
        out.push({
          nodeId: n.id,
          text: "Thumbnail: the pictures are made on Fal.ai (FLUX.2), so the picked model is not used.",
          warn: true,
        });
    }
    if (n.type === "upload") {
      if (!s.ytChannel) out.push({ nodeId: n.id, text: "Upload to YouTube: pick the YouTube channel." });
      else if (ctx.ytUpload && !ctx.ytUpload.includes(s.ytChannel))
        out.push({
          nodeId: n.id,
          text: "Upload to YouTube: this channel has not allowed uploads yet. Select the node and press Allow uploads.",
        });
      const anc = new Set(),
        st = [n.id];
      while (st.length) {
        const id = st.pop();
        for (const p of ups(id))
          if (!anc.has(p.id)) {
            anc.add(p.id);
            st.push(p.id);
          }
      }
      if (![...anc].some((id) => byId.get(id)?.type === "approval" && !byId.get(id)?.off))
        out.push({ nodeId: n.id, text: "Upload to YouTube has no Approval before it: videos go up without you seeing them.", warn: true });
    }
    const bases = () =>
      upstreamStyles(g, n.id).map((id) => ({ id, base: ctx.bases?.[id] ?? baseStyle(id), name: ctx.styleNames?.[id] ?? id }));
    if (n.type === "buildVideo") {
      for (const st of bases())
        for (const x of extrasFor(st.base))
          if (x.off && s[x.key])
            out.push({
              nodeId: n.id,
              text: `Build video: "${x.short}" is on, but ${st.name} doesn't use it, so it is skipped. ${x.off} Switch it off.`,
              warn: true,
            });
    }
    const tallOk = (id) => !!ctx.formats?.[id]?.includes("vertical");
    if (n.type === "vertical" && s.source === "reframe") {
      for (const st of bases())
        if (["pixel-art", "stickman", "recon"].includes(st.base) && !tallOk(st.id))
          out.push({
            nodeId: n.id,
            text: `Vertical version: ${st.name} is drawn for 16:9 only and can't be laid out again; its 9:16 version is cut (crop or fit). Pick Cut.`,
            warn: true,
          });
    }
    if (n.type === "createProject" && ctx.bases && !ctx.bases[s.styleId || "flat"])
      out.push({
        nodeId: n.id,
        text: `Create project: its style${s.styleName ? ` "${s.styleName}"` : ""} is not on this computer any more (deleted or never installed here). Pick another style.`,
      });
    const cBase = n.type === "createProject" ? (ctx.bases?.[s.styleId] ?? baseStyle(s.styleId || "flat")) : "",
      cTall = n.type === "createProject" && s.format === "vertical" && !tallOk(s.styleId);
    if (cTall && cBase === "pixel-art")
      out.push({ nodeId: n.id, text: "Create project: Pixel art is drawn for wide videos only. Pick Wide, or another style." });
    if (cTall && cBase === "recon")
      out.push({
        nodeId: n.id,
        text: "Create project: 3D reconstructions are made for wide videos only. Pick Wide (a 9:16 version can be cut from it later).",
      });
    if (cTall && cBase === "stickman")
      out.push({
        nodeId: n.id,
        text: "Create project: MS Paint stick figures are drawn for wide videos only. Pick Wide, or another style.",
      });
    if (n.type === "createProject" && s.language && s.styleId) {
      const b = ctx.bases?.[s.styleId] ?? baseStyle(s.styleId);
      if (!styleDraws(b, s.language))
        out.push({
          nodeId: n.id,
          text: `Create project: ${ctx.styleNames?.[s.styleId] ?? "this style"} can't write ${lang(s.language).name}: ${cantDrawWhy(b, s.language)}. ${whoCanDraw(s.language)}`,
        });
    }
    if (n.type === "voiceover" && s.provider === "kokoro") {
      const anc = new Set(),
        st = [n.id];
      while (st.length) {
        const id = st.pop();
        for (const p of ups(id))
          if (!anc.has(p.id)) {
            anc.add(p.id);
            st.push(p.id);
          }
      }
      for (const id of anc) {
        const c = byId.get(id);
        const code = c?.type === "createProject" && !c.off ? c.settings?.language : null;
        if (code && !lang(code).kokoro && lang(code).code !== "en") {
          out.push({ nodeId: n.id, text: `Voiceover: the local voice doesn't speak ${lang(code).name}. Pick ElevenLabs or Fish Audio.` });
          break;
        }
      }
    }
  }
  const scheds = real.filter((n) => n.type === "schedule");
  if (scheds.length > 1) out.push({ nodeId: scheds[1].id, text: "Only one Schedule per routine." });
  return out;
}
const baseStyle = (id) => (id === "pixel-art" || id === "pixel" ? "pixel-art" : id);
export function withDefaults(n) {
  const def = NODE[n.type],
    d = { ...(def?.defaults ?? {}) };
  if (n.settings && Object.keys(n.settings).length) for (const k of def?.newOnly ?? []) delete d[k];
  return { ...n, settings: { ...structuredCloneSafe(d), ...(n.settings ?? {}) } };
}
export const structuredCloneSafe = (o) => JSON.parse(JSON.stringify(o));
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
