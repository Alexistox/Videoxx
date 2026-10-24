import path from "node:path";
import fs from "node:fs";
import { log } from "../core/log";
import { restoreTo, snapshot } from "../core/gitSnapshots";
import { markDirty } from "../render/workers";
import { beginExport, renderFrames } from "../render/exportVideo";
import { updateIssues, writePitfalls } from "../projects/issues";
import { notifyStudio, readVersions, requireStudio, setActivity, versionsFile, writeStudio } from "./stages";
import { aspectTag, mainView, runChecks, settingsFor } from "./runChecks";
import { ensureTargetCopies } from "./targets";
import { matchPass, matchSig, usableTargets } from "./matchPass";
import { projectUrl } from "../projects/fileServer";

const chains = new Map();
function serial(projectId, job) {
  const p = (chains.get(projectId) ?? Promise.resolve()).then(job);
  chains.set(
    projectId,
    p.catch(() => {}),
  );
  return p;
}
export const studioSettled = (projectId) =>
  (chains.get(projectId) ?? Promise.resolve()).then(
    () => {},
    () => {},
  );
function writeVersions(dir, vs) {
  const f = versionsFile(dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ versions: vs }, null, 1));
  fs.renameSync(tmp, f);
}
export const clip = (s, n) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
async function renderMp4(projectId, dir, studio, aspect, rel) {
  const view = mainView(studio);
  if (!view) return null;
  const v = studio.views[view],
    name = `studio_${path.basename(rel)}_${aspectTag(aspect)}`;
  const { job, stopped, ff, end } = beginExport(projectId);
  try {
    const res = await renderFrames(
      projectId,
      { job, stopped },
      { name, fps: 30, from: 0, to: +v.end, settings: settingsFor(dir, studio, aspect), view: { scenes: v.scenes, end: +v.end } },
      () => {},
    );
    const out = `${rel}/${view}_${aspectTag(aspect)}.mp4`;
    await ff([
      "-r",
      "30",
      "-i",
      res.h264,
      "-vf",
      aspect === "9:16" ? "scale=360:-2" : "scale=640:-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      path.join(dir, out),
    ]);
    fs.rmSync(res.h264, { force: true });
    return out;
  } finally {
    end();
  }
}
async function makeVersion(projectId, label, o) {
  const { dir } = requireStudio(projectId);
  const n = (readVersions(dir).slice(-1)[0]?.v ?? 0) + 1,
    t0 = Date.now();
  setActivity(projectId, `version ${n}`);
  try {
    writeStudio(projectId, (s) => {
      s.round = n;
    });
    const commit = await snapshot(dir, `Style Studio v${n}: ${clip(label, 120)}`);
    const studio = requireStudio(projectId).studio,
      rel = `.suite/studio/renders/v${n}`;
    fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
    setActivity(projectId, `version ${n}: checks`);
    const { summary, frames, shots } = await runChecks(projectId, { version: n, renderTo: rel });
    const renders = {};
    for (const a of studio.aspects) renders[a] = { frames: frames[a] ?? [], mp4: null, shots: shots[a] ?? {} };
    let match = null;
    if (usableTargets(dir, studio).length) {
      setActivity(projectId, `version ${n}: match`);
      match = await matchPass(projectId, rel).catch((e) => {
        log("studio", "match overlays failed", e?.message);
        return null;
      });
    }
    if (o.mp4)
      for (const a of studio.aspects) {
        setActivity(projectId, `version ${n}: video ${a}`);
        renders[a].mp4 = await renderMp4(projectId, dir, studio, a, rel).catch((e) => {
          log("studio", "version video failed", a, e?.message);
          return null;
        });
      }
    const entry = {
      v: n,
      commit,
      at: new Date().toISOString(),
      stage: studio.stage,
      label: clip(label, 120) || `Version ${n}`,
      reason: o.reason ?? "explicit",
      renders,
      checks: summary,
      open: summary.open,
      openHigh: summary.openHigh,
      lookAt: studio.look?.at ?? null,
      match,
      score: null,
    };
    writeVersions(dir, [...readVersions(dir), entry]);
    log("studio", `v${n}`, projectId, `${Date.now() - t0} ms (checks ${summary.ms} ms${o.mp4 ? ", with video" : ""})`);
    return entry;
  } finally {
    setActivity(projectId, null);
  }
}
export function newVersion(projectId, label, o = {}) {
  return serial(projectId, () => makeVersion(projectId, label, o));
}
export function checkNow(projectId) {
  return serial(projectId, async () => {
    const { dir } = requireStudio(projectId),
      vs = readVersions(dir),
      last2 = vs[vs.length - 1];
    const now = await snapshot(dir, "Style Studio: changes before the checks");
    if (!last2 || !now || now !== last2.commit) return makeVersion(projectId, "Checks", { reason: "checks" });
    setActivity(projectId, `version ${last2.v}: checks`);
    try {
      const rel = `.suite/studio/renders/v${last2.v}`;
      const { summary, frames, shots } = await runChecks(projectId, { version: last2.v, renderTo: rel });
      for (const a of Object.keys(frames))
        last2.renders[a] = { frames: frames[a], mp4: last2.renders[a]?.mp4 ?? null, shots: shots[a] ?? last2.renders[a]?.shots ?? {} };
      Object.assign(last2, { checks: summary, open: summary.open, openHigh: summary.openHigh });
      const studio = requireStudio(projectId).studio;
      if (usableTargets(dir, studio).length) {
        setActivity(projectId, `version ${last2.v}: match`);
        last2.match = await matchPass(projectId, rel).catch((e) => {
          log("studio", "match overlays failed", e?.message);
          return null;
        });
      }
      writeVersions(dir, vs);
      return last2;
    } finally {
      setActivity(projectId, null);
    }
  });
}
export function ensureCurrent(projectId, label) {
  return serial(projectId, async () => {
    const { dir } = requireStudio(projectId),
      last2 = readVersions(dir).slice(-1)[0];
    const now = await snapshot(dir, "Style Studio: changes before the match");
    if (!last2 || !now || now !== last2.commit) return makeVersion(projectId, label, { reason: "loop" });
    return last2;
  });
}
export function ensureMatch(projectId) {
  return serial(projectId, async () => {
    const { dir, studio } = requireStudio(projectId),
      vs = readVersions(dir),
      last2 = vs[vs.length - 1];
    if (!last2) return null;
    const list = usableTargets(dir, studio),
      sig = list.length ? matchSig(dir, list) : "";
    if ((last2.match?.sig ?? "") === sig) return last2;
    setActivity(projectId, `version ${last2.v}: match`);
    try {
      last2.match = list.length ? await matchPass(projectId, `.suite/studio/renders/v${last2.v}`) : null;
      writeVersions(dir, vs);
    } finally {
      setActivity(projectId, null);
    }
    notifyStudio(projectId);
    return last2;
  });
}
export function setVersionScore(projectId, v, score) {
  return serial(projectId, async () => {
    const { dir } = requireStudio(projectId),
      vs = readVersions(dir),
      e = vs.find((x) => x.v === v);
    if (!e) throw new Error(`There is no version ${v} any more.`);
    e.score = score;
    writeVersions(dir, vs);
    notifyStudio(projectId);
    return e;
  });
}
export function rollback(projectId, v) {
  return serial(projectId, async () => {
    const { dir, studio: keep } = requireStudio(projectId),
      e = readVersions(dir).find((x) => x.v === v);
    if (!e?.commit) throw new Error(`There is no version ${clip(v, 10)} to go back to.`);
    setActivity(projectId, `back to v${v}`);
    try {
      await restoreTo(dir, e.commit, `Style Studio: back to v${v}`);
      const f = path.join(dir, "project.json"),
        pj = JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
      pj.studio = { ...keep, look: pj.studio?.look ?? null };
      const view = keep.views?.[keep.view];
      if (view) {
        pj.scenes = [...view.scenes];
        pj.end = +view.end;
      }
      fs.writeFileSync(f, JSON.stringify(pj, null, 1));
      writePitfalls(dir, keep.name);
      ensureTargetCopies(dir);
      const verOf = (s) => {
        const m = /^v(\d+)$/.exec(s ?? "");
        return m ? +m[1] : null;
      };
      const reopened = updateIssues(dir, (i) =>
        (i.status === "fixed" || i.status === "verify") && ((verOf(i.fixedIn) ?? 0) > v || (!verOf(i.fixedIn) && i.updatedAt > e.at))
          ? { status: "reopened", fixedIn: null }
          : null,
      );
      markDirty(projectId);
      log("studio", projectId, `back to v${v}: ${reopened} issue(s) reopened`);
      return makeVersion(projectId, `Back to v${v}`, { reason: "rollback" });
    } finally {
      setActivity(projectId, null);
    }
  });
}
const withUrls = (projectId, e) => ({
  ...e,
  renders: Object.fromEntries(
    Object.entries(e.renders ?? {}).map(([a, r]) => [
      a,
      {
        mp4: r.mp4,
        mp4Url: r.mp4 ? projectUrl(projectId, r.mp4) : null,
        shots: r.shots ?? {},
        frames: r.frames.map((f) => ({ ...f, url: projectUrl(projectId, f.file) })),
      },
    ]),
  ),
  // the match overlays: every sheet with its URL (the files are made again per version, so the URL carries the time)
  match: e.match
    ? {
        ...e.match,
        targets: e.match.targets.map((t) => {
          const u = (f) => `${projectUrl(projectId, f)}?m=${encodeURIComponent(e.match.at)}`;
          return {
            ...t,
            urls: { target: u(t.target), render: u(t.render), side: u(t.side), blend: u(t.blend), edges: u(t.edges) },
            crops: t.crops.map((c) => ({ ...c, url: u(c.file) })),
          };
        }),
      }
    : null,
  score: e.score ?? null,
});
export function listVersions(projectId) {
  const { dir } = requireStudio(projectId);
  return readVersions(dir).map((e) => withUrls(projectId, e));
}
export function compare(projectId, a, b) {
  const { dir } = requireStudio(projectId),
    vs = readVersions(dir);
  const pick = (n) => {
    const e = vs.find((x) => x.v === n);
    if (!e) throw new Error(`There is no version ${clip(n, 10)}.`);
    return withUrls(projectId, e);
  };
  return { a: pick(a), b: pick(b) };
}
