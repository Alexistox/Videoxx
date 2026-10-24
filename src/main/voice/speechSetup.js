import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";
import { app } from "electron";
import { getConfig } from "../core/config";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";
import { q } from "../db/db";
import { childPath, safeExecFile, spawnErrorText } from "../core/shellPath";
import { claudeExecutable, cleanEnv, lastStatus } from "../engines/claudeCli";
import { LANGUAGES, lang, langCode, matchUnits } from "../styles/languages";
import { friendlyError, insideDir } from "../agent/sessions";

export const speechDir = () => process.env.CZ_SPEECH_DIR || path.join(app.getPath("userData"), "speech");
const modeDir = (m) => (m === "multi" ? path.join(speechDir(), "multi") : speechDir());
const setupFile = (m) => path.join(modeDir(m), "speech.json");
const candidateFile = (m) => path.join(modeDir(m), "candidate.json");
const SAMPLE_TEXT =
  "Videoxx turns your recordings into finished videos. This short sentence checks that transcription works on this computer.";
const SAMPLE_FOREIGN = {
  es: "Videoxx convierte tus grabaciones en vídeos terminados. Esta frase corta comprueba que la transcripción funciona en este ordenador.",
  fr: "Videoxx transforme vos enregistrements en vidéos terminées. Cette courte phrase vérifie que la transcription fonctionne sur cet ordinateur.",
  de: "Videoxx macht aus deinen Aufnahmen fertige Videos. Dieser kurze Satz prüft, ob die Spracherkennung auf diesem Computer funktioniert.",
  it: "Videoxx trasforma le tue registrazioni in video finiti. Questa breve frase controlla che la trascrizione funzioni su questo computer.",
  pt: "O Videoxx transforma as suas gravações em vídeos prontos. Esta frase curta verifica se a transcrição funciona neste computador.",
  nl: "Videoxx maakt van je opnames kant-en-klare video’s. Deze korte zin controleert of de transcriptie op deze computer werkt.",
  ja: "Videoxxは録音を完成した動画に変えます。この短い文で、このコンピューターで文字起こしが動くかを確かめます。",
  ko: "Videoxx는 녹음을 완성된 동영상으로 바꿉니다. 이 짧은 문장은 이 컴퓨터에서 음성 인식이 작동하는지 확인합니다.",
  zh: "Videoxx把你的录音变成完成的视频。这句短句用来检查这台电脑上的语音转写是否正常。",
  hi: "Videoxx आपकी रिकॉर्डिंग को तैयार वीडियो में बदल देता है। यह छोटा वाक्य जाँचता है कि इस कंप्यूटर पर ट्रांसक्रिप्शन काम करता है।",
  th: "Videoxx เปลี่ยนเสียงที่คุณบันทึกให้เป็นวิดีโอที่เสร็จสมบูรณ์ ประโยคสั้นๆ นี้ตรวจสอบว่าการถอดเสียงทำงานบนคอมพิวเตอร์เครื่องนี้",
  vi: "Videoxx biến các bản ghi âm của bạn thành video hoàn chỉnh. Câu ngắn này kiểm tra xem việc chuyển giọng nói thành chữ có hoạt động trên máy tính này không.",
  id: "Videoxx mengubah rekaman Anda menjadi video yang siap. Kalimat pendek ini memeriksa apakah transkripsi berfungsi di komputer ini.",
  ms: "Videoxx menukar rakaman anda menjadi video yang siap. Ayat pendek ini menyemak sama ada transkripsi berfungsi pada komputer ini.",
};
export function findParakeet() {
  const cfg = getConfig().tools.parakeet;
  const root = cfg || path.join(os.homedir(), "tools", "parakeet");
  const py = [path.join(root, ".venv", "Scripts", "python.exe"), path.join(root, ".venv", "bin", "python")].find((f) => fs.existsSync(f));
  const script = path.join(root, "transcribe.py");
  return py && fs.existsSync(script) ? { python: py, script } : null;
}
export function readSetup(m = "english") {
  try {
    const s = JSON.parse(fs.readFileSync(setupFile(m), "utf8"));
    return fs.existsSync(s.python) && fs.existsSync(s.script) ? s : null;
  } catch {
    return null;
  }
}
const handles = (s, code) => (s.languages ?? ["en"]).includes(code);
export function findTranscriber(language2) {
  const L = lang(language2),
    en = L.code === "en";
  const pk = findParakeet();
  if (pk && (en || L.v3))
    return {
      ...pk,
      args: en ? [] : ["--model", "v3", "--lang", L.iso3],
      label: en ? "Parakeet (your own install)" : `Parakeet v3 (your own install) in ${L.name}`,
      lang: L.code,
    };
  const e = readSetup("english"),
    m = readSetup("multi");
  if (en && e) return { python: e.python, script: e.script, args: [], label: e.model, lang: "en" };
  if (m && handles(m, L.code))
    return { python: m.python, script: m.script, args: ["--lang", L.iso3], label: en ? m.model : `${m.model} in ${L.name}`, lang: L.code };
  return null;
}
let state = { status: "idle", log: [], job: null };
let emit = () => {};
let abort = null;
export function onSpeechState(fn) {
  emit = fn;
}
const language = () => {
  const c = getConfig().language;
  return c?.mode === "multi" ? (langCode(c.default) ?? "en") : "en";
};
let vl = null;
export function videoLanguages() {
  if (vl && Date.now() - vl.at < 1e4) return vl.codes;
  const codes = new Set();
  try {
    for (const p of q.all("SELECT path, kind FROM projects WHERE kind != 'personal'")) {
      try {
        const c = langCode(JSON.parse(fs.readFileSync(path.join(p.path, "project.json"), "utf8")).language);
        if (c) codes.add(c);
      } catch {}
    }
  } catch {}
  vl = { at: Date.now(), codes: [...codes] };
  return vl.codes;
}
export const forgetVideoLanguages = () => {
  vl = null;
};
export const uncoveredLanguages = () =>
  [...new Set([language(), ...[...videoLanguages()].sort()])].filter((c) => c !== "en" && !findTranscriber(c));
export function speechState() {
  const mode = getConfig().language?.mode === "multi" ? "multi" : "english",
    l = language();
  const t = findTranscriber(l);
  const multi = readSetup("multi");
  return {
    ...state,
    log: state.log.slice(-200),
    setup: readSetup("english"),
    multi,
    own: !!findParakeet(),
    mode,
    language: l,
    transcribes: t?.label ?? null,
    ready: !!findTranscriber("en") && (!!t || !!multi),
    uncovered: uncoveredLanguages(),
  };
}
const set = (p) => {
  state = { ...state, ...p };
  emit(speechState());
};
export const speechChanged = () => emit(speechState());
const say = (line) => {
  state.log.push(line);
  if (state.log.length > 400) state.log.splice(0, 100);
  emit(speechState());
};
const sh = (cmd, args, timeout = 15e3, signal) =>
  new Promise((res) => {
    if (signal?.aborted) return res("");
    try {
      safeExecFile(cmd, args, { windowsHide: true, timeout, env: toolEnv(), signal }, (e, o, se) => res(e ? "" : String(o || se).trim()));
    } catch {
      res("");
    }
  });
function toolEnv() {
  const t = getConfig().tools,
    dirs = [t.ffmpeg, t.python].filter((x) => x && /[\\/]/.test(x)).map((x) => path.dirname(x));
  const key2 = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  return {
    ...process.env,
    [key2]: childPath([...dirs, process.env[key2] ?? ""].join(path.delimiter)),
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
  };
}
export async function machineFacts(signal) {
  const cpus = os.cpus(),
    py = getConfig().tools.python;
  let free = 0;
  try {
    fs.mkdirSync(speechDir(), { recursive: true });
    const s = fs.statfsSync(speechDir());
    free = (s.bavail * s.bsize) / 2 ** 30;
  } catch {}
  const [pyVer, ffmpeg, nvidia, gpus] = await Promise.all([
    sh(py, ["--version"], 15e3, signal),
    sh(getConfig().tools.ffmpeg, ["-version"], 15e3, signal).then((v) => v.split("\n")[0].replace(/ Copyright.*/, "")),
    // (no Mac has an NVIDIA GPU: its GPU comes from system_profiler below)
    process.platform === "darwin"
      ? Promise.resolve("")
      : sh("nvidia-smi", ["--query-gpu=name,memory.total,memory.used,driver_version", "--format=csv,noheader"], 15e3, signal),
    process.platform === "win32"
      ? sh("powershell", ["-NoProfile", "-Command", '(Get-CimInstance Win32_VideoController).Name -join "; "'], 15e3, signal)
      : process.platform === "darwin"
        ? sh("system_profiler", ["SPDisplaysDataType"], 15e3, signal).then((t) =>
            t
              .split("\n")
              .filter((l) => /Chipset Model|Total Number of Cores|VRAM|Metal/.test(l))
              .map((l) => l.trim())
              .join("; "),
          )
        : sh("lspci", [], 15e3, signal).then((t) =>
            t
              .split("\n")
              .filter((l) => /VGA|3D/.test(l))
              .join("; "),
          ),
  ]);
  return {
    os: `${process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : process.platform} ${os.release()} (${process.arch})`,
    cpu: `${cpus[0]?.model?.trim() ?? "unknown"}, ${cpus.length} logical cores`,
    ram: `${(os.totalmem() / 2 ** 30).toFixed(0)} GB total, ${(os.freemem() / 2 ** 30).toFixed(0)} GB free right now`,
    gpu: gpus || "unknown",
    nvidia: nvidia || (process.platform === "darwin" ? "none (a Mac: Apple GPU)" : "none (nvidia-smi not found)"),
    disk: `${free.toFixed(0)} GB free on the drive of ${speechDir()}`,
    python: `${py} (${pyVer || "not found"})`,
    ffmpeg: ffmpeg || "not found",
  };
}
const big = (f) => fs.existsSync(f) && fs.statSync(f).size > 1e4;
const ps = (s) => s.replace(/['‘’‚‛]/g, (q2) => q2 + q2);
async function makeSample(dir, signal) {
  const wav = path.join(dir, "sample.wav");
  if (fs.existsSync(wav)) return wav;
  try {
    if (process.platform === "win32") {
      await sh(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=0; $s.SetOutputToWaveFile('${ps(wav)}'); $s.Speak('${SAMPLE_TEXT}'); $s.Dispose()`,
        ],
        6e4,
        signal,
      );
    } else if (process.platform === "darwin") {
      const aiff = path.join(dir, "sample.aiff");
      await sh("say", ["-o", aiff, SAMPLE_TEXT], 6e4, signal);
      await sh(getConfig().tools.ffmpeg, ["-y", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", "16000", wav], 6e4, signal);
      fs.rmSync(aiff, { force: true });
    }
  } catch {}
  if (signal?.aborted) {
    fs.rmSync(wav, { force: true });
    return null;
  }
  return big(wav) ? wav : null;
}
async function makeForeignSample(dir, signal) {
  const want = [language(), "es", "fr", "de", "it", "pt", "nl"].filter((c, i, a) => c !== "en" && SAMPLE_FOREIGN[c] && a.indexOf(c) === i);
  for (const code of want) {
    const wav = path.join(dir, `sample-${code}.wav`),
      text = SAMPLE_FOREIGN[code];
    if (big(wav)) return { file: wav, text, lang: code };
  }
  const tryOS = async (code, wav) => {
    const text = SAMPLE_FOREIGN[code];
    if (process.platform === "win32") {
      await sh(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $v=$s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq '${code}' } | Select-Object -First 1; if ($v) { $s.SelectVoice($v.VoiceInfo.Name); $s.SetOutputToWaveFile('${ps(wav)}'); $s.Speak('${ps(text)}') }; $s.Dispose()`,
        ],
        6e4,
        signal,
      );
    } else if (process.platform === "darwin") {
      const list = await sh("say", ["-v", "?"], 15e3, signal),
        voice = list
          .split("\n")
          .map((l) => /^(.+?)\s+([a-z]{2})[_-][A-Z]{2}\s+#/.exec(l))
          .find((m) => m && m[2] === code)?.[1]
          ?.trim();
      if (voice) {
        const aiff = path.join(dir, `sample-${code}.aiff`);
        await sh("say", ["-v", voice, "-o", aiff, text], 6e4, signal);
        await sh(getConfig().tools.ffmpeg, ["-y", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", "16000", wav], 6e4, signal);
        fs.rmSync(aiff, { force: true });
      }
    }
    if (signal?.aborted) {
      fs.rmSync(wav, { force: true });
      return false;
    }
    return big(wav);
  };
  for (const code of want) {
    if (signal?.aborted) return null;
    const wav = path.join(dir, `sample-${code}.wav`);
    try {
      if (await tryOS(code, wav)) return { file: wav, text: SAMPLE_FOREIGN[code], lang: code };
    } catch {}
  }
  try {
    const { speakSample } = await import("./index");
    for (const code of want) {
      if (signal?.aborted) return null;
      const wav = path.join(dir, `sample-${code}.wav`);
      if (await speakSample(code, SAMPLE_FOREIGN[code], wav)) return { file: wav, text: SAMPLE_FOREIGN[code], lang: code };
    }
  } catch (e) {
    log("speech: no local-voice sample", e?.message);
  }
  return null;
}
async function samplesFor(m, signal) {
  fs.mkdirSync(speechDir(), { recursive: true });
  const en = await makeSample(speechDir(), signal),
    out = en ? [{ file: en, text: SAMPLE_TEXT, lang: "en" }] : [];
  if (m === "multi" && !signal?.aborted) {
    const f = await makeForeignSample(speechDir(), signal);
    if (f) out.push(f);
  }
  return out;
}
function overlap(a, b) {
  const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1]);
  return d[a.length][b.length] / Math.max(1, a.length);
}
async function runOn(python, script, sample, out, withLang, signal) {
  const args = [script, sample.file, "--out", out, ...(withLang ? ["--lang", lang(sample.lang).iso3] : [])];
  return new Promise((res) => {
    if (signal?.aborted) return res({ code: 1, out: "Stopped." });
    let p;
    try {
      p = cp.spawn(python, args, { windowsHide: true, env: toolEnv() });
    } catch (e) {
      return res({ code: 1, out: spawnErrorText(e, python) });
    }
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.stderr.on("data", (d) => (o += d));
    const stop = () => p.kill();
    const timer = setTimeout(stop, 10 * 60 * 1e3);
    signal?.addEventListener("abort", stop);
    const done = (r) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      res(r);
    };
    p.on("close", (code) => done({ code: code ?? 1, out: o }));
    p.on("error", (e) => done({ code: 1, out: e.message }));
  });
}
const STOPPED = { ok: false, problem: "Stopped.", stopped: true };
export async function verify(python, script, samples, m = "english", signal) {
  if (!fs.existsSync(python)) return { ok: false, problem: `The Python in candidate.json does not exist: ${python}` };
  if (!fs.existsSync(script)) return { ok: false, problem: `The script in candidate.json does not exist: ${script}` };
  let seconds = 0;
  for (const sample of samples) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "cz-speech-"));
    const t0 = Date.now(),
      name = lang(sample.lang).name;
    const r = await runOn(python, script, sample, out, m === "multi", signal);
    if (sample.lang === "en") seconds = (Date.now() - t0) / 1e3;
    try {
      if (signal?.aborted) return STOPPED;
      if (r.code !== 0)
        return {
          ok: false,
          problem: `The script exited with code ${r.code} on the ${name} sample:
${r.out.slice(-1500)}`,
        };
      const jf = path.join(out, path.basename(sample.file, path.extname(sample.file)) + ".json");
      if (!fs.existsSync(jf))
        return {
          ok: false,
          problem: `The script did not write ${path.basename(jf)} into --out (files there: ${fs.readdirSync(out).join(", ") || "none"}).`,
        };
      const j = JSON.parse(fs.readFileSync(jf, "utf8"));
      const words = j.words ?? [];
      if (!Array.isArray(words) || !words.length) return { ok: false, problem: `The json of the ${name} sample has no "words".` };
      const bad = words.find(
        (w, i) => typeof w.word !== "string" || !(w.end > w.start) || w.start < 0 || (i && w.start < words[i - 1].start - 1e-3),
      );
      if (bad) return { ok: false, problem: `Word timings are not valid (each word needs start < end, in order): ${JSON.stringify(bad)}` };
      if (!Array.isArray(j.segments) || typeof j.text !== "string")
        return { ok: false, problem: 'The json needs "text" and "segments" as well as "words".' };
      const score = overlap(matchUnits(sample.text, sample.lang), matchUnits(words.map((w) => w.word).join(" "), sample.lang)),
        need = sample.lang === "en" ? 0.75 : 0.7;
      if (score < need)
        return {
          ok: false,
          problem: `It heard the ${name} test sentence wrong (${Math.round(score * 100)}% of the words${m === "multi" ? `, run with --lang ${lang(sample.lang).iso3}` : ""}). It said: "${words
            .map((w) => w.word)
            .join(" ")
            .slice(0, 300)}"`,
        };
    } catch (e) {
      return { ok: false, problem: "Could not read its json: " + e.message };
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }
  return { ok: true, seconds: seconds || void 0 };
}
const langList = (ls) => ls.map((l) => `${l.code} (${l.iso3}) ${l.name}`).join(", ");
export function prompt(dir, facts, samples, again, m = "english") {
  const baseline = path.join(templatesDir(), "tools", "speech", "transcribe.py"),
    multi = m === "multi";
  const main = lang(language()),
    en = samples.find((s) => s.lang === "en"),
    other = samples.find((s) => s.lang !== "en");
  const need = multi ? uncoveredLanguages().filter((c) => c !== main.code) : [];
  const what = multi ? "local speech-to-text for SEVERAL LANGUAGES" : "local speech-to-text";
  const head = again
    ? `Set up ${what} again for Videoxx on this computer (the user asked to redo it; the current setup keeps working until yours passes).`
    : `Set up ${what} for Videoxx on this computer.`;
  return `${head}
Videoxx uses it to transcribe voiceovers and camera footage, with word timings, for cutting and captions. Nobody is
watching: decide yourself, don't ask questions, and finish completely before you stop.${
    multi
      ? `
The user makes videos in other languages than English${main.code !== "en" ? ` (new videos start in ${main.name}, so it matters most, then English)` : ""}.${
          need.length
            ? `
Videos of theirs are in ${need.map((c) => lang(c).name).join(", ")}, which nothing on this computer transcribes yet: cover ${need.length === 1 ? "it" : "them"} too.`
            : ""
        } The
languages the app offers (ISO 639-1, then ISO 639-3): ${langList(LANGUAGES)}.`
      : ""
  }

This computer (measured by the app):
${Object.entries(facts)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

Your folder: ${dir}  (work only here; everything you install goes here)

1. Research first, always (web search; models change every few months, so don't rely on what you remember): the current
   best local speech-to-text models that give word-level timestamps: ${
     multi
       ? `accuracy across these languages (e.g. the multilingual
   tracks of the Hugging Face Open ASR leaderboard, FLEURS and Common Voice word error rates), not only English. Compare at
   least NVIDIA Parakeet TDT 0.6B v3 (25 European languages), Whisper large-v3 / large-v3-turbo (through faster-whisper:
   99 languages, needs an aligner or its own word timestamps) and anything newer you find`
       : "accuracy on English (e.g. the Hugging Face Open\n   ASR leaderboard)"
   }, speed on hardware like this (CPU, and this GPU if there is one), memory, download size, and how
   reliably they install with pip on ${facts.os.split(" ")[0]} without compilers or admin rights. Compare at least three.
2. Pick the best fit for THIS machine${multi ? " and these languages (you may combine: e.g. Parakeet v3 for its 25 languages and a Whisper model for the\n   others, chosen by --lang)" : ""}. If it has a capable GPU, try the GPU version of your pick (it must still pass
   step 5 and leave the GPU room for video decoding); if the GPU install fails, use the CPU. It must leave the computer usable while it runs (the video editor, a browser and
   Claude stay open): peak memory under a third of the RAM, at most half the CPU cores, a download under ~${multi ? 4 : 3} GB. Use the
   GPU only if it has the memory to spare and the install is reliable. A reliable install beats a small accuracy gain.
3. Install it into a virtual environment at ${path.join(dir, "venv")} made with the Python above; model files go in
   ${path.join(dir, "models")}. Never install system-wide, never use sudo/admin rights, winget, Homebrew or other
   package managers, and don't change PATH or any settings. ffmpeg is already installed (on PATH).${
     process.platform === "win32"
       ? `
   Windows fails on paths over 260 characters: keep the venv exactly there (short), never inside a deeper folder.`
       : ""
   }
4. Write ${path.join(dir, "transcribe.py")} with exactly this interface (the app and its editing skills call it):
     python transcribe.py INPUT [INPUT ...] [--out DIR] [--no-align] [--lang eng]
   - INPUT: any audio or video file ffmpeg can read. Load every model (the recogniser AND any aligner) once for all
     inputs, never per file: the editing skill passes hundreds of 2-10 s clips in one call, and a model reloaded per
     file turns minutes into half an hour. Any length (a 30-minute recording must work without running out of memory:
     cut long audio into pieces at pauses).
   - For each input write, into --out (default: next to the input), <input name without extension>.json:
       {"source": abs path, "model": name, "aligned": bool, "duration": seconds, "text": full text,
        "segments": [{"text", "start", "end"}], "words": [{"word", "start", "end"}]}
     plus <name>.srt (segments), <name>.words.srt (one word per cue) and <name>.txt (the text). Times in seconds,
     rounded to ms, words in order, start < end. Words keep their punctuation and capitalisation ("Pac-Man," "it's").
     Word timings should be as tight as the model allows (within ~50 ms is the aim): the editor cuts between words.
   - --no-align may skip any extra timing refinement; ${
     multi
       ? `--lang is the ISO 639-3 code of the language spoken in every
     input of that call (spa, fra, deu ...; eng when it is missing). Honour it: force that language (never auto-detect when
     it is given), pick the model that handles it and pass it to any aligner. Words keep their accents and letters
     ("transcripción", "Straße"), written in UTF-8 (ensure_ascii=False).`
       : "--lang is ISO 639-3 (only matters for non-English models)."
   }
   - Print short progress lines; exit non-zero with a clear message on failure.
5. Test it: ${en ? `${en.file} is a spoken sample that says: "${en.text}".${other ? ` ${other.file} says, in ${lang(other.lang).name} (run it with --lang ${lang(other.lang).iso3}): "${other.text}".` : ""} Also` : "Make a spoken test file if you can, and"} time it on a
   longer file (loop a sample to ~5 minutes with ffmpeg) to measure the real-time factor, and on 50 short clips (3 s
   pieces of the sample) in ONE call: after the model load that must take well under a second per clip.${
     multi && !other
       ? `
   This computer has no voice for another language: if you can, test a non-English recording you find or make yourself.`
       : ""
   }
6. Write ${path.join(dir, "candidate.json")}:
     {"python": "<absolute path of the venv's python>", "script": "<absolute path of transcribe.py>",
      "model": "<short human name, e.g. ${multi ? "Parakeet TDT 0.6B v3 (int8)" : "Parakeet TDT 0.6B v2 (int8)"}>", "device": "CPU" | "NVIDIA GPU" | "Apple GPU",
      "speed": <x real time on the long test>, "why": "<one plain sentence: why this fits this computer, and what you compared it with>"${
        multi
          ? `,
      "languages": [<the ISO 639-1 codes from the list above that it transcribes well, e.g. "en", "es">]`
          : ""
      }}
   The app then runs its own test${multi ? " (on each sample, with its --lang)" : ""} and switches it on.

A known-good fallback (do the research anyway): ${baseline}. It runs NVIDIA Parakeet TDT 0.6B ${multi ? "v3 (25 European languages: it picks v3 by itself when --lang is not eng)" : "v2"} through onnx-asr on the CPU
(pip install "onnx-asr[cpu,hub]", model ~0.7 GB int8 downloaded on first run, no PyTorch). Measured on a 20-thread desktop CPU: 11.7 minutes
of English narration in 21 s (34x real time), 97% word agreement with Parakeet + forced alignment, word starts within 40 ms
(median). It already follows the interface above: copy it into your folder (it keeps its model in a models folder next to itself,
${path.join(dir, "models")}) and run it once${multi ? " with --setup --model v3" : ""} so the download happens now. Pick something else when your research finds it clearly better for this
machine (more accurate, or much faster here, e.g. on this GPU${multi ? ", or covering languages it lacks" : ""}); if what you pick fails to install or to pass the tests,
fall back to this one.`;
}
export async function testProbes(cmd, badPath) {
  const probe = await sh(cmd, ["--version"]).then(
    (v) => ({ ok: true, v }),
    (e) => ({ ok: false, v: String(e?.message ?? e) }),
  );
  const was = process.env.PATH;
  process.env.PATH = badPath + path.delimiter + was;
  try {
    const f = await machineFacts().then(
      (v) => ({ ok: true, v }),
      (e) => ({ ok: false, v: String(e?.message ?? e) }),
    );
    return { probe, facts: f, toolEnvPath: toolEnv().PATH ?? toolEnv().Path };
  } finally {
    process.env.PATH = was;
  }
}
export function setupErrorText(e) {
  const msg = String(e?.message ?? e);
  if (/^(ENOTDIR|ENOENT|EACCES)$/.test(e?.code ?? "") || /\bspawn\b.*\b(ENOTDIR|ENOENT|EACCES)\b/.test(msg))
    return "The setup could not start a program. " + spawnErrorText(e, e?.path);
  return friendlyError(msg);
}
export function startSpeechSetup(opts = {}) {
  if (state.status === "running" || state.status === "verifying") return speechState();
  const m = opts.mode ?? wanted(),
    exe = claudeExecutable();
  if (!exe || !lastStatus()?.loggedIn) {
    set({ status: "failed", job: m, error: "Connect Claude first (Home > Connect Claude). It sets up transcription for this computer." });
    return speechState();
  }
  state.log = [];
  set({ status: "running", error: void 0, job: m, how: "claude" });
  const ctl = new AbortController();
  abort = ctl;
  run(exe, opts.again ?? !!readSetup(m), m, ctl)
    .catch((e) => {
      if (ctl.signal.aborted) return;
      log("speech setup failed", e?.code ?? "", e?.stack ?? e?.message);
      set({ status: "failed", error: setupErrorText(e) });
    })
    .finally(() => {
      if (abort === ctl) abort = null;
    });
  return speechState();
}
const STABLE_TS_WHY =
  "Whisper on the CPU through stable-ts: no GPU needed, word timings from Whisper itself, nothing leaves this computer.";
function step(exe, args, signal, timeoutMin = 30) {
  return new Promise((res) => {
    if (signal.aborted) return res({ code: 1, out: "Stopped." });
    let p;
    try {
      p = cp.spawn(exe, args, { windowsHide: true, env: toolEnv() });
    } catch (e) {
      return res({ code: 1, out: spawnErrorText(e, exe) });
    }
    let o = "",
      buf = "";
    const feed = (d) => {
      const s = d.toString();
      o += s;
      buf += s;
      const ls = buf.split(/\r\n|\r|\n/);
      buf = ls.pop();
      ls.forEach((l) => l.trim() && say("  " + l.trim().slice(0, 160)));
    };
    p.stdout.on("data", feed);
    p.stderr.on("data", feed);
    const stop = () => p.kill(),
      timer = setTimeout(stop, timeoutMin * 6e4);
    signal.addEventListener("abort", stop);
    const done = (r) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      res(r);
    };
    p.on("close", (code) => done({ code: code ?? 1, out: o }));
    p.on("error", (e) => done({ code: 1, out: e.message }));
  });
}
export function startStableTs(opts = {}) {
  if (state.status === "running" || state.status === "verifying") return speechState();
  const m = opts.mode === "multi" || opts.mode === "english" ? opts.mode : wanted(),
    size = opts.model === "small" ? "small" : "base";
  state.log = [];
  set({ status: "running", error: void 0, job: m, how: "stable-ts" });
  const ctl = new AbortController();
  abort = ctl;
  installStableTs(m, size, ctl.signal, opts.fake)
    .then((r) => {
      if (ctl.signal.aborted) return;
      if (!r.ok) {
        say("It did not pass: " + r.problem);
        set({ status: "failed", error: r.problem });
      }
    })
    .catch((e) => {
      if (ctl.signal.aborted) return;
      log("stable-ts setup failed", e?.code ?? "", e?.stack ?? e?.message);
      set({ status: "failed", error: setupErrorText(e) });
    })
    .finally(() => {
      if (abort === ctl) abort = null;
    });
  return speechState();
}
async function installStableTs(m, size, signal, fake) {
  const { STABLE_TS_PIP, venvPython } = await import("../core/install");
  const dir = path.join(modeDir(m), "stable-ts"),
    model = m === "english" ? `${size}.en` : size;
  fs.mkdirSync(dir, { recursive: true });
  say(`Installing Whisper ${model} on the CPU (stable-ts) into ${dir} ...`);
  const samples = await samplesFor(m, signal);
  if (signal.aborted) return STOPPED;
  let py;
  if (fake) {
    py = fake.python;
    fs.copyFileSync(fake.module, path.join(dir, "stable_whisper.py"));
    say("  (test: a stand-in stable_whisper, nothing installed)");
  } else {
    py = venvPython(path.join(dir, "venv"));
    if (!fs.existsSync(py)) {
      say("Making its own Python environment ...");
      const v = await step(getConfig().tools.python, ["-m", "venv", path.join(dir, "venv")], signal, 5);
      if (signal.aborted) return STOPPED;
      if (v.code !== 0 || !fs.existsSync(py))
        return {
          ok: false,
          problem: `Could not make a Python environment with ${getConfig().tools.python} (Settings > System > Tool paths > Python):
${v.out.slice(-600)}`,
        };
    }
    for (const a of STABLE_TS_PIP) {
      say(`pip ${a.filter((x) => !x.startsWith("http")).join(" ")} ...`);
      const r = await step(py, ["-m", "pip", ...a, "--disable-pip-version-check"], signal);
      if (signal.aborted) return STOPPED;
      if (r.code !== 0)
        return {
          ok: false,
          problem: `pip ${a.join(" ")} failed (internet connection? disk space?):
${r.out.slice(-800)}`,
        };
    }
  }
  const script = path.join(dir, "transcribe.py");
  fs.copyFileSync(path.join(templatesDir(), "tools", "speech", "stable_ts_transcribe.py"), script);
  fs.writeFileSync(
    path.join(dir, "stable-ts.json"),
    JSON.stringify(
      { model, threads: Math.max(1, Math.floor(os.cpus().length / 2)), iso: Object.fromEntries(LANGUAGES.map((l) => [l.iso3, l.code])) },
      null,
      1,
    ),
  );
  say(`Downloading the Whisper ${model} model (once) ...`);
  const s = await step(py, [script, "--setup"], signal);
  if (signal.aborted) return STOPPED;
  if (s.code !== 0)
    return {
      ok: false,
      problem: `The Whisper model could not be loaded:
${s.out.slice(-800)}`,
    };
  set({ status: "verifying" });
  say(samples.length > 1 ? "Testing it on spoken samples ..." : "Testing it on a spoken sample ...");
  return accept(
    {
      python: py,
      script,
      model: `Whisper ${model} (stable-ts)`,
      device: "CPU",
      why: STABLE_TS_WHY,
      languages: m === "multi" ? LANGUAGES.map((l) => l.code) : ["en"],
    },
    samples,
    m,
    signal,
  );
}
export function cancelSpeechSetup() {
  if (!abort) return false;
  abort.abort();
  abort = null;
  if (state.status === "running" || state.status === "verifying") {
    say("Stopped.");
    set({ status: "idle", error: void 0 });
  }
  return true;
}
function needsMulti() {
  if (getConfig().language?.mode !== "multi") return false;
  const l = language();
  return l === "en" ? !LANGUAGES.some((x) => x.code !== "en" && findTranscriber(x.code)) : !findTranscriber(l);
}
function wanted() {
  return needsMulti() ? "multi" : "english";
}
const FORBIDDEN =
  /\b(sudo|runas|winget|choco|scoop|brew|apt(-get)?|setx|reg\s+add|Set-ExecutionPolicy|Set-ItemProperty|launchctl|defaults\s+write)\b/i;
async function run(exe, again, m, ctl) {
  const signal = ctl.signal,
    stopped = () => signal.aborted;
  const dir = modeDir(m);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(candidateFile(m), { force: true });
  say(m === "multi" ? "Setting up transcription for several languages. Checking this computer ..." : "Checking this computer ...");
  const facts = await machineFacts(signal);
  if (stopped()) return;
  const samples = await samplesFor(m, signal);
  if (stopped()) return;
  for (const [k, v] of Object.entries(facts)) say(`  ${k}: ${v}`);
  if (m === "multi")
    say(
      samples.some((s) => s.lang !== "en")
        ? `  test samples: English and ${lang(samples.find((s) => s.lang !== "en").lang).name}`
        : "  test samples: English only (nothing on this computer speaks another language)",
    );
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  if (stopped()) return;
  const canUseTool = async (tool, input) => {
    const target = String(input?.file_path ?? input?.notebook_path ?? "");
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool) && target && !insideDir(dir, target))
      return { behavior: "deny", message: `Only files inside ${dir} may be written.` };
    if (/^(Bash|PowerShell)$/.test(tool) && FORBIDDEN.test(String(input?.command ?? "")))
      return {
        behavior: "deny",
        message: "No system-wide installs, package managers, admin rights or settings changes: install into your folder with pip only.",
      };
    return { behavior: "allow", updatedInput: input };
  };
  let session,
    text = prompt(dir, facts, samples, again, m);
  for (let attempt = 0; attempt < 3; attempt++) {
    const stream = query({
      prompt: text,
      options: {
        cwd: dir,
        pathToClaudeCodeExecutable: exe,
        env: { ...cleanEnv(), ...toolEnv() },
        abortController: ctl,
        model: "claude-sonnet-5-5",
        effort: "medium",
        maxTurns: 150,
        resume: session,
        settingSources: [],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append:
            "You are running inside Videoxx as an unattended setup job. Never end your turn while a command you started is still running.",
        },
        mcpServers: {},
        strictMcpConfig: true,
        permissionMode: "default",
        canUseTool,
      },
    });
    for await (const msg of stream) {
      if (msg.type === "system" && msg.subtype === "init") session = msg.session_id;
      else if (msg.type === "assistant")
        for (const b of msg.message.content || []) {
          if (b.type === "text" && b.text.trim()) say(b.text.trim().split("\n").slice(0, 6).join("\n"));
          else if (b.type === "tool_use")
            say(
              "· " +
                (b.name === "Bash" || b.name === "PowerShell"
                  ? String(b.input?.description || b.input?.command || "").slice(0, 140)
                  : b.name === "WebSearch"
                    ? `search: ${b.input?.query}`
                    : b.name === "WebFetch"
                      ? `read: ${b.input?.url}`
                      : `${b.name} ${path.basename(String(b.input?.file_path ?? ""))}`),
            );
        }
      else if (msg.type === "result" && (msg.subtype !== "success" || msg.is_error))
        throw new Error(msg.errors?.join?.("; ") || msg.result || msg.subtype);
    }
    if (stopped()) return;
    set({ status: "verifying" });
    say(samples.length > 1 ? "Testing it on spoken samples ..." : "Testing it on a spoken sample ...");
    let cand = null;
    try {
      cand = JSON.parse(fs.readFileSync(candidateFile(m), "utf8").replace(/^﻿/, ""));
    } catch {}
    const res = await accept(cand, samples, m, signal);
    if (res.ok || stopped()) return;
    say("The app's test failed: " + res.problem);
    text = `The app tested your setup and it failed:
${res.problem}
Fix it (or fall back to the known-good starting point), test again and rewrite candidate.json.`;
    set({ status: "running" });
  }
  throw new Error(
    "Transcription setup did not pass the test after three tries. Try again in Settings, or install Parakeet yourself (Settings > System > Tool paths).",
  );
}
export async function accept(cand, samples, m = "english", signal) {
  if (!cand) return { ok: false, problem: `${candidateFile(m)} is missing or not valid json.` };
  const languages =
    m === "multi"
      ? [...new Set(["en", ...(Array.isArray(cand.languages) ? cand.languages : []).map(langCode).filter((c) => !!c)])]
      : ["en"];
  if (m === "multi" && languages.length < 2)
    return {
      ok: false,
      problem:
        'candidate.json needs "languages": the ISO 639-1 codes (from the list in the task) of the languages it transcribes, e.g. ["en", "es", "fr"].',
    };
  const tested = samples.filter((s) => languages.includes(s.lang));
  const res = await verify(String(cand.python), String(cand.script), tested, m, signal);
  if (!res.ok) return res;
  if (signal?.aborted) return STOPPED;
  const setup = {
    python: cand.python,
    script: cand.script,
    model: String(cand.model || "Local model"),
    device: String(cand.device || "CPU"),
    why: cand.why,
    speed: +cand.speed || void 0,
    verifiedAt: new Date().toISOString(),
    languages,
  };
  fs.mkdirSync(modeDir(m), { recursive: true });
  fs.writeFileSync(setupFile(m), JSON.stringify(setup, null, 1));
  say(
    `Ready: ${setup.model} on the ${setup.device}${setup.speed ? `, ${Math.round(setup.speed)}x real time` : ""}${m === "multi" ? ` (${languages.length} languages)` : ""}.`,
  );
  set({ status: "ready", job: m });
  return res;
}
export async function testAccept(cand, m = "english") {
  const mm = m === "multi" ? "multi" : "english",
    samples = await samplesFor(mm);
  const ctl = new AbortController();
  if (mm === "multi") {
    abort = ctl;
    set({ status: "verifying", job: mm, error: void 0 });
  }
  try {
    const res = await accept(cand, samples, mm, ctl.signal);
    if (!res.ok && mm === "multi" && !res.stopped) set({ status: "idle" });
    return { ...res, sampled: samples.length > 0, languages: samples.map((s) => s.lang) };
  } finally {
    if (abort === ctl) abort = null;
  }
}
export async function testPrompt(m) {
  const samples = await samplesFor(m),
    facts = { os: `${process.platform === "win32" ? "Windows" : "macOS"} (test)` };
  return {
    prompt: prompt(modeDir(m), facts, samples, false, m),
    dir: modeDir(m),
    samples: samples.map((s) => ({ lang: s.lang, file: s.file })),
  };
}
let tried = new Set();
const autoFile = () => path.join(modeDir("multi"), "auto.json");
const autoTried = () => {
  try {
    const t = JSON.parse(fs.readFileSync(autoFile(), "utf8")).tried;
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
};
export function autoSpeechSetup() {
  if (process.env.CZ_NO_AUTO_SETUP || !lastStatus()?.loggedIn || state.status === "running" || state.status === "verifying") return;
  const l = language();
  if (needsMulti() && !readSetup("multi") && !autoTried().includes(l)) {
    try {
      fs.mkdirSync(modeDir("multi"), { recursive: true });
      fs.writeFileSync(autoFile(), JSON.stringify({ tried: [...autoTried(), l] }));
    } catch (e) {
      log("speech: auto setup not noted", e?.message);
      return;
    }
    log(`speech: nothing transcribes ${lang(l).name} on this computer, Claude sets up several languages`);
    startSpeechSetup({ mode: "multi", again: false });
    return;
  }
  if (findTranscriber("en") || tried.has("english")) return;
  tried.add("english");
  log("speech: no transcriber on this computer, Claude sets one up");
  startSpeechSetup({ mode: "english", again: false });
}
