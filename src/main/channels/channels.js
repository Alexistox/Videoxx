import path from "node:path";
import fs from "node:fs";
import { nativeImage } from "electron";
import { ws } from "../core/workspace";
import { log } from "../core/log";
import { now, q, uid } from "../db/db";
import { aspectOf, getStyle } from "../styles/catalog";
import { facelessPipeline } from "../projects/projects";
import { effectiveStage, isStage } from "./stages";
import { serverUrl } from "../projects/fileServer";

const CHANNEL_COLORS = ["#89bea4", "#84a9d8", "#b496db", "#d7b461", "#db9393", "#e0a46e", "#6fc3c9", "#c7d27a", "#d996c4", "#a3a3a3"];
export const channelDir = (id) => path.join(ws.root(), "channels", String(id).replace(/[^\w-]/g, ""));
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const cut = (s, max) => Array.from(s).slice(0, max).join("");
const clean = (s, max) =>
  cut(
    String(s ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    max,
  ).trim();
const cleanText = (s, max) =>
  cut(
    String(s ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim(),
    max,
  ).trimEnd();
const parseSettings = (s) => {
  try {
    const o = JSON.parse(s || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
};
function avatarUrl(c) {
  if (!c.avatar) return null;
  try {
    return `${serverUrl()}/ch/${c.id}/${encodeURIComponent(c.avatar)}?v=${Math.round(fs.statSync(path.join(channelDir(c.id), c.avatar)).mtimeMs)}`;
  } catch {
    return null;
  }
}
export function listChannels() {
  return q
    .all(
      `SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.channel_id = c.id) AS projects,
      (SELECT COUNT(*) FROM ideas i WHERE i.channel_id = c.id) AS ideas FROM channels c ORDER BY c.sort, c.created_at`,
    )
    .map((c) => ({ ...c, settings: parseSettings(c.settings), avatarUrl: avatarUrl(c) }));
}
export function rememberNewProject(channelId, v) {
  if (!channelId) return;
  const r = q.get("SELECT * FROM channels WHERE id=?", channelId);
  if (!r) return;
  const s = parseSettings(r.settings);
  s.lastNew = { styleId: v.styleId, presetId: v.presetId, length: Math.round(Number(v.length) || 0) || null, at: now() };
  q.run("UPDATE channels SET settings=? WHERE id=?", JSON.stringify(s), channelId);
}
export function getChannel(id) {
  const c = listChannels().find((x) => x.id === id);
  if (!c) throw new Error("That channel no longer exists.");
  return c;
}
export function checkChannel(id) {
  if (id === null || id === void 0 || id === "" || id === "none") return null;
  if (!q.get("SELECT id FROM channels WHERE id=?", String(id))) throw new Error("That channel no longer exists. Pick another one.");
  return String(id);
}
const HANDLE = /^[\p{L}\p{M}\p{N}_.\-·]{1,30}$/u;
export function normalizeHandle(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (/youtube\.com|youtu\.be|\//i.test(s)) {
    if (/\/(channel|c|user)\//i.test(s))
      throw new Error("Use the channel's @handle (you find it under the channel name on YouTube), not its address.");
    const at = /@([\p{L}\p{M}\p{N}_.\-·]+)/u.exec(
      (() => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      })(),
    );
    if (!at) throw new Error("That address has no @handle in it. Type the handle, like @mychannel.");
    s = at[1];
  }
  s = s.replace(/^@+/, "");
  if (!HANDLE.test(s))
    throw new Error(
      [...s].length > 30 && HANDLE.test([...s].slice(0, 30).join(""))
        ? `A handle is at most 30 characters (this one has ${[...s].length}).`
        : "A handle is letters, numbers, dots, dashes and underscores (no spaces), like @mychannel.",
    );
  return "@" + s;
}
function checkHandle(handle, except) {
  if (!handle) return;
  const twin = q.get("SELECT id, name FROM channels WHERE lower(handle) = lower(?)", handle);
  if (twin && twin.id !== except) throw new Error(`You already have a channel with ${handle} ("${twin.name}").`);
}
function validColor(c) {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
}
function nextColor() {
  const used = new Set(q.all("SELECT color FROM channels").map((r) => r.color));
  return CHANNEL_COLORS.find((c) => !used.has(c)) ?? CHANNEL_COLORS[q.all("SELECT id FROM channels").length % CHANNEL_COLORS.length];
}
function checkName(name, except) {
  if (!name) throw new Error("Give the channel a name.");
  const twin = q.get("SELECT id FROM channels WHERE lower(name) = lower(?)", name);
  if (twin && twin.id !== except) throw new Error(`You already have a channel called "${name}".`);
}
export function createChannel(o) {
  const name = clean(o?.name, 80);
  checkName(name);
  const handle = normalizeHandle(o?.handle),
    color = validColor(o?.color) ?? nextColor();
  checkHandle(handle);
  const id = uid("ch_"),
    t = now(),
    sort = (q.get("SELECT MAX(sort) AS m FROM channels")?.m ?? -1) + 1;
  q.run(
    "INSERT INTO channels(id,name,handle,color,description,sort,settings,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id,
    name,
    handle,
    color,
    cleanText(o?.description, 500) || null,
    sort,
    "{}",
    t,
    t,
  );
  return getChannel(id);
}
export function updateChannel(id, patch) {
  const c = getChannel(id);
  const name = patch.name !== void 0 ? clean(patch.name, 80) : c.name;
  checkName(name, id);
  const handle = patch.handle !== void 0 ? normalizeHandle(patch.handle) : c.handle;
  checkHandle(handle, id);
  const color = patch.color !== void 0 ? (validColor(patch.color) ?? c.color) : c.color;
  const description = patch.description !== void 0 ? cleanText(patch.description, 500) || null : c.description;
  q.run(
    "UPDATE channels SET name=?, handle=?, color=?, description=?, updated_at=? WHERE id=?",
    name,
    handle,
    color,
    description,
    now(),
    id,
  );
  return getChannel(id);
}
export function deleteChannel(id) {
  const c = getChannel(id);
  q.run("DELETE FROM channels WHERE id=?", id);
  try {
    fs.rmSync(channelDir(id), { recursive: true, force: true });
  } catch {}
  return { projects: c.projects, ideas: c.ideas };
}
export function reorderChannels(ids) {
  if (!Array.isArray(ids)) throw new Error("Nothing to reorder.");
  const t = now();
  tx(() => ids.forEach((id, i) => q.run("UPDATE channels SET sort=?, updated_at=? WHERE id=?", i, t, String(id))));
  return listChannels();
}
export function setAvatar(id, file, fromYt) {
  getChannel(id);
  const from = () => {
    const st = parseSettings(q.get("SELECT * FROM channels WHERE id=?", id).settings);
    if ((st.picFromYt ?? null) !== (fromYt ?? null)) {
      if (fromYt) st.picFromYt = fromYt;
      else delete st.picFromYt;
      q.run("UPDATE channels SET settings=? WHERE id=?", JSON.stringify(st), id);
    }
  };
  const dir = channelDir(id);
  if (file === null) {
    from();
    q.run("UPDATE channels SET avatar=NULL, updated_at=? WHERE id=?", now(), id);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
    return getChannel(id);
  }
  const f = String(file);
  if (!/\.(png|jpe?g|webp)$/i.test(f) || !fs.existsSync(f)) throw new Error("The picture must be a PNG, JPG or WebP image.");
  if (fs.statSync(f).size > 30 * 1024 * 1024) throw new Error("That picture is too big (over 30 MB).");
  let img = nativeImage.createFromPath(f),
    out;
  if (!img.isEmpty()) {
    const { width: w, height: h } = img.getSize(),
      s = Math.min(w, h);
    img = img.crop({ x: Math.floor((w - s) / 2), y: Math.floor((h - s) / 2), width: s, height: s });
    if (s > 256) img = img.resize({ width: 256, height: 256, quality: "best" });
    const o = jpegOrientation(f, w, h);
    if (o > 1) img = orient(img, o);
    out = { name: "avatar.png", data: img.toPNG() };
  } else {
    if (fs.statSync(f).size > 8 * 1024 * 1024)
      throw new Error("That picture could not be read here, and it is too big to keep as it is. Try a PNG or JPG.");
    const data = fs.readFileSync(f),
      sig = (s, at = 0) => data.subarray(at, at + s.length).toString("latin1") === s;
    if (!(sig("PNG") || sig("ÿØÿ") || (sig("RIFF") && sig("WEBP", 8))))
      throw new Error("That picture could not be read. Try a PNG or JPG.");
    out = { name: "avatar." + path.extname(f).slice(1).toLowerCase().replace("jpeg", "jpg"), data };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const x of fs.readdirSync(dir)) if (/^avatar/.test(x)) fs.rmSync(path.join(dir, x), { force: true });
    fs.writeFileSync(path.join(dir, out.name), out.data);
  } catch (e) {
    log("channel picture: cannot store", dir, e?.message);
    throw new Error(
      "The picture could not be stored in the channel's folder: something is holding it (a sync tool or an antivirus) or it can't be written. Try again in a moment.",
    );
  }
  from();
  q.run("UPDATE channels SET avatar=?, updated_at=? WHERE id=?", out.name, now(), id);
  return getChannel(id);
}
function jpegOrientation(file, decodedW, decodedH) {
  let b;
  try {
    const fd = fs.openSync(file, "r");
    try {
      b = Buffer.alloc(Math.min(256 * 1024, fs.fstatSync(fd).size));
      fs.readSync(fd, b, 0, b.length, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 1;
  }
  if (b.length < 4 || b[0] !== 255 || b[1] !== 216) return 1;
  let o = 1,
    sw = 0,
    sh = 0;
  for (let i = 2; i + 4 <= b.length;) {
    if (b[i] !== 255) break;
    const m = b[i + 1];
    if (m === 255) {
      i++;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    if (m === 216 || (m >= 208 && m <= 215) || m === 1) {
      i += 2;
      continue;
    }
    if (m === 225 && b.toString("latin1", i + 4, i + 10) === "Exif\0\0") {
      const t = i + 10,
        le = b.toString("latin1", t, t + 2) === "II";
      const u16 = (p) => (p + 2 <= b.length ? (le ? b.readUInt16LE(p) : b.readUInt16BE(p)) : 0),
        u32 = (p) => (p + 4 <= b.length ? (le ? b.readUInt32LE(p) : b.readUInt32BE(p)) : 0);
      const ifd = t + u32(t + 4),
        n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 274) {
          const v = u16(e + 8);
          if (v >= 1 && v <= 8) o = v;
          break;
        }
      }
    }
    if (m >= 192 && m <= 207 && m !== 196 && m !== 200 && m !== 204) {
      sh = b.readUInt16BE(i + 5);
      sw = b.readUInt16BE(i + 7);
      break;
    }
    if (m === 218) break;
    i += 2 + len;
  }
  if (o >= 5 && sw && sh && sw !== sh && decodedW === sh && decodedH === sw) return 1;
  return o;
}
function orient(img, o) {
  const { width: w, height: h } = img.getSize(),
    src = img.toBitmap(),
    dst = Buffer.alloc(src.length);
  if (src.length !== w * h * 4) return img;
  const W = o >= 5 ? h : w,
    H = o >= 5 ? w : h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let X = x,
        Y = y;
      switch (o) {
        case 2:
          X = w - 1 - x;
          break;
        // mirrored
        case 3:
          X = w - 1 - x;
          Y = h - 1 - y;
          break;
        // upside down
        case 4:
          Y = h - 1 - y;
          break;
        case 5:
          X = y;
          Y = x;
          break;
        case 6:
          X = h - 1 - y;
          Y = x;
          break;
        // turned: shown a quarter turn clockwise
        case 7:
          X = h - 1 - y;
          Y = w - 1 - x;
          break;
        case 8:
          X = y;
          Y = w - 1 - x;
          break;
      }
      src.copy(dst, (Y * W + X) * 4, (y * w + x) * 4, (y * w + x) * 4 + 4);
    }
  return nativeImage.createFromBitmap(dst, { width: W, height: H });
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function checkDate(d) {
  if (d === null || d === void 0 || d === "") return null;
  const s = String(d);
  if (!DATE.test(s) || isNaN(Date.parse(s + "T00:00:00Z"))) throw new Error("That date is not valid.");
  return s;
}
export const listIdeas = () => q.all("SELECT * FROM ideas ORDER BY sort, created_at DESC");
const getIdea = (id) => {
  const r = q.get("SELECT * FROM ideas WHERE id=?", id);
  if (!r) throw new Error("That idea no longer exists.");
  return r;
};
export function createIdea(o) {
  const title = clean(o?.title, 200);
  if (!title) throw new Error("Write the idea first.");
  const stage = isStage(o?.stage) ? o.stage : "idea",
    channel = checkChannel(o?.channelId),
    due = checkDate(o?.dueAt);
  const id = uid("ida_"),
    t = now();
  q.run(
    "INSERT INTO ideas(id,channel_id,title,notes,stage,sort,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id,
    channel,
    title,
    cleanText(o?.notes, 5e3) || null,
    stage,
    -Date.parse(t),
    due,
    t,
    t,
  );
  return getIdea(id);
}
export function createIdeas(titles, channelId) {
  const list = (Array.isArray(titles) ? titles : [])
    .map((t2) => clean(t2, 200))
    .filter(Boolean)
    .slice(0, 200);
  if (!list.length) throw new Error("Write the idea first.");
  const channel = checkChannel(channelId),
    t = now(),
    base = -Date.parse(t),
    ids = [];
  tx(() =>
    list.forEach((title, i) => {
      const id = uid("ida_");
      ids.push(id);
      q.run(
        "INSERT INTO ideas(id,channel_id,title,notes,stage,sort,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        channel,
        title,
        null,
        "idea",
        base - (list.length - i),
        null,
        t,
        t,
      );
    }),
  );
  return ids.map(getIdea);
}
export function updateIdea(id, patch) {
  const r = getIdea(id);
  const title = patch.title !== void 0 ? clean(patch.title, 200) : r.title;
  if (!title) throw new Error("An idea needs a title.");
  const notes = patch.notes !== void 0 ? cleanText(patch.notes, 5e3) || null : r.notes;
  const channel = patch.channelId !== void 0 ? checkChannel(patch.channelId) : r.channel_id;
  const stage = patch.stage !== void 0 ? (isStage(patch.stage) ? patch.stage : r.stage) : r.stage;
  const due = patch.dueAt !== void 0 ? checkDate(patch.dueAt) : r.due_at;
  q.run(
    "UPDATE ideas SET title=?, notes=?, channel_id=?, stage=?, due_at=?, updated_at=? WHERE id=?",
    title,
    notes,
    channel,
    stage,
    due,
    now(),
    id,
  );
  return getIdea(id);
}
export function deleteIdea(id) {
  getIdea(id);
  q.run("DELETE FROM ideas WHERE id=?", id);
}
export function deleteIdeas(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter((id) => id.startsWith("ida_"));
  if (!list.length) throw new Error("Nothing to delete.");
  tx(() => list.forEach((id) => q.run("DELETE FROM ideas WHERE id=?", id)));
  return list.length;
}
export function restoreIdea(r) {
  const id = String(r?.id ?? "");
  if (!/^ida_[\w-]+$/.test(id)) throw new Error("That idea cannot be brought back.");
  if (q.get("SELECT id FROM ideas WHERE id=?", id)) return getIdea(id);
  const title = clean(r.title, 200);
  if (!title) throw new Error("That idea cannot be brought back.");
  let channel = null;
  try {
    channel = checkChannel(r.channel_id);
  } catch {}
  let due = null;
  try {
    due = checkDate(r.due_at);
  } catch {}
  const t = now(),
    created = typeof r.created_at === "string" && !isNaN(Date.parse(r.created_at)) ? r.created_at : t;
  q.run(
    "INSERT INTO ideas(id,channel_id,title,notes,stage,sort,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id,
    channel,
    title,
    cleanText(r.notes, 5e3) || null,
    isStage(r.stage) ? r.stage : "idea",
    Number.isFinite(Number(r.sort)) ? Number(r.sort) : -Date.parse(t),
    due,
    created,
    t,
  );
  return getIdea(id);
}
let publishInfo = () => new Map();
export const setPublishInfo = (fn) => {
  publishInfo = fn;
};
function knownOnly(p, why) {
  const personal = p.kind === "personal";
  const auto = personal ? "idea" : p.status === "ready" ? "ready" : p.status === "editing" ? "review" : "script";
  let style = "Personal";
  if (!personal)
    try {
      style = getStyle(p.style_id).name;
    } catch {
      style = "Faceless";
    }
  return {
    id: p.id,
    kind: personal ? "personal" : "faceless",
    manual: false,
    missing: why === "missing",
    unreadable: why === "unreadable",
    lab: false,
    auto,
    stage: auto,
    done: 0,
    total: personal ? 4 : 8,
    next: null,
    length: p.duration || 0,
    target: null,
    style,
    look: null,
    tall: false,
  };
}
export function pipelineOf(p, presetNames) {
  const exists = fs.existsSync(p.path);
  const pj = exists ? readJson(path.join(p.path, "project.json")) || {} : {};
  if (pj.styleLab || pj.characterLab) return { lab: true };
  const personal = p.kind === "personal";
  const base = { id: p.id, kind: personal ? "personal" : "faceless", manual: false, missing: !exists, lab: false };
  if (!exists) return knownOnly(p, "missing");
  if (personal) {
    const media = readJson(path.join(p.path, "media.json"))?.media ?? [],
      edit = readJson(path.join(p.path, "edit.json")) ?? {};
    const clips = Array.isArray(edit.clips) ? edit.clips : [];
    const length = clips.reduce((s, c) => s + Math.max(0, (+c.out || 0) - (+c.in || 0)), 0);
    const rendered = fs.existsSync(path.join(p.path, "out")) && fs.readdirSync(path.join(p.path, "out")).some((f) => /\.mp4$/i.test(f));
    const steps2 = [
      { label: "Thumbnail", done: !!pj.thumbnail && fs.existsSync(path.join(p.path, String(pj.thumbnail))) },
      { label: "Footage", done: media.length > 0 },
      { label: "Cut", done: clips.length > 0 && edit.source !== "default" },
      { label: "Rendered", done: rendered },
    ];
    const auto2 = rendered ? "ready" : media.length ? "building" : "idea";
    return {
      ...base,
      auto: auto2,
      stage: auto2,
      done: steps2.filter((s) => s.done).length,
      total: steps2.length,
      next: steps2.find((s) => !s.done)?.label ?? null,
      length,
      target: null,
      style: "Personal",
      look: null,
      tall: false,
    };
  }
  const { steps } = facelessPipeline(p.path, pj, true, p.id);
  const done = (id) => !!steps.find((s) => s.id === id)?.done;
  const auto = done("export") ? "ready" : done("scenes") ? "review" : done("voice") ? "building" : done("script") ? "voiceover" : "script";
  return {
    ...base,
    auto,
    stage: auto,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    next: steps.find((s) => !s.done)?.label ?? null,
    length: pj.end || p.duration || 0,
    target: +pj.targetLength || null,
    style: getStyle(p.style_id).name,
    look: p.preset_id ? (presetNames?.get(p.preset_id) ?? null) : null,
    tall: aspectOf(p.style_id, pj.settings) < 1,
  };
}
export function board() {
  const t0 = Date.now();
  const rows = q.all("SELECT * FROM projects");
  const names = new Map(q.all("SELECT id, name FROM presets").map((r) => [r.id, r.name]));
  const pub = publishInfo(rows.map((r) => r.id));
  const cards = {},
    reverts = [];
  for (const p of rows) {
    let c;
    try {
      c = pipelineOf(p, names);
    } catch (e2) {
      log("board: cannot read", p.path, e2?.message);
      c = knownOnly(p, "unreadable");
    }
    if (!c || c.lab) continue;
    const yt = pub.get(p.id);
    if (yt) {
      c.auto = yt.stage;
      c.views = yt.views ?? null;
      c.publishedAt = yt.at ?? null;
    }
    const manual = isStage(p.stage) ? p.stage : null,
      when = isStage(p.stage_auto) ? p.stage_auto : null;
    const e =
      c.missing || c.unreadable ? { stage: manual ?? c.auto, manual: !!manual, revert: false } : effectiveStage(c.auto, manual, when);
    if (e.revert) reverts.push(p.id);
    const { lab: _lab, ...card } = c;
    cards[p.id] = {
      ...card,
      stage: e.stage,
      manual: e.manual,
      name: p.name,
      channelId: p.channel_id,
      order: p.stage_order,
      due: p.due_at,
      note: p.plan_note,
      stageAt: e.manual ? p.stage_at : null,
      created: p.created_at,
      recent: p.opened_at || p.updated_at,
    };
  }
  if (reverts.length)
    tx(() => reverts.forEach((id) => q.run("UPDATE projects SET stage=NULL, stage_auto=NULL, stage_at=NULL WHERE id=?", id)));
  return { cards, ideas: listIdeas(), ms: Date.now() - t0 };
}
export function assignChannel(projectIds, channelId) {
  const ch = checkChannel(channelId),
    ids = (Array.isArray(projectIds) ? projectIds : [projectIds]).map(String);
  tx(() =>
    ids.forEach((id) => {
      if (id.startsWith("ida_")) {
        getIdea(id);
        q.run("UPDATE ideas SET channel_id=?, updated_at=? WHERE id=?", ch, now(), id);
        return;
      }
      if (!q.get("SELECT id FROM projects WHERE id=?", id)) throw new Error("That project no longer exists.");
      q.run("UPDATE projects SET channel_id=? WHERE id=?", ch, id);
    }),
  );
  return ids.length;
}
export function setPlan(projectId, patch) {
  const p = q.get("SELECT * FROM projects WHERE id=?", projectId);
  if (!p) throw new Error("That project no longer exists.");
  if (patch.dueAt !== void 0) q.run("UPDATE projects SET due_at=? WHERE id=?", checkDate(patch.dueAt), projectId);
  if (patch.planNote !== void 0) q.run("UPDATE projects SET plan_note=? WHERE id=?", cleanText(patch.planNote, 5e3) || null, projectId);
  if (patch.stage !== void 0) setStage(p, patch.stage);
  return q.get("SELECT * FROM projects WHERE id=?", projectId);
}
export function setDueMany(ids, dueAt) {
  const due = checkDate(dueAt),
    list = (Array.isArray(ids) ? ids : []).map(String);
  if (!list.length) throw new Error("Nothing to date.");
  tx(() =>
    list.forEach((id) => {
      if (id.startsWith("ida_")) {
        getIdea(id);
        q.run("UPDATE ideas SET due_at=?, updated_at=? WHERE id=?", due, now(), id);
        return;
      }
      if (!q.get("SELECT id FROM projects WHERE id=?", id)) throw new Error("That project no longer exists.");
      q.run("UPDATE projects SET due_at=? WHERE id=?", due, id);
    }),
  );
  return list.length;
}
function setStage(p, stage) {
  if (stage === null || stage === "auto") {
    q.run("UPDATE projects SET stage=NULL, stage_auto=NULL, stage_at=NULL WHERE id=?", p.id);
    return;
  }
  if (!isStage(stage)) throw new Error("That is not a stage of the pipeline.");
  let info;
  try {
    info = pipelineOf(p);
  } catch {
    info = knownOnly(p, "unreadable");
  }
  const auto = info && !info.lab ? (publishInfo([p.id]).get(p.id)?.stage ?? info.auto) : null;
  if (stage === auto) q.run("UPDATE projects SET stage=NULL, stage_auto=NULL, stage_at=NULL WHERE id=?", p.id);
  else q.run("UPDATE projects SET stage=?, stage_auto=?, stage_at=? WHERE id=?", stage, auto, now(), p.id);
}
export function moveCard(o) {
  if (!isStage(o?.stage)) throw new Error("That is not a stage of the pipeline.");
  const ids = (Array.isArray(o.ids) ? o.ids : [o.id]).filter(Boolean).map(String),
    order = Array.isArray(o.order) ? o.order.map(String) : [];
  if (!ids.length) throw new Error("Nothing to move.");
  const ch = o.channelId !== void 0 ? checkChannel(o.channelId) : void 0;
  tx(() => {
    for (const id of ids) {
      if (id.startsWith("ida_")) {
        getIdea(id);
        q.run("UPDATE ideas SET stage=?, updated_at=? WHERE id=?", o.stage, now(), id);
        if (ch !== void 0) q.run("UPDATE ideas SET channel_id=? WHERE id=?", ch, id);
      } else {
        const p = q.get("SELECT * FROM projects WHERE id=?", id);
        if (!p) throw new Error("That project no longer exists.");
        setStage(p, o.stage);
        if (ch !== void 0) q.run("UPDATE projects SET channel_id=? WHERE id=?", ch, id);
      }
    }
    order.forEach((x, i) =>
      x.startsWith("ida_")
        ? q.run("UPDATE ideas SET sort=? WHERE id=?", i, x)
        : q.run("UPDATE projects SET stage_order=? WHERE id=?", i, x),
    );
  });
  return true;
}
export function adoptNewProject(projectId, o) {
  const ch = o.channelId !== void 0 ? checkChannel(o.channelId) : void 0;
  const idea = o.ideaId ? q.get("SELECT * FROM ideas WHERE id=?", String(o.ideaId)) : null;
  tx(() => {
    if (ch !== void 0) q.run("UPDATE projects SET channel_id=? WHERE id=?", ch, projectId);
    if (idea) {
      q.run(
        "UPDATE projects SET plan_note=COALESCE(?, plan_note), due_at=COALESCE(?, due_at) WHERE id=?",
        idea.notes ? cleanText(idea.notes, 5e3) : null,
        idea.due_at,
        projectId,
      );
      q.run("DELETE FROM ideas WHERE id=?", idea.id);
    }
  });
}
function tx(fn) {
  q.run("BEGIN");
  try {
    fn();
    q.run("COMMIT");
  } catch (e) {
    try {
      q.run("ROLLBACK");
    } catch {}
    throw e;
  }
}
