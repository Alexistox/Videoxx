import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { log } from "../core/log";
import { getSecret, secretHint, setSecret } from "../core/secrets";
import { now, q, uid } from "../db/db";

const BASE = () => (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_HIGGSFIELD_BASE) || "https://api.higgsfield.ai";
const KEY = "higgsfield";
const QUALITY_25 = ["low", "medium", "high", "xhigh", "max"];
const ASPECTS = ["16:9", "1:1", "4:3", "3:4", "3:2", "2:3", "9:16", "21:9", "auto"];
const ASPECTS_STD = ["16:9", "1:1", "4:3", "3:4", "3:2", "2:3", "9:16", "21:9"];
const gpt = (id) => ({
  path: () => id,
  body: (p) => ({
    prompt: p.prompt,
    aspect_ratio: p.aspect,
    resolution: p.resolution,
    quality: p.quality,
    enhance_prompt: false,
    ...(p.urls.length ? { image_urls: p.urls } : {}),
  }),
});
export const MODELS = [
  {
    id: "marketing-studio/image/sunburst",
    label: "GPT Image 2.5 Sunburst",
    short: "GPT 2.5 Sunburst",
    note: "Best quality, follows references closely",
    quality: QUALITY_25,
    defQuality: "high",
    aspects: ASPECTS,
    resolutions: ["1k", "2k", "4k"],
    maxRefs: 16,
    ...gpt("marketing-studio/image/sunburst"),
  },
  {
    id: "marketing-studio/image/flare",
    label: "GPT Image 2.5 Flare",
    short: "GPT 2.5 Flare",
    note: "Faster, a little less detail",
    quality: QUALITY_25,
    defQuality: "high",
    aspects: ASPECTS,
    resolutions: ["1k", "2k", "4k"],
    maxRefs: 16,
    ...gpt("marketing-studio/image/flare"),
  },
  {
    id: "ideogram/v4.0",
    label: "Ideogram 4.0",
    short: "Ideogram 4",
    note: "The best at text in the image (titles, big words); one reference",
    quality: ["turbo", "default", "quality"],
    defQuality: "default",
    aspects: ASPECTS_STD,
    resolutions: [],
    maxRefs: 1,
    path: () => "ideogram/v4.0",
    body: (p) => ({
      prompt: p.prompt,
      aspect_ratio: p.aspect,
      rendering_speed: p.quality.toUpperCase(),
      ...(p.urls[0] ? { image_url: p.urls[0] } : {}),
    }),
  },
  {
    id: "xai/grok-imagine-image-2.0",
    label: "Grok Imagine 2.0",
    short: "Grok Imagine",
    note: "Images and precise edits of references",
    quality: ["low", "medium"],
    defQuality: "medium",
    aspects: ["16:9", "1:1", "4:3", "3:4", "3:2", "2:3", "9:16", "auto"],
    resolutions: ["1k", "2k"],
    maxRefs: 10,
    path: () => "xai/grok-imagine-image-2.0",
    body: (p) => ({
      prompt: p.prompt,
      aspect_ratio: p.aspect,
      resolution: p.resolution,
      quality: p.quality,
      ...(p.urls.length ? { image_urls: p.urls } : {}),
    }),
  },
  {
    id: "alibaba/qwen-image-3",
    label: "Qwen Image 3",
    short: "Qwen Image 3",
    note: "Edits from an instruction, up to 3 references",
    quality: [],
    defQuality: "",
    aspects: ASPECTS_STD,
    resolutions: ["1k", "2k"],
    maxRefs: 3,
    path: (refs) => (refs ? "alibaba/qwen-image-3/edit" : "alibaba/qwen-image-3/text-to-image"),
    body: (p) => ({ prompt: p.prompt, aspect_ratio: p.aspect, resolution: p.resolution, ...(p.urls.length ? { image_urls: p.urls } : {}) }),
  },
  {
    id: "marketing-studio/image",
    label: "Marketing Studio Image",
    short: "Marketing Studio",
    note: "Campaign-style images",
    quality: ["low", "medium", "high"],
    defQuality: "high",
    aspects: ASPECTS,
    resolutions: ["1k", "2k", "4k"],
    maxRefs: 16,
    ...gpt("marketing-studio/image"),
  },
  {
    id: "z-image/turbo",
    label: "Z-Image Turbo",
    short: "Z-Image Turbo",
    note: "Fast drafts with clean text; no references",
    quality: [],
    defQuality: "",
    aspects: ASPECTS_STD,
    resolutions: ["1k", "2k"],
    maxRefs: 0,
    path: () => "z-image/turbo",
    body: (p) => ({ prompt: p.prompt, aspect_ratio: p.aspect, resolution: p.resolution }),
  },
  {
    id: "higgsfield-ai/soul/v2/standard",
    label: "Soul 2",
    short: "Soul 2",
    note: "Realistic people and fashion; no references",
    quality: [],
    defQuality: "",
    aspects: ["16:9", "1:1", "4:3", "3:4", "3:2", "2:3", "9:16"],
    resolutions: ["720p", "1080p"],
    maxRefs: 0,
    path: () => "higgsfield-ai/soul/v2/standard",
    body: (p) => ({ prompt: p.prompt, aspect_ratio: p.aspect, resolution: p.resolution, batch_size: 1, enhance_prompt: false }),
  },
  {
    id: "recraft/v4.1/text-to-image",
    label: "Recraft V4.1",
    short: "Recraft V4.1",
    note: "Illustrations and graphic styles; no references",
    quality: [],
    defQuality: "",
    aspects: ["16:9", "1:1", "4:3", "3:4", "3:2", "2:3", "9:16"],
    resolutions: ["1k"],
    maxRefs: 0,
    path: () => "recraft/v4.1/text-to-image",
    body: (p) => ({ prompt: p.prompt, aspect_ratio: p.aspect, resolution: p.resolution, output_format: "png" }),
  },
];
export const modelInfo = () => MODELS.map(({ path: _p, body: _b, ...m }) => m);
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32,128}$/i;
export function keyStatus() {
  const hint = secretHint(KEY);
  return { hasKey: !!hint, hint };
}
export async function setKey(key2) {
  if (!key2) {
    setSecret(KEY, null);
    return keyStatus();
  }
  key2 = key2.trim();
  if (!KEY_RE.test(key2))
    throw new Error(
      "That does not look like a Higgsfield API key. It has two parts: KEY_ID:KEY_SECRET (copy both from cloud.higgsfield.ai, API keys).",
    );
  const r = await fetch(`${BASE()}/requests/00000000-0000-0000-0000-000000000000/status`, {
    headers: { Authorization: `Key ${key2}` },
  }).catch((e) => {
    throw new Error("Could not reach Higgsfield: " + e.message);
  });
  if (r.status === 401 || r.status === 403)
    throw new Error("Higgsfield did not accept this key. Check that you copied both parts (KEY_ID:KEY_SECRET) and that the key is active.");
  setSecret(KEY, key2);
  return keyStatus();
}
function auth() {
  const k = getSecret(KEY);
  if (!k) throw new Error("Add your Higgsfield API key in Settings first (Settings > Media > Image generation).");
  return `Key ${k}`;
}
async function api(url, init = {}) {
  const r = await fetch(url.startsWith("http") ? url : BASE() + url, {
    ...init,
    headers: { Authorization: auth(), "Content-Type": "application/json", ...(init.headers || {}) },
  }).catch((e) => {
    const err = new Error(`Could not reach Higgsfield (${e.cause?.code || e.message}). Check the internet connection and try again.`);
    err.network = true;
    throw err;
  });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!r.ok) {
    const detail =
      typeof body === "string"
        ? body
        : body?.detail
          ? typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail)
          : JSON.stringify(body);
    const msg =
      /credit/i.test(detail) || r.status === 402
        ? "Your Higgsfield account has no API credits left for this image. Add credits at cloud.higgsfield.ai (Billing), then run it again. Nothing was charged."
        : r.status === 401
          ? "Higgsfield rejected the API key (Settings > Media > Image generation)."
          : r.status === 403
            ? `Higgsfield refused this request (${String(detail).slice(0, 200)}).`
            : r.status === 429 || /concurren/i.test(detail)
              ? "Higgsfield is busy with your other images (4 at a time). This one will need to be run again."
              : `Higgsfield answered ${r.status}: ${String(detail).slice(0, 300)}`;
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return body;
}
const uploads = new Map();
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
async function upload(file) {
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`${path.basename(file)}: references must be PNG, JPEG, WebP or GIF.`);
  const buf = fs.readFileSync(file);
  if (buf.length > 20 * 1024 * 1024) throw new Error(`${path.basename(file)} is over 20 MB; use a smaller reference.`);
  const hash = crypto.createHash("sha1").update(buf).digest("hex"),
    hit = uploads.get(hash);
  if (hit && Date.now() - hit.at < 6 * 36e5) return hit.url;
  const u = await api("/files/generate-upload-url", { method: "POST", body: JSON.stringify({ content_type: type }) });
  const put = await fetch(u.upload_url, { method: "PUT", headers: u.upload_headers || { "Content-Type": type }, body: buf });
  if (!put.ok) throw new Error(`Uploading ${path.basename(file)} failed (${put.status}).`);
  uploads.set(hash, { url: u.public_url, at: Date.now() });
  return u.public_url;
}
const MAX = 4;
let active = 0;
const waiting = [];
const cancelled = new Set(),
  cancelUrls = new Map();
const slot = () =>
  new Promise((res) => {
    if (active < MAX) {
      active++;
      res();
    } else
      waiting.push(() => {
        active++;
        res();
      });
  });
const release = () => {
  active--;
  waiting.shift()?.();
};
const row = (id) => q.get("SELECT * FROM generations WHERE id=?", id);
function set(id, patch, emit) {
  const keys = Object.keys(patch);
  q.run(`UPDATE generations SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`, ...keys.map((k) => patch[k]), id);
  const r = row(id);
  emit({ id, boardId: r.board_id, nodeId: r.node_id, status: r.status, file: r.file, error: r.error });
}
function resolveRefs(prompt, names) {
  return prompt.replace(/@([\w.-]+)/g, (m, n) => {
    const i = names.indexOf(n);
    return i >= 0 ? `image ${i + 1}` : m;
  });
}
export function startGeneration(boardId, nodeId, dir, req, emit) {
  const model = MODELS.find((m) => m.id === req.model) ?? MODELS[0];
  const prompt = String(req.prompt || "").trim();
  if (!prompt) throw new Error("Write a prompt first.");
  if (prompt.length > 5e3) throw new Error("The prompt is over 5000 characters.");
  if (req.refs.length && !model.maxRefs)
    throw new Error(`${model.label} can't use reference images. Disconnect them, or pick GPT Image 2.5, Grok, Qwen or Ideogram.`);
  if (req.refs.length > model.maxRefs)
    throw new Error(`${model.label} takes at most ${model.maxRefs} reference image${model.maxRefs === 1 ? "" : "s"}.`);
  auth();
  const id = uid("gen_");
  const params = {
    aspect_ratio: model.aspects.includes(req.aspect) ? req.aspect : model.aspects[0],
    resolution: model.resolutions.includes(req.resolution)
      ? req.resolution
      : model.resolutions.includes("2k")
        ? "2k"
        : (model.resolutions[model.resolutions.length - 1] ?? ""),
    quality: model.quality.includes(req.quality) ? req.quality : model.defQuality,
  };
  q.run(
    "INSERT INTO generations(id,board_id,node_id,model,prompt,params,refs,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    id,
    boardId,
    nodeId,
    model.id,
    prompt,
    JSON.stringify(params),
    JSON.stringify(req.refs.map((f) => path.basename(f))),
    "queued",
    now(),
  );
  (async () => {
    await slot();
    try {
      if (cancelled.has(id)) return set(id, { status: "canceled", finished_at: now() }, emit);
      set(id, { status: "uploading" }, emit);
      const urls = [];
      for (const f of req.refs) urls.push(await upload(f));
      if (cancelled.has(id)) return set(id, { status: "canceled", finished_at: now() }, emit);
      const body = model.body({
        prompt: resolveRefs(prompt, req.refNames ?? []),
        urls,
        aspect: params.aspect_ratio,
        resolution: params.resolution,
        quality: params.quality,
      });
      const sub = await api("/" + model.path(urls.length), { method: "POST", body: JSON.stringify(body) });
      if (sub.cancel_url) cancelUrls.set(id, sub.cancel_url);
      set(id, { status: "queued-remote", request_id: sub.request_id }, emit);
      await poll(id, sub.status_url || `/requests/${sub.request_id}/status`, dir, emit);
    } catch (e) {
      log("generation failed", id, e.message);
      set(id, { status: "failed", error: String(e.message).slice(0, 500), finished_at: now() }, emit);
    } finally {
      release();
    }
  })();
  return row(id);
}
async function poll(id, statusUrl, dir, emit) {
  let delay = 2e3;
  const t0 = Date.now();
  while (true) {
    if (cancelled.has(id)) {
      const rid = row(id).request_id;
      try {
        if (rid) await api(cancelUrls.get(id) ?? `/requests/${rid}/cancel`, { method: "POST" });
      } catch {}
      return set(id, { status: "canceled", finished_at: now() }, emit);
    }
    if (Date.now() - t0 > 15 * 6e4)
      return set(id, { status: "failed", error: "Higgsfield took longer than 15 minutes; try again.", finished_at: now() }, emit);
    await new Promise((r) => setTimeout(r, delay + Math.random() * 500));
    delay = Math.min(1e4, delay * 1.5);
    let s;
    try {
      s = await api(statusUrl);
    } catch (e) {
      if (e.status && e.status < 500) throw e;
      continue;
    }
    if (s.status === "in_progress" && row(id).status !== "in_progress") set(id, { status: "in_progress" }, emit);
    if (s.status === "completed") {
      const url = s.images?.[0]?.url;
      if (!url) throw new Error("Higgsfield finished without an image.");
      const img = await fetch(url);
      if (!img.ok) throw new Error(`Downloading the image failed (${img.status}).`);
      const type = img.headers.get("content-type") || "",
        ext = /jpe?g/.test(type) ? ".jpg" : /webp/.test(type) ? ".webp" : ".png";
      fs.mkdirSync(dir, { recursive: true });
      const file = `gen-${id.slice(4)}${ext}`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(await img.arrayBuffer()));
      return set(id, { status: "completed", file, finished_at: now() }, emit);
    }
    if (s.status === "failed")
      return set(id, { status: "failed", error: s.error || "Higgsfield could not make this image.", finished_at: now() }, emit);
    if (s.status === "nsfw")
      return set(
        id,
        {
          status: "failed",
          error: "Higgsfield blocked this image as unsafe content. Change the prompt or the references. (Not charged.)",
          finished_at: now(),
        },
        emit,
      );
    if (s.status === "canceled") return set(id, { status: "canceled", finished_at: now() }, emit);
  }
}
export function cancelGeneration(id) {
  cancelled.add(id);
}
export async function generateBuffer(req) {
  const model = MODELS.find((m) => m.id === req.model) ?? MODELS[0];
  const prompt = String(req.prompt || "").trim();
  if (!prompt) throw new Error("Write a prompt first.");
  if (req.refs.length > model.maxRefs)
    throw new Error(`${model.label} takes at most ${model.maxRefs} reference image${model.maxRefs === 1 ? "" : "s"}.`);
  auth();
  await slot();
  try {
    const urls = [];
    for (const f of req.refs) urls.push(await upload(f));
    const sub = await api("/" + model.path(urls.length), {
      method: "POST",
      body: JSON.stringify({
        ...model.body({ prompt, urls, aspect: req.aspect, resolution: req.resolution, quality: req.quality }),
        ...(req.extra || {}),
      }),
    });
    let delay = 2e3;
    const t0 = Date.now(),
      statusUrl = sub.status_url || `/requests/${sub.request_id}/status`;
    while (true) {
      if (Date.now() - t0 > 10 * 6e4) throw new Error("Higgsfield took longer than 10 minutes; try again.");
      await new Promise((r) => setTimeout(r, delay + Math.random() * 400));
      delay = Math.min(8e3, delay * 1.5);
      let s;
      try {
        s = await api(statusUrl);
      } catch (e) {
        if (e.status && e.status < 500) throw e;
        continue;
      }
      if (s.status === "completed") {
        const url = s.images?.[0]?.url;
        if (!url) throw new Error("Higgsfield finished without an image.");
        const img = await fetch(url);
        if (!img.ok) throw new Error(`Downloading the image failed (${img.status}).`);
        const type = img.headers.get("content-type") || "";
        return { buf: Buffer.from(await img.arrayBuffer()), ext: /jpe?g/.test(type) ? ".jpg" : /webp/.test(type) ? ".webp" : ".png" };
      }
      if (s.status === "failed") throw new Error(s.error || "Higgsfield could not make this image.");
      if (s.status === "nsfw") throw new Error("Higgsfield blocked this image as unsafe content (not charged). Change the prompt.");
      if (s.status === "canceled") throw new Error("The image was canceled.");
    }
  } finally {
    release();
  }
}
export function resumeGenerations(dirOf, emit) {
  const rows = q.all("SELECT * FROM generations WHERE status IN ('queued','uploading','queued-remote','in_progress')");
  for (const r of rows) {
    if (!r.request_id) {
      q.run(
        "UPDATE generations SET status='failed', error=?, finished_at=? WHERE id=?",
        "The app closed before this image was sent. Run it again.",
        now(),
        r.id,
      );
      continue;
    }
    (async () => {
      await slot();
      try {
        await poll(r.id, `/requests/${r.request_id}/status`, dirOf(r.board_id), emit);
      } catch (e) {
        set(r.id, { status: "failed", error: String(e.message).slice(0, 500), finished_at: now() }, emit);
      } finally {
        release();
      }
    })();
  }
}
