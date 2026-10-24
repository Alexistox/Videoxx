import { useEffect, useState } from "react";
import { MOD } from "../../help/keys";

const COACH = [
  {
    sel: ".stage",
    title: "Click anything",
    text: "Pause and click a character, a label or the scenery. Shift+click adds more. The timeline selects shots, phrases, word cues and ranges.",
  },
  {
    sel: ".composer",
    title: "Say what to change",
    text: "Claude gets your selection, the frame you are looking at and the project context, edits the scene code and checks it against rendered frames.",
  },
  {
    sel: ".agent-head",
    title: "Review, compare, undo",
    text: `Every edit shows before/after and the files it touched. Revert any edit exactly, or press ${MOD}+Z. Press ? for all shortcuts.`,
  },
];
export function Coach({ onDone }) {
  const [i, setI] = useState(0);
  const [r, setR] = useState(null);
  useEffect(() => {
    const el = document.querySelector(COACH[i].sel);
    setR(el ? el.getBoundingClientRect() : null);
  }, [i]);
  if (!r) return null;
  const c = COACH[i],
    w = 300,
    left = Math.min(window.innerWidth - w - 16, Math.max(16, r.left + r.width / 2 - w / 2)),
    below = r.top < window.innerHeight / 2;
  return (
    <div className="coach-layer" role="dialog" aria-label="Getting around the editor">
      <div className="coach-ring" style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 }} />
      <div
        className="coach"
        style={{
          left,
          width: w,
          ...(below ? { top: Math.min(window.innerHeight - 190, r.bottom + 12) } : { top: Math.max(16, r.top - 170) }),
        }}
      >
        <small className="dim">
          {i + 1}
          {" of "}
          {COACH.length}
        </small>
        <h3>{c.title}</h3>
        <p>{c.text}</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="text-btn" onClick={onDone}>
            Skip
          </button>
          <span className="grow" />
          <button className="btn small primary" autoFocus onClick={() => (i + 1 < COACH.length ? setI(i + 1) : onDone())}>
            {i + 1 < COACH.length ? "Next" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}
