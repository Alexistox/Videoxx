export const CLAUDE_MODELS = [
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
export const modelName = (m) =>
  !m ? "Account default" : (CLAUDE_MODELS.find((x) => x.id === m)?.name ?? ALIASES[m] ?? m.replace(/^claude-/, ""));
export const effortName = (e) => CLAUDE_EFFORTS.find((x) => x.id === e)?.name ?? "Medium";
