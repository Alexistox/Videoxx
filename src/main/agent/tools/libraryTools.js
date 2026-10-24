import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { nativeImage } from "electron";
import { z } from "zod";
import { ws } from "../../core/workspace";
import { log } from "../../core/log";
import { q, uid } from "../../db/db";
import { baseOf } from "../../styles/catalog";
import { normLicence } from "../../characters/lowpoly";
import { renderStills } from "../../render/workers";
import { studioOf } from "../../studio/stages";
import { KNOWHOW_KINDS, LIB_BASE_RX, LIB_ID_RX, LIB_KINDS, LIB_SCOPE_RX, LibEntrySchema, isFedId, isLibId } from "../../library/schema";
import { applyFlags, rebuildIndex, refreshIndex } from "../../library/index";
import { engineFits, engineRangeText, getRow, link, logUse, outcomesOf, searchLibrary } from "../../library/search";
import { bannedInSource } from "../../studio/runChecks";
import {
  assertId,
  codeHash,
  entryDirFor,
  fileIn,
  filesOf,
  findStoreEntry,
  patchWsEntry,
  sha1,
  versionDir,
  writeWsEntry,
} from "../../library/store";
import { engineVersion, getProject } from "../../projects/projects";
import { libraryUseCheck, studioWriteCheck } from "../../studio/writeCheck";
import { insideDir } from "../sessions";

const text = (t) => ({ content: [{ type: "text", text: t }] });
const cap = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const SEARCH_CHARS = 1600,
  LINE_CHARS = 240,
  CARD_CHARS = 2400,
  CODE_LINES = 400;
const runningEdit = (projectId) =>
  q.get("SELECT id FROM edits WHERE project_id=? AND status='running' ORDER BY created_at DESC LIMIT 1", projectId)?.id ?? null;
function noteUsed(editId, id) {
  if (!editId) return;
  try {
    const r = q.get("SELECT lib_used FROM edits WHERE id=?", editId);
    const l = r?.lib_used ? JSON.parse(r.lib_used) : [];
    if (!l.includes(id)) {
      l.push(id);
      q.run("UPDATE edits SET lib_used=? WHERE id=?", JSON.stringify(l), editId);
    }
  } catch (e) {
    log("library: lib_used not noted", e?.message);
  }
}
const projectInfo = (projectId) => {
  const p = getProject(projectId),
    base = baseOf(p.style_id);
  return { p, dir: p.path, base, ev: engineVersion(path.join(p.path, "engine.js")) };
};
function fedHow(id, base) {
  const [pre, rest] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
  if (pre === "lp")
    return base === "lowpoly"
      ? `low poly asset: by its id '${rest}' (S.prop / S.person, lowpoly_asset search for sizes)`
      : `low poly asset '${rest}' (served at __lib/, see lowpoly_asset)`;
  if (pre === "sfx") return `sound effect ${rest} (the sound designer picks it by category)`;
  if (pre === "char") return `flat character '${rest}' (Look > Characters)`;
  if (pre === "sprite") return `stick-figure sprites of '${rest}' (cast it; make_sprites copies them)`;
  if (pre === "fig") return `rigged figure model ${rest} (Look > Characters copies it into assets/models)`;
  if (pre === "img")
    return "a picture made for another video: make_image with the same prompt (and the same imageStyle) copies it for free";
  return "indexed in place";
}
function hitLine(h, base) {
  const own = h.source === "seed" || h.source === "ws";
  const how = !own
    ? fedHow(h.id, base)
    : KNOWHOW_KINDS.includes(h.kind)
      ? "library_use (returns the fix)"
      : h.kind === "recipe"
        ? "library_use as=<scene name>"
        : "library_use";
  const tag = [h.kind, h.status !== "accepted" ? h.status : "", h.wins || h.fails ? `${h.wins}✓ ${h.fails}✗` : ""]
    .filter(Boolean)
    .join(", ");
  return cap(`${h.id}${own ? ` v${h.version}` : ""} [${tag}] ${h.title}: ${h.summary} -> ${how}`.replace(/\s+/g, " "), LINE_CHARS);
}
const usageOf = (e) =>
  !e.usage ? "" : typeof e.usage === "string" ? e.usage : [e.usage.import, e.usage.example].filter(Boolean).join("\n");
function problemText(e) {
  const p = e.problem ?? {};
  return (
    [p.symptom && `Symptom: ${p.symptom}`, p.cause && `Cause: ${p.cause}`, p.fix && `Fix: ${p.fix}`, p.detect && `Detect: ${p.detect}`]
      .filter(Boolean)
      .join("\n") || e.summary
  );
}
function card(rec, row, base) {
  const e = rec.entry,
    o = outcomesOf([e.id]).get(e.id) ?? { wins: 0, fails: 0, uses: 0 },
    vd = versionDir(rec);
  const files = vd && fs.existsSync(vd) ? filesOf(vd, 30) : [];
  const parts = [
    `${e.id} v${e.version} [${e.kind}, ${row?.status ?? e.status}] ${e.title}`,
    e.summary,
    `for: ${row?.bases ?? e.id.split(".")[1]} (${engineRangeText(row?.engines, base)}), scope ${e.scope}, licence ${e.licence.id}${e.licence.author ? ` by ${e.licence.author}` : ""}; used ${o.uses}x, worked ${o.wins}, failed ${o.fails}`,
    e.tags.length ? `tags: ${e.tags.join(", ")}` : "",
    KNOWHOW_KINDS.includes(e.kind) ? problemText(e) : "",
    usageOf(e)
      ? `usage:
${usageOf(e)}`
      : "",
    e.exports?.length ? `exports: ${e.exports.join(", ")}` : "",
    e.doc?.when ? `when: ${e.doc.when}` : "",
    e.doc?.avoid ? `avoid: ${e.doc.avoid}` : "",
    e.doc?.gotchas?.length
      ? `gotchas:
- ${e.doc.gotchas.join("\n- ")}`
      : "",
    e.doc?.params ? `params: ${typeof e.doc.params === "string" ? e.doc.params : JSON.stringify(e.doc.params)}` : "",
    e.requires.length ? `requires: ${e.requires.join(", ")}` : "",
    e.related.length ? `related: ${e.related.join(", ")}` : "",
    files.length ? `files (v${e.version}): ${files.join(", ")}` : "",
    e.preview ? "preview: library_get image=true" : "",
  ];
  return cap(parts.filter(Boolean).join("\n"), CARD_CHARS);
}
function outline(src) {
  const lines = src.split(/\r?\n/),
    out = [];
  lines.forEach((l, i) => {
    if (/^\s*(export\b|function\b|class\b|async function\b)|^\s*(const|let)\s+\w+\s*=\s*(\(|async|function)/.test(l))
      out.push(`${i + 1}: ${cap(l.trim(), 140)}`);
  });
  return { total: lines.length, out };
}
const LOCK = "library/lock.json";
const readLock = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, LOCK), "utf8"));
  } catch {
    return {};
  }
};
function writeLock(dir, lock) {
  fs.mkdirSync(path.join(dir, "library"), { recursive: true });
  fs.writeFileSync(path.join(dir, LOCK), JSON.stringify(lock, null, 1) + "\n");
}
const hasCode = (files) => files.some((f) => /\.(m?js|html)$/i.test(f));
function copyInto(dir, rec, v) {
  const vd = versionDir(rec, v);
  if (!vd || !fs.existsSync(vd)) throw new Error(`${rec.entry.id} has no v${v} folder`);
  const files = filesOf(vd, 80);
  if (rec.origin === "seed" && rec.entry.delivery === "ref" && !hasCode(files))
    return { ref: true, files, hash: sha1(files.join("|") + v).slice(0, 20) };
  const target = path.join(dir, "library", rec.entry.id);
  if (!insideDir(dir, target)) throw new Error("library path escapes the project");
  let bytes = 0;
  for (const f of files) {
    const s = fileIn(vd, f);
    if (!s) throw new Error(`bad file ${f}`);
    bytes += fs.statSync(s).size;
  }
  if (bytes > 4e7) throw new Error(`${rec.entry.id} v${v} is ${(bytes / 1e6).toFixed(1)} MB: too big to copy into a project`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const f of files) {
    const s = fileIn(vd, f),
      t = fileIn(target, f);
    if (!t) throw new Error(`bad file ${f}`);
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.copyFileSync(s, t);
  }
  return { ref: false, files, hash: sha1(Buffer.concat(files.map((f) => fs.readFileSync(fileIn(vd, f))))).slice(0, 20) };
}
const recipeImports = (src, recipeId) =>
  src.replace(/(\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)(['"])([^'"\n]+)\2/gm, (m, pre, qt, spec) => {
    let s = spec;
    if (spec.startsWith("../../")) s = "../" + spec.slice(6);
    else if (spec.startsWith("../") && LIB_ID_RX.test(spec.slice(3).split("/")[0])) s = "../library/" + spec.slice(3);
    else if (spec.startsWith("./")) s = `../library/${recipeId}/${spec.slice(2)}`;
    return `${pre}${qt}${s}${qt}`;
  });
const CREDIT_BEGIN = "--- Library credits (kept up to date by Videoxx) ---",
  CREDIT_END = "--- end of library credits ---";
function updateLibraryCredits(dir) {
  const lock = readLock(dir),
    lines = [];
  for (const id of Object.keys(lock).sort()) {
    if (!LIB_ID_RX.test(id)) continue;
    const rec = findStoreEntry(id),
      l = rec?.entry.licence;
    if (!l || !/^CC-BY/.test(l.id)) continue;
    lines.push(l.credit_text || `"${rec.entry.title}" by ${l.author || "unknown"}, ${l.id}${l.source_url ? ` (${l.source_url})` : ""}`);
  }
  const f = path.join(dir, "DESCRIPTION.txt");
  let prev = "";
  try {
    prev = fs.readFileSync(f, "utf8");
  } catch {}
  const block = lines.length
    ? `${CREDIT_BEGIN}
${[...new Set(lines)].join("\n")}
${CREDIT_END}`
    : "";
  const has = prev.includes(CREDIT_BEGIN) && prev.includes(CREDIT_END);
  if (!block && !has) return "";
  let out = has
    ? prev.slice(0, prev.indexOf(CREDIT_BEGIN)) + block + prev.slice(prev.indexOf(CREDIT_END) + CREDIT_END.length)
    : (prev.trim() ? prev.replace(/\s*$/, "\n\n") : "") + block;
  out = out.replace(/\n{3,}/g, "\n\n").replace(/^\s+/, "");
  if (out.trim() !== prev.trim()) fs.writeFileSync(f, out.endsWith("\n") ? out : out + "\n");
  return lines.join("\n");
}
const SECRET = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bhf_[A-Za-z0-9]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/,
  /\b(?:api[_-]?key|apikey|secret|token|password|passwd|auth)\b["']?\s*[:=]\s*['"`][^'"`\s]{12,}['"`]/i,
];
const findSecret = (s) => SECRET.some((r) => r.test(s));
function stripPaths(s, projectDir) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    forms = (p) => [...new Set([p, p.replace(/\\/g, "/"), p.replace(/\//g, "\\")])];
  let t = s;
  for (const [p, rep] of [
    [projectDir, "."],
    [ws.root(), "<workspace>"],
    [os.homedir(), "~"],
  ])
    for (const f of forms(p)) if (f.length > 3) t = t.replace(new RegExp(esc(f), "gi"), rep);
  return t.replace(/\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"`]+/gi, "~").replace(/(^|[\s'"`(])\/(?:Users|home)\/[^/\s'"`]+/g, "$1~");
}
const IMPORT_RX = /(\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)(['"`])([^'"`\n]+)\2/gm;
function contractImports(src, relDir, own, requires) {
  let error = "";
  const out = src.replace(IMPORT_RX, (m, pre, qt, spec) => {
    if (error) return m;
    if (!spec.startsWith(".")) {
      error = `imports '${spec}': a Library entry imports only the project's engine (../../engine.js), its lib/*.js, other entries (../<id>/) and its own files`;
      return m;
    }
    const r = path.posix.normalize(path.posix.join(relDir || ".", spec));
    let s = null;
    if (r === "engine.js") s = "../../engine.js";
    else if (/^lib\/[\w.-]+\.m?js$/.test(r)) s = "../../" + r;
    else if (/^library\//.test(r)) {
      const id = r.split("/")[1];
      if (LIB_ID_RX.test(id) && r.split("/").length >= 3) {
        requires.add(id);
        s = "../" + r.slice("library/".length);
      }
    } else if (own.has(r)) s = "./" + own.get(r);
    if (!s) {
      error = `imports '${spec}' (${r}), which is not the engine, lib/*.js, another Library entry or one of the files you are saving: add that file too, or save it as its own entry first`;
      return m;
    }
    return `${pre}${qt}${s}${qt}`;
  });
  return error ? { error } : { src: out };
}
function exportsOf(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    n = new Set();
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) n.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g))
    for (const p of m[1].split(",")) {
      const x = p
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (x && /^[A-Za-z_$][\w$]*$/.test(x)) n.add(x);
    }
  return [...n].slice(0, 60);
}
const grams = (s) => {
  const t = ` ${s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()} `,
    g = new Set();
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3));
  return g;
};
const jaccard = (a, b) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return a.size + b.size - i ? i / (a.size + b.size - i) : 0;
};
const slugOf = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "") || "entry";
const TEXT_EXT = /\.(m?js|json|md|txt|glsl|frag|vert|css|csv)$/i,
  BIN_EXT = /\.(png|jpe?g|webp|gif|glb|bin|ogg|mp3|wav|m4a|woff2?|ttf|otf|ktx2|hdr|exr)$/i;
const DENY_DIRS = /^(\.git|\.suite|\.claude|node_modules|out|library|vendor)\//i;
function parseProblem(body) {
  const p = {};
  let hit = false;
  for (const m of body.matchAll(/^\s*(symptom|cause|fix|detect)\s*:\s*(.+)$/gim)) {
    p[m[1].toLowerCase()] = cap(m[2].trim(), 1e3);
    hit = true;
  }
  return hit ? p : { fix: cap(body.trim(), 2e3) };
}
export function libraryToolDefs(projectId, look) {
  return [
    // (descriptions and schemas kept short: all five are in every request's tool list. Patterns are checked in the handlers.)
    {
      name: "library_search",
      description:
        'Search reusable work from earlier videos: modules, materials, models, poses, scene recipes, looks, know-how (solutions, pitfalls, checks), plus lp: low poly assets, sfx: sounds, char: / sprite: / fig: characters. One line per hit with how to use it. base: default this style; scope "all": other styles too; include_proposed: not yet accepted.',
      schema: {
        query: z.string().min(2).max(200),
        kind: z.enum(LIB_KINDS).optional(),
        base: z.string().optional(),
        scope: z.enum(["fit", "all"]).optional(),
        limit: z.number().int().min(1).max(12).optional(),
        include_proposed: z.boolean().optional(),
      },
      handler: async (a) => {
        try {
          if (a.base && !LIB_BASE_RX.test(a.base))
            return text(
              `library_search: base is a style base (any, recon, lowpoly, flat, collage, stickman, pixel-art, starter, custom-<id>), not "${cap(a.base, 40)}".`,
            );
          refreshIndex();
          const { p, base, ev } = projectInfo(projectId),
            b = a.base ?? base;
          const hits = searchLibrary({
            query: a.query,
            kind: a.kind ?? null,
            base: b,
            styleId: p.style_id,
            projectId,
            engineVersion: b === base ? ev : null,
            scope: a.scope ?? "fit",
            limit: a.limit ?? 6,
            includeProposed: !!a.include_proposed,
          });
          for (const h of hits) logUse(h.id, "hit", { projectId, version: h.version });
          if (!hits.length)
            return text(
              `Nothing in the Library for "${a.query}" (${b}${a.kind ? `, ${a.kind}` : ""}). Try other words, or build it; save what works with library_add.`,
            );
          const lines = [];
          let n = 0;
          for (const h of hits) {
            const l = hitLine(h, b);
            if (n + l.length > SEARCH_CHARS) break;
            lines.push(l);
            n += l.length + 1;
          }
          return text(lines.join("\n") + "\nlibrary_get <id> for the card / code; library_use <id> to copy it in.");
        } catch (e) {
          return text(`library_search: ${e?.message || e}`);
        }
      },
    },
    {
      name: "library_get",
      description:
        'One Library entry: part "card" (default: usage, gotchas, licence, outcomes), "code" (its entry file or `file`; long files as an outline), "files". image: its preview still (counts against the frame budget).',
      schema: {
        id: z.string().max(160),
        part: z.enum(["card", "code", "files"]).optional(),
        file: z.string().max(200).optional(),
        image: z.boolean().optional(),
      },
      handler: async (a) => {
        try {
          if (!isLibId(a.id)) return text(`library_get: "${cap(a.id, 80)}" is not a library id (library_search lists them).`);
          refreshIndex();
          const row = getRow(a.id);
          if (!row) return text(`library_get: ${a.id} is not in the Library.`);
          const { base } = projectInfo(projectId);
          logUse(a.id, "get", { projectId, version: row.version });
          if (isFedId(a.id))
            return text(
              cap(
                [
                  `${a.id} [${row.kind}, ${row.source}] ${row.title}`,
                  row.summary,
                  row.tags ? `tags: ${row.tags}` : "",
                  row.licence ? `licence: ${row.licence}` : "",
                  `how: ${fedHow(a.id, base)}`,
                  row.source === "img" && row.body ? `make_image prompt: ${row.body}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
                CARD_CHARS,
              ),
            );
          const rec = findStoreEntry(a.id);
          if (!rec) return text(`library_get: ${a.id} is indexed but its folder is gone (the index refreshes shortly).`);
          const vd = versionDir(rec),
            content = [];
          if (a.part === "files")
            content.push({
              type: "text",
              text: cap(
                (vd && fs.existsSync(vd) ? filesOf(vd, 60) : [])
                  .map((f) => {
                    const s = fileIn(vd, f);
                    return `${f}  ${s ? fs.statSync(s).size : 0} bytes`;
                  })
                  .join("\n") || "No files (a know-how entry).",
                CARD_CHARS,
              ),
            });
          else if (a.part === "code") {
            const rel = a.file ?? rec.entry.entry;
            const f = rel && vd ? fileIn(vd, rel) : null;
            if (!f || !fs.existsSync(f)) return text(`library_get: ${a.id} v${rec.entry.version} has no file ${rel ?? "(no entry file)"}.`);
            if (!TEXT_EXT.test(f)) return text(`${rel} is a binary file (${fs.statSync(f).size} bytes): library_use copies it in.`);
            const src = fs.readFileSync(f, "utf8"),
              o = outline(src);
            content.push({
              type: "text",
              text:
                o.total <= CODE_LINES
                  ? `${a.id} v${rec.entry.version} ${rel} (${o.total} lines):
${src}`
                  : `${a.id} v${rec.entry.version} ${rel}: ${o.total} lines, outline:
${o.out.slice(0, 120).join("\n")}
Read ${f} with offset / limit for the parts you need.`,
            });
          } else content.push({ type: "text", text: card(rec, row, base) });
          if (a.image) {
            const pf = rec.entry.preview ? fileIn(rec.dir, rec.entry.preview) : null;
            if (!pf || !fs.existsSync(pf)) content.push({ type: "text", text: "(no preview still)" });
            else if (look?.over()) content.push({ type: "text", text: look.budgetText() });
            else {
              const im = nativeImage.createFromPath(pf),
                s0 = im.getSize(),
                k = Math.min(1, 640 / Math.max(s0.width, s0.height, 1));
              const small = k < 1 ? im.resize({ width: Math.round(s0.width * k), height: Math.round(s0.height * k), quality: "best" }) : im,
                s = small.getSize();
              look?.spend(Math.ceil((s.width * s.height) / 750));
              content.push({ type: "image", data: small.toJPEG(85).toString("base64"), mimeType: "image/jpeg" });
            }
          }
          return { content };
        } catch (e) {
          return text(`library_get: ${e?.message || e}`);
        }
      },
    },
    {
      name: "library_use",
      description: `Copy an entry (and what it requires) into library/<id>/, recorded in library/lock.json, credits in DESCRIPTION.txt. Scenes import '../library/<id>/<file>'; never edit the copy. A recipe with as="<name>" also writes scenes/<name>.js (add it to the scene list). Know-how returns its fix. Then library_note_outcome.`,
      schema: {
        id: z.string().max(160),
        version: z.number().int().min(1).max(9999).optional(),
        as: z
          .string()
          .regex(/^[a-z][a-z0-9_-]{0,40}$/)
          .optional(),
      },
      handler: async (a) => {
        try {
          if (!isLibId(a.id)) return text(`library_use: "${cap(a.id, 80)}" is not a library id (library_search lists them).`);
          refreshIndex();
          const { p, dir, base, ev } = projectInfo(projectId),
            editId = runningEdit(projectId),
            row = getRow(a.id);
          if (!row) return text(`library_use: ${a.id} is not in the Library.`);
          if (isFedId(a.id)) {
            logUse(a.id, "use", { projectId, editId });
            noteUsed(editId, a.id);
            return text(`${a.id} stays in its own library: ${fedHow(a.id, base)}.`);
          }
          const rec = findStoreEntry(a.id);
          if (!rec) return text(`library_use: ${a.id} is indexed but its folder is gone.`);
          const e = rec.entry;
          if (row.status === "retired")
            return text(`library_use: ${a.id} is retired${e.related.length ? ` (see ${e.related.join(", ")})` : ""}.`);
          const flagged =
            row.status === "flagged"
              ? `
WARNING: ${a.id} is flagged (it failed in recent uses): check it closely, and report with library_note_outcome.`
              : "";
          if (KNOWHOW_KINDS.includes(e.kind)) {
            logUse(a.id, "use", { projectId, editId, version: e.version });
            noteUsed(editId, a.id);
            return text(
              cap(
                `${e.title} (${e.id} v${e.version})
${problemText(e)}${
                  e.doc?.gotchas?.length
                    ? `
- ${e.doc.gotchas.join("\n- ")}`
                    : ""
                }${flagged}
If it helped (or not): library_note_outcome.`,
                CARD_CHARS,
              ),
            );
          }
          const [sk, sv] = e.scope.split(":");
          if (
            (sk === "project" && sv !== projectId) ||
            (sk === "style" && sv !== p.style_id) ||
            (sk === "base" && sv !== base && sv !== "any")
          )
            return text(`library_use: ${a.id} is scoped to ${e.scope}, not this project.`);
          const idBase = e.id.split(".")[1],
            bases = (row.bases || "").split(/\s+/);
          if (idBase !== "any" && !bases.includes(base) && !bases.includes(p.style_id))
            return text(`library_use: ${a.id} is made for ${bases.join(" / ")}, not ${base}: search again with this project's base.`);
          if (!engineFits(row.engines, base, ev))
            return text(
              `library_use: ${a.id} needs the ${engineRangeText(row.engines, base)}; this project's engine is ${base} v${ev}. ${ev && row.engine_max != null && ev > row.engine_max ? "It was made for an older engine: build it fresh (and save the new one)." : "Update the project's engine first (the editor offers it), or build it fresh."}`,
            );
          const st = studioOf(projectId);
          if (st) {
            const why = libraryUseCheck(st.studio);
            if (why) return text(`library_use: ${why}`);
          }
          const v = a.version ?? e.version;
          const vdv = versionDir(rec, v);
          if (v > e.version || !vdv || !fs.existsSync(vdv)) return text(`library_use: ${a.id} has no v${v} (latest v${e.version}).`);
          if (e.kind === "recipe" && a.as) {
            const why = st ? studioWriteCheck(dir, st.studio, `scenes/${a.as}.js`) : null;
            if (why) return text(`library_use: ${why}`);
            if (fs.existsSync(path.join(dir, "scenes", `${a.as}.js`)))
              return text(`library_use: scenes/${a.as}.js already exists: pick another name for as.`);
          }
          const chain = [],
            seen = new Set([e.id]);
          const visit = (r) => {
            for (const id of r.entry.requires) {
              if (seen.has(id) || chain.length >= 10) continue;
              seen.add(id);
              const d = findStoreEntry(id);
              if (!d) throw new Error(`${r.entry.id} requires ${id}, which is not in the Library`);
              visit(d);
              chain.push(d);
            }
          };
          visit(rec);
          const lock = readLock(dir),
            at = new Date().toISOString(),
            done = [];
          for (const d of chain) {
            const c2 = copyInto(dir, d, d.entry.version);
            lock[d.entry.id] = { v: d.entry.version, hash: c2.hash, at, source: d.origin, ...(c2.ref ? { ref: true } : {}) };
            done.push(`${d.entry.id} v${d.entry.version}`);
            logUse(d.entry.id, "use", { projectId, editId, version: d.entry.version });
            noteUsed(editId, d.entry.id);
          }
          const c = copyInto(dir, rec, v);
          lock[e.id] = { v, hash: c.hash, at, source: rec.origin, ...(c.ref ? { ref: true } : {}) };
          writeLock(dir, lock);
          let scene = "";
          if (e.kind === "recipe" && a.as) {
            const vd = versionDir(rec, v),
              f = e.entry ? fileIn(vd, e.entry) : null;
            if (f && fs.existsSync(f)) {
              fs.mkdirSync(path.join(dir, "scenes"), { recursive: true });
              fs.writeFileSync(path.join(dir, "scenes", `${a.as}.js`), recipeImports(fs.readFileSync(f, "utf8"), e.id));
              scene = `
Wrote scenes/${a.as}.js from the recipe: add '${a.as}' to project.json "scenes" where it belongs, then fit its cues to this narration.`;
            }
            const sj = fileIn(vd, typeof e.settings === "string" ? e.settings : "settings.json");
            if (sj && fs.existsSync(sj))
              scene += `
The recipe was made under library/${e.id}/${path.relative(vd, sj).split(path.sep).join("/")}: merge its "theme" and "post" into project.json "settings" (never "graphics", which is the user's).`;
          }
          const credits = updateLibraryCredits(dir);
          logUse(e.id, "use", { projectId, editId, version: v });
          noteUsed(editId, e.id);
          const imp = c.ref
            ? `Served (not copied) at __library/${e.id}/v${v}/: from a scene load e.g. new URL('../__library/${e.id}/v${v}/${c.files[0] ?? ""}', import.meta.url).href`
            : e.entry
              ? `import { ${(e.exports ?? []).slice(0, 8).join(", ") || "..."} } from '../library/${e.id}/${e.entry}';   (from scenes/)`
              : `files in library/${e.id}/: ${c.files.slice(0, 10).join(", ")}`;
          return text(
            cap(
              [
                c.ref
                  ? `Linked ${e.title} (${e.id} v${v}, built in: nothing copied, recorded in library/lock.json).`
                  : `Copied ${e.title} (${e.id} v${v}, ${c.files.length} file${c.files.length === 1 ? "" : "s"}) into library/${e.id}/${done.length ? `, with ${done.join(", ")}` : ""}.`,
                imp,
                usageOf(e)
                  ? `usage:
${usageOf(e)}`
                  : "",
                e.doc?.gotchas?.length
                  ? `gotchas:
- ${e.doc.gotchas.join("\n- ")}`
                  : "",
                credits ? `credit added to DESCRIPTION.txt: ${credits.split("\n")[0]}` : "",
                scene,
                flagged,
                "Run check_preview after using it, then library_note_outcome with how it went.",
              ]
                .filter(Boolean)
                .join("\n"),
              CARD_CHARS,
            ),
          );
        } catch (e) {
          return text(`library_use: ${e?.message || e}`);
        }
      },
    },
    {
      name: "library_add",
      description: `Save what worked for later videos. Know-how body: "Symptom: .. Cause: .. Fix: .. Detect: ..". files: up to 10 project files, 2 MB (first .js = entry); code imports only engine.js, lib/*.js, library/<id>/ and its own files, deterministic, no web, no secrets. bases: styles it works in, or "any". licence, author, source_url, credit_text: others' work only (CC0, PD, CC-BY). still_t: frame time for its preview. user_asked: the user asked (else proposed).`,
      schema: {
        kind: z.enum(LIB_KINDS),
        title: z.string().min(3).max(120),
        summary: z.string().min(10).max(200),
        tags: z.array(z.string().max(40)).max(20),
        bases: z.array(z.string()).min(1).max(4),
        scope: z.string().optional(),
        body: z.string().max(4e3).optional(),
        files: z.array(z.string()).max(10).optional(),
        entry: z.string().optional(),
        usage: z.string().max(1e3).optional(),
        still_t: z.number().min(0).optional(),
        related: z.array(z.string()).max(10).optional(),
        supersedes: z.string().optional(),
        licence: z.string().max(80).optional(),
        author: z.string().max(200).optional(),
        source_url: z.string().max(500).optional(),
        credit_text: z.string().max(500).optional(),
        user_asked: z.boolean().optional(),
      },
      handler: async (a) => {
        try {
          return text(await addEntry(projectId, a));
        } catch (e) {
          return text(`library_add: ${e?.message || e}`);
        }
      },
    },
    {
      name: "library_note_outcome",
      description:
        "How an entry you used went (ranks it): note = what happened, fix = what you changed. Failures flag it; a failure with a note proposes a pitfall.",
      schema: {
        id: z.string().max(160),
        outcome: z.enum(["worked", "failed", "partial"]),
        note: z.string().max(1e3).optional(),
        fix: z.string().max(1e3).optional(),
      },
      handler: async (a) => {
        try {
          if (!isLibId(a.id)) return text(`library_note_outcome: "${cap(a.id, 80)}" is not a library id.`);
          const row = getRow(a.id);
          if (!row) return text(`library_note_outcome: ${a.id} is not in the Library.`);
          const { dir, base } = projectInfo(projectId),
            editId = runningEdit(projectId);
          const lockV = readLock(dir)[a.id]?.v ?? row.version;
          logUse(a.id, "outcome", { projectId, editId, version: lockV, outcome: a.outcome, note: a.note ? stripPaths(a.note, dir) : null });
          applyFlags();
          const now = getRow(a.id),
            o = outcomesOf([a.id]).get(a.id) ?? { wins: 0, fails: 0, uses: 0 };
          let extra = "";
          if (a.outcome === "failed" && a.note && !isFedId(a.id) && !findSecret(a.note) && !findSecret(a.fix ?? "")) {
            const pb = a.id.split(".")[1] === "any" ? base : a.id.split(".")[1],
              pid = `pitfall.${pb}.${slugOf(a.note).slice(0, 40)}`;
            if (LIB_ID_RX.test(pid) && !findStoreEntry(pid)) {
              const entry = LibEntrySchema.parse({
                schema: 1,
                id: pid,
                uid: uid("lib_"),
                kind: "pitfall",
                title: cap(a.note.replace(/\s+/g, " "), 120),
                summary: cap(`Seen using ${a.id} v${lockV}: ${a.note}`.replace(/\s+/g, " "), 200),
                tags: ["pitfall", ...a.id.split(".").slice(1)],
                scope: "global",
                status: "proposed",
                version: 1,
                problem: { symptom: stripPaths(a.note, dir), cause: `using ${a.id} v${lockV}`, fix: a.fix ? stripPaths(a.fix, dir) : "" },
                related: [a.id],
                provenance: [{ projectId, edit: editId, by: "claude", at: new Date().toISOString() }],
                licence: { id: "own" },
              });
              writeWsEntry(entry, []);
              link(pid, a.id, "related");
              rebuildIndex();
              applyFlags();
              extra = `
Proposed a pitfall for the user to accept: ${pid}.`;
            }
          }
          return text(
            `Noted: ${a.outcome} for ${a.id} (worked ${o.wins}, failed ${o.fails} so far).${
              now?.status === "flagged"
                ? `
${a.id} is now FLAGGED (2 failures in its last 5 uses): it is hidden from searches until someone fixes it.`
                : ""
            }${extra}`,
          );
        } catch (e) {
          return text(`library_note_outcome: ${e?.message || e}`);
        }
      },
    },
  ];
}
export const ADD_SCHEMA = {
  kind: z.enum(LIB_KINDS),
  title: z.string().min(3).max(120),
  summary: z.string().min(10).max(200),
  tags: z.array(z.string().max(40)).max(20),
  bases: z.array(z.string()).min(1).max(4),
  scope: z.string().optional(),
  body: z.string().max(4e3).optional(),
  files: z.array(z.string()).max(10).optional(),
  entry: z.string().optional(),
  usage: z.string().max(1e3).optional(),
  still_t: z.number().min(0).optional(),
  related: z.array(z.string()).max(10).optional(),
  licence: z.string().max(80).optional(),
  author: z.string().max(200).optional(),
  source_url: z.string().max(500).optional(),
  credit_text: z.string().max(500).optional(),
};
export async function addEntry(projectId, a, o = {}) {
  const by = o.by ?? "claude";
  if (by === "harvest") {
    a = { ...a, user_asked: false };
    delete a.supersedes;
  }
  if (!a.bases.every((b) => LIB_BASE_RX.test(b)))
    return "Refused: bases are styles (any, recon, lowpoly, flat, collage, stickman, pixel-art, starter, custom-<id>).";
  if (a.scope && !LIB_SCOPE_RX.test(a.scope)) return "Refused: scope is global, base:<base>, style:<style id> or project:<project id>.";
  const { p, dir, base, ev } = projectInfo(projectId),
    editId = runningEdit(projectId);
  const texts = [a.title, a.summary, a.body ?? "", a.usage ?? "", ...(a.tags ?? []), a.credit_text ?? ""];
  if (texts.some(findSecret)) return "Refused: the text looks like it holds a key, token or password. Leave secrets out of the Library.";
  const rels = (a.files ?? []).map((f) => String(f).replace(/\\/g, "/"));
  const files = [],
    names = new Set();
  let total = 0;
  for (const r of rels) {
    const abs = path.resolve(dir, r);
    if (!insideDir(dir, abs)) return `Refused: ${r} is outside this project (only the project's own files can be saved).`;
    const proj = path.relative(dir, abs).split(path.sep).join("/");
    if (DENY_DIRS.test(proj) || /^(project\.json|CLAUDE\.md|STYLE\.md)$/i.test(proj))
      return `Refused: ${proj} is one of the app's files (or already a Library copy), not something to save.`;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return `Refused: ${proj} does not exist.`;
    if (!TEXT_EXT.test(abs) && !BIN_EXT.test(abs))
      return `Refused: ${proj}: only code, text, pictures, models, sounds and fonts can be saved.`;
    const name = path.basename(abs);
    if (names.has(name)) return `Refused: two files are called ${name}: rename one.`;
    names.add(name);
    total += fs.statSync(abs).size;
    files.push({ proj, name, abs });
  }
  if (total > 2 * 1024 * 1024) return `Refused: the files are ${(total / 1048576).toFixed(1)} MB (2 MB at most).`;
  const own = new Map(files.map((f) => [f.proj, f.name])),
    requires = new Set(),
    out = [];
  let entryName = a.entry ? path.basename(String(a.entry)) : files.find((f) => /\.m?js$/i.test(f.name))?.name,
    entrySrc = "";
  if (a.entry && !names.has(entryName)) return `Refused: entry ${a.entry} is not one of the files.`;
  for (const f of files) {
    if (!TEXT_EXT.test(f.name)) {
      out.push({ rel: f.name, buf: fs.readFileSync(f.abs) });
      continue;
    }
    let s = fs.readFileSync(f.abs, "utf8");
    if (findSecret(s)) return `Refused: ${f.proj} looks like it holds a key, token or password. Leave secrets out of the Library.`;
    if (/\.m?js$/i.test(f.name)) {
      const banned = bannedInSource(s);
      if (banned.length)
        return `Refused: ${f.proj} has ${banned.map((b) => `${b.token} (line ${b.line})`).join(", ")}: ${banned[0].fix}. Library code must render the same every time and never reach the internet.`;
      const r = contractImports(s, path.posix.dirname(f.proj) === "." ? "" : path.posix.dirname(f.proj), own, requires);
      if (r.error) return `Refused: ${f.proj} ${r.error}.`;
      s = r.src;
    }
    s = stripPaths(s, dir);
    if (f.name === entryName) entrySrc = s;
    out.push({ rel: f.name, buf: Buffer.from(s, "utf8") });
  }
  for (const id2 of requires) if (!findStoreEntry(id2)) return `Refused: it imports library/${id2}, which is not in the Library.`;
  let licence = { id: "own" };
  if (a.licence) {
    const id2 = normLicence(a.licence);
    if (!id2)
      return `Refused: licence "${a.licence}" is not allowed (CC0, public domain, CC-BY 3.0 / 4.0 only; no NC, ND, SA, personal-use or unclear licences).`;
    if (!a.author || !a.source_url)
      return "Refused: author and source_url (the page stating the licence) are needed for something made by others.";
    if (/^CC-BY/.test(id2) && !a.credit_text) return "Refused: a CC-BY entry needs credit_text (the exact line for the video description).";
    licence = { id: id2, author: a.author, source_url: a.source_url, ...(a.credit_text ? { credit_text: a.credit_text } : {}) };
  }
  const bases = [...new Set(a.bases)],
    scope = a.scope ?? "global";
  const idBase = scope.startsWith("style:") ? scope.slice(6) : bases.length === 1 ? bases[0] : "any";
  let id = `${a.kind}.${idBase}.${slugOf(a.title)}`;
  try {
    assertId(id);
  } catch {
    return `Refused: the title / bases do not make a library id (${id}).`;
  }
  const ch = entrySrc ? codeHash(entrySrc) : null;
  if (ch) {
    const same = q.get("SELECT id, source FROM lib_entries WHERE code_hash=? AND source IN ('seed','ws')", ch);
    if (same) {
      if (same.source === "ws")
        try {
          patchWsEntry(same.id, (e) => {
            e.provenance = [
              ...(e.provenance ?? []),
              { project: p.name, projectId, files: rels, edit: editId, by, at: new Date().toISOString() },
            ].slice(-100);
          });
        } catch {}
      return `Already in the Library as ${same.id} (the same code): use that id (library_use ${same.id}).`;
    }
  }
  let version = 1,
    prev = null;
  if (a.supersedes && LIB_ID_RX.test(a.supersedes) && a.supersedes === id) prev = findStoreEntry(id);
  if (prev && prev.origin === "ws") version = prev.entry.version + 1;
  else
    for (let k = 2; findStoreEntry(id) || fs.existsSync(entryDirFor(id, "ws")); k++) {
      if (k > 30) return "Refused: too many entries with that title.";
      id = `${a.kind}.${idBase}.${slugOf(a.title).slice(0, 44)}-${k}`;
    }
  const status = a.user_asked ? "accepted" : "proposed";
  const body = a.body ? stripPaths(String(a.body), dir) : "";
  const isKnow = KNOWHOW_KINDS.includes(a.kind);
  if (!isKnow && !out.length && !body) return "Refused: nothing to save (give files, or the body of a know-how entry).";
  if (body && !isKnow)
    out.push({
      rel: "README.md",
      buf: Buffer.from(
        `# ${a.title}

${body}
`,
        "utf8",
      ),
    });
  const fileList = out.map((f) => ({
    path: f.rel,
    role: f.rel === entryName ? "entry" : f.rel === "README.md" ? "doc" : TEXT_EXT.test(f.rel) ? "data" : "asset",
    bytes: f.buf.length,
    sha1: sha1(f.buf),
  }));
  const hash = sha1(Buffer.concat(out.map((f) => f.buf))).slice(0, 20),
    at = new Date().toISOString();
  const engines = bases
    .filter((b) => b !== "any" && !b.startsWith("custom-"))
    .map((b) => (b === base && ev ? { base: b, min: ev } : { base: b }));
  const raw = {
    ...(prev ? prev.entry : {}),
    schema: 1,
    id,
    uid: prev?.entry.uid ?? uid("lib_"),
    kind: a.kind,
    title: a.title.trim(),
    summary: stripPaths(a.summary.trim(), dir),
    tags: a.tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
    engines,
    scope,
    status,
    version,
    versions: [...(prev?.entry.versions ?? []), { v: version, hash, at, note: prev ? "library_add (new version)" : "library_add" }],
    delivery: "copy",
    files: fileList,
    ...(entryName && out.some((f) => f.rel === entryName) ? { entry: entryName } : {}),
    ...(entrySrc ? { exports: exportsOf(entrySrc) } : {}),
    ...(a.usage ? { usage: stripPaths(a.usage, dir) } : {}),
    requires: [...requires],
    ...(isKnow ? { problem: parseProblem(body || a.summary) } : body ? { doc: { ...(prev?.entry.doc ?? {}), when: cap(body, 1e3) } } : {}),
    provenance: [...(prev?.entry.provenance ?? []), { project: p.name, projectId, files: rels, edit: editId, by, at }].slice(-100),
    licence,
    related: (a.related ?? []).filter((r) => isLibId(r)),
    created: prev?.entry.created ?? at,
    updated: at,
  };
  delete raw.origin;
  delete raw.preview;
  const parsed = LibEntrySchema.safeParse(raw);
  if (!parsed.success)
    return `Refused: ${parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")}`;
  let preview = null,
    stillNote = "";
  if (a.still_t != null && !isKnow) {
    try {
      const [s] = await renderStills(projectId, [+a.still_t], 0.5, "library");
      if (s?.base64) {
        const im = nativeImage.createFromBuffer(Buffer.from(s.base64, "base64")),
          sz = im.getSize(),
          k = Math.min(1, 960 / Math.max(sz.width, sz.height, 1));
        preview = (k < 1 ? im.resize({ width: Math.round(sz.width * k), quality: "best" }) : im).toJPEG(84);
      }
    } catch (e) {
      stillNote = ` (no preview still: ${cap(String(e?.message || e), 120)})`;
    }
  }
  if (prev && !preview && prev.entry.preview) parsed.data.preview = prev.entry.preview;
  writeWsEntry(parsed.data, out, preview);
  if (a.supersedes && isLibId(a.supersedes) && a.supersedes !== id) link(id, a.supersedes, "supersedes");
  for (const r of parsed.data.related) link(id, r, "related");
  for (const r of requires) link(id, r, "requires");
  const mine = grams(`${a.title} ${a.tags.join(" ")}`),
    dups = [];
  for (const r of q.all("SELECT id, title, tags FROM lib_entries WHERE kind=? AND source IN ('seed','ws') AND id!=?", a.kind, id))
    if (r.id.split(".")[1] === idBase && jaccard(mine, grams(`${r.title} ${r.tags}`)) >= 0.6) {
      link(id, r.id, "dup");
      dups.push(r.id);
    }
  rebuildIndex();
  return `Saved to the Library as ${id} v${version} (${status === "accepted" ? "accepted: it shows in searches now" : "proposed: the user accepts it in the Library; library_search include_proposed finds it meanwhile"}; ${out.length} file${out.length === 1 ? "" : "s"}${preview ? ", preview still" : ""}${stillNote}).${dups.length ? ` Similar entries: ${dups.slice(0, 3).join(", ")} (linked as possible duplicates).` : ""}`;
}
