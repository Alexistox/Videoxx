import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtTime } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { Modal } from "../components/ui";
import { MusicSection } from "../settings/project/ProjectSettingsPanel";
import { LAYERS_EVENT, REDO, UNDO, announce } from "../state/layerHistory";
import { stopSound } from "./soundPlayer";
import { LibraryBrowser } from "./LibraryBrowser";
import { LayersTab } from "./LayersTab";

function AutoTab({ projectId, onMixed }) {
  const { toast } = useApp();
  const [mode, setMode] = useState(null);
  useEffect(() => {
    api
      .layers(projectId)
      .then((v) => setMode(v.effects))
      .catch(() => {});
  }, [projectId]);
  const pick = async (m) => {
    try {
      const r = await api.setSfxMode(projectId, m);
      setMode(r.effects);
      toast(
        r.needsSound
          ? 'Saved. Press Redo on "Sound design mixed" to hear the change.'
          : "Saved. It is used when the sound design runs (Pipeline: Sound design mixed).",
      );
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  return (
    <div className="snd-auto">
      <div className="pjs-music">
        <div className="pjs-music-head">
          <b>Which effects the sound design may use</b>
          <small>
            The automatic sound design (Pipeline: Sound design mixed) puts effects on the picture's events. Layers you place yourself always
            play.
          </small>
        </div>
        <div className="pjs-music-row seg" role="radiogroup" aria-label="Effects for the automatic sound design">
          {[
            ["auto", "Recordings + the style's own"],
            ["library", "Only my library"],
            ["off", "No effects"],
          ].map(([m, l]) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={"btn sm" + (mode === m ? " on" : " ghost")}
              onClick={() => pick(m)}
            >
              {l}
            </button>
          ))}
        </div>
        <small className="muted">
          {mode === "library"
            ? "Only sounds from your own library (Library tab): nothing built-in, nothing generated."
            : mode === "off"
              ? "No automatic effects: the voice, music and the layers you place."
              : "Real recordings (yours first, then the built-in ones), and the style's generated sounds where no recording fits."}
        </small>
      </div>
      <MusicSection projectId={projectId} effects music={false} onMixed={onMixed} />
    </div>
  );
}
export function SoundDialog({ projectId, onClose, onMixed, tab: tab0 = "layers", at = 0, snaps = [] }) {
  const { toast } = useApp();
  const [tab, setTab] = useState(tab0),
    [lane, setLane] = useState("effects"),
    [lanes, setLanes] = useState([]);
  useEffect(() => {
    api
      .layers(projectId)
      .then((v) => setLanes(v.layers.lanes))
      .catch(() => {});
    const h = (e) => {
      if (e.detail?.projectId === projectId) setLanes(e.detail.view.layers.lanes);
    };
    window.addEventListener(LAYERS_EVENT, h);
    return () => window.removeEventListener(LAYERS_EVENT, h);
  }, [projectId]);
  const add = async (e) => {
    const r = await api.addLayer(projectId, { libId: e.id, lane, start: at, anchorWord: true });
    if (r) {
      announce(projectId, r);
      if (r.report) onMixed?.();
      toast(
        `Added “${e.name || e.id}” on ${lanes.find((l) => l.id === lane)?.name ?? lane} at ${fmtTime(at, 2)}${r.report ? ": play the preview to hear it." : "."}`,
      );
    }
  };
  return (
    <Modal
      title={"Music & effects"}
      onClose={() => {
        stopSound();
        onClose();
      }}
      className="pjs-modal snd-modal"
    >
      <div className="modal-body">
        <div className="tabs sm snd-tabs" role="tablist" aria-label={"Music & effects"}>
          {[
            ["layers", "Layers"],
            ["library", "Library"],
            ["auto", "Auto sound design"],
          ].map(([id, l]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {l}
            </button>
          ))}
        </div>
        {tab === "layers" && (
          <LayersTab projectId={projectId} at={at} snaps={snaps} onMixed={onMixed} onLibrary={() => setTab("library")} />
        )}
        {tab === "library" && (
          <>
            <div className="snd-bar">
              <span>Add to</span>
              <select className="input compact" aria-label="Lane to add to" value={lane} onChange={(e) => setLane(e.target.value)}>
                {lanes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <span className="muted">
                {"at "}
                {fmtTime(at, 2)}
                {" (the playhead)"}
              </span>
            </div>
            <LibraryBrowser onAdd={add} />
          </>
        )}
        {tab === "auto" && <AutoTab projectId={projectId} onMixed={onMixed} />}
        <p className="pjs-foot">
          {"In Layers: "}
          {UNDO}
          {" undoes a change, "}
          {REDO}
          {" redoes it."}
        </p>
      </div>
    </Modal>
  );
}
