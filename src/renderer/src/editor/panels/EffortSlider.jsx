import { useEffect, useRef, useState } from "react";
import { BUILD_COST, qualityLevels } from "../../../../../routines/nodes";

function EffortSlider({ levels, value, onChange, left = "Faster", right = "Smarter", label = "Effort" }) {
  const wrap = useRef(null),
    canvas = useRef(null);
  const shown = useRef(value),
    target = useRef(value);
  target.current = value;
  const [drag, setDrag] = useState(false);
  const max = Math.max(1, levels.length - 1),
    top = value === max;
  useEffect(() => {
    const c = canvas.current,
      x = c.getContext("2d"),
      still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0,
      w = 0,
      h = 0;
    const size = () => {
      const r = c.getBoundingClientRect(),
        d = devicePixelRatio || 1;
      w = r.width;
      h = r.height;
      c.width = Math.round(w * d);
      c.height = Math.round(h * d);
      x.setTransform(d, 0, 0, d, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(c);
    const GAP = 7,
      ROWS = 4,
      seed = (i, j) => {
        const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
        return s - Math.floor(s);
      };
    const draw = (now) => {
      shown.current += (target.current - shown.current) * (still ? 1 : 0.18);
      const pos = shown.current / max,
        t = now / 1e3,
        lvl = target.current / max;
      x.clearRect(0, 0, w, h);
      const pad = 14,
        cols = Math.max(2, Math.floor((w - pad * 2) / GAP)),
        y0 = (h - (ROWS - 1) * GAP) / 2;
      for (let i = 0; i <= cols; i++) {
        const f = i / cols,
          px = pad + f * (w - pad * 2);
        for (let j = 0; j < ROWS; j++) {
          const r = seed(i, j),
            py = y0 + j * GAP;
          if (r < 0.18 && f > pos) continue;
          const lit = f <= pos + 4e-3;
          let a = lit ? 0.4 + 0.6 * Math.pow(f / Math.max(pos, 1e-3), 1.4) * (0.55 + 0.45 * lvl) : 0.1 + 0.06 * r;
          if (lit && !still) a *= 0.62 + 0.38 * Math.sin(t * (1.2 + 3.2 * lvl) * (0.6 + r) + r * 40);
          const big = lit && r > 0.9 - 0.25 * lvl;
          const k = lit ? Math.min(1, f * (0.6 + 0.6 * lvl)) : 0;
          x.fillStyle = `rgba(${Math.round(150 + 30 * k)},150,${Math.round(160 + 59 * k)},${Math.max(0, Math.min(1, a))})`;
          x.beginPath();
          x.arc(px, py, big ? 1.7 : 1.1, 0, 7);
          x.fill();
        }
      }
      for (let n = 0; n <= max; n++) {
        const f = n / max,
          px = pad + f * (w - pad * 2);
        x.fillStyle = n / max <= pos + 1e-3 ? "rgba(235,235,245,.85)" : "rgba(150,150,160,.35)";
        x.fillRect(px - 1, h / 2 - 7, 2, 14);
      }
      if (thumb.current) thumb.current.style.left = `${pad + pos * (w - pad * 2)}px`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [max]);
  const thumb = useRef(null);
  const at = (clientX) => {
    const r = wrap.current.getBoundingClientRect(),
      f = (clientX - r.left - 14) / (r.width - 28);
    return Math.max(0, Math.min(max, Math.round(f * max)));
  };
  const down = (e) => {
    e.target.setPointerCapture?.(e.pointerId);
    setDrag(true);
    onChange(at(e.clientX));
  };
  const move = (e) => {
    if (drag) {
      const v = at(e.clientX);
      if (v !== value) onChange(v);
    }
  };
  const key = (e) => {
    const v =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? value + 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? value - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? max
              : null;
    if (v === null) return;
    e.preventDefault();
    onChange(Math.max(0, Math.min(max, v)));
  };
  return (
    <div className={`effort ${top ? "top" : ""}`}>
      <div className="effort-head">
        <span className="dim">{label}</span>
        <b key={value} className="effort-name">
          {levels[value]?.name}
        </b>
      </div>
      <div className="effort-ends">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <div
        ref={wrap}
        className="effort-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={levels[value]?.name}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
        onKeyDown={key}
      >
        <canvas ref={canvas} />
        <div ref={thumb} className={`effort-thumb ${drag ? "drag" : ""}`} />
      </div>
      <div className="effort-adds">{levels[value]?.adds}</div>
    </div>
  );
}
export function QualitySlider({ base, value, onChange, locked }) {
  const levels = qualityLevels(base).map((l) => (locked?.includes(l.key) ? { ...l, name: `${l.name} (Premium)` } : l)),
    i = Math.max(
      0,
      levels.findIndex((l) => l.key === value),
    );
  return (
    <>
      <EffortSlider
        levels={levels}
        value={i}
        onChange={(k) => onChange(levels[k].key)}
        label="Quality"
        left="Faster"
        right={levels[levels.length - 1]?.name ?? "Ultraedit"}
      />
      <span className="help">{i ? BUILD_COST : "The quickest build."}</span>
    </>
  );
}
