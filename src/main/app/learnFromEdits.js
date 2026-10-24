import { now, q, uid } from "../db/db";
import { NO_CLAUDE, claudeExecutable, cleanEnv } from "../engines/claudeCli";
import { claudeFallback } from "../engines/resolveEngine";

export const learnModel = () => claudeFallback();
const SYSTEM = `You find recurring preferences in a video creator's edit requests and turn them into short standing rules for
future AI edits of explainer videos (pixel-art and Vox editorial styles). Only propose a rule when the history shows the preference (repeated requests,
or one request that is clearly general). Rules are imperative, specific, max 25 words, about visuals, framing, timing, text,
colour or pacing. Never restate an existing rule. Reply with JSON only: {"rules":[{"rule":"...","scope":"global"|"project",
"project":"<project name if scope is project>","because":"<which requests, briefly>"}]} (empty list if nothing is clear).`;
export async function learnFromEdits(limit = 60) {
  const edits = q.all(
    `SELECT e.instruction, e.scope, e.status, e.created_at, p.name AS project FROM edits e JOIN projects p ON p.id=e.project_id
    WHERE e.instruction <> '' AND e.commit_before IS NOT NULL AND e.status IN ('done','no-change','reverted') ORDER BY e.created_at DESC LIMIT ?`,
    limit,
  );
  if (edits.length < 3) throw new Error("Make a few more edits first: there is not enough history to learn from yet.");
  const existing = q.all("SELECT * FROM rules WHERE status IN ('active','suggested')").map((r) => r.text);
  const exe = claudeExecutable();
  if (!exe) throw new Error(NO_CLAUDE);
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const prompt =
    `Existing rules:
${existing.map((r) => "- " + r).join("\n") || "(none)"}

Edit requests, newest first (project · status · request):
` +
    edits
      .map(
        (e) =>
          `- ${e.project} · ${e.status}${e.status === "reverted" ? " (the user undid this)" : ""} · ${e.instruction.replace(/\s+/g, " ").slice(0, 240)}`,
      )
      .join("\n");
  let text = (await require("./videoxx-chatgpt").side("learn", { system: SYSTEM, prompt })) ?? "";
  if (!text)
    for await (const m of query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: exe,
        env: cleanEnv(),
        systemPrompt: SYSTEM,
        settingSources: [],
        tools: [],
        maxTurns: 1,
        model: learnModel(),
        persistSession: false,
      },
    })) {
      if (m.type === "assistant")
        text += (m.message.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
      if (m.type === "result" && m.subtype !== "success")
        throw new Error(m.errors?.join?.("; ") || "Claude could not analyse the history.");
    }
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let rules = [];
  try {
    rules = JSON.parse(json).rules ?? [];
  } catch {
    throw new Error("Claude replied in an unexpected format. Try again.");
  }
  const projects = q.all("SELECT id, name FROM projects");
  const added = [];
  for (const r of rules.slice(0, 8)) {
    const rule = String(r.rule || "").trim();
    if (rule.length < 8 || existing.includes(rule)) continue;
    const pid = r.scope === "project" ? (projects.find((p) => p.name === r.project)?.id ?? null) : null;
    if (r.scope === "project" && !pid) continue;
    const id = uid("rul_");
    q.run(
      "INSERT INTO rules(id,scope,project_id,text,enabled,status,created_at) VALUES(?,?,?,?,1,?,?)",
      id,
      pid ? "project" : "global",
      pid,
      rule,
      "suggested",
      now(),
    );
    added.push({ id, rule, scope: pid ? "project" : "global", because: r.because ?? "" });
  }
  return { analysed: edits.length, added };
}
