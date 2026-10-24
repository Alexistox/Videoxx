import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";
import { app, nativeImage } from "electron";
import { log } from "../core/log";
import { getSecret, secretHint, setSecret } from "../core/secrets";
import { claudeExecutable, cleanEnv, lastStatus } from "../engines/claudeCli";
import { friendlyError, insideDir } from "../agent/sessions";

const root = () => process.env.CZ_CUSTOM_API_DIR || path.join(app.getPath("userData"), "custom-api");
const dirOf = (k) => path.join(root(), k);
const adapterOf = (k) => path.join(dirOf(k), "adapter.mjs");
const setupFile = (k) => path.join(dirOf(k), "setup.json");
const candidateFile = (k) => path.join(dirOf(k), "candidate.json");
const keyName = (k) => `custom-${k}-key`;
const WHAT = { image: "picture", voice: "voice" };
const states = { image: blank("image"), voice: blank("voice") };
const aborts = {};
function blank(kind) {
  return { kind, status: "idle", log: [], setup: null, keyHint: null };
}
let emit = () => {};
export function onCustomState(fn) {
  emit = fn;
}
export function readSetup(k) {
  try {
    return fs.existsSync(adapterOf(k)) ? JSON.parse(fs.readFileSync(setupFile(k), "utf8")) : null;
  } catch {
    return null;
  }
}
export const customReady = (k) => !!readSetup(k);
export function customState(k) {
  const s = states[k];
  return { ...s, log: s.log.slice(-200), setup: readSetup(k), keyHint: secretHint(keyName(k)) };
}
const set = (k, p) => {
  Object.assign(states[k], p);
  emit(customState(k));
};
const say = (k, line) => {
  states[k].log.push(line);
  if (states[k].log.length > 400) states[k].log.splice(0, 100);
  emit(customState(k));
};
export async function runAdapter(k, req, opts = {}) {
  const adapter = opts.adapter ?? adapterOf(k);
  if (!fs.existsSync(adapter)) throw new Error(`No custom ${WHAT[k]} API is set up (Settings > Media > Custom APIs).`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cz-custom-"));
  const out = String(req.out ?? path.join(work, k === "image" ? "out.png" : "out.mp3"));
  const reqFile = path.join(work, "request.json");
  fs.writeFileSync(reqFile, JSON.stringify({ kind: k, ...req, out }, null, 1));
  const env = { ...cleanEnv(), ELECTRON_RUN_AS_NODE: "1", CUSTOM_API_KEY: getSecret(keyName(k)) ?? "" };
  const text = await new Promise((res, rej) => {
    const p = cp.spawn(process.execPath, [adapter, reqFile], { cwd: path.dirname(adapter), env, windowsHide: true });
    let buf = "";
    p.stdout.on("data", (d) => (buf += d));
    p.stderr.on("data", (d) => (buf += d));
    const t = setTimeout(() => p.kill(), opts.timeoutMs ?? 5 * 6e4);
    opts.signal?.addEventListener("abort", () => p.kill());
    p.on("error", rej);
    p.on("close", (code) => {
      clearTimeout(t);
      res({ code, out: buf });
    });
  });
  const line = text.out
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith("RESULT "));
  let meta = {};
  try {
    meta = line ? JSON.parse(line.slice(7)) : {};
  } catch {}
  if (text.code !== 0 || !fs.existsSync(out) || !fs.statSync(out).size) {
    log("custom api failed", k, text.out.slice(-1500));
    throw new Error(
      `Your custom ${WHAT[k]} API failed (at your own risk): ${(
        text.out
          .trim()
          .split(/\r?\n/)
          .filter((l) => !l.startsWith("RESULT "))
          .pop() || "no output"
      ).slice(0, 300)}`,
    );
  }
  return { file: out, ext: String(meta.ext || path.extname(out) || (k === "image" ? ".png" : ".mp3")), cost: Number(meta.cost) || 0 };
}
export async function customPicture(req) {
  const r = await runAdapter("image", {
    prompt: req.prompt,
    aspect: req.aspect,
    refs: req.refs,
    ...(req.model ? { model: req.model } : {}),
  });
  const buf = fs.readFileSync(r.file);
  fs.rmSync(path.dirname(r.file), { recursive: true, force: true });
  if (nativeImage.createFromBuffer(buf).isEmpty())
    throw new Error("Your custom picture API returned something that is not a picture (at your own risk).");
  return { buf, cost: r.cost };
}
async function check(k, adapter, signal) {
  try {
    if (k === "image") {
      const r2 = await runAdapter(
        k,
        { prompt: "A red apple on a white table, studio light", aspect: "16:9", refs: [] },
        { adapter, signal },
      );
      const im = nativeImage.createFromBuffer(fs.readFileSync(r2.file)),
        { width, height } = im.getSize();
      if (im.isEmpty() || width < 64 || height < 64)
        return `It wrote ${r2.file}, but that is not a picture the app can open (PNG, JPEG or WebP, 64 px or bigger).`;
      return null;
    }
    const voices = await listVoices(adapter, signal).catch((e) => e);
    if (voices instanceof Error) return `Listing the voices ({"kind": "voices"}) failed: ${voices.message}`;
    const r = await runAdapter(
      k,
      { text: "This is a short test of the custom voice.", language: "en", voice: voices[0]?.id ?? "" },
      { adapter, signal },
    );
    const { probe, grantPaths } = await import("../voice/index");
    grantPaths(r.file);
    const [p] = await probe([r.file]);
    if (!p?.audio || !p.duration || p.duration < 0.5)
      return `It wrote ${r.file}, but that is not audio the app can read (MP3, WAV or similar, at least half a second).`;
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
}
async function listVoices(adapter, signal) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cz-voices-")), "voices.json");
  try {
    const r = await runAdapter("voice", { kind: "voices", out }, { adapter, signal, timeoutMs: 6e4 });
    const list = JSON.parse(fs.readFileSync(r.file, "utf8").replace(/^﻿/, ""));
    if (!Array.isArray(list)) throw new Error("it did not write a JSON list");
    return list
      .filter((v) => v && (typeof v.id === "string" || typeof v.id === "number") && String(v.id) && String(v.id).length <= 200)
      .slice(0, 500)
      .map((v) => ({
        id: String(v.id),
        name: String(v.name || v.id).slice(0, 80),
        ...(v.language ? { language: String(v.language).slice(0, 20) } : {}),
      }));
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
}
const voiceList = { at: 0, list: [] };
export async function customVoices(force = false) {
  if (!customReady("voice")) return [];
  if (!force && voiceList.at && Date.now() - voiceList.at < 10 * 6e4) return voiceList.list;
  try {
    voiceList.list = await listVoices();
  } catch (e) {
    log("custom voices", e?.message);
    voiceList.list = [];
  }
  voiceList.at = Date.now();
  return voiceList.list;
}
async function accept(k, brief) {
  let cand = null;
  try {
    cand = JSON.parse(fs.readFileSync(candidateFile(k), "utf8").replace(/^﻿/, ""));
  } catch {}
  if (!cand) return `${candidateFile(k)} is missing or not valid JSON.`;
  if (!fs.existsSync(adapterOf(k))) return `${adapterOf(k)} is missing.`;
  fs.writeFileSync(
    setupFile(k),
    JSON.stringify(
      {
        name: String(cand.name || "Custom API").slice(0, 80),
        notes: String(cand.notes || "").slice(0, 500),
        brief,
        verifiedAt: new Date().toISOString(),
      },
      null,
      1,
    ),
  );
  return null;
}
const FORBIDDEN =
  /\b(sudo|runas|winget|choco|scoop|brew|apt(-get)?|setx|reg\s+add|Set-ExecutionPolicy|launchctl|defaults\s+write|npm|npx|pnpm|yarn|pip3?)\b/i;
function prompt(k, dir, brief) {
  const node = `ELECTRON_RUN_AS_NODE=1 "${process.execPath}"`;
  const reqEx =
    k === "image"
      ? `{ "kind": "image", "prompt": "A red apple on a white table", "aspect": "16:9", "refs": ["<absolute paths of reference pictures, may be empty>"], "model": "<optional: the model the user picked>", "out": "<absolute path, e.g. ...\\\\out.png>" }`
      : `{ "kind": "voice", "text": "The words to speak.", "language": "en", "voice": "<a voice id from the voices list; empty: the voice the user described, else the service's default>", "out": "<absolute path, e.g. ...\\\\out.mp3>" }`;
  return `You are connecting a ${k === "image" ? "picture-generation" : "text-to-speech"} API to Videoxx, unattended. The user asked for it
in their own words (it is at their own risk; do exactly what they describe, nothing else):

---
${brief}
---

Write ONE file: ${path.join(dir, "adapter.mjs")} (a Node ES module). Node 20+ built-ins and the global fetch ONLY: no npm packages,
nothing installed. The app runs it as \`node adapter.mjs <request.json>\` with the API key in process.env.CUSTOM_API_KEY (may be
empty if the service needs none). Never write the key into any file or print it.
The request file looks like: ${reqEx}
${
  k === "image"
    ? `Make ONE picture for the prompt (the aspect "16:9", "9:16", "1:1", "4:3" or "3:4"; use the refs as reference
pictures if the API supports them, else ignore them). The request may also have "model": the model the user picked in the
app (their default); when it is there, use that model of the service instead of your own default. Poll if the API is asynchronous. Save the picture bytes (PNG, JPEG or
WebP) to "out", downloading it if the API returns a URL.`
    : `Speak the text (in the "language", an ISO 639-1 code) and save the audio (MP3, WAV, OGG or M4A) to "out". The
text can be a few thousand characters: split it on sentences if the API has a limit and join the parts in order (concatenate
MP3 frames, or write one WAV) so "out" is one file. Use the "voice" id when it is given.
It must also answer a second request, { "kind": "voices", "out": "<absolute path of a .json file>" }: write to "out" a JSON list of
the voices the account can use, [{"id": "<what goes in voice>", "name": "<short name>", "language": "<ISO 639-1, if known>"}], the
account's own (cloned) voices first, then the service's ready-made ones (at most a few hundred). Include any voice the user named.
If the service has no way to list voices, write the voices the user named (or []). Print the RESULT line for it too (ext ".json").`
}
Then print one last line: RESULT {"ext": "<extension of out>", "cost": <price of this call in USD if known, else 0>}.
On any error exit with code 1 and print one short line saying what went wrong (the API's own message).

Find the API's current docs on the web (the user may have pasted a link). Test it yourself before you finish:
write a request file into ${dir}, run: ${node} adapter.mjs <that request file> (bash; CUSTOM_API_KEY is already set in your
environment), and check the result. Then write ${path.join(dir, "candidate.json")}: {"name": "<service and model, short>", "notes": "<one line: what it uses, price if known>"}.
Only write files inside ${dir}. No system-wide installs or settings changes. The app then tests it on its own sample.`;
}
export function startCustomSetup(k, brief, key2) {
  const s = states[k];
  if (s.status === "running" || s.status === "verifying") return customState(k);
  brief = String(brief || "").trim();
  if (brief.length < 10) {
    set(k, { status: "failed", error: "Describe the service: its name, the model, and a link to its API docs if you have one." });
    return customState(k);
  }
  if (key2 != null && key2.trim()) setSecret(keyName(k), key2.trim());
  const exe = claudeExecutable();
  if (!exe || !lastStatus()?.loggedIn) {
    set(k, { status: "failed", error: "Connect Claude first (Home > Connect Claude). It writes the connector for this service." });
    return customState(k);
  }
  s.log = [];
  set(k, { status: "running", error: void 0 });
  const ctl = new AbortController();
  aborts[k] = ctl;
  run(k, exe, brief, ctl)
    .catch((e) => {
      if (ctl.signal.aborted) return;
      log("custom api setup failed", k, e?.message);
      set(k, { status: "failed", error: friendlyError(String(e?.message ?? e)) });
    })
    .finally(() => {
      if (aborts[k] === ctl) delete aborts[k];
    });
  return customState(k);
}
export function cancelCustomSetup(k) {
  const c = aborts[k];
  if (!c) return false;
  c.abort();
  delete aborts[k];
  say(k, "Stopped.");
  set(k, { status: "idle", error: void 0 });
  return true;
}
export function removeCustom(k) {
  cancelCustomSetup(k);
  fs.rmSync(dirOf(k), { recursive: true, force: true });
  setSecret(keyName(k), null);
  if (k === "voice") voiceList.at = 0;
  states[k] = blank(k);
  emit(customState(k));
  return customState(k);
}
async function run(k, exe, brief, ctl) {
  const signal = ctl.signal;
  dirOf(k);
  const stopped = () => signal.aborted;
  const work = path.join(root(), `${k}.new`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  say(k, "Claude is reading the API docs and writing the connector ...");
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const canUseTool = async (tool, input) => {
    const target = String(input?.file_path ?? input?.notebook_path ?? "");
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool) && target && !insideDir(work, target))
      return { behavior: "deny", message: `Only files inside ${work} may be written.` };
    if (/^(Bash|PowerShell)$/.test(tool) && FORBIDDEN.test(String(input?.command ?? "")))
      return { behavior: "deny", message: "No installs, package managers or system changes: Node built-ins and fetch only." };
    return { behavior: "allow", updatedInput: input };
  };
  const env = { ...cleanEnv(), CUSTOM_API_KEY: getSecret(keyName(k)) ?? "" };
  let session,
    text = prompt(k, work, brief);
  for (let attempt = 0; attempt < 3; attempt++) {
    const stream = query({
      prompt: text,
      options: {
        cwd: work,
        pathToClaudeCodeExecutable: exe,
        env,
        abortController: ctl,
        model: "claude-sonnet-5-5",
        effort: "medium",
        maxTurns: 80,
        resume: session,
        settingSources: [],
        systemPrompt: { type: "preset", preset: "claude_code", append: "You are running inside Videoxx as an unattended setup job." },
        mcpServers: {},
        strictMcpConfig: true,
        permissionMode: "default",
        canUseTool,
      },
    });
    for await (const msg of stream) {
      if (msg.type === "system" && msg.subtype === "init") session = msg.session_id;
      else if (msg.type === "assistant")
        for (const b of msg.message.content || []) {
          if (b.type === "text" && b.text.trim()) say(k, b.text.trim().split("\n").slice(0, 4).join("\n"));
          else if (b.type === "tool_use")
            say(
              k,
              "· " +
                (b.name === "WebSearch"
                  ? `search: ${b.input?.query}`
                  : b.name === "WebFetch"
                    ? `read: ${b.input?.url}`
                    : b.name === "Bash" || b.name === "PowerShell"
                      ? String(b.input?.description || "testing it").slice(0, 120)
                      : `${b.name} ${path.basename(String(b.input?.file_path ?? ""))}`),
            );
        }
      else if (msg.type === "result" && (msg.subtype !== "success" || msg.is_error))
        throw new Error(msg.errors?.join?.("; ") || msg.result || msg.subtype);
    }
    if (stopped()) return;
    set(k, { status: "verifying" });
    say(k, `Testing it with a sample ${WHAT[k]} ...`);
    const problem = await installFrom(k, work, brief, signal);
    if (stopped()) return;
    if (!problem) {
      say(k, "It works. You can pick it now.");
      set(k, { status: "ready" });
      return;
    }
    say(k, "The app's test failed: " + problem);
    text = `The app tested your connector and it failed:
${problem}
Fix adapter.mjs, test it again and rewrite candidate.json.`;
    set(k, { status: "running" });
  }
  throw new Error(`The connector did not pass the test after three tries. Check the description (and the key), then try again.`);
}
async function installFrom(k, work, brief, signal) {
  const adapter = path.join(work, "adapter.mjs");
  if (!fs.existsSync(adapter)) return `${adapter} is missing.`;
  if (!fs.existsSync(path.join(work, "candidate.json"))) return `${path.join(work, "candidate.json")} is missing.`;
  const problem = await check(k, adapter, signal);
  if (problem) return problem;
  const dir = dirOf(k);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(work, dir);
  if (k === "voice") voiceList.at = 0;
  return accept(k, brief);
}
export async function testInstall(k, source, brief = "test", key2) {
  if (key2) setSecret(keyName(k), key2);
  const work = path.join(root(), `${k}.new`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, "adapter.mjs"), source);
  fs.writeFileSync(path.join(work, "candidate.json"), JSON.stringify({ name: "Test service", notes: "test" }));
  const problem = await installFrom(k, work, brief);
  set(k, problem ? { status: "failed", error: problem } : { status: "ready", error: void 0 });
  return { problem, state: customState(k) };
}
