import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useApp } from "../../state/AppProvider";

export const PROJECT_MODEL_EVENT = "cz-project-model";
export function MusicSection({ projectId, effects, music = true, onMixed }) {
  const { toast } = useApp();
  const [m, setM] = useState(null),
    [busy, setBusy] = useState(false),
    [gain, setGain] = useState(-10),
    [duck, setDuck] = useState(8),
    [fx, setFx] = useState(0),
    [fxOn, setFxOn] = useState(true);
  useEffect(() => {
    api
      .projectMusic(projectId)
      .then((v) => {
        setM(v);
        setGain(v.gain);
        setDuck(v.duck);
        setFx(v.sfxGain ?? 0);
      })
      .catch(() => {});
    if (effects)
      api
        .projectOverrides(projectId)
        .then((o) => setFxOn(o.effective.sfx))
        .catch(() => {});
  }, [projectId]);
  const done = (r) => {
    if (!r) return;
    setM(r);
    setGain(r.gain);
    setDuck(r.duck);
    setFx(r.sfxGain ?? 0);
    if (typeof r.sfx === "boolean") setFxOn(r.sfx);
    if (r.report) onMixed?.();
    toast(
      r.needsSound
        ? 'Saved. Press Redo on "Sound design mixed" to hear the change.'
        : r.report
          ? "Mixed again: play the preview to hear it."
          : "Saved. It is mixed in when the sound design runs (Pipeline: Sound design mixed).",
    );
  };
  const act = async (fn) => {
    setBusy(true);
    try {
      done(await fn());
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  if (!m) return null;
  const pct = (v, lo, hi) => `${Math.round(((v - lo) / (hi - lo)) * 100)}%`;
  return (
    <>
      {effects && (
        <div className="pjs-music">
          <div className="pjs-music-head">
            <b>Sound effects</b>
            <small>
              Effects the sound design puts on the picture's events (whooshes, hits, typing ...): recordings, yours first. A change is mixed
              in within seconds.
            </small>
          </div>
          <div className="pjs-music-row seg">
            <button
              className={"btn sm" + (fxOn ? " on" : " ghost")}
              disabled={busy}
              onClick={() => act(() => api.setProjectSfx(projectId, true))}
            >
              On
            </button>
            <button
              className={"btn sm" + (!fxOn ? " on" : " ghost")}
              disabled={busy}
              onClick={() => act(() => api.setProjectSfx(projectId, false))}
            >
              Off
            </button>
          </div>
          <label className="pjs-music-slider">
            <span>Effects level</span>
            <input
              type="range"
              min={-12}
              max={6}
              step={1}
              value={fx}
              disabled={busy || !fxOn}
              onChange={(e) => setFx(+e.target.value)}
              onPointerUp={() => fx !== m.sfxGain && act(() => api.setProjectMusic(projectId, { sfxGain: fx }))}
              onKeyUp={() => fx !== m.sfxGain && act(() => api.setProjectMusic(projectId, { sfxGain: fx }))}
            />
            <em>{fx > 0 ? `+${fx} dB` : fx ? `${fx} dB` : "normal"}</em>
          </label>
        </div>
      )}
      {music && (
        <div className="pjs-music">
          <div className="pjs-music-head">
            <b>Your own music</b>
            <small>
              Your own track under the whole video (the first music layer): looped or cut to the video, faded in and out, ducked while
              someone speaks.
            </small>
          </div>
          <div className="pjs-music-row">
            <span className="pjs-music-name">{m.file ? m.name : "No music of your own yet"}</span>
            <button className="btn sm" disabled={busy} onClick={() => act(() => api.pickProjectMusic(projectId))}>
              {m.file ? "Replace..." : "Add your own music..."}
            </button>
            {m.file && (
              <button className="btn sm ghost" disabled={busy} onClick={() => act(() => api.setProjectMusic(projectId, { remove: true }))}>
                Remove
              </button>
            )}
          </div>
          {m.file && (
            <>
              <div className="pjs-music-row seg">
                <button
                  className={"btn sm" + (m.use === "mine" ? " on" : " ghost")}
                  disabled={busy}
                  onClick={() => act(() => api.setProjectMusic(projectId, { use: "mine" }))}
                >
                  Mine
                </button>
                <button
                  className={"btn sm" + (m.use === "style" ? " on" : " ghost")}
                  disabled={busy}
                  onClick={() => act(() => api.setProjectMusic(projectId, { use: "style" }))}
                >
                  Off (the style's own sound)
                </button>
              </div>
              <label className="pjs-music-slider">
                <span>Music level</span>
                <input
                  type="range"
                  min={-40}
                  max={0}
                  step={1}
                  value={gain}
                  disabled={busy || m.use !== "mine"}
                  style={{ ["--p"]: pct(gain, -40, 0) }}
                  onChange={(e) => setGain(+e.target.value)}
                  onPointerUp={() => gain !== m.gain && act(() => api.setProjectMusic(projectId, { gain }))}
                  onKeyUp={() => gain !== m.gain && act(() => api.setProjectMusic(projectId, { gain }))}
                />
                <em>{gain <= -40 ? "off" : `${gain} dB`}</em>
              </label>
              <label className="pjs-music-slider">
                <span>Duck under the voice</span>
                <input
                  type="range"
                  min={0}
                  max={11}
                  step={1}
                  value={duck}
                  disabled={busy || m.use !== "mine"}
                  onChange={(e) => setDuck(+e.target.value)}
                  onPointerUp={() => duck !== m.duck && act(() => api.setProjectMusic(projectId, { duck }))}
                  onKeyUp={() => duck !== m.duck && act(() => api.setProjectMusic(projectId, { duck }))}
                />
                <em>{duck ? `-${duck} dB` : "no ducking"}</em>
              </label>
            </>
          )}
        </div>
      )}
    </>
  );
}
