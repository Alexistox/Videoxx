import path from "node:path";
import fs from "node:fs";
import { now } from "../db/db";
import { clipId, emptyEdit, validate } from "./timeline";
import { getPersonal } from "./personalProjects";
import { readMedia } from "./media";

const editFile = (p) => path.join(p.path, "edit.json");
export const mediaInfo = (list) =>
  list.map((m) => ({
    id: m.id,
    role: m.role,
    duration: m.duration,
    fps: m.fps,
    audio: m.audio,
    width: m.width,
    height: m.height,
    derived: !!m.derived,
    name: m.name,
  }));
const byName = (a, b) => (a.name ?? "").localeCompare(b.name ?? "", void 0, { numeric: true, sensitivity: "base" });
function laneFootage(media) {
  const edited = media.filter((m) => m.derived && m.role === "screen");
  const screens = edited.length ? edited : media.filter((m) => !m.derived && m.role === "screen").sort(byName);
  return [...screens, ...media.filter((m) => !m.derived && m.role === "other" && m.width).sort(byName)];
}
export function readEdit(p) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(editFile(p), "utf8"));
  } catch {
    raw = emptyEdit();
  }
  const media = mediaInfo(readMedia(p)),
    ids = new Set(media.map((m) => m.id));
  if (raw && Array.isArray(raw.clips)) raw = { ...raw, clips: raw.clips.filter((c) => ids.has(c?.src)) };
  try {
    return withDefaults(validate({ ...emptyEdit(), ...raw }, media), media);
  } catch {
    return withDefaults({ ...emptyEdit(), cams: raw?.cams ?? {} }, media);
  }
}
function withDefaults(e, media) {
  const ids = new Set(media.map((m) => m.id));
  let clips = e.clips.filter((c) => ids.has(c.src)),
    cams = e.cams || {};
  const intro = media.find((m) => m.role === "intro" && m.derived) ?? media.find((m) => m.role === "intro");
  if (!clips.length) clips = laneFootage(media).map((m) => ({ id: clipId(), src: m.id, in: 0, out: m.duration }));
  if (intro && !clips.some((c) => c.src === intro.id)) clips = [{ id: clipId(), src: intro.id, in: 0, out: intro.duration }, ...clips];
  if (!Object.keys(cams).length && e.source !== "claude") {
    let at = 0;
    cams = {};
    for (const m of media.filter((x) => x.role === "facecam" && !x.derived && x.width).sort(byName)) {
      cams[m.id] = { m: 0, c: at, start: at, end: at + m.duration };
      at += m.duration;
    }
  }
  return { ...e, clips, cams };
}
export function placeFootage(id) {
  const p = getPersonal(id);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(editFile(p), "utf8"));
  } catch {
    return;
  }
  if (raw?.source === "claude" || raw?.source === "default" || !Array.isArray(raw?.clips) || !raw.clips.length) return;
  const media = mediaInfo(readMedia(p)),
    role = new Map(media.map((m) => [m.id, m.role]));
  const lane = laneFootage(media),
    keep = raw.clips.filter(
      (c) => role.has(c?.src) && role.get(c.src) !== "facecam" && (role.get(c.src) !== "other" || lane.some((m) => m.id === c.src)),
    );
  const add = lane.filter((m) => !keep.some((c) => c.src === m.id)).map((m) => ({ id: clipId(), src: m.id, in: 0, out: m.duration }));
  if (!add.length && keep.length === raw.clips.length) return;
  if (!keep.length && !add.length) {
    fs.rmSync(editFile(p), { force: true });
    return;
  }
  saveEdit(id, { ...raw, clips: [...keep, ...add] }, "manual");
}
export function saveEdit(id, edit, source = "manual") {
  const p = getPersonal(id),
    e = validate(edit, mediaInfo(readMedia(p)));
  e.source = source;
  e.updated = now();
  fs.writeFileSync(editFile(p), JSON.stringify(e, null, 1) + "\n");
  return e;
}
