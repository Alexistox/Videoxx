import path from "node:path";
import fs from "node:fs";
import { uid } from "../db/db";
import { cancel, probe } from "../pipeline/ffmpeg";
import { getPersonal } from "./personalProjects";
import { jobs, queueProxy } from "./proxies";

const VIDEO = /\.(mp4|mov|mkv|m4v|webm|avi|mts|m2ts|mxf)$/i,
  AUDIO = /\.(wav|mp3|m4a|aac|flac)$/i;
export const playsDirect = (file, vcodec) => /\.(mp4|mov|m4v|webm)$/i.test(file) && /^(h264|hevc|av1|vp8|vp9)$/.test(vcodec ?? "");
const isFootage = (f) => VIDEO.test(f) || AUDIO.test(f);
const mediaFile = (p) => path.join(p.path, "media.json");
export function readMedia(p) {
  try {
    return JSON.parse(fs.readFileSync(mediaFile(p), "utf8")).media ?? [];
  } catch {
    return [];
  }
}
function writeMedia(p, list) {
  fs.writeFileSync(mediaFile(p), JSON.stringify({ media: list }, null, 1) + "\n");
}
const same = (a, b) =>
  process.platform === "win32" || process.platform === "darwin"
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
let notify = () => {};
export const onMediaEvent = (fn) => {
  notify = fn;
};
export function update(projectId, mediaId, patch) {
  const p = getPersonal(projectId),
    list = readMedia(p),
    m = list.find((x) => x.id === mediaId);
  if (!m) return;
  Object.assign(m, patch);
  writeMedia(p, list);
  notify({ projectId, media: m });
}
export async function addMedia(projectId, files, role) {
  const p = getPersonal(projectId),
    list = readMedia(p),
    added = [];
  for (const f of files) {
    if (!isFootage(f) || !fs.existsSync(f)) throw new Error(`${path.basename(f)} is not a video or audio file.`);
    if (list.some((m2) => same(m2.file, f))) continue;
    const pr = await probe(f);
    if (!pr.duration) throw new Error(`${path.basename(f)} has no length (is it a finished recording?).`);
    const m = {
      id: uid("m_"),
      file: path.resolve(f),
      name: path.basename(f),
      role: role ?? "other",
      duration: pr.duration,
      width: pr.width,
      height: pr.height,
      fps: pr.fps,
      vcodec: pr.vcodec,
      audio: pr.audio,
      size: pr.size,
      proxy: null,
      proxyState: !pr.width ? "none" : playsDirect(f, pr.vcodec) ? "direct" : "pending",
    };
    list.push(m);
    added.push(m);
  }
  if (!role) guessRoles(list, added);
  writeMedia(p, list);
  for (const m of added) if (m.proxyState === "pending") queueProxy(projectId, m.id);
  return list;
}
function guessRoles(list, added) {
  const named = (m, re) => re.test(m.name);
  for (const m of added) if (named(m, /intro/i)) m.role = "intro";
  const hasScreen = list.some((m) => m.role === "screen" && !added.includes(m));
  const pool = added.filter((m) => m.role === "other" && m.width);
  const camera = (m) => named(m, /cam|dsc|fx\d|gh\d|img_|mvi|^c\d{4}|^gx\d|^dji/i);
  const screenish = pool.filter(
    (m) => named(m, /screen|record|obs|display|capture|desktop/i) || named(m, /^\d{4}-\d{2}-\d{2}[ _]\d{2}-\d{2}-\d{2}/),
  );
  if (!hasScreen) {
    const longest = (a, b) => b.duration - a.duration,
      voiced = pool.filter((m) => m.audio);
    const pick = screenish[0] ?? voiced.filter((m) => !camera(m)).sort(longest)[0] ?? voiced.sort(longest)[0];
    if (pick && (screenish.length || pool.length > 1 || !camera(pick))) pick.role = "screen";
    for (const m of screenish) m.role = "screen";
  }
  for (const m of pool) if (m.role === "other") m.role = "facecam";
  for (const m of added) if (m.role === "other" && !m.width) m.role = "other";
}
export function setRole(projectId, mediaId, role) {
  const p = getPersonal(projectId),
    list = readMedia(p);
  if (role === "intro") {
    for (const m2 of list) if (m2.role === "intro" && m2.id !== mediaId && !m2.derived) m2.role = "other";
  }
  const m = list.find((x) => x.id === mediaId);
  if (!m) throw new Error("That file is not in this video.");
  m.role = role;
  writeMedia(p, list);
  return list;
}
export function removeMedia(projectId, mediaId) {
  const p = getPersonal(projectId),
    list = readMedia(p),
    m = list.find((x) => x.id === mediaId);
  const job = jobs.get(mediaId);
  if (job) cancel(job);
  if (m?.proxy) fs.rmSync(path.join(p.path, m.proxy), { force: true });
  writeMedia(
    p,
    list.filter((x) => x.id !== mediaId),
  );
  return readMedia(p);
}
export async function addDerived(projectId, file, role, name) {
  const p = getPersonal(projectId),
    pr = await probe(file);
  const list = readMedia(p).filter((m2) => !(m2.derived && m2.role === role));
  const direct = !!pr.width && playsDirect(file, pr.vcodec);
  const m = {
    id: uid("m_"),
    file: path.resolve(file),
    name,
    role,
    duration: pr.duration,
    width: pr.width,
    height: pr.height,
    fps: pr.fps,
    vcodec: pr.vcodec,
    audio: pr.audio,
    size: pr.size,
    proxy: null,
    proxyState: direct ? "direct" : pr.width ? "pending" : "none",
    derived: true,
  };
  list.push(m);
  writeMedia(p, list);
  if (m.proxyState === "pending") queueProxy(projectId, m.id);
  return m;
}
