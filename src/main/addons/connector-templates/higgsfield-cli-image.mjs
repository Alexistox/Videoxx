// Videoxx connector: pictures through the Higgsfield CLI that is signed in on this computer
// (no API key; credits come from the CLI's selected workspace).
// Contract (Videoxx Custom API): node adapter.mjs <request.json>
//   request: { "kind": "image", "prompt", "aspect", "refs": [paths], "model"?, "out" }
//   writes the picture to "out", prints: RESULT {"ext": ".png", "cost": 0}
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const settings = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, "connector.json"), "utf8"));
  } catch {
    return {};
  }
})();

function fail(msg) {
  console.log(String(msg).split("\n").find((l) => l.trim()) || "failed");
  process.exit(1);
}

function cliPath() {
  const tries = [
    process.env.VX_HIGGSFIELD_CLI,
    settings.cliPath,
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@higgsfield", "cli", "vendor", "hf.exe"),
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@higgsfield", "cli", "vendor", "hf"),
  ].filter(Boolean);
  const found = tries.find((p) => fs.existsSync(p));
  if (!found) fail("Higgsfield CLI not found. Install it (npm install -g @higgsfield/cli) and sign in (higgsfield auth login).");
  return found;
}

const run = (exe, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || stdout || err.message).trim() || err.message));
      else resolve(String(stdout));
    });
  });

// Every result URL in the CLI's JSON answer (result_url first).
function resultUrls(text) {
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return [...text.matchAll(/https?:\/\/\S+?\.(png|jpe?g|webp)\b/gi)].map((m) => m[0]);
  }
  const found = [];
  const walk = (v, key) => {
    if (typeof v === "string" && /^https?:\/\//.test(v) && /result_url|url/i.test(key || "") && !/thumbnail|min_result/i.test(key || "")) found.push({ v, first: key === "result_url" });
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "params") walk(x, k);
  };
  walk(data);
  return found.sort((a, b) => b.first - a.first).map((x) => x.v);
}

const ASPECTS = new Set(["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"]);

const req = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^﻿/, ""));
if (req.kind !== "image") fail(`This connector makes pictures, not "${req.kind}".`);
const model = /^[a-z0-9_]+$/.test(String(req.model || "")) ? req.model : settings.model || "nano_banana_flash";
const args = ["generate", "create", model, "--prompt", String(req.prompt || "")];
if (ASPECTS.has(req.aspect)) args.push("--aspect_ratio", req.aspect);
for (const ref of (req.refs || []).filter((r) => r && fs.existsSync(r))) args.push("--image-references", ref);
args.push("--wait", "--wait-timeout", "10m", "--json");

try {
  const out = await run(cliPath(), args, 11 * 60 * 1000);
  const url = resultUrls(out)[0];
  if (!url) fail(`Higgsfield gave no picture: ${out.trim().slice(0, 200)}`);
  const res = await fetch(url);
  if (!res.ok) fail(`Could not download the picture (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") || "";
  const ext = /webp/.test(type) || /\.webp(\?|$)/i.test(url) ? ".webp" : /jpe?g/.test(type) || /\.jpe?g(\?|$)/i.test(url) ? ".jpg" : ".png";
  fs.writeFileSync(req.out, buf);
  console.log(`RESULT ${JSON.stringify({ ext, cost: 0 })}`);
} catch (e) {
  fail(e.message);
}
