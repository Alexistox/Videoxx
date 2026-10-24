import { useEffect, useRef, useState } from "react";
import { api, on } from "../../lib/api";
import { fmtTime, secs } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import {
  Copy,
  Download,
  FolderOpen,
  ListOrdered,
  MonitorPlay,
  Play,
  Smartphone,
  TriangleAlert,
} from "../../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Modal, Spinner } from "../../components/ui";
import { slugOf } from "../../lib/fold";
import { exportsLeft, isStandard, premiumMsg, usePlan } from "../../state/usePlan";
import { ExportQualityPick, getExportQuality } from "../../../../../editor/panels/GraphicsPanel";
import { VerticalTab } from "./VerticalTab";
import { youtubeChapters } from "./youtubeChapters";

export function ExportPanel({ projectId, status, range, shots, initialTab, onClose }) {
  const { toast } = useApp();
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const [chapters, setChapters] = useState(null);
  const [name, setName] = useState(
    () => (/[^\x00-\x7f]/.test(status.title) && slugOf(status.title)) || status.project.slug.replace(/[^\w-]/g, "_"),
  );
  const [prog, setProg] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [onlyRange, setOnlyRange] = useState(false);
  const [uhd, setUhd] = useState(false);
  const recon = (status.styleBase || status.style) === "recon";
  const plan = usePlan(),
    std = isStandard(plan),
    left = exportsLeft(plan);
  const [captions, setCaptions] = useState(true);
  const [gif, setGif] = useState(false);
  const [tab, setTabState] = useState(() => {
    if (initialTab) return initialTab;
    try {
      return localStorage.getItem("cz-export-tab") === "vertical" ? "vertical" : "video";
    } catch {
      return "video";
    }
  });
  const setTab = (t) => {
    setTabState(t);
    try {
      localStorage.setItem("cz-export-tab", t);
    } catch {}
  };
  useEffect(() => {
    requestAnimationFrame(() => {
      const m = document.querySelector(".ex-modal");
      if (m && !m.contains(document.activeElement)) m.querySelector('.ex-tabs [aria-selected="true"]')?.focus();
    });
  }, [tab]);
  const [vbusy, setVbusy] = useState(false);
  useEffect(
    () =>
      on("render:progress", (p) => {
        if (p.projectId === projectId && tab === "video") setProg(p);
      }),
    [projectId, tab],
  );
  useEffect(() => {
    let off = () => {},
      live = true;
    api
      .exportRunning(projectId)
      .then((r) => {
        if (!r || !live) return;
        if (r.kind !== "video") {
          setTabState("vertical");
          return;
        }
        setTabState("video");
        setBusy(true);
        setProg(r.prog);
        off = on("render:done", (d) => {
          if (d.projectId !== projectId) return;
          off();
          setBusy(false);
          setProg(null);
          if (d.cancelled) toast("Export cancelled. Partial files removed.");
          else if (d.error) setError(d.error);
          else setRes(d.result);
        });
      })
      .catch(() => {});
    return () => {
      live = false;
      off();
    };
  }, [projectId]);
  const started = useRef(false);
  const go = async () => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    setError(null);
    setRes(null);
    setProg(null);
    const part = onlyRange && range;
    try {
      const r = await api.exportVideo(projectId, {
        uhd: uhd && !std,
        captions,
        ...(recon ? { quality: getExportQuality(projectId) } : {}),
        gif: !!part && gif,
        ...(part
          ? { name: `${name}_${range[0].toFixed(1)}-${range[1].toFixed(1)}s`.replace(/\./g, "_"), from: range[0], to: range[1] }
          : { name }),
      });
      if (r.cancelled) toast("Export cancelled. Partial files removed.");
      else {
        setRes(r);
        if (alive.current) toast(`Exported ${r.path.split(/[\\/]/).pop()}`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setProg(null);
      started.current = false;
    }
  };
  const tall = (status.aspect ?? 16 / 9) < 1,
    pixel = status.hardPixels ?? (status.style === "pixel-art" || !status.style);
  const size = tall ? "1080×1920" : "1920×1080",
    gifW = status.gifWidth ?? (pixel ? 960 : 540);
  const tabs = (
    <div className="tabs sm ex-tabs" role="tablist" aria-label="What to export">
      <button
        role="tab"
        aria-selected={tab === "video"}
        className={tab === "video" ? "active" : ""}
        disabled={busy || vbusy}
        onClick={() => setTab("video")}
      >
        <MonitorPlay size={14} />
        Video
      </button>
      <button
        role="tab"
        aria-selected={tab === "vertical"}
        className={tab === "vertical" ? "active" : ""}
        disabled={busy || vbusy}
        onClick={() => setTab("vertical")}
      >
        <Smartphone size={14} />
        Vertical 9:16
      </button>
    </div>
  );
  return (
    <Modal
      title="Export video"
      head={tabs}
      onClose={onClose}
      wide={tab === "vertical"}
      className={`ex-modal ex-${tab}`}
      dialogProps={{ "data-project": projectId }}
    >
      {tab === "vertical" ? (
        <div className="modal-body">
          <VerticalTab
            projectId={projectId}
            shots={shots}
            sel={range}
            name={name}
            busy={vbusy}
            setBusy={setVbusy}
            onClose={onClose}
            head={
              <div className="field ex-name">
                <label htmlFor="ex-name">File name</label>
                <input
                  id="ex-name"
                  className="input"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={vbusy}
                />
              </div>
            }
          />
        </div>
      ) : (
        <div className="modal-body">
          <div className="field">
            <label htmlFor="ex-name">File name</label>
            <input id="ex-name" className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            <span className="help">
              {size}
              {", 30 fps, H.264 (GPU) with "}
              {status.steps.find((s) => s.id === "sound")?.done
                ? "the mixed soundtrack (final_mix.wav)"
                : "the clean voiceover (no sound design yet)"}
              . Saved to out/.
            </span>
          </div>
          {range && (
            <label className="check" style={{ marginBottom: 18 }}>
              <input type="checkbox" checked={onlyRange} disabled={busy} onChange={(e) => setOnlyRange(e.target.checked)} />
              Only the selected range ({fmtTime(range[0])}–{fmtTime(range[1])})
            </label>
          )}
          {range && onlyRange && (
            <label className="check" style={{ marginTop: -8, marginBottom: 18 }}>
              <input type="checkbox" checked={gif} disabled={busy || range[1] - range[0] > 30} onChange={(e) => setGif(e.target.checked)} />
              <span>
                {"Also make a GIF "}
                <span className="dim">{range[1] - range[0] > 30 ? "(30 s or shorter)" : `(for sharing; ${gifW} wide, 15 fps)`}</span>
              </span>
            </label>
          )}
          {recon && <ExportQualityPick projectId={projectId} disabled={busy} />}
          <label className="check" style={{ marginBottom: 10 }} title={std ? premiumMsg("4K export") : void 0}>
            <input type="checkbox" checked={uhd && !std} disabled={busy || std} onChange={(e) => setUhd(e.target.checked)} />
            <span>
              {"Also make a 4K version "}
              {std && <span className="premium-pill">Premium</span>}{" "}
              <span className="muted">
                (
                {pixel
                  ? "pixel-perfect upscale; YouTube streams 4K at a much higher bitrate, so pixels stay crisp"
                  : `sharp upscale to ${tall ? "2160×3840" : "3840×2160"}; YouTube streams 4K at a much higher bitrate, so grain and text stay clean`}
                )
              </span>
            </span>
          </label>
          <label className="check" style={{ marginBottom: 18 }}>
            <input
              type="checkbox"
              checked={captions}
              disabled={busy || (onlyRange && !!range)}
              onChange={(e) => setCaptions(e.target.checked)}
            />
            <span>Save captions (.srt) next to the video</span>
          </label>
          {std && left != null && !(onlyRange && range) && (
            <div className={`note ${left === 0 ? "bad" : ""}`} style={{ marginBottom: 14 }}>
              {left === 0
                ? `You've used this month's ${plan.exportsLimit} exports on Standard. They reset on the 1st; Premium has unlimited exports.`
                : `Standard plan: ${left} of ${plan.exportsLimit} video exports left this month.`}
            </div>
          )}
          {busy && (
            <div>
              <div className="progress">
                <i style={{ width: `${prog ? (prog.frame / prog.frames) * 100 : 2}%` }} />
              </div>
              <small>
                {prog?.phase
                  ? `${prog.phase}…`
                  : prog
                    ? `${prog.frame} / ${prog.frames} frames · ${Math.round(prog.fps)} fps${prog.fps > 0 ? ` · about ${secs(((prog.frames - prog.frame) / prog.fps) * 1e3)} left` : ""}`
                    : "Starting the renderer…"}
              </small>
              <small className="dim ex-bg-note">
                You can close this window: the export keeps going (its progress shows in the sidebar) and the app tells you when it's done.
              </small>
            </div>
          )}
          {res && (
            <div className="note">
              <b style={{ fontWeight: 500 }}>
                {"Done in "}
                {res.seconds.toFixed(1)}s
              </b>
              {" ("}
              {res.realtime}× realtime){!res.audio && " · no audio track found"}
              {res.path.endsWith("_4k.mp4") && " · 4K + 1080p saved"}
              {res.srt && " · captions saved"}
              {res.gif && " · GIF saved"}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn small" onClick={() => api.open(res.path)}>
                  <Play size={14} />
                  Play
                </button>
                <button className="btn small" onClick={() => api.reveal(res.path)}>
                  <FolderOpen size={14} />
                  Show in folder
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="hint bad">
              <TriangleAlert size={18} />
              <div>
                <b>Export failed</b>
                <p>{error}</p>
              </div>
            </div>
          )}
          {chapters !== null && (
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="ex-ch">YouTube chapters</label>
              <textarea
                id="ex-ch"
                className="input"
                rows={Math.min(10, chapters.split("\n").length + 1)}
                value={chapters}
                onChange={(e) => setChapters(e.target.value)}
                style={{ fontFamily: "var(--mono, monospace)", fontSize: 12 }}
              />
              <span className="help">
                {chapters.split("\n").filter(Boolean).length < 3
                  ? "YouTube shows chapters only with at least 3 of them, each 10 s or longer. "
                  : ""}
                Edit the titles, then paste into the video description.
              </span>
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className="btn small"
                  onClick={async () => {
                    await api.copy(chapters);
                    toast("Chapters copied.");
                  }}
                >
                  <Copy size={14} />
                  Copy
                </button>
              </div>
            </div>
          )}
          <div className="modal-actions">
            {!busy && shots.length > 0 && (
              <button
                className="btn"
                style={{ marginRight: "auto" }}
                onClick={() => setChapters((c) => (c === null ? youtubeChapters(shots).join("\n") : null))}
              >
                <ListOrdered size={15} />
                YouTube chapters
              </button>
            )}
            {busy && (
              <button className="btn ex-cancel" onClick={() => api.cancelExport(projectId)}>
                Cancel export
              </button>
            )}
            <button className="btn ex-close" onClick={onClose}>
              {busy ? "Close, keep exporting" : "Close"}
            </button>
            <button
              className="btn primary"
              onClick={go}
              disabled={busy || !name.trim() || (std && left === 0 && !(onlyRange && range))}
              title={!name.trim() ? "Type a file name first" : void 0}
            >
              {busy ? <Spinner size={14} /> : <Download size={15} />}Export
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
