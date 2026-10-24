import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Spinner } from "../components/ui";

export function SignInHelp({ lines }) {
  const { toast } = useApp();
  const [code, setCode] = useState("");
  const url = lines.map((l) => l.match(/https:\/\/\S+/)?.[0]).find(Boolean);
  const send = async () => {
    const c = code.trim();
    if (!c) return;
    const ok = await api.claudeLoginCode(c).catch(() => false);
    setCode("");
    toast(ok ? "Code sent. Finishing the sign-in…" : "That sign-in already ended. Click Sign in with Claude again.", ok ? "info" : "bad");
  };
  return (
    <div className="signin-help" role="status">
      <span className="row small">
        <Spinner size={13} />A Claude sign-in page opened in your browser. Click Authorize there, then come back here.
      </span>
      {url && (
        <span className="small dim">
          {"Browser didn't open? "}
          <button className="text-btn link" onClick={() => api.external(url)}>
            Open the sign-in page
          </button>
        </span>
      )}
      <div className="row">
        <input
          className="input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Seeing a page with a code? Paste the code here"
          aria-label="Sign-in code"
        />
        <button className="btn small" onClick={send} disabled={!code.trim()}>
          Send code
        </button>
      </div>
    </div>
  );
}
