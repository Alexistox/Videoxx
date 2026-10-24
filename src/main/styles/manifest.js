import { z } from "zod";

export const PKG_ID = /^custom-[a-z0-9-]{1,40}$/;
export const OFFICIAL_ID = /^[a-z][a-z0-9-]{1,40}$/;
export const LOOK_ID = /^look-[a-z0-9-]{1,40}$/;
export const PKG_BASES = ["pixel-art", "collage", "flat", "stickman", "recon", "lowpoly", "starter"];
export const ASPECTS = ["16:9", "9:16"];
export const formatOfAspect = (a) => (a === "9:16" ? "vertical" : "landscape");
const text = (max) => z.string().max(max);
const settingPath = z.string().regex(/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*){0,5}$/);
const ControlZ = z.object({
  path: settingPath,
  label: text(80).min(1),
  help: text(600).optional(),
  type: z.enum(["toggle", "range", "select", "color", "figures"]),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  fmt: z.enum(["pct", "deg", "s", "x", "ppm"]).optional(),
  default: z.union([z.number().finite(), z.string().max(200)]).optional(),
  options: z
    .array(
      z.object({
        value: z.union([z.string().max(100), z.number().finite()]),
        label: text(100),
        img: z
          .string()
          .regex(/^[\w-]+(\/[\w-]+)*\.(png|jpe?g|webp)$/)
          .optional(),
      }),
    )
    .max(60)
    .optional(),
  readOnly: z.boolean().optional(),
  size: z.boolean().optional(),
  clearable: z.boolean().optional(),
});
const StyleManifestZ = z.object({
  schema: z.literal(2),
  kind: z.literal("style"),
  id: z.string().max(60),
  name: text(60).min(1),
  tagline: text(200).default(""),
  description: text(2e3).default(""),
  /** a built-in base, or another package (resolved to its built-in base when loaded) */
  base: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/),
  from: z.object({ style: z.string().max(60), engineVersion: z.number().int().min(0) }).optional(),
  version: z.number().int().min(1).default(1),
  dim: z.enum(["2d", "3d"]).optional(),
  aspects: z.array(z.enum(ASPECTS)).min(1).max(2).default(["16:9"]),
  defaultLook: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .optional(),
  controls: z
    .object({
      keep: z.array(settingPath).max(60).optional(),
      add: z.array(ControlZ).max(40).optional(),
      remove: z.array(settingPath).max(60).optional(),
    })
    .optional(),
  defaults: z.record(z.string(), z.any()).default({}),
  capabilities: z
    .object({
      needsImageKey: z.boolean().optional(),
      reframe: z.boolean().optional(),
      engineCaptions: z.boolean().optional(),
      webImages: z.boolean().optional(),
    })
    .default({}),
  audio: z.object({ music: z.enum(["beds", "none", "user"]).optional(), lufs: z.number().finite().optional() }).optional(),
  checks: z
    .object({
      layout: z.boolean().optional(),
      minText: z.number().finite().optional(),
      overlap: z.number().finite().optional(),
      mustFail: z.array(z.string().max(200)).max(40).optional(),
    })
    .optional(),
  banned: z.array(z.string().max(200)).max(100).default([]),
  prompts: z
    .object({
      brief: text(4e3).default(""),
      build: text(8e3).default(""),
      context: text(8e3).default(""),
      qualityBar: text(4e3).default(""),
      reframe: text(4e3).default(""),
      imageStyle: text(1e3).default(""),
      ignoreBaseRefs: z.array(z.string().max(200)).max(40).default([]),
    })
    .default({ brief: "", build: "", context: "", qualityBar: "", reframe: "", imageStyle: "", ignoreBaseRefs: [] }),
  fonts: z.object({ charsets: z.array(z.string().max(40)).max(20).optional() }).optional(),
  render: z.object({ smooth: z.boolean().optional() }).optional(),
  routines: z.object({ extras: z.record(z.string(), z.any()).optional() }).optional(),
  brand: z.object({ help: text(600).optional(), use: text(600).optional() }).optional(),
  official: z.boolean().default(false),
  aliases: z.array(z.string().regex(PKG_ID)).max(20).default([]),
  /** the Style Studio workspace it was published from (app-owned: republishing that workspace updates this same package) */
  studio: z.object({ workspace: z.string().max(60) }).optional(),
  /** written by the Style Kit's `cz package` (docs/STYLE_KIT_PLAN.md section 1): the kit and app versions it was made with,
   *  the sha1 of the host page it was checked against, its built-in base and that base's engine version, when it was built */
  kit: z
    .object({
      kit: z.number().int().min(1),
      app: z.string().max(40),
      host: z.string().max(80),
      base: z.string().max(60),
      baseEngine: z.number().int().min(0),
      built: z.string().max(40),
      /** the exports of the base engine it was built on (the contract check keeps those, not a newer base's) */
      baseExports: z.array(z.string().max(60)).max(300).optional(),
    })
    .optional(),
  created: z.string().max(40).optional(),
  updated: z.string().max(40).optional(),
});
const LookManifestZ = z.object({
  schema: z.literal(2),
  kind: z.literal("look"),
  id: z.string().regex(LOOK_ID),
  style: z.string().max(60).optional(),
  name: text(60).min(1),
  description: text(1e3).default(""),
  settings: z.record(z.string(), z.any()).default({}),
  notes: z.object({ context: text(4e3).default(""), qualityBar: text(4e3).default("") }).optional(),
  pitfalls: z.array(z.string().max(1e3)).max(100).default([]),
  preview: z.string().max(200).optional(),
});
export function parseManifest(raw) {
  const r = StyleManifestZ.safeParse(raw);
  return r.success
    ? { ok: true, m: r.data }
    : {
        ok: false,
        why: r.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
      };
}
export function parseLook(raw) {
  const r = LookManifestZ.safeParse(raw);
  return r.success
    ? { ok: true, m: r.data }
    : {
        ok: false,
        why: r.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
      };
}
const FORMAT_LABEL = { vertical: "Vertical 9:16", landscape: "Wide 16:9" };
export function controlsFor(base, spec, aspects) {
  const keep = spec?.keep?.length ? new Set([...spec.keep, "format", "brand.color"]) : null,
    remove = new Set(spec?.remove ?? []);
  const added = spec?.add ?? [],
    addedPaths = new Set(added.map((c) => c.path));
  let out = base.filter((c) => (!keep || keep.has(c.path)) && !remove.has(c.path) && !addedPaths.has(c.path)).map((c) => ({ ...c }));
  const bi = out.findIndex((c) => c.path === "brand.color");
  out = bi < 0 ? [...out, ...added.map((c) => ({ ...c }))] : [...out.slice(0, bi), ...added.map((c) => ({ ...c })), ...out.slice(bi)];
  if (aspects?.length) {
    const formats = aspects.map(formatOfAspect),
      opts = formats.map((v) => ({ value: v, label: FORMAT_LABEL[v] }));
    const f = out.find((c) => c.path === "format");
    if (f) f.options = opts.map((o) => ({ ...(f.options?.find((x) => x.value === o.value) ?? {}), ...o }));
    else if (formats.length > 1)
      out.unshift({
        path: "format",
        label: "Format",
        help: "Set when the project is created.",
        type: "select",
        readOnly: true,
        options: opts,
      });
  }
  return out;
}
const getPath = (o, p) => p.split(".").reduce((v, k) => (v == null ? void 0 : v[k]), o);
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : NaN);
export function validateByControls(s, controls, aspects) {
  if (s == null || typeof s !== "object" || Array.isArray(s)) return "Settings must be an object.";
  if (aspects?.length && s.format != null) {
    const ok = aspects.map(formatOfAspect);
    if (!ok.includes(s.format)) return ok.length > 1 ? "Format must be vertical or landscape." : `This style is ${aspects[0]} only.`;
  }
  for (const c of controls) {
    if (c.path === "format") continue;
    const v = getPath(s, c.path),
      name = c.label || c.path;
    if (v == null || (v === "" && c.type === "color")) continue;
    if (c.type === "range") {
      const n = num(v);
      if (!isFinite(n)) return `${name} must be a number.`;
      if ((c.min != null && n < c.min) || (c.max != null && n > c.max)) return `${name} must be ${c.min ?? "..."}-${c.max ?? "..."}.`;
    } else if (c.type === "toggle") {
      if (typeof v !== "boolean") return `${name} must be on or off.`;
    } else if (c.type === "select") {
      const val = c.size && v && typeof v === "object" ? `${v.width}x${v.height}` : v;
      if (c.options?.length && !c.options.some((o) => String(o.value) === String(val))) return `${name}: unknown choice.`;
    } else if (c.type === "color") {
      if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) return `${name} must be a colour like #e6007e.`;
    }
  }
  return null;
}
