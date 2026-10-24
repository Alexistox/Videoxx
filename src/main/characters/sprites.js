import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { nativeImage } from "electron";
import { templatesDir, ws } from "../core/workspace";
import { bgraToRgba, encodePng, shrink } from "../images/png";
import { generatePicture } from "../images/providers";

const readJson$d = (f, d = null) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return d;
  }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 1));
};
const STARTER = () => path.join(templatesDir(), "stickman", "sprites");
const starterOf = (dir) => (fs.existsSync(path.join(dir, "sprites", "index.json")) ? path.join(dir, "sprites") : STARTER());
export const libRoot = () => path.join(ws.root(), "stickman", "sprites");
const projRoot = (dir) => path.join(dir, "assets", "sprites");
const ALIAS = { walk2: "walk", run2: "run", talkL: "talk", waveL: "wave" };
export const keyOf = (pose, e, hold = "", hold2 = "", xl = false) => {
  pose = ALIAS[pose] || pose;
  const it = [hold, hold2].filter((h) => h && h !== "-");
  return xl ? "XL-" + e : [pose, e, ...it].join("-");
};
export const ANIMALS = {
  emu: {
    look: "a cartoon emu (big shaggy dark brown body, long grey-brown neck, small head, long grey legs), side view facing right",
    v: {},
  },
  goat: { look: "a cartoon white goat with small grey curved horns and a little beard, side view facing right", v: {} },
  mammoth: { look: "a cartoon woolly mammoth (shaggy brown fur, curved white tusks, trunk), side view facing right", v: {} },
  horse: { look: "a cartoon brown horse, side view facing right", v: {} },
  cow: { look: "a cartoon black-and-white cow, side view facing right", v: {} },
  dog: { look: "a cartoon brown dog, side view facing right", v: {} },
  dino: { look: "a cartoon green T-rex dinosaur, side view facing right", v: {} },
};
const VARIANT = {
  stand: "standing calmly",
  angry: "standing, angry eyebrows",
  happy: "standing, happy smiling eyes",
  sad: "standing, sad droopy eyes",
  run: "running fast to the right, legs mid-stride, motion lines behind",
  helmet: "standing, wearing a small grey army helmet, angry eyebrows",
  crown: "standing proudly, wearing a small gold crown, happy eyes",
  dance: "jumping happily in the air, happy eyes",
  scared: "standing, terrified wide eyes",
  eat: "eating with its head down",
};
const animalKey = (name, o) =>
  o.v || (o.run ? "run" : o.helmet ? "helmet" : o.crown ? "crown" : name === "goat" && o.rot ? "dance" : o.e || "stand");
function tokens(line) {
  const out = [];
  const re = /(\w+)="([^"]*)"|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ? `${m[1]}=${m[2]}` : m[3] !== void 0 ? `"${m[3]}"` : m[4]);
  return out;
}
const kv = (list) =>
  Object.fromEntries(list.filter((x) => /^\w+=/.test(x)).map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
export function needs(dir) {
  const pj = readJson$d(path.join(dir, "project.json"), {}) || {};
  const cast = {},
    uses = {};
  const add = (who, key2) => (uses[who] ??= new Set()).add(key2);
  for (const m of pj.scenes || []) {
    const src = (() => {
      try {
        return fs.readFileSync(path.join(dir, "scenes", `${m}.js`), "utf8");
      } catch {
        return "";
      }
    })();
    for (const block of src.matchAll(/script\(\s*`([\s\S]*?)`\s*\)/g))
      for (const raw of block[1].split(/\r?\n/)) {
        const line = raw.replace(/\s+#.*$/, "").trim();
        if (!line || line.startsWith("#") || line.startsWith(">")) continue;
        let t = tokens(line);
        if (t[0]?.startsWith("@")) t = t.slice(1);
        if (t[0] === "cast" && t[1]) {
          cast[t[1]] = kv(t.slice(2));
          continue;
        }
        const o = kv(t.slice(1));
        if (cast[t[0]]) {
          const c = { ...cast[t[0]], ...o };
          add(t[0], keyOf(c.pose || "stand", c.e || "neutral", c.hold || "", c.hold2 || "", c.size === "XL"));
        } else if (ANIMALS[t[0]]) add(t[0], animalKey(t[0], o));
      }
  }
  return { cast, uses };
}
const POSE = {
  stand: "standing upright facing the viewer, arms relaxed at the sides",
  talk: "standing facing the viewer, one hand raised palm-up as if explaining",
  talk2: "standing facing the viewer, both hands out as if explaining",
  shrug: "standing facing the viewer, shrugging with both palms up at shoulder height",
  present: "standing facing the viewer, presenting with both arms open wide",
  pointR: "standing facing the viewer, pointing to the RIGHT side of the picture with one straight arm",
  pointL: "standing facing the viewer, pointing to the LEFT side of the picture with one straight arm",
  pointUp: "standing facing the viewer, pointing straight up with one arm",
  wave: "standing facing the viewer, waving one hand above the head",
  cheer: "standing facing the viewer, cheering with both arms raised in a V",
  scared: "standing facing the viewer, both hands raised beside the head in fright",
  hips: "standing facing the viewer with both hands on the hips",
  think: "standing facing the viewer, one hand on the chin, thinking",
  facepalm: "standing facing the viewer, one hand covering the face (facepalm)",
  crossarms: "standing facing the viewer with arms crossed on the chest",
  pray: "standing facing the viewer, hands together praying",
  fight: "standing facing the viewer, fists up ready to fight",
  shiver: "standing facing the viewer, hugging himself and shivering, knees together",
  holdup: "standing facing the viewer, holding {item} up high above the head with both hands",
  sit: "sitting on a small rock facing the viewer",
  crosslegged: "sitting cross-legged on the ground facing the viewer",
  dance: "dancing happily, one arm up, one leg kicked out",
  sstand: "side view facing right, standing",
  stalk: "side view facing right, talking with one hand raised",
  walk: "side view, walking to the right, mid-stride",
  run: "side view, running fast to the right",
  spoint: "side view facing right, pointing forward with one straight arm",
  offer: "side view facing right, holding out {item} at arm's length",
  carry: "side view facing right, carrying {item} in both arms",
  push: "side view facing right, pushing hard with both arms forward",
  pull: "side view facing right, leaning back pulling a rope",
  throw: "side view facing right, throwing something forward with one arm",
  dig: "side view facing right, digging into the ground with {item}",
  kneel: "side view facing right, kneeling on one knee",
  crouch: "side view facing right, crouching low on one knee",
  kneelpray: "side view facing right, kneeling and praying with hands together",
  sitchair: "side view facing right, sitting on a small plain wooden stool, knees bent",
  sitground: "side view facing right, sitting on the ground hugging the knees",
  lie: "lying flat on the back, seen from the side, head on the left",
  fall: "falling backwards off balance, arms flailing",
  jump: "jumping in the air, arms up",
  bow: "side view facing right, bowing deeply",
  sneak: "side view facing right, sneaking on tiptoes, bent forward",
  swave: "side view facing right, waving one hand",
  sscared: "side view facing right, leaning back in fright with both hands raised",
  ride: "side view facing right, sitting astride as if riding",
};
const FACE = {
  neutral: "calm neutral face",
  talk: "talking, mouth open",
  smile: "small smile",
  happy: "big happy open smile",
  shock: "shocked: huge round eyes, mouth wide open",
  scared: "terrified: wide eyes, open mouth, a blue sweat drop",
  worried: "worried: eyebrows raised in the middle, wavy mouth, a blue sweat drop",
  angry: "angry: eyebrows slanted down, frowning",
  sad: "sad: droopy eyebrows, frown",
  smug: "smug: half-closed eyelids, a smirk",
  confused: "confused: one eyebrow raised, wavy mouth",
  dead: "X eyes, flat mouth",
  sleep: "eyes closed, sleeping",
  think: "thinking: eyes looking up, one hand on the chin",
  yell: "yelling, mouth wide open",
};
const ITEM = {
  shovel: "a shovel",
  map: "a yellow paper treasure map",
  scroll: "a paper scroll",
  sword: "a short sword",
  shield: "a round red shield",
  spear: "a long wooden spear",
  staff: "a wooden walking staff",
  book: "a red book",
  bag: "a small cloth sack",
  apple: "a red apple",
  cup: "a small white cup",
  torch: "a burning torch",
  sign: "a blank wooden sign",
  flag: "a red flag",
  bottle: "a glass bottle",
  coin: "a gold coin",
  lantern: "an oil lantern",
  skull: "a skull",
  gem: "a blue gem",
  phone: "a phone",
  fish: "a fish",
  bone: "a bone",
  pickaxe: "a pickaxe",
  magnifier: "a magnifying glass",
  stick: "a wooden stick",
  rope: "a rope",
};
function lookWords(c) {
  const w = [`${c.skin && c.skin !== "white" ? c.skin + " skin" : "a white round head"}`];
  if (c.hat) w.push(`a ${c.hat} hat`);
  if (c.hair) w.push(`${c.hairc ? c.hairc + " " : ""}${c.hair} hair`);
  if (c.beard) w.push(c.beard === "stache" ? "a moustache" : "a full beard");
  if (c.glasses === "1") w.push("round glasses");
  if (c.wear) w.push(`a ${c.wearc ? c.wearc + " " : ""}${c.wear}`);
  return `a stick figure with ${w.join(", ")}`;
}
function describe(who, cast, key2) {
  if (ANIMALS[who]) return `${ANIMALS[who].look}, ${VARIANT[key2] || key2}`;
  const look = cast?.desc ? cast.desc : lookWords(cast || {});
  if (key2.startsWith("XL-"))
    return `${look}, close-up from the chest up facing the viewer, the big head fills most of the cell, ${FACE[key2.slice(3)] || key2.slice(3)}`;
  const [pose, e, ...items] = key2.split("-"),
    it = items.map((i) => ITEM[i] || i).join(" and ");
  let p = POSE[pose] || POSE.stand;
  p = p.includes("{item}") ? p.replace("{item}", it || "something") : p + (it ? `, holding ${it}` : "");
  return `${look}, ${p}, ${FACE[e] || e}`;
}
const libId = (who, cast) =>
  ANIMALS[who] || (!cast?.desc && !Object.keys(cast || {}).length)
    ? who
    : `${who.replace(/[^\w-]/g, "").slice(0, 24)}-${crypto
        .createHash("sha1")
        .update(cast?.desc || JSON.stringify(cast))
        .digest("hex")
        .slice(0, 8)}`;
let bgra = null;
const isBgra = () => {
  if (bgra == null) {
    const px = nativeImage.createFromBuffer(encodePng({ data: Buffer.from([255, 0, 0, 255]), w: 1, h: 1 })).toBitmap();
    bgra = px[2] > 200 && px[0] < 50;
  }
  return bgra;
};
function decode(buf) {
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error("The picture came back in a format the app cannot read.");
  const { width: w, height: h } = img.getSize();
  const b = Buffer.from(img.toBitmap());
  return { data: isBgra() ? bgraToRgba(b) : b, w, h };
}
function keyGreen(im) {
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    if (g > 110 && g > r + 45 && g > b + 45) {
      d[i + 3] = 0;
      continue;
    }
    const m = Math.max(r, b);
    if (g > m) d[i + 1] = Math.min(g, m + 10);
    d[i + 3] = 255;
  }
  return im;
}
function blobs(im, scale = 6, grow = 3) {
  const W = Math.ceil(im.w / scale),
    H = Math.ceil(im.h / scale),
    on = new Uint8Array(W * H),
    pad = new Uint8Array(W * H),
    lab = new Int32Array(W * H);
  for (let y = 0; y < im.h; y += scale)
    for (let x = 0; x < im.w; x += scale) if (im.data[(y * im.w + x) * 4 + 3]) on[((y / scale) | 0) * W + ((x / scale) | 0)] = 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (on[y * W + x])
        for (let dy = -grow; dy <= grow; dy++)
          for (let dx = -grow; dx <= grow; dx++) {
            const yy = y + dy,
              xx = x + dx;
            if (yy >= 0 && yy < H && xx >= 0 && xx < W) pad[yy * W + xx] = 1;
          }
  const out = [];
  let n = 0;
  for (let i = 0; i < W * H; i++)
    if (pad[i] && !lab[i]) {
      lab[i] = ++n;
      const st = [i];
      const b = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0 };
      while (st.length) {
        const k = st.pop(),
          x = k % W,
          y = (k / W) | 0;
        b.n += on[k];
        b.x0 = Math.min(b.x0, x);
        b.x1 = Math.max(b.x1, x);
        b.y0 = Math.min(b.y0, y);
        b.y1 = Math.max(b.y1, y);
        for (const q of [k - 1, k + 1, k - W, k + W])
          if (q >= 0 && q < W * H && pad[q] && !lab[q] && Math.abs((q % W) - x) <= 1) {
            lab[q] = n;
            st.push(q);
          }
      }
      if (b.n > 40) out.push({ x0: b.x0 * scale, y0: b.y0 * scale, x1: (b.x1 + 1) * scale, y1: (b.y1 + 1) * scale, n: b.n });
    }
  return out;
}
function crop(im, x0, y0, x1, y1) {
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(im.w, x1);
  y1 = Math.min(im.h, y1);
  let a = x1,
    b = y1,
    c = x0,
    e = y0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (im.data[(y * im.w + x) * 4 + 3]) {
        a = Math.min(a, x);
        b = Math.min(b, y);
        c = Math.max(c, x + 1);
        e = Math.max(e, y + 1);
      }
  if (c <= a) return { data: Buffer.alloc(4), w: 1, h: 1 };
  const w = c - a,
    h = e - b,
    out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) im.data.copy(out, y * w * 4, ((y + b) * im.w + a) * 4, ((y + b) * im.w + a + w) * 4);
  return { data: out, w, h };
}
function cut(im, n, cols, rows) {
  const bs = blobs(im);
  if (rows === 1) {
    bs.sort((p, q) => p.x0 - q.x0);
    const g = [];
    for (const b of bs) {
      const l = g[g.length - 1];
      if (l && b.x0 < l.x1 + 20) {
        l.x0 = Math.min(l.x0, b.x0);
        l.y0 = Math.min(l.y0, b.y0);
        l.x1 = Math.max(l.x1, b.x1);
        l.y1 = Math.max(l.y1, b.y1);
      } else g.push({ ...b });
    }
    const big = g.filter((b) => (b.x1 - b.x0) * (b.y1 - b.y0) > im.w * im.h * 4e-3);
    if (big.length === n) return big.map((b) => crop(im, b.x0 - 4, b.y0 - 4, b.x1 + 4, b.y1 + 4));
  }
  const cw = im.w / cols,
    ch = im.h / rows;
  return Array.from({ length: n }, (_, i) => {
    const mine = bs.filter(
      (b) => Math.floor((b.x0 + b.x1) / 2 / cw) === i % cols && Math.floor((b.y0 + b.y1) / 2 / ch) === Math.floor(i / cols),
    );
    if (!mine.length) return null;
    return crop(
      im,
      Math.min(...mine.map((b) => b.x0)) - 4,
      Math.min(...mine.map((b) => b.y0)) - 4,
      Math.max(...mine.map((b) => b.x1)) + 4,
      Math.max(...mine.map((b) => b.y1)) + 4,
    );
  });
}
function copySprite(fromRoot, toRoot, fromId, toId, key2, e) {
  const src = path.join(fromRoot, fromId, e.file),
    dst = path.join(toRoot, toId, e.file);
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}
export function seedSprites(dir) {
  const from = starterOf(dir),
    idx = readJson$d(path.join(from, "index.json"), {}),
    out = {};
  for (const [id, c] of Object.entries(idx)) {
    out[id] = { ...c, lib: id, sprites: {} };
    for (const [k, e] of Object.entries(c.sprites)) if (copySprite(from, projRoot(dir), id, id, k, e)) out[id].sprites[k] = e;
  }
  writeJson(path.join(projRoot(dir), "index.json"), out);
}
const SHEET = 6;
const PROMPT_STYLE =
  "Draw it in the most clumsy, scribbly, and utterly pathetic way possible, as if it was drawn in MS Paint with a mouse, exactly like the drawing style of image 1: wobbly uneven black mouse lines, flat bucket-fill colours that miss the edges a bit, no shading, no gradients, no smooth anti-aliased lines, that low-quality pixel-by-pixel feel. Stick figures have a BIG round head (as wide as the torso is long), a thin stick body and thin stick arms and legs, and a simple expressive cartoon face (round eyes with black pupils, simple eyebrows, a simple mouth). Never use any green on the drawings.";
export async function makeSprites(dir, onProgress = () => {}) {
  const { cast, uses } = needs(dir);
  const pIdx = readJson$d(path.join(projRoot(dir), "index.json"), {});
  const lIdx = readJson$d(path.join(libRoot(), "index.json"), {});
  const starter = starterOf(dir),
    sIdx = readJson$d(path.join(starter, "index.json"), {});
  let reused = 0,
    made = 0,
    pictures = 0,
    cost = 0;
  const failed = [],
    sheets = [],
    newKeys = [];
  const save = () => {
    writeJson(path.join(projRoot(dir), "index.json"), pIdx);
    writeJson(path.join(libRoot(), "index.json"), lIdx);
  };
  for (const [who, keys] of Object.entries(uses)) {
    const id = libId(who, cast[who]),
      entry = (pIdx[who] ??= { desc: cast[who]?.desc, lib: id, kind: ANIMALS[who] ? "animal" : "human", sprites: {} });
    if (entry.lib !== id) {
      entry.lib = id;
      entry.desc = cast[who]?.desc;
      entry.sprites = {};
    }
    const missing = [];
    for (const k of keys) {
      if (entry.sprites[k] && fs.existsSync(path.join(projRoot(dir), who, entry.sprites[k].file))) continue;
      const fromLib = lIdx[id]?.sprites[k],
        fromStarter = sIdx[id]?.sprites[k];
      if (fromLib && copySprite(libRoot(), projRoot(dir), id, who, k, fromLib)) {
        entry.sprites[k] = fromLib;
        reused++;
      } else if (fromStarter && copySprite(starter, projRoot(dir), id, who, k, fromStarter)) {
        entry.sprites[k] = fromStarter;
        reused++;
      } else missing.push(k);
    }
    for (let i = 0; i < missing.length; i += SHEET) {
      const chunk = missing.slice(i, i + SHEET),
        n = chunk.length,
        cols = n <= 3 ? n : 3,
        rows = n <= 3 ? 1 : 2;
      const aspect = n === 1 ? "1:1" : n === 2 ? "16:9" : n === 3 ? "16:9" : "3:2";
      const where =
        rows === 2
          ? ["top left", "top middle", "top right", "bottom left", "bottom middle", "bottom right"]
          : n === 3
            ? ["left", "middle", "right"]
            : n === 2
              ? ["left", "right"]
              : ["centre"];
      const own = Object.values(lIdx[id]?.sprites || {})
        .slice(0, 2)
        .map((e) => path.join(libRoot(), id, e.file))
        .filter((f) => fs.existsSync(f));
      const refs = [path.join(starter, "anchor.png"), ...own].filter((f) => fs.existsSync(f));
      const prompt = `A character sprite sheet: ${n} separate full-body drawings of the SAME ${ANIMALS[who] ? "animal" : "character"} in a ${cols} by ${rows} grid, on a flat solid pure green (#00FF00) background. ${PROMPT_STYLE}${own.length ? " The other reference images show this same character: keep the face, colours, hat and clothes identical." : ""} Each drawing is centred in its own cell with plenty of green space around it; nothing touches the cell edges or another drawing; every figure is drawn at the same scale.
${chunk.map((k, j) => `Cell ${j + 1} (${where[j]}): ${describe(who, cast[who], k)}.`).join("\n")}`;
      onProgress(`Drawing ${who}: ${chunk.join(", ")}`);
      let r;
      try {
        r = await generatePicture({ prompt, aspect, refs, resolution: "2k", quality: "low" }, dir);
      } catch (e) {
        failed.push(`${who} (${chunk.join(", ")}): ${e.message}`);
        continue;
      }
      pictures++;
      cost += r.cost || 0;
      const raw = path.join(dir, ".suite", "raw", `sprites-${who}-${Date.now()}.png`);
      fs.mkdirSync(path.dirname(raw), { recursive: true });
      fs.writeFileSync(raw, r.buf);
      sheets.push(raw);
      const parts = cut(keyGreen(decode(r.buf)), n, cols, rows);
      chunk.forEach((k, j) => {
        const p = parts[j];
        if (!p || p.w < 20) {
          failed.push(`${who} ${k}: no figure found in its cell`);
          return;
        }
        const small = shrink(p, 640),
          file = `${k}.png`,
          png = encodePng(small),
          e = { file, w: small.w, h: small.h, sheet: path.basename(raw) };
        for (const [root, cid] of [
          [projRoot(dir), who],
          [libRoot(), id],
        ]) {
          fs.mkdirSync(path.join(root, cid), { recursive: true });
          fs.writeFileSync(path.join(root, cid, file), png);
        }
        entry.sprites[k] = e;
        (lIdx[id] ??= { desc: cast[who]?.desc, kind: entry.kind, sprites: {} }).sprites[k] = e;
        made++;
        newKeys.push(`${who} ${k}`);
      });
      save();
    }
  }
  save();
  return { reused, made, pictures, cost: +cost.toFixed(3), failed, sheets, newKeys, characters: Object.keys(uses) };
}
const UA = "VideoxxSuite/0.8 (stick-figure explainer videos; https://github.com/)";
export async function webImage(dir, query, name) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(query + " filetype:bitmap")}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1280`;
  const res = await fetch(api, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Wikimedia Commons answered ${res.status}`);
  const pages = Object.values((await res.json())?.query?.pages || {});
  const pick = pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ title: p.title, i: p.imageinfo?.[0] }))
    .find((p) => p.i && /jpeg|png/.test(p.i.mime) && p.i.width >= 500 && p.i.height >= 300);
  if (!pick) return null;
  const img = await fetch(pick.i.thumburl || pick.i.url, { headers: { "User-Agent": UA } });
  if (!img.ok) throw new Error(`download failed (${img.status})`);
  const buf = Buffer.from(await img.arrayBuffer()),
    ext = /png/.test(pick.i.mime) ? "png" : "jpg",
    rel = `img/${name}.${ext}`;
  fs.mkdirSync(path.join(dir, "assets", "img"), { recursive: true });
  fs.writeFileSync(path.join(dir, "assets", rel), buf);
  const meta = pick.i.extmetadata || {},
    strip = (s) =>
      String(s || "")
        .replace(/<[^>]+>/g, "")
        .trim();
  const credit = `${name}: ${pick.title.replace(/^File:/, "")} | ${strip(meta.Artist?.value) || "unknown author"} | ${strip(meta.LicenseShortName?.value) || "see source"} | ${pick.i.descriptionurl}`;
  fs.appendFileSync(path.join(dir, "assets", "credits.txt"), credit + "\n");
  const pj = readJson$d(path.join(dir, "project.json"), null);
  if (pj && typeof pj === "object") {
    pj.images = { ...(pj.images || {}), [name]: rel };
    writeJson(path.join(dir, "project.json"), pj);
  }
  return { file: path.join(dir, "assets", rel), rel, credit, title: pick.title };
}
