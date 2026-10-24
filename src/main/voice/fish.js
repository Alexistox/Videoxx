import { log } from "../core/log";
import { getSecret, secretHint, setSecret } from "../core/secrets";

const BASE = () => (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_FISH_BASE) || "https://api.fish.audio";
const KEY = "fishaudio";
export function fishKeyStatus() {
  const hint = secretHint(KEY);
  return { hasKey: !!hint, hint };
}
function auth() {
  const k = getSecret(KEY);
  if (!k) throw new Error("Add your Fish Audio API key first (Settings > Media > Voiceover, or Fish Audio in the Voiceover window).");
  return k;
}
export const FISH_MODELS = [
  { id: "drama-3", name: "Drama 3", hint: "Newest and most expressive, 80+ languages (recommended)" },
  { id: "s2.1-pro", name: "S2.1 Pro", hint: "Very natural, 80+ languages" },
  { id: "s2-pro", name: "S2 Pro", hint: "The model before S2.1, 80+ languages" },
  { id: "s1", name: "S1", hint: "Older, 13 languages" },
];
const S1_LANGS = "en zh ja de fr es ko ar ru nl it pl pt".split(" ");
export const fishSpeaks = (model, code) => model !== "s1" || S1_LANGS.includes(code.toLowerCase());
export const FISH_PRICE = 15 / 1e6;
function fishError(status, body, what) {
  const msg = String((typeof body === "string" ? body : (body?.message ?? body?.detail ?? "")) || "").slice(0, 240);
  log("fish audio error", status, what, (typeof body === "string" ? body : JSON.stringify(body)).slice(0, 600));
  let text,
    kind = "";
  if (status === 401) {
    text = "Fish Audio did not accept the API key. Copy the whole key again from fish.audio (API keys) into Settings > Media > Voiceover.";
    kind = "key";
  } else if (status === 402)
    text =
      "Your Fish Audio account has no API credit left for this. Add credit at fish.audio (Billing). Parts already made are kept and won't be charged again.";
  else if (status === 403) text = `Your Fish Audio key is not allowed to ${what}${msg ? ` (${msg})` : ""}.`;
  else if (status === 404 || (status === 400 && /reference|model not|voice/i.test(msg)))
    text = "Fish Audio no longer has this voice (it may have been deleted or made private). Pick another voice.";
  else if (status === 429) {
    text = "Fish Audio is busy for this account right now (too many requests at once). Trying again shortly.";
    kind = "retry";
  } else if (status >= 500) {
    text = `Fish Audio had a problem on its side (error ${status}). Try again in a few minutes.`;
    kind = "retry";
  } else text = `Fish Audio answered ${status}${msg ? `: ${msg}` : ""}.`;
  const e = new Error(text);
  e.status = status;
  e.kind = kind;
  return e;
}
function offline(e) {
  log("network error", "Fish Audio", e?.cause?.code || "", e?.message || e);
  const code = String(e?.cause?.code || "");
  const err = new Error(
    `Could not reach Fish Audio: ${/ENOTFOUND|EAI_AGAIN/.test(code) ? "this computer seems to be offline" : /TIMEOUT/i.test(code) ? "it did not answer in time" : "the connection failed"}. Check the internet connection and try again.`,
  );
  err.kind = "retry";
  err.network = true;
  return err;
}
async function call(p, what, init = {}, key2, signal) {
  const k = key2 ?? auth(),
    { model, ...rest } = init;
  const r = await fetch(BASE() + p, {
    ...rest,
    signal,
    headers: {
      Authorization: `Bearer ${k}`,
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(model ? { model } : {}),
      ...(rest.headers || {}),
    },
  }).catch((e) => {
    if (e?.name === "AbortError") throw new Error("cancelled");
    throw offline(e);
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    let b = t;
    try {
      b = JSON.parse(t);
    } catch {}
    throw fishError(r.status, b, what);
  }
  return r;
}
const json = async (p, what, key2) => (await call(p, what, {}, key2)).json();
let credit = { at: 0, usd: null };
export async function fishCredit(force = false) {
  if (!fishKeyStatus().hasKey) return null;
  if (!force && Date.now() - credit.at < 6e4) return credit.usd;
  try {
    const b = await json("/wallet/self/api-credit", "read your balance");
    const n = parseFloat(String(b?.credit ?? ""));
    credit = { at: Date.now(), usd: Number.isFinite(n) ? n : null };
  } catch (e) {
    log("fish credit", e?.message);
    credit = { at: Date.now(), usd: null };
  }
  return credit.usd;
}
export async function setFishKey(key2) {
  voices.clear();
  titles.clear();
  credit.at = 0;
  if (!key2) {
    setSecret(KEY, null);
    return fishKeyStatus();
  }
  key2 = key2.trim();
  if (/\s/.test(key2) || key2.length < 16 || key2.length > 200)
    throw new Error("That does not look like a Fish Audio API key. Copy it from fish.audio: API keys (in your account menu).");
  try {
    await json("/wallet/self/api-credit", "read your balance", key2);
  } catch (e) {
    if (e.kind === "key")
      throw new Error("Fish Audio did not accept this key. Check that you copied all of it and that the key is still active.");
    if (e.status !== 403) throw e;
  }
  setSecret(KEY, key2);
  return fishKeyStatus();
}
const voices = new Map(),
  samples = new Map();
const toVoice = (m, own) => {
  const s = (Array.isArray(m.samples) ? m.samples : []).find((x) => typeof x?.audio === "string" && /^https?:\/\//.test(x.audio));
  if (s) samples.set(String(m._id), s.audio);
  return {
    id: String(m._id),
    name: String(m.title || "Untitled voice")
      .trim()
      .slice(0, 80),
    own,
    languages: (Array.isArray(m.languages) ? m.languages : []).map(String).slice(0, 12),
    hint: String(m.description || (Array.isArray(m.tags) ? m.tags.slice(0, 4).join(" · ") : "") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120),
    preview: !!s,
    uses: +m.task_count || 0,
  };
};
export async function fishVoices(language = "en", force = false) {
  const code = String(language || "en")
      .toLowerCase()
      .slice(0, 3),
    c = voices.get(code);
  if (!force && c && Date.now() - c.at < 10 * 6e4) return c.list;
  const own = [];
  for (let page = 1; page <= 5; page++) {
    const b = await json(
      `/model?${new URLSearchParams({ self: "true", page_size: "100", page_number: String(page) })}`,
      "list your voices",
    );
    own.push(...(Array.isArray(b?.items) ? b.items : []).filter((m) => m?._id && m.state !== "failed").map((m) => toVoice(m, true)));
    if (!b?.has_more && (b?.items?.length ?? 0) < 100) break;
  }
  const pop = await json(
    `/model?${new URLSearchParams({ page_size: "60", page_number: "1", sort_by: "task_count", language: code })}`,
    "list voices",
  ).catch((e) => {
    log("fish popular voices", e?.message);
    return null;
  });
  const seen = new Set(own.map((v) => v.id));
  const list = [
    ...own.sort((a, b) => a.name.localeCompare(b.name)),
    ...(Array.isArray(pop?.items) ? pop.items : []).filter((m) => m?._id && !seen.has(String(m._id))).map((m) => toVoice(m, false)),
  ];
  voices.set(code, { at: Date.now(), list });
  return list;
}
export const fishSampleUrl = (id) => samples.get(id) ?? null;
const titles = new Map();
export function fishVoiceName(id) {
  id = String(id ?? "").trim();
  if (!/^[\w-]{8,64}$/.test(id) || !fishKeyStatus().hasKey) return Promise.resolve(null);
  for (const c of voices.values()) {
    const v = c.list.find((x) => x.id === id);
    if (v) return Promise.resolve(v.name);
  }
  const known = titles.get(id);
  if (known) return known;
  const p = json(`/model/${encodeURIComponent(id)}`, "read a voice").then(
    (m) => (m?._id && String(m.title ?? "").trim() ? toVoice(m, false).name : null),
    (e) => {
      log("fish voice name", e?.message);
      return null;
    },
  );
  titles.set(id, p);
  p.then((n) => {
    if (!n) titles.delete(id);
  });
  return p;
}
function wavPcm(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("Fish Audio sent back audio the app could not read. Try again.");
  let off = 12,
    rate = 0,
    ch = 1,
    bits = 16,
    start = -1,
    size = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4),
      n = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      ch = buf.readUInt16LE(off + 10);
      rate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    }
    if (id === "data") {
      start = off + 8;
      size = n === 0 || n === 4294967295 || start + n > buf.length ? buf.length - start : n;
      break;
    }
    off += 8 + n + (n & 1);
  }
  if (start < 0 || !rate || bits !== 16) throw new Error("Fish Audio sent back audio the app could not read. Try again.");
  const frames = Math.floor(size / 2 / ch),
    c = Buffer.from(buf.subarray(start, start + frames * ch * 2)),
    all = new Int16Array(c.buffer, c.byteOffset, frames * ch);
  if (ch === 1) return { pcm: all, rate };
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let k = 0; k < ch; k++) s += all[i * ch + k];
    mono[i] = Math.round(s / ch);
  }
  return { pcm: mono, rate };
}
export async function fishSpeak(text, s, signal) {
  const r = await call(
    "/v1/tts",
    "make speech",
    {
      method: "POST",
      model: s.model,
      body: JSON.stringify({
        text,
        reference_id: s.voiceId,
        format: "wav",
        sample_rate: 44100,
        normalize: true,
        latency: "normal",
        prosody: { speed: +s.speed.toFixed(2), volume: 0 },
      }),
    },
    void 0,
    signal,
  );
  const buf = Buffer.from(await r.arrayBuffer());
  const out = wavPcm(buf);
  if (out.pcm.length < out.rate * 0.1) throw new Error("Fish Audio sent back no audio for this part. Try again.");
  return out;
}
export async function fishSampleWav(text, s) {
  const r = await call("/v1/tts", "make speech", {
    method: "POST",
    model: s.model,
    body: JSON.stringify({
      text,
      reference_id: s.voiceId,
      format: "mp3",
      mp3_bitrate: 128,
      normalize: true,
      prosody: { speed: +s.speed.toFixed(2), volume: 0 },
    }),
  });
  credit.at = 0;
  return Buffer.from(await r.arrayBuffer());
}
export function fishSettings(s) {
  const voiceId = String(s?.voiceId ?? ""),
    model = FISH_MODELS.some((m) => m.id === s?.model) ? String(s.model) : FISH_MODELS[0].id;
  if (!/^[\w-]{1,64}$/.test(voiceId)) throw new Error("Pick a Fish Audio voice first.");
  const sp = Number(s?.speed);
  return {
    voiceId,
    voiceName: String(s?.voiceName ?? "").slice(0, 80),
    model,
    speed: Number.isFinite(sp) ? Math.min(1.5, Math.max(0.7, sp)) : 1,
  };
}
export const markCreditStale = () => {
  credit.at = 0;
};
