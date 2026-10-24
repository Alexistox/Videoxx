import fs from "node:fs";
import { log } from "../core/log";
import { now, q } from "../db/db";
import { SCOPE_WEIGHT, STATUS_WEIGHT, isFedId } from "./schema";
import { ftsOk } from "./index";
import { fileIn, filesOf, findStoreEntry, versionDir } from "./store";

export const getRow = (id) => q.get("SELECT * FROM lib_entries WHERE id=?", id) ?? null;
export function outcomesOf(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    for (const r of q.all(
      `SELECT entry_id, SUM(kind='outcome' AND outcome='worked') w, SUM(kind='outcome' AND outcome='failed') f, SUM(kind='use') u FROM lib_uses WHERE entry_id IN (${part.map(() => "?").join(",")}) GROUP BY entry_id`,
      ...part,
    ))
      out.set(r.entry_id, { wins: +r.w || 0, fails: +r.f || 0, uses: +r.u || 0 });
  }
  return out;
}
export function engineFits(engines, base, version) {
  if (!engines || !version) return true;
  let list = [];
  try {
    list = JSON.parse(engines);
  } catch {
    return true;
  }
  const mine = list.filter((e) => e?.base === base || e?.base === "any");
  if (!mine.length) return true;
  return mine.some((e) => (e.min == null || version >= e.min) && (e.max == null || version <= e.max));
}
export function engineRangeText(engines, base) {
  let list = [];
  try {
    list = JSON.parse(engines || "[]");
  } catch {}
  return (
    list
      .filter((e) => e?.base === base || e?.base === "any")
      .map((e) => `${e.base} engine ${e.min ?? 0}${e.max != null ? `-${e.max}` : "+"}`)
      .join(" or ") || "any engine"
  );
}
const tokensOf = (s) =>
  [
    ...new Set(
      (
        String(s)
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) || []
      ).filter((t) => t.length >= 2),
    ),
  ].slice(0, 12);
export function searchLibrary(o) {
  const rel = relevanceOf(o.query);
  if (!rel.size) return [];
  const ids = [...rel.keys()],
    rows = [];
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    rows.push(...q.all(`SELECT * FROM lib_entries WHERE id IN (${part.map(() => "?").join(",")})`, ...part));
  }
  const outs = outcomesOf(rows.map((r) => r.id)),
    hits = [];
  for (const r of rows) {
    if (o.kind && r.kind !== o.kind) continue;
    if (o.sources?.length && !o.sources.includes(r.source)) continue;
    if (r.status === "retired" || ((r.status === "proposed" || r.status === "flagged") && !o.includeProposed)) continue;
    const bases = r.bases.split(/\s+/).filter(Boolean);
    if (o.base && !bases.includes("any") && !bases.includes(o.base) && !(o.styleId && bases.includes(o.styleId))) continue;
    if (o.base && o.engineVersion && !engineFits(r.engines, o.base, o.engineVersion)) continue;
    let sw = SCOPE_WEIGHT.global;
    const [sk, sv] = r.scope.split(":");
    if (sk === "project") {
      if (sv === o.projectId) sw = SCOPE_WEIGHT.project;
      else if (o.scope !== "all") continue;
    } else if (sk === "style") {
      if (sv === o.styleId) sw = SCOPE_WEIGHT.style;
      else if (o.scope !== "all") continue;
    } else if (sk === "base") {
      if (sv === o.base) sw = SCOPE_WEIGHT.base;
      else if (o.scope !== "all" && o.base) continue;
    }
    const u = outs.get(r.id) ?? { wins: 0, fails: 0 };
    const score = rel.get(r.id) * (STATUS_WEIGHT[r.status] ?? 0.5) * Math.max(0.1, 1 + Math.log1p(u.wins) - 0.5 * Math.log1p(u.fails)) * sw;
    hits.push({
      id: r.id,
      kind: r.kind,
      source: r.source,
      title: r.title,
      summary: r.summary,
      status: r.status,
      version: r.version,
      scope: r.scope,
      licence: r.licence,
      bases,
      wins: u.wins,
      fails: u.fails,
      score: +score.toFixed(4),
    });
  }
  return hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, Math.max(1, Math.min(200, o.limit ?? 20)));
}
export function relevanceOf(query) {
  const toks = tokensOf(query),
    rel = new Map();
  if (!toks.length) return rel;
  if (ftsOk) {
    try {
      const match = toks.map((t) => `"${t.replace(/"/g, "")}"*`).join(" OR ");
      for (const r of q.all(
        "SELECT id, bm25(lib_fts, 0.0, 10.0, 4.0, 6.0, 1.0) AS r FROM lib_fts WHERE lib_fts MATCH ? ORDER BY r LIMIT 400",
        match,
      ))
        rel.set(r.id, Math.max(0.01, -r.r));
    } catch (e) {
      log("library: FTS query failed, LIKE instead", e?.message);
    }
  }
  if (!ftsOk || !rel.size) {
    const where = toks
      .map(() => "(instr(lower(title),?) OR instr(tags,?) OR instr(lower(summary),?) OR instr(lower(body),?))")
      .join(" OR ");
    for (const r of q.all(
      `SELECT id, lower(title) t, tags g, lower(summary) s, lower(body) b FROM lib_entries WHERE ${where} LIMIT 3000`,
      ...toks.flatMap((t) => [t, t, t, t]),
    )) {
      let s = 0;
      for (const t of toks)
        s += (r.t.includes(t) ? 3 : 0) + (r.g.includes(t) ? 2 : 0) + (r.s.includes(t) ? 1.5 : 0) + (r.b.includes(t) ? 1 : 0);
      if (s > 0) rel.set(r.id, s);
    }
  }
  return rel;
}
export function listLibrary(o = {}) {
  const w = [],
    a = [];
  if (o.kind) {
    w.push("kind=?");
    a.push(o.kind);
  }
  if (o.kinds?.length) {
    w.push(`kind IN (${o.kinds.map(() => "?").join(",")})`);
    a.push(...o.kinds);
  }
  if (o.source) {
    w.push("source=?");
    a.push(o.source);
  }
  if (o.status) {
    w.push("status=?");
    a.push(o.status);
  }
  const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
  const total = q.get(`SELECT count(*) n FROM lib_entries ${where}`, ...a).n;
  const rows = q.all(
    `SELECT id,uid,kind,source,title,summary,tags,bases,engines,scope,status,version,hash,code_hash,dir,preview,licence,bytes,delivery,created,updated FROM lib_entries ${where} ORDER BY (source IN ('seed','ws')) DESC, updated DESC, title LIMIT ? OFFSET ?`,
    ...a,
    Math.max(1, Math.min(2e3, o.limit ?? 200)),
    Math.max(0, o.offset ?? 0),
  );
  const count = (col) => Object.fromEntries(q.all(`SELECT ${col} k, count(*) n FROM lib_entries GROUP BY ${col}`).map((r) => [r.k, r.n]));
  return { rows, total, counts: { kind: count("kind"), status: count("status"), source: count("source") }, fts: ftsOk };
}
export function libraryEntry(id) {
  if (typeof id !== "string" || id.length > 160) throw new Error("not a library id");
  const row = getRow(id);
  if (!row) throw new Error(`${id} is not in the library`);
  const rec = isFedId(id) ? null : findStoreEntry(id),
    vd = rec ? versionDir(rec) : null;
  const u =
    q.get(
      "SELECT SUM(kind='hit') hits, SUM(kind='get') gets, SUM(kind='use') uses, SUM(kind='outcome' AND outcome='worked') wins, SUM(kind='outcome' AND outcome='failed') fails FROM lib_uses WHERE entry_id=?",
      id,
    ) ?? {};
  const usedIn = q
    .all("SELECT DISTINCT project_id FROM lib_uses WHERE entry_id=? AND kind='use' AND project_id IS NOT NULL", id)
    .map((r) => r.project_id);
  return {
    row: { ...row, body: void 0 },
    entry: rec?.entry ?? null,
    files: vd && fs.existsSync(vd) ? filesOf(vd, 60) : [],
    preview: rec && rec.entry.preview ? fileIn(rec.dir, rec.entry.preview) : null,
    uses: { hits: +u.hits || 0, gets: +u.gets || 0, uses: +u.uses || 0, wins: +u.wins || 0, fails: +u.fails || 0 },
    usedIn,
    links: q.all("SELECT a, b, rel FROM lib_links WHERE a=? OR b=?", id, id),
  };
}
export function logUse(entryId, kind, o = {}) {
  q.run(
    "INSERT INTO lib_uses(entry_id, version, project_id, edit_id, kind, outcome, note, at) VALUES(?,?,?,?,?,?,?,?)",
    entryId,
    o.version ?? null,
    o.projectId ?? null,
    o.editId ?? null,
    kind,
    o.outcome ?? null,
    o.note ? String(o.note).slice(0, 1e3) : null,
    now(),
  );
}
export const link = (a, b, rel) => q.run("INSERT OR IGNORE INTO lib_links(a, b, rel, at) VALUES(?,?,?,?)", a, b, rel, now());
export function libraryLabel(id) {
  try {
    const r = typeof id === "string" ? q.get("SELECT title, version, source FROM lib_entries WHERE id=?", id) : null;
    return r ? `${r.title}${r.source === "seed" || r.source === "ws" ? ` v${r.version}` : ""}` : String(id ?? "").slice(0, 60);
  } catch {
    return String(id ?? "").slice(0, 60);
  }
}
