import path from "node:path";
import fs from "node:fs";
import { BrowserWindow } from "electron";
import { WEBGL_FAIL, webglAdvice, webglFailed } from "../app/graphicsMode";
import { projectDir, projectUrl, serverUrl } from "../projects/fileServer";

export const workers = new Map();
export const HUNG =
  "The preview renderer stopped responding (the scene took too long to load or draw: a slow graphics card, or a scene stuck in a loop). It will be restarted for the next job.";
export function js(win, code, ms) {
  if (win.isDestroyed()) return Promise.reject(new Error(HUNG));
  let timer;
  const deadline = new Promise((_, rej) => {
    timer = setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
      rej(new Error(HUNG));
    }, ms);
  });
  return Promise.race([win.webContents.executeJavaScript(code), deadline]).finally(() => clearTimeout(timer));
}
export function seal(win) {
  const wc = win.webContents,
    ours = (url) => url.startsWith(serverUrl() + "/");
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.on("will-frame-navigate", (e) => {
    if (!e.isMainFrame) e.preventDefault();
  });
  wc.on("will-redirect", (e) => {
    if (!ours(e.url)) e.preventDefault();
  });
  return win;
}
export function create(projectId, settings, view, swenc = false) {
  const win = seal(
    new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: { backgroundThrottling: false, offscreen: false, sandbox: true, contextIsolation: true },
    }),
  );
  const w = { win, dirty: false, ready: Promise.resolve() };
  win.webContents.on("console-message", (e) => {
    const msg = e.message ?? "";
    if (msg.startsWith("PROGRESS")) w.progress?.(msg);
  });
  w.ready = load(w, projectId, settings, view, swenc);
  win.on("closed", () => {
    for (const [k, x] of workers) if (x.win === win) workers.delete(k);
  });
  win.webContents.on("render-process-gone", () => {
    if (!win.isDestroyed()) win.destroy();
  });
  return w;
}
async function load(w, projectId, settings, view, swenc = false) {
  await w.win.loadURL(
    projectUrl(
      projectId,
      "__suite/host.html?mode=render" +
        (settings ? `&settings=${encodeURIComponent(JSON.stringify(settings))}` : "") +
        (view ? `&scenes=${encodeURIComponent(view.scenes.join(","))}&end=${+view.end || 0}` : "") +
        (swenc ? "&swenc=1" : process.env.CZ_TEST_HANG_ENCODER ? "&testhang=1" : ""),
    ),
  );
  const t0 = Date.now();
  for (;;) {
    const ok = await Promise.race([
      w.win.webContents.executeJavaScript("window.ready === true"),
      new Promise((r) => setTimeout(() => r(null), 15e3)),
    ]).catch(() => false);
    if (ok === true) break;
    if (w.win.isDestroyed() || Date.now() - t0 > 18e4) {
      if (!w.win.isDestroyed()) w.win.destroy();
      throw new Error(HUNG);
    }
    if (ok !== null) await new Promise((r) => setTimeout(r, 100));
  }
  const bootError = await js(w.win, "window.bootError || null", 5e3);
  if (bootError && WEBGL_FAIL.test(bootError)) {
    const r = webglFailed("a render worker: " + bootError);
    throw new Error(webglAdvice(r.software));
  }
  if (bootError) throw new Error("Preview failed to load: " + bootError);
}
const projectOf = (key2) => key2.split("#")[0];
const keysOf = (projectId) => [...workers.keys()].filter((k) => k === projectId || k.startsWith(projectId + "#"));
async function worker(key2) {
  const projectId = projectOf(key2);
  let w = workers.get(key2);
  if (!w || w.win.isDestroyed()) {
    w = create(projectId);
    workers.set(key2, w);
  } else if (w.dirty) {
    w.dirty = false;
    w.ready = load(w, projectId);
  }
  await w.ready;
  if (await js(w.win, "window.contextLost === true", 5e3).catch(() => true)) {
    if (w.win.isDestroyed()) {
      w = create(projectId);
      workers.set(key2, w);
    } else w.ready = load(w, projectId);
    await w.ready;
  }
  return w;
}
export function markDirty(projectId) {
  for (const k of keysOf(projectId)) workers.get(k).dirty = true;
}
export function closeWorker(projectId) {
  for (const k of keysOf(projectId)) {
    const w = workers.get(k);
    if (w && !w.win.isDestroyed()) w.win.destroy();
    workers.delete(k);
  }
}
export function closeAllWorkers() {
  for (const id of new Set([...workers.keys()].map(projectOf))) closeWorker(id);
}
const chains = new Map();
function serial(key2, job) {
  const p = (chains.get(key2) ?? Promise.resolve()).then(async () => job(await worker(key2)));
  chains.set(
    key2,
    p.catch(() => {}),
  );
  return p;
}
const pools = new Map(),
  busy = new Map();
export function setWorkerPool(projectId, n) {
  if (n > 1) {
    pools.set(projectId, Math.min(4, Math.round(n)));
    return;
  }
  pools.delete(projectId);
  for (const k of keysOf(projectId))
    if (k !== projectId) {
      const w = workers.get(k);
      if (w && !w.win.isDestroyed()) w.win.destroy();
      workers.delete(k);
    }
}
function pooled(projectId, job) {
  const n = pools.get(projectId) ?? 1;
  if (n <= 1) return serial(projectId, job);
  const keys = [projectId, ...Array.from({ length: n - 1 }, (_, i) => `${projectId}#${i + 1}`)];
  const key2 = keys.reduce((a, b) => ((busy.get(b) ?? 0) < (busy.get(a) ?? 0) ? b : a));
  busy.set(key2, (busy.get(key2) ?? 0) + 1);
  return serial(key2, job).finally(() => busy.set(key2, (busy.get(key2) ?? 1) - 1));
}
export async function checkedStills(projectId, times, scale = 0.5, batch = "claude") {
  markDirty(projectId);
  const r = await pooled(projectId, async (w) => ({
    urls: await js(w.win, `window.suite.stills(${JSON.stringify(times)}, ${scale})`, 1e4 + times.length * 1500),
    errors: await js(w.win, "window.suite ? window.suite.errors() : []", 5e3),
    bootError: await js(w.win, "window.bootError || null", 5e3),
  })).catch((e) => ({ urls: times.map(() => null), errors: [], bootError: String(e.message || e) }));
  const out = path.join(projectDir(projectId), ".suite", "frames", batch);
  fs.mkdirSync(out, { recursive: true });
  const shots = r.urls.map((u, i) => {
    if (!u) return { time: times[i], file: "", base64: "", error: true };
    const b64 = u.slice(u.indexOf(",") + 1),
      f = path.join(out, `t${times[i].toFixed(2).replace(".", "_")}.png`);
    fs.writeFileSync(f, Buffer.from(b64, "base64"));
    return { time: times[i], file: f, base64: b64 };
  });
  return { shots, errors: r.errors, bootError: r.bootError };
}
export async function renderStills(projectId, times, scale = 0.5, batch = "claude", settings, clean) {
  const dir = projectDir(projectId);
  const call = (w) =>
    js(
      w.win,
      `window.suite.stills(${JSON.stringify(times)}, ${scale}${clean ? `, ${JSON.stringify({ clean })}` : ""})`,
      1e4 + times.length * 1500,
    );
  const urls =
    settings || clean
      ? await (async () => {
          const w = create(projectId, settings);
          try {
            await w.ready;
            return await call(w);
          } finally {
            if (!w.win.isDestroyed()) w.win.destroy();
          }
        })()
      : await serial(projectId, call);
  const out = path.join(dir, ".suite", "frames", batch);
  fs.mkdirSync(out, { recursive: true });
  if (urls.every((u) => !u)) throw new Error("The scenes threw an error at every requested time. Check the preview warnings.");
  return urls.map((u, i) => {
    if (!u) return { time: times[i], file: "", base64: "", error: true };
    const b64 = u.slice(u.indexOf(",") + 1),
      f = path.join(out, `t${times[i].toFixed(2).replace(".", "_")}.png`);
    fs.writeFileSync(f, Buffer.from(b64, "base64"));
    return { time: times[i], file: f, base64: b64 };
  });
}
export async function hostState(projectId, reload = false) {
  if (reload) markDirty(projectId);
  return serial(projectId, async (w) => ({
    info: await js(w.win, "window.suite ? window.suite.info() : null", 15e3),
    errors: await js(w.win, "window.suite ? window.suite.errors() : []", 5e3),
    bootError: await js(w.win, "window.bootError || null", 5e3),
  })).catch((e) => ({ info: null, errors: [], bootError: String(e.message || e) }));
}
export async function viewProp(projectId, q) {
  const dir = projectDir(projectId);
  let theme = "studio";
  try {
    theme =
      JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^﻿/, "")).settings?.theme === "investigation"
        ? "investigation"
        : "studio";
  } catch {}
  const win = seal(
    new BrowserWindow({
      show: false,
      width: 1920,
      height: 1080,
      webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true },
    }),
  );
  const errors = [];
  win.webContents.on("console-message", (e) => {
    if ((e.level === "error" || e.level === 3) && e.message) errors.push(String(e.message).slice(0, 300));
  });
  try {
    await win.loadURL(
      projectUrl(
        projectId,
        `lib/propview.html?mod=${encodeURIComponent(q.mod)}&fn=${encodeURIComponent(q.fn)}&args=${encodeURIComponent(JSON.stringify(q.args))}&theme=${theme}${q.expect ? `&expect=${encodeURIComponent(JSON.stringify(q.expect))}` : ""}`,
      ),
    );
    const t0 = Date.now();
    while (!(await js(win, 'typeof window.viewProp === "function"', 5e3).catch(() => false))) {
      if (Date.now() - t0 > 6e4)
        throw new Error("the prop viewer did not load" + (errors.length ? `: ${errors.slice(-3).join(" | ")}` : ""));
      await new Promise((r2) => setTimeout(r2, 150));
    }
    const r = await js(win, `Promise.resolve(window.viewProp(${JSON.stringify({ expect: q.expect ?? null })}))`, 9e4);
    const png = r?.png ? Buffer.from(r.png.slice(r.png.indexOf(",") + 1), "base64") : null;
    if (png) {
      const out = path.join(dir, ".suite", "props");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(
          out,
          `${path.basename(q.mod, ".js")}-${q.fn}-${
            String(q.args[0] ?? "")
              .replace(/[^\w-]/g, "")
              .slice(0, 24) || "prop"
          }.png`,
        ),
        png,
      );
    }
    return { png, report: r?.report ?? null, errors };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
export async function viewHold(projectId, q) {
  const dir = projectDir(projectId);
  let theme = "studio";
  try {
    theme =
      JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^﻿/, "")).settings?.theme === "investigation"
        ? "investigation"
        : "studio";
  } catch {}
  const qs = Object.entries({ theme, ...q })
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const win = seal(
    new BrowserWindow({
      show: false,
      width: 1920,
      height: 1080,
      webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true },
    }),
  );
  const errors = [];
  win.webContents.on("console-message", (e) => {
    if ((e.level === "error" || e.level === 3) && e.message) errors.push(String(e.message).slice(0, 300));
  });
  try {
    await win.loadURL(projectUrl(projectId, `lib/holdview.html?${qs}`));
    const t0 = Date.now();
    for (;;) {
      const ready = await js(win, "window.ready", 5e3).catch(() => null);
      if (ready === true) break;
      if (typeof ready === "string" && ready.startsWith("error"))
        throw new Error(`the hold viewer could not build it: ${ready.slice(0, 300)}`);
      if (Date.now() - t0 > 9e4)
        throw new Error("the hold viewer did not load" + (errors.length ? `: ${errors.slice(-3).join(" | ")}` : ""));
      await new Promise((r2) => setTimeout(r2, 200));
    }
    const r = await js(win, "Promise.resolve(window.viewHold({}))", 15e4);
    const png = r?.png ? Buffer.from(r.png.slice(r.png.indexOf(",") + 1), "base64") : null;
    if (png) {
      const out = path.join(dir, ".suite", "holds");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(
          out,
          `${String(q.args ?? q.fn ?? "hold")
            .replace(/[^\w-]/g, "")
            .slice(0, 24)}-${String(q.grip ?? "")
            .replace(/[^\w-]/g, "")
            .slice(0, 16)}-${q.body ?? "male"}.png`,
        ),
        png,
      );
    }
    return { png, report: r?.report ?? null, errors };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
export async function layoutCheck(projectId, times, range) {
  if (range) markDirty(projectId);
  return pooled(projectId, (w) =>
    js(w.win, `window.suite.layout(${JSON.stringify(times ?? null)}${range ? `, ${JSON.stringify(range)}` : ""})`, 12e4),
  );
}
export async function layoutCheckWith(projectId, settings, view, o = {}) {
  const t0 = Date.now(),
    w = create(projectId, settings, view);
  const out = { bootError: null, info: null, layout: null, stills: [], sweep: null, errors: [], ms: 0 };
  try {
    try {
      await w.ready;
    } catch (e) {
      out.bootError = String(e?.message || e).replace(/^Preview failed to load: /, "");
      return out;
    }
    out.info = await js(w.win, "window.suite ? window.suite.info() : null", 15e3);
    if (o.layout !== false) out.layout = await js(w.win, "window.suite.layout(null)", 12e4);
    const plan = o.stills?.(out.info, out.layout);
    if (plan?.times.length) {
      const urls = await js(w.win, `window.suite.stills(${JSON.stringify(plan.times)}, ${plan.scale})`, 15e3 + plan.times.length * 1500);
      out.stills = plan.times.map((t, i) => ({
        time: t,
        png: urls[i] ? Buffer.from(urls[i].slice(urls[i].indexOf(",") + 1), "base64") : null,
      }));
    }
    if (o.sweepFps) out.sweep = await js(w.win, `window.suite.sweep ? window.suite.sweep(${+o.sweepFps}) : null`, 5 * 6e4);
    out.errors = await js(w.win, "window.suite ? window.suite.errors() : []", 5e3);
    if (o.probe) out.probe = await js(w.win, o.probe, 9e4).catch(() => null);
    return out;
  } finally {
    out.ms = Date.now() - t0;
    if (!w.win.isDestroyed()) w.win.destroy();
  }
}
export async function withThrowawayWorker(projectId, settings, view, fn) {
  const w = create(projectId, settings, view);
  try {
    await w.ready;
    return await fn((code, ms) => js(w.win, code, ms));
  } finally {
    if (!w.win.isDestroyed()) w.win.destroy();
  }
}
export async function sweepErrors(projectId, fps = 10) {
  return serial(projectId, (w) => js(w.win, `window.suite.sweep ? window.suite.sweep(${+fps || 10}) : null`, 15 * 6e4));
}
const STUCK =
  "A scene stopped responding while the sound events were collected (no sign of life for 90 seconds, most likely a loop that never ends in one shot). Ask Claude to check the scenes for a loop that never finishes, then run this step again.";
export async function collectEvents(projectId, log) {
  const ev = await serial(projectId, (w) => {
    const t0 = Date.now();
    let last2 = t0,
      ticks = 0,
      timer;
    w.progress = () => {
      last2 = Date.now();
    };
    const stall = new Promise((_, rej) => {
      timer = setInterval(() => {
        if (Date.now() - last2 > 9e4) {
          if (!w.win.isDestroyed()) w.win.destroy();
          rej(new Error(STUCK));
        } else if (++ticks % 6 === 0)
          log?.(`Still collecting (${Math.round((Date.now() - t0) / 1e3)} s so far, long videos take a few minutes) ...`);
      }, 5e3);
    });
    return Promise.race([js(w.win, "window.suite.events()", 4 * 36e5), stall]).finally(() => {
      clearInterval(timer);
      w.progress = void 0;
    });
  });
  fs.writeFileSync(path.join(projectDir(projectId), "audio", "events.json"), JSON.stringify(ev, null, 1));
  return ev;
}
