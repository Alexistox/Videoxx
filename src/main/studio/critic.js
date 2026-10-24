import path from "node:path";
import fs from "node:fs";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";
import { NO_CLAUDE, claudeExecutable, cleanEnv } from "../engines/claudeCli";
import { getStyle } from "../styles/catalog";
import { addIssue, isOpen, readIssues, updateIssues } from "../projects/issues";
import { hasFillMark, notifyStudio, readVersions, requireStudio, setActivity } from "./stages";
import { mainView } from "./runChecks";
import { readTargets } from "./targets";
import { STUDIO_DISALLOWED, STUDIO_MODEL, friendlyError, insideDir, testCriticAnswer } from "../agent/sessions";
import { normPath } from "../projects/references";
import { setVersionScore } from "./versions";

const clip = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() && isFinite(+v) ? +v : null);
const IMG = /\.(jpe?g|png|webp)$/i;
const SEV = ["high", "medium", "low"];
function toSettle(issues, lastCriticAt) {
  return issues
    .filter(
      (i) =>
        i.source === "critic" &&
        (isOpen(i) || i.status === "verify" || (i.status === "wontfix" && (!lastCriticAt || i.updatedAt > lastCriticAt))),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30);
}
const stateWord = (i) =>
  i.status === "verify"
    ? "the builder says FIXED"
    : i.status === "wontfix"
      ? `the builder REJECTED it: "${clip(i.lesson, 400)}"`
      : "still open";
export async function runCritic(projectId, o = {}) {
  const t0 = Date.now(),
    { dir, studio } = requireStudio(projectId),
    vs = readVersions(dir),
    last2 = vs[vs.length - 1];
  if (!last2) throw new Error("There is no version to judge yet: run the checks first.");
  const st = getStyle(studio.target),
    view = mainView(studio);
  const files = [];
  for (const m of last2.match?.targets ?? []) {
    files.push(
      { rel: m.target, what: `TARGET ${m.id}: the frame to match (view ${m.view}, ${m.aspect}, at ${m.t} s)` },
      { rel: m.render, what: `RENDER of ${m.id}: this version's frame at the same view, frame and moment` },
      { rel: m.side, what: `${m.id} side by side: target LEFT, render RIGHT` },
      { rel: m.blend, what: `${m.id} 50/50 blend of target and render` },
      { rel: m.edges, what: `${m.id} the target's edges in cyan over the (darkened) render` },
      ...m.crops.map((c, k) => ({
        rel: c.file,
        what: `${m.id} zoomed crop ${k + 1} (${c.why === "centre" ? "the centre" : "a region where the two differ most"}; x ${Math.round(c.rect[0] * 100)}%, y ${Math.round(c.rect[1] * 100)}% of the frame): target left, render right`,
      })),
      ...(m.regionsFile
        ? [
            {
              rel: m.regionsFile,
              what: `${m.id} the mean colour of 12 named regions, target vs render (hex, luminance difference, colour distance)`,
            },
          ]
        : []),
    );
  }
  const per = last2.match?.targets?.length ? 3 : 6;
  for (const a of studio.aspects) {
    const fr = (last2.renders?.[a]?.frames ?? []).filter((f) => f.view === view).sort((p, q) => p.t - q.t);
    const pick = fr.length <= per ? fr : Array.from({ length: per }, (_, k) => fr[Math.round((k * (fr.length - 1)) / (per - 1))]);
    for (const f of pick) files.push({ rel: f.file, what: `a frame of this version: view ${f.view}, ${a}, at ${f.t} s` });
  }
  const filled = (rel) => {
    try {
      const t = fs.readFileSync(path.join(dir, rel), "utf8");
      return t.trim().length > 40 && !hasFillMark(t);
    } catch {
      return false;
    }
  };
  for (const [rel, what2] of [
    [studio.mode === "look" ? "skill/LOOK.md" : "skill/STYLE_GUIDE.md", studio.mode === "look" ? "the look's notes" : "the style guide"],
    ["skill/QUALITY.md", "the quality bar"],
    ["reference/ANALYSIS.md", "the study of the references"],
    [".claude/skills/studio/NO_SLOP.md", "what never passes (slop)"],
  ])
    if (fs.existsSync(path.join(dir, rel)) && (rel.endsWith("NO_SLOP.md") || filled(rel))) files.push({ rel, what: what2 });
  const ok = files.filter((f) => fs.existsSync(path.join(dir, f.rel)));
  if (!ok.some((f) => IMG.test(f.rel))) throw new Error(`Version ${last2.v} has no frames to judge: run the checks first.`);
  if (!last2.match?.targets?.length && !ok.some((f) => /\.md$/i.test(f.rel) && !f.rel.endsWith("NO_SLOP.md")) && !studio.description.trim())
    throw new Error(
      "The critic needs something to judge against: add target frames, or fill the style's notes / the brief's description first.",
    );
  const allowed = new Set(ok.map((f) => normPath(path.join(dir, f.rel))));
  const lastCritic = [...vs].reverse().find((x) => x.score)?.score?.at ?? null;
  const prev = toSettle(readIssues(dir), lastCritic);
  const targets = readTargets(dir);
  const what =
    studio.mode === "look"
      ? `a LOOK for the style "${st.name}"`
      : studio.mode === "scratch"
        ? "a NEW STYLE made from scratch"
        : `a NEW STYLE built on top of "${st.name}"`;
  const prompt = [
    `Judge version v${last2.v} of ${what}, named "${studio.name}"${studio.description ? `. The member's brief: ${clip(studio.description, 1200)}` : ""}. Frames: ${studio.aspects.join(" and ")}.`,
    targets.length
      ? `TARGETS: ${targets.map((t) => `${t.id} (${t.label}: view ${t.view}, ${t.aspect}, at ${t.t} s)`).join("; ")}.`
      : "There are no target frames: judge against the written notes and the brief.",
    `FILES (Read each one you need; nothing else can be opened):
${ok.map((f) => `- ${f.rel}  ${f.what}`).join("\n")}`,
    prev.length
      ? `EARLIER FINDINGS to settle (give each id a verdict in "previous"):
${prev.map((i) => `- [${i.id}] ${i.severity} "${i.title}"${i.fix ? ` (fix asked: ${clip(i.fix, 200)})` : ""}: ${stateWord(i)}`).join("\n")}`
      : "There are no earlier findings to settle.",
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
  const DENY = [...STUDIO_DISALLOWED, "Edit", "Write", "MultiEdit", "NotebookEdit", "Glob", "Grep", "TodoWrite", "Skill", "LS"];
  let system = "";
  try {
    system = fs.readFileSync(path.join(templatesDir(), "studio", "stages", "critic.md"), "utf8");
  } catch {
    throw new Error("The critic's instructions (templates/studio/stages/critic.md) are missing from the app.");
  }
  setActivity(projectId, `critic v${last2.v}`);
  let text = "",
    model = STUDIO_MODEL;
  try {
    const probe = async (n, f) => (await canUseTool(n, { file_path: f })).behavior;
    const canned = await testCriticAnswer(
      {
        model: STUDIO_MODEL,
        tools: ["Read"],
        disallowed: DENY,
        cwd: dir,
        v: last2.v,
        text: prompt,
        files: ok.map((f) => f.rel),
        settle: prev.map((i) => i.id),
        gate: {
          readListed: await probe("Read", ok[0].rel),
          readOther: await probe("Read", "engine.js"),
          write: await probe("Write", "scenes/x.js"),
          edit: await probe("Edit", ok[0].rel),
          bash: await probe("Bash", ""),
        },
      },
      o.signal,
    );
    if (canned !== void 0) {
      text = typeof canned === "string" ? canned : JSON.stringify(canned);
      model = "critic-test-stand-in";
    } else {
      const exe = claudeExecutable();
      if (!exe) throw new Error(NO_CLAUDE);
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      const ac = new AbortController(),
        stop = () => ac.abort();
      o.signal?.addEventListener("abort", stop, { once: true });
      if (o.signal?.aborted) throw new Error("aborted");
      try {
        for await (const m of query({
          prompt,
          options: {
            pathToClaudeCodeExecutable: exe,
            env: cleanEnv(),
            cwd: dir,
            systemPrompt: system,
            settingSources: [],
            tools: ["Read"],
            allowedTools: [],
            disallowedTools: DENY,
            mcpServers: {},
            strictMcpConfig: true,
            permissionMode: "default",
            canUseTool,
            hooks: { PreToolUse: [{ matcher: ".*", hooks: [hook] }] },
            model: STUDIO_MODEL,
            effort: "high",
            maxTurns: ok.length + 12,
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
        o.signal?.removeEventListener("abort", stop);
      }
    }
  } finally {
    setActivity(projectId, null);
  }
  let j;
  try {
    j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("The critic answered in an unexpected format (no JSON). Run it again.");
  }
  const raw = num(j?.score);
  if (raw == null) throw new Error("The critic gave no score. Run it again.");
  const score = Math.round(Math.max(1, Math.min(10, raw)) * 2) / 2,
    vtag = `v${last2.v}`;
  const verdict = new Map();
  for (const p of Array.isArray(j?.previous) ? j.previous : []) if (p?.id) verdict.set(String(p.id), String(p.verdict ?? "").toLowerCase());
  const prevIds = new Set(prev.map((i) => i.id));
  let fixed = 0,
    reopened = 0;
  updateIssues(dir, (i) => {
    if (!prevIds.has(i.id)) return null;
    const vd = verdict.get(i.id);
    if (i.status === "wontfix") {
      if (vd === "disagree" || vd === "still") {
        reopened++;
        return { status: "reopened", fixedIn: null };
      }
      return null;
    }
    if (vd === "gone" || vd === "fixed" || vd === "agree") {
      fixed++;
      return { status: "fixed", fixedIn: vtag };
    }
    if (vd === "still" || vd === "disagree") {
      if (i.status === "verify") {
        reopened++;
        return { status: "reopened", fixedIn: null };
      }
      return { status: i.status };
    }
    return null;
  });
  const problems = (Array.isArray(j?.problems) ? j.problems : []).filter((p) => p && clip(p.title, 200)).slice(0, 10);
  let opened = 0;
  problems.forEach((p, k) => {
    const rank = Math.max(1, Math.round(num(p.rank) ?? k + 1)),
      impact = String(p.impact ?? "").toLowerCase();
    const severity = SEV.includes(impact) ? impact : rank <= 3 ? "high" : rank <= 7 ? "medium" : "low";
    const tg = targets.find((t) => t.id === String(p.target ?? "")),
      mt = last2.match?.targets?.find((m) => m.id === tg?.id);
    const aspect = p.aspect === "9:16" || p.aspect === "16:9" ? p.aspect : (tg?.aspect ?? null);
    const r = addIssue(dir, {
      source: "critic",
      check: "critic",
      severity,
      title: clip(p.title, 200),
      meaning: clip(p.evidence ?? p.why, 1e3),
      fix: clip(p.fix, 1e3),
      round: last2.v,
      where: {
        view: typeof p.view === "string" && studio.views[p.view] ? p.view : (tg?.view ?? view),
        aspect,
        t: num(p.t) ?? tg?.t ?? null,
        element:
          [
            tg?.id,
            clip(p.region, 60),
            Array.isArray(p.at) && p.at.length === 2 && p.at.every((v) => num(v) != null)
              ? `@${Math.round(num(p.at[0]))},${Math.round(num(p.at[1]))} px`
              : "",
          ]
            .filter(Boolean)
            .join(" · ") || null,
      },
      thumb: mt?.side ?? null,
    });
    if (r.added) opened++;
  });
  const rec = {
    value: score,
    at: new Date().toISOString(),
    summary: clip(j?.summary, 600),
    problems: problems.length,
    filed: opened,
    settled: fixed + reopened,
    model,
    ms: Date.now() - t0,
  };
  await setVersionScore(projectId, last2.v, rec);
  log(
    "studio",
    "critic",
    projectId,
    `v${last2.v} score ${score} (${problems.length} problems, ${opened} new, ${fixed} settled fixed, ${reopened} reopened) in ${rec.ms} ms`,
  );
  notifyStudio(projectId);
  return { ...rec, v: last2.v, opened, reopened, fixed };
}
