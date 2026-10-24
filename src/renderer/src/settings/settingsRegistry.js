import { fold } from "../lib/fold";

export const SETTINGS_TABS = [
  { id: "general", label: "General", hint: "Language, interface scale, preview quality, workspace folder, updates" },
  { id: "claude", label: "AI engines", hint: "Claude and ChatGPT: sign-in, model, effort, video length, permissions, sessions, bridge" },
  { id: "media", label: "Media", hint: "Image generation, voiceover, sound, custom APIs" },
  { id: "youtube", label: "YouTube", hint: "Google sign-in, API key, followed channels" },
  { id: "system", label: "System", hint: "System check, transcription, tool paths" },
  { id: "experimental", label: "Experimental", hint: "Unsupported features, at your own risk: Google models via CLIProxyAPI" },
];
export const tabLabel = (t) => SETTINGS_TABS.find((x) => x.id === t)?.label ?? t;
const SETTINGS = [
  // General
  {
    id: "language",
    tab: "general",
    title: "Language",
    description: "The language your videos are narrated in: English only or several languages.",
    keywords: ["multilingual", "languages", "spanish", "french", "german", "polish", "translate", "narration language", "english"],
  },
  {
    id: "scale",
    tab: "general",
    title: "Interface scale",
    description: "Makes text and controls bigger or smaller.",
    keywords: ["zoom", "font size", "text size", "bigger", "smaller", "ui", "display", "look"],
  },
  {
    id: "preview-quality",
    tab: "general",
    title: "Preview quality",
    description: "How big the editor's live preview is drawn; lower plays in real time on a slow computer.",
    keywords: ["fps", "frame rate", "lag", "slow", "stutter", "performance", "half", "quarter", "auto", "resolution", "quality"],
  },
  {
    id: "graphics-panel",
    tab: "general",
    title: "Graphics (each video)",
    description: "Render scale, shadows, post processing, colour grade and export quality: the Graphics button in the editor.",
    keywords: [
      "graphics",
      "quality",
      "fps",
      "bloom",
      "shadows",
      "post processing",
      "ambient occlusion",
      "depth of field",
      "anti-aliasing",
      "tone mapping",
      "exposure",
      "grain",
      "vignette",
      "colour grade",
      "color grade",
      "render scale",
      "supersampling",
      "motion blur",
      "performance",
    ],
  },
  {
    id: "workspace",
    tab: "general",
    title: "Workspace",
    description: "The folder where your projects and the database live. Also the log and diagnostics.",
    keywords: ["folder", "storage", "where", "path", "documents", "files", "disk", "log", "diagnostics", "support", "version", "database"],
  },
  {
    id: "updates",
    tab: "general",
    title: "Updates",
    description: "Check for a new version, install it, or get beta versions.",
    keywords: [
      "update",
      "version",
      "beta",
      "check now",
      "restart",
      "install",
      "download",
      "upgrade",
      "new version",
      "release",
      "mac",
      "windows",
      "applications",
    ],
  },
  // Claude
  {
    id: "claude-account",
    tab: "claude",
    title: "Claude",
    description: "Sign in with Claude: the app uses your own Claude Code and your plan.",
    keywords: [
      "sign in",
      "login",
      "log in",
      "sign out",
      "logout",
      "account",
      "subscription",
      "plan",
      "connect",
      "anthropic",
      "claude code",
      "usage",
    ],
  },
  {
    id: "chatgpt",
    tab: "claude",
    title: "ChatGPT (Codex)",
    description: "Run edits and builds on ChatGPT (GPT-6 Astra, GPT-6.1 Sol, Luna) with your own ChatGPT plan, through the Codex app.",
    keywords: [
      "chatgpt",
      "codex",
      "openai",
      "gpt",
      "gpt-6",
      "astra",
      "sol",
      "luna",
      "plus",
      "pro",
      "sign in with chatgpt",
      "other models",
      "engine",
      "ai engine",
    ],
  },
  {
    id: "model",
    tab: "claude",
    title: "Model",
    description: "Claude's model for every project without its own: Opus, Sonnet or Haiku.",
    keywords: ["opus", "sonnet", "haiku", "claude model", "gpt", "chatgpt model", "ai model", "default model", "usage", "tokens", "speed"],
  },
  {
    id: "effort",
    tab: "claude",
    title: "Effort",
    description: "How much Claude thinks before acting. Higher is slower and uses more of your plan.",
    keywords: ["thinking", "reasoning", "think", "speed", "usage", "tokens", "quality", "careful", "fast"],
  },
  {
    id: "claude-plan",
    tab: "claude",
    title: "Your Claude plan",
    description:
      "Pro, Max, Team or your own price (or hide savings): Home uses its price to show what you save compared with the pay-per-token API.",
    keywords: [
      "plan",
      "subscription",
      "pro",
      "max",
      "max 5x",
      "max 20x",
      "team",
      "price",
      "savings",
      "saved",
      "money",
      "cost",
      "api",
      "tokens",
      "billing",
    ],
  },
  {
    id: "video-length",
    tab: "claude",
    title: "Preferred video length",
    description: "New projects start with this length; Claude writes scripts to it.",
    keywords: ["length", "duration", "minutes", "seconds", "long", "short", "runtime", "script length"],
  },
  {
    id: "script-skill",
    tab: "claude",
    title: "Your scripting skill",
    description: "Your own way of writing scripts (a skill or instructions): Claude follows it whenever it writes a script.",
    keywords: [
      "script",
      "scripting",
      "skill",
      "skill.md",
      "my skill",
      "own skill",
      "writing",
      "prompt",
      "instructions",
      "tone",
      "voice",
      "hook",
      "template",
      "formula",
      "custom-scripting",
      "scriptwriting",
      "copywriting",
      "per video",
    ],
  },
  {
    id: "permissions",
    tab: "claude",
    title: "Permissions",
    description: "What Claude may do without asking.",
    keywords: ["ask", "approve", "approval", "automatic", "prompts", "allow", "commands", "safety"],
  },
  {
    id: "sessions",
    tab: "claude",
    title: "Sessions",
    description: "Check edits with rendered frames, grow the library after builds, use your own Claude Code setup, turn limit per edit.",
    keywords: [
      "verify",
      "verify edits",
      "rendered frames",
      "own setup",
      "hooks",
      "mcp",
      "skills",
      "claude.md",
      "turn limit",
      "turns",
      "connectors",
      "library",
      "grow",
      "harvest",
      "reuse",
    ],
  },
  {
    id: "bridge",
    tab: "claude",
    title: "Bridge for your own sessions",
    description: "Let a Claude Code session you already have open work on the open project.",
    keywords: ["bridge", "mcp", "terminal", "external", "desktop app", "own session", "videoxx"],
  },
  // Media
  {
    id: "image",
    tab: "media",
    title: "Image generation",
    description:
      "Pictures for Vox videos and custom styles on your Higgsfield or Fal.ai account, the default image model and the API keys.",
    keywords: [
      "images",
      "pictures",
      "image service",
      "higgsfield",
      "fal",
      "fal.ai",
      "api key",
      "key",
      "flux",
      "nano banana",
      "image model",
      "thumbnails",
      "vox",
    ],
  },
  {
    id: "voiceover",
    tab: "media",
    title: "Voiceover",
    description: "The voice that reads your scripts: ElevenLabs, Fish Audio, the local voice or your own; keys and default voice.",
    keywords: [
      "voice",
      "tts",
      "text to speech",
      "narration",
      "narrator",
      "elevenlabs",
      "eleven labs",
      "fish",
      "fish audio",
      "kokoro",
      "local voice",
      "api key",
      "key",
      "speak",
    ],
  },
  {
    id: "sound",
    tab: "media",
    title: "Sound",
    description: "Music and sound effects under the voice in every video.",
    keywords: ["music", "sound effects", "sfx", "ambience", "audio", "mix", "sound design", "background music"],
  },
  {
    id: "sfx-library",
    tab: "media",
    title: "Sound effects library",
    description:
      "Your own sound effects: add a folder or files, search, listen, tag; the sound design uses them first and you can place them in the editor.",
    keywords: ["sound effects", "sfx", "library", "my sounds", "own sounds", "folder", "whoosh", "samples", "foley", "audio files", "tags"],
  },
  {
    id: "custom-api",
    tab: "media",
    title: "Custom APIs",
    description: "A picture or voice service the app doesn't offer: your Claude writes a connector for it (at your own risk).",
    keywords: ["custom", "connector", "own service", "api", "kie", "other service", "plugin"],
  },
  {
    id: "google-flow",
    tab: "media",
    title: "Google Flow",
    description: "Make the pictures with your own Google Flow credits (Nano Banana 2.1) in a Chrome window of its own (at your own risk).",
    keywords: ["flow", "google", "nano banana", "chrome", "credits", "sign in", "gemini"],
  },
  // YouTube
  {
    id: "youtube",
    tab: "youtube",
    title: "YouTube",
    description: "Your Google app and API key, sign-in for your own channel, and the channels you follow.",
    keywords: ["google", "channel", "channels", "api key", "oauth", "analytics", "comments", "stats", "sign in", "upload"],
  },
  // System
  {
    id: "system-check",
    tab: "system",
    title: "System check",
    description: "Everything the pipeline needs: Claude Code, git, ffmpeg, Python and its packages, Node.js.",
    keywords: [
      "health",
      "check",
      "tools",
      "missing",
      "install",
      "ffmpeg",
      "git",
      "python",
      "packages",
      "node",
      "database",
      "run checks",
      "gpu",
    ],
  },
  {
    id: "graphics",
    tab: "system",
    title: "Graphics",
    description: "Draw the preview and videos with the graphics card, or in software when the preview says it cannot create WebGL.",
    keywords: [
      "webgl",
      "gpu",
      "graphics card",
      "software",
      "swiftshader",
      "preview error",
      "black preview",
      "opencore",
      "driver",
      "metal",
      "opengl",
    ],
  },
  {
    id: "transcription",
    tab: "system",
    title: "Transcription",
    description: "The speech model that times the words of your voiceovers on this computer, or Whisper on the CPU.",
    keywords: [
      "whisper",
      "parakeet",
      "speech",
      "speech to text",
      "transcribe",
      "captions",
      "subtitles",
      "timing",
      "gpu",
      "cpu",
      "stable-ts",
      "asr",
    ],
  },
  {
    id: "tool-paths",
    tab: "system",
    title: "Tool paths",
    description: "Where claude, git, ffmpeg, python and Parakeet are, if the app can't find them.",
    keywords: ["path", "paths", "ffmpeg path", "executable", "homebrew", "brew", "not found", "location", "parakeet", "python path"],
  },
  // Experimental
  {
    id: "google-models",
    tab: "experimental",
    title: "Google subscription models via CLIProxyAPI",
    description:
      "Run edits and builds on Gemini with a Google AI plan, through a small program on this computer. At your own risk: Google can block the account.",
    keywords: [
      "gemini",
      "argon",
      "gemini 4",
      "flash",
      "antigravity",
      "google",
      "cliproxy",
      "cliproxyapi",
      "proxy",
      "google ai",
      "ultra",
      "ai pro",
      "experimental",
      "other models",
    ],
  },
];
export const settingById = (id) => SETTINGS.find((s) => s.id === id);
function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const words = (s) =>
  fold(s)
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);
function wordScore(q, ws, whole) {
  let s = 0;
  for (const w of ws) {
    if (w === q) return 1;
    if (w.startsWith(q)) s = Math.max(s, q.length >= 2 ? 0.8 : 0.4);
    else if (q.length >= 3 && w.includes(q)) s = Math.max(s, 0.55);
    else if (q.length >= 4) {
      const max = q.length >= 7 ? 2 : 1;
      if (dist(q, w, max) <= max) s = Math.max(s, 0.5);
      else if (w.length > q.length && dist(q, w.slice(0, q.length), 1) <= 1) s = Math.max(s, 0.4);
    }
  }
  if (!s && q.length >= 3 && whole.includes(q)) s = 0.45;
  return s;
}
export function searchSettings(query) {
  const qs = words(query);
  if (!qs.length) return [];
  const full = fold(query.trim());
  const scored = SETTINGS.map((e) => {
    const title = words(e.title),
      kw = e.keywords.flatMap(words),
      desc = words(e.description),
      tab = words(tabLabel(e.tab));
    let total = 0;
    for (const q of qs) {
      const s = Math.max(
        wordScore(q, title, fold(e.title)) * 10,
        wordScore(q, kw, fold(e.keywords.join(" "))) * 7,
        wordScore(q, tab, "") * 3,
        wordScore(q, desc, fold(e.description)) * 2,
      );
      if (!s) return { e, total: 0 };
      total += s;
    }
    if (fold(e.title) === full) total += 10;
    else if (e.keywords.some((k) => fold(k) === full)) total += 6;
    return { e, total };
  }).filter((x) => x.total > 0);
  scored.sort((a, b) => b.total - a.total || SETTINGS.indexOf(a.e) - SETTINGS.indexOf(b.e));
  return scored.map((x) => x.e);
}
