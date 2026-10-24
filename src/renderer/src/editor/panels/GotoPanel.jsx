import { useState } from "react";
import { fmtTime } from "../../lib/format";
import { Modal } from "../../components/ui";

export function GotoPanel({ end, onGo, onClose }) {
  const [v, setV] = useState("");
  const parse = (s) => {
    const m = s.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const t2 = +(m[1] || 0) * 60 + +m[2];
    return t2 >= 0 && t2 <= end ? t2 : null;
  };
  const t = parse(v);
  return (
    <Modal title="Go to time" onClose={onClose}>
      <div className="modal-body">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="goto">Time (seconds or m:ss.s)</label>
          <input
            id="goto"
            className="input"
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder={`0 – ${fmtTime(end)}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && t !== null) onGo(t);
            }}
          />
          <span className="help">
            {v && t === null ? "Not a time inside the video." : t !== null ? `Jump to ${fmtTime(t, 2)}` : "e.g. 83.5 or 1:23.5"}
          </span>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={t === null} onClick={() => t !== null && onGo(t)}>
            Go
          </button>
        </div>
      </div>
    </Modal>
  );
}
