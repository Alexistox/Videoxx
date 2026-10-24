import { useState } from "react";
import {
  CameraIcon,
  FileHeadphoneIcon,
  FilmIcon,
  MonitorPlayIcon,
  PlusIcon,
  RotateCwIcon,
  TrashIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { fmtTime } from "../lib/format";
import { useApp } from "../state/AppProvider";

const ROLES = [
  { id: "screen", label: "Screen recording" },
  { id: "facecam", label: "Facecam" },
  { id: "intro", label: "Intro" },
  { id: "other", label: "Other" },
];
const ICON = { screen: MonitorPlayIcon, facecam: CameraIcon, intro: FilmIcon, other: FileHeadphoneIcon };
const FOOTAGE = ["mp4", "mov", "mkv", "m4v", "webm", "avi", "mts", "m2ts", "mxf", "wav", "mp3", "m4a", "aac", "flac"];
const gb = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
export function FootageBin({ projectId, media, setMedia }) {
  const { toast } = useApp();
  const [adding, setAdding] = useState(false);
  const add = async (files) => {
    if (!files.length) return;
    setAdding(true);
    try {
      setMedia(await api.pAddMedia(projectId, files));
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setAdding(false);
    }
  };
  const pick = async () => {
    const f = await api.pickFiles("Add footage", [{ name: "Video and audio", extensions: FOOTAGE }]);
    if (f?.length) add(f);
  };
  const role = async (m, r) => {
    try {
      setMedia(await api.pSetRole(projectId, m.id, r));
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const remove = async (m) => {
    try {
      setMedia(await api.pRemoveMedia(projectId, m.id));
      toast(`Removed ${m.name} from this video. The file itself is untouched.`);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const order = (r) => ["intro", "screen", "facecam", "other"].indexOf(r);
  const list = media.slice().sort((a, b) => order(a.role) - order(b.role) || a.name.localeCompare(b.name));
  return (
    <div className="footage">
      <div className="sec-title">
        {"Footage "}
        <span className="dim">{media.length || ""}</span>
        <span className="grow" />
        <button className="btn tiny" onClick={pick} disabled={adding}>
          <PlusIcon size={12} />
          Add
        </button>
      </div>
      {!media.length && (
        <button className="footage-drop" onClick={pick}>
          <MonitorPlayIcon size={22} strokeWidth={1.5} />
          <b>Drop your footage here</b>
          <span>Screen recording (with your mic), facecam clips, and the intro if it's separate. The files stay where they are.</span>
        </button>
      )}
      {list.map((m) => {
        const Icon = ICON[m.role];
        return (
          <div key={m.id} className={`fm-row ${m.role}`} title={m.file}>
            <span className="fm-ic">
              <Icon size={15} strokeWidth={1.7} />
            </span>
            <span className="fm-main">
              <span className="fm-top">
                <span className="fm-name ellipsis">{m.derived ? `${m.name} (made by Claude)` : m.name}</span>
                <button
                  className="icon-btn sm fm-x"
                  aria-label={`Remove ${m.name}`}
                  title="Remove from this video (the file is not deleted)"
                  onClick={() => remove(m)}
                >
                  <TrashIcon size={13} strokeWidth={1.7} />
                </button>
              </span>
              <span className="fm-sub">
                <span className="fm-meta">
                  {fmtTime(m.duration, 0)}
                  {m.width ? ` · ${m.height}p${m.fps ? Math.round(m.fps) : ""}` : ""}
                  {" · "}
                  {gb(m.size)}
                  {m.missing && <span className="fm-bad">{" · file missing"}</span>}
                </span>
                <select
                  className="fm-role"
                  aria-label={`What ${m.name} is`}
                  value={m.role}
                  onChange={(e) => role(m, e.target.value)}
                  disabled={m.derived}
                >
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </span>
              {(m.proxyState === "working" || m.proxyState === "pending") && (
                <span
                  className="fm-prog"
                  title="The player can't open this file directly, so a preview copy is being made (the original is used for the final render)"
                >
                  <i style={{ width: `${m.progress ?? 0}%` }} />
                  <em>{m.proxyState === "pending" ? "Waiting…" : `Preview copy ${m.progress ?? 0}%`}</em>
                </span>
              )}
              {m.proxyState === "failed" && (
                <span className="fm-bad fm-err">
                  <TriangleAlertIcon size={12} />
                  {m.proxyError || "Preview copy failed"}
                  <button className="text-btn" onClick={async () => setMedia(await api.pRetryProxy(projectId, m.id))}>
                    <RotateCwIcon size={11} />
                    Retry
                  </button>
                </span>
              )}
            </span>
          </div>
        );
      })}
      {media.length > 0 && !media.some((m) => m.role === "screen") && (
        <p className="small fm-hint">
          <TriangleAlertIcon size={12} />
          {" Mark one file as the screen recording: its sound is the video's sound."}
        </p>
      )}
    </div>
  );
}
export const FOOTAGE_EXT = new RegExp(`\\.(${FOOTAGE.join("|")})$`, "i");
