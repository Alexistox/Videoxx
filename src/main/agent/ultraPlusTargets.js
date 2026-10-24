import path from "node:path";
import fs from "node:fs";
import { nativeImage } from "electron";
import { log } from "../core/log";
import { NO_CLAUDE, claudeExecutable, cleanEnv } from "../engines/claudeCli";
import { aspectOf, baseOf } from "../styles/catalog";
import { DEFAULT_BUDGET } from "../images/makeImage";
import { PROVIDER_NAMES, activeProvider, generatePicture } from "../images/providers";
import { hostState, layoutCheck, renderStills } from "../render/workers";
import { getProject } from "../projects/projects";
import { overlays } from "../studio/matchPass";
import { ULTRA_MODEL, friendlyError, insideDir, testCriticAnswer, testTargetStub } from "./sessions";
import { normPath } from "../projects/references";

export const isUltraPlus = (styleId) => baseOf(styleId) === "recon";
const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } catch {
    return d;
  }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
};
const clip = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const shotId = (n) => `shot${Math.max(1, Math.round(n))}`;
export const targetRel = (n) => `assets/targets/${shotId(n)}.jpg`;
const matchRel = (n) => `.suite/match/${shotId(n)}`;
const KEEP_PEOPLE =
  "THE PEOPLE MUST NOT CHANGE: keep every person exactly as in image 1 (the same faceless mannequin figures, body shape, surface and finish, outfit or no outfit, colours, pose, size and place; the same number of people). Do not dress, restyle, re-pose, add or remove anyone, and do not turn them into realistic humans.";
function lookLine(settings, vertical) {
  const frame = vertical ? "vertical 9:16" : "cinematic 16:9";
  return settings?.theme === "investigation"
    ? `One finished still frame (${frame}) of a dark, cinematic 3D reconstruction documentary, showing this shot's own subject (what the narration below is about, in its own world: its people, places, objects and papers): a stylized 3D CG render (Blender / Cinema 4D look, never photo-real): the project's own faceless mannequin figures in a furnished, lit miniature-diorama set, a motivated key light (a monitor, window or lamp) with soft fill and a rim light, practical lights in the set, desaturated grade with one crimson accent, true blacks only in the background, shallow depth of field, light film grain, always clearly readable (never underexposed). Simple, buildable shapes and real proportions: everything rests on what holds it. No text, no letters, no labels, no UI, no watermark, no gore.`
    : `One finished still frame (${frame}) of a premium 3D reconstruction documentary: a stylized 3D CG render (Blender / Cinema 4D look, never photo-real): a matte clay-like miniature diorama of the real place, soft studio lighting with gentle contact shadows, muted natural colours with one accent colour, real proportions, shallow depth of field, a clear subject in a foreground / midground / background composition. Simple, buildable shapes: everything rests on what holds it. No text, no letters, no labels, no UI, no watermark.`;
}
const shotOf = (shots, n) => shots.find((s) => s.index === n - 1) ?? null;
const midOf = (s) => +((+s.t0 + +s.t1) / 2).toFixed(2);
function narrationOf(dir, s) {
  const tl = readJson(path.join(dir, "audio", "timeline.json"), []);
  try {
    return tl
      .flatMap((p) => p.words || [])
      .filter((w) => w.s >= +s.t0 - 0.01 && w.s < +s.t1)
      .map((w) => w.w)
      .join(" ");
  } catch {
    return "";
  }
}
export async function makeTarget(projectId, shots, a) {
  const p = getProject(projectId),
    dir = p.path;
  if (!isUltraPlus(p.style_id)) throw new Error("make_target is for 3D reconstruction projects only (Ultraedit+).");
  const pj = readJson(path.join(dir, "project.json"), null);
  if (!pj || typeof pj !== "object") throw new Error("project.json can't be read, so no target was made and nothing was spent.");
  const vertical = aspectOf(pj.style, pj.settings) < 1,
    s = shotOf(shots, a.shot);
  if (a.from_still && !s)
    throw new Error(`There is no shot ${a.shot} to take a still of yet (list_shots): build it first, or leave from_still out.`);
  const said = s ? narrationOf(dir, s) : "";
  const refNote = a.from_still
    ? `Image 1 is the current 3D render of this shot. ${KEEP_PEOPLE} Keep its camera angle, framing and composition, and where every person and object stands. Repaint ONLY the environment as the polished final render of the same moment. It must stay a stylized 3D CG render, like a Blender Cycles or Cinema 4D / Redshift render of a miniature diorama: clean modelled shapes with bevelled edges, simple stylized materials with subtle texture (no photographic surfaces, no photo-real clutter, no real-world photo backgrounds), the same set with only a few well-chosen props that support the story. Keep the subject the clear centre of attention: the area around the people is the most finished and best lit, the edges and background calmer and darker. Lighting is cinematic and intentional: one clear motivated key on the subject (from a lamp, window or screen that is in the set), soft fill, a rim to separate the people from the background, each visible practical (lamp, bulb, sign, window) glowing and casting a small, believable pool, controlled contrast, gentle atmosphere. Not realistic, not busier: the same scene, rendered beautifully.`
    : "";
  const prompt = [
    lookLine(pj.settings, vertical),
    String(a.prompt).trim(),
    said ? `The narration over this shot: "${clip(said, 500)}".` : "",
    refNote,
  ]
    .filter(Boolean)
    .join(" ");
  const rel = targetRel(a.shot),
    out = path.join(dir, rel),
    ledgerF = path.join(dir, "assets", "targets", "targets.json");
  const rec = readJson(ledgerF, { shots: {} });
  if (!a.from_still && rec.shots?.[shotId(a.shot)]?.prompt === prompt && fs.existsSync(out)) {
    const l2 = readJson(path.join(dir, "assets", "images.json"), { spent: 0, count: 0 }),
      budget2 = Number(pj.imageBudget) > 0 ? Number(pj.imageBudget) : DEFAULT_BUDGET;
    return {
      file: out,
      rel,
      cost: 0,
      cached: true,
      model: rec.shots[shotId(a.shot)].model,
      count: l2.count,
      spent: l2.spent,
      budget: budget2,
      fromStill: false,
      prompt,
    };
  }
  const images = path.join(dir, "assets", "images.json"),
    l0 = readJson(images, { spent: 0, count: 0, images: {} });
  const budget = Number(pj.imageBudget) > 0 ? Number(pj.imageBudget) : DEFAULT_BUDGET;
  if (activeProvider(dir) !== "flow" && l0.count >= budget)
    throw new Error(
      `This project has used its image budget (${l0.count} of ${budget} images, about $${(+l0.spent || 0).toFixed(2)}). Match against the targets you have, or ask the user to raise "imageBudget" in project.json.`,
    );
  let refs = [];
  if (a.from_still) {
    await hostState(projectId, true);
    const st = await renderStills(projectId, [midOf(s)], 1, `ultraplus-still-${shotId(a.shot)}`);
    if (!st[0]?.file) throw new Error(`Shot ${a.shot} threw while rendering its still (check_preview shows why).`);
    refs = [st[0].file];
  }
  const stub = testTargetStub();
  const r = stub
    ? { buf: fs.readFileSync(stub), model: "test-stub", cost: 0 }
    : await (async () => {
        if (!activeProvider(dir))
          throw new Error("No image service is set up: add a Higgsfield or Fal.ai key in Settings > Media > Image generation.");
        return generatePicture({ prompt, aspect: vertical ? "9:16" : "16:9", refs, quality: "medium", resolution: "1k" }, dir);
      })();
  const im = nativeImage.createFromBuffer(r.buf);
  if (im.isEmpty()) throw new Error("The image service returned no picture.");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, im.toJPEG(92));
  const l = readJson(images, { spent: 0, count: 0, images: {} });
  l.count = (+l.count || 0) + 1;
  l.spent = +((+l.spent || 0) + r.cost).toFixed(4);
  writeJson(images, l);
  rec.shots = {
    ...(rec.shots || {}),
    [shotId(a.shot)]: { file: rel, prompt, fromStill: !!a.from_still, model: r.model, cost: r.cost, at: new Date().toISOString() },
  };
  writeJson(ledgerF, rec);
  log("ultraplus", "target", projectId, shotId(a.shot), r.model, a.from_still ? "from still" : "text", r.cost);
  return {
    file: out,
    rel,
    cost: r.cost,
    cached: false,
    model: r.model,
    count: l.count,
    spent: l.spent,
    budget,
    fromStill: !!a.from_still,
    prompt,
  };
}
export const providerName = (projectId) => {
  const pr = activeProvider(getProject(projectId).path);
  return pr ? PROVIDER_NAMES[pr] : "no image service";
};
const historyOf = (dir, n) => readJson(path.join(dir, matchRel(n), "history.json"), []);
const saveHistory = (dir, n, h) => writeJson(path.join(dir, matchRel(n), "history.json"), h);
export async function matchShot(projectId, shots, a) {
  const p = getProject(projectId),
    dir = p.path;
  if (!isUltraPlus(p.style_id)) throw new Error("match_shot is for 3D reconstruction projects only (Ultraedit+).");
  const tf = path.join(dir, targetRel(a.shot));
  if (!fs.existsSync(tf)) throw new Error(`Shot ${a.shot} has no target yet: make_target first.`);
  const s = shotOf(shots, a.shot),
    t = a.t ?? (s ? midOf(s) : null);
  if (t == null) throw new Error(`There is no shot ${a.shot} (list_shots): give t, the second to compare.`);
  const pj = readJson(path.join(dir, "project.json"), {}),
    aspect = aspectOf(pj.style, pj.settings) < 1 ? "9:16" : "16:9";
  const h = historyOf(dir, a.shot),
    pass = (h[h.length - 1]?.pass ?? 0) + 1,
    rel = `${matchRel(a.shot)}/pass${pass}`;
  fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, rel), { recursive: true });
  await hostState(projectId, true);
  const st = await renderStills(projectId, [t], 1, `ultraplus-${shotId(a.shot)}`);
  if (!st[0]?.file) throw new Error(`The frame at ${t} s threw while rendering (check_preview shows why).`);
  const m = await overlays(dir, rel, { id: shotId(a.shot), view: "video", aspect, t }, Buffer.from(st[0].base64, "base64"), tf);
  const lay = await layoutCheck(projectId, [t]).catch(() => null);
  const issues = (lay?.issues ?? []).map(
    (i) => `${String(i.type).toUpperCase()}: ${i.what}${i.other ? ` / ${i.other}` : ""} - ${clip(i.detail, 200)}`,
  );
  const files = {
    target: m.target,
    render: m.render,
    side: m.side,
    blend: m.blend,
    edges: m.edges,
    regions: m.regionsFile ?? "",
    ...Object.fromEntries(m.crops.map((c, k) => [`crop${k + 1}`, c.file])),
  };
  const rec = {
    pass,
    at: new Date().toISOString(),
    t,
    diff: m.diff,
    issues: issues.length,
    side: m.side,
    target: targetRel(a.shot),
    score: null,
    files,
  };
  saveHistory(dir, a.shot, [...h, rec].slice(-40));
  const regions = fs.existsSync(path.join(dir, m.regionsFile ?? "")) ? fs.readFileSync(path.join(dir, m.regionsFile), "utf8") : "";
  log("ultraplus", "match", projectId, shotId(a.shot), `pass ${pass} diff ${m.diff} issues ${issues.length}`);
  return { pass, t, diff: m.diff, issues, regions, files, crops: m.crops, abs: (r) => path.join(dir, r), dir };
}
const CRITIC_SYSTEM = `You are a strict, adversarial art director. You judge ONE shot of a 3D reconstruction video (a real-time Three.js
render) against its TARGET: a painted ideal frame of that shot. You only read the files the request lists; you never edit anything.
Read the target, the render, the side by side (target LEFT, render RIGHT), the 50/50 blend (misplaced masses show double), the edge
overlay (the target's edges in cyan over the darkened render: where cyan lines miss the render's shapes, the layout is off), the zoomed
crops (target left, render right) and the region colour table (grade errors in numbers).
Score 1-10: how close the render is to the target AND how good it is as a finished frame. 10 = the same frame; 8 = clearly the same
shot, only small differences; 6 = the same idea, visible layout / pose / material gaps; 4 = the composition differs; 2 = unrelated.
LIGHTING AND ATMOSPHERE weigh most (they are the main thing the target adds): where each light pool, glow, rim and shadow falls, how
bright and warm each region is (use the region numbers), haze and depth; then materials and textures, then set dressing and
detail; camera and layout only when the edges overlay is clearly off. Name the light to add or move in each lighting problem. Ignore what a clean 3D render can't and shouldn't copy (painted noise, text, impossible
geometry in the target). Never claim hidden geometry you can't see; cite the overlay that shows each problem.
The PEOPLE are the video's fixed cast: never report differences in how a person looks (figure type, body, surface, clothing,
colours, face) and never ask to restyle, dress or replace them; only where they stand and that they are grounded counts. Judge the
ENVIRONMENT: set dressing, props, materials and textures, lighting, atmosphere, depth and background detail.
Answer with ONE JSON object only: {"score": n, "summary": "one sentence", "problems": [{"rank": 1, "title": "short", "region":
"top left", "evidence": "which overlay shows what", "fix": "a concrete 3D change: camera fov / position / look, move X by ~N m,
rotate, scale, material colour #hex / roughness, light intensity / colour"}]} with at most 8 problems, the biggest first.`;
export async function criticShot(projectId, a, signal) {
  const t0 = Date.now(),
    p = getProject(projectId),
    dir = p.path;
  if (!isUltraPlus(p.style_id)) throw new Error("critic_shot is for 3D reconstruction projects only (Ultraedit+).");
  const h = historyOf(dir, a.shot),
    last2 = h[h.length - 1];
  if (!last2) throw new Error(`Shot ${a.shot} has no match pass yet: match_shot first.`);
  const W = {
    target: "TARGET: the frame to match",
    render: "RENDER: the shot as it is now",
    side: "side by side: target LEFT, render RIGHT",
    blend: "50/50 blend of target and render",
    edges: "the target's edges in cyan over the darkened render",
    regions: "mean colour of 12 named regions, target vs render (hex, luminance and colour difference)",
  };
  const files = Object.entries(last2.files)
    .filter(([, rel]) => rel && fs.existsSync(path.join(dir, rel)))
    .map(([k, rel]) => ({ rel, what: W[k] ?? `zoomed ${k} (target left, render right)` }));
  if (!files.some((f) => /\.jpe?g$/i.test(f.rel))) throw new Error("The last match pass has no pictures: run match_shot again.");
  const allowed = new Set(files.map((f) => normPath(path.join(dir, f.rel))));
  const prompt = [
    `Judge shot ${a.shot} of a 3D reconstruction video (match pass ${last2.pass}, frame at ${last2.t} s, mean tile difference ${last2.diff}, ${last2.issues} layout issue(s) from the checker).`,
    `FILES (Read each one you need; nothing else can be opened):
${files.map((f) => `- ${f.rel}  ${f.what}`).join("\n")}`,
    "Answer with the JSON object only.",
  ].join("\n\n");
  const gate2 = (name, input) => {
    if (name !== "Read") return `The critic only reads; ${name} is not available.`;
    const f = String(input?.file_path ?? "");
    if (!f) return "No file was named.";
    const abs = path.resolve(dir, f);
    return insideDir(dir, abs) && allowed.has(normPath(abs)) ? null : "The critic only reads the files listed in the request.";
  };
  const canUseTool = async (name, input) => {
    const why = gate2(name, input);
    return why ? { behavior: "deny", message: why } : { behavior: "allow", updatedInput: input };
  };
  const hook = async (input) => {
    const why = gate2(String(input?.tool_name ?? ""), input?.tool_input ?? {});
    return why ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } } : {};
  };
  const DENY = [
    "Bash",
    "BashOutput",
    "KillShell",
    "Task",
    "Agent",
    "WebFetch",
    "WebSearch",
    "NotebookEdit",
    "Edit",
    "Write",
    "MultiEdit",
    "Glob",
    "Grep",
    "TodoWrite",
    "Skill",
    "LS",
  ];
  let text = "",
    model = ULTRA_MODEL;
  const probe = async (n, f) => (await canUseTool(n, { file_path: f })).behavior;
  const canned = await testCriticAnswer(
    {
      ultraplus: true,
      model: ULTRA_MODEL,
      tools: ["Read"],
      disallowed: DENY,
      cwd: dir,
      shot: a.shot,
      text: prompt,
      files: files.map((f) => f.rel),
      gate: {
        readListed: await probe("Read", files[0].rel),
        readOther: await probe("Read", "engine.js"),
        write: await probe("Write", "scenes/x.js"),
        bash: await probe("Bash", ""),
      },
    },
    signal,
  );
  if (canned !== void 0) {
    text = typeof canned === "string" ? canned : JSON.stringify(canned);
    model = "critic-test-stand-in";
  } else {
    const exe = claudeExecutable();
    if (!exe) throw new Error(NO_CLAUDE);
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const ac = new AbortController();
    try {
      for await (const m of query({
        prompt,
        options: {
          pathToClaudeCodeExecutable: exe,
          env: cleanEnv(),
          cwd: dir,
          systemPrompt: CRITIC_SYSTEM,
          settingSources: [],
          tools: ["Read"],
          allowedTools: [],
          disallowedTools: DENY,
          mcpServers: {},
          strictMcpConfig: true,
          permissionMode: "default",
          canUseTool,
          hooks: { PreToolUse: [{ matcher: ".*", hooks: [hook] }] },
          model: ULTRA_MODEL,
          effort: "high",
          maxTurns: files.length + 8,
          persistSession: false,
          abortController: ac,
        },
      })) {
        if (m.type === "system" && m.subtype === "init" && m.model) model = m.model;
        if (m.type === "assistant") {
          const tx = (m.message?.content || [])
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("");
          if (tx.trim()) text = tx;
        }
        if (m.type === "result" && (m.subtype !== "success" || m.is_error))
          throw new Error(m.errors?.join?.("; ") || m.result || "The critic did not answer.");
      }
    } catch (e) {
      if (ac.signal.aborted) throw new Error("aborted");
      throw new Error(friendlyError(String(e?.message ?? e)));
    } finally {
    }
  }
  let j;
  try {
    j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("The critic answered in an unexpected format (no JSON). Run critic_shot again.");
  }
  const raw = typeof j?.score === "number" ? j.score : +j?.score;
  if (!isFinite(raw)) throw new Error("The critic gave no score. Run critic_shot again.");
  const score = Math.round(Math.max(1, Math.min(10, raw)) * 2) / 2;
  const problems = (Array.isArray(j?.problems) ? j.problems : [])
    .filter((x) => x && clip(x.title, 200))
    .slice(0, 8)
    .map((x, k) => ({
      rank: +x.rank || k + 1,
      title: clip(x.title, 200),
      region: clip(x.region, 60),
      evidence: clip(x.evidence ?? x.why, 600),
      fix: clip(x.fix, 600),
    }));
  const hh = historyOf(dir, a.shot);
  const lp = hh.find((x) => x.pass === last2.pass);
  if (lp) {
    lp.score = score;
    lp.summary = clip(j?.summary, 400);
    saveHistory(dir, a.shot, hh);
  }
  const ms = Date.now() - t0;
  log("ultraplus", "critic", projectId, shotId(a.shot), `pass ${last2.pass} score ${score} (${problems.length} problems) in ${ms} ms`);
  return { score, summary: clip(j?.summary, 400), problems, pass: last2.pass, model, ms };
}
export const scoresOf = (projectId, n) =>
  historyOf(getProject(projectId).path, n)
    .filter((x) => typeof x.score === "number")
    .map((x) => x.score);
