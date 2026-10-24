import { useEffect, useMemo, useState } from "react";
import { fmtTime } from "../../lib/format";
import { Modal } from "../../components/ui";
import { findFolded, fold } from "../../lib/fold";

export function FindPanel({ phrases, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const hits = useMemo(() => {
    const s = fold(q.trim());
    return s.length < 2 ? [] : phrases.filter((p) => fold(p.text).includes(s)).slice(0, 40);
  }, [q, phrases]);
  useEffect(() => setI(0), [q]);
  const mark = (t) => {
    const r = findFolded(t, q.trim());
    return !r ? (
      t
    ) : (
      <>
        {t.slice(0, r[0])}
        <b style={{ color: "#efe2bd", fontWeight: 600 }}>{t.slice(r[0], r[1])}</b>
        {t.slice(r[1])}
      </>
    );
  };
  return (
    <Modal title="Find in narration" onClose={onClose} className="palette">
      <div style={{ padding: "14px 16px 4px" }}>
        <div className="search">
          <input
            autoFocus
            placeholder="A word or phrase from the voiceover"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search narration"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setI((x) => Math.min(hits.length - 1, x + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setI((x) => Math.max(0, x - 1));
              }
              if (e.key === "Enter" && hits[i]) onPick(hits[i]);
            }}
          />
        </div>
      </div>
      <div className="palette-results" role="listbox">
        {hits.map((p, k) => (
          <button
            key={k}
            role="option"
            aria-selected={k === i}
            className={k === i ? "on" : ""}
            onMouseEnter={() => setI(k)}
            onClick={() => onPick(p)}
          >
            <span>{mark(p.text)}</span>
            <small>{fmtTime(p.s)}</small>
          </button>
        ))}
        {q.trim().length >= 2 && !hits.length && (
          <p className="muted" style={{ padding: 14, fontSize: 13 }}>
            Not in the narration.
          </p>
        )}
      </div>
    </Modal>
  );
}
