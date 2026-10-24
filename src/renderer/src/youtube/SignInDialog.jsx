import { useEffect, useRef, useState } from "react";
import { ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Modal, Spinner } from "../components/ui";
import { useYtStatus } from "./useYtStatus";
import { LinkStep } from "./LinkStep";

export function SignInDialog({ onClose, onGuide, onAdded }) {
  const { toast } = useApp();
  const { status } = useYtStatus();
  const [phase, setPhase] = useState("waiting"),
    [err, setErr] = useState(null);
  const [got, setGot] = useState(null),
    [n, setN] = useState(0);
  const live = useRef(true),
    waiting = useRef(false);
  useEffect(() => {
    live.current = true;
    waiting.current = true;
    setPhase("waiting");
    setErr(null);
    api
      .ytSignIn()
      .then((r) => {
        waiting.current = false;
        if (!live.current) return;
        setGot({ ids: r.channels.map((c) => c.id), analytics: r.analytics });
        setPhase("done");
        onAdded?.(r.channels.map((c) => c.id));
        for (const c of r.channels) api.ytSync(c.id).catch((e) => toast(`${c.title}: ${e.message}`, "bad"));
      })
      .catch((e) => {
        waiting.current = false;
        if (!live.current) return;
        if (/cancelled/i.test(e.message) && !/Google/.test(e.message)) {
          onClose();
          return;
        }
        setErr(e.message);
        setPhase("failed");
      });
    return () => {
      live.current = false;
    };
  }, [n]);
  useEffect(
    () => () => {
      if (waiting.current) api.ytCancelSignIn().catch(() => {});
    },
    [],
  );
  const close = () => {
    if (phase === "waiting") {
      api.ytCancelSignIn().catch(() => {});
      toast("The Google sign-in was stopped: nothing was connected. If Google's page is still open in your browser, close it.", "info");
    }
    onClose();
  };
  const chans = (got?.ids ?? []).map((id) => status?.channels.find((c) => c.id === id)).filter(Boolean);
  return (
    <Modal title="Sign in with Google" onClose={close} className="yt-small" stay={() => phase === "waiting"}>
      <div className="modal-body">
        {phase === "waiting" && (
          <div className="yt-wait">
            <Spinner size={22} kind="orbit" />
            <div>
              <b>Waiting for Google…</b>
              <p>
                Your browser opened Google's sign-in. Pick the account that owns the channel, allow both permissions, then come back here.
              </p>
            </div>
          </div>
        )}
        {phase === "failed" && (
          <div className="hint bad" role="alert">
            <TriangleAlertIcon size={18} />
            <div>
              <b>Not connected</b>
              <p>{err}</p>
            </div>
          </div>
        )}
        {phase === "done" && (
          <>
            {!got?.analytics && (
              <div className="hint warn">
                <TriangleAlertIcon size={18} />
                <div>
                  <b>Analytics not allowed</b>
                  <p>Only public numbers show for now. Sign in again and tick both boxes to see watch time and how long people watch.</p>
                </div>
              </div>
            )}
            {chans.map((c) => (
              <LinkStep key={c.id} yt={c} />
            ))}
            <p className="help yt-which">
              Not the channel you wanted? Google signs in one channel at a time: pick it in Google's list. Channels you only manage through
              YouTube Studio permissions can't be read — sign in with the Google account that owns them.
            </p>
          </>
        )}
        <div className="modal-actions">
          {phase === "waiting" && (
            <>
              <button className="btn" onClick={() => api.ytReopenSignIn().catch(() => {})}>
                <ExternalLinkIcon size={14} />
                Open the page again
              </button>
              <span className="grow" />
              <button className="btn" onClick={close}>
                Cancel
              </button>
            </>
          )}
          {phase === "failed" && (
            <>
              {/client ID|Set up your Google app/.test(err ?? "") && (
                <button
                  className="btn"
                  onClick={() => {
                    onClose();
                    onGuide();
                  }}
                >
                  Open the guide
                </button>
              )}
              <span className="grow" />
              <button className="btn" onClick={onClose}>
                Close
              </button>
              <button className="btn primary" onClick={() => setN((x) => x + 1)}>
                Try again
              </button>
            </>
          )}
          {phase === "done" && (
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
