import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Download,
  Expand,
  FolderOpen,
  ImagePlus,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Star,
  Trash,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { ALT, MOD } from "../help/keys";
import { Busy, Spinner } from "../components/ui";
import { Lightbox } from "../components/Lightbox";
import { DEFAULTS, STATUS, cable, canFeed, fitSettings, nid, nodeHeight, port, ratio, refsOf, running } from "./board";
import { MentionField, usedRefs } from "./MentionField";

const COLORS = ["#ffffff", "#f5d76e", "#89bea4", "#84a9d8", "#e08a8a", "#111111"];
const clampZ = (z) => Math.min(4, Math.max(0.1, z));
const editable = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
export const BoardCanvas = forwardRef(function BoardCanvas2(p, ref) {
  const vp = useRef(null),
    world = useRef(null);
  const view = useRef({ ...p.data.view });
  const [sel, setSel] = useState(new Set());
  const [selEdge, setSelEdge] = useState(null);
  const [zoomPct, setZoomPct] = useState(Math.round(p.data.view.z * 100));
  const [wire, setWire] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [editing, setEditing] = useState(null);
  const [space, setSpace] = useState(false);
  const [light, setLight] = useState(null);
  const fresh = useRef(new Set()),
    freshEdges = useRef(new Set());
  const heights = useRef(new Map());
  const dataRef = useRef(p.data);
  dataRef.current = p.data;
  const P = useRef(p);
  P.current = p;
  const moving = useRef(0),
    save = useRef(0);
  const apply = useCallback(() => {
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
    w.classList.add("moving");
    clearTimeout(moving.current);
    moving.current = window.setTimeout(() => w.classList.remove("moving"), 160);
    clearTimeout(save.current);
    save.current = window.setTimeout(() => {
      setZoomPct(Math.round(v.z * 100));
      P.current.update((d) => ({ ...d, view: { ...v } }), false);
    }, 250);
  }, []);
  useLayoutEffect(() => {
    view.current = { ...p.data.view };
    apply();
  }, []);
  const anim = useRef(0);
  const animateTo = (t, ms = 260) => {
    cancelAnimationFrame(anim.current);
    const f = { ...view.current },
      t0 = performance.now(),
      ease = (k) => 1 - Math.pow(1 - k, 3);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms),
        e = ease(k);
      const z = f.z * Math.pow(t.z / f.z, e);
      view.current = { x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, z };
      apply();
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
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
  const bounds = (ids) => {
    const ns = dataRef.current.nodes.filter((n) => !ids || ids.has(n.id));
    if (!ns.length) return null;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of ns) {
      const h = nodeHeight(n, heights.current.get(n.id));
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.w);
      y1 = Math.max(y1, n.y + h);
    }
    return { x0, y0, x1, y1 };
  };
  const fit = (animate = true, ids) => {
    const b = bounds(ids),
      r = vp.current.getBoundingClientRect();
    if (!b) {
      const t2 = { x: r.width / 2, y: r.height / 2, z: 1 };
      animate ? animateTo(t2) : ((view.current = t2), apply());
      return;
    }
    const pad = 80,
      z = clampZ(Math.min(1.25, (r.width - pad * 2) / Math.max(1, b.x1 - b.x0), (r.height - pad * 2) / Math.max(1, b.y1 - b.y0)));
    const t = { z, x: r.width / 2 - ((b.x0 + b.x1) / 2) * z, y: r.height / 2 - ((b.y0 + b.y1) / 2) * z };
    animate ? animateTo(t, 380) : ((view.current = t), apply());
  };
  const viewCenter = () => {
    const r = vp.current.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };
  const addAt = (type, at) => {
    const c = at ?? viewCenter(),
      id = nid(type[0] + "_");
    const n =
      type === "prompt"
        ? { id, type, x: c.x - 190, y: c.y - 110, w: 380, text: "", ...DEFAULTS }
        : { id, type, x: c.x - 60, y: c.y - 24, w: 0, text: "", size: 40, weight: 700, color: "#ffffff" };
    fresh.current.add(id);
    P.current.update((d) => ({ ...d, nodes: [...d.nodes, n] }), true);
    setSel(new Set([id]));
    if (type === "text") setEditing(id);
    return id;
  };
  useImperativeHandle(ref, () => ({
    fit,
    centerOn: (id) => fit(true, new Set([id])),
    addAt: (t, at) => {
      addAt(t, at);
    },
    viewCenter,
  }));
  useEffect(() => {
    const el = vp.current;
    const wheel = (e) => {
      const t = e.target;
      if (!e.ctrlKey && !e.metaKey && t.closest("textarea, .mf-pop, .tn-scroll")) {
        const s = t.closest("textarea, .mf-pop, .tn-scroll");
        if (s.scrollHeight > s.clientHeight) return;
      }
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
    lastDown = useRef({ t: 0, had: false });
  const onDown = (e) => {
    if (e.button === 2) return;
    const t = e.target;
    const portEl = t.closest("[data-port]"),
      nodeEl = t.closest("[data-node]"),
      resizeEl = t.closest("[data-resize]");
    cancelAnimationFrame(anim.current);
    if (e.button === 1 || space || (!nodeEl && !portEl && !e.shiftKey && !t.closest(".tc-edge"))) {
      if (Date.now() - lastDown.current.t > 450) lastDown.current = { t: Date.now(), had: sel.size > 0 || !!selEdge || !!editing };
      if (!e.shiftKey && e.button === 0 && !space) {
        setSel(new Set());
        setSelEdge(null);
        setEditing(null);
      }
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y };
    } else if (!nodeEl && !portEl && e.shiftKey) {
      const w = toWorld(e.clientX, e.clientY);
      drag.current = { kind: "marquee", ...w, base: new Set(sel) };
      setMarquee({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
    } else if (portEl) {
      const w = toWorld(e.clientX, e.clientY);
      drag.current = { kind: "wire", from: portEl.dataset.port };
      setWire({ from: portEl.dataset.port, ...w, over: null });
    } else if (resizeEl && nodeEl) {
      const n = dataRef.current.nodes.find((x) => x.id === nodeEl.dataset.node),
        how = resizeEl.dataset.resize;
      const width0 = nodeEl.getBoundingClientRect().width / view.current.z;
      drag.current =
        how === "scale"
          ? { kind: "scale", id: n.id, sx: e.clientX, size0: n.size ?? 40, w0: n.w, width0, recorded: false }
          : how === "width"
            ? { kind: "twidth", id: n.id, sx: e.clientX, width0, recorded: false }
            : { kind: "resize", id: n.id, sx: e.clientX, w0: n.w, recorded: false };
    } else if (nodeEl) {
      if (editable(t) || t.closest("button, select, a, .tn-noDrag")) return;
      const id = nodeEl.dataset.node;
      let s = sel;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        s = new Set(sel);
        s.has(id) ? s.delete(id) : s.add(id);
      } else if (!sel.has(id)) s = new Set([id]);
      setSel(s);
      setSelEdge(null);
      if (editing !== id) setEditing(null);
      const starts = new Map(dataRef.current.nodes.filter((n) => s.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
      drag.current = { kind: "move", sx: e.clientX, sy: e.clientY, starts, moved: false, dup: e.altKey };
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
        for (const n of dataRef.current.nodes) {
          const h = nodeHeight(n, heights.current.get(n.id));
          if (n.x < x1 && n.x + n.w > x0 && n.y < y1 && n.y + h > y0) s.add(n.id);
        }
        setSel(s);
      } else if (d.kind === "wire") {
        const w = toWorld(cx, cy),
          el = document.elementFromPoint(cx, cy)?.closest("[data-node]");
        const from = dataRef.current.nodes.find((n) => n.id === d.from),
          to = dataRef.current.nodes.find((n) => n.id === el?.dataset.node);
        setWire({ from: d.from, ...w, over: canFeed(from, to) ? to.id : null });
      } else if (d.kind === "move") {
        const z = view.current.z,
          dx = (cx - d.sx) / z,
          dy = (cy - d.sy) / z;
        if (!d.moved && Math.hypot(cx - d.sx, cy - d.sy) < 3) return;
        if (!d.moved && d.dup) {
          const ids = [...d.starts.keys()],
            map = new Map(ids.map((id) => [id, nid(id.split("_")[0] + "_")]));
          P.current.update(
            (b) => ({
              ...b,
              nodes: [
                ...b.nodes,
                ...b.nodes
                  .filter((n) => map.has(n.id))
                  .map((n) => ({ ...n, id: map.get(n.id), x: Math.round(n.x + dx), y: Math.round(n.y + dy) })),
              ],
              edges: [
                ...b.edges,
                ...b.edges.filter((x) => map.has(x.to)).map((x) => ({ id: nid("e_"), from: map.get(x.from) ?? x.from, to: map.get(x.to) })),
              ],
            }),
            true,
          );
          d.starts = new Map(ids.map((id) => [map.get(id), d.starts.get(id)]));
          d.moved = true;
          setSel(new Set(map.values()));
          return;
        }
        P.current.update(
          (b) => ({
            ...b,
            nodes: b.nodes.map((n) =>
              d.starts.has(n.id) ? { ...n, x: Math.round(d.starts.get(n.id).x + dx), y: Math.round(d.starts.get(n.id).y + dy) } : n,
            ),
          }),
          !d.moved,
        );
        d.moved = true;
      } else if (d.kind === "resize") {
        const w = Math.max(120, Math.round(d.w0 + (cx - d.sx) / view.current.z));
        P.current.update((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === d.id ? { ...n, w } : n)) }), !d.recorded);
        d.recorded = true;
      } else if (d.kind === "twidth") {
        const w = Math.max(40, Math.round(d.width0 + (cx - d.sx) / view.current.z));
        P.current.update((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === d.id ? { ...n, w } : n)) }), !d.recorded);
        d.recorded = true;
      } else if (d.kind === "scale") {
        const k = Math.max(0.1, (d.width0 + (cx - d.sx) / view.current.z) / d.width0),
          size = Math.min(600, Math.max(8, Math.round(d.size0 * k)));
        P.current.update(
          (b) => ({
            ...b,
            nodes: b.nodes.map((n) => (n.id === d.id ? { ...n, size, w: d.w0 ? Math.round((d.w0 * size) / d.size0) : 0 } : n)),
          }),
          !d.recorded,
        );
        d.recorded = true;
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
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node]");
      const from = dataRef.current.nodes.find((n) => n.id === d.from),
        to = dataRef.current.nodes.find((n) => n.id === el?.dataset.node);
      setWire(null);
      if (canFeed(from, to)) connect(d.from, to.id);
      else if (!el && from && (from.type === "image" || from.type === "output")) {
        const w = toWorld(e.clientX, e.clientY),
          id = nid("p_");
        fresh.current.add(id);
        P.current.update(
          (b) => ({ ...b, nodes: [...b.nodes, { id, type: "prompt", x: w.x + 10, y: w.y - 26, w: 380, text: "", ...DEFAULTS }] }),
          true,
        );
        connect(d.from, id, false);
        setSel(new Set([id]));
      }
    }
  };
  const connect = (from, to, record = true) => {
    if (dataRef.current.edges.some((x) => x.from === from && x.to === to)) return;
    const id = nid("e_");
    freshEdges.current.add(id);
    P.current.update((b) => ({ ...b, edges: [...b.edges, { id, from, to }] }), record);
  };
  useEffect(() => {
    const down = (e) => {
      if (editable(e.target) || document.querySelector('[aria-modal="true"]')) return;
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
        setSel(new Set(dataRef.current.nodes.map((n) => n.id)));
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
        setSel(new Set());
        setSelEdge(null);
        setEditing(null);
      } else if (e.key === "!" || (e.shiftKey && e.code === "Digit1")) fit();
      else if (e.shiftKey && e.code === "Digit0") {
        const r = vp.current.getBoundingClientRect();
        zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1, true);
      } else if (e.key === "+" || e.key === "=") {
        const r = vp.current.getBoundingClientRect();
        zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.current.z * 1.25, true);
      } else if (e.key === "-") {
        const r = vp.current.getBoundingClientRect();
        zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.current.z / 1.25, true);
      } else if (k === "p") addAt("prompt");
      else if (k === "t") addAt("text");
      else if (e.key === "Enter" && sel.size === 1) {
        const n = dataRef.current.nodes.find((x) => sel.has(x.id));
        if (n?.type === "text") {
          e.preventDefault();
          setEditing(n.id);
        }
      }
    };
    const up = (e) => {
      if (e.key === " ") setSpace(false);
    };
    const paste = (e) => {
      if (editable(e.target)) return;
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (!f) return;
      e.preventDefault();
      const at = viewCenter(),
        r = new FileReader();
      const sp = sel.size === 1 ? dataRef.current.nodes.find((n) => sel.has(n.id) && n.type === "prompt") : null;
      r.onload = () => {
        const slot = sp ? refSlot(sp) : null,
          added = P.current.addData(String(r.result), slot ? { x: slot.x + 150, y: slot.y + 90 } : at);
        if (sp) attachTo(sp, added);
      };
      r.readAsDataURL(f);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("paste", paste);
    };
  });
  const remove = () => {
    if (selEdge) {
      P.current.update((b) => ({ ...b, edges: b.edges.filter((x) => x.id !== selEdge) }), true);
      setSelEdge(null);
      return;
    }
    if (!sel.size) return;
    P.current.update(
      (b) => ({ ...b, nodes: b.nodes.filter((n) => !sel.has(n.id)), edges: b.edges.filter((x) => !sel.has(x.from) && !sel.has(x.to)) }),
      true,
    );
    setSel(new Set());
  };
  const duplicate = () => {
    if (!sel.size) return;
    const map = new Map(),
      copies = [];
    for (const n of dataRef.current.nodes)
      if (sel.has(n.id)) {
        const id = nid(n.type[0] + "_");
        map.set(n.id, id);
        fresh.current.add(id);
        copies.push({ ...n, id, x: n.x + 40, y: n.y + 40, genId: n.type === "output" ? n.genId : void 0 });
      }
    const edges = dataRef.current.edges
      .filter((x) => map.has(x.to))
      .map((x) => ({ id: nid("e_"), from: map.get(x.from) ?? x.from, to: map.get(x.to) }));
    P.current.update((b) => ({ ...b, nodes: [...b.nodes, ...copies], edges: [...b.edges, ...edges] }), true);
    setSel(new Set(map.values()));
  };
  const promptAt = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest("[data-node]"),
      n = dataRef.current.nodes.find((q) => q.id === el?.dataset.node);
    return n?.type === "prompt" ? n : null;
  };
  const attachTo = async (prompt, added) => {
    const list = await added;
    list.forEach((n) => connect(n.id, prompt.id));
  };
  const refSlot = (prompt) => {
    const refs = dataRef.current.edges
      .filter((e) => e.to === prompt.id)
      .map((e) => dataRef.current.nodes.find((n) => n.id === e.from))
      .filter(Boolean);
    return refs.length
      ? { x: Math.min(...refs.map((n) => n.x)), y: Math.max(...refs.map((n) => n.y + nodeHeight(n, heights.current.get(n.id)))) + 44 }
      : { x: prompt.x - 380, y: prompt.y };
  };
  const onDrop = (e) => {
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY),
      target = promptAt(e.clientX, e.clientY);
    const paths = [...e.dataTransfer.files].map((f) => window.suite.pathForFile(f)).filter((f) => f && /\.(png|jpe?g|webp|gif)$/i.test(f));
    if (!paths.length) return;
    if (target) attachTo(target, P.current.addFiles(paths, refSlot(target)));
    else P.current.addFiles(paths, at);
  };
  const fileOf = (n) =>
    n.type === "image" ? (n.file ?? null) : n.type === "output" ? (n.genId ? (P.current.gens[n.genId]?.file ?? null) : null) : null;
  const urlOf = (file) => (file ? P.current.base + encodeURIComponent(file) : null);
  const nodes = p.data.nodes,
    byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const busyPrompts = useMemo(
    () =>
      new Set(
        nodes
          .filter((n) => n.type === "output" && running(p.gens[n.genId ?? ""]?.status))
          .map((n) => p.data.edges.find((e) => e.to === n.id)?.from)
          .filter(Boolean),
      ),
    [nodes, p.gens, p.data.edges],
  );
  const actions = useRef({});
  actions.current = {
    patch: (id, patch, record = true) =>
      P.current.update((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }), record),
    measure: (id, h) => heights.current.set(id, h),
    generate: (id) => P.current.generate(id),
    cancel: (g) => P.current.cancel(g),
    useAsThumb: (f) => P.current.useAsThumb(f),
    reveal: (f) => P.current.reveal(f),
    saveAs: (f) => P.current.saveAs(f),
    edit: (id) => setEditing(id),
    open: (id) => {
      const el = vp.current?.querySelector(`[data-node="${id}"] .tn-pic`);
      setLight({ id, from: el?.getBoundingClientRect() ?? null });
    },
    remove: (id) => {
      P.current.update(
        (b) => ({ ...b, nodes: b.nodes.filter((n) => n.id !== id), edges: b.edges.filter((x) => x.from !== id && x.to !== id) }),
        true,
      );
      setSel(new Set());
    },
  };
  const lightItems = useMemo(
    () =>
      nodes
        .filter((n) => n.type === "image" || n.type === "output")
        .map((n) => ({ id: n.id, file: fileOf(n), label: n.type === "image" ? (n.name ?? "Image") : "Generated image" }))
        .filter((i) => !!i.file)
        .map((i) => ({ ...i, url: urlOf(i.file) }))
        .sort((a, b) => {
          const na = byId.get(a.id),
            nb = byId.get(b.id);
          return na.y - nb.y || na.x - nb.x;
        }),
    [nodes, p.gens],
  );
  return (
    <div
      ref={vp}
      className={`tc ${space ? "panning" : ""} ${wire ? "wiring" : ""}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={(e) => {
        const under = document.elementFromPoint(e.clientX, e.clientY),
          nodeEl = under?.closest("[data-node]");
        if (nodeEl) {
          const n = dataRef.current.nodes.find((x) => x.id === nodeEl.dataset.node);
          if (n?.type === "text") setEditing(n.id);
          else if (
            n &&
            (n.type === "image" || (n.type === "output" && P.current.gens[n.genId ?? ""]?.status === "completed")) &&
            !under?.closest("button, textarea, select")
          )
            actions.current.open(n.id);
          return;
        }
        if (under?.closest(".tc-bar, .tc-edge, .lb") || lastDown.current.had) return;
        addAt("text", toWorld(e.clientX, e.clientY));
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
      }}
      onDrop={onDrop}
      tabIndex={-1}
      aria-label="Thumbnail canvas"
    >
      <div ref={world} className="tc-world">
        <svg className="tc-edges" aria-hidden>
          {p.data.edges.map((ed) => {
            const a = byId.get(ed.from),
              b = byId.get(ed.to);
            if (!a || !b) return null;
            const d = cable(
              port(a, "out", nodeHeight(a, heights.current.get(a.id))),
              port(b, "in", nodeHeight(b, heights.current.get(b.id))),
            );
            const live = b.type === "output" && running(p.gens[b.genId ?? ""]?.status),
              isNew = freshEdges.current.has(ed.id);
            return (
              <g key={ed.id} className={`tc-edge ${selEdge === ed.id ? "sel" : ""} ${live ? "live" : ""} ${isNew ? "new" : ""}`}>
                <path
                  className="hit"
                  d={d}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelEdge(ed.id);
                    setSel(new Set());
                  }}
                />
                <path className="line" d={d} pathLength={isNew ? 1 : void 0} onAnimationEnd={() => freshEdges.current.delete(ed.id)} />
              </g>
            );
          })}
          {wire &&
            (() => {
              const a = byId.get(wire.from);
              if (!a) return null;
              const s = port(a, "out", nodeHeight(a, heights.current.get(a.id)));
              const t = wire.over ? port(byId.get(wire.over), "in", 0) : { x: wire.x, y: wire.y };
              return <path className={`tc-wire ${wire.over ? "ok" : ""}`} d={cable(s, t)} />;
            })()}
        </svg>
        {nodes.map((n) => (
          <NodeView
            key={n.id}
            n={n}
            selected={sel.has(n.id)}
            editing={editing === n.id}
            fresh={fresh.current.has(n.id)}
            target={wire?.over === n.id}
            gen={n.type === "output" && n.genId ? p.gens[n.genId] : void 0}
            url={n.type === "image" ? urlOf(n.file ?? null) : null}
            refs={
              n.type === "prompt"
                ? refsOf(p.data, n.id, fileOf).map((r) => ({
                    name: r.name,
                    url: urlOf(r.file),
                    label: r.node.name ?? (r.node.type === "output" ? "Generated image" : "Image"),
                  }))
                : void 0
            }
            busy={busyPrompts.has(n.id)}
            models={p.models}
            hasKey={p.hasKey}
            act={actions}
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
      {!nodes.length && (
        <div className="tc-empty">
          <ImagePlus size={28} strokeWidth={1.3} />
          <b>Drop images here, or start with a prompt</b>
          <span>
            Connect images into a prompt as references (@img1, @img2 …), press Generate, and the result appears next to it. Double-click
            anywhere to write text.
          </span>
          <div className="row">
            <button className="btn small primary" onClick={() => addAt("prompt")}>
              <Sparkles size={14} />
              New prompt
            </button>
            <button className="btn small" onClick={() => P.current.pickImages(viewCenter())}>
              <ImagePlus size={14} />
              Add images
            </button>
          </div>
        </div>
      )}
      <div className="tc-bar" onPointerDown={(e) => e.stopPropagation()}>
        <button className="tc-btn" title="New prompt (P)" onClick={() => addAt("prompt")}>
          <Sparkles size={16} strokeWidth={1.7} />
          <span>Prompt</span>
        </button>
        <button className="tc-btn" title="Add images (or drop / paste them)" onClick={() => P.current.pickImages(viewCenter())}>
          <ImagePlus size={16} strokeWidth={1.7} />
          <span>Image</span>
        </button>
        <button className="tc-btn" title="Text (T, or double-click the canvas)" onClick={() => addAt("text")}>
          <Type size={16} strokeWidth={1.7} />
          <span>Text</span>
        </button>
        <i className="tc-sep" />
        <button
          className="tc-btn icon"
          title="Zoom out (-)"
          aria-label="Zoom out"
          onClick={() => {
            const r = vp.current.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.current.z / 1.25, true);
          }}
        >
          <ZoomOut size={16} strokeWidth={1.7} />
        </button>
        <button
          className="tc-zoom"
          title="Zoom to 100 % (Shift + 0)"
          onClick={() => {
            const r = vp.current.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1, true);
          }}
        >
          {zoomPct}%
        </button>
        <button
          className="tc-btn icon"
          title="Zoom in (+)"
          aria-label="Zoom in"
          onClick={() => {
            const r = vp.current.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.current.z * 1.25, true);
          }}
        >
          <ZoomIn size={16} strokeWidth={1.7} />
        </button>
        <button className="tc-btn icon" title="Fit everything (Shift + 1)" aria-label="Fit everything" onClick={() => fit()}>
          <Maximize2 size={15} strokeWidth={1.7} />
        </button>
      </div>
      {light && (
        <Lightbox
          items={lightItems}
          start={light.id}
          from={light.from}
          onClose={() => setLight(null)}
          actions={(it) => ({
            useAsThumb: () => P.current.useAsThumb(it.file),
            saveAs: () => P.current.saveAs(it.file),
            reveal: () => P.current.reveal(it.file),
            dragOut: () => P.current.dragOut(it.file),
          })}
        />
      )}
      <div className="tc-hint">
        {"Drag to pan · "}
        {ALT}
        {"+scroll or pinch to zoom · Shift+drag to select · "}
        {ALT}+drag to copy · drag from a dot to connect
      </div>
    </div>
  );
});
function TextEdit({ n, fixed, tstyle, act }) {
  const val = useRef(n.text ?? ""),
    first = useRef(true);
  useEffect(
    () => () => {
      if (!val.current.trim()) act.current.remove(n.id);
    },
    [],
  );
  return (
    <textarea
      className="tn-txt-edit"
      autoFocus
      defaultValue={n.text}
      wrap={fixed ? "soft" : "off"}
      style={{ ...tstyle, width: fixed ? "100%" : void 0 }}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        val.current = e.currentTarget.value;
        act.current.patch(n.id, { text: val.current }, first.current);
        first.current = false;
      }}
      onBlur={() => act.current.edit(null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) e.currentTarget.blur();
      }}
    />
  );
}
const NodeView = memo(function NodeView2({ n, selected, editing, fresh, target, gen, url, refs, busy, models, hasKey, act }) {
  const el = useRef(null);
  useLayoutEffect(() => {
    if (!el.current || (n.type !== "prompt" && n.type !== "text")) return;
    const ro = new ResizeObserver(() => act.current.measure(n.id, el.current.offsetHeight));
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [n.id, n.type]);
  const cls = `tn tn-${n.type} ${selected ? "sel" : ""} ${fresh ? "fresh" : ""} ${target ? "target" : ""}`;
  const style = { transform: `translate(${n.x}px, ${n.y}px)`, width: n.w };
  if (n.type === "text") {
    const fs = n.size ?? 40,
      fixed = (n.w ?? 0) > 0;
    const tstyle = { fontSize: fs, fontWeight: n.weight ?? 700, color: n.color ?? "#fff", whiteSpace: fixed ? "pre-wrap" : "pre" };
    return (
      <div
        ref={el}
        data-node={n.id}
        className={cls}
        style={{ ...style, width: fixed ? n.w : "max-content" }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          act.current.edit(n.id);
        }}
      >
        {editing ? (
          <TextEdit n={n} fixed={fixed} tstyle={tstyle} act={act} />
        ) : (
          <div className="tn-txt" style={tstyle}>
            {n.text || "Text"}
          </div>
        )}
        {selected && !editing && (
          <>
            <i className="tn-edge-r" data-resize="width" title="Drag to set the width (the text wraps)" />
            <i className="tn-corner" data-resize="scale" title="Drag to make the text bigger or smaller" />
          </>
        )}
        {selected && !editing && (
          <div className="tn-tools tn-noDrag" onPointerDown={(e) => e.stopPropagation()}>
            <button
              title="Smaller"
              aria-label="Smaller text"
              onClick={() => act.current.patch(n.id, { size: Math.max(8, Math.round(fs / 1.2)), w: fixed ? Math.round(n.w / 1.2) : 0 })}
            >
              <Minus size={13} />
            </button>
            <span className="tn-size">{fs}</span>
            <button
              title="Bigger"
              aria-label="Bigger text"
              onClick={() => act.current.patch(n.id, { size: Math.min(600, Math.round(fs * 1.2)), w: fixed ? Math.round(n.w * 1.2) : 0 })}
            >
              <Plus size={13} />
            </button>
            <button
              title="Bold"
              aria-label="Bold"
              className={(n.weight ?? 700) >= 700 ? "on" : ""}
              onClick={() => act.current.patch(n.id, { weight: (n.weight ?? 700) >= 700 ? 400 : 800 })}
            >
              <Bold size={13} />
            </button>
            {fixed && (
              <button title="Back to one line (no wrapping)" onClick={() => act.current.patch(n.id, { w: 0 })}>
                Auto width
              </button>
            )}
            {COLORS.map((c) => (
              <button
                key={c}
                className={`sw ${n.color === c ? "on" : ""}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                onClick={() => act.current.patch(n.id, { color: c })}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  if (n.type === "image")
    return (
      <div
        ref={el}
        data-node={n.id}
        className={cls}
        style={style}
        onDoubleClick={(e) => {
          e.stopPropagation();
          act.current.open(n.id);
        }}
      >
        <div className="tn-label">
          <span className="ellipsis">{n.name ?? "Image"}</span>
        </div>
        <div className="tn-pic" style={{ aspectRatio: n.iw && n.ih ? `${n.iw} / ${n.ih}` : "16 / 9" }}>
          {url ? <img src={url} alt={n.name ?? ""} draggable={false} decoding="async" /> : null}
        </div>
        <i className="tn-port out" data-port={n.id} title="Drag into a prompt to use as a reference" />
        <i className="tn-resize" data-resize />
        {selected && (
          <div className="tn-tools tn-noDrag" onPointerDown={(e) => e.stopPropagation()}>
            <button title="Open big (double-click)" aria-label="Open big" onClick={() => act.current.open(n.id)}>
              <Expand size={13} />
            </button>
            <button title="Use as the thumbnail of a video or project" onClick={() => act.current.useAsThumb(n.file)}>
              <Star size={13} />
              Use as thumbnail
            </button>
            <button title="Show in folder" aria-label="Show in folder" onClick={() => act.current.reveal(n.file)}>
              <FolderOpen size={13} />
            </button>
            <button title="Delete" aria-label="Delete" onClick={() => act.current.remove(n.id)}>
              <Trash size={13} />
            </button>
          </div>
        )}
      </div>
    );
  if (n.type === "output") {
    const st = gen?.status,
      done = st === "completed" && gen?.url,
      live = running(st);
    return (
      <div
        ref={el}
        data-node={n.id}
        className={`${cls} ${live ? "live" : ""} ${st === "failed" ? "bad" : ""}`}
        style={style}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (done) act.current.open(n.id);
        }}
      >
        <div className="tn-label">
          <Sparkles size={11} />
          <span className="ellipsis">{models.find((m) => m.id === gen?.model)?.label ?? "Output"}</span>
          {live && <span className="tn-st">{STATUS[st]}</span>}
        </div>
        <div className="tn-pic" style={{ aspectRatio: `1 / ${ratio(n.aspectHint)}` }}>
          {done ? (
            <img src={gen.url} alt="Generated" draggable={false} decoding="async" className="tn-reveal" />
          ) : live ? (
            <div className="tn-shimmer">
              <Busy text={STATUS[st]} since={new Date(gen.created_at).getTime() || void 0} size={18} kind="orbit" />
            </div>
          ) : (
            <div className="tn-fail">
              <span>{gen?.error ?? (st === "canceled" ? "Cancelled." : "Nothing generated yet.")}</span>
            </div>
          )}
        </div>
        <i className="tn-port in" />
        <i className="tn-port out" data-port={n.id} title="Drag into a prompt to use this image as a reference" />
        <i className="tn-resize" data-resize />
        {selected && (
          <div className="tn-tools tn-noDrag" onPointerDown={(e) => e.stopPropagation()}>
            {done && (
              <>
                <button title="Open big (double-click)" aria-label="Open big" onClick={() => act.current.open(n.id)}>
                  <Expand size={13} />
                </button>
                <button
                  className="accent"
                  title="Make this the thumbnail of a video or project"
                  onClick={() => act.current.useAsThumb(gen.file)}
                >
                  <Star size={13} />
                  Use as thumbnail
                </button>
                <button title="Save a copy" aria-label="Save a copy" onClick={() => act.current.saveAs(gen.file)}>
                  <Download size={13} />
                </button>
                <button title="Show in folder" aria-label="Show in folder" onClick={() => act.current.reveal(gen.file)}>
                  <FolderOpen size={13} />
                </button>
              </>
            )}
            {live && (
              <button onClick={() => act.current.cancel(gen.id)}>
                <X size={13} />
                Cancel
              </button>
            )}
            {st === "failed" && (
              <button onClick={() => act.current.generate(n.id)}>
                <RotateCcw size={13} />
                Try again
              </button>
            )}
            <button title="Delete" aria-label="Delete" onClick={() => act.current.remove(n.id)}>
              <Trash size={13} />
            </button>
          </div>
        )}
      </div>
    );
  }
  const used = usedRefs(n.text ?? "", refs ?? []),
    model = models.find((m) => m.id === n.model) ?? models[0];
  return (
    <div ref={el} data-node={n.id} className={`${cls} ${busy ? "busy" : ""}`} style={style}>
      <div className="tn-head">
        <Sparkles size={13} />
        <b>Prompt</b>
        <span className="grow" />
        {refs && refs.length > 0 && (
          <span className="tn-count">
            {refs.length}
            {" ref"}
            {refs.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <i className="tn-port in" title="Connect images here" />
      <i className="tn-port out" />
      {refs && refs.length > 0 && (
        <div className="tn-refs">
          {refs.map((r) => (
            <span key={r.name} className={`tn-ref ${used.has(r.name) ? "used" : ""}`} title={r.label}>
              {r.url ? <img src={r.url} alt="" draggable={false} /> : <i />}
              <b>@{r.name}</b>
              {r.url && (
                <span className="tn-ref-big">
                  <img src={r.url} alt="" />
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      <MentionField
        value={n.text ?? ""}
        onChange={(v) => act.current.patch(n.id, { text: v }, false)}
        refs={refs ?? []}
        rows={3}
        stopKeys
        className="tn-noDrag"
        placeholder={refs?.length ? "Describe the thumbnail. Type @ to use a reference…" : "Describe the thumbnail…"}
        onSubmit={() => act.current.generate(n.id)}
      />
      {model && (refs?.length ?? 0) > model.maxRefs && (
        <div className="tn-warn">
          {model.maxRefs
            ? `${model.label} takes ${model.maxRefs} reference${model.maxRefs === 1 ? "" : "s"}; ${refs.length} are connected.`
            : `${model.label} can't use references. Pick GPT Image 2.5, Grok, Qwen or Ideogram.`}
        </div>
      )}
      <div className="tn-foot tn-noDrag" onPointerDown={(e) => e.stopPropagation()}>
        <select
          value={model?.id}
          onChange={(e) => {
            const m = models.find((x) => x.id === e.target.value);
            act.current.patch(n.id, { model: e.target.value, ...fitSettings(m, n) });
          }}
          aria-label="Model"
          title={model?.note}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.short ?? m.label}
            </option>
          ))}
        </select>
        <select value={n.aspect ?? "16:9"} onChange={(e) => act.current.patch(n.id, { aspect: e.target.value })} aria-label="Aspect ratio">
          {(model?.aspects ?? ["16:9"]).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        {(model?.resolutions.length ?? 0) > 0 && (
          <select
            value={n.resolution ?? "2k"}
            onChange={(e) => act.current.patch(n.id, { resolution: e.target.value })}
            aria-label="Resolution"
          >
            {model.resolutions.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        )}
        <button
          className="btn tiny primary"
          disabled={!hasKey || !(n.text ?? "").trim()}
          title={!hasKey ? "Add your Higgsfield key first" : `Generate (${MOD}+Enter)`}
          onClick={() => act.current.generate(n.id)}
        >
          {busy ? <Spinner size={12} /> : <Sparkles size={12} />}Generate
        </button>
      </div>
      <i className="tn-resize" data-resize />
    </div>
  );
});
