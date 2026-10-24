import { BrowserWindow, app, session } from "electron";
import { log } from "../core/log";

let testBase = null;
export const setTestBase = (u) => {
  if (process.env.CZ_TEST_HOOKS === "1") testBase = u;
};
export const pageBase = () =>
  ((process.env.CZ_TEST_HOOKS === "1" && (testBase || process.env.CZ_YT_PAGE_BASE)) || "https://www.youtube.com").replace(/\/+$/, "");
export const isRealYoutube = () => pageBase() === "https://www.youtube.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const PART = "cz-yt-reader";
const CAP = 3e3,
  CACHE_MS = 4 * 36e5;
const reads = new Map(),
  searches = new Map();
const alive = new Set();
export const readerWindows = () => [...alive].filter((w) => !w.isDestroyed()).length;
export let readersOpened = 0;
export const clearCache = () => {
  reads.clear();
  searches.clear();
};
let hooked = false;
function hookQuit() {
  if (hooked) return;
  hooked = true;
  app.on("before-quit", () => {
    for (const w of alive) if (!w.isDestroyed()) w.destroy();
  });
}
let chain = Promise.resolve();
function serial(go) {
  const p = chain.then(go, go);
  chain = p.catch(() => {});
  return p;
}
let prepared = false;
async function readerSession() {
  const s = session.fromPartition(PART);
  if (!prepared) {
    prepared = true;
    s.setUserAgent(UA);
    s.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    s.setPermissionCheckHandler(() => false);
    s.webRequest.onBeforeRequest((d, cb) =>
      cb({ cancel: d.resourceType === "image" || d.resourceType === "media" || d.resourceType === "font" }),
    );
  }
  for (const url of new Set(["https://www.youtube.com", pageBase()]))
    for (const [name, value] of [
      ["CONSENT", "YES+1"],
      ["SOCS", "CAI"],
    ])
      await s.cookies.set({ url, name, value, path: "/" }).catch(() => {});
  return s;
}
const timeout = (ms, why) => new Promise((_, rej) => setTimeout(() => rej(new Error(why)), ms));
async function withWindow(budgetMs, go) {
  return serial(async () => {
    if (!app.isReady()) await app.whenReady();
    hookQuit();
    await readerSession();
    const win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      focusable: false,
      width: 1280,
      height: 1800,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        partition: PART,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    alive.add(win);
    readersOpened++;
    win.on("closed", () => alive.delete(win));
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-prevent-unload", (e) => e.preventDefault());
    const kill = setTimeout(() => {
      if (!win.isDestroyed()) {
        log("youtube page reader: time limit, window closed");
        win.destroy();
      }
    }, budgetMs);
    const gone = () => {
      if (win.isDestroyed()) throw new Error("the read took too long");
    };
    try {
      const load = async (url) => {
        gone();
        try {
          await Promise.race([win.loadURL(url, { userAgent: UA }), timeout(25e3, "the page did not load")]);
        } catch (e) {
          if (!/ERR_ABORTED|\(-3\)/.test(String(e?.message))) throw e;
        }
        gone();
      };
      const js2 = async (code, ms = 6e4) => {
        gone();
        return await Promise.race([win.webContents.executeJavaScript(code, true), timeout(ms, "the page did not answer")]);
      };
      return await go(load, js2);
    } finally {
      clearTimeout(kill);
      if (!win.isDestroyed()) win.destroy();
      alive.delete(win);
    }
  });
}
const PAGE_JS = String.raw`(async (tab, cap, follow) => {
  const out = new Map(); let tokens = []; let wrongTab = false;
  const cfg = k => { try { return (window.ytcfg && (window.ytcfg.get ? window.ytcfg.get(k) : null)) ?? (window.ytcfg && window.ytcfg.data_ ? window.ytcfg.data_[k] : null); } catch { return null; } };
  const str = o => o == null ? '' : typeof o === 'string' ? o : (o.simpleText ?? o.content ?? (Array.isArray(o.runs) ? o.runs.map(r => r.text).join('') : ''));
  const texts = (o, acc, d) => { if (!o || typeof o !== 'object' || d > 14) return acc;
    if (Array.isArray(o)) { for (const x of o) texts(x, acc, d + 1); return acc; }
    for (const k in o) { const v = o[k]; if (typeof v === 'string') { if (k === 'simpleText' || k === 'text' || k === 'content') acc.push(v.trim()); } else if (v && typeof v === 'object') texts(v, acc, d + 1); }
    return acc; };
  const DUR = /^\d{1,2}(:\d{2}){1,2}$/, AGO = /\bago$|^Streamed |^Premiered /i;
  const add = (id, title, o, kind) => { if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id) || out.has(id) || !title) return;
    const all = texts(o, [], 0); out.set(id, { id, title: String(title).trim().slice(0, 300), ago: all.find(s => AGO.test(s)) || null, dur: all.find(s => DUR.test(s)) || null, kind }); };
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 60) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    for (const k in o) { const v = o[k]; if (!v || typeof v !== 'object') continue;
      if (k === 'videoRenderer' || k === 'gridVideoRenderer') add(v.videoId, str(v.title), v, 'video');
      else if (k === 'reelItemRenderer') add(v.videoId, str(v.headline), v, 'reel');
      else if (k === 'shortsLockupViewModel') add((((v.onTap || {}).innertubeCommand || {}).reelWatchEndpoint || {}).videoId || String(v.entityId || '').replace(/^shorts-shelf-item-/, ''), str((v.overlayMetadata || {}).primaryText), v, 'reel');
      else if (k === 'lockupViewModel') { if (!v.contentType || /VIDEO/.test(v.contentType)) add(v.contentId, str((((v.metadata || {}).lockupMetadataViewModel) || {}).title), v, 'video'); }
      else if (k === 'continuationItemRenderer') { const t = []; const f = (x, e) => { if (!x || typeof x !== 'object' || e > 12) return; for (const j in x) { if (j === 'continuationCommand' && x[j] && typeof x[j].token === 'string') t.push(x[j].token); else f(x[j], e + 1); } }; f(v, 0); tokens.push(...t); }
      else if (k === 'tabRenderer' && v.selected === true) { const u = String((((v.endpoint || {}).commandMetadata || {}).webCommandMetadata || {}).url || ''); if (tab !== 'search' && u && !u.endsWith('/' + tab)) wrongTab = true; walk(v, d + 1); }
      else walk(v, d + 1); }
  };
  walk(window.ytInitialData, 0);
  if (wrongTab) return { items: [], wrongTab: true, more: false, error: null };
  const key = cfg('INNERTUBE_API_KEY'), ctx = cfg('INNERTUBE_CONTEXT');
  let idle = 0, pages = 0, error = null;
  while (follow && tokens.length && out.size < cap && idle < 2 && pages < 300) {
    const t = tokens[tokens.length - 1]; tokens = [];
    if (!ctx) { error = 'no page context'; tokens = [t]; break; }
    const before = out.size;
    try {
      const r = await fetch('/youtubei/v1/browse?prettyPrint=false' + (key ? '&key=' + encodeURIComponent(key) : ''), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ctx, continuation: t }) });
      if (!r.ok) { error = 'next page ' + r.status; tokens = [t]; break; }
      walk(await r.json(), 0);
    } catch (e) { error = String(e && e.message || e); tokens = [t]; break; }
    pages++; idle = out.size > before ? 0 : idle + 1;
  }
  return { items: [...out.values()].slice(0, cap), wrongTab: false, more: tokens.length > 0 && out.size < cap, error };
})`;
const DOM_JS = `(() => { const out = [];
  for (const a of document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]')) { const h = a.getAttribute('href') || '', m = /(?:[?&]v=|\\/shorts\\/)([\\w-]{11})/.exec(h);
    const t = (a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\\s+/g, ' ');
    if (m && t && !/^\\d{1,2}(:\\d{2}){1,2}$/.test(t)) out.push({ id: m[1], title: t.slice(0, 300), short: /\\/shorts\\//.test(h) }); }
  window.scrollTo(0, document.documentElement.scrollHeight); return out; })()`;
async function readTab(load, js2, url, tab, format) {
  await load(url);
  let r;
  try {
    r = await js2(`(${PAGE_JS})(${JSON.stringify(tab)}, ${CAP}, true)`, 12e4);
  } catch (e) {
    r = { items: [], wrongTab: false, more: true, error: String(e?.message ?? e) };
  }
  if (r.wrongTab) return { list: [], error: null };
  const got = new Map(r.items.map((x) => [x.id, { id: x.id, title: x.title, ago: x.ago, dur: x.dur, format }]));
  if (!got.size || r.more) {
    let idle = 0;
    for (let i = 0; i < 400 && idle < 2 && got.size < CAP; i++) {
      const before = got.size;
      let seen = [];
      try {
        seen = await js2(DOM_JS, 15e3);
      } catch {
        break;
      }
      for (const x of seen) if (!got.has(x.id)) got.set(x.id, { id: x.id, title: x.title, ago: null, dur: null, format });
      idle = got.size > before ? 0 : idle + 1;
      await new Promise((res) => setTimeout(res, 1200));
    }
  }
  return { list: [...got.values()].slice(0, CAP), error: got.size ? null : r.error };
}
const channelPath = (t) =>
  t.handle ? "/" + encodeURIComponent(t.handle.replace(/^@/, "").split("/")[0]).replace(/^/, "@") : `/channel/${encodeURIComponent(t.id)}`;
export async function readChannel(t, force = false) {
  const had = reads.get(t.id);
  if (had && !force && Date.now() - had.at < CACHE_MS && had.videos.length) return had;
  const t0 = Date.now();
  try {
    const res = await withWindow(6 * 6e4, async (load, js2) => {
      const base = pageBase() + channelPath(t);
      const v = await readTab(load, js2, base + "/videos", "videos", "long");
      const s = await readTab(load, js2, base + "/shorts", "shorts", "short");
      const by = new Map();
      for (const x of [...v.list, ...s.list]) if (!by.has(x.id)) by.set(x.id, x);
      return {
        videos: [...by.values()],
        tabs: { videos: v.list.length, shorts: s.list.length },
        error: by.size ? null : v.error || s.error || "the channel page showed no videos",
        at: Date.now(),
      };
    });
    log(
      "youtube page reader:",
      t.id,
      `${res.tabs.videos} videos + ${res.tabs.shorts} shorts in ${((Date.now() - t0) / 1e3).toFixed(1)} s`,
      res.error ?? "",
    );
    if (res.videos.length) reads.set(t.id, res);
    return res;
  } catch (e) {
    log("youtube page reader failed:", t.id, e?.message);
    return { videos: [], tabs: { videos: 0, shorts: 0 }, error: String(e?.message ?? e), at: Date.now() };
  }
}
export async function searchChannel(t, queries, budgetMs = 45e3) {
  const out = new Map(),
    todo = [];
  for (const qy of queries) {
    const c = searches.get(`${t.id}|${qy}`);
    if (c && Date.now() - c.at < CACHE_MS) out.set(qy, c.hits);
    else if (!todo.includes(qy)) todo.push(qy);
  }
  if (!todo.length) return out;
  let fails = 0,
    last2 = "";
  await withWindow(budgetMs + 5e3, async (load, js2) => {
    const t0 = Date.now();
    for (const qy of todo) {
      if (Date.now() - t0 > budgetMs) {
        fails++;
        last2 = "out of time";
        continue;
      }
      try {
        await load(`${pageBase()}${channelPath(t)}/search?query=${encodeURIComponent(qy)}`);
        const r = await js2(`(${PAGE_JS})("search", 20, false)`, 15e3);
        const hits = r.items.slice(0, 20).map((x) => ({ id: x.id, title: x.title, format: x.kind === "reel" ? "short" : null }));
        out.set(qy, hits);
        searches.set(`${t.id}|${qy}`, { at: Date.now(), hits });
      } catch (e) {
        fails++;
        last2 = String(e?.message ?? e);
      }
    }
  });
  if (fails && fails === todo.length && !out.size) throw new Error(last2 || "the search page could not be read");
  return out;
}
export function durSeconds(s) {
  if (!s || !/^\d{1,2}(:\d{2}){1,2}$/.test(s)) return null;
  return s.split(":").reduce((a, x) => a * 60 + +x, 0);
}
export const formatOfDuration = (sec) => (sec == null ? null : sec <= 180 ? "short" : "long");
