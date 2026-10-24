import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FolderOpen, Star, X } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";

export function Lightbox({ items, start, from, onClose, actions }) {
  const [i, setI] = useState(() =>
    Math.max(
      0,
      items.findIndex((x) => x.id === start),
    ),
  );
  const [closing, setClosing] = useState(false);
  const img = useRef(null),
    startRef = useRef(start);
  const it = items[i];
  const close = () => {
    if (closing) return;
    const el = img.current,
      back = startRef.current === it?.id ? from : null;
    setClosing(true);
    if (el && back) {
      const r = el.getBoundingClientRect();
      el.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: flip(back, r), opacity: 0.4 },
        ],
        { duration: 220, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
      );
    }
    setTimeout(onClose, 200);
  };
  useLayoutEffect(() => {
    const el = img.current;
    if (!el || !from) return;
    const go = () => {
      const r = el.getBoundingClientRect();
      el.animate(
        [
          { transform: flip(from, r), opacity: 0.4 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 320, easing: "cubic-bezier(.2,.9,.25,1)" },
      );
    };
    if (el.complete) go();
    else el.addEventListener("load", go, { once: true });
  }, []);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "ArrowRight" && items.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        setI((x) => (x + 1) % items.length);
      } else if (e.key === "ArrowLeft" && items.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        setI((x) => (x - 1 + items.length) % items.length);
      } else if (e.key === "Delete" || e.key === "Backspace" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  if (!it) return null;
  const a = actions?.(it);
  return (
    <div
      className={`lb ${closing ? "out" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={it.label}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <img
        key={it.id}
        ref={img}
        src={it.url}
        alt={it.label}
        className={`lb-img ${a?.dragOut ? "can-drag" : ""}`}
        draggable={!!a?.dragOut}
        onClick={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          if (!a?.dragOut) return;
          e.preventDefault();
          a.dragOut();
        }}
        title={a?.dragOut ? "Drag it into YouTube Studio, a folder or a chat" : void 0}
      />
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lb-label ellipsis">
          {it.label}
          {items.length > 1 ? ` · ${i + 1} / ${items.length}` : ""}
        </span>
        {a?.useAsThumb && (
          <button className="btn small primary" onClick={a.useAsThumb}>
            <Star size={14} />
            Use as thumbnail
          </button>
        )}
        {a?.saveAs && (
          <button className="icon-btn" title="Save a copy" aria-label="Save a copy" onClick={a.saveAs}>
            <Download size={16} />
          </button>
        )}
        {a?.reveal && (
          <button className="icon-btn" title="Show in folder" aria-label="Show in folder" onClick={a.reveal}>
            <FolderOpen size={16} />
          </button>
        )}
        <button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={close}>
          <X size={17} />
        </button>
      </div>
      {items.length > 1 && (
        <>
          <button
            className="lb-nav l"
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation();
              setI((x) => (x - 1 + items.length) % items.length);
            }}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            className="lb-nav r"
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation();
              setI((x) => (x + 1) % items.length);
            }}
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>
  );
}
function flip(from, to) {
  const sx = from.width / to.width,
    sy = from.height / to.height;
  return `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${sx}, ${sy})`;
}
