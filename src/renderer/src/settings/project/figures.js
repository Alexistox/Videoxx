export const FIG_BODIES = [
  {
    id: "male",
    label: "Male",
    about: "The smooth jointed mannequin (Mixamo Y Bot) on the motion-capture skeleton: every clip, hands that really touch.",
  },
  {
    id: "female",
    label: "Female",
    about: "His sister: the female jointed mannequin (Quaternius, CC0) on the same skeleton and clips, hands that really touch.",
  },
];
export const FIG_FINISHES = [
  { id: "matte", label: "Matte", about: "Clay-like matte body, darker joints." },
  { id: "glossy", label: "Glossy", about: "Porcelain-like clearcoat, darker joints." },
  { id: "glow", label: "Glow", about: "Emissive body with a bright fresnel rim and an outline (pair with settings.post.cap >= .95)." },
];
export const FIG_ROLES = [
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
export const FIG_ACTS = [
  { id: "stand", label: "Stand" },
  { id: "walk", label: "Walk" },
  { id: "sit", label: "Sit" },
  { id: "typing", label: "Typing" },
  { id: "phone", label: "Phone" },
  { id: "handsOnHead", label: "Hands on head" },
  { id: "cuffed", label: "Arms folded" },
  { id: "think", label: "Thinking" },
  { id: "talk", label: "Talking" },
  { id: "point", label: "Pointing" },
  { id: "carry", label: "Carrying" },
  { id: "pickup", label: "Picking up" },
  { id: "door", label: "Opening a door" },
  { id: "fall", label: "Falling" },
];
const HEX = /^#[0-9a-f]{6}$/i;
const CUSTOM_BODY = /^custom:[a-z0-9][a-z0-9-]{0,47}$/;
export const isCustomBody = (b) => typeof b === "string" && CUSTOM_BODY.test(b);
const legacyFinish = (x) =>
  x.outfit === "glow" ? "glow" : x.rig === "porcelain" || x.rig === "masked" ? "glossy" : x.rig ? "matte" : null;
const legacyBody = (b) => (b === "f" || b === "female" ? "female" : b === "m" || b === "male" ? "male" : isCustomBody(b) ? b : null);
export function roleFigure(f, role) {
  const d = FIG_ROLES.find((r) => r.id === role) ?? FIG_ROLES[FIG_ROLES.length - 1],
    u = (role === "main" ? f?.main : f?.roles?.[role]) ?? {};
  const g = (u.group && f?.groups?.[u.group]) || Object.values(f?.groups ?? {}).find((x) => x.roles?.includes(role)) || {};
  const legacyColor = u.colors?.top && HEX.test(u.colors.top) ? u.colors.top : null;
  const body = legacyBody(u.body) ?? legacyBody(g.body) ?? d.body,
    chosen = u.finish ?? legacyFinish(u) ?? g.finish ?? null;
  return {
    body,
    finish: chosen ?? (isCustomBody(body) ? "" : d.finish),
    color: (u.color ?? legacyColor ?? g.color ?? d.color).toLowerCase(),
    own: !!(role === "main" ? f?.main : f?.roles?.[role]),
  };
}
