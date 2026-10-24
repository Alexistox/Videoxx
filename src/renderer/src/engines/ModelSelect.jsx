import { Fragment, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Gauge, Sparkles } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { CLAUDE_EFFORTS, effortName } from "./claudeModels";
import { engineOf, modelGroups, modelName } from "./models";
import { Dropdown } from "../components/Dropdown";

const BLURB = {
  "claude-opus-5-5": "Best quality, the default for builds",
  "claude-sonnet-5-5": "Faster, lighter on your plan",
  "claude-haiku-5-5": "Fastest, for small fixes",
};
const SHORT = { low: "Low", medium: "Med", high: "High", xhigh: "X-High", max: "Max" };
const EFFORT_HINT = {
  low: "Fastest, lightest on your plan",
  medium: "Balanced, the default",
  high: "More careful",
  xhigh: "Even more careful, slower",
  max: "Slowest, uses the most of your plan",
};
export function ModelSelect({ value, onChange, globalLabel, globalHint, google, codex, ariaLabel, disabled, style, extra = [] }) {
  const groups = modelGroups(
    google ? { enabled: google.enabled, signedIn: google.accounts.length > 0, models: google.models } : null,
    codex ? { ready: codex.ready } : null,
  );
  const dd = [
    ...(globalLabel !== null ? [{ options: [{ value: "", label: globalLabel, hint: globalHint }] }] : []),
    ...groups.map((g) => ({
      label: g.label,
      options: [...g.models.map((m) => ({ value: m.id, label: m.name, hint: BLURB[m.id] })), ...(g.engine === "claude" ? extra : [])],
    })),
  ];
  if (value && !dd.some((g) => g.options.some((o) => o.value === value)))
    dd.push({ options: [{ value, label: modelName(value, google) }] });
  return <Dropdown value={value} groups={dd} onChange={onChange} ariaLabel={ariaLabel} disabled={disabled} style={style} menuWidth={260} />;
}
export function EffortSelect({ value, onChange, globalLabel, ariaLabel, disabled, title, style }) {
  const dd = [
    ...(globalLabel !== null ? [{ options: [{ value: "", label: globalLabel }] }] : []),
    { options: CLAUDE_EFFORTS.map((x) => ({ value: x.id, label: x.name, hint: EFFORT_HINT[x.id] })) },
  ];
  return (
    <Dropdown
      value={value}
      groups={dd}
      onChange={onChange}
      ariaLabel={ariaLabel}
      disabled={disabled}
      title={title}
      style={style}
      menuWidth={240}
    />
  );
}
export function ModelPicker({ model, effort, globalModel, globalEffort, effectiveModel, effectiveEffort, google, codex, onPick }) {
  const [open, setOpen] = useState(false),
    box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const down = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    const key = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const groups = modelGroups(
    google ? { enabled: google.enabled, signedIn: google.accounts.length > 0, models: google.models } : null,
    codex ? { ready: codex.ready } : null,
  );
  const known = groups.some((g) => g.models.some((m) => m.id === model));
  const noEffort = engineOf(effectiveModel) === "google";
  const Row = ({ id, name, blurb }) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={model === id}
      className={`mp-row${model === id ? " on" : ""}`}
      data-mp-model={id ?? ""}
      onClick={() => onPick({ model: id })}
    >
      <span className="grow">
        <b>{name}</b>
        {blurb && <small>{blurb}</small>}
      </span>
      {model === id && <Check size={14} />}
    </button>
  );
  return (
    <div className="mp" ref={box}>
      <button
        type="button"
        className={`mp-btn${model || effort ? " own" : ""}${open ? " open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-mp-open
        aria-label="Claude model for this project"
        data-model={model ?? ""}
        data-effort={effort ?? ""}
        data-effort-shown={noEffort ? "false" : "true"}
        data-first={`Global setting (${modelName(globalModel, google)})`}
        data-groups={groups.map((g) => g.label).join("|")}
        title="Claude's model and effort for this project only. Global setting = what Settings > AI engines says."
        onClick={() => setOpen(!open)}
      >
        <Sparkles size={13} />
        <span className="ellipsis">{modelName(effectiveModel, google)}</span>
        {!noEffort && (
          <>
            <span className="mp-sep" />
            <Gauge size={13} />
            <span>{effortName(effectiveEffort)}</span>
          </>
        )}
        <ChevronDown size={13} className="mp-chev" />
      </button>
      {open && (
        <div className="mp-menu" role="menu">
          <div className="mp-label">Model</div>
          <Row id={null} name={`Global setting · ${modelName(globalModel, google)}`} blurb="Whatever Settings > AI engines says" />
          {groups.map((g) => (
            <Fragment key={g.engine}>
              {g.engine !== "claude" && <div className="mp-label">{g.label}</div>}
              {g.models.map((m) => (
                <Row key={m.id} id={m.id} name={m.name} blurb={BLURB[m.id]} />
              ))}
            </Fragment>
          ))}
          {model && !known && <Row id={model} name={modelName(model, google)} />}
          {!noEffort && (
            <>
              <div className="mp-label">
                {"Effort "}
                <span className="dim">· more thinking, slower, more of your plan</span>
              </div>
              <div className="mp-effort" role="radiogroup" aria-label="Effort">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!effort}
                  className={!effort ? "on" : ""}
                  data-mp-effort=""
                  title={`Global setting (${effortName(globalEffort)})`}
                  onClick={() => onPick({ effort: null })}
                >
                  Global
                </button>
                {CLAUDE_EFFORTS.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    role="radio"
                    aria-checked={effort === x.id}
                    className={effort === x.id ? "on" : ""}
                    data-mp-effort={x.id}
                    title={`${x.name} effort`}
                    onClick={() => onPick({ effort: x.id })}
                  >
                    {SHORT[x.id] ?? x.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
