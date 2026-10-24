import path from "node:path";
import fs from "node:fs";
import { getSecret, secretHint, setSecret } from "../core/secrets";

const BASE = () => (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_FAL_BASE) || "https://queue.fal.run";
const KEY = "fal";
export const FAL_MODEL = "fal-ai/flux-2",
  FAL_EDIT = "fal-ai/flux-2/edit",
  FAL_COST = 0.012;
const SIZES = {
  "1:1": [1024, 1024],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "3:2": [1216, 832],
  "2:3": [832, 1216],
  "4:3": [1152, 896],
  "3:4": [896, 1152],
};
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
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
  if (!/^[\w-]{8,}:[\w-]{16,}$/.test(key2))
    throw new Error("That does not look like a Fal.ai API key. It looks like KEY_ID:KEY_SECRET (copy it from fal.ai/dashboard/keys).");
  const r = await fetch(`${BASE()}/${FAL_MODEL}/requests/00000000-0000-0000-0000-000000000000/status`, {
    headers: { Authorization: `Key ${key2}` },
  }).catch((e) => {
    throw new Error("Could not reach Fal.ai: " + e.message);
  });
  if (r.status === 401)
    throw new Error("Fal.ai did not accept this key. Check that you copied all of it and that the key is active (fal.ai/dashboard/keys).");
  setSecret(KEY, key2);
  return keyStatus();
}
function auth() {
  const k = getSecret(KEY);
  if (!k) throw new Error("Add your Fal.ai API key in Settings first (Settings > Media > Image generation).");
  return `Key ${k}`;
}
async function api(url, init = {}) {
  const r = await fetch(url.startsWith("http") ? url : BASE() + url, {
    ...init,
    headers: { Authorization: auth(), "Content-Type": "application/json", ...(init.headers || {}) },
  }).catch((e) => {
    throw new Error(`Could not reach Fal.ai (${e.cause?.code || e.message}). Check the internet connection and try again.`);
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
    const msg = /balance|locked|credit/i.test(detail)
      ? "Your Fal.ai account has no credits left for this image. Add credits at fal.ai/dashboard/billing, then run it again."
      : r.status === 401
        ? "Fal.ai rejected the API key (Settings > Media > Image generation)."
        : r.status === 429
          ? "Fal.ai is busy with your other images. This one will need to be run again."
          : `Fal.ai answered ${r.status}: ${String(detail).slice(0, 300)}`;
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return body;
}
const dataUri = (file) => {
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`${path.basename(file)}: references must be PNG, JPEG, WebP or GIF.`);
  const buf = fs.readFileSync(file);
  if (buf.length > 20 * 1024 * 1024) throw new Error(`${path.basename(file)} is over 20 MB; use a smaller reference.`);
  return `data:${type};base64,${buf.toString("base64")}`;
};
export async function generate(req) {
  const prompt = String(req.prompt || "").trim();
  if (!prompt) throw new Error("Write a prompt first.");
  auth();
  const [width, height] = SIZES[req.aspect] ?? SIZES["1:1"],
    refs = req.refs.slice(0, 4);
  const body = {
    prompt,
    image_size: { width, height },
    num_images: 1,
    output_format: "png",
    enable_safety_checker: true,
    ...(refs.length ? { image_urls: refs.map(dataUri) } : {}),
  };
  const sub = await api("/" + (refs.length ? FAL_EDIT : FAL_MODEL), { method: "POST", body: JSON.stringify(body) });
  const model = refs.length ? FAL_EDIT : FAL_MODEL;
  const statusUrl = sub.status_url || `/${model}/requests/${sub.request_id}/status`,
    resultUrl = sub.response_url || `/${model}/requests/${sub.request_id}`;
  let delay = 1500;
  const t0 = Date.now();
  while (true) {
    if (Date.now() - t0 > 10 * 6e4) throw new Error("Fal.ai took longer than 10 minutes; try again.");
    await new Promise((r) => setTimeout(r, delay + Math.random() * 400));
    delay = Math.min(8e3, delay * 1.5);
    let s;
    try {
      s = await api(statusUrl);
    } catch (e) {
      if (e.status && e.status < 500) throw e;
      continue;
    }
    if (s.status !== "COMPLETED") continue;
    if (s.error) throw new Error(`Fal.ai could not make this image: ${String(s.error).slice(0, 300)}`);
    const out = await api(resultUrl);
    if (out?.has_nsfw_concepts?.[0]) throw new Error("Fal.ai blocked this image as unsafe content. Change the prompt.");
    const url = out?.images?.[0]?.url;
    if (!url) throw new Error("Fal.ai finished without an image.");
    const buf = url.startsWith("data:")
      ? Buffer.from(url.split(",")[1], "base64")
      : await fetch(url).then(async (r) => {
          if (!r.ok) throw new Error(`Downloading the image failed (${r.status}).`);
          return Buffer.from(await r.arrayBuffer());
        });
    return { buf, ext: ".png", cost: +(FAL_COST * ((width * height) / 1e6 + refs.length)).toFixed(4) };
  }
}
