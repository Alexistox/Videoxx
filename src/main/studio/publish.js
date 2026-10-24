import path from "node:path";
import fs from "node:fs";
import { log } from "../core/log";
import { PKG_ID, controlsFor, formatOfAspect, parseLook, parseManifest, validateByControls } from "../styles/manifest";
import { STYLES, allStyles, engineDirOf, getStyle } from "../styles/catalog";
import { getPreset } from "../styles/presets";
import { slugOf } from "../core/text";
import { loadPackages, memberRoot } from "../styles/packages";
import { beginExport, renderFrames } from "../render/exportVideo";
import { isOpen, issueSummary, issuesFile, readIssues } from "../projects/issues";
import {
  FILL_MARK,
  collectFacts,
  gateOf,
  notifyStudio,
  onPublishState,
  readVersions,
  requireStudio,
  setActivity,
  stagesOf,
  writeStudio,
} from "./stages";
import { exportNames } from "./workspace";
import { aspectTag, bannedScan, mainView, settingsFor } from "./runChecks";
import { engineVersion } from "../projects/projects";
import { ff } from "../pipeline/ff";
import { checkNow } from "./versions";

const HOST_REQUIRED = [
  "SHOTS",
  "SUITE",
  "compose",
  "outCanvas",
  "loadTimeline",
  "loadImages",
  "finalizeShots",
  "renderer",
  "prewarm",
  "W",
  "H",
  "SETTINGS",
  "ENGINE_KIND",
];
const ENGINE_PARTS = ["engine.js", "models.js", "lib", "fonts", "vendor", "sprites", path.join("assets", "figures")];
const runs = new Map(),
  busy = new Set();
onPublishState((pid) => publishState(pid));
const runFile = (dir) => path.join(dir, ".suite", "studio", "publish.json");
export const publishBusy = (projectId) => busy.has(projectId);
export function publishState(projectId) {
  const r = runs.get(projectId);
  if (r) return r;
  try {
    const { dir } = requireStudio(projectId);
    const j = JSON.parse(fs.readFileSync(runFile(dir), "utf8"));
    if (j && Array.isArray(j.items))
      return j.status === "running" ? { ...j, status: "failed", error: "The app was closed while publishing: publish again." } : j;
  } catch {}
  return null;
}
export function notePublishHarvest(projectId, state) {
  try {
    const { dir } = requireStudio(projectId),
      j = JSON.parse(fs.readFileSync(runFile(dir), "utf8"));
    j.harvest = state;
    fs.writeFileSync(runFile(dir), JSON.stringify(j, null, 1));
    notifyStudio(projectId);
  } catch {}
}
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
};
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const deepMerge = (a, b) => {
  const o = { ...a };
  for (const k in b || {}) o[k] = isObj(b[k]) && isObj(a?.[k]) ? deepMerge(a[k], b[k]) : b[k];
  return o;
};
const clip = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
function copyTree(src, dst) {
  const st = fs.lstatSync(src);
  if (st.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return;
  }
  if (!st.isDirectory()) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src)) copyTree(path.join(src, e), path.join(dst, e));
}
function sectionText(md, head) {
  const out = [];
  let on = false;
  for (const l of md.replace(/\r/g, "").split("\n")) {
    const h = /^##\s+(.*)$/.exec(l);
    if (h) {
      on = head.test(h[1]);
      continue;
    }
    if (on) out.push(l);
  }
  return out.join("\n").split(FILL_MARK).join("").trim();
}
function buildManifest(projectId, dir, studio, id, version, prev) {
  const raw = readJson(path.join(dir, "style.json")) ?? {};
  const target = getStyle(studio.target),
    now = new Date().toISOString();
  const prompts = {
    brief: "",
    build: "",
    context: "",
    qualityBar: "",
    reframe: "",
    imageStyle: "",
    ignoreBaseRefs: [],
    ...(isObj(raw.prompts) ? raw.prompts : {}),
  };
  if (!String(prompts.qualityBar || "").trim()) {
    try {
      prompts.qualityBar = sectionText(fs.readFileSync(path.join(dir, "skill", "QUALITY.md"), "utf8"), /the bar/i).slice(0, 4e3);
    } catch {}
  }
  const m = {
    ...raw,
    schema: 2,
    kind: "style",
    id,
    name: clip(raw.name || studio.name, 60),
    description: String(raw.description ?? studio.description ?? "").slice(0, 2e3),
    base: target.pkg && !target.pkg.official ? target.id : studio.base,
    from: { style: studio.target, engineVersion: engineVersion(path.join(engineDirOf(studio.target), "engine.js")) },
    version,
    aspects: [...studio.aspects],
    ...(studio.dim ? { dim: studio.dim } : {}),
    prompts,
    official: false,
    aliases: [],
    studio: { workspace: projectId },
    created: prev?.created ?? now,
    updated: now,
  };
  delete m.restoredFrom;
  return m;
}
function pickId(projectId, studio, raw, name) {
  const ours = (id) => {
    const sj = readJson(path.join(memberRoot(), id, "style.json"));
    return !fs.existsSync(path.join(memberRoot(), id)) || sj?.studio?.workspace === projectId;
  };
  const free = (id) =>
    PKG_ID.test(id) && ours(id) && !allStyles().some((s) => s.id === id && !(s.pkg && s.pkg.manifest.studio?.workspace === projectId));
  for (const c of [studio.published?.id, studio.packageId]) if (c && PKG_ID.test(c) && ours(c)) return c;
  const base = `custom-${
    (slugOf(studio.name || name) || "style")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36) || "style"
  }`;
  for (let k = 1; k < 200; k++) {
    const c = k === 1 ? base : `${base.slice(0, 36)}-${k}`;
    if (free(c)) return c;
  }
  throw new Error("No free id for this style: rename it.");
}
export async function publishStyle(projectId) {
  const { dir, studio } = requireStudio(projectId);
  if (studio.mode === "look") throw new Error("A look is saved, not published.");
  if (studio.stage !== "publish") throw new Error("Approve the review first: a style is published from the Publish stage.");
  if (busy.has(projectId)) throw new Error("This style is being published already.");
  busy.add(projectId);
  const t0 = Date.now();
  const run = {
    status: "running",
    at: new Date().toISOString(),
    ms: 0,
    result: null,
    error: null,
    items: [
      ["stages", "Every stage before Publish passed"],
      ["manifest", "style.json is valid, with a name of its own"],
      ["contract", "The engine keeps its exports and has no banned calls"],
      ["checks", "The app's checks ran on the workspace as it is now"],
      ...studio.aspects.map((a) => [`aspect:${a}`, `${a}: every view loads, runs clean, no high layout issue, a 5 s export`]),
      ["issues", "No high-severity issue is open"],
      ["mustfail", "Every must-fail scene still fails"],
      ["looks", "The looks validate"],
      ["preview", "Preview video and poster made"],
      ["install", "Installed in Your styles"],
    ].map(([id, label]) => ({ id, label, status: "wait", detail: "", fix: "" })),
  };
  runs.set(projectId, run);
  const save = () => {
    run.ms = Date.now() - t0;
    try {
      fs.mkdirSync(path.dirname(runFile(dir)), { recursive: true });
      fs.writeFileSync(runFile(dir), JSON.stringify(run, null, 1));
    } catch {}
    notifyStudio(projectId);
  };
  const item = (id) => run.items.find((i) => i.id === id);
  const set = (id, status, detail = "", fix = "") => {
    Object.assign(item(id), { status, detail: clip(detail, 600), fix: clip(fix, 400) });
    save();
  };
  const start = (id) => {
    setActivity(projectId, `publish: ${item(id).label.toLowerCase()}`);
    set(id, "running");
  };
  const tmpRoot = path.join(memberRoot(), ".publishing");
  try {
    start("stages");
    {
      const facts = collectFacts(dir, studio),
        order = stagesOf(studio.mode),
        miss = [];
      for (const s of order.slice(0, order.indexOf("publish"))) {
        const g = gateOf(s, studio.mode, facts);
        if (!g.ok) miss.push(`${s}: ${g.missing.join("; ")}`);
      }
      if (miss.length)
        set("stages", "fail", miss.join(" · "), "Go back to the stage it names (the rail on the left) and finish it, then publish again.");
      else set("stages", "ok", "brief, study, guide, kit, sample and review all pass");
    }
    start("manifest");
    const raw = readJson(path.join(dir, "style.json"));
    const prevDirOf = (id2) => path.join(memberRoot(), id2);
    let id = "",
      manifest = null,
      prev = null;
    try {
      if (!raw) throw new Error("style.json is missing or not JSON");
      const name = clip(raw.name || studio.name, 60);
      id = pickId(projectId, studio, raw, name);
      const pp = parseManifest(readJson(path.join(prevDirOf(id), "style.json")));
      prev = pp.ok ? pp.m : null;
      const p = parseManifest(buildManifest(projectId, dir, studio, id, (prev?.version ?? 0) + 1, prev));
      if (!p.ok) throw new Error(`style.json: ${p.why}`);
      const clash = allStyles().find((s) => s.id !== id && !s.hidden && s.name.toLowerCase() === p.m.name.trim().toLowerCase());
      if (clash)
        throw new Error(
          `"${p.m.name}" is already the name of ${clash.pkg || clash.custom ? "another of your styles" : "a built-in style"}`,
        );
      manifest = p.m;
      set(
        "manifest",
        "ok",
        `${manifest.name} (${id}), version ${manifest.version}, ${manifest.aspects.join(" and ")}, built on ${getStyle(studio.target).name}`,
      );
    } catch (e) {
      set(
        "manifest",
        "fail",
        e.message,
        /name/.test(e.message)
          ? 'Give the style another name in style.json ("name"), e.g. ask Claude in the chat, then publish again.'
          : "Ask Claude in the chat to fix style.json (it may write it at the Publish stage), then publish again.",
      );
    }
    start("contract");
    {
      let src2 = "";
      try {
        src2 = fs.readFileSync(path.join(dir, "engine.js"), "utf8");
      } catch {}
      const have = new Set(exportNames(src2)),
        baseHas = new Set(
          exportNames(
            (() => {
              try {
                return fs.readFileSync(path.join(engineDirOf(studio.target), "engine.js"), "utf8");
              } catch {
                return "";
              }
            })(),
          ),
        );
      const need = [...new Set([...(studio.baseExports ?? []), ...HOST_REQUIRED.filter((n) => baseHas.has(n))])],
        gone = need.filter((n) => !have.has(n));
      const banned = bannedScan(dir, studio);
      if (!src2) set("contract", "fail", "engine.js is missing", "Go back to a version that had it (Compare > Go back).");
      else if (gone.length || banned.length)
        set(
          "contract",
          "fail",
          [gone.length ? `engine.js no longer exports ${gone.slice(0, 6).join(", ")}` : "", ...banned.slice(0, 3).map((b) => b.title)]
            .filter(Boolean)
            .join(" · "),
          gone.length
            ? "Exports may be added, never removed: ask Claude to export them again (an alias when one was renamed)."
            : (banned[0].fix ?? "Remove the banned call."),
        );
      else set("contract", "ok", `${need.length} exports kept (${have.size} in all), no banned calls`);
    }
    start("checks");
    let ver = readVersions(dir).slice(-1)[0] ?? null;
    try {
      ver = await checkNow(projectId);
      set(
        "checks",
        "ok",
        `v${ver.v}: ${ver.checks?.pairs.length ?? 0} view × frame checks, ${ver.checks?.found ?? 0} finding${ver.checks?.found === 1 ? "" : "s"}`,
      );
    } catch (e) {
      set("checks", "fail", e.message, "Run checks in Review to see what breaks.");
    }
    const pairs = ver?.checks?.pairs ?? [],
      open = readIssues(dir).filter(isOpen);
    const normal = Object.keys(studio.views).filter((n) => !studio.views[n].expect && !/^mustfail/i.test(n));
    const exports = {};
    for (const a of studio.aspects) {
      const k = `aspect:${a}`;
      start(k);
      const notLoaded = normal.filter((n) => {
        const p = pairs.find((x) => x.view === n && x.aspect === a);
        return !p || !p.boot;
      });
      const thrown = open.filter((i) => (i.check === "throw" || i.check === "boot") && i.where?.aspect === a);
      const high = open.filter((i) => i.severity === "high" && i.where?.aspect === a && i.check !== "throw" && i.check !== "boot");
      if (notLoaded.length || thrown.length || high.length) {
        set(
          k,
          "fail",
          [
            notLoaded.length ? `does not load: ${notLoaded.join(", ")}` : "",
            thrown.length ? `${thrown.length} scene error${thrown.length === 1 ? "" : "s"}: ${thrown[0].title}` : "",
            high.length ? `${high.length} high issue${high.length === 1 ? "" : "s"} in ${a}: ${high[0].title}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          "Open Review: Fix all open (or Fix it on each), then publish again.",
        );
        continue;
      }
      const view = mainView(studio),
        v = view ? studio.views[view] : null;
      if (!view || !v) {
        set(k, "fail", "there is no sample view to export", "Go back to the Sample stage.");
        continue;
      }
      try {
        setActivity(projectId, `publish: a 5 s export in ${a}`);
        const rel = path.join(".suite", "studio", "publish", `${view}_${aspectTag(a)}.mp4`),
          out = path.join(dir, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const { job, stopped, ff: ff2, end } = beginExport(projectId);
        try {
          const res = await renderFrames(
            projectId,
            { job, stopped },
            {
              name: `publish_${aspectTag(a)}`,
              fps: 30,
              from: 0,
              to: Math.min(5, +v.end),
              settings: settingsFor(dir, studio, a),
              view: { scenes: v.scenes, end: +v.end },
            },
            () => {},
          );
          await ff2([
            "-r",
            "30",
            "-i",
            res.h264,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            out,
          ]);
          fs.rmSync(res.h264, { force: true });
        } finally {
          end();
        }
        if (!fs.existsSync(out) || fs.statSync(out).size < 2e3) throw new Error("the export wrote no video");
        exports[a] = out;
        set(
          k,
          "ok",
          `${normal.length} view${normal.length === 1 ? "" : "s"} load, sweep clean, 5 s of ${view} exported (${Math.round(fs.statSync(out).size / 1024)} KB)`,
        );
      } catch (e) {
        set(
          k,
          "fail",
          `the 5 s export failed: ${e.message}`,
          "Open the sample in Review and look for the frame that breaks; the log names the shot.",
        );
      }
    }
    start("issues");
    {
      const sum = issueSummary(dir),
        hi = readIssues(dir).filter((i) => isOpen(i) && i.severity === "high");
      if (sum.openHigh)
        set(
          "issues",
          "fail",
          `${sum.openHigh} open: ${hi
            .slice(0, 3)
            .map((i) => `"${i.title}"`)
            .join(", ")}${hi.length > 3 ? " …" : ""}`,
          "Fix them in Review (Fix all open, or Fix it on each), or mark one Not an issue when it isn't.",
        );
      else set("issues", "ok", `${sum.open} open, none high`);
    }
    start("mustfail");
    {
      const must = Object.keys(studio.views).filter((n) => studio.views[n].expect || /^mustfail/i.test(n));
      const broken = readIssues(dir).filter((i) => isOpen(i) && i.check === "check-broken"),
        unchecked = must.filter((n) => !pairs.some((p) => p.view === n && p.boot));
      if (!must.length) set("mustfail", "skip", "this workspace has no must-fail scenes");
      else if (broken.length || unchecked.length)
        set(
          "mustfail",
          "fail",
          [...broken.slice(0, 3).map((i) => i.title), unchecked.length ? `not checked: ${unchecked.join(", ")}` : ""]
            .filter(Boolean)
            .join(" · "),
          "Ask Claude to restore the check the engine lost (never the must-fail scene), then publish again.",
        );
      else
        set(
          "mustfail",
          "ok",
          `${must.length} must-fail scene${must.length === 1 ? "" : "s"} still caught (${must
            .map((n) => studio.views[n].expect)
            .filter(Boolean)
            .join(", ")})`,
        );
    }
    start("looks");
    if (!manifest) set("looks", "skip", "needs a valid style.json first");
    else {
      const base = STYLES.find((s) => s.id === studio.base),
        controls = controlsFor(base.controls, manifest.controls, manifest.aspects);
      const def = deepMerge(getPreset(getStyle(studio.target).defaultLook)?.settings ?? {}, manifest.defaults || {}),
        probs = [];
      for (const a of manifest.aspects) {
        const e = validateByControls({ ...def, format: formatOfAspect(a) }, controls, manifest.aspects);
        if (e) probs.push(`default look in ${a}: ${e}`);
      }
      let n = 1;
      const ld = path.join(dir, "looks");
      if (fs.existsSync(ld))
        for (const f of fs.readdirSync(ld).filter((x) => x.endsWith(".json"))) {
          n++;
          const p = parseLook(readJson(path.join(ld, f)));
          if (!p.ok) probs.push(`${f}: ${p.why}`);
          else {
            const e = validateByControls(
              { ...def, ...p.m.settings, format: formatOfAspect(manifest.aspects[0]) },
              controls,
              manifest.aspects,
            );
            if (e) probs.push(`${f}: ${e}`);
          }
        }
      if (probs.length)
        set(
          "looks",
          "fail",
          probs.slice(0, 3).join(" · "),
          `A default in style.json "defaults" is outside what the style's controls allow: ask Claude to fix it.`,
        );
      else set("looks", "ok", `${n} look${n === 1 ? "" : "s"} valid in ${manifest.aspects.join(" and ")}`);
    }
    start("preview");
    const tmp = id ? path.join(tmpRoot, `${id}-${Date.now().toString(36)}`) : "";
    const src = exports["16:9"] ?? exports[studio.aspects[0]] ?? null;
    if (!src || !tmp) set("preview", "skip", "needs a clean 5 s export first");
    else
      try {
        fs.mkdirSync(tmp, { recursive: true });
        const tall = !exports["16:9"];
        await ff([
          "-i",
          src,
          "-vf",
          tall ? "scale=360:-2" : "scale=640:-2",
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "28",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          path.join(tmp, "preview.mp4"),
        ]);
        await ff([
          "-ss",
          "2.5",
          "-i",
          src,
          "-frames:v",
          "1",
          "-vf",
          tall ? "scale=360:-2" : "scale=640:-2",
          "-q:v",
          "3",
          path.join(tmp, "poster.jpg"),
        ]);
        fs.copyFileSync(path.join(tmp, "poster.jpg"), path.join(tmp, "preview.jpg"));
        set("preview", "ok", `preview.mp4 (${Math.round(fs.statSync(path.join(tmp, "preview.mp4")).size / 1024)} KB) and poster.jpg`);
      } catch (e) {
        set("preview", "fail", e.message, "Check ffmpeg in Settings > System > Tool paths.");
      }
    const failed = run.items.filter((i) => i.status === "fail" && i.id !== "install");
    if (failed.length || !manifest || !tmp) {
      set("install", "skip", `${failed.length} item${failed.length === 1 ? "" : "s"} above to fix first`);
      run.status = "failed";
      run.error = `Not published: ${failed.map((i) => i.label.toLowerCase()).join("; ")}.`;
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      return run;
    }
    start("install");
    const dst = prevDirOf(id),
      republished = fs.existsSync(dst);
    const prevEngine = republished ? engineVersion(path.join(dst, "engine", "engine.js")) : 0;
    const wsEngine = engineVersion(path.join(dir, "engine.js")),
      engV = Math.max(prevEngine + 1, wsEngine, 1);
    const baseEngine = engineDirOf(studio.target);
    for (const part of ENGINE_PARTS) {
      const from = fs.existsSync(path.join(dir, part)) ? path.join(dir, part) : path.join(baseEngine, part);
      if (fs.existsSync(from)) copyTree(from, path.join(tmp, "engine", part));
    }
    {
      const f = path.join(tmp, "engine", "engine.js"),
        s = fs.readFileSync(f, "utf8");
      fs.writeFileSync(
        f,
        /export const ENGINE_VERSION = \d+/.test(s)
          ? s.replace(/export const ENGINE_VERSION = \d+/, `export const ENGINE_VERSION = ${engV}`)
          : `${s.replace(/\s*$/, "")}
export const ENGINE_VERSION = ${engV};   // (the Style Studio: projects of this style get Update engine when it rises)
`,
      );
    }
    if (fs.existsSync(path.join(dir, "skill"))) copyTree(path.join(dir, "skill"), path.join(tmp, "skill"));
    if (fs.existsSync(path.join(dir, "looks"))) copyTree(path.join(dir, "looks"), path.join(tmp, "looks"));
    for (const r of ["ANALYSIS.md", "sheets"])
      if (fs.existsSync(path.join(dir, "reference", r))) copyTree(path.join(dir, "reference", r), path.join(tmp, "reference", r));
    if (fs.existsSync(issuesFile(dir))) copyTree(issuesFile(dir), path.join(tmp, "qa", "issues.json"));
    for (const f of fs.readdirSync(path.join(dir, "scenes")).filter((f2) => /^(hero|kit|sample)[\w-]*\.js$/i.test(f2)))
      copyTree(path.join(dir, "scenes", f), path.join(tmp, "sample", "scenes", f));
    for (const [a, f] of Object.entries(exports)) copyTree(f, path.join(tmp, "sample", `sample_${aspectTag(a)}.mp4`));
    const final = { ...manifest, version: manifest.version };
    fs.writeFileSync(path.join(tmp, "style.json"), JSON.stringify(final, null, 2) + "\n");
    if (republished) {
      const old = path.join(tmpRoot, `${id}-old-${Date.now().toString(36)}`);
      try {
        fs.renameSync(dst, old);
        fs.renameSync(tmp, dst);
        fs.rmSync(old, { recursive: true, force: true });
      } catch (e) {
        log("studio publish: rename failed, copying over", e?.message);
        if (!fs.existsSync(dst) && fs.existsSync(old)) fs.renameSync(old, dst);
        copyTree(tmp, dst);
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } else {
      fs.mkdirSync(memberRoot(), { recursive: true });
      fs.renameSync(tmp, dst);
    }
    loadPackages();
    const st = getStyle(id);
    if (!st.pkg || st.id !== id) {
      set(
        "install",
        "fail",
        "the package was written but could not be loaded (see the log)",
        "Publish again; if it stays, send the log from Settings.",
      );
      run.status = "failed";
      run.error = "The style could not be loaded.";
      return run;
    }
    try {
      const sj = readJson(path.join(dir, "style.json")) ?? {};
      if (sj.id !== id || sj.version !== final.version)
        fs.writeFileSync(path.join(dir, "style.json"), JSON.stringify({ ...sj, id, version: final.version }, null, 2) + "\n");
    } catch {}
    const at = new Date().toISOString();
    writeStudio(projectId, (s) => {
      s.packageId = id;
      s.published = { id, name: st.name, version: final.version, engineVersion: engV, at, v: ver?.v ?? null };
      s.stages ??= {};
      s.stages.publish = { status: "done", at };
    });
    run.result = { id, name: st.name, version: final.version, engineVersion: engV, republished };
    set(
      "install",
      "ok",
      `${st.name} v${final.version} (engine v${engV}) in Your styles${republished ? ": projects in it are offered Update engine" : ""}`,
    );
    run.status = "done";
    log("studio", "published", id, `v${final.version}`, `engine v${engV}`, `${Date.now() - t0} ms`);
    return run;
  } catch (e) {
    run.status = "failed";
    run.error = String(e?.message || e);
    for (const i of run.items)
      if (i.status === "running") {
        i.status = "fail";
        i.detail = run.error;
      }
    return run;
  } finally {
    busy.delete(projectId);
    setActivity(projectId, null);
    save();
    runs.delete(projectId);
    try {
      const pub = path.join(memberRoot(), ".publishing");
      if (fs.existsSync(pub) && !fs.readdirSync(pub).length) fs.rmdirSync(pub);
    } catch {}
  }
}
