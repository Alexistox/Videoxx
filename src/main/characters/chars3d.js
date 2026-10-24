import path from "node:path";
import fs from "node:fs";
import { BrowserWindow } from "electron";
import { ws } from "../core/workspace";
import { log } from "../core/log";
import { serverUrl } from "../projects/fileServer";

const CHAR_EXT = /\.(fbx|glb|gltf|vrm)$/i;
const CHAR_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_BYTES = 2e8;
const FILES = /^(model\.glb|mapping\.json|meta\.json|sheet\.png|thumb\.png)$/;
export const chars3dDir = () => path.join(ws.root(), "characters3d");
const dirOf = (id) => {
  if (!CHAR_ID.test(id)) throw new Error("Not a character id.");
  return path.join(chars3dDir(), id);
};
const readJson$f = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const writeJson = (f, v) => {
  const t = f + ".tmp";
  fs.writeFileSync(t, JSON.stringify(v, null, 1) + "\n");
  fs.renameSync(t, f);
};
export function char3dFile(rel) {
  const [id, file, ...rest] = rel.split("/");
  if (rest.length || !id || !file || !CHAR_ID.test(id) || !FILES.test(file)) return null;
  const f = path.join(chars3dDir(), id, file);
  return fs.existsSync(f) ? f : null;
}
export function chars3dIndex() {
  return {
    version: 1,
    characters: listChars()
      .filter((c) => c.status === "ok")
      .map((c) => ({ id: c.id, name: c.name, height: c.height, rig: c.rig })),
  };
}
function entry(id) {
  const d = path.join(chars3dDir(), id),
    m = readJson$f(path.join(d, "meta.json"));
  if (!m) return null;
  const at = (f) =>
    fs.existsSync(path.join(d, f)) ? `${serverUrl()}/fv/__chars3d/${id}/${f}?t=${Math.round(fs.statSync(path.join(d, f)).mtimeMs)}` : null;
  return {
    id,
    name: m.name || id,
    height: m.height || 0,
    from: m.from || "",
    licence: m.licence || "own upload",
    added: m.added || "",
    status: m.status === "ok" ? "ok" : "needs-mapping",
    rig: m.rig || "humanoid",
    source: m.source || "",
    warnings: m.warnings || [],
    missing: m.missing || [],
    problems: m.problems || [],
    thumb: at("thumb.png"),
    sheet: at("sheet.png"),
    sheetAt: m.sheetAt || null,
    bones: m.bones || 0,
    verts: m.verts || 0,
  };
}
export function listChars() {
  let ids = [];
  try {
    ids = fs.readdirSync(chars3dDir()).filter((x) => CHAR_ID.test(x));
  } catch {
    return [];
  }
  return ids
    .map(entry)
    .filter(Boolean)
    .sort((a, b) => String(b.added).localeCompare(String(a.added)));
}
let onChange = () => {},
  onProgress = () => {};
export function onChars3d(h) {
  if (h.changed) onChange = h.changed;
  if (h.progress) onProgress = h.progress;
}
let win = null,
  idleT = null;
async function worker() {
  if (idleT) {
    clearTimeout(idleT);
    idleT = null;
  }
  if (win && !win.w.isDestroyed()) {
    await win.ready;
    return win.w;
  }
  const w = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  const ready = (async () => {
    await w.loadURL(`${serverUrl()}/fv/charview.html?mode=tool&theme=studio&spin=0`);
    for (let k = 0; k < 240; k++) {
      const r = await w.webContents.executeJavaScript("window.ready");
      if (r === true) break;
      if (typeof r === "string") throw new Error("the character preview did not start: " + r);
      await new Promise((res) => setTimeout(res, 250));
    }
    const ok = await w.webContents.executeJavaScript(`import('/fv/lib/customchar.js').then(m => { window.__czChars = m; return true; })`);
    if (!ok) throw new Error("the character importer did not start");
  })();
  win = { w, ready };
  w.on("closed", () => {
    if (win?.w === w) win = null;
  });
  try {
    await ready;
  } catch (e) {
    if (!w.isDestroyed()) w.destroy();
    win = null;
    throw e;
  }
  return w;
}
function release() {
  if (idleT) clearTimeout(idleT);
  idleT = setTimeout(() => {
    idleT = null;
    if (win && !win.w.isDestroyed()) win.w.destroy();
    win = null;
  }, 3e4);
}
async function run(code, ms = 24e4) {
  const w = await worker();
  return Promise.race([
    w.webContents.executeJavaScript(code),
    new Promise((_, rej) => setTimeout(() => rej(new Error("The character importer stopped responding.")), ms)),
  ]);
}
async function convert(file, mapping) {
  const b64 = fs.readFileSync(file).toString("base64");
  const r = await run(`(async () => { try {
    const buf = await (await fetch('data:application/octet-stream;base64,' + ${JSON.stringify(b64)})).arrayBuffer();
    const out = await window.__czChars.convertCharFile(buf, ${JSON.stringify(path.basename(file))}, ${JSON.stringify({
      mapping: mapping || null,
    })});
    const b64 = g => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(new Blob([g])); });
    return { ok: true, status: out.status, mapping: out.mapping, info: out.info, glb: out.glb ? await b64(out.glb) : null };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`);
  if (!r?.ok) throw new Error(r?.error || "The character could not be converted.");
  return { status: r.status, mapping: r.mapping, info: r.info, glb: r.glb ? Buffer.from(r.glb, "base64") : null };
}
function mappingPrompt(id) {
  const d = dirOf(id),
    mp = readJson$f(path.join(d, "mapping.json")),
    meta = readJson$f(path.join(d, "meta.json")) || {};
  if (!mp?.bones) return "";
  const bones = mp.bones
    .map(
      (b, i) =>
        `${b.name} | parent ${b.parent >= 0 ? mp.bones[b.parent].name : "-"} | at ${b.pos.map((v) => v.toFixed(3)).join(", ")}${b.weighted ? "" : " | moves no vertices"}`,
    )
    .join("\n");
  const ours = [
    "pelvis",
    "spine_01",
    "spine_02",
    "spine_03",
    "neck_01",
    "Head",
    ...["l", "r"].flatMap((s) => [
      ...["clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot", "ball"].map((b) => `${b}_${s}`),
      ...["thumb", "index", "middle", "ring", "pinky"].flatMap((f) => ["01", "02", "03"].map((k) => `${f}_${k}_${s}`)),
    ]),
  ];
  return `Map the bones of my 3D character "${meta.name || id}" (file ${meta.from || "?"}) to Videoxx's character skeleton (Unreal 5 mannequin names).

Our bones: ${ours.join(", ")}.
_l is the character's own LEFT side. Required: ${["pelvis", "Head", "upperarm_l", "lowerarm_l", "hand_l", "upperarm_r", "lowerarm_r", "hand_r", "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r"].join(", ")}. spine_01..03 go from the hips up to the bone the arms hang from; leave out twist / helper / end bones and anything you are not sure of (fingers may be left out).
Each of our bones must be BELOW the one it hangs from in their hierarchy (lowerarm below upperarm, and so on).
${
  mp.missing?.length
    ? `Not found automatically: ${mp.missing.join(", ")}.
`
    : ""
}${
    mp.problems?.length
      ? `Problems with the automatic guess: ${mp.problems.join("; ")}.
`
      : ""
  }
Their bones (name | parent | rest position x, y, z in the file's units):
${bones}

My automatic guess: ${JSON.stringify(mp.map)}

Reply with ONLY a JSON object { "ourBone": "theirBone", ... } (their names exactly as listed).`;
}
const slugOf = (n) =>
  n
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "character";
let chain = Promise.resolve();
const queue = (f) => {
  const job = chain.then(f);
  chain = job.catch(() => {});
  return job;
};
export function uploadChar(file, o = {}) {
  return queue(async () => {
    file = path.resolve(String(file || ""));
    if (!CHAR_EXT.test(file)) throw new Error("Pick an FBX, GLB, GLTF or VRM file.");
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      throw new Error("That file is not there any more.");
    }
    if (!st.isFile()) throw new Error("Not a file.");
    if (st.size > MAX_BYTES) throw new Error("The file is too big (over 200 MB).");
    if (st.size < 64) throw new Error("The file is empty.");
    const name =
      String(o.name || path.basename(file).replace(/\.[^.]+$/, ""))
        .replace(/[_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60) || "Character";
    fs.mkdirSync(chars3dDir(), { recursive: true });
    let id = slugOf(name);
    for (let k = 2; fs.existsSync(path.join(chars3dDir(), id)); k++) id = `${slugOf(name).slice(0, 44)}-${k}`;
    const d = path.join(chars3dDir(), id),
      ext = path.extname(file).toLowerCase();
    onProgress({ id, stage: "reading", file: path.basename(file) });
    fs.mkdirSync(d, { recursive: true });
    try {
      fs.copyFileSync(file, path.join(d, "source" + ext));
      writeJson(path.join(d, "meta.json"), {
        id,
        name,
        from: path.basename(file),
        source: "source" + ext,
        licence:
          String(o.licence || "")
            .trim()
            .slice(0, 300) || "own upload",
        added: new Date().toISOString(),
        status: "needs-mapping",
      });
      onProgress({ id, stage: "converting", file: path.basename(file) });
      const r = await finishImport(id);
      onChange();
      return r;
    } catch (e) {
      fs.rmSync(d, { recursive: true, force: true });
      const msg = String(e?.message || e).split("\n")[0];
      log("chars3d: upload failed", file, msg);
      throw new Error(msg);
    } finally {
      onProgress({ id, stage: "done", file: "" });
      release();
    }
  });
}
async function finishImport(id, mapping) {
  const d = dirOf(id),
    meta = readJson$f(path.join(d, "meta.json"));
  if (!meta) throw new Error("That character is not in your library.");
  const src = path.join(d, meta.source || "");
  if (!meta.source || !fs.existsSync(src)) throw new Error("The uploaded file of this character is missing: upload it again.");
  const t0 = Date.now(),
    c = await convert(src, mapping);
  writeJson(path.join(d, "mapping.json"), c.mapping);
  Object.assign(meta, {
    status: c.status,
    rig: c.info?.rig,
    mappedBy: c.mapping?.source,
    missing: c.mapping?.missing || [],
    problems: c.mapping?.problems || [],
    bones: c.info?.bones,
    verts: c.info?.verts,
    textures: c.info?.textures,
    texturesLoaded: c.info?.texturesLoaded,
  });
  if (c.status === "ok" && c.glb) {
    fs.writeFileSync(path.join(d, "model.glb"), c.glb);
    meta.height = c.info.height;
    meta.warnings = [];
    writeJson(path.join(d, "meta.json"), meta);
    onProgress({ id, stage: "sheet", file: meta.from });
    const s = await sheetOf(id);
    meta.warnings = s.warnings;
    meta.restFit = s.checks?.fit || {};
    meta.proportions = propsOf(s.checks);
    meta.sheetAt = new Date().toISOString();
  } else {
    for (const f of ["model.glb", "sheet.png", "thumb.png"]) fs.rmSync(path.join(d, f), { force: true });
    meta.warnings = [];
  }
  writeJson(path.join(d, "meta.json"), meta);
  log(`chars3d: ${id} ${c.status} (${c.mapping?.rig}, mapped by ${c.mapping?.source}, ${c.info?.bones} bones) in ${Date.now() - t0} ms`);
  const character = entry(id);
  return {
    id,
    status: c.status,
    character,
    warnings: character.warnings,
    ...(c.status === "needs-mapping" ? { prompt: mappingPrompt(id) } : {}),
  };
}
const propsOf = (checks) => {
  const p = checks?.proportions;
  return p ? { ok: !!p.ok, mode: p.proportions, worst: p.worst, bindError: p.bindError, lengths: p.lengths } : null;
};
async function sheetOf(id) {
  const r = await run(
    `(async () => { try { const s = await window.__czChars.renderSheet(${JSON.stringify(id)}); return { ok: true, ...s }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } })()`,
  );
  if (!r?.ok) throw new Error("The test sheet could not be drawn: " + (r?.error || "?"));
  const d = dirOf(id);
  fs.writeFileSync(path.join(d, "sheet.png"), Buffer.from(String(r.sheet).split(",")[1], "base64"));
  fs.writeFileSync(path.join(d, "thumb.png"), Buffer.from(String(r.thumb).split(",")[1], "base64"));
  return { warnings: r.warnings || [], checks: r.checks };
}
export function charSheet(id) {
  return queue(async () => {
    const d = dirOf(String(id)),
      meta = readJson$f(path.join(d, "meta.json"));
    if (!meta) throw new Error("That character is not in your library.");
    if (meta.status !== "ok") throw new Error("Map the bones of this character first.");
    try {
      onProgress({ id, stage: "sheet", file: meta.from });
      const s = await sheetOf(id);
      meta.warnings = s.warnings;
      meta.proportions = propsOf(s.checks);
      meta.sheetAt = new Date().toISOString();
      writeJson(path.join(d, "meta.json"), meta);
      onChange();
      return { character: entry(id), warnings: s.warnings, checks: s.checks };
    } finally {
      onProgress({ id, stage: "done", file: "" });
      release();
    }
  });
}
export function charBones(id) {
  const d = dirOf(String(id)),
    mp = readJson$f(path.join(d, "mapping.json"));
  if (!mp) throw new Error("That character has no bone list yet.");
  return {
    bones: mp.bones.map((b) => ({ name: b.name, parent: b.parent >= 0 ? mp.bones[b.parent].name : null, weighted: !!b.weighted })),
    map: mp.map || {},
    missing: mp.missing || [],
    problems: mp.problems || [],
    source: mp.source,
    rig: mp.rig,
    prompt: mappingPrompt(id),
  };
}
export function setCharMapping(id, map) {
  return queue(async () => {
    const clean = {};
    for (const [k, v] of Object.entries(map && typeof map === "object" ? map : {}))
      if (typeof v === "string" && v && /^[\w]+$/.test(k)) clean[k] = v;
    try {
      onProgress({ id, stage: "converting", file: "" });
      const r = await finishImport(String(id), clean);
      onChange();
      return r;
    } finally {
      onProgress({ id, stage: "done", file: "" });
      release();
    }
  });
}
export function renameChar(id, o) {
  const d = dirOf(String(id)),
    meta = readJson$f(path.join(d, "meta.json"));
  if (!meta) throw new Error("That character is not in your library.");
  if (o.name != null) meta.name = String(o.name).trim().slice(0, 60) || meta.name;
  if (o.licence != null) meta.licence = String(o.licence).trim().slice(0, 300) || "own upload";
  writeJson(path.join(d, "meta.json"), meta);
  onChange();
  return entry(id);
}
export function removeChar(id) {
  const d = dirOf(String(id));
  if (!fs.existsSync(path.join(d, "meta.json"))) throw new Error("That character is not in your library.");
  const name = readJson$f(path.join(d, "meta.json"))?.name || id;
  fs.rmSync(d, { recursive: true, force: true });
  onChange();
  return { removed: name };
}
