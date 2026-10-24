import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AudioLines,
  Box,
  File,
  FileText,
  Film,
  Image,
  Plus,
  TriangleAlert,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { MOD } from "../help/keys";
import { fmtSpan, fmtT, parseMentions, refMeta } from "./mentions";
import { useRefThumb, useRefs } from "./useRefs";

export const OPEN_REF_EVENT = "cz-open-ref";
export const openRef = (projectId, refId, o = {}) =>
  window.dispatchEvent(new CustomEvent(OPEN_REF_EVENT, { detail: { projectId, refId, ...o } }));
export const lastField = { insert: null };
export const newRangeId = () =>
  "rng_" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
export const KindIcon = ({ kind, size = 14 }) =>
  kind === "video" ? (
    <Film size={size} />
  ) : kind === "image" ? (
    <Image size={size} />
  ) : kind === "audio" ? (
    <AudioLines size={size} />
  ) : kind === "pdf" ? (
    <FileText size={size} />
  ) : kind === "model" ? (
    <Box size={size} />
  ) : (
    <File size={size} />
  );
const COPY = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "tab-size",
  "text-indent",
  "word-spacing",
];
export const MentionField = forwardRef(function MentionField2(
  { projectId, value, onChange, onAddReference, wrapClassName = "", className = "", onKeyDown, onScroll, corner, ...rest },
  fref,
) {
  const ta = useRef(null),
    mirror = useRef(null),
    wrap = useRef(null);
  const { refs } = useRefs(projectId);
  const byTag = useMemo(() => new Map((refs ?? []).map((r) => [r.tag, r])), [refs]);
  const mentions = useMemo(() => parseMentions(value), [value]);
  const replace = (a, b, text) => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(a, b);
    if (!document.execCommand("insertText", false, text)) {
      const v = el.value.slice(0, a) + text + el.value.slice(b);
      onChange(v);
      requestAnimationFrame(() => el.setSelectionRange(a + text.length, a + text.length));
    }
  };
  const handle = useRef(null);
  handle.current = {
    insert: (text) => {
      const el = ta.current;
      if (!el) return;
      const a = el.selectionStart ?? el.value.length,
        b = el.selectionEnd ?? a;
      const pre = a > 0 && !/\s/.test(el.value[a - 1]) ? " " : "",
        post = /^\S/.test(el.value.slice(b)) ? " " : "";
      replace(a, b, pre + text + (post || " "));
    },
    focus: () => ta.current?.focus(),
    el: () => ta.current,
  };
  useImperativeHandle(
    fref,
    () => ({ insert: (t) => handle.current.insert(t), focus: () => handle.current.focus(), el: () => ta.current }),
    [],
  );
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    const mine = (t) => handle.current.insert(t),
      f = () => {
        lastField.insert = mine;
      };
    el.addEventListener("focus", f);
    return () => {
      el.removeEventListener("focus", f);
      if (lastField.insert === mine) lastField.insert = null;
    };
  }, []);
  useLayoutEffect(() => {
    const el = ta.current,
      m = mirror.current;
    if (!el || !m) return;
    const sync = () => {
      const cs = getComputedStyle(el);
      for (const p of COPY) m.style.setProperty(p, cs.getPropertyValue(p));
      m.style.left = el.offsetLeft + el.clientLeft + "px";
      m.style.top = el.offsetTop + el.clientTop + "px";
      m.style.width = el.clientWidth + "px";
      m.style.height = el.clientHeight + "px";
      m.scrollTop = el.scrollTop;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (mirror.current && ta.current) mirror.current.scrollTop = ta.current.scrollTop;
  });
  const [ac, setAc] = useState(null);
  const [caretXY, setCaretXY] = useState(null);
  const check = () => {
    const el = ta.current;
    if (!el || el.selectionStart !== el.selectionEnd) return setAc(null);
    const before = el.value.slice(0, el.selectionStart),
      m = /(^|[^\w@])@(\w{0,12})$/.exec(before);
    if (!m) return setAc(null);
    const at = before.length - m[2].length - 1;
    setAc((a) => (a && a.at === at && a.q === m[2] ? a : { at, q: m[2], i: 0 }));
  };
  const items = useMemo(() => {
    if (!ac) return [];
    const q = ac.q.toLowerCase();
    return (refs ?? [])
      .filter((r) => !q || r.tag.startsWith(q) || r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [ac?.q, refs]);
  const total = items.length + (onAddReference ? 1 : 0);
  const pick = (k) => {
    if (!ac || !ta.current) return;
    const r = items[k];
    setAc(null);
    if (!r) {
      onAddReference?.();
      return;
    }
    const caret = ta.current.selectionStart;
    const after = ta.current.value.slice(caret);
    replace(ac.at, caret, "@" + r.tag + (/^\s/.test(after) ? "" : " "));
  };
  useLayoutEffect(() => {
    const m = mirror.current;
    if (!ac || !m) {
      setCaretXY(null);
      return;
    }
    const c = m.querySelector(".rf-caret");
    if (!c) return;
    const r = c.getBoundingClientRect();
    setCaretXY({ x: r.left, y: r.bottom });
  }, [ac, value]);
  const [hover, setHover] = useState(null);
  const hoverTimer = useRef(0),
    overCard = useRef(false);
  const markAt = (x, y) => document.elementsFromPoint(x, y).find((e) => e.classList?.contains("rf-mark"));
  const onMove = (e) => {
    const mk = markAt(e.clientX, e.clientY),
      m = mk ? mentions[+mk.dataset.i] : null;
    wrap.current?.classList.toggle("rf-over-mark", !!m);
    clearTimeout(hoverTimer.current);
    if (m && (!hover || hover.m.start !== m.start))
      hoverTimer.current = setTimeout(() => setHover({ m, rect: mk.getBoundingClientRect() }), 260);
    else if (!m && hover)
      hoverTimer.current = setTimeout(() => {
        if (!overCard.current) setHover(null);
      }, 220);
  };
  const onLeave = () => {
    clearTimeout(hoverTimer.current);
    wrap.current?.classList.remove("rf-over-mark");
    hoverTimer.current = setTimeout(() => {
      if (!overCard.current) setHover(null);
    }, 220);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const insertHere = (t) => handle.current.insert(t);
  const openMention = (m) => {
    const r = byTag.get(m.tag);
    if (r) openRef(projectId, r.id, { range: m.range ?? void 0, onInsert: insertHere });
  };
  const caretAt = ac && ta.current ? ta.current.selectionStart : -1;
  const parts = [];
  let pos = 0;
  const plain = (a, b) => {
    if (b <= a) return;
    if (caretAt >= a && caretAt < b) {
      parts.push(value.slice(a, caretAt), <span key="c" className="rf-caret" />, value.slice(caretAt, b));
    } else parts.push(value.slice(a, b));
  };
  mentions.forEach((m, i) => {
    plain(pos, m.start);
    const r = byTag.get(m.tag);
    const st = !r
      ? "bad"
      : m.badRange || (m.range && r.probe?.duration && m.range[1] > r.probe.duration + 0.5)
        ? "bad"
        : !r.exists
          ? "missing"
          : "ok";
    parts.push(
      <mark key={i} data-i={i} className={`rf-mark k-${r?.kind ?? "none"} ${st} ${m.range ? "ranged" : ""}`}>
        {m.raw}
      </mark>,
    );
    if (caretAt === m.end) parts.push(<span key="c" className="rf-caret" />);
    pos = m.end;
  });
  plain(pos, value.length);
  if (caretAt === value.length && !parts.some((p) => p?.key === "c")) parts.push(<span key="c" className="rf-caret" />);
  return (
    <div ref={wrap} className={`rf-field ${corner ? "has-corner" : ""} ${wrapClassName}`} onMouseMove={onMove} onMouseLeave={onLeave}>
      <div ref={mirror} className="rf-mirror" aria-hidden="true">
        {parts}​
      </div>
      <textarea
        ref={ta}
        {...rest}
        className={`rf-ta ${className}`}
        value={value}
        data-mentions={mentions.map((m) => m.raw).join(" ")}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(check);
        }}
        onSelect={() => {
          if (ac) check();
        }}
        onBlur={(e) => {
          setTimeout(() => setAc(null), 120);
          rest.onBlur?.(e);
        }}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.(e);
        }}
        onMouseDown={(e) => {
          if (e.ctrlKey || e.metaKey) {
            const mk = markAt(e.clientX, e.clientY);
            if (mk) {
              e.preventDefault();
              openMention(mentions[+mk.dataset.i]);
            }
          }
          rest.onMouseDown?.(e);
        }}
        onKeyDown={(e) => {
          if (ac && total) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setAc({ ...ac, i: (ac.i + (e.key === "ArrowDown" ? 1 : total - 1)) % total });
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              e.stopPropagation();
              pick(ac.i);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setAc(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      {corner && <div className="rf-corner">{corner}</div>}
      {ac &&
        caretXY &&
        createPortal(
          <div
            className="rf-ac"
            role="listbox"
            aria-label="References"
            style={{ left: Math.min(caretXY.x - 8, window.innerWidth - 330), top: caretXY.y + 6 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {refs === null ? (
              <div className="rf-ac-empty">Loading references…</div>
            ) : !items.length && !(refs ?? []).length ? (
              <div className="rf-ac-empty">No references yet. Add one to mention it here.</div>
            ) : !items.length ? (
              <div className="rf-ac-empty">No reference matches “@{ac.q}”.</div>
            ) : null}
            {items.map((r, k) => (
              <AcRow key={r.id} projectId={projectId} r={r} on={ac.i === k} onPick={() => pick(k)} />
            ))}
            {onAddReference && (
              <button
                role="option"
                aria-selected={ac.i === items.length}
                className={`rf-ac-row add ${ac.i === items.length ? "on" : ""}`}
                onClick={() => pick(items.length)}
              >
                <span className="rf-ac-thumb">
                  <Plus size={15} />
                </span>
                <span className="grow">
                  <b>Add reference…</b>
                  <small>Any image, video, audio or PDF on this computer</small>
                </span>
              </button>
            )}
            <div className="rf-ac-foot">
              {"Time range: "}
              <code>@vid1[1:02:00-1:02:20]</code>
            </div>
          </div>,
          document.body,
        )}
      {hover &&
        createPortal(
          <MentionCard
            projectId={projectId}
            m={hover.m}
            r={byTag.get(hover.m.tag) ?? null}
            rect={hover.rect}
            onEnter={() => {
              overCard.current = true;
              clearTimeout(hoverTimer.current);
            }}
            onLeave={() => {
              overCard.current = false;
              setHover(null);
            }}
            onOpen={() => {
              setHover(null);
              openMention(hover.m);
            }}
            onAdd={
              onAddReference
                ? () => {
                    setHover(null);
                    onAddReference();
                  }
                : void 0
            }
          />,
          document.body,
        )}
    </div>
  );
});
function AcRow({ projectId, r, on, onPick }) {
  const u = useRefThumb(projectId, r, void 0, 160),
    el = useRef(null);
  useEffect(() => {
    if (on) el.current?.scrollIntoView({ block: "nearest" });
  }, [on]);
  return (
    <button
      ref={el}
      role="option"
      aria-selected={on}
      className={`rf-ac-row ${on ? "on" : ""} ${r.exists ? "" : "missing"}`}
      onClick={onPick}
      data-tag={r.tag}
    >
      <span className="rf-ac-thumb">{u ? <img src={u} alt="" /> : <KindIcon kind={r.kind} size={15} />}</span>
      <span className="grow">
        <b>
          <span className={`rf-tag k-${r.kind}`}>@{r.tag}</span>
          {r.label || r.name}
        </b>
        <small>{r.exists ? refMeta(r) : "File not found"}</small>
      </span>
    </button>
  );
}
function MentionCard({ projectId, m, r, rect, onEnter, onLeave, onOpen, onAdd }) {
  const u = useRefThumb(projectId, r, m.range ? m.range[0] : void 0, 320);
  const below = rect.top < 240,
    left = Math.max(10, Math.min(window.innerWidth - 290, rect.left - 10));
  const tooLong = !!(m.range && r?.probe?.duration && m.range[1] > r.probe.duration + 0.5);
  return (
    <div
      className="rf-card-pop"
      role="tooltip"
      style={{ left, ...(below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }) }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {!r ? (
        <div className="rf-pop-bad">
          <TriangleAlert size={15} />
          <div>
            <b>
              No @{m.tag}
              {" in this project"}
            </b>
            <p>Claude will not know what it means. Add the file as a reference, or fix the tag.</p>
            {onAdd && (
              <button className="btn tiny" onClick={onAdd}>
                <Plus size={12} />
                Add reference
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="rf-pop-media">
            {u ? (
              <img src={u} alt="" />
            ) : (
              <span className="rf-pop-ph">
                <KindIcon kind={r.kind} size={22} />
              </span>
            )}
            {m.range && (
              <span className="rf-pop-range">
                {fmtT(m.range[0])}–{fmtT(m.range[1])}
              </span>
            )}
          </div>
          <div className="rf-pop-body">
            <b>
              <span className={`rf-tag k-${r.kind}`}>@{r.tag}</span>
              {r.label || r.name}
            </b>
            <small>
              {!r.exists
                ? "File not found: relink it in References"
                : m.badRange
                  ? "This time range is not valid: use start-end, like [0:12-0:32]"
                  : tooLong
                    ? `The range ends after the file (${fmtT(r.probe.duration, 0)})`
                    : m.range
                      ? `${fmtSpan(m.range[1] - m.range[0])} of ${fmtT(r.probe?.duration ?? 0, 0)}`
                      : refMeta(r)}
            </small>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn tiny" onClick={onOpen}>
                Open
              </button>
              <span className="dim" style={{ fontSize: 11 }}>
                {"or "}
                {MOD}+click the mention
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
