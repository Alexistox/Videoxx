import { useState } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CircleXIcon } from "lucide-react";
import { Spinner } from "../components/ui";

export const srcOf = (s) =>
  s.element?.source?.file
    ? s.element.source
    : s.kind === "cue"
      ? { file: s.element.file, line: s.element.line }
      : s.shot?.file
        ? { file: s.shot.file, line: s.shot.line ?? 1 }
        : null;
const TOOL_VERB = /^(Editing|Writing|Reading|Running|Searching the web|Searching|Using skill|Rendering frames at)\s+([\s\S]+)$/;
export function ToolGroup({ list }) {
  const [open, setOpen] = useState(false);
  const shown = open ? list : list.slice(-6),
    hidden = list.length - shown.length;
  return (
    <div className="tool-group">
      {hidden > 0 && (
        <button className="tool-more" onClick={() => setOpen(true)}>
          <ChevronRightIcon size={12} />
          {hidden}
          {" earlier step"}
          {hidden === 1 ? "" : "s"}
        </button>
      )}
      {shown.map((t) => {
        const m = TOOL_VERB.exec(t.summary);
        return (
          <div key={t.id} className={`tool-line ${!t.done ? "run" : t.error ? "bad" : "done"}`} title={t.summary}>
            <span className="tl-ic">{!t.done ? <Spinner size={12} /> : t.error ? <CircleXIcon size={13} /> : <CheckIcon size={13} />}</span>
            {m ? (
              <>
                <span className="tl-verb">{m[1]}</span>
                <span className={`tl-chip ${/^(Editing|Writing|Reading|Running)$/.test(m[1]) ? "mono" : ""}`}>{m[2]}</span>
              </>
            ) : (
              <span className="tl-verb ellipsis">{t.summary}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function Compare({ c: all, onSeek }) {
  const [k, setK] = useState(50),
    [n, setN] = useState(0);
  const list = all.list?.length ? all.list : [all],
    c = list[Math.min(n, list.length - 1)];
  return (
    <div className="compare-wrap">
      {list.length > 1 && (
        <div className="cmp-nav">
          <button className="icon-btn sm" aria-label="Previous shot" disabled={n === 0} onClick={() => setN(n - 1)}>
            <ChevronLeftIcon size={14} />
          </button>
          <span className="grow ellipsis" title={c.label}>
            {c.label}
          </span>
          <span className="dim">
            {n + 1}
            {" / "}
            {list.length}
          </span>
          <button className="icon-btn sm" aria-label="Next shot" disabled={n >= list.length - 1} onClick={() => setN(n + 1)}>
            <ChevronRightIcon size={14} />
          </button>
        </div>
      )}
      <div className="compare" aria-label="Before and after">
        <img src={c.after} alt="After the edit" loading="lazy" decoding="async" />
        <img src={c.before} alt="Before the edit" loading="lazy" decoding="async" style={{ clipPath: `inset(0 ${100 - k}% 0 0)` }} />
        <i style={{ left: `${k}%` }} />
        <span className="l">Before</span>
        <span className="r">After</span>
        <input type="range" min={0} max={100} value={k} onChange={(e) => setK(+e.target.value)} aria-label="Compare before and after" />
        {onSeek && (
          <button className="btn tiny" onClick={() => onSeek(c.time)}>
            {c.time.toFixed(1)}s
          </button>
        )}
      </div>
    </div>
  );
}
