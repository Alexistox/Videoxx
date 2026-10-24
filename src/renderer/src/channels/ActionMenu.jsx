import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon } from "lucide-react";
import { MenuList, Popover } from "../components/Picker";

export function ActionMenu({ at, items: given, onClose, width = 250, label = "Menu" }) {
  const [items] = useState(given);
  const point = useRef(null),
    el = useRef(null);
  el.current = at instanceof HTMLElement ? at : point.current;
  const [stack, setStack] = useState([]);
  const top = stack[stack.length - 1];
  const rows = useMemo(
    () =>
      top
        ? [{ value: "__back", label: top.title, icon: <ChevronLeftIcon size={15} strokeWidth={1.8} />, group: void 0 }, ...top.items]
        : items,
    [top, items],
  );
  const first = (l, from = 0) => {
    for (let i = from; i < l.length; i++) if (!l[i].disabled && l[i].value !== "__back") return i;
    return 0;
  };
  const [active, setActive] = useState(() => first(items));
  useEffect(() => setActive(first(rows)), [rows]);
  const close = useRef(onClose);
  close.current = onClose;
  const listId = `ch-menu-${useId().replace(/:/g, "")}`;
  const back = useRef(void 0);
  if (back.current === void 0) back.current = document.activeElement;
  const giveBack = () => {
    const b = back.current,
      a = document.activeElement;
    if (b?.isConnected && (!a || a === document.body || a.closest?.(".pk-menu"))) b.focus({ preventScroll: true });
  };
  useEffect(() => {
    const r = requestAnimationFrame(() => document.getElementById(listId)?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(r);
      giveBack();
    };
  }, []);
  const pick = (o) => {
    if (!o || o.disabled) return;
    if (o.value === "__back") {
      const f = top?.from ?? 0;
      setStack((s) => s.slice(0, -1));
      requestAnimationFrame(() => setActive(f));
      return;
    }
    if (o.sub) {
      setStack((s) => [...s, { title: o.subTitle ?? o.label, items: o.sub, from: rows.indexOf(o) }]);
      return;
    }
    giveBack();
    close.current();
    o.run?.();
  };
  const ref = useRef({ rows, active, pick, stack });
  ref.current = { rows, active, pick, stack };
  useEffect(() => {
    const step = (d) =>
      setActive((a) => {
        const l = ref.current.rows;
        for (let i = a + d, n = 0; n < l.length; i += d, n++) {
          const j = (i + l.length) % l.length;
          if (!l[j].disabled) return j;
        }
        return a;
      });
    const key = (e) => {
      const k = e.key,
        { rows: rows2, active: active2, pick: pick22, stack: stack2 } = ref.current;
      const eat = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (k === "Escape") {
        eat();
        if (stack2.length) pick22(rows2[0]);
        else close.current();
      } else if (k === "ArrowDown") {
        eat();
        step(1);
      } else if (k === "ArrowUp") {
        eat();
        step(-1);
      } else if (k === "Home") {
        eat();
        setActive(first(rows2));
      } else if (k === "End") {
        eat();
        setActive(rows2.length - 1);
      } else if (k === "Enter" || k === " ") {
        eat();
        pick22(rows2[active2]);
      } else if (k === "ArrowRight") {
        eat();
        if (rows2[active2]?.sub) pick22(rows2[active2]);
      } else if (k === "ArrowLeft" || k === "Backspace") {
        eat();
        if (stack2.length) pick22(rows2[0]);
      } else if (k === "Tab") {
        eat();
        close.current();
      } else if (k.length === 1 && /\S/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        eat();
        const s = k.toLowerCase(),
          i = rows2.findIndex((o, j2) => j2 > active2 && !o.disabled && o.label.toLowerCase().startsWith(s)),
          j = i >= 0 ? i : rows2.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(s));
        if (j >= 0) setActive(j);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const [, force] = useState(0);
  useLayoutEffect(() => {
    if (!(at instanceof HTMLElement)) force((n) => n + 1);
  }, []);
  return (
    <>
      {!(at instanceof HTMLElement) &&
        createPortal(<div ref={point} className="ch-point" style={{ left: at.x, top: at.y }} />, document.body)}
      <Popover anchor={el} open={!!el.current} onClose={onClose} width={width} className="ch-menu" swallowClick maxHeight={Infinity}>
        <div className="ch-menu-wrap" aria-label={label}>
          <MenuList
            id={listId}
            options={rows}
            active={active}
            onHover={(i) => i >= 0 && setActive(i)}
            onPick={pick}
            label={top ? `${label}: ${top.title}` : label}
            focusable
          />
        </div>
      </Popover>
    </>
  );
}
