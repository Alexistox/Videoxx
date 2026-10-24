import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { fmtLength } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { AudioLines, Copy, ExternalLink, PenLine, TriangleAlert } from "../../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Modal, Spinner } from "../../components/ui";
import { aLang, cantDrawWhy, lang, otherScriptLanguage, styleDraws, wordUnit } from "../../settings/languages";
import { speechPace } from "../../settings/project/visualPace";
import { spokenScript } from "../../script/scriptText";
import { lengthNote, scriptLength } from "../../script/scriptLength";

const spokenText = (s, language) =>
  spokenScript(s, language)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
export function ScriptView({ projectId, dir, language, reading, onClose, onRewrite, onSaved, onVoiceover, base, styleName, onLanguage }) {
  const { toast } = useApp();
  const [text, setText] = useState(null);
  const [orig, setOrig] = useState("");
  const [tab, setTab] = useState("script");
  const [research, setResearch] = useState(null);
  useEffect(() => {
    api.readText(projectId, "script.txt").then((t) => {
      setText(t ?? "");
      setOrig(t ?? "");
    });
    api.readText(projectId, "research.md").then((t) => setResearch(t ?? ""));
  }, []);
  const V = lang(language),
    spoken = text ? spokenText(text, V.code) : "";
  const other = useMemo(() => (spoken ? otherScriptLanguage(spoken, V.code) : null), [spoken, V.code]),
    L = lang(other ?? V.code);
  const [keptPace, setKeptPace] = useState(void 0);
  useEffect(() => {
    api
      .config()
      .then((c) => setKeptPace(c.voice?.pace?.[base ?? ""]))
      .catch(() => {});
  }, [base]);
  const len = useMemo(() => (text ? scriptLength(text, L.code, base, keptPace) : null), [text, L.code, base, keptPace]),
    words = len?.words ?? 0;
  const told = Math.round(L.wpm * speechPace(base)),
    rateNote = len?.pace === "short" ? ` at ${told} ${L.unit === "char" ? "characters a minute" : "wpm"}` : "";
  const dirty = text !== null && text !== orig;
  const save = async () => {
    await api.saveScript(projectId, text);
    setOrig(text);
    onSaved();
    toast("Script saved.");
  };
  const rewrite = async () => {
    if (dirty) {
      try {
        await save();
      } catch (e) {
        toast(e.message, "bad");
        return;
      }
    }
    onRewrite();
  };
  const voiceover = async () => {
    if (dirty) {
      try {
        await save();
      } catch (e) {
        toast(e.message, "bad");
        return;
      }
    }
    onVoiceover?.();
  };
  const copy = async () => {
    await api.copy(spokenText(text ?? "", V.code));
    toast("Narration copied without headings and notes. Paste it into your TTS.");
  };
  return (
    <Modal
      title="Script"
      onClose={() => {
        if (!dirty || confirm("Discard your unsaved script changes?")) onClose();
      }}
      wide
    >
      <div className="modal-body">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="tabs sm" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "script"}
              className={tab === "script" ? "active" : ""}
              onClick={() => setTab("script")}
            >
              Narration
            </button>
            <button
              role="tab"
              aria-selected={tab === "research"}
              className={tab === "research" ? "active" : ""}
              onClick={() => setTab("research")}
            >
              {"Research & sources"}
            </button>
          </div>
          <span className="grow" />
          {tab === "script" && (
            <span className="small">
              {words}
              {" spoken "}
              {wordUnit(L.code)}
              {" · about "}
              {fmtLength(len?.seconds ?? 0)}
              {rateNote}
              {len ? lengthNote(len) : ""}
              {L.code !== "en" ? ` (${L.name})` : ""}
            </span>
          )}
        </div>
        {other && !reading && tab === "script" && (
          <div className="hint warn sv-otherlang" style={{ marginBottom: 12 }}>
            <TriangleAlert size={18} />
            <div>
              <b>
                {"This script is in "}
                {L.name}
                {", but the video is "}
                {V.name}
              </b>
              <p>
                {"A voice would read it as "}
                {V.name}
                {" and its words would be timed as "}
                {V.name}
                {". Rewrite with Claude writes it in "}
                {V.name}
                {!styleDraws(base, other)
                  ? `. ${styleName || "This style"} can't write ${L.name}: ${cantDrawWhy(base, other)}.`
                  : onLanguage
                    ? `, or make the video ${L.name}.`
                    : "."}
              </p>
              {onLanguage && styleDraws(base, other) && (
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn small" onClick={() => onLanguage(other)}>
                    {"Make it "}
                    {aLang(other)}
                    {" video"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {reading && tab === "script" && (
          <div className="hint warn" style={{ marginBottom: 12 }}>
            <TriangleAlert size={18} />
            <div>
              <b>A voice is reading this script right now</b>
              <p>
                Changes you save now are not in that voiceover (it reads the script as it was when it started). Make the voiceover again
                afterwards for the new text.
              </p>
            </div>
          </div>
        )}
        {tab === "script" ? (
          text === null ? (
            <Spinner />
          ) : (
            <textarea
              className="input"
              aria-label="Script"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck
              style={{ width: "100%", height: "58vh", fontSize: 14, lineHeight: 1.65, resize: "vertical" }}
              placeholder="No script yet. Press Rewrite with Claude, or type it here."
            />
          )
        ) : research === null ? (
          <Spinner />
        ) : research ? (
          <pre className="log-box" style={{ maxHeight: "58vh", fontSize: 12, whiteSpace: "pre-wrap" }}>
            {research}
          </pre>
        ) : (
          <p className="muted">No research notes yet.</p>
        )}
        <div className="modal-actions">
          <button
            className="btn"
            style={{ marginRight: "auto" }}
            onClick={() => api.open(dir + "/" + (tab === "script" ? "script.txt" : "research.md"))}
          >
            <ExternalLink size={15} />
            Open file
          </button>
          <button
            className="btn"
            onClick={rewrite}
            disabled={reading}
            title={
              reading
                ? "Wait until the voiceover is made: it reads this script"
                : dirty
                  ? "Saves your changes first, then Claude rewrites from them"
                  : void 0
            }
          >
            <PenLine size={15} />
            Rewrite with Claude
          </button>
          <button
            className="btn"
            onClick={copy}
            disabled={!words}
            title="Copies the spoken words only: headings, [notes], (directions), markdown marks and emoji are left out"
          >
            <Copy size={15} />
            Copy for TTS
          </button>
          {onVoiceover && (
            <button
              className="btn"
              onClick={voiceover}
              disabled={!words}
              title={
                dirty
                  ? "Saves your changes first, then makes the voiceover from the script"
                  : "ElevenLabs or the free local voice reads this script"
              }
            >
              <AudioLines size={15} />
              Make the voiceover
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
