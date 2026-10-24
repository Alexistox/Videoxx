import { getConfig } from "../core/config";
import { bareModel, engineOf, isClaudeModelId, modelName } from "./models";
import { cliproxyState, googleEndpoint, proxyReady } from "./cliproxy";
import { codexState, ensureSandboxProbe, notReadyWhy, refreshCodex } from "./codexCli";

const OTHER_ENGINE_KINDS = new Set(["edit", "ask", "script", "build", "reframe", "routine", "cut", "intro"]);
const KIND_WORDS = {
  ultra: "Ultraedit",
  studio: "the Style Studio",
  style: "a style lab",
  character: "character design",
  harvest: "the Library harvest",
  build: "a build with Ultraedit",
};
export const claudeFallback = () => {
  const m = getConfig().claude.model;
  return m && isClaudeModelId(m) ? m : void 0;
};
export function checkEngineModel(model) {
  const e = engineOf(model);
  if (e === "google" && !cliproxyState().enabled) throw new Error("Google models are off: turn them on in Settings > Experimental first.");
  if (e === "codex" && !codexState().supported) throw new Error("ChatGPT (Codex) is offered on Windows and macOS only.");
}
const GOOGLE_START_MS = 2e4;
export const needsProxyStart = (model) => engineOf(model) === "google" && cliproxyState().enabled && !proxyReady();
export async function resolveEngine(kind, model, o = {}) {
  const engine = engineOf(model);
  if (engine === "claude") return { engine, model: model || void 0 };
  const fallback = (why) => ({
    engine: "claude",
    model: claudeFallback(),
    fallback: true,
    note: `Not on ${engine === "codex" ? "ChatGPT" : "Google"}: ${why} This run uses ${modelName(claudeFallback() ?? null)} on Claude instead, so it counts against your Claude plan.`,
  });
  if (!OTHER_ENGINE_KINDS.has(kind) || (kind === "build" && o.ultraExtras))
    return fallback(`${KIND_WORDS[kind] ?? "This kind of run"} runs on Claude only.`);
  if (engine === "codex") {
    let st = codexState();
    if (!st.checkedAt || Date.now() - Date.parse(st.checkedAt) > 5 * 60 * 1e3 || !st.ready) st = await refreshCodex();
    if (st.installed && !st.tooOld && st.sandbox.ok === null) {
      await ensureSandboxProbe();
      st = codexState();
    }
    const why = notReadyWhy(st);
    return why ? fallback(why) : { engine: "codex", model: bareModel(model) };
  }
  let timedOut = false,
    timer,
    onAbort = () => {};
  const ep = await Promise.race([
    googleEndpoint(),
    new Promise((res) => {
      timer = setTimeout(() => {
        timedOut = true;
        res(null);
      }, GOOGLE_START_MS);
    }),
    new Promise((_, rej) => {
      onAbort = () => rej(new Error("Stopped."));
      if (o.signal?.aborted) onAbort();
      else o.signal?.addEventListener("abort", onAbort, { once: true });
    }),
  ]).finally(() => {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  });
  if (!ep) {
    const st = cliproxyState();
    return fallback(
      !st.enabled
        ? "Google models are turned off (Settings > Experimental)."
        : timedOut
          ? `Google models did not start within ${GOOGLE_START_MS / 1e3} seconds (${st.status === "downloading" ? "CLIProxyAPI is still downloading" : "CLIProxyAPI is still starting"}; see Settings > Experimental).`
          : `CLIProxyAPI is not running${st.error ? ` (${st.error})` : ""}.`,
    );
  }
  if (!cliproxyState().accounts.length) return fallback("No Google account is signed in (Settings > Experimental).");
  const bare = bareModel(model);
  return { engine: "google", model: bare, env: googleEnv(ep.baseUrl, ep.key, bare) };
}
function googleEnv(baseUrl, key2, bare) {
  return {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: key2,
    ANTHROPIC_MODEL: bare,
    ANTHROPIC_DEFAULT_OPUS_MODEL: bare,
    ANTHROPIC_DEFAULT_SONNET_MODEL: bare,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: bare,
    ANTHROPIC_SMALL_FAST_MODEL: bare,
    CLAUDE_CODE_SUBAGENT_MODEL: bare,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    // few retries: a quota error (429) is final for the day; Claude Code's default 10 retries would only burn more requests
    CLAUDE_CODE_MAX_RETRIES: "2",
  };
}
export function engineEnv(base, route) {
  if (!route.env) return base;
  const env = { ...base };
  for (const k of Object.keys(env))
    if (
      /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)|MAX_THINKING_TOKENS)$/.test(
        k,
      )
    )
      delete env[k];
  return { ...env, ...route.env };
}
