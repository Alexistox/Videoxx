import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fadeEdges, resample } from "../audio/loudness";
import { FISH_PRICE, fishSpeak, markCreditStale } from "./fish";
import { NARRATOR_ONLY, chunksOf, levelVoices, onLine, pcm16, speechBounds, wavHeader, withVoice } from "./voiceover";
import { PACE_AIR, abortableSleep, gapAfter, keepOf, silence } from "./elevenlabs";

const fishCache = (dir) => path.join(dir, ".suite", "tts", "fish");
export const fishKey = (s, text, language) =>
  crypto
    .createHash("sha1")
    .update(JSON.stringify(["fish", s.voiceId, s.model, +s.speed.toFixed(2), text, language]))
    .digest("hex")
    .slice(0, 24);
export const fishChunks = (secs, voiceOf = NARRATOR_ONLY, pace = null) => chunksOf(secs, 1500, voiceOf, pace);
export const fishHave = (dir, key2) => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(fishCache(dir), key2 + ".json"), "utf8"));
    return fs.existsSync(path.join(fishCache(dir), key2 + ".pcm")) && m.rate ? m : null;
  } catch {
    return null;
  }
};
export async function fishGenerate(dir, chunks, s, fresh, job, state, emit, language) {
  const cache = fishCache(dir);
  fs.mkdirSync(cache, { recursive: true });
  const made = [];
  let bytes = 0;
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
      key2 = fishKey(sc, c.text, language),
      have = fresh ? null : fishHave(dir, key2),
      inSec = chunks.filter((x) => x.section === c.section);
    job.part = { done: i, total: chunks.length, unit: "part", sec: { done: inSec.indexOf(c), total: inSec.length } };
    if (have) {
      made.push({ key: key2, rate: have.rate });
      if (c.last) mark(i, job.sections[c.section].state === "run" ? "done" : "cached");
      continue;
    }
    mark(i, "run");
    for (let tries = 0; ;) {
      try {
        const r = await fishSpeak(c.text, sc, state.abort.signal);
        fs.writeFileSync(path.join(cache, key2 + ".pcm"), Buffer.from(r.pcm.buffer, r.pcm.byteOffset, r.pcm.byteLength));
        fs.writeFileSync(path.join(cache, key2 + ".json"), JSON.stringify({ rate: r.rate, at: Date.now() }));
        made.push({ key: key2, rate: r.rate });
        bytes += Buffer.byteLength(c.text, "utf8");
        if (job.retry) {
          job.retry = void 0;
          emit(job);
        }
        break;
      } catch (e) {
        if (state.cancelled || e.message === "cancelled") throw new Error("cancelled");
        if (e.kind === "retry" && ++tries <= 4) {
          job.log.push(`${e.message} Trying again (${tries} of 4) ...`);
          job.retry = `${e.network ? "Fish Audio could not be reached" : e.status >= 500 ? "Fish Audio had a problem on its side" : "Fish Audio is busy"}: trying again (${tries} of 4)…`;
          emit(job);
          await abortableSleep([2e3, 5e3, 12e3, 25e3][tries - 1], state.abort.signal);
          continue;
        }
        job.retry = void 0;
        markCreditStale();
        throw onLine(e, c);
      }
    }
    if (c.last) mark(i, "done");
  }
  job.part = { done: chunks.length, total: chunks.length, unit: "part" };
  markCreditStale();
  const outRate = Math.max(...made.map((m) => m.rate));
  const tmp = path.join(dir, "audio", "source.wav.incoming");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const fd = fs.openSync(tmp, "w");
  let samples = 0;
  const spans = [];
  try {
    fs.writeSync(fd, wavHeader(0, outRate));
    samples += silence(fd, chunks[0]?.lead ?? 0, outRate);
    made.forEach((m, i) => {
      const x = resample(pcm16(fs.readFileSync(path.join(cache, m.key + ".pcm"))), m.rate, outRate),
        [a, b] = speechBounds(x, outRate);
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
  const keep = new Set(made.map((m) => m.key));
  for (const f of fs.readdirSync(cache)) {
    const k = f.replace(/\.(json|pcm)$/, "");
    if (keep.has(k)) continue;
    try {
      if (Date.now() - fs.statSync(path.join(cache, f)).mtimeMs > 60 * 864e5) fs.rmSync(path.join(cache, f), { force: true });
    } catch {}
  }
  return { tmp, ext: ".wav", words: null, usd: +(bytes * FISH_PRICE).toFixed(4), keys: made.map((m) => m.key), keep: pauses };
}
