import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import cp from "node:child_process";
import os from "node:os";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { log } from "../core/log";
import { CODEX_MODELS } from "./models";
import { NO_CODEX, codexEnv, codexExecutable, codexFake, codexSafety } from "./codexCli";
import { resolveEngine } from "./resolveEngine";
import { CodexMapper } from "./codexMapper";
import { registerScoped } from "../agent/tools/scopedBridge";

const EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const GUARDED = ["lib/contact.js", "lib/collide.js"];
const ours = new Set();
const norm = (f) => {
  const r = path.resolve(f);
  return process.platform === "win32" || process.platform === "darwin" ? r.toLowerCase() : r;
};
export const spawnSeen = [];
export const treeKills = [];
const killing = new WeakMap();
let patched = false;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const gone = (c) => c.exitCode !== null || c.signalCode !== null;
function descendants(root) {
  return new Promise((res) =>
    cp.execFile("/bin/ps", ["-A", "-o", "pid=", "-o", "ppid="], { windowsHide: true, timeout: 5e3 }, (err, out) => {
      if (err) return res([]);
      const kids = new Map();
      for (const l of String(out).split("\n")) {
        const [p, pp] = l.trim().split(/\s+/).map(Number);
        if (p > 0 && pp >= 0) {
          if (!kids.has(pp)) kids.set(pp, []);
          kids.get(pp).push(p);
        }
      }
      const all = [],
        todo = [root];
      while (todo.length)
        for (const k of kids.get(todo.pop()) ?? [])
          if (!all.includes(k)) {
            all.push(k);
            todo.push(k);
          }
      res(all);
    }),
  );
}
async function treeKill(child, plainKill) {
  const pid = child.pid;
  if (!pid || gone(child)) return;
  if (process.platform === "win32") {
    const tk = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    const ok = await new Promise((res) =>
      cp.execFile(tk, ["/T", "/F", "/PID", String(pid)], { windowsHide: true, timeout: 1e4 }, (err) => res(!err)),
    );
    treeKills.push({ pid, how: "taskkill /T /F", ok, killed: 0 });
    if (!ok)
      try {
        plainKill();
      } catch {}
  } else {
    const kids = await descendants(pid);
    for (const k of kids) {
      try {
        process.kill(-k, "SIGKILL");
      } catch {}
      try {
        process.kill(k, "SIGKILL");
      } catch {}
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
    treeKills.push({ pid, how: "SIGKILL descendants + codex", ok: true, killed: kids.length });
  }
  if (treeKills.length > 20) treeKills.shift();
  for (let i = 0; i < 60 && !gone(child); i++) await sleep(100);
}
export const stopped = (signal) => killing.get(signal) ?? Promise.resolve();
export function hideSpawn(exe) {
  ours.add(norm(exe));
  if (patched) return;
  patched = true;
  const orig = cp.spawn;
  cp.spawn = function (cmd, args, opts) {
    if (typeof cmd !== "string" || !ours.has(norm(cmd))) return orig.call(this, cmd, args, opts);
    if (!Array.isArray(args)) {
      opts = args;
      args = [];
    }
    args = args.slice();
    if (args[0] === "exec") {
      const at = args[1] === "--experimental-json" ? 2 : 1;
      args.splice(at, 0, ...codexSafety().flags.filter((f) => !args.includes(f)));
    }
    const signal = opts?.signal;
    opts = { ...(opts ?? {}), windowsHide: true };
    delete opts.signal;
    const child = orig.call(this, cmd, args, opts);
    spawnSeen.push({ cmd, windowsHide: true, args: args.slice() });
    if (spawnSeen.length > 20) spawnSeen.shift();
    const plainKill = child.kill.bind(child);
    let done = null;
    const kill = () => (done ??= treeKill(child, () => plainKill()));
    child.kill = () => {
      void kill();
      return true;
    };
    if (signal) {
      const onAbort = () => {
        killing.set(signal, kill());
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    return child;
  };
  syncBuiltinESMExports();
}
export function codexClient(exe, env, config) {
  return {
    codexPathOverride: exe,
    env: { ...codexEnv(), ...(env ?? {}) },
    configOverrides: codexSafety().overrides,
    ...(config ? { config } : {}),
  };
}
const fake = { calls: [], next: 0, delayMs: 120, holdMs: 0 };
export function testFakeCodex(op, a) {
  if (op === "calls") return fake.calls;
  if (op === "reset") {
    fake.calls = [];
    fake.next = 0;
    fake.holdMs = 0;
    return true;
  }
  if (op === "turn") {
    fake.next = Math.max(0, +a || 0);
    return true;
  }
  if (op === "hold") {
    fake.holdMs = Math.min(3e4, Math.max(0, +a || 0));
    return true;
  }
  if (op === "spawnSeen") return spawnSeen.slice();
  throw new Error("unknown op " + op);
}
const post = (url, body, headers = {}) =>
  new Promise((res) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const r = http.request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (x) => {
        let t = "";
        x.on("data", (d) => (t += d));
        x.on("end", () => res({ status: x.statusCode ?? 0, text: t }));
      },
    );
    r.on("error", (e) => res({ status: "err " + e.message, text: "" }));
    r.end(data);
  });
const rpcJson = (t) => {
  const m = t.match(/data: (.*)/);
  try {
    return JSON.parse(m ? m[1] : t);
  } catch {
    return null;
  }
};
async function* fakeEvents(call, o) {
  const file = process.env.CZ_CODEX_FAKE;
  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("//"));
  const sub = (s) =>
    s
      .replace(/\{\{project\}\}/g, JSON.stringify(o.projectDir).slice(1, -1))
      .replace(/\{\{thread\}\}/g, call.thread)
      .replace(/\{\{outside\}\}/g, JSON.stringify(path.join(os.tmpdir(), "cz-codex-outside-never-written.txt")).slice(1, -1));
  const wait = (ms) =>
    new Promise((res, rej) => {
      const t = setTimeout(res, ms);
      o.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          rej(new Error("aborted"));
        },
        { once: true },
      );
    });
  for (const raw of lines) {
    const ev = JSON.parse(sub(raw));
    if (ev._turn !== void 0 && ev._turn !== call.turn) continue;
    if (o.signal.aborted) throw new Error("aborted");
    if (ev._write) {
      const f = path.resolve(o.projectDir, ev._write.file);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, ev._write.content);
    }
    if (ev._mcp && call.mcpUrl) {
      await post(call.mcpUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex-fake", version: "1" } },
      });
      const list = rpcJson((await post(call.mcpUrl, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).text);
      const shots = rpcJson(
        (await post(call.mcpUrl, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_shots", arguments: {} } })).text,
      );
      const origin = (
        await post(call.mcpUrl, { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }, { Origin: "http://evil.example" })
      ).status;
      const badToken = (
        await post(call.mcpUrl.replace(/\/s\/[a-f0-9]+\//, `/s/${"0".repeat(48)}/`), {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/list",
          params: {},
        })
      ).status;
      call.mcp = {
        tools: (list?.result?.tools ?? []).map((t) => t.name),
        call: shots?.result ? "ok" : `failed ${JSON.stringify(shots?.error ?? shots).slice(0, 120)}`,
        origin,
        badToken,
      };
    }
    delete ev._turn;
    delete ev._write;
    delete ev._mcp;
    if (ev.type === "turn.completed" && fake.holdMs) await wait(fake.holdMs);
    await wait(fake.delayMs);
    yield ev;
  }
}
export async function codexText(o) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cz-codex-text-"));
  const effort = o.effort && EFFORTS.has(o.effort) ? o.effort : void 0;
  const threadOpts = {
    model: o.model,
    workingDirectory: dir,
    skipGitRepoCheck: true,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: o.web ? "live" : "disabled",
    ...(effort ? { modelReasoningEffort: effort } : {}),
  };
  const input = [
    {
      type: "text",
      text: `${o.system.trim()}

${o.prompt}`,
    },
    ...(o.look ?? []).slice(0, 8).map((f) => ({ type: "local_image", path: f })),
  ];
  try {
    if (codexFake()) {
      fake.calls.push({
        kind: "text",
        model: o.model,
        effort: effort ?? null,
        sandboxMode: "read-only",
        approvalPolicy: "never",
        cwd: dir,
        resume: null,
        skipGitRepoCheck: true,
        networkAccessEnabled: false,
        mcpUrl: null,
        mcpApproval: null,
        images: (o.look ?? []).length,
        prompt: o.prompt.slice(0, 400),
        agentsMd: false,
        thread: "codex-fake-text",
        turn: 0,
      });
      return '{"fake":"codex"}';
    }
    const exe = (await codexExecutable()).exe;
    if (!exe) throw new Error(NO_CODEX);
    hideSpawn(exe);
    const { Codex } = await import("@openai/codex-sdk");
    const turn = await new Codex(codexClient(exe)).startThread(threadOpts).run(input, { signal: o.signal });
    return turn.finalResponse;
  } finally {
    if (o.signal.aborted) await Promise.race([stopped(o.signal), sleep(1e4)]);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}
require("./videoxx-chatgpt").init({ codexText, resolveEngine, models: CODEX_MODELS });
function writeImages(o) {
  const pics = [];
  (o.images ?? [])
    .filter((u) => /^data:image\/(png|jpeg|webp|gif);base64,/.test(u))
    .slice(0, 4)
    .forEach((u, i) => pics.push({ data: u, label: `reference image ${i + 1} from the user` }));
  if (o.frame?.startsWith("data:image/"))
    pics.push({
      data: o.frame,
      label: `the preview frame${typeof o.time === "number" ? ` at t=${o.time.toFixed(2)}s` : ""} (what the user was looking at when asking; selections are outlined)`,
    });
  if (!pics.length) return { dir: null, input: [], note: "" };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cz-codex-img-"));
  const input = pics.map((p, i) => {
    const ext = /^data:image\/(\w+)/.exec(p.data)?.[1]?.replace("jpeg", "jpg") ?? "png",
      f = path.join(dir, `image-${i + 1}.${ext}`);
    fs.writeFileSync(f, Buffer.from(p.data.slice(p.data.indexOf(",") + 1), "base64"));
    return { type: "local_image", path: f };
  });
  return { dir, input, note: `Attached images, in order: ${pics.map((p, i) => `${i + 1}. ${p.label}`).join("; ")}.` };
}
const readGuarded = (dir) =>
  GUARDED.map((rel) => {
    const f = path.join(dir, rel);
    try {
      return { rel, f, buf: fs.readFileSync(f) };
    } catch {
      return { rel, f, buf: null };
    }
  });
export async function* runCodex(o) {
  const isFake = codexFake();
  const exe = isFake ? "codex-test-stand-in" : (await codexExecutable()).exe;
  if (!exe) throw new Error(NO_CODEX);
  const reg = o.tools ? await registerScoped(o.projectId, o.selection ?? [], o.ledger) : null;
  const pics = writeImages(o);
  const guarded = readGuarded(o.projectDir);
  const ac = new AbortController();
  const stop = () => ac.abort();
  o.signal.addEventListener("abort", stop, { once: true });
  const effort = o.effort && EFFORTS.has(o.effort) ? o.effort : void 0;
  const threadOpts = {
    model: o.model,
    workingDirectory: o.projectDir,
    skipGitRepoCheck: true,
    sandboxMode: o.kind === "ask" ? "read-only" : "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    ...(effort ? { modelReasoningEffort: effort } : {}),
  };
  const codexOpts = codexClient(
    exe,
    o.env,
    reg
      ? { mcp_servers: { suite: { url: reg.url, default_tools_approval_mode: "approve", startup_timeout_sec: 20, tool_timeout_sec: 600 } } }
      : void 0,
  );
  const input = [
    {
      type: "text",
      text: pics.note
        ? `${pics.note}

${o.prompt}`
        : o.prompt,
    },
    ...pics.input,
  ];
  const mapper = new CodexMapper({ model: o.model, inside: o.inside, resumeId: o.resume ?? null });
  let outside = [];
  try {
    let events;
    if (isFake) {
      const turn = fake.next || fake.calls.length + 1;
      fake.next = 0;
      const call = {
        kind: o.kind,
        model: o.model,
        effort: effort ?? null,
        sandboxMode: threadOpts.sandboxMode,
        approvalPolicy: threadOpts.approvalPolicy,
        cwd: threadOpts.workingDirectory,
        resume: o.resume ?? null,
        skipGitRepoCheck: !!threadOpts.skipGitRepoCheck,
        networkAccessEnabled: !!threadOpts.networkAccessEnabled,
        mcpUrl: reg?.url ?? null,
        mcpApproval: codexOpts.config?.mcp_servers?.suite?.default_tools_approval_mode ?? null,
        images: pics.input.length,
        prompt: o.prompt.slice(0, 400),
        agentsMd: fs.existsSync(path.join(o.projectDir, "AGENTS.md")),
        thread: o.resume || `codex-fake-${crypto.randomBytes(6).toString("hex")}`,
        turn,
        configOverrides: codexOpts.configOverrides ?? [],
        flags: codexSafety().flags,
      };
      fake.calls.push(call);
      events = fakeEvents(call, { ...o, signal: ac.signal });
    } else {
      hideSpawn(exe);
      const { Codex } = await import("@openai/codex-sdk");
      const codex = new Codex(codexOpts);
      const thread = o.resume ? codex.resumeThread(o.resume, threadOpts) : codex.startThread(threadOpts);
      events = (await thread.runStreamed(input, { signal: ac.signal })).events;
    }
    for await (const ev of events) {
      const r = mapper.map(ev);
      for (const m of r.messages) {
        if (m.type === "codex_note") {
          log("codex note", o.kind, String(m.text).slice(0, 300));
          continue;
        }
        yield m;
      }
      if (r.outside.length) {
        outside = r.outside;
        ac.abort();
        break;
      }
    }
  } catch (err) {
    if (!outside.length) throw err;
  } finally {
    o.signal.removeEventListener("abort", stop);
    if (ac.signal.aborted) await Promise.race([stopped(ac.signal), sleep(1e4)]);
    reg?.dispose();
    if (pics.dir)
      try {
        fs.rmSync(pics.dir, { recursive: true, force: true });
      } catch {}
  }
  const back = [];
  for (const g of guarded) {
    let now = null;
    try {
      now = fs.readFileSync(g.f);
    } catch {}
    if ((now === null) === (g.buf === null) && (!now || now.equals(g.buf))) continue;
    try {
      if (g.buf) {
        fs.mkdirSync(path.dirname(g.f), { recursive: true });
        fs.writeFileSync(g.f, g.buf);
      } else fs.rmSync(g.f, { force: true });
      back.push(g.rel);
    } catch (e) {
      log("codex guard restore failed", g.rel, e?.message);
    }
  }
  if (back.length)
    yield {
      type: "system",
      subtype: "suite_note",
      warn: true,
      text: `ChatGPT changed ${back.join(" and ")}, the sign-off check${back.length > 1 ? "s" : ""} every edit is judged by. The app put ${back.length > 1 ? "them" : "it"} back: fix the scene so it passes, never the check.`,
    };
  if (outside.length) {
    log("codex file change OUTSIDE the project", o.projectDir, outside.join(", "));
    yield {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: [
        `OUTSIDE_PROJECT: ChatGPT changed a file outside this project (${outside.slice(0, 3).join(", ")}), so the run was stopped. Changes inside the project are kept in this edit and can be reverted; check that file yourself.`,
      ],
    };
  }
}
