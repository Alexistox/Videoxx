import path from "node:path";
import fs from "node:fs";
import { now, q, uid } from "../db/db";
import { validateByControls } from "./manifest";
import { baseOf, getStyle } from "./catalog";
import { brandError } from "./brand";
import { figuresError } from "./figures";
import { validateGraphics } from "./graphicsControls";
import { cleanLook, isCharId } from "../characters/looks";

const voxLook = (theme, post, extra = {}) => ({
  format: "vertical",
  theme,
  post: { grain: 0.045, halftone: 0.14, paper: 0.3, vignette: 0.3, aberration: 0, lift: 0.06, warmth: 0, ...post },
  camera: { fov: 28, drift: 0.045 },
  transitions: { duration: 0.42 },
  light: { shadows: true, softness: 1, mapSize: 2048 },
  ...extra,
});
const collageLook = (theme, post = {}, extra = {}) => ({
  format: "landscape",
  theme,
  palette: null,
  post: { grain: 0.035, paper: 0.4, halftone: 0.07, vignette: 0.16, warmth: 0.15, tone: 0, ...post },
  camera: { fov: 16, drift: 0.035 },
  transitions: { duration: 0.62 },
  sheet: { cols: 4, gap: 1.1 },
  pace: { perMinute: 12 },
  shadow: { opacity: 0.32, softness: 1 },
  border: 1,
  ...extra,
});
const flatLook = (post = {}, extra = {}) => ({
  format: "vertical",
  captions: { on: true, size: 56 },
  post: { grain: 0.07, vignette: 0.16, ...post },
  transitions: { duration: 0.42 },
  camera: { push: 0.05, punch: 0.03 },
  ...extra,
});
const reconLook = (extra = {}) => ({
  format: "landscape",
  badge: false,
  quality: { ss: 2 },
  post: { grain: 0.014, vignette: 0.07, ao: true },
  media: { on: true, perMin: 1 },
  models: { on: true },
  maps: { on: true },
  ...extra,
});
const stickLook = (extra = {}) => ({ format: "landscape", detail: false, web: { on: false, perMin: 2 }, ...extra });
const lowpolyLook = (look, extra = {}) => ({
  format: "vertical",
  look,
  render: { short: look === "moody" ? 270 : 320 },
  post:
    look === "moody"
      ? { sharpen: 0.75, ca: 1, bloom: 0.4, threshold: 0.82, vignette: 0.5, grain: 0 }
      : { sharpen: 0.28, ca: 0.35, bloom: 0.18, threshold: 0.88, vignette: 0, grain: 0 },
  captions: { on: true, size: 1, y: look === "moody" ? 0.75 : 0.675 },
  camera: { push: look === "moody" ? 0.05 : 0.06, shake: 0 },
  transitions: { duration: 0.36 },
  ps1: { snap: false, affine: false, dither: false },
  characters: { main: "alex", cast: {} },
  ...extra,
});
const toonLook = (look, extra = {}) => ({
  format: "vertical",
  look,
  quality: 1,
  post:
    look === "cinema"
      ? { bloom: 0.32, threshold: 0.82, dof: 1, vignette: 0.28, grain: 6e-3, ca: 0, sharpen: 0.12 }
      : { bloom: 0.2, threshold: 0.88, dof: 0.45, vignette: 0.12, grain: 0, ca: 0, sharpen: 0.1 },
  light: { shadows: true, ao: look === "cinema" ? 1 : 0.6 },
  captions: { on: true, size: 1, y: 0.705, words: 2 },
  camera: { drift: look === "cinema" ? 1 : 0.6 },
  transitions: { duration: 0.4 },
  characters: { main: "milo", palette: "tones" },
  ...extra,
});
const stickstoryLook = (look, extra = {}) => ({
  format: "landscape",
  look,
  quality: 1,
  post:
    look === "story"
      ? { bloom: 0.18, threshold: 0.9, dof: 1, vignette: 0.3, grain: 0.035, ca: 0, sharpen: 0.05 }
      : { bloom: 0.1, threshold: 0.92, dof: 0.5, vignette: 0.15, grain: 0, ca: 0, sharpen: 0.05 },
  captions: { on: false, size: 1, y: 0.86, words: 4 },
  camera: { drift: look === "story" ? 1 : 0.6 },
  transitions: { duration: 0.25 },
  ...extra,
});
const starterLook = (dim) => ({
  format: "landscape",
  dim,
  theme: "base",
  captions: { on: true, size: 56 },
  post: { grain: 0.035, vignette: 0.12, contrast: 1, desat: 0, warmth: 0 },
  camera: { push: 0.04, punch: 0.02, fov: 40 },
  transitions: { duration: 0.4 },
  quality: { ss: null, shadows: true },
});
const BUILTIN = [
  {
    id: "hidetail",
    name: "Hi-detail 480",
    description:
      "The Brains vs Brawn look: 480×270 art, object outlines that separate touching shapes, light-facing rim, outlines fading with fog.",
    settings: {
      art: { width: 480, height: 270 },
      outline: { depth: true, objectId: true, rim: true, fogFade: true, color: "#1a1c2c" },
      shadows: { enabled: true, mapSize: 4096 },
      post: { vignette: 0.35, dither: 0.05 },
      transitions: { duration: 0.42, chapterDuration: 0.5, pixelateMax: 12 },
      camera: { fov: 40, push: 0.04 },
    },
  },
  {
    id: "classic",
    name: "Classic 320",
    description: "The original pixel-explainer look: chunky 320×180 pixels, depth outlines only.",
    settings: {
      art: { width: 320, height: 180 },
      outline: { depth: true, objectId: false, rim: false, fogFade: false, color: "#1a1c2c" },
      shadows: { enabled: true, mapSize: 2048 },
      post: { vignette: 0.35, dither: 0.05 },
      transitions: { duration: 0.42, chapterDuration: 0.5, pixelateMax: 15 },
      camera: { fov: 40, push: 0.04 },
    },
  },
  {
    id: "crisp",
    name: "Crisp 640",
    description: "Fine 640×360 pixel art for detailed scenes and small props. Heavier on the GPU.",
    settings: {
      art: { width: 640, height: 360 },
      outline: { depth: true, objectId: true, rim: true, fogFade: true, color: "#1a1c2c" },
      shadows: { enabled: true, mapSize: 4096 },
      post: { vignette: 0.3, dither: 0.04 },
      transitions: { duration: 0.42, chapterDuration: 0.5, pixelateMax: 10 },
      camera: { fov: 40, push: 0.04 },
    },
  },
  {
    id: "hibit",
    name: "Hi-Bit 640",
    description:
      "The upgraded pixel art look: fine 640×360 pixels in about 100 colours with five shading steps per surface, smooth dithered skies, glowing screens and neon, full-screen b-roll of the real things the voiceover names.",
    settings: {
      art: { width: 640, height: 360 },
      outline: { depth: true, objectId: true, rim: true, fogFade: true, color: "#1a1c2c" },
      shadows: { enabled: true, mapSize: 4096 },
      post: { vignette: 0.26, dither: 0.04 },
      transitions: { duration: 0.42, chapterDuration: 0.5, pixelateMax: 10 },
      camera: { fov: 40, push: 0.03 },
      color: { palette: "hibit", bands: 5 },
    },
  },
  {
    id: "diagram",
    name: "Flat diagram",
    description: "For diagram and data shots: no cast shadows, no rim, light vignette, calm camera.",
    settings: {
      art: { width: 480, height: 270 },
      outline: { depth: true, objectId: true, rim: false, fogFade: false, color: "#1a1c2c" },
      shadows: { enabled: false, mapSize: 2048 },
      post: { vignette: 0.2, dither: 0.03 },
      transitions: { duration: 0.42, chapterDuration: 0.5, pixelateMax: 12 },
      camera: { fov: 36, push: 0.02 },
    },
  },
  {
    id: "collage-press",
    styleId: "collage",
    name: "Press",
    description: "Cream and kraft paper, charcoal engraving cut-outs, red stamps and marker. The classic newspaper collage.",
    settings: collageLook("press"),
  },
  {
    id: "collage-sepia",
    styleId: "collage",
    name: "Sepia archive",
    description:
      "Everything printed in sepia on aged parchment: brown engravings and ink, heavy paper texture, a darker vignette. History and archival stories.",
    settings: collageLook("sepia", { paper: 0.6, grain: 0.05, vignette: 0.3, warmth: 0.3, tone: 0.55 }),
  },
  {
    id: "collage-broadsheet",
    styleId: "collage",
    name: "Broadsheet",
    description: "Crisp white newsprint, true black ink and a loud red, light texture: news, business and tech stories.",
    settings: collageLook("broadsheet", { paper: 0.18, halftone: 0.04, vignette: 0.06, warmth: -0.05, grain: 0.025 }),
  },
  {
    id: "collage-press-vertical",
    styleId: "collage",
    name: "Press vertical",
    description: "The Press look for shorts (1080×1920), panels stacked two per row.",
    settings: collageLook("press", {}, { format: "vertical", sheet: { cols: 2, gap: 1.1 } }),
  },
  {
    id: "flat-midnight",
    styleId: "flat",
    name: "Studio",
    description:
      "Soft film grain, a gentle vignette, a slow push-in on every shot and a small punch-in after each cut, word-highlight captions. The format (9:16 or 16:9) is picked per project.",
    settings: flatLook(),
  },
  {
    id: "recon-studio",
    styleId: "recon",
    name: "Studio",
    description:
      "Matte clay in a bright seamless studio, soft key light and ambient occlusion, a whisper of grain, real maps, photos, footage and free 3D models. 16:9 or 9:16 (picked per project).",
    settings: reconLook(),
  },
  {
    id: "recon-investigation",
    styleId: "recon",
    name: "Investigation",
    description:
      "Dark, cinematic investigative documentary for any topic (sport, business, history, science or a crime: the story decides what is shown): glossy faceless mannequins in near-black rooms lit by one cool light, shallow focus, a desaturated film grade with soft whites, grain and a strong vignette, one crimson accent, full-screen archive footage with numbered source credits, white flashes and glitch cuts. 16:9 or 9:16 (picked per project).",
    settings: reconLook({ theme: "investigation", post: { grain: 0.03, vignette: 0.38, ao: true, contrast: 1.18, desat: 0.55 } }),
  },
  {
    id: "stickman-paint",
    styleId: "stickman",
    name: "MS Paint",
    description: "White-sky Paint backdrops, scribbly mouse-drawn stick figures, red and yellow labels, hard cuts every 2-3 seconds. 16:9.",
    settings: stickLook(),
  },
  {
    id: "lowpoly-bright",
    styleId: "lowpoly",
    name: "Bright",
    description:
      "Flat bright daylight, a soft 320-pixel upscale with light sharpening, small yellow lowercase captions: the weird-facts low-poly shorts look. 9:16 or 16:9.",
    settings: lowpolyLook("bright"),
  },
  {
    id: "lowpoly-moody",
    styleId: "lowpoly",
    name: "Moody",
    description:
      "Dark rooms, warm lamps with soft shadows, strong glow, a chunky 270-pixel render with heavy sharpening and colour fringes, a vignette, bold white captions: the casino-story look. 9:16 or 16:9.",
    settings: lowpolyLook("moody"),
  },
  {
    id: "toon-cinema",
    styleId: "toon",
    name: "Cinema",
    description:
      "Soft key and rim light, strong depth of field on every shot, warm glow on lamps and screens, a light vignette and film grain: the animated-film look. 9:16 or 16:9.",
    settings: toonLook("cinema"),
  },
  {
    id: "toon-clean",
    styleId: "toon",
    name: "Clean",
    description:
      "Brighter and flatter: lighter depth of field, softer glow and vignette, no grain. For explainers that live on diagrams, maps and labels. 9:16 or 16:9.",
    settings: toonLook("clean"),
  },
  {
    id: "stickstory-story",
    styleId: "stickstory",
    name: "Story",
    description:
      "The studied look: flat-vector sets layered at real depths with soft depth of field, warm glowing practicals, film grain and a vignette, a slowly creeping camera. 16:9 or 9:16.",
    settings: stickstoryLook("story"),
  },
  {
    id: "stickstory-clean",
    styleId: "stickstory",
    name: "Clean",
    description:
      "Flatter and crisper: less depth of field, a lighter vignette, no grain. For stories that lean on maps, diagrams and HUD graphics. 16:9 or 9:16.",
    settings: stickstoryLook("clean"),
  },
  {
    id: "starter-plain",
    styleId: "starter",
    name: "Plain 2D",
    description:
      "The Style Studio starter in 2D: neutral palette, flat shapes in pixels, word-highlight captions, a light grain and vignette.",
    settings: starterLook("2d"),
  },
  {
    id: "starter-plain-3d",
    styleId: "starter",
    name: "Plain 3D",
    description:
      "The Style Studio starter in 3D: simple lit solids on a ground, soft shadows, 2x supersampling, text on a HUD over the picture.",
    settings: starterLook("3d"),
  },
  {
    id: "vox-editorial",
    styleId: "vox",
    name: "Editorial",
    description: "Cream paper, charcoal type, Vox yellow highlights. Warm desk light, soft paper shadows, light grain and halftone. 9:16.",
    settings: voxLook("editorial", {}),
  },
  {
    id: "vox-archive",
    styleId: "vox",
    name: "Archive",
    description:
      "Sepia paper on wood and plaster, wax-red and gold accents, heavier grain and vignette: history and archival stories. 9:16.",
    settings: voxLook("archive", { grain: 0.06, halftone: 0.18, paper: 0.45, vignette: 0.45, lift: 0.07, warmth: 0.5 }),
  },
  {
    id: "vox-newsroom",
    styleId: "vox",
    name: "Newsroom",
    description: "Clean white editorial grid, bold red accent, crisp cards with offset shadows: data, tech and business stories. 9:16.",
    settings: voxLook("newsroom", { grain: 0.03, halftone: 0.08, paper: 0.18, vignette: 0.15, lift: 0.03 }),
  },
  {
    id: "vox-tabletop",
    styleId: "vox",
    name: "Tabletop",
    description: "Loud tabletop collage: saturated felt and grids, money, hands and props, heavy condensed type in yellow. 9:16.",
    settings: voxLook("tabletop", { grain: 0.05, halftone: 0.2, paper: 0.35, vignette: 0.35 }),
  },
  {
    id: "vox-editorial-wide",
    styleId: "vox",
    name: "Editorial wide",
    description: "The Editorial look for 16:9 videos (1920×1080).",
    settings: voxLook("editorial", {}, { format: "landscape" }),
  },
];
const RETIRED = { "flat-clean": "flat-midnight", "flat-nocaps": "flat-midnight" };
export function seedPresets() {
  for (const [id, to] of Object.entries(RETIRED)) {
    if (!q.get("SELECT * FROM presets WHERE id=? AND builtin=1", id)) continue;
    q.run("UPDATE projects SET preset_id=? WHERE preset_id=?", to, id);
    q.run("DELETE FROM presets WHERE id=? AND builtin=1", id);
  }
  for (const p of BUILTIN) {
    const row = q.get("SELECT * FROM presets WHERE id=?", p.id),
      style = p.styleId || "pixel-art";
    if (!row)
      q.run(
        "INSERT INTO presets(id,name,description,settings,builtin,style_id,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)",
        p.id,
        p.name,
        p.description,
        JSON.stringify(p.settings),
        style,
        now(),
        now(),
      );
    else if (row.builtin)
      q.run(
        "UPDATE presets SET name=?, description=?, settings=?, style_id=?, updated_at=? WHERE id=?",
        p.name,
        p.description,
        JSON.stringify(p.settings),
        style,
        now(),
        p.id,
      );
  }
}
const parse = (r) => ({ ...r, builtin: !!r.builtin, settings: JSON.parse(r.settings) });
export const listPresets = () => q.all("SELECT * FROM presets ORDER BY builtin DESC, name").map(parse);
export const getPreset = (id) => {
  const r = q.get("SELECT * FROM presets WHERE id=?", id);
  return r ? parse(r) : null;
};
export function validateSettings(s, styleId = "pixel-art") {
  const brand = brandError(s);
  if (brand) return brand;
  const gfx = validateGraphics(s?.graphics);
  if (gfx) return gfx;
  if (getStyle(styleId).custom) return ["vertical", "landscape"].includes(s?.format) ? null : "Format must be vertical or landscape.";
  const pk = getStyle(styleId);
  if (pk.pkg) return validateByControls(s, pk.controls, pk.aspects) ?? baseInvariants(s, baseOf(pk.id));
  if (styleId === "collage") {
    if (!["vertical", "landscape"].includes(s?.format)) return "Format must be vertical or landscape.";
    if (!["press", "sepia", "broadsheet"].includes(s?.theme)) return "Unknown paper theme.";
    if (s?.sheet?.cols != null && !(s.sheet.cols >= 1 && s.sheet.cols <= 6)) return "Panels per row must be 1-6.";
    if (s?.pace?.perMinute != null && !(s.pace.perMinute >= 4 && s.pace.perMinute <= 30)) return "Pictures per minute must be 4-30.";
    return null;
  }
  if (styleId === "flat") {
    if (!["vertical", "landscape"].includes(s?.format)) return "Format must be vertical or landscape.";
    if (s?.post?.vignette != null && !(s.post.vignette >= 0 && s.post.vignette <= 0.3))
      return "Vignette must be 0-0.3 (stronger darkening turns warm backgrounds muddy).";
    if (s?.captions?.size != null && !(s.captions.size >= 36 && s.captions.size <= 80)) return "Caption size must be 36-80.";
    return null;
  }
  if (styleId === "recon") {
    if (s?.format != null && !["vertical", "landscape"].includes(s.format)) return "Format must be vertical or landscape.";
    if (s?.quality?.ss != null && ![1, 2].includes(+s.quality.ss)) return "Render quality must be 1 or 2.";
    if (s?.theme != null && !["studio", "investigation"].includes(s.theme)) return "Theme must be studio or investigation.";
    if (s?.badge != null && typeof s.badge !== "boolean") return "Corner tag (badge) must be true or false.";
    const dark = s?.theme === "investigation";
    if (s?.post?.vignette != null && !(s.post.vignette >= 0 && s.post.vignette <= (dark ? 0.6 : 0.15)))
      return dark ? "Vignette must be 0-0.6." : "Vignette must be 0-0.15 (the style is high key).";
    if (s?.post?.grain != null && !(s.post.grain >= 0 && s.post.grain <= (dark ? 0.08 : 0.05)))
      return dark ? "Film grain must be 0-0.08." : "Film grain must be 0-0.05 (the style is high key).";
    if (s?.post?.contrast != null && !(s.post.contrast >= 0.8 && s.post.contrast <= 1.5)) return "Contrast must be 0.8-1.5.";
    if (s?.post?.desat != null && !(s.post.desat >= 0 && s.post.desat <= 1)) return "Desaturation must be 0-1.";
    if (s?.media?.perMin != null && !(s.media.perMin >= 0 && s.media.perMin <= 4)) return "Real pictures per minute must be 0-4.";
    return baseInvariants(s, "recon");
  }
  if (styleId === "stickman") {
    if (s?.format != null && s.format !== "landscape") return "The stick-figure style is 16:9 only.";
    if (s?.web?.perMin != null && !(s.web.perMin >= 0 && s.web.perMin <= 6)) return "Real images per minute must be 0-6.";
    return null;
  }
  if (styleId === "lowpoly") {
    if (!["vertical", "landscape"].includes(s?.format)) return "Format must be vertical or landscape.";
    if (s?.look != null && !["bright", "moody"].includes(s.look)) return "Look must be bright or moody.";
    if (s?.render?.short != null && !(+s.render.short >= 160 && +s.render.short <= 720)) return "Render resolution must be 160-720 pixels.";
    if (s?.captions?.size != null && !(s.captions.size >= 0.5 && s.captions.size <= 2)) return "Caption size must be 0.5-2.";
    if (s?.captions?.y != null && !(s.captions.y >= 0.4 && s.captions.y <= 0.92)) return "Caption height must be 40-92% of the frame.";
    return baseInvariants(s, "lowpoly");
  }
  if (styleId === "toon") {
    if (!["vertical", "landscape"].includes(s?.format)) return "Format must be vertical or landscape.";
    if (s?.look != null && !["cinema", "clean"].includes(s.look)) return "Look must be cinema or clean.";
    const r = (v, a, b) => v == null || (typeof v === "number" && v >= a && v <= b);
    if (s?.captions?.size != null && !(s.captions.size >= 0.5 && s.captions.size <= 2)) return "Caption size must be 0.5-2.";
    if (s?.captions?.y != null && !(s.captions.y >= 0.4 && s.captions.y <= 0.92)) return "Caption height must be 40-92% of the frame.";
    if (!r(s?.captions?.words, 1, 6)) return "Caption words must be 1-6.";
    if (!r(s?.post?.dof, 0, 2) || !r(s?.post?.bloom, 0, 1.5) || !r(s?.post?.vignette, 0, 0.8) || !r(s?.post?.grain, 0, 0.1))
      return "Finish values out of range (depth of field 0-2, glow 0-1.5, vignette 0-0.8, grain 0-0.1).";
    if (typeof s?.quality === "number" && !(s.quality >= 0.5 && s.quality <= 1)) return "Quality must be 0.5-1.";
    if (s?.characters?.palette != null && !["tones", "white"].includes(s.characters.palette)) return "Faces must be skin tones or white.";
    return baseInvariants(s, "toon");
  }
  if (styleId === "stickstory") {
    if (!["vertical", "landscape"].includes(s?.format)) return "Format must be vertical or landscape.";
    if (s?.look != null && !["story", "clean"].includes(s.look)) return "Look must be story or clean.";
    const r = (v, a, b) => v == null || (typeof v === "number" && v >= a && v <= b);
    if (!r(s?.captions?.size, 0.5, 2)) return "Caption size must be 0.5-2.";
    if (!r(s?.captions?.y, 0.4, 0.95)) return "Caption height must be 40-95% of the frame.";
    if (!r(s?.captions?.words, 1, 8)) return "Caption words must be 1-8.";
    if (!r(s?.post?.dof, 0, 2) || !r(s?.post?.bloom, 0, 1) || !r(s?.post?.vignette, 0, 0.8) || !r(s?.post?.grain, 0, 0.1))
      return "Finish values out of range (depth of field 0-2, glow 0-1, vignette 0-0.8, grain 0-0.1).";
    if (!r(s?.camera?.drift, 0, 2)) return "Camera drift must be 0-2.";
    if (typeof s?.quality === "number" && !(s.quality >= 0.5 && s.quality <= 1)) return "Quality must be 0.5-1.";
    return baseInvariants(s, "stickstory");
  }
  if (styleId === "vox") {
    if (!["vertical", "landscape"].includes(s?.format)) return "Format must be vertical or landscape.";
    if (!["editorial", "archive", "newsroom", "tabletop"].includes(s?.theme)) return "Unknown colour theme.";
    return null;
  }
  if (styleId === "starter") return starterError(s) ?? baseInvariants(s, "starter");
  return baseInvariants(s, "pixel-art");
}
function starterError(s) {
  if (!["vertical", "landscape"].includes(s?.format)) return "Format must be vertical or landscape.";
  if (s?.dim != null && !["2d", "3d"].includes(s.dim)) return "Dimension must be 2d or 3d.";
  if (s?.theme != null && !/^[a-z][a-z0-9-]{0,30}$/i.test(String(s.theme))) return "Unknown theme.";
  if (s?.quality?.ss != null && ![1, 2].includes(+s.quality.ss)) return "Supersampling must be 1 or 2.";
  const r = (v, a, b) => v == null || (typeof v === "number" && v >= a && v <= b);
  if (!r(s?.captions?.size, 36, 80)) return "Caption size must be 36-80.";
  if (
    !r(s?.post?.grain, 0, 0.2) ||
    !r(s?.post?.vignette, 0, 0.6) ||
    !r(s?.post?.contrast, 0.5, 2) ||
    !r(s?.post?.desat, 0, 1) ||
    !r(s?.post?.warmth, -1, 1)
  )
    return "Finish values out of range (grain 0-0.2, vignette 0-0.6, contrast 0.5-2, desaturation 0-1, warmth -1-1).";
  if (!r(s?.camera?.push, 0, 0.2) || !r(s?.camera?.punch, 0, 0.1) || !r(s?.camera?.fov, 15, 90))
    return "Camera values out of range (push 0-0.2, punch 0-0.1, field of view 15-90).";
  if (!r(s?.transitions?.duration, 0, 2)) return "Transition length must be 0-2 s.";
  return null;
}
function baseInvariants(s, base) {
  if (base === "recon") return figuresError(s?.figures) || null;
  if (base === "starter") return s?.dim != null && !["2d", "3d"].includes(s.dim) ? "Dimension must be 2d or 3d." : null;
  if (base === "lowpoly") {
    if (s?.characters?.main != null && !/^[a-z0-9_.-]{1,60}$/i.test(s.characters.main)) return "Unknown main character.";
    if (
      s?.characters?.cast != null &&
      (typeof s.characters.cast !== "object" ||
        Object.entries(s.characters.cast).some(
          ([k, v]) => !/^[a-z]{1,20}$/.test(k) || (v !== "" && !/^[a-z0-9_.-]{1,60}$/i.test(String(v))),
        ))
    )
      return "Unknown supporting cast.";
    return null;
  }
  if (base === "toon") {
    if (s?.characters?.main != null && !/^[a-z0-9_-]{1,40}$/i.test(String(s.characters.main))) return "Unknown main character.";
    const own = s?.characters?.custom;
    if (
      own != null &&
      (typeof own !== "object" ||
        Array.isArray(own) ||
        Object.keys(own).length > 12 ||
        Object.entries(own).some(([k, v]) => !isCharId(k) || !cleanLook(v)))
    )
      return "A custom character is incomplete.";
    return null;
  }
  if (base === "stickstory")
    return s?.characters?.main != null && !/^[a-z0-9_-]{1,40}$/i.test(String(s.characters.main)) ? "Unknown main character." : null;
  if (base === "pixel-art") {
    if (!s?.art?.width || 1920 % s.art.width !== 0 || s.art.width * 9 !== s.art.height * 16)
      return "Art size must be 16:9 and divide 1920 evenly (320, 384, 480, 640).";
    if (![1024, 2048, 4096].includes(s.shadows?.mapSize)) return "Shadow map must be 1024, 2048 or 4096.";
    if (s?.color?.palette != null && !["sweetie16", "hibit"].includes(s.color.palette)) return "Palette must be sweetie16 or hibit.";
    if (s?.color?.bands != null && ![0, 3, 5].includes(+s.color.bands)) return "Shading steps must be 3 or 5.";
  }
  return null;
}
export function savePreset(p) {
  const style = p.styleId || (p.id ? q.get("SELECT * FROM presets WHERE id=?", p.id)?.style_id : null) || "pixel-art";
  const err = validateSettings(p.settings, style);
  if (err) throw new Error(err);
  if (p.id) {
    const row = q.get("SELECT * FROM presets WHERE id=?", p.id);
    if (row?.builtin) throw new Error("Built-in presets are read-only. Duplicate it to make changes.");
    q.run(
      "UPDATE presets SET name=?, description=?, settings=?, updated_at=? WHERE id=?",
      p.name,
      p.description ?? "",
      JSON.stringify(p.settings),
      now(),
      p.id,
    );
    return getPreset(p.id);
  }
  const id = uid("pre_");
  q.run(
    "INSERT INTO presets(id,name,description,settings,builtin,style_id,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?)",
    id,
    p.name,
    p.description ?? "",
    JSON.stringify(p.settings),
    style,
    now(),
    now(),
  );
  return getPreset(id);
}
export function deletePreset(id) {
  const row = q.get("SELECT * FROM presets WHERE id=?", id);
  if (!row) return;
  if (row.builtin) throw new Error("Built-in presets cannot be deleted.");
  q.run("DELETE FROM presets WHERE id=?", id);
  q.run(
    "UPDATE projects SET preset_id=? WHERE preset_id=?",
    getStyle(row.style_id).id === row.style_id ? getStyle(row.style_id).defaultLook : "hidetail",
    id,
  );
}
export function writeSettings(projectDir, settings) {
  const f = path.join(projectDir, "project.json");
  const pj = JSON.parse(fs.readFileSync(f, "utf8"));
  pj.settings = settings;
  fs.writeFileSync(f, JSON.stringify(pj, null, 1));
}
