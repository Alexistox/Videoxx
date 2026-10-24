import { CLAUDE_MODELS, modelName as modelName$1 } from "./claudeModels";

const PREFIXED = /^(google|codex):([A-Za-z0-9][A-Za-z0-9._-]{0,79})$/;
export function engineOf(model) {
  const m = typeof model === "string" ? model.match(PREFIXED) : null;
  return m ? m[1] : "claude";
}
const bareModel = (model) => model.match(PREFIXED)?.[2] ?? model;
function prettyProxyModel(id) {
  return id
    .split(/[-_]/)
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/\bGpt\b/, "GPT");
}
export function proxyModelName(id, name) {
  const n = name || prettyProxyModel(id);
  return /^claude/i.test(id) ? `${/^claude/i.test(n) ? n : "Claude " + n} (via Google)` : n;
}
export const CODEX_MODELS = [
  { id: "gpt-6-astra", name: "GPT-6 Astra" },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
  { id: "gpt-6-luna", name: "GPT-6 Luna" },
];
const codexModelName = (bare) => CODEX_MODELS.find((x) => x.id === bare)?.name ?? prettyProxyModel(bare);
export function modelGroups(google, codex) {
  const out = [{ engine: "claude", label: "Claude", models: CLAUDE_MODELS }];
  if (codex?.ready)
    out.push({ engine: "codex", label: "ChatGPT", models: CODEX_MODELS.map((m) => ({ id: `codex:${m.id}`, name: m.name })) });
  if (google?.enabled && google.signedIn && google.models.length)
    out.push({
      engine: "google",
      label: "Experimental (Google) ⚠",
      risky: true,
      models: google.models.map((m) => ({ id: `google:${m.id}`, name: proxyModelName(m.id, m.name) })),
    });
  return out;
}
export function modelName(m, google) {
  if (!m) return modelName$1(m);
  const e = engineOf(m);
  if (e === "claude") return modelName$1(m);
  const bare = bareModel(m);
  if (e === "codex") return `${codexModelName(bare)} (ChatGPT)`;
  const known = google?.models.find((x) => x.id === bare)?.name;
  if (/^claude/i.test(bare)) return proxyModelName(bare, known).replace(/\(via Google\)$/, "(via Google, experimental)");
  return `${known || prettyProxyModel(bare)} (Google, experimental)`;
}
export const withEngine = (model, engine) =>
  engineOf(model) !== "claude" || !engine || engine === "claude" ? model : `${engine}:${model}`;
export const workingText = (engine) => (engine === "codex" ? "ChatGPT is working" : engine === "google" ? "Working" : "Claude is working");
