import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clock, compactNum, dateShort, int } from "./format";

function useWidth() {
  const ref = useRef(null),
    [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((e) => setW(Math.round(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
function niceScale(lo, hi) {
  lo = Math.min(0, lo);
  hi = Math.max(0, hi);
  if (hi - lo <= 0) hi = lo + 1;
  const steps = [1, 2, 2.5, 5, 10];
  let e = 10 ** Math.floor(Math.log10((hi - lo) / 4)),
    i = steps.findIndex((f) => f * e >= (hi - lo) / 4 - 1e-9);
  for (;;) {
    const step = steps[i] * e;
    if (!(steps[i] === 2.5 && e < 10)) {
      const min = Math.floor(lo / step + 1e-9) * step,
        max = Math.ceil(hi / step - 1e-9) * step;
      if ((max - min) / step <= 6)
        return { min, max, step, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, k) => min + k * step) };
    }
    if (++i >= steps.length) {
      i = 1;
      e *= 10;
    }
  }
}
const tick = (v, step) => (Math.abs(v) >= 1e3 ? compactNum(v) : v.toFixed(step < 1 ? Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)) : 0));
export function DayChart({ days, prev, name, unit, format = int, height = 230 }) {
  const [ref, w] = useWidth(),
    gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState(null);
  const n = days.length,
    pad = { l: 44, r: 14, t: 14, b: 28 },
    iw = Math.max(10, w - pad.l - pad.r),
    ih = height - pad.t - pad.b;
  const scale = useMemo(() => {
    const all = [...days.map((d) => d.value), ...(prev ?? []).filter((v) => v != null)];
    return niceScale(Math.min(0, ...all), Math.max(1, ...all));
  }, [days, prev]);
  const x = (i) => pad.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1)),
    y = (v) => pad.t + ih - ((v - scale.min) / (scale.max - scale.min)) * ih;
  const zero = y(0);
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${zero.toFixed(1)}L${x(0).toFixed(1)},${zero.toFixed(1)}Z` : "";
  const prevLine =
    prev?.length === n
      ? prev.map((v, i) => (v == null ? "" : `${i && prev[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join("")
      : "";
  const labels = useMemo(() => {
    if (n < 2) return n ? [0] : [];
    const k = Math.max(2, Math.min(8, Math.floor(iw / 92))),
      step = Math.max(1, Math.ceil((n - 1) / (k - 1)));
    const l = [];
    for (let i = n - 1; i >= 0; i -= step) l.unshift(i);
    return l;
  }, [n, iw]);
  const total = days.reduce((s, d) => s + d.value, 0),
    best = days.reduce((b, d, i) => (d.value > (days[b]?.value ?? -1) ? i : b), 0);
  const at = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left - pad.l) / iw) * (n - 1))));
  };
  const keys = (e) => {
    if (!n) return;
    const i = hover?.i ?? n - 1;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setHover({ i: Math.max(0, hover ? i - 1 : n - 1) });
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setHover({ i: Math.min(n - 1, hover ? i + 1 : 0) });
    } else if (e.key === "Home") {
      e.preventDefault();
      setHover({ i: 0 });
    } else if (e.key === "End") {
      e.preventDefault();
      setHover({ i: n - 1 });
    } else if (e.key === "Escape" && hover) {
      e.stopPropagation();
      setHover(null);
    }
  };
  const h = hover && days[hover.i] ? hover.i : null,
    tipLeft = h === null ? 0 : x(h),
    flip = tipLeft > w - 190;
  return (
    <div
      ref={ref}
      className="yt-chart"
      style={{ height }}
      tabIndex={n ? 0 : -1}
      onKeyDown={keys}
      onBlur={() => setHover(null)}
      role="img"
      aria-label={
        n
          ? `${name} per day, ${dateShort(days[0].day)} to ${dateShort(days[n - 1].day)}: ${format(total)} in all, the most on ${dateShort(days[best].day)} (${format(days[best].value)}). Arrow keys read each day.`
          : `${name}: no data yet`
      }
      onPointerMove={(e) => n && setHover({ i: at(e.clientX) })}
      onPointerLeave={() => setHover(null)}
    >
      {w > 0 && (
        <svg width={w} height={height} aria-hidden="true">
          <defs>
            <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#89bea4" stopOpacity=".32" />
              <stop offset="1" stopColor="#89bea4" stopOpacity="0" />
            </linearGradient>
          </defs>
          {scale.ticks.map((v) => (
            <g key={v} className={`yt-grid-line ${v === 0 && scale.min < 0 ? "zero" : ""}`}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end">
                {tick(v, scale.step)}
              </text>
            </g>
          ))}
          {labels.map((i) => (
            <text
              key={i}
              className="yt-x"
              x={x(i)}
              y={height - 8}
              textAnchor={i === n - 1 ? "end" : x(i) - pad.l < 34 ? "start" : "middle"}
            >
              {dateShort(days[i].day)}
            </text>
          ))}
          {prevLine && <path className="yt-prev" d={prevLine} />}
          {area && <path d={area} fill={`url(#g${gid})`} />}
          {line && <path className="yt-line" d={line} />}
          {n === 1 && <circle className="yt-dot" cx={x(0)} cy={y(days[0].value)} r={3.5} />}
          {h !== null && (
            <>
              <line className="yt-cross" x1={x(h)} x2={x(h)} y1={pad.t} y2={pad.t + ih} />
              {prev?.[h] != null && <circle className="yt-dot prev" cx={x(h)} cy={y(prev[h])} r={3} />}
              <circle className="yt-dot" cx={x(h)} cy={y(days[h].value)} r={4} />
            </>
          )}
        </svg>
      )}
      {h !== null && (
        <div className={`yt-tip ${flip ? "flip" : ""}`} style={{ left: tipLeft }} role="status">
          <b>{dateShort(days[h].day, true)}</b>
          <span>
            {format(days[h].value)} {unit}
          </span>
          {prev?.[h] != null && (
            <small>
              {"Period before: "}
              {format(prev[h])}
            </small>
          )}
        </div>
      )}
    </div>
  );
}
export function RetentionChart({ points, duration, height = 210 }) {
  const [ref, w] = useWidth(),
    gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState(null);
  const pts = useMemo(() => [...points].sort((a, b) => a.x - b.x), [points]);
  const n = pts.length,
    pad = { l: 44, r: 14, t: 14, b: 28 },
    iw = Math.max(10, w - pad.l - pad.r),
    ih = height - pad.t - pad.b;
  const top = Math.max(100, Math.ceil(Math.max(...pts.map((p) => p.y * 100)) / 10) * 10);
  const x = (r) => pad.l + Math.max(0, Math.min(1, r)) * iw,
    y = (v) => pad.t + ih - (Math.max(0, v * 100) / top) * ih;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  const area = n ? `${line}L${x(pts[n - 1].x).toFixed(1)},${pad.t + ih}L${x(pts[0].x).toFixed(1)},${pad.t + ih}Z` : "";
  const near = (r) => pts.reduce((b, p, i) => (Math.abs(p.x - r) < Math.abs(pts[b].x - r) ? i : b), 0);
  const mark = duration && duration > 60 ? 30 / duration : null,
    m = mark !== null && n ? pts[near(mark)] : null;
  const rel = (v) =>
    v == null
      ? ""
      : v >= 0.66
        ? "better than most videos this long"
        : v <= 0.33
          ? "below most videos this long"
          : "about typical for videos this long";
  const keys = (e) => {
    if (!n) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const d = e.key === "ArrowLeft" ? -1 : 1;
      setHover((i) => Math.max(0, Math.min(n - 1, i === null ? (d > 0 ? 0 : n - 1) : i + d * (e.shiftKey ? 10 : 1))));
    } else if (e.key === "Escape" && hover !== null) {
      e.stopPropagation();
      setHover(null);
    }
  };
  const h = hover !== null ? pts[hover] : null,
    left = h ? x(h.x) : 0;
  return (
    <div
      ref={ref}
      className="yt-chart"
      style={{ height }}
      tabIndex={n ? 0 : -1}
      onKeyDown={keys}
      onBlur={() => setHover(null)}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(e) => {
        if (!n) return;
        const r = ref.current.getBoundingClientRect();
        setHover(near((e.clientX - r.left - pad.l) / iw));
      }}
      role="img"
      aria-label={
        n
          ? `Audience retention: ${Math.round(pts[0].y * 100)}% at the start, ${Math.round(pts[near(0.5)].y * 100)}% halfway, ${Math.round(pts[n - 1].y * 100)}% at the end. Arrow keys read each point.`
          : "Audience retention: no data"
      }
    >
      {w > 0 && (
        <svg width={w} height={height} aria-hidden="true">
          <defs>
            <linearGradient id={`r${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#84a9d8" stopOpacity=".34" />
              <stop offset="1" stopColor="#84a9d8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f} className="yt-grid-line">
              <line x1={pad.l} x2={pad.l + iw} y1={y((f * top) / 100)} y2={y((f * top) / 100)} />
              <text x={pad.l - 8} y={y((f * top) / 100) + 4} textAnchor="end">
                {Math.round(f * top)}%
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} className="yt-x" x={x(f)} y={height - 8} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}>
              {duration ? clock(f * duration) : `${f * 100}%`}
            </text>
          ))}
          {area && <path d={area} fill={`url(#r${gid})`} />}
          {line && <path className="yt-line blue" d={line} />}
          {m && (
            <g className="yt-mark">
              <line x1={x(m.x)} x2={x(m.x)} y1={pad.t} y2={pad.t + ih} />
              <text x={x(m.x) + 5} y={pad.t + 11}>
                {"30s · "}
                {Math.round(m.y * 100)}%
              </text>
            </g>
          )}
          {h && (
            <>
              <line className="yt-cross" x1={left} x2={left} y1={pad.t} y2={pad.t + ih} />
              <circle className="yt-dot blue" cx={left} cy={y(h.y)} r={4} />
            </>
          )}
        </svg>
      )}
      {h && (
        <div className={`yt-tip ${left > w - 210 ? "flip" : ""}`} style={{ left }} role="status">
          <b>{duration ? clock(h.x * duration) : `${Math.round(h.x * 100)}%`}</b>
          <span>{Math.round(h.y * 100)}% still watching</span>
          {h.rel != null && <small>{rel(h.rel)}</small>}
        </div>
      )}
    </div>
  );
}
export function Bars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.value)),
    total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div className="yt-bars">
      {items.map((it) => (
        <div key={it.label} className="yt-bar" title={`${it.label}: ${int(it.value)}${it.note ? ` · ${it.note}` : ""}`}>
          <span className="yt-bar-l">{it.label}</span>
          <span className="yt-bar-t">
            <i style={{ width: `${Math.max(1.5, (it.value / max) * 100)}%` }} />
          </span>
          <span className="yt-bar-v">
            {int(it.value)}
            <small>{Math.round((it.value / total) * 100)}%</small>
          </span>
        </div>
      ))}
    </div>
  );
}
export function Spark({ values, width = 92, height = 28 }) {
  if (values.length < 2) return null;
  const max = Math.max(...values),
    min = Math.min(...values),
    span = max - min || 1;
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg className="yt-spark" width={width} height={height} aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}
