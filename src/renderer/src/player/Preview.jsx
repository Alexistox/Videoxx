import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "../lib/api";
import { MonitorCog, RefreshCw, Sparkles, TriangleAlert } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { isMac } from "../help/keys";
import { Busy, Spinner } from "../components/ui";
import { WEBGL_FAIL, webglAdvice } from "./webglHelp";
import { useClockTime, usePlaying } from "./clock";
import { SCALE } from "./previewQuality";

const SLOW_MS = 34;
const autoScale = new Map();
export const Preview = forwardRef(function Preview2(
  {
    host,
    reloadKey,
    clock,
    selection,
    onPick,
    onReady,
    onLog,
    onBootError,
    bootError,
    label,
    onFix,
    aspect = 16 / 9,
    quality = "full",
    onDrawn,
    onPerf,
    stats,
    aside,
  },
  ref,
) {
  const onPerfRef = useRef(onPerf);
  onPerfRef.current = onPerf;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const logBuf = useRef([]),
    logTimer = useRef(0);
  useEffect(
    () => () => {
      if (logTimer.current) clearTimeout(logTimer.current);
    },
    [],
  );
  const [perf, setPerf] = useState(null);
  const stageRef = useRef(null);
  const frames = useRef(new Map());
  const [slots, setSlots] = useState([]);
  const [active, setActive] = useState(null);
  const activeRef = useRef(null);
  activeRef.current = active;
  const slotsRef = useRef([]);
  slotsRef.current = slots;
  const [hover, setHover] = useState(null);
  const pending = useRef(new Map());
  const seq = useRef(1),
    lastHover = useRef(0),
    nextSlot = useRef(1);
  const playing = usePlaying(clock);
  const t = useClockTime(clock, playing ? 4 : 20);
  const [nonce, setNonce] = useState(0);
  const zoomRef = useRef(null);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [art, setArt] = useState([480, 270]);
  const [kind, setKind] = useState("pixel");
  const drag = useRef(null);
  const zoomAt = useCallback((k, px, py) => {
    const el = stageRef.current;
    if (!el) return;
    const W = el.clientWidth,
      H = el.clientHeight,
      v = viewRef.current;
    const z = k === 0 ? 1 : Math.min(16, Math.max(1, v.z * k));
    const cx = px ?? W / 2,
      cy = py ?? H / 2;
    const clampPan = (p, size) => Math.min(0, Math.max(size - size * z, p));
    setView(
      z === 1 ? { z: 1, x: 0, y: 0 } : { z, x: clampPan(cx - ((cx - v.x) * z) / v.z, W), y: clampPan(cy - ((cy - v.y) * z) / v.z, H) },
    );
  }, []);
  const panTo = (x, y) => {
    const el = stageRef.current;
    if (!el) return;
    const v = viewRef.current;
    const c = (p, size) => Math.min(0, Math.max(size - size * v.z, p));
    setView({ ...v, x: c(x, el.clientWidth), y: c(y, el.clientHeight) });
  };
  const panBy = (dx, dy) => panTo(viewRef.current.x + dx, viewRef.current.y + dy);
  useEffect(() => {
    post({ type: "crisp", on: view.z > 1 && kind === "pixel" });
  }, [view.z > 1, active, kind]);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const wheel = (e) => {
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
      } else if (viewRef.current.z > 1) {
        e.preventDefault();
        panBy(-(e.shiftKey ? e.deltaY : e.deltaX), e.shiftKey ? 0 : -e.deltaY);
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt]);
  const [autoK, setAutoK] = useState(() => autoScale.get(host) ?? 1);
  const pq = quality === "auto" ? autoK : SCALE[quality];
  const perfRef = useRef({ quality, pq, playing: false, slow: 0 });
  perfRef.current.quality = quality;
  perfRef.current.pq = pq;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  useEffect(() => {
    const id = nextSlot.current++;
    perfRef.current.slow = 0;
    setSlots((s) => [
      ...s.filter((x) => x.id === activeRef.current),
      {
        id,
        url: `${host}${host.includes("?") ? "&" : "?"}t=${clock.t.toFixed(3)}&r=${reloadKey}.${nonce}.${id}${pq < 1 ? `&pq=${pq}` : ""}`,
      },
    ]);
    const timer = setTimeout(() => {
      if (activeRef.current !== id && slotsRef.current[slotsRef.current.length - 1]?.id === id) {
        api.killPreview().catch(() => {});
        onBootError(
          "The preview did not finish loading within 25 s. A scene may be stuck in an endless loop, or the project is very heavy.",
        );
      }
    }, 25e3);
    return () => clearTimeout(timer);
  }, [host, reloadKey, nonce, pq]);
  const win = (id) => (id === null ? null : (frames.current.get(id)?.contentWindow ?? null));
  const post = (m) => win(activeRef.current)?.postMessage({ target: "cz-host", ...m }, "*");
  const request = useCallback(
    (m, timeout = 8e3) =>
      new Promise((res) => {
        if (!win(activeRef.current)) return res(null);
        const id = seq.current++;
        pending.current.set(id, res);
        post({ ...m, id });
        setTimeout(() => {
          if (pending.current.delete(id)) res(null);
        }, timeout);
      }),
    [],
  );
  useImperativeHandle(
    ref,
    () => ({
      frame: async (scale = 0.5) => (await request({ type: "frame", t: clock.t, scale }))?.dataUrl ?? null,
      reload: () => setNonce((n) => n + 1),
      zoom: (k) => zoomAt(k),
      graphics: (values, replace = false) => request({ type: "graphics", values, replace }),
      bench: (n = 8) => request({ type: "bench", n }, 3e4),
      info: async () => (await request({ type: "info" }))?.info ?? null,
    }),
    [request, zoomAt],
  );
  useEffect(() => {
    const onMsg = (e) => {
      const m = e.data;
      if (!m || m.source !== "cz-host") return;
      const slot = slotsRef.current.find((s) => frames.current.get(s.id)?.contentWindow === e.source);
      if (!slot) return;
      if (m.type === "ready" || m.type === "boot-error") {
        const newest = slotsRef.current[slotsRef.current.length - 1];
        if (slot.id !== newest?.id) return;
        setActive(slot.id);
        setSlots((s) => s.filter((x) => x.id === slot.id));
        if (m.type === "ready") {
          onBootError(m.sceneErrors?.length ? m.sceneErrors.join("\n") : null);
          onReady(m.info);
          if (m.info?.art) setArt(m.info.art);
          setKind(m.info?.kind || "pixel");
          onDrawnRef.current?.({
            asked: m.info?.preview?.asked ?? 1,
            scale: m.info?.preview?.scale ?? 1,
            scalable: !!m.info?.preview?.scalable,
          });
          e.source && e.source.postMessage({ target: "cz-host", type: "seek", t: clock.t }, "*");
        } else onBootError(m.message);
        return;
      }
      if (slot.id !== activeRef.current) return;
      if (m.type === "context-lost") {
        onLog("warn", "The GPU reset the preview. Reloading it.");
        setNonce((n) => n + 1);
        return;
      }
      if (m.type === "log") {
        logBuf.current.push([m.level, m.text]);
        logTimer.current ||= window.setTimeout(() => {
          logTimer.current = 0;
          const b = logBuf.current.splice(0);
          for (const [l, x] of b) onLogRef.current(l, x);
        }, 150);
      } else if (m.type === "perf") {
        const pf = { median: m.median, fps: m.fps ?? 0, frames: m.frames, drawn: m.drawn ?? null, at: Date.now() };
        setPerf(pf);
        onPerfRef.current?.(pf);
        const p = perfRef.current;
        if (p.quality !== "auto" || !p.playing || !m.scalable || m.frames < 10 || p.pq <= 0.25 || m.scale > p.pq + 0.01) {
          p.slow = 0;
          return;
        }
        p.slow = m.median > SLOW_MS ? p.slow + 1 : 0;
        if (p.slow >= 2) {
          p.slow = 0;
          const next = p.pq / 2;
          autoScale.set(host, next);
          setAutoK(next);
        }
      } else if (m.id && pending.current.has(m.id)) {
        const f = pending.current.get(m.id);
        pending.current.delete(m.id);
        f("result" in m ? m.result : m.type === "reply-error" ? null : m);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onReady, onLog, onBootError, host]);
  useEffect(
    () =>
      clock.on((v) =>
        post({ type: "seek", t: v, at: performance.timeOrigin + performance.now(), rate: clock.rate, playing: clock.playing }),
      ),
    [clock, active],
  );
  useEffect(() => {
    post({ type: "playing", on: playing });
  }, [playing, active]);
  useEffect(() => {
    if (playing) setHover(null);
    perfRef.current.playing = playing;
    perfRef.current.slow = 0;
  }, [playing]);
  const [gl, setGl] = useState(null);
  useEffect(() => {
    if (!bootError || !WEBGL_FAIL.test(bootError)) {
      setGl(null);
      return;
    }
    let live = true;
    api
      .graphicsFailed("the preview: " + bootError)
      .then((r) => live && setGl({ software: r.software }))
      .catch(() => live && setGl({ software: false }));
    return () => {
      live = false;
    };
  }, [bootError]);
  const loaded = active !== null;
  const updating = slots.some((s) => s.id !== active);
  const norm = (e) => {
    const r = (zoomRef.current ?? stageRef.current).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onMove = async (e) => {
    if (playing || !loaded || bootError) return;
    const now = performance.now();
    if (now - lastHover.current < 90) return;
    lastHover.current = now;
    const { x, y } = norm(e);
    const r = await request({ type: "pick", x, y, t: clock.t }, 1500);
    setHover(r && r.rect && r.kind !== "shot" ? r : null);
  };
  const onDown = (e) => {
    if (view.z > 1 && (e.button === 1 || (e.button === 0 && e.altKey))) {
      e.preventDefault();
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    }
  };
  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      if (d) panTo(d.vx + e.clientX - d.x, d.vy + e.clientY - d.y);
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);
  const onClick = async (e) => {
    if (!loaded || e.altKey) return;
    if (playing) {
      clock.setPlaying(false);
      return;
    }
    const { x, y } = norm(e);
    const r = await request({ type: "pick", x, y, t: clock.t });
    if (r) onPick(r, e.shiftKey || e.ctrlKey || e.metaKey);
  };
  const boxes = selection.filter((s) => s.rect && s.time !== void 0 && Math.abs(s.time - t) < 0.05);
  const rectStyle = (r) => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${Math.max(r.w * 100, 0.8)}%`,
    height: `${Math.max(r.h * 100, 0.8)}%`,
  });
  return (
    <div className={`stage-wrap ${aside ? "gfx-open" : ""}`}>
      {aside}
      <div
        className={`stage ${!playing ? "picking" : ""} ${view.z > 1 ? "zoomed" : ""} ${aspect < 1 ? "tall" : ""}`}
        ref={stageRef}
        style={{ ["--ar"]: aspect }}
      >
        <div
          className="zoomer"
          ref={zoomRef}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, ["--z"]: view.z }}
        >
          {slots.map((s) => (
            <iframe
              key={s.id}
              ref={(el) => {
                if (el) frames.current.set(s.id, el);
                else frames.current.delete(s.id);
              }}
              src={s.url}
              title={s.id === active ? "Video preview" : "Loading preview"}
              sandbox="allow-scripts allow-same-origin"
              aria-hidden={s.id !== active}
              style={s.id === active ? void 0 : { opacity: 0, pointerEvents: "none" }}
            />
          ))}
          {view.z >= 8 && kind === "pixel" && (
            <div className="pixel-grid" style={{ backgroundSize: `${100 / art[0]}% ${100 / art[1]}%` }} />
          )}
          <div
            className="overlay"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            onMouseDown={onDown}
            onClick={onClick}
            role="presentation"
          >
            {hover && !boxes.some((b) => b.element?.key && b.element?.key === hover.element?.key) && (
              <div className="sel-box hover" style={rectStyle(hover.rect)} />
            )}
            {boxes.map((s, i) => (
              <div key={i} className="sel-box" style={rectStyle(s.rect)}>
                <label>{label(s)}</label>
              </div>
            ))}
          </div>
        </div>
        {view.z > 1 && (
          <button className="zoom-badge" onClick={() => zoomAt(0)} title="Back to fit (0)">
            {Math.round(view.z * 100)}% · Fit
          </button>
        )}
        {stats && loaded && (
          <div
            className="gfx-stats"
            aria-live="off"
            title="Live speed of the preview (Graphics panel). Frame time is how long one frame takes to draw; under 33 ms plays at full speed."
          >
            <b>{perf && Date.now() - perf.at < 4e3 ? perf.fps.toFixed(0) : "–"}</b>
            {" fps"}
            <span>{perf ? `${perf.median.toFixed(1)} ms` : "play to measure"}</span>
            {perf?.drawn && (
              <span>
                {perf.drawn[0]}×{perf.drawn[1]}
              </span>
            )}
            {stats.gpu && <span className="gfx-gpu">{stats.gpu}</span>}
          </div>
        )}
        {!loaded && (
          <div className="stage-msg">
            <Busy text="Loading the scenes…" size={18} kind="orbit" />
          </div>
        )}
        {loaded && updating && (
          <div className="stage-badge">
            <Spinner size={12} />
            Updating
          </div>
        )}
        {bootError && gl && (
          <div className="stage-err gl-err" role="alert">
            <MonitorCog size={16} />
            <p>{webglAdvice(gl.software, isMac)}</p>
            <div className="row">
              {!gl.software && (
                <button className="btn tiny primary" onClick={() => api.setGraphics("software").then(() => api.graphicsRestart())}>
                  <RefreshCw size={12} />
                  Use software graphics and restart
                </button>
              )}
              <button
                className="btn tiny"
                onClick={() => {
                  onBootError(null);
                  setNonce((n) => n + 1);
                }}
              >
                Try again
              </button>
            </div>
            <small className="dim">{bootError}</small>
          </div>
        )}
        {bootError && !gl && (
          <div className="stage-err" role="alert">
            <TriangleAlert size={16} />
            <pre>{bootError}</pre>
            <div className="row">
              <button
                className="btn tiny"
                onClick={() => {
                  onBootError(null);
                  setNonce((n) => n + 1);
                }}
              >
                <RefreshCw size={12} />
                Reload
              </button>
              {onFix && (
                <button className="btn tiny" onClick={() => onFix(bootError)}>
                  <Sparkles size={12} />
                  Fix with Claude
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
