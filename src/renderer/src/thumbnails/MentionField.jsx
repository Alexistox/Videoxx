import { useLayoutEffect, useMemo, useRef, useState } from "react";

const TOKEN = /@([\w.-]+)/g;
export const usedRefs = (text, refs) => new Set([...text.matchAll(TOKEN)].map((m) => m[1]).filter((n) => refs.some((r) => r.name === n)));
export function MentionField({
  value,
  onChange,
  refs,
  placeholder,
  rows = 3,
  className = "",
  onSubmit,
  autoFocus,
  onFocus,
  onBlur,
  stopKeys,
}) {
  const ta = useRef(null),
    hl = useRef(null);
  const [pop, setPop] = useState(null);
  const matches = useMemo(
    () =>
      pop
        ? refs.filter(
            (r) => r.name.toLowerCase().startsWith(pop.q.toLowerCase()) || (r.label ?? "").toLowerCase().includes(pop.q.toLowerCase()),
          )
        : [],
    [pop, refs],
  );
  const parts = useMemo(() => {
    const out = [];
    let last = 0,
      k = 0;
    for (const m of value.matchAll(TOKEN)) {
      const known = refs.some((r) => r.name === m[1]);
      out.push(value.slice(last, m.index));
      out.push(
        known ? (
          <mark key={k++} className="mf-tok">
            {m[0]}
          </mark>
        ) : (
          m[0]
        ),
      );
      last = m.index + m[0].length;
    }
    out.push(value.slice(last) + "\n");
    return out;
  }, [value, refs]);
  const caret = useRef(null);
  useLayoutEffect(() => {
    if (caret.current !== null && ta.current) {
      ta.current.focus();
      ta.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
    if (hl.current && ta.current) hl.current.scrollTop = ta.current.scrollTop;
  });
  const check = (el) => {
    const c = el.selectionStart,
      before = el.value.slice(0, c),
      m = /@([\w.-]*)$/.exec(before);
    setPop(m && refs.length ? { q: m[1], at: c - m[0].length, i: 0 } : null);
  };
  const insert = (r) => {
    if (!pop || !ta.current) return;
    const el = ta.current,
      c = el.selectionStart,
      v = value.slice(0, pop.at) + "@" + r.name + " " + value.slice(c);
    caret.current = pop.at + r.name.length + 2;
    onChange(v);
    setPop(null);
  };
  return (
    <div className={`mf ${className}`} onPointerDown={(e) => stopKeys && e.stopPropagation()}>
      <div className="mf-hl" ref={hl} aria-hidden>
        {parts}
      </div>
      <textarea
        ref={ta}
        value={value}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        aria-label="Prompt"
        onChange={(e) => {
          onChange(e.target.value);
          check(e.target);
        }}
        onSelect={(e) => check(e.currentTarget)}
        onScroll={() => {
          if (hl.current && ta.current) hl.current.scrollTop = ta.current.scrollTop;
        }}
        onFocus={onFocus}
        onBlur={() => {
          setTimeout(() => setPop(null), 120);
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (stopKeys) e.stopPropagation();
          if (pop && matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setPop({ ...pop, i: (pop.i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length });
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              insert(matches[pop.i]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setPop(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {pop && matches.length > 0 && (
        <div className="mf-pop" role="listbox" aria-label="Reference images">
          {matches.map((r, i) => (
            <button
              key={r.name}
              role="option"
              aria-selected={i === pop.i}
              className={i === pop.i ? "on" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(r);
              }}
            >
              {r.url ? <img src={r.url} alt="" /> : <span className="mf-noimg" />}
              <b>@{r.name}</b>
              {r.label && <span>{r.label}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
