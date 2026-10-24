import { useState } from "react";
import { MOD, isMac } from "../help/keys";
import { Modal } from "../components/ui";

export function NoteDialog({ title, value, onClose, onSave }) {
  const [v, setV] = useState(value ?? "");
  const save = () => {
    onSave(v.trim() || null);
    onClose();
  };
  return (
    <Modal title="Plan note" onClose={onClose} className="ch-small-modal" dirty={() => v.trim() !== (value ?? "").trim()}>
      <div className="modal-body">
        <p className="muted ch-for ellipsis">{title}</p>
        <textarea
          className="input"
          rows={5}
          autoFocus
          maxLength={5e3}
          value={v}
          onChange={(e) => setV(e.target.value)}
          aria-label="Plan note"
          placeholder="What is left to do, the angle, a reminder… It shows on the card."
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="help" style={{ marginTop: 6 }}>
          {v.length.toLocaleString()}
          {" / 5,000"}
        </div>
        <div className="modal-actions">
          <span className="np-keys" aria-hidden="true">
            <kbd>{MOD}</kbd>
            <kbd>{isMac ? "↩" : "Enter"}</kbd>to save
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
