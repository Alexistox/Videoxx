// Videoxx connector: voiceover through the Higgsfield CLI that is signed in on this computer
// (Text to Speech V2; no API key; credits come from the CLI's selected workspace).
// Contract (Videoxx Custom API): node adapter.mjs <request.json>
//   { "kind": "voice", "text", "language", "voice", "out" }  -> audio in "out"
//   { "kind": "voices", "out" }                              -> JSON list [{id, name}] in "out"
//   then prints: RESULT {"ext": ".mp3", "cost": 0}
// A voice id is "<voice_type>:<id>" (preset or element, as `higgsfield voices list` gives them).
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
const VARIANT = ["elevenlabs", "minimax", "seed_speech", "vibe_voice", "cozy_voice"].includes(settings.variant) ? settings.variant : "elevenlabs";
const LIMIT = { elevenlabs: 5000, vibe_voice: 5000, cozy_voice: 5000, minimax: 10000, seed_speech: 15000 }[VARIANT];

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

const run = (args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(cliPath(), args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || stdout || err.message).trim() || err.message));
      else resolve(String(stdout).replace(/^﻿/, ""));
    });
  });

function resultUrl(text) {
  try {
    const found = [];
    const walk = (v, key) => {
      if (typeof v === "string" && /^https?:\/\//.test(v) && key === "result_url") found.push(v);
      else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "params") walk(x, k);
    };
    walk(JSON.parse(text));
    if (found[0]) return found[0];
  } catch {
    // not JSON: look for a URL below
  }
  return text.match(/https?:\/\/\S+?\.(mp3|wav|m4a|ogg)\b/i)?.[0] ?? null;
}

async function voices() {
  const data = JSON.parse(await run(["voices", "list", "--json"], 120000));
  const list = Array.isArray(data) ? data : data.voices || data.data || data.items || [];
  return list
    .filter((v) => v && v.id && (v.status ?? "completed") === "completed")
    .sort((a, b) => (a.voice_type === "element" ? 0 : 1) - (b.voice_type === "element" ? 0 : 1))
    .map((v) => ({ id: `${v.voice_type || "preset"}:${v.id}`, name: String(v.name || v.id).slice(0, 80) }));
}

// Splits on sentence ends so every part fits the engine's character limit.
function parts(text) {
  const out = [];
  let cur = "";
  for (const s of text.match(/[^.!?。！？\n]+[.!?。！？]*\s*|\n+/g) || [text]) {
    if ((cur + s).length > LIMIT - 50 && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
    while (cur.length > LIMIT - 50) {
      out.push(cur.slice(0, LIMIT - 50));
      cur = cur.slice(LIMIT - 50);
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Joins WAV files with the same format into one (MP3 parts are simply concatenated).
function joinAudio(bufs, ext) {
  if (bufs.length === 1 || ext !== ".wav") return Buffer.concat(bufs);
  const dataOf = (b) => {
    let i = 12;
    while (i + 8 <= b.length) {
      const id = b.toString("ascii", i, i + 4), size = b.readUInt32LE(i + 4);
      if (id === "data") return { head: b.subarray(0, i + 8), data: b.subarray(i + 8, i + 8 + size) };
      i += 8 + size + (size % 2);
    }
    throw new Error("a WAV part has no data chunk");
  };
  const all = bufs.map(dataOf), data = Buffer.concat(all.map((x) => x.data)), head = Buffer.from(all[0].head);
  head.writeUInt32LE(head.length - 8 + data.length, 4);
  head.writeUInt32LE(data.length, head.length - 4);
  return Buffer.concat([head, data]);
}

const req = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^﻿/, ""));
try {
  if (req.kind === "voices") {
    fs.writeFileSync(req.out, JSON.stringify(await voices()));
    console.log(`RESULT ${JSON.stringify({ ext: ".json", cost: 0 })}`);
    process.exit(0);
  }
  if (req.kind !== "voice") fail(`This connector speaks text, not "${req.kind}".`);
  let [type, id] = String(req.voice || settings.voice || "").split(":");
  if (!id) {
    const first = (await voices())[0];
    if (!first) fail("No Higgsfield voices are available on this account.");
    [type, id] = first.id.split(":");
  }
  const bufs = [];
  let ext = ".mp3";
  for (const text of parts(String(req.text || ""))) {
    const out = await run(["generate", "create", "text2speech_v2", "--prompt", text, "--variant", VARIANT, "--voice_id", id, "--voice_type", type, "--wait", "--wait-timeout", "15m", "--json"], 16 * 60 * 1000);
    const url = resultUrl(out);
    if (!url) fail(`Higgsfield gave no audio: ${out.trim().slice(0, 200)}`);
    const res = await fetch(url);
    if (!res.ok) fail(`Could not download the audio (HTTP ${res.status}).`);
    const typeHeader = res.headers.get("content-type") || "";
    ext = /wav/.test(typeHeader) || /\.wav(\?|$)/i.test(url) ? ".wav" : /mp4|m4a/.test(typeHeader) || /\.m4a(\?|$)/i.test(url) ? ".m4a" : /ogg/.test(typeHeader) ? ".ogg" : ".mp3";
    bufs.push(Buffer.from(await res.arrayBuffer()));
  }
  if (!bufs.length) fail("There was no text to speak.");
  fs.writeFileSync(req.out, joinAudio(bufs, ext));
  console.log(`RESULT ${JSON.stringify({ ext, cost: 0 })}`);
} catch (e) {
  fail(e.message);
}
