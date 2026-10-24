import { useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { Modal } from "../components/ui";
import { DATE_LIMITS, dateProblem, inDays, isEnter, today } from "./stages";

export function DueDialog({ title, value, canClear, onClose, onSave }) {
  const [v, setV] = useState(value ?? ""),
    [partial, setPartial] = useState(false),
    [msg, setMsg] = useState(null);
  const field = useRef(null);
  const quick = [
    ["Today", today()],
    ["Tomorrow", inDays(1)],
    ["In 3 days", inDays(3)],
    ["In a week", inDays(7)],
    ["In 2 weeks", inDays(14)],
  ];
  const save = (d) => {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    onSave(d);
    onClose();
  };
  const read = () => {
    const el = field.current;
    if (el) {
      setPartial(el.validity.badInput);
      if (!dateProblem(el, el.value)) setMsg(null);
    }
  };
  const saveTyped = () => {
    const p = dateProblem(field.current, v);
    if (p) {
      setMsg(`${p} Or pick one above.`);
      return;
    }
    if (!v) {
      setMsg(value || canClear ? "Pick a date first. To take the date away, use No due date." : "Pick a date first.");
      return;
    }
    save(v);
  };
  return (
    <Modal title="Due date" onClose={onClose} className="ch-small-modal">
      <div className="modal-body">
        <p className="muted ch-for ellipsis">{title}</p>
        <div className="ch-quick">
          {quick.map(([l, d]) => (
            <button key={l} className={`btn small ${v === d ? "active" : ""}`} onClick={() => save(d)}>
              {l}
            </button>
          ))}
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ch-due">Or a date</label>
          <input
            ref={field}
            id="ch-due"
            type="date"
            className="input"
            {...DATE_LIMITS}
            value={v}
            onChange={(e) => {
              setV(e.target.value);
              read();
            }}
            onKeyUp={read}
            onBlur={read}
            onKeyDown={(e) => {
              if (isEnter(e)) {
                e.preventDefault();
                saveTyped();
              }
            }}
            aria-describedby={msg ? "ch-due-msg" : void 0}
          />
          {msg && (
            <span id="ch-due-msg" className="help warn" role="alert">
              {msg}
            </span>
          )}
        </div>
        <div className="modal-actions">
          {(value || canClear) && (
            <button className="btn ghost ch-del" onClick={() => save(null)}>
              <XIcon size={14} />
              No due date
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={saveTyped} disabled={!v && !partial}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
