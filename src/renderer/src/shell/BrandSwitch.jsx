import { Fragment, startTransition, useEffect, useLayoutEffect, useRef, useState } from "react";

const MODES = ["personal", "faceless"];
const LABELS = { personal: "Personal Brand", faceless: "Faceless Brand" };
const FILTER = "cz-liquid-glass";
const REST = 4;
const CHANNEL = [
  "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
];
function lensMap(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d"),
    img = g.createImageData(w, h),
    r = h / 2,
    bezel = r;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      const cx = Math.min(Math.max(px, r), w - r);
      const dx = px - cx,
        dy = py - r,
        len = Math.hypot(dx, dy) || 1;
      const edge = Math.max(0, 1 - (r - len) / bezel);
      const k = edge * edge * (3 - 2 * edge);
      const i = (y * w + x) * 4;
      img.data[i] = 128 - (dx / len) * k * 127;
      img.data[i + 1] = 128 - (dy / len) * k * 70;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}
export function BrandSwitch({ value, onChange }) {
  const root = useRef(null),
    thumb = useRef(null),
    btns = useRef([]);
  const disp = useRef([]);
  const [map, setMap] = useState(null);
  const s = useRef({
    p: value === "faceless" ? 1 : 0,
    v: 0,
    target: value === "faceless" ? 1 : 0,
    press: 0,
    pressV: 0,
    pressTo: 0,
    raf: 0,
    last: 0,
    travel: 0,
    w: 0,
    h: 0,
    drag: null,
  });
  const cb = useRef(onChange);
  cb.current = onChange;
  const paint = () => {
    const st = s.current,
      el = thumb.current,
      r = root.current;
    if (!el || !r) return;
    const over = st.p < 0 ? -st.p : st.p > 1 ? st.p - 1 : 0;
    const p = Math.min(1, Math.max(0, st.p));
    const stretch = Math.min(Math.abs(st.v) * 0.024, 0.2);
    const inflate = 1 + st.press * 0.07;
    const sx = (1 + stretch - over * 2.2) * inflate,
      sy = (1 - stretch * 0.42 + over * 1.1) * inflate;
    const tx = p * st.travel + (st.p < 0 ? -1 : 1) * over * st.travel * 0.25;
    el.style.transform = `translate3d(${tx}px,0,0) scale(${sx},${sy})`;
    const q = Math.min(1, Math.abs(st.v) / 2.5),
      m = Math.min(1, q * q * (3 - 2 * q) + st.press * 0.7);
    const x0 = tx + (st.w * (1 - sx)) / 2;
    r.style.setProperty("--x0", `${x0.toFixed(2)}px`);
    r.style.setProperty("--x1", `${(x0 + st.w * sx).toFixed(2)}px`);
    r.style.setProperty("--m", m.toFixed(3));
    if (m > 2e-3) r.setAttribute("data-bend", "");
    else r.removeAttribute("data-bend");
    r.style.setProperty("--p", p.toFixed(4));
    const c = Math.min(1, Math.max(0, (p - 0.25) / 0.5));
    r.style.setProperty("--c", (c * c * (3 - 2 * c)).toFixed(4));
    r.style.setProperty("--lift", st.press.toFixed(3));
    const size = st.h / 38;
    const amp = Math.min(REST + Math.abs(st.v) * 1.3 + st.press * 5 + over * 30, 19) * size;
    const split = 0.03 + m * 0.12;
    disp.current.forEach((d, i) => d.setAttribute("scale", (amp * (1 + (i - 1) * split)).toFixed(2)));
  };
  const tick = (t) => {
    const st = s.current;
    let dt = st.last ? (t - st.last) / 1e3 : 1 / 120;
    st.last = t;
    dt = Math.min(dt, 1 / 30);
    const k = st.drag ? 1600 : 330,
      c = st.drag ? 72 : 22;
    for (let n = Math.ceil(dt / (1 / 480)), h = dt / n; n > 0; n--) {
      st.v += (k * (st.target - st.p) - c * st.v) * h;
      st.p += st.v * h;
      st.pressV += (500 * (st.pressTo - st.press) - 34 * st.pressV) * h;
      st.press += st.pressV * h;
    }
    paint();
    const still =
      Math.abs(st.target - st.p) < 1e-4 && Math.abs(st.v) < 1e-3 && Math.abs(st.pressTo - st.press) < 1e-3 && Math.abs(st.pressV) < 1e-3;
    if (still && !st.drag) {
      st.p = st.target;
      st.v = 0;
      st.press = st.pressTo;
      st.pressV = 0;
      paint();
      st.raf = 0;
      st.last = 0;
      return;
    }
    st.raf = requestAnimationFrame(tick);
  };
  const kick = () => {
    const st = s.current;
    if (!st.raf) {
      st.last = 0;
      st.raf = requestAnimationFrame(tick);
    }
  };
  const measure = () => {
    const r = root.current,
      el = thumb.current;
    if (!r || !el) return;
    const st = s.current,
      w = el.offsetWidth,
      h = el.offsetHeight;
    st.w = w;
    st.h = h;
    st.travel = r.clientWidth - w - el.offsetLeft * 2;
    if (w && h) setMap((m) => (m && m.w === w && m.h === h ? m : { url: lensMap(Math.round(w), Math.round(h)), w, h }));
    paint();
  };
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (root.current) ro.observe(root.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(s.current.raf);
      s.current.raf = 0;
    };
  }, []);
  useLayoutEffect(paint, [map]);
  useEffect(() => {
    const to = value === "faceless" ? 1 : 0;
    if (s.current.target !== to && !s.current.drag) {
      s.current.target = to;
      kick();
    }
  }, [value]);
  const swapT = useRef(0);
  const pick = (m) => {
    s.current.target = m === "faceless" ? 1 : 0;
    kick();
    clearTimeout(swapT.current);
    if (m !== value) swapT.current = window.setTimeout(() => startTransition(() => cb.current(m)), 190);
  };
  const down = (e) => {
    if (e.button !== 0) return;
    const st = s.current;
    st.drag = { x: e.clientX, p: st.target, moved: false };
    st.pressTo = 1;
    root.current?.setPointerCapture(e.pointerId);
    kick();
  };
  const move = (e) => {
    const st = s.current,
      d = st.drag;
    if (!d || !st.travel) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    if (!d.moved) return;
    let p = d.p + dx / st.travel;
    if (p < 0) p = -(1 - 1 / (1 - p * 3)) / 3;
    else if (p > 1) p = 1 + (1 - 1 / (1 + (p - 1) * 3)) / 3;
    st.target = p;
    kick();
  };
  const up = (e) => {
    const st = s.current,
      d = st.drag;
    if (!d) return;
    st.drag = null;
    st.pressTo = 0;
    let to;
    if (d.moved) to = st.p + st.v * 0.12 > 0.5 ? 1 : 0;
    else {
      const r = root.current.getBoundingClientRect();
      to = e.clientX - r.left > r.width / 2 ? 1 : 0;
    }
    if (e.type === "pointercancel") to = value === "faceless" ? 1 : 0;
    pick(MODES[to]);
    btns.current[to]?.focus({ preventScroll: true });
  };
  const key = (e) => {
    const m =
      e.key === "ArrowLeft" || e.key === "ArrowUp"
        ? "personal"
        : e.key === "ArrowRight" || e.key === "ArrowDown"
          ? "faceless"
          : e.key === "Home"
            ? "personal"
            : e.key === "End"
              ? "faceless"
              : null;
    if (!m) return;
    e.preventDefault();
    pick(m);
    btns.current[MODES.indexOf(m)]?.focus();
  };
  return (
    <div
      ref={root}
      className="brand-switch"
      role="radiogroup"
      aria-label="Brand type"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <svg className="bsw-defs" aria-hidden="true" width="0" height="0">
        {map && (
          <filter id={FILTER} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feImage href={map.url} x="0" y="0" width={map.w} height={map.h} preserveAspectRatio="none" result="map" />
            {["r", "g", "b"].map((ch, i) => (
              <Fragment key={ch}>
                <feDisplacementMap
                  ref={(el) => {
                    if (el) disp.current[i] = el;
                  }}
                  in="SourceGraphic"
                  in2="map"
                  scale={REST}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result={`d${ch}`}
                />
                <feColorMatrix in={`d${ch}`} type="matrix" result={`c${ch}`} values={CHANNEL[i]} />
              </Fragment>
            ))}
            <feComposite in="cr" in2="cg" operator="arithmetic" k2="1" k3="1" result="rg" />
            <feComposite in="rg" in2="cb" operator="arithmetic" k2="1" k3="1" />
          </filter>
        )}
      </svg>
      <span className="bsw-labels bsw-under" aria-hidden="true">
        {MODES.map((m) => (
          <span key={m} className={`bsw-opt ${m}`}>
            {LABELS[m]}
          </span>
        ))}
      </span>
      <span ref={thumb} className="bsw-glass" aria-hidden="true" />
      <span className="bsw-labels bsw-top">
        {MODES.map((m, i) => (
          <button
            key={m}
            ref={(el) => {
              btns.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === m}
            tabIndex={value === m ? 0 : -1}
            className={`bsw-opt ${m}`}
            onClick={(e) => {
              if (e.detail === 0) pick(m);
            }}
          >
            {LABELS[m]}
          </button>
        ))}
      </span>
    </div>
  );
}
