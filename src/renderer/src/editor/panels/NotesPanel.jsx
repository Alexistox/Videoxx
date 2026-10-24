import { useEffect, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { api } from "../../lib/api";
import { Modal, Spinner } from "../../components/ui";

const NOTE_FILES = [
  ["storyboard.md", "Storyboard"],
  ["CLAUDE.md", "Claude context"],
  ["STYLE.md", "Style rules"],
  ["script.txt", "Script"],
  ["research.md", "Research"],
  ["brief.md", "Brief"],
  ["audio/script_timed.txt", "Timed script"],
];
export function NotesPanel({ projectId, dir, onClose }) {
  const [cur, setCur] = useState("storyboard.md");
  const [text, setText] = useState(null);
  useEffect(() => {
    setText(null);
    api.readText(projectId, cur).then((t) => setText(t ?? ""));
  }, [cur]);
  return (
    <Modal title="Project notes" onClose={onClose} wide>
      <div className="modal-body">
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="tabs sm" role="tablist">
            {NOTE_FILES.map(([f, l]) => (
              <button key={f} role="tab" aria-selected={cur === f} className={cur === f ? "active" : ""} onClick={() => setCur(f)}>
                {l}
              </button>
            ))}
          </div>
          <span className="grow" />
          <button className="btn small" onClick={() => api.open(dir + "/" + cur)}>
            <ExternalLinkIcon size={14} />
            Open in editor
          </button>
        </div>
        {text === null ? (
          <Spinner />
        ) : text ? (
          <pre className="log-box" style={{ maxHeight: "62vh", fontSize: 12, whiteSpace: "pre-wrap" }}>
            {text}
          </pre>
        ) : (
          <p className="muted">This file doesn't exist yet.</p>
        )}
      </div>
    </Modal>
  );
}
