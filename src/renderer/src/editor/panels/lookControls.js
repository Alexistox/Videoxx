const GENERIC_CONTROLS = [
  "format",
  "post.grain",
  "post.vignette",
  "post.warmth",
  "camera.drift",
  "transitions.duration",
  "sheet.cols",
  "pace.perMinute",
  "brand.color",
];
const OPTIONAL_CONTROLS = ["post.paper", "post.halftone", "post.tone", "shadow.opacity", "border"];
const NEUTRAL = {
  "transitions.duration": { label: "Transition length", help: "Travel time between chapters." },
  "brand.color": {
    help: "Your channel's colour for the accents (where the style uses its loud accent colour: stamps, dates, marker, tags). Style default keeps the style's own colours.",
  },
  "sheet.cols": { help: "How many chapters sit side by side on the page (the finale shows them all)." },
};
export function customControls(base, declared) {
  const keep = new Set([
    ...GENERIC_CONTROLS,
    ...(Array.isArray(declared) ? declared.map(String).filter((p) => OPTIONAL_CONTROLS.includes(p)) : []),
  ]);
  return base.filter((c) => c.path !== "theme" && keep.has(c.path)).map((c) => ({ ...c, ...(NEUTRAL[c.path] ?? {}) }));
}
