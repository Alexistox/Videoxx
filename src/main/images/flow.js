import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";
import netMod from "node:net";
import { app, nativeImage } from "electron";
import { log } from "../core/log";

const test = () => process.env.CZ_TEST_HOOKS === "1";
const FLOW_HOME = "https://flow.google.com/";
const flowUrl = () => (test() && process.env.CZ_FLOW_URL) || FLOW_HOME;
const profileDir = () => (test() && process.env.CZ_FLOW_PROFILE) || path.join(app.getPath("userData"), "flow-chrome");
const stateFile = () => path.join(path.dirname(profileDir()), path.basename(profileDir()) + "-state.json");
const TIMEOUT = () => (test() && Number(process.env.CZ_FLOW_TIMEOUT)) || 9e4;
const isMac = process.platform === "darwin";
const SIGN_IN_MSG =
  "Open Flow in Chrome and finish signing in / the check, then try again (Settings > Media > Image generation > Google Flow > Open Flow).";
const POLICY_MSG = "Flow blocked this prompt (policy), nothing was charged. Change the prompt and try again.";
const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
};
const writeState = (s) => {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), ...s }));
  } catch {}
};
export function findChrome() {
  if (test() && process.env.CZ_FLOW_CHROME) return fs.existsSync(process.env.CZ_FLOW_CHROME) ? process.env.CZ_FLOW_CHROME : null;
  const env = process.env;
  const c =
    process.platform === "win32"
      ? [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
          .filter(Boolean)
          .map((d) => path.join(d, "Google", "Chrome", "Application", "chrome.exe"))
      : isMac
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  return c.find((p) => fs.existsSync(p)) ?? null;
}
export const flowReady = () => fs.existsSync(profileDir());
export async function flowState() {
  const port = readState().port;
  return { chrome: !!findChrome(), opened: flowReady(), running: !!(port && (await alive(port))), busy };
}
const alive = async (port) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};
const freePort = () =>
  new Promise((res, rej) => {
    const s = netMod.createServer();
    s.unref();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
async function ensureChrome(url = flowUrl()) {
  const known = readState().port;
  if (known && (await alive(known))) return known;
  const exe = findChrome();
  if (!exe)
    throw new Error(
      `Google Chrome is not installed. Flow pictures need Chrome (free from google.com/chrome)${isMac ? ", in Applications" : ""}.`,
    );
  const port = await freePort();
  fs.mkdirSync(profileDir(), { recursive: true });
  const headless = test() && process.env.CZ_FLOW_HEADLESS === "1";
  const child = cp.spawn(
    exe,
    [
      `--user-data-dir=${profileDir()}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--remote-allow-origins=http://127.0.0.1:${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      // a Flow tab behind other windows must keep working: Chrome otherwise slows its timers and paints
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...(headless ? ["--headless=new", "--window-size=1400,900"] : []),
      url,
    ],
    { detached: true, stdio: "ignore", windowsHide: headless },
  );
  child.on("error", () => {});
  child.unref();
  for (let i = 0; i < 80; i++) {
    if (await alive(port)) {
      writeState({ port });
      return port;
    }
    await sleep(250);
  }
  throw new Error(`Chrome started but did not answer. If a Flow Chrome window is already open, close it and try again.`);
}
export async function openFlow() {
  const port = await ensureChrome();
  const t = await findFlowTarget(port);
  if (t) await fetch(`http://127.0.0.1:${port}/json/activate/${t.id}`).catch(() => {});
  else await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(flowUrl())}`, { method: "PUT" }).catch(() => {});
  return flowState();
}
class CDP {
  constructor(ws) {
    this.ws = ws;
    ws.onmessage = (m) => {
      const msg = JSON.parse(typeof m.data === "string" ? m.data : String(m.data));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
      } else if (msg.method) (this.handlers.get(msg.method) ?? []).forEach((f) => f(msg.params));
    };
    ws.onclose = () => {
      for (const p of this.pending.values()) p.rej(new Error("The Flow Chrome window was closed."));
      this.pending.clear();
    };
  }
  ws;
  id = 0;
  pending = new Map();
  handlers = new Map();
  static async connect(url) {
    const WS = globalThis.WebSocket;
    const ws = new WS(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error("Could not connect to the Flow Chrome window."));
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    this.handlers.set(method, [...(this.handlers.get(method) ?? []), fn]);
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}
const isFlowUrl = (u) => {
  if (test() && process.env.CZ_FLOW_URL) return u.startsWith(new URL(flowUrl()).origin);
  return /^https:\/\/(flow\.google\.com|labs\.google\/fx\/([a-z-]+\/)?tools\/flow|accounts\.google\.com)/.test(u);
};
async function findFlowTarget(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  return list.find((t) => t.type === "page" && isFlowUrl(t.url)) ?? null;
}
const PAGE = `(() => {
  const vis = e => { if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const txt = b => ((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')).replace(/\\s+/g, ' ').trim();
  const prompt = () => {
    const c = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(vis);
    return c.find(e => /prompt|create|describe|imagine|what do you want/i.test((e.getAttribute('placeholder') || '') + (e.getAttribute('aria-label') || '') + (e.dataset.placeholder || ''))) || c[c.length - 1] || null;
  };
  const buttons = () => [...document.querySelectorAll('button, [role="button"]')].filter(vis);
  const dist = (a, b) => { const r = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - q.x - q.width / 2, r.y + r.height / 2 - q.y - q.height / 2); };
  const generate = () => {
    const p = prompt(); if (!p) return null;
    const c = buttons().filter(b => /^(arrow_forward|create|generate|send)\\b|\\barrow_forward\\b/i.test(txt(b)) && !/new project|create project/i.test(txt(b)));
    return c.sort((a, b) => dist(a, p) - dist(b, p))[0] || null;
  };
  const center = e => { e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const images = () => [...document.images].filter(i => i.complete && i.naturalWidth >= 256 && i.naturalHeight >= 128 && vis(i)).map(i => i.currentSrc || i.src).filter(s => !/^data:image\\/svg/.test(s));
  const words = re => (document.body.innerText.match(re) || []).length;
  const challenge = () => [...document.querySelectorAll('iframe')].some(f => /recaptcha\\/.*bframe|\\/challenge/i.test(f.src) && vis(f)) || /unusual traffic|verify (that )?you('re| are) (not a robot|human)/i.test(document.body.innerText.slice(0, 4000));
  const signIn = () => location.hostname === 'accounts.google.com' || (!prompt() && buttons().concat([...document.querySelectorAll('a')].filter(vis)).some(b => /^sign in( with google)?$/i.test(txt(b))));
  const newProject = () => buttons().find(b => /new project/i.test(txt(b))) || null;
  // the aspect ratio: Flow's settings chip under the prompt shows it as an icon only ("🍌 Nano Banana 2.1 crop_16_9 x1"); a
  // real click opens radios that carry the words ("crop_16_9 16:9", "crop_landscape 4:3", "crop_square 1:1",
  // "crop_portrait 3:4", "crop_9_16 9:16"). Words win over icons: "crop_landscape" is 4:3 and "crop_portrait" is 3:4.
  const RATIO = /(^|[^\\d.])(16:9|9:16|1:1|4:3|3:4)(?![\\d.])/;
  const ICON = { crop_16_9: '16:9', crop_9_16: '9:16', crop_square: '1:1', crop_portrait: '3:4', crop_landscape: '4:3', crop_3_4: '3:4', crop_4_3: '4:3' };
  const ratioIn = t => { const m = t.match(RATIO); if (m) return m[2]; const i = t.match(/\\bcrop_[a-z0-9_]+/); return (i && ICON[i[0]]) || null; };
  const choice = e => /^(radio|option|menuitemradio|tab)$/.test(e.getAttribute('role') || '');
  const checked = e => e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-pressed') === 'true' || /^(checked|on|active)$/.test(e.getAttribute('data-state') || '');
  const aspectChip = () => { const p = prompt(), c = buttons().filter(b => !choice(b) && ratioIn(txt(b))); return (p ? c.sort((a, b) => dist(a, p) - dist(b, p)) : c)[0] || null; };
  const aspectOptions = () => { const chip = aspectChip(); return [...document.querySelectorAll('[role="radio"], [role="option"], [role="menuitemradio"], [role="tab"], button')].filter(e => e !== chip && vis(e) && RATIO.test(txt(e))); };
  const aspectOption = want => aspectOptions().find(e => ratioIn(txt(e)) === want) || null;
  const imageMode = () => [...document.querySelectorAll('[role="radio"], [role="tab"]')].filter(vis).find(e => /^(image )?image$/i.test(txt(e))) || null;
  return { vis, txt, prompt, buttons, generate, center, images, words, challenge, signIn, newProject, ratioIn, checked, aspectChip, aspectOptions, aspectOption, imageMode };
})()`;
const POLICY_RE = "/might violate|violates? our (content )?polic|against our polic/gi";
async function attach(port) {
  let t = await findFlowTarget(port);
  if (!t) t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(flowUrl())}`, { method: "PUT" })).json();
  const cdp = await CDP.connect(t.webSocketDebuggerUrl);
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Network.enable", { maxResourceBufferSize: 64e6, maxTotalBufferSize: 2e8 }),
  ]);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  const ev = async (fn) => {
    const body = fn.trim().startsWith("{") ? fn : `(${fn})`;
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(async (F) => ${body})(${PAGE})`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error("Flow page script failed: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const click = async (x, y) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  };
  return { cdp, ev, click };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gone = () => new Error(SIGN_IN_MSG);
const EDIT_RE = /(\/project\/[^/?#]+)\/edit\/[^?#]*/;
const projectRoot = (u) => u.replace(EDIT_RE, "$1");
async function ready(p) {
  const t0 = Date.now();
  let clickedNew = false,
    triedSaved = false,
    leftEdit = 0;
  while (Date.now() - t0 < 45e3) {
    const s = await p
      .ev(
        `{ const pr = F.prompt(), np = F.newProject(); return { url: location.href, ready: document.readyState, prompt: !!pr, signIn: F.signIn(), challenge: F.challenge(), np: np && !pr ? F.center(np) : null }; }`,
      )
      .catch(() => null);
    if (s) {
      if (s.signIn || s.challenge) throw gone();
      if (EDIT_RE.test(s.url)) {
        if (leftEdit++ < 3) {
          log("flow", "leaving an opened picture for its project");
          await p.cdp.send("Page.navigate", { url: projectRoot(s.url) });
          await sleep(2500);
          continue;
        }
      } else if (s.prompt) {
        if (/\/project\//.test(s.url)) writeState({ project: projectRoot(s.url) });
        return;
      }
      const saved = readState().project ? projectRoot(readState().project) : void 0;
      if (s.ready === "complete" && saved && !triedSaved && s.url !== saved) {
        triedSaved = true;
        await p.cdp.send("Page.navigate", { url: saved });
        await sleep(2500);
        continue;
      }
      if (s.np && !clickedNew && Date.now() - t0 > 1500) {
        clickedNew = true;
        await p.click(s.np.x, s.np.y);
        await sleep(2500);
        continue;
      }
    }
    await sleep(700);
  }
  throw new Error(
    "Flow did not show its prompt box. Open Flow in Chrome, make sure a project is open and you are signed in, then try again.",
  );
}
async function pickSetting(p, current, want) {
  try {
    const b = await p.ev(
      `{ const b = F.buttons().find(b => ${current}.test(F.txt(b))); if (!b) return null; if (${want}.test(F.txt(b))) return 'ok'; return F.center(b); }`,
    );
    if (!b || b === "ok") return;
    await p.click(b.x, b.y);
    await sleep(700);
    const o = await p.ev(
      `{ const o = [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], li, button')].filter(F.vis).find(e => ${want}.test(F.txt(e))); return o ? F.center(o) : null; }`,
    );
    if (o) await p.click(o.x, o.y);
    else
      await p.cdp
        .send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
        .then(() => p.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }));
    await sleep(400);
  } catch {}
}
const FLOW_ASPECTS = ["16:9", "4:3", "1:1", "3:4", "9:16"];
const ENUM_SLOT = ["", "SQUARE", "PORTRAIT", "LANDSCAPE", "3_4", "4_3"];
const ratioOf = (a) => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/.exec(a);
  return m && +m[1] > 0 && +m[2] > 0 ? +m[1] / +m[2] : null;
};
function flowAspect(a) {
  const r = a ? ratioOf(a) : null;
  if (!r) return null;
  return FLOW_ASPECTS.reduce((best, x) => (Math.abs(Math.log(ratioOf(x) / r)) < Math.abs(Math.log(ratioOf(best) / r)) ? x : best));
}
function fitsAspect(s, want) {
  const r = s.width / s.height,
    w = ratioOf(want);
  return w === 1 ? Math.abs(r - 1) < 0.08 : w > 1 ? r > 1.05 : r < 0.95;
}
const shapeOf = (s) => (s.width > s.height * 1.05 ? "landscape" : s.height > s.width * 1.05 ? "portrait" : "square");
function requestAspect(body) {
  if (!body) return null;
  let t = body;
  try {
    t = decodeURIComponent(body.replace(/\+/g, " "));
  } catch {}
  const m = t.match(/IMAGE_ASPECT_RATIO_([A-Z0-9_]+)/);
  if (m) return m[1];
  const n = t.match(/\[null,null,null,\d+,([1-5]),\\*"[A-Z0-9_]+\\*"/);
  return n ? ENUM_SLOT[+n[1]] : null;
}
async function pickAspect(p, want, force = false) {
  const W = JSON.stringify(want);
  const look = () =>
    p.ev(`{ const c = F.aspectChip(), o = F.aspectOption(${W}), m = F.imageMode(), open = F.aspectOptions().length > 0;
    return { now: c ? F.ratioIn(F.txt(c)) : null, chip: c ? F.center(c) : null, open, opt: o ? { ...F.center(o), on: F.checked(o) } : null, img: open && m && !F.checked(m) ? F.center(m) : null }; }`);
  let s = await look();
  if (!s.chip && !s.open) return null;
  if (s.now === want && !force && !s.open) return want;
  if (!s.open) {
    await p.click(s.chip.x, s.chip.y);
    await sleep(700);
    s = await look();
  }
  if (s.img) {
    await p.click(s.img.x, s.img.y);
    await sleep(600);
    s = await look();
  }
  if (s.opt) {
    await p.click(s.opt.x, s.opt.y);
    await sleep(500);
    s = await look();
  }
  const on = !!s.opt?.on;
  if (s.open) {
    await esc(p);
    await sleep(400);
    s = await look();
  }
  return s.now ?? (on ? want : null);
}
const extOf = (b) => (b[0] === 137 ? ".png" : b[0] === 255 ? ".jpg" : b.slice(8, 12).toString() === "WEBP" ? ".webp" : ".png");
let busy = false,
  chain = Promise.resolve();
export function flowPicture(req) {
  const run = chain.then(() => {
    busy = true;
    return generateOnce(req).finally(() => {
      busy = false;
    });
  });
  chain = run.catch(() => {});
  return run;
}
async function generateOnce(req) {
  const prompt = String(req.prompt || "").trim();
  if (!prompt) throw new Error("Write a prompt first.");
  const refs = (req.refs ?? []).slice(0, 8).map((f) => {
    const im = nativeImage.createFromPath(f);
    if (im.isEmpty()) throw new Error(`${path.basename(f)} could not be read as a picture.`);
    const { width, height } = im.getSize(),
      k = Math.min(1, 2048 / Math.max(width, height));
    return {
      name: path.basename(f).replace(/\.\w+$/, "") + ".png",
      b64: (k < 1 ? im.resize({ width: Math.round(width * k), height: Math.round(height * k) }) : im).toPNG().toString("base64"),
    };
  });
  const want = flowAspect(req.aspect),
    notes = [];
  if (want && req.aspect && req.aspect.replace(/\s/g, "") !== want)
    notes.push(`Flow has no ${req.aspect} pictures: this one is ${want}, the closest it offers.`);
  const port = await ensureChrome();
  const p = await attach(port);
  const t0 = Date.now();
  const byUrl = new Map(),
    gen = new Set();
  const net2 = { err: null, image: null, aspect: null };
  const posts = new Map();
  p.cdp.on("Network.requestWillBeSent", (e) => {
    if (e.request?.method !== "POST") return;
    posts.set(e.requestId, false);
    if (/batchGenerateImages|ogiZ0b/.test(e.request.url)) net2.aspect = requestAspect(e.request.postData) ?? net2.aspect;
  });
  p.cdp.on("Network.responseReceived", (e) => {
    byUrl.set(e.response.url, e.requestId);
    if (/batchGenerateImages|ogiZ0b/.test(e.response.url)) gen.add(e.requestId);
  });
  const done = (e) => {
    if (posts.has(e.requestId)) posts.set(e.requestId, true);
  };
  p.cdp.on("Network.loadingFailed", done);
  p.cdp.on("Network.loadingFinished", async (e) => {
    done(e);
    if (!gen.has(e.requestId)) return;
    try {
      const r = await p.cdp.send("Network.getResponseBody", { requestId: e.requestId });
      const body = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
      if (/PUBLIC_ERROR_UNSAFE_GENERATION/.test(body)) net2.err = POLICY_MSG;
      else if (/PUBLIC_ERROR_UNUSUAL_ACTIVITY/.test(body))
        net2.err = "Flow refused this run (unusual activity). Open Flow in Chrome, make one picture there by hand, then try again.";
      else if (/RESOURCE_EXHAUSTED|INSUFFICIENT_CREDIT|out of credits/i.test(body))
        net2.err = "Your Flow credits ran out for now. Check your plan in Flow, then try again.";
      const m = body.match(/"fifeUrl"\s*:\s*"([^"]+)"/);
      if (m) net2.image = JSON.parse(`"${m[1]}"`);
    } catch {}
  });
  try {
    await ready(p);
    await pickSetting(p, "/nano banana|imagen|narwhal|beluga/i", "/nano banana 2\\.1|beluga/i");
    await pickSetting(
      p,
      "/(^|\\s)x\\s?[1-4]\\b|\\b[1-4]\\s*(outputs?|images?|results?)\\b|outputs per prompt/i",
      "/(^|\\s)x\\s?1\\b|^\\s*1\\s*$|\\b1\\s*(output|image|result)\\b/i",
    );
    let r = await makeOne(false),
      size = nativeImage.createFromBuffer(r.buf).getSize();
    if (want && !fitsAspect(size, want)) {
      log(
        "flow",
        `asked ${want}, got ${size.width}x${size.height} (request said ${net2.aspect ?? "?"}): picking ${want} again, one more try`,
      );
      r = await makeOne(true);
      size = nativeImage.createFromBuffer(r.buf).getSize();
      if (!fitsAspect(size, want))
        throw new Error(
          `Flow made a ${shapeOf(size)} picture (${size.width}x${size.height}) twice although ${want} was picked, so it was not used. Look at the aspect setting under the prompt in the Flow window (Chrome), then try again.`,
        );
    }
    const { buf, src } = r;
    log("flow", "picture", buf.length, "bytes", `${size.width}x${size.height}`, want ?? "", "in", Date.now() - t0, "ms");
    const note = (extra) => [...notes, extra].filter(Boolean).join(" ") || void 0;
    if (req.upscale2k) {
      let big = await upscale2k(p, port, src).catch((e) => {
        log("flow", "2K failed", e?.message);
        return null;
      });
      if (big && want && !fitsAspect(nativeImage.createFromBuffer(big).getSize(), want)) {
        log("flow", "2K has the wrong shape: the 1K is used");
        big = null;
      }
      if (big) {
        log("flow", "2K", big.length, "bytes in", Date.now() - t0, "ms");
        return { buf: big, ext: extOf(big), cost: 0, upscaled: true, ...(note() ? { note: note() } : {}) };
      }
      return {
        buf,
        ext: extOf(buf),
        cost: 0,
        upscaled: false,
        note: note("Flow's 2K download was not found in time, so this is the 1K picture."),
      };
    }
    return { buf, ext: extOf(buf), cost: 0, ...(note() ? { note: note() } : {}) };
  } finally {
    p.cdp.close();
  }
  async function makeOne(again) {
    net2.err = null;
    net2.image = null;
    net2.aspect = null;
    if (want) {
      let now = await pickAspect(p, want, again);
      if (now !== want) {
        log("flow", `aspect shows ${now ?? "nothing"}, wanted ${want}: picking it again`);
        await sleep(600);
        now = await pickAspect(p, want, true);
      }
      if (now !== want)
        throw new Error(
          `Flow's aspect ratio could not be set to ${want}${now ? ` (it stays on ${now})` : " (its setting under the prompt was not found)"}, so nothing was made. Flow may have changed its page; this service is at your own risk.`,
        );
    }
    const box = await p.ev(`{ const e = F.prompt(); return e ? F.center(e) : null; }`);
    if (!box) throw gone();
    await p.click(box.x, box.y);
    await p.ev(
      `{ const e = F.prompt(); e.focus(); if ('select' in e && e.tagName === 'TEXTAREA') e.select(); else getSelection().selectAllChildren(e); return true; }`,
    );
    await p.cdp.send("Input.insertText", { text: prompt });
    for (const r of refs) {
      posts.clear();
      const ok =
        await p.ev(`{ const e = F.prompt(); if (!e) return false; e.focus(); const bin = atob(${JSON.stringify(r.b64)}), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([u], ${JSON.stringify(r.name)}, { type: 'image/png' }));
        e.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; }`);
      if (!ok) throw new Error("Flow lost its prompt box while adding a reference picture.");
      const u0 = Date.now();
      let quiet = 0;
      while (Date.now() - u0 < 45e3) {
        await sleep(400);
        const all = [...posts.values()],
          open = all.filter((v) => !v).length;
        quiet = all.length && !open ? quiet + 400 : 0;
        if (quiet >= 1200 && Date.now() - u0 > 1500) break;
      }
    }
    const before = await p.ev(`F.images()`),
      pol0 = await p.ev(`F.words(${POLICY_RE})`);
    const g = await p.ev(
      `{ const b = F.generate(); if (!b) return null; return { ...F.center(b), off: b.disabled || b.getAttribute('aria-disabled') === 'true' }; }`,
    );
    if (!g) throw new Error("Flow's Generate button was not found. Flow may have changed its page; this service is at your own risk.");
    if (g.off) {
      await sleep(1500);
    }
    await p.click(g.x, g.y);
    log("flow", "generate", prompt.slice(0, 80), refs.length, "refs");
    const seen = new Set(before),
      tGen = Date.now();
    let src = null;
    while (Date.now() - tGen < TIMEOUT()) {
      await sleep(1e3);
      if (net2.err) throw new Error(net2.err);
      const s = await p.ev(`({ imgs: F.images(), pol: F.words(${POLICY_RE}), ch: F.challenge() || F.signIn() })`).catch(() => null);
      if (!s) continue;
      if (s.ch) throw gone();
      if (s.pol > pol0) throw new Error(POLICY_MSG);
      src = s.imgs.find((u) => !seen.has(u)) ?? null;
      if (src) break;
    }
    if (!src) {
      log("flow", "no tile in time: reloading the project");
      await p.cdp.send("Page.reload", { ignoreCache: false });
      const r0 = Date.now();
      while (!src && Date.now() - r0 < 3e4) {
        await sleep(1500);
        if (net2.err) throw new Error(net2.err);
        const imgs = await p.ev(`F.images()`).catch(() => []);
        src = imgs.find((u) => !seen.has(u)) ?? null;
      }
      if (!src)
        throw new Error(
          `Flow did not finish the picture in ${Math.round(TIMEOUT() / 1e3)} s. Look at the Flow window in Chrome: if it finished there, run it again.`,
        );
    }
    const buf = await download(p, net2.image ?? src, byUrl).catch((e) =>
      net2.image && net2.image !== src ? download(p, src, byUrl) : Promise.reject(e),
    );
    return { buf, src };
  }
}
const UPSCALE_TIMEOUT = () => (test() && Number(process.env.CZ_FLOW_2K_TIMEOUT)) || 4e4;
const esc = (p) =>
  p.cdp
    .send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
    .then(() => p.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }))
    .catch(() => {});
async function upscale2k(p, port, src) {
  const v = await alive(port);
  if (!v?.webSocketDebuggerUrl) return null;
  const browser = await CDP.connect(v.webSocketDebuggerUrl);
  const dir = fs.mkdtempSync(path.join(app.getPath("userData"), "flow-dl-"));
  let done = null,
    failed = false;
  const names = new Map();
  browser.on("Browser.downloadWillBegin", (e) => names.set(e.guid, e.suggestedFilename || ""));
  browser.on("Browser.downloadProgress", (e) => {
    if (e.state === "completed" && names.has(e.guid)) done = e.guid;
    else if (e.state === "canceled") failed = true;
  });
  const t0 = Date.now(),
    left = () => UPSCALE_TIMEOUT() - (Date.now() - t0);
  try {
    await browser.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: dir, eventsEnabled: true });
    const tile = await p.ev(
      `{ const i = [...document.images].find(i => (i.currentSrc || i.src) === ${JSON.stringify(src)}) || [...document.images].find(i => (i.currentSrc || i.src).endsWith(${JSON.stringify(src)})); return i ? F.center(i) : null; }`,
    );
    if (!tile) return null;
    const dlButton = () =>
      p.ev(`{ const t = { x: ${tile.x}, y: ${tile.y} }; const c = F.buttons().filter(b => /\\bdownload\\b/i.test(F.txt(b)));
      const d = b => { const r = b.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - t.x, r.y + r.height / 2 - t.y); };
      const b = c.sort((a, b) => d(a) - d(b))[0]; return b ? F.center(b) : null; }`);
    await p.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tile.x, y: tile.y, button: "none" });
    await sleep(600);
    let b = await dlButton();
    if (!b) {
      await p.click(tile.x, tile.y);
      await sleep(1500);
      b = await dlButton();
    }
    if (!b) return null;
    await p.click(b.x, b.y);
    let o = null;
    while (!o && left() > 0) {
      await sleep(500);
      o = await p
        .ev(
          `{ const o = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], li, button')].filter(F.vis).find(e => /\\b2\\s?K\\b/i.test(F.txt(e)) && !/upgrade/i.test(F.txt(e))); return o ? F.center(o) : null; }`,
        )
        .catch(() => null);
      if (!o && Date.now() - t0 > 15e3) break;
    }
    if (!o) {
      await esc(p);
      return null;
    }
    await p.click(o.x, o.y);
    log("flow", "asked for the 2K download");
    while (!done && !failed && left() > 0) await sleep(400);
    if (!done) return null;
    const f = path.join(dir, done);
    if (!fs.existsSync(f)) return null;
    const buf = fs.readFileSync(f);
    return buf.length && !nativeImage.createFromBuffer(buf).isEmpty() ? buf : null;
  } finally {
    await browser.send("Browser.setDownloadBehavior", { behavior: "default" }).catch(() => {});
    browser.close();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}
const TO_PNG = `async b => { if (!b || !b.size) return null; try { const bm = await createImageBitmap(b); const c = new OffscreenCanvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0);
  b = await c.convertToBlob({ type: 'image/png' }); } catch {} return await new Promise(res => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = () => res(null); f.readAsDataURL(b); }); }`;
async function download(p, url, byUrl) {
  const abs = await p.ev(`new URL(${JSON.stringify(url)}, location.href).href`).catch(() => url);
  const ok = (b) => !!b?.length && !nativeImage.createFromBuffer(b).isEmpty();
  const inPage = (js2) =>
    p
      .ev(`(async () => { const png = ${TO_PNG}; try { return await png(await (${js2})); } catch { return null; } })()`)
      .then((s) => (s ? Buffer.from(s, "base64") : null))
      .catch(() => null);
  const tried = [];
  for (const cred of ["include", "omit"]) {
    const buf = await inPage(`fetch(${JSON.stringify(abs)}, { credentials: '${cred}' }).then(r => r.ok ? r.blob() : null)`);
    if (buf && ok(buf)) return buf;
    tried.push(`page fetch (${cred}): ${buf ? "unreadable" : "failed"}`);
  }
  if (byUrl.has(abs)) {
    const r = await p.cdp.send("Network.getResponseBody", { requestId: byUrl.get(abs) }).catch(() => null);
    const raw = r ? Buffer.from(r.body, r.base64Encoded ? "base64" : "utf8") : null;
    if (raw && ok(raw)) return raw;
    if (raw && raw.length) {
      const buf = await inPage(`fetch('data:image/*;base64,${raw.toString("base64")}').then(r => r.blob())`);
      if (buf && ok(buf)) return buf;
    }
    tried.push(`loaded copy: ${raw ? "unreadable" : "gone"}`);
  } else tried.push("loaded copy: none");
  {
    const buf =
      await inPage(`(async () => { const i = [...document.images].find(i => (i.currentSrc || i.src) === ${JSON.stringify(abs)} || (i.currentSrc || i.src) === ${JSON.stringify(url)}); if (!i) return null;
      if (!i.complete) await new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 10000); }); const c = new OffscreenCanvas(i.naturalWidth, i.naturalHeight); c.getContext('2d').drawImage(i, 0, 0); return await c.convertToBlob({ type: 'image/png' }); })()`);
    if (buf && ok(buf)) return buf;
    tried.push(`tile canvas: ${buf ? "unreadable" : "failed"}`);
  }
  if (/^https:/.test(abs)) {
    const buf = await fetch(abs, { headers: { Accept: "image/png,image/jpeg;q=0.9,*/*;q=0.1" } })
      .then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null))
      .catch(() => null);
    if (buf && ok(buf)) return buf;
    tried.push(`direct: ${buf ? "unreadable format" : "failed"}`);
  }
  log("flow", "download failed", abs.slice(0, 120), tried.join("; "));
  throw new Error(
    `Flow made the picture, but the app could not save it (${tried.join("; ")}). Try again; if it keeps happening, send this message to support.`,
  );
}
