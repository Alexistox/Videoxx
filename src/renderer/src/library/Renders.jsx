import { useEffect, useState } from "react";
import { FilmIcon, FolderOpenIcon, PlayIcon } from "lucide-react";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { Empty, StatusBadge } from "../components/ui";

export function Renders() {
  const { go, brand, allProjects } = useApp();
  const personal = brand === "personal",
    kindOf = new Map(allProjects.map((p) => [p.id, p.kind ?? "faceless"]));
  const [list, setList] = useState([]);
  useEffect(() => {
    api.renders().then(setList);
    const t = setInterval(() => api.renders().then(setList), 3e3);
    return () => clearInterval(t);
  }, []);
  const shown = list.filter((r) => (r.kind === "personal" || kindOf.get(r.project_id) === "personal") === personal);
  return (
    <div className="page page-enter narrow">
      <div className="page-head">
        <div>
          <h1>Renders</h1>
          <div className="sub">
            {personal
              ? "Every final render of your videos, newest first. Files live in each video's out/ folder."
              : "Every export, newest first. Files live in each project's out/ folder."}
          </div>
        </div>
      </div>
      {!shown.length ? (
        <Empty
          icon={<FilmIcon size={28} strokeWidth={1.7} />}
          title={personal ? "No renders yet" : "No exports yet"}
          text={
            personal
              ? "Open a video, watch it through and press Sign off & render. It renders on the graphics card, several times faster than realtime."
              : "Open a project and press Export. The GPU renders 1080p H.264 many times faster than realtime."
          }
        >
          <button className="btn" onClick={() => go("projects")}>
            {personal ? "Go to videos" : "Go to projects"}
          </button>
        </Empty>
      ) : (
        <section className="panel" style={{ padding: "4px 22px" }}>
          {shown.map((r) => (
            <div key={r.id} className="rule-row" style={{ alignItems: "center" }}>
              <div className="grow">
                <div className="txt ellipsis">
                  {r.path
                    ? r.path.split(/[\\/]/).pop()
                    : r.status === "running"
                      ? "Rendering…"
                      : r.status === "failed"
                        ? "Render failed"
                        : "Render"}
                </div>
                <div className="meta rd-meta">
                  {(r.kind === "vertical" || r.kind === "trailer" || r.kind === "clip") && (
                    <span className="badge blue" title="Made in Export > Vertical 9:16">
                      <i />
                      {r.kind === "trailer" ? "Trailer 9:16" : r.kind === "clip" ? "Clip 9:16" : "9:16"}
                    </span>
                  )}
                  <span>{r.project_name}</span>
                  <span>{ago(r.created_at)}</span>
                  {r.seconds && <span>{r.seconds.toFixed(1)}s</span>}
                  {r.message && (
                    <span className="ellipsis" style={{ maxWidth: 420 }}>
                      {r.message}
                    </span>
                  )}
                </div>
              </div>
              {r.status === "running" ? (
                <span className="small">{Math.round((r.progress || 0) * 100)}%</span>
              ) : (
                <StatusBadge s={r.status === "done" ? "exported" : r.status} />
              )}
              {r.exists && (
                <>
                  <button className="btn small" onClick={() => api.open(r.path)}>
                    <PlayIcon size={14} />
                    Play
                  </button>
                  <button className="icon-btn" aria-label="Show in folder" onClick={() => api.reveal(r.path)}>
                    <FolderOpenIcon size={16} strokeWidth={1.7} />
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
