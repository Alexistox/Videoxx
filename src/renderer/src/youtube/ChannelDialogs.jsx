import { useEffect, useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Modal, Spinner } from "../components/ui";
import { useYtStatus } from "./useYtStatus";

export function RemoveDialog({ yt, onClose }) {
  const { toast, refreshChannels, channels } = useApp();
  const [busy, setBusy] = useState(false),
    [lessons, setLessons] = useState(0);
  const mine = yt.linkedChannelId ? (channels.find((c) => c.id === yt.linkedChannelId) ?? null) : null;
  useEffect(() => {
    if (mine)
      api
        .ytApproved(mine.id)
        .then((l) => setLessons(l.length))
        .catch(() => {});
  }, [mine?.id]);
  const go = async () => {
    setBusy(true);
    try {
      await api.ytRemove(yt.id);
      await refreshChannels();
      toast(`Stopped following ${yt.title}.`);
      onClose();
    } catch (e) {
      toast(e.message, "bad");
      setBusy(false);
    }
  };
  return (
    <Modal title="Stop following" onClose={onClose} className="yt-small">
      <div className="modal-body">
        <p className="yt-confirm">
          {"Remove "}
          <b dir="auto">{yt.title}</b>
          {" from the app? The app forgets the numbers, videos and comments it read"}
          {yt.signedIn ? ", and the Google sign-in" : ""}. Nothing changes on YouTube.
          {yt.linkedVideos > 0 && (
            <>
              {" "}
              {yt.linkedVideos === 1 ? "One project loses its" : `${yt.linkedVideos} projects lose their`}
              {" link to "}
              {yt.linkedVideos === 1 ? "its video" : "their videos"}
              {" (the projects stay)."}
            </>
          )}
          {mine && lessons > 0 && (
            <>
              {" The "}
              {lessons === 1 ? "lesson" : `${lessons} lessons`}
              {" you kept for your channel “"}
              <span dir="auto">{mine.name}</span>” stay with it, but stop guiding its scripts until it is linked to a YouTube channel again.
            </>
          )}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" onClick={go} disabled={busy}>
            {busy && <Spinner size={14} />}Remove
          </button>
        </div>
      </div>
    </Modal>
  );
}
export function publicReader(status, ytId) {
  return status?.key.hasKey ? "key" : status?.channels.some((c) => c.signedIn && c.id !== ytId) ? "other" : null;
}
export function DisconnectDialog({ yt, onClose, onGuide }) {
  const { toast } = useApp();
  const { status } = useYtStatus();
  const [busy, setBusy] = useState(false);
  const via = publicReader(status, yt.id);
  const go = async () => {
    setBusy(true);
    try {
      await api.ytDisconnect(yt.id);
      toast(
        via
          ? `${yt.title}: public stats only now.`
          : `${yt.title}: public stats only now. Add a Google API key (Settings > YouTube) to keep them updating.`,
        via ? "ok" : "info",
      );
      onClose();
    } catch (e) {
      toast(e.message, "bad");
      setBusy(false);
    }
  };
  return (
    <Modal title="Stop using the Google sign-in" onClose={onClose} className="yt-small">
      <div className="modal-body">
        <p className="yt-confirm">
          {"Keep "}
          <b dir="auto">{yt.title}</b>
          {" with public stats only? "}
          {via === "key"
            ? "Views, likes and comments keep updating with your API key."
            : via === "other"
              ? "Views, likes and comments keep updating through the Google sign-in of your other channel."
              : null}{" "}
          Watch time, the numbers per day, how long people watch and where they come from go from the app
          {yt.signedIn ? ", and Google is told to forget the sign-in" : ""}. Signing in with Google again brings them back.
        </p>
        {status && !via && (
          <div className="hint warn yt-nokey">
            <KeyRoundIcon size={18} />
            <div>
              <b>Its numbers would stop updating</b>
              <p>
                Public stats are read with a Google API key, and none is saved. Without one, the numbers stay as they are now. A key takes a
                few minutes (steps 1 to 3 of the guide).
              </p>
            </div>
            <button
              className="btn small"
              onClick={() => {
                onClose();
                onGuide();
              }}
            >
              Add an API key
            </button>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" onClick={go} disabled={busy || !status} autoFocus>
            {busy && <Spinner size={14} />}Public stats only
          </button>
        </div>
      </div>
    </Modal>
  );
}
export function ForgetDialog({ what, onClose }) {
  const { toast } = useApp();
  const { status } = useYtStatus();
  const [busy, setBusy] = useState(false);
  const builtin = !!status?.client.hasBuiltin;
  const go = async () => {
    setBusy(true);
    try {
      if (what === "key") await api.ytSetKey(null);
      else await api.ytSetClient(null);
      toast(
        what === "key"
          ? "The Google API key is removed from this computer."
          : builtin
            ? "Your sign-in app is removed: new sign-ins use the one built into the app."
            : "Your sign-in app is removed from this computer.",
      );
      onClose();
    } catch (e) {
      toast(e.message, "bad");
      setBusy(false);
    }
  };
  const signedIn = status?.channels.filter((c) => c.signedIn).length ?? 0;
  return (
    <Modal title={what === "key" ? "Remove the Google API key" : "Remove your Google sign-in app"} onClose={onClose} className="yt-small">
      <div className="modal-body">
        <p className="yt-confirm">
          {what === "key" ? (
            <>
              The app forgets the key. Channels you follow without a Google sign-in stop updating until you add a key again
              {signedIn ? " (or read them through a channel you signed in with)" : ""}
              {"; their numbers stay. To switch the key off for good, delete it in Google Cloud > Credentials too."}
            </>
          ) : (
            <>
              The app forgets your Desktop client ({status?.client.id ?? "its ID and secret"}
              {"). "}
              {signedIn === 1
                ? "The channel you signed in with it stays signed in. "
                : signedIn
                  ? `The ${signedIn} channels you signed in with it stay signed in. `
                  : ""}
              {builtin
                ? "New sign-ins use the sign-in built into the app."
                : "New sign-ins need a sign-in app again (steps 4 and 5 of the guide)."}
            </>
          )}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn danger" onClick={go} disabled={busy} autoFocus>
            {busy && <Spinner size={14} />}Remove
          </button>
        </div>
      </div>
    </Modal>
  );
}
