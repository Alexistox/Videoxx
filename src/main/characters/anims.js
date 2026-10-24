import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { BrowserWindow } from "electron";
import { templatesDir, ws } from "../core/workspace";
import { log } from "../core/log";
import { serverUrl } from "../projects/fileServer";

export const ANIM_EXT = /\.(fbx|glb|gltf)$/i;
const MAX_BYTES = 15e7;
export const animDirs = () => {
  const user = path.join(ws.root(), "assets", "animations");
  return {
    user,
    inbox: path.join(user, "inbox"),
    failed: path.join(user, "inbox", "failed"),
    sources: path.join(user, "sources"),
    catalog: path.join(user, "catalog.json"),
    builtin: path.join(templatesDir(), "recon", "assets", "anims", "builtin.json"),
  };
};
const readJson$g = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
function userAnims() {
  const j = readJson$g(animDirs().catalog);
  return Array.isArray(j?.entries) ? j.entries.filter((e) => e?.name && e?.file) : [];
}
function writeUser(entries) {
  const d = animDirs();
  fs.mkdirSync(d.user, { recursive: true });
  const tmp = d.catalog + ".tmp";
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        version: 1,
        about:
          "Your own character animations (Settings > Media > Character animations). Converted by Videoxx; clips from Mixamo stay on this computer.",
        entries,
      },
      null,
      1,
    ) + "\n",
  );
  fs.renameSync(tmp, d.catalog);
}
let bcache = null;
function builtinAnims() {
  const f = animDirs().builtin;
  let key2 = "";
  try {
    key2 = f + fs.statSync(f).mtimeMs;
  } catch {
    return [];
  }
  if (bcache?.key !== key2) bcache = { key: key2, list: readJson$g(f)?.entries ?? [] };
  return bcache.list;
}
export function animCatalog() {
  return { version: 1, builtin: builtinAnims(), user: userAnims() };
}
export function animFile(rel) {
  if (!/^[\w.-]+\.glb$/.test(rel) || rel.includes("..")) return null;
  if (!userAnims().some((e) => e.file === rel)) return null;
  const f = path.join(animDirs().user, rel);
  return fs.existsSync(f) ? f : null;
}
export function listAnims() {
  startAnimWatch();
  const d = animDirs(),
    user = userAnims()
      .slice()
      .sort((a, b) => String(b.added).localeCompare(String(a.added)) || a.name.localeCompare(b.name));
  return { dir: d.user, inbox: d.inbox, builtin: builtinAnims().length, user };
}
let onChange = () => {},
  onProgress = () => {};
export function onAnims(h) {
  if (h.changed) onChange = h.changed;
  if (h.progress) onProgress = h.progress;
}
let conv = null,
  idleT = null;
async function converter() {
  if (idleT) {
    clearTimeout(idleT);
    idleT = null;
  }
  if (conv && !conv.win.isDestroyed()) {
    await conv.ready;
    return conv.win;
  }
  const win = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  const ready = (async () => {
    await win.loadURL(`${serverUrl()}/fv/lib/anims.js`);
    const ok = await win.webContents.executeJavaScript(`import('/fv/lib/anims.js').then(m => { window.__czAnims = m; return true; })`);
    if (!ok) throw new Error("the animation converter did not start");
  })();
  conv = { win, ready };
  win.on("closed", () => {
    if (conv?.win === win) conv = null;
  });
  try {
    await ready;
  } catch (e) {
    if (!win.isDestroyed()) win.destroy();
    conv = null;
    throw e;
  }
  return win;
}
function releaseConverter() {
  if (idleT) clearTimeout(idleT);
  idleT = setTimeout(() => {
    idleT = null;
    if (conv && !conv.win.isDestroyed()) conv.win.destroy();
    conv = null;
  }, 3e4);
}
async function convertOne(file) {
  const win = await converter(),
    b64 = fs.readFileSync(file).toString("base64");
  const code = `(async () => { try {
    const buf = await (await fetch('data:application/octet-stream;base64,' + ${JSON.stringify(b64)})).arrayBuffer();
    const out = await window.__czAnims.convertAnimFile(buf, ${JSON.stringify(path.basename(file))});
    const b64 = g => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(new Blob([g])); });
    return { ok: true, clips: await Promise.all(out.map(async o => ({ name: o.name, info: o.info, glb: await b64(o.glb) }))) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`;
  const r = await Promise.race([
    win.webContents.executeJavaScript(code),
    new Promise((_, rej) => setTimeout(() => rej(new Error("The converter stopped responding.")), 18e4)),
  ]);
  if (!r?.ok) throw new Error(r?.error || "conversion failed");
  return r.clips.map((c) => ({ name: c.name, info: c.info, glb: Buffer.from(c.glb, "base64") }));
}
const slugOf = (n) =>
  n
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "clip";
const cleanName = (n) =>
  n
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Clip";
function uniquePath(dir, base) {
  let f = path.join(dir, base);
  const ext = path.extname(base),
    stem = base.slice(0, base.length - ext.length);
  for (let i = 2; fs.existsSync(f); i++) f = path.join(dir, `${stem} ${i}${ext}`);
  return f;
}
function moveTo(file, dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(file, uniquePath(dir, path.basename(file)));
    return true;
  } catch (e) {
    log("anims: could not move", file, e?.message);
    return false;
  }
}
let chain = Promise.resolve();
export function importAnims(files, o = {}) {
  const job = chain.then(() => doImport(files, o));
  chain = job.catch(() => {});
  return job;
}
async function doImport(files, o) {
  const d = animDirs();
  fs.mkdirSync(d.user, { recursive: true });
  const imported = [],
    skipped = [],
    failed = [];
  const list = [...new Set((files || []).map((f) => path.resolve(String(f))))];
  let entries = userAnims();
  const t0 = Date.now();
  try {
    for (const [i, file] of list.entries()) {
      onProgress({ done: i, total: list.length, file: path.basename(file) });
      try {
        if (!ANIM_EXT.test(file)) throw new Error("Not an FBX, GLB or GLTF file.");
        const st = fs.statSync(file);
        if (!st.isFile()) throw new Error("Not a file.");
        if (st.size > MAX_BYTES) throw new Error("The file is too big (over 150 MB).");
        const hash = crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
        const dup = entries.find((e) => e.hash === hash);
        if (dup) {
          skipped.push({ file, reason: `already in your library as "${dup.name}"` });
          if (o.fromInbox) moveTo(file, d.sources);
          continue;
        }
        const clips = await convertOne(file);
        const taken = new Set([...entries.map((e) => e.name.toLowerCase()), ...builtinAnims().map((e) => String(e.name).toLowerCase())]);
        const files2 = new Set(entries.map((e) => e.file));
        for (const c of clips) {
          let name = cleanName(c.name);
          for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${cleanName(c.name)} ${k}`;
          let id = slugOf(name),
            fileName = id + ".glb";
          for (let k = 2; files2.has(fileName) || fs.existsSync(path.join(d.user, fileName)); k++) fileName = `${id}-${k}.glb`;
          id = fileName.replace(/\.glb$/, "");
          fs.writeFileSync(path.join(d.user, fileName), c.glb);
          const inf = c.info || {};
          const e = {
            name,
            id,
            file: fileName,
            kind: "user",
            source: inf.source || "fbx",
            tags: inf.tags || [],
            loop: !!inf.loop,
            inPlace: inf.inPlace !== false,
            travel: inf.travel || 0,
            duration: inf.duration || 0,
            fps: inf.fps || 30,
            hands: inf.hands || "none",
            suits: `${name.toLowerCase()}${inf.loop ? " (loops)" : ""}${inf.inPlace === false ? `, travels about ${inf.travel} m/s (walkAt moves the figure)` : ""}`,
            from: path.basename(file),
            hash,
            added: new Date().toISOString(),
            bones: inf.bones,
            mapped: inf.mapped,
            loopError: inf.loopError,
          };
          entries.push(e);
          imported.push(e);
          taken.add(name.toLowerCase());
          files2.add(fileName);
        }
        writeUser(entries);
        if (o.fromInbox) moveTo(file, d.sources);
      } catch (e) {
        const msg = String(e?.message || e).split("\n")[0];
        failed.push({ file, error: msg });
        log("anims: import failed", file, msg);
        if (o.fromInbox && fs.existsSync(file) && moveTo(file, d.failed))
          try {
            fs.writeFileSync(uniquePath(d.failed, path.basename(file) + ".txt"), msg + "\n");
          } catch {}
      }
    }
  } finally {
    onProgress({ done: list.length, total: list.length, file: "" });
    releaseConverter();
    if (imported.length) onChange();
  }
  log(`anims: ${imported.length} clip(s) imported, ${skipped.length} skipped, ${failed.length} failed in ${Date.now() - t0} ms`);
  return { imported, skipped, failed, ms: Date.now() - t0 };
}
export function removeAnim(id) {
  const entries = userAnims(),
    e = entries.find((x) => x.id === id || x.name === id);
  if (!e) throw new Error("That animation is not in your library.");
  const f = path.join(animDirs().user, e.file);
  writeUser(entries.filter((x) => x !== e));
  if (!entries.some((x) => x !== e && x.file === e.file))
    try {
      fs.unlinkSync(f);
    } catch {}
  onChange();
  return { removed: e.name };
}
let watcher = null,
  watched = "",
  pending = null,
  scanning = false;
const sizeOf = (f) => {
  try {
    return fs.statSync(f).size;
  } catch {
    return -1;
  }
};
export function startAnimWatch() {
  let inbox = "";
  try {
    inbox = animDirs().inbox;
  } catch {
    return;
  }
  if (watcher && watched === inbox && fs.existsSync(inbox)) return;
  watcher?.close();
  watcher = null;
  try {
    fs.mkdirSync(inbox, { recursive: true });
    watcher = fs.watch(inbox, () => scheduleScan());
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
    watched = inbox;
  } catch (e) {
    log("anims: inbox watch failed", e?.message);
    return;
  }
  scheduleScan();
}
function scheduleScan(ms = 1200) {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    scanInbox().catch((e) => log("anims: inbox scan failed", e?.message));
  }, ms);
}
async function scanInbox() {
  if (scanning) {
    scheduleScan();
    return;
  }
  scanning = true;
  try {
    const inbox = watched;
    if (!inbox || !fs.existsSync(inbox)) return;
    const files = fs
      .readdirSync(inbox)
      .filter((f) => ANIM_EXT.test(f))
      .map((f) => path.join(inbox, f))
      .filter((f) => {
        try {
          return fs.statSync(f).isFile();
        } catch {
          return false;
        }
      });
    if (!files.length) return;
    const s0 = files.map(sizeOf);
    await new Promise((r) => setTimeout(r, 800));
    const ready = files.filter((f, i) => s0[i] > 0 && sizeOf(f) === s0[i]);
    if (ready.length) await importAnims(ready, { fromInbox: true });
    if (ready.length < files.length) scheduleScan(2e3);
  } finally {
    scanning = false;
  }
}
