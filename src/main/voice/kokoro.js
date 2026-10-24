import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import { app } from "electron";
import { once } from "node:events";
import { getConfig } from "../core/config";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";
import { isMacStub } from "../core/install";
import { countWords, lang } from "../styles/languages";
import { beginStep, cancelStep, endStep, pythonLacks, run } from "../pipeline/steps";
import { FISH_MODELS, FISH_PRICE, fishSampleUrl, fishSampleWav, fishSettings } from "./fish";
import {
  NARRATOR_ONLY,
  PACES,
  chunksOf,
  clamp,
  isLocked,
  jobs,
  levelVoices,
  onLine,
  paceOf,
  readScript,
  sentences,
  speakerVoices,
  spokenLength,
  voicesFor,
  wavDuration,
  wavHeader,
  wavLayout,
  withVoice,
} from "./voiceover";
import { grantPaths, probeFiles, useRecordings } from "./recordings";
import {
  BASE,
  FALLBACK_MODELS,
  NO_LANGUAGE_CODE,
  PACE_AIR,
  account,
  auth,
  chunkKey,
  chunkScript,
  elError,
  elevenSettings,
  elevenVoices,
  gapAfter,
  isCurrent,
  keepOf,
  modelCache,
  offline,
  readMade,
  voiceCache,
  voiceSettings,
} from "./elevenlabs";
import { fishChunks, fishHave, fishKey } from "./fishGenerate";

export const ttsDir = () =>
  (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_TTS_MODEL_DIR) || path.join(app.getPath("userData"), "tts");
const KOKORO_BASE = () =>
  (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_KOKORO_BASE) ||
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";
const KFILES = [
  { name: "kokoro-v1.0.onnx", sub: "models", size: 325532387, sha256: "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5" },
  { name: "voices-v1.0.bin", sub: "voices", size: 28214398, sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d" },
];
export const KOKORO_MB = Math.round(KFILES.reduce((n, f) => n + f.size, 0) / 1e6);
const kokoroScript = () => path.join(templatesDir(), "tools", "tts", "kokoro_tts.py");
export function kokoroFiles() {
  const dirs = [[ttsDir(), "app"]];
  if (!(process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_TTS_MODEL_DIR))
    dirs.push([path.join(os.homedir(), ".cache", "hyperframes", "tts"), "shared"]);
  for (const [d, where] of dirs) {
    const found = KFILES.map((f) =>
      [path.join(d, f.name), path.join(d, f.sub, f.name)].find((p) => {
        try {
          return fs.statSync(p).size === f.size;
        } catch {
          return false;
        }
      }),
    );
    if (found.every(Boolean)) return { model: found[0], voices: found[1], where };
  }
  return null;
}
const KLANG = {
  a: ["English (US)", "en-us"],
  b: ["English (UK)", "en-gb"],
  e: ["Spanish", "es"],
  f: ["French", "fr-fr"],
  h: ["Hindi", "hi"],
  i: ["Italian", "it"],
  p: ["Portuguese (Brazil)", "pt-br"],
};
const KBEST = ["af_heart", "af_bella", "af_nicole", "bf_emma", "am_fenrir", "am_michael", "am_puck", "bm_george", "bm_fable", "ff_siwis"];
function npzNames(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size,
      tail = Buffer.alloc(Math.min(size, 66e3));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    const e = tail.lastIndexOf(Buffer.from([80, 75, 5, 6]));
    if (e < 0) return [];
    const n = tail.readUInt16LE(e + 10),
      cdSize = tail.readUInt32LE(e + 12),
      cdOff = tail.readUInt32LE(e + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const names = [];
    let p = 0;
    for (let i = 0; i < n && p + 46 <= cd.length && cd.readUInt32LE(p) === 33639248; i++) {
      const fl = cd.readUInt16LE(p + 28),
        xl = cd.readUInt16LE(p + 30),
        cl = cd.readUInt16LE(p + 32);
      names.push(cd.toString("utf8", p + 46, p + 46 + fl).replace(/\.npy$/, ""));
      p += 46 + fl + xl + cl;
    }
    return names;
  } finally {
    fs.closeSync(fd);
  }
}
const kvCache = new Map();
export function kokoroVoiceList(voicesFile) {
  if (kvCache.has(voicesFile)) return kvCache.get(voicesFile);
  const list = npzNames(voicesFile)
    .filter((id) => /^[a-z][fm]_[a-z]+$/.test(id) && KLANG[id[0]])
    .map((id) => ({
      id,
      name: id.slice(3, 4).toUpperCase() + id.slice(4),
      language: KLANG[id[0]][0],
      lang: KLANG[id[0]][1],
      gender: id[1] === "f" ? "female" : "male",
      best: KBEST.includes(id),
    }));
  const langOrder = Object.keys(KLANG);
  list.sort(
    (a, b) =>
      langOrder.indexOf(a.id[0]) - langOrder.indexOf(b.id[0]) ||
      Number(b.best) - Number(a.best) ||
      KBEST.indexOf(a.id) - KBEST.indexOf(b.id) ||
      a.name.localeCompare(b.name),
  );
  kvCache.set(voicesFile, list);
  return list;
}
export function kokoroVoices() {
  const f = kokoroFiles();
  return f ? kokoroVoiceList(f.voices) : [];
}
export function kokoroVoicesFor(language) {
  const pre = lang(language).kokoro ?? "";
  return pre ? kokoroVoices().filter((v) => pre.includes(v.id[0])) : [];
}
export async function speakSample(language, text, wav) {
  const files = kokoroFiles(),
    v = kokoroVoicesFor(language)[0],
    py = files && v ? await kokoroPython() : null;
  if (!files || !v || !py) return false;
  const r = await run(
    py,
    [kokoroScript(), "--model", files.model, "--voices", files.voices, "--voice", v.id, "--lang", v.lang, "--say", text, "--out", wav],
    os.tmpdir(),
  ).catch(() => ({ code: 1, out: "" }));
  return r.code === 0 && fs.existsSync(wav) && fs.statSync(wav).size > 1e4;
}
const PY_KOKORO = { kokoro_onnx: "kokoro-onnx" };
const kokoroVenv = () => path.join(ttsDir(), "venv");
const kokoroVenvPython = () => path.join(kokoroVenv(), ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python3"]));
let pkg = { at: 0, py: null, base: null, of: "" };
async function kokoroPython(force = false) {
  const own = kokoroVenvPython(),
    base = getConfig().tools.python;
  if (!force && Date.now() - pkg.at < 6e4 && pkg.of === base) return pkg.py;
  const ownOk = fs.existsSync(own) && (await pythonLacks(PY_KOKORO, own))?.length === 0;
  const baseLacks = ownOk ? [] : isMacStub(base) ? null : await pythonLacks(PY_KOKORO, base);
  pkg = { at: Date.now(), py: ownOk ? own : baseLacks?.length === 0 ? base : null, base: baseLacks !== null, of: base };
  return pkg.py;
}
async function pythonFor(cwd) {
  const VERS = ["3.12", "3.13", "3.11", "3.10"];
  const cands = [
    [getConfig().tools.python, []],
    ...VERS.map((v) => (process.platform === "win32" ? ["py", [`-${v}`]] : [`python${v}`, []])),
  ];
  let first = 0;
  for (const [cmd, pre] of cands) {
    if (isMacStub(cmd)) continue;
    const r = await run(cmd, [...pre, "-c", "import sys; print(sys.version_info[0] * 100 + sys.version_info[1])"], cwd).catch(() => ({
      code: 1,
      out: "",
    }));
    const ver = r.code === 0 ? +r.out.trim().split(/\r?\n/).pop() || 0 : 0;
    if (!first && cmd === cands[0][0]) first = ver;
    if (ver >= 310 && ver <= 313) return { cmd, pre, ver };
  }
  return { cmd: null, pre: [], ver: first };
}
const rtfFile = () => path.join(ttsDir(), "speed.json");
export async function kokoroStatus() {
  const files = kokoroFiles(),
    py = await kokoroPython();
  let rtf = null;
  try {
    rtf = +JSON.parse(fs.readFileSync(rtfFile(), "utf8")).rtf || null;
  } catch {}
  return {
    installed: !!files && !!py,
    files: !!files,
    where: files?.where ?? null,
    python: py ? true : pkg.base === false ? null : false,
    voices: files ? kokoroVoiceList(files.voices).length : 0,
    sizeMB: KOKORO_MB,
    rtf,
    install: inst.status === "running" || (files && py) ? inst : { ...inst, kept: keptBytes() },
  };
}
function keptBytes() {
  let n = 0;
  for (const f of KFILES) {
    const p = path.join(ttsDir(), f.name);
    try {
      n += fs.statSync(p).size === f.size ? f.size : 0;
    } catch {
      try {
        n += fs.statSync(p + ".part").size;
      } catch {}
    }
  }
  return n;
}
let inst = { status: "idle", step: null, received: 0, total: 0, log: [] };
async function venvWhole(cwd) {
  if (!fs.existsSync(kokoroVenvPython())) return false;
  const r = await run(kokoroVenvPython(), ["-m", "pip", "--version"], cwd).catch(() => ({ code: 1, out: "" }));
  return r.code === 0;
}
export function installKokoro(emit) {
  if (inst.status === "running") return inst;
  fs.mkdirSync(ttsDir(), { recursive: true });
  const state = beginStep(ttsDir(), "install"),
    signal = state.abort.signal,
    cwd = ttsDir();
  inst = { status: "running", step: "packages", received: 0, total: KFILES.reduce((n, f) => n + f.size, 0), log: [] };
  const say = (l) => {
    inst.log.push(l);
    if (inst.log.length > 200) inst.log.splice(0, 50);
    emit({ ...inst });
  };
  let making = false,
    halfMade = false;
  (async () => {
    try {
      sweepRemoved();
      if (await kokoroPython(true)) say("The Python package kokoro-onnx is already installed.");
      else {
        const base = await pythonFor(cwd);
        if (!base.cmd)
          throw new Error(
            base.ver
              ? `The local voice needs Python 3.10 to 3.13; this computer's Python is ${Math.floor(base.ver / 100)}.${base.ver % 100}. Install Python 3.12 from python.org, then press Install again.`
              : `Python was not found (${getConfig().tools.python}). Install it (Settings > System check shows how) or set its path in Settings > System > Tool paths, then try again.`,
          );
        if (!(await venvWhole(cwd))) {
          if (fs.existsSync(kokoroVenv())) {
            say("The local voice's Python environment was not finished last time: making it again ...");
            if (!(await removeDir(kokoroVenv())))
              throw new Error("The local voice's unfinished Python environment is still in use. Wait a moment, then press Install again.");
          }
          say("Making the local voice its own Python environment ...");
          making = true;
          const r3 = await run(base.cmd, [...base.pre, "-m", "venv", kokoroVenv()], cwd, (l) => say(l.slice(0, 300)));
          if (state.cancelled) throw new Error("cancelled");
          if (r3.code !== 0 || !(await venvWhole(cwd)))
            throw new Error(
              `Python could not make an environment for the local voice: ${r3.out.trim().split(/\r?\n/).pop()?.slice(0, 200) || `exit ${r3.code}`}`,
            );
          making = false;
        }
        say("Installing kokoro-onnx and what it needs (about 60 MB) ...");
        const r2 = await run(
          kokoroVenvPython(),
          ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "kokoro-onnx"],
          cwd,
          (l) => say(l.slice(0, 300)),
        );
        if (state.cancelled) throw new Error("cancelled");
        if (r2.code !== 0 || !(await kokoroPython(true))) {
          log("kokoro pip failed", r2.out.slice(-2e3));
          throw new Error(
            "The Python package kokoro-onnx did not install. The log below says why (often the internet connection: try again).",
          );
        }
      }
      inst.step = "download";
      emit({ ...inst });
      const d = ttsDir();
      fs.mkdirSync(d, { recursive: true });
      let before = 0;
      for (const f of KFILES) {
        const dest = path.join(d, f.name);
        if (fs.existsSync(dest) && fs.statSync(dest).size === f.size) {
          inst.received = before += f.size;
          emit({ ...inst });
          continue;
        }
        say(`Downloading ${f.name} (${Math.round(f.size / 1e6)} MB) ...`);
        let shown = 0;
        await download(`${KOKORO_BASE()}/${f.name}`, dest, f, signal, (n) => {
          inst.received = before + n;
          if (Date.now() - shown > 250) {
            shown = Date.now();
            emit({ ...inst });
          }
        });
        before += f.size;
        inst.received = before;
        emit({ ...inst });
      }
      inst.step = "test";
      say("Testing the voice ...");
      emit({ ...inst });
      const files = kokoroFiles();
      if (!files) throw new Error("The model files are not complete. Try again.");
      const wav = path.join(os.tmpdir(), `cz-kokoro-test-${process.pid}.wav`);
      const r = await run(
        await kokoroPython(true),
        [kokoroScript(), "--model", files.model, "--voices", files.voices, "--voice", "af_heart", "--say", "Ready.", "--out", wav],
        cwd,
      );
      const ok = r.code === 0 && fs.existsSync(wav) && fs.statSync(wav).size > 4e3;
      fs.rmSync(wav, { force: true });
      if (state.cancelled) throw new Error("cancelled");
      if (!ok) {
        log("kokoro test failed", r.out.slice(-1500));
        throw new Error(
          `The local voice did not speak its test line: ${r.out.trim().split(/\r?\n/).pop()?.slice(0, 200) || `exit ${r.code}`}`,
        );
      }
      inst = { ...inst, status: "ready", step: null };
      say("The local voice is ready.");
    } catch (e) {
      const cancelled = state.cancelled || e.message === "cancelled";
      const kept = keptBytes();
      inst = {
        ...inst,
        status: cancelled ? "idle" : "failed",
        step: null,
        error: cancelled ? void 0 : e.message,
        kept,
        note: cancelled
          ? kokoroFiles()
            ? "Stopped. The voice files are already here: Install only sets up the rest."
            : kept > 1e6
              ? `Stopped. The ${Math.round(kept / 1e6)} MB downloaded so far are kept: Install continues from there.`
              : "Stopped. Nothing was installed."
          : void 0,
      };
      if (!cancelled) log("kokoro install failed", e?.stack || e?.message);
      emit({ ...inst });
      halfMade = cancelled && making;
    } finally {
      endStep(cwd, state);
    }
    if (halfMade) await removeDir(kokoroVenv());
  })().catch((e) => log("kokoro install", e?.message));
  return inst;
}
async function removeDir(d) {
  for (let i = 0; ; i++) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
      return true;
    } catch (e) {
      if (i >= 12) {
        log("could not remove", d, e?.code);
        return false;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
export function cancelKokoroInstall() {
  return cancelStep(ttsDir());
}
async function download(url, dest, f, signal, onBytes, again = false) {
  const part = dest + ".part";
  let have = 0;
  try {
    have = fs.statSync(part).size;
  } catch {}
  if (have >= f.size) {
    fs.rmSync(part, { force: true });
    have = 0;
  }
  const r = await fetch(url, { signal, redirect: "follow", headers: have ? { Range: `bytes=${have}-` } : {} }).catch((e) => {
    if (signal.aborted) throw new Error("cancelled");
    throw new Error(offline(`the download server (${f.name})`, e));
  });
  if (r.status === 416 && !again) {
    fs.rmSync(part, { force: true });
    return download(url, dest, f, signal, onBytes, true);
  }
  if (!r.ok || !r.body) throw new Error(`Could not download ${f.name} (the server answered ${r.status}). Try again later.`);
  const resumed = have > 0 && r.status === 206 && new RegExp(`^bytes ${have}-`).test(r.headers.get("content-range") || "");
  const hash = crypto.createHash("sha256");
  if (resumed) for await (const c of fs.createReadStream(part)) hash.update(c);
  let n = resumed ? have : 0;
  onBytes(n);
  const out = fs.createWriteStream(part, { flags: resumed ? "a" : "w" });
  try {
    for await (const chunk of r.body) {
      hash.update(chunk);
      n += chunk.length;
      onBytes(n);
      if (!out.write(chunk)) await once(out, "drain");
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  } catch (e) {
    out.end();
    throw signal.aborted
      ? new Error("cancelled")
      : new Error(`The download of ${f.name} stopped (${e.message}). Press Install again: it continues where it stopped.`);
  }
  if (n !== f.size || hash.digest("hex") !== f.sha256) {
    fs.rmSync(part, { force: true });
    throw new Error(`${f.name} arrived damaged (not the published file). Try again.`);
  }
  fs.renameSync(part, dest);
}
let samplesMaking = 0;
const inUse = "The local voice is in use right now (a sample or a voiceover is reading it). Wait a moment, then press Remove again.";
export function removeKokoro() {
  if (inst.status === "running") throw new Error("The local voice is still being installed.");
  if ([...jobs.values()].some((j) => j.status === "running" && j.provider === "kokoro"))
    throw new Error("The local voice is making a voiceover right now. Remove it when that is done.");
  if (samplesMaking) throw new Error(inUse);
  const d = ttsDir(),
    stamp = `.removing-${Date.now()}`,
    moved = [];
  const targets = [...KFILES.flatMap((f) => [f.name, f.name + ".part"]), "previews", "venv"]
    .map((n) => path.join(d, n))
    .filter((p) => fs.existsSync(p));
  try {
    for (const p of targets) {
      fs.renameSync(p, p + stamp);
      moved.push([p, p + stamp]);
    }
  } catch (e) {
    for (const [a, b] of moved.reverse())
      try {
        fs.renameSync(b, a);
      } catch {}
    log("kokoro remove refused", e?.code, e?.message);
    throw new Error(
      isLocked(e)
        ? inUse
        : `The local voice could not be removed: ${String(e?.message || e)
            .replace(/^[A-Z]+:\s*/, "")
            .slice(0, 160)}`,
    );
  }
  sweepRemoved();
  pkg.at = 0;
  inst = { status: "idle", step: null, received: 0, total: 0, log: [] };
  return kokoroStatus();
}
function sweepRemoved() {
  try {
    for (const n of fs.readdirSync(ttsDir()))
      if (/\.removing-\d+$/.test(n))
        try {
          fs.rmSync(path.join(ttsDir(), n), { recursive: true, force: true });
        } catch (e) {
          log("kokoro leftover not removed yet", n, e?.code);
        }
  } catch {}
}
export function kokoroPieces(s, max = KOKORO_MAX) {
  if (s.length <= max) return [{ text: s, pause: "end" }];
  const out = [];
  let cur = "";
  for (const part of s.split(/(?<=[,;:–—])\s+/)) {
    if (cur && cur.length + 1 + part.length > max) {
      out.push({ text: cur, pause: "clause" });
      cur = "";
    }
    let rest = cur ? `${cur} ${part}` : part;
    cur = "";
    while (rest.length > max) {
      const at = rest.lastIndexOf(" ", max);
      const k = at > max / 3 ? at : max;
      out.push({ text: rest.slice(0, k).trim(), pause: "word" });
      rest = rest.slice(k).trim();
    }
    cur = rest;
  }
  if (cur) out.push({ text: cur, pause: "end" });
  return out.filter((p) => p.text);
}
const KOKORO_MAX = 220;
export async function kokoroGenerate(dir, secs, v, speed, files, job, state, emit, voiceOf = NARRATOR_ONLY, pace = null) {
  const py = await kokoroPython(true);
  if (!py) throw new Error("The local voice needs its Python package: press Install in Local voice (or Settings > Media > Voiceover).");
  const paragraphs = (s) =>
    !s.runs?.some((r2) => r2.beat || voiceOf(r2.speaker))
      ? s.text.split("\n\n").map((p) => [{ text: p, voice: "", name: "" }])
      : s.runs.reduce((ps, r2) => {
          if (r2.beat) {
            (ps[ps.length - 1] ?? ps[ps.push([]) - 1]).push({ text: "", voice: "", name: "", beat: r2.beat });
            return ps;
          }
          const voice = voiceOf(r2.speaker),
            p = r2.para || !ps.length ? ps[ps.push([]) - 1] : ps[ps.length - 1],
            last2 = p.at(-1);
          if (last2 && !last2.beat && last2.voice === voice) last2.text += " " + r2.text;
          else p.push({ text: r2.text, voice, name: voice ? r2.name : "" });
          return ps;
        }, []);
  const G = pace
    ? { s: Math.max(0.1, pace.sentence - PACE_AIR), p: Math.max(0.1, pace.para - PACE_AIR), x: Math.max(0.1, pace.section - PACE_AIR) }
    : { s: 0.28, p: 0.6, x: 0.95 };
  const names = [],
    items = [];
  let lead = 0;
  secs.forEach((s, si) =>
    paragraphs(s).forEach((segs, pi, ps) =>
      segs.forEach((seg, gi) => {
        if (seg.beat) {
          const last2 = items[items.length - 1];
          if (last2) {
            last2.gap = +(last2.gap + seg.beat).toFixed(3);
            last2.beat = +((last2.beat ?? 0) + seg.beat).toFixed(3);
          } else lead += seg.beat;
          return;
        }
        const more = segs.slice(gi + 1).some((x) => !x.beat);
        sentences(seg.text).forEach((t, ti, ts) =>
          kokoroPieces(t).forEach((piece) => {
            names.push(seg.name);
            items.push({
              section: si,
              text: piece.text,
              gap: +(
                (piece.pause === "word"
                  ? 0
                  : piece.pause === "clause"
                    ? 0.1
                    : ti < ts.length - 1 || more
                      ? G.s
                      : pi < ps.length - 1
                        ? G.p
                        : si < secs.length - 1
                          ? G.x
                          : 0) / speed
              ).toFixed(3),
              ...(seg.voice ? { voice: seg.voice, lang: KLANG[seg.voice[0]]?.[1] ?? v.lang } : {}),
            });
          }),
        );
      }),
    ),
  );
  const end = items[items.length - 1];
  if (lead && items.length) items[0].pre = +lead.toFixed(3);
  if (end?.beat) end.tail = end.beat;
  const deliberate = !!pace || lead > 0 || items.some((x) => x.beat);
  const work = path.join(dir, ".suite", "tts");
  fs.mkdirSync(work, { recursive: true });
  const jobFile = path.join(work, "kokoro-job.json"),
    tmp = path.join(dir, "audio", "source.wav.incoming");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(jobFile, JSON.stringify({ voice: v.id, lang: v.lang, speed, items, ...(deliberate ? { spans: true } : {}) }));
  const t0 = Date.now();
  let cur = -1;
  const spans = [];
  const first = (sec) => items.findIndex((x) => x.section === sec),
    count = (sec) => items.filter((x) => x.section === sec).length;
  const r = await run(
    py,
    [kokoroScript(), "--model", files.model, "--voices", files.voices, "--job", jobFile, "--out", tmp],
    dir,
    (line) => {
      const m = /^ITEM (\d+) (\d+) (\d+)/.exec(line),
        sp = /^SPAN (\d+) (\d+) (\d+)/.exec(line);
      if (m) {
        const sec = +m[3];
        job.part = { done: +m[1] - 1, total: +m[2], unit: "sentence", sec: { done: +m[1] - 1 - first(sec), total: count(sec) } };
        if (sec !== cur) {
          if (cur >= 0 && job.sections[cur]) job.sections[cur].state = "done";
          cur = sec;
          if (job.sections[sec]) job.sections[sec].state = "run";
        }
        emit(job);
      } else if (sp) {
        const it = items[+sp[1] - 1];
        spans.push({ start: +sp[2], end: +sp[3], voice: it?.voice ?? "", name: names[+sp[1] - 1] ?? "" });
      } else if (!/^DONE/.test(line)) job.log.push(line);
    },
  );
  if (r.code !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, { force: true });
    if (state.cancelled) throw new Error("cancelled");
    log("kokoro failed", r.out.slice(-2e3));
    const at = job.sections[cur]?.title,
      who = names[job.part?.done ?? -1] || "";
    throw new Error(
      /No module named/.test(r.out)
        ? "The local voice needs the Python package kokoro-onnx: press Install in Local voice (or Settings > Media > Voiceover)."
        : /MemoryError|out of memory|bad_alloc/i.test(r.out)
          ? "The local voice ran out of memory. Close other programs and try again."
          : `The local voice stopped${who ? ` on ${who}'s line “${items[job.part.done].text.slice(0, 80)}”` : at ? ` while reading “${at}”` : ""}. Try again; if it stops at the same place, rephrase or shorten that part of the script. (The details are in the log: Settings > Open log.)`,
    );
  }
  const w = spans.length ? wavLayout(tmp) : null;
  if (w && spans.some((x) => x.voice)) levelVoices(dir, tmp, w.rate, w.at, spans, (l) => job.log.push(l));
  const keep =
    w && deliberate && spans.length === items.length
      ? keepOf(
          items.map((it, i) => ({
            section: it.section,
            text: it.text,
            last: false,
            beat: it.beat,
            gap: pace ? it.gap : void 0,
            lead: i ? void 0 : it.pre,
          })),
          spans,
          w.rate,
          Math.floor((fs.statSync(tmp).size - w.at) / 2),
        )
      : void 0;
  job.sections.forEach((s) => (s.state = "done"));
  emit(job);
  try {
    const secsOut = wavDuration(tmp) ?? 0;
    if (secsOut > 5) fs.writeFileSync(rtfFile(), JSON.stringify({ rtf: +(secsOut / ((Date.now() - t0) / 1e3)).toFixed(1) }));
  } catch {}
  return { tmp, ext: ".wav", keep };
}
export async function customGenerate(dir, secs, language, voice, job, state, emit, voiceOf = NARRATOR_ONLY, pace = null) {
  const { runAdapter } = await import("../images/customProviders");
  const work = path.join(dir, ".suite", "tts", "custom");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const calls = chunksOf(secs, Infinity, voiceOf, pace);
  const parts = [];
  let cost = 0;
  for (const [i, c] of calls.entries()) {
    if (state.cancelled) throw new Error("cancelled");
    job.sections[c.section].state = "run";
    job.part = { done: i, total: calls.length, unit: "section" };
    emit(job);
    const r = await runAdapter("voice", {
      text: c.text,
      language,
      voice: c.voice || voice,
      out: path.join(work, `part${String(i).padStart(3, "0")}.audio`),
    }).catch((e) => {
      throw onLine(e, c);
    });
    const f = path.join(work, `part${String(i).padStart(3, "0")}${r.ext.startsWith(".") ? r.ext : "." + r.ext}`);
    fs.renameSync(r.file, f);
    parts.push(f);
    cost += r.cost;
    if (c.last) {
      job.sections[c.section].state = "done";
      emit(job);
    }
  }
  const deliberate = !!pace || calls.some((c) => c.beat || c.lead);
  const pads = deliberate ? calls.map((c, i) => (i < calls.length - 1 ? gapAfter(c, PACE_AIR) : (c.beat ?? 0))) : void 0,
    lead = calls[0]?.lead ?? 0;
  let files = parts;
  if (lead > 0 && pads) {
    const f = path.join(work, "lead.wav"),
      n = Math.round(lead * 48e3);
    fs.writeFileSync(f, Buffer.concat([wavHeader(n * 2, 48e3), Buffer.alloc(n * 2)]));
    files = [f, ...parts];
    pads.unshift(0);
  }
  grantPaths(files);
  const made = await useRecordings(dir, files, 0.45, job, state, emit, pads);
  let keep;
  if ((calls.some((c) => c.voice) || deliberate) && made.ext === ".wav") {
    const w = wavLayout(made.tmp),
      durs = (await probeFiles(files)).map((p) => p.duration ?? 0),
      off = files.length - parts.length;
    let t = 0;
    if (w) {
      const spans = [];
      files.forEach((_, i) => {
        const c = calls[i - off];
        if (c)
          spans.push({ start: Math.round(t * w.rate), end: Math.round((t + durs[i]) * w.rate), voice: c.voice ?? "", name: c.name ?? "" });
        t += durs[i] + (pads ? pads[i] : i < files.length - 1 ? 0.45 : 0);
      });
      if (calls.some((c) => c.voice)) levelVoices(dir, made.tmp, w.rate, w.at, spans, (l) => job.log.push(l));
      if (deliberate) keep = keepOf(calls, spans, w.rate, Math.floor((fs.statSync(made.tmp).size - w.at) / 2));
    }
  }
  return { ...made, keep };
}
const PREVIEW_TEXT = {
  en: "Here is how I sound reading your script. Every word is made right here, in the app.",
  es: "Así sueno leyendo tu guion. Cada palabra se crea aquí mismo, en la aplicación.",
  fr: "Voici ma voix quand je lis votre script. Chaque mot est créé ici même, dans l’application.",
  it: "Ecco come suono leggendo il tuo copione. Ogni parola nasce qui, nell’app.",
  pt: "É assim que eu soo lendo o seu roteiro. Cada palavra é criada aqui mesmo, no aplicativo.",
  de: "So klinge ich, wenn ich dein Skript lese. Jedes Wort entsteht direkt hier, in der App.",
  nl: "Zo klink ik als ik je script voorlees. Elk woord wordt hier gemaakt, in de app.",
  pl: "Tak brzmię, czytając twój scenariusz. Każde słowo powstaje tutaj, w aplikacji.",
  sv: "Så här låter jag när jag läser ditt manus. Varje ord skapas här, i appen.",
  tr: "Senaryonu okurken sesim böyle. Her kelime burada, uygulamanın içinde oluşturuluyor.",
  hi: "नमस्ते! मैं आपकी स्क्रिप्ट को इसी तरह पढ़ती हूँ।",
  ja: "あなたの台本を読むと、こんな声になります。一つひとつの言葉が、このアプリの中で作られています。",
  ko: "제가 대본을 읽으면 이런 목소리가 나요. 모든 단어가 바로 이 앱 안에서 만들어집니다.",
  zh: "这就是我朗读你的脚本时的声音。每一个字都是在这个应用里生成的。",
  th: "นี่คือเสียงของฉันเวลาอ่านสคริปต์ของคุณ ทุกคำถูกสร้างขึ้นที่นี่ในแอปนี้",
  vi: "Đây là giọng của tôi khi đọc kịch bản của bạn. Từng chữ đều được tạo ngay tại đây, trong ứng dụng.",
  id: "Beginilah suara saya saat membaca naskah Anda. Setiap kata dibuat di sini, di dalam aplikasi.",
  ms: "Beginilah suara saya apabila membaca skrip anda. Setiap perkataan dihasilkan di sini, dalam aplikasi ini.",
};
const previewDir = () => path.join(ttsDir(), "previews");
export async function preview(o) {
  fs.mkdirSync(previewDir(), { recursive: true });
  const send = (f2, mime, paid = false) => ({ mime, data: fs.readFileSync(f2).toString("base64"), paid });
  if (o.provider === "kokoro") {
    const files = kokoroFiles();
    if (!files) throw new Error("Install the local voice first.");
    const v = kokoroVoiceList(files.voices).find((x) => x.id === o.voiceId);
    if (!v) throw new Error("Pick one of the local voices.");
    const speed = clamp(o.speed, 0.5, 2, 1),
      f2 = path.join(previewDir(), `kokoro-${v.id}-${speed.toFixed(2)}.wav`);
    const py = await kokoroPython();
    if (!py) throw new Error("The local voice needs its Python package: press Install.");
    if (!fs.existsSync(f2)) {
      samplesMaking++;
      const r = await run(
        py,
        [
          kokoroScript(),
          "--model",
          files.model,
          "--voices",
          files.voices,
          "--voice",
          v.id,
          "--lang",
          v.lang,
          "--speed",
          String(speed),
          "--say",
          PREVIEW_TEXT[v.lang.slice(0, 2)] ?? PREVIEW_TEXT.en,
          "--out",
          f2,
        ],
        os.tmpdir(),
      ).finally(() => samplesMaking--);
      if (r.code !== 0 || !fs.existsSync(f2)) {
        log("kokoro preview failed", r.out.slice(-1200));
        throw new Error(
          /No module named/.test(r.out)
            ? "The local voice needs its Python package: press Install."
            : "The local voice could not speak the sample. See the log (Settings > Open log).",
        );
      }
    }
    return send(f2, "audio/wav");
  }
  if (o.provider === "fish") {
    const s2 = fishSettings({ ...o.fish, voiceId: o.voiceId }),
      url2 = fishSampleUrl(s2.voiceId);
    if (url2) {
      const f3 = path.join(previewDir(), `fish-${s2.voiceId}.audio`);
      if (!fs.existsSync(f3)) {
        const r = await fetch(url2).catch((e) => {
          throw new Error(offline("Fish Audio (for the sample)", e));
        });
        if (!r.ok) throw new Error(`Could not download the sample (${r.status}).`);
        fs.writeFileSync(f3, Buffer.from(await r.arrayBuffer()));
        fs.writeFileSync(f3 + ".type", String(r.headers.get("content-type") || "audio/mpeg").split(";")[0]);
      }
      let mime = "audio/mpeg";
      try {
        mime = fs.readFileSync(f3 + ".type", "utf8") || mime;
      } catch {}
      return send(f3, /^audio\//.test(mime) ? mime : "audio/mpeg");
    }
    const text22 = PREVIEW_TEXT[lang(o.language).code] ?? PREVIEW_TEXT.en,
      f2 = path.join(previewDir(), `fish-${fishKey(s2, text22, lang(o.language).code)}.mp3`);
    if (!fs.existsSync(f2)) fs.writeFileSync(f2, await fishSampleWav(text22, s2));
    return send(f2, "audio/mpeg", true);
  }
  const id = String(o.voiceId || "");
  if (!/^[\w-]{1,64}$/.test(id)) throw new Error("Pick a voice first.");
  if (!voiceCache.previews.size) await elevenVoices().catch(() => null);
  const code = lang(o.language).code,
    own = code !== "en" ? voiceCache.langPreviews.get(id)?.[code] : void 0,
    url = own ?? voiceCache.previews.get(id);
  if (url) {
    const f2 = path.join(previewDir(), `el-${id}${own ? "-" + code : ""}.mp3`);
    if (!fs.existsSync(f2)) {
      const r = await fetch(url).catch((e) => {
        throw new Error(offline("ElevenLabs (for the sample)", e));
      });
      if (!r.ok) throw new Error(`Could not download the sample (${r.status}).`);
      fs.writeFileSync(f2, Buffer.from(await r.arrayBuffer()));
    }
    return send(f2, "audio/mpeg");
  }
  const s = elevenSettings({ ...o.eleven, voiceId: id }),
    text = PREVIEW_TEXT[lang(o.language).code] ?? PREVIEW_TEXT.en;
  const f = path.join(previewDir(), `el-${chunkKey(s, text)}.mp3`);
  if (!fs.existsSync(f)) {
    const k = auth();
    const r = await fetch(`${BASE()}/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": k, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: s.modelId,
        voice_settings: voiceSettings(s),
        ...(lang(o.language).code !== "en" && !NO_LANGUAGE_CODE.test(s.modelId) ? { language_code: lang(o.language).code } : {}),
      }),
    }).catch((e) => {
      throw new Error(offline("ElevenLabs", e));
    });
    if (!r.ok) {
      const t = await r.text();
      let b = t;
      try {
        b = JSON.parse(t);
      } catch {}
      throw elError(r.status, b, "make speech (Text to Speech)");
    }
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    account.at = 0;
  }
  return send(f, "audio/mpeg", true);
}
export async function estimate(dir, req) {
  const read = readScript(dir),
    secs = read.sections;
  const speed =
    req.provider === "kokoro"
      ? clamp(req.kokoro?.speed, 0.5, 2, 1)
      : req.provider === "elevenlabs"
        ? clamp(req.eleven?.speed, 0.7, 1.2, 1)
        : req.provider === "fish"
          ? clamp(req.fish?.speed, 0.7, 1.5, 1)
          : 1;
  const pacing = req.provider === "file" ? "short" : paceOf(dir, req.pace),
    pace = PACES[pacing];
  const len = spokenLength(secs, read.language, pacing, speed);
  const base = {
    sections: secs.map((s2) => ({ title: s2.title, chars: s2.text.length, words: countWords(s2.text, read.language) })),
    chars: secs.reduce((n, s2) => n + s2.text.length, 0),
    words: len.words,
    seconds: len.seconds,
    cached: 0,
    chunks: secs.length,
    credits: 0,
    reusable: 0,
    current: false,
    language: read.language,
    beats: len.beats,
    pace: pacing,
  };
  if (req.provider === "fish" && req.fish?.voiceId) {
    const s2 = fishSettings(req.fish),
      chunks2 = fishChunks(secs, voicesFor(speakerVoices(dir, "fish", req.speakers), s2.voiceId), pace),
      fresh2 = !!req.fresh,
      keys2 = chunks2.map((c) => fishKey(withVoice(s2, c), c.text, read.language));
    const reusable2 = keys2.filter((k) => fishHave(dir, k)).length,
      todo = chunks2.filter((c, i) => fresh2 || !fishHave(dir, keys2[i]));
    return {
      ...base,
      chunks: chunks2.length,
      cached: fresh2 ? 0 : reusable2,
      reusable: reusable2,
      model: FISH_MODELS.find((m) => m.id === s2.model)?.name,
      usd: +(todo.reduce((n, c) => n + Buffer.byteLength(c.text, "utf8"), 0) * FISH_PRICE).toFixed(4),
      current: reusable2 === keys2.length && isCurrent(dir, keys2),
    };
  }
  if (req.provider !== "elevenlabs" || !req.eleven?.voiceId) return base;
  const s = elevenSettings(req.eleven),
    model = (modelCache.list.length ? modelCache.list : FALLBACK_MODELS).find((m) => m.id === s.modelId);
  const chunks = chunkScript(secs, model, voicesFor(speakerVoices(dir, "elevenlabs", req.speakers), s.voiceId), pace),
    fresh = !!req.fresh;
  const keys = chunks.map((c) => chunkKey(withVoice(s, c), c.text, read.language)),
    reusable = keys.filter((k) => readMade(dir, k)).length,
    cached = fresh ? 0 : reusable;
  const credits = Math.round(
    chunks.filter((c, i) => fresh || !readMade(dir, keys[i])).reduce((n, c) => n + c.text.length, 0) * (model?.cost ?? 1),
  );
  return {
    ...base,
    cached,
    chunks: chunks.length,
    credits,
    model: model?.name,
    reusable,
    current: reusable === keys.length && isCurrent(dir, keys),
  };
}
