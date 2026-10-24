import path from "node:path";
import fs from "node:fs";
import { app, shell } from "electron";
import { getConfig } from "../core/config";
import { log } from "../core/log";
import { baseOf } from "../styles/catalog";
import { countWords, lang } from "../styles/languages";
import { beatOf, headingOf, spokenLine, spokenScript } from "./spokenScript";
import { TRIM_DEFAULTS, setTrim } from "../audio/trim";
import { VOICE_WORDS, beginStep, cancelStep, endStep, projectLanguage, runStep, stepBusy } from "../pipeline/steps";
import { quietWrite } from "../projects/watcher";
import { scriptSpeakers, speakerKey, speakerOf } from "./speakers";
import { gainInPlace, gatedLoudness, loudnessBlocks } from "../audio/loudness";
import { FISH_MODELS, fishKeyStatus, fishSettings, fishSpeaks } from "./fish";
import { MAX_FILES, durationOf, notGranted, useRecordings } from "./recordings";
import {
  FALLBACK_MODELS,
  account,
  auth,
  chunkKey,
  chunkScript,
  elevenGenerate,
  elevenModels,
  elevenSettings,
  isCurrent,
  markCurrent,
  modelsFor,
  speaks,
  writePauses,
} from "./elevenlabs";
import { fishChunks, fishGenerate, fishKey } from "./fishGenerate";
import { customGenerate, kokoroFiles, kokoroGenerate, kokoroVoiceList, kokoroVoicesFor } from "./kokoro";

const tidy = (t) =>
  t
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p && !/^[-*_=~#\s]+$/.test(p))
    .join("\n\n");
const textRuns = (text) => text.split("\n\n").map((p) => ({ speaker: "", name: "", text: p, para: true }));
export function scriptSections(script, language) {
  const out = [];
  let cur = { title: "", lines: [] };
  for (const line of script.split(/\r?\n/)) {
    const h = headingOf(line);
    if (h !== null) {
      if (cur.lines.some((l) => l.trim())) out.push(cur);
      cur = { title: h, lines: [] };
      continue;
    }
    cur.lines.push(line);
  }
  if (cur.lines.some((l) => l.trim())) out.push(cur);
  const all = out.map((s, i) => ({
    title: s.title || (i ? `Part ${i + 1}` : "Opening"),
    text: tidy(spokenScript(s.lines.join("\n"), language)),
    ...runsOf(s.lines, language),
  }));
  const kept = [];
  let carry = [];
  for (const s of all) {
    if (!s.text) {
      carry.push(...(s.runs ?? []).filter((r) => r.beat));
      continue;
    }
    if (carry.length) {
      s.runs = [...carry, ...(s.runs ?? textRuns(s.text))];
      carry = [];
    }
    kept.push(s);
  }
  if (carry.length && kept.length) {
    const p = kept[kept.length - 1];
    p.runs = [...(p.runs ?? textRuns(p.text)), ...carry];
  }
  return kept;
}
function runsOf(lines, language) {
  if (!lines.some((l) => beatOf(l) != null || speakerOf(l, language))) return {};
  const runs = [];
  let para = true;
  for (const line of lines) {
    if (!line.trim()) {
      para = true;
      continue;
    }
    const beat = beatOf(line);
    if (beat != null) {
      runs.push({ speaker: "", name: "", text: "", para: false, beat });
      continue;
    }
    const text = spokenLine(line, language).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const sp = speakerOf(line, language),
      key2 = sp?.key ?? "",
      last2 = runs.at(-1);
    if (last2 && !para && !last2.beat && last2.speaker === key2) last2.text += " " + text;
    else runs.push({ speaker: key2, name: sp?.name ?? "", text, para });
    para = false;
  }
  return { runs };
}
const beatsIn = (secs) => secs.flatMap((s) => (s.runs ?? []).filter((r) => r.beat).map((r) => r.beat));
export const PACES = {
  short: null,
  natural: { sentence: 0.75, para: 1.33, section: 1.6 },
  long: { sentence: 1, para: 1.78, section: 2.13 },
};
const isSentencePause = (v) => v === "short" || v === "natural" || v === "long";
const stylePace = (base) => (base === "stickstory" ? "natural" : "short");
export function sentences(p) {
  const out = [];
  let last2 = 0;
  for (const m of p.matchAll(/[.!?…]+["'”’»)\]]*\s+|[。！？]+[」』”’）)]*\s*|[।॥]+\s*/g)) {
    const end = m.index + m[0].length;
    if (end >= p.length) break;
    out.push(p.slice(last2, end).trim());
    last2 = end;
  }
  if (last2 < p.length) out.push(p.slice(last2).trim());
  return out.filter(Boolean);
}
function pack(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = "";
  const add = (piece, sep) => {
    if (!cur) cur = piece;
    else if (cur.length + sep.length + piece.length <= max) cur += sep + piece;
    else {
      out.push(cur);
      cur = piece;
    }
  };
  for (const para of text.split("\n\n")) {
    if (para.length <= max) {
      add(para, "\n\n");
      continue;
    }
    sentences(para).forEach((s, i) => {
      const sep = i ? " " : "\n\n";
      if (s.length <= max) return add(s, sep);
      let rest = s;
      while (rest.length > max) {
        const at = Math.max(rest.lastIndexOf(" ", max), rest.lastIndexOf("、", max) + 1, rest.lastIndexOf("，", max) + 1);
        const k = at > max / 2 ? at : max;
        add(rest.slice(0, k).trim(), sep);
        rest = rest.slice(k).trim();
      }
      if (rest) add(rest, " ");
    });
  }
  if (cur) out.push(cur);
  return out;
}
export const NARRATOR_ONLY = (_key) => "";
export function chunksOf(secs, max, voiceOf, pace = null) {
  const out = [];
  let lead = 0;
  const addBeat = (b) => {
    const last2 = out[out.length - 1];
    if (last2) last2.beat = +((last2.beat ?? 0) + b).toFixed(3);
    else lead += b;
  };
  secs.forEach((s, i) => {
    if (!pace && !s.runs?.some((r) => r.beat || voiceOf(r.speaker))) {
      out.push(...pack(s.text, max).map((text, k, all) => ({ section: i, text, last: k === all.length - 1 })));
      return;
    }
    const start = out.length;
    let narration = "",
      paraGap = false;
    const flush = () => {
      if (narration) for (const text of pack(narration, max)) out.push({ section: i, text, last: false });
      narration = "";
    };
    for (const r of s.runs ?? textRuns(s.text)) {
      if (r.beat) {
        flush();
        addBeat(r.beat);
        continue;
      }
      const voice = voiceOf(r.speaker),
        who = voice ? { speaker: r.speaker, name: r.name, voice } : {};
      if (pace) {
        if (r.para) paraGap = true;
        for (const t of sentences(r.text))
          for (const text of pack(t, max)) {
            if (out.length > start) out[out.length - 1].gap = paraGap ? pace.para : pace.sentence;
            out.push({ section: i, text, last: false, ...who });
            paraGap = false;
          }
        continue;
      }
      if (!voice) {
        narration = narration ? narration + (r.para ? "\n\n" : " ") + r.text : r.text;
        continue;
      }
      flush();
      for (const text of pack(r.text, max)) out.push({ section: i, text, last: false, ...who });
    }
    flush();
    if (out.length > start) {
      const end = out[out.length - 1];
      end.last = true;
      if (pace) end.gap = pace.section;
    }
  });
  if (lead && out.length) out[0].lead = +lead.toFixed(3);
  return out;
}
export function spokenLength(secs, language, pacing, speed = 1) {
  const words = countWords(secs.map((s) => s.text).join(" "), language),
    pace = PACES[pacing] ?? null;
  const beats = beatsIn(secs),
    beatSecs = beats.reduce((n, b) => n + b, 0);
  const pauses = pace
    ? chunksOf(secs, 1500, NARRATOR_ONLY, pace)
        .slice(0, -1)
        .reduce((n, c) => n + Math.max(0, (c.gap ?? 0) - 0.4), 0)
    : secs.length * 0.8;
  return {
    words,
    seconds: Math.round(((words / lang(language).wpm) * 60) / (speed > 0 ? speed : 1) + pauses + beatSecs),
    beats: { count: beats.length, seconds: +beatSecs.toFixed(2) },
    pauses: +pauses.toFixed(2),
    pace: pacing,
  };
}
const readPjTrim = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")).trim;
  } catch {
    return null;
  }
};
export function paceOf(dir, asked) {
  if (isSentencePause(asked)) return asked;
  let style = "";
  try {
    style = baseOf(readProject(dir).style);
  } catch {}
  const kept = getConfig().voice?.pace?.[style];
  return isSentencePause(kept) ? kept : stylePace(style);
}
export function readScript(dir) {
  let s = "";
  try {
    s = fs.readFileSync(path.join(dir, "script.txt"), "utf8");
  } catch {}
  const language = projectLanguage(dir),
    sections = scriptSections(s, language);
  if (!countWords(sections.map((x) => x.text).join(" "), language))
    throw new Error("There is no script to read yet. Write it first (the Script step), or use your own recording.");
  return { sections, raw: s, language };
}
const sectionsText = (secs) => secs.map((x) => x.text).join("\n\n");
export function scriptWords(dir) {
  let s = "";
  try {
    s = fs.readFileSync(path.join(dir, "script.txt"), "utf8");
  } catch {
    return 0;
  }
  const code = projectLanguage(dir);
  return countWords(
    scriptSections(s, code)
      .map((x) => x.text)
      .join(" "),
    code,
  );
}
const CAST_PROVIDERS = ["elevenlabs", "fish", "kokoro", "custom"];
const readProject = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^﻿/, ""));
export function savedSpeakers(dir) {
  try {
    const v = readProject(dir).characterVoices;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
export function speakerVoices(dir, provider, given) {
  if (!CAST_PROVIDERS.includes(provider)) return {};
  const src = given == null ? (savedSpeakers(dir)[provider] ?? {}) : typeof given === "object" && !Array.isArray(given) ? given : {};
  const out = {};
  for (const [k, v] of Object.entries(src).slice(0, 200)) {
    const key2 = speakerKey(k).slice(0, 40),
      id = String(v?.voiceId ?? "").trim();
    if (!key2 || !id || !(provider === "custom" ? id.length <= 200 : /^[\w.-]{1,64}$/.test(id))) continue;
    out[key2] = { voiceId: id, ...(v?.voiceName ? { voiceName: String(v.voiceName).slice(0, 80) } : {}) };
  }
  return out;
}
export function saveSpeakers(dir, provider, voices) {
  if (!CAST_PROVIDERS.includes(provider))
    throw new Error("Character voices are for a voiceover the app makes (ElevenLabs, Fish Audio, the local voice or a custom API).");
  const clean = speakerVoices(dir, provider, voices && typeof voices === "object" ? voices : {});
  let pj;
  try {
    pj = readProject(dir);
  } catch {
    throw new Error("This project's settings (project.json) could not be read.");
  }
  const all = { ...(pj.characterVoices && typeof pj.characterVoices === "object" ? pj.characterVoices : {}) };
  if (Object.keys(clean).length) all[provider] = clean;
  else delete all[provider];
  if (JSON.stringify(all) !== JSON.stringify(pj.characterVoices ?? {})) {
    if (Object.keys(all).length) pj.characterVoices = all;
    else delete pj.characterVoices;
    quietWrite("project.json");
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(pj, null, 1));
  }
  return savedSpeakers(dir);
}
export function projectSpeakers(dir) {
  let s = "";
  try {
    s = fs.readFileSync(path.join(dir, "script.txt"), "utf8");
  } catch {}
  return { speakers: scriptSpeakers(s, projectLanguage(dir)), saved: savedSpeakers(dir) };
}
export const voicesFor = (cast, narrator) => (key2) => {
  const v = key2 ? cast[key2]?.voiceId : "";
  return v && v !== narrator ? v : "";
};
export const withVoice = (s, c) => (c.voice ? { ...s, voiceId: c.voice } : s);
const castNote = (chunks) => {
  const n = new Set(chunks.filter((c) => c.voice).map((c) => c.speaker)).size;
  return n ? ` · ${n} character voice${n === 1 ? "" : "s"}` : "";
};
export function onLine(e, c) {
  if (!c.name || e?.message === "cancelled") return e;
  const t = c.text.length > 80 ? c.text.slice(0, 77).trimEnd() + "…" : c.text;
  const err = new Error(`${c.name}'s line “${t}” could not be made: ${String(e?.message || e)}`);
  err.kind = e?.kind;
  err.status = e?.status;
  return err;
}
export function levelVoices(dir, file, rate, at, spans, say) {
  const fd = fs.openSync(file, "r+"),
    gains = new Map();
  try {
    const n = Math.floor((fs.fstatSync(fd).size - at) / 2);
    spans = spans.map((s) => ({ ...s, start: Math.max(0, Math.min(n, s.start)), end: Math.max(0, Math.min(n, s.end)) }));
    const read = (s) => {
      const b = Buffer.alloc((s.end - s.start) * 2);
      fs.readSync(fd, b, 0, b.length, at + s.start * 2);
      return pcm16(b);
    };
    const blocks = new Map(),
      peak = new Map(),
      names = new Map();
    for (const s of spans) {
      if (s.end <= s.start) continue;
      const x = read(s),
        list = blocks.get(s.voice) ?? [];
      for (const p of loudnessBlocks(x, rate)) list.push(p);
      blocks.set(s.voice, list);
      if (!s.voice) continue;
      let pk = peak.get(s.voice) ?? 0;
      for (let i = 0; i < x.length; i++) {
        const v = Math.abs(x[i]);
        if (v > pk) pk = v;
      }
      peak.set(s.voice, pk);
      names.set(s.voice, (names.get(s.voice) ?? new Set()).add(s.name));
    }
    const voices = [...blocks.keys()].filter(Boolean),
      narrator = gatedLoudness(blocks.get("") ?? []);
    const ref = narrator ?? gatedLoudness(blocks.get(voices[0]) ?? []);
    if (ref == null) return;
    for (const v of voices) {
      const l = gatedLoudness(blocks.get(v)),
        who = [...(names.get(v) ?? [])].join(" and ") || "A character";
      if (l == null) continue;
      const db = Math.min(Math.max(-18, Math.min(18, ref - l)), 20 * Math.log10(32764 / Math.max(1, peak.get(v) ?? 1)));
      say(
        `${who}: ${l.toFixed(1)} LUFS, the narrator ${ref.toFixed(1)} LUFS: ${Math.abs(db) < 0.5 ? "left as it is" : `levelled ${db > 0 ? "+" : ""}${db.toFixed(1)} dB`}`,
      );
      if (Math.abs(db) >= 0.5) gains.set(v, 10 ** (db / 20));
    }
    for (const s of spans) {
      const g = gains.get(s.voice);
      if (!g || s.end <= s.start) continue;
      const x = gainInPlace(read(s), g);
      fs.writeSync(fd, Buffer.from(x.buffer, x.byteOffset, x.byteLength), 0, x.byteLength, at + s.start * 2);
    }
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.mkdirSync(path.join(dir, ".suite", "tts"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".suite", "tts", "voices.json"),
      JSON.stringify({
        file: "audio/source.wav",
        spans: spans
          .filter((s) => s.voice)
          .map((s) => ({
            name: s.name,
            start: +(s.start / rate).toFixed(3),
            end: +(s.end / rate).toFixed(3),
            gainDb: +(20 * Math.log10(gains.get(s.voice) ?? 1)).toFixed(2),
          })),
      }),
    );
  } catch {}
}
export function wavLayout(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 1 << 16));
    fs.readSync(fd, head, 0, head.length, 0);
    if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE") return null;
    let off = 12,
      rate = 0,
      ok = false;
    while (off + 8 <= head.length) {
      const id = head.toString("ascii", off, off + 4),
        n = head.readUInt32LE(off + 4);
      if (id === "fmt " && off + 24 <= head.length) {
        rate = head.readUInt32LE(off + 12);
        ok = head.readUInt16LE(off + 8) === 1 && head.readUInt16LE(off + 10) === 1 && head.readUInt16LE(off + 22) === 16;
      }
      if (id === "data") return ok && rate ? { at: off + 8, rate } : null;
      off += 8 + n + (n & 1);
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}
export const jobs = new Map(),
  jobDirs = new Map();
export const jobOf = (projectId) => jobs.get(projectId) ?? null;
export function markSeen(projectId, emit) {
  const j = jobs.get(projectId);
  if (!j || j.status === "running" || j.seen) return;
  j.seen = true;
  emit(j);
  if (j.interrupted) persistJobs();
}
export function stepSucceeded(projectId, step, emit) {
  const j = jobs.get(projectId),
    order = ["clean", "timeline"];
  if (!j || j.status !== "failed" || !j.installed || j.seen || order.indexOf(step) < order.indexOf(j.phase)) return;
  markSeen(projectId, emit);
}
export function forgetInterrupted(projectId) {
  const j = jobs.get(projectId);
  if (!j?.interrupted || j.seen) return;
  j.seen = true;
  persistJobs();
}
const jobsFile = () => path.join(app.getPath("userData"), "voice-jobs.json");
let quitting = false,
  persistTimer = null;
function persistJobs() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const keep = [...jobs.values()]
    .filter((j) => j.status === "running" || (j.interrupted && !j.seen))
    .map((j) => ({ ...j, log: j.log.slice(-40), dir: jobDirs.get(j.projectId) }));
  try {
    if (keep.length) fs.writeFileSync(jobsFile(), JSON.stringify(keep));
    else fs.rmSync(jobsFile(), { force: true });
  } catch (e) {
    log("voiceover jobs not noted", e?.message);
  }
}
const persistSoon = () => {
  if (!persistTimer) persistTimer = setTimeout(persistJobs, 1500);
};
export function restoreInterrupted() {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(jobsFile(), "utf8"));
  } catch {
    return;
  }
  for (const j of Array.isArray(list) ? list : []) {
    if (!j?.projectId || jobs.has(j.projectId)) continue;
    const { dir, ...rest } = j,
      job = { ...rest, status: "failed", seen: false, interrupted: true, retry: void 0, finishedAt: j.finishedAt ?? Date.now() };
    if (j.status === "running") {
      const what =
        job.phase === "clean"
          ? "the audio was being cleaned"
          : job.phase === "timeline"
            ? "the words were being timed"
            : "the voiceover was being made";
      job.error = `The app was closed while ${what}.`;
      job.note = job.installed
        ? afterNote(job.phase, false)
        : `${job.hadVoice ? "Your previous voiceover is unchanged. " : ""}${job.provider === "elevenlabs" || job.provider === "fish" ? "Try again to finish it: the parts already made are reused for free." : job.provider === "kokoro" ? "Try again to make it." : "Add the recordings again to finish."}`;
    }
    jobs.set(j.projectId, job);
    if (dir) jobDirs.set(j.projectId, dir);
  }
  persistJobs();
}
export const interruptedJobs = () => [...jobs.values()].filter((j) => j.interrupted && !j.seen);
const afterNote = (phase, failed) => {
  const button = phase === "clean" ? "“Clean and time”" : "“Time words”";
  return failed
    ? `Fix the problem, then press ${button} under the preview.`
    : `The new voiceover is in: press ${button} under the preview when you are ready.`;
};
const lockedText = (f) =>
  `audio/${f} is open in another program (a player, an audio editor or a sync app). Close it there, then try again.`;
export const isLocked = (e) => /^(EBUSY|EPERM|EACCES)$/.test(String(e?.code || ""));
async function assertReplaceable(dir) {
  const a = path.join(dir, "audio");
  let list = [];
  try {
    list = fs.readdirSync(a);
  } catch {
    return;
  }
  const noSource = !list.some((f) => /^source\.\w+$/.test(f));
  for (const f of list) {
    if (!(/^source\./.test(f) || (noSource && f === "clean.wav")) || /\.(incoming|cz-check)$/.test(f)) continue;
    const p = path.join(a, f),
      moved = p + ".cz-check";
    try {
      fs.renameSync(p, moved);
    } catch (e) {
      if (isLocked(e)) throw new Error(lockedText(f));
      continue;
    }
    for (let i = 0; ; i++) {
      try {
        fs.renameSync(moved, p);
        break;
      } catch (e) {
        if (i >= 40) {
          log("voiceover check could not put back", p, e?.message);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
}
export const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
export const AUDIO_EXT = /\.(wav|mp3|m4a|flac|ogg|oga|opus|aac|aif|aiff|aifc|caf|wma|mp4|mov|m4v|webm|mkv)$/i;
export const PLAIN_AUDIO = /^\.(wav|mp3|m4a|flac|ogg)$/i;
export const PLAYABLE = /^(pcm_(u8|s16le|s24le|s32le|f32le)|mp3\w*|aac|flac|vorbis|opus)$/;
export function copyAsNew(from, to) {
  fs.copyFileSync(from, to);
  const t = new Date();
  fs.utimesSync(to, t, t);
}
export async function startVoiceover(projectId, dir, req, emitOut, changed) {
  if (jobs.get(projectId)?.status === "running") throw new Error("A voiceover is already being made for this project.");
  const emit = (j) => {
    emitOut(j);
    if (!quitting) persistSoon();
  };
  const provider =
    req.provider === "elevenlabs" || req.provider === "kokoro" || req.provider === "custom" || req.provider === "fish"
      ? req.provider
      : "file";
  const autoTime = req.autoTime !== false;
  let plan;
  let sections = [],
    label = "",
    read = null;
  let asked;
  const pacing = provider === "file" ? "short" : paceOf(dir, req.pace),
    pace = PACES[pacing],
    paceNote = pace ? ` · ${pacing} pauses` : "";
  if (provider === "file") {
    const files = (req.files ?? []).map((f) => path.resolve(String(f)));
    if (!files.length) throw new Error("Add a recording first.");
    if (files.length > MAX_FILES) throw new Error(`Up to ${MAX_FILES} recordings can be joined at once (this list has ${files.length}).`);
    if (notGranted(files).length) throw new Error("Add the recordings again by choosing or dropping them in this window.");
    for (const f of files)
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error(`${path.basename(f)} is no longer there.`);
      else if (!AUDIO_EXT.test(f)) throw new Error(`${path.basename(f)} is not an audio or video file the app can read.`);
    const gap = clamp(req.gap, 0, 5, getConfig().voice?.gap ?? 0.5);
    sections = files.map((f) => ({ title: path.basename(f), chars: 0, state: "wait" }));
    label = files.length > 1 ? `${files.length} recordings` : "Your recording";
    asked = { provider, files, gap, autoTime };
    plan = () => useRecordings(dir, files, gap, job, state, emit);
  } else if (provider === "elevenlabs") {
    const s = elevenSettings(req.eleven);
    auth();
    read = readScript(dir);
    const secs = read.sections,
      model = (await elevenModels().catch(() => FALLBACK_MODELS)).find((m) => m.id === s.modelId),
      code = read.language;
    if (model && !speaks(model, code))
      throw new Error(
        `${model.name} does not speak ${lang(code).name}, the language of this video. Pick ${modelsFor(code)} (Model, in this window).`,
      );
    const cast = speakerVoices(dir, provider, req.speakers),
      chunks = chunkScript(secs, model, voicesFor(cast, s.voiceId), pace);
    sections = secs.map((x, i) => ({
      title: x.title,
      chars: chunks.filter((c) => c.section === i).reduce((n, c) => n + c.text.length, 0),
      state: "wait",
    }));
    label = `ElevenLabs · ${s.voiceName || "voice"}${castNote(chunks)}${paceNote}`;
    const fresh =
      !!req.fresh ||
      (!!req.retake &&
        isCurrent(
          dir,
          chunks.map((c) => chunkKey(withVoice(s, c), c.text, code)),
        ));
    asked = { provider, eleven: s, autoTime, pace: pacing, ...(Object.keys(cast).length ? { speakers: cast } : {}) };
    plan = () => elevenGenerate(dir, chunks, s, model, fresh, job, state, emit, code);
  } else if (provider === "fish") {
    const s = fishSettings(req.fish);
    if (!fishKeyStatus().hasKey)
      throw new Error("Add your Fish Audio API key first (Settings > Media > Voiceover, or Fish Audio in this window).");
    read = readScript(dir);
    const code = read.language,
      m = FISH_MODELS.find((x) => x.id === s.model);
    if (!fishSpeaks(s.model, code))
      throw new Error(
        `${m.name} does not speak ${lang(code).name}, the language of this video. Pick ${FISH_MODELS[0].name} (Model, in this window).`,
      );
    const cast = speakerVoices(dir, provider, req.speakers),
      chunks = fishChunks(read.sections, voicesFor(cast, s.voiceId), pace);
    sections = read.sections.map((x, i) => ({
      title: x.title,
      chars: chunks.filter((c) => c.section === i).reduce((n, c) => n + c.text.length, 0),
      state: "wait",
    }));
    label = `Fish Audio · ${s.voiceName || "voice"}${castNote(chunks)}${paceNote}`;
    const fresh =
      !!req.fresh ||
      (!!req.retake &&
        isCurrent(
          dir,
          chunks.map((c) => fishKey(withVoice(s, c), c.text, code)),
        ));
    asked = { provider, fish: s, autoTime, pace: pacing, ...(Object.keys(cast).length ? { speakers: cast } : {}) };
    plan = () => fishGenerate(dir, chunks, s, fresh, job, state, emit, code);
  } else if (provider === "custom") {
    const { readSetup: customSetup } = await import("../images/customProviders");
    const cs = customSetup("voice");
    if (!cs) throw new Error("Set up your custom voice API first (Settings > Media > Custom APIs).");
    read = readScript(dir);
    const secs = read.sections,
      code = read.language;
    sections = secs.map((x) => ({ title: x.title, chars: x.text.length, state: "wait" }));
    const cv = { voice: String(req.custom?.voice ?? "").slice(0, 200), voiceName: String(req.custom?.voiceName ?? "").slice(0, 80) };
    const cast = speakerVoices(dir, provider, req.speakers),
      voiceOf = voicesFor(cast, cv.voice);
    label = `Custom API · ${cs.name}${cv.voice ? ` · ${cv.voiceName || cv.voice}` : ""}${castNote(chunksOf(secs, Infinity, voiceOf))}${paceNote}`;
    asked = { provider, custom: cv, autoTime, pace: pacing, ...(Object.keys(cast).length ? { speakers: cast } : {}) };
    plan = () => customGenerate(dir, secs, code, cv.voice, job, state, emit, voiceOf, pace);
  } else {
    const files = kokoroFiles();
    if (!files) throw new Error("Install the local voice first (Local voice, Install). It is free and runs on this computer.");
    const voice = String(req.kokoro?.voice ?? ""),
      speed = clamp(req.kokoro?.speed, 0.5, 2, 1);
    const v = kokoroVoiceList(files.voices).find((x) => x.id === voice);
    if (!v) throw new Error("Pick one of the local voices.");
    read = readScript(dir);
    const L = lang(read.language),
      ok = kokoroVoicesFor(read.language),
      an = /^[AEIOU]/.test(L.name) ? "an" : "a";
    if (!ok.length)
      throw new Error(
        `The local voice does not speak ${L.name}, the language of this video. Use ElevenLabs, Fish Audio or your own recording.`,
      );
    if (!ok.some((x) => x.id === v.id))
      throw new Error(
        `${v.name} speaks ${v.language}. Pick ${an} ${L.name} voice for this ${L.name} video${L.code === "en" ? " (a video in another language: set its language first, Settings > Language > Several languages)" : ""}.`,
      );
    const secs = read.sections;
    sections = secs.map((x) => ({ title: x.title, chars: x.text.length, state: "wait" }));
    const cast = Object.fromEntries(
      Object.entries(speakerVoices(dir, provider, req.speakers)).filter(([, c]) => ok.some((x) => x.id === c.voiceId)),
    );
    const voiceOf = voicesFor(cast, v.id);
    label = `Local voice · ${v.name}${castNote(chunksOf(secs, Infinity, voiceOf))}${paceNote}`;
    asked = { provider, kokoro: { voice: v.id, speed }, autoTime, pace: pacing, ...(Object.keys(cast).length ? { speakers: cast } : {}) };
    plan = () => kokoroGenerate(dir, secs, v, speed, files, job, state, emit, voiceOf, pace);
  }
  const hadVoice = (() => {
    try {
      return fs.readdirSync(path.join(dir, "audio")).some((f) => /^source\.\w+$/.test(f) || f === "clean.wav");
    } catch {
      return false;
    }
  })();
  const state = beginStep(dir, "voice");
  try {
    await assertReplaceable(dir);
  } catch (e) {
    endStep(dir, state);
    throw e;
  }
  const job = {
    projectId,
    provider,
    status: "running",
    phase: "generate",
    sections,
    startedAt: Date.now(),
    autoTime,
    installed: false,
    log: [],
    label,
    hadVoice,
    req: asked,
  };
  jobs.set(projectId, job);
  jobDirs.set(projectId, dir);
  emit(job);
  persistJobs();
  const say = (l) => {
    job.log.push(l);
    if (job.log.length > 300) job.log.splice(0, 100);
    const m = /matched (\d+) of (\d+) script words/.exec(l);
    if (m) job.timing = { matched: +m[1], total: +m[2] };
  };
  const transcript = read ? spokenScript(read.raw, read.language) : void 0;
  const language = read?.language ?? projectLanguage(dir);
  (async () => {
    let held = true;
    try {
      const made = await plan();
      if (state.cancelled) throw new Error("cancelled");
      job.phase = "join";
      emit(job);
      const src = await replaceSource(dir, made.tmp, made.ext);
      markCurrent(dir, made.keys ?? null);
      writePauses(dir, made.keep);
      if (made.words?.length) writeWords(dir, provider, made.words);
      if (transcript != null) fs.writeFileSync(path.join(dir, "audio", "transcript.txt"), transcript);
      job.installed = true;
      job.source = "audio/" + path.basename(src);
      job.charged = made.charged;
      job.usd = made.usd;
      job.duration = await durationOf(src).catch(() => void 0);
      if (read) {
        let now = "";
        try {
          now = fs.readFileSync(path.join(dir, "script.txt"), "utf8");
        } catch {}
        job.scriptChanged = sectionsText(scriptSections(now, read.language)) !== sectionsText(read.sections);
      }
      endStep(dir, state);
      held = false;
      changed();
      persistJobs();
      if (autoTime) {
        if (!fs.existsSync(path.join(dir, "audio", "clean.wav")) && readPjTrim(dir) === void 0)
          setTrim(dir, { ...TRIM_DEFAULTS, applied: true });
        for (const step of ["clean", "timeline"]) {
          job.phase = step;
          emit(job);
          await runStep(step, dir, { tightenPauses: false, transcript, language }, say);
          if (step === "clean") job.duration = await durationOf(path.join(dir, "audio", "clean.wav")).catch(() => job.duration);
          changed();
        }
      }
      job.phase = "done";
      job.status = "done";
      job.finishedAt = Date.now();
      emit(job);
      log("voiceover made", projectId, provider, job.duration);
    } catch (e) {
      const stopped = state.cancelled || /^Cancelled/.test(String(e?.message));
      if (!job.installed)
        try {
          for (const f of fs.readdirSync(path.join(dir, "audio")))
            if (/^source\..*\.incoming$/.test(f)) fs.rmSync(path.join(dir, "audio", f), { force: true });
        } catch {}
      job.status = stopped ? "cancelled" : "failed";
      job.finishedAt = Date.now();
      job.retry = void 0;
      if (!stopped) {
        job.error = String(e?.message || e).replace(job.installed ? /^[A-Z][\w ]{2,30} failed: / : /^$/, "");
        log("voiceover failed", projectId, provider, job.phase, e?.stack || e?.message);
      }
      job.note = !job.installed
        ? hadVoice
          ? "Your previous voiceover is unchanged."
          : void 0
        : job.phase === "clean" || job.phase === "timeline"
          ? afterNote(job.phase, !stopped)
          : void 0;
      if (!quitting) emit(job);
    } finally {
      if (held) endStep(dir, state);
      account.at = 0;
      if (!quitting) persistJobs();
    }
  })().catch((e) => log("voiceover", projectId, e?.message));
  return job;
}
export function cancelVoiceover(projectId, dir) {
  const j = jobs.get(projectId);
  if (!j || j.status !== "running") return false;
  return cancelStep(dir);
}
export function sweepIncoming(dir) {
  if (stepBusy(dir)) return;
  const a = path.join(dir, "audio");
  try {
    for (const f of fs.readdirSync(a)) {
      if (/\.incoming$/.test(f)) fs.rmSync(path.join(a, f), { force: true });
      else if (/\.cz-check$/.test(f) && !fs.existsSync(path.join(a, f.slice(0, -9))))
        fs.renameSync(path.join(a, f), path.join(a, f.slice(0, -9)));
    }
  } catch {}
}
export function stopAllVoiceovers() {
  quitting = true;
  persistJobs();
  for (const [id, j] of jobs)
    if (j.status === "running") {
      const d = jobDirs.get(id);
      if (!d) continue;
      cancelStep(d);
      try {
        for (const f of fs.readdirSync(path.join(d, "audio")))
          if (/\.incoming$/.test(f)) fs.rmSync(path.join(d, "audio", f), { force: true });
      } catch {}
    }
}
export async function replaceSource(dir, tmp, ext) {
  const a = path.join(dir, "audio");
  fs.mkdirSync(a, { recursive: true });
  const dest = path.join(a, "source" + ext);
  const plain = (f) => (e) => {
    throw isLocked(e) ? new Error(lockedText(f)) : e;
  };
  const list = fs.readdirSync(a);
  for (const f of list) {
    if (!/^source\./.test(f) || path.join(a, f) === tmp || /\.(incoming|cz-check)$/.test(f)) continue;
    const old = path.join(a, f);
    if (f === VOICE_WORDS) {
      try {
        fs.rmSync(old, { force: true });
      } catch (e) {
        plain(f)(e);
      }
      continue;
    }
    await toTrash(old).catch((e) => {
      log("voiceover to the trash failed", old, e?.message);
      try {
        fs.rmSync(old, { force: true });
      } catch (e2) {
        plain(f)(e2);
      }
    });
  }
  const legacy = path.join(a, "clean.wav");
  if (!list.some((f) => /^source\.\w+$/.test(f) && path.join(a, f) !== tmp) && fs.existsSync(legacy)) {
    await toTrash(legacy).catch((e) => {
      log("previous narration to the trash failed", legacy, e?.message);
      try {
        fs.renameSync(legacy, path.join(a, `clean (previous voiceover ${Date.now()}).wav`));
      } catch (e2) {
        plain("clean.wav")(e2);
      }
    });
  }
  try {
    fs.renameSync(tmp, dest);
  } catch (e) {
    plain(path.basename(dest))(e);
  }
  return dest;
}
async function toTrash(file) {
  const t = process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_TEST_TRASH;
  if (!t) return shell.trashItem(file);
  fs.mkdirSync(t, { recursive: true });
  fs.renameSync(file, path.join(t, `${Date.now()}-${path.basename(file)}`));
}
function writeWords(dir, provider, words) {
  const src = path.join(dir, "audio", "source.wav"),
    size = fs.statSync(src).size;
  fs.writeFileSync(path.join(dir, "audio", VOICE_WORDS), JSON.stringify({ provider, size, duration: wavDuration(src), words }));
}
export const wavHeader = (bytes, rate) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(bytes, 40);
  return h;
};
export function wavDuration(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size,
      head = Buffer.alloc(Math.min(size, 1 << 16));
    fs.readSync(fd, head, 0, head.length, 0);
    const riff = head.toString("ascii", 0, 4);
    if ((riff !== "RIFF" && riff !== "RF64") || head.toString("ascii", 8, 12) !== "WAVE") return null;
    let off = 12,
      tag = 1,
      rate = 0,
      byteRate = 0,
      frames = 0,
      data = null,
      big = null;
    while (off + 8 <= head.length) {
      const id = head.toString("ascii", off, off + 4),
        n = head.readUInt32LE(off + 4);
      if (id === "ds64" && off + 24 <= head.length) big = Number(head.readBigUInt64LE(off + 16));
      if (id === "fmt " && off + 24 <= head.length) {
        tag = head.readUInt16LE(off + 8);
        rate = head.readUInt32LE(off + 12);
        byteRate = head.readUInt32LE(off + 16);
      }
      if (id === "fact" && off + 12 <= head.length) frames = head.readUInt32LE(off + 8);
      if (id === "data") {
        data = n === 4294967295 && big != null ? big : Math.min(n, size - off - 8);
        break;
      }
      off += 8 + n + (n & 1);
    }
    if (!rate || data == null) return null;
    if (tag !== 1 && tag !== 3 && tag !== 65534 && frames) return frames / rate;
    return byteRate ? data / byteRate : null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}
export const pcm16 = (b) => {
  const c = Buffer.from(b.subarray(0, b.length - (b.length % 2)));
  return new Int16Array(c.buffer, c.byteOffset, c.length / 2);
};
export function speechBounds(x, rate) {
  const thr = 330;
  let a = 0,
    b = x.length - 1;
  while (a < x.length && Math.abs(x[a]) < thr) a++;
  while (b > a && Math.abs(x[b]) < thr) b--;
  if (a >= x.length) return [0, x.length];
  return [Math.max(0, a - Math.round(0.04 * rate)), Math.min(x.length, b + 1 + Math.round(0.15 * rate))];
}
