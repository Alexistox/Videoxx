import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import { nativeImage } from "electron";
import { getConfig } from "../core/config";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";
import { encodePng } from "../images/png";
import { notifyStudio, requireStudio, setActivity } from "./stages";
import { findTranscriber } from "../voice/speechSetup";
import { fmtTime, listRefs } from "../projects/references";
import { projectUrl } from "../projects/fileServer";

const SCENE = 0.3,
  SPIKE_MIN = 0.12,
  SPIKE_X = 3.5,
  MERGE = 0.3,
  PER_SHEET = 24,
  STRIP_FPS = 12,
  MAX_WHOLE = 600,
  MAX_STRIPS = 60,
  POOL = 4,
  NEAR = 0.15,
  GAP = 0.25;
const statsFile = (dir) => path.join(dir, "reference", "stats.json");
const rel = (dir, f) => path.relative(dir, f).split(path.sep).join("/");
const r2 = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
const ffBin = () => getConfig().tools.ffmpeg || "ffmpeg";
function ffRun(args, o = {}) {
  const ms = o.ms ?? 12e4;
  return new Promise((res, rej) => {
    const p = cp.spawn(ffBin(), ["-hide_banner", "-nostdin", "-nostats", "-y", "-v", o.info ? "info" : "error", ...args], {
      windowsHide: true,
      cwd: o.cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    o.job?.procs.add(p);
    let tail = "",
      all = "",
      buf = "";
    p.stderr.on("data", (d) => {
      const s = String(d);
      tail = (tail + s).slice(-4e3);
      if (o.onLine) {
        buf += s;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          o.onLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      } else if (all.length < 2e6) all += s;
    });
    const timer = setTimeout(() => {
      try {
        p.kill();
      } catch {}
      rej(new Error(`ffmpeg took too long (over ${Math.round(ms / 1e3)} s)`));
    }, ms);
    p.on("error", (e) => {
      clearTimeout(timer);
      o.job?.procs.delete(p);
      rej(
        new Error(
          /ENOENT/.test(String(e))
            ? "ffmpeg is not installed (or not on PATH): set it in Settings > System > Tool paths."
            : String(e.message),
        ),
      );
    });
    p.on("close", (c) => {
      clearTimeout(timer);
      o.job?.procs.delete(p);
      if (buf && o.onLine) o.onLine(buf);
      c === 0 ? res(all) : rej(new Error("ffmpeg failed: " + tail.trim().split("\n").slice(-2).join(" ").slice(-300)));
    });
  });
}
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}
const quant = (sorted, q) => {
  if (!sorted.length) return 0;
  const x = (sorted.length - 1) * q,
    lo = Math.floor(x),
    hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
};
function dist(v) {
  const s = [...v].sort((a, b) => a - b);
  return {
    count: s.length,
    mean: r2(s.reduce((a, b) => a + b, 0) / (s.length || 1)),
    median: r2(quant(s, 0.5)),
    p10: r2(quant(s, 0.1)),
    p90: r2(quant(s, 0.9)),
  };
}
function cutsFrom(scores, len) {
  const out = [];
  for (let i = 0; i < scores.length; i++) {
    const { t, s } = scores[i];
    if (t <= MERGE || t >= len - 0.05 || s < SPIKE_MIN) continue;
    let hit = s >= SCENE;
    if (!hit) {
      const win = [...scores.slice(Math.max(0, i - 12), i), ...scores.slice(i + 1, i + 13)].map((x) => x.s).sort((a, b) => a - b);
      hit = s >= SPIKE_X * Math.max(win[Math.floor(win.length / 2)] ?? 0, 0.02);
    }
    if (hit && t - (out[out.length - 1] ?? 0) > MERGE) out.push(r2(t, 3));
  }
  return out;
}
let bgra = null;
const isBgra = () =>
  (bgra ??= (() => {
    const px = nativeImage.createFromBuffer(encodePng({ data: Buffer.from([255, 0, 0, 255]), w: 1, h: 1 })).toBitmap();
    return px[2] > 200 && px[0] < 50;
  })());
const hexOf = (c) =>
  "#" +
  c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
function pixelsOf(file, w) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize(),
    small = width >= height ? img.resize({ width: 48, quality: "good" }) : img.resize({ height: 48, quality: "good" });
  const bmp = small.toBitmap(),
    [ri, bi] = isBgra() ? [2, 0] : [0, 2],
    n = bmp.length / 4,
    px = [];
  let L = 0,
    dark = 0;
  const m = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const r = bmp[i * 4 + ri],
      g = bmp[i * 4 + 1],
      b = bmp[i * 4 + bi],
      l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    L += l;
    if (l < 0.15) dark++;
    m[0] += r;
    m[1] += g;
    m[2] += b;
    px.push({ r, g, b, w: w / n });
  }
  return { px, luma: n ? L / n : 0, dark: n ? dark / n : 0, mean: m.map((v) => (n ? v / n : 0)) };
}
const MERGE_RGB = 22;
function kmeans(pts, k, total = pts.reduce((a, p) => a + p.w, 0)) {
  if (!pts.length || !(total > 0)) return [];
  let seed = 625341585;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const d2 = (p, c) => (p.r - c[0]) ** 2 + (p.g - c[1]) ** 2 + (p.b - c[2]) ** 2;
  const pickBy = (ws) => {
    const s = ws.reduce((a, b) => a + b, 0);
    let x = rnd() * s;
    for (let i = 0; i < ws.length; i++) {
      x -= ws[i];
      if (x <= 0) return i;
    }
    return ws.length - 1;
  };
  const C = [],
    first = pts[pickBy(pts.map((p) => p.w))];
  C.push([first.r, first.g, first.b]);
  while (C.length < Math.min(k, pts.length)) {
    const p = pts[pickBy(pts.map((q) => q.w * Math.min(...C.map((c) => d2(q, c)))))];
    C.push([p.r, p.g, p.b]);
  }
  const lab = new Int32Array(pts.length);
  for (let it = 0; it < 14; it++) {
    const S = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let best = 0,
        bd = Infinity;
      for (let j = 0; j < C.length; j++) {
        const d = d2(pts[i], C[j]);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      lab[i] = best;
      const p = pts[i],
        s = S[best];
      s[0] += p.r * p.w;
      s[1] += p.g * p.w;
      s[2] += p.b * p.w;
      s[3] += p.w;
    }
    for (let j = 0; j < C.length; j++) if (S[j][3] > 0) C[j] = [S[j][0] / S[j][3], S[j][1] / S[j][3], S[j][2] / S[j][3]];
  }
  const W = C.map(() => 0);
  for (let i = 0; i < pts.length; i++) W[lab[i]] += pts[i].w;
  let cl = C.map((c, j) => ({ c, w: W[j] }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w);
  for (let a = 0; a < cl.length; a++)
    for (let b = cl.length - 1; b > a; b--)
      if (Math.sqrt(d2({ r: cl[a].c[0], g: cl[a].c[1], b: cl[a].c[2] }, cl[b].c)) < MERGE_RGB) {
        const w = cl[a].w + cl[b].w;
        cl[a].c = cl[a].c.map((v, i) => (v * cl[a].w + cl[b].c[i] * cl[b].w) / w);
        cl[a].w = w;
        cl.splice(b, 1);
      }
  cl = cl.sort((a, b) => b.w - a.w);
  return cl.map((x) => ({ hex: hexOf(x.c), share: r2(x.w / total, 3) })).filter((x) => x.share >= 5e-3);
}
const saturated = (p) => {
  const mx = Math.max(p.r, p.g, p.b),
    mn = Math.min(p.r, p.g, p.b);
  return mx > 60 && (mx - mn) / mx > 0.4;
};
function paletteOf(px) {
  const total = px.reduce((a, p) => a + p.w, 0);
  return {
    palette: kmeans(px, 8, total),
    accents: kmeans(px.filter(saturated), 5, total)
      .filter((x) => x.share < 0.25)
      .slice(0, 4),
  };
}
function transcribe(wav, outDir, job, language) {
  const tr = findTranscriber(language);
  if (!tr) return Promise.reject(new Error("no transcriber"));
  return new Promise((res, rej) => {
    const c = cp.spawn(tr.python, [tr.script, wav, "--out", outDir, ...tr.args], {
      windowsHide: true,
      cwd: outDir,
      stdio: ["ignore", "ignore", "pipe"],
    });
    job.procs.add(c);
    let err = "";
    c.stderr.on("data", (d) => {
      err = (err + d).slice(-3e3);
    });
    const kill = setTimeout(() => {
      try {
        c.kill();
      } catch {}
    }, 6e5);
    c.on("error", (e) => {
      clearTimeout(kill);
      job.procs.delete(c);
      rej(e);
    });
    c.on("close", (code) => {
      clearTimeout(kill);
      job.procs.delete(c);
      const jf = path.join(outDir, path.basename(wav, path.extname(wav)) + ".json");
      if (code !== 0 || !fs.existsSync(jf))
        return rej(
          new Error(`the transcriber (${tr.label}) exited ${code}${err ? `: ${err.trim().split("\n").slice(-1)[0].slice(0, 200)}` : ""}`),
        );
      try {
        const j = JSON.parse(fs.readFileSync(jf, "utf8")),
          words = (Array.isArray(j.words) ? j.words : [])
            .filter((w) => typeof w?.word === "string" && w.end >= w.start && w.start >= 0)
            .map((w) => ({ word: w.word, start: +w.start, end: +w.end }));
        res({ words, text: typeof j.text === "string" ? j.text : words.map((w) => w.word).join(" "), by: tr.label });
      } catch (e) {
        rej(new Error("its json could not be read: " + e.message));
      }
    });
  });
}
function speechStats(words, cuts, len, text, by) {
  const ws = [...words].sort((a, b) => a.start - b.start);
  const gaps = [];
  for (let i = 1; i < ws.length; i++) {
    const g = ws[i].start - ws[i - 1].end;
    if (g >= GAP) gaps.push(g);
  }
  const talk = ws.length ? Math.max(1, ws[ws.length - 1].end - ws[0].start - gaps.filter((g) => g > 1).reduce((a, b) => a + b, 0)) : 0;
  const near = (t) => ws.some((w) => Math.abs(w.start - t) <= NEAR);
  let cover = 0,
    at = -Infinity;
  for (const w of ws) {
    const a = Math.max(0, w.start - NEAR, at),
      b = Math.min(len, w.start + NEAR);
    if (b > a) {
      cover += b - a;
      at = b;
    }
  }
  const gd = dist(gaps);
  return {
    words: ws.length,
    wpm: r2(ws.length / (len / 60), 1),
    talkWpm: talk ? r2(ws.length / (talk / 60), 1) : 0,
    gaps: { count: gaps.length, perMin: r2(gaps.length / (len / 60), 1), median: gd.median, p90: gd.p90 },
    cutsOnWords: cuts.length && ws.length ? r2(cuts.filter(near).length / cuts.length, 3) : null,
    chance: ws.length && len ? r2(cover / len, 3) : null,
    transcript: text.slice(0, 4e3),
    by,
  };
}
const progress = new Map();
let lastTick = 0;
function tick(pid, what, done = 0, total = 0, force = false) {
  progress.set(pid, { what, done, total });
  const now = Date.now();
  if (!force && now - lastTick < 400) return;
  lastTick = now;
  setActivity(pid, `study: ${what}${total ? ` ${done}/${total}` : ""}`);
}
async function studyRange(pid, dir, ref, rg, k, nRanges, job, language, fontOk) {
  const t0 = Date.now(),
    file = ref.path,
    s = rg.start,
    len = r2(rg.end - rg.start, 3),
    notes = [];
  const key2 = nRanges > 1 ? `${ref.tag}_r${k + 1}` : ref.tag,
    label = `${ref.tag}${nRanges > 1 ? ` part ${k + 1}` : ""}`;
  const work = path.join(dir, ".suite", "studio", "study", key2);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const W = ref.probe?.width || 1920,
    H = ref.probe?.height || 1080,
    portrait = H > W;
  const seek = ["-ss", s.toFixed(3), "-t", len.toFixed(3), "-i", file];
  tick(pid, `${label} cuts`, 0, 0, true);
  const scores = [];
  let lastT = -1;
  await ffRun(
    [
      ...seek,
      "-map",
      "0:v:0",
      "-an",
      "-sn",
      "-vf",
      "scale=256:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score",
      "-f",
      "null",
      "-",
    ],
    {
      job,
      info: true,
      ms: 12e4 + len * 1500,
      onLine: (l) => {
        const m = /pts_time:([\d.]+)/.exec(l);
        if (m) lastT = +m[1];
        else {
          const q = /scene_score=([\d.]+)/.exec(l);
          if (q && lastT >= 0) scores.push({ t: lastT, s: +q[1] });
        }
      },
    },
  );
  if (!scores.length) throw new Error(`no video frames could be read in ${fmtTime(s)}-${fmtTime(rg.end)}`);
  const t00 = scores[0].t;
  if (t00 > 0 && t00 < 0.5) for (const x of scores) x.t -= t00;
  const cuts = cutsFrom(scores, len),
    starts = [0, ...cuts],
    lens = starts.map((a, i) => r2((starts[i + 1] ?? len) - a, 3));
  const shotsDir = path.join(dir, "reference", "shots"),
    sheetsDir = path.join(dir, "reference", "sheets");
  if (fontOk.v)
    try {
      fs.copyFileSync(
        path.join(templatesDir(), "skill", "intro-edit", "assets", "fonts", "Inter-Medium.ttf"),
        path.join(work, "label.ttf"),
      );
    } catch {
      fontOk.v = false;
    }
  const tileVf = portrait ? "scale=-2:320" : "scale=320:-2";
  const shots = starts.map((a, i) => ({
    i,
    start: r2(s + a, 3),
    len: lens[i],
    frame: rel(dir, path.join(shotsDir, `${key2}_s${String(i + 1).padStart(3, "0")}.jpg`)),
    motion: null,
    luma: 0,
    dark: 0,
    hex: "",
  }));
  let n = 0;
  tick(pid, `${label} frames`, 0, shots.length, true);
  await pool(shots, POOL, async (sh, i) => {
    const at = (sh.start + Math.min(0.4, sh.len / 2)).toFixed(3),
      out = path.join(dir, sh.frame),
      tile = path.join(work, `t_${String(i).padStart(4, "0")}.jpg`);
    fs.writeFileSync(path.join(work, `l_${i}.txt`), `#${i + 1}  ${fmtTime(sh.start)}  ${sh.len.toFixed(1)} s`);
    const draw = fontOk.v
      ? `,drawtext=fontfile=label.ttf:textfile=l_${i}.txt:x=6:y=6:fontsize=15:fontcolor=yellow:box=1:boxcolor=black@0.6:boxborderw=4`
      : "";
    const run = (lbl) =>
      ffRun(
        [
          "-ss",
          at,
          "-i",
          file,
          "-filter_complex",
          `[0:v]split=2[a][b];[a]scale='min(640,iw)':-2[o1];[b]${tileVf}${lbl}[o2]`,
          "-map",
          "[o1]",
          "-frames:v",
          "1",
          "-q:v",
          "3",
          out,
          "-map",
          "[o2]",
          "-frames:v",
          "1",
          "-q:v",
          "4",
          path.basename(tile),
        ],
        { job, cwd: work, ms: 6e4 },
      );
    try {
      await run(draw);
    } catch (e) {
      if (!draw) throw e;
      fontOk.v = false;
      await run("");
    }
    tick(pid, `${label} frames`, ++n, shots.length);
  });
  if (!fontOk.v) notes.push("The contact sheets have no labels (this ffmpeg has no drawtext): the shots are in order, left to right.");
  const sheets = [],
    cols = portrait ? 8 : 4;
  for (let a = 0, k2 = 0; a < shots.length; a += PER_SHEET, k2++) {
    const cnt = Math.min(PER_SHEET, shots.length - a),
      out = path.join(sheetsDir, `${key2}_${String(k2 + 1).padStart(2, "0")}.jpg`);
    const c = Math.min(cols, cnt),
      rows = Math.ceil(cnt / c);
    await ffRun(
      [
        "-framerate",
        "1",
        "-start_number",
        String(a),
        "-i",
        "t_%04d.jpg",
        "-frames:v",
        "1",
        "-vf",
        `tile=${c}x${rows}:padding=4:color=0x202020`,
        "-q:v",
        "3",
        out,
      ],
      { job, cwd: work, ms: 6e4 },
    );
    sheets.push({ file: rel(dir, out), from: a + 1, to: a + cnt });
  }
  const step = Math.max(1, shots.length / MAX_STRIPS),
    pick = new Set();
  for (let x = 0; x < shots.length; x += step) pick.add(Math.floor(x));
  const strips = shots.filter((sh) => pick.has(sh.i) && sh.len >= 0.25);
  n = 0;
  await pool(strips, POOL, async (sh) => {
    const dur = Math.min(1, sh.len - 0.05),
      cnt = Math.max(3, Math.min(STRIP_FPS, Math.round(dur * STRIP_FPS))),
      out = path.join(shotsDir, `${key2}_s${String(sh.i + 1).padStart(3, "0")}_motion.jpg`);
    try {
      await ffRun(
        [
          "-ss",
          (sh.start + 0.02).toFixed(3),
          "-t",
          dur.toFixed(3),
          "-i",
          file,
          "-frames:v",
          "1",
          "-vf",
          `fps=${STRIP_FPS},scale=${portrait ? "-2:160" : "-2:90"},tile=${cnt}x1:padding=2:color=0x202020`,
          "-q:v",
          "4",
          out,
        ],
        { job, ms: 6e4 },
      );
      sh.motion = rel(dir, out);
    } catch (e) {
      log("study strip", key2, sh.i, e?.message);
    }
    tick(pid, `${label} motion`, ++n, strips.length);
  });
  tick(pid, `${label} colours`, 0, 0, true);
  const all = [];
  let L = 0,
    D = 0;
  for (const sh of shots) {
    const p = pixelsOf(path.join(dir, sh.frame), sh.len);
    if (!p) continue;
    all.push(...p.px);
    sh.luma = r2(p.luma, 3);
    sh.dark = r2(p.dark, 3);
    sh.hex = hexOf(p.mean);
    L += p.luma * sh.len;
    D += p.dark * sh.len;
  }
  const { palette, accents } = paletteOf(all);
  let audio = null;
  if (ref.probe?.hasAudio) {
    tick(pid, `${label} loudness`, 0, 0, true);
    try {
      const e = await ffRun([...seek, "-map", "0:a:0", "-vn", "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"], {
        job,
        info: true,
        ms: 6e4 + len * 500,
      });
      const sum = e.slice(e.lastIndexOf("Summary:")),
        num = (re) => {
          const m = re.exec(sum);
          return m ? (m[1] === "-inf" ? -120 : +m[1]) : null;
        };
      const lufs = num(/I:\s+(-?[\d.]+|-inf) LUFS/),
        lra = num(/LRA:\s+(-?[\d.]+) LU/),
        tp = num(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
      const silenceDb = Math.round(Math.max(-60, Math.min(-30, (lufs ?? -40) - 20)));
      const sd = await ffRun([...seek, "-map", "0:a:0", "-vn", "-af", `silencedetect=noise=${silenceDb}dB:d=${GAP}`, "-f", "null", "-"], {
        job,
        info: true,
        ms: 6e4 + len * 500,
      });
      const list = [];
      let open = null;
      for (const l of sd.split("\n")) {
        const a = /silence_start: (-?[\d.]+)/.exec(l),
          b = /silence_end: (-?[\d.]+)/.exec(l);
        if (a) open = Math.max(0, +a[1]);
        if (b && open != null) {
          list.push([r2(open), r2(Math.min(len, +b[1]))]);
          open = null;
        }
      }
      if (open != null && len - open >= GAP) list.push([r2(open), r2(len)]);
      const ds = dist(list.map(([a, b]) => b - a));
      audio = {
        lufs,
        lra,
        tp,
        silenceDb,
        pauses: {
          count: list.length,
          perMin: r2(list.length / (len / 60), 1),
          total: r2(list.reduce((a, [x, y]) => a + y - x, 0)),
          median: ds.median,
          p90: ds.p90,
          list: list.slice(0, 60),
        },
      };
      if (lufs != null && lufs <= -70) notes.push("The sound of this range is silent.");
    } catch (e) {
      notes.push(`Loudness could not be measured: ${e?.message || e}`);
    }
  } else notes.push("This video has no sound: loudness, pauses and words were skipped.");
  let speech = null;
  if (ref.probe?.hasAudio) {
    const tr = findTranscriber(language);
    if (!tr)
      notes.push(
        "No transcriber on this computer, so words per minute and where cuts land on the words were skipped (the Speech setup in Settings installs one; then Measure again).",
      );
    else if (len > 1800) notes.push("Words were skipped: the range is over 30 minutes (pick a shorter part in References).");
    else {
      tick(pid, `${label} words`, 0, 0, true);
      try {
        const wav = path.join(work, "speech.wav");
        await ffRun([...seek, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", wav], { job, ms: 12e4 });
        const t = await transcribe(wav, work, job, language);
        speech = speechStats(t.words, cuts, len, t.text, t.by);
        if (!t.words.length) notes.push(`${t.by} heard no words in this range.`);
      } catch (e) {
        notes.push(`Words were skipped: ${e?.message || e}`);
      }
    }
  }
  fs.rmSync(work, { recursive: true, force: true });
  return {
    id: rg.id,
    label: rg.label,
    start: r2(s, 3),
    end: r2(rg.end, 3),
    len,
    width: W,
    height: H,
    shots,
    cuts: { count: cuts.length, perMin: r2(cuts.length / (len / 60), 1), times: cuts },
    shotLen: dist(lens),
    sheets,
    palette,
    accents,
    light: { luma: r2(L / (len || 1), 3), dark: r2(D / (len || 1), 3) },
    audio,
    speech,
    notes,
    ms: Date.now() - t0,
  };
}
async function studyImage(pid, dir, ref, job) {
  tick(pid, `${ref.tag} colours`, 0, 0, true);
  const out = path.join(dir, "reference", "shots", `${ref.tag}.jpg`);
  await ffRun(["-i", ref.path, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", out], { job, ms: 6e4 });
  const p = pixelsOf(out, 1);
  if (!p) throw new Error("the picture could not be read");
  const { palette, accents } = paletteOf(p.px);
  return {
    width: ref.probe?.width ?? nativeImage.createFromPath(out).getSize().width,
    height: ref.probe?.height ?? nativeImage.createFromPath(out).getSize().height,
    file: rel(dir, out),
    palette,
    accents,
    light: { luma: r2(p.luma, 3), dark: r2(p.dark, 3) },
  };
}
function rangesOf(ref) {
  const dur = ref.probe?.duration ?? 0;
  if (ref.ranges.length)
    return ref.ranges
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        start: r.start,
        end: Math.min(r.end, dur || r.end),
        label: r.label || `${fmtTime(r.start)}-${fmtTime(r.end)}`,
      }));
  return [
    {
      id: "whole",
      start: 0,
      end: Math.min(dur || MAX_WHOLE, MAX_WHOLE),
      label: dur > MAX_WHOLE ? `the first ${fmtTime(MAX_WHOLE)}` : "the whole video",
    },
  ];
}
const studied = (refs) => refs.filter((r) => r.exists && (r.kind === "video" || r.kind === "image"));
function sigOf(refs) {
  return (
    studied(refs)
      .map((r) => `${r.id}|${r.path}|${r.probe?.mtime}|${r.probe?.size}|${r.ranges.map((x) => `${x.start}-${x.end}`).join(",")}`)
      .join(";") + `|t${findTranscriber() ? 1 : 0}`
  );
}
function readStudy(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(statsFile(dir), "utf8"));
    return j?.schema === 1 ? j : null;
  } catch {
    return null;
  }
}
const running = new Map();
export const studyBusy = (projectId) => running.has(projectId);
export function runStudy(projectId) {
  const have = running.get(projectId);
  if (have) return have;
  const p = (async () => {
    const { dir } = requireStudio(projectId),
      t0 = Date.now(),
      job = { procs: new Set() };
    const refs = await listRefs(projectId),
      list = studied(refs),
      notes = [];
    for (const r of refs)
      if (r.missing) notes.push(`${r.tag} is missing (${r.path}): relink it in References.`);
      else if (r.kind !== "video" && r.kind !== "image") notes.push(`${r.tag} (${r.kind}) is not measured: only pictures and videos are.`);
    if (!list.length) {
      try {
        fs.rmSync(statsFile(dir), { force: true });
      } catch {}
      return null;
    }
    let language = null;
    try {
      language = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")).language ?? null;
    } catch {}
    for (const d of ["sheets", "shots"]) {
      fs.rmSync(path.join(dir, "reference", d), { recursive: true, force: true });
      fs.mkdirSync(path.join(dir, "reference", d), { recursive: true });
    }
    const gi = path.join(dir, "reference", ".gitignore");
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, "sheets/\nshots/\n");
    const out = [],
      fontOk = { v: true };
    for (const ref of list) {
      const r = { id: ref.id, tag: ref.tag, kind: ref.kind, name: ref.name, path: ref.path, notes: [] };
      try {
        if (ref.kind === "image") r.image = await studyImage(projectId, dir, ref, job);
        else {
          const rs = rangesOf(ref);
          r.ranges = [];
          if (!ref.ranges.length && (ref.probe?.duration ?? 0) > MAX_WHOLE)
            r.notes.push(`No parts picked: the first ${fmtTime(MAX_WHOLE)} were studied (Pick parts in References chooses others).`);
          for (let k = 0; k < rs.length; k++)
            r.ranges.push(await studyRange(projectId, dir, ref, rs[k], k, rs.length, job, language, fontOk));
        }
      } catch (e) {
        r.error = String(e?.message || e);
        log("studio study", ref.tag, r.error);
      }
      out.push(r);
    }
    const ranges = out.flatMap((r) => r.ranges ?? []),
      secs = ranges.reduce((a, x) => a + x.len, 0),
      allLens = ranges.flatMap((x) => x.shots.map((s) => s.len));
    const med = allLens.length ? dist(allLens).median : 3,
      px = [];
    for (const r of out) {
      for (const x of r.ranges ?? [])
        for (const sh of x.shots) {
          const p2 = pixelsOf(path.join(dir, sh.frame), sh.len);
          if (p2) px.push(...p2.px);
        }
      if (r.image) {
        const p2 = pixelsOf(path.join(dir, r.image.file), med);
        if (p2) px.push(...p2.px);
      }
    }
    const withSound = ranges.filter((x) => x.audio?.lufs != null && x.audio.lufs > -70),
      withWords = ranges.filter((x) => x.speech);
    const cutsTotal = ranges.reduce((a, x) => a + x.cuts.count, 0),
      onWords = withWords.filter((x) => x.speech.cutsOnWords != null);
    const stats = {
      schema: 1,
      at: new Date().toISOString(),
      ms: Date.now() - t0,
      sig: sigOf(refs),
      transcriber: findTranscriber(language)?.label ?? null,
      refs: out,
      summary: {
        videos: out.filter((r) => r.ranges?.length).length,
        images: out.filter((r) => r.image).length,
        seconds: r2(secs, 1),
        shots: allLens.length,
        cutsPerMin: secs ? r2(cutsTotal / (secs / 60), 1) : null,
        shotLen: allLens.length ? dist(allLens) : null,
        palette: kmeans(px, 8),
        lufs: withSound.length
          ? r2(withSound.reduce((a, x) => a + x.audio.lufs * x.len, 0) / withSound.reduce((a, x) => a + x.len, 0), 1)
          : null,
        wpm: withWords.length
          ? r2(withWords.reduce((a, x) => a + x.speech.words, 0) / (withWords.reduce((a, x) => a + x.len, 0) / 60), 1)
          : null,
        cutsOnWords: onWords.length
          ? r2(
              onWords.reduce((a, x) => a + x.speech.cutsOnWords * x.cuts.count, 0) / (onWords.reduce((a, x) => a + x.cuts.count, 0) || 1),
              3,
            )
          : null,
      },
      notes,
    };
    fs.writeFileSync(statsFile(dir), JSON.stringify(stats, null, 1));
    log("studio study", projectId, `${out.length} refs, ${allLens.length} shots, ${Math.round(stats.ms / 100) / 10} s`);
    return stats;
  })().finally(() => {
    running.delete(projectId);
    progress.delete(projectId);
    setActivity(projectId, null);
    notifyStudio(projectId);
  });
  running.set(projectId, p);
  notifyStudio(projectId);
  return p;
}
export async function studyStale(projectId) {
  const { dir } = requireStudio(projectId),
    refs = await listRefs(projectId);
  if (!studied(refs).length) return false;
  return readStudy(dir)?.sig !== sigOf(refs);
}
export async function studyView(projectId) {
  const { dir } = requireStudio(projectId),
    stats = readStudy(dir),
    v = stats ? `?v=${Date.parse(stats.at) || 0}` : "";
  const url = (f) => (f ? projectUrl(projectId, f.split("/").map(encodeURIComponent).join("/")) + v : null);
  let analysis = null;
  try {
    analysis = fs.readFileSync(path.join(dir, "reference", "ANALYSIS.md"), "utf8");
  } catch {}
  const refs = await listRefs(projectId);
  return {
    stats: stats
      ? {
          ...stats,
          refs: stats.refs.map((r) => ({
            ...r,
            image: r.image ? { ...r.image, url: url(r.image.file) } : void 0,
            ranges: r.ranges?.map((x) => ({
              ...x,
              sheets: x.sheets.map((s) => ({ ...s, url: url(s.file) })),
              shots: x.shots.map((s) => ({ ...s, url: url(s.frame), motionUrl: url(s.motion) })),
            })),
          })),
        }
      : null,
    stale: stats ? stats.sig !== sigOf(refs) : studied(refs).length > 0,
    running: studyBusy(projectId),
    progress: progress.get(projectId) ?? null,
    measurable: studied(refs).length,
    refs: refs.length,
    transcriber: findTranscriber()?.label ?? null,
    analysis,
  };
}
const pct = (v) => (v == null ? "?" : `${Math.round(v * 100)}%`);
const sw = (l, n = 6) =>
  l
    .slice(0, n)
    .map((x) => `${x.hex} ${pct(x.share)}`)
    .join(", ") || "none";
export function studyBlock(dir) {
  const s = readStudy(dir);
  if (!s) return "";
  const lines = [
    `APP STUDY (measured by the app ${s.at.slice(0, 16).replace("T", " ")}, in ${Math.round(s.ms / 1e3)} s; the numbers are in reference/stats.json - use them, don't re-estimate them):`,
  ];
  for (const r of s.refs) {
    if (r.error) {
      lines.push(`- ${r.tag} (${r.name}): could not be measured (${r.error}).`);
      continue;
    }
    if (r.image)
      lines.push(
        `- ${r.tag} picture ${r.image.width}x${r.image.height}: palette ${sw(r.image.palette)}; accents ${sw(r.image.accents, 4)}; light ${r.image.light.luma}, dark share ${pct(r.image.light.dark)}. Frame: ${r.image.file}.`,
      );
    for (const x of r.ranges ?? []) {
      const a = x.audio,
        sp = x.speech;
      lines.push(
        `- ${r.tag} ${fmtTime(x.start)}-${fmtTime(x.end)} (${x.len} s, ${x.width}x${x.height}): ${x.shots.length} shots, ${x.cuts.perMin} cuts/min, shot length median ${x.shotLen.median} s (mean ${x.shotLen.mean}, p10 ${x.shotLen.p10}, p90 ${x.shotLen.p90}); palette ${sw(x.palette)}; accents ${sw(x.accents, 4)}; light ${x.light.luma}, dark share ${pct(x.light.dark)}` +
          (a
            ? `; loudness ${a.lufs ?? "?"} LUFS, range ${a.lra ?? "?"} LU, true peak ${a.tp ?? "?"} dBFS; ${a.pauses.count} pauses >= ${GAP} s under ${a.silenceDb} dB (median ${a.pauses.median} s)`
            : "") +
          (sp
            ? `; ${sp.wpm} words/min (${sp.talkWpm} while talking), ${sp.gaps.count} gaps between words (median ${sp.gaps.median} s); ${pct(sp.cutsOnWords)} of cuts within ${NEAR} s of a word start (chance ${pct(sp.chance)})`
            : "") +
          ".",
        `  contact sheets: ${x.sheets.map((q) => `${q.file} (shots ${q.from}-${q.to})`).join(", ")}; per shot: reference/shots/<frame>.jpg and <frame>_motion.jpg (12 fps, first second).`,
      );
      for (const n of x.notes) lines.push(`  note: ${n}`);
    }
    for (const n of r.notes) lines.push(`  note: ${n}`);
  }
  for (const n of s.notes) lines.push(`note: ${n}`);
  return lines.join("\n");
}
