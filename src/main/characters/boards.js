import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { shell } from "electron";
import { ws } from "../core/workspace";
import { now, q, uid } from "../db/db";
import { probe } from "../pipeline/ffmpeg";
import { serverUrl } from "../projects/fileServer";

export const brandOf = (b) => (b === "faceless" ? "faceless" : "personal");
export const boardDir = (id) => path.join(ws.root(), "thumbnails", id.replace(/[^\w-]/g, ""));
export const boardUrl = (id, file) => `${serverUrl()}/b/${id}/${encodeURIComponent(file)}`;
const EMPTY = () => ({ v: 1, nodes: [], edges: [], view: { x: 0, y: 0, z: 1 }, mode: "canvas" });
const IMG = /\.(png|jpe?g|webp|gif)$/i;
export function getBoard(id) {
  const b = q.get("SELECT * FROM boards WHERE id=?", id);
  if (!b) throw new Error("That board no longer exists.");
  let data;
  try {
    data = JSON.parse(b.data);
  } catch {
    data = EMPTY();
  }
  const gens = q
    .all("SELECT * FROM generations WHERE board_id=? ORDER BY created_at", id)
    .map((g) => ({ ...g, url: g.file ? boardUrl(id, g.file) : null }));
  return {
    id: b.id,
    name: b.name,
    created_at: b.created_at,
    updated_at: b.updated_at,
    projectId: b.project_id ?? null,
    pinned: !!b.pinned,
    brand: brandOf(b.brand),
    data,
    gens,
    base: `${serverUrl()}/b/${id}/`,
    orphans: orphans(id, data, gens),
  };
}
function ensureMaster(brand) {
  if (q.get("SELECT id FROM boards WHERE pinned=1 AND brand=?", brand)) return;
  const oldest = q.get("SELECT * FROM boards WHERE project_id IS NULL AND brand=? ORDER BY created_at LIMIT 1", brand);
  if (oldest) {
    q.run(
      "UPDATE boards SET pinned=1, name=CASE WHEN name IN ('My thumbnails','Board 1') THEN 'Master' ELSE name END WHERE id=?",
      oldest.id,
    );
    return;
  }
  const id = uid("brd_"),
    t = now();
  q.run(
    "INSERT INTO boards(id,name,data,created_at,updated_at,pinned,brand) VALUES(?,?,?,?,?,1,?)",
    id,
    "Master",
    JSON.stringify(EMPTY()),
    t,
    t,
    brand,
  );
  fs.mkdirSync(boardDir(id), { recursive: true });
}
export function boardForProject(projectId, name, brand) {
  const b = q.get("SELECT * FROM boards WHERE project_id=? ORDER BY created_at LIMIT 1", projectId);
  if (b) return getBoard(b.id);
  const id = uid("brd_"),
    t = now();
  q.run(
    "INSERT INTO boards(id,name,data,created_at,updated_at,project_id,brand) VALUES(?,?,?,?,?,?,?)",
    id,
    String(name || "Video").slice(0, 120),
    JSON.stringify(EMPTY()),
    t,
    t,
    projectId,
    brand,
  );
  fs.mkdirSync(boardDir(id), { recursive: true });
  return getBoard(id);
}
function orphans(id, data, gens) {
  const d = boardDir(id);
  if (!fs.existsSync(d)) return [];
  const used = new Set(Array.isArray(data?.dismissed) ? data.dismissed : []);
  for (const n of data?.nodes ?? []) {
    if (n.file) used.add(n.file);
    if (n.genId) {
      const g = gens.find((x) => x.id === n.genId);
      if (g?.file) used.add(g.file);
    }
  }
  return fs
    .readdirSync(d)
    .filter((f) => IMG.test(f) && !used.has(f))
    .map((f) => ({ file: f, generated: gens.some((g) => g.file === f), at: fs.statSync(path.join(d, f)).mtimeMs }))
    .sort((a, b) => a.at - b.at);
}
export function listBoards(brand) {
  ensureMaster(brand);
  return q.all("SELECT * FROM boards WHERE brand=? ORDER BY pinned DESC, updated_at DESC", brand).map((b) => {
    let nodes = [];
    try {
      nodes = JSON.parse(b.data).nodes ?? [];
    } catch {}
    const last2 = q.get("SELECT file FROM generations WHERE board_id=? AND status='completed' ORDER BY finished_at DESC LIMIT 1", b.id);
    const img = last2?.file ?? nodes.find((n) => n.type === "image" && n.file)?.file ?? null;
    return {
      id: b.id,
      name: b.name,
      updated_at: b.updated_at,
      nodes: nodes.length,
      cover: img ? boardUrl(b.id, img) : null,
      projectId: b.project_id ?? null,
      pinned: !!b.pinned,
      brand: brandOf(b.brand),
    };
  });
}
export function createBoard(name, brand) {
  const id = uid("brd_"),
    t = now(),
    n = q.get("SELECT COUNT(*) AS n FROM boards WHERE brand=?", brand).n;
  q.run(
    "INSERT INTO boards(id,name,data,created_at,updated_at,brand) VALUES(?,?,?,?,?,?)",
    id,
    (name || "").trim() || `Board ${n + 1}`,
    JSON.stringify(EMPTY()),
    t,
    t,
    brand,
  );
  fs.mkdirSync(boardDir(id), { recursive: true });
  return getBoard(id);
}
export function saveBoard(id, data) {
  const s = JSON.stringify(data ?? {});
  if (s.length > 4 * 1024 * 1024) throw new Error("This board is too large to save (over 4 MB of layout).");
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error("Not a board.");
  q.run("UPDATE boards SET data=?, updated_at=? WHERE id=?", s, now(), id);
  return { ok: true };
}
export function renameBoard(id, name) {
  q.run("UPDATE boards SET name=?, updated_at=? WHERE id=?", String(name).trim().slice(0, 120) || "Board", now(), id);
  return getBoard(id);
}
export async function deleteBoard(id) {
  if (q.get("SELECT id FROM boards WHERE id=? AND pinned=1", id))
    throw new Error("The Master board stays. Remove what you do not need from it instead.");
  const d = boardDir(id);
  q.run("DELETE FROM generations WHERE board_id=?", id);
  q.run("DELETE FROM boards WHERE id=?", id);
  if (fs.existsSync(d)) await shell.trashItem(d).catch(() => fs.rmSync(d, { recursive: true, force: true }));
}
export function boardFile(id, file) {
  const d = boardDir(id),
    f = path.resolve(d, String(file));
  if (!f.startsWith(d + path.sep) || !IMG.test(f)) throw new Error("Not an image on this board.");
  if (!fs.existsSync(f)) throw new Error("That image is missing from the board folder.");
  return f;
}
export async function imageDims(f) {
  return dims(f);
}
async function dims(f) {
  try {
    const p = await probe(f);
    if (p.width) return { w: p.width, h: p.height };
  } catch {}
  return { w: 0, h: 0 };
}
export async function addImage(id, src) {
  let buf, ext;
  if (src.startsWith("data:image/")) {
    const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.*)$/s.exec(src);
    if (!m) throw new Error("Paste a PNG, JPEG, WebP or GIF image.");
    buf = Buffer.from(m[2], "base64");
    ext = m[1] === "jpeg" ? ".jpg" : "." + m[1];
  } else {
    if (!IMG.test(src)) throw new Error(`${path.basename(src)}: use PNG, JPEG, WebP or GIF images.`);
    const st = fs.statSync(src);
    if (st.size > 40 * 1024 * 1024) throw new Error(`${path.basename(src)} is over 40 MB.`);
    buf = fs.readFileSync(src);
    ext = path.extname(src).toLowerCase().replace(".jpeg", ".jpg");
  }
  const d = boardDir(id);
  fs.mkdirSync(d, { recursive: true });
  const file = `img-${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16)}${ext}`,
    f = path.join(d, file);
  if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
  return { file, url: boardUrl(id, file), name: src.startsWith("data:") ? "Pasted image" : path.basename(src), ...(await dims(f)) };
}
export function revealImage(id, file) {
  shell.showItemInFolder(boardFile(id, file));
}
