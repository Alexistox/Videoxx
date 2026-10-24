import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { nativeImage } from "electron";
import { z } from "zod";
import * as lowpoly from "../../characters/lowpoly";
import { now, q, uid } from "../../db/db";
import { aspectOf, baseOf } from "../../styles/catalog";
import { cutoutWarning, makeImage } from "../../images/makeImage";
import { PROVIDER_NAMES, activeProvider } from "../../images/providers";
import { makeSprites, webImage } from "../../characters/sprites";
import { checkedStills, hostState, layoutCheck, viewHold, viewProp } from "../../render/workers";
import { studioOf } from "../../studio/stages";
import { libraryOff } from "../../library/context";
import { flowTextures, makeTexture } from "../../studio/textures";
import { getProject } from "../../projects/projects";
import { libraryToolDefs } from "./libraryTools";
import { lowpolyChanged } from "../../library/harvest";
import { isUltraPlus } from "../ultraPlusTargets";
import { ultraPlusToolDefs } from "./ultraPlusTools";
import { studioToolDefs } from "./studioTools";
import { fmtTime, framesFor } from "../../projects/references";
import { projectUrl } from "../../projects/fileServer";

const selections = new Map();
export const setSelection = (projectId, items) => selections.set(projectId, items);
const getSelection = (projectId) => selections.get(projectId) ?? [];
const shotCache = new Map();
export const setShots = (projectId, shots) => shotCache.set(projectId, shots);
export const getShots = (projectId) => shotCache.get(projectId) ?? [];
let onRuleSuggested = () => {};
export let onFramesRendered = () => {};
export const onFrames = (f) => (onFramesRendered = f);
export const onRuleSuggestion = (f) => (onRuleSuggested = f);
let onImagesBlocked = () => {};
export const onImageBlock = (f) => (onImagesBlocked = f);
const BLOCKING_IMAGE_ERROR = /API key|Could not reach (Higgsfield|Fal\.ai)|no (API )?credits/i;
export function describeSelection(items) {
  return items
    .map((s, i) => {
      const sh = s.shot
        ? `shot ${s.shot.index + 1} "${s.shot.name ?? ""}" (${s.shot.t0.toFixed(1)}-${s.shot.t1.toFixed(1)}s, ${s.shot.file ?? "?"}:${s.shot.line ?? "?"})`
        : "";
      const el = s.element || {};
      const what =
        s.kind === "object"
          ? `3D object ${el.key ? `\`${el.key}\`` : "(not stored in st)"}${el.name ? ` named "${el.name}"` : ""}${el.kind ? ` [${el.kind}]` : ""} at t=${s.time?.toFixed(2)}s, world point ${JSON.stringify(el.point ?? [])}${el.size ? `, size ${el.size.join("x")}` : ""}${el.ramp ? `, clicked surface ramp [${el.ramp.join(", ")}]` : ""}`
          : s.kind === "hud"
            ? `HUD ${el.type ?? "element"}${el.text ? ` "${el.text}"` : ""}${el.source ? ` drawn at ${el.source.file}:${el.source.line}` : ""} at t=${s.time?.toFixed(2)}s`
            : s.kind === "range"
              ? `time range ${s.range?.[0].toFixed(2)}-${s.range?.[1].toFixed(2)}s`
              : s.kind === "phrase"
                ? `narration phrase "${el.text ?? ""}" (${s.range?.[0].toFixed(2)}-${s.range?.[1].toFixed(2)}s)`
                : s.kind === "cue"
                  ? `word cue ${el.key ? `\`${el.key}\` = ` : ""}cue('${el.word}', ${el.near}${el.which === "e" ? ", 'e'" : ""})${el.offset ? ` ${el.offset > 0 ? "+" : "-"} ${Math.abs(el.offset)}` : ""} at ${el.file}:${el.line}, fires at ${Number(el.t).toFixed(2)}s${el.miss ? " (MISS: the words were not found in the narration)" : ""}; things keyed to it appear on that word`
                  : `the whole shot`;
      return `${i + 1}. ${what}${sh ? ` - in ${sh}` : ""}`;
    })
    .join("\n");
}
export const text = (t) => ({ content: [{ type: "text", text: t }] });
export function schemaProblems(defs) {
  const out = [];
  for (const d of defs) {
    try {
      const j = JSON.stringify(z.toJSONSchema(z.object(d.schema ?? {})));
      if (j.includes('"propertyNames"')) out.push(`${d.name}: propertyNames (use z.object({}).catchall(...), not z.record)`);
    } catch (e) {
      out.push(`${d.name}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return out;
}
const CLAUDE_MAX_SIDE = 1568;
function imageTokens(w, h) {
  const k = Math.min(1, CLAUDE_MAX_SIDE / Math.max(w, h, 1), Math.sqrt(115e4 / Math.max(1, w * h)));
  return Math.ceil((w * k * h * k) / 750);
}
export function claudeImage(src, maxSide, png = false) {
  const im = typeof src === "string" ? nativeImage.createFromPath(src) : nativeImage.createFromBuffer(src);
  const { width: w, height: h } = im.getSize(),
    k = Math.min(1, maxSide / Math.max(w, h, 1));
  const small = k < 1 ? im.resize({ width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), quality: "best" }) : im;
  const s = small.getSize(),
    tokens = imageTokens(s.width, s.height);
  return {
    tokens,
    block: png
      ? { type: "image", data: small.toPNG().toString("base64"), mimeType: "image/png" }
      : { type: "image", data: small.toJPEG(90).toString("base64"), mimeType: "image/jpeg" },
  };
}
export const forClaude = (src, maxSide, alpha = false) => claudeImage(src, maxSide, alpha).block;
export const frameSide = (count, scale, art = 0) => {
  const side = scale >= 0.75 ? (count <= 2 ? CLAUDE_MAX_SIDE : count <= 4 ? 1280 : 960) : count <= 4 ? 960 : 800;
  return art > 0 ? pixelSide(side, art) : side;
};
function pixelSide(target, art) {
  const ah = (art * 9) / 16;
  let m = Math.max(1, Math.floor(target / art + 0.34));
  while (m > 1 && (m * art > CLAUDE_MAX_SIDE || m * art * m * ah > 115e4)) m--;
  return m * art;
}
function pixelArtWidth(projectId) {
  const p = getProject(projectId),
    ok = (w) => w > 0 && 1920 % w === 0;
  if (baseOf(p.style_id) !== "pixel-art") return 0;
  try {
    const w = +JSON.parse(fs.readFileSync(path.join(p.path, "project.json"), "utf8")).settings?.art?.width;
    if (ok(w)) return w;
  } catch {}
  try {
    const m = /art:\s*\{\s*width:\s*(\d+)/.exec(fs.readFileSync(path.join(p.path, "engine.js"), "utf8"));
    if (m && ok(+m[1])) return +m[1];
  } catch {}
  return 320;
}
function pixelDown(src, side) {
  const im = nativeImage.createFromBuffer(src),
    { width: w, height: h } = im.getSize(),
    k = side / Math.max(w, h, 1);
  if (k >= 1 || !w) return src;
  const W = Math.max(1, Math.round(w * k)),
    H = Math.max(1, Math.round(h * k)),
    a = im.toBitmap(),
    b = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.floor((y + 0.5) / k)) * w;
    for (let x = 0; x < W; x++) b.writeUInt32LE(a.readUInt32LE((sy + Math.min(w - 1, Math.floor((x + 0.5) / k))) * 4), (y * W + x) * 4);
  }
  return nativeImage.createFromBitmap(b, { width: W, height: H }).toPNG();
}
export const newLedger = (budget, onOver) => ({
  budget,
  spent: 0,
  frames: 0,
  over: false,
  warned: false,
  tools: {},
  seen: new Map(),
  onOver,
});
export function tally(l, name, add) {
  if (!l) return;
  const s = (l.tools[name] ??= { calls: 0, images: 0, tokens: 0, cached: 0, refused: 0 });
  for (const k of Object.keys(add)) s[k] += add[k] ?? 0;
}
export function spend(l, tokens, frames) {
  l.spent += tokens;
  l.frames += frames;
  if (!l.over && l.spent >= l.budget) {
    l.over = true;
    l.onOver?.(l);
  }
}
export const budgetText = (l) =>
  `FRAME BUDGET FOR THIS RUN IS USED UP: you have looked at ${l.frames} frames (about ${Math.round(l.spent / 1e3)}k tokens of images; every image is re-read at each later step and counts against the user's Claude plan). Do not call render_frames again in this run and do not open image files. Check the rest with check_preview and check_layout (text), finish the work, and end your summary with the moments you could not look at, so the user can ask for a look at them in a new request.`;
export const budgetLeft = (l) =>
  l.over
    ? `
${budgetText(l)}`
    : !l.warned && l.spent >= l.budget * 0.75
      ? ((l.warned = true),
        `
Note: about ${Math.max(0, Math.round((l.budget - l.spent) / 1e3))}k tokens of this run's frame budget are left. Look only at moments you changed and haven't seen since, at scale 0.5.`)
      : "";
const BUDGET_PER_SHOT = { pass: 3500, verified: 3500, recon: 3500, ultra: 2e4 };
export function frameBudget(kind, shots, o = {}) {
  const n = Math.max(1, shots),
    B = BUDGET_PER_SHOT,
    ultra = Math.max(0, o.ultraShots ?? 0);
  if (kind === "ultra") return 3e4 + B.ultra * Math.max(1, ultra);
  if (kind === "build" || kind === "reframe")
    return 1e5 + n * (B.pass + (o.verified ? B.verified : 0) + (o.recon ? B.recon : 0)) + B.ultra * ultra;
  if (kind === "studio" || kind === "character" || kind === "cut" || kind === "intro" || kind === "routine") return 25e4;
  return 6e4;
}
function sourcePrint(root) {
  const h = crypto.createHash("sha1");
  let n = 0;
  const walk = (d, rel) => {
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (++n > 2e4) return;
      if (e.isDirectory()) {
        if (!rel && [".suite", ".git", ".claude", "out", "node_modules"].includes(e.name)) continue;
        walk(path.join(d, e.name), rel + e.name + "/");
      } else if (!/\.(wav|mp3|m4a|mp4|mov|webm|log)$/i.test(e.name)) {
        try {
          const s = fs.statSync(path.join(d, e.name));
          h.update(`${rel}${e.name}|${s.size}|${Math.round(s.mtimeMs)}
`);
        } catch {}
      }
    }
  };
  walk(root, "");
  return h.digest("hex");
}
export function readImageCheck(l, root, file) {
  if (!l || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file)) return null;
  const abs = path.resolve(root, file);
  if (/[\\/]\.suite[\\/](frames|edits)[\\/]/i.test(abs)) {
    tally(l, "Read (image)", { calls: 1, refused: 1 });
    return "This is a frame render_frames already showed you (as a smaller copy): reading the full-size file again costs the user's Claude plan. For more detail at that moment use render_frames with scale 1 and one or two times.";
  }
  if (l.over) {
    tally(l, "Read (image)", { calls: 1, refused: 1 });
    return budgetText(l);
  }
  let tokens = 1600;
  try {
    const s = nativeImage.createFromPath(abs).getSize();
    if (s.width) tokens = imageTokens(s.width, s.height);
  } catch {}
  tally(l, "Read (image)", { calls: 1, images: 1, tokens });
  spend(l, tokens, 1);
  return null;
}
const MADE_IMAGE_SIDE = 512;
export function pruneBatches(root) {
  const d = path.join(root, ".suite", "frames");
  try {
    fs.readdirSync(d)
      .filter((x) => x.startsWith("claude-"))
      .sort()
      .slice(0, -40)
      .forEach((x) => fs.rmSync(path.join(d, x), { recursive: true, force: true }));
  } catch {}
}
export function suiteToolDefs(projectId, taskSelection, ledger) {
  const dir = () => getProject(projectId).path;
  const onFlow = (() => {
    try {
      return activeProvider(projectId) === "flow";
    } catch {
      return false;
    }
  })();
  const flowTex =
    onFlow &&
    (() => {
      try {
        return flowTextures(projectId, getProject(projectId).style_id);
      } catch {
        return false;
      }
    })();
  const defs = [
    // in the app: what was selected when this request was made (not whatever the user clicks while you work); bridge: the live selection
    {
      name: "get_selection",
      description:
        "What the user selected for this request in the editor (3D objects, HUD elements, shots, time ranges, narration phrases), with source file:line where known.",
      schema: {},
      handler: async () => {
        const s = taskSelection ?? getSelection(projectId);
        return text(s.length ? describeSelection(s) : "Nothing is selected.");
      },
    },
    {
      name: "list_shots",
      description: "All shots in playback order: index, time range, title, source file and line.",
      schema: {},
      handler: async () => {
        let shots = getShots(projectId);
        if (!shots.length) {
          const st = await hostState(projectId);
          shots = st.info?.shots ?? [];
        }
        return text(
          shots.map((s) => `${s.index + 1}. ${s.t0.toFixed(2)}-${s.t1.toFixed(2)}s  ${s.name}  (${s.file}:${s.line})`).join("\n") ||
            "No shots loaded.",
        );
      },
    },
    {
      name: "reference_frames",
      description:
        "Frames from one of the user's REFERENCES (the files they pointed at, tags like vid1 / img1, listed in the request). Extracts just that range of the original fast (no copying) and returns the frame file paths, their times and a contact sheet (shown to you as one image). start/end in seconds (video; default: the ranges the user saved, else the first 20 s); count = frames (default about 1 per second, max 60). Then Read single frames you need at full size.",
      schema: {
        tag: z.string().min(2).max(12),
        start: z.number().min(0).optional(),
        end: z.number().min(0).optional(),
        count: z.number().int().min(1).max(60).optional(),
      },
      handler: async ({ tag, start, end, count }) => {
        try {
          const x = await framesFor(projectId, tag, start, end, count);
          const lines = [
            x.summary,
            x.sheet ? `contact sheet: ${x.sheet}` : "",
            ...x.frames.map((f, i) => `${fmtTime(x.times[i] ?? 0)}  ${f}`),
            x.audio ? `audio: ${x.audio}` : "",
            x.transcript ? `words: ${x.transcript}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          if (!x.sheet || ledger?.over) {
            tally(ledger, "reference_frames", { calls: 1 });
            return text(lines);
          }
          const im = claudeImage(x.sheet, 1280);
          tally(ledger, "reference_frames", { calls: 1, images: 1, tokens: im.tokens });
          if (ledger) spend(ledger, im.tokens, 1);
          return { content: [{ type: "text", text: lines }, im.block] };
        } catch (e) {
          return text(`reference_frames: ${e?.message || e}`);
        }
      },
    },
    {
      name: "render_frames",
      description:
        "Render frames of the video at the given times (seconds) with the current files, and return them as images so you can check your work. Use 2-6 times per call around the key cue moments. scale 0.5 = 960 px wide (default; more than 4 times in one call come back 800 px wide, pixel art 640), 1 = full detail for small text (1 or 2 times per call; 3-4 come back 1280 px, more 960 px). Every image stays in the conversation and is paid for again at each later step: look at the moments you changed, not the whole video again. A moment you already saw whose files did not change comes back as text, and each run has a frame budget: when it is used up, finish with the text checks.",
      schema: {
        times: z.array(z.number()).min(1).max(8),
        scale: z.number().min(0.25).max(1).optional(),
        who: z
          .string()
          .max(40)
          .optional()
          .describe('In a crew build: your agent name (e.g. "c2"), so "unchanged since you last looked" means what YOU saw'),
      },
      handler: async ({ times, scale, who }) => {
        const art = pixelArtWidth(projectId),
          pixel = art > 0;
        const L = ledger,
          side = frameSide(times.length, scale ?? 0.5, art),
          at = (t) => `${who ? who.trim() + "|" : ""}${t.toFixed(2)}`;
        if (L?.over) {
          tally(L, "render_frames", { refused: 1 });
          return text(budgetText(L));
        }
        const fp = L ? sourcePrint(dir()) : "";
        const known = (t) => {
          const s = L?.seen.get(at(t));
          return !!s && s.fp === fp && s.side >= side;
        };
        const todo = times.filter((t) => !known(t)),
          same = times.filter(known);
        const sameText = same.length
          ? [
              {
                type: "text",
                text: `t = ${same.map((t) => t.toFixed(2)).join("s, ")}s: unchanged since you last looked (no file changed), not sent again. It passed or failed then for the same reasons.`,
              },
            ]
          : [];
        if (!todo.length) {
          tally(L, "render_frames", { cached: same.length });
          return { content: sameText };
        }
        const batch = `claude-${Date.now().toString(36)}${who ? "-" + who.replace(/[^\w-]/g, "").slice(0, 12) : ""}`;
        const { shots, ...st } = await checkedStills(projectId, todo, pixel ? 1 : (scale ?? 0.5), batch);
        pruneBatches(dir());
        onFramesRendered({
          projectId,
          frames: shots
            .filter((s) => s.file)
            .map((s) => ({ time: s.time, url: projectUrl(projectId, `.suite/frames/${batch}/${path.basename(s.file)}`) })),
        });
        const errs = [st.bootError, ...st.errors.filter((e) => e.level === "error").map((e) => e.text)].filter(Boolean);
        let tokens = 0,
          images = 0,
          identical = 0;
        const content = [...(errs.length ? [{ type: "text", text: "Preview errors:\n" + errs.slice(-8).join("\n") }] : []), ...sameText];
        for (const s of shots) {
          if (!s.file) {
            content.push({ type: "text", text: `t = ${s.time.toFixed(2)}s: rendering this frame threw an error (see Preview errors)` });
            continue;
          }
          const hash = crypto.createHash("sha1").update(s.base64).digest("hex"),
            prev = L?.seen.get(at(s.time));
          if (L) L.seen.set(at(s.time), { fp, hash, side: prev?.hash === hash ? Math.max(prev.side, side) : side });
          if (prev && prev.hash === hash && prev.side >= side) {
            identical++;
            content.push({ type: "text", text: `t = ${s.time.toFixed(2)}s: looks exactly as when you last saw it, not sent again.` });
            continue;
          }
          const raw = Buffer.from(s.base64, "base64"),
            im = claudeImage(pixel ? pixelDown(raw, side) : raw, side, pixel);
          tokens += im.tokens;
          images++;
          content.push({ type: "text", text: `t = ${s.time.toFixed(2)}s` }, im.block);
        }
        tally(L, "render_frames", { images, tokens, cached: same.length + identical });
        if (L) {
          spend(L, tokens, images);
          const note = budgetLeft(L);
          if (note) content.push({ type: "text", text: note.trim() });
        }
        return { content };
      },
    },
    {
      name: "check_preview",
      description:
        "Reload the project like the live preview does and report module load errors, runtime errors and cue misses. Call after editing scene files.",
      schema: {},
      handler: async () => {
        const st = await hostState(projectId, true);
        const lines = [st.bootError ? `BOOT ERROR: ${st.bootError}` : null, ...st.errors.map((e) => `${e.level}: ${e.text}`)].filter(
          Boolean,
        );
        return text(
          lines.length ? lines.slice(-30).join("\n") : `Loaded cleanly: ${st.info?.shots?.length ?? 0} shots, ${st.info?.end ?? 0}s.`,
        );
      },
    },
    {
      name: "check_layout",
      description:
        "The second look at your work (Vox collage, Flat explainer, Low poly shorts, 3D cartoon shorts, Stick stories and 3D reconstruction projects; on Stick stories it checks the subject out of frame or its face cut by the frame edge, labels over a face, people through each other, floating feet, held props off the hand, too-dark and empty frames; on Low poly shorts it checks bodies through objects and each other, feet on the ground and sliding, held props in the hand, floating props, the camera inside geometry, the subject in frame and covered text; on 3D cartoon shorts characters out of frame, faces behind the caption or seen from behind in close shots, characters through each other or solid props, floating feet, too-dark and empty (undressed) frames; on 3D reconstructions it runs the coplanar / overlap / flicker sign-off checks over the whole film): measures every steady frame (after each element lands, start/middle/end of every shot) for elements cut off by the frame edge, elements that really overlap, text too small to read, and per style: marker lines crossing things and low-contrast text (collage), elements in the caption band and shading drawn outside an element's own form (flat); on the Studio starter engine also low-contrast text, empty frames, DARK / CRUSHED pictures, ABRUPT camera moves, kit elements not whole in frame, and in 3D floating solids, solids through solids, coplanar surfaces and z-fight flicker. Returns each problem with its time, element and file:line. Fix them all, run it again until it is clean, then look at the flagged times with render_frames. Pass times to check specific moments.",
      schema: {
        times: z.array(z.number()).max(90).optional(),
        from: z
          .number()
          .min(0)
          .optional()
          .describe("Only the checked moments from this time (seconds): a crew agent checks its own chapter"),
        to: z.number().min(0).optional(),
      },
      handler: async ({ times, from, to }) => {
        const range = from != null || to != null ? { from, to } : null;
        if (!range) await hostState(projectId, true);
        const r = await layoutCheck(projectId, times, range);
        if (!r)
          return text(
            "This project's engine has no layout check (the Vox collage, Flat explainer, Low poly shorts, 3D cartoon shorts, Stick stories, 3D reconstruction and Studio starter engines have one). Look at render_frames instead.",
          );
        if (!r.issues.length)
          return text(`Clean: no problems found at ${r.times.length} steady frames. Now do the visual pass with render_frames.`);
        const seen = new Set(),
          lines = r.issues
            .filter((i) => {
              const k = i.type + i.what + (i.other || "");
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .map((i) => `${i.t.toFixed(2)}s  ${String(i.type).toUpperCase()}: ${i.what}${i.other ? ` / ${i.other}` : ""} - ${i.detail}`);
        const MAX = 60,
          shown = lines.slice(0, MAX).map((x) => (x.length > 300 ? x.slice(0, 299) + "…" : x));
        return text(`${lines.length} problem(s) (first time each was seen; ${r.times.length} frames checked):
${shown.join("\n")}${
          lines.length > MAX
            ? `
...and ${lines.length - MAX} more: fix these first, then run check_layout again to see the rest.`
            : ""
        }
For each: why is it bad, and what is the intended layout? Move, resize, re-time or remove the element (o.over / o.bleed / mark target only when the overlap or bleed is truly intended). Then run check_layout again.`);
      },
    },
    {
      name: "narration",
      description: "Narration words with start times between two times (seconds). Use these times with cue().",
      schema: { from: z.number(), to: z.number() },
      handler: async ({ from, to }) => {
        const f = path.join(dir(), "audio", "timeline.json");
        if (!fs.existsSync(f)) return text("No timeline yet.");
        const tl = JSON.parse(fs.readFileSync(f, "utf8"));
        const words = tl.flatMap((p) => p.words).filter((w) => w.s >= from - 0.01 && w.s <= to);
        return text(words.map((w) => `${w.s.toFixed(2)} ${w.w}`).join("\n") || "No words in that range.");
      },
    },
    {
      name: "make_image",
      description: `Make one still image on the user's image service (Higgsfield, Fal.ai or their own: whichever they picked for this project or in Settings; costs about $0.013; cached: the same name + prompt again is free). kind "cutout" = one isolated subject, returned as a PNG with real transparency (the white background is removed locally); "background" = a full-bleed paper/texture/map; "texture" = anything full-frame. aspect: normally leave it out: backgrounds and textures then come at the video's own frame (16:9, or 9:16 in a vertical video) and cut-outs square; never give a picture that fills the frame or a scene another aspect (1:1 or 3:2 leaves it cropped or barred). Never ask for text in the image. The project's "imageStyle" (project.json) is put in front of every prompt, so describe only the subject. ref = the name of an earlier image to copy its look (only for a deliberate style swatch; it can leak its subject into the new image, so normally leave it out: the shared imageStyle keeps the look consistent). The image lands in assets/img/<name>.png and is loaded as IMG[name]. Plan every image first and make each once: there is a budget per project. You get back a small preview to check it (the file itself is full size). model: leave it out to use the default model the user picked (the project's CLAUDE.md names it); give one only when a picture really needs another model of that service.`,
      schema: {
        name: z.string().min(1).max(48),
        prompt: z.string().min(3).max(1500),
        kind: z.enum(["cutout", "background", "texture"]),
        aspect: z.enum(["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]).optional(),
        ref: z.string().optional(),
        model: z.string().max(100).optional(),
        ...(onFlow
          ? {
              upscale: z
                .boolean()
                .optional()
                .describe(
                  "Google Flow: true = Flow's own 2K version of the picture (about 20 s more), for one seen big (a framed print, a screen, a poster)",
                ),
            }
          : {}),
      },
      handler: async (a) => {
        if (!onFlow) delete a.upscale;
        const frame = (() => {
          try {
            const pj = JSON.parse(fs.readFileSync(path.join(dir(), "project.json"), "utf8").replace(/^﻿/, ""));
            return aspectOf(pj.style, pj.settings) < 1 ? "9:16" : "16:9";
          } catch {
            return "16:9";
          }
        })();
        const r = await makeImage(dir(), { ...a, aspect: a.aspect ?? (a.kind === "cutout" ? "1:1" : frame) }).catch((e) => {
          if (!BLOCKING_IMAGE_ERROR.test(String(e?.message))) throw e;
          onImagesBlocked({ projectId, message: String(e.message) });
          throw new Error(`IMAGE GENERATION IS NOT WORKING: ${e.message}
Stop making images. Do NOT replace the pictures with drawn shapes, emoji, placeholders or text: that is what makes a poor video. Finish only work that needs no new images, then end your reply by telling the user plainly that the pictures could not be made on ${((p) => (p ? PROVIDER_NAMES[p] : "Higgsfield or Fal.ai"))(activeProvider(projectId))}, why (the message above), how to fix it (Settings > Media > Image generation, or credits on their Higgsfield / Fal.ai account), and that they can ask you to continue afterwards.`);
        });
        const warn = cutoutWarning(r.entry),
          l = r.ledger;
        return {
          content: [
            {
              type: "text",
              text: `${r.shared ? `Copied for free from the project "${r.shared.project}" (the same picture was made there)` : r.cached ? "Already made (no cost)" : "Made"}: IMG.${r.name} = assets/${r.rel} (${r.entry.size.join("x")}${r.entry.kind === "cutout" ? `, transparent, subject covers ${Math.round((r.entry.cover ?? 0) * 100)}%` : ""}). Project total: ${l.count} images, about $${l.spent.toFixed(2)}.${warn ? "\nWARNING: " + warn : ""}${r.entry.note ? "\nNOTE: " + r.entry.note : ""}${
                onFlow
                  ? `
Google Flow: pictures are free here (one picture per request, made one after the other). Look at this one once and remake it only if it is wrong. upscale: true gets Flow's 2K version for a picture seen big.${flowTex ? " Big surfaces: make_texture." : ""}`
                  : ""
              }`,
            },
            forClaude(r.file, MADE_IMAGE_SIDE, r.entry.kind === "cutout"),
          ],
        };
      },
    },
    ...(flowTex
      ? [
          {
            name: "make_texture",
            description: `Google Flow only (free here): a seamless tileable material texture for a BIG visible surface (floor, walls, table tops, counters, sofas, beds) instead of a procedural canvas material, made while you build. Made on the member's Google Flow as a flat, evenly lit, top-down texture, subtle and stylized-3D (not photo-real), upscaled with Flow's Download > 2K, its edges blended so it tiles with no seam. name = a short id (oak_floor); material = what it is, in plain words with colour and finish ("worn honey oak floor planks, narrow boards", "pale green plaster wall, faint trowel marks"); tile_m = the real-world metres one tile covers (planks ~1.5, bricks ~1, fabric ~.5). Saved as assets/textures/<name>.jpg (+ textures.json) and in the Library, so later videos get it free; the same name + material again is free. Returns the file, a preview to check once (remake with a clearer material only when it is wrong: seams, perspective, objects, text, too photographic) and the 3 lines to use it. Small things keep the procedural materials; pictures and small details come from make_image.`,
            schema: {
              name: z.string().min(1).max(40),
              material: z.string().min(3).max(300),
              tile_m: z.number().min(0.05).max(50).optional(),
              seamless: z.boolean().optional(),
            },
            handler: async (a) => {
              const p = getProject(projectId);
              const r = await makeTexture(p.path, p.style_id, a);
              const e = r.entry,
                how =
                  r.cached === "project"
                    ? "Already made (no new picture)"
                    : r.cached === "library"
                      ? `Copied for free from the Library (${e.from})`
                      : `Made on Google Flow (free${e.upscaled ? ", 2K" : ""}, edges blended to tile)`;
              return {
                content: [
                  {
                    type: "text",
                    text: `${how}: ${r.rel} (${e.size.join("x")}), one tile = ${e.tile_m} m.${e.note ? "\nNOTE: " + e.note : ""}${
                      e.library
                        ? `
In the Library as ${e.library}.`
                        : ""
                    }
Use it (W x H = the surface in metres):
${r.snippet}
Look at the preview once: remake only if it is wrong.`,
                  },
                  forClaude(r.file, MADE_IMAGE_SIDE),
                ],
              };
            },
          },
        ]
      : []),
    {
      name: "make_sprites",
      description: `Stick-figure (MS Paint) style only. Makes the people and animals the scenes use as transparent sprites: reads every cast line (cast <name> desc="...") and every figure and animal in scenes/*.js, copies what the user's sprite library already has (free), and draws only the missing poses on the user's image service in the clumsy MS Paint style (6 figures per picture, about $0.01-0.03 a picture). Run it after writing or changing the scenes, then check_preview. Returns the new sprites as an image to look at.`,
      schema: {},
      handler: async () => {
        const p = getProject(projectId);
        if (baseOf(p.style_id) !== "stickman") return text("make_sprites is for the stick-figure style only.");
        if (!activeProvider(projectId))
          return text(
            "No image service is set up (Settings > Media > Image generation). The scenes still draw: figures without sprites use the drawn stick-figure rig.",
          );
        const r = await makeSprites(p.path);
        const lines = [
          `Characters: ${r.characters.join(", ") || "none in the scenes"}. Reused from the library: ${r.reused}. Newly drawn: ${r.made} sprites in ${r.pictures} picture(s) (about $${r.cost.toFixed(2)}).`,
        ];
        if (r.failed.length) lines.push(`Not made (they fall back to the drawn rig until fixed): ${r.failed.join("; ")}`);
        if (r.newKeys.length)
          lines.push(
            "New: " +
              r.newKeys.join(", ") +
              ". Look at them below; a wrong one: change its pose/face in the scene or the cast desc and run make_sprites again.",
          );
        const content = [{ type: "text", text: lines.join("\n") }];
        for (const f of r.sheets.slice(0, 4)) content.push(forClaude(f, 900));
        return { content };
      },
    },
    {
      name: "web_image",
      description:
        'Stick-figure and 3D reconstruction styles: a real photo from Wikimedia Commons (free licences, credited in assets/credits.txt), saved as IMG[name] (stick figures: `photo <pos> img=<name> text="caption"`; reconstruction: photo(name, { caption, credit })). Use for real places, objects, documents and people named in the narration, as often as the project\'s "real images per minute" says. Search in English with plain nouns ("Lake Nyos", "Heinrich Schliemann portrait").',
      schema: { query: z.string().min(2).max(120), name: z.string().regex(/^[a-zA-Z][\w-]{0,40}$/) },
      handler: async ({ query, name }) => {
        const p = getProject(projectId);
        if (!["stickman", "recon"].includes(baseOf(p.style_id)))
          return text("web_image is for the stick-figure and 3D reconstruction styles only.");
        const r = await webImage(p.path, query, name);
        if (!r) return text(`Nothing usable on Wikimedia Commons for "${query}". Try a simpler or different query, or draw it instead.`);
        return {
          content: [
            {
              type: "text",
              text: `Saved IMG.${name} = assets/${r.rel} (${r.title}). Credit: ${r.credit}. Check it shows what the narration says; if not, search again with another name.`,
            },
            forClaude(r.file, 640),
          ],
        };
      },
    },
    {
      name: "lowpoly_asset",
      description: `Every 3D style that can load models (Low poly, 3D reconstruction, 3D cartoon, styles with the Videoxx asset loader) unless the user switched the library off for the style: the 3D asset library (the app's seed library + every model saved on this computer). action "search": ranked matches for words (query, optional kind: prop | character | animal | vehicle | set | texture | animation) with id, size in metres, clips. ALWAYS search before building anything by code. action "add": save a free model you found on the web (or a .glb in the project) into the library so every later video can reuse it: id (kind prefix: prop.<name>, animal.<name>, vehicle.<name>, set.<name>), kind, name, tags, licence (CC0, public domain, CC-BY 3.0/4.0 only; NC / ND / SA / personal use are refused), licence_quote (what the page says), author, source_url (the page stating the licence), credit_text (CC-BY: the exact credit line), url (a direct https link to the .glb) or file. Uncompressed .glb only (no Draco / Meshopt), under 8 MB, origin at the bottom centre and front +Z preferred (else note it). action "credits": the description credits of every library asset the scenes use (the app also keeps them in DESCRIPTION.txt).`,
      schema: {
        action: z.enum(["search", "add", "credits"]),
        query: z.string().max(120).optional(),
        kind: z.string().max(20).optional(),
        id: z.string().max(80).optional(),
        name: z.string().max(80).optional(),
        tags: z.array(z.string().max(30)).max(20).optional(),
        licence: z.string().max(80).optional(),
        licence_quote: z.string().max(400).optional(),
        author: z.string().max(120).optional(),
        source_url: z.string().max(400).optional(),
        credit_text: z.string().max(400).optional(),
        url: z.string().max(800).optional(),
        file: z.string().max(300).optional(),
        size_m: z.array(z.number()).length(3).optional(),
        forward: z.string().max(4).optional(),
        note: z.string().max(300).optional(),
      },
      handler: async (a) => {
        const p = getProject(projectId);
        {
          const why = require("./videoxx-assets").gate(p, baseOf(p.style_id));
          if (why) return text(why);
        }
        const L = await import("../../characters/lowpoly");
        if (a.action === "search") {
          const r2 = await L.searchAssets(String(a.query || ""), a.kind);
          if (baseOf(p.style_id) !== "lowpoly" && r2.length)
            return text(require("./videoxx-assets").searchText(r2, L.lowpolyIndex(), baseOf(p.style_id), p.path));
          return text(
            r2.length
              ? r2
                  .map(
                    (e) =>
                      `${e.id}  [${e.kind}] ${e.name}${e.size_m ? `  ${e.size_m.map((v) => +v.toFixed(2)).join(" x ")} m` : ""}${e.clips ? `  ${e.clips} clips` : ""}  ${e.licence}${e.user ? "  (saved find)" : ""}`,
                  )
                  .join("\n")
              : `Nothing in the library for "${a.query}". Try other words (a synonym, the category), then build it from the kit or find a free model on the web and add it.`,
          );
        }
        if (a.action === "credits") {
          const t = await L.updateCredits(p.path);
          return text(t || "No library assets in the scenes yet.");
        }
        const r = await L.addAsset(a, p.path);
        lowpolyChanged();
        if (r.entry.id !== String(a.id || "").toLowerCase())
          return text(`This exact file is already in the library as ${r.entry.id} (${r.entry.licence}): use that id.`);
        return text(
          `Saved to the library: ${r.entry.id} (${r.entry.kind}, ${r.entry.licence}${r.info?.size_m ? `, ${r.info.size_m.join(" x ")} m` : ""}${r.info?.poly_count ? `, ${r.info.poly_count} triangles` : ""}${r.info?.animations?.length ? `, clips: ${r.info.animations.map((x) => x.name).join(", ")}` : ""}). Use it in a scene by its id, e.g. S.prop('${r.entry.id}', { at: [0, 0], height: <real height in m> }). Look at it in a frame before using it everywhere (size, facing, materials).`,
        );
      },
    },
    ...require("./videoxx-assetfind").toolDefs({ projectId, getProject, baseOf, text, z, lowpoly, changed: () => lowpolyChanged() }),
    {
      name: "remember_rule",
      description:
        'Suggest a reusable style rule learned from this request (e.g. "Never place the camera behind the character talked about"). The user approves it in the app before it applies to future sessions. scope: "global" for all videos, "project" for this video.',
      schema: { rule: z.string().min(8).max(300), scope: z.enum(["global", "project"]) },
      handler: async ({ rule, scope }) => {
        const id = uid("rul_");
        q.run(
          "INSERT INTO rules(id,scope,project_id,text,enabled,status,created_at) VALUES(?,?,?,?,1,?,?)",
          id,
          scope,
          scope === "project" ? projectId : null,
          rule.trim(),
          "suggested",
          now(),
        );
        onRuleSuggested({ id, scope, text: rule, projectId });
        return text("Suggested to the user. It applies once they accept it.");
      },
    },
  ];
  if (
    (() => {
      try {
        return isUltraPlus(getProject(projectId).style_id);
      } catch {
        return false;
      }
    })()
  )
    defs.push(...ultraPlusToolDefs(projectId, ledger));
  if (
    (() => {
      try {
        const p = getProject(projectId);
        return baseOf(p.style_id) === "recon" && fs.existsSync(path.join(p.path, "lib", "holdview.html"));
      } catch {
        return false;
      }
    })()
  )
    defs.push({
      name: "view_hold",
      description: `Check ONE hold before it goes into a shot (3D reconstruction, references/hands.md + the SOP): a person (body male / female / custom:<id>, finish) holding one prop with one grip, rendered as close-ups over the clips and times you give, with the hold check's numbers per frame (fingers or body inside the prop in mm, palm gap, second hand, the ear for a phone, verified or not). module / fn / args build the prop (the kit: lib/props.js, fn prop, args ["smartphone"]; your own: lib/props/<name>.js), grip = the grip name (or a JSON grip you are designing), side R / L, use (e.g. ear), clips = catalog clip names (default the grip's own + idle + walk), times in seconds within the clips. Clean on every row and right by eye = the hold may be used; else fix the grip and look again. Costs one image.`,
      schema: {
        module: z.string().min(3).max(120).optional(),
        fn: z.string().min(1).max(60).optional(),
        args: z.array(z.any()).max(4).optional(),
        grip: z.string().min(1).max(600),
        side: z.enum(["R", "L"]).optional(),
        use: z.string().max(40).optional(),
        body: z.string().max(60).optional(),
        finish: z.enum(["matte", "glossy", "glow"]).optional(),
        clips: z.array(z.string().max(80)).max(6).optional(),
        times: z.array(z.number().min(0)).max(8).optional(),
      },
      handler: async (a) => {
        const mod = (a.module ?? "lib/props.js").replace(/\\/g, "/"),
          rel = path.relative(dir(), path.resolve(dir(), mod));
        if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(path.join(dir(), rel)))
          return text(`view_hold: ${mod} is not a file in this project.`);
        if (ledger?.over) {
          tally(ledger, "view_hold", { refused: 1 });
          return text(budgetText(ledger));
        }
        try {
          const r = await viewHold(projectId, {
            mod,
            fn: a.fn ?? "prop",
            args: JSON.stringify(a.args ?? []),
            grip: a.grip,
            side: a.side,
            use: a.use,
            body: a.body,
            finish: a.finish,
            clip: a.clips?.length ? a.clips.join(",") : void 0,
            times: a.times?.length ? a.times.join(",") : void 0,
          });
          const lines = [
            `hold ${a.grip} of ${mod} ${a.fn ?? "prop"}(${(a.args ?? []).map((x) => JSON.stringify(x)).join(", ")}): ${JSON.stringify(r.report)}`.slice(
              0,
              6e3,
            ),
            ...(r.errors.length ? ["Errors:", ...r.errors.slice(-6)] : []),
          ].join("\n");
          if (!r.png) {
            tally(ledger, "view_hold", { calls: 1 });
            return text(lines);
          }
          const im = claudeImage(r.png, 1600);
          tally(ledger, "view_hold", { calls: 1, images: 1, tokens: im.tokens });
          if (ledger) spend(ledger, im.tokens, 1);
          return { content: [{ type: "text", text: lines }, im.block] };
        } catch (e) {
          return text(`view_hold: ${e?.message || e}`);
        }
      },
    });
  if (
    (() => {
      try {
        const p = getProject(projectId);
        return baseOf(p.style_id) === "recon" && fs.existsSync(path.join(p.path, "lib", "propview.html"));
      } catch {
        return false;
      }
    })()
  )
    defs.push({
      name: "view_prop",
      description: `Look at ONE prop alone before it goes into a scene (3D reconstruction, references/props.md): renders it on a neutral floor as a 2x2 sheet (front, side, 3/4 from above, top; its size in cm, its front marked) and reports its measured size, its lowest point, loose parts not touching the rest, floating and through parts. module = the file that builds it, from the project folder (lib/props.js for the kit, lib/props/<name>.js for your own), fn = the exported builder, args = its arguments (JSON array, e.g. ["monitor"] for the kit's prop()), expect = its real-world size [w, h, d] in metres (compared). Fix the prop until the sheet looks right and the report is clean, then place it with place(). Costs one image.`,
      schema: {
        module: z.string().min(3).max(120),
        fn: z.string().min(1).max(60),
        args: z.array(z.any()).max(4).optional(),
        expect: z.array(z.number()).length(3).optional(),
      },
      handler: async ({ module: module2, fn, args, expect }) => {
        const rel = path.relative(dir(), path.resolve(dir(), module2));
        if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(path.join(dir(), rel)))
          return text(`view_prop: ${module2} is not a file in this project.`);
        if (ledger?.over) {
          tally(ledger, "view_prop", { refused: 1 });
          return text(budgetText(ledger));
        }
        try {
          const r = await viewProp(projectId, { mod: module2.replace(/\\/g, "/"), fn, args: args ?? [], expect: expect ?? null });
          const lines = [
            `${module2} ${fn}(${(args ?? []).map((a) => JSON.stringify(a)).join(", ")}): ${JSON.stringify(r.report)}`,
            ...(r.errors.length ? ["Errors:", ...r.errors.slice(-6)] : []),
          ].join("\n");
          if (!r.png) {
            tally(ledger, "view_prop", { calls: 1 });
            return text(lines);
          }
          const im = claudeImage(r.png, 1600);
          tally(ledger, "view_prop", { calls: 1, images: 1, tokens: im.tokens });
          if (ledger) spend(ledger, im.tokens, 1);
          return { content: [{ type: "text", text: lines }, im.block] };
        } catch (e) {
          return text(`view_prop: ${e?.message || e}`);
        }
      },
    });
  const look = {
    over: () => !!ledger?.over,
    spend: (t) => {
      if (ledger) spend(ledger, t, 1);
    },
    budgetText: () => (ledger ? budgetText(ledger) : ""),
  };
  if (!libraryOff()) defs.push(...libraryToolDefs(projectId, look));
  const all = (() => {
    try {
      return studioOf(projectId) ? [...defs, ...studioToolDefs(projectId, ledger)] : defs;
    } catch {
      return defs;
    }
  })();
  if (!ledger) return all;
  return all.map((d) => ({
    ...d,
    handler: async (a) => {
      tally(ledger, d.name, { calls: 1 });
      const res = await d.handler(a);
      if (d.name !== "render_frames" && d.name !== "render_view") {
        for (const c of res?.content ?? [])
          if (c?.type === "image") {
            let t = 0;
            try {
              const s = nativeImage.createFromBuffer(Buffer.from(c.data, "base64")).getSize();
              t = imageTokens(s.width, s.height);
            } catch {}
            tally(ledger, d.name, { images: 1, tokens: t });
          }
      }
      return res;
    },
  }));
}
