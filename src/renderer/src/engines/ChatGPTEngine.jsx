import { useEffect, useState } from "react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import {
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { isMac } from "../help/keys";
import { Spinner } from "../components/ui";
import { modelGroups } from "./models";

export function useCodexState() {
  const [s, setS] = useState(null);
  useEffect(() => {
    api
      .enginesState()
      .then(setS)
      .catch(() => {});
    return on("engines:changed", setS);
  }, []);
  return s;
}
export function CodexOptgroup({ codex }) {
  const g = modelGroups(null, codex ? { ready: codex.ready } : null).find((x) => x.engine === "codex");
  if (!g) return null;
  return (
    <optgroup label={g.label}>
      {g.models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </optgroup>
  );
}
const Dot = ({ ok, warn }) => <span className={`dot ${ok ? "ok" : warn ? "warn" : "bad"}`} />;
export function ChatGPTEngine() {
  const { toast } = useApp();
  const s = useCodexState();
  const [busy, setBusy] = useState(""),
    [lines, setLines] = useState([]),
    [showInstall, setShowInstall] = useState(false);
  useEffect(() => on("engines:login-log", (l) => setLines((x) => [...x.slice(-60), l])), []);
  const act = async (what, f) => {
    setBusy(what);
    try {
      await f();
    } catch (e) {
      toast(String(e.message).replace(/^.*Error: /, ""), "bad");
    } finally {
      setBusy("");
    }
  };
  if (!s) return <Spinner size={14} />;
  const copy = async () => {
    await api.copy(s.command);
    toast(`Copied. Run it in ${s.shell}, then press Check again.`);
  };
  const status = !s.supported
    ? "Offered on Windows and macOS"
    : !s.installed
      ? "Not installed"
      : s.tooOld
        ? "Installed, but too old"
        : s.method === "chatgpt"
          ? "Signed in with ChatGPT"
          : s.method === "apikey"
            ? "Signed in with an API key (billed as API credit)"
            : s.loggedIn
              ? "Signed in"
              : "Installed, not signed in";
  const login = s.login;
  return (
    <div className="cx-engine">
      <div className="row">
        <Dot ok={s.ready} warn={s.installed && !s.ready} />
        <b style={{ fontWeight: 500 }} data-codex-status>
          {status}
        </b>
        {s.version && (
          <span className="small">
            {"Codex "}
            {s.version}
          </span>
        )}
        <span className="grow" />
        <button
          className="btn tiny ghost"
          disabled={!!busy}
          title="Look again (installed, version, sign-in)"
          onClick={() => act("refresh", () => api.enginesRefresh())}
        >
          {busy === "refresh" ? <Spinner size={12} /> : <RefreshCw size={12} />}Check again
        </button>
      </div>
      {s.error && (
        <p className="small" style={{ color: "var(--err)" }}>
          {s.error}
        </p>
      )}
      {s.supported && !s.installed && (
        <>
          <p className="small">
            {"Install Codex (OpenAI's free app; it needs Node.js) in "}
            {s.shell}:
          </p>
          <div className="row cx-cmd">
            <code className="path grow">{s.command}</code>
            <button className="btn small" onClick={copy}>
              <Copy size={14} />
              Copy
            </button>
          </div>
          <button className="text-btn small" aria-expanded={showInstall} onClick={() => setShowInstall((v) => !v)}>
            {showInstall ? "Hide" : "Or let the app install it"}
          </button>
          {showInstall && (
            <div className="row">
              <button
                className="btn small"
                disabled={!!busy || s.install.running}
                onClick={() => {
                  setLines([]);
                  act("install", () => api.codexInstall());
                }}
              >
                {s.install.running ? <Spinner size={14} /> : <Download size={14} />}Install for me
              </button>
              <span className="small dim">Runs the same command, hidden; the output shows below.</span>
            </div>
          )}
          {s.install.error && (
            <p className="small" style={{ color: "var(--err)" }}>
              {s.install.error}
            </p>
          )}
          {(s.install.running || (showInstall && lines.length > 0)) && (
            <pre className="log-box cx-log" style={{ maxHeight: 140 }}>
              {lines.slice(-30).join("\n") || "Starting npm…"}
            </pre>
          )}
        </>
      )}
      {s.installed && s.tooOld && (
        <div className="row cx-cmd">
          <code className="path grow">{s.update}</code>
          <button
            className="btn small"
            onClick={async () => {
              await api.copy(s.update);
              toast(`Copied. Run it in ${s.shell}, then press Check again.`);
            }}
          >
            <Copy size={14} />
            Copy
          </button>
        </div>
      )}
      {s.installed && !s.tooOld && (
        <div className="row cx-signin">
          {login.running ? (
            <>
              <Spinner size={14} />
              <span className="small">
                {login.mode === "device" ? "Waiting for the code to be entered…" : "Waiting for ChatGPT in your browser…"}
              </span>
              <span className="grow" />
              <button className="btn small" onClick={() => act("cancel", () => api.codexCancelLogin())}>
                <X size={14} />
                Cancel
              </button>
            </>
          ) : s.loggedIn ? (
            <>
              <span className="grow" />
              <button
                className="btn small ghost"
                onClick={() => api.external(s.usageUrl)}
                title="Your ChatGPT plan's Codex limits (5-hour and weekly), on chatgpt.com"
              >
                <ExternalLink size={14} />
                Codex usage
              </button>
              <button className="btn small" disabled={!!busy} onClick={() => act("logout", () => api.codexLogout())}>
                {busy === "logout" ? <Spinner size={14} /> : <LogOut size={14} />}Sign out
              </button>
            </>
          ) : (
            <>
              <span className="grow" />
              <button
                className="btn small primary"
                disabled={!!busy}
                onClick={() => {
                  setLines([]);
                  act("login", () => api.codexLogin());
                }}
              >
                <LogIn size={14} />
                Sign in with ChatGPT
              </button>
              <button
                className="btn small"
                disabled={!!busy}
                title="For when the browser sign-in doesn't come back: a page and a one-time code"
                onClick={() => {
                  setLines([]);
                  act("device", () => api.codexDeviceLogin());
                }}
              >
                <KeyRound size={14} />
                Use a code instead
              </button>
            </>
          )}
        </div>
      )}
      {login.url && (login.running || login.code) && (
        <div className="cx-login small">
          {login.code && (
            <p>
              {"Open the page and enter this code: "}
              <b className="cx-code" data-codex-code>
                {login.code}
              </b>
            </p>
          )}
          <button className="text-btn" onClick={() => api.codexOpenLogin().catch((e) => toast(e.message, "bad"))}>
            <ExternalLink size={12} />
            {login.code ? "Open the page" : "Open the sign-in page again"}
          </button>
        </div>
      )}
      {login.error && (
        <p className="small" style={{ color: "var(--err)" }}>
          {login.error}
        </p>
      )}
      {s.method === "apikey" && (
        <p className="small dim">To use your ChatGPT plan instead of API credit, click Sign out, then Sign in with ChatGPT.</p>
      )}
      {s.installed && s.sandbox.ok !== true && !isMac && (
        <div className="row cx-sandbox">
          <ShieldCheck size={14} />
          <span className="small grow">
            {s.sandbox.checking
              ? "Checking that Codex keeps its changes inside the project…"
              : s.sandbox.ok === false
                ? `ChatGPT is off on this computer: ${s.sandbox.error}`
                : "Codex's sandbox is checked before the first ChatGPT run."}
          </span>
          <button className="btn tiny" disabled={!!busy || s.sandbox.checking} onClick={() => act("probe", () => api.codexProbe())}>
            {busy === "probe" ? <Spinner size={12} /> : null}Check now
          </button>
        </div>
      )}
      {s.ready && (
        <p className="small dim cx-models">{`Models: GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna. Pick one in a project's Claude panel or under Model below (group "ChatGPT"). On Plus, GPT-6.1 Sol goes furthest; GPT-6 Astra is for the hardest edits.`}</p>
      )}
      <p className="small dim">
        Edits stay inside the project folder (Codex's sandbox{!isMac ? ", checked on this computer" : ""}); like Claude, it can read files
        elsewhere on this computer. Every edit can be reverted.
      </p>
    </div>
  );
}
