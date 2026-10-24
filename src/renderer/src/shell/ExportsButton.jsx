import { useEffect, useRef, useState } from "react";
import { FilmIcon } from "lucide-react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { requestExportDialog } from "../state/exportRequest";

export function ExportsButton() {
  const { allProjects, go, toast } = useApp();
  const [jobs, setJobs] = useState({});
  const names = useRef(allProjects);
  names.current = allProjects;
  useEffect(() => {
    const nameOf = (id) => names.current.find((p) => p.id === id)?.name ?? "your video";
    const offP = on("render:progress", (p) => setJobs((j) => ({ ...j, [p.projectId]: p.pct ?? (p.frames ? p.frame / p.frames : 0) })));
    const offD = on("render:done", (d) => {
      setJobs((j) => {
        const n = { ...j };
        delete n[d.projectId];
        return n;
      });
      if (d.cancelled || [...document.querySelectorAll(".ex-modal")].some((m) => m.dataset.project === d.projectId)) return;
      if (d.error)
        toast(`Export of “${nameOf(d.projectId)}” failed: ${d.error}`, "bad", { label: "Open", run: () => go("editor", d.projectId) });
      else
        toast(
          `Export of “${nameOf(d.projectId)}” is done.`,
          "ok",
          d.result?.path ? { label: "Show in folder", run: () => api.reveal(d.result.path) } : void 0,
        );
    });
    return () => {
      offP();
      offD();
    };
  }, []);
  const ids = Object.keys(jobs);
  if (!ids.length) return null;
  const name = allProjects.find((p) => p.id === ids[0])?.name ?? "";
  return (
    <button
      className="conn update ex-chip"
      onClick={() => {
        requestExportDialog(ids[0]);
        go("editor", ids[0]);
      }}
      title="Exports keep going while you work. Click to see its progress."
    >
      <FilmIcon size={15} strokeWidth={1.8} />
      <span className="grow ellipsis">
        {"Exporting "}
        {Math.round(Math.min(1, jobs[ids[0]]) * 100)}%<small className="dim">{ids.length > 1 ? `${ids.length} videos` : name}</small>
      </span>
    </button>
  );
}
