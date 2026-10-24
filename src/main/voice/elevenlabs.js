import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { log } from "../core/log";
import { getSecret, secretHint, setSecret } from "../core/secrets";
import { fadeEdges, resample } from "../audio/loudness";
import { NARRATOR_ONLY, chunksOf, clamp, levelVoices, onLine, pcm16, speechBounds, wavHeader, withVoice } from "./voiceover";

export const BASE = () => (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_ELEVENLABS_BASE) || "https://api.elevenlabs.io";
const KEY = "elevenlabs";
export function keyStatus() {
  const hint = secretHint(KEY);
  return { hasKey: !!hint, hint };
}
export function auth() {
  const k = getSecret(KEY);
  if (!k) throw new Error("Add your ElevenLabs API key first (Settings > Media > Voiceover, or ElevenLabs in this dialog).");
  return k;
}
export function elError(status, body, what) {
  const d = body?.detail ?? body;
  const code = String((Array.isArray(d) ? d[0]?.type : d?.code || d?.status || d?.type) ?? "");
  const msg = String(
    Array.isArray(d)
      ? d
          .map((x) => x?.msg)
          .filter(Boolean)
          .join("; ")
      : typeof d === "string"
        ? d
        : (d?.message ?? ""),
  );
  const all = `${code} ${msg}`;
  log("elevenlabs error", status, what, JSON.stringify(body).slice(0, 600));
  const need = /(\d[\d,]*) credits? remaining, while (\d[\d,]*) credits? are required/i.exec(msg);
  let text,
    kind = "";
  if (/ivc_not_permitted|cloned voices? (are|is) not available/i.test(`${all} ${d?.status ?? ""}`))
    text =
      "Your ElevenLabs plan can't use instantly cloned voices (this voice is one). Pick a voice from the ElevenLabs library or a professional voice, or upgrade at elevenlabs.io (Starter or higher).";
  else if (/subscription_required/i.test(all) && !/output.?format|pcm_/i.test(all))
    text = `Your ElevenLabs plan doesn't include this${msg ? `: ${msg.slice(0, 200)}` : "."}`;
  else if (
    /invalid_api_key|missing_api_key|invalid api key/i.test(all) ||
    (status === 401 && !/permission|quota|unusual|credit/i.test(all))
  ) {
    text =
      "ElevenLabs did not accept the API key. Copy the whole key again from elevenlabs.io (Developers > API keys) into Settings > Media > Voiceover.";
    kind = "key";
  } else if (/missing_permissions|insufficient_permissions|permission/i.test(all)) {
    text = `Your ElevenLabs API key is not allowed to ${what}. Edit the key at elevenlabs.io (Developers > API keys) and allow it, or make a key without restrictions.`;
    kind = "permission";
  } else if (/quota_exceeded|insufficient_credits|exceeds your quota/i.test(all) || (status === 402 && /credit|quota/i.test(all)))
    text = `Your ElevenLabs account doesn't have enough characters left for this${need ? ` (it needs ${need[2]}, you have ${need[1]})` : ""}. Wait for your monthly reset or upgrade at elevenlabs.io. Sections already made are kept and won't be charged again.`;
  else if (/unusual.activity|free.tier.*disabled/i.test(all))
    text =
      "ElevenLabs has turned off free-plan use for this account (it reports unusual activity). A paid ElevenLabs plan lifts it; or use the local voice.";
  else if (status === 429 || /too_many_concurrent|concurrent_limit|rate_limit|system_busy/i.test(all)) {
    text = "ElevenLabs is busy right now (too many requests at once). Try again in a minute.";
    kind = "retry";
  } else if (/voice_not_found|invalid_voice_id/i.test(all) || (status === 404 && /voice/i.test(all)))
    text = "ElevenLabs no longer has this voice (it may have been removed from your voices). Pick another voice.";
  else if (/model_not_found/i.test(all)) text = "ElevenLabs does not offer this model to your account. Pick another model.";
  else if (/output.?format|pcm_44100|requires? (the )?pro|tier/i.test(all) && (status === 400 || status === 403)) {
    text = "This audio quality needs a higher ElevenLabs plan.";
    kind = "format";
  } else if (/previous_request_ids|next_request_ids|previous_text|next_text|stitch/i.test(all) && status < 500) {
    text = "This model cannot continue from the previous section.";
    kind = "stitch";
  } else if (/language_code|unsupported_language|language.*not supported/i.test(all) && status < 500) {
    text = "This model does not take the language of this video. Pick another model.";
    kind = "language";
  } else if (/text_too_long|too long/i.test(all))
    text = "A section is longer than this model takes at once. Pick another model, or add a ## heading to split the section.";
  else if (status === 402) text = `ElevenLabs needs a paid plan for this: ${msg.slice(0, 200) || "payment required"}.`;
  else if (status >= 500) {
    text = `ElevenLabs had a problem on its side (error ${status}). Try again in a few minutes.`;
    kind = "retry";
  } else text = `ElevenLabs answered ${status}${msg ? `: ${msg.slice(0, 240)}` : ""}.`;
  const e = new Error(text);
  e.status = status;
  e.kind = kind;
  return e;
}
export function offline(who, e) {
  log("network error", who, e?.cause?.code || "", e?.message || e);
  const code = String(e?.cause?.code || "");
  return `Could not reach ${who}: ${/ENOTFOUND|EAI_AGAIN/.test(code) ? "this computer seems to be offline" : /TIMEOUT/i.test(code) ? "it did not answer in time" : "the connection failed"}. Check the internet connection and try again.`;
}
async function el(p, what, init = {}, key2, signal) {
  const k = key2 ?? auth();
  const r = await fetch(BASE() + p, {
    ...init,
    signal,
    headers: {
      "xi-api-key": k,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  }).catch((e) => {
    if (e?.name === "AbortError") throw new Error("cancelled");
    const err = new Error(offline("ElevenLabs", e));
    err.kind = "retry";
    err.network = true;
    throw err;
  });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!r.ok) throw elError(r.status, body, what);
  return { body, headers: r.headers };
}
export const account = { at: 0, data: null, restricted: false, error: null };
const toAccount = (s) => ({
  tier: String(s.tier ?? ""),
  used: +s.character_count || 0,
  limit: +s.character_limit || 0,
  left: Math.max(0, (+s.character_limit || 0) - (+s.character_count || 0)),
  resetsAt: s.next_character_count_reset_unix ? s.next_character_count_reset_unix * 1e3 : null,
  canExtend: !!s.can_extend_character_limit,
  status: String(s.status ?? ""),
});
export async function elevenAccount(force = false) {
  if (!keyStatus().hasKey) return { account: null, restricted: false, error: null };
  if (!force && Date.now() - account.at < 6e4) return { account: account.data, restricted: account.restricted, error: account.error };
  try {
    const { body } = await el("/v1/user/subscription", "read your character balance (User: read)");
    account.data = toAccount(body);
    account.restricted = false;
    account.error = null;
  } catch (e) {
    account.data = null;
    account.restricted = e.kind === "permission";
    account.error = e.kind === "permission" ? null : e.message;
  }
  account.at = Date.now();
  return { account: account.data, restricted: account.restricted, error: account.error };
}
export async function setKey(key2) {
  if (!key2) {
    setSecret(KEY, null);
    voiceCache.at = 0;
    account.at = 0;
    rateCap = null;
    return keyStatus();
  }
  key2 = key2.trim();
  if (/\s/.test(key2) || key2.length < 20 || key2.length > 200)
    throw new Error(
      "That does not look like an ElevenLabs API key. Copy it from elevenlabs.io: Developers > API keys (it starts with sk_).",
    );
  try {
    await el("/v1/user/subscription", "read your character balance", {}, key2);
  } catch (e) {
    if (e.kind !== "permission")
      throw e.kind === "key"
        ? new Error("ElevenLabs did not accept this key. Check that you copied all of it and that the key is still active.")
        : e;
  }
  setSecret(KEY, key2);
  voiceCache.at = 0;
  account.at = 0;
  rateCap = null;
  modelCache.at = 0;
  return keyStatus();
}
export const voiceCache = { at: 0, list: [], previews: new Map(), langPreviews: new Map() };
const CATEGORY = { cloned: "Cloned", generated: "Designed", professional: "Pro clone" };
export async function elevenVoices(force = false) {
  if (!force && voiceCache.list.length && Date.now() - voiceCache.at < 10 * 6e4) return voiceCache.list;
  const all = [];
  let token = null;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ page_size: "100", include_total_count: "false", ...(token ? { next_page_token: token } : {}) });
    const { body } = await el(`/v2/voices?${q}`, "list your voices (Voices: read)");
    all.push(...(body?.voices ?? []));
    if (!body?.has_more || !body?.next_page_token) break;
    token = body.next_page_token;
  }
  voiceCache.previews.clear();
  voiceCache.langPreviews.clear();
  const short = (v) => (v.category === "premade" ? String(v.name).split(" - ")[0].trim() || String(v.name) : String(v.name).trim());
  const shared = new Set(),
    seen = new Set();
  for (const v of all)
    if (v?.voice_id && v?.name) {
      const n = short(v);
      if (seen.has(n)) shared.add(n);
      seen.add(n);
    }
  const list = all
    .filter((v) => v?.voice_id && v?.name)
    .map((v) => {
      if (v.preview_url) voiceCache.previews.set(v.voice_id, v.preview_url);
      const per = {};
      for (const x of Array.isArray(v.verified_languages) ? v.verified_languages : []) {
        const c = String(x?.language || "").toLowerCase();
        if (c && typeof x.preview_url === "string" && /^https?:\/\//.test(x.preview_url) && !per[c]) per[c] = x.preview_url;
      }
      voiceCache.langPreviews.set(v.voice_id, per);
      const l = v.labels || {},
        langs = [...new Set((v.verified_languages || []).map((x) => String(x.language || "")).filter(Boolean))];
      return {
        id: v.voice_id,
        name: shared.has(short(v)) ? String(v.name).trim() : short(v),
        category: String(v.category || ""),
        own: v.category !== "premade",
        hint: [l.accent, l.gender, l.age, l.descriptive || l.use_case || l.description]
          .filter(Boolean)
          .map(String)
          .map((s) => s.replace(/_/g, " "))
          .join(" · "),
        description: String(v.description || "").slice(0, 200),
        preview: !!v.preview_url,
        languages: langs,
        samples: Object.keys(per),
      };
    });
  list.sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
  voiceCache.list = list;
  voiceCache.at = Date.now();
  return list;
}
export const categoryLabel = (c) => CATEGORY[c] ?? "";
const V2_LANGS = "en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru".split(" ");
const MODEL_LANGS = {
  eleven_multilingual_v2: V2_LANGS,
  eleven_multilingual_v1: "en de pl es it fr pt hi".split(" "),
  eleven_flash_v2_5: [...V2_LANGS, "hu", "no", "vi"],
  eleven_turbo_v2_5: [...V2_LANGS, "hu", "no", "vi"],
  eleven_flash_v2: ["en"],
  eleven_turbo_v2: ["en"],
  eleven_monolingual_v1: ["en"],
};
export const speaks = (m, code) => !m.langs.length || m.langs.includes(code.toLowerCase());
export const NO_LANGUAGE_CODE = /multilingual_v[12]|monolingual|_v2$/;
let modelsKnown = [];
export const modelsFor = (code) => {
  const ok = (modelsKnown.length ? modelsKnown : FALLBACK_MODELS).filter((m) => speaks(m, code) && !m.older).map((m) => m.name);
  return ok.length ? ok.slice(0, 3).join(", ") : "another model";
};
const MODEL_NOTES = {
  // what each model is good for, and its documented limit per request
  eleven_multilingual_v2: ["Most natural and stable for long narration", 1e4],
  eleven_v4: ["Newest and most expressive", 1e4],
  eleven_v3: ["Very expressive; each section is made on its own", 5e3],
  eleven_flash_v2_5: ["Fast and half the credits; a little less natural", 4e4],
  eleven_turbo_v2_5: ["Older fast model (replaced by Flash v2.5)", 4e4],
  eleven_flash_v2: ["Fast, English only", 3e4],
  eleven_turbo_v2: ["Older fast model, English only", 3e4],
  eleven_monolingual_v1: ["First English model", 1e4],
  eleven_multilingual_v1: ["First multilingual model", 1e4],
};
const OLDER = /turbo|monolingual|multilingual_v1|flash_v2$/;
const ORDER = ["eleven_multilingual_v2", "eleven_v4", "eleven_v3", "eleven_flash_v2_5"];
const noStitch = (id) => /eleven_v3/.test(id);
const toModel = (m) => {
  const id = String(m.model_id),
    note = MODEL_NOTES[id];
  return {
    id,
    name: String(m.name || id),
    hint:
      note?.[0] ??
      String(m.description || "")
        .split(/(?<=\.)\s/)[0]
        .slice(0, 90),
    maxChars: +m.maximum_text_length_per_request || note?.[1] || 5e3,
    languages: Array.isArray(m.languages) ? m.languages.length : 0,
    cost: +(m.model_rates?.character_cost_multiplier ?? 1) || 1,
    style: m.can_use_style !== false,
    boost: m.can_use_speaker_boost !== false,
    stitching: !noStitch(id),
    older: OLDER.test(id),
    langs: (() => {
      const ids = (Array.isArray(m.languages) ? m.languages : [])
        .map(
          (l) =>
            String(l?.language_id ?? "")
              .toLowerCase()
              .split(/[-_]/)[0],
        )
        .filter((c) => /^[a-z]{2,3}$/.test(c));
      return ids.length ? [...new Set(ids)] : (MODEL_LANGS[id] ?? []);
    })(),
  };
};
export const FALLBACK_MODELS = [
  { model_id: "eleven_multilingual_v2", name: "Eleven Multilingual v2", languages: new Array(29) },
  { model_id: "eleven_flash_v2_5", name: "Eleven Flash v2.5", languages: new Array(32), model_rates: { character_cost_multiplier: 0.5 } },
  { model_id: "eleven_v3", name: "Eleven v3", languages: new Array(70) },
].map(toModel);
export let modelCache = { at: 0, list: [] };
export async function elevenModels() {
  if (modelCache.list.length && Date.now() - modelCache.at < 30 * 6e4) return modelCache.list;
  let list;
  try {
    const { body } = await el("/v1/models", "list the models");
    list = (Array.isArray(body) ? body : [])
      .filter((m) => m?.model_id && m.can_do_text_to_speech !== false && !m.requires_alpha_access)
      .map(toModel);
  } catch (e) {
    if (e.kind !== "permission") throw e;
    list = FALLBACK_MODELS;
  }
  const rank = (m) => {
    const i = ORDER.indexOf(m.id);
    return i < 0 ? (m.older ? 200 : 100) : i;
  };
  list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  modelCache = { at: Date.now(), list: list.length ? list : FALLBACK_MODELS };
  modelsKnown = modelCache.list;
  return modelCache.list;
}
export function elevenSettings(s) {
  const voiceId = String(s?.voiceId ?? ""),
    modelId = String(s?.modelId ?? "eleven_multilingual_v2");
  if (!/^[\w-]{1,64}$/.test(voiceId)) throw new Error("Pick an ElevenLabs voice first.");
  if (!/^[\w.-]{1,64}$/.test(modelId)) throw new Error("Pick an ElevenLabs model.");
  return {
    voiceId,
    voiceName: String(s?.voiceName ?? "").slice(0, 80),
    modelId,
    stability: clamp(s?.stability, 0, 1, 0.5),
    similarity: clamp(s?.similarity, 0, 1, 0.75),
    style: clamp(s?.style, 0, 1, 0),
    speed: clamp(s?.speed, 0.7, 1.2, 1),
    speakerBoost: s?.speakerBoost !== false,
  };
}
export const voiceSettings = (s, m) => ({
  stability: noStitch(s.modelId)
    ? [0, 0.5, 1].reduce((b, v) => (Math.abs(v - s.stability) < Math.abs(b - s.stability) ? v : b), 0.5)
    : +s.stability.toFixed(2),
  // v3: Creative / Natural / Robust
  similarity_boost: +s.similarity.toFixed(2),
  ...(m?.style === false ? {} : { style: +s.style.toFixed(2) }),
  ...(m?.boost === false ? {} : { use_speaker_boost: s.speakerBoost }),
  speed: +s.speed.toFixed(2),
});
export function chunkScript(secs, model, voiceOf = NARRATOR_ONLY, pace = null) {
  return chunksOf(secs, Math.min(model?.maxChars ?? 5e3, 2500), voiceOf, pace);
}
export const gapAfter = (c, air = 0) => (c.gap != null ? Math.max(0.1, c.gap - air) : c.last ? 0.8 : 0.45) + (c.beat ?? 0);
export const PACE_AIR = 0.35;
export const silence = (fd, secs, rate) => {
  const n = Math.round(secs * rate);
  if (n > 0) fs.writeSync(fd, Buffer.alloc(n * 2));
  return Math.max(0, n);
};
export function keepOf(chunks, spans, rate, total) {
  const k = [],
    s = (n) => +(n / rate).toFixed(3);
  if (chunks[0]?.lead && spans.length) k.push([0, s(spans[0].start)]);
  chunks.forEach((c, i) => {
    if ((c.beat || (c.gap != null && i < chunks.length - 1)) && spans[i])
      k.push([s(spans[i].end), s(i + 1 < spans.length ? spans[i + 1].start : total)]);
  });
  return k;
}
export function writePauses(dir, keep) {
  const f = path.join(dir, ".suite", "tts", "pauses.json");
  try {
    if (!keep?.length) {
      fs.rmSync(f, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ file: "audio/source.wav", size: fs.statSync(path.join(dir, "audio", "source.wav")).size, keep }));
  } catch (e) {
    log("voiceover pauses not noted", e?.message);
  }
}
const currentFile = (dir) => path.join(cacheDir(dir), "current.json");
export function markCurrent(dir, keys) {
  try {
    const s = fs.statSync(path.join(dir, "audio", "source.wav"));
    if (keys) fs.mkdirSync(cacheDir(dir), { recursive: true });
    if (keys) fs.writeFileSync(currentFile(dir), JSON.stringify({ keys, size: s.size, mtime: Math.round(s.mtimeMs) }));
    else fs.rmSync(currentFile(dir), { force: true });
  } catch {
    fs.rmSync(currentFile(dir), { force: true });
  }
}
export function isCurrent(dir, keys) {
  try {
    const c = JSON.parse(fs.readFileSync(currentFile(dir), "utf8")),
      s = fs.statSync(path.join(dir, "audio", "source.wav"));
    return c.size === s.size && c.mtime === Math.round(s.mtimeMs) && JSON.stringify(c.keys) === JSON.stringify(keys);
  } catch {
    return false;
  }
}
const cacheDir = (dir) => path.join(dir, ".suite", "tts", "elevenlabs");
export const chunkKey = (s, text, language) =>
  crypto
    .createHash("sha1")
    .update(
      JSON.stringify([
        s.voiceId,
        s.modelId,
        +s.stability.toFixed(2),
        +s.similarity.toFixed(2),
        +s.style.toFixed(2),
        +s.speed.toFixed(2),
        s.speakerBoost,
        text,
        ...(language && language !== "en" ? [language] : []),
      ]),
    )
    .digest("hex")
    .slice(0, 24);
export const readMade = (dir, key2) => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(cacheDir(dir), key2 + ".json"), "utf8"));
    return fs.existsSync(path.join(cacheDir(dir), m.pcm)) ? m : null;
  } catch {
    return null;
  }
};
let rateCap = null;
const PRO = /pro|scale|business|enterprise|growing/i;
export async function elevenGenerate(dir, chunks, s, model, fresh, job, state, emit, language = "en") {
  const cache = cacheDir(dir);
  fs.mkdirSync(cache, { recursive: true });
  const acct = await elevenAccount().catch(() => null);
  let rate = acct?.account ? (PRO.test(acct.account.tier) ? 44100 : 24e3) : (rateCap ?? 44100);
  let stitch = model?.stitching !== false && !noStitch(s.modelId),
    charged = 0;
  let sendLanguage = language !== "en" && !NO_LANGUAGE_CODE.test(s.modelId);
  const made = [];
  const mark = (i, st) => {
    const sec = job.sections[chunks[i].section];
    if (sec) {
      sec.state = st;
      emit(job);
    }
  };
  for (let i = 0; i < chunks.length; i++) {
    if (state.cancelled) throw new Error("cancelled");
    const c = chunks[i],
      sc = withVoice(s, c),
      key2 = chunkKey(sc, c.text, language),
      have = fresh ? null : readMade(dir, key2),
      inSec = chunks.filter((x) => x.section === c.section);
    job.part = { done: i, total: chunks.length, unit: "part", sec: { done: inSec.indexOf(c), total: inSec.length } };
    if (have) {
      made.push({ ...have, key: key2, voice: sc.voiceId });
      if (c.last) mark(i, job.sections[c.section].state === "run" ? "done" : "cached");
      continue;
    }
    mark(i, "run");
    const prevIds = made
      .filter((m) => m.voice === sc.voiceId)
      .slice(-3)
      .filter((m) => m.requestId && Date.now() - m.at < 110 * 6e4)
      .map((m) => m.requestId);
    let tries = 0;
    for (;;) {
      const body = { text: c.text, model_id: s.modelId, voice_settings: voiceSettings(s, model) };
      if (sendLanguage) body.language_code = language;
      if (stitch) {
        if (prevIds.length) body.previous_request_ids = prevIds;
        else if (i > 0) body.previous_text = chunks[i - 1].text.slice(-400);
        if (i + 1 < chunks.length) body.next_text = chunks[i + 1].text.slice(0, 400);
      }
      try {
        const { body: r, headers } = await el(
          `/v1/text-to-speech/${encodeURIComponent(sc.voiceId)}/with-timestamps?output_format=pcm_${rate}`,
          "make speech (Text to Speech)",
          { method: "POST", body: JSON.stringify(body) },
          void 0,
          state.abort.signal,
        );
        const audio = Buffer.from(String(r?.audio_base64 ?? ""), "base64"),
          al = r?.alignment;
        if (audio.length < 200) throw new Error("ElevenLabs sent back no audio for this section. Try again.");
        const timed = Array.isArray(al?.characters) && al.characters.length > 0;
        const m = {
          pcm: key2 + ".pcm",
          rate,
          requestId: headers.get("request-id"),
          at: Date.now(),
          chars: timed ? al.characters : [],
          starts: timed ? al.character_start_times_seconds : [],
          ends: timed ? al.character_end_times_seconds : [],
        };
        fs.writeFileSync(path.join(cache, m.pcm), audio);
        fs.writeFileSync(path.join(cache, key2 + ".json"), JSON.stringify(m));
        made.push({ ...m, key: key2, voice: sc.voiceId });
        charged += Math.round(c.text.length * (model?.cost ?? 1));
        if (job.retry) {
          job.retry = void 0;
          emit(job);
        }
        break;
      } catch (e) {
        if (state.cancelled || e.message === "cancelled") throw new Error("cancelled");
        if (e.kind === "format" && rate !== 24e3) {
          rate = rateCap = 24e3;
          job.log.push("This ElevenLabs plan makes 24 kHz audio (44.1 kHz needs Pro): using that.");
          continue;
        }
        if (e.kind === "stitch" && stitch) {
          stitch = false;
          delete body.previous_request_ids;
          job.log.push("This model makes each section on its own (no stitching).");
          continue;
        }
        if (e.kind === "language" && sendLanguage) {
          sendLanguage = false;
          job.log.push("This model takes the language from the text itself.");
          continue;
        }
        if (e.kind === "retry" && ++tries <= 3) {
          job.log.push(`${e.message} Trying again (${tries} of 3) ...`);
          job.retry = `${e.network ? "ElevenLabs could not be reached" : e.status >= 500 ? "ElevenLabs had a problem on its side" : "ElevenLabs is busy"}: trying again (${tries} of 3)…`;
          emit(job);
          await abortableSleep([2e3, 5e3, 12e3][tries - 1], state.abort.signal);
          continue;
        }
        job.retry = void 0;
        throw onLine(e, c);
      }
    }
    if (c.last) mark(i, "done");
  }
  job.part = { done: chunks.length, total: chunks.length, unit: "part" };
  const outRate = Math.max(...made.map((m) => m.rate));
  const tmp = path.join(dir, "audio", "source.wav.incoming");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const fd = fs.openSync(tmp, "w");
  let samples = 0;
  const words = [],
    spans = [];
  try {
    fs.writeSync(fd, wavHeader(0, outRate));
    samples += silence(fd, chunks[0]?.lead ?? 0, outRate);
    made.forEach((m, i) => {
      const x = resample(pcm16(fs.readFileSync(path.join(cache, m.pcm))), m.rate, outRate),
        [a, b] = speechBounds(x, outRate);
      const t0 = samples / outRate - a / outRate;
      for (const w of alignWords(m)) {
        const st = Math.max(samples / outRate, t0 + w.start),
          en = Math.min((samples + b - a) / outRate, t0 + w.end);
        words.push({ word: w.word, start: +st.toFixed(3), end: +Math.max(en, st + 0.02).toFixed(3) });
      }
      spans.push({ start: samples, end: samples + b - a, voice: chunks[i].voice ?? "", name: chunks[i].name ?? "" });
      const part = fadeEdges(x.subarray(a, b), outRate);
      fs.writeSync(fd, Buffer.from(part.buffer, part.byteOffset, part.byteLength));
      samples += b - a;
      if (i < made.length - 1) {
        const gap = Math.round(gapAfter(chunks[i], PACE_AIR) * outRate);
        fs.writeSync(fd, Buffer.alloc(gap * 2));
        samples += gap;
      } else samples += silence(fd, chunks[i].beat ?? 0, outRate);
    });
    fs.writeSync(fd, wavHeader(samples * 2, outRate), 0, 44, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (spans.some((x) => x.voice)) levelVoices(dir, tmp, outRate, 44, spans, (l) => job.log.push(l));
  const pauses = keepOf(chunks, spans, outRate, samples);
  for (let i = 1; i < words.length; i++) if (words[i].start < words[i - 1].start) words[i].start = words[i - 1].start;
  const keep = new Set(made.map((m) => m.key)),
    parts = new Map();
  for (const f of fs.readdirSync(cache)) {
    if (f === "current.json") continue;
    const k = f.replace(/\.(json|pcm)$/, ""),
      st = fs.statSync(path.join(cache, f)),
      p = parts.get(k) ?? { at: 0, bytes: 0, files: [] };
    p.at = Math.max(p.at, st.mtimeMs);
    p.bytes += st.size;
    p.files.push(f);
    parts.set(k, p);
  }
  let total = [...parts.values()].reduce((n, p) => n + p.bytes, 0);
  for (const [k, p] of [...parts].sort((x, y) => x[1].at - y[1].at)) {
    if (keep.has(k) || (total <= 3e8 && Date.now() - p.at < 60 * 864e5)) continue;
    for (const f of p.files) fs.rmSync(path.join(cache, f), { force: true });
    total -= p.bytes;
  }
  return { tmp, ext: ".wav", words: made.every((m) => m.chars.length) ? words : null, charged, keys: made.map((m) => m.key), keep: pauses };
}
const SOLID_RE = /^[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}]$/u,
  SOLID = { test: (c) => SOLID_RE.test(c) && !new RegExp("\\p{M}", "u").test(c) };
function alignWords(m) {
  const out = [];
  let cur = null;
  m.chars.forEach((ch, i) => {
    if (/^\s*$/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = null;
      }
      return;
    }
    const s = +m.starts[i] || 0,
      e = +m.ends[i] || s;
    if (cur && (SOLID.test(ch) || (/^[\p{L}\p{N}]$/u.test(ch) && SOLID.test(cur.word.slice(-1))))) {
      out.push(cur);
      cur = null;
    }
    if (!cur) cur = { word: ch, start: s, end: e };
    else {
      cur.word += ch;
      cur.end = Math.max(cur.end, e);
    }
  });
  if (cur) out.push(cur);
  return out;
}
export const abortableSleep = (ms, signal) =>
  new Promise((res, rej) => {
    if (signal.aborted) return rej(new Error("cancelled"));
    const t = setTimeout(res, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rej(new Error("cancelled"));
      },
      { once: true },
    );
  });
