import { useEffect, useRef, useState } from "react";
import { HammerIcon, TriangleAlertIcon } from "lucide-react";
import { api } from "../../lib/api";
import { useApp } from "../../state/AppProvider";
import { Modal } from "../../components/ui";
import { mentionOf } from "../../refs/mentions";
import { MentionField } from "../../refs/MentionField";
import { getAt, setAt } from "../../settings/project/SettingsControls";
import { isStandard, premiumMsg, usePlan } from "../../state/usePlan";
import { SETTING_EXTRAS, TIME_LIMITS, TIME_LIMIT_BASES, extrasFor, levelExtras, qualityLevels, timeLimitText } from "../../routines/nodes";
import { RefButton, RefsPanel, RefsUsed, addDropped } from "../RefsPanel";
import { QualitySlider } from "./EffortSlider";

export function BuildPanel({ projectId, base, styleName, rebuild, notReady, settings, onSettings, onStart, onClose }) {
  const { toast } = useApp();
  const [brief, setBrief] = useState(null);
  const key = `cz.buildExtras.${projectId}`,
    notesKey = `cz.buildNotes.${projectId}`;
  const [notes, setNotesState] = useState(() => {
    try {
      return localStorage.getItem(notesKey) || "";
    } catch {
      return "";
    }
  });
  const setNotes = (v) => {
    setNotesState(v);
    try {
      localStorage.setItem(notesKey, v);
    } catch {}
  };
  const [extras, setExtras] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      return [];
    }
  });
  const bound = SETTING_EXTRAS[base],
    [set, setSet] = useState(settings),
    [saving, setSaving] = useState(false);
  const boundOn = bound ? getAt(set, bound.path) !== false && (bound.path !== "web.on" || !!getAt(set, bound.path)) : false;
  const flipBound = async () => {
    if (!bound || !onSettings) return;
    const n = setAt(set, bound.path, !boundOn);
    setSaving(true);
    try {
      await onSettings(n);
      setSet(n);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setSaving(false);
    }
  };
  const std = isStandard(usePlan()),
    usable = std ? extras.filter((k) => k !== "ultra" && k !== "ultraplus") : extras;
  const list = extrasFor(base),
    on = usable.filter((k) => list.some((x) => x.key === k && !x.off));
  const save = (n) => {
    setExtras(n);
    try {
      localStorage.setItem(key, JSON.stringify(n));
    } catch {}
  };
  const flip = (k) => save(extras.includes(k) ? extras.filter((y) => y !== k) : [...extras, k]);
  const levels = qualityLevels(base),
    layers = levels.slice(1);
  let level = 0;
  while (level < layers.length && usable.includes(layers[level].key)) level++;
  const setLevel = (key2) => {
    if (std && (key2 === "ultra" || key2 === "ultraplus")) {
      toast(premiumMsg("Ultraedit"), "info");
      return;
    }
    save([...extras.filter((k) => !layers.some((l) => l.key === k)), ...levelExtras(key2, base)]);
  };
  const media = list.find((x) => x.key === "depth");
  const limitKey = `cz.buildLimit.${projectId}`,
    hasLimit = TIME_LIMIT_BASES.includes(base);
  const [limit, setLimitState] = useState(() => {
    try {
      const n = +(localStorage.getItem(limitKey) || 0);
      return TIME_LIMITS.includes(n) ? n : 0;
    } catch {
      return 0;
    }
  });
  const setLimit = (n) => {
    setLimitState(n);
    try {
      localStorage.setItem(limitKey, String(n));
    } catch {}
  };
  const start = () => {
    const mins = hasLimit ? limit : 0;
    onStart([notes.trim(), mins > 0 ? timeLimitText(mins, on.includes("ultra")) : ""].filter(Boolean).join("\n\n"), on);
  };
  useEffect(() => {
    api.readText(projectId, "brief.md").then((t) => setBrief(t ? t.replace(/^# Brief\s*/, "").trim() : ""));
  }, []);
  const [refsOpen, setRefsOpen] = useState(false),
    field = useRef(null);
  const dropRefs = {
    onDragOver: (e) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDrop: async (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      const l = await addDropped(projectId, e.dataTransfer.files, toast);
      if (l.length) field.current?.insert(l.map((r) => mentionOf(r.tag)).join(" "));
    },
  };
  return (
    <Modal
      title={notReady ? "Set up the build" : rebuild ? "Rebuild the video with Claude" : "Build the video with Claude"}
      onClose={onClose}
      dialogProps={dropRefs}
    >
      <div className="modal-body">
        <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
          Claude writes the storyboard, builds every shot synced to the narration, checks each one against rendered frames and designs the
          ambience. It runs unattended; you can watch it in the Claude panel or keep working.
        </p>
        {notReady && (
          <div className="hint">
            <HammerIcon size={18} />
            <div>
              <b>Set it up now, build later</b>
              <p>
                {notReady}
                {" Your direction and extras are kept for this project and used when you press Build."}
              </p>
            </div>
          </div>
        )}
        {rebuild && !notReady && (
          <div className="hint warn">
            <TriangleAlertIcon size={18} />
            <div>
              <b>Scenes already exist</b>
              <p>Claude will rework them to your notes. Every change is one revertable edit.</p>
            </div>
          </div>
        )}
        {brief ? (
          <div className="note" style={{ marginBottom: 18, fontSize: 12, whiteSpace: "pre-wrap" }}>
            <b style={{ fontWeight: 500, display: "block", marginBottom: 4 }}>Brief (brief.md)</b>
            {brief}
          </div>
        ) : null}
        <div className="field" style={{ marginBottom: 0 }}>
          <div className="rf-labelrow">
            <label htmlFor="build-notes">
              {"Direction for this build "}
              <span className="dim">(optional)</span>
            </label>
            <RefButton projectId={projectId} onClick={() => setRefsOpen(true)} />
          </div>
          <MentionField
            ref={field}
            projectId={projectId}
            id="build-notes"
            className="input"
            rows={4}
            autoFocus
            value={notes}
            onChange={setNotes}
            onAddReference={() => setRefsOpen(true)}
            placeholder="e.g. Keep it to 6 shots. Warm sunset palette in the second half. Calm cameras, no fast moves. Type @ to point at a reference."
          />
          <RefsUsed projectId={projectId} text={notes} onAdd={() => setRefsOpen(true)} />
        </div>
        {refsOpen && <RefsPanel projectId={projectId} onClose={() => setRefsOpen(false)} onInsert={(t) => field.current?.insert(t)} />}
        <div className="field build-extras" style={{ marginTop: 16, marginBottom: 0 }}>
          <label>Build quality</label>
          <div className="bx-for">
            {"Worded for "}
            {styleName}. Every level adds instructions to the build; the model and its effort stay the same.
          </div>
          {bound && onSettings ? (
            <label className="check" style={{ margin: "6px 0 12px" }} title={bound.detail}>
              <input type="checkbox" checked={boundOn} disabled={saving} onChange={flipBound} />
              <span>
                {bound.label} <span className="dim">(style setting)</span>
              </span>
            </label>
          ) : media && !media.off ? (
            <label className="check" style={{ margin: "6px 0 12px" }} title={media.detail}>
              <input type="checkbox" checked={extras.includes("depth")} onChange={() => flip("depth")} />
              <span>{media.label}</span>
            </label>
          ) : media?.off ? (
            <div className="bx-off" title={media.off} style={{ marginBottom: 12 }}>
              <span style={{ width: 16, flexShrink: 0 }} />
              <span>
                <b>{media.label}</b>
                {": not for "}
                {styleName}
                {". "}
                {media.off}
              </span>
            </div>
          ) : null}
          <QualitySlider base={base} value={levels[level].key} onChange={setLevel} locked={std ? ["ultra", "ultraplus"] : void 0} />
        </div>
        {hasLimit && (
          <div className="field" style={{ marginTop: 16, marginBottom: 0 }} data-build-limit>
            <label>Time limit</label>
            <div className="seg-ctl build-limit" role="radiogroup" aria-label="Time limit">
              {TIME_LIMITS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={limit === n}
                  className={limit === n ? "on" : ""}
                  data-limit={n}
                  onClick={() => setLimit(n)}
                >
                  {n ? `${n} min` : "Unlimited"}
                </button>
              ))}
            </div>
            <span className="help">
              {limit
                ? `Claude gets the deadline as a clock time and works faster to finish in ${limit} minutes${on.includes("ultra") ? ", the Ultraedit pass included" : ""}: it plans once, builds each part in one go and keeps the checks short.`
                : "Claude takes as long as the build needs."}
            </span>
          </div>
        )}
        <div className="modal-actions">
          {notReady ? (
            <button
              className="btn primary"
              onClick={() => {
                toast("Build set up. It uses these choices when you press Build.");
                onClose();
              }}
            >
              Save for later
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={start}>
                <HammerIcon size={15} />
                {rebuild ? "Rebuild" : "Start build"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
