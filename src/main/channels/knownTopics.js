import path from "node:path";
import fs from "node:fs";
import { q } from "../db/db";
import { getChannel as getChannel$1 } from "./channels";
import { formatOfDuration } from "./youtubeReader";
import { getChannel, readHow, sync, ytDir } from "./youtubeSync";

export const ofFormat = (v, f) => f === "both" || !v.f || v.f === f;
export const formatWord = (f) => (f === "long" ? "long-form videos" : f === "short" ? "Shorts" : "videos");
const file = (yt) => path.join(ytDir(yt), "known-videos.json");
function readKnown(yt) {
  let j = null;
  try {
    j = JSON.parse(fs.readFileSync(file(yt), "utf8"));
  } catch {}
  const videos = Array.isArray(j?.videos) ? j.videos : [];
  for (const v of videos) if (!v.f && v.dur != null) v.f = formatOfDuration(v.dur);
  return { videos, topics: Array.isArray(j?.topics) ? j.topics : [], lastRun: j?.lastRun ?? null };
}
function write(yt, k) {
  fs.mkdirSync(path.dirname(file(yt)), { recursive: true });
  const tmp = file(yt) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(k));
  fs.renameSync(tmp, file(yt));
}
export const testFeed = new Map();
export const testLast = { prompt: "" };
const fmtOf = (format, dur) => (format === "long" || format === "short" ? format : formatOfDuration(dur));
function loaded(yt) {
  const fake = testFeed.get(yt);
  if (fake) return fake.map((v) => ({ id: v.id, t: v.title, at: v.at ?? null, dur: null, desc: null }));
  return q
    .all(
      "SELECT id, title, COALESCE(published_at, publish_at, uploaded_at) AS at, duration, description, format, ago FROM yt_videos WHERE channel_id=?",
      yt,
    )
    .map((v) => ({
      id: String(v.id),
      t: String(v.title),
      at: v.at ?? null,
      dur: v.duration ?? null,
      desc: v.description ? String(v.description).slice(0, 200) : null,
      f: fmtOf(v.format, v.duration),
      ago: v.ago ?? null,
    }));
}
export function liveIds(yt, f = "both") {
  const fake = testFeed.get(yt);
  if (fake) return new Set(fake.map((v) => v.id));
  return new Set(
    q
      .all("SELECT id, format, duration FROM yt_videos WHERE channel_id=? AND gone=0 AND COALESCE(privacy, 'public')='public'", yt)
      .filter((v) => ofFormat({ f: fmtOf(v.format, v.duration) }, f))
      .map((v) => String(v.id)),
  );
}
export function mergeKnown(yt, run = false) {
  const k = readKnown(yt),
    by = new Map(k.videos.map((v) => [v.id, v])),
    now = new Date().toISOString(),
    since = k.lastRun?.at ?? "";
  let added = 0;
  for (const v of loaded(yt)) {
    const had = by.get(v.id);
    if (had) {
      if (v.t) had.t = v.t;
      had.at = v.at ?? had.at;
      had.dur = v.dur ?? had.dur;
      had.desc = v.desc ?? had.desc;
      had.f = v.f ?? had.f ?? null;
      had.ago = v.ago ?? had.ago ?? null;
      delete had.found;
    } else {
      by.set(v.id, { ...v, first: now });
      added++;
    }
  }
  k.videos = [...by.values()].sort((a, b) => String(b.at ?? b.first).localeCompare(String(a.at ?? a.first)));
  if (run) k.lastRun = { at: now, total: k.videos.length, added: k.videos.filter((v) => v.first > since).length, prev: since };
  write(yt, k);
  return { known: k, added, since };
}
export function addFound(yt, hits) {
  if (!hits.length) return 0;
  const k = readKnown(yt),
    have = new Set(k.videos.map((v) => v.id)),
    now = new Date().toISOString();
  let n = 0;
  for (const h of hits)
    if (!have.has(h.id)) {
      k.videos.push({ id: h.id, t: h.title, at: null, dur: null, desc: null, first: now, f: h.format, found: "search" });
      have.add(h.id);
      n++;
    }
  if (n) write(yt, k);
  return n;
}
const liveNote = (known, live) => (live !== known ? `${live} on the channel now, ` : "");
export function knownLine(k, f, since, yt) {
  const vs = k.videos.filter((v) => ofFormat(v, f)),
    fresh = vs.filter((v) => v.first > since).length;
  const live = yt ? liveIds(yt, f) : null,
    on = live ? vs.filter((v) => live.has(v.id)).length : vs.length;
  return { count: vs.length, fresh, text: `Known ${formatWord(f)}: ${vs.length} (${liveNote(vs.length, on)}${fresh} new since last run)` };
}
export function readNote(yt) {
  const r = readHow(yt);
  if (r?.how === "page") return { how: "page", text: "Read from the channel's Videos and Shorts tabs" };
  if (r?.how === "feed")
    return {
      how: "feed",
      text: "Only the newest 15 videos could be read - add a YouTube API key or sign in with Google in Settings > YouTube for the full list",
    };
  return null;
}
export function addTopics(yt, titles) {
  if (!titles.length) return;
  const k = readKnown(yt),
    at = new Date().toISOString(),
    have = new Set(k.topics.map((x) => x.t.toLowerCase()));
  for (const t of titles)
    if (!have.has(t.toLowerCase())) {
      k.topics.push({ t, at });
      have.add(t.toLowerCase());
    }
  write(yt, k);
}
export function pastTopics(yt, channelId) {
  const out = new Map();
  for (const x of readKnown(yt).topics) out.set(x.t.toLowerCase(), x.t);
  try {
    for (const r of q.all(
      `SELECT label FROM routine_items WHERE status NOT IN ('failed','cancelled','skipped','rejected') AND label IS NOT NULL
      AND (json_extract(context,'$.ytChannel')=? OR (? IS NOT NULL AND json_extract(context,'$.channelId')=?))`,
      yt,
      channelId,
      channelId,
    ))
      out.set(String(r.label).toLowerCase(), String(r.label));
  } catch {}
  return [...out.values()];
}
function ytFor(ytChannel, channelId) {
  if (ytChannel) return ytChannel;
  try {
    return channelId ? (getChannel$1(channelId).yt_channel_id ?? "") : "";
  } catch {
    return "";
  }
}
export async function knownView(ytChannel, channelId, refresh2, format = "both") {
  const yt = ytFor(ytChannel, channelId);
  if (!yt) return null;
  let error = null;
  if (refresh2) {
    if (!testFeed.has(yt))
      try {
        await sync(yt, true);
      } catch (e) {
        error = String(e?.message ?? e);
      }
    mergeKnown(yt);
  } else if (!readKnown(yt).videos.length) mergeKnown(yt);
  const k = readKnown(yt),
    since = k.lastRun?.at ?? "",
    vs = k.videos.filter((v) => ofFormat(v, format));
  const live = liveIds(yt),
    onChannel = vs.filter((v) => live.has(v.id)).length;
  const longs = k.videos.filter((v) => v.f === "long" && live.has(v.id)).length,
    shorts = k.videos.filter((v) => v.f === "short" && live.has(v.id)).length;
  let state = "ok",
    readError = null;
  if (!testFeed.has(yt))
    try {
      const c = getChannel(yt);
      if (c.readFailed) {
        state = "failed";
        readError = c.error;
      } else if (!c.fetchedAt && !k.videos.length) state = "never";
    } catch {
      state = "never";
    }
  return {
    yt,
    total: vs.length,
    onChannel,
    state,
    readError,
    all: k.videos.length,
    longs,
    shorts,
    format,
    word: formatWord(format),
    // the last run's new ones of this format (a list saved before formats were kept: its own count)
    lastRun: k.lastRun
      ? {
          ...k.lastRun,
          added: k.lastRun.prev !== void 0 ? vs.filter((v) => v.first > k.lastRun.prev && v.first <= k.lastRun.at).length : k.lastRun.added,
        }
      : null,
    foundSince: k.lastRun ? vs.filter((v) => v.first > since).length : 0,
    topics: k.topics.length,
    error,
    read: readNote(yt),
    videos: vs.map((v) => ({ t: v.t, at: v.at ? String(v.at).slice(0, 10) : (v.ago ?? null), f: v.f ?? null, live: live.has(v.id) })),
  };
}
