import path from "node:path";
import fs from "node:fs";
import { ws } from "../core/workspace";
import { log } from "../core/log";
import { now, q } from "../db/db";
import { isPremium } from "../app/plan";
import {
  checkChannel,
  createChannel,
  getChannel as getChannel$1,
  listChannels as listChannels$1,
  normalizeHandle,
  setAvatar,
} from "./channels";
import {
  SCOPE_ANALYTICS,
  SignedOut,
  accessToken,
  apiKey,
  base,
  dropAccess,
  forgetToken,
  getJson,
  grantedAnalytics,
  hasToken,
  revoke,
  revokeToken,
  setSharedCheck,
  signIn,
  storeToken,
  tokenExpires,
  tokenOf,
} from "./youtubeAuth";
import { durSeconds, formatOfDuration, isRealYoutube, pageBase, readChannel } from "./youtubeReader";
import { projectChoices, suggestAll } from "./links";
import { serverUrl } from "../projects/fileServer";

export const ytDir = (id) => path.join(ws.root(), "youtube", String(id).replace(/[^\w-]/g, ""));
export let send = () => {};
export const setSender = (fn) => {
  send = fn;
};
export const changed = (what, channelId) => send("youtube:changed", { what, channelId });
const progress = (channelId, state, step, error) => send("youtube:sync", { channelId, state, step, error });
const MAX_PAGES = 40;
const DETAIL_TTL = 6 * 36e5;
const day = (d) => d.toISOString().slice(0, 10);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const row = (id) => q.get("SELECT * FROM yt_channels WHERE id=?", id);
function need(id) {
  const r = row(id);
  if (!r) throw new Error("That YouTube channel is not in the app any more.");
  return r;
}
function parseChannelInput(raw) {
  let s = String(raw ?? "").trim();
  if (!s) throw new Error("Type the channel's @handle, its address or its channel ID.");
  try {
    s = decodeURIComponent(s);
  } catch {}
  if (/[?&]v=|youtu\.be\/|\/shorts\/|\/watch/i.test(s))
    throw new Error("That is a link to a video. Paste the channel's address (open the channel, copy the address) or its @handle.");
  const id = /(?:^|\/channel\/)(UC[\w-]{22})(?:[/?#]|$)/.exec(s);
  if (id) return { id: id[1] };
  const at =
    /(?:^|youtube\.com\/|\s)@([\p{L}\p{M}\p{N}_.\-·]{1,30})(?:[/?#\s]|$)/u.exec(s) ?? /^@?([\p{L}\p{M}\p{N}_.\-·]{3,30})$/u.exec(s);
  if (at && !/\//.test(at[1])) return { handle: at[1] };
  const user = /youtube\.com\/user\/([\w.-]+)/i.exec(s);
  if (user) return { username: user[1] };
  if (/youtube\.com\/c\//i.test(s))
    throw new Error(
      "YouTube no longer finds channels by that kind of address. Use the channel's @handle (under its name on YouTube) or its channel ID (it starts with UC).",
    );
  if (/\s/.test(s) && !/[/.]/.test(s))
    throw new Error(
      "YouTube can't find a channel by its name. Use its @handle (under the name on YouTube, like @mychannel), its address or its channel ID (UC…).",
    );
  throw new Error("That is not a YouTube channel. Use its @handle (like @mychannel), its address, or its channel ID (UC…).");
}
async function authFor(r, ownerOnly = false) {
  if (r && hasToken(r.id)) {
    try {
      return { bearer: await accessToken(r.id), owner: true, channel: r.id };
    } catch (e) {
      if (!(e instanceof SignedOut)) throw e;
      signedOut(r.id, e.message);
      if (ownerOnly) throw e;
    }
  }
  if (ownerOnly) throw new SignedOut("This channel is not signed in with Google.");
  const key2 = apiKey();
  if (key2) return { key: key2, owner: false };
  for (const o of q.all("SELECT id FROM yt_channels"))
    if (hasToken(o.id))
      try {
        return { bearer: await accessToken(o.id), owner: false, channel: o.id };
      } catch (e) {
        if (e instanceof SignedOut) signedOut(o.id, e.message);
      }
  return { owner: false, keyless: true };
}
export function readHow(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ytDir(id), "read.json"), "utf8"));
  } catch {
    return null;
  }
}
function setReadHow(id, r) {
  try {
    fs.mkdirSync(ytDir(id), { recursive: true });
    fs.writeFileSync(path.join(ytDir(id), "read.json"), JSON.stringify(r));
  } catch {}
}
const thumbOf = (videoId) => (isRealYoutube() ? "https://i.ytimg.com/vi/" : pageBase() + "/vi/") + videoId + "/mqdefault.jpg";
const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
  "Accept-Language": "en",
};
const unesc = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
async function pageChannel(t) {
  const B = pageBase(),
    url = t.id
      ? `${B}/channel/${t.id}`
      : t.handle
        ? `${B}/@${encodeURIComponent(t.handle)}`
        : `${B}/user/${encodeURIComponent(t.username)}`;
  const r = await fetch(url, { headers: { ...UA, Cookie: "CONSENT=YES+1; SOCS=CAI" }, signal: AbortSignal.timeout(2e4) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`YouTube did not answer (${r.status}). Try again in a minute.`);
  const html = await r.text();
  const id =
    /<meta itemprop="identifier" content="(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1];
  if (!id) return null;
  const meta = (p) => {
    const m = new RegExp(`<meta property="${p}" content="([^"]*)"`).exec(html);
    return m ? unesc(m[1]) : null;
  };
  const handle = /"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]+)"/.exec(html)?.[1] ?? (t.handle ? "@" + t.handle : null);
  const avatar = meta("og:image");
  return {
    id,
    snippet: {
      title: meta("og:title") ?? "YouTube channel",
      description: meta("og:description"),
      customUrl: handle,
      thumbnails: avatar ? { medium: { url: avatar } } : {},
    },
    statistics: {},
    contentDetails: {},
  };
}
async function feedVideos(channelId, stop) {
  const r = await fetch(`${pageBase()}/feeds/videos.xml?channel_id=${channelId}`, {
    headers: UA,
    signal: stop ? AbortSignal.any([AbortSignal.timeout(2e4), stop]) : AbortSignal.timeout(2e4),
  });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`YouTube did not send the channel's videos (${r.status}). Try again in a minute.`);
  const xml = await r.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, e]) => {
      const tag = (n) => {
        const m = new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`).exec(e);
        return m ? unesc(m[1]) : null;
      };
      return {
        id: tag("yt:videoId"),
        snippet: {
          title: tag("title"),
          description: tag("media:description"),
          publishedAt: tag("published"),
          thumbnails: { high: { url: /<media:thumbnail url="([^"]+)"/.exec(e)?.[1] ?? null } },
        },
        statistics: { viewCount: /<media:statistics views="(\d+)"/.exec(e)?.[1] },
        status: {},
        contentDetails: {},
      };
    })
    .filter((v) => typeof v.id === "string" && v.id);
}
async function withRetry(a, go) {
  try {
    return await go();
  } catch (e) {
    if (e?.status !== 401 || !a.channel) throw e;
    dropAccess(a.channel);
    try {
      a.bearer = await accessToken(a.channel);
    } catch (x) {
      if (x instanceof SignedOut) signedOut(a.channel, x.message);
      throw x;
    }
    return go();
  }
}
function signedOut(id, why) {
  forgetToken(id);
  q.run("UPDATE yt_channels SET analytics=0, error=? WHERE id=?", `Signed out: ${why}`, id);
  changed("channels", id);
}
const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== void 0 && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
const commentsAuth = () => {
  const key2 = apiKey();
  return key2 ? { key: key2, owner: false } : null;
};
const data = (p, params, a) =>
  withRetry(a, () => getJson(`${base("data")}/youtube/v3/${p}?${qs({ ...params, key: a.key })}`, "data", a.bearer));
async function report(params, a) {
  const r = await withRetry(a, () => getJson(`${base("analytics")}/v2/reports?${qs(params)}`, "analytics", a.bearer));
  const cols = (r.columnHeaders ?? []).map((c) => String(c.name));
  return (r.rows ?? []).map((x) => Object.fromEntries(cols.map((c, i) => [c, x[i]])));
}
const HOSTS = /^(i\d?\.ytimg\.com|yt\d?\.ggpht\.com|yt\d?\.googleusercontent\.com|lh\d\.googleusercontent\.com)$/i;
async function download(url, file, stop) {
  if (!url) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const mock = process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_YOUTUBE_BASE && url.startsWith(process.env.CZ_YOUTUBE_BASE);
  if (!mock && (u.protocol !== "https:" || !HOSTS.test(u.hostname))) {
    log("youtube picture from an unexpected host skipped", u.hostname);
    return false;
  }
  try {
    const r = await fetch(url, { signal: stop ? AbortSignal.any([AbortSignal.timeout(2e4), stop]) : AbortSignal.timeout(2e4) });
    if (!r.ok || !/^image\//.test(r.headers.get("content-type") || "image/")) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 5 * 1024 * 1024) return false;
    try {
      if (buf.equals(fs.readFileSync(file))) return "same";
    } catch {}
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".part", buf);
    fs.renameSync(file + ".part", file);
    return "new";
  } catch (e) {
    log("youtube picture download failed", url.slice(0, 120), e?.message);
    return false;
  }
}
const thumbChecked = new Map();
const RECHECK_NEWEST = 50,
  RECHECK_MS = 12 * 36e5;
const fileUrl = (channelId, rel) => {
  if (!rel) return null;
  try {
    return `${serverUrl()}/yt/${channelId}/${rel}?v=${Math.round(fs.statSync(path.join(ytDir(channelId), rel)).mtimeMs)}`;
  } catch {
    return null;
  }
};
const avatarFile = (id) => path.join(ytDir(id), "avatar.jpg");
const wantsPic = new Map(),
  picJobs = new Map();
function getAvatar(id, url, stop) {
  let job = picJobs.get(id);
  if (!job) {
    job = download(url, avatarFile(id), stop)
      .then((got) => {
        if (got === "same")
          try {
            const t = new Date();
            fs.utimesSync(avatarFile(id), t, t);
          } catch {}
        if (got && row(id)) {
          q.run("UPDATE yt_channels SET avatar='avatar.jpg' WHERE id=?", id);
          givePic(id, got === "new");
        }
        return !!got;
      })
      .finally(() => picJobs.delete(id));
    picJobs.set(id, job);
  }
  return job;
}
function givePic(ytId, changed2) {
  const waiting = wantsPic.get(ytId);
  wantsPic.delete(ytId);
  for (const c of q.all("SELECT id, avatar, settings FROM channels WHERE yt_channel_id=?", ytId)) {
    let fromYt = false;
    try {
      fromYt = JSON.parse(c.settings || "{}")?.picFromYt === ytId;
    } catch {}
    if (!(c.id === waiting && !c.avatar) && !(changed2 && fromYt)) continue;
    try {
      setAvatar(c.id, avatarFile(ytId), ytId);
      send("channels:changed", { what: "channels" });
    } catch (e) {
      log("channel picture from YouTube not taken", e?.message);
    }
  }
}
const FAILED = "Not read: ";
function view(r) {
  const signedIn = hasToken(r.id);
  const counts = q.get("SELECT COUNT(*) AS n, SUM(project_id IS NOT NULL) AS linked FROM yt_videos WHERE channel_id=? AND gone=0", r.id);
  const linkedChannelId = q.get("SELECT id FROM channels WHERE yt_channel_id=?", r.id)?.id ?? null;
  return {
    id: r.id,
    title: r.title,
    handle: r.handle,
    description: r.description,
    avatarUrl: fileUrl(r.id, r.avatar),
    access: r.access,
    signedIn,
    analytics: signedIn && !!r.analytics && grantedAnalytics(r.id),
    subs: r.subs,
    views: r.views,
    videos: r.videos,
    hiddenSubs: !!r.hidden_subs,
    fetchedAt: r.fetched_at,
    analyticsAt: r.analytics_at,
    error: r.error?.startsWith(FAILED) ? r.error.slice(FAILED.length) : r.error,
    readFailed: !!r.error?.startsWith(FAILED),
    linkedChannelId,
    expires: signedIn ? tokenExpires(r.id) : null,
    syncing: syncing.has(r.id),
    created: r.created,
    videoCount: counts?.n ?? 0,
    linkedVideos: counts?.linked ?? 0,
    // one of the user's own channels (linked to one of theirs, or signed in with Google), not a creator followed to learn from
    own: r.access === "oauth" || !!linkedChannelId,
  };
}
export const listChannels = () => q.all("SELECT * FROM yt_channels ORDER BY sort, added_at").map(view);
export const getChannel = (id) => view(need(id));
function upsertChannel(item, access) {
  const sn = item?.snippet ?? {},
    st = item?.statistics ?? {},
    cd = item?.contentDetails ?? {};
  const id = String(item?.id ?? "");
  if (!/^UC[\w-]{22}$/.test(id)) throw new Error("YouTube sent a channel the app could not read.");
  const handle =
    typeof sn.customUrl === "string" && sn.customUrl ? (sn.customUrl.startsWith("@") ? sn.customUrl : "@" + sn.customUrl) : null;
  const avatarUrl = sn.thumbnails?.medium?.url ?? sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null;
  const t = now(),
    hidden = st.hiddenSubscriberCount ? 1 : 0;
  const sort = (q.get("SELECT MAX(sort) AS m FROM yt_channels")?.m ?? -1) + 1;
  q.run(
    `INSERT INTO yt_channels(id,title,handle,description,avatar_url,uploads,created,subs,views,videos,hidden_subs,access,sort,added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, handle=excluded.handle, description=excluded.description, avatar_url=excluded.avatar_url, uploads=COALESCE(excluded.uploads, uploads),
    created=COALESCE(excluded.created, created), subs=excluded.subs, views=excluded.views, videos=excluded.videos, hidden_subs=excluded.hidden_subs${access ? ", access=excluded.access" : ""}`,
    id,
    String(sn.title ?? "YouTube channel").slice(0, 200),
    handle,
    sn.description ? String(sn.description).slice(0, 2e3) : null,
    avatarUrl,
    cd.relatedPlaylists?.uploads ?? null,
    sn.publishedAt ?? null,
    hidden ? null : num(st.subscriberCount),
    num(st.viewCount),
    num(st.videoCount),
    hidden,
    access ?? "public",
    sort,
    t,
  );
  q.run(
    "INSERT OR REPLACE INTO yt_snapshots(channel_id,day,subs,views,videos) VALUES(?,?,?,?,?)",
    id,
    day(new Date()),
    hidden ? null : num(st.subscriberCount),
    num(st.viewCount),
    num(st.videoCount),
  );
  return id;
}
export async function addChannel(input) {
  const target = parseChannelInput(input),
    a = await authFor(null);
  const r = a.keyless
    ? { items: [await pageChannel(target)].filter(Boolean) }
    : await data(
        "channels",
        {
          part: "snippet,statistics,contentDetails",
          ...(target.id ? { id: target.id } : target.handle ? { forHandle: "@" + target.handle } : { forUsername: target.username }),
          maxResults: 1,
        },
        a,
      );
  const item = r?.items?.[0];
  if (!item)
    throw new Error(
      target.handle
        ? `YouTube has no channel with the handle @${target.handle}. Check the spelling: it is under the channel's name on YouTube.`
        : target.id
          ? `YouTube has no channel with the ID ${target.id}.`
          : `YouTube has no channel called ${target.username}.`,
    );
  const existed = !!row(item.id);
  const id = upsertChannel(item);
  changed("channels", id);
  return { channel: getChannel(id), existed };
}
export async function signInChannel(upload = false) {
  const res = await signIn(upload);
  const r = await data(
    "channels",
    { part: "snippet,statistics,contentDetails", mine: "true", maxResults: 50 },
    { bearer: res.accessToken, owner: true },
  );
  const items = r?.items ?? [];
  if (!items.length) {
    await revokeToken(res.refresh);
    throw new Error(
      "This Google account has no YouTube channel. Sign in again and pick the account (or brand account) that owns the channel.",
    );
  }
  const ids = items.map((it) => {
    const id = upsertChannel(it, "oauth");
    storeToken(id, res);
    q.run("UPDATE yt_channels SET error=NULL, analytics=? WHERE id=?", res.scope.split(/\s+/).includes(SCOPE_ANALYTICS) ? 1 : 0, id);
    return id;
  });
  changed("channels");
  return { channels: ids.map(getChannel), analytics: res.scope.split(/\s+/).includes(SCOPE_ANALYTICS) };
}
setSharedCheck((refresh2, except) =>
  q.all("SELECT id FROM yt_channels WHERE id<>?", except).some((o) => tokenOf(o.id)?.refresh === refresh2),
);
export async function disconnect(id) {
  need(id);
  reads.get(id)?.abort();
  await syncing.get(id)?.catch(() => {});
  await revoke(id);
  q.run("UPDATE yt_channels SET access='public', analytics=0, analytics_at=NULL, error=NULL WHERE id=?", id);
  q.run("DELETE FROM yt_daily WHERE channel_id=?", id);
  q.run(
    "UPDATE yt_videos SET minutes=NULL, avg_duration=NULL, avg_pct=NULL, subs_gained=NULL, retention=NULL, traffic=NULL, detail_at=NULL WHERE channel_id=?",
    id,
  );
  changed("channels", id);
  changed("data", id);
  return getChannel(id);
}
export async function removeChannel(id) {
  need(id);
  removing.add(id);
  try {
    reads.get(id)?.abort();
    await syncing.get(id)?.catch(() => {});
    await revoke(id);
    const linked = q.get("SELECT COUNT(*) AS n FROM yt_videos WHERE channel_id=? AND project_id IS NOT NULL", id)?.n ?? 0;
    q.run("UPDATE channels SET yt_channel_id=NULL WHERE yt_channel_id=?", id);
    q.run("DELETE FROM yt_channels WHERE id=?", id);
    try {
      fs.rmSync(ytDir(id), { recursive: true, force: true });
    } catch {}
    changed("channels", id);
    if (linked) send("channels:changed", { what: "files" });
    return { linked };
  } finally {
    removing.delete(id);
  }
}
export function reorder(ids) {
  (Array.isArray(ids) ? ids : []).forEach((id, i) => q.run("UPDATE yt_channels SET sort=? WHERE id=?", i, String(id)));
  changed("channels");
  return listChannels();
}
export function linkChannel(ytId, channelId) {
  need(ytId);
  const ch = checkChannel(channelId);
  q.run("UPDATE channels SET yt_channel_id=NULL WHERE yt_channel_id=?", ytId);
  if (ch) q.run("UPDATE channels SET yt_channel_id=?, updated_at=? WHERE id=?", ytId, now(), ch);
  changed("channels", ytId);
  send("channels:changed", { what: "channels" });
  return getChannel(ytId);
}
export function linkSuggestion(ytId) {
  const y = need(ytId);
  const taken = (cid) => {
    const v = q.get("SELECT yt_channel_id FROM channels WHERE id=?", cid)?.yt_channel_id;
    return !!v && v !== ytId;
  };
  const all = listChannels$1().filter((c) => !taken(c.id));
  return (
    (y.handle && all.find((c) => c.handle?.toLowerCase() === y.handle.toLowerCase())?.id) ||
    all.find((c) => c.name.trim().toLowerCase() === y.title.trim().toLowerCase())?.id ||
    null
  );
}
export function channelFrom(ytId) {
  const y = need(ytId);
  const existing = linkSuggestion(ytId);
  if (existing) {
    linkChannel(ytId, existing);
    return getChannel$1(existing);
  }
  let handle = null;
  try {
    handle = normalizeHandle(y.handle);
  } catch {
    handle = null;
  }
  if (handle && q.get("SELECT id FROM channels WHERE lower(handle)=lower(?)", handle)) handle = null;
  let name = y.title.replace(/\s+/g, " ").trim().slice(0, 80) || "YouTube channel";
  for (let i = 2; q.get("SELECT id FROM channels WHERE lower(name)=lower(?)", name); i++) name = `${y.title.slice(0, 74)} (${i})`;
  const c = createChannel({ name, handle, description: null });
  const pic = y.avatar ? path.join(ytDir(ytId), y.avatar) : null;
  linkChannel(ytId, c.id);
  if (pic && fs.existsSync(pic))
    try {
      setAvatar(c.id, pic, ytId);
    } catch (e) {
      log("channel picture from YouTube not taken", e?.message);
    }
  else if (y.avatar_url) {
    wantsPic.set(ytId, c.id);
    getAvatar(ytId, y.avatar_url).catch(() => {});
  }
  return getChannel$1(c.id);
}
const syncing = new Map(),
  reads = new Map(),
  removing = new Set();
class Stopped extends Error {}
class ToPage extends Error {}
export function sync(id, asked = false) {
  if (removing.has(id)) return Promise.reject(new Error("That YouTube channel is being removed from the app."));
  const running2 = syncing.get(id);
  if (running2) return running2;
  const ac = new AbortController();
  reads.set(id, ac);
  const p = doSync(id, ac.signal, asked).finally(() => {
    syncing.delete(id);
    reads.delete(id);
  });
  syncing.set(id, p);
  changed("channels", id);
  return p;
}
function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(iso ?? ""));
  return m ? +(m[1] || 0) * 86400 + +(m[2] || 0) * 3600 + +(m[3] || 0) * 60 + +(m[4] || 0) : null;
}
async function doSync(id, stop, asked) {
  const r0 = need(id),
    problems = [];
  const live = () => {
    if (stop.aborted || removing.has(id) || !row(id)) throw new Stopped("The read stopped: the channel is being removed.");
  };
  progress(id, "running", "Reading the channel");
  try {
    let a = await authFor(r0);
    live();
    const pub = async (go) => {
      try {
        return await go();
      } catch (e) {
        if (!(e instanceof SignedOut)) throw e;
        a = await authFor(need(id));
        if (a.keyless) throw new ToPage();
        return go();
      }
    };
    const chOf = async () =>
      a.keyless
        ? { items: [await pageChannel({ id })].filter(Boolean) }
        : await pub(() => data("channels", { part: "snippet,statistics,contentDetails", id }, a));
    const ch = await chOf().catch((e) => {
      if (e instanceof ToPage) return chOf();
      throw e;
    });
    live();
    if (!ch?.items?.[0]) throw new Error("YouTube no longer has this channel (it was deleted or hidden).");
    upsertChannel(ch.items[0]);
    let r = need(id);
    if (r.avatar_url) {
      const file = avatarFile(id);
      if (!r.avatar || !fs.existsSync(file) || r.avatar_url !== r0.avatar_url || Date.now() - fs.statSync(file).mtimeMs > 7 * 864e5) {
        await getAvatar(id, r.avatar_url, stop);
        live();
      }
    }
    progress(id, "running", "Reading the videos");
    const ids = [];
    let pageToken,
      pages = 0,
      complete = false;
    if (!a.keyless && r.uploads) {
      try {
        do {
          const pl = await pub(() =>
            data("playlistItems", { part: "contentDetails", playlistId: r.uploads, maxResults: 50, pageToken }, a),
          );
          live();
          for (const it of pl?.items ?? []) {
            const v = it?.contentDetails?.videoId;
            if (typeof v === "string" && !ids.includes(v)) ids.push(v);
          }
          pageToken = pl?.nextPageToken;
          pages++;
        } while (pageToken && pages < MAX_PAGES);
        complete = !pageToken;
      } catch (e) {
        if (e instanceof ToPage) {
          log("youtube: the sign-in ended while reading the uploads, reading the channel page instead", id);
          ids.length = 0;
        } else if (e instanceof Stopped || e.status !== 404) throw e;
        else complete = true;
      }
      if (!a.keyless) setReadHow(id, { how: "api", at: now(), count: ids.length });
    }
    let feed = null,
      tabs = null;
    if (a.keyless) {
      tabs = await readChannel({ id, handle: r.handle }, asked);
      live();
      feed = await feedVideos(id, stop).catch((e) => {
        if (!tabs.videos.length) throw e;
        log("youtube feed skipped", id, e?.message);
        return [];
      });
      live();
      if (tabs.videos.length) {
        const dated = new Map(feed.map((v) => [String(v.id), v])),
          t2 = now();
        for (const v of tabs.videos) {
          const f = dated.get(v.id),
            sn = f?.snippet ?? {};
          ids.push(v.id);
          q.run(
            `INSERT INTO yt_videos(id,channel_id,title,description,published_at,duration,thumb_url,views,format,ago,gone,fetched_at,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)
            ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id, title=excluded.title, description=COALESCE(excluded.description, description), published_at=COALESCE(excluded.published_at, published_at),
            duration=COALESCE(excluded.duration, duration), thumb=CASE WHEN thumb_url IS excluded.thumb_url THEN thumb ELSE NULL END, thumb_url=excluded.thumb_url, views=COALESCE(excluded.views, views),
            format=excluded.format, ago=excluded.ago, gone=0, fetched_at=excluded.fetched_at, uploaded_at=COALESCE(excluded.uploaded_at, uploaded_at)`,
            v.id,
            id,
            v.title.slice(0, 300),
            sn.description ? String(sn.description).slice(0, 5e3) : null,
            sn.publishedAt ?? null,
            durSeconds(v.dur),
            thumbOf(v.id),
            num(f?.statistics?.viewCount),
            v.format,
            v.ago,
            t2,
            sn.publishedAt ?? null,
          );
        }
        feed = feed.filter((v) => !ids.includes(String(v.id)));
        for (const v of feed) ids.push(String(v.id));
        setReadHow(id, { how: "page", at: t2, count: tabs.videos.length, videos: tabs.tabs.videos, shorts: tabs.tabs.shorts });
      } else {
        log("youtube: the channel tabs could not be read, only the feed (newest 15)", id, tabs.error);
        setReadHow(id, { how: "feed", at: now(), count: feed.length, why: tabs.error });
      }
      complete = false;
      for (const v of feed) if (!ids.includes(String(v.id))) ids.push(String(v.id));
    }
    const t = now();
    for (let i = 0; i < (feed ? feed.length : ids.length); i += 50) {
      let vl;
      try {
        vl = feed
          ? { items: feed.slice(i, i + 50) }
          : await pub(() =>
              data("videos", { part: "snippet,contentDetails,statistics,status", id: ids.slice(i, i + 50).join(","), maxResults: 50 }, a),
            );
      } catch (e) {
        if (!(e instanceof ToPage)) throw e;
        problems.push("The Google sign-in ended while the videos were read: sign in again for their numbers.");
        break;
      }
      live();
      for (const v of vl?.items ?? []) {
        const sn = v.snippet ?? {},
          st = v.statistics ?? {},
          stt = v.status ?? {};
        const dur = parseDuration(v.contentDetails?.duration);
        q.run(
          `INSERT INTO yt_videos(id,channel_id,title,description,published_at,publish_at,privacy,duration,thumb_url,views,likes,comments,gone,fetched_at,uploaded_at,format) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)
          ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id, title=excluded.title, description=excluded.description, published_at=excluded.published_at, publish_at=excluded.publish_at,
          privacy=excluded.privacy, duration=excluded.duration, thumb=CASE WHEN thumb_url IS excluded.thumb_url THEN thumb ELSE NULL END, thumb_url=excluded.thumb_url, views=excluded.views,
          likes=excluded.likes, comments=excluded.comments, gone=0, fetched_at=excluded.fetched_at, uploaded_at=excluded.uploaded_at, format=COALESCE(format, excluded.format)`,
          String(v.id),
          id,
          String(sn.title ?? "Untitled").slice(0, 300),
          sn.description ? String(sn.description).slice(0, 5e3) : null,
          // a scheduled video's publishedAt is its upload time: it is "published" only once it goes public (publishAt)
          stt.privacyStatus === "private" ? null : (sn.publishedAt ?? null),
          stt.publishAt ?? null,
          stt.privacyStatus ?? null,
          dur,
          sn.thumbnails?.medium?.url ?? sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null,
          num(st.viewCount),
          num(st.likeCount),
          num(st.commentCount),
          t,
          // (every video's: a private one, often public before and with real views, is dated by it, not by when it was read)
          sn.publishedAt ?? null,
          formatOfDuration(dur),
        );
      }
    }
    const listed = JSON.stringify(ids),
      seen = a.owner && a.channel === id ? 1 : 0,
      says = need(id).videos ?? 0;
    if (complete && ids.length < Math.ceil(says / 2)) {
      log("youtube: the read listed", ids.length, "of the", says, "videos the channel says it has; none marked gone", id);
      complete = false;
    }
    if (!ids.length && !(complete && !says)) {
    } else if (complete)
      q.run(
        `UPDATE yt_videos SET gone=1 WHERE channel_id=? AND id NOT IN (SELECT value FROM json_each(?)) AND (? OR COALESCE(privacy, 'public') = 'public')`,
        id,
        listed,
        seen,
      );
    else
      q.run(
        `UPDATE yt_videos SET gone=1 WHERE channel_id=? AND id NOT IN (SELECT value FROM json_each(?)) AND (? OR COALESCE(privacy, 'public') = 'public') AND COALESCE(published_at, uploaded_at, '') >=
      (SELECT MIN(COALESCE(published_at, uploaded_at, '9')) FROM yt_videos WHERE id IN (SELECT value FROM json_each(?)))`,
        id,
        listed,
        seen,
        listed,
      );
    progress(id, "running", "Reading the comments");
    const ca = commentsAuth();
    if (ca)
      try {
        const ct = await data(
          "commentThreads",
          { part: "snippet", allThreadsRelatedToChannelId: id, maxResults: 100, order: "time", textFormat: "plainText" },
          ca,
        );
        live();
        storeComments(id, ct?.items ?? [], { whole: !ct?.nextPageToken });
      } catch (e) {
        if (e.network || e instanceof Stopped) throw e;
        log("youtube comments skipped", id, e.message);
        if (!(e.reasons ?? []).includes("commentsDisabled")) problems.push(`Comments: ${e.message}`);
      }
    r = need(id);
    const owner = hasToken(id);
    if (owner && grantedAnalytics(id)) {
      progress(id, "running", "Reading the analytics");
      try {
        a = await authFor(r, true);
        const end = day(new Date()),
          start = day(new Date(Math.max(Date.now() - 200 * 864e5, r.created ? Date.parse(r.created) : 0)));
        const days = await report(
          {
            ids: "channel==MINE",
            startDate: start,
            endDate: end,
            dimensions: "day",
            sort: "day",
            metrics:
              "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments",
          },
          a,
        );
        live();
        for (const d of days)
          q.run(
            "INSERT OR REPLACE INTO yt_daily(channel_id,day,views,minutes,avg_duration,avg_pct,subs_gained,subs_lost,likes,comments) VALUES(?,?,?,?,?,?,?,?,?,?)",
            id,
            String(d.day),
            num(d.views),
            num(d.estimatedMinutesWatched),
            num(d.averageViewDuration),
            num(d.averageViewPercentage),
            num(d.subscribersGained),
            num(d.subscribersLost),
            num(d.likes),
            num(d.comments),
          );
        const first = r.created ? r.created.slice(0, 10) : "2005-04-23";
        const per = await report(
          {
            ids: "channel==MINE",
            startDate: first < end ? first : end,
            endDate: end,
            dimensions: "video",
            sort: "-views",
            maxResults: 200,
            metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained",
          },
          a,
        );
        live();
        for (const v of per)
          q.run(
            "UPDATE yt_videos SET minutes=?, avg_duration=?, avg_pct=?, subs_gained=? WHERE id=? AND channel_id=?",
            num(v.estimatedMinutesWatched),
            num(v.averageViewDuration),
            num(v.averageViewPercentage),
            num(v.subscribersGained),
            String(v.video),
            id,
          );
        q.run("UPDATE yt_channels SET analytics=1, analytics_at=? WHERE id=?", now(), id);
      } catch (e) {
        if (e instanceof Stopped) throw e;
        if (e instanceof SignedOut) problems.push(e.message);
        else {
          if (e.network) throw e;
          if ((e.reasons ?? []).some((x) => /insufficientPermissions|SCOPE_INSUFFICIENT/.test(x)))
            q.run("UPDATE yt_channels SET analytics=0 WHERE id=?", id);
          problems.push(e.message);
        }
      }
    }
    live();
    progress(id, "running", "Getting the thumbnails");
    const rows = q.all(
      `SELECT id, thumb_url, thumb FROM yt_videos WHERE channel_id=? AND gone=0 AND thumb_url IS NOT NULL
      ORDER BY COALESCE(published_at, publish_at, uploaded_at, fetched_at) DESC`,
      id,
    );
    const recheck = new Set(
      rows
        .slice(0, RECHECK_NEWEST)
        .filter((v) => asked || Date.now() - (thumbChecked.get(v.id) ?? 0) > RECHECK_MS)
        .map((v) => v.id),
    );
    const want = rows.filter((v) => !v.thumb || !fs.existsSync(path.join(ytDir(id), v.thumb)) || recheck.has(v.id)).slice(0, 600);
    let misses = 0;
    for (let i = 0; i < want.length && misses < 8; i += 4) {
      const got = await Promise.all(
        want.slice(i, i + 4).map(async (v) => {
          const rel = `v/${v.id.replace(/[^\w-]/g, "")}.jpg`;
          const r2 = await download(v.thumb_url, path.join(ytDir(id), rel), stop);
          if (r2) thumbChecked.set(v.id, Date.now());
          return r2 ? [v.id, rel] : null;
        }),
      );
      live();
      for (const g of got) if (g) q.run("UPDATE yt_videos SET thumb=? WHERE id=?", g[1], g[0]);
      misses = got.some(Boolean) ? 0 : misses + got.length;
    }
    if (misses >= 8) log("youtube thumbnails: the picture host keeps failing, the rest wait for the next read", id);
    const err = need(id).error?.startsWith("Signed out:") && !hasToken(id) ? need(id).error : null;
    q.run("UPDATE yt_channels SET fetched_at=?, error=? WHERE id=?", now(), err ?? (problems.length ? problems.join(" ") : null), id);
    progress(id, "done");
    changed("data", id);
    if (q.get("SELECT 1 FROM yt_videos WHERE channel_id=? AND project_id IS NOT NULL", id)) send("channels:changed", { what: "files" });
    return getChannel(id);
  } catch (e) {
    const cur = row(id),
      ended = !!cur?.error?.startsWith("Signed out:") && !hasToken(id);
    if (!(e instanceof Stopped) && cur && !ended && !removing.has(id))
      q.run("UPDATE yt_channels SET error=? WHERE id=?", FAILED + String(e?.message ?? e), id);
    progress(id, "failed", void 0, String(e?.message ?? e));
    changed("channels", id);
    throw e;
  }
}
function storeComments(channelId, items, scope) {
  const t = now(),
    ids = [];
  for (const it of items) {
    const top = it?.snippet?.topLevelComment?.snippet ?? {};
    q.run(
      `INSERT INTO yt_comments(id,channel_id,video_id,author,text,likes,replies,published_at,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET text=excluded.text, likes=excluded.likes, replies=excluded.replies, fetched_at=excluded.fetched_at`,
      String(it.id),
      channelId,
      it?.snippet?.videoId ?? top.videoId ?? null,
      String(top.authorDisplayName ?? "").slice(0, 120),
      String(top.textOriginal ?? top.textDisplay ?? "").slice(0, 4e3),
      num(top.likeCount) ?? 0,
      num(it?.snippet?.totalReplyCount) ?? 0,
      top.publishedAt ?? null,
      t,
    );
    ids.push(String(it.id));
  }
  const oldest = items.reduce((m, it) => {
    const p = it?.snippet?.topLevelComment?.snippet?.publishedAt;
    return typeof p === "string" && (!m || p < m) ? p : m;
  }, null);
  if (scope.whole || oldest)
    q.run(
      `DELETE FROM yt_comments WHERE channel_id=? AND id NOT IN (SELECT value FROM json_each(?)) AND (? IS NULL OR video_id=?) AND (? OR published_at > ?)`,
      channelId,
      JSON.stringify(ids),
      scope.videoId ?? null,
      scope.videoId ?? null,
      scope.whole ? 1 : 0,
      oldest ?? "",
    );
  q.run(
    `DELETE FROM yt_comments WHERE channel_id=? AND id NOT IN (SELECT value FROM json_each(?))
    AND id NOT IN (SELECT id FROM yt_comments WHERE channel_id=? ORDER BY fetched_at DESC, published_at DESC LIMIT 1000)`,
    channelId,
    JSON.stringify(ids),
    channelId,
  );
}
let ticking = false;
export async function tick(maxAgeMs = 4 * 36e5) {
  if (ticking || !isPremium()) return [];
  ticking = true;
  const done = [];
  try {
    for (const r of q.all("SELECT * FROM yt_channels ORDER BY sort")) {
      if (syncing.has(r.id) || removing.has(r.id) || (r.fetched_at && Date.now() - Date.parse(r.fetched_at) < maxAgeMs)) continue;
      try {
        await sync(r.id);
        done.push(r.id);
      } catch (e) {
        log("youtube background refresh failed", r.id, e?.message);
      }
    }
  } finally {
    ticking = false;
  }
  return done;
}
export function startBackground() {
  if (process.env.CZ_TEST_HOOKS === "1") return;
  setTimeout(() => {
    tick().catch(() => {});
    setInterval(() => tick().catch(() => {}), 15 * 6e4);
  }, 9e4);
}
export function statusOf(v) {
  if (v.privacy === "private")
    return v.publish_at && Date.parse(v.publish_at) > Date.now() ? "scheduled" : v.publish_at ? "published" : "private";
  return v.privacy === "unlisted" ? "unlisted" : "published";
}
export function videoView(v) {
  return {
    id: v.id,
    channelId: v.channel_id,
    title: v.title,
    publishedAt: v.published_at ?? (statusOf(v) === "published" ? v.publish_at : null),
    publishAt: v.publish_at,
    uploadedAt: v.uploaded_at ?? null,
    privacy: v.privacy,
    duration: v.duration,
    thumbUrl: fileUrl(v.channel_id, v.thumb),
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    minutes: v.minutes,
    avgDuration: v.avg_duration,
    avgPct: v.avg_pct,
    subsGained: v.subs_gained,
    projectId: v.project_id,
    projectName: v.project_name ?? null,
    projectKind: v.project_kind ?? null,
    status: statusOf(v),
  };
}
const commentRows = (sql, ...a) =>
  q
    .all(sql, ...a)
    .map((c) => ({
      id: c.id,
      videoId: c.video_id,
      videoTitle: c.video_title ?? null,
      author: c.author,
      text: c.text,
      likes: c.likes ?? 0,
      replies: c.replies ?? 0,
      publishedAt: c.published_at,
    }));
export const LIVE_COMMENT = "(c.video_id IS NULL OR NOT EXISTS (SELECT 1 FROM yt_videos g WHERE g.id = c.video_id AND g.gone = 1))";
export function overview(id) {
  const ch = getChannel(id);
  const days = q
    .all("SELECT * FROM yt_daily WHERE channel_id=? ORDER BY day", id)
    .map((d) => ({
      day: d.day,
      views: d.views ?? 0,
      minutes: d.minutes ?? 0,
      avgDuration: d.avg_duration,
      avgPct: d.avg_pct,
      subsGained: d.subs_gained ?? 0,
      subsLost: d.subs_lost ?? 0,
      likes: d.likes ?? 0,
      comments: d.comments ?? 0,
    }));
  const snapshots = q.all("SELECT day, subs, views, videos FROM yt_snapshots WHERE channel_id=? ORDER BY day", id);
  const videos = q
    .all(
      `SELECT v.*, p.name AS project_name, p.kind AS project_kind FROM yt_videos v LEFT JOIN projects p ON p.id = v.project_id
      WHERE v.channel_id=? AND v.gone=0 ORDER BY COALESCE(v.published_at, v.publish_at, v.uploaded_at, v.fetched_at) DESC`,
      id,
    )
    .map(videoView);
  const sugg = suggestAll(
    videos.filter((v) => !v.projectId),
    id,
    ch.linkedChannelId,
  );
  for (const v of videos) v.suggestion = sugg.get(v.id) ?? null;
  const comments = commentRows(
    `SELECT c.*, v.title AS video_title FROM yt_comments c LEFT JOIN yt_videos v ON v.id = c.video_id WHERE c.channel_id=? AND ${LIVE_COMMENT}
    ORDER BY c.published_at DESC LIMIT 40`,
    id,
  );
  return { channel: ch, days, snapshots, videos, comments, commentsNeedKey: !apiKey() };
}
export async function videoDetail(videoId, force = false) {
  let v = q.get("SELECT * FROM yt_videos WHERE id=?", videoId);
  if (!v) throw new Error("That video is not in the app any more.");
  const r = need(v.channel_id);
  let note = null,
    commentsOff = false,
    read = false;
  const fresh = !!v.gone || (!force && !!v.detail_at && Date.now() - Date.parse(v.detail_at) < DETAIL_TTL);
  if (!fresh) {
    const owner2 = hasToken(r.id) && grantedAnalytics(r.id);
    if (owner2)
      try {
        const a = await authFor(r, true),
          end = day(new Date()),
          start = (v.published_at ?? v.uploaded_at ?? v.publish_at ?? r.created ?? "2005-04-23").slice(0, 10);
        const ret = await report(
          {
            ids: "channel==MINE",
            startDate: start <= end ? start : end,
            endDate: end,
            dimensions: "elapsedVideoTimeRatio",
            metrics: "audienceWatchRatio,relativeRetentionPerformance",
            filters: `video==${videoId}`,
          },
          a,
        );
        const traffic2 = await report(
          {
            ids: "channel==MINE",
            startDate: start <= end ? start : end,
            endDate: end,
            dimensions: "insightTrafficSourceType",
            metrics: "views,estimatedMinutesWatched",
            filters: `video==${videoId}`,
            sort: "-views",
          },
          a,
        );
        q.run(
          "UPDATE yt_videos SET retention=?, traffic=? WHERE id=?",
          JSON.stringify(ret.map((x) => [num(x.elapsedVideoTimeRatio), num(x.audienceWatchRatio), num(x.relativeRetentionPerformance)])),
          JSON.stringify(traffic2.map((x) => [String(x.insightTrafficSourceType), num(x.views), num(x.estimatedMinutesWatched)])),
          videoId,
        );
        read = true;
      } catch (e) {
        note = e.message;
      }
    const ca = commentsAuth();
    if (ca)
      try {
        const a = ca;
        const ct = await data("commentThreads", { part: "snippet", videoId, maxResults: 50, order: "time", textFormat: "plainText" }, a);
        if (!row(r.id)) throw new Error("That video is not in the app any more.");
        storeComments(r.id, ct?.items ?? [], { whole: !ct?.nextPageToken, videoId });
        read = true;
      } catch (e) {
        if ((e.reasons ?? []).includes("commentsDisabled")) {
          commentsOff = true;
          read = true;
        } else if (/not in the app any more/.test(e.message)) throw e;
        else note = note ?? e.message;
      }
    if (!q.get("SELECT 1 FROM yt_videos WHERE id=?", videoId)) throw new Error("That video is not in the app any more.");
    if (read) q.run("UPDATE yt_videos SET detail_at=? WHERE id=?", now(), videoId);
    if (force && v.thumb_url) {
      const rel = `v/${v.id.replace(/[^\w-]/g, "")}.jpg`;
      if (await download(v.thumb_url, path.join(ytDir(r.id), rel))) {
        thumbChecked.set(v.id, Date.now());
        q.run("UPDATE yt_videos SET thumb=? WHERE id=?", rel, v.id);
      }
    }
    v = q.get("SELECT * FROM yt_videos WHERE id=?", videoId);
  }
  const p = v.project_id ? q.get("SELECT name, kind FROM projects WHERE id=?", v.project_id) : null;
  const parse = (s) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };
  const retention =
    parse(v.retention)
      ?.filter((x) => x[0] !== null && x[1] !== null)
      .map(([x, y, rel]) => ({ x, y, rel })) ?? null;
  const traffic = parse(v.traffic)?.map(([source, views, minutes]) => ({ source, views: views ?? 0, minutes: minutes ?? 0 })) ?? null;
  const comments = commentRows("SELECT * FROM yt_comments WHERE video_id=? ORDER BY published_at DESC LIMIT 50", videoId);
  const choices = projectChoices(v),
    signedIn = hasToken(r.id),
    ch = getChannel(r.id);
  const owner = signedIn ? (grantedAnalytics(r.id) ? "live" : "no-analytics") : r.access === "oauth" ? "ended" : ch.own ? "own" : "other";
  return {
    video: { ...videoView({ ...v, project_name: p?.name ?? null, project_kind: p?.kind ?? null }) },
    retention,
    traffic,
    comments,
    commentsOff,
    commentsNeedKey: !apiKey(),
    analytics: owner === "live",
    owner,
    gone: !!v.gone,
    note,
    readFailed: !fresh && !read,
    detailAt: v.detail_at,
    fetchedAt: v.fetched_at,
    choices,
  };
}
