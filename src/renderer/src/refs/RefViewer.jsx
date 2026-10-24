import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  Link2Icon,
  Maximize2Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  ScanIcon,
  SparklesIcon,
  TriangleAlertIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { MOD, isMac } from "../help/keys";
import { Modal, Spinner } from "../components/ui";
import { cacheUrl, fmtSpan, fmtT, mentionOf, parseTime, refMeta, shortPath } from "./mentions";
import { putRef, refThumb, useRefThumb, useRefs } from "./useRefs";
import { KindIcon, OPEN_REF_EVENT, lastField, newRangeId } from "./MentionField";

export function RefViewerHost() {
  const [o, setO] = useState(null);
  useEffect(() => {
    const f = (e) => setO({ ...e.detail, n: Date.now() });
    window.addEventListener(OPEN_REF_EVENT, f);
    return () => window.removeEventListener(OPEN_REF_EVENT, f);
  }, []);
  if (!o) return null;
  return createPortal(<RefViewer key={o.n} {...o} onClose={() => setO(null)} />, document.body);
}
const COLORS = ["#84a9d8", "#89bea4", "#d7b461", "#b496db", "#db9393", "#7fc8c8"];
const isField = (t) => !!t?.matches?.('input, textarea, select, [contenteditable="true"]');
function RefViewer({ projectId, refId, range, rangeId, onInsert, onClose }) {
  const { refs } = useRefs(projectId),
    { toast } = useApp();
  const r = refs?.find((x) => x.id === refId) ?? null;
  const insert = onInsert ?? lastField.insert ?? void 0;
  const title = r ? `@${r.tag} · ${r.label || r.name}` : "Reference";
  return (
    <Modal title={title} wide onClose={onClose} className="rf-viewer" focusField={false}>
      <div className="modal-body">
        {refs === null ? (
          <div className="rf-loading">
            <Spinner />
            Loading…
          </div>
        ) : !r ? (
          <p className="muted">This reference was removed.</p>
        ) : !r.exists ? (
          <Missing projectId={projectId} r={r} />
        ) : r.kind === "video" || r.kind === "audio" ? (
          <TimeViewer projectId={projectId} r={r} initRange={range} initRangeId={rangeId} onInsert={insert} />
        ) : r.kind === "image" ? (
          <ImageViewer projectId={projectId} r={r} onInsert={insert} />
        ) : (
          <DocViewer r={r} onInsert={insert} />
        )}
        {r && r.exists && <Details projectId={projectId} r={r} toast={toast} />}
      </div>
    </Modal>
  );
}
function Missing({ projectId, r }) {
  const { toast } = useApp();
  const relink = async () => {
    const p = await api.pickFile(`Where is ${r.name} now?`);
    if (!p) return;
    try {
      putRef(projectId, await api.refsRelink(projectId, r.id, p));
      toast(`Relinked @${r.tag}.`);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  return (
    <div className="rf-missing">
      <TriangleAlertIcon size={22} />
      <div>
        <b>
          {r.name}
          {" is not where it was"}
        </b>
        <p>
          {"It pointed to "}
          <span className="mono" title={r.path}>
            {shortPath(r.path, 70)}
          </span>
          . Moved, renamed, or on a drive that is not connected? Point to where it is now: the tag, label and ranges stay.
        </p>
        <button className="btn small primary" onClick={relink}>
          <Link2Icon size={14} />
          Relink…
        </button>
      </div>
    </div>
  );
}
function Details({ projectId, r, toast }) {
  const [label, setLabel] = useState(r.label),
    [note, setNote] = useState(r.note),
    t = useRef(0),
    first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearTimeout(t.current);
    t.current = setTimeout(
      () =>
        api
          .refsUpdate(projectId, r.id, { label: label.trim(), note: note.trim() })
          .then((x) => putRef(projectId, x))
          .catch((e) => toast(e.message, "bad")),
      450,
    );
    return () => clearTimeout(t.current);
  }, [label, note]);
  return (
    <div className="rf-details">
      <label className="rf-lbl">
        <span>Label</span>
        <input className="input compact" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={r.name} aria-label="Label" />
      </label>
      <label className="rf-lbl grow">
        <span>Note for Claude</span>
        <input
          className="input compact"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note for Claude"
          placeholder={
            r.kind === "video"
              ? "e.g. Copy the camera moves and pacing, not the people"
              : r.kind === "image"
                ? "e.g. Match this colour palette and lighting"
                : "e.g. The facts in chapter 2"
          }
        />
      </label>
      <span className="rf-path-full" title={r.path}>
        {shortPath(r.path, 64)}
      </span>
    </div>
  );
}
function TimeViewer({ projectId, r, initRange, initRangeId, onInsert }) {
  const { toast } = useApp();
  const video = r.kind === "video";
  const media = useRef(null);
  const [src, setSrc] = useState(null),
    [mediaErr, setMediaErr] = useState(null);
  const [dur, setDur] = useState(r.probe?.duration ?? 0);
  const fps = r.probe?.fps && r.probe.fps > 1 ? r.probe.fps : 30;
  const [t, setT] = useState(0),
    tRef = useRef(0);
  tRef.current = t;
  const [playing, setPlaying] = useState(false),
    [rate, setRate] = useState(1),
    [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const [ranges, setRanges] = useState(() => r.ranges.map((x) => ({ ...x })));
  const match = initRange ? ranges.find((x) => Math.abs(x.start - initRange[0]) < 0.06 && Math.abs(x.end - initRange[1]) < 0.06) : null;
  const [active, setActive] = useState(() => initRangeId ?? match?.id ?? (initRange ? null : (ranges[0]?.id ?? null)));
  const [ghost, setGhost] = useState(() => (initRange && !match ? initRange : null));
  const act = ranges.find((x) => x.id === active) ?? null;
  const [view, setView] = useState([0, Math.max(1, r.probe?.duration ?? 1)]);
  useEffect(() => {
    let live = true;
    api
      .refsMedia(projectId, r.id)
      .then((x) => {
        if (live) setSrc(x.url);
      })
      .catch((e) => live && setMediaErr(e.message));
    return () => {
      live = false;
    };
  }, [r.id, r.path]);
  const start = initRange ?? (act ? [act.start, act.end] : null);
  useEffect(() => {
    if (!dur) return;
    setView(start ? fitOf(start, dur) : [0, dur]);
  }, [dur > 0]);
  const onMeta = () => {
    const m = media.current;
    if (isFinite(m.duration) && m.duration > 0 && !r.probe?.duration) setDur(m.duration);
    if (start) seek(start[0]);
  };
  const saveT = useRef(0);
  const save = (next) => {
    clearTimeout(saveT.current);
    saveT.current = setTimeout(
      () =>
        api
          .refsUpdate(projectId, r.id, {
            ranges: next.map(({ id, start: start22, end, label, note }) => ({
              id,
              start: +start22.toFixed(3),
              end: +end.toFixed(3),
              label,
              note,
            })),
          })
          .then((x) => putRef(projectId, x))
          .catch((e) => toast(e.message, "bad")),
      350,
    );
  };
  useEffect(() => () => clearTimeout(saveT.current), []);
  const setAll = (next, persist = true) => {
    setRanges(next);
    if (persist) save(next);
  };
  const patch = (id, p, persist = true) =>
    setAll(
      ranges.map((x) => (x.id === id ? clampR({ ...x, ...p }, dur) : x)),
      persist,
    );
  const addRange = (a, b) => {
    const s = a ?? tRef.current,
      e = b ?? Math.min(dur, s + Math.min(20, Math.max(1, dur - s)));
    const n = clampR({ id: newRangeId(), start: Math.min(s, Math.max(0, dur - 0.1)), end: e, label: "" }, dur);
    setAll([...ranges, n]);
    setActive(n.id);
    setGhost(null);
    return n;
  };
  const removeRange = (id) => {
    const next = ranges.filter((x) => x.id !== id);
    setAll(next);
    if (active === id) setActive(next[0]?.id ?? null);
  };
  const seek = useCallback(
    (v) => {
      const m = media.current;
      const c = Math.max(0, Math.min(dur || 0, v));
      if (m) m.currentTime = c;
      setT(c);
    },
    [dur],
  );
  const play = (p = !playing) => {
    const m = media.current;
    if (!m) return;
    if (p) {
      if (loop && act && (m.currentTime < act.start || m.currentTime >= act.end - 0.03)) m.currentTime = act.start;
      m.play().catch(() => {});
    } else m.pause();
  };
  useEffect(() => {
    if (media.current) media.current.playbackRate = rate;
  }, [rate]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const m = media.current;
      if (m) {
        let c = m.currentTime;
        const lr = act ?? (ghost ? { start: ghost[0], end: ghost[1] } : null);
        if (loop && lr && c >= lr.end) {
          m.currentTime = lr.start;
          c = lr.start;
        }
        setT(c);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, act?.start, act?.end, ghost]);
  const setIn = () => {
    const c = tRef.current;
    if (!act) {
      addRange(c);
      return;
    }
    patch(act.id, { start: Math.min(c, act.end - 0.1) });
  };
  const setOut = () => {
    const c = tRef.current;
    if (!act) {
      addRange(Math.max(0, c - 10), c);
      return;
    }
    patch(act.id, { end: Math.max(c, act.start + 0.1) });
  };
  const zoomBy = (k, around = tRef.current) =>
    setView(([a, b]) => {
      const span = Math.max(0.5, Math.min(dur, (b - a) * k));
      let n = around - (around - a) * (span / (b - a));
      n = Math.max(0, Math.min(dur - span, n));
      return [n, n + span];
    });
  const fitR = () => {
    const x = act ? [act.start, act.end] : ghost;
    if (x) setView(fitOf(x, dur));
  };
  const root = useRef(null);
  const keyRef = useRef(() => {});
  keyRef.current = (e) => {
    const bds = document.querySelectorAll(".backdrop");
    if (!root.current || !bds[bds.length - 1]?.contains(root.current) || isField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase(),
      frame = 1 / fps;
    if (k === " ") {
      e.preventDefault();
      play();
    } else if (k === "k") play(false);
    else if (k === "l") {
      if (playing) setRate((x) => Math.min(8, x * 2));
      else {
        setRate(1);
        play(true);
      }
    } else if (k === "j") {
      seek(tRef.current - 2);
    } else if (k === "arrowleft" || k === "arrowright") {
      e.preventDefault();
      seek(tRef.current + (k === "arrowleft" ? -1 : 1) * (e.shiftKey ? 1 : frame));
    } else if (k === "home") {
      e.preventDefault();
      seek(act?.start ?? 0);
    } else if (k === "end") {
      e.preventDefault();
      seek(act?.end ?? dur);
    } else if (k === "i") setIn();
    else if (k === "o") setOut();
    else if (k === "=" || k === "+") zoomBy(0.5);
    else if (k === "-") zoomBy(2);
    else return;
  };
  useEffect(() => {
    const f = (e) => keyRef.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  const durWord = dur ? fmtT(dur, 0) : "…";
  const ext = act ?? (ghost ? { id: "", start: ghost[0], end: ghost[1] } : null);
  return (
    <div ref={root} className={`rf-tv ${video ? "" : "audio"}`} data-t={t.toFixed(2)}>
      {video ? (
        <div className="rf-stage">
          {src ? (
            <video
              ref={media}
              src={src}
              preload="metadata"
              muted={muted}
              onLoadedMetadata={onMeta}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={() => play()}
              onError={() =>
                setMediaErr(
                  "This video cannot be played here (its format is not supported by the preview). Claude can still read its frames: pick the parts by typing the times.",
                )
              }
            />
          ) : (
            !mediaErr && <Spinner />
          )}
          {mediaErr && <p className="rf-stage-err">{mediaErr}</p>}
          <span className="rf-stage-time">{fmtT(t, 1)}</span>
        </div>
      ) : (
        <div className="rf-audio-stage">
          {src && (
            <audio
              ref={media}
              src={src}
              preload="metadata"
              muted={muted}
              onLoadedMetadata={onMeta}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          )}
          <AudioLinesArt />
          <span className="rf-stage-time">{fmtT(t, 1)}</span>
        </div>
      )}
      <div className="rf-transport">
        <button className="icon-btn sm" onClick={() => seek(t - 1 / fps)} aria-label="One frame back" title="One frame back (←)">
          <ChevronLeftIcon size={15} />
        </button>
        <button
          className="rf-play"
          onClick={() => play()}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
        >
          {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        </button>
        <button className="icon-btn sm" onClick={() => seek(t + 1 / fps)} aria-label="One frame on" title="One frame on (→)">
          <ChevronRightIcon size={15} />
        </button>
        <span className="rf-clock">
          <b>{fmtT(t, 1)}</b>
          {" / "}
          {durWord}
          {rate !== 1 && <em> {rate}×</em>}
        </span>
        <span className="rf-sep" />
        <button className="btn tiny rf-setin" onClick={setIn} title="Start the selected range at the playhead (I)">
          {"Set in "}
          <kbd>I</kbd>
        </button>
        <button className="btn tiny rf-setout" onClick={setOut} title="End the selected range at the playhead (O)">
          {"Set out "}
          <kbd>O</kbd>
        </button>
        <button
          className={`btn tiny rf-loop ${loop ? "on" : ""}`}
          aria-pressed={loop}
          onClick={() => setLoop(!loop)}
          title="Play the selected range over and over"
        >
          <RepeatIcon size={12} />
          Loop range
        </button>
        <span className="grow" />
        <div className="rf-zoom" role="group" aria-label="Timeline zoom">
          <button className="icon-btn sm" onClick={() => zoomBy(2)} aria-label="Zoom out" title="Zoom out (-)">
            <ZoomOutIcon size={14} />
          </button>
          <button className="icon-btn sm" onClick={() => zoomBy(0.5)} aria-label="Zoom in" title="Zoom in (=)">
            <ZoomInIcon size={14} />
          </button>
          <button className="icon-btn sm" onClick={fitR} disabled={!ext} aria-label="Zoom to the range" title="Zoom to the selected range">
            <ScanIcon size={14} />
          </button>
          <button className="icon-btn sm" onClick={() => setView([0, dur])} aria-label="Show all" title="Show the whole file">
            <Maximize2Icon size={13} />
          </button>
        </div>
        <button
          className="icon-btn sm"
          onClick={() => setMuted(!muted)}
          aria-label={muted ? "Sound on" : "Mute"}
          title={muted ? "Sound on" : "Mute"}
        >
          {muted ? <VolumeXIcon size={14} /> : <Volume2Icon size={14} />}
        </button>
      </div>
      {dur > 0 ? (
        <Track
          projectId={projectId}
          r={r}
          dur={dur}
          view={view}
          setView={setView}
          t={t}
          ranges={ranges}
          active={active}
          ghost={ghost}
          onSeek={seek}
          onSelect={(id) => {
            setActive(id);
            setGhost(null);
          }}
          onRange={(id, a, b, done) => patch(id, { start: a, end: b }, done)}
          onMake={(a, b) => addRange(a, b)}
          zoomBy={zoomBy}
        />
      ) : (
        <div className="rf-track skel" />
      )}
      <div className="rf-lower">
        <div className="rf-ranges">
          <div className="rf-sec-h">
            <b>Parts to look at</b>
            <span className="dim">
              {ranges.length
                ? `${fmtSpan(ranges.reduce((a, x) => a + x.end - x.start, 0))} of ${durWord}`
                : ghost
                  ? "Your text picks the part below"
                  : `Nothing picked: Claude looks at the first 20 s`}
            </span>
          </div>
          {ghost && (
            <div className="rf-range ghost">
              <i style={{ background: "#999" }} />
              <span className="grow">
                {"From your text: "}
                {fmtT(ghost[0])}–{fmtT(ghost[1])}
                {" · "}
                {fmtSpan(ghost[1] - ghost[0])}
              </span>
              <button className="btn tiny" onClick={() => addRange(ghost[0], ghost[1])}>
                Save as a range
              </button>
            </div>
          )}
          {ranges.map((x, i) => (
            <RangeRow
              key={x.id}
              x={x}
              i={i}
              dur={dur}
              on={x.id === active}
              tag={r.tag}
              onPick={() => {
                setActive(x.id);
                setGhost(null);
                if (x.start < view[0] || x.end > view[1]) setView(fitOf([x.start, x.end], dur));
                seek(x.start);
              }}
              onPatch={(p) => patch(x.id, p)}
              onRemove={() => removeRange(x.id)}
              onLoop={() => {
                setActive(x.id);
                setLoop(true);
                seek(x.start);
                setTimeout(() => play(true), 30);
              }}
              onInsert={onInsert ? () => onInsert(mentionOf(r.tag, x)) : void 0}
            />
          ))}
          <button className="btn tiny rf-addrange" onClick={() => addRange()}>
            <PlusIcon size={12} />
            {"Add a range at "}
            {fmtT(t)}
          </button>
        </div>
        <ExtractBox projectId={projectId} r={r} range={ext} dur={dur} />
      </div>
      <div className="rf-keys" aria-label="Keyboard shortcuts">
        <span>
          <kbd>Space</kbd>
          {" play"}
        </span>
        <span>
          <kbd>J</kbd>
          <kbd>K</kbd>
          <kbd>L</kbd>
          {" back 2 s / pause / play"}
        </span>
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd>
          {" frame"}
        </span>
        <span>
          <kbd>Shift</kbd>+<kbd>←</kbd>
          <kbd>→</kbd>
          {" 1 s"}
        </span>
        <span>
          <kbd>I</kbd>
          <kbd>O</kbd>
          {" in / out"}
        </span>
        <span>
          <kbd>{isMac ? "fn ←" : "Home"}</kbd>
          <kbd>{isMac ? "fn →" : "End"}</kbd>
          {" range start / end"}
        </span>
        <span>
          <kbd>=</kbd>
          <kbd>-</kbd>
          {" zoom"}
        </span>
        <span>
          <kbd>{MOD}</kbd>+scroll zoom
        </span>
      </div>
    </div>
  );
}
const fitOf = ([a, b], dur) => {
  const pad = Math.max((b - a) * 0.35, 0.75);
  let s = Math.max(0, a - pad),
    e = Math.min(dur, b + pad);
  if (e - s < 0.5) e = Math.min(dur, s + 0.5);
  return [s, e];
};
const clampR = (x, dur) => {
  let s = Math.max(0, Math.min(x.start, dur)),
    e = Math.max(0, Math.min(x.end, dur));
  if (e - s < 0.1) {
    if (s + 0.1 <= dur) e = s + 0.1;
    else s = e - 0.1;
  }
  return { ...x, start: s, end: e };
};
function AudioLinesArt() {
  return (
    <svg className="rf-audio-art" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: 80 }, (_, i) => {
        const h = 8 + 40 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23));
        return <rect key={i} x={i * 5} y={30 - h / 2} width={2.4} height={h} rx={1.2} />;
      })}
    </svg>
  );
}
function Track({ projectId, r, dur, view, setView, t, ranges, active, ghost, onSeek, onSelect, onRange, onMake, zoomBy }) {
  const box = useRef(null),
    [W, setW] = useState(800);
  useLayoutEffect(() => {
    const el = box.current;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 800));
    ro.observe(el);
    setW(el.clientWidth || 800);
    return () => ro.disconnect();
  }, []);
  const [v0, v1] = view,
    span = v1 - v0 || 1,
    x = (s) => ((s - v0) / span) * W,
    tAt = (px) => Math.max(0, Math.min(dur, v0 + (px / W) * span));
  const full = v0 <= 0.01 && v1 >= dur - 0.01,
    video = r.kind === "video";
  const [strip, setStrip] = useState(null);
  useEffect(() => {
    if (!video) return;
    let live = true;
    api
      .refsStrip(projectId, r.id, 32)
      .then((s) => {
        if (live) setStrip({ url: s.url, n: s.n ?? s.times.length });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [r.id, r.path]);
  const H = 58,
    aspect = r.probe?.width && r.probe?.height ? r.probe.width / r.probe.height : 16 / 9,
    tileW = Math.max(40, H * aspect),
    nT = Math.ceil(W / tileW);
  const tiles = useMemo(
    () =>
      full || !video
        ? []
        : Array.from({ length: nT }, (_, k) => {
            const step = span / nT;
            return { k, t: +Math.min(dur - 0.05, v0 + (k + 0.5) * step).toFixed(span < 30 ? 1 : 0) };
          }),
    [v0, v1, nT, full, video],
  );
  const [hov, setHov] = useState(null),
    [hovImg, setHovImg] = useState(null),
    hovT = useRef(0);
  useEffect(() => {
    clearTimeout(hovT.current);
    if (!hov || !video) return;
    const q = +(Math.round(hov.t * 2) / 2).toFixed(1);
    hovT.current = setTimeout(() => refThumb(projectId, r, Math.min(q, Math.max(0, dur - 0.05)), 240).then((u) => setHovImg(u)), 70);
    return () => clearTimeout(hovT.current);
  }, [hov && Math.round(hov.t * 2)]);
  const drag = useRef(null);
  const local = (e) => e.clientX - box.current.getBoundingClientRect().left;
  const down = (e, mode, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    box.current?.setPointerCapture?.(e.pointerId);
    const tt = tAt(local(e)),
      rg = ranges.find((q) => q.id === id);
    if (mode === "scrub" && e.shiftKey) {
      const n = onMake(tt, Math.min(dur, tt + 0.1));
      drag.current = { mode: "make", id: n.id, t0: tt, a: tt, b: tt + 0.1, moved: false };
      return;
    }
    drag.current = { mode, id, t0: tt, a: rg?.start ?? 0, b: rg?.end ?? 0, moved: false };
    if (id) onSelect(id);
    if (mode === "scrub") onSeek(tt);
  };
  const move = (e) => {
    const px = local(e),
      tt = tAt(px);
    setHov({ px, t: tt });
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    if (d.mode === "scrub") onSeek(tt);
    else if (d.mode === "in") {
      onRange(d.id, Math.min(tt, d.b - 0.1), d.b, false);
      onSeek(Math.min(tt, d.b - 0.1));
    } else if (d.mode === "out") {
      onRange(d.id, d.a, Math.max(tt, d.a + 0.1), false);
      onSeek(Math.max(tt, d.a + 0.1));
    } else if (d.mode === "move") {
      const len = d.b - d.a;
      let a = d.a + (tt - d.t0);
      a = Math.max(0, Math.min(dur - len, a));
      onRange(d.id, a, a + len, false);
    } else if (d.mode === "make") {
      const a = Math.min(d.t0, tt),
        b = Math.max(d.t0, tt);
      onRange(d.id, a, Math.max(b, a + 0.1), false);
    }
  };
  const up = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.id && d.mode !== "scrub") {
      const rg = ranges.find((q) => q.id === d.id);
      if (rg) onRange(rg.id, rg.start, rg.end, true);
    }
    if (d.mode === "move" && !d.moved) onSeek(tAt(local(e)));
  };
  const zr = useRef({ zoomBy, tAt, setView, view, dur });
  zr.current = { zoomBy, tAt, setView, view, dur };
  useEffect(() => {
    const el = box.current;
    const f = (e) => {
      const z = zr.current,
        px = e.clientX - el.getBoundingClientRect().left;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        z.zoomBy(e.deltaY > 0 ? 1.25 : 0.8, z.tAt(px));
        return;
      }
      const [a, b] = z.view;
      if (b - a >= z.dur - 0.01) return;
      e.preventDefault();
      const d = ((e.deltaX || e.deltaY) / el.clientWidth) * (b - a);
      const n = Math.max(0, Math.min(z.dur - (b - a), a + d));
      z.setView([n, n + (b - a)]);
    };
    el.addEventListener("wheel", f, { passive: false });
    return () => el.removeEventListener("wheel", f);
  }, []);
  const ov = useRef(null);
  const ovDown = (e) => {
    const el = ov.current,
      go = (cx) => {
        const tt = Math.max(0, Math.min(dur, ((cx - el.getBoundingClientRect().left) / el.clientWidth) * dur));
        onSeek(tt);
        if (!full) {
          let n0 = tt - span / 2;
          n0 = Math.max(0, Math.min(dur - span, n0));
          setView([n0, n0 + span]);
        }
      };
    el.setPointerCapture(e.pointerId);
    go(e.clientX);
    el.onpointermove = (m) => go(m.clientX);
    el.onpointerup = () => {
      el.onpointermove = null;
      el.onpointerup = null;
    };
  };
  const ticks = useMemo(() => {
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600],
      want = span / Math.max(2, Math.floor(W / 110));
    const st = steps.find((s) => s >= want) ?? 3600;
    const out = [];
    for (let s = Math.ceil(v0 / st) * st; s <= v1 + 1e-6; s += st) out.push(+s.toFixed(3));
    return { st, out };
  }, [v0, v1, W]);
  return (
    <div className="rf-timeline">
      <div ref={ov} className="rf-overview" onPointerDown={ovDown} title="The whole file: click to jump" role="presentation">
        {ranges.map((q, i) => (
          <i
            key={q.id}
            className={q.id === active ? "on" : ""}
            style={{
              left: `${(q.start / dur) * 100}%`,
              width: `max(2px, ${((q.end - q.start) / dur) * 100}%)`,
              background: COLORS[i % COLORS.length],
            }}
          />
        ))}
        {ghost && (
          <i className="ghost" style={{ left: `${(ghost[0] / dur) * 100}%`, width: `max(2px, ${((ghost[1] - ghost[0]) / dur) * 100}%)` }} />
        )}
        {!full && <b className="rf-ov-win" style={{ left: `${(v0 / dur) * 100}%`, width: `max(4px, ${(span / dur) * 100}%)` }} />}
        <em style={{ left: `${(t / dur) * 100}%` }} />
      </div>
      <div
        ref={box}
        className={`rf-track ${video ? "" : "audio"}`}
        style={{ height: H }}
        onPointerDown={(e) => down(e, "scrub")}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => !drag.current && setHov(null)}
        role="slider"
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={fmtT(t, 1)}
        tabIndex={0}
      >
        <div className="rf-track-clip">
          {video && full && strip && <img className="rf-strip" src={strip.url} alt="" draggable={false} />}
          {video && full && !strip && <div className="rf-strip-skel" />}
          {tiles.map((q) => (
            <Tile key={q.k + ":" + q.t} projectId={projectId} r={r} t={q.t} left={q.k * (W / nT)} w={W / nT} />
          ))}
          {!video && <AudioLinesArt />}
          {ghost && <div className="rf-band ghost" style={{ left: x(ghost[0]), width: Math.max(2, x(ghost[1]) - x(ghost[0])) }} />}
          {ranges.map((q, i) => {
            const L = x(q.start),
              R = x(q.end);
            if (R < -12 || L > W + 12) return null;
            const on2 = q.id === active,
              c = COLORS[i % COLORS.length];
            return (
              <div
                key={q.id}
                className={`rf-band ${on2 ? "on" : ""}`}
                data-id={q.id}
                style={{ left: L, width: Math.max(2, R - L), ["--c"]: c }}
                onPointerDown={(e) => down(e, "move", q.id)}
              >
                {R - L > 46 && <span className="rf-band-l">{q.label || `Range ${i + 1}`}</span>}
                <span
                  className="rf-handle in"
                  role="slider"
                  aria-label={`Start of ${q.label || `range ${i + 1}`}`}
                  aria-valuetext={fmtT(q.start, 1)}
                  onPointerDown={(e) => down(e, "in", q.id)}
                />
                <span
                  className="rf-handle out"
                  role="slider"
                  aria-label={`End of ${q.label || `range ${i + 1}`}`}
                  aria-valuetext={fmtT(q.end, 1)}
                  onPointerDown={(e) => down(e, "out", q.id)}
                />
              </div>
            );
          })}
        </div>
        <div className="rf-playhead" style={{ left: x(t) }} />
        {hov && (
          <div className="rf-hover" style={{ left: Math.max(0, Math.min(W, hov.px)) }}>
            {video && <span className="rf-hover-img">{hovImg ? <img src={hovImg} alt="" /> : <Spinner size={12} />}</span>}
            <b>{fmtT(hov.t, 1)}</b>
          </div>
        )}
      </div>
      <div className="rf-ruler">
        {ticks.out
          .filter((s) => x(s) > 22 && x(s) < W - 22)
          .map((s) => (
            <span key={s} style={{ left: x(s) }}>
              {fmtT(s, ticks.st < 1 ? 1 : 0)}
            </span>
          ))}
      </div>
    </div>
  );
}
function Tile({ projectId, r, t, left, w }) {
  const u = useRefThumb(projectId, r, t, 160);
  return (
    <span className="rf-tile" style={{ left, width: w + 0.5 }}>
      {u && <img src={u} alt="" draggable={false} />}
    </span>
  );
}
function TimeInput({ value, onCommit, label, max }) {
  const [d, setD] = useState(null),
    shown = d ?? fmtT(value, 1);
  const bad = d != null && (parseTime(d) == null || parseTime(d) > max + 0.01);
  const commit = () => {
    if (d == null) return;
    const v = parseTime(d);
    if (v == null || v > max + 0.01) return;
    onCommit(v);
    setD(null);
  };
  return (
    <input
      className={`input compact rf-time ${bad ? "bad" : ""}`}
      value={shown}
      aria-label={label}
      aria-invalid={bad}
      spellCheck={false}
      title={
        bad
          ? `Type a time like 1:02:00, 62 or 62.5 (the file is ${fmtT(max, 0)} long)`
          : "Type 1:02:00, 62 or 62.5; ↑ / ↓ nudge (Shift = 1 s)"
      }
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setD(e.target.value)}
      onBlur={() => {
        commit();
        setD(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          if (d != null) {
            e.stopPropagation();
            e.preventDefault();
            setD(null);
          }
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const s = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowUp" ? 1 : -1);
          onCommit(Math.max(0, Math.min(max, (parseTime(shown) ?? value) + s)));
          setD(null);
        }
      }}
    />
  );
}
function RangeRow({ x, i, dur, on: on2, tag, onPick, onPatch, onRemove, onLoop, onInsert }) {
  const [label, setLabel] = useState(x.label ?? "");
  useEffect(() => setLabel(x.label ?? ""), [x.label]);
  return (
    <div
      className={`rf-range ${on2 ? "on" : ""}`}
      data-id={x.id}
      onClick={(e) => {
        if (!isField(e.target) && !e.target.closest("button")) onPick();
      }}
    >
      <i style={{ background: COLORS[i % COLORS.length] }} />
      <input
        className="input compact rf-rlabel"
        value={label}
        placeholder={`Range ${i + 1}`}
        aria-label={`Name of range ${i + 1}`}
        onFocus={onPick}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label !== (x.label ?? "") && onPatch({ label: label.trim() })}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
        }}
      />
      <span className="rf-times">
        <TimeInput
          value={x.start}
          max={dur}
          label={`Start of range ${i + 1}`}
          onCommit={(v) => onPatch({ start: Math.min(v, x.end - 0.1) })}
        />
        <span className="dim">–</span>
        <TimeInput value={x.end} max={dur} label={`End of range ${i + 1}`} onCommit={(v) => onPatch({ end: Math.max(v, x.start + 0.1) })} />
      </span>
      <span className="rf-dur" title="How much of the file Claude reads for this range">
        {fmtSpan(x.end - x.start)}{" "}
        <span className="dim">
          {"of "}
          {fmtT(dur, 0)}
        </span>
      </span>
      <span className="rf-rbtns">
        <button className="icon-btn sm" onClick={onLoop} aria-label={`Loop range ${i + 1}`} title="Play this range in a loop">
          <RepeatIcon size={13} />
        </button>
        {onInsert && (
          <button className="btn tiny rf-rinsert" onClick={onInsert} title={`Put ${mentionOf(tag, x)} in your text`}>
            <CornerDownLeftIcon size={11} />
            Insert
          </button>
        )}
        <button className="icon-btn sm" onClick={onRemove} aria-label={`Remove range ${i + 1}`} title="Remove this range">
          <XIcon size={13} />
        </button>
      </span>
    </div>
  );
}
function ExtractBox({ projectId, r, range, dur }) {
  const [st, setSt] = useState({ busy: false, done: 0, total: 0, stage: "", res: null, err: null, ms: 0, base: null });
  const len = range ? range.end - range.start : Math.min(20, dur);
  const key = range ? `${range.start.toFixed(2)}-${range.end.toFixed(2)}` : "first";
  useEffect(() => {
    setSt((s) => (s.busy ? s : { ...s, res: null, err: null }));
  }, [key]);
  useEffect(
    () =>
      on("references:progress", (p) => {
        if (p?.refId === r.id && p.projectId === projectId)
          setSt((s) => (s.busy ? { ...s, done: p.done ?? s.done, total: p.total ?? s.total, stage: p.stage ?? s.stage } : s));
      }),
    [r.id],
  );
  const run = async () => {
    const t0 = performance.now();
    setSt((s) => ({ ...s, busy: true, done: 0, total: 0, stage: "", res: null, err: null }));
    try {
      const [res, base] = await Promise.all([
        api.refsExtract(projectId, r.id, range ? { start: range.start, end: range.end } : { start: 0, end: Math.min(20, dur) }),
        refThumb(projectId, r, 0, 160),
      ]);
      setSt((s) => ({ ...s, busy: false, res, base, ms: performance.now() - t0 }));
    } catch (e) {
      setSt((s) => ({ ...s, busy: false, err: e.message }));
    }
  };
  const frames = (st.res?.frames ?? []).map((f) => cacheUrl(st.base, f)).filter(Boolean),
    sheet = cacheUrl(st.base, st.res?.sheet);
  return (
    <div className="rf-extract" aria-live="polite">
      <div className="rf-sec-h">
        <b>What Claude sees</b>
        <span className="dim">{range ? `${fmtT(range.start)}–${fmtT(range.end)}` : "first 20 s"}</span>
      </div>
      {!st.busy && !st.res && !st.err && (
        <p className="rf-ex-intro">
          {"Reads only these "}
          {fmtSpan(len)}
          {" of the "}
          {fmtSpan(dur)}
          {" file, so it is quick even for long videos."}
        </p>
      )}
      {st.busy && (
        <div className="rf-ex-prog">
          <Spinner size={13} />
          <div className="grow">
            <span>
              {"Reading "}
              {fmtSpan(len)}
              {" of a "}
              {fmtSpan(dur)}
              {" file…"}
              {st.total ? ` ${st.done}/${st.total}` : ""}
              {st.stage && st.stage !== "frames" && st.stage !== "done" ? ` · ${st.stage}` : ""}
            </span>
            <i className="rf-bar">
              <b style={{ width: st.total ? `${Math.round((st.done / st.total) * 100)}%` : "12%" }} className={st.total ? "" : "indet"} />
            </i>
          </div>
          <button className="btn tiny ghost" onClick={() => api.refsCancel(projectId, r.id).catch(() => {})}>
            Stop
          </button>
        </div>
      )}
      {st.err && (
        <p className="rf-ex-err">
          <TriangleAlertIcon size={13} />
          {st.err}
        </p>
      )}
      {st.res && (
        <div className="rf-ex-res">
          {sheet ? (
            <a
              className="rf-sheet"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                api.open(st.res.sheet).catch(() => {});
              }}
              title="Open the contact sheet"
            >
              <img src={sheet} alt="Contact sheet of the extracted frames" />
            </a>
          ) : null}
          {frames.length > 0 && !sheet && (
            <div className="rf-frames">
              {frames.slice(0, 12).map((u, i) => (
                <img key={i} src={u} alt={`Frame ${i + 1}`} loading="lazy" />
              ))}
            </div>
          )}
          <p className="rf-ex-sum">
            {st.res.summary}
            {st.ms ? (
              <span className="dim">
                {" · "}
                {(st.ms / 1e3).toFixed(1)}
                {" s"}
              </span>
            ) : null}
          </p>
          {st.res.transcript && (
            <p className="rf-ex-tr">
              “{st.res.transcript.slice(0, 220)}
              {st.res.transcript.length > 220 ? "…" : ""}”
            </p>
          )}
        </div>
      )}
      <button className="btn small rf-ex-go" onClick={run} disabled={st.busy}>
        {st.busy ? <Spinner size={13} /> : <SparklesIcon size={14} />}
        {st.res ? "Extract again" : "Preview extract"}
      </button>
    </div>
  );
}
function ImageViewer({ projectId, r, onInsert }) {
  const [src, setSrc] = useState(null),
    [zoom, setZoom] = useState(0);
  const big = useRefThumb(projectId, r, void 0, 1600);
  useEffect(() => {
    api
      .refsMedia(projectId, r.id)
      .then((x) => setSrc(x.url))
      .catch(() => {});
  }, [r.id]);
  const stage = useRef(null);
  useEffect(() => {
    const el = stage.current;
    const f = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => Math.max(0, Math.min(8, (z || 1) * (e.deltaY > 0 ? 0.85 : 1.18))));
    };
    el.addEventListener("wheel", f, { passive: false });
    return () => el.removeEventListener("wheel", f);
  }, []);
  return (
    <div className="rf-iv">
      <div
        ref={stage}
        className={`rf-img-stage ${zoom ? "zoomed" : ""}`}
        onClick={() => setZoom((z) => (z ? 0 : 1))}
        title={zoom ? "Click to fit" : `Click for full size, ${MOD}+scroll to zoom`}
      >
        {src || big ? (
          <img
            src={src ?? big}
            alt={r.label || r.name}
            style={zoom ? { width: (r.probe?.width ?? 1e3) * zoom, maxWidth: "none", maxHeight: "none" } : void 0}
            draggable={false}
          />
        ) : (
          <Spinner />
        )}
      </div>
      <div className="rf-transport">
        <span className="rf-clock">{refMeta(r)}</span>
        <span className="grow" />
        <button className="btn tiny" onClick={() => setZoom((z) => (z ? 0 : 1))}>
          {zoom ? "Fit" : "100 %"}
        </button>
        {onInsert && (
          <button className="btn tiny primary" onClick={() => onInsert(mentionOf(r.tag))}>
            <CornerDownLeftIcon size={11} />
            Insert @{r.tag}
          </button>
        )}
      </div>
    </div>
  );
}
function DocViewer({ r, onInsert }) {
  return (
    <div className="rf-doc">
      <span className="rf-doc-ic">
        <KindIcon kind={r.kind} size={30} />
      </span>
      <div className="grow">
        <b>{r.name}</b>
        <p className="dim">{refMeta(r)}. Claude reads it from where it is.</p>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn small" onClick={() => api.open(r.path)}>
            <ExternalLinkIcon size={13} />
            Open
          </button>
          {onInsert && (
            <button className="btn small primary" onClick={() => onInsert(mentionOf(r.tag))}>
              <CornerDownLeftIcon size={13} />
              Insert @{r.tag}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
