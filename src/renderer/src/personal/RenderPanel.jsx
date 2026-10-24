import { useEffect, useState } from "react";
import { CircleCheckIcon, FilmIcon, FolderOpenIcon, PlayIcon, TriangleAlertIcon } from "lucide-react";
import { api, on } from "../lib/api";
import { fmtTime } from "../lib/format";
import { Modal } from "../components/ui";
import { renderAssets } from "./canvasDraw";

export function RenderPanel({ projectId, duration, clips, layout, bg, onClose }) {
  const [presets, setPresets] = useState([]);
  const [preset, setPreset] = useState("yt1080");
  const [enc, setEnc] = useState(null);
  const [prog, setProg] = useState(null);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.pRenderPresets().then(setPresets);
    api
      .pEncoder()
      .then(setEnc)
      .catch(() => {});
  }, []);
  useEffect(
    () =>
      on("personal:job", (e) => {
        if (e.projectId === projectId && e.kind === "render") setProg({ phase: e.phase, progress: e.progress, speed: e.speed });
      }),
    [projectId],
  );
  const start = async () => {
    const p = presets.find((x) => x.id === preset);
    if (!p) return;
    setErr(null);
    setDone(null);
    setProg({ phase: "Preparing", progress: 0 });
    try {
      const H = p.height,
        W = Math.round((H * 16) / 9 / 2) * 2;
      setDone(await api.pRender(projectId, renderAssets(layout, bg, W, H), p.id));
    } catch (e) {
      setErr(String(e.message).replace(/^.*Error: /, ""));
    } finally {
      setProg(null);
    }
  };
  const busy = !!prog,
    mb = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);
  return (
    <Modal title={done ? "Your video is ready" : "Sign off and render"} onClose={() => !busy && onClose()}>
      <div className="modal-body render-panel">
        {!done && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {"Rendering signs off this cut: "}
              {clips}
              {" clip"}
              {clips === 1 ? "" : "s"}
              {", "}
              {fmtTime(duration, 1)}. The original footage is used at full quality; the preview copies are not.
            </p>
            <div className="rp-presets" role="radiogroup" aria-label="Render preset">
              {presets.map((p) => (
                <label key={p.id} className={`rp-preset ${preset === p.id ? "on" : ""}`}>
                  <input type="radio" name="rp" checked={preset === p.id} onChange={() => setPreset(p.id)} disabled={busy} />
                  {p.label}
                </label>
              ))}
            </div>
            {enc && (
              <p className="small">
                {enc.gpu ? `Encodes on the GPU (${enc.name}).` : "No GPU encoder found: encodes on the CPU (slower)."}
                {" Constant quality with a high cap: small files, no blocky frames."}
              </p>
            )}
          </>
        )}
        {prog && (
          <div className="rp-progress">
            <div className="progress">
              <i style={{ width: `${Math.round(prog.progress * 100)}%` }} />
            </div>
            <span className="small">
              {prog.phase}
              {"… "}
              {Math.round(prog.progress * 100)}%{prog.speed ? ` · ${prog.speed.toFixed(1)}× realtime` : ""}
            </span>
          </div>
        )}
        {err && (
          <p className="rp-err">
            <TriangleAlertIcon size={14} />
            {err}
          </p>
        )}
        {done && (
          <div className="rp-done">
            <CircleCheckIcon size={22} strokeWidth={1.7} />
            <div>
              <b className="path">{done.path.split(/[\\/]/).pop()}</b>
              <span className="small">
                {fmtTime(done.duration, 1)}
                {" · "}
                {mb(done.size)}
                {" · "}
                {done.preset}
                {" · rendered in "}
                {Math.round(done.seconds)}
                {" s ("}
                {done.realtime.toFixed(1)}
                {"× realtime, "}
                {done.encoder})
              </span>
            </div>
          </div>
        )}
        <div className="modal-actions">
          {done ? (
            <>
              <button className="btn" onClick={() => api.reveal(done.path)}>
                <FolderOpenIcon size={15} />
                Show in folder
              </button>
              <button className="btn" onClick={() => api.open(done.path)}>
                <PlayIcon size={15} />
                Play
              </button>
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </>
          ) : busy ? (
            <button className="btn" onClick={() => api.pCancelRender(projectId)}>
              Cancel
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                Not yet
              </button>
              <button className="btn primary" onClick={start} disabled={!presets.length}>
                <FilmIcon size={15} />
                {"Sign off & render"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
