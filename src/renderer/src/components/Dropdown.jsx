import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

export function Dropdown({ value, groups, onChange, ariaLabel, disabled, title, className = "", style, menuWidth }) {
  const [open, setOpen] = useState(false),
    [pos, setPos] = useState({}),
    [hi, setHi] = useState(-1);
  const btn = useRef(null),
    menu = useRef(null);
  const flat = groups.flatMap((g) => g.options),
    cur = flat.find((o) => o.value === value);
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.max(r.width, menuWidth ?? 0),
      h = Math.min(menu.current?.scrollHeight ?? 320, 360),
      below = innerHeight - r.bottom - 8;
    const up = below < h && r.top > below;
    setPos({
      left: Math.min(r.left, innerWidth - w - 8),
      width: w,
      maxHeight: Math.max(160, (up ? r.top : below) - 8),
      ...(up ? { bottom: innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setHi(flat.findIndex((o) => o.value === value));
    const down = (e) => {
      if (!btn.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false);
    };
    const follow = (e) => {
      if (menu.current?.contains(e.target)) return;
      const r = btn.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > innerHeight) setOpen(false);
      else place();
    };
    document.addEventListener("mousedown", down);
    addEventListener("scroll", follow, true);
    addEventListener("resize", follow);
    return () => {
      document.removeEventListener("mousedown", down);
      removeEventListener("scroll", follow, true);
      removeEventListener("resize", follow);
    };
  }, [open]);
  const pick = (v) => {
    setOpen(false);
    btn.current?.focus();
    if (v !== value) onChange(v);
  };
  const onKey = (e) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => (i + (e.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
    } else if ((e.key === "Enter" || e.key === " ") && flat[hi]) {
      e.preventDefault();
      pick(flat[hi].value);
    } else if (e.key === "Tab") setOpen(false);
  };
  let n = -1;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`dd-btn ${open ? "open" : ""} ${className}`}
        style={style}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-value={value}
        data-first={flat[0]?.label ?? ""}
        data-groups={groups
          .map((g) => g.label ?? "")
          .filter(Boolean)
          .join("|")}
        disabled={disabled}
        title={title}
        onClick={() => setOpen(!open)}
        onKeyDown={onKey}
      >
        <span className="ellipsis">{cur?.label ?? value}</span>
        <ChevronDownIcon size={14} className="dd-chev" />
      </button>
      {open &&
        createPortal(
          <div ref={menu} className="dd-menu" role="listbox" aria-label={ariaLabel} style={pos}>
            {groups.map((g, gi) => (
              <div key={gi} className="dd-group">
                {g.label && <div className="dd-label">{g.label}</div>}
                {g.options.map((o) => {
                  n++;
                  const i = n;
                  return (
                    <div
                      key={o.value}
                      role="option"
                      aria-selected={o.value === value}
                      data-dd-value={o.value}
                      className={`dd-opt${o.value === value ? " on" : ""}${i === hi ? " hi" : ""}`}
                      onMouseEnter={() => setHi(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o.value)}
                    >
                      <span className="grow">
                        <b>{o.label}</b>
                        {o.hint && <small>{o.hint}</small>}
                      </span>
                      {o.value === value && <CheckIcon size={14} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
