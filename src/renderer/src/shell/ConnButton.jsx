import { useApp } from "../state/AppProvider";

export function ConnButton() {
  const { claude, openSettings, signingIn } = useApp();
  const ok = claude?.loggedIn;
  return (
    <button className="conn" onClick={() => openSettings("claude-account")} title="Claude connection">
      <span className={`dot ${signingIn ? "busy" : ok ? "ok" : claude ? "bad" : ""}`} />
      <span className="grow ellipsis">
        {ok ? "Claude connected" : signingIn ? "Signing in…" : claude ? "Claude not signed in" : "Checking Claude…"}
        <small className="dim">
          {ok
            ? `${claude.method === "claude.ai" ? "Claude subscription" : claude.method} · v${claude.version ?? "?"}`
            : "Open settings to connect"}
        </small>
      </span>
    </button>
  );
}
