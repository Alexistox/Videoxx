import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";
import { getConfig, setConfig } from "../core/config";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";
import { childPath } from "../core/shellPath";
import { suiteVenv, suiteVenvPython } from "../core/install";
import { baseOf, getStyle, manifestOf } from "../styles/catalog";
import { soundOf } from "../images/overrides";
import { lang, langCode, wordsIn } from "../styles/languages";
import { spokenScript } from "../voice/spokenScript";
import { musicArgs, sfxGainOf } from "../audio/music";
import { toCut, trimArgs } from "../audio/trim";
import { sfxLibArgs } from "../audio/sfx";
import { hasLayers, layersMixFile } from "../audio/layers";
import { pipelineScriptsDir, reinstallHint } from "./pipelineScripts";
import { collectEvents } from "../render/workers";
import { findTranscriber, speechState, uncoveredLanguages } from "../voice/speechSetup";

function mixExtra(dir, style, music) {
  const lp = baseOf(style) === "lowpoly",
    toon = ["toon", "stickstory"].includes(baseOf(style)),
    fx = sfxGainOf(dir),
    lufs = manifestOf(style, dir)?.audio?.lufs;
  const own = typeof lufs === "number" && lufs >= -40 && lufs <= -6 ? ["--lufs", String(lufs)] : [];
  const layers = layersMixFile(dir);
  return [
    ...(music ? musicArgs(dir, baseOf(style)) : []),
    ...(lp
      ? ["--lufs", "-14", "--tp", "-2", "--bed-duck", "1.5"]
      : toon
        ? ["--lufs", "-14", "--tp", "-1.5", "--bed-duck", "1.5", ...(baseOf(style) === "stickstory" ? ["--min-ratio", "12"] : [])]
        : []),
    ...own,
    ...(fx ? ["--bed-gain", String(fx)] : []),
    ...(layers ? ["--layers", layers] : []),
  ];
}
export async function remix(dir, projectId, log2) {
  const py = getConfig().tools.python,
    a = path.join(dir, "audio");
  const bed = fs.existsSync(path.join(a, "sfx_bed.wav"));
  if (!fs.existsSync(path.join(a, "clean.wav")) || (!bed && !hasLayers(dir))) return null;
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^\uFEFF/, ""));
  const r = await run(
    py,
    [
      path.join(skillScripts(), "mix.py"),
      dir,
      ...mixExtra(dir, pj.style, soundOf(projectId).music),
      ...(bed ? [] : ["--no-bed"]),
      ...(soundOf(projectId).sfx ? [] : ["--bed-gain", "-120"]),
    ],
    dir,
    log2,
  );
  if (r.code !== 0) throw new Error("The mix failed: " + r.out.trim().split("\n").slice(-2).join(" "));
  try {
    return JSON.parse(fs.readFileSync(path.join(a, "mix_report.json"), "utf8"));
  } catch {
    return null;
  }
}
export async function waveform(file, perSecond = 60) {
  const cache = path.join(path.dirname(path.dirname(file)), ".suite", `wave-${path.basename(file)}.json`);
  const st = fs.statSync(file);
  try {
    const c = JSON.parse(fs.readFileSync(cache, "utf8"));
    if (c.mtime === st.mtimeMs && c.perSecond === perSecond) return c;
  } catch {}
  let b = await fs.promises.readFile(file);
  const parse = (b2) => {
    if (!/^(RIFF|RF64)$/.test(b2.toString("ascii", 0, 4)) || b2.toString("ascii", 8, 12) !== "WAVE") return null;
    let off = 12,
      fmt2 = null,
      data22 = null;
    while (off + 8 <= b2.length) {
      const id = b2.toString("ascii", off, off + 4),
        size = b2.readUInt32LE(off + 4);
      if (id === "fmt ")
        fmt2 = {
          format: b2.readUInt16LE(off + 8),
          channels: b2.readUInt16LE(off + 10),
          rate: b2.readUInt32LE(off + 12),
          bits: b2.readUInt16LE(off + 22),
        };
      if (id === "data") {
        data22 = [off + 8, Math.min(size, b2.length - off - 8)];
        break;
      }
      off += 8 + size + (size & 1);
    }
    const plain =
      fmt2 &&
      fmt2.channels &&
      (((fmt2.format === 1 || fmt2.format === 65534) && [8, 16, 24, 32].includes(fmt2.bits)) || (fmt2.format === 3 && fmt2.bits === 32));
    return plain && data22 ? { fmt: fmt2, data: data22 } : null;
  };
  let wav = parse(b);
  if (!wav) {
    const tmp = path.join(os.tmpdir(), `cz-wave-${process.pid}-${Date.now()}.wav`);
    try {
      const r = await run(
        getConfig().tools.ffmpeg,
        ["-v", "error", "-y", "-i", file, "-ac", "1", "-ar", "8000", "-c:a", "pcm_s16le", "-f", "wav", tmp],
        os.tmpdir(),
      );
      if (r.code !== 0 || !fs.existsSync(tmp)) return null;
      b = await fs.promises.readFile(tmp);
      wav = parse(b);
    } catch {
      return null;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  if (!wav) throw new Error("unsupported WAV");
  const { fmt, data } = wav;
  const bps = fmt.bits / 8,
    frame = bps * fmt.channels,
    n = Math.floor(data[1] / frame);
  const read = (i) => {
    const p = data[0] + i * frame;
    if (fmt.format === 3) return b.readFloatLE(p);
    if (fmt.bits === 16) return b.readInt16LE(p) / 32768;
    if (fmt.bits === 24) return b.readIntLE(p, 3) / 8388608;
    if (fmt.bits === 32) return b.readInt32LE(p) / 2147483648;
    return (b.readUInt8(p) - 128) / 128;
  };
  const hop = Math.max(1, Math.round(fmt.rate / perSecond)),
    buckets = Math.ceil(n / hop);
  const peaks = new Array(buckets);
  for (let k = 0; k < buckets; k++) {
    let m = 0;
    const e = Math.min(n, (k + 1) * hop);
    for (let i = k * hop; i < e; i += 4) {
      const v = Math.abs(read(i));
      if (v > m) m = v;
    }
    peaks[k] = Math.round(Math.min(1, m) * 255);
  }
  const out = { mtime: st.mtimeMs, perSecond, duration: n / fmt.rate, peaks };
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(out));
  return out;
}
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
const stepProcs = new Map();
export const stepsRunning = () => stepProcs.size;
export function cancelStep(dir) {
  const s = stepProcs.get(dir);
  if (!s) return false;
  s.cancelled = true;
  s.abort.abort();
  s.procs.forEach((p) => p.kill());
  return true;
}
export function beginStep(dir, kind = "step") {
  if (stepProcs.has(dir))
    throw new Error("Another audio step is still running for this project. Wait for it to finish (or cancel it), then try again.");
  const state = { procs: new Set(), cancelled: false, abort: new AbortController(), kind };
  stepProcs.set(dir, state);
  return state;
}
export function endStep(dir, state) {
  if (stepProcs.get(dir) === state) stepProcs.delete(dir);
}
export const stepBusy = (dir) => stepProcs.has(dir);
export const stepKind = (dir) => stepProcs.get(dir)?.kind ?? null;
const NOISE =
  /OneLogger|error_handling_strategy|for rank \(rank=|No exporters were provided|telemetry data will|triton not found|flop_counter|flop counting|^\s*W\d{4} \d\d:\d\d|\[NeMo W|UserWarning|FutureWarning|warnings\.warn\(/;
function cannotStart(cmd, e) {
  const base = path
    .basename(cmd)
    .replace(/\.exe$/i, "")
    .toLowerCase();
  const tool = /^(python[\d.]*|py|pythonw)$/.test(base)
    ? "Python"
    : /^ffmpeg$/.test(base)
      ? "ffmpeg"
      : /^ffprobe$/.test(base)
        ? "ffprobe"
        : path.basename(cmd);
  const missing = e?.code === "ENOENT",
    where = /[\\/]/.test(cmd) ? ` (it looked for ${cmd})` : "";
  log("could not start", cmd, e?.code, e?.message);
  const err = new Error(
    missing
      ? `${tool} was not found. Install it, or set its path in Settings > System > Tool paths${where}; Settings > System check shows what is missing.`
      : `${tool} could not be started (${e?.code || "error"}). Check its path in Settings > System > Tool paths${where}.`,
  );
  err.notFound = missing;
  return err;
}
export function run(cmd, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const p = cp.spawn(cmd, args, { cwd, windowsHide: true, env: toolEnv() });
    const tracked = stepProcs.get(cwd);
    tracked?.procs.add(p);
    if (tracked?.cancelled) p.kill();
    let out = "",
      buf = "";
    const feed = (d) => {
      const s = d.toString();
      out += s;
      buf += s;
      const lines = buf.split(/\r\n|\r|\n/);
      buf = lines.pop();
      lines.forEach((l) => l.trim() && !NOISE.test(l) && onLine?.(l));
    };
    p.stdout.on("data", feed);
    p.stderr.on("data", feed);
    p.on("error", (e) => reject(cannotStart(cmd, e)));
    p.on("close", (code) => {
      tracked?.procs.delete(p);
      if (buf.trim()) onLine?.(buf);
      resolve({ code: code ?? 1, out });
    });
  });
}
const PY_CORE = { numpy: "numpy", scipy: "scipy", PIL: "pillow" };
const PY_WHISPER = { stable_whisper: "stable-ts" };
export async function pythonLacks(want, py = getConfig().tools.python) {
  const code = `import importlib.util as u, json; print(json.dumps([p for m, p in ${JSON.stringify(want)}.items() if u.find_spec(m) is None]))`;
  try {
    const r = await run(py, ["-c", code], os.tmpdir());
    return r.code === 0 ? JSON.parse(r.out.trim().split(/\r?\n/).pop()) : null;
  } catch {
    return null;
  }
}
export async function missingPython() {
  return pythonLacks({ ...PY_CORE, ...(findTranscriber() && !uncoveredLanguages().length ? {} : PY_WHISPER) });
}
export async function installPython(pkgs, onLine) {
  const safe = pkgs.filter((p) => /^[\w.-]+$/.test(p) && [...Object.values(PY_CORE), ...Object.values(PY_WHISPER)].includes(p));
  if (!safe.length) return { ok: true, missing: await missingPython() };
  let r = await run(getConfig().tools.python, ["-m", "pip", "install", "--upgrade", ...safe], os.tmpdir(), onLine);
  if (r.code !== 0 && /externally-managed-environment/.test(r.out)) {
    const venv = suiteVenv(),
      py = suiteVenvPython();
    onLine(`This Python doesn't allow installing packages system-wide. Creating the Suite's own Python environment in ${venv} ...`);
    if (!fs.existsSync(py)) {
      const v = await run(getConfig().tools.python, ["-m", "venv", venv], os.tmpdir(), onLine);
      if (v.code !== 0) return { ok: false, missing: await missingPython() };
    }
    setConfig({ tools: { python: py } });
    r = await run(py, ["-m", "pip", "install", "--upgrade", "pip", ...safe], os.tmpdir(), onLine);
  }
  return { ok: r.code === 0, missing: await missingPython() };
}
const skillScripts = () => pipelineScriptsDir();
const soundScript = (dir) => {
  let style = "pixel-art";
  try {
    style = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^\uFEFF/, "")).style || style;
  } catch {}
  const own = path.join(templatesDir(), "skill", getStyle(style).skill, "scripts", "sound_design.py");
  return {
    file: fs.existsSync(own) ? own : path.join(skillScripts(), "sound_design.py"),
    vox: baseOf(style) !== "pixel-art",
    music: manifestOf(style, dir)?.audio?.music ?? null,
  };
};
export const SAME_RUN_MS = 1e3;
export function voiceNotReady(dir, what) {
  const a = path.join(dir, "audio");
  let src;
  try {
    src = fs.readdirSync(a).find((f) => /^source\.\w+$/.test(f));
  } catch {
    return null;
  }
  const mt = (f) => {
    try {
      return fs.statSync(path.join(a, f)).mtimeMs;
    } catch {
      return 0;
    }
  };
  if (src && mt(src) > mt("clean.wav"))
    return mt("clean.wav")
      ? `The voiceover changed after the audio was cleaned: press Clean and time (under the preview in the editor) first. The ${what} would still have the previous narration.`
      : "Clean the audio and time the words first: Clean and time, under the preview in the editor.";
  if (what === "video" && mt("timeline.json") && mt("timeline.json") < mt("clean.wav") - SAME_RUN_MS)
    return "The words of this voiceover are not timed yet: press Time words (under the preview in the editor) first. The scenes would not follow the narration.";
  return null;
}
export function projectLanguage(dir) {
  try {
    return langCode(JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^\uFEFF/, "")).language) ?? "en";
  } catch {
    return "en";
  }
}
export const VOICE_WORDS = "source.words.json";
function voiceWords(dir) {
  const a = path.join(dir, "audio");
  try {
    const w = JSON.parse(fs.readFileSync(path.join(a, VOICE_WORDS), "utf8")),
      src = fs.statSync(path.join(a, "source.wav"));
    if (w.size !== src.size || !Array.isArray(w.words) || !w.words.length) return null;
    const cuts = JSON.parse(fs.readFileSync(path.join(a, "cuts.json"), "utf8"));
    if (!Array.isArray(cuts)) return null;
    if (!cuts.length) return w;
    const m = (t) => Math.round(toCut(t, cuts) * 1e3) / 1e3;
    return { ...w, duration: m(w.duration), words: w.words.map((x) => ({ ...x, start: m(x.start), end: m(x.end) })) };
  } catch {
    return null;
  }
}
export async function runStep(step, dir, opts, log2) {
  const state = beginStep(dir, step),
    a = path.join(dir, "audio");
  const before = new Map();
  for (const f of fs.existsSync(a) ? fs.readdirSync(a) : [])
    try {
      before.set(f, fs.statSync(path.join(a, f)).mtimeMs);
    } catch {}
  try {
    return await runStepInner(step, dir, opts, log2, state);
  } catch (e) {
    if (state.cancelled) {
      for (const f of fs.existsSync(a) ? fs.readdirSync(a) : []) {
        const p = path.join(a, f);
        if (/^source\./.test(f)) continue;
        try {
          if (fs.statSync(p).isFile() && fs.statSync(p).mtimeMs !== before.get(f)) fs.rmSync(p);
        } catch {}
      }
      throw new Error("Cancelled. Nothing from this step was kept.");
    }
    throw e;
  } finally {
    endStep(dir, state);
  }
}
function transcriptWords(dir, code, log2) {
  const f = path.join(dir, "audio", "transcript_words.txt");
  if (lang(code).spaced !== false) {
    fs.rmSync(f, { force: true });
    return;
  }
  const t = fs.readFileSync(path.join(dir, "audio", "transcript.txt"), "utf8"),
    lines = t.split(/\r?\n/).map((l) => wordsIn(l, code));
  fs.writeFileSync(f, lines.map((l) => l.join(" ")).join("\n"));
  log2?.(
    `${lang(code).name} has no spaces between words: ${lines.reduce((n, l) => n + l.length, 0)} words found by the word breaker, matched to the voice letter by letter.`,
  );
}
async function runStepInner(step, dir, opts, log2, state) {
  const py = getConfig().tools.python;
  const must = async (r, what, env = "suite") => {
    const x = await r;
    if (x.code === 0) return x;
    if (state.cancelled) throw new Error("Cancelled.");
    const mod = x.out.match(/No module named '([\w.]+)'/)?.[1];
    if (mod)
      throw new Error(
        env === "parakeet"
          ? `The transcriber's own Python environment is missing "${mod.split(".")[0]}". Redo it in Settings > System check > Transcription (or fix your Parakeet install).`
          : `${what} needs the Python package "${mod.split(".")[0]}". Install it in Settings > System check.`,
      );
    const lost = x.out.match(/can't open file '([^']+)'/)?.[1];
    if (lost) throw new Error(`${what} could not run: Videoxx is missing its own file ${path.basename(lost)}. ${reinstallHint()}`);
    if (/FileNotFoundError.*ffmpeg|'ffmpeg' is not recognized|ffmpeg: not found|ffmpeg: command not found/i.test(x.out))
      throw new Error(`${what} could not run ffmpeg. Install it or set its path in Settings > System > Tool paths.`);
    const last2 =
      x.out
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .pop() ?? "";
    throw new Error(`${what} failed${last2 ? `: ${last2.slice(0, 240)}` : ` (exit ${x.code})`}`);
  };
  if (step === "clean") {
    const audioDir = path.join(dir, "audio");
    const src = fs.readdirSync(audioDir).find((f) => /^source\.\w+$/.test(f));
    if (!src) throw new Error("Add a voiceover first (audio/source.*).");
    const trim = trimArgs(dir);
    if (trim)
      log2(`Trimming silences: ${trim[1]}% of every pause longer than ${trim[5]} ms (below ${trim[3]} dB), 20 ms tails and crossfades.`);
    await must(
      run(py, [path.join(skillScripts(), "audio_prep.py"), dir, ...(trim ?? (opts.tightenPauses ? [] : ["--keep-pauses"]))], dir, log2),
      "Audio cleanup",
    );
    return;
  }
  if (step === "timeline") {
    const clean = path.join(dir, "audio", "clean.wav");
    if (!fs.existsSync(clean)) throw new Error("Clean the audio first.");
    const code = langCode(opts.language) ?? projectLanguage(dir),
      L = lang(code),
      pk = findTranscriber(code),
      given = voiceWords(dir);
    if (given || pk) {
      if (given) {
        log2(
          `Using the word timings ${given.provider === "elevenlabs" ? "ElevenLabs" : "the voice"} sent with the voiceover (${given.words.length} words): no transcription needed.`,
        );
        const text = given.words.map((w) => w.word).join(" ");
        fs.writeFileSync(
          path.join(dir, "audio", "clean.json"),
          JSON.stringify({
            source: clean,
            model: given.provider,
            aligned: true,
            duration: given.duration,
            text,
            segments: [{ text, start: given.words[0].start, end: given.words.at(-1).end }],
            words: given.words,
          }),
        );
        fs.writeFileSync(path.join(dir, "audio", "clean.txt"), text);
      } else {
        log2(`Transcribing on this computer with ${pk.label}. Loading the speech model first: up to a minute after a restart ...`);
        await must(run(pk.python, [pk.script, clean, ...pk.args], dir, log2), "Transcription", "parakeet");
      }
      const script = path.join(dir, "script.txt"),
        transcript = path.join(dir, "audio", "transcript.txt");
      const mt = (f) => {
        try {
          return fs.statSync(f).mtimeMs;
        } catch {
          return 0;
        }
      };
      const src = fs.readdirSync(path.join(dir, "audio")).find((f) => /^source\.\w+$/.test(f));
      const keep = fs.existsSync(transcript) && mt(transcript) > mt(script) && (!src || mt(transcript) >= mt(path.join(dir, "audio", src)));
      if (opts.transcript != null) {
        const same = (() => {
          try {
            return fs.readFileSync(transcript, "utf8") === opts.transcript;
          } catch {
            return false;
          }
        })();
        if (!same) fs.writeFileSync(transcript, opts.transcript);
        log2("Using the script as the voice read it.");
      } else if (fs.existsSync(script)) {
        if (!keep) {
          fs.writeFileSync(transcript, spokenScript(fs.readFileSync(script, "utf8"), code));
          log2("Using script.txt as the proofread transcript.");
        } else log2("Keeping audio/transcript.txt (written for this voiceover, after script.txt).");
      } else fs.copyFileSync(path.join(dir, "audio", "clean.txt"), transcript);
      transcriptWords(dir, code, log2);
      await must(run(py, [path.join(templatesDir(), "tools", "parakeet_timeline.py"), dir, "--lang", code], dir, log2), "Timeline");
    } else {
      const setting = speechState().status === "running" || speechState().status === "verifying";
      log2(
        code !== "en" && findTranscriber("en")
          ? `Nothing on this computer transcribes ${L.name} yet${setting ? " (Claude is setting up transcription right now)" : ": Settings > System check > Transcription, other languages sets up a faster one"}. Using Whisper this time (slower) ...`
          : setting
            ? "Claude is still setting up transcription for this computer (Settings > System check). Using Whisper this time ..."
            : "Transcription is not set up on this computer yet (Settings > System check). Using Whisper this time ...",
      );
      await must(run(py, [path.join(skillScripts(), "transcribe.py"), dir, "--lang", code], dir, log2), "Transcription");
      const raw = path.join(dir, "audio", "transcript_raw.txt"),
        fixed = path.join(dir, "audio", "transcript.txt"),
        script = path.join(dir, "script.txt");
      if (opts.transcript != null) fs.writeFileSync(fixed, opts.transcript);
      else if (fs.existsSync(script)) fs.writeFileSync(fixed, spokenScript(fs.readFileSync(script, "utf8"), code));
      else fs.copyFileSync(raw, fixed);
      transcriptWords(dir, code, log2);
      await must(run(py, [path.join(skillScripts(), "align.py"), dir, "--lang", code], dir, log2), "Alignment");
    }
    const tl = JSON.parse(fs.readFileSync(path.join(dir, "audio", "timeline.json"), "utf8"));
    if (!Array.isArray(tl) || !tl.length)
      throw new Error("No words could be timed. Check that the voiceover is speech and that script.txt matches it.");
    const pjf = path.join(dir, "project.json"),
      pj = JSON.parse(fs.readFileSync(pjf, "utf8"));
    pj.end = +(tl.at(-1).e + 1.2).toFixed(2);
    fs.writeFileSync(pjf, JSON.stringify(pj, null, 1));
    log2(`Timeline ready: ${tl.length} phrases, video length ${pj.end}s.`);
    return;
  }
  if (step === "sound") {
    if (!opts.projectId) throw new Error("project id required");
    const notReady = voiceNotReady(dir, "mix");
    if (notReady) throw new Error(notReady);
    log2("Collecting shot boundaries, card entrances and accents ...");
    const ev = await collectEvents(opts.projectId, log2);
    log2(`events: ${ev.shots.length} shots, ${ev.hits.length} accents, ${ev.cards.length} cards`);
    for (const s of ev.skipped ?? [])
      log2(`Skipped frames that threw an error (fix this scene, then run Sound again for its accents): ${s}`);
    const beds = path.join(dir, "audio", "beds.json"),
      sd = soundScript(dir);
    const pj0 = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^\uFEFF/, ""));
    if (sd.music == null && baseOf(pj0.style) === "stickman") {
      fs.writeFileSync(beds, JSON.stringify({ beds: [] }, null, 1));
      log2("MS Paint stick figures: voice only (no music bed).");
    } else if (sd.music == null && baseOf(pj0.style) === "stickstory" && !fs.existsSync(beds)) {
      const end = +(pj0.end || 0) || 60;
      fs.writeFileSync(
        beds,
        JSON.stringify(
          {
            music: true,
            beds: [
              { from: 0, to: end, type: "music", mood: "mystery", gain: -34 },
              { from: 0, to: end, type: "room", gain: -46 },
            ],
          },
          null,
          1,
        ),
      );
      log2("No beds.json yet - wrote a quiet story bed and room tone. Ask Claude to shape the music per section.");
    } else if (sd.music === "none") {
      fs.writeFileSync(beds, JSON.stringify({ beds: [] }, null, 1));
      log2(`${getStyle(pj0.style).name}: no music bed (the style has none).`);
    } else if (!fs.existsSync(beds)) {
      const pj = pj0;
      fs.writeFileSync(
        beds,
        JSON.stringify(
          sd.music === "user" || (sd.music == null && ["lowpoly", "toon"].includes(baseOf(pj0.style)))
            ? { beds: [] }
            : sd.vox
              ? {
                  beds: [
                    { from: 0, to: pj.end, type: "music", gain: -30, mood: "curious", bpm: 96 },
                    { from: 0, to: pj.end, type: "room", gain: -44 },
                  ],
                }
              : { beds: [{ from: 0, to: pj.end, type: "pad", gain: -33, root: 55 }] },
          null,
          1,
        ),
      );
      log2(
        sd.vox
          ? "No beds.json yet - wrote a light music bed and room tone. Ask Claude to shape the music per section."
          : "No beds.json yet - wrote a single ambient pad. Ask Claude to design beds per section for more atmosphere.",
      );
    }
    const want = soundOf(opts.projectId),
      extra = mixExtra(dir, pj0.style, want.music),
      mine = extra.includes("--music");
    const noBed = !want.music && !want.sfx;
    const sdArgs = sfxLibArgs();
    if (noBed) log2("Music and sound effects are off for this project: the voice alone.");
    else if (want.music && want.sfx && !mine) await must(run(py, [sd.file, dir, ...sdArgs], dir, log2), "Sound design");
    else {
      log2(
        mine
          ? "Your own music plays instead of the style's music (Project settings > Music)."
          : want.music
            ? "Sound effects are off for this project: music and ambience only."
            : "Music is off for this project: sound effects only.",
      );
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cz-sound-")),
        ta = path.join(tmp, "audio");
      fs.mkdirSync(ta);
      try {
        for (const f of ["timeline.json", "events.json", "beds.json"])
          if (fs.existsSync(path.join(dir, "audio", f))) fs.copyFileSync(path.join(dir, "audio", f), path.join(ta, f));
        fs.copyFileSync(path.join(dir, "project.json"), path.join(tmp, "project.json"));
        const edit = (f, fn) => {
          const p = path.join(ta, f);
          try {
            fs.writeFileSync(p, JSON.stringify(fn(JSON.parse(fs.readFileSync(p, "utf8")))));
          } catch {}
        };
        if (want.music && mine)
          edit("beds.json", (j) => ({ ...j, beds: (j.beds ?? []).map((b) => (b.type === "music" ? { ...b, gain: -200 } : b)) }));
        if (!want.music)
          edit("beds.json", (j) => ({
            ...j,
            beds: j.beds?.length
              ? j.beds.map((b) => ({ ...b, gain: -200 }))
              : baseOf(pj0.style) === "recon"
                ? [{ from: 0, to: 1, type: "drone", gain: -200 }]
                : [],
          }));
        if (!want.sfx) edit("events.json", (j) => Object.fromEntries(Object.entries(j).map(([k, v]) => [k, Array.isArray(v) ? [] : v])));
        await must(run(py, [sd.file, tmp, ...sdArgs], dir, log2), "Sound design");
        fs.copyFileSync(path.join(ta, "sfx_bed.wav"), path.join(dir, "audio", "sfx_bed.wav"));
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
    if (!fs.existsSync(path.join(dir, "audio", "clean.wav")))
      throw new Error(
        noBed
          ? "There is no voiceover to mix yet. Add the voiceover (first step), then run this step again."
          : "Sound effects and music are ready, but there is no voiceover to mix them with yet. Add the voiceover (first step), then run this step again.",
      );
    await must(run(py, [path.join(skillScripts(), "mix.py"), dir, ...(noBed ? ["--no-bed"] : []), ...extra], dir, log2), "Mix");
    let rep = null;
    try {
      rep = JSON.parse(fs.readFileSync(path.join(dir, "audio", "mix_report.json"), "utf8"));
    } catch {}
    const ratio = rep?.voice_to_bed_db_while_speaking;
    if (typeof ratio === "number" && ratio < (["lowpoly", "toon", "stickstory"].includes(baseOf(pj0.style)) ? 8 : 16)) {
      const trim = -Math.min(14, +(16 - ratio + 1.5).toFixed(1));
      log2(
        `The music and effects were too loud for the voice (${ratio} dB apart, 16 needed): lowering them by ${-trim} dB and mixing again.`,
      );
      await must(
        run(py, [path.join(skillScripts(), "mix.py"), dir, ...extra, "--bed-gain", String(trim + sfxGainOf(dir))], dir, log2),
        "Mix",
      );
      try {
        rep = JSON.parse(fs.readFileSync(path.join(dir, "audio", "mix_report.json"), "utf8"));
      } catch {}
    }
    return rep;
  }
}
