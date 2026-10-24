import { useEffect, useState } from "react";
import { ArrowLeftRightIcon, LogInIcon, PowerIcon, RotateCcwIcon, TrashIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Spinner } from "../components/ui";
import { modelGroups, proxyModelName } from "./models";

export const RiskBadge = () => (
  <span
    className="own-risk own-risk-red"
    title="Not supported: Google can block the account for using its sign-in through third-party tools."
  >
    <TriangleAlertIcon size={11} strokeWidth={2.2} />
    Use at your own risk
  </span>
);
export function useGoogleState() {
  const [s, setS] = useState(null);
  useEffect(() => {
    api
      .experimentalState()
      .then(setS)
      .catch(() => {});
    return on("experimental:state", setS);
  }, []);
  return s;
}
export function GoogleOptgroup({ google }) {
  const g = modelGroups(google ? { enabled: google.enabled, signedIn: google.accounts.length > 0, models: google.models } : null).find(
    (x) => x.engine === "google",
  );
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
const STATUS = {
  off: "Off",
  downloading: "Downloading CLIProxyAPI…",
  starting: "Starting…",
  running: "Running",
  stopped: "Stopped",
  failed: "Stopped with a problem",
};
export function ExperimentalGoogle() {
  const { toast } = useApp();
  const s = useGoogleState();
  const [ack, setAck] = useState(false),
    [busy, setBusy] = useState(""),
    [lines, setLines] = useState([]),
    [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => on("experimental:login-log", (l) => setLines((x) => [...x.slice(-5), l])), []);
  const act = async (what, f) => {
    setBusy(what);
    try {
      await f();
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy("");
    }
  };
  if (!s) return <Spinner size={14} />;
  const signedIn = s.accounts.length > 0;
  const remove = !confirmRemove ? (
    <button className="btn small" disabled={!!busy} onClick={() => setConfirmRemove(true)}>
      <TrashIcon size={14} />
      Remove
    </button>
  ) : (
    <>
      <span className="small">Delete the program and the Google sign-in from this computer?</span>
      <button
        className="btn small danger"
        onClick={() => {
          setConfirmRemove(false);
          act("remove", () => api.experimentalRemove());
        }}
      >
        Remove
      </button>
      <button className="btn small" onClick={() => setConfirmRemove(false)}>
        Keep
      </button>
    </>
  );
  return (
    <div className="xp-google">
      {!s.enabled && (
        <div className="xp-risk" role="note" aria-label="Risks of Google models via CLIProxyAPI">
          <p className="xp-risk-head">
            <TriangleAlertIcon size={16} strokeWidth={2.2} />
            <b>This can get your Google account blocked.</b>
          </p>
          <p>
            {
              "In February 2026 Google blocked many paid Google AI accounts, Ultra included, for using their Antigravity or Gemini CLI sign-in through third-party tools - this feature does exactly that. Most got access back after a form, with a warning that a "
            }
            <b>second time is a permanent ban</b>
            {". Google gave "}
            <b>no refunds</b>.
          </p>
          <ul>
            <li>
              {"Use a "}
              <b>separate Google account</b>, not the one with your YouTube channel or Gmail.
            </li>
            <li>It can stop working any day, without notice. Videoxx does not support it and can't help if Google blocks you.</li>
            <li>
              <b>Gemini 4 Argon needs Google AI Ultra.</b>
              {" On AI Pro you get Gemini 3.8 Flash, plus Claude Sonnet/Opus 5.5 on Google's quota."}
            </li>
            <li>
              {"Google reports about "}
              <b>200 requests a day</b>
              {" on Ultra. A full build can use 100 or more, so expect to hit the limit."}
            </li>
            <li>
              <b>One Google account only.</b>
              {" Never sign in several accounts to stretch the quota - Google treats that as abuse."}
            </li>
            <li>It runs a small open-source program (CLIProxyAPI, MIT licence) on your computer, reachable only from this computer.</li>
          </ul>
          <label className="xp-ack">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand the risks and use a separate
            Google account
          </label>
          <div className="row">
            <button
              className="btn small primary"
              disabled={!ack || !!busy || !s.supported}
              onClick={() => act("on", () => api.experimentalEnable(true))}
            >
              {busy === "on" ? <Spinner size={14} /> : <PowerIcon size={14} />}Turn on
            </button>
            {!s.supported && <span className="small dim">Offered on Windows (64-bit) and macOS only.</span>}
          </div>
        </div>
      )}
      {s.enabled && (
        <>
          <div className="row xp-status">
            <span
              className={`dot ${s.status === "running" ? "ok" : s.status === "failed" ? "bad" : s.status === "stopped" ? "warn" : "busy"}`}
            />
            <b style={{ fontWeight: 500 }}>
              {STATUS[s.status]}
              {s.status === "running" && s.port ? ` on port ${s.port}` : ""}
            </b>
            <span className="small dim">
              {"CLIProxyAPI "}
              {s.version}
            </span>
          </div>
          <p className="small xp-reminder">
            <TriangleAlertIcon size={12} strokeWidth={2.2} />
            At your own risk: Google can block the account. Use a separate Google account, not the one with your YouTube channel or Gmail.
          </p>
          {s.error && (
            <p className="small xp-error" style={{ color: "var(--err)" }}>
              {s.error}
            </p>
          )}
          {(s.status === "failed" || s.status === "stopped") && (
            <div className="row">
              <button className="btn small primary" disabled={!!busy} onClick={() => act("retry", () => api.experimentalRetry())}>
                {busy === "retry" ? <Spinner size={14} /> : <RotateCcwIcon size={14} />}Try again
              </button>
            </div>
          )}
          <div className="row xp-accounts">
            {signedIn ? (
              <span className="small">
                {"Signed in: "}
                <b>{s.accounts.join(", ")}</b>
              </span>
            ) : (
              <span className="small dim">No Google account signed in yet.</span>
            )}
            <span className="grow" />
            {s.login.running ? (
              <>
                <Spinner size={14} />
                <span className="small">Waiting for Google in your browser…</span>
                <button className="btn small" onClick={() => act("cancel", () => api.experimentalCancelLogin())}>
                  <XIcon size={14} />
                  Cancel
                </button>
              </>
            ) : signedIn ? (
              <button
                className="btn small"
                disabled={!!busy || !["running", "stopped", "failed"].includes(s.status)}
                title="Signs this Google account out of CLIProxyAPI, then opens Google's sign-in for another one (one account at a time)"
                onClick={() => {
                  setLines([]);
                  act("switch", () => api.experimentalSwitch());
                }}
              >
                {busy === "switch" ? <Spinner size={14} /> : <ArrowLeftRightIcon size={14} />}Switch account
              </button>
            ) : (
              <button
                className="btn small primary"
                disabled={!!busy || !["running", "stopped"].includes(s.status)}
                title={["running", "stopped"].includes(s.status) ? void 0 : "Wait until CLIProxyAPI is running"}
                onClick={() => {
                  setLines([]);
                  act("login", () => api.experimentalLogin());
                }}
              >
                <LogInIcon size={14} />
                Sign in with Google
              </button>
            )}
          </div>
          {s.login.error && (
            <p className="small" style={{ color: "var(--err)" }}>
              {s.login.error}
            </p>
          )}
          {s.login.running && lines.length > 0 && (
            <div className="xp-log small dim">
              {lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
          {signedIn && (
            <p className="small dim xp-models">
              {s.models.length ? (
                <>
                  {"Models: "}
                  {s.models.map((m) => proxyModelName(m.id, m.name)).join(", ")}
                  {`. Pick one in a project's Claude panel or under Settings > AI engines > Model (group "Experimental (Google)").`}
                </>
              ) : (
                "No models listed yet: they show up a moment after the sign-in."
              )}
            </p>
          )}
          <div className="row">
            <button
              className="btn small"
              disabled={!!busy}
              onClick={() => act("off", () => api.experimentalDisable())}
              title="Stops the program; the program and your sign-in stay for next time"
            >
              {busy === "off" ? <Spinner size={14} /> : <PowerIcon size={14} />}Turn off
            </button>
            {remove}
          </div>
        </>
      )}
      {!s.enabled && (s.installed || signedIn) && (
        <div className="row wrap">
          <span className="small dim">
            {"Off. "}
            {signedIn ? "The program and your Google sign-in stay" : "The program stays"}
            {" on this computer for next time."}
          </span>
          {remove}
        </div>
      )}
    </div>
  );
}
