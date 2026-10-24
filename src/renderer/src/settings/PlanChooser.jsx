import { useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";
import { api } from "../lib/api";

export const PLANS = [
  { id: "pro", label: "Pro", price: 20 },
  { id: "max5", label: "Max 5x", price: 100 },
  { id: "max20", label: "Max 20x", price: 200 },
  { id: "team", label: "Team", price: 30 },
  { id: "other", label: "Other", price: null },
];
const planPrice = (kind, custom) =>
  kind === "other"
    ? custom != null && isFinite(+custom) && +custom >= 0
      ? +custom
      : null
    : (PLANS.find((p) => p.id === kind)?.price ?? null);
export function planOf(c) {
  const kind = PLANS.some((p) => p.id === c?.kind) ? c.kind : null;
  const custom = c?.custom != null && isFinite(+c.custom) ? +c.custom : null;
  return { kind, custom, price: planPrice(kind, custom), detected: c?.detected ?? null, hide: !kind && c?.hide === true };
}
export function planText(plan) {
  if (!plan?.kind) return plan?.hide ? "Savings hidden" : "Not set";
  const label = PLANS.find((p) => p.id === plan.kind)?.label ?? plan.kind;
  return plan.price != null
    ? `${label} · $${plan.price.toLocaleString(void 0, { maximumFractionDigits: 2 })}/mo`
    : `${label} · no price yet`;
}
export function PlanChooser({ plan, onSaved, hint = [], showHide = true }) {
  const [custom, setCustom] = useState(plan?.custom != null ? String(plan.custom) : "");
  useEffect(() => {
    setCustom(plan?.custom != null ? String(plan.custom) : "");
  }, [plan?.custom]);
  const [busy, setBusy] = useState(false);
  const pick = async (kind, price) => {
    if (busy) return;
    setBusy(true);
    try {
      onSaved(await api.setUsagePlan(kind, price ?? null));
    } finally {
      setBusy(false);
    }
  };
  const okCustom = custom.trim() !== "" && +custom >= 0 && isFinite(+custom);
  const saveOther = () => {
    if (okCustom) pick("other", +custom);
  };
  return (
    <div className="plan-chooser" role="group" aria-label="Your Claude plan">
      {PLANS.filter((p) => p.price != null).map((p) => {
        const on = plan?.kind === p.id;
        return (
          <button
            key={p.id}
            type="button"
            className={`btn small ${on ? "on" : ""} ${!on && hint.includes(p.id) ? "hint" : ""}`}
            aria-pressed={on}
            onClick={() => pick(p.id)}
          >
            {on && <CheckIcon size={12} />}
            {p.label}
            <small>${p.price}</small>
          </button>
        );
      })}
      <label className={`plan-other ${plan?.kind === "other" ? "on" : ""}`}>
        <span className="muted">Other $</span>
        <input
          className="input compact"
          type="number"
          min={0}
          step={1}
          placeholder="/month"
          aria-label="Other plan, monthly price in US dollars"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveOther();
            }
          }}
        />
        <button
          type="button"
          className="btn small"
          disabled={!okCustom || (plan?.kind === "other" && plan.custom === +custom)}
          onClick={saveOther}
        >
          Save
        </button>
      </label>
      {showHide && (
        <button
          type="button"
          className={`text-btn plan-hide ${plan?.hide ? "on" : ""}`}
          aria-pressed={!!plan?.hide}
          onClick={() => pick("hide")}
        >
          {plan?.hide && <CheckIcon size={12} />}Not sure · hide savings
        </button>
      )}
    </div>
  );
}
