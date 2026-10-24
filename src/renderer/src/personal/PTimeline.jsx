import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { fmtTime } from "../lib/format";
import { isMac } from "../help/keys";

const RULER = 24,
  CLIP_Y = 30,
  CLIP_H = 58,
  CAM_Y = 94,
  CAM_H = 20,
  WAVE_Y = 120,
  EDGE = 7;
const COL = {
  bg: "#191919",
  lane: "#1e1e1e",
  screen: "#2f3b49",
  screenHi: "#3f5063",
  intro: "#4a3860",
  introHi: "#5d4778",
  other: "#3a3a3a",
  sel: "#dfe7ef",
  cam: "#3b5646",
  camTxt: "#a9c9b6",
  wave: "#5f7f9b",
  waveIntro: "#8a6fae",
  text: "#c9d2dc",
  dim: "#7a7a7a",
  head: "#f2f2f2",
};
export const PTimeline = forwardRef(function PTimeline2(p, ref) {
  const wrap = useRef(null),
    cv = useRef(null);
  const v = useRef({ pps: 40, sx: 0, w: 800, h: 190, dirty: true, fitted: false, drag: null, hover: -1 });
  const P = useRef(p);
  P.current = p;
  window.__ptl = v.current;
  const xOf = (t) => (t - v.current.sx) * v.current.pps,
    tOf = (x) => v.current.sx + x / v.current.pps;
  const clampSx = () => {
    const s = v.current,
      maxS = Math.max(0, P.current.duration - (s.w / s.pps) * 0.9);
    s.sx = Math.min(maxS, Math.max(0, s.sx));
  };
  const fit = () => {
    const s = v.current;
    s.pps = Math.max(0.5, (s.w - 24) / Math.max(1, P.current.duration));
    s.sx = 0;
    s.dirty = true;
  };
  useImperativeHandle(ref, () => ({
    fit,
    zoom(f) {
      const s = v.current,
        t = P.current.clock.t,
        x = xOf(t);
      s.pps = Math.min(2e3, Math.max(0.5, s.pps * f));
      s.sx = t - x / s.pps;
      clampSx();
      s.dirty = true;
    },
    reveal(t) {
      const s = v.current,
        x = xOf(t);
      if (x < 40 || x > s.w - 40) {
        s.sx = t - (s.w * 0.3) / s.pps;
        clampSx();
        s.dirty = true;
      }
    },
  }));
  useEffect(() => {
    v.current.dirty = true;
    if (!v.current.fitted && p.duration > 0) {
      v.current.fitted = true;
      fit();
    }
  }, [p.segs, p.duration, p.selected, p.waves, p.edit]);
  useEffect(() => {
    const s = v.current;
    const off = p.clock.on((t) => {
      s.dirty = true;
      if (p.clock.playing) {
        const x = xOf(t);
        if (x > s.w * 0.92 || x < 0) {
          s.sx = t - (s.w * 0.08) / s.pps;
          clampSx();
        }
      }
    });
    const ro = new ResizeObserver(() => {
      const r = cv.current.getBoundingClientRect();
      s.w = r.width;
      s.h = r.height;
      const d = devicePixelRatio;
      cv.current.width = Math.round(r.width * d);
      cv.current.height = Math.round(r.height * d);
      s.dirty = true;
    });
    ro.observe(cv.current);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (s.dirty) {
        s.dirty = false;
        draw();
      }
    };
    raf = requestAnimationFrame(loop);
    const wheel = (e) => {
      e.preventDefault();
      const r = cv.current.getBoundingClientRect(),
        x = e.clientX - r.left;
      if (e.altKey || e.ctrlKey || e.metaKey) {
        const t = tOf(x);
        const dy = e.deltaY || e.deltaX;
        s.pps = Math.min(2e3, Math.max(0.5, s.pps * Math.exp(-dy * 22e-4)));
        s.sx = t - x / s.pps;
      } else s.sx += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / s.pps;
      clampSx();
      s.dirty = true;
    };
    cv.current.addEventListener("wheel", wheel, { passive: false });
    const noAuto = (e) => {
      if (e.button === 1) e.preventDefault();
    };
    cv.current.addEventListener("mousedown", noAuto);
    cv.current.addEventListener("auxclick", noAuto);
    return () => {
      off();
      ro.disconnect();
      cancelAnimationFrame(raf);
      cv.current?.removeEventListener("wheel", wheel);
      cv.current?.removeEventListener("mousedown", noAuto);
      cv.current?.removeEventListener("auxclick", noAuto);
    };
  }, [p.clock]);
  const hit = (x, y) => {
    const { segs } = P.current;
    if (y < CLIP_Y || y > CLIP_Y + CLIP_H) return null;
    for (let i = 0; i < segs.length; i++) {
      const a = xOf(segs[i].start),
        b = xOf(segs[i].end);
      if (x >= a - EDGE && x <= b + EDGE) {
        if (Math.abs(x - a) <= EDGE && (i === 0 || x <= a)) return { i, edge: "in" };
        if (Math.abs(x - b) <= EDGE && (i === segs.length - 1 || x >= b)) return { i, edge: "out" };
        if (x >= a && x <= b) return { i, edge: null };
      }
    }
    return null;
  };
  const down = (e) => {
    const r = cv.current.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      s = v.current,
      h = hit(x, y);
    e.target.setPointerCapture(e.pointerId);
    if (e.button === 1) {
      e.preventDefault();
      s.drag = { mode: "pan", x0: x, v0: s.sx };
      cv.current.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;
    if (h?.edge) {
      const c = P.current.segs[h.i].clip;
      s.drag = { mode: "trim", i: h.i, side: h.edge, x0: x, v0: h.edge === "in" ? c.in : c.out };
      P.current.onSelect(h.i);
      return;
    }
    if (h) P.current.onSelect(h.i);
    else if (y >= CLIP_Y) P.current.onSelect(null);
    s.drag = { mode: "scrub" };
    P.current.clock.setPlaying(false);
    P.current.clock.set(Math.max(0, Math.min(P.current.duration, tOf(x))));
  };
  const move = (e) => {
    const r = cv.current.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      s = v.current;
    if (!s.drag) {
      const h = hit(x, y);
      cv.current.style.cursor = h?.edge ? "ew-resize" : "default";
      return;
    }
    if (s.drag.mode === "pan") {
      s.sx = s.drag.v0 - (x - s.drag.x0) / s.pps;
      clampSx();
      s.dirty = true;
      return;
    }
    if (s.drag.mode === "scrub") P.current.clock.set(Math.max(0, Math.min(P.current.duration, tOf(x))));
    else P.current.onTrim(s.drag.i, s.drag.side, s.drag.v0 + (x - s.drag.x0) / s.pps, false);
  };
  const up = (e) => {
    const s = v.current,
      d = s.drag;
    s.drag = null;
    if (d?.mode === "pan") cv.current.style.cursor = "default";
    if (d?.mode === "trim") {
      const r = cv.current.getBoundingClientRect();
      P.current.onTrim(d.i, d.side, d.v0 + (e.clientX - r.left - d.x0) / s.pps, true);
    }
  };
  function draw() {
    const c = cv.current;
    if (!c) return;
    const g = c.getContext("2d"),
      d = devicePixelRatio,
      s = v.current,
      { segs, duration, waves, selected, edit, names } = P.current;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = COL.bg;
    g.fillRect(0, 0, s.w, s.h);
    g.fillStyle = COL.lane;
    g.fillRect(0, CLIP_Y, s.w, CLIP_H);
    g.fillRect(0, CAM_Y, s.w, CAM_H);
    g.fillRect(0, WAVE_Y, s.w, s.h - WAVE_Y - 4);
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600],
      step = steps.find((x) => x * s.pps >= 70) ?? 1200;
    g.font = "10px Inter, Arial, sans-serif";
    g.textBaseline = "middle";
    g.fillStyle = COL.dim;
    g.strokeStyle = "#333";
    g.lineWidth = 1;
    for (let t = Math.floor(s.sx / step) * step; t < tOf(s.w); t += step) {
      const x = Math.round(xOf(t)) + 0.5;
      if (x < 0) continue;
      g.beginPath();
      g.moveTo(x, 14);
      g.lineTo(x, RULER);
      g.stroke();
      g.fillText(fmtTime(t, step < 1 ? 2 : 0), x + 4, 9);
    }
    const x0 = Math.max(0, xOf(0)),
      x1 = Math.min(s.w, xOf(duration));
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i],
        a = xOf(sg.start),
        b = xOf(sg.end);
      if (b < 0 || a > s.w) continue;
      const intro = sg.role === "intro",
        w = Math.max(1, b - a - 1);
      g.fillStyle =
        selected === i ? (intro ? COL.introHi : COL.screenHi) : intro ? COL.intro : sg.role === "screen" ? COL.screen : COL.other;
      g.beginPath();
      g.roundRect(a + 0.5, CLIP_Y + 2, w, CLIP_H - 4, 5);
      g.fill();
      if (selected === i) {
        g.strokeStyle = COL.sel;
        g.lineWidth = 1.5;
        g.stroke();
      }
      if (w > 46) {
        g.save();
        g.beginPath();
        g.rect(a + 4, CLIP_Y, w - 8, CLIP_H);
        g.clip();
        g.fillStyle = COL.text;
        g.font = "500 11px Inter, Arial, sans-serif";
        g.fillText(intro ? "Intro" : names[sg.clip.src] || "Clip", a + 8, CLIP_Y + 16);
        g.fillStyle = COL.dim;
        g.font = "10px Inter, Arial, sans-serif";
        g.fillText(`${fmtTime(sg.clip.in, 1)}–${fmtTime(sg.clip.out, 1)}`, a + 8, CLIP_Y + 32);
        g.restore();
      }
      if (sg.role === "screen") {
        if (sg.cam) {
          g.fillStyle = COL.cam;
          g.fillRect(a + 0.5, CAM_Y + 2, w, CAM_H - 4);
          if (w > 60) {
            g.fillStyle = COL.camTxt;
            g.font = "10px Inter, Arial, sans-serif";
            g.fillText(names[sg.cam] || "Facecam", a + 6, CAM_Y + CAM_H / 2);
          }
        } else {
          g.fillStyle = "#2a2020";
          g.fillRect(a + 0.5, CAM_Y + 2, w, CAM_H - 4);
        }
      }
      const wv = waves[sg.clip.src];
      if (wv && wv.peaks.length) {
        const mid = WAVE_Y + (s.h - WAVE_Y - 4) / 2,
          amp = (s.h - WAVE_Y - 10) / 2;
        g.fillStyle = intro ? COL.waveIntro : COL.wave;
        const pa = Math.max(0, a),
          pb = Math.min(s.w, b);
        for (let x = Math.floor(pa); x < pb; x++) {
          const t0 = sg.clip.in + (x - a) / s.pps,
            t1 = t0 + 1 / s.pps;
          let k = Math.floor(t0 * wv.perSecond),
            k1 = Math.max(k + 1, Math.floor(t1 * wv.perSecond)),
            m = 0;
          for (let k2 = k; k2 < k1 && k2 < wv.peaks.length; k2++) if (wv.peaks[k2] > m) m = wv.peaks[k2];
          const hh = Math.max(0.5, (m / 100) * amp);
          g.fillRect(x, mid - hh, 1, hh * 2);
        }
      }
      if (sg.cutAfter && b > 0 && b < s.w) {
        g.fillStyle = "#e4b86a";
        g.fillRect(b - 1, WAVE_Y, 2, 5);
      }
    }
    if (!segs.length) {
      g.fillStyle = COL.dim;
      g.font = "12px Inter, Arial, sans-serif";
      g.fillText("Drop your screen recording and facecam clips on the left to start.", 16, CLIP_Y + CLIP_H / 2);
    }
    if (x1 > x0 && x1 < s.w) {
      g.fillStyle = "#ffffff10";
      g.fillRect(x1, RULER, s.w - x1, s.h - RULER);
    }
    const px = Math.round(xOf(P.current.clock.t)) + 0.5;
    if (px >= 0 && px <= s.w) {
      g.strokeStyle = COL.head;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(px, 4);
      g.lineTo(px, s.h);
      g.stroke();
      g.fillStyle = COL.head;
      g.beginPath();
      g.moveTo(px - 5, 2);
      g.lineTo(px + 5, 2);
      g.lineTo(px, 9);
      g.closePath();
      g.fill();
    }
  }
  return (
    <div className="ptl" ref={wrap}>
      <div className="ptl-labels" aria-hidden="true">
        <span style={{ top: CLIP_Y + 20 }}>Video</span>
        <span style={{ top: CAM_Y + 4 }}>Facecam</span>
        <span style={{ top: WAVE_Y + 22 }}>Audio</span>
      </div>
      <canvas
        ref={cv}
        className="ptl-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        aria-label={`Timeline. ${isMac ? "⌥" : "Alt"} + scroll to zoom, middle-drag to move.`}
      />
    </div>
  );
});
