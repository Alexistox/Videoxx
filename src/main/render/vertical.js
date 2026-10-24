import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import { nativeImage } from "electron";
import { ws } from "../core/workspace";
import { log } from "../core/log";
import { now, q, uid } from "../db/db";
import { aspectOf, baseOf, getStyle } from "../styles/catalog";
import { cancel, encoders, ffprobeBin, probe, runFF } from "../pipeline/ffmpeg";
import { voiceNotReady } from "../pipeline/steps";
import { hostState, markDirty, renderStills } from "./workers";
import { NO_SHOTS, beginExport, renderFrames, soundtrackCopy } from "./exportVideo";
import { coverFile, refreshCover } from "./covers";
import { CARD_SECONDS, captionCards, startShot, trailerRange, verticalFile, verticalStem } from "./verticalPlan";
import { duplicateProject, getProject } from "../projects/projects";
import { writeContext } from "../agent/projectContext";
import { channelDir } from "../channels/channels";
import { projectUrl } from "../projects/fileServer";
import { CAP_H, savePng, withPainter } from "./painter";

const W = 1080,
  H = 1920,
  FPS = 30,
  MINT = "#89bea4";
const DEFAULT_HEADLINE = "Watch the full video on YouTube";
export const REFRAME_TASK = "Reframe for 9:16";
class Plain extends Error {}
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
};
const pjOf = (dir) => readJson(path.join(dir, "project.json")) || {};
function pjForWrite(dir) {
  const j = readJson(path.join(dir, "project.json"));
  if (!j || typeof j !== "object" || Array.isArray(j))
    throw new Plain(
      "This video's project.json can't be read (it may have been edited by hand), so nothing was copied or changed. Ask Claude to repair project.json, then try again.",
    );
  return j;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rmQuiet = async (f) => {
  try {
    await fs.promises.rm(f, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  } catch (e) {
    log("vertical: could not remove", f, e.message);
  }
};
function usable(row, tall) {
  return !!row && row.kind !== "personal" && fs.existsSync(row.path) && aspectOf(row.style_id, pjOf(row.path).settings) < 1 === tall;
}
function linked(link, tall) {
  if (!link || typeof link !== "object" || !link.id) return null;
  const row = q.get("SELECT * FROM projects WHERE id=?", String(link.id));
  return usable(row, tall) ? row : null;
}
function linkedTo(p, key2, tall) {
  for (const row of q.all("SELECT * FROM projects WHERE id != ? AND COALESCE(kind, 'faceless') != 'personal' ORDER BY created_at", p.id)) {
    const l = pjOf(row.path)[key2];
    if (l && typeof l === "object" && l.id === p.id && usable(row, tall)) return row;
  }
  return null;
}
export function reframeOf(projectId) {
  const p = getProject(projectId);
  return linked(pjOf(p.path).reframedAs, true) ?? linkedTo(p, "reframeOf", true);
}
function originalOf(p) {
  return linked(pjOf(p.path).reframeOf, false) ?? linkedTo(p, "reframedAs", false);
}
export const reframeState = (id) =>
  q.get("SELECT status FROM edits WHERE project_id=? AND instruction=? ORDER BY created_at DESC LIMIT 1", id, REFRAME_TASK)?.status ?? null;
const reframeable = (styleId) => {
  const st = getStyle(styleId),
    m = st.pkg?.manifest;
  if (m)
    return (
      (m.capabilities?.reframe ?? ["flat", "collage", "starter", "toon", "stickstory"].includes(baseOf(styleId))) &&
      m.aspects.includes("9:16")
    );
  return ["flat", "collage", "starter", "toon", "stickstory"].includes(baseOf(styleId)) || st.id === "vox";
};
const noReframeWhy = (styleId) => {
  const st = getStyle(styleId);
  if (st.pkg && baseOf(styleId) !== "pixel-art")
    return `${st.name} is not made to be laid out again for a tall frame. The vertical cut works well for it (crop or fit).`;
  if (baseOf(styleId) === "pixel-art") return PIXEL_REFRAME;
  return aspectOf(styleId, { format: "vertical" }) < 1
    ? `A ${st.name} video made in 16:9 can't be laid out again for a tall frame. The vertical cut works well for it (crop or fit). For a real 9:16 video, start a new ${st.name} project in Vertical 9:16.`
    : `The ${st.name} style is drawn for a 16:9 screen, so its videos can't be laid out again for a tall frame. The vertical cut works well for them (crop or fit).`;
};
export const PIXEL_REFRAME =
  "Pixel art is drawn for a 16:9 screen (its picture, HUD and cameras), so it can't be laid out again for a tall frame. The vertical cut works well for it: crop to fill keeps the pixels hard.";
function sceneStamp(dir) {
  let m = 0;
  const st = (f) => {
    try {
      m = Math.max(m, fs.statSync(f).mtimeMs);
    } catch {}
  };
  for (const f of ["project.json", "models.js", "engine.js", "character.js"]) st(path.join(dir, f));
  try {
    for (const f of fs.readdirSync(path.join(dir, "scenes"))) st(path.join(dir, "scenes", f));
  } catch {}
  return Math.round(m);
}
const stamps = new Map();
function freshen(p) {
  const s = sceneStamp(p.path);
  if (stamps.has(p.id) && stamps.get(p.id) !== s) markDirty(p.id);
  stamps.set(p.id, s);
}
export function makeReframe(projectId) {
  let m = making.get(projectId);
  if (!m) {
    m = makeReframeNow(projectId).finally(() => making.delete(projectId));
    making.set(projectId, m);
  }
  return m;
}
const making = new Map();
const CARD_FILES = /^(cover\.jpg|thumb\.png|thumbnail\.(png|jpe?g|webp))$/i;
async function makeReframeNow(projectId) {
  const p = getProject(projectId);
  if (p.kind === "personal") throw new Plain("Only Faceless videos have a 9:16 version.");
  const pj = pjForWrite(p.path);
  if (aspectOf(p.style_id, pj.settings) < 1) throw new Plain("This video is already 9:16.");
  if (!reframeable(p.style_id)) throw new Plain(noReframeWhy(p.style_id));
  const have = reframeOf(projectId);
  if (have) return getProject(have.id);
  const sib = await duplicateProject(projectId, `${p.name} (9:16)`).catch((e) => {
    log("9:16 copy failed", e?.message || e);
    throw new Plain(
      "The 9:16 copy could not be made (is the disk full, or is a file of this video open in another program?). Nothing was changed; the details are in the app log (Settings, Open log).",
    );
  });
  try {
    for (const f of fs.readdirSync(path.join(sib.path, ".suite")))
      if (CARD_FILES.test(f)) fs.rmSync(path.join(sib.path, ".suite", f), { force: true });
  } catch {}
  const sf = path.join(sib.path, "project.json"),
    sj = pjForWrite(sib.path);
  sj.settings = {
    ...(sj.settings || {}),
    format: "vertical",
    ...(baseOf(p.style_id) === "collage" ? { sheet: { ...(sj.settings?.sheet || {}), cols: 2 } } : {}),
  };
  sj.reframeOf = { id: p.id, slug: p.slug, title: pj.title || p.name };
  delete sj.reframedAs;
  fs.writeFileSync(sf, JSON.stringify(sj, null, 1));
  const oj = pjForWrite(p.path);
  oj.reframedAs = { id: sib.id, slug: sib.slug, title: sj.title || sib.name };
  fs.writeFileSync(path.join(p.path, "project.json"), JSON.stringify(oj, null, 1));
  q.run(
    "UPDATE projects SET status=?, duration=? WHERE id=?",
    (sj.scenes || []).length ? "editing" : "draft",
    sj.end || sib.duration || 0,
    sib.id,
  );
  writeContext(sib.id);
  writeContext(p.id);
  return getProject(sib.id);
}
export async function afterReframeTask(editId) {
  const e = editId ? q.get("SELECT project_id, instruction, status FROM edits WHERE id=?", editId) : null;
  if (!e || e.instruction !== REFRAME_TASK || e.status !== "done") return null;
  markDirty(e.project_id);
  return (await refreshCover(e.project_id)) ? e.project_id : null;
}
const cardDir = () => path.join(ws.root(), "endcard");
const logoFile = () => {
  try {
    const f = fs.readdirSync(cardDir()).find((x) => /^logo\.(png|jpe?g|webp)$/i.test(x));
    return f ? path.join(cardDir(), f) : null;
  } catch {
    return null;
  }
};
function channelOf(projectId) {
  try {
    const c = q.get("SELECT c.* FROM channels c JOIN projects p ON p.channel_id = c.id WHERE p.id=?", projectId);
    if (!c) return null;
    const file = c.avatar ? path.join(channelDir(c.id), path.basename(String(c.avatar))) : null;
    return {
      id: c.id,
      name: String(c.name || "").trim(),
      handle: c.handle || null,
      color: /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : null,
      avatar: file && fs.existsSync(file) ? file : null,
    };
  } catch (e) {
    log("end card: channel", e.message);
    return null;
  }
}
async function stillPng(src, dst) {
  try {
    await runFF(["-i", src, "-frames:v", "1", "-vf", "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease", dst]);
    if (nativeImage.createFromPath(dst).isEmpty()) throw new Error("not a picture after converting");
  } catch (e) {
    fs.rmSync(dst, { force: true });
    const type = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp", ".gif": "gif", ".avif": "avif" }[
      path.extname(src).toLowerCase()
    ];
    if (!type || fs.statSync(src).size > 15e6) throw e;
    const url = await withPainter((call) =>
      call(`window.czStill(${JSON.stringify(`data:image/${type};base64,${fs.readFileSync(src).toString("base64")}`)}, 1024)`),
    ).catch(() => null);
    if (!url) throw new Error(`ffmpeg: ${e.message}; Chromium can't read it either`);
    savePng(url, dst);
    if (nativeImage.createFromPath(dst).isEmpty()) {
      fs.rmSync(dst, { force: true });
      throw new Error("not a picture");
    }
  }
}
async function channelPng(ch) {
  if (!ch.avatar) return null;
  const key2 = `channel-${ch.id.replace(/[^\w-]/g, "_")}-`,
    dst = path.join(cardDir(), `${key2}${Math.round(fs.statSync(ch.avatar).mtimeMs)}.png`),
    bad = dst.replace(/\.png$/, ".bad");
  if (fs.existsSync(dst)) return dst;
  if (fs.existsSync(bad)) return null;
  fs.mkdirSync(cardDir(), { recursive: true });
  for (const f of fs.readdirSync(cardDir())) if (f.startsWith(key2)) fs.rmSync(path.join(cardDir(), f), { force: true });
  try {
    await stillPng(ch.avatar, dst);
    return dst;
  } catch (e) {
    log("channel picture unreadable for the end card", ch.avatar, e.message);
    fs.writeFileSync(bad, "");
    return null;
  }
}
async function cardLogo(projectId) {
  const ch = channelOf(projectId),
    own = ch?.avatar ? await channelPng(ch) : null;
  if (own) return { file: own, from: "channel", ch, note: null };
  const file = logoFile();
  const note = ch?.avatar
    ? `The channel's picture (${path.basename(ch.avatar)}) can't be drawn${file ? ", so your logo is used" : ""}. Give the channel a still PNG or JPG picture on the Channels page.`
    : null;
  return { file, from: file ? "logo" : null, ch, note };
}
function logoLook(f) {
  if (!f) return null;
  const img = nativeImage.createFromPath(f);
  if (img.isEmpty()) return null;
  const { width: w, height: h } = img.getSize(),
    px = img.resize({ width: Math.min(64, w), quality: "good" }).toBitmap();
  let clear = 0,
    lum = 0,
    solid = 0;
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] < 128) clear++;
    if (px[i + 3] >= 200) {
      solid++;
      lum += (px[i] + px[i + 1] + px[i + 2]) / 765;
    }
  }
  return { w, h, dark: clear / (px.length / 4) > 0.04 && solid > 0 && lum / solid > 0.62 };
}
function thumbData(f) {
  if (!f) return null;
  try {
    const img = nativeImage.createFromPath(f);
    if (!img.isEmpty()) return img.resize({ width: 256, quality: "good" }).toDataURL();
    if (fs.statSync(f).size < 3e6)
      return `data:image/${path.extname(f).slice(1).replace("jpg", "jpeg")};base64,${fs.readFileSync(f).toString("base64")}`;
  } catch {}
  return null;
}
const isWordmark = (w, h) => w > 0 && h > 0 && (w / h > 1.3 || h / w > 1.3);
async function logoShape(f) {
  if (!f) return null;
  const img = nativeImage.createFromPath(f);
  if (!img.isEmpty()) {
    const s = img.getSize();
    return { w: s.width, h: s.height };
  }
  try {
    const pr = await probe(f);
    return { w: pr.width, h: pr.height };
  } catch {
    return null;
  }
}
const BAD_LOGO = "That picture can't be used (a damaged file, or not a picture?). Pick a still PNG or JPG.";
export async function setLogo(file) {
  const old = () => (fs.existsSync(cardDir()) ? fs.readdirSync(cardDir()) : []).filter((f) => /^logo\./i.test(f));
  if (!file) {
    for (const f of old()) fs.rmSync(path.join(cardDir(), f), { force: true });
    return null;
  }
  const ext = path.extname(file).toLowerCase();
  if (!/^\.(png|jpe?g|webp)$/.test(ext) || !fs.existsSync(file)) throw new Plain("Pick a PNG, JPG or WebP picture.");
  if (fs.statSync(file).size > 15e6)
    throw new Plain("That picture is over 15 MB. Pick a smaller one (a few hundred pixels square is plenty).");
  fs.mkdirSync(cardDir(), { recursive: true });
  const tmp = path.join(cardDir(), "new-logo.png");
  try {
    await stillPng(file, tmp);
  } catch (e) {
    log("end card logo refused", file, e.message);
    throw new Plain(BAD_LOGO);
  }
  for (const f of old()) fs.rmSync(path.join(cardDir(), f), { force: true });
  const dst = path.join(cardDir(), "logo.png");
  fs.renameSync(tmp, dst);
  return thumbData(dst);
}
function cardMemory() {
  return readJson(path.join(cardDir(), "endcard.json")) || {};
}
const words = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const fromTitle = (name, title) => {
  const n = words(name),
    t = words(title);
  return !n.length || n.every((w) => t.includes(w)) || t.join("").includes(n.join(""));
};
export const HEADLINES = { trailer: DEFAULT_HEADLINE, full: "More videos on YouTube" };
const headlineFor = (length) => (length === "full" ? HEADLINES.full : HEADLINES.trailer);
const NAME_MAX = 48;
function shortTitle(t) {
  t = clean(t);
  if (t.length <= NAME_MAX) return t;
  const cut = t.slice(0, NAME_MAX - 1),
    at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("_"), cut.lastIndexOf("-"));
  return (at > NAME_MAX / 2 ? cut.slice(0, at) : cut).replace(/[\s_\-:;,.]+$/, "") + "…";
}
function cardDefaults(projectId) {
  const p = getProject(projectId),
    pj = pjOf(p.path),
    ch = channelOf(projectId),
    mem = cardMemory();
  const orig = pj.reframeOf ? originalOf(p) : null;
  const full = clean(orig ? pjOf(orig.path).title || orig.name : pj.reframeOf?.title || pj.title || p.name),
    title = shortTitle(full);
  const line2 = ch?.name || (typeof mem.line2 === "string" && mem.line2.trim() ? mem.line2 : "") || title;
  const line1 =
    typeof mem.line1 === "string" && mem.line1.trim() && !Object.values(HEADLINES).includes(mem.line1) ? String(mem.line1) : null;
  return { line1, headlines: HEADLINES, line2, title, fullTitle: full, from: ch?.name ? "channel" : line2 === title ? "title" : "memory" };
}
function rememberCard(lines, title, channel) {
  const m = cardMemory(),
    l1 = clean(lines[0] ?? ""),
    l2 = clean(lines[1] ?? "");
  if (l1 && !Object.values(HEADLINES).includes(l1)) m.line1 = l1;
  else delete m.line1;
  if (!channel && l2) {
    if (l2 === clean(title) || l2 === shortTitle(title)) delete m.line2;
    else if (!fromTitle(l2, title)) m.line2 = l2;
  }
  try {
    fs.mkdirSync(cardDir(), { recursive: true });
    fs.writeFileSync(path.join(cardDir(), "endcard.json"), JSON.stringify(m, null, 1));
  } catch (e) {
    log("end card memory", e.message);
  }
}
const wordsOf = (dir) => {
  const tl = readJson(path.join(dir, "audio", "timeline.json"));
  return Array.isArray(tl) ? tl : [];
};
const phrasesOf = (dir) =>
  wordsOf(dir).map((ph) => ({ s: ph.s, e: ph.e, words: (ph.words || []).map((w) => ({ w: w.w, s: w.s, e: w.e })) }));
export async function verticalInfo(projectId) {
  const p = getProject(projectId),
    pj = pjOf(p.path),
    base = baseOf(p.style_id),
    tall = aspectOf(p.style_id, pj.settings) < 1;
  const sib = tall ? null : reframeOf(projectId),
    ch = channelOf(projectId),
    lg = await cardLogo(projectId),
    look = logoLook(lg.file);
  const tl = wordsOf(p.path),
    cover = coverFile(p.path),
    parent = tall ? originalOf(p) : null;
  const outDir = path.join(p.path, "out");
  return {
    tall,
    style: getStyle(p.style_id).id,
    base,
    pixel: base === "pixel-art",
    end: pj.end || 0,
    title: pj.title || p.name,
    stamp: sceneStamp(p.path),
    reframeOf: parent ? { id: parent.id, name: parent.name } : null,
    reframe: {
      can: !tall && reframeable(p.style_id),
      why: tall ? null : reframeable(p.style_id) ? null : noReframeWhy(p.style_id),
      styleName: getStyle(p.style_id).name,
      project: sib
        ? {
            id: sib.id,
            name: sib.name,
            state: reframeState(sib.id),
            stamp: sceneStamp(sib.path),
            captions: ownCaptions(sib.style_id, pjOf(sib.path).settings),
          }
        : null,
    },
    // engine: the style draws captions (a 16:9 one's are left out); own: this 9:16 video shows its own (its look may have them
    // off); look: its look has them on (a 9:16 version made from it will show them)
    captions: {
      words: tl.reduce((n, ph) => n + (ph.words?.length ?? 0), 0),
      engine: base === "flat" || base === "starter" || base === "toon" || base === "stickstory",
      own: tall && ownCaptions(p.style_id, pj.settings),
      look: ownCaptions(p.style_id, pj.settings),
    },
    phrases: phrasesOf(p.path),
    channel: ch ? { name: ch.name, handle: ch.handle } : null,
    // dark: a light logo on a transparent background, shown on a dark disc; note: why the channel's picture isn't used
    picture: {
      logo: thumbData(lg.file),
      from: lg.from,
      wordmark: !!look && isWordmark(look.w, look.h),
      dark: !!look?.dark,
      note: lg.note,
      cover: cover
        ? projectUrl(projectId, ".suite/" + cover) + "?v=" + Math.round(fs.statSync(path.join(p.path, ".suite", cover)).mtimeMs)
        : null,
    },
    defaults: cardDefaults(projectId),
    saved: readJson(path.join(p.path, ".suite", "vertical.json")),
    outFiles: fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => /\.mp4$/i.test(f)) : [],
    // the dialog announces the name the export will really use
    speed: exportSpeed(projectId),
  };
}
function exportSpeed(projectId) {
  const rows = q.all(
    "SELECT seconds, message FROM renders WHERE project_id=? AND kind IN ('vertical','trailer','clip') AND status='done' AND seconds>0 ORDER BY created_at DESC LIMIT 5",
    projectId,
  );
  const r = rows
    .map((x) => +(/([\d.]+) s$/.exec(x.message || "")?.[1] ?? 0) / x.seconds)
    .filter((v) => v > 0 && isFinite(v))
    .sort((a, b) => a - b);
  return r.length ? +r[Math.floor(r.length / 2)].toFixed(3) : null;
}
export async function verticalShots(projectId, source) {
  const src = source === "reframe" ? reframeOf(projectId) : getProject(projectId);
  if (!src) return null;
  freshen(src);
  const st = await hostState(src.id),
    pj = pjOf(src.path);
  return {
    shots: (st.info?.shots ?? []).map((s) => ({ index: s.index, t0: s.t0, t1: s.t1, name: s.name || "" })),
    end: pj.end || st.info?.end || 0,
    phrases: phrasesOf(src.path),
    stamp: sceneStamp(src.path),
  };
}
export async function verticalFrames(projectId, source, times, captions = true) {
  const src = source === "reframe" ? reframeOf(projectId) : getProject(projectId);
  if (!src) return [];
  freshen(src);
  const pj = pjOf(src.path),
    wide2 = aspectOf(src.style_id, pj.settings) >= 1;
  const settings = wide2 || !captions ? withoutCaptions(src.style_id, pj.settings) : void 0;
  const batch = settings ? "vertical-nocaps" : "vertical";
  const out = await renderStills(src.id, times.slice(0, 8), 0.5, batch, settings);
  const v = Date.now();
  return out.map((o) => (o.file ? projectUrl(src.id, `.suite/frames/${batch}/` + path.basename(o.file)) + "?v=" + v : null));
}
const clean = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const ownCaptions = (styleId, settings) =>
  baseOf(styleId) === "stickstory"
    ? settings?.captions?.on === true
    : ["flat", "starter", "toon"].includes(baseOf(styleId)) && settings?.captions?.on !== false;
const withoutCaptions = (styleId, settings) =>
  ownCaptions(styleId, settings) ? { ...settings, captions: { ...(settings?.captions || {}), on: false } } : void 0;
async function paintCaptions(call, phrases, from, to, tmp, tick = () => {}, stop = () => false) {
  const cards = captionCards(phrases, from, to);
  if (!cards.length) return null;
  const dur = to - from,
    ev = [];
  for (const c of cards)
    c.words.forEach((w, i) => {
      const a = i ? w.s : Math.max(0, c.s - 0.03),
        b = Math.min(dur, c.words[i + 1]?.s ?? c.until),
        words2 = c.words.map((x) => x.w),
        gaps = c.words.map((x) => (x.ns ? 0 : 1));
      if (b - a < 0.01) return;
      if (!i && b - a > 0.2)
        [0.86, 0.93, 0.98].forEach((scale, k) => ev.push({ words: words2, gaps, active: 0, scale, a: a + k / FPS, b: a + (k + 1) / FPS }));
      ev.push({ words: words2, gaps, active: i, scale: 1, a: !i && b - a > 0.2 ? a + 3 / FPS : a, b });
    });
  const files = [];
  for (let k = 0; k < ev.length; k += 40) {
    if (stop()) throw new Error("Export cancelled");
    const urls = await call(
      `[${ev
        .slice(k, k + 40)
        .map((e) => `window.czCaption(${JSON.stringify(e.words)},${e.active},${e.scale},${JSON.stringify(e.gaps)})`)
        .join(",")}]`,
    );
    if (stop()) throw new Error("Export cancelled");
    urls.forEach((u, j) => {
      const f = `cap_${String(k + j).padStart(5, "0")}.png`;
      savePng(u, path.join(tmp, f));
      files.push(f);
    });
    tick(Math.min(1, (k + 40) / ev.length));
  }
  savePng(await call("window.czCaption([], -1, 1)"), path.join(tmp, "cap_blank.png"));
  const seq = [];
  let t = 0;
  const show2 = (f, until) => {
    if (until - t > 5e-4) {
      seq.push(`file '${f}'`, `duration ${(until - t).toFixed(4)}`);
      t = until;
    }
  };
  ev.forEach((e, k) => {
    if (e.a > t) show2("cap_blank.png", e.a);
    show2(files[k], e.b);
  });
  show2("cap_blank.png", dur + 1);
  seq.push("file 'cap_blank.png'");
  fs.writeFileSync(path.join(tmp, "captions.txt"), "ffconcat version 1.0\n" + seq.join("\n") + "\n");
  return "captions.txt";
}
const CJK = /[⺀-鿿豈-﫿＀-￯]/u;
const CJK_PIECES = /[⺀-鿿豈-﫿＀-￯]|[^⺀-鿿豈-﫿＀-￯]+/gu;
const NO_BREAK_BEFORE = /^[、。，．・：；？！ー」』）】〉》〕｝]$/u;
const wide = (s) => [...s].reduce((n, c) => n + (CJK.test(c) ? 2 : 1), 0);
function wrapLines(s, per, max) {
  const hard = Math.round(per * 1.6),
    pieces = [];
  for (const w of clean(s).split(" ").filter(Boolean)) {
    const parts = [];
    if (CJK.test(w)) {
      for (const seg of w.match(CJK_PIECES) ?? [w]) {
        if (NO_BREAK_BEFORE.test(seg) && parts.length) parts[parts.length - 1].t += seg;
        else parts.push({ t: seg, j: "" });
      }
      parts[parts.length - 1].j = " ";
      pieces.push(...parts);
      continue;
    }
    for (const seg of w.length > per ? w.split(/(?<=[/.\-_])(?=.)|(?=@)/).filter(Boolean) : [w]) {
      if (seg.length <= hard) {
        parts.push({ t: seg, j: "" });
        continue;
      }
      const n = Math.ceil(seg.length / per),
        size = Math.ceil(seg.length / n);
      for (let k = 0; k < seg.length; k += size) parts.push({ t: seg.slice(k, k + size), j: k + size < seg.length ? "-" : "" });
    }
    parts[parts.length - 1].j = " ";
    pieces.push(...parts);
  }
  if (!pieces.length) return [];
  const line = (a, b) =>
    pieces
      .slice(a, b)
      .map((p, i, l) => p.t + (i < l.length - 1 ? (p.j === " " ? " " : "") : p.j === "-" ? "-" : ""))
      .join("");
  let best = [line(0, pieces.length)],
    bestScore = Infinity;
  for (let n = 1; n <= Math.min(max, pieces.length); n++) {
    let nb = null,
      nl = Infinity,
      ni = Infinity,
      nr = Infinity;
    const go = (i, left, starts) => {
      if (left === 1) {
        const st = [...starts, i],
          ls = st.map((c, k) => line(c, st[k + 1] ?? pieces.length)),
          long = Math.max(...ls.map(wide));
        const inner = st.slice(1).filter((c) => pieces[c - 1].j === "-" || (pieces[c - 1].j === "" && !CJK.test(pieces[c - 1].t))).length,
          ragged = ls.reduce((s2, x) => s2 + (long - wide(x)) ** 2, 0);
        if (long < nl || (long === nl && (inner < ni || (inner === ni && ragged < nr)))) {
          nl = long;
          ni = inner;
          nr = ragged;
          nb = ls;
        }
        return;
      }
      for (let k = i + 1; k <= pieces.length - left + 1; k++) go(k, left - 1, [...starts, i]);
    };
    if (pieces.length <= 90) go(0, n, []);
    else if (n === 1) {
      nb = [line(0, pieces.length)];
      nl = wide(nb[0]);
      ni = 0;
    }
    const score = Math.max(nl, per) + ni * 1.5;
    if (nb && score < bestScore - 0.01) {
      bestScore = score;
      best = nb;
    }
  }
  return best;
}
async function makeBadge(tmp, src, kind, ring, tallCover) {
  const out = path.join(tmp, "badge.png"),
    rgb = (e) => `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${e}'`;
  if (kind === "logo") {
    const look = logoLook(src),
      shape = look ?? (await logoShape(src)),
      a = shape ? shape.w / shape.h : 1;
    const R = 148,
      bw = Math.round((2 * R * a) / Math.hypot(a, 1) / 2) * 2,
      bh = Math.max(2, Math.round(bw / a / 2) * 2);
    const back = look?.dark ? "0x1d2024" : "0xf4f4f2";
    const img =
      shape && isWordmark(shape.w, shape.h)
        ? `scale=${bw}:${bh}:flags=lanczos,format=rgba[lg];color=c=${back}:s=340x340,format=rgba[wb];[wb][lg]overlay=(W-w)/2:(H-h)/2:format=auto,format=rgba[img]`
        : `scale=340:340:force_original_aspect_ratio=increase,crop=340:340,format=rgba[lg];color=c=${back}:s=340x340,format=rgba[wb];[wb][lg]overlay=format=auto,format=rgba[img]`;
    await runFF([
      "-i",
      src,
      "-filter_complex",
      `[0:v]${img};[img]${rgb("255*clip(170.5-hypot(X-169.5,Y-169.5),0,1)")}[av];color=c=0x${ring.slice(1)}:s=364x364,format=rgba,${rgb("255*clip(182.5-hypot(X-181.5,Y-181.5),0,1)")}[ring];color=c=black:s=484x484,format=rgba,geq=r=0:g=0:b=0:a='170*clip(182-hypot(X-241.5,Y-258.5),0,1)',gblur=sigma=16[sh];[sh][ring]overlay=60:60[r1];[r1][av]overlay=72:72`,
      "-frames:v",
      "1",
      out,
    ]);
    return { file: out, kind, w: 364, h: 364, pad: 60 };
  }
  const [w, h] = tallCover ? [324, 576] : [720, 405],
    r = 26,
    cw = w + 100,
    chh = h + 100;
  const box = (cx, cy) => `clip(${r + 0.5}-hypot(max(0,abs(X-${cx})-${w / 2 - r}),max(0,abs(Y-${cy})-${h / 2 - r})),0,1)`;
  await runFF([
    "-i",
    src,
    "-filter_complex",
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=rgba,${rgb("255*" + box((w - 1) / 2, (h - 1) / 2))}[img];color=c=black:s=${cw}x${chh},format=rgba,geq=r=0:g=0:b=0:a='160*${box((cw - 1) / 2, (chh - 1) / 2 + 14)}',gblur=sigma=18[sh];[sh][img]overlay=50:50`,
    "-frames:v",
    "1",
    out,
  ]);
  return { file: out, kind, w, h, pad: 50 };
}
const pictureFrames = new Map();
async function captionlessFrame(p) {
  const pj = pjOf(p.path),
    stamp = sceneStamp(p.path),
    had = pictureFrames.get(p.id);
  if (had && had.stamp === stamp && fs.existsSync(had.file)) return had.file;
  const [s] = await renderStills(
    p.id,
    [Math.min((pj.end || 0) * 0.3, 20)],
    0.5,
    "card-picture",
    withoutCaptions(p.style_id, pj.settings),
  ).catch(() => [{ file: "" }]);
  if (s.file) pictureFrames.set(p.id, { stamp, file: s.file });
  return s.file || null;
}
async function cardPicture(projectId, srcId, card, end) {
  const lg = card.picture === "logo" ? await cardLogo(projectId) : null;
  if (lg?.file) return { file: lg.file, kind: "logo", ring: lg.ch?.color ?? MINT, tall: false };
  const p = getProject(projectId),
    c = coverFile(p.path);
  let file = c && /^thumbnail\./i.test(c) ? path.join(p.path, ".suite", c) : null;
  if (!file && ownCaptions(p.style_id, pjOf(p.path).settings)) file = await captionlessFrame(p);
  if (!file && c) file = path.join(p.path, ".suite", c);
  if (!file) {
    const [s] = await renderStills(srcId, [Math.min(end * 0.3, 20)], 0.5, "card").catch(() => [{ file: "" }]);
    file = s.file || null;
  }
  if (!file) return null;
  const img = nativeImage.createFromPath(file),
    sz = img.isEmpty() ? null : img.getSize();
  return { file, kind: "cover", ring: MINT, tall: !!sz && sz.height > sz.width };
}
async function paintCard(call, projectId, srcId, card, end, tmp) {
  const pc = await cardPicture(projectId, srcId, card, end);
  const badge = pc
    ? await makeBadge(tmp, pc.file, pc.kind, pc.ring, pc.tall).catch((e) => {
        log("end card picture failed", pc.file, e.message);
        if (pc.kind === "logo")
          throw new Plain(
            `The end card's logo can't be drawn (${path.basename(pc.file)}). Choose another one (a still PNG or JPG), or use the video picture.`,
          );
        return null;
      })
    : null;
  const r = await call(
    `window.czCard(${JSON.stringify(wrapLines(card.lines[0] ?? "", 16, 3))},${JSON.stringify(wrapLines(card.lines[1] ?? "", 24, 2))},${JSON.stringify(
      badge ? { kind: badge.kind, h: badge.h } : null,
    )},${JSON.stringify(pc?.ring ?? MINT)})`,
  );
  const layers = [
    ["play", 0.2, 0],
    ["head", 0.3, 40],
    ["bar", 0.55, 0],
    ["name", 0.75, 24],
  ]
    .filter(([k]) => r[k])
    .map(([k, at, rise]) => {
      const file = path.join(tmp, `card_${k}.png`);
      savePng(r[k], file);
      return { file, at, rise };
    });
  return { badge, picTop: r.picTop, layers };
}
function cardChain(inLabel, c, picIn, layerIn, outLabel) {
  const NC = Math.round(CARD_SECONDS * FPS),
    ease = (at, d) => `pow(1-min(max((t-${at})/${d}\\,0)\\,1)\\,3)`;
  let g = `[${inLabel}]scale=135:240,gblur=sigma=8:steps=4,scale=${W}:${H}:flags=bicubic,eq=brightness=-0.26:contrast=0.85:saturation=1.2,vignette=angle=PI/3.4,zoompan=z='1+0.05*on/${NC}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},format=yuv420p[cbg];`;
  let cur = "cbg";
  if (c.badge && picIn != null) {
    g += `[${picIn}:v]format=rgba,fade=t=in:st=0.1:d=0.4:alpha=1[cpic];[${cur}][cpic]overlay=x=(W-w)/2:y='${c.picTop - c.badge.pad}+46*${ease(0.1, 0.55)}':shortest=1[cp];`;
    cur = "cp";
  }
  c.layers.forEach((l, k) => {
    g += `[${layerIn[k]}:v]format=rgba,fade=t=in:st=${l.at}:d=0.3:alpha=1[cl${k}];[${cur}][cl${k}]overlay=x=0:y='${l.rise}*${ease(l.at, 0.45)}':shortest=1[cw${k}];`;
    cur = `cw${k}`;
  });
  return g + `[${cur}]format=yuv420p,setsar=1[${outLabel}]`;
}
const loopIn = (file) => ["-loop", "1", "-framerate", String(FPS), "-t", String(CARD_SECONDS), "-i", file];
const NO_BACKGROUND = "That frame of the video has an error, so the card has no background. Fix the shot first.";
export async function endCardPreview(projectId, o) {
  const src = o.source === "reframe" ? (reframeOf(projectId) ?? getProject(projectId)) : getProject(projectId),
    spj = pjOf(src.path),
    end = spj.end || 0;
  if (src.id !== projectId) freshen(src);
  const sd = path.join(getProject(projectId).path, ".suite");
  fs.mkdirSync(sd, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(sd, "card-"));
  try {
    const tall = aspectOf(src.style_id, spj.settings) < 1,
      settings = !tall || o.captions === false ? withoutCaptions(src.style_id, spj.settings) : void 0;
    const clean2 = typeof o.to === "number" && o.to < end - 0.05 ? { to: o.to } : void 0;
    const [still] = await renderStills(src.id, [clamp(o.t, 0, Math.max(0, end - 0.05))], 0.5, "card", settings, clean2).catch(() => [
      { file: "" },
    ]);
    if (!still.file) throw new Plain(NO_BACKGROUND);
    const c = await withPainter((call) => paintCard(call, projectId, src.id, o.card, end, tmp));
    const out = path.join(tmp, "card.jpg"),
      inputs = [...loopIn(still.file), ...(c.badge ? loopIn(c.badge.file) : []), ...c.layers.flatMap((l) => loopIn(l.file))];
    const first = c.badge ? 2 : 1;
    await runFF([
      ...inputs,
      "-filter_complex",
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[still];` +
        cardChain(
          "still",
          c,
          c.badge ? 1 : null,
          c.layers.map((_, k) => first + k),
          "card",
        ) +
        ";[card]scale=540:960[v]",
      "-map",
      "[v]",
      "-update",
      "1",
      "-q:v",
      "3",
      out,
    ]);
    return "data:image/jpeg;base64," + fs.readFileSync(out).toString("base64");
  } catch (e) {
    if (e instanceof Plain) throw e;
    log("end card preview failed", e?.message || e);
    throw new Plain("The end card could not be drawn. The details are in the app log (Settings, Open log).");
  } finally {
    await rmQuiet(tmp);
  }
}
function tallChain(kind, x, pixel) {
  if (kind === "crop")
    return `crop=w=trunc(ih*9/32+0.5)*2:h=ih:x=trunc((iw-ow)*${clamp(x, 0, 1).toFixed(4)}):y=0,scale=${W}:${H}:flags=${pixel ? "neighbor" : "lanczos,unsharp=5:5:0.4"}`;
  if (kind === "blur")
    return `split=2[xa][xb];[xa]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=6,scale=${W}:${H}:flags=bicubic,eq=brightness=-0.1:saturation=1.15[xbg];[xb]scale=${pixel ? "960:540:flags=neighbor" : `${W}:-2:flags=lanczos`}[xfg];[xbg][xfg]overlay=(W-w)/2:(H-h)/2`;
  return `scale=${W}:${H}:flags=lanczos`;
}
const frameCount = (f) =>
  new Promise((res) =>
    cp.execFile(
      ffprobeBin(),
      ["-v", "error", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", f],
      { windowsHide: true, timeout: 12e4 },
      (e, out) => res(e ? 0 : parseInt(String(out).trim(), 10) || 0),
    ),
  );
const FF_FAILED =
  "ffmpeg could not make the vertical video. The details are in the app log (Settings, Open log); Copy diagnostics there to ask for help.";
function plainError(e, step, other) {
  const raw = String(e?.message || e);
  if (
    e instanceof Plain ||
    /^(ffmpeg not found|The preview renderer stopped responding|A scene stopped responding|Drawing the text took too long)/.test(raw)
  )
    return raw;
  if (raw === NO_SHOTS)
    return other ? `${other} has no shots to render: its scenes failed to load. Open it and fix the error it shows first.` : raw;
  if (/^ffmpeg failed/.test(raw) || step === "encode") return FF_FAILED;
  if (step === "save")
    return "The finished video could not be saved in the out folder (is the disk full, or is a file there open in another program?). The details are in the app log (Settings, Open log).";
  if (step === "draw") return "The captions or the end card could not be drawn. The details are in the app log (Settings, Open log).";
  if (/^Preview failed to load/.test(raw))
    return other
      ? `The scenes of ${other} failed to load, so it can't be exported. Open it and fix the error it shows first.`
      : "The video's scenes failed to load, so it can't be exported. Fix the error the editor shows first.";
  return other
    ? `A scene of ${other} threw an error while it was rendering, so it could not be exported. Open ${other} and fix it there first (its preview marks the shot); the details are in the app log.`
    : "A scene threw an error while the video was rendering, so it could not be exported. Fix it in the editor first (the preview marks the shot); the details are in the app log.";
}
export async function exportVertical(projectId, o, onProgress) {
  const p = getProject(projectId),
    pj = pjOf(p.path),
    tall = aspectOf(p.style_id, pj.settings) < 1;
  if (p.kind === "personal") throw new Plain("Vertical export is for Faceless videos.");
  let src = p,
    spj = pj;
  if (o.source === "reframe" && !tall) {
    const sib = reframeOf(projectId);
    if (!sib) throw new Plain("This video has no 9:16 version yet. Make it first (Reframed version), or use the vertical cut.");
    if (reframeState(sib.id) === "running")
      throw new Plain("Claude is still laying out the 9:16 version. Export it once that is finished.");
    src = sib;
    spj = pjOf(sib.path);
    freshen(sib);
  }
  const native = src !== p || tall,
    base = baseOf(src.style_id),
    pixel = base === "pixel-art",
    end = spj.end || 0;
  if (!end) throw new Plain("This video has no length yet. Add the voiceover and time the words first.");
  const notReady = voiceNotReady(src.path, "video");
  if (notReady) throw new Plain(notReady);
  const phrases = wordsOf(src.path);
  const cardOn = !!o.endCard?.on,
    lines = [0, 1].map((k) => clean(String(o.endCard?.lines?.[k] ?? "")));
  const card = { on: cardOn, lines, picture: o.endCard?.picture === "logo" ? "logo" : "cover" };
  const { job, stopped, end: done } = beginExport(projectId, src !== p ? [src.id] : []);
  const ffj = { proc: null, cancelled: false };
  job.kill = () => cancel(ffj);
  const ff = (args, opt = {}) => Promise.race([runFF(args, { ...opt, job: ffj }), stopped]);
  const id = uid("ren_"),
    t0 = Date.now(),
    tmp = path.join(p.path, ".suite", "vertical", id),
    part = path.join(tmp, "video.mp4");
  const h264 = path.join(src.path, "out", `vtmp_${id}.h264`);
  const ffGone = async () => {
    for (let i = 0; i < 100 && ffj.proc; i++) await new Promise((r) => setTimeout(r, 50));
  };
  let step = "frames",
    listed = false;
  try {
    let from = 0,
      to = end;
    if (o.length === "trailer") {
      const shots = (await Promise.race([hostState(src.id), stopped])).info?.shots ?? [];
      if (!shots.length)
        throw new Plain(
          "A trailer is cut from the shots, and this video has none yet (or its scenes failed to load). Build the video, or fix the error the editor shows, first.",
        );
      ({ from, to } = trailerRange(shots, startShot(shots, o.start, o.startAt), o.max || 60, cardOn, end, phrases));
    } else if (o.length === "range") {
      const r2 = Array.isArray(o.range) ? o.range.map(Number) : [];
      if (r2.length !== 2 || !r2.every((v) => isFinite(v))) throw new Plain("Select a part of the timeline first, then export it.");
      from = clamp(Math.min(r2[0], r2[1]), 0, end);
      to = clamp(Math.max(r2[0], r2[1]), 0, end);
    }
    const dur = to - from;
    if (dur < 1) throw new Plain("That range is too short for a video.");
    const kind = o.length === "trailer" ? "trailer" : o.length === "range" ? "clip" : "vertical",
      stem = verticalStem(o.name);
    const own = native && ownCaptions(src.style_id, spj.settings),
      burn = !!o.captions && !own && phrases.length > 0;
    const fill = native ? "native" : o.fit === "blur" ? "blur" : "crop";
    const def = cardDefaults(projectId),
      head = def.line1 ?? headlineFor(o.length);
    try {
      fs.mkdirSync(path.join(p.path, ".suite"), { recursive: true });
      fs.writeFileSync(
        path.join(p.path, ".suite", "vertical.json"),
        JSON.stringify(
          {
            ...o,
            name: stem,
            endCard: { ...card, lines: [lines[0] === head ? null : lines[0], lines[1] === def.line2 ? null : lines[1]] },
          },
          null,
          1,
        ),
      );
    } catch {}
    q.run(
      "INSERT INTO renders(id,project_id,kind,status,progress,created_at) VALUES(?,?,?,?,?,?)",
      id,
      projectId,
      kind,
      "running",
      0,
      now(),
    );
    listed = true;
    const notes = [];
    const wDraw = burn || cardOn ? 0.1 : 0,
      wFrames = 0.6,
      wMake = 1 - wFrames - wDraw;
    const report2 = (pct, p2) => {
      onProgress({ ...p2, pct });
      q.run("UPDATE renders SET progress=? WHERE id=?", pct, id);
    };
    fs.mkdirSync(tmp, { recursive: true });
    const mix = soundtrackCopy(src.path, path.join(tmp, "soundtrack.wav"));
    const settings = !native || !o.captions ? withoutCaptions(src.style_id, spj.settings) : void 0;
    const clean2 = from > 0.01 || to < end - 0.01 ? { ...(from > 0.01 ? { from } : {}), ...(to < end - 0.01 ? { to } : {}) } : void 0;
    const r = await renderFrames(
      src.id,
      { job, stopped },
      { name: `vtmp_${id}`, fps: FPS, from, to, settings, requireShots: true, clean: clean2 },
      (f, n22, rate) => report2((wFrames * f) / Math.max(1, n22), { frame: f, frames: n22, fps: rate }),
    );
    const drawPhase = `Drawing ${[burn ? "the captions" : "", cardOn ? "the end card" : ""].filter(Boolean).join(" and ")}`;
    step = "draw";
    if (wDraw) report2(wFrames, { frame: 0, frames: 1, fps: 0, phase: drawPhase });
    const nf = (await frameCount(h264)) || r.frames,
      NC = Math.round(CARD_SECONDS * FPS),
      capY = fill === "blur" ? 1440 : 1340;
    const painting =
      burn || cardOn
        ? withPainter(
            async (call) => ({
              caps: burn
                ? await paintCaptions(
                    call,
                    phrases,
                    from,
                    to,
                    tmp,
                    (f) => report2(wFrames + wDraw * 0.9 * f, { frame: 0, frames: 1, fps: 0, phase: drawPhase }),
                    () => job.cancelled,
                  )
                : null,
              card: cardOn ? await paintCard(call, projectId, src.id, card, end, tmp) : null,
            }),
            // (the letters it will draw: Japanese, Korean, Chinese, Thai or Hindi ones load the bundled fonts' pieces they need)
            [...(burn ? phrases.map((ph) => ph.text ?? "") : []), ...(cardOn ? lines.map((l) => l ?? "") : [])].join("\n"),
            spj.language,
          )
        : Promise.resolve({ caps: null, card: null });
    painting.catch(() => {});
    const drawn = await Promise.race([painting, stopped]);
    const { caps, card: card2 } = drawn;
    if (burn && !caps) notes.push("No words are spoken in this part, so it has no captions.");
    const makePhase = "Making it vertical";
    step = "encode";
    report2(wFrames + wDraw, { frame: 0, frames: 1, fps: 0, phase: makePhase });
    if (!mix) notes.push("This video has no voiceover yet (no audio/clean.wav), so the export is silent.");
    const inputs = [
      "-r",
      String(FPS),
      "-i",
      h264,
      ...(mix
        ? ["-ss", from.toFixed(3), "-t", dur.toFixed(3), "-i", mix]
        : ["-f", "lavfi", "-t", dur.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"]),
    ];
    let n = 2;
    const next = (...a) => {
      inputs.push(...a);
      return n++;
    };
    const capIn = caps ? next("-f", "concat", "-safe", "0", "-i", caps) : -1;
    const picIn = card2?.badge ? next(...loopIn(card2.badge.file)) : null;
    const layerIn = (card2?.layers ?? []).map((l) => next(...loopIn(l.file)));
    const cardAudio = card2
      ? next(
          "-f",
          "lavfi",
          "-t",
          String(CARD_SECONDS),
          "-i",
          "aevalsrc='0.18*sin(2*PI*(520+700*exp(-38*t))*t)*exp(-16*t)*gte(t,0.1)':s=48000",
        )
      : -1;
    const A = `aformat=sample_rates=48000:channel_layouts=stereo`,
      fade = card2 || o.length !== "full" ? `,afade=t=out:st=${Math.max(0, dur - 0.35).toFixed(3)}:d=0.35` : "";
    let g =
      `[0:v]setpts=PTS-STARTPTS,${tallChain(fill, o.x ?? 0.5, pixel)},setsar=1,format=yuv420p${card2 ? ",split=2[vb][vl]" : "[vb]"};` +
      (caps
        ? `[${capIn}:v]format=rgba[capv];[vb][capv]overlay=x=0:y=${capY - CAP_H / 2}:eof_action=pass:format=auto,format=yuv420p[body];`
        : "[vb]null[body];") +
      `[1:a]${A},apad,atrim=0:${dur.toFixed(3)}${fade}[ab];`;
    if (card2)
      g +=
        `[vl]trim=start_frame=${Math.max(0, nf - 1)}:end_frame=${Math.max(1, nf)},setpts=PTS-STARTPTS,loop=loop=${NC - 1}:size=1:start=0,setpts=N/${FPS}/TB[last];` +
        cardChain("last", card2, picIn, layerIn, "card") +
        `;[${cardAudio}:a]${A}[ac];[body][ab][card][ac]concat=n=2:v=1:a=1[v][a]`;
    else g += "[body]null[v];[ab]anull[a]";
    const total = dur + (card2 ? CARD_SECONDS : 0);
    const enc = await encoders(),
      testCpu = process.env.CZ_TEST_HOOKS === "1" && !!o.cpu;
    const cap = ["-maxrate", "8M", "-bufsize", "16M"];
    const encode = (vargs) =>
      ff(
        [
          ...inputs,
          "-filter_complex",
          g,
          "-map",
          "[v]",
          "-map",
          "[a]",
          ...vargs,
          ...cap,
          "-pix_fmt",
          "yuv420p",
          "-r",
          String(FPS),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-ar",
          "48000",
          "-movflags",
          "+faststart",
          part,
        ],
        {
          cwd: tmp,
          duration: total,
          onProgress: (k, speed) =>
            report2(wFrames + wDraw + wMake * k, {
              frame: Math.round(k * total * FPS),
              frames: Math.round(total * FPS),
              fps: 0,
              phase: makePhase,
              left: speed > 0 ? ((1 - k) * total) / speed : void 0,
            }),
        },
      );
    const cpu = ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-profile:v", "high"];
    if (enc.gpu && !testCpu)
      await encode(enc.h264).catch((e) => {
        if (job.cancelled) throw e;
        log("vertical: GPU encode failed, using x264", e.message);
        return encode(cpu);
      });
    else await encode(cpu);
    step = "save";
    const outDir = path.join(p.path, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(
      outDir,
      verticalFile(stem, kind, (f) => fs.existsSync(path.join(outDir, f))),
    );
    fs.renameSync(part, out);
    const secs = (Date.now() - t0) / 1e3;
    const what = [
      native
        ? src !== p
          ? "Reframed 9:16 version"
          : "9:16"
        : fill === "blur"
          ? "Fit with blurred background"
          : `Crop to fill (${Math.round((o.x ?? 0.5) * 100)} % across)`,
      o.length === "trailer"
        ? `trailer ${from.toFixed(1)}-${to.toFixed(1)} s`
        : o.length === "range"
          ? `the part ${from.toFixed(1)}-${to.toFixed(1)} s`
          : "full length",
      ...(caps || (own && o.captions) ? ["captions"] : []),
      ...(card2 ? ["end card"] : []),
      ...(mix ? [] : ["no sound"]),
      `${total.toFixed(1)} s`,
    ].join(" · ");
    q.run(
      "UPDATE renders SET status=?, progress=1, path=?, seconds=?, message=?, finished_at=? WHERE id=?",
      "done",
      out,
      secs,
      what,
      now(),
      id,
    );
    if (card2) rememberCard(lines, def.fullTitle, !!channelOf(projectId));
    return {
      id,
      path: out,
      seconds: secs,
      duration: total,
      from,
      to,
      frames: nf,
      notes,
      realtime: +(total / Math.max(1e-3, secs)).toFixed(2),
    };
  } catch (e) {
    if (job.cancelled) {
      if (listed) q.run("UPDATE renders SET status=?, message=?, finished_at=? WHERE id=?", "cancelled", "Cancelled", now(), id);
      throw new Plain("Export cancelled");
    }
    if (!listed) {
      if (e instanceof Plain) throw e;
      log("vertical export could not start", e?.message || e);
      throw new Plain("The vertical export could not start. The details are in the app log (Settings, Open log).");
    }
    log("vertical export failed", step, e?.message || e);
    const gone = [src, p].find((x) => !fs.existsSync(path.join(x.path, "project.json")));
    const msg = gone
      ? `The files of ${gone.name} were deleted or moved while it was being exported, so the export stopped.`
      : plainError(e, step, src !== p ? src.name : void 0);
    q.run("UPDATE renders SET status=?, message=?, finished_at=? WHERE id=?", "failed", msg, now(), id);
    throw new Plain(msg);
  } finally {
    done();
    await ffGone();
    await rmQuiet(h264);
    await rmQuiet(tmp);
    setTimeout(() => {
      if (fs.existsSync(h264)) rmQuiet(h264);
    }, 3e3);
  }
}
export function sweepLeftovers() {
  let n = 0;
  for (const p of q.all("SELECT path FROM projects")) {
    try {
      for (const f of fs.readdirSync(path.join(p.path, "out")))
        if (/^vtmp_ren_[0-9a-f]+\.h264$/i.test(f)) {
          fs.rmSync(path.join(p.path, "out", f), { force: true });
          n++;
        }
    } catch {}
    const v = path.join(p.path, ".suite", "vertical");
    try {
      if (fs.existsSync(v)) {
        fs.rmSync(v, { recursive: true, force: true });
        n++;
      }
    } catch (e) {
      log("vertical leftovers", v, e.message);
    }
  }
  return n;
}
