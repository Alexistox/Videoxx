import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppProvider";
import { CircleAlert, CircleCheck, Info, LifeBuoy, X } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";

export const I = { size: 18, strokeWidth: 1.7 };
const PIXELS = {
  drive: { ms: 650, delays: [90, 180, 270, 0, 90, 180, 90, 180, 270] },
  orbit: { ms: 950, delays: [0, 110, 220, 770, -1, 330, 660, 550, 440] },
};
const GRID = [
  [12, 3, 1],
  [15, 4, 1],
  [18, 4, 1.5],
  [24, 6, 2],
  [Infinity, 8, 2.5],
];
export const Spinner = ({ size = 16, kind = "drive" }) => {
  const [, px, gap] = GRID.find((g) => size <= g[0]),
    p = PIXELS[kind];
  return (
    <span className="spinner" role="img" aria-label="Loading" style={{ "--px": `${px}px`, "--gap": `${gap}px`, "--ms": `${p.ms}ms` }}>
      {p.delays.map((d, i) => (
        <i key={i} className={d < 0 ? "off" : ""} style={d < 0 ? void 0 : { animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
};
const elapsedText = (ms) =>
  ms < 6e4 ? `${(Math.max(0, ms) / 1e3).toFixed(1)}s` : `${Math.floor(ms / 6e4)}m ${String(Math.floor(ms / 1e3) % 60).padStart(2, "0")}s`;
export function Busy({ text, since, size = 14, kind = "drive", className = "" }) {
  const [now, setNow] = useState(() => Date.now());
  const long = !!since && now - since >= 6e4;
  useEffect(() => {
    if (!since) return;
    const iv = setInterval(() => setNow(Date.now()), long ? 1e3 : 100);
    return () => clearInterval(iv);
  }, [since, long]);
  return (
    <span className={`busy ${className}`} role="status">
      <Spinner size={size} kind={kind} />
      <span className="shimmer-text">{text}</span>
      {since ? <span className="elapsed">{elapsedText(now - since)}</span> : null}
    </span>
  );
}
const openModals = [];
const modalSubs = new Set(),
  modalsChanged = () => modalSubs.forEach((f) => f());
function useTopModalSince() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    modalSubs.add(f);
    return () => {
      modalSubs.delete(f);
    };
  }, []);
  return openModals.length ? openModals[openModals.length - 1].at : 0;
}
export function Modal({ title, onClose, children, wide, className = "", dirty, stay, focusField = true, dialogProps, head, closeOff }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const isDirty = useRef(dirty);
  isDirty.current = dirty;
  const staying = useRef(stay);
  staying.current = stay;
  const [asking, setAsking] = useState(false),
    askingRef = useRef(false);
  askingRef.current = asking;
  const tryClose = () => {
    if (!askingRef.current && isDirty.current?.()) setAsking(true);
    else close.current();
  };
  const pressedIn = useRef(0);
  const prevFocus = useRef(void 0);
  if (prevFocus.current === void 0) prevFocus.current = document.activeElement;
  useEffect(() => {
    const prev = prevFocus.current;
    const el = ref.current;
    const focusables = () =>
      [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (x) => !x.hasAttribute("disabled"),
      );
    if (!el.contains(document.activeElement)) {
      if (!focusField) el.focus({ preventScroll: true });
      else (focusables().find((x) => /^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName)) || focusables()[0] || el).focus();
    }
    openModals.push({ el, at: Date.now() });
    modalsChanged();
    const key = (e) => {
      if (openModals[openModals.length - 1]?.el !== el) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        tryClose();
        return;
      }
      if (
        askingRef.current &&
        e.target?.matches?.('input, textarea, [contenteditable="true"]') &&
        !["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)
      )
        setAsking(false);
      if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (i < 0) {
          e.preventDefault();
          f[0].focus();
        } else if (e.shiftKey && i === 0) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      openModals.splice(
        openModals.findIndex((m) => m.el === el),
        1,
      );
      modalsChanged();
      prev?.focus?.();
    };
  }, []);
  return (
    <div
      className="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && e.detail < 2 && Date.now() - pressedIn.current > 600 && !staying.current?.()) tryClose();
      }}
    >
      <div
        ref={ref}
        {...dialogProps}
        className={`modal ${wide ? "wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDownCapture={() => {
          pressedIn.current = Date.now();
        }}
        onKeyDownCapture={() => {
          pressedIn.current = 0;
        }}
      >
        <header>
          <h2>{title}</h2>
          {head && <div className="modal-head">{head}</div>}
          <button className="icon-btn" onClick={() => tryClose()} aria-label="Close" disabled={!!closeOff} title={closeOff || "Close"}>
            <X {...I} />
          </button>
        </header>
        <div className="modal-scroll">{children}</div>
        {asking && (
          <div className="modal-discard" role="alert">
            <span>
              {"What you typed is not saved. "}
              <span className="dim">Esc again throws it away.</span>
            </span>
            <button className="btn small" onClick={() => setAsking(false)}>
              Keep editing
            </button>
            <button className="btn small danger" onClick={() => close.current()}>
              Discard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
const reportable = (text) =>
  text.length > 90 ||
  /fail|error|could ?n[o']t|can['’]?t|cannot|crash|stopp?ed|not found|missing|broke|unexpected|timed? ?out|denied|refused|went wrong|didn['’]?t work|invalid|corrupt/i.test(
    text,
  );
export function Toasts() {
  const { toasts, dismiss, openHelp, holdToast } = useApp();
  const since = useTopModalSince();
  const [lift, setLift] = useState(null),
    box = useRef(null);
  useEffect(() => {
    if (!toasts.length) {
      setLift(null);
      return;
    }
    const place = () => {
      const m = [...document.querySelectorAll(".backdrop > .modal")].pop();
      const foot = m ? [...m.querySelectorAll(".modal-actions")].pop()?.getBoundingClientRect() : null;
      const h = box.current?.offsetHeight ?? 0,
        H = window.innerHeight;
      setLift(foot && foot.height && foot.bottom > H - 26 - h - 6 && foot.top - 12 - h > 8 ? Math.round(H - foot.top + 12) : null);
    };
    place();
    const t = window.setInterval(place, 250);
    window.addEventListener("resize", place);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", place);
    };
  }, [toasts.length > 0]);
  return (
    <div ref={box} className="toasts" role="status" aria-live="polite" style={lift ? { bottom: lift } : void 0}>
      {toasts
        .filter((t) => !since || t.at >= since || t.tag)
        .map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind === "bad" ? "bad" : t.kind === "info" ? "info" : ""}`}
            onMouseEnter={() => holdToast(t.id, true)}
            onMouseLeave={() => holdToast(t.id, false)}
          >
            {t.kind === "bad" ? <CircleAlert {...I} /> : t.kind === "info" ? <Info {...I} /> : <CircleCheck {...I} />}
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn tiny"
                onClick={() => {
                  t.action.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            {t.kind === "bad" && reportable(t.text) && (
              <button
                className="btn tiny ghost toast-report"
                title="Report this problem: the Help panel opens with this message filled in"
                onClick={() => {
                  openHelp({ error: t.text });
                  dismiss(t.id);
                }}
              >
                <LifeBuoy size={13} />
                Report
              </button>
            )}
            <button className="icon-btn sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
    </div>
  );
}
export function Empty({ icon, title, text, children }) {
  return (
    <div className="empty">
      <div className="ic">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Toggle({ on, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
    />
  );
}
const STATUS = {
  draft: ["Draft", ""],
  building: ["Building", "purple"],
  editing: ["Editing", "blue"],
  ready: ["Ready", "mint"],
  running: ["Working", "blue"],
  exported: ["Exported", "mint"],
  done: ["Applied", "mint"],
  "no-change": ["No changes", "gray"],
  failed: ["Failed", "red"],
  cancelled: ["Stopped", "gray"],
  reverted: ["Reverted", "gray"],
};
export const StatusBadge = ({ s }) => {
  const [t, c] = STATUS[s] ?? [s, "gray"];
  return (
    <span className={`badge ${c}`}>
      <i />
      {t}
    </span>
  );
};
