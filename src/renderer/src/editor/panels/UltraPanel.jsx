import { useEffect, useMemo, useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";
import { api } from "../../lib/api";
import { fmtTime } from "../../lib/format";
import { Modal } from "../../components/ui";
import { MentionField } from "../../refs/MentionField";
import { BUILD_COST } from "../../routines/nodes";
import { RefButton, RefsPanel, RefsUsed } from "../RefsPanel";

const ULTRA_MODELS = [
  { id: "claude-opus-5-5", name: "Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
];
const ULTRA_EFFORTS = [
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
];
const ULTRA_MINUTES = [0, 1, 2, 3, 5, 10];
const ULTRA_OPTS_KEY = "ultraplus-opts";
const readUltraOpts = () => {
  const d = { model: "claude-opus-5-5", effort: "medium", minutes: 0 };
  try {
    const o = JSON.parse(localStorage.getItem(ULTRA_OPTS_KEY) || "{}");
    return {
      model: ULTRA_MODELS.some((m) => m.id === o.model) ? o.model : d.model,
      effort: ULTRA_EFFORTS.some((e) => e.id === o.effort) ? o.effort : d.effort,
      minutes: ULTRA_MINUTES.includes(o.minutes) ? o.minutes : d.minutes,
    };
  } catch {
    return d;
  }
};
export function UltraPanel({ projectId, shots, thumbs, initial, onStart, onClose, plusOk }) {
  const [plus, setPlus] = useState(false);
  const [opts, setOpts] = useState(readUltraOpts);
  const setOpt = (v) =>
    setOpts((o) => {
      const n = { ...o, ...v };
      try {
        localStorage.setItem(ULTRA_OPTS_KEY, JSON.stringify(n));
      } catch {}
      return n;
    });
  const modelName = ULTRA_MODELS.find((m) => m.id === opts.model)?.name ?? "Opus 5.5";
  const [flowImg, setFlowImg] = useState(false);
  useEffect(() => {
    if (plusOk)
      api
        .imagesStatus()
        .then((s) => setFlowImg(s?.active === "flow"))
        .catch(() => {});
  }, [plusOk]);
  const [done, setDone] = useState(new Map());
  useEffect(() => {
    api
      .readText(projectId, "ultraedit.json")
      .then((t) => {
        try {
          setDone(new Map((JSON.parse(t || "{}").shots || []).map((x) => [`${x.file}|${x.name}`, x.at])));
        } catch {}
      })
      .catch(() => {});
  }, [projectId]);
  const doneAt = (s) => done.get(`${s.file}|${s.name.replace(/^\d+[a-z]?[:.]\s*/i, "")}`);
  const files = useMemo(() => {
    const m = new Map();
    for (const s of shots) {
      const f = s.file || "scenes";
      m.set(f, [...(m.get(f) ?? []), s]);
    }
    return [...m.entries()];
  }, [shots]);
  const [picked, setPicked] = useState(() => new Set(initial ?? []));
  const [full, setFull] = useState(!initial?.length);
  useEffect(() => {
    if (full && initial?.length)
      requestAnimationFrame(() => document.querySelector(".ultra-shot.cur")?.scrollIntoView({ block: "center" }));
  }, [full]);
  const [notes, setNotes] = useState("");
  const [refsOpen, setRefsOpen] = useState(false),
    field = useRef(null);
  const flip = (ids, v) =>
    setPicked((p) => {
      const n = new Set(p);
      ids.forEach((i) => (v ? n.add(i) : n.delete(i)));
      return n;
    });
  const nFiles = files.filter(([, ss]) => ss.some((s) => picked.has(s.index))).length;
  const secsPicked = shots.filter((s) => picked.has(s.index)).reduce((a, s) => a + (s.t1 - s.t0), 0);
  const chosen = shots.filter((s) => picked.has(s.index));
  return (
    <Modal
      title={full ? "Ultraedit" : chosen.length === 1 ? `Ultraedit shot ${chosen[0].index + 1}` : `Ultraedit ${chosen.length} shots`}
      onClose={onClose}
      wide={full}
    >
      <div className="modal-body">
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          Opus 5.5 goes through the shots you pick, one by one: it looks at stills of the shot, writes down why it looks bad, adds detail
          and depth, fixes visual inconsistencies and checks the result. You get a before and after for every shot. Timing and narration
          stay. It is one revertable edit.
          {full
            ? " Pick a few shots to try it quickly; selecting shots in the list or on the timeline (Shift+click for more) brings you here with them."
            : ""}
        </p>
        {!full ? (
          <div className="ultra-quick">
            {chosen.map((s) => (
              <div key={s.index} className="uq-shot">
                {thumbs?.[s.index] ? <img src={thumbs[s.index]} alt="" /> : <span className="ph" />}
                <div className="grow">
                  <b>
                    {s.index + 1}
                    {". "}
                    {s.name.replace(/^\d+[a-z]?[:.]\s*/i, "") || "Shot " + (s.index + 1)}
                  </b>
                  <span className="dim">
                    {fmtTime(s.t0)}
                    {" · "}
                    {(s.t1 - s.t0).toFixed(1)}
                    {" s · "}
                    {s.file?.replace("scenes/", "")}
                    {doneAt(s) ? " · Ultraedited before" : ""}
                  </span>
                </div>
              </div>
            ))}
            <button className="text-btn" style={{ marginTop: 8 }} onClick={() => setFull(true)}>
              Change shots…
            </button>
          </div>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 8, gap: 8 }}>
              <button
                className="btn tiny"
                onClick={() =>
                  flip(
                    shots.map((s) => s.index),
                    true,
                  )
                }
              >
                All
              </button>
              <button className="btn tiny" onClick={() => setPicked(new Set())}>
                None
              </button>
              {done.size > 0 && (
                <button
                  className="btn tiny"
                  onClick={() => setPicked(new Set(shots.filter((s) => !doneAt(s)).map((s) => s.index)))}
                  title="Every shot that has not been Ultraedited yet"
                >
                  Not done yet
                </button>
              )}
              <span className="grow" />
              <span className="small">
                {picked.size
                  ? `${picked.size} shot${picked.size === 1 ? "" : "s"} in ${nFiles} scene${nFiles === 1 ? "" : "s"} · ${fmtTime(secsPicked)}`
                  : "Nothing picked"}
              </span>
            </div>
            <div className="ultra-list">
              {files.map(([f, ss]) => {
                const all = ss.every((s) => picked.has(s.index)),
                  some = ss.some((s) => picked.has(s.index));
                return (
                  <div key={f} className="ultra-file">
                    <label className="check ultra-fhead">
                      <input
                        type="checkbox"
                        checked={all}
                        ref={(el) => {
                          if (el) el.indeterminate = some && !all;
                        }}
                        onChange={() =>
                          flip(
                            ss.map((s) => s.index),
                            !all,
                          )
                        }
                      />
                      <b>{f.replace("scenes/", "")}</b>
                      <span className="dim">
                        {ss.filter((s) => doneAt(s)).length ? `${ss.filter((s) => doneAt(s)).length} of ${ss.length} Ultraedited · ` : ""}
                        {ss.length}
                        {" shot"}
                        {ss.length === 1 ? "" : "s"}
                        {" · "}
                        {fmtTime(ss[0].t0)}–{fmtTime(ss[ss.length - 1].t1)}
                      </span>
                    </label>
                    {ss.map((s) => (
                      <label key={s.index} className={`check ultra-shot ${initial?.includes(s.index) ? "cur" : ""}`}>
                        <input type="checkbox" checked={picked.has(s.index)} onChange={(e) => flip([s.index], e.target.checked)} />
                        {thumbs?.[s.index] ? <img src={thumbs[s.index]} alt="" loading="lazy" /> : <span className="ph" />}
                        <span className="grow ellipsis">
                          {s.index + 1}
                          {". "}
                          {s.name.replace(/^\d+[a-z]?[:.]\s*/i, "") || "Shot " + (s.index + 1)}
                        </span>
                        {doneAt(s) && (
                          <span className="ultra-done" title={`Ultraedited ${new Date(doneAt(s)).toLocaleString()}`}>
                            <SparklesIcon size={11} />
                            Ultraedited
                          </span>
                        )}
                        <span className="dim">{fmtTime(s.t0)}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
          <div className="rf-labelrow">
            <label htmlFor="ultra-notes">
              {"Notes for Claude "}
              <span className="dim">(optional)</span>
            </label>
            <RefButton projectId={projectId} onClick={() => setRefsOpen(true)} />
          </div>
          <MentionField
            ref={field}
            projectId={projectId}
            id="ultra-notes"
            className="input"
            rows={2}
            value={notes}
            onChange={setNotes}
            onAddReference={() => setRefsOpen(true)}
            placeholder="e.g. More background people. Keep the camera moves as they are. Type @ for a reference."
          />
          <RefsUsed projectId={projectId} text={notes} title="Used in this Ultraedit" onAdd={() => setRefsOpen(true)} />
        </div>
        {refsOpen && <RefsPanel projectId={projectId} onClose={() => setRefsOpen(false)} onInsert={(t) => field.current?.insert(t)} />}
        {plusOk && (
          <label className="check ultra-plus" data-ultra-plus style={{ marginTop: 12 }}>
            <input type="checkbox" checked={plus} onChange={(e) => setPlus(e.target.checked)} />
            <span>
              <b>Ultraedit+</b>{" "}
              <span className="dim">
                · your image service paints the ideal frame of each shot from its current still (
                {flowImg ? "free on Google Flow" : "about 1-5 cents a shot"}), then Claude rebuilds the shot to match it pass by pass, with
                a fresh critic scoring it (4 passes a shot, up to 2 more only when needed). The people stay as they are. Slower and uses
                more Claude.
              </span>
            </span>
          </label>
        )}
        {plusOk && plus && (
          <div
            className="ultra-opts"
            data-ultra-opts
            style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10, alignItems: "center" }}
          >
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Model
              <select
                className="input"
                data-ultra-model
                value={opts.model}
                onChange={(e) => setOpt({ model: e.target.value })}
                style={{ width: "auto" }}
              >
                {ULTRA_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Effort
              <span className="seg" role="group" aria-label="Effort" style={{ display: "inline-flex", gap: 4 }}>
                {ULTRA_EFFORTS.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    data-ultra-effort={x.id}
                    className={`btn tiny ${opts.effort === x.id ? "primary" : ""}`}
                    aria-pressed={opts.effort === x.id}
                    onClick={() => setOpt({ effort: x.id })}
                  >
                    {x.name}
                  </button>
                ))}
              </span>
            </span>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Time per shot
              <select
                className="input"
                data-ultra-minutes
                value={opts.minutes}
                onChange={(e) => setOpt({ minutes: +e.target.value })}
                style={{ width: "auto" }}
              >
                {ULTRA_MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m ? `${m} min` : "No limit"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <span className="help">
          {BUILD_COST}{" "}
          {plus && plusOk && opts.minutes
            ? `About ${opts.minutes} minute${opts.minutes === 1 ? "" : "s"} per shot (your limit) on ${modelName}, ${opts.effort} effort.`
            : `About ${plus ? "5-15" : "1-3"} minutes per shot on ${plus && plusOk ? `${modelName}, ${opts.effort} effort` : "Opus 5.5"}.`}
        </span>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary ultra-go"
            autoFocus={!full}
            disabled={!picked.size}
            onClick={() =>
              onStart(
                notes.trim(),
                [...picked].sort((a, b) => a - b),
                plusOk ? plus : false,
                plusOk && plus ? opts : void 0,
              )
            }
          >
            <SparklesIcon size={15} />
            {plus && plusOk ? "Ultraedit+" : "Ultraedit"} {picked.size ? `${picked.size} shot${picked.size === 1 ? "" : "s"}` : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}
