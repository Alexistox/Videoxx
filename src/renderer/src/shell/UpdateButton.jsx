import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";

export function UpdateButton() {
  const { toast } = useApp();
  const [u, setU] = useState(null);
  useEffect(() => {
    api.updateStatus().then(setU);
    return on("update:status", setU);
  }, []);
  if (u?.state !== "ready") return null;
  const manual = !!u.download && !u.viaLauncher;
  const restart = async () => {
    try {
      await api.installUpdate();
      toast(
        manual
          ? "The download opened in your browser. Open it and drag the app into Applications."
          : u.download
            ? "Videoxx closes, the launcher installs the update and opens it again."
            : "Restarting to install the update…",
      );
    } catch (e) {
      toast(e.message.replace(/^.*Error: /, ""), "bad");
    }
  };
  return (
    <button
      className="conn update"
      onClick={restart}
      title={
        u.notes
          ? `What's new in ${u.version}:
${u.notes}`
          : u.download
            ? `Version ${u.version} is out`
            : `Version ${u.version} is downloaded`
      }
    >
      <DownloadIcon size={15} strokeWidth={1.8} />
      {manual ? (
        <span className="grow ellipsis">
          {"Update "}
          {u.version}
          {" available"}
          <small className="dim">Download, then drag it into Applications</small>
        </span>
      ) : u.download ? (
        <span className="grow ellipsis">
          {"Update "}
          {u.version}
          {" available"}
          <small className="dim">Click to install (Videoxx restarts)</small>
        </span>
      ) : (
        <span className="grow ellipsis">
          {"Update "}
          {u.version}
          {" ready"}
          <small className="dim">Restart to install, or it installs on close</small>
        </span>
      )}
    </button>
  );
}
