import path from "node:path";
import fs from "node:fs";
import { Notification, nativeImage, shell } from "electron";
import { Readable } from "node:stream";
import { getConfig } from "../core/config";
import { log } from "../core/log";
import { q } from "../db/db";
import { NO_CLAUDE, claudeExecutable, cleanEnv } from "../engines/claudeCli";
import { aspectOf, baseOf, getStyle } from "../styles/catalog";
import { getPreset } from "../styles/presets";
import { engineOf, modelName } from "../engines/models";
import { claudeFallback, engineEnv, resolveEngine } from "../engines/resolveEngine";
import { MODELS } from "../images/higgsfield";
import { IMAGE_MODEL } from "../images/makeImage";
import { applyChoices, checkChoices, overridesOf } from "../images/overrides";
import { activeProvider, defaultImageModel, generatePicture } from "../images/providers";
import { countWords, lang, wordUnit } from "../styles/languages";
import { spokenScript } from "../voice/spokenScript";
import { cancelStep, projectLanguage, runStep } from "../pipeline/steps";
import { hostState, layoutCheck, markDirty, renderStills, sweepErrors } from "../render/workers";
import { cancelExport, exportVideo } from "../render/exportVideo";
import { ownSkill, projectSkillChoice } from "../projects/scriptSkill";
import { createProject, getProject } from "../projects/projects";
import { writeContext } from "../agent/projectContext";
import { codexText } from "../engines/runCodex";
import { adoptNewProject, checkChannel, getChannel, listIdeas, setPlan } from "../channels/channels";
import { accessToken, base, grantedUpload } from "../channels/youtubeAuth";
import { searchChannel } from "../channels/youtubeReader";
import { Matcher, norm, prep } from "../channels/titleMatch";
import { sync, ytDir } from "../channels/youtubeSync";
import { linkVideo } from "../channels/links";
import { approvedFor } from "../channels/insights";
import { SCRIPT_PRESETS, TIME_LIMIT_BASES, extrasFor, levelName, nodeBuildExtras, nodeLevel, timeLimitText } from "./buildExtras";
import { thumbCount, thumbJudges, thumbMode, withStyleKey } from "./nodes";
import { friendlyError, isProjectBusy, projectThread, runTask, stopTask } from "../agent/sessions";
import { canNotify } from "../app/updater";
import { FISH_MODELS, fishKeyStatus, fishSpeaks } from "../voice/fish";
import { cancelVoiceover, jobOf, startVoiceover, stepSucceeded } from "../voice/voiceover";
import { grantPaths } from "../voice/recordings";
import { keyStatus } from "../voice/elevenlabs";
import { kokoroFiles, kokoroVoicesFor } from "../voice/kokoro";
import {
  HEADLINES,
  PIXEL_REFRAME,
  REFRAME_TASK,
  exportVertical,
  makeReframe,
  reframeOf,
  reframeState,
  verticalInfo,
} from "../render/vertical";
import { MAX_THUMB_REFS, refFile } from "./thumbRefs";
import {
  addFound,
  addTopics,
  formatWord,
  knownLine,
  mergeKnown,
  ofFormat,
  pastTopics,
  readNote,
  testFeed,
  testLast,
} from "../channels/knownTopics";

const FAKE = () => process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_ROUTINE_FAKE_CLAUDE === "1";
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};
const sleep = (ms, signal) =>
  new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rej(new Error("Cancelled."));
      },
      { once: true },
    );
  });
const lines = (s) =>
  String(s ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
function fill(pattern, api, extra = {}) {
  const c = api?.item.ctx ?? {},
    p = c.projectId
      ? (() => {
          try {
            return getProject(c.projectId);
          } catch {
            return null;
          }
        })()
      : null;
  const ch = c.channelId
    ? (() => {
        try {
          return getChannel(c.channelId).name;
        } catch {
          return "";
        }
      })()
    : "";
  const v = {
    topic: c.topic ?? "",
    title: c.publish?.title || c.title || c.topic || "",
    project: p?.name ?? c.topic ?? "",
    channel: ch,
    n: String((api?.item.idx ?? 0) + 1),
    date: new Date().toISOString().slice(0, 10),
    ...extra,
  };
  return String(pattern ?? "")
    .replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m))
    .replace(/\s+/g, " ")
    .trim();
}
function project(api) {
  const id = api.item.ctx.projectId;
  if (!id) throw new Error("There is no project yet: put a Create project before this node.");
  return getProject(id);
}
const pjOf = (dir) => readJson(path.join(dir, "project.json")) || {};
const spokenWords = (dir) => {
  let t = "";
  try {
    t = fs.readFileSync(path.join(dir, "script.txt"), "utf8");
  } catch {
    return { text: "", words: 0, unit: wordUnit(projectLanguage(dir)) };
  }
  const code = projectLanguage(dir),
    s = spokenScript(t, code);
  return {
    text: s,
    words: lang(code).spaced === false ? countWords(s, code) : s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length,
    unit: wordUnit(code),
  };
};
const notBusy = (projectId) => {
  if (isProjectBusy(projectId))
    throw new Error("Claude is already working on this project (started from the editor?). Wait for it, then retry this video.");
};
async function claudeTask(api, req) {
  if (api.signal.aborted) throw new Error("Cancelled.");
  if (FAKE()) return fakeTask(api, req);
  notBusy(req.projectId);
  return new Promise((resolve, reject) => {
    let off = () => {};
    const emit = (ev) => {
      api.emitTask(ev);
      if (ev.type === "tool" && ev.summary) api.log(ev.summary);
      if (ev.type === "note" && ev.text) api.log(ev.warn ? `⚠ ${ev.text}` : ev.text);
      if (ev.type === "starting") {
        api.log(ev.text);
        off();
        off = api.onCancel(() => stopTask(ev.taskId));
        if (api.signal.aborted) stopTask(ev.taskId);
      }
      if (ev.type === "done") {
        off();
        if (ev.status === "done" || ev.status === "no-change") resolve({ status: ev.status, error: null });
        else reject(new Error(ev.status === "cancelled" ? "Cancelled." : ev.error || "Claude stopped."));
      }
    };
    runTask({ ...req, auto: true, model: api.settings.model || null, effort: api.settings.effort || null }, emit)
      .then((r) => {
        off();
        off = api.onCancel(() => stopTask(r.taskId));
        if (api.signal.aborted) stopTask(r.taskId);
      })
      .catch(reject);
  });
}
function setScriptSkillChoice(p, choice) {
  const pj = pjOf(p.path);
  if (JSON.stringify(projectSkillChoice(p.path)) === JSON.stringify(choice)) return false;
  if (choice === void 0) delete pj.scriptSkill;
  else pj.scriptSkill = choice;
  fs.writeFileSync(path.join(p.path, "project.json"), JSON.stringify(pj, null, 1));
  writeContext(p.id);
  return true;
}
async function fakeTask(api, req) {
  const p = getProject(req.projectId),
    pj = pjOf(p.path);
  api.log(`(test) ${req.kind}${req.kind === "build" ? ` extras: ${(req.extras ?? []).join(", ") || "none"}` : ""}`);
  if (req.kind === "script") {
    const L = lang(pj.language),
      n = Math.round(((pj.targetLength || 60) / 60) * L.wpm),
      base2 = `This is a test narration about ${pj.topic || p.name}. `;
    let t = "## Intro\n";
    while (countWords(t, L.code) < n) t += base2;
    fs.writeFileSync(path.join(p.path, "script.txt"), t.trim() + "\n");
  }
  if (req.kind === "build") {
    const src = process.env.CZ_ROUTINE_FAKE_BUILD;
    if (src && fs.existsSync(src)) {
      for (const f of fs.readdirSync(path.join(src, "scenes")))
        fs.copyFileSync(path.join(src, "scenes", f), path.join(p.path, "scenes", f));
      const spj = pjOf(src),
        cur = pjOf(p.path);
      cur.scenes = spj.scenes;
      fs.writeFileSync(path.join(p.path, "project.json"), JSON.stringify(cur, null, 1));
      markDirty(p.id);
    }
  }
  return { status: "done", error: null };
}
async function claudeText(signal, settings, system, prompt, fake, web = false, look, say) {
  if (FAKE()) return fake();
  const ac = new AbortController();
  const stop = () => ac.abort();
  signal.addEventListener("abort", stop, { once: true });
  const WEB = ["WebSearch", "WebFetch"],
    seen = new Set((look ?? []).map((f) => path.resolve(f).toLowerCase()));
  const lookOpts = look
    ? {
        tools: ["Read"],
        allowedTools: [],
        cwd: path.dirname(look[0]),
        maxTurns: look.length + 6,
        canUseTool: async (name, input) =>
          name === "Read" && seen.has(path.resolve(path.dirname(look[0]), String(input?.file_path ?? "")).toLowerCase())
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: "Only the listed pictures can be opened here." },
      }
    : null;
  const want = settings.model || getConfig().claude.model || void 0;
  const vxWeb = web && engineOf(want) === "codex" && require("./videoxx-chatgpt").webOnChatGPT();
  if (web && !vxWeb && engineOf(want) !== "claude")
    say?.(
      `Web research runs on Claude (${modelName(claudeFallback() ?? null)}), not on the ${engineOf(want) === "codex" ? "ChatGPT" : "Google"} model: the web tools are Anthropic's own.`,
    );
  const route = await resolveEngine("routine", web && !vxWeb && engineOf(want) !== "claude" ? claudeFallback() : want, { signal }).catch(
    (e) => {
      throw signal.aborted ? new Error("Cancelled.") : e;
    },
  );
  if (route.note) {
    log("routine text: engine fallback:", route.note);
    say?.(`⚠ ${route.note}`);
  }
  if (route.engine === "codex") {
    try {
      return await codexText({ system, prompt, model: route.model, effort: settings.effort || null, look, signal, web: vxWeb });
    } catch (e) {
      if (signal.aborted) throw new Error("Cancelled.");
      throw new Error(friendlyError(String(e?.message ?? e), "codex"));
    } finally {
      signal.removeEventListener("abort", stop);
    }
  }
  const exe = claudeExecutable();
  if (!exe) throw new Error(NO_CLAUDE);
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  let text = "";
  try {
    for await (const m of query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: exe,
        env: engineEnv(cleanEnv(), route),
        systemPrompt: system,
        settingSources: [],
        tools: web ? WEB : [],
        maxTurns: web ? 30 : 1,
        ...(web
          ? {
              allowedTools: WEB,
              canUseTool: async (name, input) =>
                WEB.includes(name)
                  ? { behavior: "allow", updatedInput: input }
                  : { behavior: "deny", message: "Only web search and reading are available here." },
            }
          : {}),
        ...(lookOpts ?? {}),
        model: route.model,
        effort: route.engine !== "claude" ? void 0 : settings.effort || void 0,
        persistSession: false,
        abortController: ac,
      },
    })) {
      if (m.type === "assistant") {
        const t = (m.message.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        if (t.trim()) text = t;
      }
      if (m.type === "result" && (m.subtype !== "success" || m.is_error))
        throw new Error(m.errors?.join?.("; ") || m.result || "Claude did not answer.");
    }
  } catch (e) {
    if (signal.aborted) throw new Error("Cancelled.");
    throw new Error(friendlyError(String(e?.message ?? e), route.engine));
  } finally {
    signal.removeEventListener("abort", stop);
  }
  return text;
}
const jsonIn = (text) => {
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("Claude answered in an unexpected format. Retry this video.");
  }
};
async function step(api, id, opts = {}) {
  const p = project(api);
  notBusy(p.id);
  const off = api.onCancel(() => cancelStep(p.path)),
    out = [];
  try {
    const r = await runStep(id, p.path, { ...opts, projectId: p.id }, (l) => {
      out.push(l);
      api.log(l);
      api.send("pipeline:log", { projectId: p.id, step: id, line: l });
    });
    markDirty(p.id);
    writeContext(p.id);
    if (id === "clean" || id === "timeline") stepSucceeded(p.id, id, (j) => api.send("voice:progress", j));
    return { r, out };
  } finally {
    off();
    api.send("channels:changed", { what: "files" });
  }
}
const matchedOf = (out) => {
  for (const l of [...out].reverse()) {
    const m = /matched (\d+) of (\d+) script words/.exec(l);
    if (m) return { matched: +m[1], total: +m[2] };
  }
  return null;
};
async function exportWith(api, projectId, kind, run) {
  const off = api.onCancel(() => cancelExport(projectId));
  let lastPct = -1;
  try {
    const r = await api.exporting(projectId, kind, (prog) =>
      run((p) => {
        prog(p);
        const pct = Math.floor((p.pct ?? p.frame / Math.max(1, p.frames)) * 10);
        if (pct !== lastPct) {
          lastPct = pct;
          api.log(`${p.phase ?? "Rendering"} ${pct * 10}%`);
        }
      }),
    );
    if (r?.cancelled) throw new Error("Cancelled.");
    return r;
  } finally {
    off();
  }
}
function notifyUser(api, title, body) {
  api.send("routines:notice", { title, body });
  if (canNotify()) {
    const n = new Notification({ title, body: body.slice(0, 200) });
    n.show();
  }
}
function blank(file) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return true;
  const small = img.resize({ width: 48 }),
    { width, height } = small.getSize(),
    b = small.toBitmap();
  let min = 255,
    max = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    const l = (b[i] + b[i + 1] + b[i + 2]) / 3;
    if (l < min) min = l;
    if (l > max) max = l;
  }
  return max - min < 6;
}
const publicVideos = (yt) =>
  q.all(
    `SELECT id, title, views, COALESCE(published_at, uploaded_at) AS at, description, format FROM yt_videos
  WHERE channel_id=? AND gone=0 AND (privacy IS NULL OR privacy='public') ORDER BY COALESCE(published_at, uploaded_at) DESC`,
    yt,
  );
const fmtVid = (v) =>
  `- ${v.title}${v.views != null ? ` (${Number(v.views).toLocaleString("en")} views${v.at ? `, ${String(v.at).slice(0, 10)}` : ""})` : ""}`;
async function freshVideos(yt, log2, signal) {
  const fake = process.env.CZ_TEST_HOOKS === "1" ? testFeed.get(yt) : void 0;
  if (fake) return fake.map((v) => ({ id: v.id, title: v.title, views: null, at: v.at ?? null, description: null }));
  log2("Reading the channel's public videos again from YouTube");
  try {
    await Promise.race([
      sync(yt),
      new Promise((_, rej) => setTimeout(() => rej(new Error("it took longer than two minutes")), 12e4)),
      new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("Cancelled.")), { once: true })),
    ]);
  } catch (e) {
    if (signal.aborted) throw new Error("Cancelled.");
    const at = q.get("SELECT fetched_at FROM yt_channels WHERE id=?", yt)?.fetched_at;
    log2(`Could not read it again (${e?.message}); using the videos read ${at ? String(at).slice(0, 16).replace("T", " ") : "earlier"}`);
  }
  return publicVideos(yt);
}
const STOP = new Set(
  "a an the and or but of to in on at for from by with without about into over under how why what when where who which is are was were be been being it its this that these those your you my our their his her vs versus ever really just most more best worst than then so do does did can could would should will has have had not no".split(
    " ",
  ),
);
function searchTerms(title) {
  const w = norm(title)
    .split(" ")
    .filter((x) => x && !STOP.has(x) && (x.length > 2 || /\d/.test(x)));
  return (w.length ? w : norm(title).split(" ")).slice(0, 6).join(" ");
}
async function channelSearch(yt, titles, log2) {
  if (process.env.CZ_TEST_HOOKS === "1" && testFeed.has(yt)) return new Map();
  const handle = q.get("SELECT handle FROM yt_channels WHERE id=?", yt)?.handle ?? null,
    terms = titles.map(searchTerms);
  try {
    const m = await searchChannel({ id: yt, handle }, [...new Set(terms.filter(Boolean))]);
    const out = new Map(titles.map((t, i) => [t, m.get(terms[i]) ?? []]));
    if (process.env.CZ_TEST_HOOKS === "1")
      testLast.search = titles.map((t, i) => ({ query: terms[i], hits: (out.get(t) ?? []).map((h) => h.title) }));
    log2(
      `Searched the channel for ${titles.length} candidate${titles.length === 1 ? "" : "s"}: ${[...out.values()].reduce((a, h) => a + h.length, 0)} videos found`,
    );
    return out;
  } catch (e) {
    if (process.env.CZ_TEST_HOOKS === "1") testLast.search = String(e?.message ?? e);
    log2(`Could not search the channel (${e?.message ?? e}); checked against the known videos only`);
    return new Map();
  }
}
function ytOf(api, pick) {
  if (pick) return pick;
  if (api.item.ctx.ytChannel) return api.item.ctx.ytChannel;
  const p = api.item.ctx.projectId ? getProject(api.item.ctx.projectId) : null;
  return p?.channel_id ? (getChannel(p.channel_id).yt_channel_id ?? "") : "";
}
async function titleStyle(yt, vids, settings, signal, log2, force = false) {
  if (!vids.length) return null;
  const f = path.join(ytDir(yt), "title-style.json"),
    had = readJson(f);
  if (had && !force && vids.length - had.basedOn < 3 && Date.now() - Date.parse(had.at) < 30 * 864e5) {
    log2(`Title style: kept (learned from ${had.basedOn} videos on ${had.at.slice(0, 10)})`);
    return had;
  }
  log2(`Title style: learning it from ${vids.length} public videos`);
  const top = [...vids].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const descs = [...top.slice(0, 3), ...vids.slice(0, 3)]
    .filter((v, i, a) => v.description && a.findIndex((x) => x.id === v.id) === i)
    .slice(0, 5);
  const prompt = `These are all the public videos of a YouTube channel, newest first, with their views:
${vids.slice(0, 400).map(fmtVid).join("\n")}

Some of its video descriptions:
${
  descs
    .map(
      (v) => `--- "${v.title}" ---
${String(v.description).slice(0, 1500)}`,
    )
    .join("\n\n") || "(none)"
}

Reverse-engineer how this channel writes its titles, precisely enough that a new title written by these rules sits among the others as if the creator wrote it: the structure (the fixed frame and the slots that change, e.g. "How [Game] Pushed [Console] Beyond Its Limits"), length in words and characters, capitalisation, punctuation and symbols, numbers, names, the kind of hook, words it always or never uses, and what the most viewed titles do differently. Then describe how its descriptions are laid out (opening, links, credits, hashtags, sign-off) as a template.
Answer with JSON only: {"structure":"one paragraph","rules":["..."],"patterns":["templates with [slots], most used first"],"description":"the description template, with [slots]"}`;
  const text = await claudeText(
    signal,
    settings,
    "You analyse YouTube channels. Answer with the JSON asked for, nothing else.",
    prompt,
    () =>
      JSON.stringify({ structure: "Test structure.", rules: ["Title Case"], patterns: ["How [Thing] Works"], description: "[Summary]" }),
    false,
    void 0,
    log2,
  );
  const j = jsonIn(text);
  const st = {
    structure: String(j.structure ?? "").trim(),
    rules: (Array.isArray(j.rules) ? j.rules : []).map(String).slice(0, 20),
    patterns: (Array.isArray(j.patterns) ? j.patterns : []).map(String).slice(0, 10),
    description: String(j.description ?? "").trim(),
    basedOn: vids.length,
    latest: vids[0]?.id ?? null,
    at: new Date().toISOString(),
  };
  if (!st.structure) return had;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(st, null, 1));
  return st;
}
const styleText = (st) => `How this channel writes titles (learned from its ${st.basedOn} public videos):
${st.structure}
Rules:
${st.rules.map((r) => "- " + r).join("\n")}
Patterns, most used first:
${st.patterns.map((r) => "- " + r).join("\n")}`;
async function seeds(n, o) {
  const s = n.settings ?? {};
  switch (n.type) {
    case "topic":
      return [{ label: String(s.topic).trim(), ctx: { topic: String(s.topic).trim(), notes: String(s.notes ?? "").trim() } }];
    // (a parallel build of the same routine takes the next lines: `busy` = the topics its other builds are making now)
    case "topicList": {
      const seen = new Set(),
        busy = new Set([...(o.busy ?? [])].map((t) => t.toLowerCase()));
      return lines(s.topics)
        .filter((t) => {
          const k = t.toLowerCase();
          if (seen.has(k) || busy.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((t) => ({ label: t, ctx: { topic: t, notes: String(s.notes ?? "").trim() } }));
    }
    case "myScript": {
      const t =
        String(s.title || "").trim() ||
        lines(s.script)
          .find((l) => !l.startsWith("#"))
          ?.slice(0, 80) ||
        "My script";
      return [{ label: t, ctx: { topic: t, title: t, script: String(s.script) } }];
    }
    case "myAudio": {
      const t = String(s.title || "").trim() || path.parse(String(s.files?.[0] ?? "My audio")).name;
      return [
        {
          label: t,
          ctx: { topic: t, title: t, audioFiles: s.files, ...(String(s.script ?? "").trim() ? { script: String(s.script) } : {}) },
        },
      ];
    }
    case "channelIdeas": {
      const ch = checkChannel(s.channelId);
      if (!ch) throw new Error("Channel ideas: its channel is gone. Pick another.");
      return listIdeas()
        .filter((i) => i.channel_id === ch && i.stage === "idea" && !o.taken.has(i.id))
        .slice(0, Math.max(1, +s.count || 1))
        .map((i) => ({ label: i.title, ctx: { topic: i.title, notes: i.notes ?? "", ideaId: i.id, channelId: ch } }));
    }
    case "ideaGenerator":
      return findTopics(s, o);
  }
  return [];
}
async function findTopics(s, o) {
  const ch = s.channelId ? checkChannel(s.channelId) : null,
    count = Math.min(o.max, Math.max(1, +s.count || 1));
  const chan = ch ? getChannel(ch) : null,
    yt = String(s.ytChannel || chan?.yt_channel_id || "");
  const ytRow = yt ? q.get("SELECT title, description FROM yt_channels WHERE id=?", yt) : null;
  const fmt = o.format ?? "both";
  const vids = (yt ? await freshVideos(yt, o.log, o.signal) : []).filter((v) => ofFormat({ f: v.format }, fmt));
  const how = yt && !(process.env.CZ_TEST_HOOKS === "1" && testFeed.has(yt)) ? readNote(yt) : null;
  if (how) o.log(how.text);
  const readAt = yt
    ? String(q.get("SELECT fetched_at FROM yt_channels WHERE id=?", yt)?.fetched_at ?? "")
        .slice(0, 16)
        .replace("T", " ")
    : "";
  const latest = s.look === "all" ? vids.slice(0, 200) : vids.slice(0, Math.max(1, +s.lastN || 10));
  const top = [...vids].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 10);
  const planned = [
    ...(ch ? q.all("SELECT name FROM projects WHERE channel_id=?", ch).map((r) => String(r.name)) : []),
    ...(ch
      ? listIdeas()
          .filter((i) => i.channel_id === ch)
          .map((i) => i.title)
      : []),
  ];
  const lessons = ch ? approvedFor({ channelId: ch }) : [];
  const about = String(s.about ?? s.niche ?? "").trim();
  const known = yt
    ? (() => {
        const m = mergeKnown(yt, true);
        o.log(knownLine(m.known, fmt, m.since, yt).text);
        return m.known;
      })()
    : null;
  const knownTitles = known ? [...new Set(known.videos.filter((v) => ofFormat(v, fmt)).map((v) => v.t))] : vids.map((v) => v.title);
  const past = yt ? pastTopics(yt, ch).filter((t) => !o.takenTopics.has(t)) : [];
  const existing = [
    ...knownTitles.map((t) => ({ title: t, where: "video" })),
    ...planned.map((t) => ({ title: t, where: "project or idea in the app" })),
    ...past.map((t) => ({ title: t, where: "topic found by a routine before" })),
    ...[...o.takenTopics].map((t) => ({ title: t, where: "another video being made now" })),
  ];
  const latestSet = new Set(latest.map((v) => v.title)),
    others = knownTitles.filter((t) => !latestSet.has(t));
  const M = new Matcher(existing.map((e) => prep(e.title)));
  const closest = (t) => {
    const pt = prep(t);
    return existing
      .map((e) => ({ ...e, s: M.compare(prep(e.title), pt).s }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .filter((e) => e.s > 0);
  };
  const out = [],
    rejected = [];
  for (let round = 0; round < 3 && out.length < count; round++) {
    const want = count - out.length + 2;
    const prompt = `Find ${want} new video topic${want === 1 ? "" : "s"} for ${ytRow ? `the YouTube channel "${ytRow.title}"` : chan ? `the channel "${chan.name}"` : "this channel"}.
${
  about
    ? `What the channel is about (from its creator):
${about}
`
    : ""
}${
      ytRow?.description
        ? `The channel's own description: ${String(ytRow.description).slice(0, 600)}
`
        : ""
    }
${
  latest.length
    ? `Its ${s.look === "all" ? "public videos, newest first" : `latest ${latest.length} public videos`} (learn the kind of topic, the angle and the title style from these):
${latest.map(fmtVid).join("\n")}
`
    : ""
}${
      top.length > 3
        ? `
Its most viewed videos:
${top.map(fmtVid).join("\n")}
`
        : ""
    }${
      others.length
        ? `
Every other video the channel has (already covered, never repeat these):
${others
  .slice(0, 5e3)
  .map((t) => "- " + t)
  .join("\n")}
`
        : ""
    }${
      past.length
        ? `
Topics already found for this channel by earlier runs (never repeat these either):
${past
  .slice(0, 1e3)
  .map((x) => "- " + x)
  .join("\n")}
`
        : ""
    }${
      planned.length
        ? `
Already made or planned in the app (don't repeat these either):
${planned
  .slice(0, 200)
  .map((x) => "- " + x)
  .join("\n")}
`
        : ""
    }${
      out.length
        ? `
Already picked for this run (don't repeat):
${out.map((x) => "- " + x.label).join("\n")}
`
        : ""
    }${
      o.takenTopics.size
        ? `
Being made right now by other builds (each new topic must be a completely different subject from these: not the same game, console, hardware part, quirk, event or question, not even from another angle):
${[...o.takenTopics].map((x) => "- " + x).join("\n")}
`
        : ""
    }${
      rejected.length
        ? `
Rejected because the channel already covers them (don't propose these or close variants):
${rejected.map((r) => `- ${r.title} (${r.why})`).join("\n")}
`
        : ""
    }${
      lessons.length
        ? `
What works on this channel (lessons the creator approved):
${lessons.map((x) => "- " + x).join("\n")}
`
        : ""
    }${
      s.notes
        ? `
Notes: ${s.notes}
`
        : ""
    }
Every topic must fit this channel like its best videos do (same world, same kind of question, same audience), be clearly different from everything already covered (not the same subject with new words), and be specific enough to fill the video.
Exclude any idea that overlaps a video or topic listed above: the same subject, or the same angle on it, counts as covered even when the words differ.${
      s.web
        ? `
Research before you pick: search the web (and what people ask on forums, Reddit and YouTube) to find questions and stories in this channel's world that it has not covered yet, and check that each topic is real and has enough to tell.`
        : ""
    }
Each topic: a clickable, specific YouTube title in the channel's own title style (max 90 characters), and notes for the script writer: the angle, the hook, the key facts or sources to start from, and which of the channel's videos it is closest to.
Answer with JSON only: {"ideas":[{"title":"...","notes":"..."}]}`;
    o.log(
      `Topic finder: ${knownTitles.length ? `${knownTitles.length} known ${formatWord(fmt)}` : "no YouTube videos"}${round ? `, round ${round + 1}` : ""}: asking Claude for ${want} topic${want === 1 ? "" : "s"}`,
    );
    if (process.env.CZ_TEST_HOOKS === "1") testLast.prompt = prompt;
    const text = await claudeText(
      o.signal,
      o.settings,
      "You find new video topics for YouTube channels. Use the tools to research when asked. Your final answer is the JSON asked for, nothing else.",
      prompt,
      () =>
        JSON.stringify({
          ideas:
            round === 0 && testLast.cands
              ? testLast.cands.map((title) => ({ title, notes: "A test topic." }))
              : Array.from({ length: want }, (_, i) => ({
                  title: `Test topic ${round * 10 + i + 1}${about ? ` about ${about.slice(0, 40)}` : ""}`,
                  notes: "A test topic.",
                })),
        }),
      !!s.web,
      void 0,
      o.log,
    );
    const cands = (jsonIn(text).ideas ?? [])
      .filter((x) => typeof x?.title === "string" && x.title.trim())
      .map((x) => ({ title: x.title.trim(), notes: String(x.notes ?? "").trim() }));
    if (!cands.length) continue;
    const found = yt
      ? await channelSearch(
          yt,
          cands.map((c) => c.title),
          o.log,
        )
      : new Map();
    for (const hits of found.values())
      for (const h of hits) if (!existing.some((e) => e.title === h.title)) existing.push({ title: h.title, where: "video" });
    if (yt && found.size) addFound(yt, [...found.values()].flat());
    const near = cands.map((c) => ({ ...c, near: closest(c.title), found: (found.get(c.title) ?? []).slice(0, 8) }));
    const vprompt = `A YouTube channel must never make a video it has already made. Check each candidate topic against what the channel already has.
Candidates, each with the existing titles closest to it by their words:
${near
  .map(
    (c, i) => `${i + 1}. "${c.title}"
   ${c.notes.slice(0, 300)}
   Closest existing: ${c.near.length ? c.near.map((e) => `"${e.title}" (${e.where})`).join("; ") : "(none share its words)"}${
     c.found.length
       ? `
   Found by searching the channel for "${searchTerms(c.title)}": ${c.found.map((h) => `"${h.title}"`).join("; ")}`
       : ""
   }`,
  )
  .join("\n")}

Everything the channel already has${knownTitles.length ? ` (all ${knownTitles.length} known videos${readAt ? `, read ${readAt}` : ""})` : ""}:
${
  existing
    .slice(0, 6e3)
    .map((e) => `- ${e.title}${e.where === "video" ? "" : ` [${e.where}]`}`)
    .join("\n") || "(nothing yet)"
}

A candidate is NOT new when an existing video already tells the same story or answers the same question, even with other words, or when it is the same subject with only a slightly different angle.${o.takenTopics.size ? ` Titles marked [another video being made now] are videos being made at this moment: a candidate about the same subject as one of them (the same game, console, hardware part, quirk, event or question), from any angle, is NOT new.` : ""} It IS new when its subject (the game, the machine, the person, the event, the question) is not the subject of any existing video, or the angle is clearly a different story.
Answer with JSON only: {"verdicts":[{"n":1,"new":true,"closest":"the most similar existing title","why":"one short sentence"}]}`;
    const vt = await claudeText(
      o.signal,
      o.settings,
      "You check video topics against a channel's existing videos. Be strict. Answer with the JSON asked for, nothing else.",
      vprompt,
      () => JSON.stringify({ verdicts: near.map((_, i) => ({ n: i + 1, new: true, closest: "", why: "test" })) }),
      false,
      void 0,
      o.log,
    );
    const verdicts = jsonIn(vt).verdicts ?? [];
    near.forEach((c, i) => {
      const v = verdicts.find((x) => +x.n === i + 1);
      if (!v || v.new !== true) {
        rejected.push({ title: c.title, why: String(v?.why || "not confirmed new").slice(0, 200) });
        o.log(`Rejected (already covered): "${c.title}": ${v?.why ?? "not confirmed"}`);
        return;
      }
      const twin = [...existing, ...c.found.map((h) => ({ title: h.title, where: "video found by searching the channel" }))].find((e) => {
        const m = M.compare(prep(e.title), prep(c.title));
        return m.close && m.s >= 0.85;
      });
      if (twin) {
        rejected.push({ title: c.title, why: `its title nearly matches "${twin.title}"` });
        o.log(`Rejected (title nearly matches "${twin.title}" (${twin.where})): "${c.title}"`);
        return;
      }
      if (out.length >= count || out.some((x) => x.label.toLowerCase() === c.title.toLowerCase())) return;
      const nearList = c.near
        .slice(0, 3)
        .map((e) => `"${e.title}"`)
        .join(", ");
      const verified =
        `Checked new against ${knownTitles.length ? `all ${knownTitles.length} known videos of ${ytRow?.title ?? "the channel"}${readAt ? ` (read ${readAt})` : ""}` : "the channel"}${planned.length ? ` and ${planned.length} projects and ideas` : ""}${past.length ? ` and ${past.length} earlier topics` : ""}. ${v.why ? String(v.why) : ""}${nearList ? ` Closest existing: ${nearList}.` : ""}`.trim();
      o.log(`New: "${c.title}"`);
      out.push({
        label: c.title,
        note: verified,
        ctx: {
          topic: c.title,
          channelId: ch,
          ytChannel: yt || void 0,
          verified,
          notes: [
            c.notes,
            `This topic was checked against the channel (${knownTitles.length} known videos${planned.length ? ` and ${planned.length} projects and ideas` : ""}): it is new.${nearList ? ` The closest videos the channel already has are ${nearList}: keep this one's story and angle clearly different from them.` : ""}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      });
    });
  }
  if (!out.length)
    throw new Error(
      `Every topic Claude found is already covered by the channel (${rejected.length} rejected: ${rejected
        .slice(0, 3)
        .map((r) => `"${r.title}"`)
        .join(", ")}). Write more about the channel, or try again.`,
    );
  if (out.length < count) o.log(`Only ${out.length} of ${count} topics passed the check after three rounds`);
  if (yt)
    addTopics(
      yt,
      out.map((x) => x.label),
    );
  return out;
}
function chaptersOf(dir) {
  let script = "";
  try {
    script = fs.readFileSync(path.join(dir, "script.txt"), "utf8");
  } catch {
    return null;
  }
  const tl = readJson(path.join(dir, "audio", "timeline.json"));
  if (!Array.isArray(tl)) return null;
  const solid = lang(projectLanguage(dir)).spaced === false,
    N = solid ? 6 : 3;
  const units = (s) => (solid ? [...norm(s).replace(/ /g, "")] : norm(s).split(" ").filter(Boolean));
  const words = tl.flatMap((ph) => (ph.words || []).flatMap((w) => units(String(w.w)).map((x) => ({ w: x, s: +w.s }))));
  const secs = [];
  for (const line of script.split(/\r?\n/)) {
    const h = /^##\s+(.+)/.exec(line);
    if (h) {
      secs.push({ title: h[1].trim(), first: [] });
      continue;
    }
    const cur = secs[secs.length - 1];
    if (!cur || cur.first.length >= N || /^\s*\[/.test(line)) continue;
    cur.first.push(...units(line).slice(0, N - cur.first.length));
  }
  if (secs.length < 3) return null;
  const out = [];
  let from = 0;
  for (const [i, sec] of secs.entries()) {
    let at = -1;
    for (let k = from; k <= words.length - sec.first.length && at < 0; k++)
      if (sec.first.length && sec.first.every((w, m) => words[k + m].w === w)) at = k;
    const t = i === 0 ? 0 : at >= 0 ? words[at].s : -1;
    if (t < 0) continue;
    if (at >= 0) from = at + 1;
    if (out.length && t - out[out.length - 1].t < 10) continue;
    out.push({ t, title: sec.title });
  }
  if (out.length < 3) return null;
  const mmss = (t) => {
    t = Math.floor(t);
    const h = Math.floor(t / 3600),
      m = Math.floor((t % 3600) / 60),
      s = t % 60;
    return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(s).padStart(2, "0")}`;
  };
  return out.map((c) => `${mmss(c.t)} ${c.title}`).join("\n");
}
const R = {
  async createProject(api) {
    const s = api.s,
      c = api.item.ctx;
    const style = getStyle(s.styleId || "flat");
    if (style.missing) throw new Error("Its style is not on this computer any more. Pick another style.");
    const look = s.presetId && getPreset(s.presetId)?.style_id === style.id ? s.presetId : style.defaultLook;
    const channelId = checkChannel(s.channelId || c.channelId || null);
    const name =
      (fill(s.name || "{topic}", api, { channel: channelId ? getChannel(channelId).name : "" }) || c.topic || "Untitled video") +
      (c.effortTag ? ` · ${c.effortTag}` : "");
    const flat = baseOf(style.id) === "flat",
      stick = baseOf(style.id) === "stickman",
      recon = baseOf(style.id) === "recon";
    api.log(`Creating "${name}" (${style.name}${s.format === "vertical" ? ", 9:16" : ""})`);
    const choices = checkChoices(s.project && typeof s.project === "object" ? s.project : null);
    const made = await createProject({
      name,
      presetId: look,
      styleId: style.id,
      script: c.script ?? null,
      topic: c.topic ?? null,
      brief: c.notes || null,
      length: +s.length || null,
      format: s.format === "vertical" ? "vertical" : "landscape",
      character: flat ? (s.character === "random" ? { random: true } : s.character === "none" ? { none: true } : {}) : null,
      language: s.language || null,
      ...(s.brand ? { brand: String(s.brand) } : {}),
      // the node's Brand colour (empty: the look's)
      settings: stick
        ? { detail: !!s.detail, web: { on: !!s.webImages, perMin: Math.max(0, Math.min(6, Math.round(+(s.webPerMin ?? 2)))) } }
        : recon
          ? {
              media: { on: s.reconMedia !== false, perMin: Math.max(0, Math.min(4, Math.round(+(s.reconPerMin ?? 1)))) },
              models: { on: s.reconModels !== false },
              maps: { on: s.reconMaps !== false },
            }
          : null,
    });
    if (applyChoices(made.id, choices)) writeContext(made.id);
    adoptNewProject(made.id, { channelId, ideaId: c.ideaId ?? null });
    api.setProject(made.id);
    api.send("channels:changed", { what: "board" });
    if (c.audioFiles?.length) {
      grantPaths(c.audioFiles);
      await voice(api, made.id, made.path, { provider: "file", files: c.audioFiles, autoTime: true });
    }
    return { ctx: { projectId: made.id, channelId }, note: name };
  },
  async writeScript(api) {
    const p = project(api);
    if (api.s.scriptSkill === "own") {
      const own = api.s.ownSkill?.id ? ownSkill(api.s.ownSkill.id) : null;
      if (!own)
        throw new Error(
          api.s.ownSkill?.id
            ? `This node's own scripting skill "${api.s.ownSkill.name || "skill"}" is not on this computer. Add it again in the node.`
            : "Add this node's own scripting skill first (or pick another Scripting skill choice).",
        );
      setScriptSkillChoice(p, { own: own.id });
      api.log(`Writing with this node's own scripting skill: ${own.name}`);
    } else if (setScriptSkillChoice(p, api.s.scriptSkill === "off" ? false : void 0) && api.s.scriptSkill === "off")
      api.log("Not using your scripting skill for this video");
    const had = spokenWords(p.path);
    if (had.words > 20 && !api.s.overwrite) return { note: `Skipped: the video has a script (${had.words} ${had.unit}).` };
    const pj = pjOf(p.path),
      L = lang(pj.language),
      target = Math.round(((pj.targetLength || 120) / 60) * L.wpm),
      tol = Math.max(2, +api.s.tolerance || 10) / 100;
    const lo = Math.round(target * (1 - tol)),
      hi = Math.round(target * (1 + tol));
    const how = SCRIPT_PRESETS.find((x) => x.value === api.s.preset)?.detail;
    await claudeTask(api, {
      projectId: p.id,
      kind: "script",
      instruction: [how, api.item.ctx.notes, api.s.notes].filter(Boolean).join("\n\n"),
    });
    for (let i = 0; ; i++) {
      const n = spokenWords(p.path).words;
      if (!n) throw new Error("Claude did not write script.txt.");
      const u = wordUnit(L.code);
      if (n >= lo && n <= hi) return { note: `${n} ${u} (target ${target}).` };
      if (i >= (+api.s.tries || 0)) return { warn: `The script has ${n} ${u}; the target is ${lo}-${hi}.` };
      api.log(`${n} ${u}: outside ${lo}-${hi}, asking Claude to fit it`);
      await claudeTask(api, {
        projectId: p.id,
        kind: "script",
        instruction: `The script has ${n} spoken ${u}; it must have between ${lo} and ${hi}. ${n > hi ? "Cut" : "Add"} until it fits; keep the angle and facts.`,
      });
    }
  },
  async scriptRules(api) {
    const p = project(api),
      s = api.s;
    const problems = () => {
      const { text, words, unit: u } = spokenWords(p.path),
        low = text.toLowerCase(),
        out = [],
        code = projectLanguage(p.path);
      if (!words) return ["There is no script yet."];
      for (const b of lines(s.banned)) if (low.includes(b.toLowerCase())) out.push(`It says "${b}" (banned).`);
      for (const r of lines(s.required)) if (!low.includes(r.toLowerCase())) out.push(`It must say "${r}".`);
      if (+s.maxSentence > 0) {
        const long = text.split(/(?<=[.!?])\s+|(?<=[。！？।])\s*/).filter((x) => countWords(x, code) > +s.maxSentence);
        if (long.length) out.push(`${long.length} sentence(s) are longer than ${s.maxSentence} ${u}, e.g. "${long[0].slice(0, 120)}…".`);
      }
      if (+s.minWords > 0 && words < +s.minWords) out.push(`It has ${words} ${u}; at least ${s.minWords} are needed.`);
      if (+s.maxWords > 0 && words > +s.maxWords) out.push(`It has ${words} ${u}; at most ${s.maxWords} are allowed.`);
      return out;
    };
    for (let i = 0; ; i++) {
      const bad = problems();
      if (!bad.length) return { note: "Every rule passes." };
      bad.forEach((b) => api.log(b));
      if (s.onFail === "warn") return { warn: bad.join(" ") };
      if (s.onFail !== "fix" || i >= Math.max(1, +s.tries || 1)) throw new Error(bad.join(" "));
      const was = projectSkillChoice(p.path),
        changed = setScriptSkillChoice(p, s.scriptSkill === "off" ? false : was === false ? void 0 : was);
      try {
        await claudeTask(api, {
          projectId: p.id,
          kind: "script",
          instruction: `Revise script.txt so it follows these rules (keep everything else):
${bad.map((b) => "- " + b).join("\n")}`,
        });
      } finally {
        if (changed) setScriptSkillChoice(p, was);
      }
    }
  },
  async voiceover(api) {
    const p = project(api),
      a = path.join(p.path, "audio");
    if (fs.existsSync(a) && fs.readdirSync(a).some((f) => /^source\./.test(f))) return { note: "Skipped: the video has narration." };
    if (!spokenWords(p.path).words) throw new Error("There is no script to read: put Write script (or My script) before it.");
    const cfg = getConfig().voice,
      language = projectLanguage(p.path),
      per = cfg.langs?.[language];
    const tts = (v) => (v === "elevenlabs" || v === "kokoro" || v === "fish" ? v : null),
      own = tts(overridesOf(p.id).voice);
    const provider =
      tts(api.s.provider) ?? own ?? (keyStatus().hasKey ? "elevenlabs" : fishKeyStatus().hasKey ? "fish" : kokoroFiles() ? "kokoro" : null);
    if (!provider)
      throw new Error(
        "No voice is set up: add an ElevenLabs or Fish Audio key, or install the local voice (Settings > Media > Voiceover).",
      );
    const speed = +api.s.speed || 1;
    const req = { provider, autoTime: true };
    if (provider === "elevenlabs") {
      const e = { ...cfg.elevenlabs, ...(per?.elevenlabs ?? {}) };
      if (api.s.elevenVoice) {
        e.voiceId = api.s.elevenVoice;
        e.voiceName = "";
      }
      if (api.s.elevenModel) e.modelId = api.s.elevenModel;
      if (!e.voiceId)
        throw new Error(
          "Pick an ElevenLabs voice in this node (or make one voiceover in the Voiceover window first: its voice is remembered).",
        );
      req.eleven = { ...e, speed };
    } else if (provider === "fish") {
      if (!fishKeyStatus().hasKey)
        throw new Error("Add your Fish Audio key in Settings > Media > Voiceover (or pick another voice in this node).");
      const f = { voiceId: null, voiceName: null, model: "s2.1-pro", ...(cfg.fish ?? {}), ...(per?.fish ?? {}) };
      if (api.s.fishVoice) {
        f.voiceId = String(api.s.fishVoice).trim();
        f.voiceName = "";
      }
      if (api.s.fishModel) f.model = api.s.fishModel;
      if (!f.voiceId)
        throw new Error(
          "Pick a Fish Audio voice in this node (or make one voiceover with Fish Audio in the Voiceover window first: its voice is remembered).",
        );
      if (!fishSpeaks(f.model, language))
        throw new Error(
          `${FISH_MODELS.find((m) => m.id === f.model)?.name ?? f.model} does not speak ${lang(language).name}: pick S2.1 Pro in this node.`,
        );
      req.fish = { voiceId: f.voiceId, voiceName: f.voiceName || "", model: f.model, speed };
    } else {
      const voices = kokoroVoicesFor(language);
      if (!voices.length)
        throw new Error(`The local voice does not speak ${lang(language).name}. Use ElevenLabs or Fish Audio for this video.`);
      const want =
        [api.s.kokoroVoice, per?.kokoro?.voice, cfg.kokoro.voice].find((v) => v && voices.some((x) => x.id === v)) ??
        (voices.find((v) => v.best) ?? voices[0]).id;
      req.kokoro = { voice: want, speed };
    }
    const j = await voice(api, p.id, p.path, req);
    const pct = j.timing?.total ? Math.round((j.timing.matched / j.timing.total) * 100) : null;
    if (pct !== null && pct < (+api.s.minMatch || 0))
      throw new Error(`Only ${pct}% of the script's words were heard when it was timed (${api.s.minMatch}% needed).`);
    return {
      note: `${provider === "elevenlabs" ? "ElevenLabs" : provider === "fish" ? "Fish Audio" : "Local voice"}${j.duration ? `, ${Math.round(j.duration)} s` : ""}${pct !== null ? `, ${pct}% of words timed` : ""}.`,
    };
  },
  async cleanAudio(api) {
    await step(api, "clean", { tightenPauses: !!api.s.tighten });
    return { note: "Cleaned." };
  },
  async timeWords(api) {
    const { out } = await step(api, "timeline"),
      m = matchedOf(out);
    const pct = m?.total ? Math.round((m.matched / m.total) * 100) : null;
    if (pct !== null && pct < (+api.s.minMatch || 0))
      throw new Error(`Only ${pct}% of the script's words were found in the narration (${api.s.minMatch}% needed).`);
    return { note: pct !== null ? `${pct}% of the script's words timed.` : "Timed." };
  },
  async buildVideo(api) {
    const p = project(api);
    if (!fs.existsSync(path.join(p.path, "audio", "timeline.json")) || !fs.existsSync(path.join(p.path, "audio", "clean.wav")))
      throw new Error("The narration is not ready (cleaned and timed). Put Voiceover (or Clean audio + Time words) before it.");
    const bs = api.settings.buildLevel ? { ...api.s, level: api.settings.buildLevel } : api.s;
    const base2 = baseOf(p.style_id),
      { extras, skipped } = nodeBuildExtras(bs, base2),
      byKey = new Map(extrasFor(base2).map((x) => [x.key, x]));
    api.log(
      `Build quality: ${levelName(nodeLevel(bs))}${extras.length ? ` (${extras.map((k) => byKey.get(k)?.short ?? k).join(", ")})` : ""}`,
    );
    for (const x of skipped) api.log(`Skipped "${x.short}": ${x.off}`);
    const mins = TIME_LIMIT_BASES.includes(base2) ? Math.round(+api.s.timeLimit || 0) : 0;
    if (mins > 0) api.log(`Time limit: ${mins} min`);
    const instruction = [String(api.s.notes ?? "").trim(), mins > 0 ? timeLimitText(mins, extras.includes("ultra")) : ""]
      .filter(Boolean)
      .join("\n\n");
    await claudeTask(api, { projectId: p.id, kind: "build", instruction, extras });
    return { note: "Built." };
  },
  async qualityCheck(api) {
    const p = project(api),
      s = api.s,
      tries = s.onFail === "fix" ? Math.max(1, +s.tries || 1) : 0;
    for (let i = 0; ; i++) {
      api.log(i ? `Checking again (after fix ${i})` : "Checking scenes, layout, length and shots");
      const issues = [];
      const st = await hostState(p.id, true);
      if (st.bootError) issues.push(`The video does not load: ${st.bootError}`);
      for (const e of (st.errors ?? []).slice(0, 8))
        issues.push(`Scene error: ${typeof e === "string" ? e : (e?.message ?? JSON.stringify(e))}`.slice(0, 300));
      const pj = pjOf(p.path),
        end = +pj.end || 0,
        target = +pj.targetLength || 0;
      if (!end) issues.push("The video has no length (no timed narration).");
      else if (target && !api.item.ctx.audioFiles?.length && (Math.abs(end - target) / target) * 100 > (+s.lengthTol || 25))
        issues.push(`It is ${Math.round(end)} s long; the target is ${target} s (±${s.lengthTol}%).`);
      if (!st.bootError) {
        try {
          const r = await layoutCheck(p.id);
          const list = Array.isArray(r?.issues) ? r.issues : [];
          if (list.length > (+s.maxLayout || 0))
            issues.push(
              `${list.length} layout problem(s) (${+s.maxLayout || 0} allowed): ` +
                list
                  .slice(0, 12)
                  .map((x) =>
                    typeof x === "string"
                      ? x
                      : `${x.t != null ? (+x.t).toFixed(1) + "s " : ""}${x.text ?? x.msg ?? x.message ?? x.kind ?? JSON.stringify(x)}`,
                  )
                  .join("; "),
            );
        } catch {}
        if (s.blank && end) {
          const times = Array.from({ length: 6 }, (_, k) => +(end * (0.08 + k * 0.17)).toFixed(2));
          try {
            const shots = await renderStills(p.id, times, 0.25, "routine-qc");
            const bad = shots.filter((x) => x.error || (x.file && blank(x.file))).map((x) => `${x.time.toFixed(1)}s`);
            if (bad.length) issues.push(`Blank or broken frames at ${bad.join(", ")}.`);
          } catch (e) {
            issues.push(`Frames could not be rendered: ${e.message}`);
          }
        }
        if (s.frames !== false && end) {
          api.log("Playing every frame for scene errors");
          try {
            const sw = await sweepErrors(p.id);
            if (sw?.errors.length)
              issues.push(
                ...sw.errors
                  .slice(0, 8)
                  .map(
                    (e) =>
                      `A scene throws at ${e.t.toFixed(2)}s (${e.where}): ${e.message}. The export draws this frame, so it would fail there; the preview may never show it (often the moment around a shot change).`,
                  ),
              );
            else if (sw) api.log(`${sw.frames} frames played: no scene errors`);
          } catch (e) {
            issues.push(`The frames could not all be played: ${e.message}`);
          }
        }
      }
      if (!issues.length) return { note: "Clean: no scene errors in any frame." };
      issues.forEach((x) => api.log(x));
      if (s.onFail === "warn") return { warn: issues.join(" ") };
      if (s.onFail !== "fix" || i >= tries) throw new Error(issues.join(" "));
      await claudeTask(api, {
        projectId: p.id,
        kind: "edit",
        scope: "video",
        instruction: `A quality check of this video found these problems. Fix every one of them (check_preview, ${["flat", "collage", "recon", "lowpoly", "toon", "stickstory", "starter"].includes(baseOf(p.style_id)) ? "check_layout until it is clean, " : ""}then render_frames to confirm):
${issues.map((x) => "- " + x).join("\n")}`,
      });
    }
  },
  async soundDesign(api) {
    const { r, out } = await step(api, "sound"),
      ratio = r?.voice_to_bed_db_while_speaking;
    const broken = out.filter((l) => /^Skipped frames that threw/.test(l));
    if (typeof ratio === "number" && ratio < 16) {
      const msg = `The voice is only ${ratio} dB above the music and effects (16 needed).`;
      if (api.s.strict) throw new Error(msg);
      return { warn: msg };
    }
    if (broken.length)
      return {
        warn: `Mixed, but some frames of a scene throw an error (no sound accents there): ${broken[0].replace(/^Skipped frames that threw an error \([^)]*\): /, "")}`,
      };
    return { note: typeof ratio === "number" ? `Mixed: the voice is ${ratio} dB above the music.` : "Mixed." };
  },
  async render(api) {
    const p = project(api),
      name = fill(api.s.name || "{project}", api) || p.name;
    api.log(`Exporting ${api.s.quality === "uhd" ? "4K" : "Full HD"}`);
    const go = () =>
      exportWith(api, p.id, "video", (prog) =>
        exportVideo(p.id, { name, uhd: api.s.quality === "uhd", captions: api.s.captions !== false }, prog),
      );
    let r;
    try {
      r = await go();
    } catch (e) {
      const msg = String(e?.message || e);
      if (api.signal.aborted || api.s.fix === false || /cancel|ffmpeg|disk|space|EBUSY|EPERM/i.test(msg)) throw e;
      api.log(`The export stopped: ${msg}. Finding the frame and asking Claude to fix the scene`);
      const sw = await sweepErrors(p.id).catch(() => null);
      const where = sw?.errors.length
        ? sw.errors
            .slice(0, 6)
            .map((x) => `- at ${x.t.toFixed(2)}s, ${x.where}: ${x.message}`)
            .join("\n")
        : `- the export stopped with: ${msg}`;
      await claudeTask(api, {
        projectId: p.id,
        kind: "edit",
        scope: "video",
        instruction: `Exporting this video failed: a scene throws an error at a frame the export draws (the preview may never show that moment, often the frames around a shot change, when the time is before the shot's start). Fix the cause in the scene code so every frame draws, guarding values that can be out of range there:
${where}
Then render_frames around each place to confirm.`,
      });
      api.log("Exporting again");
      r = await go();
    }
    q.run("UPDATE projects SET status='ready' WHERE id=? AND status<>'ready'", p.id);
    return { ctx: { video: r.path }, note: path.basename(r.path) };
  },
  async vertical(api) {
    const p = project(api),
      pj = pjOf(p.path),
      s = api.s;
    const tall = aspectOf(p.style_id, pj.settings) < 1;
    if (tall && s.length !== "trailer") return { note: "Skipped: the video is 9:16 already.", ctx: { vertical: api.item.ctx.video } };
    let source = s.source === "reframe" ? "reframe" : "cut";
    if (source === "reframe" && ["pixel-art", "stickman", "recon"].includes(baseOf(p.style_id))) {
      source = "cut";
      api.log(
        `${getStyle(p.style_id).name} is drawn for 16:9 only: its 9:16 version is cut (${s.fit === "blur" ? "fit on blur" : "crop to fill"})`,
      );
    }
    if (tall) source = "cut";
    if (source === "reframe") {
      if (baseOf(p.style_id) === "pixel-art") throw new Error(PIXEL_REFRAME);
      const sib = reframeOf(p.id) ?? (await makeReframe(p.id));
      if (reframeState(sib.id) !== "done") {
        api.log("Claude lays the scenes out for 9:16");
        await claudeTask(api, { projectId: sib.id, kind: "reframe", instruction: REFRAME_TASK, newSession: !projectThread(sib.id) });
      }
    }
    const info = await verticalInfo(p.id),
      length = s.length === "trailer" ? "trailer" : "full";
    const o = {
      name: `${p.slug || "video"}_9x16`,
      source,
      fit: s.fit === "blur" ? "blur" : "crop",
      x: 0.5,
      captions: s.captions !== false,
      length,
      start: 0,
      max: Math.max(10, +s.max || 60),
      endCard: { on: !!s.endCard, lines: [info?.defaults?.line1 ?? HEADLINES[length], info?.defaults?.line2 ?? ""], picture: "cover" },
    };
    const r = await exportWith(api, p.id, length === "trailer" ? "trailer" : "vertical", (prog) => exportVertical(p.id, o, prog));
    return { ctx: { vertical: r.path }, note: path.basename(r.path) };
  },
  async thumbnail(api) {
    const p = project(api),
      sd = path.join(p.path, ".suite"),
      pj = pjOf(p.path);
    fs.mkdirSync(sd, { recursive: true });
    let img,
      note = "",
      extra = { thumbVariations: void 0, thumbPick: void 0 };
    const mode = thumbMode(api.s);
    const out = path.join(p.path, "out"),
      stem = api.item.ctx.video ? path.parse(api.item.ctx.video).name : p.slug || "video";
    if (mode !== "frame") {
      const tall = aspectOf(p.style_id, pj.settings) < 1,
        count = thumbCount(api.s),
        key2 = String(api.s.styleKey ?? "").trim();
      const plan =
        mode === "claude"
          ? await designThumb(api, p, pj, count)
          : mode === "refs"
            ? await refsThumb(api, p, pj, count)
            : { prompts: [fill(api.s.prompt || "{topic}", api)], refs: [], analysis: "" };
      const prompts = Array.from({ length: count }, (_, i) => withStyleKey(plan.prompts[i % plan.prompts.length], key2));
      if (key2) api.log("Global style key added to the end of every prompt.");
      const vars = await makeVariations(api, p, tall, prompts, plan.refs);
      fs.mkdirSync(out, { recursive: true });
      for (const f of fs.readdirSync(out))
        if (f.startsWith(`${stem}_thumbnail_v`) && /_v\d+\.jpg$/.test(f)) fs.rmSync(path.join(out, f), { force: true });
      const files = vars.map((v) => {
        if (!v.img) return null;
        const f = path.join(out, `${stem}_thumbnail_v${v.n}.jpg`);
        fs.writeFileSync(f, fitWidth(v.img).toJPEG(88));
        return f;
      });
      let win = vars.find((v) => v.img),
        why = "";
      if (thumbJudges(api.s) && vars.filter((v) => v.img).length > 1) {
        api.log(`Claude is comparing the ${vars.filter((v) => v.img).length} variations`);
        const j = await judgeThumbs(api, p, pj, vars, plan.analysis);
        win = vars.find((v) => v.n === j.winner && v.img) ?? win;
        why = j.why;
        api.log(`Picked variation ${win.n}${why ? `: ${why}` : ""}`);
      }
      img = win.img;
      const list = vars.map((v, i) => ({ n: v.n, file: files[i], prompt: v.prompt, error: v.error ?? null, winner: v.n === win.n }));
      const sd2 = path.join(p.path, ".suite", "thumbref");
      fs.mkdirSync(sd2, { recursive: true });
      const prev = readJson(path.join(sd2, "plan.json")) ?? {};
      fs.writeFileSync(
        path.join(sd2, "plan.json"),
        JSON.stringify({ ...prev, prompt: win.prompt, prompts, pick: { winner: win.n, why } }, null, 1),
      );
      extra = { thumbVariations: list, thumbPick: { winner: win.n, why } };
      const head =
        mode === "claude" ? "Designed by Claude" : mode === "refs" ? "In the style of your references" : "AI picture from the template";
      note = (
        count > 1
          ? `${head} · ${vars.filter((v) => v.img).length} variations, ${why ? `Claude picked ${win.n}: ${why}` : `variation ${win.n} used.`}`
          : `${head}${mode !== "ai" ? `: ${win.prompt.slice(0, 160)}` : "."}`
      ).slice(0, 600);
    } else {
      const end = +pj.end || 0;
      if (!end) throw new Error("The video has no length yet.");
      const t = +(end * Math.min(0.98, Math.max(0, (+api.s.at || 30) / 100))).toFixed(2);
      const [st] = await renderStills(p.id, [t], 1, "routine-thumb");
      if (!st?.file) throw new Error(`The frame at ${t}s threw an error.`);
      img = nativeImage.createFromPath(st.file);
    }
    img = fitWidth(img);
    for (const f of fs.readdirSync(sd)) if (/^thumbnail\.(png|jpe?g|webp)$/i.test(f)) fs.rmSync(path.join(sd, f), { force: true });
    const jpg = img.toJPEG(88);
    fs.writeFileSync(path.join(sd, "thumbnail.jpg"), jpg);
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `${stem}_thumbnail.jpg`);
    fs.writeFileSync(file, jpg);
    api.send("projects:covers", { projectId: p.id });
    return { ctx: { thumbnail: file, ...extra }, note: note || `Frame at ${api.s.at ?? 30}%.` };
  },
  async titleDesc(api) {
    const p = project(api),
      pj = pjOf(p.path),
      script = spokenWords(p.path).text,
      L = lang(pj.language);
    const yt = ytOf(api, api.s.ytChannel),
      ytRow = yt ? q.get("SELECT title FROM yt_channels WHERE id=?", yt) : null;
    const vids = yt ? publicVideos(yt) : [];
    const style = yt ? await titleStyle(yt, vids, api.settings, api.signal, api.log, !!api.s.relearn) : null;
    const lessons = approvedFor({ projectId: p.id });
    const heads = (() => {
      try {
        return fs
          .readFileSync(path.join(p.path, "script.txt"), "utf8")
          .split(/\r?\n/)
          .filter((l) => /^##\s/.test(l))
          .map((l) => l.replace(/^##\s*/, ""));
      } catch {
        return [];
      }
    })();
    const thumb = readJson(path.join(p.path, ".suite", "thumbref", "plan.json"))?.prompt;
    const top = [...vids].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 10);
    const lastDesc = vids.find((v) => v.description)?.description;
    const prompt = `Write the YouTube title, description and tags for this video${L.code !== "en" ? ` in ${L.name} (${L.native}${L.writing ? `: ${L.writing}` : ""})` : ""}${ytRow ? ` on the channel "${ytRow.title}"` : ""}.
${
  style
    ? `
${styleText(style)}
`
    : ""
}${
      vids.length
        ? `
Its latest titles:
${vids.slice(0, 25).map(fmtVid).join("\n")}

Its most viewed titles:
${top.map(fmtVid).join("\n")}
`
        : ""
    }
This video: ${pj.topic || api.item.ctx.topic || p.name}${
      api.item.ctx.topic && api.item.ctx.topic !== pj.topic
        ? `
Working title from the topic search: ${api.item.ctx.topic}`
        : ""
    }
Length: about ${Math.round(+pj.end || +pj.targetLength || 0)} seconds.${
      heads.length
        ? `
Sections: ${heads.join(" | ")}`
        : ""
    }${
      thumb
        ? `
The thumbnail shows: ${String(thumb).slice(0, 600)}
Title and thumbnail work together: the title must not just repeat the words on the thumbnail.`
        : ""
    }
${
  lessons.length
    ? `
What works on this channel (approved lessons):
${lessons.map((x) => "- " + x).join("\n")}
`
    : ""
}${
      api.s.notes
        ? `
Notes from the creator: ${api.s.notes}
`
        : ""
    }
Narration:
${script.slice(0, 12e3)}

The title: ${style ? "built exactly by the channel's structure and rules above, so it sits among its other titles as if the creator wrote it" : "clear and specific, curiosity without lying"}; at most 100 characters; true to what the video says. Write 3 options, say in one line why each fits, and pick the best.
The description: ${
      style?.description
        ? `follow the channel's description template:
${style.description}
`
        : lastDesc
          ? `laid out like the channel's latest one:
${String(lastDesc).slice(0, 1200)}
`
          : "2-4 short paragraphs, then a line of 3-5 hashtags. "
    }No timestamps (the app adds the chapters). 8-15 tags.
Answer with JSON only: {"options":[{"title":"...","why":"..."}],"title":"the best option","description":"...","tags":["..."]}`;
    const text = await claudeText(
      api.signal,
      api.settings,
      "You write YouTube titles and descriptions that match a channel's own style exactly. Answer with the JSON asked for, nothing else.",
      prompt,
      () =>
        JSON.stringify({
          options: [{ title: `Test title: ${pj.topic || p.name}`.slice(0, 100), why: "test" }],
          title: `Test title: ${pj.topic || p.name}`.slice(0, 100),
          description: "A test description.",
          tags: ["test"],
        }),
      false,
      void 0,
      api.log,
    );
    const j = jsonIn(text);
    const options = (Array.isArray(j.options) ? j.options : [])
      .map((o) => ({
        title: String(o?.title ?? "")
          .trim()
          .slice(0, 100),
        why: String(o?.why ?? "").trim(),
      }))
      .filter((o) => o.title);
    let description = String(j.description ?? "")
      .trim()
      .slice(0, 4500);
    const chapters = api.s.chapters !== false ? chaptersOf(p.path) : null;
    if (chapters)
      description = `${description}

${chapters}`;
    const pub = {
      title: String(j.title || options[0]?.title || "")
        .trim()
        .slice(0, 100),
      description: description.slice(0, 4900),
      tags: (Array.isArray(j.tags) ? j.tags : [])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 30),
      options,
    };
    if (!pub.title) throw new Error("Claude gave no title. Retry this video.");
    const same = vids.find((v) => v.title.trim().toLowerCase() === pub.title.toLowerCase());
    if (same) throw new Error(`Claude wrote a title the channel already has ("${same.title}"). Retry this video.`);
    fs.writeFileSync(path.join(p.path, "publish.json"), JSON.stringify(pub, null, 1));
    options.forEach((o) => api.log(`Option: ${o.title}${o.why ? ` (${o.why})` : ""}`));
    return {
      ctx: { publish: pub },
      note: `${pub.title}${style ? ` · in the channel's title style (from ${style.basedOn} videos)` : ""}${chapters ? " · with chapters" : ""}`,
    };
  },
  async approval(api) {
    api.log(api.s.note ? `Waiting for you: ${api.s.note}` : "Waiting for you to approve or reject.");
    const ok = await api.approve();
    if (!ok) return { stop: "rejected", note: "Rejected." };
    return { note: "Approved." };
  },
  async moveStage(api) {
    const p = project(api);
    setPlan(p.id, { stage: api.s.stage || "review" });
    api.send("channels:changed", { what: "board" });
    return { note: `Moved to ${api.s.stage}.` };
  },
  async notify(api) {
    const t = fill(api.s.text || "{project} is ready", api),
      c = api.item.ctx;
    notifyUser(api, "Routine", t);
    if (api.s.open !== false && process.env.CZ_TEST_HOOKS === "1") api.log("(test) the exports folder would open now");
    else if (api.s.open !== false) {
      const file = [c.vertical, c.video].find((f) => f && fs.existsSync(f));
      if (file) shell.showItemInFolder(file);
      else if (c.projectId) {
        const out = path.join(getProject(c.projectId).path, "out");
        if (fs.existsSync(out)) shell.openPath(out);
      }
    }
    return { note: t };
  },
  async upload(api) {
    const p = project(api),
      c = api.item.ctx,
      yt = String(api.s.ytChannel || "");
    if (!c.video || !fs.existsSync(c.video)) throw new Error("There is no rendered video: put a Render before it.");
    if (!yt) throw new Error("Pick the YouTube channel in this node.");
    if (!grantedUpload(yt)) throw new Error("This channel has not allowed uploads: select the node and press Allow uploads.");
    const pub = c.publish ?? readJson(path.join(p.path, "publish.json")) ?? { title: p.name, description: "", tags: [] };
    const privacy = ["private", "unlisted", "public", "scheduled"].includes(api.s.privacy) ? api.s.privacy : "private";
    const publishAt = privacy === "scheduled" ? new Date(Date.now() + Math.max(1, +api.s.publishIn || 24) * 36e5).toISOString() : null;
    const id = await uploadVideo(
      api,
      yt,
      c.video,
      pub,
      privacy === "scheduled" ? "private" : privacy,
      publishAt,
      c.thumbnail && fs.existsSync(c.thumbnail) ? c.thumbnail : null,
      projectLanguage(p.path),
    );
    try {
      await sync(yt);
      linkVideo(id, p.id);
    } catch (e) {
      log("routine upload link", e?.message);
    }
    api.send("channels:changed", { what: "board" });
    return { ctx: { youtubeId: id }, note: `Uploaded (${privacy}): https://youtu.be/${id}` };
  },
};
async function designThumb(api, p, pj, count = 1) {
  const dir = path.join(p.path, ".suite", "thumbref");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const yt = String(api.s.ytSource || (p.channel_id ? (getChannel(p.channel_id).yt_channel_id ?? "") : ""));
  const examples = [];
  if (yt && +api.s.learn > 0) {
    const rows = q.all(
      `SELECT title, views, thumb FROM yt_videos WHERE channel_id=? AND gone=0 AND thumb IS NOT NULL AND (privacy IS NULL OR privacy='public')
      ORDER BY COALESCE(published_at, uploaded_at) DESC LIMIT ?`,
      yt,
      Math.min(20, +api.s.learn),
    );
    rows.forEach((r, i) => {
      const src = path.join(ytDir(yt), r.thumb);
      if (!fs.existsSync(src)) return;
      const to = `channel-${i + 1}${path.extname(src) || ".jpg"}`;
      fs.copyFileSync(src, path.join(dir, to));
      examples.push(`.suite/thumbref/${to}: "${r.title}"${r.views != null ? ` (${Number(r.views).toLocaleString("en")} views)` : ""}`);
    });
  }
  const title = api.item.ctx.publish?.title || pj.topic || p.name,
    tall = aspectOf(p.style_id, pj.settings) < 1;
  const key2 = String(api.s.styleKey ?? "").trim();
  if (FAKE()) {
    fs.writeFileSync(
      path.join(dir, "plan.json"),
      JSON.stringify({
        prompt: `A bold YouTube thumbnail about ${title}. No text.`,
        prompts: Array.from({ length: count }, (_, i) => `A bold YouTube thumbnail about ${title}, take ${i + 1}. No text.`),
        refs: [],
      }),
    );
  } else
    await claudeTask(api, {
      projectId: p.id,
      kind: "routine",
      instruction: `Design the YouTube thumbnail for this video. Don't change any other file of the project.
Video: "${title}"${pj.topic && pj.topic !== title ? ` (topic: ${pj.topic})` : ""}. Its script is script.txt. The picture is ${tall ? "9:16 (a tall Short)" : "16:9"}.
${
  examples.length
    ? `1. The channel's own recent thumbnails (open each one with Read and look at it):
${examples.map((x) => "   - " + x).join("\n")}
   Reverse-engineer what they share: composition, the main subject and its size, background, colours and contrast, lighting, faces and expressions, text on the picture (how many words, font look, colour, placement), borders, arrows or other recurring devices. The new one must look like it belongs to this channel.`
    : `1. The channel has no thumbnails to learn from: design a clear, high-contrast YouTube thumbnail that makes people curious.`
}
${api.s.refs !== false ? `2. Find 1-3 reference pictures online for the real things this video is about, so the picture is accurate (for example real game footage or a screenshot for the background, the console or device, the person, the place). Search with WebSearch / WebFetch, download each with Bash (curl -L -o .suite/thumbref/ref-1.jpg "<image url>"), then open it with Read to check it really shows the right thing in good quality; delete and replace any that don't.` : "2. Use no reference pictures."}
3. Write .suite/thumbref/plan.json: {"prompt": "...", "refs": [".suite/thumbref/ref-1.jpg"]}. The prompt (under 700 characters) describes the finished thumbnail in plain words for an image model: the subject, the composition, the style learned from the channel, and how to use each reference in order ("use image 1 as the background"). Any text on the thumbnail: at most 4 words, given exactly in quotes. Keep refs to the files you checked (at most 3).${
        count > 1
          ? `
   ${count} variations are made: also write "prompts": ${count} different prompts (real alternatives: another framing of the subject, other hook words or emotion), all in the channel's style and using the same refs; "prompt" is the first of them.`
          : ""
      }${
        key2
          ? `
   The app adds this style key to the end of every prompt, word for word: "${key2}". Don't repeat it or contradict it.`
          : ""
      }${
        api.s.style
          ? `
Notes from the creator: ${api.s.style}`
          : ""
      }
Finish with one sentence describing the thumbnail.`,
    });
  const plan = readJson(path.join(dir, "plan.json"));
  const prompt = String(plan?.prompt ?? "").trim();
  if (!prompt) throw new Error("Claude did not write the thumbnail plan. Retry this video.");
  const refs = (Array.isArray(plan.refs) ? plan.refs : [])
    .map((r) => path.resolve(p.path, String(r)))
    .filter(
      (f) =>
        f.startsWith(dir + path.sep) &&
        fs.existsSync(f) &&
        /\.(png|jpe?g|webp)$/i.test(f) &&
        (/\.webp$/i.test(f) || !nativeImage.createFromPath(f).isEmpty()),
    )
    .slice(0, 3);
  const more = (Array.isArray(plan.prompts) ? plan.prompts : []).map((x) => String(x ?? "").trim()).filter(Boolean);
  return { prompts: (more.length ? more : [prompt]).map((x) => x.slice(0, 1500)), refs, analysis: "" };
}
const fitWidth = (img) => (img.getSize().width > 1920 ? img.resize({ width: 1920, quality: "best" }) : img);
export const thumbTest = { analysis: null, writer: null, gens: [], judge: null };
function thumbGen(api, projectId) {
  const want = ["higgsfield", "fal", "custom"].includes(api.s.service) ? api.s.service : "auto";
  const svc = activeProvider(projectId, want),
    m = String(api.s.model ?? "").trim();
  const model = !m ? null : svc === "higgsfield" ? (MODELS.some((x) => x.id === m) ? m : null) : svc === "custom" ? m : null;
  const hm =
    svc === "higgsfield" ? MODELS.find((x) => x.id === (model ?? defaultImageModel("higgsfield", projectId) ?? IMAGE_MODEL)) : null;
  const q2 = String(api.s.quality || "high"),
    r = String(api.s.resolution || "2k");
  const quality = !hm ? q2 : hm.quality.includes(q2) ? q2 : hm.quality.includes("high") ? "high" : hm.defQuality;
  const resolution = !hm
    ? r
    : hm.resolutions.includes(r)
      ? r
      : hm.resolutions.includes("2k")
        ? "2k"
        : (hm.resolutions[hm.resolutions.length - 1] ?? "");
  return { want, svc, model, quality, resolution, label: hm?.label ?? model };
}
async function makeVariations(api, p, tall, prompts, refs) {
  const g = thumbGen(api, p.id),
    aspect = tall ? "9:16" : "16:9";
  if (!g.svc) throw new Error("Add a Higgsfield or Fal.ai API key in Settings first (Settings > Media > Image generation).");
  const svcName = { higgsfield: "Higgsfield", fal: "Fal.ai", custom: "your custom API", flow: "Google Flow" }[g.svc];
  if (g.want !== "auto" && g.svc !== g.want)
    api.log(
      `${{ higgsfield: "Higgsfield", fal: "Fal.ai", custom: "The custom API" }[g.want]} is not set up: making the pictures on ${svcName}.`,
    );
  api.log(
    `Making ${prompts.length === 1 ? "the picture" : `${prompts.length} variations`} on ${svcName}${g.label ? ` with ${g.label}` : ""}${g.svc === "higgsfield" ? ` (${[g.quality, g.resolution].filter(Boolean).join(", ")})` : ""}${refs.length ? ` with ${refs.length} reference picture${refs.length === 1 ? "" : "s"}` : ""}`,
  );
  const fake = FAKE() && !(process.env.CZ_HIGGSFIELD_BASE && g.svc === "higgsfield");
  const fakeImg = () => {
    const w = tall ? 360 : 640,
      h = tall ? 640 : 360,
      b = Buffer.alloc(w * h * 4);
    for (let i = 0; i < b.length; i += 4) {
      b[i] = 200;
      b[i + 1] = 120;
      b[i + 2] = 60;
      b[i + 3] = 255;
    }
    return nativeImage.createFromBitmap(b, { width: w, height: h }).toPNG();
  };
  if (process.env.CZ_TEST_HOOKS === "1") thumbTest.gens = [];
  const vars = prompts.map((prompt, i) => ({ n: i + 1, prompt, img: null }));
  let next = 0;
  const worker = async () => {
    while (next < vars.length) {
      const v = vars[next++];
      if (api.signal.aborted) throw new Error("Cancelled.");
      const req = { prompt: v.prompt, aspect, refs, resolution: g.resolution, quality: g.quality, model: g.model, provider: g.want };
      if (process.env.CZ_TEST_HOOKS === "1") thumbTest.gens.push({ ...req, service: g.svc });
      try {
        const r = fake ? { buf: fakeImg() } : await generatePicture(req, p.id);
        const img = nativeImage.createFromBuffer(r.buf);
        if (img.isEmpty()) throw new Error("The picture service sent an image the app could not read.");
        v.img = img;
        if (prompts.length > 1) api.log(`Variation ${v.n} made`);
      } catch (e) {
        v.error = String(e?.message ?? e);
        api.log(`Variation ${v.n} failed: ${v.error}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, vars.length) }, worker));
  if (api.signal.aborted) throw new Error("Cancelled.");
  if (!vars.some((v) => v.img)) throw new Error(vars[0]?.error || "No picture was made.");
  return vars;
}
export async function analyzeThumbRefs(signal, settings, ids) {
  const files = (Array.isArray(ids) ? ids : [])
    .map((id) => refFile(String(id)))
    .filter(Boolean)
    .slice(0, MAX_THUMB_REFS);
  if (!files.length) throw new Error("Add 1-5 reference thumbnails first.");
  const prompt = `Open each of these ${files.length} reference YouTube thumbnail${files.length === 1 ? "" : "s"} with Read and look at ${files.length === 1 ? "it" : "every one"} closely:
${files.map((f) => `- ${path.basename(f)}`).join("\n")}

Reverse-engineer the formula ${files.length === 1 ? "it follows" : "they share"}, so new thumbnails for other videos can be made with the same look and the same pull. Write it under these headings:
Layout and structure: where the subject, the text and the background sit (thirds, split screen, close-up...), how much of the frame each takes.
Formula: text placement and size, how many words, hook words and their tone, the face or main subject (size, expression, emotion, where it looks), contrast between subject and background, arrows, circles, before/after.
Colour palette: the main colours with hex values, what is saturated and what is muted.
Typography: font look (weight, condensed, serif or not), case, colour, outline, shadow, tilt.
Effects: outlines or glows around the subject, drop shadows, blur, vignette, lighting, grain, borders, stickers.
Always do: a short checklist of what every new thumbnail must copy.
Be specific and concrete (things an image model can draw), plain text, under 2,500 characters. Answer with the analysis only.`;
  if (process.env.CZ_TEST_HOOKS === "1") thumbTest.analysis = { prompt, files: files.map((f) => path.basename(f)) };
  const text = await claudeText(
    signal,
    settings,
    "You are an expert YouTube thumbnail designer. You study thumbnails and describe exactly how they are built.",
    prompt,
    () =>
      `(test) Layout: subject left third, three bold words right. Palette: #FFD400 on #101010. References: ${files.map((f) => path.basename(f)).join(", ")}.`,
    false,
    files,
  );
  const t = text.trim();
  if (!t) throw new Error("Claude gave no analysis. Try again.");
  return t.slice(0, 6e3);
}
async function refsThumb(api, p, pj, count) {
  const dir = path.join(p.path, ".suite", "thumbref");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let analysis = String(api.s.analysis ?? "").trim();
  if (!analysis) {
    api.log("Analysing the reference thumbnails (press Analyse in the node to keep it)");
    analysis = await analyzeThumbRefs(
      api.signal,
      api.settings,
      (Array.isArray(api.s.refImages) ? api.s.refImages : []).map((r) => r?.id),
    );
  }
  fs.writeFileSync(path.join(dir, "analysis.md"), analysis);
  const title = api.item.ctx.publish?.title || pj.topic || p.name,
    tall = aspectOf(p.style_id, pj.settings) < 1,
    key2 = String(api.s.styleKey ?? "").trim();
  const script = spokenWords(p.path).text;
  const prompt = `Write ${count === 1 ? "the text-to-image prompt" : `${count} text-to-image prompts`} for the YouTube thumbnail of this video.

The thumbnail formula, reverse-engineered from the creator's reference thumbnails (follow it closely: layout, formula, colours, typography, effects):
${analysis}

Video title: "${title}"${
    pj.topic && pj.topic !== title
      ? `
Topic: ${pj.topic}`
      : ""
  }
The picture is ${tall ? "9:16 (a tall Short)" : "16:9"}.${
    api.s.style
      ? `
Notes from the creator: ${api.s.style}`
      : ""
  }
Script (the start):
${script.slice(0, 3e3) || "(not written yet)"}

Each prompt (under 700 characters) describes the finished thumbnail in plain words for an image model: this video's own subject drawn with the formula above (layout, subject and emotion, colours, typography, effects). Any text on it: at most 4 words, given exactly in quotes, a hook that makes people curious without repeating the title.${count > 1 ? ` Make the ${count} prompts real alternatives (another framing of the subject, other hook words or emotion), all within the formula.` : ""}${
    key2
      ? `
The app adds this style key to the end of every prompt, word for word: "${key2}". Don't repeat it or contradict it.`
      : ""
  }
Answer with JSON only: {"prompts": ["..."]}`;
  if (process.env.CZ_TEST_HOOKS === "1") thumbTest.writer = prompt;
  const text = await claudeText(
    api.signal,
    api.settings,
    "You write prompts for image models that make YouTube thumbnails. Answer with the JSON asked for, nothing else.",
    prompt,
    () =>
      JSON.stringify({
        prompts: Array.from(
          { length: count },
          (_, i) => `(test) A thumbnail about ${title}, take ${i + 1}, subject left, "THREE BOLD WORDS" right.`,
        ),
      }),
    false,
    void 0,
    api.log,
  );
  const got = jsonIn(text).prompts;
  const prompts = (Array.isArray(got) ? got : [])
    .map((x) =>
      String(x ?? "")
        .trim()
        .slice(0, 1500),
    )
    .filter(Boolean);
  if (!prompts.length) throw new Error("Claude wrote no thumbnail prompt. Retry this video.");
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ prompt: prompts[0], prompts, refs: [] }, null, 1));
  return { prompts, refs: [], analysis };
}
async function judgeThumbs(api, p, pj, vars, analysis) {
  const dir = path.join(p.path, ".suite", "thumbref", "judge");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ok = vars.filter((v) => v.img),
    files = [];
  for (const v of ok) {
    let im = v.img;
    if (im.getSize().width > 768) im = im.resize({ width: 768, quality: "good" });
    const f = path.join(dir, `variation-${v.n}.jpg`);
    fs.writeFileSync(f, im.toJPEG(85));
    files.push(f);
  }
  const small = ok.map((v) => v.img.resize({ width: 240, quality: "good" })),
    sw = small.reduce((a, im) => a + im.getSize().width + 8, 8),
    sh = Math.max(...small.map((im) => im.getSize().height)) + 16;
  const strip = Buffer.alloc(sw * sh * 4, 255);
  let x = 8;
  for (const im of small) {
    const { width: w, height: h } = im.getSize(),
      b = im.toBitmap();
    for (let row = 0; row < h; row++) b.copy(strip, ((row + 8) * sw + x) * 4, row * w * 4, (row + 1) * w * 4);
    x += w + 8;
  }
  const sf = path.join(dir, "all-small.jpg");
  fs.writeFileSync(sf, nativeImage.createFromBitmap(strip, { width: sw, height: sh }).toJPEG(85));
  files.push(sf);
  const title = api.item.ctx.publish?.title || pj.topic || p.name;
  const formula = analysis || readJson(path.join(p.path, ".suite", "thumbref", "plan.json"))?.prompt || "";
  const prompt = `Pick the best of these ${ok.length} thumbnail variations for the YouTube video "${title}"${pj.topic && pj.topic !== title ? ` (topic: ${pj.topic})` : ""}.
Open each one with Read and look at it:
${ok.map((v) => `- variation-${v.n}.jpg (variation ${v.n})`).join("\n")}
- all-small.jpg: all of them side by side, left to right in the order above, at the size YouTube shows them in a feed.
${
  formula
    ? `
The formula they should follow:
${String(formula).slice(0, 3e3)}
`
    : ""
}
Judge each one on: how well it follows the formula; readability at small size (all-small.jpg: is the text legible, the subject clear, the idea readable at a glance); how well it fits the topic and makes people curious; and flaws (garbled or misspelled text, broken hands or faces, clutter). Pick one winner.
Answer with JSON only: {"scores":[{"n":1,"score":7,"note":"..."}],"winner":1,"why":"one or two sentences"}`;
  if (process.env.CZ_TEST_HOOKS === "1") thumbTest.judge = { prompt, files: files.map((f) => path.basename(f)) };
  const text = await claudeText(
    api.signal,
    api.settings,
    "You are an expert YouTube thumbnail designer judging thumbnails. Answer with the JSON asked for, nothing else.",
    prompt,
    () =>
      JSON.stringify({
        scores: ok.map((v) => ({ n: v.n, score: v.n, note: "test" })),
        winner: ok[ok.length - 1].n,
        why: `(test) variation ${ok[ok.length - 1].n} reads best at small size.`,
      }),
    false,
    files,
    api.log,
  );
  const j = jsonIn(text),
    winner = Math.round(+j.winner);
  if (!ok.some((v) => v.n === winner)) {
    api.log("Claude named no valid winner: the first variation is used.");
    return { winner: ok[0].n, why: "" };
  }
  fs.writeFileSync(path.join(dir, "pick.json"), JSON.stringify(j, null, 1));
  return {
    winner,
    why: String(j.why ?? "")
      .trim()
      .slice(0, 400),
  };
}
async function voice(api, projectId, dir, req) {
  notBusy(projectId);
  await startVoiceover(
    projectId,
    dir,
    req,
    (j) => api.send("voice:progress", j),
    () => {
      markDirty(projectId);
      writeContext(projectId);
    },
  );
  const off = api.onCancel(() => cancelVoiceover(projectId, dir));
  try {
    let phase = "";
    for (;;) {
      const j = jobOf(projectId);
      if (!j) throw new Error("The voiceover stopped.");
      if (j.phase !== phase) {
        phase = j.phase;
        api.log(
          { generate: "Making the voice", join: "Joining", clean: "Cleaning the audio", timeline: "Timing the words", done: "Done" }[
            phase
          ] ?? phase,
        );
      }
      if (j.status !== "running") {
        if (j.status !== "done") throw new Error(j.error || (j.status === "cancelled" ? "Cancelled." : "The voiceover failed."));
        return j;
      }
      await sleep(1e3, api.signal);
    }
  } finally {
    off();
  }
}
async function uploadVideo(api, yt, file, pub, privacy, publishAt, thumb, language = "en") {
  const yl = language === "en" ? null : language === "zh" ? "zh-Hans" : language;
  const token = await accessToken(yt),
    size = fs.statSync(file).size,
    ac = new AbortController();
  const off = api.onCancel(() => ac.abort());
  const why = async (r) => {
    const t = await r.text();
    log("youtube upload", r.status, t.slice(0, 400));
    let m = "";
    try {
      m = JSON.parse(t).error?.message ?? "";
    } catch {}
    return r.status === 401 || r.status === 403
      ? `YouTube refused the upload${m ? `: ${m}` : ""}. Sign in again with uploads allowed (select the node, Allow uploads).`
      : `YouTube did not take the video (${r.status}${m ? `: ${m}` : ""}).`;
  };
  try {
    api.log(`Uploading ${(size / 1e6).toFixed(0)} MB`);
    const init = await fetch(`${base("data")}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify({
        snippet: {
          title: pub.title,
          description: pub.description,
          tags: pub.tags,
          categoryId: "27",
          ...(yl ? { defaultLanguage: yl, defaultAudioLanguage: yl } : {}),
        },
        status: { privacyStatus: privacy, ...(publishAt ? { publishAt } : {}), selfDeclaredMadeForKids: false },
      }),
    });
    if (!init.ok) throw new Error(await why(init));
    const at = init.headers.get("location");
    if (!at) throw new Error("YouTube did not start the upload. Try again.");
    const put = await fetch(at, {
      method: "PUT",
      signal: ac.signal,
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
      body: Readable.toWeb(fs.createReadStream(file)),
      duplex: "half",
    });
    if (!put.ok) throw new Error(await why(put));
    const id = (await put.json())?.id;
    if (!id) throw new Error("YouTube did not say which video it made.");
    if (thumb) {
      const t = await fetch(`${base("data")}/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(id)}`, {
        method: "POST",
        signal: ac.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
        body: fs.readFileSync(thumb),
      });
      if (!t.ok) api.log(`The thumbnail was not set: ${await why(t)} (a channel needs a verified phone number for custom thumbnails)`);
    }
    return id;
  } catch (e) {
    if (api.signal.aborted) throw new Error("Cancelled.");
    throw e;
  } finally {
    off();
  }
}
export const RUNNERS = Object.assign(R, { seeds });
