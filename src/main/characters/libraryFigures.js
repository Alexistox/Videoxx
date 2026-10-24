import path from "node:path";
import fs from "node:fs";
import { ws } from "../core/workspace";
import { q } from "../db/db";

const MAX = 4e7;
function glbPerson(f) {
  try {
    const st = fs.statSync(f);
    if (!st.isFile() || st.size > MAX || st.size < 64) return { ok: false, clips: 0 };
    const fd = fs.openSync(f, "r");
    const head = Buffer.alloc(20);
    fs.readSync(fd, head, 0, 20, 0);
    if (head.readUInt32LE(0) !== 1179937895 || head.readUInt32LE(16) !== 1313821514) {
      fs.closeSync(fd);
      return { ok: false, clips: 0 };
    }
    const n = head.readUInt32LE(12);
    if (n > 8e6) {
      fs.closeSync(fd);
      return { ok: false, clips: 0 };
    }
    const js2 = Buffer.alloc(n);
    fs.readSync(fd, js2, 0, n, 20);
    fs.closeSync(fd);
    const j = JSON.parse(js2.toString("utf8")),
      names = (j.nodes || []).map((x) => String(x.name || ""));
    const has = (re) => names.some((s) => re.test(s));
    const ok =
      (j.skins?.length ?? 0) > 0 && has(/hip|pelvis/i) && has(/head/i) && has(/arm|shoulder|clavicle/i) && has(/leg|thigh|knee|calf/i);
    return { ok, clips: (j.animations || []).length };
  } catch {
    return { ok: false, clips: 0 };
  }
}
const credits = (dir) => {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, "CREDITS.json"), "utf8"));
    return Array.isArray(c) ? c : [];
  } catch {
    return [];
  }
};
let cache = null;
export function libraryFigures(fresh = false) {
  if (!fresh && cache && Date.now() - cache.t < 2e4) return cache.list;
  const out = [],
    seen = new Set();
  const add = (file, c, from) => {
    const id = path.basename(file).replace(/[^\w.-]/g, "_");
    if (seen.has(id) || !/\.glb$/i.test(id)) return;
    const g = glbPerson(file);
    if (!g.ok) return;
    seen.add(id);
    out.push({
      id,
      file,
      title: String(c?.title || id.replace(/\.glb$/i, "")),
      author: c?.author ?? null,
      license: c?.license ?? null,
      url: c?.source_url ?? c?.url ?? null,
      from,
      clips: g.clips,
    });
  };
  const lib = path.join(ws.root(), "assets", "models");
  const walk = (d, depth) => {
    let es = [];
    try {
      es = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    const cr = credits(d);
    for (const e of es) {
      const f = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) walk(f, depth + 1);
      else if (e.isFile() && /\.glb$/i.test(e.name))
        add(
          f,
          cr.find((c) => c.file === e.name || path.basename(String(c.file || "")) === e.name),
          "Your model library",
        );
    }
  };
  walk(lib, 0);
  for (const p of q.all("SELECT path, name, style_id FROM projects")) {
    if (!/recon/.test(String(p.style_id))) continue;
    const d = path.join(p.path, "assets", "models");
    for (const c of credits(d)) if (typeof c?.file === "string" && /\.glb$/i.test(c.file)) add(path.join(d, c.file), c, `From "${p.name}"`);
  }
  cache = { t: Date.now(), list: out };
  return out;
}
export const libraryFigureFile = (id) => libraryFigures().find((x) => x.id === id)?.file ?? null;
export function useLibraryFigure(dir, id) {
  const m = libraryFigures().find((x) => x.id === id);
  if (!m) throw new Error("That model is no longer in your library.");
  const d = path.join(dir, "assets", "models");
  fs.mkdirSync(d, { recursive: true });
  const dst = path.join(d, m.id);
  if (path.resolve(m.file) !== path.resolve(dst)) fs.copyFileSync(m.file, dst);
  const cr = credits(d).filter((c) => c.file !== m.id);
  cr.push({
    file: m.id,
    title: m.title,
    author: m.author ?? "unknown",
    license: m.license ?? "unknown",
    source_url: m.url ?? "",
    notes: "a character picked in Look > Characters",
  });
  fs.writeFileSync(path.join(d, "CREDITS.json"), JSON.stringify(cr, null, 1));
  return { model: `assets/models/${m.id}`, credit: [m.title, m.author, m.license].filter(Boolean).join(" - ") };
}
