export function normHex(v) {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return void 0;
  let s = v.trim().toLowerCase();
  if (!s) return null;
  if (!s.startsWith("#")) s = "#" + s;
  if (/^#[0-9a-f]{3}$/.test(s)) s = "#" + [...s.slice(1)].map((c) => c + c).join("");
  return /^#[0-9a-f]{6}$/.test(s) ? s : void 0;
}
const brandOf = (settings) => normHex(settings?.brand?.color) ?? null;
export function brandError(settings) {
  const v = settings?.brand?.color;
  if (v == null || v === "") return null;
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)
    ? null
    : "Brand colour must be a hex colour like #e6007e (or empty for the style's own colours).";
}
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
}
const contrast = (a, b) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const textOn = (hex) => (contrast("#ffffff", hex) >= contrast("#111111", hex) ? "#ffffff" : "#111111");
const STYLE_USE = {
  "pixel-art":
    "the engine draws the chapter slam bars and number, the chapter tag and stat units in it (engine.js BRAND.hud, readable on the dark HUD); in the 3D world use RAMP.brand (the nearest of the 16 palette ramps, BRAND.slot) so the art stays on the palette",
  collage:
    "it replaces the theme's red everywhere the engine draws it (C.red: stamps, dates, marker circles and arrows, tags), darkened just enough to read on the paper; C.brand is the exact colour for fills behind ink, with C.brandInk as the text on it",
  flat: "the engine draws the spoken caption word and the default tag() fill in it (BRAND.color, BRAND.ink for text on it); also use it (C.brand) for the key accent of title cards, chapter cards, highlights, lower thirds and the end card, while keeping the palette's colour meanings for everything else",
  stickman:
    "the engine uses it for labels, date and number cards and the default text colour (colour name `accent`, or `brand` for the exact colour): write c=accent / c=brand where a label should carry the brand",
  recon:
    "it replaces the blue accent everywhere the engine draws it (C.accent: chapter kickers, the timecard bar, callouts, route lines, place dots, quote marks and highlights), darkened just enough to read on the white cards",
  lowpoly:
    "the engine draws the 8-bit number banners, the 3D brand sting and the game-UI panel frames in it (BRAND.color, C.brand); green gains and red losses keep their colours; also use it for a recurring prop or sign of the channel",
  toon: "the engine keeps it as BRAND.color / C.brand (C.brandInk for text on it): use it for the signs, labels, screens and painted logos you put in the sets and for one recurring prop of the channel; the characters keep their own outfit colours",
  stickstory:
    "the engine keeps it as BRAND.color / C.brand (C.brandInk for text on it; without one the HUD gold): use it for the HUD graphics, counters, map markers and routes, labels and title cards you draw; the stick people keep their own clothes",
  vox: "use it for the highlights, marker circles and accent type you draw (pass color: '<hex>' where an element takes one)",
  starter:
    "the engine draws the spoken caption word and the default tag() fill in it (BRAND.color, BRAND.ink for text on it, C.brand / C.brandInk); also use C.brand for the one key accent of title cards, highlights and the end card",
};
export function brandNote(base, settings, engine = "yes") {
  const hex = brandOf(settings);
  if (!hex) return "";
  return `BRAND COLOUR: the user's brand colour is ${hex} (text on it: ${textOn(hex)}). Use it as the video's main accent: title and chapter cards, highlights, lower thirds, key labels and numbers, and the end card${base === "flat" || base === "collage" || base === "starter" ? " (also in the 9:16 version)" : ""}; one accent, used consistently, never on every element. Keep text readable on it. ${engine === "yes" ? `In this style ${STYLE_USE[base] ?? STYLE_USE.vox}.` : `This project's engine doesn't know it: write ${hex} yourself where you set an accent colour${engine === "old" ? " (Update engine in the editor makes the engine's own accents follow it)" : ""}.`}`;
}
