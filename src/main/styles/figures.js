const FIG_FINISHES = [
  { id: "matte", label: "Matte", about: "Clay-like matte body, darker joints." },
  { id: "glossy", label: "Glossy", about: "Porcelain-like clearcoat, darker joints." },
  { id: "glow", label: "Glow", about: "Emissive body with a bright fresnel rim and an outline (pair with settings.post.cap >= .95)." },
];
const FIG_ROLES = [
  { id: "main", label: "Main character", body: "male", finish: "glossy", color: "#e8742a" },
  { id: "suspect", label: "Suspect", body: "male", finish: "matte", color: "#c9343a" },
  { id: "victim", label: "Victim", body: "female", finish: "matte", color: "#e6d9c2" },
  { id: "detective", label: "Detective", body: "male", finish: "matte", color: "#3f6fc4" },
  { id: "witness", label: "Witness", body: "female", finish: "matte", color: "#3fa68c" },
  { id: "accomplice", label: "Accomplice", body: "male", finish: "matte", color: "#8a5fb0" },
  { id: "official", label: "Official", body: "male", finish: "matte", color: "#c9a43c" },
  { id: "prisoner", label: "Prisoner", body: "male", finish: "matte", color: "#cf611f" },
  { id: "police", label: "Police officer", body: "male", finish: "matte", color: "#3c5a8a" },
  { id: "swat", label: "Tactical officer", body: "male", finish: "matte", color: "#5a6068" },
  { id: "unknown", label: "Unknown person", body: "male", finish: "matte", color: "#8a9097" },
  { id: "extra", label: "Extra", body: "male", finish: "matte", color: "#b9b2a6" },
];
const LEGACY_RIGS = ["human", "porcelain", "faceted", "masked", "ual", "mixamo", "model"];
const LEGACY_OUTFITS = [
  "none",
  "glow",
  "red-tee-jeans",
  "hacker-hoodie",
  "grey-hoodie",
  "olive-parka",
  "suit-blue-tie",
  "navy-suit",
  "orange-jumpsuit",
  "police",
  "swat",
  "pink-sweater",
  "white-shirt",
  "dress",
  "smock",
  "overalls",
  "blazer",
  "longsleeve",
];
const LEGACY_REGIONS = ["skin", "top", "bottom", "shoes", "accent"];
const HEX = /^#[0-9a-f]{6}$/i;
const CUSTOM_BODY = /^custom:[a-z0-9][a-z0-9-]{0,47}$/;
const isCustomBody = (b) => typeof b === "string" && CUSTOM_BODY.test(b);
export function figuresError(f) {
  if (f == null) return null;
  if (typeof f !== "object" || Array.isArray(f)) return "Characters must be an object.";
  const o = f;
  const look = (x, who) => {
    if (x.body != null && !["male", "female", "m", "f"].includes(x.body) && !isCustomBody(x.body))
      return `${who}: unknown body "${x.body}" (male, female or custom:<your character's id>).`;
    if (x.finish != null && !FIG_FINISHES.some((r) => r.id === x.finish))
      return `${who}: unknown finish "${x.finish}" (matte, glossy or glow).`;
    if (x.color != null && !(typeof x.color === "string" && HEX.test(x.color))) return `${who}: colours must be hex like #b4232d.`;
    if (x.joints != null && !(typeof x.joints === "string" && HEX.test(x.joints))) return `${who}: colours must be hex like #b4232d.`;
    return null;
  };
  const one = (c, who) => {
    if (c == null) return null;
    if (typeof c !== "object" || Array.isArray(c)) return `${who}: must be an object.`;
    const x = c,
      e = look(x, who);
    if (e) return e;
    if (x.group != null && !(typeof x.group === "string" && /^[a-z][a-z0-9-]{0,23}$/i.test(x.group))) return `${who}: bad group name.`;
    if (x.rig != null && !LEGACY_RIGS.includes(x.rig)) return `${who}: unknown figure "${x.rig}".`;
    if (x.rig === "model" && !(typeof x.model === "string" && /^assets\/[\w./ -]+\.glb$/i.test(x.model) && !x.model.includes("..")))
      return `${who}: a model figure needs its file (assets/...glb).`;
    if (x.outfit != null && !LEGACY_OUTFITS.includes(x.outfit)) return `${who}: unknown outfit "${x.outfit}".`;
    if (x.colors != null) {
      if (typeof x.colors !== "object" || Array.isArray(x.colors)) return `${who}: colours must be an object.`;
      for (const [k, v] of Object.entries(x.colors)) {
        if (!LEGACY_REGIONS.includes(k)) return `${who}: unknown colour "${k}".`;
        if (v != null && !(typeof v === "string" && HEX.test(v))) return `${who}: colours must be hex like #b4232d.`;
      }
    }
    if (x.name != null && (typeof x.name !== "string" || x.name.length > 60)) return `${who}: name too long.`;
    return null;
  };
  const m = one(o.main, "Main character");
  if (m) return m;
  if (o.roles != null) {
    if (typeof o.roles !== "object" || Array.isArray(o.roles)) return "Characters: roles must be an object.";
    for (const [k, v] of Object.entries(o.roles)) {
      if (!/^[a-z][a-z0-9-]{0,23}$/.test(k)) return `Unknown role "${k}".`;
      const e = one(v, FIG_ROLES.find((r) => r.id === k)?.label ?? k);
      if (e) return e;
    }
  }
  if (o.groups != null) {
    if (typeof o.groups !== "object" || Array.isArray(o.groups)) return "Characters: groups must be an object.";
    for (const [k, g] of Object.entries(o.groups)) {
      if (!/^[a-z][a-z0-9-]{0,23}$/i.test(k)) return `Bad group name "${k}".`;
      if (!g || typeof g !== "object" || Array.isArray(g)) return `Group ${k}: must be an object.`;
      if (g.roles != null && !(Array.isArray(g.roles) && g.roles.every((r) => typeof r === "string" && /^[a-z][a-z0-9-]{0,23}$/.test(r))))
        return `Group ${k}: roles must be a list of role names.`;
      const e = look(g, `Group ${k}`);
      if (e) return e;
    }
  }
  return null;
}
