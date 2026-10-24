import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { FolderOpen } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Toggle } from "../components/ui";

export function ScriptSkillRow() {
  const { toast } = useApp();
  const [s, setS] = useState(null);
  const [paste, setPaste] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .scriptSkillState()
      .then(setS)
      .catch(() => {});
  }, []);
  const run = async (f, ok) => {
    setBusy(true);
    try {
      const before = s?.added;
      const n = await f();
      setS(n);
      if (ok && n.added !== before) toast(ok);
      return n;
    } catch (e) {
      toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const added = (n) => {
    if (n?.has) setPaste(null);
  };
  return (
    <div className="settings-row" data-setting="script-skill">
      <div className="l">
        <h3>Your scripting skill</h3>
        <p>
          Have your own way of writing scripts (a Claude skill, a prompt, a formula)? Add it once and Claude follows it every time it writes
          or rewrites a script: New project, Write the script and the Write script step of routines. The app still sets the length, the
          language and the script's layout. Only the text is used; nothing in it is run.
        </p>
        <p className="muted small">
          One video without it: switch it off in New project (This project's settings), in the Write the script window, or in a routine's
          Write script step.
        </p>
      </div>
      <div className="r" data-script-skill>
        {s?.has ? (
          <>
            <div className="opt">
              <span>
                <b style={{ fontWeight: 500 }} data-skill-name>
                  {s.name}
                </b>
                <small>
                  {s.files.length === 1 ? "One file" : `${s.files.length} files`}
                  {s.added ? ` · added ${new Date(s.added).toLocaleDateString()}` : ""}
                  {" · "}
                  {s.on ? "Claude follows it" : "Off: Claude writes scripts the usual way"}
                </small>
              </span>
              <Toggle label="Use my scripting skill" on={s.on} onChange={(v) => run(() => api.scriptSkillSet(v))} />
            </div>
            {s.preview && (
              <pre
                className="small dim"
                data-skill-preview
                style={{
                  whiteSpace: "pre-wrap",
                  margin: "6px 0",
                  maxHeight: 110,
                  overflow: "hidden",
                  fontSize: 12,
                  background: "var(--bg-2, #141414)",
                  padding: "8px 10px",
                  borderRadius: 8,
                }}
              >
                {s.preview}
              </pre>
            )}
            <div className="row wrap">
              <button
                className="btn small"
                disabled={busy}
                onClick={() => run(() => api.scriptSkillPick("file"), "Scripting skill replaced.")}
              >
                Replace with a file
              </button>
              <button
                className="btn small"
                disabled={busy}
                onClick={() => run(() => api.scriptSkillPick("folder"), "Scripting skill replaced.")}
              >
                <FolderOpen size={14} />
                Replace with a folder
              </button>
              <button className="btn small" disabled={busy} onClick={() => setPaste(paste === null ? "" : null)}>
                Paste instead
              </button>
              <button
                className="btn small"
                disabled={busy}
                onClick={() => run(() => api.scriptSkillRemove()).then((n) => n && toast("Scripting skill removed."))}
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <div className="row wrap">
            <button
              className="btn small primary"
              disabled={busy}
              onClick={() =>
                run(() => api.scriptSkillPick("file"), "Scripting skill added. Claude follows it from the next script.").then(added)
              }
            >
              Add a file (.md or .txt)
            </button>
            <button
              className="btn small"
              disabled={busy}
              onClick={() =>
                run(() => api.scriptSkillPick("folder"), "Scripting skill added. Claude follows it from the next script.").then(added)
              }
            >
              <FolderOpen size={14} />
              Add a skill folder
            </button>
            <button className="btn small" disabled={busy} onClick={() => setPaste(paste === null ? "" : null)}>
              Paste text
            </button>
          </div>
        )}
        {paste !== null && (
          <div style={{ marginTop: 8 }}>
            <textarea
              className="input"
              rows={6}
              aria-label="Scripting instructions"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Paste your scripting skill or instructions here (how you open, the tone, the structure, words to avoid...)"
              style={{ width: "100%", resize: "vertical" }}
            />
            <div className="row">
              <button
                className="btn small primary"
                disabled={busy || !paste.trim()}
                onClick={() =>
                  run(() => api.scriptSkillPaste(paste), "Scripting skill saved. Claude follows it from the next script.").then(added)
                }
              >
                Save
              </button>
              <button className="btn small" onClick={() => setPaste(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <p className="small dim" style={{ marginTop: 6 }}>
          A skill folder needs its SKILL.md; text files only, up to 1 MB.
        </p>
      </div>
    </div>
  );
}
