import path from "node:path";
import fs from "node:fs";
import { nativeImage } from "electron";
import { log } from "../core/log";
import { engineDirOf, getStyle } from "../styles/catalog";
import { layoutCheckWith } from "../render/workers";
import { applyCheckRun, issueSummary } from "../projects/issues";
import { requireStudio } from "./stages";
import { aspectsOfStyle, exportNames } from "./workspace";
import { structureOf } from "./staticCheck";

const SEVERITY = {
  boot: "high",
  throw: "high",
  contract: "high",
  "check-broken": "high",
  banned: "high",
  blank: "high",
  cut: "high",
  caption: "high",
  band: "high",
  dark: "high",
  crushed: "high",
  frame: "high",
  floating: "high",
  through: "high",
  contact: "high",
  collide: "high",
  coplanar: "high",
  flicker: "high",
  nocollide: "high",
  support: "high",
  sunk: "high",
  overlap: "medium",
  small: "medium",
  contrast: "medium",
  kit: "medium",
  frozen: "medium",
  same: "medium",
  cue: "medium",
  empty: "low",
  abrupt: "low",
};
const MEANING = {
  boot: "nothing in this view renders: every frame of it is broken",
  throw: "that frame breaks (in the preview and in every export)",
  contract: "the host page and every project made in the style import this export: without it they break",
  "check-broken": "the check no longer catches the fault it exists for, so a Clean result means nothing",
  banned: "the video is not the same on every render (preview, stills, export), or it runs code from outside the style",
  blank: "the frame shows nothing: a scene drew nothing, or everything is hidden or off-frame",
  frozen: "nothing moves on screen for the whole shot",
  same: "two shots in a row look the same: the cut says nothing",
  cue: "a cue word is not in the narration, so the beat lands at a guessed time",
  cut: "an element is cropped or crowds the edge",
  caption: "it sits where captions draw",
  band: "it sits where captions draw",
  overlap: "two elements collide by accident",
  small: "unreadable on a phone",
  contrast: "text does not read on what is behind it",
  empty: "the frame says nothing",
  dark: "the subject can't be seen",
  crushed: "shadows lose all detail",
  abrupt: "the camera snaps or whips",
  kit: "a kit element can't be judged",
  floating: "a 3D solid hovers",
  through: "solids interpenetrate",
  coplanar: "z-fighting (flicker)",
  flicker: "z-fighting seen in the render",
  nocollide:
    "the people in this shot are never checked against each other or the props: the checks say Clean while bodies pass through each other and through solids",
  support: "a person hangs in the air (bodies are exempt from the floating check, so nothing else catches it)",
  sunk: "a person goes into the floor or the seat (feet through the floor are not checked otherwise)",
};
export const RECON_COLLIDE_PROBE = `(async () => {
  const E = window.E; if (!E || !Array.isArray(E.SHOTS) || typeof E.compose !== 'function') return null;
  const info = window.suite && window.suite.info ? window.suite.info() : null, end = info && info.end ? +info.end : 0, out = [];
  for (let i = 0; i < E.SHOTS.length; i++) {
    const d = E.SHOTS[i], nx = E.SHOTS[i + 1], t1 = d.t1 != null ? d.t1 : nx ? nx.t0 : (end || d.t0 + 4), mid = +(d.t0 + (t1 - d.t0) * .5).toFixed(2);
    try { E.compose(mid); } catch (e) { continue; }
    const S = d._S; if (!S || !S.scene) continue;
    let people = 0, rigged = 0; const casts = new Set();
    S.scene.traverse(o => { const u = o.userData || {};
      if (u.kind === 'person') people++;                                   // a library figure (lib/figures.js)
      else if (u.castOf && Array.isArray(u.castOf.drawn) && u.castOf.drawn.length && !casts.has(u.castOf)) { casts.add(u.castOf); people += u.castOf.drawn.length; }   // the clay crowd (models.js cast)
      else if (o.isSkinnedMesh) { let p = o.parent, inside = false; while (p) { if (p.userData && p.userData.kind === 'person') { inside = true; break; } p = p.parent; } if (!inside) rigged++; } });   // a rigged library actor
    // the bodies S.collide declares are exempt from the floating / contact check: is each one standing, sitting or lying ON
    // something? (a ray down from its lowest capsule point; a body declared { airborne: true } flies, falls or swims)
    const support = [], THREE = E.THREE;
    if (S.collide && typeof S.collide.bodies === 'function' && THREE) {
      let bodies = []; try { bodies = S.collide.bodies() || []; } catch (e) { bodies = []; }
      const skip = new Set(), surfaces = [], vis = o => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
      S.scene.traverse(o => { const u = o.userData || {}; if (u.kind === 'person') o.traverse(c => skip.add(c)); else if (u.castOf || o.isSkinnedMesh) skip.add(o); });
      S.scene.traverse(o => { if (o.isMesh && !skip.has(o) && !(o.userData && o.userData.airborne) && vis(o)) surfaces.push(o); });
      const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), UP = .25;
      for (const b of bodies.slice(0, 40)) {
        if (!b || b.airborne || !Array.isArray(b.caps)) continue;
        let low = null; for (const c of b.caps) for (const p of [c && c.a, c && c.b]) if (p && (low == null || p.y - (c.r || 0) < low.y)) low = { x: p.x, y: p.y - (c.r || 0), z: p.z };
        if (!low) continue;
        rc.set(new THREE.Vector3(low.x, low.y + UP, low.z), down); rc.far = 60;
        const hit = rc.intersectObjects(surfaces, false)[0]; if (!hit) continue;
        const gap = hit.distance - UP;
        if (gap > .15 || gap < -.08) support.push({ name: String(b.name || 'a body').slice(0, 60), gap: +gap.toFixed(3) });
      }
    }
    out.push({ i, name: String(d.name || ''), file: String(d._file || ''), line: +d._line || 0, t: mid, figures: people + (rigged ? 1 : 0), collide: !!S.collide, support });
    await new Promise(r => setTimeout(r, 0));
  }
  return out;
})()`;
const probeOf = (base) => (base === "recon" ? RECON_COLLIDE_PROBE : null);
function qualityOf(dir) {
  let t = "";
  try {
    t = fs.readFileSync(path.join(dir, "skill", "QUALITY.md"), "utf8");
  } catch {}
  const severity = {},
    meaning = {};
  for (const m of t.matchAll(/^\s*[-*]?\s*`?severity\s+([A-Za-z][\w-]*)\s*:\s*(high|medium|low)\b/gim))
    severity[m[1].toLowerCase()] = m[2].toLowerCase();
  for (const m of t.matchAll(/^\|\s*([A-Za-z][\w-]*)\s*:[^|]*\|\s*([^|]+?)\s*\|/gm))
    if (!/^_?\(to fill/.test(m[2])) meaning[m[1].toLowerCase()] ??= m[2];
  return { severity, meaning };
}
export function stripJs(src, keepStrings) {
  const out = src.split(""),
    n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < Math.min(b, n); k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  const stack = [];
  let depth = 0,
    prev = "",
    i = 0;
  const template = (from) => {
    let j = from;
    while (j < n && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) {
      if (src[j] === "\\") j++;
      j++;
    }
    if (!keepStrings) blank(from, j);
    if (src[j] === "$") {
      stack.push(depth);
      depth++;
      prev = "{";
      return j + 2;
    }
    prev = "`";
    return j + 1;
  };
  while (i < n) {
    const c = src[i],
      d = src[i + 1];
    if (c === "/" && d === "/") {
      const e = src.indexOf("\n", i);
      const end = e < 0 ? n : e;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        j++;
      }
      if (!keepStrings) blank(i + 1, j);
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === "`") {
      i = template(i + 1);
      continue;
    }
    if (c === "/" && (!prev || "(,=:[!&|?{};+-*%<>~^".includes(prev))) {
      let j = i + 1,
        cls = false;
      while (j < n && src[j] !== "\n" && (cls || src[j] !== "/")) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      prev = "/";
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (stack.length && stack[stack.length - 1] === depth) {
        stack.pop();
        i = template(i + 1);
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}
const ALWAYS_BANNED = ["eval(", "new Function(", "Math.random(", "Date.now("];
const BANNED_FIX = [
  [/random/i, "use fixed values or the engine's seeded random (the same numbers on every render)"],
  [/now\(|Date/i, "use the frame time the engine passes (t / the shot's time), never the clock"],
  [/eval|Function/, "write the code out as plain code"],
];
const tokenRx = (tok) => {
  const esc = tok
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\($/, "\\s*\\(")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\w$.])${esc}`, "g");
};
const lineAt = (s, i) => {
  let n = 1;
  for (let k = 0; k < i; k++) if (s.charCodeAt(k) === 10) n++;
  return n;
};
function walk(dir, rel, out) {
  let es = [];
  try {
    es = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of es) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, r, out);
    else if (/\.(m?js)$/i.test(e.name)) out.push(r);
  }
}
export function bannedScan(dir, studio) {
  let manifest = [];
  try {
    const sj = JSON.parse(fs.readFileSync(path.join(dir, "style.json"), "utf8"));
    if (Array.isArray(sj?.banned)) manifest = sj.banned.filter((x) => typeof x === "string");
  } catch {
    manifest = getStyle(studio.target).pkg?.manifest.banned ?? [];
  }
  const tokens = [...new Set([...ALWAYS_BANNED, ...manifest.map((s) => s.trim()).filter((s) => s.length >= 3 && s.length <= 80)])];
  const files = [];
  walk(dir, "scenes", files);
  walk(dir, "lib", files);
  if (fs.existsSync(path.join(dir, "models.js"))) files.push("models.js");
  const baseDir = engineDirOf(studio.target),
    out = [];
  for (const rel of files) {
    if (/^scenes\/mustfail_/i.test(rel)) continue;
    let src = "";
    try {
      src = fs.readFileSync(path.join(dir, rel), "utf8");
    } catch {
      continue;
    }
    try {
      if (!rel.startsWith("scenes/") && fs.readFileSync(path.join(baseDir, rel), "utf8") === src) continue;
    } catch {}
    for (const b of bannedInSource(src, tokens)) {
      if (b.token === "absolute URL") {
        out.push({
          check: "banned",
          title: `BANNED: loads code or data from an absolute URL in ${rel}:${b.line}`,
          fix: b.fix,
          where: { file: rel, line: b.line, element: "absolute URL" },
        });
        continue;
      }
      out.push({
        check: "banned",
        title: `BANNED: ${b.token} in ${rel}:${b.line}`,
        fix: b.fix,
        where: { file: rel, line: b.line, element: b.token },
      });
    }
  }
  return out;
}
export function bannedInSource(src, tokens = ALWAYS_BANNED) {
  const out = [],
    code = stripJs(src, false),
    withStrings = stripJs(src, true);
  for (const tok of [...new Set([...ALWAYS_BANNED, ...tokens])]) {
    const m = tokenRx(tok).exec(code);
    if (!m) continue;
    out.push({
      token: tok,
      line: lineAt(code, m.index),
      fix: BANNED_FIX.find(([r]) => r.test(tok))?.[1] ?? "remove it (the style's manifest bans it)",
    });
  }
  const url =
    /\b(?:fetch|import)\s*\(\s*(['"`])\s*(?:https?:)?\/\/|\bfrom\s*(['"`])\s*(?:https?:)?\/\/|^\s*import\s*(['"`])\s*(?:https?:)?\/\//m.exec(
      withStrings,
    );
  if (url)
    out.push({
      token: "absolute URL",
      line: lineAt(withStrings, url.index),
      fix: "put the file into the workspace (assets/, lib/) and load it by a relative path: a style never reaches the internet",
    });
  return out;
}
function exportDiff(dir, studio) {
  let src = null;
  try {
    src = fs.readFileSync(path.join(dir, "engine.js"), "utf8");
  } catch {}
  if (src == null)
    return [
      {
        check: "contract",
        title: "CONTRACT: engine.js is missing",
        fix: "restore engine.js (roll back to the last version that had it)",
        where: { file: "engine.js", element: "engine.js" },
      },
    ];
  const now = new Set(exportNames(src));
  return (studio.baseExports ?? [])
    .filter((n) => !now.has(n))
    .map((n) => ({
      check: "contract",
      title: `CONTRACT: engine.js no longer exports ${n}`,
      fix: `export ${n} again (exports may be added, never removed or renamed: keep the old name exported, as an alias if it was renamed)`,
      where: { file: "engine.js", element: n },
    }));
}
export function frameStat(png) {
  try {
    const img = nativeImage.createFromBuffer(png);
    if (img.isEmpty()) return null;
    const sm = img.resize({ width: 64, quality: "good" }),
      { width, height } = sm.getSize(),
      bmp = sm.toBitmap();
    const L = new Float32Array(width * height),
      hist = new Uint32Array(256);
    let sum = 0,
      dark = 0;
    for (let i = 0; i < L.length; i++) {
      const v = (bmp[i * 4] * 0.2 + bmp[i * 4 + 1] * 0.6 + bmp[i * 4 + 2] * 0.2) / 255;
      L[i] = v;
      sum += v;
      hist[Math.min(255, Math.round(v * 255))]++;
      if (v < 0.06) dark++;
    }
    const q = (p) => {
      let c = 0;
      const want = p * L.length;
      for (let k = 0; k < 256; k++) {
        c += hist[k];
        if (c >= want) return k / 255;
      }
      return 1;
    };
    return { mean: sum / L.length, lo: q(0.02), hi: q(0.98), darkFrac: dark / L.length, small: L };
  } catch {
    return null;
  }
}
export const diffOf = (a, b) => {
  if (a.small.length !== b.small.length) return 1;
  let s = 0;
  for (let i = 0; i < a.small.length; i++) s += Math.abs(a.small[i] - b.small[i]);
  return s / a.small.length;
};
const PLACEHOLDER = /PLACEHOLDER \(/;
const readPj = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8").replace(/^﻿/, ""));
const mergeSettings = (a, b) => {
  const o = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {}))
    o[k] =
      v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? { ...o[k], ...v } : v;
  return o;
};
export function settingsFor(dir, studio, aspect) {
  let s = mergeSettings(readPj(dir).settings, studio.look?.settings);
  if (aspectsOfStyle(studio.target).length > 1) s = { ...s, format: aspect === "9:16" ? "vertical" : "landscape" };
  return s;
}
const isMustFail = (name, v) => !!v.expect || /^mustfail/i.test(name);
export function mainView(studio) {
  const has = (v) => !!studio.views?.[v];
  const order = ["review", "publish", "sample", "look", "save"].includes(studio.stage)
    ? ["sample", "kit", "hero"]
    : studio.stage === "kit"
      ? ["kit", "sample", "hero"]
      : ["hero", "sample", "kit"];
  return order.find(has) ?? Object.keys(studio.views ?? {}).find((v) => !isMustFail(v, studio.views[v])) ?? null;
}
export const aspectTag = (a) => a.replace(":", "x");
async function pool(items, n, f) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const k = next++;
        if (k >= items.length) return;
        out[k] = await f(items[k]);
      }
    }),
  );
  return out;
}
export async function runChecks(projectId, opts = {}) {
  const t0 = Date.now(),
    { dir, studio } = requireStudio(projectId);
  const aspects = opts.aspects?.length ? opts.aspects.filter((a) => studio.aspects.includes(a)) : studio.aspects;
  const all = Object.entries(studio.views ?? {})
    .filter(([k, v]) => !opts.views?.length || opts.views.includes(k))
    .filter(([, v]) => Array.isArray(v?.scenes) && v.scenes.length && +v.end > 0);
  const placeholder = (v) =>
    v.scenes.every((s) => {
      try {
        return PLACEHOLDER.test(fs.readFileSync(path.join(dir, "scenes", `${s}.js`), "utf8"));
      } catch {
        return false;
      }
    });
  const views = all.filter(([, v]) => !placeholder(v)),
    main = mainView(studio),
    q = qualityOf(dir);
  const RANK = { low: 0, medium: 1, high: 2 };
  const sevOf = (check) => {
    const c = check.toLowerCase(),
      built = SEVERITY[c] ?? "medium",
      d = q.severity[c];
    return d && (RANK[d] ?? -1) > (RANK[built] ?? -1) ? d : built;
  };
  const meanOf = (check) => q.meaning[check.toLowerCase()] ?? MEANING[check.toLowerCase()] ?? "";
  const found = [],
    frames = {},
    shotsOut = {};
  const attempted = new Set(),
    booted = new Set(),
    pairs = [];
  const jobs = [];
  for (const [name, v] of views) {
    const must = isMustFail(name, v);
    for (const a of must ? aspects.slice(0, 1) : aspects) jobs.push({ name, v, aspect: a, must });
  }
  const probe = probeOf(studio.base);
  const results = await pool(jobs, 3, async (j) => {
    const isMain = j.name === main,
      motion = /^sample/i.test(j.name);
    let r;
    try {
      r = await layoutCheckWith(
        projectId,
        settingsFor(dir, studio, j.aspect),
        { scenes: j.v.scenes, end: +j.v.end },
        {
          sweepFps: !j.must && isMain && opts.sweep !== false ? 4 : null,
          probe: probe && !j.must && j.aspect === aspects[0] ? probe : null,
          // (once per view: what it finds is the scene's, not the frame's)
          // a must-fail view gets its shots' middles too: on an engine with no layout check (pixel / stickman) the app-side
          // frame checks (BLANK, DARK) are what it proves
          stills: j.must
            ? (info) => {
                const shots = info?.shots ?? [],
                  end = +j.v.end;
                return {
                  times: [
                    ...new Set(shots.map((s) => +Math.max(0, Math.min(end - 0.02, s.t0 + ((s.t1 ?? end) - s.t0) * 0.5)).toFixed(2))),
                  ].slice(0, 6),
                  scale: 0.5,
                };
              }
            : (info, lay) => {
                const shots = info?.shots ?? [],
                  end = +j.v.end,
                  cap = isMain || motion ? 24 : 12,
                  clampT = (t) => +Math.max(0, Math.min(end - 0.02, t)).toFixed(2);
                const mids = shots.map((s) => clampT(s.t0 + ((s.t1 ?? end) - s.t0) * 0.5)),
                  ends = shots.map((s) => clampT(s.t0 + ((s.t1 ?? end) - s.t0) * 0.88)),
                  starts = shots.map((s) => clampT(s.t0 + ((s.t1 ?? end) - s.t0) * 0.12));
                const issueTs = [...new Set((lay?.issues ?? []).map((i) => clampT(+i.t)).filter((t) => isFinite(t)))];
                const ts = [];
                for (const t of [...mids, ...issueTs, ...ends, ...starts]) if (!ts.includes(t)) ts.push(t);
                return { times: ts.slice(0, cap).sort((a, b) => a - b), scale: 0.5 };
              },
        },
      );
    } catch (e) {
      r = { bootError: String(e?.message || e), info: null, layout: null, stills: [], sweep: null, errors: [], ms: 0 };
    }
    return { j, r, isMain, motion };
  });
  for (const { j, r, isMain, motion } of results) {
    const key2 = `${j.name}|${j.aspect}`,
      base = { view: j.name, aspect: j.aspect };
    attempted.add(key2);
    const scene0 = `scenes/${j.v.scenes[0]}.js`;
    let n = found.length;
    if (r.bootError) {
      found.push({
        check: "boot",
        title: `BOOT: the ${j.name} view does not load (${j.aspect}): ${r.bootError}`.slice(0, 200),
        fix: "fix the error it names (check_preview shows it with its line)",
        where: { ...base, file: scene0, element: "boot" },
      });
      pairs.push({ view: j.name, aspect: j.aspect, ms: r.ms, boot: false, layout: false, issues: found.length - n });
      continue;
    }
    booted.add(key2);
    const shots = r.info?.shots ?? [];
    if (!j.must)
      (shotsOut[j.aspect] ??= {})[j.name] = shots.map((s, k) => ({
        t0: +s.t0,
        t1: +(s.t1 ?? shots[k + 1]?.t0 ?? j.v.end),
        name: String(s.name ?? "").slice(0, 80),
      }));
    const shotOf = (t) => {
      let k = -1;
      shots.forEach((s, i) => {
        if (t >= s.t0 - 1e-6) k = i;
      });
      return k >= 0 ? k : null;
    };
    const throws = new Map();
    const addThrow = (text, t) => {
      const m = /^shot (\d+) \(([^():]+):(\d+)\) at ([\d.]+)s: (.*)$/s.exec(text),
        ld = /^scene ([\w-]+\.js) failed to load: (.*)$/s.exec(text);
      const file = m ? m[2] : ld ? `scenes/${ld[1]}` : null,
        msg = (m ? m[5] : ld ? ld[2] : text).trim().slice(0, 160),
        tt = m ? +m[4] : t;
      const k = `${file}|${msg}`;
      if (throws.has(k)) return;
      throws.set(k, {
        check: "throw",
        title: `THROW: ${msg}${file ? ` (${file}${m ? ":" + m[3] : ""})` : ""}`.slice(0, 200),
        fix: "fix the scene code at that line (render_view the moment to see it break)",
        where: { ...base, t: tt, shot: m ? +m[1] - 1 : null, file, line: m ? +m[3] : null, element: msg.slice(0, 100) },
      });
    };
    for (const e of r.errors ?? []) if (e.level === "error" && !/^No timeline yet/.test(e.text)) addThrow(e.text, null);
    for (const e of r.sweep?.errors ?? []) addThrow(`${e.where}: ${e.message}`, e.t);
    found.push(...throws.values());
    for (const e of r.errors ?? [])
      if (/cue miss/i.test(e.text)) {
        const w = /cue miss\W+["']?([^"']+)/i.exec(e.text)?.[1]?.slice(0, 60) ?? e.text.slice(0, 60);
        found.push({
          check: "cue",
          title: `CUE: ${e.text}`.slice(0, 200),
          fix: "cue a word that is in audio/timeline.json (the narration tool lists them)",
          where: { ...base, element: w },
        });
      }
    if (j.must) {
      const types = [...new Set((r.layout?.issues ?? []).map((i) => String(i.type)))],
        want = String(j.v.expect ?? "");
      if (!r.layout)
        for (const s of r.stills) {
          const m = s.png ? frameStat(s.png) : null;
          if (!m) continue;
          for (const ft of [structureOf(m.small).blank ? "BLANK" : null, m.mean < 0.1 && m.hi < 0.35 ? "DARK" : null])
            if (ft && !types.includes(ft)) types.push(ft);
        }
      const ok = !!want && types.some((t) => t.toLowerCase() === want.toLowerCase());
      if (!ok)
        found.push({
          check: "check-broken",
          title:
            `CHECK BROKEN: ${j.name} no longer reports ${want || "(no expected check)"} (it reports ${types.join(", ") || "nothing"})`.slice(
              0,
              200,
            ),
          fix: `restore the ${want} check in the engine (engine.js layoutIssues / lib) so ${j.name} fails again; never edit a must-fail scene`,
          where: { ...base, file: scene0, element: j.name },
        });
      pairs.push({ view: j.name, aspect: j.aspect, ms: r.ms, boot: true, layout: !!r.layout, issues: found.length - n });
      continue;
    }
    for (const i of r.layout?.issues ?? []) {
      const type = String(i.type ?? "layout"),
        p = parseWhat(String(i.what ?? "")),
        o = i.other ? parseWhat(String(i.other)) : null;
      const element = o?.element ? [p.element, o.element].filter(Boolean).sort().join(" + ") : p.element;
      const det = String(i.detail ?? ""),
        cut = det.indexOf(": "),
        finding = cut > 0 ? det.slice(0, cut) : det,
        fix = cut > 0 ? det.slice(cut + 2) : "";
      found.push({
        check: type,
        title: `${type.toUpperCase()}: ${element ?? ""} ${finding}`.replace(/\s+/g, " ").trim().slice(0, 200),
        detail: det,
        fix,
        where: {
          ...base,
          t: +i.t,
          shot: isFinite(+i.t) ? shotOf(+i.t) : null,
          file: p.file ?? o?.file ?? null,
          line: p.line ?? o?.line ?? null,
          element,
        },
      });
    }
    for (const p of Array.isArray(r.probe) ? r.probe : [])
      if (+p?.figures > 0 && !p.collide) {
        const n2 = (+p.i || 0) + 1,
          file = /^[\w./-]+\.js$/.test(String(p.file)) ? String(p.file) : null;
        found.push({
          check: "nocollide",
          title: `COLLISION NOT DECLARED: shot ${n2}${p.name ? ` (${String(p.name).slice(0, 60)})` : ""} shows ${p.figures} figure${p.figures === 1 ? "" : "s"} but declares no S.collide = { bodies, solids }`,
          fix: `in the shot's build: S.collide = { bodies: () => [{ name, caps: personCaps(p) }] (figure: f.caps(); library actor: actorCaps(a)), solids: [the closed meshes they stand at or sit in] } (lib/collide.js; engine_api.md "S.collide")`,
          where: { ...base, t: isFinite(+p.t) ? +p.t : null, shot: n2 - 1, file, line: +p.line || null, element: `shot ${n2}` },
        });
      }
    for (const p of Array.isArray(r.probe) ? r.probe : [])
      for (const b of Array.isArray(p?.support) ? p.support : []) {
        const n2 = (+p.i || 0) + 1,
          file = /^[\w./-]+\.js$/.test(String(p.file)) ? String(p.file) : null,
          cm = Math.round(Math.abs(+b.gap) * 100),
          up = +b.gap > 0;
        found.push({
          check: up ? "support" : "sunk",
          title: `${up ? "SUPPORT" : "SUNK"}: ${String(b.name).slice(0, 60)} in shot ${n2} ${up ? `hangs ${cm} cm above what is under it` : `is ${cm} cm into the surface under it`}`,
          fix: up
            ? "rest the body on the surface (its feet, knees, seat or back within 3 cm of it), or hold it where it really holds on; a body that really flies, falls or swims: { name, caps, airborne: true } in S.collide.bodies"
            : "lift the body (or its feet) onto the surface: nothing of it may go into the floor or the seat",
          where: {
            ...base,
            t: isFinite(+p.t) ? +p.t : null,
            shot: n2 - 1,
            file,
            line: +p.line || null,
            element: String(b.name).slice(0, 60),
          },
        });
      }
    const stats = new Map(),
      list = (frames[j.aspect] ??= []);
    for (const s of r.stills) {
      if (!s.png) continue;
      const st = frameStat(s.png);
      if (st) stats.set(s.time, st);
      if (opts.renderTo) {
        const rel = `${opts.renderTo}/${aspectTag(j.aspect)}/${j.name}_t${s.time.toFixed(2).replace(".", "_")}.jpg`,
          abs = path.join(dir, rel);
        try {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, nativeImage.createFromBuffer(s.png).toJPEG(84));
          list.push({ view: j.name, t: s.time, shot: shotOf(s.time), file: rel });
        } catch (e) {
          log("studio", "frame not saved", e?.message);
        }
      }
    }
    const near = (t) => {
      let best = null;
      for (const k of stats.keys()) if (best == null || Math.abs(k - t) < Math.abs(best - t)) best = k;
      return best;
    };
    shots.forEach((s, k) => {
      const end = +j.v.end,
        t1 = s.t1 ?? end,
        mid = +Math.max(0, Math.min(end - 0.02, s.t0 + (t1 - s.t0) * 0.5)).toFixed(2),
        m = stats.get(mid);
      const shotW = { ...base, t: mid, shot: k, file: s.file ?? null, line: s.line ?? null, element: `shot ${k + 1}` };
      if (!m) return;
      const S = structureOf(m.small);
      if (S.blank)
        found.push({
          check: "BLANK",
          title: `BLANK: shot ${k + 1} shows nothing but its background at ${mid}s (structure ${S.full.toFixed(2)}, centre ${S.centre.toFixed(2)})`,
          fix: "make the shot draw its elements (check_preview for errors; check they are inside the frame and visible)",
          where: shotW,
        });
      else if (!r.layout && m.mean < 0.1 && m.hi < 0.35)
        found.push({
          check: "DARK",
          title: `DARK: shot ${k + 1} is too dark to read at ${mid}s (mean ${m.mean.toFixed(3)}, brightest 2 % ${m.hi.toFixed(2)})`,
          fix: "light the subject / lighten the background (never by turning text up)",
          where: shotW,
        });
      if (motion && t1 - s.t0 >= 2.5) {
        const a = stats.get(+Math.max(0, s.t0 + (t1 - s.t0) * 0.12).toFixed(2)),
          b = stats.get(+Math.min(end - 0.02, s.t0 + (t1 - s.t0) * 0.88).toFixed(2));
        if (a && b && diffOf(a, m) < 2e-3 && diffOf(m, b) < 2e-3)
          found.push({
            check: "FROZEN",
            title: `FROZEN: nothing moves in shot ${k + 1} (${(t1 - s.t0).toFixed(1)} s)`,
            fix: "bring elements in on their spoken words, or move the camera / an element over the shot",
            where: shotW,
          });
      }
      const prevS = k > 0 ? shots[k - 1] : null;
      if (prevS) {
        const pm = stats.get(+Math.max(0, Math.min(end - 0.02, prevS.t0 + ((prevS.t1 ?? end) - prevS.t0) * 0.5)).toFixed(2));
        if (pm && diffOf(pm, m) < 15e-4)
          found.push({
            check: "SAME",
            title: `SAME: shots ${k} and ${k + 1} look the same`,
            fix: "change what the second shot shows (a new subject, framing or layout), or merge the two shots",
            where: shotW,
          });
      }
    });
    if (opts.renderTo) {
      for (const f of found.slice(n))
        if (f.where.t != null) {
          const t = near(f.where.t);
          if (t != null && Math.abs(t - f.where.t) < 0.6)
            f.thumb = `${opts.renderTo}/${aspectTag(j.aspect)}/${j.name}_t${t.toFixed(2).replace(".", "_")}.jpg`;
        }
    }
    pairs.push({ view: j.name, aspect: j.aspect, ms: r.ms, boot: true, layout: !!r.layout, issues: found.length - n });
  }
  found.push(...bannedScan(dir, studio), ...exportDiff(dir, studio));
  const STATIC = new Set(["banned", "contract"]),
    ver = opts.version != null ? `v${opts.version}` : "checks";
  const covers = (i) => {
    if (STATIC.has(String(i.check))) return true;
    const k = `${i.where?.view ?? ""}|${i.where?.aspect ?? ""}`;
    return String(i.check) === "boot" ? attempted.has(k) : booted.has(k);
  };
  const applied = applyCheckRun(
    dir,
    found.map((f) => ({
      source: "check",
      check: f.check,
      severity: sevOf(f.check),
      title: f.title,
      meaning: f.meaning ?? meanOf(f.check),
      fix: f.fix ?? "",
      where: f.where,
      thumb: f.thumb ?? null,
      round: opts.version ?? studio.round,
    })),
    covers,
    ver,
  );
  const byCheck = {};
  for (const f of found) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
  const sum = issueSummary(dir);
  const summary = {
    ran: true,
    at: new Date().toISOString(),
    ms: Date.now() - t0,
    version: opts.version ?? null,
    pairs,
    found: found.length,
    opened: applied.opened,
    reopened: applied.reopened,
    closed: applied.closed,
    byCheck,
    open: sum.open,
    openHigh: sum.openHigh,
  };
  log(
    "studio",
    "checks",
    projectId,
    `${pairs.length} view x aspect in ${summary.ms} ms: ${found.length} findings (${applied.opened} new, ${applied.reopened} reopened, ${applied.closed} fixed)`,
  );
  return { summary, frames, shots: shotsOut };
}
function parseWhat(what) {
  const m = /^(.*?)\s*\(([^():]+):(\d+)\)\s*$/.exec(what.trim());
  return m ? { element: m[1].trim() || null, file: m[2], line: +m[3] } : { element: what.trim() || null, file: null, line: null };
}
