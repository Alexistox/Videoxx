import path from "node:path";
import fs from "node:fs";
import { nativeImage } from "electron";
import { log } from "../core/log";
import { encodePng } from "../images/png";
import { layoutCheckWith } from "../render/workers";
import { requireStudio } from "./stages";
import { settingsFor } from "./runChecks";
import { ff } from "../pipeline/ff";
import { ensureTargetCopies, readTargets, targetMaster } from "./targets";

const SIZE = { "16:9": [1280, 720], "9:16": [720, 1280] };
const GRID = 4;
export function matchSig(dir, list = readTargets(dir)) {
  return list
    .map((t) => {
      let s = 0;
      try {
        s = fs.statSync(path.join(dir, targetMaster(t.id))).size;
      } catch {}
      return `${t.id}@${t.view}/${t.aspect}/${t.t}#${s}`;
    })
    .join(",");
}
export const usableTargets = (dir, studio) =>
  ensureTargetCopies(dir).filter(
    (t) => studio.views[t.view] && studio.aspects.includes(t.aspect) && fs.existsSync(path.join(dir, targetMaster(t.id))),
  );
function cover(img, w, h) {
  const s = img.getSize(),
    want = w / h;
  if (!s.width || !s.height) return img;
  const crop =
    s.width / s.height > want
      ? { x: Math.round((s.width - s.height * want) / 2), y: 0, width: Math.round(s.height * want), height: s.height }
      : { x: 0, y: Math.round((s.height - s.width / want) / 2), width: s.width, height: Math.round(s.width / want) };
  return img.crop(crop).resize({ width: w, height: h, quality: "good" });
}
function tileDiff(a, b, gw, gh) {
  const A = cover(a, gw, gh).toBitmap(),
    B = cover(b, gw, gh).toBitmap(),
    tw = gw / GRID,
    th = gh / GRID;
  const tiles = new Array(GRID * GRID).fill(0),
    n = new Array(GRID * GRID).fill(0);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = (y * gw + x) * 4,
        k = Math.min(GRID - 1, Math.floor(y / th)) * GRID + Math.min(GRID - 1, Math.floor(x / tw));
      tiles[k] += (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 765;
      n[k]++;
    }
  return tiles.map((s, k) => (n[k] ? s / n[k] : 0));
}
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
let bgra = null;
const isBgra = () =>
  (bgra ??= (() => {
    const px = nativeImage.createFromBuffer(encodePng({ data: Buffer.from([255, 0, 0, 255]), w: 1, h: 1 })).toBitmap();
    return px[2] > 200 && px[0] < 50;
  })());
const hex = (r, g, b) =>
  "#" +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function regionGrid(portrait) {
  const cols = portrait ? ["left", "centre", "right"] : ["left", "centre-left", "centre-right", "right"];
  const rows = portrait ? ["top", "upper middle", "lower middle", "bottom"] : ["top", "middle", "bottom"];
  return rows.flatMap((r, y) =>
    cols.map((c, x) => ({ name: `${r} ${c}`, rect: [x / cols.length, y / rows.length, 1 / cols.length, 1 / rows.length] })),
  );
}
function regionMeans(a, b, portrait) {
  const gw = portrait ? 72 : 128,
    gh = portrait ? 128 : 72,
    A = cover(a, gw, gh).toBitmap(),
    B = cover(b, gw, gh).toBitmap(),
    [ri, bi] = isBgra() ? [2, 0] : [0, 2];
  const mean = (bmp, r) => {
    const x0 = Math.round(r[0] * gw),
      y0 = Math.round(r[1] * gh),
      x1 = Math.round((r[0] + r[2]) * gw),
      y1 = Math.round((r[1] + r[3]) * gh),
      s = [0, 0, 0];
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * gw + x) * 4;
        s[0] += bmp[i + ri];
        s[1] += bmp[i + 1];
        s[2] += bmp[i + bi];
        n++;
      }
    return s.map((v) => (n ? v / n : 0));
  };
  return regionGrid(portrait).map((g) => {
    const t = mean(A, g.rect),
      r = mean(B, g.rect);
    return {
      name: g.name,
      rect: g.rect,
      target: hex(t[0], t[1], t[2]),
      render: hex(r[0], r[1], r[2]),
      dL: Math.round(luma(r) - luma(t)),
      d: +(Math.hypot(r[0] - t[0], r[1] - t[1], r[2] - t[2]) / 4.4167).toFixed(1),
    };
  });
}
function regionsText(id, rs) {
  const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
  return [
    `Region colour means of ${id}: the target vs this version's frame (sRGB hex). dL = render minus target luminance (0-255: negative = the render is darker),`,
    "d = colour distance (0-100). Where d is high the grade, light or material of that region is off.",
    "",
    ...rs.map((r) => `${pad(r.name, 22)}target ${r.target}  render ${r.render}  dL ${r.dL >= 0 ? "+" : ""}${r.dL}  d ${r.d}`),
    "",
  ].join("\n");
}
function regions(diff, w, h) {
  const cw = even(w / 3),
    ch = even(h / 3),
    out = [];
  const rect = (cx, cy) => ({
    x: even(Math.max(0, Math.min(w - cw, cx - cw / 2))),
    y: even(Math.max(0, Math.min(h - ch, cy - ch / 2))),
    w: cw,
    h: ch,
  });
  out.push({ ...rect(w / 2, h / 2), why: "centre" });
  const iou = (a, b) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)),
      iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return (ix * iy) / (a.w * a.h + b.w * b.h - ix * iy);
  };
  const order = diff.map((d, k) => ({ d, k })).sort((p, q) => q.d - p.d),
    mean = diff.reduce((s, d) => s + d, 0) / diff.length;
  for (const { d, k } of order) {
    if (out.length >= 4) break;
    if (out.length > 1 && d < Math.max(0.03, mean)) break;
    const r = rect((((k % GRID) + 0.5) * w) / GRID, ((Math.floor(k / GRID) + 0.5) * h) / GRID);
    if (out.some((o) => iou(o, r) > 0.25)) continue;
    out.push({ ...r, why: "difference" });
  }
  return out;
}
export async function overlays(dir, rel, t, png, targetFile = path.join(dir, targetMaster(t.id))) {
  const [W, H] = SIZE[t.aspect] ?? SIZE["16:9"],
    base = `${rel}/${t.id}`,
    abs = (r) => path.join(dir, r);
  const render2 = nativeImage.createFromBuffer(png);
  if (render2.isEmpty()) throw new Error("the frame came back empty");
  fs.writeFileSync(abs(`${base}_render.jpg`), cover(render2, W, H).toJPEG(88));
  const target = nativeImage.createFromPath(targetFile);
  if (target.isEmpty()) throw new Error("the target picture can't be read");
  const portrait = t.aspect === "9:16",
    diff = tileDiff(target, render2, portrait ? 36 : 64, portrait ? 64 : 36);
  const rs = regions(diff, W, H),
    n = 4 + rs.length,
    zoom = portrait ? "scale=-2:640:flags=lanczos" : "scale=640:-2:flags=lanczos";
  const outs = ["side", "blend", "edges", "target", ...rs.map((_, k) => `crop${k + 1}`)];
  let g = `[0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=rgb24,split=${n}${outs.map((_, i) => `[t${i}]`).join("")};[1]scale=${W}:${H},setsar=1,format=rgb24,split=${n}${outs.map((_, i) => `[r${i}]`).join("")};[t0]scale=${W / 2}:${H / 2}[ts];[r0]scale=${W / 2}:${H / 2}[rs];[ts][rs]hstack[side];[t1]format=gbrp[tb];[r1]format=gbrp[rb];[tb][rb]blend=all_mode=average[blend];[t2]edgedetect=low=0.08:high=0.2,format=rgb24,colorchannelmixer=rr=0:gg=1:bb=1,format=gbrp[te];[r2]lutrgb=r=val*0.5:g=val*0.5:b=val*0.5,format=gbrp[rd];[rd][te]blend=all_mode=screen[edges];[t3]null[target];[r3]nullsink`;
  rs.forEach((r, k) => {
    const c = `crop=${r.w}:${r.h}:${r.x}:${r.y},${zoom}`;
    g += `;[t${4 + k}]${c}[ca${k}];[r${4 + k}]${c}[cb${k}];[ca${k}][cb${k}]hstack[crop${k + 1}]`;
  });
  const args = ["-i", targetFile, "-i", abs(`${base}_render.jpg`), "-filter_complex", g];
  for (const o of outs) args.push("-map", `[${o}]`, "-frames:v", "1", "-q:v", "3", abs(`${base}_${o}.jpg`));
  await ff(args, 6e4);
  const missing = outs.find((o) => !fs.existsSync(abs(`${base}_${o}.jpg`)));
  if (missing) throw new Error(`ffmpeg made no ${missing} sheet`);
  const regs = regionMeans(target, render2, portrait);
  fs.writeFileSync(abs(`${base}_regions.txt`), regionsText(t.id, regs));
  return {
    regions: regs,
    regionsFile: `${base}_regions.txt`,
    id: t.id,
    view: t.view,
    aspect: t.aspect,
    t: t.t,
    target: `${base}_target.jpg`,
    render: `${base}_render.jpg`,
    side: `${base}_side.jpg`,
    blend: `${base}_blend.jpg`,
    edges: `${base}_edges.jpg`,
    crops: rs.map((r, k) => ({
      file: `${base}_crop${k + 1}.jpg`,
      rect: [+(r.x / W).toFixed(4), +(r.y / H).toFixed(4), +(r.w / W).toFixed(4), +(r.h / H).toFixed(4)],
      why: r.why,
    })),
    diff: +(diff.reduce((s, d) => s + d, 0) / diff.length).toFixed(4),
  };
}
export async function matchPass(projectId, rel) {
  const t0 = Date.now(),
    { dir, studio } = requireStudio(projectId),
    list = usableTargets(dir, studio);
  if (!list.length) return null;
  const out = `${rel}/match`;
  fs.rmSync(path.join(dir, out), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, out), { recursive: true });
  const errors = [],
    targets = [],
    groups = new Map();
  for (const t of list) {
    const k = `${t.view}|${t.aspect}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const [key2, ts] of groups) {
    const [view, aspect] = key2.split("|"),
      v = studio.views[view],
      end = +v.end;
    const times = ts.map((t) => +Math.max(0, Math.min(end - 0.02, t.t)).toFixed(2));
    let r;
    try {
      r = await layoutCheckWith(
        projectId,
        settingsFor(dir, studio, aspect),
        { scenes: v.scenes, end },
        { layout: false, stills: () => ({ times, scale: 1 }) },
      );
    } catch (e) {
      errors.push(`${view} ${aspect}: ${e?.message || e}`);
      continue;
    }
    if (r.bootError) {
      errors.push(`${view} ${aspect} does not load: ${r.bootError}`.slice(0, 300));
      continue;
    }
    for (const [k, t] of ts.entries()) {
      const png = r.stills[k]?.png;
      if (!png) {
        errors.push(`${t.id}: the ${view} frame at ${times[k]} s threw (check_preview shows why)`);
        continue;
      }
      try {
        targets.push(await overlays(dir, out, t, png));
      } catch (e) {
        errors.push(`${t.id}: ${e?.message || e}`.slice(0, 300));
      }
    }
  }
  const rec = { at: new Date().toISOString(), ms: Date.now() - t0, sig: matchSig(dir, list), targets, errors };
  log(
    "studio",
    "match",
    projectId,
    `${targets.length} of ${list.length} target(s) in ${rec.ms} ms${errors.length ? ` (${errors.length} error(s): ${errors[0]})` : ""}`,
  );
  return rec;
}
