import { useEffect, useState } from "react";
import { LightbulbIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";

export function ChannelLessons({ channelId, personal }) {
  const { channels } = useApp();
  const [l, setL] = useState([]),
    [all, setAll] = useState(false);
  const ch = channels.find((c) => c.id === channelId);
  useEffect(() => {
    setAll(false);
    if (!ch) {
      setL([]);
      return;
    }
    api
      .ytApproved(ch.id)
      .then(setL)
      .catch(() => setL([]));
  }, [ch?.id]);
  if (!ch || !l.length) return null;
  const shown = all ? l : l.slice(0, 3);
  return (
    <div className="yt-np-lessons" aria-label={`What works on ${ch.name}`}>
      <b>
        <LightbulbIcon size={13} strokeWidth={1.9} />
        {"What works on "}
        {ch.name}
      </b>
      <ul>
        {shown.map((t, i) => (
          <li key={i} dir="auto">
            {t}
          </li>
        ))}
      </ul>
      <small>
        Lessons kept on its YouTube page
        {personal ? ": worth keeping in mind for this video." : ". Claude follows them when it writes the script."}
        {l.length > 3 && !all && (
          <>
            {" "}
            <button type="button" className="text-btn link" onClick={() => setAll(true)}>
              {"Show all "}
              {l.length}
            </button>
          </>
        )}
      </small>
    </div>
  );
}
