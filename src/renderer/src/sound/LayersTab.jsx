import { useEffect, useRef, useState } from "react";
import { AnchorIcon, PlusIcon, Redo2Icon, RepeatIcon, TrashIcon, Undo2Icon } from "lucide-react";
import { api } from "../lib/api";
import { fmtTime } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { MusicSection } from "../settings/project/ProjectSettingsPanel";
import { LAYERS_EVENT, REDO, UNDO, announce, canStep, clone, commitLayers, dB, laneColor, stepLayers } from "../state/layerHistory";

const waves = new Map();
function ClipWave({ projectId, clip, color }) {
  const cv = useRef(null),
    [w, setW] = useState(waves.get(clip.file));
  useEffect(() => {
    if (!waves.has(clip.file))
      api
        .layerWave(projectId, clip.id)
        .then((v) => {
          waves.set(clip.file, v);
          setW(v);
        })
        .catch(() => {});
  }, [clip.file]);
  useEffect(() => {
    const c = cv.current;
    if (!c || !w?.peaks?.length) return;
    const W = c.clientWidth || 100,
      Hh = c.clientHeight || 20;
    c.width = W;
    c.height = Hh;
    const g = c.getContext("2d");
    g.clearRect(0, 0, W, Hh);
    g.fillStyle = color + "aa";
    const len = clip.len ?? Math.max(0.02, clip.srcDur - clip.in),
      dur = clip.srcDur || 1;
    for (let x = 0; x < W; x++) {
      let t = clip.in + (x / W) * len;
      if (clip.loop) t = clip.in + ((t - clip.in) % Math.max(0.02, dur - clip.in));
      const v = (w.peaks[Math.floor(t * w.perSecond)] ?? 0) / 255,
        h = Math.max(0.5, (v * Hh) / 2);
      g.fillRect(x, Hh / 2 - h, 1, h * 2);
    }
  }, [w, clip.in, clip.len, clip.loop, clip.srcDur, color]);
  return <canvas ref={cv} className="snd-wave" />;
}
export function LayersTab({ projectId, at, snaps, onMixed, onLibrary }) {
  const { toast } = useApp();
  const [v, setV] = useState(null),
    [sel, setSel] = useState(null),
    [busy, setBusy] = useState(false),
    [, tick] = useState(0);
  useEffect(() => {
    api
      .layers(projectId)
      .then(setV)
      .catch((e) => toast(e.message, "bad"));
    const h = (e) => {
      if (e.detail?.projectId === projectId) {
        setV(e.detail.view);
        tick((n) => n + 1);
      }
    };
    window.addEventListener(LAYERS_EVENT, h);
    return () => window.removeEventListener(LAYERS_EVENT, h);
  }, [projectId]);
  const after = (r) => {
    if (r?.report) onMixed?.();
    else if (r && !r.canMix) toast("Saved. Layers are mixed in once the voiceover is cleaned (Clean and time).");
  };
  const change = async (fn) => {
    if (!v) return;
    const next = clone(v.layers);
    fn(next);
    setV({ ...v, layers: next });
    setBusy(true);
    try {
      after(await commitLayers(projectId, v.layers, next));
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const step = async (redo) => {
    if (!v) return;
    setBusy(true);
    try {
      after(await stepLayers(projectId, v.layers, redo));
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const k = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.target?.tagName === "INPUT") return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        step(e.shiftKey);
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        step(true);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  if (!v) return <div className="muted">Loading…</div>;
  const end = Math.max(1, v.end || Math.max(1, ...v.layers.clips.map((c) => c.start + (c.len ?? c.srcDur))));
  const words = v.words,
    clip = v.layers.clips.find((c) => c.id === sel) ?? null;
  const addFile = async (lane) => {
    setBusy(true);
    try {
      const r = await api.addLayer(projectId, { lane, start: at, anchorWord: true });
      if (r) {
        announce(projectId, r);
        setSel(r.clip.id);
        after(r);
      }
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const snapTo = (t, px) => {
    let best = t,
      bd = 8 / px;
    for (const s of [...snaps, ...words.map((w) => w.s)]) {
      const d = Math.abs(s - t);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  };
  const nearWord = (t) => {
    let bi = -1,
      bd = 0.12;
    words.forEach((w, i) => {
      const d = Math.abs(w.s - t);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return bi;
  };
  const startOf = (c) => (c.anchor && words[c.anchor.word] ? Math.max(0, words[c.anchor.word].s + c.anchor.offset) : c.start);
  const lenOf = (c) => c.len ?? (c.loop ? Math.max(0.02, end - startOf(c)) : Math.max(0.02, c.srcDur - c.in));
  const drag = (e, c, strip) => {
    e.preventDefault();
    setSel(c.id);
    const r = strip.getBoundingClientRect(),
      px = r.width / end,
      a = e.clientX,
      s0 = startOf(c),
      el = e.currentTarget;
    let t = s0,
      moved = false;
    const mv = (ev) => {
      moved = moved || Math.abs(ev.clientX - a) > 3;
      if (!moved) return;
      t = Math.max(0, snapTo(s0 + (ev.clientX - a) / px, px));
      el.style.left = `${(t / end) * 100}%`;
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      if (moved && Math.abs(t - s0) > 1e-3)
        change((L) => {
          const x = L.clips.find((k) => k.id === c.id),
            wi = nearWord(t);
          x.start = +t.toFixed(3);
          x.anchor = wi >= 0 ? { word: wi, text: words[wi].w, offset: +(t - words[wi].s).toFixed(3) } : null;
        });
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  const setClip = (patch) =>
    clip &&
    change((L) => {
      Object.assign(
        L.clips.find((k) => k.id === clip.id),
        patch,
      );
    });
  const setLane = (id, patch) =>
    change((L) => {
      Object.assign(
        L.lanes.find((l) => l.id === id),
        patch,
      );
    });
  const N = ({ label, value, onSet, min, max, step: step22 = 0.1, unit, aria }) => (
    <label className="snd-num">
      <span>{label}</span>
      <input
        key={`${clip?.id}-${label}-${value}`}
        className="input compact"
        type="number"
        aria-label={aria ?? label}
        min={min}
        max={max}
        step={step22}
        defaultValue={value ?? ""}
        placeholder={value == null ? "full" : void 0}
        onBlur={(e) => {
          const raw = e.target.value.trim(),
            n = raw === "" ? null : Math.max(min, Math.min(max, +raw));
          if (raw !== "" && !isFinite(+raw)) return;
          if (n !== value) onSet(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
      />
      {unit && <em>{unit}</em>}
    </label>
  );
  return (
    <div className="snd-layers">
      <MusicSection projectId={projectId} onMixed={onMixed} />
      <div className="snd-bar">
        <button
          className="icon-btn sm"
          aria-label="Undo"
          title={`Undo (${UNDO})`}
          disabled={busy || !canStep(projectId, false)}
          onClick={() => step(false)}
        >
          <Undo2Icon size={15} />
        </button>
        <button
          className="icon-btn sm"
          aria-label="Redo"
          title={`Redo (${REDO})`}
          disabled={busy || !canStep(projectId, true)}
          onClick={() => step(true)}
        >
          <Redo2Icon size={15} />
        </button>
        <span className="snd-at">
          {"Playhead "}
          {fmtTime(at, 2)}
        </span>
        <span className="grow" />
        {busy && <span className="muted snd-mixing">Mixing…</span>}
        <button className="btn sm ghost" onClick={onLibrary}>
          From the library…
        </button>
        <button
          className="btn sm ghost"
          disabled={busy}
          onClick={() =>
            change((L) => {
              const n = L.lanes.filter((l) => l.kind === "free").length + 1;
              L.lanes.push({ id: `lane${Date.now().toString(36)}`, name: `Layer ${n}`, kind: "free", gain: 0, mute: false, solo: false });
            })
          }
        >
          <PlusIcon size={13} />
          New lane
        </button>
      </div>
      <p className="sfxl-hint">
        Sounds you place yourself, on top of the voice and the automatic sound design. Drag a clip to move it (it snaps to words, shots and
        cues; dropped on a word it stays with that word when pauses are trimmed). Changes are mixed in within seconds: play the preview to
        hear them.
      </p>
      <div className="snd-lanes">
        {v.layers.lanes.map((l) => {
          const clips = v.layers.clips.filter((c) => c.lane === l.id),
            col = laneColor(l.kind);
          return (
            <div key={l.id} className="snd-lane" data-lane={l.id}>
              <div className="snd-lane-head">
                <span className="snd-dot" style={{ background: col }} />
                <b>{l.name}</b>
                <button
                  className={"snd-ms" + (l.mute ? " on" : "")}
                  aria-pressed={l.mute}
                  aria-label={`Mute ${l.name}`}
                  title="Mute"
                  disabled={busy}
                  onClick={() => setLane(l.id, { mute: !l.mute })}
                >
                  M
                </button>
                <button
                  className={"snd-ms solo" + (l.solo ? " on" : "")}
                  aria-pressed={l.solo}
                  aria-label={`Solo ${l.name}`}
                  title="Solo: only the solo lanes play"
                  disabled={busy}
                  onClick={() => setLane(l.id, { solo: !l.solo })}
                >
                  S
                </button>
                <input
                  key={`${l.id}-${l.gain}`}
                  type="range"
                  min={-40}
                  max={12}
                  step={1}
                  defaultValue={l.gain}
                  aria-label={`${l.name} volume`}
                  title={`Lane volume ${dB(l.gain)}`}
                  disabled={busy}
                  onPointerUp={(e) => {
                    const n = +e.target.value;
                    if (n !== l.gain) setLane(l.id, { gain: n });
                  }}
                  onKeyUp={(e) => {
                    const n = +e.target.value;
                    if (n !== l.gain) setLane(l.id, { gain: n });
                  }}
                />
                <em className="snd-db">{dB(l.gain)}</em>
                <button className="btn sm ghost" disabled={busy} onClick={() => addFile(l.id)}>
                  <PlusIcon size={13} />
                  Add audio layer…
                </button>
                {l.kind === "free" && !clips.length && (
                  <button
                    className="icon-btn sm"
                    aria-label={`Remove the lane ${l.name}`}
                    onClick={() =>
                      change((L) => {
                        L.lanes = L.lanes.filter((x) => x.id !== l.id);
                      })
                    }
                  >
                    <TrashIcon size={13} />
                  </button>
                )}
              </div>
              <div
                className="snd-strip"
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) setSel(null);
                }}
              >
                {words.length > 0 && (
                  <div className="snd-words">
                    {words
                      .filter((_, i) => i % Math.max(1, Math.round(words.length / 60)) === 0)
                      .map((w, i) => (
                        <i key={i} style={{ left: `${(w.s / end) * 100}%` }} />
                      ))}
                  </div>
                )}
                {clips.map((c) => {
                  const s = startOf(c),
                    len = lenOf(c);
                  return (
                    <div
                      key={c.id}
                      className={"snd-clip" + (sel === c.id ? " sel" : "")}
                      data-clip={c.id}
                      style={{
                        left: `${(s / end) * 100}%`,
                        width: `${Math.max(0.6, (Math.min(len, end - s) / end) * 100)}%`,
                        borderColor: col,
                      }}
                      title={`${c.name} · ${fmtTime(s, 2)} · ${len.toFixed(2)} s${c.anchor ? ` · on “${c.anchor.text}”` : ""}`}
                      onPointerDown={(e) => drag(e, c, e.currentTarget.parentElement)}
                    >
                      <ClipWave projectId={projectId} clip={c} color={col} />
                      <span>
                        {c.anchor && <AnchorIcon size={10} />}
                        {c.loop && <RepeatIcon size={10} />}
                        {c.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {clip && (
        <div className="snd-clip-edit" aria-label="Selected audio layer">
          <div className="snd-clip-title">
            <b>{clip.name}</b>
            <small>
              {clip.srcDur.toFixed(2)}
              {" s file"}
              {clip.lufs != null ? `, ${clip.lufs.toFixed(0)} LUFS (levelled to the voice)` : ""}
            </small>
            <span className="grow" />
            <select className="input compact" aria-label="Lane" value={clip.lane} onChange={(e) => setClip({ lane: e.target.value })}>
              {v.layers.lanes.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button
              className="btn sm danger"
              onClick={() => {
                const id = clip.id;
                setSel(null);
                change((L) => {
                  L.clips = L.clips.filter((k) => k.id !== id);
                });
              }}
            >
              <TrashIcon size={13} />
              Remove
            </button>
          </div>
          <div className="snd-grid">
            {N({
              label: "Start",
              value: +startOf(clip).toFixed(3),
              min: 0,
              max: 36e3,
              step: 0.01,
              unit: "s",
              onSet: (n) => setClip({ start: n ?? 0, anchor: null }),
            })}
            {N({
              label: "Trim start",
              value: clip.in,
              min: 0,
              max: Math.max(0, clip.srcDur - 0.02),
              step: 0.01,
              unit: "s",
              onSet: (n) => setClip({ in: n ?? 0 }),
            })}
            {N({
              label: "Length",
              value: clip.len,
              min: 0.02,
              max: 36e3,
              step: 0.01,
              unit: "s",
              aria: "Length (empty: the whole sound, or to the end when looped)",
              onSet: (n) => setClip({ len: n }),
            })}
            {N({ label: "Fade in", value: clip.fadeIn, min: 0, max: 30, step: 0.05, unit: "s", onSet: (n) => setClip({ fadeIn: n ?? 0 }) })}
            {N({
              label: "Fade out",
              value: clip.fadeOut,
              min: 0,
              max: 30,
              step: 0.05,
              unit: "s",
              onSet: (n) => setClip({ fadeOut: n ?? 0 }),
            })}
            {N({ label: "Volume", value: clip.gain, min: -60, max: 12, step: 0.5, unit: "dB", onSet: (n) => setClip({ gain: n ?? 0 }) })}
            {N({ label: "Pan", value: clip.pan, min: -1, max: 1, step: 0.1, unit: "L-1 … R+1", onSet: (n) => setClip({ pan: n ?? 0 }) })}
            {N({
              label: "Duck under voice",
              value: clip.duck,
              min: 0,
              max: 11,
              step: 1,
              unit: "dB",
              onSet: (n) => setClip({ duck: n ?? 0 }),
            })}
          </div>
          <div className="snd-row">
            <label className="snd-check">
              <input type="checkbox" checked={clip.loop} onChange={(e) => setClip({ loop: e.target.checked })} />
              Loop to fill{clip.len == null ? " (to the end of the video)" : " (the length above)"}
            </label>
            {(() => {
              const wi = nearWord(startOf(clip)),
                anchored = !!clip.anchor;
              return anchored ? (
                <button className="btn sm on" onClick={() => setClip({ start: +startOf(clip).toFixed(3), anchor: null })}>
                  <AnchorIcon size={13} />
                  On “{clip.anchor.text}” · unpin
                </button>
              ) : wi >= 0 ? (
                <button
                  className="btn sm ghost"
                  onClick={() => setClip({ anchor: { word: wi, text: words[wi].w, offset: +(startOf(clip) - words[wi].s).toFixed(3) } })}
                >
                  <AnchorIcon size={13} />
                  Anchor to the word “{words[wi].w}”
                </button>
              ) : (
                <small className="muted">Move it onto a word to anchor it there.</small>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
