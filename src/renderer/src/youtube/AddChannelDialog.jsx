import { useEffect, useRef, useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Modal, Spinner } from "../components/ui";
import { isEnter } from "../channels/stages";
import { useYtStatus } from "./useYtStatus";
import { LinkStep } from "./LinkStep";

export function AddChannelDialog({ onClose, onGuide, onAdded }) {
  const { toast } = useApp();
  const { status } = useYtStatus();
  const [v, setV] = useState(""),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState(null),
    [added, setAdded] = useState(null);
  const can = !!status && (status.key.hasKey || status.channels.some((c) => c.signedIn));
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);
  const add = async () => {
    if (!v.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.ytAdd(v);
      if (gone.current) {
        if (!r.existed) api.ytRemove(r.channel.id).catch(() => {});
        return;
      }
      if (r.existed) toast(`You already follow ${r.channel.title}. It is being read again.`, "info");
      setAdded(r.channel.id);
      onAdded?.(r.channel);
      api.ytSync(r.channel.id).catch((e) => toast(`${r.channel.title}: ${e.message}`, "bad"));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const yt = added ? status?.channels.find((c) => c.id === added) : null;
  return (
    <Modal title={yt ? "Following" : "Follow a YouTube channel"} onClose={onClose} className="yt-small" dirty={() => !added && !!v.trim()}>
      <div className="modal-body">
        {yt ? (
          <LinkStep yt={yt} />
        ) : (
          <>
            {status && !can && (
              <div className="hint warn">
                <KeyRoundIcon size={18} />
                <div>
                  <b>Add a Google API key first</b>
                  <p>Public stats come from YouTube with your own free API key (steps 1 to 3 of the guide).</p>
                </div>
                <button
                  className="btn small"
                  autoFocus
                  onClick={() => {
                    onClose();
                    onGuide();
                  }}
                >
                  Open the guide
                </button>
              </div>
            )}
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="yt-add">Channel</label>
              <input
                id="yt-add"
                className="input"
                autoFocus
                value={v}
                onChange={(e) => {
                  setV(e.target.value);
                  setErr(null);
                }}
                onKeyDown={(e) => {
                  if (isEnter(e)) add();
                }}
                disabled={!can && !!status}
                placeholder="@handle, youtube.com/@handle or a channel ID (UC…)"
                spellCheck={false}
              />
              {err ? (
                <span className="help warn" role="alert">
                  {err}
                </span>
              ) : (
                <span className="help">
                  Any public channel: yours or one you want to learn from. Your own channels show more when you sign in with Google.
                </span>
              )}
            </div>
          </>
        )}
        <div className="modal-actions">
          {yt ? (
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={add} disabled={!v.trim() || busy || !can}>
                {busy && <Spinner size={14} />}Follow
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
