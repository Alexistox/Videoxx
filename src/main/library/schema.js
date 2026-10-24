import { z } from "zod";

export const LIB_KINDS = [
  "model",
  "module",
  "material",
  "texture",
  "image",
  "sprite",
  "font",
  "sound",
  "anim",
  "pose",
  "recipe",
  "look",
  "solution",
  "pitfall",
  "check",
];
export const LIB_TABS = {
  assets: ["model", "module", "material", "texture", "image", "sprite", "font", "sound", "anim", "pose"],
  scenes: ["recipe", "look"],
  knowhow: ["solution", "pitfall", "check"],
};
export const KNOWHOW_KINDS = ["solution", "pitfall", "check"];
const BASE_RX = "(?:any|recon|lowpoly|flat|collage|stickman|pixel-art|starter|custom-[a-z0-9-]{1,40})";
export const LIB_ID_RX = new RegExp(`^(${LIB_KINDS.join("|")})\\.${BASE_RX}\\.[a-z0-9-]{1,48}$`);
export const LIB_BASE_RX = new RegExp(`^${BASE_RX}$`);
const FED_ID_RX = /^(lp|sfx|char|sprite|fig|img):[A-Za-z0-9_.:-]{1,120}$/;
export const isLibId = (id) => typeof id === "string" && (LIB_ID_RX.test(id) || FED_ID_RX.test(id));
export const isFedId = (id) => FED_ID_RX.test(id);
export const LIB_STATUSES = ["proposed", "accepted", "verified", "proven", "flagged", "retired"];
export const STATUS_WEIGHT = { proven: 1.6, verified: 1.3, accepted: 1, proposed: 0.4, flagged: 0.2, retired: 0 };
export const SCOPE_WEIGHT = { project: 1.5, style: 1.4, base: 1.2, global: 1 };
export const LIB_SCOPE_RX = /^(global|base:[a-z0-9-]{1,48}|style:[a-z0-9-]{1,60}|project:[\w-]{1,64})$/;
const LICENCE_IDS = ["own", "CC0-1.0", "CC-BY-4.0", "CC-BY-3.0", "PD"];
const str = (max) => z.string().max(max);
const opt = (s) =>
  s
    .nullable()
    .optional()
    .transform((v) => v ?? void 0);
const fileRel = z
  .string()
  .min(1)
  .max(200)
  .regex(/^(?![\\/])(?!.*\.\.)[\w./ -]+$/, "a relative path inside the entry (no ..)");
const LibFileSchema = z.looseObject({
  path: fileRel,
  role: z.enum(["entry", "doc", "data", "asset"]).default("asset"),
  bytes: opt(z.number().int().min(0)),
  sha1: opt(str(64)),
});
const LibEngineSchema = z.looseObject({ base: str(60), min: opt(z.number().int().min(0)), max: opt(z.number().int().min(0)) });
export const LibEntrySchema = z.looseObject({
  schema: z.number().int().min(1).default(1),
  id: z.string().regex(LIB_ID_RX, "id must be <kind>.<base>.<slug>"),
  uid: opt(str(64)),
  origin: opt(z.enum(["seed", "ws"])),
  kind: z.enum(LIB_KINDS),
  title: z.string().min(1).max(120),
  summary: str(400)
    .nullable()
    .default("")
    .transform((v) => v ?? ""),
  tags: z.array(str(40)).max(40).default([]),
  engines: z.array(LibEngineSchema).max(12).default([]),
  three: opt(z.union([z.string(), z.number()])),
  scope: z.string().regex(LIB_SCOPE_RX).default("global"),
  status: z.enum(LIB_STATUSES).default("proposed"),
  version: z.number().int().min(1).default(1),
  versions: z.array(z.looseObject({ v: z.number().int().min(1), hash: opt(str(80)), at: opt(str(40)), note: opt(str(400)) })).default([]),
  delivery: z.enum(["copy", "ref"]).default("copy"),
  files: z.array(LibFileSchema).max(60).default([]),
  entry: opt(fileRel),
  exports: opt(z.array(str(80)).max(80)),
  usage: opt(z.union([str(2e3), z.looseObject({ import: opt(str(400)), example: opt(str(2e3)) })])),
  requires: z.array(z.string().regex(LIB_ID_RX)).max(12).default([]),
  doc: opt(
    z.looseObject({ when: opt(str(1e3)), avoid: opt(str(1e3)), gotchas: opt(z.array(str(400)).max(20)), params: z.any().optional() }),
  ),
  problem: opt(
    z.looseObject({
      symptom: opt(str(1e3)),
      cause: opt(str(1e3)),
      fix: opt(str(2e3)),
      detect: opt(str(1e3)),
      scopeLetter: opt(z.enum(["G", "R", "I"])),
    }),
  ),
  preview: opt(fileRel),
  provenance: z.array(z.looseObject({})).max(100).default([]),
  licence: z
    .looseObject({ id: z.enum(LICENCE_IDS).default("own"), author: opt(str(200)), source_url: opt(str(500)), credit_text: opt(str(500)) })
    .prefault({ id: "own" }),
  metrics: opt(z.record(z.string(), z.any())),
  related: z.array(z.string().max(140)).max(30).default([]),
  created: opt(str(40)),
  updated: opt(str(40)),
});
