import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { templatesDir, ws } from "../core/workspace";
import { q } from "../db/db";
import { boardDir } from "../characters/boards";
import { charDir } from "../characters/characterLab";
import { lowpolyDirs, lowpolyIndex } from "../characters/lowpoly";
import { libraryFigureFile } from "../characters/libraryFigures";
import { animCatalog, animFile } from "../characters/anims";
import { char3dFile, chars3dIndex } from "../characters/chars3d";
import { LIB_ID_RX, isLibId } from "../library/schema";
import { seedRefDir } from "../library/store";
import { servedRefFile } from "./references";
import { entryImage, previewFile } from "../library/browse";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".md": "text/markdown; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".ogv": "video/ogg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".pdf": "application/pdf",
};
let server = null;
let port = 0;
const dirCache = new Map();
const hidden = new Map();
export function registerHiddenProject(id, dir) {
  hidden.set(id, { dir, misses: [] });
}
export function unregisterHiddenProject(id) {
  const h = hidden.get(id);
  if (h) realCache.delete(h.dir);
  hidden.delete(id);
}
export const hiddenMisses = (id) => hidden.get(id)?.misses.slice() ?? [];
export function projectDir(id) {
  const hp = hidden.get(id);
  if (hp) return hp.dir;
  if (dirCache.has(id)) return dirCache.get(id);
  const row = q.get("SELECT path FROM projects WHERE id=?", id);
  if (row) dirCache.set(id, row.path);
  return row?.path ?? null;
}
export const forgetProject = (id) => dirCache.delete(id);
export const serverUrl = () => `http://127.0.0.1:${port}`;
export const projectUrl = (id, rel = "") => `${serverUrl()}/p/${id}/${rel}`;
export const mediaUrl = (projectId, mediaId) => `${serverUrl()}/m/${projectId}/${mediaId}`;
const realCache = new Map();
const realRoot = (root) => {
  let r = realCache.get(root);
  if (!r) {
    r = fs.realpathSync.native(root);
    realCache.set(root, r);
  }
  return r;
};
function inside(root, rel) {
  const f = path.resolve(root, rel);
  if (f !== root && !f.startsWith(root + path.sep)) return null;
  try {
    const rf = fs.realpathSync.native(f),
      rr = realRoot(root),
      low = (x) => (process.platform === "win32" ? x.toLowerCase() : x);
    return low(rf) === low(rr) || low(rf).startsWith(low(rr) + path.sep) ? rf : null;
  } catch {
    return f;
  }
}
const open = new Set();
export function closeStreamsUnder(dir) {
  const low = (x) => (process.platform === "win32" ? x.toLowerCase() : x),
    d = low(path.resolve(dir) + path.sep);
  for (const o of [...open])
    if (low(o.f).startsWith(d)) {
      o.res.destroy();
      open.delete(o);
    }
}
function sendFile(req, res, f) {
  let st;
  try {
    st = fs.statSync(f);
  } catch {
    res.writeHead(404);
    return res.end();
  }
  if (st.isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  const type = MIME[path.extname(f).toLowerCase()] || "application/octet-stream";
  const stream = (opts) => {
    const rs = fs.createReadStream(f, opts).on("error", () => res.destroy());
    const o = { f, res };
    open.add(o);
    res.on("close", () => {
      rs.destroy();
      open.delete(o);
    });
    rs.pipe(res);
  };
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());
  if (range && (range[1] || range[2]) && st.size > 0) {
    const start = range[1] ? +range[1] : Math.max(0, st.size - +range[2]),
      end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${st.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    return stream({ start, end });
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
  stream();
}
function sendAnims(req, res, rel) {
  if (rel === "catalog.json") {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    return res.end(JSON.stringify(animCatalog()));
  }
  const f = animFile(rel);
  if (!f) {
    res.writeHead(404);
    return res.end();
  }
  return sendFile(req, res, f);
}
function sendChars3d(req, res, rel) {
  if (rel === "index.json") {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    return res.end(JSON.stringify(chars3dIndex()));
  }
  const f = char3dFile(rel);
  if (!f) {
    res.writeHead(404);
    return res.end();
  }
  return sendFile(req, res, f);
}
function readBody(req) {
  return new Promise((res, rej) => {
    const c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => res(Buffer.concat(c)));
    req.on("error", rej);
  });
}
export function startServer() {
  if (server) return Promise.resolve(serverUrl());
  server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || "").replace(/:\d+$/, "");
      if (host !== "127.0.0.1" && host !== "localhost") {
        res.writeHead(403);
        return res.end();
      }
      const url = new URL(req.url || "/", "http://x");
      const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
      if (parts[0] === "health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end('{"ok":true}');
      }
      if (parts[0] === "m" && parts[1] && parts[2]) {
        const dir22 = projectDir(parts[1]);
        if (!dir22) {
          res.writeHead(404);
          return res.end();
        }
        let list = [];
        try {
          list = JSON.parse(fs.readFileSync(path.join(dir22, "media.json"), "utf8")).media ?? [];
        } catch {}
        const m = list.find((x) => x.id === parts[2]);
        if (!m?.file) {
          res.writeHead(404);
          return res.end();
        }
        return sendFile(req, res, m.file);
      }
      if (parts[0] === "r") {
        const origin = req.headers.origin;
        if (origin && origin !== "null" && !/^file:\/\//.test(origin) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
          res.writeHead(403);
          return res.end();
        }
        const f2 = parts.length >= 3 && parts.length <= 4 ? servedRefFile(parts[1], parts[2]) : null;
        if (!f2) {
          res.writeHead(404);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (parts[0] === "b" && parts[1] && parts[2]) {
        const f2 = inside(boardDir(parts[1]), parts.slice(2).join("/"));
        if (!f2) {
          res.writeHead(403);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (parts[0] === "ch" && parts[1] && /^avatar\.(png|jpe?g|webp)$/.test(parts[2] || "")) {
        const f2 = inside(path.join(ws.root(), "channels", parts[1].replace(/[^\w-]/g, "")), parts[2]);
        if (!f2) {
          res.writeHead(403);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (
        parts[0] === "yt" &&
        parts[1] &&
        (/^avatar\.jpg$/.test(parts[2] || "") || (parts[2] === "v" && /^[\w-]+\.jpg$/.test(parts[3] || "") && parts.length === 4))
      ) {
        const f2 = inside(path.join(ws.root(), "youtube", parts[1].replace(/[^\w-]/g, "")), parts.slice(2).join("/"));
        if (!f2 || !fs.existsSync(f2)) {
          res.writeHead(404);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (parts[0] === "s" && parts[1] === "looks" && /^look-[a-z0-9-]{1,40}\.jpg$/.test(parts[2] || "") && parts.length === 3) {
        const f2 = inside(path.join(ws.root(), "styles", "looks"), parts[2]);
        if (!f2 || !fs.existsSync(f2)) {
          res.writeHead(404);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (parts[0] === "s" && parts[1] && /^(preview\.(mp4|jpg)|poster\.jpg)$/.test(parts[2] || "") && parts.length === 3) {
        const f2 = inside(path.join(ws.root(), "styles", parts[1].replace(/[^\w-]/g, "")), parts[2]);
        if (!f2 || !fs.existsSync(f2)) {
          res.writeHead(404);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (parts[0] === "c" && parts[1] && parts[2]) {
        const dir22 = charDir(parts[1]),
          rel = parts.slice(2).join("/"),
          flat = path.join(templatesDir(), "flat");
        if (!dir22) {
          res.writeHead(404);
          return res.end();
        }
        const own = rel === "character.js" || rel === "thumb.png";
        if (!own && !/^(charview\.(html|js)|engine\.js|models\.js|vendor\/[\w.-]+|fonts\/[\w.-]+)$/.test(rel)) {
          res.writeHead(404);
          return res.end();
        }
        const f2 = inside(own ? dir22 : flat, rel);
        if (!f2) {
          res.writeHead(403);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (parts[0] === "fv" && parts[1]) {
        const rel = parts.slice(1).join("/"),
          recon = path.join(templatesDir(), "recon");
        if (parts[1] === "__lib") {
          const r = parts.slice(2).join("/");
          if (r.includes("..") || !/^(characters|animations)\/[\w./-]+\.glb$|^tools\/anim-runtime\.js$/.test(r)) {
            res.writeHead(404);
            return res.end();
          }
          for (const root of [lowpolyDirs().user, lowpolyDirs().seed]) {
            const f3 = inside(root, r);
            if (f3 && fs.existsSync(f3)) return sendFile(req, res, f3);
          }
          res.writeHead(404);
          return res.end();
        }
        if (parts[1] === "__anims") return sendAnims(req, res, parts.slice(2).join("/"));
        if (parts[1] === "__chars3d") return sendChars3d(req, res, parts.slice(2).join("/"));
        if (parts[1] === "libmodel" && parts.length === 3) {
          const f3 = libraryFigureFile(parts[2]);
          if (!f3) {
            res.writeHead(404);
            return res.end();
          }
          return sendFile(req, res, f3);
        }
        if (
          rel.includes("..") ||
          !/^(charview\.(html|js)|engine\.js|models\.js|lib\/[\w-]+\.js|vendor\/[\w./-]+\.js|fonts\/[\w.-]+\.woff2|assets\/figures\/[\w.-]+\.glb)$/.test(
            rel,
          )
        ) {
          res.writeHead(404);
          return res.end();
        }
        const f2 = inside(recon, rel);
        if (!f2) {
          res.writeHead(403);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (parts[0] === "lib" && parts[1] && isLibId(parts[1])) {
        const f2 =
          parts[2] === "preview" && parts.length === 3
            ? previewFile(parts[1])
            : parts[2] === "file" && parts.length > 3 && !parts.slice(3).some((x) => x === ".." || x === ".")
              ? entryImage(parts[1], parts.slice(3).join("/"))
              : null;
        if (!f2) {
          res.writeHead(404);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (parts[0] !== "p" || !parts[1]) {
        res.writeHead(404);
        return res.end();
      }
      const dir = projectDir(parts[1]);
      if (!dir) {
        res.writeHead(404);
        return res.end("unknown project");
      }
      const rest = parts.slice(2);
      const hp = hidden.get(parts[1]);
      if (hp && req.method === "GET")
        res.on("finish", () => {
          if (res.statusCode >= 400 && hp.misses.length < 200) hp.misses.push({ rel: rest.join("/"), status: res.statusCode });
        });
      if (rest[0] === "__lib") {
        const rel = rest.slice(1).join("/");
        if (rel === "index.json") {
          res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
          return res.end(JSON.stringify(lowpolyIndex()));
        }
        if (
          !/^(characters|animations|animals|props|sets|textures|vehicles|previews|faces)\/[\w./ -]+\.(glb|webp|png|jpg)$|^tools\/anim-runtime\.js$|^CREDITS\.json$/.test(
            rel,
          )
        ) {
          res.writeHead(404);
          return res.end();
        }
        for (const root of [lowpolyDirs().user, lowpolyDirs().seed]) {
          const f2 = inside(root, rel);
          if (f2 && fs.existsSync(f2)) return sendFile(req, res, f2);
        }
        res.writeHead(404);
        return res.end();
      }
      if (rest[0] === "__anims") return sendAnims(req, res, rest.slice(1).join("/"));
      if (rest[0] === "__chars3d") return sendChars3d(req, res, rest.slice(1).join("/"));
      if (rest[0] === "__library") {
        const id = rest[1] || "",
          v = rest[2] || "",
          rel = rest.slice(3).join("/");
        if (!LIB_ID_RX.test(id) || !/^v\d{1,4}$/.test(v) || !rel || rest.slice(3).some((x) => x === ".." || x === ".")) {
          res.writeHead(404);
          return res.end();
        }
        const d = seedRefDir(id);
        if (!d) {
          res.writeHead(404);
          return res.end();
        }
        const f2 = inside(path.join(d, v), rel);
        if (!f2 || !fs.existsSync(f2)) {
          res.writeHead(404);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      if (rest[0] === "__suite") {
        if (req.method === "POST") {
          const body = await readBody(req);
          if (rest[1] === "frame" && rest[2] && rest[3]) {
            const d = path.join(dir, ".suite", "frames", rest[2].replace(/[^\w-]/g, ""));
            fs.mkdirSync(d, { recursive: true });
            fs.writeFileSync(path.join(d, String(+rest[3]).padStart(6, "0") + ".png"), body);
          } else if (rest[1] === "append" && rest[2]) {
            const f3 = path.join(dir, "out", rest[2].replace(/[^\w-]/g, "") + ".h264");
            fs.mkdirSync(path.dirname(f3), { recursive: true });
            if (url.searchParams.get("reset")) fs.writeFileSync(f3, body);
            else fs.appendFileSync(f3, body);
          } else {
            res.writeHead(404);
            return res.end();
          }
          res.writeHead(204);
          return res.end();
        }
        const f2 = inside(path.join(templatesDir(), "host"), rest.slice(1).join("/"));
        if (!f2) {
          res.writeHead(403);
          return res.end();
        }
        return sendFile(req, res, f2);
      }
      const f = inside(dir, rest.join("/") || "index.html");
      if (!f) {
        res.writeHead(403);
        return res.end();
      }
      return sendFile(req, res, f);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(e?.message || e));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      resolve(serverUrl());
    });
  });
}
export function stopServer() {
  server?.close();
  server = null;
}
