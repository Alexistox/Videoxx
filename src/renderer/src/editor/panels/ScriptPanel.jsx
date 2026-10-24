import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtLength, parseLength } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { PenLine } from "../../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Modal } from "../../components/ui";
import { lang } from "../../settings/languages";
import { LanguagePicker } from "../../settings/LanguagePicker";

export function ScriptPanel({ projectId, status, onStart, onClose }) {
  const { toast, claude, signIn } = useApp();
  const [topic, setTopic] = useState(status.topic || status.title);
  const [length, setLength] = useState(fmtLength(status.targetLength || 120));
  const [notes, setNotes] = useState("");
  const [language, setLanguage] = useState(status.language || "en"),
    [multi, setMulti] = useState(false);
  useEffect(() => {
    api
      .config()
      .then((c) => setMulti(c.language?.mode === "multi"))
      .catch(() => {});
  }, []);
  const showLang = multi || (status.language || "en") !== "en",
    L = lang(language);
  const rewrite = status.scriptWords >= 30;
  const [skill, setSkill] = useState(null),
    [useSkill, setUseSkill] = useState(status.scriptSkill !== false);
  useEffect(() => {
    api
      .scriptSkillState()
      .then(setSkill)
      .catch(() => {});
  }, []);
  const go = async () => {
    const len = parseLength(length);
    if (!len || len < 15) {
      toast("Use minutes:seconds for the length, e.g. 2:30.", "bad");
      return;
    }
    if (!topic.trim()) {
      toast("Say what the video is about.", "bad");
      return;
    }
    const other = language !== (status.language || "en");
    if (other && !claude?.loggedIn) {
      toast(`Claude is not connected yet: sign in first. The video becomes ${L.name} when Claude rewrites its script.`, "bad", {
        label: "Sign in",
        run: signIn,
      });
      return;
    }
    try {
      await api.setMeta(projectId, {
        topic,
        targetLength: len,
        ...((skill?.has || status.scriptSkillOwn) && useSkill !== (status.scriptSkill !== false) ? { scriptSkill: useSkill } : {}),
      });
    } catch (e) {
      toast(e.message, "bad");
      return;
    }
    onStart(notes.trim(), other ? language : void 0);
  };
  return (
    <Modal title={rewrite ? "Rewrite the script with Claude" : "Write the script with Claude"} onClose={onClose}>
      <div className="modal-body">
        <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
          Claude researches the topic on the web (sources go to research.md) and writes the narration to script.txt
          {L.code !== "en" ? ` in ${L.name}` : ""}
          {
            " at the length you set, at medium effort. Then make the voiceover in the app (your ElevenLabs voices or a free local voice), or record it yourself: the "
          }
          <b>Voiceover</b>
          {" step."}
          {rewrite ? ` The current script has ${status.scriptWords} words; Claude revises it to your notes.` : ""}
        </p>
        <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          <div className="field grow">
            <label htmlFor="sc-topic">Topic</label>
            <textarea
              id="sc-topic"
              className="input oneline"
              autoFocus
              rows={Math.min(5, topic.split("\n").length)}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What is the video about?"
            />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label htmlFor="sc-length">Length</label>
            <input id="sc-length" className="input" value={length} onChange={(e) => setLength(e.target.value)} placeholder="2:00" />
          </div>
        </div>
        {showLang && (
          <div className="field">
            <label htmlFor="sc-lang">Language</label>
            <div style={{ maxWidth: 260 }}>
              <LanguagePicker
                id="sc-lang"
                value={language}
                onChange={setLanguage}
                base={status.styleBase ?? status.style}
                ariaLabel="Language of the script"
              />
            </div>
            <span className="help">
              {language !== (status.language || "en")
                ? `The video becomes ${L.name} once Claude has written the script: the voice reads and the words are timed in it too.`
                : `About ${L.wpm} words a minute in ${L.name}.`}
            </span>
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="sc-notes">
            {"Angle and notes "}
            <span className="dim">(optional)</span>
          </label>
          <textarea
            id="sc-notes"
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. For gamers, not engineers. End on what modern consoles lost. Mention Ico and GTA III."
          />
        </div>
        {(skill?.has || status.scriptSkillOwn) &&
          (() => {
            const own = status.scriptSkillOwn,
              on = !!own || !!skill?.on;
            return (
              <div className="field" data-sc-skill style={{ marginTop: 14, marginBottom: 0 }}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={useSkill && on}
                    disabled={!on}
                    onChange={(e) => setUseSkill(e.target.checked)}
                    aria-label="Use my scripting skill for this video"
                  />
                  <span>
                    {"Use "}
                    {own ? "its routine's scripting skill" : "my scripting skill"} <b style={{ fontWeight: 500 }}>{own ?? skill?.name}</b>
                    {" for this video"}
                  </span>
                </label>
                <span className="help">
                  {on
                    ? useSkill
                      ? "Claude follows your way of writing; the length and the language above still apply."
                      : `Off for this video: Claude writes it the usual way. Rewrites of this video stay that way until you tick it again${own ? " (then with your Settings skill)" : ""}.`
                    : "Your scripting skill is switched off in Settings > AI engines > Your scripting skill."}
                </span>
              </div>
            );
          })()}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={go}>
            <PenLine size={15} />
            {rewrite ? "Rewrite script" : "Write script"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
