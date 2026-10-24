import { log } from "../core/log";
import { now, q, uid } from "../db/db";
import { NO_CLAUDE, claudeExecutable, cleanEnv } from "../engines/claudeCli";
import { claudeFallback } from "../engines/resolveEngine";
import { isPremium } from "../app/plan";
import { checkChannel, getChannel } from "./channels";
import { LIVE_COMMENT, overview, videoDetail } from "./youtubeSync";
import { friendlyError } from "../agent/sessions";

export const insightsModel = () => claudeFallback();
const KINDS = ["working", "topic", "hook", "length", "avoid", "other"];
const clean = (s, max) =>
  Array.from(
    String(s ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, max)
    .join("");
export const listInsights = (channelId) =>
  q.all(
    `SELECT * FROM yt_insights WHERE channel_id=? AND status IN ('suggested','approved')
  ORDER BY status='approved' DESC, created_at DESC`,
    String(channelId),
  );
export const MAX_KEPT = 30;
const keptCount = (channelId) => q.get("SELECT COUNT(*) AS n FROM yt_insights WHERE channel_id=? AND status='approved'", channelId)?.n ?? 0;
const roomFor = (channelId) => {
  if (keptCount(channelId) >= MAX_KEPT) throw new Error(`A channel keeps up to ${MAX_KEPT} lessons. Remove one you no longer need first.`);
};
export function approvedFor(o) {
  if (!isPremium()) return [];
  const ch =
    o.channelId !== void 0 ? o.channelId : (q.get("SELECT channel_id FROM projects WHERE id=?", o.projectId ?? "")?.channel_id ?? null);
  if (!ch || !q.get("SELECT 1 FROM channels WHERE id=? AND yt_channel_id IS NOT NULL", ch)) return [];
  return q.all("SELECT text FROM yt_insights WHERE channel_id=? AND status='approved' ORDER BY created_at DESC", ch).map((r) => r.text);
}
function get(id) {
  const r = q.get("SELECT * FROM yt_insights WHERE id=?", String(id));
  if (!r) throw new Error("That insight no longer exists.");
  return r;
}
export function updateInsight(id, patch) {
  const r = get(id);
  const text = patch.text !== void 0 ? clean(patch.text, 400) : r.text;
  if (!text) throw new Error("Write the lesson first (or dismiss it).");
  const status = patch.status === "approved" || patch.status === "suggested" ? patch.status : r.status;
  if (status === "approved" && r.status !== "approved") roomFor(r.channel_id);
  q.run("UPDATE yt_insights SET text=?, status=?, updated_at=? WHERE id=?", text, status, now(), id);
  return get(id);
}
export function dismissInsight(id) {
  get(id);
  q.run("UPDATE yt_insights SET status='dismissed', updated_at=? WHERE id=?", now(), id);
}
export function addInsight(channelId, text) {
  const ch = checkChannel(channelId);
  if (!ch) throw new Error("Pick a channel first.");
  const t = clean(text, 400);
  if (!t) throw new Error("Write the lesson first.");
  roomFor(ch);
  const id = uid("ins_"),
    at = now();
  q.run(
    "INSERT INTO yt_insights(id,channel_id,kind,text,why,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    id,
    ch,
    "other",
    t,
    null,
    "approved",
    at,
    at,
  );
  return get(id);
}
const SYSTEM = `You help a YouTube creator learn from their channel's numbers. You get the channel's stats, its videos (views,
watch time, average percentage viewed, average view duration), audience-retention shapes (how many viewers are still
watching at points through a video) and recent viewer comments. Write concise, specific lessons and suggestions the
creator can act on in their next scripts: which topics and angles work, what viewers ask for in comments (topic ideas),
how openings (the first 30 seconds) hold or lose viewers, which lengths hold attention, and what to avoid. Every point
must be backed by the data you were given (name the videos or numbers it comes from). No generic advice. Never invent
numbers. Write each point as one imperative sentence of at most 30 words. Reply with JSON only:
{"insights":[{"kind":"working"|"topic"|"hook"|"length"|"avoid"|"other","text":"...","because":"<the evidence, briefly>"}]}
with 3 to 8 points (fewer if the data is thin).`;
const pct = (v) => (v == null ? "?" : `${Math.round(v)}%`);
const mmss = (s) => (s == null ? "?" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
export async function summary(channelId) {
  const ch = getChannel(channelId);
  if (!ch.yt_channel_id) throw new Error(`Link "${ch.name}" to its YouTube channel first (YouTube page, or Settings > YouTube).`);
  const o = overview(ch.yt_channel_id),
    y = o.channel;
  if (!y.fetchedAt) throw new Error(`${y.title} has not been read yet. Refresh it first (the button at the top of its YouTube page).`);
  if (!o.videos.some((v) => v.status === "published" || v.status === "unlisted"))
    throw new Error(
      `${y.title} has no published videos yet. Claude learns from published videos, their numbers and their comments: ask again after your first uploads.`,
    );
  const lines = [];
  lines.push(
    `Channel: ${y.title}${y.handle ? ` (${y.handle})` : ""}. ${y.hiddenSubs ? "Subscriber count hidden" : `${(y.subs ?? 0).toLocaleString("en-US")} subscribers`}, ${(y.views ?? 0).toLocaleString("en-US")} views in total, ${y.videos ?? o.videos.length} videos.`,
  );
  const d = o.days,
    last2 = d.length ? d.slice(-28) : [],
    prev = d.length > 28 ? d.slice(-56, -28) : [];
  if (last2.length) {
    const sum = (l, k) => l.reduce((s, x) => s + (x[k] || 0), 0);
    lines.push(
      `Last 28 days: ${sum(last2, "views").toLocaleString("en-US")} views (previous 28: ${prev.length ? sum(prev, "views").toLocaleString("en-US") : "n/a"}), ${Math.round(sum(last2, "minutes") / 60).toLocaleString("en-US")} watch hours, net subscribers ${last2.reduce((s, x) => s + x.subsGained - x.subsLost, 0)}.`,
    );
  }
  const pub = o.videos.filter((v) => v.status === "published" || v.status === "unlisted");
  const recent = pub.slice(0, 40),
    top = [...pub].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 12);
  const pick = [...new Map([...recent, ...top].map((v) => [v.id, v])).values()];
  lines.push("", "Videos (title | published | length | views | likes | comments | avg viewed | avg view duration | subscribers gained):");
  for (const v of pick)
    lines.push(
      `- ${v.title} | ${v.publishedAt?.slice(0, 10) ?? "?"} | ${mmss(v.duration)} | ${v.views ?? "?"} | ${v.likes ?? "?"} | ${v.comments ?? "?"} | ${pct(v.avgPct)} | ${mmss(v.avgDuration)} | ${v.subsGained ?? "?"}`,
    );
  if (y.analytics) {
    const want = [...new Map([...top.slice(0, 4), ...recent.slice(0, 4)].map((v) => [v.id, v])).values()];
    const shapes = [];
    for (const v of want) {
      try {
        const det = await videoDetail(v.id);
        const r = det.retention;
        if (!r?.length || !v.duration) continue;
        const at = (x) => {
          const p = r.reduce((b, c) => (Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b), r[0]);
          return Math.round(p.y * 100);
        };
        shapes.push(
          `- ${v.title} (${mmss(v.duration)}): still watching ${v.duration > 60 ? `at 30s ${at(30 / v.duration)}%, ` : ""}25% ${at(0.25)}%, 50% ${at(0.5)}%, 75% ${at(0.75)}%, end ${at(1)}%` +
            (det.traffic?.length
              ? `; top traffic: ${det.traffic
                  .slice(0, 3)
                  .map((t) => `${t.source} ${t.views}`)
                  .join(", ")}`
              : ""),
        );
      } catch (e) {
        log("insights: no retention for", v.id, e?.message);
      }
    }
    if (shapes.length) lines.push("", "Audience retention (share of viewers still watching at each point):", ...shapes);
  }
  const comments = o.comments.slice(0, 40).concat(
    q
      .all(
        `SELECT c.text, v.title AS video_title FROM yt_comments c LEFT JOIN yt_videos v ON v.id=c.video_id
      WHERE c.channel_id=? AND ${LIVE_COMMENT} ORDER BY c.likes DESC, c.published_at DESC LIMIT 80`,
        y.id,
      )
      .map((c) => ({ text: c.text, videoTitle: c.video_title })),
  );
  const seen = new Set(),
    cm = [];
  for (const c of comments) {
    const t = clean(c.text, 280);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    cm.push(`- [${c.videoTitle ?? "channel"}] ${t}`);
    if (cm.length >= 100) break;
  }
  if (cm.length) lines.push("", "Recent and most liked viewer comments:", ...cm);
  else if (o.commentsNeedKey) lines.push("", "No viewer comments: the app reads comments only with a Google API key, and none is saved.");
  const kept = approvedFor({ channelId });
  if (kept.length) lines.push("", "Lessons the creator already approved (do not repeat them):", ...kept.map((t) => `- ${t}`));
  let text = lines.join("\n");
  if (text.length > 24e3) text = text.slice(0, 24e3) + "\n(cut short)";
  return { text, channel: ch, videos: pick, comments: cm.length };
}
let lastPrompt = "",
  stubDelay = 0,
  stubFail = null;
export const testLastPrompt = () => lastPrompt;
export const setStubDelay = (ms) => {
  stubDelay = Math.max(0, Math.min(6e4, ms));
  return stubDelay;
};
export const setStubFail = (raw) => {
  stubFail = raw ? String(raw) : null;
  return stubFail;
};
const LIMIT_MS = 5 * 6e4;
const running = new Map();
export const insightsRunning = (channelId) => running.has(channelId);
export const insightsSince = (channelId) => running.get(channelId)?.since ?? null;
export function cancelInsights(channelId) {
  const r = running.get(channelId);
  if (!r) return false;
  r.why = "you";
  r.stop.abort();
  return true;
}
export async function generateInsights(channelId) {
  if (running.has(channelId)) throw new Error("Claude is already reading this channel. Wait for it to finish.");
  const run = { since: Date.now(), stop: new AbortController(), why: null };
  running.set(channelId, run);
  const timer = setTimeout(() => {
    run.why = "time";
    run.stop.abort();
  }, LIMIT_MS);
  const stopped = () =>
    new Error(
      run.why === "time"
        ? `Claude took longer than ${LIMIT_MS / 6e4} minutes, so it was stopped. Try again in a moment.`
        : "Stopped: no lessons were added.",
    );
  try {
    const s = await summary(channelId);
    if (run.stop.signal.aborted) throw stopped();
    lastPrompt = s.text;
    let items;
    if (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_YT_INSIGHTS_STUB === "1") {
      if (stubDelay)
        await new Promise((r) => {
          const t2 = setTimeout(r, stubDelay);
          run.stop.signal.addEventListener("abort", () => {
            clearTimeout(t2);
            r();
          });
        });
      if (run.stop.signal.aborted) throw stopped();
      if (stubFail) {
        log("insights: claude failed", stubFail);
        throw new Error(friendlyError(stubFail));
      }
      items = stub(s);
    } else {
      const exe = claudeExecutable();
      if (!exe) throw new Error(NO_CLAUDE);
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      let text =
        (await require("./videoxx-chatgpt").side("insights", {
          system: SYSTEM,
          prompt: `Here is the channel's data.\n\n${s.text}`,
          signal: run.stop.signal,
        })) ?? "";
      if (!text)
        try {
          for await (const m of query({
            prompt: `Here is the channel's data.

${s.text}`,
            options: {
              pathToClaudeCodeExecutable: exe,
              env: cleanEnv(),
              systemPrompt: SYSTEM,
              settingSources: [],
              tools: [],
              maxTurns: 1,
              model: insightsModel(),
              persistSession: false,
              abortController: run.stop,
            },
          })) {
            if (m.type === "assistant")
              text += (m.message.content || [])
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("");
            if (m.type === "result" && (m.subtype !== "success" || m.is_error))
              throw new Error(m.errors?.join?.("; ") || m.result || "Claude could not read the channel.");
          }
        } catch (e) {
          if (run.stop.signal.aborted) throw stopped();
          log("insights: claude failed", e?.message);
          throw new Error(friendlyError(String(e?.message ?? e)));
        }
      if (run.stop.signal.aborted) throw stopped();
      try {
        items = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).insights ?? [];
      } catch {
        log("insights: unexpected reply", text.slice(0, 400));
        throw new Error("Claude replied in an unexpected format. Try again.");
      }
    }
    if (!q.get("SELECT 1 FROM channels WHERE id=?", channelId))
      throw new Error("The channel was deleted while Claude was reading it, so no lessons were kept.");
    const keep = new Set(approvedFor({ channelId }).map((t2) => t2.toLowerCase()));
    const t = now(),
      out = [];
    q.run("UPDATE yt_insights SET status='dismissed', updated_at=? WHERE channel_id=? AND status='suggested'", t, channelId);
    for (const it of (Array.isArray(items) ? items : []).slice(0, 8)) {
      const text = clean(it?.text, 400);
      if (text.length < 8 || keep.has(text.toLowerCase())) continue;
      const kind = KINDS.includes(String(it.kind)) ? it.kind : "other",
        id = uid("ins_");
      q.run(
        "INSERT INTO yt_insights(id,channel_id,kind,text,why,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        id,
        channelId,
        kind,
        text,
        clean(it.because, 400) || null,
        "suggested",
        t,
        t,
      );
      out.push(get(id));
    }
    return { added: out, read: { videos: s.videos.length, comments: s.comments } };
  } finally {
    clearTimeout(timer);
    running.delete(channelId);
  }
}
function stub(s) {
  const best = [...s.videos].filter((v) => v.avgPct != null).sort((a, b) => (b.avgPct ?? 0) - (a.avgPct ?? 0))[0] ?? s.videos[0];
  const most = [...s.videos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
  const ask = /\[[^\]]*\] (.*?(?:video on|do one on|explain|about) ([^?.!]{3,40}))/i.exec(
    s.text.split("Recent and most liked viewer comments:")[1] ?? "",
  );
  return [
    {
      kind: "working",
      text: `Make more videos like "${most.title}": it has the most views on the channel.`,
      because: `${most.views} views`,
    },
    {
      kind: "hook",
      text: `Open like "${best.title}" does: it keeps ${pct(best.avgPct)} of the video watched on average.`,
      because: "average percentage viewed",
    },
    ...(ask ? [{ kind: "topic", text: `Viewers ask for a video about ${ask[2].trim()}.`, because: ask[1].slice(0, 120) }] : []),
  ];
}
