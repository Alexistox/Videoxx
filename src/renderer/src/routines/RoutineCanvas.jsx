import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleDashed,
  Hourglass,
  LoaderCircle,
  Maximize2,
  Plus,
  Search,
  SkipForward,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { ALT, MOD } from "../help/keys";
import { CATEGORY_LABEL, NODE, NODES, PORT_COLOR, PORT_LABEL, connectProblem, withDefaults } from "../../../../routines/nodes";
import { ICONS, summary } from "./summary";

const W = 252,
  PORT_Y = 25;
const clampZ = (z) => Math.min(2.5, Math.max(0.15, z));
const editable = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
const nid = (p = "n_") => p + Math.random().toString(36).slice(2, 10);
const cable = (a, b) => {
  if (b.x >= a.x + 40) {
    const dx = Math.max(60, Math.abs(b.x - a.x) * 0.5);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }
  const r = 12,
    o = 26,
    my = Math.abs(b.y - a.y) < 30 ? a.y + 110 : b.y > a.y ? b.y - 70 : b.y + 150,
    s1 = my > a.y ? 1 : -1,
    s2 = b.y > my ? 1 : -1;
  const ax = a.x + o,
    bx = b.x - o;
  return `M${a.x},${a.y} H${ax - r} Q${ax},${a.y} ${ax},${a.y + s1 * r} V${my - s1 * r} Q${ax},${my} ${ax - r},${my} H${bx + r} Q${bx},${my} ${bx},${my + s2 * r} V${b.y - s2 * r} Q${bx},${b.y} ${bx + r},${b.y} H${b.x}`;
};
const portOut = (n) => ({ x: n.x + W, y: n.y + PORT_Y });
const portIn = (n) => ({ x: n.x, y: n.y + PORT_Y });
export const RoutineCanvas = forwardRef(function RoutineCanvas2(p, ref) {
  const vp = useRef(null),
    world = useRef(null),
    pct = useRef(null);
  const view = useRef({ ...(p.graph.view ?? { x: 80, y: 120, z: 0.8 }) });
  const [selEdge, setSelEdge] = useState(null);
  const [wire, setWire] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [menu, setMenu] = useState(null);
  const [flash, setFlash] = useState(null);
  const [space, setSpace] = useState(false);
  const heights = useRef(new Map());
  const gRef = useRef(p.graph);
  gRef.current = p.graph;
  const P = useRef(p);
  P.current = p;
  const save = useRef(0);
  const apply = () => {
    const v = view.current,
      w = world.current,
      el = vp.current;
    if (!w || !el) return;
    w.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    let step = 24;
    while (step * v.z < 14) step *= 2;
    while (step * v.z > 56) step /= 2;
    const s = step * v.z;
    el.style.backgroundSize = `${s}px ${s}px`;
    el.style.backgroundPosition = `${v.x}px ${v.y}px`;
    if (pct.current) pct.current.textContent = `${Math.round(v.z * 100)}%`;
    clearTimeout(save.current);
    save.current = window.setTimeout(() => P.current.update((g) => ({ ...g, view: { ...view.current } }), false), 300);
  };
  useLayoutEffect(() => {
    apply();
  }, []);
  const anim = useRef(0);
  const animateTo = (t, ms = 280) => {
    cancelAnimationFrame(anim.current);
    const f = { ...view.current },
      t0 = performance.now(),
      ease = (k) => 1 - Math.pow(1 - k, 3);
    const tick = (nw) => {
      const k = Math.min(1, (nw - t0) / ms),
        e = ease(k);
      view.current = { x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, z: f.z * Math.pow(t.z / f.z, e) };
      apply();
      if (k < 1) anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  };
  const toWorld = (cx, cy) => {
    const r = vp.current.getBoundingClientRect(),
      v = view.current;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  };
  const zoomAt = (cx, cy, z, animate = false) => {
    const r = vp.current.getBoundingClientRect(),
      v = view.current,
      nz = clampZ(z),
      px = cx - r.left,
      py = cy - r.top;
    const t = { x: px - ((px - v.x) * nz) / v.z, y: py - ((py - v.y) * nz) / v.z, z: nz };
    if (animate) animateTo(t, 200);
    else {
      view.current = t;
      apply();
    }
  };
  const zoomCenter = (k) => {
    const r = vp.current.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, k === 0 ? 1 : view.current.z * k, true);
  };
  const hOf = (n) => heights.current.get(n.id) ?? 110;
  const fit = (animate = true, ids) => {
    const ns = gRef.current.nodes.filter((n) => !ids || ids.has(n.id)),
      r = vp.current.getBoundingClientRect();
    if (!ns.length) {
      const t2 = { x: r.width / 2 - 120, y: r.height / 2 - 60, z: 1 };
      animate ? animateTo(t2) : ((view.current = t2), apply());
      return;
    }
    const x0 = Math.min(...ns.map((n) => n.x)),
      y0 = Math.min(...ns.map((n) => n.y)),
      x1 = Math.max(...ns.map((n) => n.x + W)),
      y1 = Math.max(...ns.map((n) => n.y + hOf(n)));
    const pad = 70,
      z = clampZ(Math.min(1.1, (r.width - pad * 2) / Math.max(1, x1 - x0), (r.height - pad * 2) / Math.max(1, y1 - y0)));
    const t = { z, x: r.width / 2 - ((x0 + x1) / 2) * z, y: r.height / 2 - ((y0 + y1) / 2) * z };
    animate ? animateTo(t, 380) : ((view.current = t), apply());
  };
  const viewCenter = () => {
    const r = vp.current.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };
  const addNode = (type, at, from) => {
    if (P.current.readOnly) return;
    const c = at ?? viewCenter(),
      id = nid();
    const n = withDefaults({ id, type, x: Math.round(c.x - (at ? 0 : W / 2)), y: Math.round(c.y - (at ? PORT_Y : 50)), settings: {} });
    const fromN = from ? gRef.current.nodes.find((x) => x.id === from) : void 0;
    const edge = fromN && !connectProblem(fromN, n, gRef.current.edges) ? { id: nid("e_"), from: fromN.id, to: id } : null;
    P.current.update((g) => ({ ...g, nodes: [...g.nodes, n], edges: edge ? [...g.edges, edge] : g.edges }), true);
    P.current.setSelected(new Set([id]));
  };
  const panTo = (id) => {
    const n = gRef.current.nodes.find((x) => x.id === id),
      el = vp.current;
    if (!n || !el) return;
    const r = el.getBoundingClientRect(),
      z = view.current.z;
    animateTo({ z, x: r.width / 2 - (n.x + W / 2) * z, y: r.height / 2 - (n.y + hOf(n) / 2) * z }, 700);
  };
  useImperativeHandle(ref, () => ({ fit, centerOn: (id) => fit(true, new Set([id])), addNode: (t) => addNode(t), panTo }));
  useEffect(() => {
    if (!p.graph.view) setTimeout(() => fit(false), 30);
  }, []);
  useEffect(() => {
    const el = vp.current;
    const wheel = (e) => {
      const t = e.target,
        sc = t.closest(".rc-menu-list, textarea");
      if (!e.ctrlKey && !e.metaKey && !e.altKey && sc && sc.scrollHeight > sc.clientHeight) return;
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey || e.altKey)
        zoomAt(
          e.clientX,
          e.clientY,
          view.current.z * Math.exp(-(e.deltaY || e.deltaX) * k * (e.ctrlKey && Math.abs(e.deltaY) < 20 ? 0.012 : 22e-4)),
        );
      else {
        const v = view.current;
        view.current = { ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX) * k, y: v.y - (e.shiftKey ? 0 : e.deltaY) * k };
        apply();
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const drag = useRef(null),
    raf = useRef(0),
    lastEmpty = useRef({ t: 0, x: 0, y: 0 });
  const nodeAt = (cx, cy) => {
    const el = document.elementFromPoint(cx, cy)?.closest("[data-rnode]");
    return el ? gRef.current.nodes.find((n) => n.id === el.dataset.rnode) : void 0;
  };
  const onDown = (e) => {
    if (e.button === 2) return;
    const t = e.target;
    if (t.closest(".rc-bar, .rc-menu, .rc-flash")) return;
    const portEl = t.closest("[data-out]"),
      nodeEl = t.closest("[data-rnode]");
    cancelAnimationFrame(anim.current);
    setMenu(null);
    if (e.button === 1 || space || (!nodeEl && !t.closest(".rc-edge") && !e.shiftKey)) {
      if (e.button === 0 && !space && !nodeEl) {
        const l = lastEmpty.current;
        if (Date.now() - l.t < 380 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 6) {
          lastEmpty.current = { t: 0, x: 0, y: 0 };
          openMenu(e.clientX, e.clientY, null);
          return;
        }
        lastEmpty.current = { t: Date.now(), x: e.clientX, y: e.clientY };
        if (!e.shiftKey) {
          P.current.setSelected(new Set());
          setSelEdge(null);
        }
      }
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y };
    } else if (!nodeEl && e.shiftKey) {
      const w = toWorld(e.clientX, e.clientY);
      drag.current = { kind: "marquee", ...w, base: new Set(P.current.selected) };
      setMarquee({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
    } else if (portEl && !P.current.readOnly) {
      const w = toWorld(e.clientX, e.clientY);
      drag.current = { kind: "wire", from: portEl.dataset.out };
      setWire({ from: portEl.dataset.out, ...w, over: null, bad: null });
    } else if (nodeEl) {
      if (editable(t) || t.closest("button, select, a")) return;
      const id = nodeEl.dataset.rnode,
        cur = P.current.selected;
      let s = cur;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        s = new Set(cur);
        s.has(id) ? s.delete(id) : s.add(id);
      } else if (!cur.has(id)) s = new Set([id]);
      P.current.setSelected(s);
      setSelEdge(null);
      const starts = new Map(gRef.current.nodes.filter((n) => s.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
      drag.current = { kind: "move", sx: e.clientX, sy: e.clientY, starts, moved: false };
    } else return;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const cx = e.clientX,
      cy = e.clientY;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (d.kind === "pan") {
        view.current = { ...view.current, x: d.vx + cx - d.sx, y: d.vy + cy - d.sy };
        apply();
      } else if (d.kind === "marquee") {
        const w = toWorld(cx, cy);
        setMarquee({ x0: d.x, y0: d.y, x1: w.x, y1: w.y });
        const x0 = Math.min(d.x, w.x),
          x1 = Math.max(d.x, w.x),
          y0 = Math.min(d.y, w.y),
          y1 = Math.max(d.y, w.y),
          s = new Set(d.base);
        for (const n of gRef.current.nodes) if (n.x < x1 && n.x + W > x0 && n.y < y1 && n.y + hOf(n) > y0) s.add(n.id);
        P.current.setSelected(s);
      } else if (d.kind === "wire") {
        const w = toWorld(cx, cy),
          to = nodeAt(cx, cy),
          from = gRef.current.nodes.find((n) => n.id === d.from);
        const bad = to && to.id !== d.from ? connectProblem(from, to, gRef.current.edges) : null;
        setWire({ from: d.from, ...w, over: to && !bad && to.id !== d.from ? to.id : null, bad: to && to.id !== d.from ? bad : null });
      } else if (d.kind === "move" && !P.current.readOnly) {
        const z = view.current.z,
          dx = (cx - d.sx) / z,
          dy = (cy - d.sy) / z;
        if (!d.moved && Math.hypot(cx - d.sx, cy - d.sy) < 3) return;
        P.current.update(
          (g) => ({
            ...g,
            nodes: g.nodes.map((n) =>
              d.starts.has(n.id) ? { ...n, x: Math.round(d.starts.get(n.id).x + dx), y: Math.round(d.starts.get(n.id).y + dy) } : n,
            ),
          }),
          !d.moved,
        );
        d.moved = true;
      }
    });
  };
  const onUp = (e) => {
    const d = drag.current;
    drag.current = null;
    cancelAnimationFrame(raf.current);
    if (!d) return;
    if (d.kind === "marquee") setMarquee(null);
    if (d.kind === "wire") {
      setWire(null);
      const to = nodeAt(e.clientX, e.clientY),
        from = gRef.current.nodes.find((n) => n.id === d.from);
      if (to && to.id !== d.from) {
        const bad = connectProblem(from, to, gRef.current.edges);
        if (bad) {
          const r = vp.current.getBoundingClientRect();
          setFlash({ x: e.clientX - r.left, y: e.clientY - r.top, text: bad });
        } else P.current.update((g) => ({ ...g, edges: [...g.edges, { id: nid("e_"), from: d.from, to: to.id }] }), true);
      } else if (!to) openMenu(e.clientX, e.clientY, d.from);
    }
  };
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);
  const openMenu = (cx, cy, from) => {
    if (P.current.readOnly) return;
    const r = vp.current.getBoundingClientRect(),
      w = toWorld(cx, cy);
    setMenu({ sx: Math.min(cx - r.left, r.width - 300), sy: Math.min(cy - r.top, r.height - 380), wx: w.x, wy: w.y, from });
  };
  useEffect(() => {
    const down = (e) => {
      if (editable(e.target) || document.querySelector('[aria-modal="true"]')) return;
      if (!vp.current?.isConnected) return;
      const mod = e.ctrlKey || e.metaKey,
        k = e.key.toLowerCase();
      if (e.key === " " && !e.repeat) {
        setSpace(true);
        e.preventDefault();
        return;
      }
      if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? P.current.redo() : P.current.undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        P.current.redo();
        return;
      }
      if (mod && k === "a") {
        e.preventDefault();
        P.current.setSelected(new Set(gRef.current.nodes.map((n) => n.id)));
        return;
      }
      if (mod && k === "d") {
        e.preventDefault();
        duplicate();
        return;
      }
      if (mod) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape") {
        P.current.setSelected(new Set());
        setSelEdge(null);
        setMenu(null);
      } else if (e.key === "!" || (e.shiftKey && e.code === "Digit1")) fit();
      else if (e.shiftKey && e.code === "Digit0") zoomCenter(0);
      else if (e.key === "+" || e.key === "=") zoomCenter(1.25);
      else if (e.key === "-") zoomCenter(1 / 1.25);
      else if (k === "m") toggleOff();
      else if (k === "n" || k === "a") {
        const r = vp.current.getBoundingClientRect();
        openMenu(r.left + r.width / 2 - 140, r.top + r.height / 2 - 160, null);
      }
    };
    const up = (e) => {
      if (e.key === " ") setSpace(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });
  const remove = () => {
    if (P.current.readOnly) return;
    if (selEdge) {
      P.current.update((g) => ({ ...g, edges: g.edges.filter((x) => x.id !== selEdge) }), true);
      setSelEdge(null);
      return;
    }
    const sel = P.current.selected;
    if (!sel.size) return;
    P.current.update(
      (g) => ({ ...g, nodes: g.nodes.filter((n) => !sel.has(n.id)), edges: g.edges.filter((x) => !sel.has(x.from) && !sel.has(x.to)) }),
      true,
    );
    P.current.setSelected(new Set());
  };
  const toggleOff = () => {
    const sel = P.current.selected;
    if (!sel.size || P.current.readOnly) return;
    const on = gRef.current.nodes.some((n) => sel.has(n.id) && n.off);
    P.current.update(
      (g) => ({ ...g, nodes: g.nodes.map((n) => (sel.has(n.id) && n.type !== "note" ? { ...n, off: on ? void 0 : true } : n)) }),
      true,
    );
  };
  const duplicate = () => {
    const sel = P.current.selected;
    if (!sel.size || P.current.readOnly) return;
    const map = new Map(),
      copies = [];
    for (const n of gRef.current.nodes)
      if (sel.has(n.id)) {
        const id = nid();
        map.set(n.id, id);
        copies.push({ ...n, id, x: n.x + 40, y: n.y + 60, settings: JSON.parse(JSON.stringify(n.settings)) });
      }
    const edges = gRef.current.edges
      .filter((x) => map.has(x.from) && map.has(x.to))
      .map((x) => ({ id: nid("e_"), from: map.get(x.from), to: map.get(x.to) }));
    P.current.update((g) => ({ ...g, nodes: [...g.nodes, ...copies], edges: [...g.edges, ...edges] }), true);
    P.current.setSelected(new Set(map.values()));
  };
  const byId = useMemo(() => new Map(p.graph.nodes.map((n) => [n.id, n])), [p.graph.nodes]);
  const measure = useRef((id, h) => {
    if (heights.current.get(id) !== h) heights.current.set(id, h);
  });
  const st = p.states;
  return (
    <div
      ref={vp}
      className={`tc rc ${space ? "panning" : ""} ${wire ? "wiring" : ""}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!e.target.closest("[data-rnode], .rc-bar, .rc-menu")) openMenu(e.clientX, e.clientY, null);
      }}
      tabIndex={-1}
      aria-label="Routine canvas"
    >
      <div ref={world} className="tc-world">
        <svg className="tc-edges" aria-hidden>
          {p.graph.edges.map((ed) => {
            const a = byId.get(ed.from),
              b = byId.get(ed.to);
            if (!a || !b) return null;
            const d = cable(portOut(a), portIn(b)),
              t = NODE[a.type]?.out ?? "any";
            const live = st && st[ed.from]?.status === "done" && st[ed.to]?.status === "running";
            const done = st && ["done", "warn"].includes(st[ed.from]?.status ?? "") && ["done", "warn"].includes(st[ed.to]?.status ?? "");
            return (
              <g
                key={ed.id}
                className={`tc-edge rc-edge ${selEdge === ed.id ? "sel" : ""} ${live ? "live" : ""} ${done ? "done" : ""}`}
                style={{ "--pc": PORT_COLOR[t] }}
              >
                <path
                  className="hit"
                  d={d}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelEdge(ed.id);
                    P.current.setSelected(new Set());
                  }}
                />
                <path className="line" d={d} />
              </g>
            );
          })}
          {wire &&
            (() => {
              const a = byId.get(wire.from);
              if (!a) return null;
              const t = wire.over ? portIn(byId.get(wire.over)) : { x: wire.x, y: wire.y };
              return <path className={`tc-wire ${wire.over ? "ok" : ""} ${wire.bad ? "bad" : ""}`} d={cable(portOut(a), t)} />;
            })()}
        </svg>
        {p.graph.nodes.map((n) => (
          <NodeCard
            key={n.id}
            n={n}
            selected={p.selected.has(n.id)}
            target={wire?.over === n.id}
            badTarget={!!wire?.bad && nodeOver(wire, n)}
            state={st?.[n.id] ?? null}
            problems={p.problems.get(n.id)}
            sctx={p.sctx}
            measure={measure}
            image={p.images?.[n.id] ?? null}
          />
        ))}
        {marquee && (
          <div
            className="tc-marquee"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
      </div>
      {!p.graph.nodes.length && (
        <div className="tc-empty">
          <Plus size={28} strokeWidth={1.3} />
          <b>An empty routine</b>
          <span>
            Add nodes with the + button, a right-click or a double-click, then connect them from the dot on their right edge. Or start from
            a template on the left.
          </span>
        </div>
      )}
      {menu && (
        <NodeMenu
          at={menu}
          from={menu.from ? (byId.get(menu.from) ?? null) : null}
          edges={p.graph.edges}
          onClose={() => setMenu(null)}
          onPick={(type) => {
            addNode(type, { x: menu.wx, y: menu.wy }, menu.from);
            setMenu(null);
          }}
        />
      )}
      {flash && (
        <div className="rc-flash" style={{ left: flash.x + 12, top: flash.y + 12 }} role="alert">
          <TriangleAlert size={13} />
          {flash.text}
        </div>
      )}
      <div className="tc-bar rc-bar" onPointerDown={(e) => e.stopPropagation()}>
        {!p.readOnly && (
          <>
            <button
              className="tc-btn"
              title="Add a node (N, right-click or double-click the canvas)"
              onClick={() => {
                const r = vp.current.getBoundingClientRect();
                openMenu(r.left + r.width / 2 - 140, r.top + r.height / 2 - 170, null);
              }}
            >
              <Plus size={16} strokeWidth={1.7} />
              <span>Add node</span>
            </button>
            <i className="tc-sep" />
          </>
        )}
        <button className="tc-btn icon" title="Zoom out (-)" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.25)}>
          <ZoomOut size={16} strokeWidth={1.7} />
        </button>
        <button ref={pct} className="tc-zoom" title="Zoom to 100 % (Shift + 0)" onClick={() => zoomCenter(0)}>
          100%
        </button>
        <button className="tc-btn icon" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomCenter(1.25)}>
          <ZoomIn size={16} strokeWidth={1.7} />
        </button>
        <button className="tc-btn icon" title="Fit everything (Shift + 1)" aria-label="Fit everything" onClick={() => fit()}>
          <Maximize2 size={15} strokeWidth={1.7} />
        </button>
      </div>
      <div
        className="tc-hint rc-hint"
        title={`Drag to pan · ${ALT}+scroll or pinch to zoom · Shift+drag to select · drag from a node's right dot to connect · M switches a node off · ${MOD}+Z undo`}
      >
        {"Drag to pan · "}
        {ALT}+scroll to zoom · drag a right dot to connect · M switches off
      </div>
    </div>
  );
});
const nodeOver = (w, n) => w.x >= n.x && w.x <= n.x + W && w.y >= n.y && w.y <= n.y + 160;
const STATE_ICON = {
  running: LoaderCircle,
  done: Check,
  failed: X,
  approval: Hourglass,
  waiting: CircleDashed,
  skipped: SkipForward,
  warn: TriangleAlert,
};
const STATE_LABEL = {
  running: "Working",
  done: "Done",
  failed: "Failed",
  approval: "Needs approval",
  waiting: "Waiting",
  skipped: "Skipped",
  warn: "Done, with a warning",
};
const NodeCard = memo(function NodeCard2({ n, selected, target, badTarget, state, problems, sctx, measure, image }) {
  const el = useRef(null),
    def = NODE[n.type];
  useLayoutEffect(() => {
    if (!el.current) return;
    const ro = new ResizeObserver(() => measure.current(n.id, el.current.offsetHeight));
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [n.id]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (state?.status !== "running") return;
    const t = setInterval(() => tick((x) => x + 1), 1e3);
    return () => clearInterval(t);
  }, [state?.status]);
  if (!def) return null;
  const Ic = ICONS[def.icon] ?? CircleDashed,
    lines = summary(n, sctx);
  if (n.type === "note")
    return (
      <div
        ref={el}
        data-rnode={n.id}
        className={`rn rn-note ${selected ? "sel" : ""}`}
        style={{ transform: `translate(${n.x}px, ${n.y}px)`, width: W }}
      >
        <div className="rn-note-text">{String(n.settings.text || "") || "Note: select it and write in the panel on the right."}</div>
      </div>
    );
  const SI = state ? (STATE_ICON[state.status] ?? CircleDashed) : null;
  const secs = state?.startedAt
    ? Math.round(((state.finishedAt ? Date.parse(state.finishedAt) : Date.now()) - Date.parse(state.startedAt)) / 1e3)
    : null;
  return (
    <div
      ref={el}
      data-rnode={n.id}
      className={`rn rn-${def.category} ${n.off ? "off" : ""} ${selected ? "sel" : ""} ${target ? "target" : ""} ${badTarget ? "bad-target" : ""} ${state ? "st-" + state.status : ""} ${problems?.length ? "has-problem" : ""}`}
      style={{ transform: `translate(${n.x}px, ${n.y}px)`, width: W }}
    >
      <div className="rn-head">
        <span className="rn-ic">
          <Ic size={14} strokeWidth={1.8} />
        </span>
        <b className="ellipsis">{def.label}</b>
        {n.off ? (
          <span className="rn-tag rn-offtag" title="Switched off: runs pass through it (M switches it back on)">
            Off
          </span>
        ) : (
          def.claude && (
            <span className="rn-tag" title="Uses Claude">
              Claude
            </span>
          )
        )}
        {problems?.length ? (
          <span className="rn-warn" title={problems.join("\n")}>
            <TriangleAlert size={13} />
          </span>
        ) : null}
      </div>
      {image && (
        <div className="rn-img">
          <img src={image} alt="" draggable={false} decoding="async" />
        </div>
      )}
      {lines.length > 0 && (
        <div className="rn-body">
          {lines.map((l, i) => (
            <div key={i} className={`ellipsis ${i ? "dim" : ""}`} title={l}>
              {l}
            </div>
          ))}
        </div>
      )}
      {state && SI && (
        <div className={`rn-state ${state.status}`} title={state.error || state.note || ""}>
          <SI size={12} className={state.status === "running" ? "spin" : ""} />
          <span className="ellipsis">
            {state.status === "failed"
              ? state.error || "Failed"
              : state.status === "running"
                ? state.log?.[state.log.length - 1] || STATE_LABEL.running
                : state.note || STATE_LABEL[state.status]}
          </span>
          {secs !== null && state.status !== "waiting" && (
            <small>{secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`}</small>
          )}
        </div>
      )}
      {state && ["done", "warn", "failed", "running", "approval"].includes(state.status) && (
        <span className={`rn-badge ${state.status}`} aria-label={STATE_LABEL[state.status]} title={STATE_LABEL[state.status]}>
          {state.status === "done" ? (
            <Check size={12} strokeWidth={3} />
          ) : state.status === "warn" ? (
            <TriangleAlert size={11} strokeWidth={2.4} />
          ) : state.status === "failed" ? (
            <X size={12} strokeWidth={3} />
          ) : state.status === "running" ? (
            <LoaderCircle size={12} strokeWidth={2.6} className="spin" />
          ) : (
            <Hourglass size={11} strokeWidth={2.4} />
          )}
        </span>
      )}
      {def.accepts && (
        <i
          className="rn-port in"
          style={{ "--pc": PORT_COLOR[def.accepts[0]] }}
          title={`Takes ${def.accepts.map((t) => PORT_LABEL[t]).join(" or ")}`}
        />
      )}
      {def.out && (
        <i
          className="rn-port out"
          data-out={n.id}
          style={{ "--pc": PORT_COLOR[def.out] }}
          title={`Gives ${PORT_LABEL[def.out]}: drag to connect`}
        />
      )}
    </div>
  );
});
function NodeMenu({ at, from, edges, onPick, onClose }) {
  const [qy, setQ] = useState(""),
    [i, setI] = useState(0);
  const list = useMemo(() => {
    const s = qy.trim().toLowerCase();
    return NODES.filter((d) => !from || !connectProblem(from, { id: "_new", type: d.type }, edges)).filter(
      (d) => !s || `${d.label} ${d.desc} ${CATEGORY_LABEL[d.category]}`.toLowerCase().includes(s),
    );
  }, [qy, from, edges]);
  useEffect(() => setI(0), [qy]);
  const groups = ["input", "production", "check", "publish", "note"]
    .map((c) => ({ c, items: list.filter((d) => d.category === c) }))
    .filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items);
  return (
    <div
      className="rc-menu"
      style={{ left: Math.max(8, at.sx), top: Math.max(8, at.sy) }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="rc-menu-search">
        <Search size={14} />
        <input
          autoFocus
          placeholder={from ? `What comes after ${NODE[from.type]?.label}?` : "Add a node…"}
          value={qy}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setI((x) => Math.min(flat.length - 1, x + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setI((x) => Math.max(0, x - 1));
            }
            if (e.key === "Enter" && flat[i]) onPick(flat[i].type);
          }}
        />
      </div>
      <div className="rc-menu-list">
        {groups.map((g) => (
          <div key={g.c}>
            <div className="rc-menu-cat">{CATEGORY_LABEL[g.c]}</div>
            {g.items.map((d) => {
              const Ic = ICONS[d.icon] ?? CircleDashed,
                k = flat.indexOf(d);
              return (
                <button
                  key={d.type}
                  className={`rc-menu-item rn-${d.category} ${k === i ? "on" : ""}`}
                  onMouseEnter={() => setI(k)}
                  onClick={() => onPick(d.type)}
                >
                  <span className="rn-ic">
                    <Ic size={14} strokeWidth={1.8} />
                  </span>
                  <span className="grow">
                    <b>
                      {d.label}
                      {d.claude ? <em>{" · Claude"}</em> : null}
                    </b>
                    <small>{d.desc}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {!flat.length && (
          <div className="rc-menu-empty">
            {from
              ? `Nothing takes ${PORT_LABEL[NODE[from.type]?.out ?? "any"]}${qy ? ` matching “${qy}”` : ""}.`
              : `No node matches “${qy}”.`}
          </div>
        )}
      </div>
    </div>
  );
}
