import path from "node:path";
import fs from "node:fs";
import { getConfig } from "../core/config";
import { log } from "../core/log";
import { q } from "../db/db";
import { baseOf } from "../styles/catalog";
import { KNOWHOW_KINDS, LIB_ID_RX, STATUS_WEIGHT } from "./schema";
import { refreshIndex } from "./index";
import { outcomesOf, searchLibrary } from "./search";
import { findStoreEntry } from "./store";
import { engineVersion, getProject } from "../projects/projects";

export const libraryOff = () => process.env.CZ_LIBRARY_OFF === "1" || getConfig().library?.off === true;
export const LIBRARY_SYSTEM_LINE =
  "- The Library holds what earlier videos proved (modules, recipes, looks, poses, solutions, pitfalls): library_search before building\n  anything non-trivial or chasing an error, reuse with library_use, then report with library_note_outcome.";
export const LIBRARY_NOTE = `LIBRARY, step 0 (before the storyboard): library_search for the storyboard's sets, props, materials, poses and look, and
for this style's known pitfalls ("Known pitfalls" in the request lists the top ones). Reuse what fits with library_use (a
recipe with as=<scene name>) instead of building it again; list what you reuse at the top of storyboard.md (a reframe: in
your summary), and report each with library_note_outcome.`;
export const LIBRARY_ULTRA = `LIBRARY: before you fix a shot, library_search the fix in a few words ("props floating", "glowing person", "brick wall
texture"): a solution or module that already worked saves the round; report what you used with library_note_outcome.`;
const STOP = new Set(
  "a an and or but the of to in on at for with from by as is are be it its this that these those my me we our you your i make made add change set more less bigger smaller please can could would should will shot shots scene scenes video videos frame frames so then than there here very just also into over under about like same new old one two three some all any each every not no do does look looks show shows put get use want need".split(
    " ",
  ),
);
const cap = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function searchWords(text) {
  const out = [];
  for (const t of String(text || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [])
    if (t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t) && !out.includes(t)) out.push(t);
  return out.slice(0, 12);
}
function buildText(dir) {
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      return "";
    }
  };
  let topic = "";
  try {
    topic = String(JSON.parse(read("project.json") || "{}").topic || "");
  } catch {}
  const heads = (s) =>
    (s.match(/^#{1,4}\s+.+$/gm) || [])
      .map((h) => h.replace(/^#+\s+/, ""))
      .slice(0, 20)
      .join(" ");
  return [topic, heads(read("storyboard.md")), heads(read("script.txt"))].filter(Boolean).join(" ");
}
const LONG_JOBS = new Set(["build", "reframe", "ultra"]);
const CONTEXT_KINDS = new Set(["edit", "ask", "build", "reframe", "ultra", "studio", "routine"]);
const HITS_CHARS = 1e3,
  PITFALL_CHARS = 2e3;
function libraryHits(projectId, kind, instruction) {
  const p = getProject(projectId),
    base = baseOf(p.style_id);
  const words = searchWords([instruction, LONG_JOBS.has(kind) ? buildText(p.path) : ""].join(" "));
  if (words.length < (LONG_JOBS.has(kind) ? 1 : 2)) return "";
  const hits = searchLibrary({
    query: words.join(" "),
    base,
    styleId: p.style_id,
    projectId,
    engineVersion: engineVersion(path.join(p.path, "engine.js")) || null,
    scope: "fit",
    limit: 5,
    sources: ["seed", "ws"],
  });
  if (!hits.length) return "";
  const lines = [];
  let n = 0;
  for (const h of hits) {
    const how = KNOWHOW_KINDS.includes(h.kind) ? "library_use for the fix" : h.kind === "recipe" ? "library_use as=<scene>" : "library_use";
    const l = cap(`- ${h.id} [${h.kind}] ${h.title} -> ${how}`.replace(/\s+/g, " ").trim(), 220);
    if (n + l.length > HITS_CHARS) break;
    lines.push(l);
    n += l.length + 1;
  }
  return `Library hits for this request (the app's search; library_get <id> for the card):
${lines.join("\n")}`;
}
function knownPitfalls(projectId) {
  const p = getProject(projectId),
    base = baseOf(p.style_id);
  const rows = q
    .all(
      `SELECT id, kind, title, summary, status, scope, bases, body FROM lib_entries WHERE kind IN ('pitfall','solution') AND source IN ('seed','ws') AND status IN ('accepted','verified','proven')`,
    )
    .filter((r) => {
      const b = String(r.bases || "").split(/\s+/);
      return b.includes(base) || b.includes("any") || b.includes(p.style_id);
    })
    .filter((r) => {
      const [sk, sv] = String(r.scope).split(":");
      return (
        sk === "global" ||
        (sk === "base" && (sv === base || sv === "any")) ||
        (sk === "style" && sv === p.style_id) ||
        (sk === "project" && sv === projectId)
      );
    });
  if (!rows.length) return "";
  const outs = outcomesOf(rows.map((r) => r.id)),
    own = (r) => (r.id.split(".")[1] === base || String(r.scope) !== "global" ? 1 : 0);
  const score = (r) => {
    const o = outs.get(r.id) ?? { wins: 0, fails: 0 };
    return own(r) * 10 + Math.log1p(o.wins) - 0.5 * Math.log1p(o.fails) + (STATUS_WEIGHT[r.status] ?? 1) - 1;
  };
  rows.sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : 1));
  const fixOf = (id) => {
    try {
      return String(findStoreEntry(id)?.entry.problem?.fix ?? "");
    } catch {
      return "";
    }
  };
  const lines = [];
  let n = 0;
  for (const r of rows.slice(0, 8)) {
    const fix = fixOf(r.id) || r.summary;
    const l = cap(`- ${r.title} -> ${cap(fix, 120)} (${r.id})`.replace(/\s+/g, " "), 240);
    if (n + l.length > PITFALL_CHARS) break;
    lines.push(l);
    n += l.length + 1;
  }
  return `Known pitfalls for ${base} (from the Library; library_use <id> returns the full fix):
${lines.join("\n")}`;
}
export function libraryBlocks(projectId, kind, instruction = "") {
  if (libraryOff() || !CONTEXT_KINDS.has(kind)) return {};
  try {
    refreshIndex();
    return { hits: libraryHits(projectId, kind, instruction), pitfalls: knownPitfalls(projectId) };
  } catch (e) {
    log("library: request blocks failed", e?.message);
    return {};
  }
}
export function libraryContext(dir) {
  if (libraryOff()) return "";
  let lock = {};
  try {
    lock = JSON.parse(fs.readFileSync(path.join(dir, "library", "lock.json"), "utf8"));
  } catch {}
  const ids = Object.keys(lock)
    .filter((id) => LIB_ID_RX.test(id))
    .sort();
  const copied = ids.length
    ? `${ids
        .slice(0, 12)
        .map((id) => `${id} v${lock[id]?.v ?? "?"}`)
        .join(", ")}${ids.length > 12 ? ` and ${ids.length - 12} more` : ""}`
    : "nothing yet";
  return `
## Library
- Copied into this project (library/lock.json): ${copied}.
- library_search before building anything non-trivial or chasing an error (modules, recipes, looks, poses, solutions, pitfalls); library_get <id> for its card or code.
- library_use copies an entry into library/<id>/ with what it requires; scenes import it as '../library/<id>/<file>' (a recipe with as=<name> becomes scenes/<name>.js).
- Never edit library/<id>/ in place: copy what you change into your scene or lib/, or save the better version with library_add (supersedes = the old id).
- After using one: library_note_outcome (worked / failed / partial). Something new that worked: library_add.
`;
}
export const withoutLibraryLines = (md) =>
  libraryOff()
    ? md
        .split("\n")
        .filter((l) => !/\blibrary_(search|get|use|add|note_outcome)\b/.test(l))
        .join("\n")
    : md;
