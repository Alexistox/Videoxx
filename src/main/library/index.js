import path from "node:path";
import fs from "node:fs";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";
import { execSql, now, q, tx } from "../db/db";
import { baseOf } from "../styles/catalog";
import { charsRoot } from "../characters/characterLab";
import { lowpolyDirs, lowpolyIndex } from "../characters/lowpoly";
import { libraryFigures } from "../characters/libraryFigures";
import { imageEntries, imagesSig } from "../images/imageCache";
import { promptSubject } from "../images/makeImage";
import { libRoot } from "../characters/sprites";
import { sfxDirs } from "../audio/sfx";
import { entryCodeHash, hashDir, scanStore, storeSig, versionDir } from "./store";

export let ftsOk = false;
export const libraryFts = () => ftsOk;
function openLibrary() {
  ftsOk = false;
  if (process.env.CZ_LIBRARY_NO_FTS === "1") {
    log("library: FTS off (CZ_LIBRARY_NO_FTS)");
    return false;
  }
  try {
    execSql(`CREATE VIRTUAL TABLE IF NOT EXISTS lib_fts USING fts5(id UNINDEXED, title, summary, tags, body, tokenize='porter unicode61')`);
    q.get("SELECT count(*) n FROM lib_fts");
    ftsOk = true;
  } catch (e) {
    log("library: no FTS5, searching with LIKE", e?.message);
  }
  return ftsOk;
}
export const setFtsForTest = (on) => {
  if (!on) {
    ftsOk = false;
    return false;
  }
  return openLibrary();
};
const mt = (f) => {
  try {
    const s = fs.statSync(f);
    return `${s.size}:${Math.round(s.mtimeMs)}`;
  } catch {
    return "-";
  }
};
const clip$b = (s, n) => {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const tagsOf = (a) =>
  (Array.isArray(a) ? a : [])
    .map((x) => String(x).toLowerCase().trim())
    .filter(Boolean)
    .slice(0, 40)
    .join(" ");
const base = (o) => ({
  uid: null,
  summary: "",
  tags: "",
  bases: "any",
  engines: null,
  engine_min: null,
  engine_max: null,
  scope: "global",
  status: "accepted",
  version: 1,
  hash: null,
  code_hash: null,
  dir: null,
  preview: null,
  licence: null,
  bytes: 0,
  delivery: "ref",
  created: null,
  updated: null,
  body: "",
  ...o,
});
const usageText = (u) => (!u ? "" : typeof u === "string" ? u : [u.import, u.example].filter(Boolean).join("\n"));
function storeRows() {
  const ws = scanStore("ws"),
    seed = scanStore("seed"),
    mine = new Set(ws.recs.map((r) => r.entry.id));
  for (const e of [...ws.errors, ...seed.errors]) log("library: skipped", e.dir, e.error);
  return [...ws.recs, ...seed.recs.filter((r) => !mine.has(r.entry.id))].map(storeRow);
}
function storeRow(r) {
  const e = r.entry,
    idBase = e.id.split(".")[1];
  const bases = [...new Set([idBase, ...e.engines.map((x) => x.base)])].filter(Boolean);
  const mins = e.engines.map((x) => x.min).filter((x) => x != null),
    maxs = e.engines.map((x) => x.max).filter((x) => x != null);
  const vd = versionDir(r),
    bytes = e.files.reduce((s, f) => s + (f.bytes ?? 0), 0);
  const body = [
    e.kind,
    e.id.replace(/[.-]/g, " "),
    usageText(e.usage),
    e.doc?.when,
    e.doc?.avoid,
    ...(e.doc?.gotchas ?? []),
    e.problem?.symptom,
    e.problem?.cause,
    e.problem?.fix,
    e.problem?.detect,
    (e.exports ?? []).join(" "),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6e3);
  return base({
    id: e.id,
    uid: e.uid ?? null,
    kind: e.kind,
    source: r.origin,
    title: e.title,
    summary: clip$b(e.summary, 400),
    tags: tagsOf(e.tags),
    bases: bases.join(" "),
    engines: e.engines.length ? JSON.stringify(e.engines) : null,
    engine_min: mins.length ? Math.min(...mins) : null,
    engine_max: maxs.length ? Math.max(...maxs) : null,
    scope: e.scope,
    status: e.status,
    version: e.version,
    hash: vd && fs.existsSync(vd) ? hashDir(vd).slice(0, 20) : null,
    code_hash: entryCodeHash(r),
    dir: r.dir,
    preview: e.preview ?? (fs.existsSync(path.join(r.dir, "preview.jpg")) ? "preview.jpg" : null),
    licence: e.licence?.id ?? "own",
    bytes,
    delivery: e.delivery,
    created: e.created ?? null,
    updated: e.updated ?? null,
    body,
  });
}
const LP_KIND = { animation: "anim", texture: "texture", face: "texture" };
const SOURCES = [
  { name: "store", sources: ["seed", "ws"], sig: () => `${storeSig("seed")}|${storeSig("ws")}`, rows: storeRows },
  // low poly assets (templates/lowpoly/library + <ws>/assets/lowpoly), served at <project>/__lib/ (lowpoly and recon use them)
  {
    name: "lowpoly",
    sources: ["lowpoly"],
    sig: () => {
      const d = lowpolyDirs();
      return `${mt(path.join(d.seed, "index.json"))}|${mt(path.join(d.user, "index.json"))}`;
    },
    rows: () =>
      lowpolyIndex()
        .entries.filter((e) => typeof e?.id === "string")
        .map((e) =>
          base({
            id: `lp:${e.id}`,
            kind: LP_KIND[e.kind] ?? "model",
            source: "lowpoly",
            title: clip$b(e.name || e.id, 120),
            summary: clip$b(
              [
                e.kind,
                e.size_m ? `${e.size_m.map((v) => +(+v).toFixed(2)).join(" x ")} m` : "",
                e.animations?.length ? `${e.animations.length} clips` : "",
                e.pack,
                e.user ? "saved find" : "",
              ]
                .filter(Boolean)
                .join(", "),
              200,
            ),
            tags: tagsOf(e.tags),
            bases: "lowpoly recon",
            licence: e.licence ?? null,
            bytes: +e.bytes || 0,
            hash: e.hash ? String(e.hash).slice(-20) : null,
            created: e.added ?? null,
            body: [e.kind, e.pack, (e.animations || []).map((a) => a.name).join(" "), e.author].filter(Boolean).join(" "),
          }),
        ),
  },
  // sound effects: the built-in recordings + the member's own (<ws>/assets/sfx)
  {
    name: "sfx",
    sources: ["sfx"],
    sig: () => {
      const d = sfxDirs();
      return `${mt(path.join(d.builtin, "index.json"))}|${mt(path.join(d.user, "index.json"))}`;
    },
    rows: () => {
      const d = sfxDirs(),
        read = (f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(f, "index.json"), "utf8")).entries || [];
          } catch {
            return [];
          }
        };
      const mine = read(d.user).map((e) => ({ ...e, user: true })),
        ids = new Set(mine.map((e) => e.id));
      return [...mine, ...read(d.builtin).filter((e) => !ids.has(e.id))]
        .filter((e) => typeof e?.id === "string")
        .map((e) =>
          base({
            id: `sfx:${e.id}`,
            kind: "sound",
            source: "sfx",
            title: clip$b(e.name || e.id, 120),
            summary: clip$b(`${e.category} sound effect, ${(+e.duration || 0).toFixed(1)} s${e.user ? ", yours" : ""}`, 200),
            tags: tagsOf([e.category, ...(e.tags || [])]),
            bases: "any",
            licence: e.licence ?? null,
            created: e.added ? new Date(e.added).toISOString() : null,
            body: [e.category, e.author].filter(Boolean).join(" "),
          }),
        );
    },
  },
  // flat characters (<ws>/characters/<id>/character.json, ready ones) + Mo
  {
    name: "char",
    sources: ["char"],
    sig: () => {
      let s = "";
      try {
        for (const id of fs.readdirSync(charsRoot()).sort()) s += `${id}:${mt(path.join(charsRoot(), id, "character.json"))};`;
      } catch {}
      return s;
    },
    rows: () => {
      const out = [
        base({
          id: "char:mo",
          kind: "model",
          source: "char",
          title: "Mo",
          summary: "The Flat style's original character",
          tags: "character person flat mo",
          bases: "flat",
          dir: path.join(templatesDir(), "flat"),
        }),
      ];
      let ids = [];
      try {
        ids = fs.readdirSync(charsRoot());
      } catch {}
      for (const id of ids) {
        let m = null;
        try {
          m = JSON.parse(fs.readFileSync(path.join(charsRoot(), id, "character.json"), "utf8"));
        } catch {
          continue;
        }
        if (m?.id !== id || m.status !== "ready" || !/^[\w-]{1,64}$/.test(id)) continue;
        out.push(
          base({
            id: `char:${id}`,
            kind: "model",
            source: "char",
            title: clip$b(m.name || id, 120),
            summary: clip$b(m.about, 200),
            tags: "character person flat",
            bases: "flat",
            dir: path.join(charsRoot(), id),
            preview: fs.existsSync(path.join(charsRoot(), id, "thumb.png")) ? "thumb.png" : null,
            created: m.created ? new Date(m.created).toISOString() : null,
          }),
        );
      }
      return out;
    },
  },
  // stick-figure sprites (<ws>/stickman/sprites/index.json): one entry per character with its poses
  {
    name: "sprite",
    sources: ["sprite"],
    sig: () => mt(path.join(libRoot(), "index.json")),
    rows: () => {
      let idx = {};
      try {
        idx = JSON.parse(fs.readFileSync(path.join(libRoot(), "index.json"), "utf8"));
      } catch {
        return [];
      }
      return Object.entries(idx || {})
        .filter(([id, v]) => /^[\w.-]{1,100}$/.test(id) && v?.sprites)
        .map(([id, v]) => {
          const poses = Object.keys(v.sprites);
          return base({
            id: `sprite:${id}`,
            kind: "sprite",
            source: "sprite",
            title: clip$b(id.replace(/[_-]+/g, " "), 120),
            summary: clip$b(`${v.desc || v.kind || "stick figure"}: ${poses.length} pose${poses.length === 1 ? "" : "s"}`, 200),
            tags: tagsOf(["sprite", "stickman", ...poses.map((p) => p.split("-")[0])]),
            bases: "stickman",
            dir: path.join(libRoot(), id),
            body: poses.join(" "),
          });
        });
    },
  },
  // 3D reconstruction figures (<ws>/assets/models + credited downloads of recon projects)
  {
    name: "fig",
    sources: ["fig"],
    sig: () =>
      libraryFigures()
        .map((f) => `${f.id}:${mt(f.file)}`)
        .join(";"),
    rows: () =>
      libraryFigures(true)
        .filter((f) => /^[\w.-]{1,120}$/.test(f.id))
        .map((f) =>
          base({
            id: `fig:${f.id}`,
            kind: "model",
            source: "fig",
            title: clip$b(f.title, 120),
            summary: clip$b(
              `rigged person model, ${f.clips} clip${f.clips === 1 ? "" : "s"}${f.author ? `, by ${f.author}` : ""} (${f.from})`,
              200,
            ),
            tags: "person figure character rigged human",
            bases: "recon",
            licence: f.license,
            dir: path.dirname(f.file),
          }),
        ),
  },
  // pictures make_image made in the projects (each project's assets/images.json): one per picture (kind + aspect + full
  // prompt), so a later video asking for the same one gets a free copy (library/images.ts, claude/assets.ts)
  {
    name: "img",
    sources: ["img"],
    sig: imagesSig,
    rows: () => {
      const styles = new Map();
      const styleOf = (dir) => {
        if (!styles.has(dir)) {
          let s = "";
          try {
            s = String(JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^﻿/, "")).imageStyle || "");
          } catch {}
          styles.set(dir, s);
        }
        return styles.get(dir);
      };
      return imageEntries().map(({ key: key2, p, e }) => {
        const b = baseOf(p.style ?? "pixel-art"),
          nm = e.name.replace(/[_-]+/g, " ").trim(),
          subject = promptSubject(e.prompt, e.kind, styleOf(p.dir));
        return base({
          id: `img:${key2}`,
          kind: "image",
          source: "img",
          title: clip$b(nm || e.name, 120),
          summary: clip$b(`${e.kind || "picture"} (${e.aspect}) made for "${p.projectName}": ${subject}`, 200),
          tags: tagsOf([e.kind, "picture", ...nm.split(/\s+/)]),
          bases: [...new Set([b, p.style].filter((x) => !!x))].join(" "),
          hash: key2,
          dir: p.dir,
          preview: e.file,
          created: e.at || null,
          body: clip$b(subject, 1500),
        });
      });
    },
  },
];
const COLS = [
  "id",
  "uid",
  "kind",
  "source",
  "title",
  "summary",
  "tags",
  "bases",
  "engines",
  "engine_min",
  "engine_max",
  "scope",
  "status",
  "version",
  "hash",
  "code_hash",
  "dir",
  "preview",
  "licence",
  "bytes",
  "delivery",
  "body",
  "created",
  "updated",
  "indexed_at",
];
let lastRefresh = 0,
  building = false;
const changeListeners = new Set();
export const onLibraryChanged = (f) => {
  changeListeners.add(f);
  return () => changeListeners.delete(f);
};
export function rebuildIndex(force = false) {
  if (building) return { changed: [], rows: 0, ms: 0 };
  building = true;
  const t0 = Date.now();
  try {
    let all = force;
    if (!all && ftsOk) {
      const a = q.get("SELECT count(*) n FROM lib_entries").n,
        b = q.get("SELECT count(*) n FROM lib_fts").n;
      if (a !== b) all = true;
    }
    const todo = [];
    for (const s of SOURCES) {
      let sig = "error";
      try {
        sig = s.sig();
      } catch (e) {
        log("library: source fingerprint failed", s.name, e?.message);
      }
      const prev = q.get("SELECT value FROM kv WHERE key=?", `lib_sig:${s.name}`)?.value;
      if (!all && prev === sig) continue;
      let rows = [];
      try {
        rows = s.rows();
      } catch (e) {
        log("library: source failed", s.name, e?.message);
        continue;
      }
      todo.push({ s, sig, rows });
    }
    if (!todo.length) return { changed: [], rows: 0, ms: Date.now() - t0 };
    const at = now(),
      ins = `INSERT OR REPLACE INTO lib_entries(${COLS.join(",")}) VALUES(${COLS.map(() => "?").join(",")})`;
    let n = 0;
    tx(() => {
      for (const { s, sig, rows } of todo) {
        const mark = s.sources.map(() => "?").join(",");
        if (ftsOk) q.run(`DELETE FROM lib_fts WHERE id IN (SELECT id FROM lib_entries WHERE source IN (${mark}))`, ...s.sources);
        q.run(`DELETE FROM lib_entries WHERE source IN (${mark})`, ...s.sources);
        const seen = new Set();
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          const v = { ...r, indexed_at: at };
          if (ftsOk) q.run("DELETE FROM lib_fts WHERE id=?", r.id);
          q.run(ins, ...COLS.map((c) => v[c] ?? null));
          n++;
          if (ftsOk)
            q.run("INSERT INTO lib_fts(id, title, summary, tags, body) VALUES(?,?,?,?,?)", r.id, r.title, r.summary, r.tags, r.body);
        }
        q.run("INSERT OR REPLACE INTO kv(key, value) VALUES(?,?)", `lib_sig:${s.name}`, sig);
      }
      if (all && ftsOk) {
        q.run("DELETE FROM lib_fts WHERE id NOT IN (SELECT id FROM lib_entries)");
      }
      applyFlags();
    });
    const changed = todo.map((t) => t.s.name);
    log("library: indexed", changed.join(", "), n, "rows in", Date.now() - t0, "ms", ftsOk ? "(FTS5)" : "(LIKE)");
    for (const f of changeListeners) {
      try {
        f(changed);
      } catch {}
    }
    return { changed, rows: n, ms: Date.now() - t0 };
  } finally {
    building = false;
    lastRefresh = Date.now();
  }
}
export function refreshIndex(minGapMs = 4e3) {
  if (Date.now() - lastRefresh < minGapMs) return;
  try {
    rebuildIndex();
  } catch (e) {
    log("library: refresh failed", e?.message);
  }
}
export function startLibrary(after = Promise.resolve()) {
  try {
    openLibrary();
  } catch (e) {
    log("library: open failed", e?.message);
  }
  void after.then(() =>
    setTimeout(() => {
      try {
        rebuildIndex();
      } catch (e) {
        log("library: first index failed", e?.message);
      }
    }, 1500),
  );
}
export function applyFlags() {
  const last2 = new Map();
  for (const u of q.all("SELECT entry_id, outcome FROM lib_uses WHERE kind='outcome' ORDER BY n DESC")) {
    const l = last2.get(u.entry_id) ?? [];
    if (l.length < 5) l.push(u.outcome);
    last2.set(u.entry_id, l);
  }
  for (const [id, l] of last2)
    if (l.filter((o) => o === "failed").length >= 2) q.run("UPDATE lib_entries SET status='flagged' WHERE id=? AND status!='retired'", id);
}
