const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", name: "Haiku 5.5" },
];
const ALIASES = { opus: "Opus (latest)", sonnet: "Sonnet (latest)", haiku: "Haiku (latest)" };
export const CLAUDE_EFFORTS = [
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
  { id: "xhigh", name: "Extra high" },
  { id: "max", name: "Max" },
];
export const isClaudeModelId = (m) => typeof m === "string" && (CLAUDE_MODELS.some((x) => x.id === m) || m in ALIASES);
export const isModelId = (m) => isClaudeModelId(m) || (typeof m === "string" && /^(google|codex):[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(m));
export const isEffort = (e) => typeof e === "string" && CLAUDE_EFFORTS.some((x) => x.id === e);
const modelName$1 = (m) =>
  !m ? "Account default" : (CLAUDE_MODELS.find((x) => x.id === m)?.name ?? ALIASES[m] ?? m.replace(/^claude-/, ""));
const PREFIXED = /^(google|codex):([A-Za-z0-9][A-Za-z0-9._-]{0,79})$/;
export function engineOf(model) {
  const m = typeof model === "string" ? model.match(PREFIXED) : null;
  return m ? m[1] : "claude";
}
export const bareModel = (model) => model.match(PREFIXED)?.[2] ?? model;
function prettyProxyModel(id) {
  return id
    .split(/[-_]/)
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/\bGpt\b/, "GPT");
}
function proxyModelName(id, name) {
  const n = name || prettyProxyModel(id);
  return /^claude/i.test(id) ? `${/^claude/i.test(n) ? n : "Claude " + n} (via Google)` : n;
}
export const CODEX_MODELS = [
  { id: "gpt-6-astra", name: "GPT-6 Astra" },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
  { id: "gpt-6-luna", name: "GPT-6 Luna" },
];
const codexModelName = (bare) => CODEX_MODELS.find((x) => x.id === bare)?.name ?? prettyProxyModel(bare);
export function modelName(m, google) {
  if (!m) return modelName$1(m);
  const e = engineOf(m);
  if (e === "claude") return modelName$1(m);
  const bare = bareModel(m);
  if (e === "codex") return `${codexModelName(bare)} (ChatGPT)`;
  const known = google?.models.find((x) => x.id === bare)?.name;
  if (/^claude/i.test(bare)) return proxyModelName(bare, known).replace(/\(via Google\)$/, "(via Google, experimental)");
  return `${prettyProxyModel(bare)} (Google, experimental)`;
}
