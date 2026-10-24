import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, on } from "../lib/api";
import { fmtLength, parseLength } from "../lib/format";
import { useApp } from "../state/AppProvider";
import {
  Copy,
  CornerDownLeft,
  Download,
  FlaskConical,
  FolderOpen,
  Image,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  TvMinimalPlay,
  Wrench,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { MOD, isMac } from "../help/keys";
import { Spinner, Toggle } from "../components/ui";
import { CustomApiPanel, OwnRisk } from "../engines/CustomApiPanel";
import { AnimationsPanel } from "../engines/AnimationsPanel";
import { engineOf } from "../engines/models";
import { ExperimentalGoogle, RiskBadge, useGoogleState } from "../engines/ExperimentalGoogle";
import { ChatGPTEngine, useCodexState } from "../engines/ChatGPTEngine";
import { EffortSelect, ModelSelect } from "../engines/ModelSelect";
import { SETTINGS_TABS, searchSettings, settingById, tabLabel } from "./settingsRegistry";
import { PlanChooser, planOf, planText } from "./PlanChooser";
import { LibraryBrowser } from "../sound/LibraryBrowser";
import { KeyDialog } from "../thumbnails/KeyDialog";
import { YouTubeSettings } from "../youtube/YouTubeSettings";
import { VoiceSettingsSection } from "../voice/VoiceSettingsSection";
import { PQ_OPTIONS, setPreviewQuality } from "../player/previewQuality";
import { SignInHelp } from "./SignInHelp";
import { ScriptSkillRow } from "./ScriptSkillRow";
import { Dot, GraphicsRow, Hint, LanguageSection, SpeechRow, updateLine } from "./SettingsRows";

const COUNT_WORDS = {
  projects: ["project", "projects"],
  threads: ["thread", "threads"],
  messages: ["message", "messages"],
  edits: ["edit", "edits"],
  presets: ["preset", "presets"],
  rules: ["rule", "rules"],
  renders: ["render", "renders"],
  channels: ["channel", "channels"],
  ideas: ["idea", "ideas"],
  yt_channels: ["YouTube channel", "YouTube channels"],
  yt_videos: ["YouTube video", "YouTube videos"],
};
const countWords = (k, n) => {
  const w = COUNT_WORDS[k];
  return `${n} ${w ? w[n === 1 ? 0 : 1] : k.replace(/_/g, " ")}`;
};
const TAB_ICON = {
  general: <SlidersHorizontal size={14} />,
  claude: <Sparkles size={14} />,
  media: <Image size={14} />,
  youtube: <TvMinimalPlay size={14} />,
  system: <Wrench size={14} />,
  experimental: <FlaskConical size={14} />,
};
const TAB_KEY = "cz.settingsTab";
const savedTab = () => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return SETTINGS_TABS.some((x) => x.id === t) ? t : "general";
  } catch {
    return "general";
  }
};
function SettingsSearch({ onPick }) {
  const [q, setQ] = useState(""),
    [open, setOpen] = useState(false),
    [i, setI] = useState(0);
  const input = useRef(null),
    list = useRef(null);
  const groups = useMemo(() => {
    const g = new Map();
    for (const e of searchSettings(q)) g.set(e.tab, [...(g.get(e.tab) ?? []), e]);
    return [...g.entries()];
  }, [q]);
  const flat = groups.flatMap(([, es]) => es);
  useEffect(() => setI(0), [q]);
  useEffect(() => {
    const key = (e) => {
      const t = e.target;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"], .modal'))
        return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useLayoutEffect(() => {
    list.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [i]);
  const pick = (e) => {
    if (!e) return;
    setQ("");
    setOpen(false);
    input.current?.blur();
    onPick(e.id);
  };
  const keys = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (flat.length) setI((n22) => (n22 + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(flat[i]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (q) setQ("");
      else input.current?.blur();
    }
  };
  const shown = open && !!q.trim();
  let n = -1;
  return (
    <div
      className="set-search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Search size={15} className="set-search-ic" />
      <input
        ref={input}
        className="input"
        type="search"
        value={q}
        placeholder="Search settings"
        aria-label="Search settings"
        role="combobox"
        aria-expanded={shown}
        aria-controls="set-results"
        aria-activedescendant={shown && flat[i] ? `set-res-${flat[i].id}` : void 0}
        aria-autocomplete="list"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={keys}
      />
      {!q && (
        <kbd className="set-search-kbd" title="Press / to search">
          /
        </kbd>
      )}
      {shown && (
        <div className="set-results" id="set-results" role="listbox" aria-label="Matching settings" ref={list}>
          {!flat.length ? (
            <div className="set-empty" role="status">
              <SearchX size={20} strokeWidth={1.6} />
              <b>No setting matches “{q.trim()}”</b>
              <span>Try another word for it, like voice, key, music, folder or update.</span>
            </div>
          ) : (
            groups.map(([tab, es]) => (
              <div key={tab} className="set-res-group" role="group" aria-label={tabLabel(tab)}>
                <div className="set-res-tab">
                  {TAB_ICON[tab]}
                  {tabLabel(tab)}
                </div>
                {es.map((e) => {
                  n++;
                  const k = n;
                  return (
                    <div
                      key={e.id}
                      id={`set-res-${e.id}`}
                      role="option"
                      aria-selected={k === i}
                      className={`set-res ${k === i ? "on" : ""}`}
                      onMouseMove={() => setI(k)}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => pick(e)}
                    >
                      <span className="set-res-t">
                        {e.title}
                        <small>{e.description}</small>
                      </span>
                      {k === i && <CornerDownLeft size={13} className="set-res-enter" />}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
export function Settings() {
  const [hf, setHf] = useState(null),
    [keyOpen, setKeyOpen] = useState(false);
  const [img, setImg] = useState(null),
    [falOpen, setFalOpen] = useState(false);
  const loadImg = () =>
    api
      .imagesStatus()
      .then(setImg)
      .catch(() => {});
  useEffect(
    () =>
      on("customapi:state", () => {
        loadImg();
      }),
    [],
  );
  useEffect(() => {
    api
      .hfStatus()
      .then(setHf)
      .catch(() => setHf({ hasKey: false, hint: null }));
    loadImg();
  }, []);
  const PNAME = {
    higgsfield: "Higgsfield",
    fal: "Fal.ai",
    custom: `your custom API${img?.custom ? ` (${img.custom}, at your own risk)` : ""}`,
    flow: "Google Flow (uses your Flow credits, at your own risk)",
  };
  const using = !img
    ? "Checking…"
    : !img.active
      ? img.setting === "flow"
        ? "Open Flow below and sign in first"
        : "No key yet: add a Higgsfield or Fal.ai key below"
      : `Using ${PNAME[img.active]}${img.setting !== "auto" && img.setting !== img.active ? ` (${img.setting === "flow" ? "Google Flow is not opened yet" : `${PNAME[img.setting]} has no key`})` : img.setting === "auto" && img.higgsfield.hasKey && img.fal.hasKey ? " (both are set up)" : ""}`;
  const [flowBusy, setFlowBusy] = useState(""),
    [flowShot, setFlowShot] = useState(null),
    [flowErr, setFlowErr] = useState("");
  const flowOpen = () => {
    setFlowBusy("open");
    setFlowErr("");
    api
      .flowOpen()
      .then(setImg)
      .catch((e) => setFlowErr(e.message))
      .finally(() => setFlowBusy(""));
  };
  const flowTest = () => {
    setFlowBusy("test");
    setFlowErr("");
    setFlowShot(null);
    api
      .flowTest()
      .then(setFlowShot)
      .catch((e) => setFlowErr(e.message))
      .finally(() => {
        setFlowBusy("");
        loadImg();
      });
  };
  const { claude, signIn, signingIn, loginLog, refreshClaude, toast, settingsReq, clearSettingsReq } = useApp();
  const [cfg, setCfg] = useState(null);
  const google = useGoogleState();
  const codex = useCodexState();
  const [tab, setTabState] = useState(savedTab);
  const setTab = (t) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
  };
  const [jumpTo, setJumpTo] = useState(null);
  const jump = (id) => {
    const e = settingById(id);
    if (!e) return;
    setTab(e.tab);
    setJumpTo({ id, n: Date.now() });
  };
  useEffect(() => {
    if (settingsReq) {
      jump(settingsReq.id);
      clearSettingsReq();
    }
  }, [settingsReq]);
  const tabsRef = useRef(null);
  const tabKeys = (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0,
      at = SETTINGS_TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? SETTINGS_TABS.length - 1 : d ? (at + d + SETTINGS_TABS.length) % SETTINGS_TABS.length : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(SETTINGS_TABS[next].id);
    requestAnimationFrame(() => tabsRef.current?.querySelector(`#set-tab-${SETTINGS_TABS[next].id}`)?.focus());
  };
  const [health, setHealth] = useState(null);
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(null);
  useEffect(
    () =>
      on("pipeline:log", (m) => {
        if (m.step === "setup") setInstalling((l) => l && [...l.slice(-200), m.line]);
      }),
    [],
  );
  const installPy = async () => {
    setInstalling([]);
    try {
      const r = await api.installPython(health.pyMissing);
      setHealth((h) => ({ ...h, pyMissing: r.missing }));
      toast(r.ok && !r.missing?.length ? "Python packages installed." : "Some packages did not install. See the log.", r.ok ? "ok" : "bad");
    } catch (e) {
      toast(e.message, "bad");
      setInstalling(null);
    }
  };
  const check = async () => {
    setChecking(true);
    try {
      setHealth(await api.health());
      await refreshClaude();
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    api.config().then(setCfg);
    api.info().then(setInfo);
    check();
  }, []);
  const [upd, setUpd] = useState(null);
  useEffect(() => {
    api.updateStatus().then(setUpd);
    return on("update:status", setUpd);
  }, []);
  const [updChecking, setUpdChecking] = useState(false);
  const checkUpdates = async () => {
    setUpdChecking(true);
    try {
      const s = await api.checkUpdates();
      setUpd(s);
      if (s.state === "none") toast(`You're up to date (${info?.version ?? "latest"}).`);
      else if (s.state === "downloading") toast(`Version ${s.version} found. Downloading it now…`);
      else if (s.state === "ready")
        toast(
          s.download
            ? `Version ${s.version} is out. Press ${s.viaLauncher ? "Install now" : "Download"}.`
            : `Version ${s.version} is ready. Press Restart now, or it installs when you close the app.`,
        );
      else if (s.state === "error") toast(`Couldn't check for updates: ${s.message}`, "bad");
    } catch (e) {
      toast(`Couldn't check for updates: ${String(e.message).replace(/^.*Error: /, "")}`, "bad");
    } finally {
      setUpdChecking(false);
    }
  };
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    api.zoom().then(setZoom);
    return on("ui:zoom", (v) => setZoom(v.zoom));
  }, []);
  const save = async (patch) => {
    const c = await api.setConfig(patch);
    setCfg(c);
    if (patch.bridge) setInfo(await api.info());
    toast("Saved.");
  };
  useEffect(() => {
    if (!jumpTo || !cfg) return;
    let timer = 0;
    const find = () => document.querySelector(`[data-setting="${jumpTo.id}"]`);
    const go = () => {
      const el = find();
      if (!el) return;
      const row = el.matches(".settings-row, .kv > *") ? el : (el.querySelector(".settings-row") ?? el);
      const lit = row.parentElement?.classList.contains("kv") && row.nextElementSibling ? [row, row.nextElementSibling] : [row];
      document.querySelectorAll(".set-flash").forEach((x) => x.classList.remove("set-flash"));
      row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      lit.forEach((x) => {
        x.classList.remove("set-flash");
        void x.offsetWidth;
        x.classList.add("set-flash");
      });
      timer = window.setTimeout(() => lit.forEach((x) => x.classList.remove("set-flash")), 2400);
    };
    const raf = requestAnimationFrame(go);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [jumpTo, !!cfg]);
  if (!cfg)
    return (
      <div className="loading">
        <Spinner />
      </div>
    );
  const copy = async (s) => {
    await api.copy(s);
    toast("Copied.");
  };
  const panel = (id, children) => (
    <div role="tabpanel" id={`set-panel-${id}`} aria-labelledby={`set-tab-${id}`} hidden={tab !== id} className="set-panel">
      {children}
    </div>
  );
  return (
    <div className="page page-enter narrow">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Connection, permissions, tools and where your work is stored.</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={check} disabled={checking}>
            {checking ? <Spinner size={15} /> : <RefreshCw size={15} />}Run checks
          </button>
        </div>
      </div>
      <div className="set-bar">
        <div className="tabs set-tabs" role="tablist" aria-label="Settings sections" ref={tabsRef} onKeyDown={tabKeys}>
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`set-tab-${t.id}`}
              aria-controls={`set-panel-${t.id}`}
              aria-selected={tab === t.id}
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? "active" : ""}
              title={t.hint}
              onClick={() => setTab(t.id)}
            >
              {TAB_ICON[t.id]}
              {t.label}
            </button>
          ))}
        </div>
        <SettingsSearch onPick={jump} />
      </div>
      {panel(
        "claude",
        <>
          <section className="panel" aria-label="Claude">
            <div className="settings-row" data-setting="claude-account">
              <div className="l">
                <h3>Claude</h3>
                <p>
                  The Suite drives your own Claude Code with your login (your plan's usage, not API billing). Each project keeps one session
                  that every edit continues.
                </p>
              </div>
              <div className="r">
                <div className="row">
                  <Dot ok={!!claude?.loggedIn} />
                  <b style={{ fontWeight: 500 }}>
                    {claude?.loggedIn
                      ? `Signed in (${claude.method === "claude.ai" ? "Claude subscription" : claude.method === "api_key" ? "API key, billed as API credit" : claude.method})`
                      : "Not signed in"}
                  </b>
                  <span className="small">
                    {"Claude Code "}
                    {claude?.version ?? "?"}
                  </span>
                  <span className="grow" />
                  {claude?.loggedIn ? (
                    <button
                      className="btn small"
                      onClick={async () => {
                        await api.claudeLogout();
                        refreshClaude();
                      }}
                    >
                      <LogOut size={14} />
                      Sign out
                    </button>
                  ) : (
                    <button className="btn small primary" onClick={signIn} disabled={signingIn}>
                      {signingIn ? <Spinner size={14} /> : <LogIn size={14} />}Sign in with Claude
                    </button>
                  )}
                </div>
                {claude?.error && (
                  <p className="small" style={{ color: "var(--err)" }}>
                    {claude.error}
                  </p>
                )}
                {claude?.ignoredKey && (
                  <p className="small dim">
                    This computer has an ANTHROPIC_API_KEY set. The Suite ignores it, so edits use your Claude plan, not API credit.
                  </p>
                )}
                {claude?.method === "api_key" && (
                  <p className="small dim">To use your Claude plan instead, click Sign out, then Sign in with Claude.</p>
                )}
                {signingIn && <SignInHelp lines={loginLog} />}
                <span className="path">{claude?.executable ?? "binary not found"}</span>
              </div>
            </div>
            <div className="settings-row" data-setting="chatgpt">
              <div className="l">
                <h3>ChatGPT (Codex)</h3>
                <p>
                  Run edits, questions, scripts and builds on ChatGPT's models (GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna) with your own ChatGPT
                  plan instead of Claude. The app drives OpenAI's Codex app that you install and sign in to, the same way it drives your
                  Claude Code. Ultraedit, the Style Studio and character design stay on Claude.
                </p>
              </div>
              <div className="r">
                <ChatGPTEngine />
              </div>
            </div>
            <div className="settings-row" data-setting="model">
              <div className="l">
                <h3>Model</h3>
                <p>{`Leave on default to use whatever your Claude Code account is set to. Every project uses this unless it has its own (New project's "This project's settings", Project settings in the editor, or under its Claude panel's input).`}</p>
              </div>
              <div className="r">
                <ModelSelect
                  value={cfg.claude.model ?? ""}
                  onChange={(v) => save({ claude: { model: v || null } })}
                  ariaLabel="Model"
                  style={{ width: 320, maxWidth: "100%" }}
                  globalLabel="Account default"
                  globalHint="Whatever your Claude Code account is set to"
                  google={google}
                  codex={codex}
                  extra={
                    ["opus", "sonnet", "haiku"].includes(cfg.claude.model ?? "")
                      ? [{ value: cfg.claude.model, label: `${cfg.claude.model[0].toUpperCase()}${cfg.claude.model.slice(1)} (latest)` }]
                      : []
                  }
                />
              </div>
            </div>
            <div className="settings-row" data-setting="effort">
              <div className="l">
                <h3>Effort</h3>
                <p>
                  {"How much "}
                  {engineOf(cfg.claude.model) === "codex" ? "the AI" : "Claude"}
                  {
                    " thinks before acting on edits and builds (for ChatGPT: Codex's reasoning effort). Higher is slower and uses more of your plan. Script research runs at medium unless a project has its own effort (New project, Project settings or its Claude panel)."
                  }
                </p>
                {engineOf(cfg.claude.model) === "google" && (
                  <p className="small dim" data-effort-google>
                    Google models have no effort setting: this applies only to runs on Claude (Ultraedit, the Style Studio, and any run that
                    falls back to Claude).
                  </p>
                )}
              </div>
              <div className="r">
                <EffortSelect
                  value={cfg.claude.effort ?? "medium"}
                  onChange={(v) => save({ claude: { effort: v } })}
                  ariaLabel="Effort"
                  globalLabel={null}
                  style={{ width: 320, maxWidth: "100%" }}
                />
              </div>
            </div>
            <div className="settings-row" data-setting="claude-plan">
              <div className="l">
                <h3>Your Claude plan</h3>
                <p>
                  {`Home compares what your Claude use would cost on the pay-per-token API with what your plan costs, to show what you save. The app can't read your plan reliably, so pick it here or on Home (the plan pill on the savings card). Not sure? "Hide savings" leaves out only the savings card; tokens and the API equivalent stay.`}
                  {cfg.claudePlan?.detected ? ` Claude Code reports "${cfg.claudePlan.detected}".` : ""}
                </p>
                <p className="muted small" data-plan-now>
                  {"Now: "}
                  {planText(planOf(cfg.claudePlan))}
                </p>
              </div>
              <div className="r">
                <PlanChooser
                  plan={planOf(cfg.claudePlan)}
                  onSaved={async () => {
                    setCfg(await api.config());
                    toast("Saved.");
                  }}
                />
              </div>
            </div>
            <div className="settings-row" data-setting="video-length">
              <div className="l">
                <h3>Preferred video length</h3>
                <p>
                  New projects start with this length. Claude writes scripts to it and paces builds for it; every project can change its
                  own.
                </p>
              </div>
              <div className="r">
                <input
                  className="input compact"
                  style={{ width: 120 }}
                  aria-label="Preferred video length"
                  defaultValue={fmtLength(cfg.video?.length ?? 120)}
                  placeholder="2:00"
                  onBlur={(e) => {
                    const v = parseLength(e.target.value);
                    if (v && v >= 15 && v <= 3600) {
                      if (v !== cfg.video?.length) save({ video: { length: v } });
                      e.target.value = fmtLength(v);
                    } else {
                      toast("Use minutes:seconds, e.g. 2:30.", "bad");
                      e.target.value = fmtLength(cfg.video?.length ?? 120);
                    }
                  }}
                />
              </div>
            </div>
            <ScriptSkillRow />
            <div className="settings-row" data-setting="permissions">
              <div className="l">
                <h3>Permissions</h3>
                <p>What Claude may do without asking. Edits always stay inside the project folder and every edit can be reverted.</p>
              </div>
              <div className="r">
                {[
                  ["auto", "Automatic", "Edits and commands run without prompts (recommended for unattended builds)."],
                  [
                    "ask-commands",
                    "Ask before commands",
                    "File edits are automatic; shell commands and web access ask first. Good for projects someone else made.",
                  ],
                  ["ask-all", "Ask for everything", "Every edit and command asks for approval in the Claude panel."],
                ].map(([v, t, d]) => (
                  <label key={v} className="check" style={{ alignItems: "flex-start" }}>
                    <input
                      type="radio"
                      name="perm"
                      checked={cfg.claude.permissions === v}
                      onChange={() => save({ claude: { permissions: v } })}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      {t}
                      <small className="muted" style={{ display: "block", fontSize: 12 }}>
                        {d}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="settings-row" data-setting="sessions">
              <div className="l">
                <h3>Sessions</h3>
                <p>
                  Each project has one Claude Code session that every edit continues, so Claude remembers the project. Start it over with +
                  in the Claude panel.
                </p>
              </div>
              <div className="r">
                <div className="opt">
                  <span>
                    Check edits with rendered frames<small>Claude renders the changed moments and fixes what looks wrong.</small>
                  </span>
                  <Toggle label="Verify edits" on={cfg.claude.autoVerify} onChange={(v) => save({ claude: { autoVerify: v } })} />
                </div>
                <div className="opt" data-setting="library-grow">
                  <span>
                    Grow the library after builds
                    <small>
                      {
                        "When a video is built, Claude takes a short read-only look back and proposes what later videos can reuse (code, scene recipes, fixes). You accept or reject each in the Library. Library > Harvest now works either way."
                      }
                    </small>
                  </span>
                  <Toggle
                    label="Grow the library after builds"
                    on={cfg.library?.grow !== false}
                    onChange={(v) => save({ library: { grow: v } })}
                  />
                </div>
                <div className="opt">
                  <span>
                    Use my own Claude Code setup
                    <small>
                      Off keeps sessions fast and scoped: the project's settings, the bundled skill and the Suite's tools only. On also
                      loads your hooks, personal skills, CLAUDE.md, MCP servers and connectors. ChatGPT runs follow it too: off leaves your
                      Codex config.toml out, on loads its MCP servers and plugins.
                    </small>
                  </span>
                  <Toggle
                    label="Use my own Claude Code setup"
                    on={!!cfg.claude.userMcp}
                    onChange={(v) => save({ claude: { userMcp: v } })}
                  />
                </div>
                <div className="opt">
                  <span>Turn limit per edit</span>
                  <input
                    className="input compact"
                    style={{ width: 90 }}
                    type="number"
                    min={5}
                    max={400}
                    defaultValue={cfg.claude.maxTurns}
                    aria-label="Turn limit per edit"
                    onBlur={(e) => {
                      const v = Math.min(400, Math.max(5, Math.round(+e.target.value) || 60));
                      e.target.value = String(v);
                      if (v !== cfg.claude.maxTurns) save({ claude: { maxTurns: v } });
                    }}
                  />
                </div>
              </div>
            </div>
          </section>
          <section className="panel" style={{ marginTop: 25 }} aria-label="Bridge">
            <div className="settings-row" data-setting="bridge">
              <div className="l">
                <h3>Bridge for your own sessions</h3>
                <p>
                  Let a Claude Code session you already have open (desktop app or terminal) see your selection and work on the open project.
                </p>
              </div>
              <div className="r">
                <div className="opt">
                  <span>
                    Enable bridge<small>{info?.bridge?.running ? `Listening on ${info.bridge.url}` : "Not running"}</small>
                  </span>
                  <Toggle label="Enable bridge" on={cfg.bridge.enabled} onChange={(v) => save({ bridge: { enabled: v } })} />
                </div>
                <div className="row">
                  <code className="grow path" style={{ fontSize: 12, background: "#141414", padding: "9px 11px", borderRadius: 8 }}>
                    {info?.bridge?.command}
                  </code>
                  <button className="btn small" onClick={() => copy(info?.bridge?.command)}>
                    <Copy size={14} />
                    Copy
                  </button>
                </div>
                <span className="help">
                  Run that once in a terminal. Then in any Claude Code session: “use videoxx to fix what I selected”.
                </span>
              </div>
            </div>
          </section>
        </>,
      )}
      {panel(
        "media",
        <>
          <section className="panel" style={{ marginTop: 25 }} aria-label="Image generation">
            <div className="settings-row" data-setting="image">
              <div className="l">
                <h3>Image generation</h3>
                <p>
                  Vox videos, custom styles, textures, Ultraedit+ targets and thumbnails use it: Claude makes the pictures on your own
                  account. Automatic uses Google Flow when you have set it up below (free with your Flow credits), else Higgsfield or Fal.ai
                  (about a cent each; Higgsfield first when both are). If Flow can't make a picture, Automatic makes it on Higgsfield or
                  Fal.ai instead. A project can pick its own service in its Project settings (the gear next to its name in the editor). Keys
                  are stored encrypted on this computer and only used by the app.
                </p>
              </div>
              <div className="r">
                <div className="opt">
                  <span>
                    Pictures in Vox and custom styles<small>{using}</small>
                  </span>
                  <select
                    className="input compact"
                    style={{ width: 200 }}
                    aria-label="Image generation service"
                    value={img?.setting ?? "auto"}
                    onChange={(e) =>
                      api
                        .setImageProvider(e.target.value)
                        .then(setImg)
                        .catch((err) => toast(err.message, "bad"))
                    }
                  >
                    <option value="auto">Automatic</option>
                    <option value="higgsfield">Higgsfield</option>
                    <option value="fal">Fal.ai</option>
                    {img?.custom && (
                      <option value="custom">
                        {"Custom: "}
                        {img.custom}
                      </option>
                    )}
                    <option value="flow">Google Flow (at your own risk)</option>
                  </select>
                </div>
                {img && (
                  <div className="opt">
                    <span>
                      Default Higgsfield model
                      <small>
                        {img.higgsfieldModels.find((m) => m.id === (img.models.higgsfield ?? img.defaultModel))?.note ?? ""}. Claude uses it
                        for every picture unless it picks another; a project can pick its own. Fal.ai uses FLUX.2.
                      </small>
                    </span>
                    <select
                      className="input compact"
                      style={{ width: 190 }}
                      aria-label="Default Higgsfield model"
                      value={img.models.higgsfield ?? ""}
                      onChange={(e) =>
                        api
                          .setImageModel("higgsfield", e.target.value || null)
                          .then(setImg)
                          .catch((err) => toast(err.message, "bad"))
                      }
                    >
                      <option value="">
                        {img.higgsfieldModels.find((m) => m.id === img.defaultModel)?.label ?? img.defaultModel}
                        {" (app default)"}
                      </option>
                      {img.higgsfieldModels
                        .filter((m) => m.id !== img.defaultModel)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                {img?.custom && (
                  <div className="opt">
                    <span>
                      Default model of your custom API
                      <small>
                        {'Sent to your connector as "model", the way '}
                        {img.custom}
                        {" names it. Empty: the connector's own."}
                      </small>
                    </span>
                    <input
                      key={img.models.custom ?? ""}
                      className="input compact"
                      style={{ width: 190 }}
                      aria-label="Default custom API model"
                      defaultValue={img.models.custom ?? ""}
                      placeholder="The connector's own"
                      maxLength={100}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (img.models.custom ?? ""))
                          api
                            .setImageModel("custom", v || null)
                            .then(setImg)
                            .catch((err) => toast(err.message, "bad"));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                      }}
                    />
                  </div>
                )}
                <div className="opt">
                  <span>
                    Higgsfield API key
                    <small>{hf === null ? "Checking…" : hf.hasKey ? `Saved, ends in …${hf.hint}` : "Not added yet"}</small>
                  </span>
                  <button className="btn small" onClick={() => setKeyOpen(true)}>
                    {hf?.hasKey ? "Change" : "Add key"}
                  </button>
                </div>
                <div className="opt">
                  <span>
                    Fal.ai API key<small>{!img ? "Checking…" : img.fal.hasKey ? `Saved, ends in …${img.fal.hint}` : "Not added yet"}</small>
                  </span>
                  <button className="btn small" onClick={() => setFalOpen(true)}>
                    {img?.fal.hasKey ? "Change" : "Add key"}
                  </button>
                </div>
                <div className="opt flow-opt" data-setting="google-flow">
                  <span>
                    {"Google Flow "}
                    <OwnRisk />
                    <small>
                      {!img
                        ? "Checking…"
                        : !img.flow.chrome
                          ? "Needs Google Chrome (free from google.com/chrome)."
                          : `Uses your Flow credits (Nano Banana 2.1), one picture at a time, in a Chrome window of its own: keep that window open while a video builds. Only used when you pick it above. ${img.flow.opened ? "Opened before: sign in there if Flow asks." : "Open Flow once and sign in to your Google account."} Not supported: if Flow changes, it may stop working.`}
                    </small>
                    {flowErr && (
                      <small className="flow-err" style={{ color: "var(--bad, #e06c6c)" }}>
                        {flowErr}
                      </small>
                    )}
                    {flowShot && (
                      <img
                        className="flow-test-shot"
                        src={flowShot.url}
                        alt="Test picture from Google Flow"
                        style={{ display: "block", width: 220, marginTop: 8, borderRadius: 6 }}
                      />
                    )}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn small" disabled={!!flowBusy || !img?.flow.chrome} onClick={flowOpen}>
                      {flowBusy === "open" ? <Spinner size={12} /> : null}Open Flow to sign in
                    </button>
                    <button
                      className="btn small"
                      disabled={!!flowBusy || !img?.flow.opened}
                      title="Makes one small test picture on your Flow account"
                      onClick={flowTest}
                    >
                      {flowBusy === "test" ? <Spinner size={12} /> : null}Test
                    </button>
                  </span>
                </div>
              </div>
            </div>
          </section>
          <div data-setting="voiceover">
            <VoiceSettingsSection />
          </div>
          {cfg && (
            <section className="panel" style={{ marginTop: 25 }} aria-label="Sound">
              <div className="settings-row" data-setting="sound">
                <div className="l">
                  <h3>Sound</h3>
                  <p>
                    What the Mix step puts under the voice in every video. A project can choose its own in its Project settings (the gear
                    next to its name in the editor).
                  </p>
                </div>
                <div className="r">
                  <div className="opt">
                    <span>
                      Music<small>Music and ambience beds (MS Paint stick figures never have music).</small>
                    </span>
                    <Toggle label="Music" on={cfg.sound?.music !== false} onChange={(v) => save({ sound: { music: v } })} />
                  </div>
                  <div className="opt">
                    <span>
                      Sound effects<small>Sounds on cuts, cards and accents.</small>
                    </span>
                    <Toggle label="Sound effects" on={cfg.sound?.sfx !== false} onChange={(v) => save({ sound: { sfx: v } })} />
                  </div>
                </div>
              </div>
            </section>
          )}
          <section className="panel" style={{ marginTop: 25 }} aria-label="Sound effects library">
            <div className="settings-row sfxl-row-wide" data-setting="sfx-library">
              <div className="l">
                <h3>Sound effects library</h3>
                <p>
                  {
                    'Your own sounds, for every video: the sound design uses them first (a folder named "Whooshes" fills the whooshes), and in the editor you can place any of them yourself (Music & effects > Layers). Copies are kept in your workspace, in '
                  }
                  {isMac ? "a folder you can open in Finder" : "a folder you can open in File Explorer"}.
                </p>
                <button
                  className="btn small ghost"
                  onClick={() =>
                    api
                      .sfxList()
                      .then((l) => api.reveal(l.dir))
                      .catch((e) => toast(e.message, "bad"))
                  }
                >
                  <FolderOpen size={14} />
                  {isMac ? "Show in Finder" : "Show in File Explorer"}
                </button>
              </div>
              <div className="r">
                <LibraryBrowser />
              </div>
            </div>
          </section>
          <AnimationsPanel />
          <section className="panel" style={{ marginTop: 25 }} aria-label="Custom APIs">
            <div className="settings-row" data-setting="custom-api">
              <div className="l">
                <h3>
                  {"Custom APIs "}
                  <OwnRisk />
                </h3>
                <p>
                  Want a picture or voice service the app doesn't offer? Describe it, and your Claude writes a small connector for it and
                  tests it. It lives in its own folder and changes nothing else; pick it in Image generation or in the Voiceover window. Not
                  supported: if it breaks, remove it.
                </p>
              </div>
              <div className="r">
                <CustomApiPanel kind="image" />
                <CustomApiPanel kind="voice" />
              </div>
            </div>
          </section>
        </>,
      )}
      {keyOpen && (
        <KeyDialog
          hf={hf}
          onClose={() => setKeyOpen(false)}
          onSaved={(s) => {
            setHf(s);
            loadImg();
          }}
        />
      )}
      {falOpen && <KeyDialog provider="fal" hf={img?.fal ?? null} onClose={() => setFalOpen(false)} onSaved={() => loadImg()} />}
      {panel(
        "youtube",
        <div data-setting="youtube">
          <YouTubeSettings />
        </div>,
      )}
      {panel(
        "experimental",
        <section className="panel" aria-label="Experimental">
          <div className="settings-row" data-setting="google-models">
            <div className="l">
              <h3>
                {"Google subscription models via CLIProxyAPI "}
                <RiskBadge />
              </h3>
              <p>
                Run edits, questions, scripts and builds on Google's models (Gemini 4 Argon, Gemini 3.8 Flash) with your Google AI plan
                instead of Claude. Your own Claude Code does the work, talking to a small program on this computer that signs in to Google
                for it. Ultraedit, the Style Studio and character design stay on Claude.
              </p>
            </div>
            <div className="r">
              <ExperimentalGoogle />
            </div>
          </div>
        </section>,
      )}
      {panel(
        "system",
        <>
          <section className="panel" style={{ marginTop: 25 }} aria-label="Health">
            <div className="settings-row" data-setting="system-check">
              <div className="l">
                <h3>System check</h3>
                <p>Everything the pipeline needs. Missing tools only disable the steps that use them.</p>
              </div>
              <div className="r">
                {!health ? (
                  <Spinner />
                ) : (
                  <div className="kv">
                    <span>Database</span>
                    <span className="row">
                      <Dot ok={health.db?.ok} />
                      {health.db?.ok
                        ? `OK · schema v${health.db.version} · ${Object.entries(health.db.counts)
                            .map(([k, v]) => countWords(k, Number(v)))
                            .join(", ")}`
                        : health.db?.error}
                    </span>
                    <span>Claude Code</span>
                    <span className="row">
                      <Dot ok={!!health.claude?.loggedIn} />
                      {health.claude?.loggedIn ? (
                        "Connected"
                      ) : !health.executable ? (
                        <>
                          {"Claude Code is not installed "}
                          <Hint cmd={health.install?.claude} shell={health.install?.shell} />
                        </>
                      ) : (
                        health.claude?.error || "Not signed in"
                      )}
                    </span>
                    <span>Git (edit history)</span>
                    <span className="row">
                      <Dot ok={!!health.git} />
                      {health.git ?? (
                        <>
                          {"Not found: edits cannot be reverted "}
                          <Hint cmd={health.install?.git} shell={health.install?.shell} />
                        </>
                      )}
                    </span>
                    <span>ffmpeg (export)</span>
                    <span className="row">
                      <Dot ok={!!health.ffmpeg} />
                      {health.ffmpeg ?? (
                        <>
                          {"Not found: export cannot add audio / mux "}
                          <Hint cmd={health.install?.ffmpeg} shell={health.install?.shell} />
                        </>
                      )}
                    </span>
                    <span>Python (audio)</span>
                    <span className="row">
                      <Dot ok={!!health.python} />
                      {health.python ?? (
                        <>
                          {"Not found: audio pipeline disabled "}
                          <Hint cmd={health.install?.python} shell={health.install?.shell} />
                        </>
                      )}
                    </span>
                    {health.python && (
                      <>
                        <span>Python packages</span>
                        <span className="row" style={{ flexWrap: "wrap" }}>
                          <Dot ok={!health.pyMissing?.length} warn={!!health.pyMissing?.length} />
                          {!health.pyMissing ? (
                            "Could not check"
                          ) : !health.pyMissing.length ? (
                            "All installed"
                          ) : (
                            <>
                              {"Missing "}
                              {health.pyMissing.join(", ")}
                              <button className="btn tiny" disabled={!!installing && !installing.length} onClick={installPy}>
                                {installing && !installing.length ? <Spinner size={12} /> : null}Install
                                {health.pyMissing.includes("stable-ts") ? " (~2 GB with PyTorch)" : ""}
                              </button>
                            </>
                          )}
                        </span>
                      </>
                    )}
                    {installing && installing.length > 0 && (
                      <>
                        <span />
                        <div className="log-box" style={{ maxHeight: 140 }}>
                          {installing.slice(-40).join("\n")}
                        </div>
                      </>
                    )}
                    {health.scripts && (
                      <>
                        <span>Audio scripts (app files)</span>
                        <span className="row" data-check="scripts">
                          <Dot ok={health.scripts.ok && !health.scripts.restored} warn={health.scripts.restored} />
                          {health.scripts.text}
                        </span>
                      </>
                    )}
                    <span>Node.js (intro edits)</span>
                    <span className="row">
                      <Dot ok={!!health.node} warn={!health.node} />
                      {health.node ? (
                        `Node ${health.node.replace(/^v/, "")}`
                      ) : (
                        <>
                          {"Not found: Claude cannot render edited intros "}
                          <Hint cmd={health.install?.node} shell={health.install?.shell} />
                        </>
                      )}
                    </span>
                    {health.pathProblem && (
                      <>
                        <span>PATH</span>
                        <span className="row">
                          <Dot ok={false} warn />
                          {health.pathProblem}
                        </span>
                      </>
                    )}
                    <SpeechRow signedIn={!!claude?.loggedIn} />
                    <SpeechRow signedIn={!!claude?.loggedIn} mode="multi" />
                    {health.install?.note && (!health.ffmpeg || !health.python) && (
                      <>
                        <span />
                        <span className="small">{health.install.note}</span>
                      </>
                    )}
                    <span>Preview server</span>
                    <span className="row">
                      <Dot ok={!!health.server} />
                      {health.server}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <GraphicsRow />
            <div className="settings-row" data-setting="tool-paths">
              <div className="l">
                <h3>Tool paths</h3>
                <p>
                  {isMac
                    ? "Only needed if the Suite can't find a tool, e.g. /opt/homebrew/bin/ffmpeg."
                    : "Only needed if the tools aren't on PATH."}
                </p>
              </div>
              <div className="r">
                <div className="row">
                  <span style={{ width: 70 }} className="small">
                    claude
                  </span>
                  <input
                    className="input compact grow"
                    aria-label="Claude Code path"
                    defaultValue={cfg.claude.executable ?? ""}
                    placeholder={`Found automatically${claude?.executable ? `: ${claude.executable}` : ""}`}
                    onBlur={(e) =>
                      e.target.value.trim() !== (cfg.claude.executable ?? "") &&
                      save({ claude: { executable: e.target.value.trim() || null } }).then(() => refreshClaude())
                    }
                  />
                </div>
                <div className="row">
                  <span style={{ width: 70 }} className="small">
                    codex
                  </span>
                  <input
                    className="input compact grow"
                    aria-label="Codex path"
                    defaultValue={cfg.engines?.codex?.executable ?? ""}
                    placeholder={`Found automatically${codex?.executable ? `: ${codex.executable}` : ""}`}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (cfg.engines?.codex?.executable ?? ""))
                        api
                          .codexPath(v || null)
                          .then(async () => {
                            setCfg(await api.config());
                            toast("Saved.");
                          })
                          .catch((err) => toast(String(err.message).replace(/^.*Error: /, ""), "bad"));
                    }}
                  />
                </div>
                {["git", "ffmpeg", "python", "parakeet"].map((k) => (
                  <div key={k} className="row">
                    <span style={{ width: 70 }} className="small">
                      {k}
                    </span>
                    <input
                      className="input compact grow"
                      defaultValue={cfg.tools[k] ?? ""}
                      placeholder={k === "parakeet" ? "Only if you run your own Parakeet: folder with .venv and transcribe.py" : void 0}
                      onBlur={(e) =>
                        e.target.value !== (cfg.tools[k] ?? "") &&
                        save({ tools: { [k]: e.target.value || (k === "parakeet" ? null : k === "python" && isMac ? "python3" : k) } })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>,
      )}
      {panel(
        "general",
        <>
          <div data-setting="language">
            <LanguageSection signedIn={!!claude?.loggedIn} />
          </div>
          <section className="panel" style={{ marginTop: 25 }} aria-label="Updates">
            <div className="settings-row" data-setting="updates">
              <div className="l">
                <h3>Updates</h3>
                <p>
                  {isMac
                    ? "The app checks for new versions. The Videoxx Launcher installs them for you (without it: download the new version and drag it into Applications). Your projects and settings are kept."
                    : "New versions download in the background and install when you close the app. Your projects and settings are kept."}
                </p>
              </div>
              <div className="r">
                {(() => {
                  const [ok, warn, text] = updateLine(upd);
                  return (
                    <>
                      <div className="row">
                        <Dot ok={ok} warn={warn} />
                        <span className="grow">{text}</span>
                        {upd?.state === "ready" ? (
                          <button
                            className="btn small primary"
                            onClick={async () => {
                              try {
                                await api.installUpdate();
                                toast(
                                  upd.download && upd.viaLauncher
                                    ? "Videoxx closes, the launcher installs the update and opens it again."
                                    : upd.download
                                      ? "The download opened in your browser. Open it and drag the app into Applications."
                                      : "Restarting to install the update…",
                                );
                              } catch (e) {
                                toast(e.message.replace(/^.*Error: /, ""), "bad");
                              }
                            }}
                          >
                            <Download size={14} />
                            {upd.download ? (upd.viaLauncher ? "Install now" : "Download") : "Restart now"}
                          </button>
                        ) : (
                          upd?.state !== "off" && (
                            <button
                              className="btn small"
                              disabled={updChecking || upd?.state === "checking" || upd?.state === "downloading"}
                              onClick={checkUpdates}
                            >
                              {updChecking ? <Spinner size={14} /> : <RefreshCw size={14} />}
                              {updChecking ? "Checking…" : "Check now"}
                            </button>
                          )
                        )}
                      </div>
                      {upd?.state === "ready" && upd.notes && (
                        <pre className="log-box" style={{ maxHeight: 160, whiteSpace: "pre-wrap" }}>
                          {upd.notes}
                        </pre>
                      )}
                      <div className="opt">
                        <span>
                          Get beta versions<small>Try new features before everyone else. Betas are tested but may have rough edges.</small>
                        </span>
                        <Toggle label="Get beta versions" on={!!cfg.updates?.beta} onChange={(v) => save({ updates: { beta: v } })} />
                      </div>
                      <span className="small">
                        {"You have Videoxx "}
                        {info?.version}
                      </span>
                    </>
                  );
                })()}
              </div>
            </div>
          </section>
          <section className="panel" style={{ marginTop: 25 }} aria-label="Workspace">
            <div className="settings-row" data-setting="scale">
              <div className="l">
                <h3>Interface scale</h3>
                <p>
                  {"Makes text and controls bigger or smaller. Shortcuts: "}
                  {MOD}
                  {" + and "}
                  {MOD}
                  {" - anywhere in the app, "}
                  {MOD}
                  {" 0 to reset."}
                </p>
              </div>
              <div className="r">
                <select
                  className="input compact"
                  style={{ width: 120 }}
                  aria-label="Interface scale"
                  value={zoom}
                  onChange={(e) => api.zoom(+e.target.value).then(setZoom)}
                >
                  {[0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map((v) => (
                    <option key={v} value={v}>
                      {Math.round(v * 100)}%{v === 1 ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-row" data-setting="preview-quality">
              <div className="l">
                <h3>Preview quality</h3>
                <p>
                  How big the editor's live preview is drawn. On a slow computer, Half or Quarter plays the video in real time while you
                  edit; Auto starts at Full and drops while playing when frames come too slowly. Exports, saved frames and Claude's frames
                  always stay full size. Also in the editor, next to the playback speed.
                </p>
              </div>
              <div className="r">
                <select
                  className="input compact"
                  style={{ width: 160 }}
                  aria-label="Preview quality"
                  value={cfg.ui?.previewQuality ?? "full"}
                  onChange={async (e) => {
                    setCfg(await setPreviewQuality(e.target.value));
                    toast("Saved.");
                  }}
                >
                  {PQ_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                      {o.value === "full" ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-row" data-setting="graphics-panel">
              <div className="l">
                <h3>Graphics (each video)</h3>
                <p>
                  Render scale, shadows, ambient occlusion, depth of field, bloom, anti-aliasing, tone mapping, colour grade and export
                  quality, with a live frame-rate readout. They are saved with each video: open a video in the editor and press Graphics,
                  next to its look, at the top.
                </p>
              </div>
              <div className="r" />
            </div>
            <div className="settings-row" data-setting="workspace">
              <div className="l">
                <h3>Workspace</h3>
                <p>suite.db, global STYLE.md and every project folder live here.</p>
              </div>
              <div className="r">
                <div className="row">
                  <span className="path grow">{info?.workspace}</span>
                  <button className="btn small" onClick={() => api.open(info.workspace)}>
                    <FolderOpen size={14} />
                    Open
                  </button>
                </div>
                <pre className="log-box" style={{ maxHeight: "none" }}>
                  {info?.structure}
                </pre>
                <span className="small">
                  {"Videoxx "}
                  {info?.version}
                  {" · "}
                  {{ darwin: "macOS", win32: "Windows", linux: "Linux" }[info?.platform] ?? info?.platform}
                  {" · "}
                  <button className="text-btn" onClick={() => api.open(info.log)}>
                    Open log
                  </button>
                  {" · "}
                  <button
                    className="text-btn"
                    onClick={async () => {
                      await api.copy(await api.diagnostics());
                      toast("Diagnostics copied: paste them into a support message.");
                    }}
                  >
                    Copy diagnostics
                  </button>
                </span>
              </div>
            </div>
          </section>
        </>,
      )}
    </div>
  );
}
