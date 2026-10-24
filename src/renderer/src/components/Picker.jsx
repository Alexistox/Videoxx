import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { fold } from "../lib/fold";

export function Popover({ anchor, open, onClose, children, width, className = "", side, swallowClick, maxHeight = 380 }) {
  const ref = useRef(null),
    sideRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [mounted, setMounted] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  const swallow = useRef(swallowClick);
  swallow.current = swallowClick;
  useEffect(() => {
    if (open) setMounted(true);
    else {
      const t = setTimeout(() => setMounted(false), 120);
      return () => clearTimeout(t);
    }
  }, [open]);
  const natural = () => {
    const m = ref.current;
    if (!m) return 0;
    let h = m.offsetHeight;
    m.querySelectorAll(".pk-list").forEach((l) => {
      h += l.scrollHeight - l.clientHeight;
    });
    return h;
  };
  const upRef = useRef(null);
  const place = (keepSide = false) => {
    const a = anchor.current;
    if (!a) return;
    const r = a.getBoundingClientRect(),
      vh = innerHeight;
    let w = Math.max(r.width, width ?? 0);
    if (side && r.left + w + 246 > innerWidth && r.left - 246 < 8) w = Math.max(width ?? 240, Math.min(w, innerWidth - r.left - 254));
    const below = vh - r.bottom - 12,
      above = r.top - 12,
      need = natural();
    const up = keepSide && upRef.current !== null ? upRef.current : below < (need ? Math.min(maxHeight, need) : 220) && above > below;
    upRef.current = up;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    if (maxHeight === Infinity && need > Math.max(above, below) && need <= vh - 16) {
      setPos({ left, top: Math.max(8, vh - 8 - need), width: w, up: false, max: vh - 16 });
      return;
    }
    setPos({ left, top: up ? r.top - 6 : r.bottom + 6, width: w, up, max: Math.max(140, Math.min(maxHeight, up ? above : below)) });
  };
  useLayoutEffect(() => {
    if (open) {
      upRef.current = null;
      place();
    }
  }, [open, width]);
  const measured = useRef(false);
  useLayoutEffect(() => {
    if (!open) {
      measured.current = false;
      return;
    }
    if (pos && !measured.current) {
      measured.current = true;
      place();
    }
  }, [open, pos]);
  useEffect(() => {
    const m = ref.current;
    if (!open || !m) return;
    const mo = new MutationObserver(() => place(true));
    mo.observe(m, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [open, !!pos]);
  useEffect(() => {
    if (!open) return;
    const down = (e) => {
      const t = e.target;
      if (ref.current?.contains(t) || sideRef.current?.contains(t) || anchor.current?.contains(t)) return;
      e.stopPropagation();
      close.current();
      if (swallow.current && e.button === 0) {
        const eat = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        const stop = () => {
          document.removeEventListener("click", eat, true);
          document.removeEventListener("mousedown", stop, true);
        };
        document.addEventListener("click", eat, true);
        document.addEventListener("mousedown", stop, true);
        document.addEventListener("mouseup", () => setTimeout(stop, 0), { capture: true, once: true });
      }
    };
    const scroll = (e) => {
      if (!ref.current?.contains(e.target)) place();
    };
    const resize = () => place();
    document.addEventListener("mousedown", down, true);
    addEventListener("resize", resize);
    document.addEventListener("scroll", scroll, true);
    const modals = () => document.querySelectorAll('[aria-modal="true"]').length,
      n = modals();
    const mo = new MutationObserver(() => {
      if (modals() > n) close.current();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("mousedown", down, true);
      removeEventListener("resize", resize);
      document.removeEventListener("scroll", scroll, true);
      mo.disconnect();
    };
  }, [open]);
  if (!(open || mounted) || !pos) return null;
  const sideLeft = pos.left + pos.width + 10 + 236 < innerWidth ? pos.left + pos.width + 10 : pos.left - 10 - 236;
  return createPortal(
    <>
      <div
        ref={ref}
        className={`pk-menu ${pos.up ? "up" : ""} ${open ? "" : "out"} ${className}`}
        style={{ left: pos.left, width: pos.width, maxHeight: pos.max, ...(pos.up ? { bottom: innerHeight - pos.top } : { top: pos.top }) }}
        onMouseDown={(e) => {
          if (!e.target.closest("input, textarea")) e.preventDefault();
        }}
      >
        {children}
      </div>
      {side && open && sideLeft > 8 && (
        <div
          ref={sideRef}
          className={`pk-side ${pos.up ? "up" : ""}`}
          style={{ left: sideLeft, ...(pos.up ? { bottom: innerHeight - pos.top } : { top: pos.top }) }}
        >
          {side}
        </div>
      )}
    </>,
    document.body,
  );
}
export function MenuList({ id, options, active, value, onHover, onPick, empty, label, focusable }) {
  const list = useRef(null);
  const [glide, setGlide] = useState({ y: 0, h: 0, on: false, jump: true });
  useLayoutEffect(() => {
    const el = list.current?.querySelector(`[data-i="${active}"]`);
    if (!el) {
      setGlide((g) => ({ ...g, on: false }));
      return;
    }
    setGlide((g) => ({ y: el.offsetTop, h: el.offsetHeight, on: true, jump: !g.on }));
    const box = list.current,
      top = el.offsetTop,
      bottom = top + el.offsetHeight;
    if (top < box.scrollTop + 4) box.scrollTop = top - 4;
    else if (bottom > box.scrollTop + box.clientHeight - 4) box.scrollTop = bottom - box.clientHeight + 4;
  }, [active, options]);
  let group;
  return (
    <div
      ref={list}
      id={id}
      role="listbox"
      className="pk-list"
      onMouseLeave={() => onHover(-1)}
      aria-label={label}
      tabIndex={focusable ? -1 : void 0}
      aria-activedescendant={focusable && options[active] ? `${id}-${active}` : void 0}
    >
      <i
        className={`pk-glide ${glide.on ? "on" : ""} ${glide.jump ? "jump" : ""}`}
        style={{ transform: `translateY(${glide.y}px)`, height: glide.h }}
        aria-hidden="true"
      />
      {!options.length && <div className="pk-empty">{empty ?? "Nothing here"}</div>}
      {options.map((o, i) => {
        const head =
          o.group && o.group !== group ? (
            <div className="pk-group" role="presentation">
              {o.group}
            </div>
          ) : null;
        group = o.group;
        return (
          <Fragment key={o.value}>
            {head}
            <div
              role="option"
              id={`${id}-${i}`}
              data-i={i}
              data-value={o.value}
              aria-selected={o.value === value}
              aria-disabled={o.disabled || void 0}
              className={`pk-opt ${o.disabled ? "off" : ""} ${o.value === value ? "sel" : ""} ${o.hint ? "two" : ""}`}
              onMouseMove={() => {
                if (!o.disabled && i !== active) onHover(i);
              }}
              onClick={() => !o.disabled && onPick(o)}
            >
              {o.icon != null && <span className="pk-ico">{o.icon}</span>}
              <span className="pk-txt">
                <b>
                  {o.label}
                  {o.badge && <em className="pk-badge">{o.badge}</em>}
                </b>
                {o.hint && <small>{o.hint}</small>}
              </span>
              {o.value === value && <CheckIcon className="pk-check" size={14} strokeWidth={2.2} />}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
function Peek({ o }) {
  if (!o?.preview?.video && !o?.preview?.poster) return null;
  return (
    <div key={o.value} className={`pk-peek ${o.preview.tall ? "tall" : o.preview.square ? "square" : ""}`}>
      {o.preview.video ? (
        <video src={o.preview.video} poster={o.preview.poster} autoPlay muted loop playsInline />
      ) : (
        <img src={o.preview.poster} alt="" />
      )}
      <span>
        <b>{o.label}</b>
        {o.hint && <small>{o.hint}</small>}
      </span>
    </div>
  );
}
const step = (opts, from, dir) => {
  for (let i = from + dir, n = 0; n < opts.length; i += dir, n++) {
    const j = (i + opts.length) % opts.length;
    if (!opts[j].disabled) return j;
  }
  return from;
};
function rank(o, s) {
  const words = fold(`${o.label} ${o.keywords ?? ""}`)
    .split(/[\s,·()\/]+/)
    .filter(Boolean);
  return fold(o.value) === s || words.includes(s) ? 0 : fold(o.label).startsWith(s) ? 1 : words.some((w) => w.startsWith(s)) ? 2 : 3;
}
export function Picker({
  id,
  value,
  options,
  onChange,
  placeholder = "Choose…",
  search,
  size,
  className = "",
  menuWidth,
  ariaLabel,
  disabled,
  trigger,
  typeAhead = true,
  searchGroups = true,
  searchHints = true,
}) {
  const auto = useId().replace(/:/g, ""),
    listId = `${id ?? auto}-list`;
  const btn = useRef(null),
    field = useRef(null);
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [active, setActive] = useState(-1);
  const typed = useRef({ s: "", t: 0 });
  const searchable = search ?? options.length > 8;
  const filter = (text) => {
    const s = fold(text.trim());
    if (!s) return options;
    return options.filter((o) =>
      fold(`${o.label} ${searchHints ? (o.hint ?? "") : ""} ${o.keywords ?? ""} ${searchGroups ? (o.group ?? "") : ""}`).includes(s),
    );
  };
  const shown = useMemo(() => filter(q), [q, options, searchGroups, searchHints]);
  const cur = options.find((o) => o.value === value);
  const show = (typedText = "") => {
    if (disabled) return;
    setQ(typedText);
    setActive(
      typedText
        ? filter(typedText).findIndex((o) => !o.disabled)
        : Math.max(
            0,
            options.findIndex((o) => o.value === value),
          ),
    );
    setOpen(true);
  };
  const hide = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const pick = (o) => {
    if (o.disabled) return;
    if (o.value !== value) onChange(o.value);
    hide();
  };
  useEffect(() => {
    if (open && searchable)
      requestAnimationFrame(() => {
        const f = field.current;
        if (f) {
          f.focus();
          f.setSelectionRange(f.value.length, f.value.length);
        }
      });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const s = fold(q.trim());
    if (!s) {
      setActive((a) => (shown[a] && !shown[a].disabled ? a : shown.findIndex((o) => !o.disabled)));
      return;
    }
    let best = -1,
      top = 9;
    shown.forEach((o, i) => {
      const r = rank(o, s) - (o.disabled ? 0 : 0.5);
      if (r < top) {
        top = r;
        best = i;
      }
    });
    setActive(best);
  }, [shown, open]);
  const keys = (e) => {
    const k = e.key;
    if (k === "Enter" && (e.ctrlKey || e.metaKey)) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter"].includes(k) || (k === " " && typeAhead)) {
        e.preventDefault();
        show();
      } else if (typeAhead && k.length === 1 && /\S/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (searchable) show(k);
        else {
          typed.current = { s: fold(k), t: Date.now() };
          show();
          const i = options.findIndex((o) => !o.disabled && fold(o.label).startsWith(fold(k)));
          if (i >= 0) setActive(i);
        }
      }
      return;
    }
    if (k === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hide();
    } else if (k === "ArrowDown") {
      e.preventDefault();
      setActive((a) => step(shown, a, 1));
    } else if (k === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(shown, a < 0 ? shown.length : a, -1));
    } else if (k === "Home" && !searchable) {
      e.preventDefault();
      setActive(step(shown, -1, 1));
    } else if (k === "End" && !searchable) {
      e.preventDefault();
      setActive(step(shown, shown.length, -1));
    } else if (k === "Enter" || (k === " " && !searchable)) {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (k === "Tab") {
      if (searchable) {
        e.preventDefault();
        e.stopPropagation();
      }
      hide();
    } else if (!searchable && k.length === 1 && /\S/.test(k)) {
      const now = Date.now(),
        t = typed.current;
      t.s = now - t.t < 700 ? t.s + fold(k) : fold(k);
      t.t = now;
      const i = shown.findIndex((o) => !o.disabled && fold(o.label).startsWith(t.s));
      if (i >= 0) setActive(i);
    }
  };
  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        className={`pk-trigger ${size ?? ""} ${open ? "open" : ""} ${className}`}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : void 0}
        aria-label={ariaLabel}
        aria-activedescendant={open && !searchable && active >= 0 ? `${listId}-${active}` : void 0}
        data-value={value}
        onClick={() => (open ? hide() : show())}
        onKeyDown={keys}
      >
        {trigger ? (
          trigger(cur)
        ) : cur ? (
          <>
            {cur.icon != null && <span className="pk-ico">{cur.icon}</span>}
            <span className="pk-val">{cur.label}</span>
          </>
        ) : (
          <span className="pk-val ph">{placeholder}</span>
        )}
        <ChevronDownIcon className="pk-chev" size={15} strokeWidth={1.8} />
      </button>
      <Popover anchor={btn} open={open} onClose={() => hide(false)} width={menuWidth} side={<Peek o={shown[active]} />}>
        {searchable && (
          <label className="pk-search">
            <SearchIcon size={14} strokeWidth={1.8} />
            <input
              ref={field}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={keys}
              placeholder="Search…"
              aria-label="Search"
              aria-controls={listId}
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : void 0}
            />
          </label>
        )}
        <MenuList
          id={listId}
          options={shown}
          active={active}
          value={value}
          onHover={(i) => i >= 0 && setActive(i)}
          onPick={pick}
          empty={q ? `Nothing matches "${q}"` : void 0}
        />
      </Popover>
    </>
  );
}
export function Segmented({ id, value, options, onChange, ariaLabel, className = "", disabled = false }) {
  const box = useRef(null);
  const [pill, setPill] = useState(null);
  useLayoutEffect(() => {
    const el = box.current?.querySelector('[aria-checked="true"]');
    if (!el) return;
    const fit = () => setPill({ x: el.offsetLeft, w: el.offsetWidth });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [value, options.length]);
  const keys = (e) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d || disabled) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value),
      n = options[(i + d + options.length) % options.length];
    onChange(n.value);
    requestAnimationFrame(() => box.current?.querySelector(`[data-value="${n.value}"]`)?.focus());
  };
  return (
    <div
      ref={box}
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || void 0}
      className={`pk-seg ${disabled ? "off" : ""} ${className}`}
      onKeyDown={keys}
      data-value={value}
    >
      {pill && <i className="pk-seg-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          data-value={o.value}
          disabled={disabled}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          <span>
            {o.label}
            {o.hint && <small>{o.hint}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}
