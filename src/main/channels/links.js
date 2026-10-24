import path from "node:path";
import { now, q } from "../db/db";
import { listProjects } from "../projects/projects";
import { pipelineOf, setPublishInfo } from "./channels";
import { Matcher, pairs, prep } from "./titleMatch";
import { changed, send, statusOf, videoView } from "./youtubeSync";

const projectsForLinks = () =>
  listProjects()
    .filter((p) => !p.lab)
    .map((p) => ({ id: p.id, name: p.name, kind: p.kind, channel_id: p.channel_id, created: p.created_at, title: prep(p.name) }));
function apart() {
  const yt = new Map(q.all("SELECT id, yt_channel_id FROM channels").map((c) => [c.id, c.yt_channel_id]));
  const of = new Map(q.all("SELECT id, yt_channel_id FROM channels WHERE yt_channel_id IS NOT NULL").map((c) => [c.yt_channel_id, c.id]));
  return (projectChannel, ytChannel) => {
    const mine = projectChannel ? (yt.get(projectChannel) ?? null) : null,
      theirs = of.get(ytChannel) ?? null;
    return (!!mine && mine !== ytChannel) || (!!theirs && !!projectChannel && theirs !== projectChannel);
  };
}
const UNLIKELY = 0.45;
function ownYt() {
  const s = new Set(q.all("SELECT yt_channel_id FROM channels WHERE yt_channel_id IS NOT NULL").map((r) => r.yt_channel_id));
  for (const r of q.all("SELECT id FROM yt_channels WHERE access='oauth'")) s.add(r.id);
  return s;
}
function linkMatches(projects = projectsForLinks()) {
  const own = ownYt(),
    far = apart();
  const videos = q
    .all(
      "SELECT id, title, channel_id, project_id, COALESCE(published_at, publish_at, uploaded_at, fetched_at) AS at FROM yt_videos WHERE gone=0",
    )
    .filter((v) => own.has(v.channel_id))
    .map((v) => ({ id: v.id, title: prep(v.title), channel_id: v.channel_id, project_id: v.project_id, at: v.at ?? "" }));
  const m = new Matcher([...videos.map((v) => v.title), ...projects.map((p) => p.title)]);
  const all = pairs(m, videos, projects, 0.2).filter((x) => !far(x.p.channel_id, x.v.channel_id));
  const bestV = new Map(),
    bestP = new Map(),
    likely = new Set();
  for (const x of all) {
    bestV.set(x.p.id, Math.max(bestV.get(x.p.id) ?? 0, x.s));
    bestP.set(x.v.id, Math.max(bestP.get(x.v.id) ?? 0, x.s));
  }
  for (const x of all) if (x.close && x.s >= bestV.get(x.p.id) - 1e-9 && x.s >= bestP.get(x.v.id) - 1e-9) likely.add(`${x.v.id} ${x.p.id}`);
  return { m, all, own, far, isLikely: (videoId, projectId) => likely.has(`${videoId} ${projectId}`) };
}
export function suggestAll(videos, ytId, linkedChannel) {
  const out = new Map();
  if (!videos.length || !ownYt().has(ytId)) return out;
  const want = new Set(videos.map((v) => v.id)),
    at = new Map(videos.map((v) => [v.id, v.publishedAt ?? v.publishAt ?? v.uploadedAt ?? ""]));
  const linked = new Set(q.all("SELECT project_id FROM yt_videos WHERE project_id IS NOT NULL AND gone=0").map((r) => r.project_id));
  const L = linkMatches();
  const cand = L.all
    .filter((x) => want.has(x.v.id) && !linked.has(x.p.id) && L.isLikely(x.v.id, x.p.id))
    .sort(
      (a, b) =>
        b.s - a.s ||
        +(b.p.channel_id === linkedChannel) - +(a.p.channel_id === linkedChannel) ||
        (at.get(b.v.id) ?? "").localeCompare(at.get(a.v.id) ?? ""),
    );
  const usedP = new Set();
  for (const x of cand) {
    if (out.has(x.v.id) || usedP.has(x.p.id)) continue;
    out.set(x.v.id, { projectId: x.p.id, name: x.p.name, score: x.s });
    usedP.add(x.p.id);
  }
  return out;
}
export function projectChoices(v) {
  const linkedCh = q.get("SELECT id FROM channels WHERE yt_channel_id=?", v.channel_id)?.id ?? null;
  const taken = new Map(
    q.all("SELECT project_id, id, title FROM yt_videos WHERE project_id IS NOT NULL AND gone=0").map((r) => [r.project_id, r]),
  );
  const chName = new Map(q.all("SELECT id, name FROM channels").map((c) => [c.id, c.name]));
  const projects = projectsForLinks(),
    L = linkMatches(projects),
    mine = L.own.has(v.channel_id) && !v.gone;
  const vt = prep(v.title),
    sOf = new Map();
  if (mine) {
    for (const x of L.all) if (x.v.id === v.id) sOf.set(x.p.id, x.s);
  }
  const named = new Map();
  for (const p of projects) named.set(p.name, (named.get(p.name) ?? 0) + 1);
  const twin = (id) => {
    const r = q.get("SELECT * FROM projects WHERE id=?", id);
    if (!r) return null;
    let stage = r.stage ?? null,
      length = 0;
    try {
      const c = pipelineOf(r);
      if (c && !c.lab) {
        stage = stage ?? c.auto;
        length = c.length || 0;
      }
    } catch {}
    return { stage, length, folder: path.basename(String(r.path ?? "")) };
  };
  return projects
    .map((p) => {
      const s = mine ? (sOf.get(p.id) ?? 0) : L.m.compare(vt, p.title).s,
        likely = mine && L.isLikely(v.id, p.id);
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        channelId: p.channel_id,
        channelName: p.channel_id ? (chName.get(p.channel_id) ?? null) : null,
        created: p.created,
        score: likely ? s : Math.min(UNLIKELY, s),
        likely,
        linkedTo: taken.get(p.id) && taken.get(p.id).id !== v.id ? taken.get(p.id).title : null,
        twin: (named.get(p.name) ?? 0) > 1 ? twin(p.id) : null,
      };
    })
    .sort(
      (a, b) =>
        +b.likely - +a.likely ||
        b.score - a.score ||
        +(b.channelId === linkedCh) - +(a.channelId === linkedCh) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 400);
}
export function videoChoices(projectId) {
  const p = q.get("SELECT id, name, channel_id FROM projects WHERE id=?", projectId);
  if (!p) throw new Error("That project no longer exists.");
  const ytOfChannel = p.channel_id ? (q.get("SELECT yt_channel_id FROM channels WHERE id=?", p.channel_id)?.yt_channel_id ?? null) : null;
  const L = linkMatches(),
    pt = prep(p.name),
    sOf = new Map();
  for (const x of L.all) if (x.p.id === p.id) sOf.set(x.v.id, x.s);
  const list = q
    .all(
      `SELECT v.*, p.name AS project_name, p.kind AS project_kind, c.title AS channel_title FROM yt_videos v JOIN yt_channels c ON c.id = v.channel_id
      LEFT JOIN projects p ON p.id = v.project_id WHERE v.gone=0 ORDER BY COALESCE(v.published_at, v.publish_at, v.uploaded_at, v.fetched_at) DESC LIMIT 2000`,
    )
    .map((v) => {
      const mine = L.own.has(v.channel_id),
        likely = mine && L.isLikely(v.id, p.id),
        s = mine ? (sOf.get(v.id) ?? 0) : L.m.compare(prep(v.title), pt).s;
      return { ...videoView(v), channelTitle: v.channel_title, mine, likely, score: likely ? s : Math.min(UNLIKELY, s) };
    });
  let seen = false;
  for (const v of list)
    if (v.likely) {
      if (seen) v.likely = false;
      seen = true;
    }
  const rank = (v) => (v.likely ? 3 : v.mine && v.score >= 0.3 ? 2 : v.mine ? 1 : 0);
  list.sort(
    (a, b) =>
      rank(b) - rank(a) || (rank(a) === 2 ? b.score - a.score : 0) || +(b.channelId === ytOfChannel) - +(a.channelId === ytOfChannel),
  );
  const current = list.find((v) => v.projectId === projectId) ?? null;
  return { current, videos: list, ytChannel: ytOfChannel };
}
const linkedVideoView = (id) => {
  const v = q.get("SELECT * FROM yt_videos WHERE id=?", id);
  return videoView({
    ...v,
    project_name: v.project_id ? (q.get("SELECT name FROM projects WHERE id=?", v.project_id)?.name ?? null) : null,
  });
};
export function linkVideo(videoId, projectId) {
  const v = q.get("SELECT * FROM yt_videos WHERE id=?", String(videoId));
  if (!v) throw new Error("That video is not in the app any more.");
  let joined = null;
  const undo = {
    videoId: v.id,
    projectId: projectId ? String(projectId) : null,
    videoProject: v.project_id,
    projectVideo: null,
    joined: null,
  };
  if (projectId && v.gone)
    throw new Error("That video is no longer on YouTube (it was deleted or made private), so it can't be linked to a project.");
  if (projectId) {
    const p = q.get("SELECT id, channel_id FROM projects WHERE id=?", String(projectId));
    if (!p) throw new Error("That project no longer exists.");
    undo.projectVideo = q.get("SELECT id FROM yt_videos WHERE project_id=? AND id<>?", p.id, v.id)?.id ?? null;
    q.run("UPDATE yt_videos SET project_id=NULL, linked_at=NULL WHERE project_id=? AND id<>?", p.id, v.id);
    q.run("UPDATE yt_videos SET project_id=?, linked_at=? WHERE id=?", p.id, now(), v.id);
    const ch = q.get("SELECT id, name FROM channels WHERE yt_channel_id=?", v.channel_id);
    if (ch && !p.channel_id) {
      q.run("UPDATE projects SET channel_id=? WHERE id=?", ch.id, p.id);
      joined = ch.name;
      undo.joined = ch.id;
      send("channels:changed", { what: "board" });
    }
  } else q.run("UPDATE yt_videos SET project_id=NULL, linked_at=NULL WHERE id=?", v.id);
  changed("links", v.channel_id);
  send("channels:changed", { what: "files" });
  return { video: linkedVideoView(v.id), joined, undo };
}
export function undoLink(u) {
  const v = q.get("SELECT * FROM yt_videos WHERE id=?", String(u?.videoId ?? ""));
  if (!v || !u) throw new Error("That video is not in the app any more.");
  const pid = u.projectId ? String(u.projectId) : null;
  const hasVideo = (projectId) => !!q.get("SELECT 1 FROM yt_videos WHERE project_id=?", projectId);
  const exists = (projectId) => !!q.get("SELECT 1 FROM projects WHERE id=?", projectId);
  const undone = (v.project_id ?? null) === pid;
  if (undone) {
    q.run("UPDATE yt_videos SET project_id=NULL, linked_at=NULL WHERE id=?", v.id);
    const before = u.videoProject ? String(u.videoProject) : null;
    if (before && exists(before) && !hasVideo(before))
      q.run("UPDATE yt_videos SET project_id=?, linked_at=? WHERE id=?", before, now(), v.id);
  }
  if (pid && u.projectVideo && exists(pid) && !hasVideo(pid))
    q.run("UPDATE yt_videos SET project_id=?, linked_at=? WHERE id=? AND project_id IS NULL", pid, now(), String(u.projectVideo));
  let left = null;
  if (
    pid &&
    u.joined &&
    q.get("SELECT 1 FROM projects WHERE id=? AND channel_id=?", pid, String(u.joined)) &&
    !q.get(
      "SELECT 1 FROM yt_videos v JOIN channels c ON c.yt_channel_id = v.channel_id WHERE v.project_id=? AND c.id=?",
      pid,
      String(u.joined),
    )
  ) {
    q.run("UPDATE projects SET channel_id=NULL WHERE id=?", pid);
    send("channels:changed", { what: "board" });
    left = q.get("SELECT name FROM channels WHERE id=?", String(u.joined))?.name ?? null;
  }
  changed("links", v.channel_id);
  send("channels:changed", { what: "files" });
  return { video: linkedVideoView(v.id), undone, left };
}
setPublishInfo((ids) => {
  const want = new Set(ids),
    out = new Map();
  for (const v of q.all("SELECT * FROM yt_videos WHERE project_id IS NOT NULL AND gone=0")) {
    if (!want.has(v.project_id)) continue;
    const s = statusOf(v);
    if (s === "scheduled") out.set(v.project_id, { stage: "scheduled", views: null, at: v.publish_at });
    else if (s === "published" || s === "unlisted")
      out.set(v.project_id, { stage: "published", views: v.views, at: v.published_at ?? v.publish_at ?? v.uploaded_at });
  }
  return out;
});
