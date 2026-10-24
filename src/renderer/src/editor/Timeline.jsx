import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AnchorIcon,
  AudioLinesIcon,
  ClapperboardIcon,
  Maximize2Icon,
  MessageSquareTextIcon,
  Music2Icon,
  SparkleIcon,
  WavesHorizontalIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { fmtTime } from "../lib/format";
import { isMac } from "../help/keys";

const TRACKS = [
  { id: "ruler", h: 20 },
  { id: "shots", h: 34, label: "Shots", icon: ClapperboardIcon },
  { id: "words", h: 30, label: "Narration", icon: MessageSquareTextIcon },
  { id: "cues", h: 24, label: "Cues", icon: AnchorIcon },
  { id: "audio", h: 46, label: "Audio", icon: AudioLinesIcon },
  { id: "fx", h: 20, label: "Cards", icon: SparkleIcon },
  { id: "beds", h: 22, label: "Auto beds", icon: WavesHorizontalIcon },
];
const LANE_COL = { music: "#b496db", effects: "#d7b461", ambience: "#84a9d8", free: "#89bea4" };
const clipStart = (c, words) => (c.anchor && words[c.anchor.word] ? Math.max(0, words[c.anchor.word].s + c.anchor.offset) : c.start);
const BED_COL = {
  pad: "#b496db",
  wind: "#84a9d8",
  ocean: "#84a9d8",
  city: "#d7b461",
  crowd: "#d7b461",
  hum: "#89bea4",
  keys: "#89bea4",
  room: "#969696",
  rain: "#84a9d8",
  space: "#b496db",
  crackle: "#d7b461",
};
const NO_MARKS = [];
const NO_GLOW = new Set();
function fitText(g, text, maxW) {
  if (maxW <= 6) return "";
  if (g.measureText(text).width <= maxW) return text;
  let lo = 0,
    hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo ? text.slice(0, lo).trimEnd() + "…" : "";
}
const NO_WORDS = [];
export function Timeline({
  clock,
  end,
  shots,
  cues,
  phrases,
  wave,
  events,
  beds,
  selection,
  onSelect,
  onScrub,
  marks = NO_MARKS,
  glow = NO_GLOW,
  layers = null,
  layerWords = NO_WORDS,
  onLayerMove,
  onAddLayer,
}) {
  const tracks = useMemo(() => {
    if (!layers?.clips.length) return TRACKS;
    const i = TRACKS.findIndex((t) => t.id === "audio") + 1;
    return [
      ...TRACKS.slice(0, i),
      ...layers.lanes.map((l) => ({
        id: `lane:${l.id}`,
        h: 20,
        label: l.name + (l.mute ? " (muted)" : l.solo ? " (solo)" : ""),
        icon: Music2Icon,
      })),
      ...TRACKS.slice(i),
    ];
  }, [layers]);
  const top = (id) => {
    let y = 0;
    for (const t of tracks) {
      if (t.id === id) return y;
      y += t.h;
    }
    return y;
  };
  const HEIGHT = tracks.reduce((a, t) => a + t.h, 0);
  const layerDrag = useRef(null);
  const [menu, setMenu] = useState(null);
  const wrap = useRef(null),
    cv = useRef(null);
  const [width, setWidth] = useState(800);
  const view = useRef({ pps: 0, x0: 0 });
  const drag = useRef(null);
  const [range, setRange] = useState(null);
  const [tip, setTip] = useState(null);
  const tipRef = useRef(null);
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (el && tip) el.style.left = `${Math.max(4, Math.min(tip.x, width - el.offsetWidth - 6))}px`;
  }, [tip, width]);
  const [, force] = useState(0);
  const fitMode = useRef(true);
  const fit = useCallback(() => {
    view.current = { pps: Math.max(0.05, (width - 16) / Math.max(1, end)), x0: 0 };
    fitMode.current = true;
    force((n) => n + 1);
  }, [width, end]);
  useEffect(() => {
    const ro = new ResizeObserver(() => setWidth(wrap.current.clientWidth));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const fitted = useRef({ end: 0, width: 0 });
  useEffect(() => {
    const f = fitted.current,
      v = view.current;
    if (!v.pps || (fitMode.current && (f.end !== end || f.width !== width)) || v.pps * end < width * 0.5) {
      fit();
      fitted.current = { end, width };
    } else if (f.end !== end) {
      v.x0 = clampX(v.x0);
      fitted.current = { end, width };
      force((n) => n + 1);
    }
  }, [width, end]);
  const clampX = (x0) => Math.max(0, Math.min(Math.max(0, end - (width - 16) / view.current.pps), x0));
  const bar = useRef(null),
    thumb = useRef(null);
  const X = (s) => (s - view.current.x0) * view.current.pps + 8;
  const S = (x) => (x - 8) / view.current.pps + view.current.x0;
  const head = useRef(null),
    drawnCur = useRef(-1);
  const curShotOf = (t) => shots.findIndex((sh) => t >= sh.t0 && t < sh.t1);
  const placeHead = (t) => {
    const h = head.current;
    if (!h) return;
    const x = Math.round(X(t));
    h.style.transform = `translateX(${x}px)`;
    h.style.visibility = x < 0 || x > width ? "hidden" : "";
  };
  const draw = useCallback(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(width * dpr),
      ph = Math.round(HEIGHT * dpr);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
      c.style.width = width + "px";
      c.style.height = HEIGHT + "px";
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);
    const { pps } = view.current,
      s0 = S(0),
      s1 = S(width);
    g.font = "11px Inter, sans-serif";
    g.textBaseline = "middle";
    g.fillStyle = "#222";
    for (const t of TRACKS.slice(1)) g.fillRect(0, top(t.id) + t.h - 1, width, 1);
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((st) => st * pps >= 60) ?? 600;
    g.fillStyle = "#8e8e8e";
    g.strokeStyle = "#3a3a3a";
    for (let s = Math.max(0, Math.floor(s0 / step) * step); s <= Math.min(end, s1); s += step) {
      const x = Math.round(X(s)) + 0.5;
      g.beginPath();
      g.moveTo(x, 12);
      g.lineTo(x, 20);
      g.stroke();
      g.fillText(fmtTime(s, step < 1 ? 1 : 0), x + 4, 9);
    }
    for (const m of marks) {
      const x = X(m.t);
      if (x < -6 || x > width + 6) continue;
      g.fillStyle = m.status === "done" ? "#b496db" : "#5c5c5c";
      g.beginPath();
      g.moveTo(x - 4.5, 13);
      g.lineTo(x + 4.5, 13);
      g.lineTo(x, 20);
      g.closePath();
      g.fill();
    }
    const selShots = new Set(selection.filter((s) => s.kind === "shot" || s.shot).map((s) => s.shot?.index));
    const ys = top("shots");
    shots.forEach((sh, i) => {
      const x0 = X(sh.t0),
        x1 = X(sh.t1);
      if (x1 < 0 || x0 > width) return;
      const on = selShots.has(sh.index),
        cur = clock.t >= sh.t0 && clock.t < sh.t1;
      g.fillStyle = on ? "#2c3a33" : cur ? "#2b2b2b" : i % 2 ? "#252525" : "#282828";
      roundRect(g, x0 + 1, ys + 4, Math.max(2, x1 - x0 - 2), 26, 6);
      g.fill();
      if (on) {
        g.strokeStyle = "#89bea4";
        g.lineWidth = 1.2;
        g.stroke();
      }
      if (glow.has(sh.index)) {
        const k = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0.5 + 0.5 * Math.sin(performance.now() / 380);
        g.save();
        g.fillStyle = `rgba(180,150,219,${0.06 + 0.05 * k})`;
        roundRect(g, x0 + 1, ys + 4, Math.max(2, x1 - x0 - 2), 26, 6);
        g.fill();
        g.strokeStyle = `rgba(180,150,219,${0.55 + 0.3 * k})`;
        g.lineWidth = 1.2;
        g.stroke();
        g.restore();
      }
      if (x1 - x0 > 14) {
        g.fillStyle = on ? "#dcefe4" : "#c8c8c8";
        const num = String(sh.index + 1),
          full = `${num}  ${sh.name.replace(/^\d+[a-z]?:\s*/i, "")}`;
        g.fillText(fitText(g, full, x1 - x0 - 14) || fitText(g, num, x1 - x0 - 6), x0 + 7, ys + 17);
      }
    });
    const yw = top("words");
    const selPhr = new Set(selection.filter((s) => s.kind === "phrase").map((s) => s.range?.[0]));
    phrases.forEach((p) => {
      const x0 = X(p.s),
        x1 = X(p.e);
      if (x1 < 0 || x0 > width) return;
      const on = selPhr.has(p.s);
      g.fillStyle = on ? "#3a3528" : "#232625";
      roundRect(g, x0, yw + 5, Math.max(2, x1 - x0), 20, 5);
      g.fill();
      if (on) {
        g.strokeStyle = "#d7b461";
        g.lineWidth = 1;
        g.stroke();
      }
      if (x1 - x0 > 24) {
        g.fillStyle = on ? "#efe2bd" : "#9fa9a3";
        g.fillText(fitText(g, p.text, x1 - x0 - 12), x0 + 6, yw + 15.5);
      }
    });
    const yc = top("cues") + 12,
      selCue = new Set(selection.filter((s) => s.kind === "cue").map((s) => `${s.element?.file}:${s.element?.line}:${s.element?.word}`));
    let lastLabel = -1e9;
    const shown = cues
      .filter((c2) => {
        const x = X(c2.t);
        return x >= -4 && x <= width + 4;
      })
      .sort((a, b) => a.t - b.t);
    shown.forEach((c2, i) => {
      const x = X(c2.t),
        on = selCue.has(`${c2.file}:${c2.line}:${c2.word}`),
        col = c2.miss ? "#db9393" : on ? "#efe2bd" : "#d7b461";
      g.fillStyle = col;
      g.fillRect(Math.round(x), yc - 7, 1, 14);
      g.beginPath();
      g.arc(x, yc - 7, on ? 3.2 : 2.2, 0, 6.3);
      g.fill();
      const room = (i + 1 < shown.length ? X(shown[i + 1].t) : width) - x - 8;
      if (x - lastLabel > 70 && pps > 18 && room >= 16) {
        g.font = "10px Inter, sans-serif";
        const t = fitText(g, c2.word.slice(0, 14), room);
        if (t) {
          g.fillStyle = on ? "#efe2bd" : "#9d9277";
          g.fillText(t, x + 4, yc + 1);
          lastLabel = x;
        }
        g.font = "11px Inter, sans-serif";
      }
    });
    const ya = top("audio"),
      mid = ya + 23;
    if (wave?.peaks?.length) {
      g.fillStyle = "#5f6d66";
      const per = wave.perSecond,
        px = Math.max(1, Math.floor(1));
      for (let x = 0; x < width; x += px) {
        const a = Math.floor(S(x) * per),
          b = Math.max(a + 1, Math.floor(S(x + px) * per));
        if (a < 0 || a >= wave.peaks.length) continue;
        let m = 0;
        for (let k = a; k < b && k < wave.peaks.length; k++) m = Math.max(m, wave.peaks[k]);
        const h = Math.max(0.5, (m / 255) * 20);
        g.fillRect(x, mid - h, px, h * 2);
      }
    } else {
      g.fillStyle = "#5a5a5a";
      g.fillText("No audio yet", 12, mid);
    }
    const yf = top("fx") + 10;
    (events?.cards ?? []).forEach((cd) => {
      const x = X(cd.t);
      if (x < -5 || x > width + 5) return;
      g.fillStyle = "#d7b461";
      g.beginPath();
      g.moveTo(x, yf - 5);
      g.lineTo(x + 5, yf);
      g.lineTo(x, yf + 5);
      g.lineTo(x - 5, yf);
      g.fill();
    });
    (events?.hits ?? []).forEach((h) => {
      const x = X(h);
      if (x < -3 || x > width + 3) return;
      g.fillStyle = "#b496db";
      g.beginPath();
      g.arc(x, yf, 2.5, 0, 6.3);
      g.fill();
    });
    const yb = top("beds");
    beds.forEach((b) => {
      const x0 = X(b.from),
        x1 = X(b.to);
      if (x1 < 0 || x0 > width) return;
      const col = BED_COL[b.type] ?? "#969696";
      g.fillStyle = col + "22";
      roundRect(g, x0 + 1, yb + 4, Math.max(2, x1 - x0 - 2), 14, 4);
      g.fill();
      g.fillStyle = col;
      if (x1 - x0 > 30) g.fillText(fitText(g, `${b.type}  ${b.gain} dB`, x1 - x0 - 12), x0 + 6, yb + 11.5);
    });
    for (const l of layers?.clips.length ? layers.lanes : []) {
      const yl = top(`lane:${l.id}`),
        col = LANE_COL[l.kind] ?? "#969696",
        dim = l.mute || (layers.lanes.some((x) => x.solo) && !l.solo);
      for (const c2 of layers.clips.filter((c3) => c3.lane === l.id)) {
        const s = layerDrag.current?.id === c2.id ? layerDrag.current.t : clipStart(c2, layerWords);
        const len = c2.len ?? (c2.loop ? Math.max(0.02, end - s) : Math.max(0.02, c2.srcDur - c2.in)),
          x0 = X(s),
          x1 = X(Math.min(end, s + len));
        if (x1 < 0 || x0 > width) continue;
        g.fillStyle = col + (dim ? "14" : "30");
        roundRect(g, x0, yl + 3, Math.max(3, x1 - x0), 14, 4);
        g.fill();
        g.fillStyle = dim ? "#6a6a6a" : col;
        g.fillRect(x0, yl + 3, 2, 14);
        if (c2.anchor) {
          g.beginPath();
          g.arc(x0, yl + 3, 2.5, 0, 6.3);
          g.fill();
        }
        if (x1 - x0 > 26) {
          g.font = "10px Inter, sans-serif";
          g.fillText(fitText(g, c2.name, x1 - x0 - 10), x0 + 6, yl + 10.5);
          g.font = "11px Inter, sans-serif";
        }
      }
    }
    const rs = range ?? selection.find((s) => s.kind === "range")?.range ?? null;
    if (rs) {
      g.fillStyle = "#89bea41a";
      g.fillRect(X(rs[0]), 0, X(rs[1]) - X(rs[0]), HEIGHT);
      g.fillStyle = "#89bea4";
      g.fillRect(X(rs[0]), 0, 1, HEIGHT);
      g.fillRect(X(rs[1]), 0, 1, HEIGHT);
    }
    drawnCur.current = curShotOf(clock.t);
    placeHead(clock.t);
    const ex = X(end);
    if (ex < width) {
      g.fillStyle = "#141414";
      g.fillRect(ex, 0, width - ex, HEIGHT);
    }
    const vis = (width - 16) / pps,
      tb = thumb.current;
    if (tb && end > 0) {
      tb.style.left = `${Math.min(100, (view.current.x0 / end) * 100)}%`;
      tb.style.width = `${Math.min(100, (vis / end) * 100)}%`;
      bar.current?.classList.toggle("full", vis >= end - 0.01);
    }
  }, [width, end, shots, cues, phrases, wave, events, beds, selection, range, marks, glow, layers, layerWords, tracks]);
  useEffect(() => {
    if (!glow.size) return;
    const id = setInterval(() => draw(), 50);
    return () => clearInterval(id);
  }, [glow, draw]);
  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => {
    layerDrag.current = null;
    draw();
  }, [layers]);
  useEffect(
    () =>
      clock.on((t) => {
        const v = view.current,
          x = X(t);
        if (clock.playing && (x > width - 40 || x < 0)) {
          v.x0 = Math.max(0, t - (2 / v.pps) * 8);
          draw();
        } else if (curShotOf(t) !== drawnCur.current) draw();
        else placeHead(t);
      }),
    [draw, width],
  );
  const hit = (x, y) => {
    const s = S(x);
    if (y < 22 && marks.length) {
      let best = null,
        bd = 6;
      for (const m of marks) {
        const d = Math.abs(X(m.t) - x);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (best) return { kind: "mark", m: best, s };
    }
    if (y >= top("shots") && y < top("shots") + 34) {
      const sh = shots.find((h) => s >= h.t0 && s < h.t1);
      if (sh) return { kind: "shot", sh, s };
    }
    if (y >= top("words") && y < top("words") + 30) {
      const p = phrases.find((p2) => s >= p2.s && s <= p2.e);
      if (p) return { kind: "phrase", p, s };
    }
    if (y >= top("cues") && y < top("cues") + 24) {
      let best = null,
        bd = 6;
      for (const c of cues) {
        const d = Math.abs(X(c.t) - x);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best) return { kind: "cue", c: best, s };
    }
    for (const l of layers?.clips.length ? layers.lanes : []) {
      const yl = top(`lane:${l.id}`);
      if (y < yl || y >= yl + 20) continue;
      const c = layers.clips
        .filter((c2) => c2.lane === l.id)
        .reverse()
        .find((c2) => {
          const st = clipStart(c2, layerWords),
            len = c2.len ?? (c2.loop ? end - st : c2.srcDur - c2.in);
          return s >= st - 3 / view.current.pps && s <= st + Math.max(len, 6 / view.current.pps);
        });
      if (c) return { kind: "layer", c, s };
    }
    return null;
  };
  const snap = (t) => {
    let best = t,
      bd = 8 / view.current.pps;
    for (const v of [...layerWords.map((w) => w.s), ...shots.map((s) => s.t0), ...cues.map((c) => c.t)]) {
      const d = Math.abs(v - t);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  const onDown = (e) => {
    const r = cv.current.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      s = Math.max(0, Math.min(end, S(x)));
    if (e.button === 1) {
      e.preventDefault();
      const v = view.current,
        a = e.clientX,
        x0 = v.x0;
      const mv = (ev) => {
        v.x0 = clampX(x0 - (ev.clientX - a) / v.pps);
        draw();
      };
      const up = () => {
        window.removeEventListener("mousemove", mv);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", mv);
      window.addEventListener("mouseup", up);
      return;
    }
    setMenu(null);
    if (e.button === 2) return;
    if (e.shiftKey && !hit(x, y)) {
      drag.current = { mode: "range", a: s };
      setRange([s, s]);
      return;
    }
    const h = hit(x, y);
    if (h?.kind === "layer" && onLayerMove) {
      const s0 = clipStart(h.c, layerWords);
      layerDrag.current = { id: h.c.id, s0, x0: x, t: s0, moved: false };
      const mv = (ev) => {
        const d = layerDrag.current,
          r2 = cv.current?.getBoundingClientRect();
        if (!d || !r2) return;
        const dx = ev.clientX - r2.left - d.x0;
        d.moved = d.moved || Math.abs(dx) > 3;
        if (!d.moved) return;
        d.t = Math.max(0, snap(d.s0 + dx / view.current.pps));
        draw();
      };
      const up = () => {
        window.removeEventListener("mousemove", mv);
        window.removeEventListener("mouseup", up);
        const d = layerDrag.current;
        if (d?.moved && Math.abs(d.t - d.s0) > 1e-3) onLayerMove(d.id, +d.t.toFixed(3));
        else layerDrag.current = null;
        draw();
      };
      window.addEventListener("mousemove", mv);
      window.addEventListener("mouseup", up);
      return;
    }
    if (h?.kind === "shot")
      onSelect(
        { kind: "shot", time: s, shot: { index: h.sh.index, name: h.sh.name, file: h.sh.file, line: h.sh.line, t0: h.sh.t0, t1: h.sh.t1 } },
        e.shiftKey || e.ctrlKey || e.metaKey,
      );
    else if (h?.kind === "phrase")
      onSelect({ kind: "phrase", range: [h.p.s, h.p.e], element: { text: h.p.text } }, e.shiftKey || e.ctrlKey || e.metaKey);
    else if (h?.kind === "cue") {
      const sh = h.c.shot !== null ? shots[h.c.shot] : void 0;
      onSelect(
        {
          kind: "cue",
          time: h.c.t,
          element: h.c,
          shot: sh ? { index: sh.index, name: sh.name, file: sh.file, line: sh.line, t0: sh.t0, t1: sh.t1 } : void 0,
        },
        e.shiftKey || e.ctrlKey || e.metaKey,
      );
      clock.setPlaying(false);
      clock.set(h.c.t + 0.02);
      drag.current = null;
      return;
    }
    clock.setPlaying(false);
    clock.set(s);
    drag.current = { mode: "scrub", a: s };
  };
  useEffect(() => {
    const move = (e) => {
      if (!drag.current || !cv.current) return;
      const r = cv.current.getBoundingClientRect(),
        s = Math.max(0, Math.min(end, S(e.clientX - r.left)));
      if (drag.current.mode === "scrub") {
        clock.set(s);
        onScrub?.(s);
      } else setRange([Math.min(drag.current.a, s), Math.max(drag.current.a, s)]);
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (d?.mode === "range")
        setRange((rg) => {
          if (rg && rg[1] - rg[0] > 0.1) onSelect({ kind: "range", range: rg }, false);
          return null;
        });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [end, onSelect, onScrub]);
  const onWheel = (e) => {
    e.preventDefault();
    const v = view.current,
      r = cv.current.getBoundingClientRect(),
      x = e.clientX - r.left;
    if (e.ctrlKey || e.metaKey) {
      fitMode.current = false;
      const s = S(x);
      v.pps = Math.min(400, Math.max((width - 16) / Math.max(1, end), v.pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      v.x0 = Math.max(0, s - (x - 8) / v.pps);
    } else v.x0 = clampX(v.x0 + (e.deltaX || e.deltaY) / v.pps);
    draw();
  };
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const h = (e) => wheelRef.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);
  const barDown = (e) => {
    const r = bar.current.getBoundingClientRect(),
      v = view.current,
      vis = (width - 16) / v.pps;
    if (e.target !== thumb.current) v.x0 = clampX(((e.clientX - r.left) / r.width) * end - vis / 2);
    const a = e.clientX,
      x0 = v.x0;
    draw();
    const mv = (ev) => {
      v.x0 = clampX(x0 + ((ev.clientX - a) / r.width) * end);
      draw();
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  };
  const zoom = (k) => {
    fitMode.current = false;
    const v = view.current,
      c = clock.t;
    v.pps = Math.min(400, Math.max((width - 16) / Math.max(1, end), v.pps * k));
    v.x0 = Math.max(0, c - width / 2 / v.pps);
    draw();
  };
  return (
    <div className="timeline" aria-label="Timeline">
      <div className="tl-head">
        <span>Timeline</span>
        <span className="dim tl-hint">
          {"Click to select · drag to scrub (with sound) · Shift+drag for a range · "}
          {isMac ? "⌘+scroll or pinch" : "Ctrl+wheel"}
          {" to zoom · scroll or the bar below to move along"}
        </span>
        <span className="grow" />
        <button className="icon-btn sm" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)}>
          <ZoomOutIcon size={15} strokeWidth={1.7} />
        </button>
        <button className="icon-btn sm" aria-label="Zoom in" onClick={() => zoom(1.5)}>
          <ZoomInIcon size={15} strokeWidth={1.7} />
        </button>
        <button className="icon-btn sm" aria-label="Fit" onClick={fit}>
          <Maximize2Icon size={14} strokeWidth={1.7} />
        </button>
      </div>
      <div className="tl-body">
        <div className="tl-labels">
          {tracks.map((t) => (
            <div key={t.id} style={{ height: t.h }} className={t.id.startsWith("lane:") ? "tl-lane-label" : void 0}>
              {t.icon && <t.icon size={13} strokeWidth={1.7} />}
              {t.label}
            </div>
          ))}
        </div>
        <div className="tl-scroll" ref={wrap}>
          <canvas
            ref={cv}
            className="tl-canvas"
            onMouseDown={onDown}
            onMouseLeave={() => setTip(null)}
            onContextMenu={(e) => {
              if (!onAddLayer) return;
              e.preventDefault();
              const r = cv.current.getBoundingClientRect(),
                x = e.clientX - r.left,
                y = e.clientY - r.top;
              setTip(null);
              setMenu({ x: Math.min(x, width - 210), y: Math.max(0, Math.min(y, HEIGHT - 40)), t: Math.max(0, Math.min(end, S(x))) });
            }}
            onMouseMove={(e) => {
              if (drag.current) return setTip(null);
              const r = cv.current.getBoundingClientRect(),
                x = e.clientX - r.left,
                y = e.clientY - r.top,
                h = hit(x, y),
                s = Math.max(0, S(x));
              const text =
                h?.kind === "mark"
                  ? `Claude edit · ${h.m.text.slice(0, 90)}${h.m.status !== "done" ? ` (${h.m.status})` : ""} · ${fmtTime(h.m.t, 2)}`
                  : h?.kind === "shot"
                    ? `Shot ${h.sh.index + 1} · ${h.sh.name} · ${fmtTime(h.sh.t0)}–${fmtTime(h.sh.t1)} · ${h.sh.file}:${h.sh.line}`
                    : h?.kind === "phrase"
                      ? `“${h.p.text}” · ${fmtTime(h.p.s, 2)}`
                      : h?.kind === "cue"
                        ? `${h.c.key ? h.c.key + " = " : ""}cue('${h.c.word}', ${h.c.near})${h.c.offset ? ` ${h.c.offset > 0 ? "+" : "−"} ${Math.abs(h.c.offset)}` : ""} → ${h.c.t.toFixed(2)}s${h.c.miss ? " · MISS" : ""} · ${h.c.file}:${h.c.line}`
                        : h?.kind === "layer"
                          ? `${h.c.name} · ${fmtTime(clipStart(h.c, layerWords), 2)}${h.c.anchor ? ` · on “${h.c.anchor.text}”` : ""} · drag to move`
                          : fmtTime(s, 2);
              setTip({ x: x + 12, y: Math.max(0, y - 30), text });
            }}
          />
          <div className="tl-playhead" ref={head} style={{ height: HEIGHT }} />
          {menu && (
            <div className="tl-ctx" role="menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
              <button
                role="menuitem"
                onClick={() => {
                  const t = menu.t;
                  setMenu(null);
                  onAddLayer?.(t);
                }}
              >
                Add audio layer here ({fmtTime(menu.t, 2)})…
              </button>
            </div>
          )}
          <div className="tl-hbar full" ref={bar} onPointerDown={barDown} aria-label="Scroll the timeline">
            <div className="tl-hthumb" ref={thumb} />
          </div>
          {tip && (
            <div ref={tipRef} className="tl-tip" style={{ left: tip.x, top: tip.y }}>
              {tip.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
