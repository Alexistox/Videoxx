import path from "node:path";
import fs from "node:fs";
import { templatesDir } from "../core/workspace";
import { parseManifest } from "./manifest";

const LOWPOLY_ROSTER = [
  { value: "alex", img: "lowpoly-cast/alex.png", label: "Alex (man, leather jacket)" },
  { value: "maya", img: "lowpoly-cast/maya.png", label: "Maya (woman, yellow top)" },
  { value: "marcus", img: "lowpoly-cast/marcus.png", label: "Marcus (man, hoodie, beard)" },
  { value: "jen", img: "lowpoly-cast/jen.png", label: "Jen (woman, red top, buns)" },
  { value: "tom", img: "lowpoly-cast/tom.png", label: "Tom (man, shirt and tie, glasses)" },
  { value: "rosa", img: "lowpoly-cast/rosa.png", label: "Rosa (woman, green top)" },
  { value: "frank", img: "lowpoly-cast/frank.png", label: "Frank (older man, sweater)" },
  { value: "lena", img: "lowpoly-cast/lena.png", label: "Lena (woman, blonde, office)" },
];
const TOON_CAST = [
  ["milo", "Milo (everyman, teal tee)"],
  ["juno", "Juno (everywoman, yellow sweater)"],
  ["dex", "Dex (scientist, lab coat)"],
  ["bea", "Bea (kid, red dress)"],
  ["otis", "Otis (big guy, plaid flannel, beard)"],
  ["rose", "Nana Rose (grandma, cardigan)"],
  ["walt", "Walt (grandpa, vest, mustache)"],
  ["kai", "Kai (student, blue hoodie)"],
  ["priya", "Priya (professional, green blouse)"],
  ["sam", "Sam (police officer)"],
  ["lola", "Lola (explorer, orange overalls)"],
  ["viktor", "Viktor (boss, suit and tie)"],
  ["ike", "Ike (adventurer, red puffer, beanie)"],
  ["mei", "Mei (doctor, scrubs)"],
  ["rex", "Rex (athlete, tank top)"],
  ["tess", "Tess (pilot, jacket, cap)"],
  ["hugo", "Hugo (chef, chef's hat)"],
  ["ada", "Ada (engineer, striped sweater)"],
  ["bo", "Bo (little kid, cap)"],
  ["zed", "Zed (shady guy, sunglasses)"],
].map(([value, label]) => ({ value, label }));
export const STYLES = [
  {
    id: "pixel-art",
    name: "Pixel art",
    tagline: "Three.js scenes rendered as crisp low-res pixel art",
    description:
      "Word-synced 3D scenes rendered at 320–640 px and scaled up with hard pixels: the Hi-Bit look's 100 colours in five shading steps (or the classic 16), outlines that separate shapes, rim light, dithered skies and transitions, full-screen b-roll of the real things you name, a 1080p HUD in retro fonts. Explains ideas with characters, props, sets and diagrams.",
    engine: "engine",
    skill: "pixel-explainer-video",
    defaultLook: "hibit",
    looks: ["hibit", "crisp"],
    brief:
      "Pixel-art explainer: small blocky characters, props, maps and diagrams in a Three.js scene rendered as low-res pixel art, with a clean 1080p HUD (titles, labels, counters) in retro fonts. Real photos only for real people, products and places.",
    controls: [
      {
        path: "art",
        label: "Art resolution",
        help: "Pixel size of the 3D render. Higher = finer pixel art.",
        type: "select",
        size: true,
        options: [
          { value: "320x180", label: "320×180 chunky" },
          { value: "384x216", label: "384×216" },
          { value: "480x270", label: "480×270 hi-detail" },
          { value: "640x360", label: "640×360 crisp" },
        ],
      },
      {
        path: "color.palette",
        label: "Colours",
        help: "Hi-Bit: about 100 colours and five shading steps per surface (engine v10+). Classic: the 16-colour palette.",
        type: "select",
        options: [
          { value: "hibit", label: "Hi-Bit (about 100 colours)" },
          { value: "sweetie16", label: "Classic 16 colours" },
        ],
      },
      { path: "outline.depth", label: "Depth outlines", help: "Dark contour where depth jumps.", type: "toggle" },
      { path: "outline.objectId", label: "Object outlines", help: "Separates touching objects at similar depth.", type: "toggle" },
      { path: "outline.rim", label: "Rim light", help: "One-shade-lighter edge on sides facing the light.", type: "toggle" },
      { path: "outline.fogFade", label: "Fade outlines with fog", help: "Distant contours dissolve for depth.", type: "toggle" },
      { path: "outline.color", label: "Outline colour", type: "color" },
      { path: "shadows.enabled", label: "Cast shadows", type: "toggle" },
      {
        path: "shadows.mapSize",
        label: "Shadow detail",
        type: "select",
        options: [1024, 2048, 4096].map((v) => ({ value: v, label: String(v) })),
      },
      { path: "post.vignette", label: "Vignette", type: "range", min: 0, max: 0.6, step: 0.05 },
      { path: "post.dither", label: "Edge dither", type: "range", min: 0, max: 0.1, step: 0.01 },
      { path: "transitions.duration", label: "Transition length", type: "range", min: 0.2, max: 1, step: 0.02, fmt: "s" },
      { path: "transitions.pixelateMax", label: "Pixelate transition", type: "range", min: 4, max: 24, step: 1 },
      { path: "camera.fov", label: "Field of view", type: "range", min: 28, max: 60, step: 1, fmt: "deg" },
      { path: "camera.push", label: "Camera push-in", type: "range", min: 0, max: 0.1, step: 0.01, fmt: "pct" },
    ],
  },
  {
    id: "collage",
    name: "Vox",
    tagline: "Newspaper cut-out collage explainers on one broadsheet page",
    description:
      "Mixed-media newspaper collage: every chapter is a panel on one front page. Cut-out images with real transparency (made on your Higgsfield or Fal.ai account, a cent each), hand-cut white sticker borders and soft shadows, torn paper, ransom-note letters, handwriting that writes itself, typewriter labels, rubber stamps, marker circles, counters and pins. The camera whip-pans from panel to panel with real motion blur and ends pulling back to the whole front page, then loops seamlessly into the first frame. 1920×1080 or 1080×1920.",
    engine: "collage",
    skill: "vox-collage-video",
    defaultLook: "collage-press",
    brief:
      "Vox newspaper-collage explainer: one broadsheet front page with a panel per chapter; cut-out engraving-style images (stills made with make_image, with transparency, never any text in them) with white sticker borders and soft shadows on torn cream/kraft/parchment paper; all text is animated typography drawn by the engine (ransom-note letters, blackletter mastheads, script handwriting, typewriter labels, red rubber stamps with dates, big condensed counters, red marker circles); camera whip-pans between panels, finale pulls back to the full front page and loops into the opening frame; facts and dates exact.",
    controls: [
      {
        path: "format",
        label: "Format",
        help: "1920×1080 or vertical 1080×1920. Set when the project is created.",
        type: "select",
        readOnly: true,
        options: [
          { value: "landscape", label: "Wide 16:9" },
          { value: "vertical", label: "Vertical 9:16" },
        ],
      },
      {
        path: "theme",
        label: "Paper and ink",
        help: "Paper, ink and stamp colours for every element.",
        type: "select",
        options: [
          { value: "press", label: "Press (cream + red)" },
          { value: "sepia", label: "Sepia (aged paper)" },
          { value: "broadsheet", label: "Broadsheet (white + red)" },
        ],
      },
      {
        path: "pace.perMinute",
        label: "Pictures per minute",
        help: "How busy the video is: how many cut-outs Claude makes and lands per minute of narration. Longer videos get more chapters and pictures, so a 10-minute video stays as lively as a 2-minute one. 12 = a new picture about every 5 s.",
        type: "range",
        min: 4,
        max: 30,
        step: 1,
        fmt: "ppm",
        default: 12,
      },
      {
        path: "post.paper",
        label: "Paper texture",
        help: "Paper grain over everything, adjusted by brightness so colours stay clean.",
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        path: "post.halftone",
        label: "Halftone print",
        help: "Printed dot screen over the frame.",
        type: "range",
        min: 0,
        max: 0.3,
        step: 0.01,
      },
      { path: "post.grain", label: "Film grain", type: "range", min: 0, max: 0.1, step: 5e-3 },
      { path: "post.vignette", label: "Vignette", type: "range", min: 0, max: 0.5, step: 0.02 },
      { path: "post.warmth", label: "Warmth", type: "range", min: -1, max: 1, step: 0.05 },
      {
        path: "post.tone",
        label: "Sepia tone",
        help: "Prints everything in sepia: brown engravings and ink.",
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        path: "shadow.opacity",
        label: "Cut-out shadows",
        help: "How dark the soft shadows under cut-outs and paper are.",
        type: "range",
        min: 0,
        max: 0.6,
        step: 0.02,
      },
      {
        path: "border",
        label: "Sticker border",
        help: "Width of the white hand-cut border around cut-outs.",
        type: "range",
        min: 0,
        max: 2,
        step: 0.1,
        fmt: "x",
      },
      {
        path: "camera.drift",
        label: "Camera creep per shot",
        help: "How much every shot slowly pushes in.",
        type: "range",
        min: 0,
        max: 0.1,
        step: 5e-3,
        fmt: "pct",
      },
      {
        path: "transitions.duration",
        label: "Whip-pan length",
        help: "Travel time between panels; the fast middle carries the motion blur.",
        type: "range",
        min: 0.35,
        max: 1.2,
        step: 0.02,
        fmt: "s",
      },
      {
        path: "sheet.cols",
        label: "Panels per row",
        help: "How the chapters are laid out on the front page (the finale shows them all).",
        type: "select",
        options: [2, 3, 4, 5].map((v) => ({ value: v, label: String(v) })),
      },
    ],
  },
  {
    id: "flat",
    name: "Flat explainer",
    tagline: "Bright flat-vector science explainers with your own character, 9:16 or 16:9",
    description:
      "Flat-vector explainer animation in the style of popular science shorts, built entirely in Three.js: rounded shapes with one consistent light, a friendly character with real follow-through (blinks, drag, squash and stretch), icons, diagrams and labels that land on the spoken word, lines that draw on and land, dopamine-style particle bursts, smooth dissolves between scenes, word-highlight captions in their own band and a soft film finish. Every element passes a close-up quality gate. Each video stars your main character (Characters: a random one of your own, or one Claude designs from your description). 1080×1920 shorts or 1920×1080 videos, no images needed.",
    engine: "flat",
    skill: "flat-explainer-video",
    defaultLook: "flat-midnight",
    brief:
      "Flat-vector explainer (9:16 shorts or 16:9 videos): orthographic Three.js, exact flat colours with meaning (one colour per concept, used consistently), only rounded primitives, one light from the top-left (shading = a darker tint of the object's own colour, cut from its outline, never laid on top), the project's own main character (character.js) with expressive follow-through, every visual event on a spoken word, nothing ever snaps (eased in-betweens, colour changes spread from their cause), seamless loops, dissolves between scenes, captions only in the reserved band, nothing important in the caption band. Everything is procedural: no images.",
    controls: [
      {
        path: "format",
        label: "Format",
        help: "Vertical 1080×1920 for shorts and reels, or wide 1920×1080. Set when the project is created.",
        type: "select",
        readOnly: true,
        options: [
          { value: "vertical", label: "Vertical 9:16" },
          { value: "landscape", label: "Wide 16:9" },
        ],
      },
      { path: "captions.on", label: "Captions", help: "Word-highlight captions in the reserved band near the bottom.", type: "toggle" },
      { path: "captions.size", label: "Caption size", type: "range", min: 44, max: 72, step: 2 },
      { path: "post.grain", label: "Film grain", type: "range", min: 0, max: 0.12, step: 0.01 },
      {
        path: "post.vignette",
        label: "Vignette",
        help: "Keep it soft: strong darkening turns warm backgrounds muddy.",
        type: "range",
        min: 0,
        max: 0.3,
        step: 0.02,
      },
      {
        path: "camera.push",
        label: "Camera push-in",
        help: "How much every shot slowly pushes in.",
        type: "range",
        min: 0,
        max: 0.1,
        step: 5e-3,
        fmt: "pct",
      },
      {
        path: "camera.punch",
        label: "Cut punch-in",
        help: "A small zoom that eases out right after each cut.",
        type: "range",
        min: 0,
        max: 0.06,
        step: 5e-3,
        fmt: "pct",
      },
      { path: "transitions.duration", label: "Transition length", type: "range", min: 0.2, max: 0.8, step: 0.02, fmt: "s" },
    ],
  },
  {
    id: "stickman",
    name: "MS Paint stick figures",
    tagline: "Funny history and science explainers drawn like MS Paint: big-head stick figures, a new picture every 2-3 seconds",
    description:
      "The fast story-explainer look of the big folklore and history channels, drawn like a scribbly MS Paint picture: a new image for every clause of the narration (2-3 seconds each), big-head stick figures with exaggerated faces, chapter titles, red and yellow date and number cards, maps, arrows and cross-sections. Backdrops, props and diagrams are drawn by code (free); the people and animals are drawn once by your image service in a clumsy MS Paint style and kept in a library, so every later video reuses them for free. Optionally pulls real photos from the web (Wikimedia Commons) into framed pictures.",
    engine: "stickman",
    skill: "stickman-explainer",
    defaultLook: "stickman-paint",
    brief:
      "MS Paint stick-figure explainer, 16:9: one clause of narration = one new still picture (2-3 s, never more than ~4.5 s), written in the shot language (script(`...`) in scenes/*.js) from a library of backdrops, props, labels and diagrams; people and animals are sprites made with make_sprites (clumsy MS Paint mouse-drawn style, cut out, reused); a chapter title in caps on every frame; red/yellow outlined labels for dates, numbers, names; reaction close-ups after surprising facts.",
    controls: [
      {
        path: "detail",
        label: "More details",
        help: "Busier pictures: extra clouds, birds and ground clutter in outdoor backdrops, and Claude adds more props and labels to each shot.",
        type: "toggle",
      },
      {
        path: "web.on",
        label: "Use real images from the web",
        help: "Claude finds real photos on Wikimedia Commons (free, with their licence noted in assets/credits.txt) and shows them as framed pictures, like documentary channels do.",
        type: "toggle",
      },
      {
        path: "web.perMin",
        label: "Real images per minute",
        help: "How many real photos per minute of video when real images are on (the rest stays drawn).",
        type: "range",
        min: 0,
        max: 6,
        step: 1,
      },
    ],
  },
  {
    id: "recon",
    name: "3D reconstruction",
    tagline:
      "Documentary reconstructions of real events: matte clay 3D in a bright studio, or a dark cinematic investigation look, with real maps, photos and footage",
    description:
      'The "what really happened" reconstruction look: real events re-staged as matte clay 3D models in a bright seamless studio, with real maps and terrain of the places (OpenStreetMap and elevation data), real photographs and archive footage in print frames, free downloaded 3D models of the real machines and vehicles (artists credited), rigged people whose feet stay planted and whose hands touch what they hold, black name tags, timecards and news-desk cards. The Investigation look turns it into a dark, cinematic investigative documentary for any topic (sport, business, history, science or a crime): glossy faceless mannequins in near-black rooms with one cool light, shallow focus, a desaturated film grade, full-screen archive footage with numbered source credits, white flashes and glitch cuts. Every video is signed off by automatic checks (nothing passes through anything, no flicker) and a frame-by-frame review before it renders. 1920×1080 or vertical 1080×1920.',
    engine: "recon",
    skill: "recon-reconstruction",
    defaultLook: "recon-studio",
    brief:
      "3D reconstruction documentary, 16:9 or 9:16 (settings.format), in one of two looks (settings.theme). Studio (default): real events re-staged as matte off-white clay models in a seamless light-grey studio, high key and natural (soft key light, ambient occlusion, no heavy grading); real photos and footage in white print frames with credits; black name tags on leader lines, bottom-left timecards, chapter cards, big numbers. Investigation: a dark, cinematic investigative documentary - a visual style for any topic, the story's own subject decides the content (crime devices only for a crime story): faceless mannequins whose finish and colour tell who they are (the user's Look > Characters, both looks), near-black rooms lit by one motivated cool key, shallow depth of field, desaturated grade with true blacks and capped highlights, vignette and grain, one crimson accent; full-screen real footage and photos (broll) with numbered bottom-left source credits; fast hard cuts one frame before the word, white flashes and glitch cuts. Both: real places from real map data (OpenStreetMap, elevation), free downloaded 3D models of real objects (CC0/CC-BY, credited), rigged people with planted feet; every fact, time and place exact.",
    controls: [
      {
        path: "format",
        label: "Format",
        help: "1920×1080, or vertical 1080×1920 for shorts. Set when the project is created.",
        type: "select",
        readOnly: true,
        options: [
          { value: "landscape", label: "Wide 16:9" },
          { value: "vertical", label: "Vertical 9:16" },
        ],
      },
      {
        path: "theme",
        label: "Look",
        help: "Studio: matte clay in a bright grey studio. Investigation: dark cinematic investigative documentary for any topic (near-black rooms, glossy mannequins, shallow focus, film grade).",
        type: "select",
        default: "studio",
        options: [
          { value: "studio", label: "Studio (bright clay)" },
          { value: "investigation", label: "Investigation (dark)" },
        ],
      },
      {
        path: "quality.ss",
        label: "Render quality",
        help: "Final renders every frame at twice the size and averages it down: no shimmer on dense scenes like a city seen from the air, but slower. Draft is quicker for trying things.",
        type: "select",
        options: [
          { value: 2, label: "Final (2× supersampling)" },
          { value: 1, label: "Draft (1×)" },
        ],
      },
      {
        path: "post.ao",
        label: "Ambient occlusion",
        help: "Soft contact shadows where surfaces meet: the depth of the look.",
        type: "toggle",
      },
      {
        path: "post.grain",
        label: "Film grain",
        help: "Studio: up to 0.05 (it is high key). Investigation: up to 0.08, about 0.03 looks like film.",
        type: "range",
        min: 0,
        max: 0.08,
        step: 2e-3,
      },
      {
        path: "post.vignette",
        label: "Vignette",
        help: "Studio: keep it light, up to 0.15 (it is high key). Investigation: up to 0.6, about 0.38 frames the subject.",
        type: "range",
        min: 0,
        max: 0.6,
        step: 0.01,
      },
      {
        path: "post.contrast",
        label: "Contrast",
        help: "Investigation only: how hard the blacks and whites are pushed apart.",
        type: "range",
        min: 0.8,
        max: 1.5,
        step: 0.02,
        fmt: "x",
        default: 1.12,
      },
      {
        path: "post.desat",
        label: "Desaturation",
        help: "Investigation only: how much colour is taken out (the reference is almost black and white with one crimson accent).",
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
        fmt: "pct",
        default: 0.55,
      },
      {
        path: "badge",
        label: "Corner tag (RECONSTRUCTION)",
        help: 'The small "RECONSTRUCTION" tag in the top-right corner of every 3D shot. Off by default.',
        type: "toggle",
      },
      {
        path: "figures",
        label: "Characters",
        help: "Who plays each role, in both looks: the body (male, female or your own character), the finish (matte, glossy, glow) and the colour. Scenes name the role (the main character, a witness), so a change here changes the whole video at once. Automatic = the role's usual look.",
        type: "figures",
      },
      {
        path: "media.on",
        label: "Real photos and footage",
        help: "Claude finds real photographs and archive film of the event on Wikimedia Commons (public domain and free licences, credited on screen and in the description) and shows them in print frames between the reconstructions.",
        type: "toggle",
      },
      {
        path: "media.perMin",
        label: "Real pictures per minute",
        help: "How many real photos or film clips per minute of video when real media is on.",
        type: "range",
        min: 0,
        max: 4,
        step: 1,
      },
      {
        path: "models.on",
        label: "Free 3D models from the web",
        help: "Claude downloads free 3D models of the real machines, vehicles and animals (CC0, public domain or CC-BY only, from NASA, the Smithsonian, Poly Pizza, Quaternius and similar) and restyles them to clay; every artist is credited in the description. Off: everything is modelled by code.",
        type: "toggle",
      },
      {
        path: "maps.on",
        label: "Real maps of the places",
        help: "Maps and terrain of the real places from OpenStreetMap and elevation data, showing only what existed at the time of the story.",
        type: "toggle",
      },
    ],
  },
  {
    id: "lowpoly",
    name: "Low poly shorts",
    tagline: "Fast low-poly 3D shorts: blocky game characters, bright or moody sets, a new picture every 1.5-2.5 s",
    description:
      "The look of the big low-poly story shorts: game-style 3D people with real motion-capture animation (walking, sitting, pointing, phone calls, falls), library sets and props (casinos, offices, streets, hospitals, labs, voids), drawn on a low-resolution 3D render that is scaled up, sharpened and colour-fringed like a game capture. One clause of the narration is one shot, the camera never stops moving, numbers pop up in the scene (green gains, red losses, 8-bit banners), and the captions are part of the picture. Two looks: Bright (flat daylight, small yellow captions) and Moody (dark rooms, warm lamps, bloom, soft shadows, white captions). Free 3D models come from a built-in library (CC0 / CC-BY, credited in the description); every new model Claude finds is saved there for your next videos. 1080×1920 shorts or 1920×1080.",
    engine: "lowpoly",
    skill: "lowpoly-shorts",
    defaultLook: "lowpoly-bright",
    looks: ["lowpoly-bright", "lowpoly-moody"],
    brief:
      "Low-poly 3D shorts (9:16, or 16:9): game-style low-poly people from the asset library (mocap clips, drawn original faces, painted outfits), library props and sets (search the library before building anything), rendered at a low internal resolution and scaled up with sharpening and chromatic aberration; ONE CLAUSE = ONE SHOT (1.5-2.5 s, ~24-30 cuts a minute), the camera always moves (push-ins, dutch inserts, POV, top-down, fast pull-outs, tracking walks), literal visuals for every clause, voids for abstract ideas, in-scene number callouts (green gains, red losses, 8-bit banners), captions drawn by the engine, hard cuts with an occasional push wipe / flash / mosaic, the last shot loops back to the first.",
    controls: [
      {
        path: "format",
        label: "Format",
        help: "Vertical 1080×1920 for shorts and reels, or wide 1920×1080. Set when the project is created.",
        type: "select",
        readOnly: true,
        options: [
          { value: "vertical", label: "Vertical 9:16" },
          { value: "landscape", label: "Wide 16:9" },
        ],
      },
      {
        path: "look",
        label: "Lighting and finish",
        help: "Bright: flat daylight, soft upscale, little post. Moody: dark rooms, warm lamps with soft shadows, strong bloom, sharpening, colour fringes and a vignette.",
        type: "select",
        options: [
          { value: "bright", label: "Bright" },
          { value: "moody", label: "Moody" },
        ],
      },
      {
        path: "render.short",
        label: "Render resolution",
        help: "How many pixels the 3D picture is drawn with before it is scaled up: fewer = chunkier, more like an old game capture.",
        type: "select",
        options: [
          { value: 240, label: "240 (very chunky)" },
          { value: 270, label: "270 (Moody channel)" },
          { value: 320, label: "320 (Bright channel)" },
          { value: 360, label: "360" },
          { value: 540, label: "540 (sharp)" },
        ],
      },
      {
        path: "characters.main",
        label: "Main character",
        help: 'The person "you" are in every scene (models.js HERO). Change it any time: the whole video switches, no scene is edited.',
        type: "select",
        options: LOWPOLY_ROSTER,
      },
      {
        path: "characters.cast.friend",
        label: "Cast: Friend",
        help: "Who plays the friend in every scene that has one (they keep the role's clothes). Automatic = the default.",
        type: "select",
        options: [{ value: "", label: "Automatic" }, ...LOWPOLY_ROSTER],
      },
      {
        path: "characters.cast.partner",
        label: "Cast: Partner",
        help: "Who plays the partner in every scene that has one (they keep the role's clothes). Automatic = the default.",
        type: "select",
        options: [{ value: "", label: "Automatic" }, ...LOWPOLY_ROSTER],
      },
      {
        path: "characters.cast.boss",
        label: "Cast: Boss",
        help: "Who plays the boss in every scene that has one (they keep the role's clothes). Automatic = the default.",
        type: "select",
        options: [{ value: "", label: "Automatic" }, ...LOWPOLY_ROSTER],
      },
      {
        path: "characters.cast.dealer",
        label: "Cast: Dealer",
        help: "Who plays the dealer in every scene that has one (they keep the role's clothes). Automatic = the default.",
        type: "select",
        options: [{ value: "", label: "Automatic" }, ...LOWPOLY_ROSTER],
      },
      {
        path: "characters.cast.doctor",
        label: "Cast: Doctor",
        help: "Who plays the doctor in every scene that has one (they keep the role's clothes). Automatic = the default.",
        type: "select",
        options: [{ value: "", label: "Automatic" }, ...LOWPOLY_ROSTER],
      },
      {
        path: "characters.cast.stranger",
        label: "Cast: Stranger",
        help: "Who plays the stranger in every scene that has one (they keep the role's clothes). Automatic = the default.",
        type: "select",
        options: [{ value: "", label: "Automatic" }, ...LOWPOLY_ROSTER],
      },
      {
        path: "captions.on",
        label: "Captions",
        help: "Two to five words at a time, swapping with the voice: small yellow lowercase (Bright) or bold white with an outline (Moody).",
        type: "toggle",
      },
      { path: "captions.size", label: "Caption size", type: "range", min: 0.7, max: 1.6, step: 0.05, fmt: "x" },
      {
        path: "captions.y",
        label: "Caption height",
        help: "Where the captions sit, from the top of the frame.",
        type: "range",
        min: 0.55,
        max: 0.85,
        step: 5e-3,
        fmt: "pct",
      },
      {
        path: "post.sharpen",
        label: "Sharpening",
        help: "The edge halos of a scaled-up game capture.",
        type: "range",
        min: 0,
        max: 1.2,
        step: 0.05,
      },
      {
        path: "post.ca",
        label: "Colour fringes",
        help: "Chromatic aberration: red on one side, blue on the other, stronger toward the corners.",
        type: "range",
        min: 0,
        max: 2,
        step: 0.05,
      },
      { path: "post.bloom", label: "Glow", help: "Lamps, screens and neon glow (bloom).", type: "range", min: 0, max: 1, step: 0.05 },
      { path: "post.vignette", label: "Vignette", type: "range", min: 0, max: 0.8, step: 0.05 },
      {
        path: "camera.push",
        label: "Camera push-in",
        help: "How fast every shot creeps in (per second). The camera always moves.",
        type: "range",
        min: 0,
        max: 0.12,
        step: 5e-3,
        fmt: "pct",
      },
      {
        path: "camera.shake",
        label: "Camera shake",
        help: "A little handheld wobble on every shot.",
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        path: "transitions.duration",
        label: "Wipe length",
        help: "Most cuts are hard cuts; this is the length of the push / blinds wipes and mosaic dissolves.",
        type: "range",
        min: 0.2,
        max: 0.7,
        step: 0.02,
        fmt: "s",
      },
      {
        path: "ps1.snap",
        label: "PS1 strict: vertex wobble",
        help: "Snaps every vertex to the low-res pixel grid, like the PlayStation 1 (off in both analysed channels).",
        type: "toggle",
      },
      {
        path: "ps1.affine",
        label: "PS1 strict: texture warp",
        help: "Affine texture mapping: textures swim on big surfaces, like the PlayStation 1.",
        type: "toggle",
      },
      { path: "ps1.dither", label: "PS1 strict: dither", help: "15-bit colour with ordered dithering.", type: "toggle" },
    ],
  },
  {
    id: "toon",
    name: "3D cartoon shorts",
    tagline: "Big-headed 3D cartoon characters with expressive faces in busy, fully dressed sets: a new shot on every clause",
    description:
      "Fast 3D cartoon shorts with our own cast of big-headed characters: soft toon shading with ink outlines, painted faces that change expression on the word, smooth hand-keyed acting (walks, gestures, reactions, hops), dense dressed sets (rooms, streets, offices, labs, nature) full of props, warm light, depth of field and bloom. One clause of the narration is one shot, the camera always moves (creeps, pushes, reveals, quick reaction push-ins), shots join with short dissolves, and bold captions are drawn into the picture. Pick your main character from a cast of 20. Two looks: Cinema (soft rim light, strong depth of field, glow, vignette and film grain) and Clean (brighter and flatter, for explainers). 1080×1920 shorts or 1920×1080.",
    engine: "toon",
    skill: "toon-shorts",
    defaultLook: "toon-cinema",
    looks: ["toon-cinema", "toon-clean"],
    brief:
      '3D cartoon shorts (9:16, or 16:9): our own big-headed toon characters (the cast in lib/cast.js, the main character is "you") with painted faces that change expression on the word, soft toon shading with ink outlines, dense dressed sets (never an empty frame), depth of field and bloom; the script is a short, punchy second-person story ("you wake up, you open the fridge..."), ONE IDEA MADE LITERAL PER CLAUSE, about 210-230 words per minute; ONE CLAUSE = ONE SHOT, characters act on their words (gestures, walks, reactions), the camera always moves (creep, push, reveal, reaction push-ins), 5-7 frame dissolves, bold captions drawn by the engine that never cover a face.',
    controls: [
      {
        path: "format",
        label: "Format",
        help: "Vertical 1080×1920 for shorts and reels, or wide 1920×1080. Set when the project is created.",
        type: "select",
        readOnly: true,
        options: [
          { value: "vertical", label: "Vertical 9:16" },
          { value: "landscape", label: "Wide 16:9" },
        ],
      },
      {
        path: "characters.main",
        label: "Main character",
        help: 'The character "you" are in every scene. Change it any time: the whole video switches, no scene is edited.',
        type: "select",
        options: TOON_CAST,
      },
      {
        path: "characters.palette",
        label: "Faces",
        help: "Skin tones: every character has their own skin colour. White: the classic look, every head and hand is clean white (the faces, hair and clothes stay). Change it any time.",
        type: "select",
        default: "tones",
        options: [
          { value: "tones", label: "Skin tones" },
          { value: "white", label: "White (classic)" },
        ],
      },
      {
        path: "captions.on",
        label: "Captions",
        help: "Two words at a time in bold white with a dark outline, swapping with the voice, drawn into the picture.",
        type: "toggle",
      },
      { path: "captions.size", label: "Caption size", type: "range", min: 0.7, max: 1.6, step: 0.05, fmt: "x" },
      {
        path: "post.dof",
        label: "Depth of field",
        help: "How strongly the background (and the near foreground) goes soft behind the subject.",
        type: "range",
        min: 0,
        max: 1.5,
        step: 0.05,
        fmt: "x",
      },
      {
        path: "post.bloom",
        label: "Glow",
        help: "Lamps, screens and bright highlights glow (bloom).",
        type: "range",
        min: 0,
        max: 1,
        step: 0.02,
      },
      { path: "post.vignette", label: "Vignette", type: "range", min: 0, max: 0.7, step: 0.02 },
      { path: "post.grain", label: "Film grain", type: "range", min: 0, max: 0.06, step: 2e-3 },
    ],
  },
  {
    // Stick stories (2026-10-23: built overnight, battle-tested with two 8-minute videos). Engine templates/stickstory (a
    // 2.5D cut-out theatre on the toon shot system), skill stickstory-videos, study + build log experiments/stickstory-style.
    // No character picker yet: the main character is lib/cast.js 'you' (the blue hoodie) unless settings.characters.main names one.
    id: "stickstory",
    name: "Stick stories",
    tagline: '"What if you..." stories acted by black stick people in illustrated sets, with HUD graphics, maps and diagrams',
    description:
      'Story videos told to "you" ("What if you woke up..."), 8-12 minutes or shorter: black-silhouette stick people with round heads, white eye and mouth shapes, coloured clothes and a coloured rim light act every clause in flat-vector illustrated sets (rooms, streets, offices, labs, landscapes) layered at real depths, so the long-lens camera gets parallax and soft depth of field. Hand close-ups, HUD graphics, maps, diagrams and counters show the facts on their words; a new picture on every clause, mostly hard cuts, the camera still on faces and nudging in on the wides, a 2:1 letterbox, film grain and a vignette. Characters can speak their lines in their own voices. Two looks: Story (the studied look: depth of field, grain, vignette) and Clean (flatter, no grain). 1920×1080 for YouTube, or 1080×1920.',
    engine: "stickstory",
    skill: "stickstory-videos",
    defaultLook: "stickstory-story",
    looks: ["stickstory-story", "stickstory-clean"],
    brief: `Stick stories (16:9, or 9:16): a long "What if you..." story told to "you" in the second person, acted by black-silhouette stick people (round black heads, white eye and mouth shapes, coloured clothes, coloured rim light; S.char('main') is "you") in flat-vector illustrated sets layered at real depths (parallax, depth of field); the script is a gripping hypothetical that escalates step by step with concrete, visual consequences ("on day one you notice...", "a week later..."), about 150-165 words per minute, 8-12 minutes for a full video; ONE PICTURE PER CLAUSE (about 25 shots a minute), the characters act on their words, hand close-ups, HUD graphics, maps, diagrams and counters carry the facts and numbers on their words, a slow creeping long-lens camera, cuts and short dissolves, film grain and a vignette.`,
    controls: [
      {
        path: "format",
        label: "Format",
        help: "Wide 1920×1080 for YouTube, or vertical 1080×1920 for Shorts and Reels. Set when the project is created.",
        type: "select",
        readOnly: true,
        options: [
          { value: "landscape", label: "Wide 16:9" },
          { value: "vertical", label: "Vertical 9:16" },
        ],
      },
      {
        path: "captions.on",
        label: "Captions",
        help: "A few words at a time near the bottom, swapping with the voice, drawn into the picture. Off in the studied look.",
        type: "toggle",
      },
      { path: "captions.size", label: "Caption size", type: "range", min: 0.7, max: 1.6, step: 0.05, fmt: "x" },
      {
        path: "post.dof",
        label: "Depth of field",
        help: "How soft the layers in front of and behind the subject go.",
        type: "range",
        min: 0,
        max: 1.5,
        step: 0.05,
        fmt: "x",
      },
      { path: "post.bloom", label: "Glow", help: "Lamps, screens and HUD lights glow.", type: "range", min: 0, max: 0.6, step: 0.02 },
      { path: "post.vignette", label: "Vignette", type: "range", min: 0, max: 0.6, step: 0.02 },
      { path: "post.grain", label: "Film grain", type: "range", min: 0, max: 0.08, step: 2e-3 },
      {
        path: "camera.drift",
        label: "Camera drift",
        help: "How much the camera creeps and sways in every shot.",
        type: "range",
        min: 0,
        max: 1.5,
        step: 0.05,
        fmt: "x",
      },
    ],
  },
  {
    // The Style Studio's plain base (templates/starter + skill studio-starter): never offered as a style of its own
    // (hidden), only the ground new styles grow from. CZ_SHOW_STARTER=1 lists it in New project as "Starter (dev)".
    id: "starter",
    hidden: true,
    name: "Starter",
    tagline: "The plain base new styles grow from: 2D or 3D, 9:16 or 16:9",
    description:
      "A neutral Three.js engine with set rules: flat 2D shapes in pixels or simple lit 3D solids on a ground, word-timed shots, word-highlight captions, cut / dissolve / push transitions, a light film finish and the full set of layout, visibility, camera and 3D contact checks. It has no look of its own: the Style Studio reshapes it into one.",
    engine: "starter",
    skill: "studio-starter",
    defaultLook: "starter-plain",
    looks: ["starter-plain", "starter-plain-3d"],
    brief:
      "A plain starter style: neutral palette (THEMES.base), clean sans-serif type, simple shapes (2D) or simple lit solids on a ground (3D), one idea per frame, every element on its spoken word with eased motion, nothing cut by the frame edge, no accidental overlaps, every text readable, nothing in the caption band.",
    controls: [
      {
        path: "format",
        label: "Format",
        help: "Vertical 1080×1920 or wide 1920×1080. Set when the project is created.",
        type: "select",
        readOnly: true,
        options: [
          { value: "landscape", label: "Wide 16:9" },
          { value: "vertical", label: "Vertical 9:16" },
        ],
      },
      {
        path: "dim",
        label: "Dimension",
        help: "2D: flat shapes in pixels. 3D: lit solids on a ground. Set when the project is created.",
        type: "select",
        readOnly: true,
        options: [
          { value: "2d", label: "2D" },
          { value: "3d", label: "3D" },
        ],
      },
      { path: "captions.on", label: "Captions", help: "Word-highlight captions in the reserved band near the bottom.", type: "toggle" },
      { path: "captions.size", label: "Caption size", type: "range", min: 44, max: 72, step: 2 },
      { path: "post.grain", label: "Film grain", type: "range", min: 0, max: 0.1, step: 5e-3 },
      { path: "post.vignette", label: "Vignette", type: "range", min: 0, max: 0.4, step: 0.02 },
      { path: "post.contrast", label: "Contrast", type: "range", min: 0.8, max: 1.4, step: 0.02, fmt: "x", default: 1 },
      {
        path: "camera.push",
        label: "Camera push-in",
        help: "How much every shot slowly pushes in.",
        type: "range",
        min: 0,
        max: 0.1,
        step: 5e-3,
        fmt: "pct",
      },
      { path: "transitions.duration", label: "Transition length", type: "range", min: 0.2, max: 0.8, step: 0.02, fmt: "s" },
    ],
  },
  {
    id: "vox",
    legacy: true,
    name: "Vox editorial (old)",
    tagline: "Layered paper collage documentaries, vertical or wide",
    description:
      'Editorial documentary look built entirely in Three.js: paper, grid, wood and newsprint boards, cut-out stickers and printed halftone "photos" at real depth, pins, tape and marker annotations, Vox-style text animators (fill, odometer, random letters, typewriter), a camera that never stops moving, cut-the-curve and rack-focus transitions, grain and halftone texture, and tactile sound design. 1080×1920 shorts or 1920×1080 videos.',
    engine: "vox",
    skill: "vox-editorial-video",
    defaultLook: "vox-editorial",
    brief:
      'Vox-style editorial collage: layered paper boards (grid, dots, wood, felt, newsprint), cut-out sticker illustrations and printed halftone/duotone "photos" of procedural 3D subjects, pins, tape and marker circles/arrows, one bold text animation at a time (yellow/red highlight, odometer numbers), constant slow camera drift with parallax, cut-the-curve transitions and tactile sound. Everything is built procedurally in Three.js; real images and footage can be added later as printed cards.',
    controls: [
      {
        path: "format",
        label: "Format",
        help: "Vertical 1080×1920 for shorts, or 1920×1080. Set when the project is created.",
        type: "select",
        readOnly: true,
        options: [
          { value: "vertical", label: "Vertical 9:16" },
          { value: "landscape", label: "Wide 16:9" },
        ],
      },
      {
        path: "theme",
        label: "Colour theme",
        help: "Paper, ink and accent colours for every element.",
        type: "select",
        options: [
          { value: "editorial", label: "Editorial (cream + yellow)" },
          { value: "archive", label: "Archive (sepia + wax red)" },
          { value: "newsroom", label: "Newsroom (white + red)" },
          { value: "tabletop", label: "Tabletop (bold + yellow)" },
        ],
      },
      { path: "post.grain", label: "Film grain", type: "range", min: 0, max: 0.12, step: 5e-3 },
      {
        path: "post.halftone",
        label: "Halftone screen",
        help: "Printed dot texture over the frame (dances slightly as the camera moves).",
        type: "range",
        min: 0,
        max: 0.5,
        step: 0.02,
      },
      {
        path: "post.paper",
        label: "Paper texture",
        help: "Paper grain over everything, adjusted by luminance so colours stay clean.",
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
      },
      { path: "post.vignette", label: "Vignette", type: "range", min: 0, max: 0.7, step: 0.05 },
      {
        path: "post.lift",
        label: "Lifted blacks",
        help: "Blacks become dark grey: the editorial print range.",
        type: "range",
        min: 0,
        max: 0.15,
        step: 0.01,
      },
      { path: "post.warmth", label: "Warmth", type: "range", min: -1, max: 1, step: 0.1 },
      {
        path: "camera.drift",
        label: "Camera drift per shot",
        help: "How much every shot creeps in. Vox never holds still.",
        type: "range",
        min: 0,
        max: 0.12,
        step: 5e-3,
        fmt: "pct",
      },
      {
        path: "camera.fov",
        label: "Field of view",
        help: "Lower = flatter collage, higher = more parallax between layers.",
        type: "range",
        min: 18,
        max: 45,
        step: 1,
        fmt: "deg",
      },
      { path: "transitions.duration", label: "Transition length", type: "range", min: 0.2, max: 0.9, step: 0.02, fmt: "s" },
      { path: "light.shadows", label: "Soft shadows", help: "Paper layers cast soft drop shadows on each other.", type: "toggle" },
      { path: "light.softness", label: "Shadow softness", type: "range", min: 0.3, max: 2.5, step: 0.1, fmt: "x" },
    ],
  },
];
const BRAND_HELP = {
  "pixel-art":
    "Your channel's colour for the chapter cards, chapter tag and stat units (Claude keeps the 3D art in the look's own palette, using its nearest colour).",
  collage:
    "Your channel's colour instead of the red: stamps, dates, marker circles, tags and headlines (darkened just enough to read on the paper).",
  flat: "Your channel's colour for the spoken word in the captions, tags, title and chapter cards, highlights and the end card.",
  stickman: "Your channel's colour for the labels and the date and number cards instead of red.",
  recon: "Your channel's colour instead of the blue: chapter kickers, timecards, callouts, route lines and place dots.",
  vox: "Your channel's colour for the highlights and accents Claude draws.",
  lowpoly:
    "Your channel's colour for the 8-bit number banners, the brand sting and the game-UI panel frames (green gains and red losses keep their colours).",
  toon: "Your channel's colour for the signs, labels and screens Claude puts in the sets and a recurring prop of the channel (the characters keep their own clothes).",
  stickstory:
    "Your channel's colour for the HUD graphics, map markers, labels and title cards Claude draws (the stick people keep their own clothes).",
  starter: "Your channel's colour for the spoken word in the captions, the default tag fill and the key accents Claude draws.",
};
for (const s of STYLES)
  s.controls.push({
    path: "brand.color",
    label: "Brand colour",
    type: "color",
    clearable: true,
    help: BRAND_HELP[s.id] + " Style default keeps the style's own colours; text on it turns light or dark by itself.",
  });
export const CUSTOM = [];
export const PACKAGES = [];
export const allStyles = () => [...STYLES, ...PACKAGES, ...CUSTOM];
export const CARRIED = new Map();
const standIn = (id) => {
  const c = CARRIED.get(id),
    b = STYLES.find((s) => s.id === c?.base && !s.legacy) ?? STYLES.find((s) => s.id === "collage");
  return {
    ...b,
    id,
    name: c ? `${c.name} (not installed)` : "Missing custom style",
    tagline: "This custom style is not installed on this computer",
    custom: true,
    missing: true,
    base: b.id,
    defaultLook: b.defaultLook,
  };
};
export const getStyle = (id) =>
  STYLES.find((s) => s.id === id) ??
  PACKAGES.find((s) => s.id === id) ??
  (id ? PACKAGES.find((s) => s.pkg?.manifest.aliases.includes(id)) : void 0) ??
  CUSTOM.find((s) => s.id === id) ??
  (id && id.startsWith("custom-") ? standIn(id) : STYLES[0]);
export function pinnedManifest(dir, id) {
  if (!dir) return null;
  try {
    const p = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, ".style-pkg", "style.json"), "utf8").replace(/^﻿/, "")));
    return p.ok && (!id || p.m.id === id) && !p.m.official ? p.m : null;
  } catch {
    return null;
  }
}
export function manifestOf(styleId, dir) {
  const st = getStyle(styleId);
  if (!st.pkg) return null;
  return (!st.pkg.official ? pinnedManifest(dir, st.id) : null) ?? st.pkg.manifest;
}
export const engineDirOf = (id) => {
  const st = getStyle(id);
  return st.pkg ? st.pkg.engineDir : st.custom && st.dir ? st.dir : path.join(templatesDir(), st.engine);
};
export const baseOf = (id) => {
  const st = getStyle(id);
  return st.base ?? st.id;
};
export const aspectOf = (styleId, settings) => {
  const st = getStyle(styleId);
  if (st.pkg) {
    const a = st.aspects?.length ? st.aspects : ["16:9"],
      r = (x) => (x === "9:16" ? 9 / 16 : 16 / 9);
    if (a.length === 1) return r(a[0]);
    return settings?.format === "vertical" ? 9 / 16 : settings?.format === "landscape" ? 16 / 9 : r(a[0]);
  }
  const id = baseOf(styleId);
  if (id === "vox") return (settings?.format ?? "vertical") !== "landscape" ? 9 / 16 : 16 / 9;
  if (id === "collage") return settings?.format === "vertical" ? 9 / 16 : 16 / 9;
  if (id === "flat" || id === "lowpoly" || id === "toon") return settings?.format === "landscape" ? 16 / 9 : 9 / 16;
  if (id === "starter" || id === "recon" || id === "stickstory") return settings?.format === "vertical" ? 9 / 16 : 16 / 9;
  return 16 / 9;
};
export const isMine = (styleId) => {
  const st = getStyle(styleId);
  return !!st.custom || (!!st.pkg && !st.pkg.official);
};
export const pkgPrompt = (styleId, key2, dir) => {
  const m = manifestOf(styleId, dir);
  return m ? String(m.prompts?.[key2] ?? "").trim() : "";
};
export const needsImageKey = (styleId) => {
  const v = getStyle(styleId).pkg?.manifest.capabilities?.needsImageKey;
  return typeof v === "boolean" ? v : baseOf(styleId) === "collage";
};
export const smoothScale = (styleId) => {
  const v = getStyle(styleId).pkg?.manifest.render?.smooth;
  return typeof v === "boolean"
    ? v
    : styleId === "vox" || ["collage", "flat", "lowpoly", "toon", "stickstory", "starter", "recon"].includes(baseOf(styleId));
};
export const GIF_WIDTH = { smooth: 540, hard: 960 };
const LAYOUT_BASES = new Set(["recon", "flat", "collage", "lowpoly", "toon", "stickstory", "starter", "pixel-art"]);
export const hasLayoutCheck = (styleId, base = baseOf(styleId)) => {
  const v = getStyle(styleId).pkg?.manifest.checks?.layout;
  return typeof v === "boolean" ? v : LAYOUT_BASES.has(base);
};
export const QUALITY_BAR = {
  recon:
    "matte off-white clay in a bright, high-key studio light; real proportions and real sizes; everything rests on the ground or the water with a contact shadow, nothing floats or passes through anything; the real, period-correct places and objects the story names; black name tags on clean leader lines in empty space, never over the subject; one clear subject per shot and a calm camera with a purpose.",
  flat: "exact flat colours, one colour per concept and used consistently; only rounded primitives; one light from the top-left, shading a darker tint cut from the outline; the main character on model and acting; every event on its word with eased motion, nothing snaps; nothing important in the caption band.",
  collage:
    "a newspaper cut-out collage on one front page: paper layers, tape, print texture and bold headline type; cut-outs clean (no leftover background or text inside them); every panel with a foreground, a subject and a background; one bold text animation at a time.",
  stickman:
    "MS Paint stick figures: big heads with faces that show the feeling, a new picture on every clause, the chapter title on every frame, red and yellow outlined labels spelled right and readable; clumsy charm, but always clear.",
  lowpoly:
    "low-poly 3D game capture: library people with real mocap clips posed for what is said (never T-posed, frozen or sliding), faces with the face sheet expression that matches the words (expr on the word), hands that act (fingers: wiggle, point, fist), every set dressed with library props in a foreground, midground and background (furniture, extras, lamps with light pools, signs), real light for the look (Bright: flat daylight; Moody: dark room, a warm key on the subject, glowing practicals, soft shadows), a camera that always moves, a literal picture of the clause (abstract ideas: ONE clear object in a void set, a state change shown on that object), no two neighbouring shots with the same set and framing, nothing passing through anything (hair, hats and glasses included), feet planted on the floor, held props in the hand, callouts and captions readable and never on a face (16:9: panels beside the subject, not over the head).",
  toon: "3D cartoon shorts: our own big-headed toon cast on model (ink outlines, soft toon shading), faces readable in every shot with the expression that matches the words (changed on the word), characters acting their clause (gestures land on the stressed word, walks with planted feet, reactions, never frozen or sliding), smooth eased motion with no pops; every set densely dressed with props in a foreground, midground and background (no empty frames, no bare floor or wall filling the shot), warm motivated light, depth of field that keeps the subject sharp; a camera that always moves; a literal picture of every clause; no two neighbouring shots with the same set and framing; nothing passing through anything, props held in the hand, feet on the floor; every frame checked; captions readable and never covering a face.",
  stickstory:
    "stick stories: black-silhouette stick people on model (round black heads, white eye and mouth shapes, coloured clothes, a coloured rim light), each acting its clause (poses and gestures landing on the stressed word, walks with planted feet, reactions; never frozen or sliding) with face shapes that change on the word; every set a dressed flat-vector place with a foreground, midground and background at real depths (parallax, depth of field that keeps the subject sharp), motivated light and glowing practicals; a literal picture of every clause; facts and numbers as clean HUD graphics, maps, diagrams, counters and hand close-ups that land on their words and stay readable for 1.5 s; a slow, eased long-lens camera; no two neighbouring shots with the same set and framing; nothing passing through anything, held props in the hand, feet on the floor; every frame checked.",
  "pixel-art":
    "the look's palette only (RAMP names, never hex), crisp outlines and readable silhouettes at the art resolution, dithered skies, solid shadows; the HUD text readable against what is behind it; no shimmering edges; nothing passing through anything or floating (check_layout Clean); every real thing the voiceover names shown full screen (brollShot); a different set, light or angle from the shot before.",
  vox: 'layered paper boards, cut-out stickers and printed "photos" at real depth, pins, tape and marker annotations; a camera that never fully stops; one bold text animation at a time.',
  starter:
    "the style's own STYLE_GUIDE (its palette, type, elements and motion) wherever it has one; and always the shared rules: one clear idea per frame, nothing cut by the frame edge, no accidental overlaps, every text readable at phone size with real contrast, nothing in the caption band, every element on its spoken word with eased motion, a calm eased camera; in 3D everything rests on what holds it and nothing passes through anything.",
};
export const qualityBarOf = (styleId, dir) => {
  const st = getStyle(styleId);
  if (st.pkg)
    return (
      pkgPrompt(st.id, "qualityBar", dir) ||
      `${QUALITY_BAR[baseOf(st.id)] ?? "the shared rules: nothing cut by the frame edge, no accidental overlaps, every text readable, every element on its word, eased camera."} The LOOK is this style's own ("${st.name}", .claude/skills/style-${st.id}/): where it differs from the base style's look, the style wins.`
    );
  return QUALITY_BAR[baseOf(styleId)];
};
export const INV_ANY_TOPIC = `ANY TOPIC: the Investigation look is a VISUAL style - a dark, cinematic investigative documentary (near-black dioramas, faceless mannequins in the user's finishes and colours, full-screen archive, documents on a dark desk, network grids, one accent colour, its burst-then-hold pacing) - not a genre: it fits any story (sport, business, history, science, a life story, or a crime). The story's own topic decides the content. Crime devices (suspects and a victim, mugshot-like cards, redactions, police, "the crime", an arrest) belong only to a story that IS about a crime or an investigation. Any other topic uses the same devices for its own subject: the board (crimeBoard()) pins that story's players, teams, companies or events; the network grid shows who connects to whom in that field; the documents, headlines and screens are that field's own (a team sheet, a contract, a lab notebook, a match report); the people are the story's own roles; the tone is investigative (what really happened, and how), never a crime show's. Never invent a crime, suspects, a victim, police or an investigation the story does not have, and picture prompts (make_image, make_target, make_texture) describe the shot's own subject in the look's visual terms, never a genre label.`;
const CRIME_TOPIC =
  /\b(crimes?|criminals?|murder\w*|killers?|killings?|homicides?|manslaughter|heists?|robber(y|ies|s)?|robbed|thefts?|thie(f|ves)|stole|stolen|fraud\w*|scam\w*|ponzi|embezzl\w*|swindl\w*|con (man|men|artist)|kidnap\w*|abduct\w*|hostages?|cartels?|mafia|mobsters?|gangsters?|smuggl\w*|traffick\w*|ransomware|hackers?|hacked|cyber ?attacks?|police|fbi|interpol|detectives?|arrest\w*|convict\w*|prisons?|jail\w*|on trial|murder trial|indict\w*|investigations?|cold case|assassinat\w*|terroris\w*|bombings?|spy|spies|espionage|poison\w*|forger(y|ies)|counterfeit\w*|brib\w*|corruption|laundering|manhunt|disappearance)\b/i;
export const invCrimeTopic = (topic) => !!topic && CRIME_TOPIC.test(topic);
export const invTopicNote = (topic) =>
  invCrimeTopic(topic)
    ? `THIS STORY IS ABOUT A CRIME OR AN INVESTIGATION (its topic says so): the crime devices fit where the story has them (the suspects, the victim, the police, the crime board, redactions, the arrest).`
    : topic?.trim()
      ? `THIS STORY'S TOPIC ("${topic.trim().slice(0, 160)}") IS NOT A CRIME STORY unless the research shows one: no crime devices (no suspects, victims, police, redactions or arrests); the look's devices show this topic's own people, places, documents and events.`
      : "THE TOPIC decides: crime devices only if the script and research are about a crime or an investigation; otherwise the look's devices show the topic's own people, places, documents and events.";
