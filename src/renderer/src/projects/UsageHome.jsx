import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { ChevronDown, Film } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { PLANS, PlanChooser, planText } from "../settings/PlanChooser";

const PERIODS = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "all", label: "All time", days: null },
];
const PERIOD_WORDS = { today: "today", "7d": "in the last 7 days", "30d": "in the last 30 days", all: "since you started" };
const MONTH = 30.44;
const FAMILY_COLOR = { opus: "var(--purple)", sonnet: "var(--blue)", haiku: "var(--mint)", fable: "var(--amber)", other: "var(--neutral)" };
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmtCompact = (n) => {
  const [d, u] = n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "k"] : [1, ""];
  return (n / d).toLocaleString(void 0, { maximumFractionDigits: u && n / d < 100 ? 1 : 0 }) + u;
};
const fmtUsd = (n) =>
  new Intl.NumberFormat(void 0, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: Math.abs(n) >= 1e3 ? 0 : 2,
    minimumFractionDigits: Math.abs(n) >= 1e3 ? 0 : 2,
  }).format(n);
const tokensOf = (r) => r.input + r.cacheRead + r.cacheWrite + r.output;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
const daysBetween = (a, b) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 864e5);
const dayLabel = (s) => parseDay(s).toLocaleDateString(void 0, { month: "short", day: "numeric" });
const monthLabel = (s) => parseDay(s + "-01").toLocaleDateString(void 0, { month: "short", year: "2-digit" });
let cached = null;
function Count({ v, fmt, ms = 800, delay = 0 }) {
  const [shown, setShown] = useState(() => (reduced() ? v : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (reduced()) {
      setShown(v);
      from.current = v;
      return;
    }
    const a = from.current,
      t0 = performance.now() + delay;
    let raf = 0;
    const tick = (t) => {
      const k = Math.min(1, Math.max(0, (t - t0) / ms)),
        e = 1 - Math.pow(1 - k, 3);
      const x = a + (v - a) * e;
      setShown(x);
      from.current = x;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return <span data-v={v}>{fmt(shown)}</span>;
}
export function UsageHome({ projects }) {
  const { go } = useApp();
  const [data, setData] = useState(cached);
  const [period, setPeriod] = useState("30d");
  const [metric, setMetric] = useState("tokens");
  const [on, setOn] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const planRef = useRef(null);
  useEffect(() => {
    api
      .usageSummary()
      .then((s) => {
        cached = s;
        setData(s);
      })
      .catch(() => setData((d) => d ?? cached));
  }, []);
  useEffect(() => {
    if (!planOpen) return;
    const key = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPlanOpen(false);
      }
    };
    const down = (e) => {
      if (!planRef.current?.contains(e.target)) setPlanOpen(false);
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("mousedown", down);
    };
  }, [planOpen]);
  useLayoutEffect(() => {
    if (!data) return;
    if (reduced()) {
      setOn(true);
      return;
    }
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(r);
  }, [!!data]);
  const planSaved = (plan2) => {
    setData((d) => d && { ...d, plan: plan2 });
    cached = cached && { ...cached, plan: plan2 };
    setPlanOpen(false);
  };
  const v = useMemo(() => {
    if (!data) return null;
    const p = PERIODS.find((x) => x.id === period),
      today = data.today;
    const start = p.days ? addDays(today, -(p.days - 1)) : (data.firstDay ?? today);
    const rows = data.rows.filter((r) => r.d >= start && r.d <= today);
    const sum = (list) =>
      list.reduce(
        (a, r) => ({
          tokens: a.tokens + tokensOf(r),
          cost: a.cost + (r.cost ?? 0),
          runs: a.runs + r.runs,
          read: a.read + r.cacheRead,
          inp: a.inp + (r.model ? r.input + r.cacheRead + r.cacheWrite : 0),
        }),
        { tokens: 0, cost: 0, runs: 0, read: 0, inp: 0 },
      );
    const tot = sum(rows);
    const estimated = rows.some((r) => r.estimated);
    const byModel = new Map();
    for (const r of rows) {
      const k = r.model ? r.label : "Earlier runs";
      const m = byModel.get(k) ?? {
        label: r.model ? r.label : "Model not recorded",
        family: r.model ? r.family : "none",
        tokens: 0,
        runs: 0,
        cost: 0,
      };
      m.tokens += tokensOf(r);
      m.runs += r.runs;
      m.cost += r.cost ?? 0;
      byModel.set(k, m);
    }
    const models = [...byModel.values()].sort((a, b) => b.tokens - a.tokens);
    const fav = models.find((m) => m.family !== "none") ?? null;
    const byProject = new Map();
    for (const r of rows) byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + tokensOf(r));
    const top = [...byProject.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, t]) => ({ id, name: data.projects[id]?.name ?? "Removed project", tokens: t }));
    let bars = [];
    const span = data.firstDay ? daysBetween(data.firstDay, today) + 1 : 1;
    if (period === "all" && span > 92) {
      const m = new Map();
      for (const r of data.rows) {
        const k = r.d.slice(0, 7),
          x = m.get(k) ?? { tokens: 0, cost: 0 };
        x.tokens += tokensOf(r);
        x.cost += r.cost ?? 0;
        m.set(k, x);
      }
      const first = parseDay(data.firstDay);
      first.setDate(1);
      for (const d = first; dayKey(d) <= today; d.setMonth(d.getMonth() + 1)) {
        const k = dayKey(d).slice(0, 7);
        bars.push({ key: k, label: monthLabel(k), ...(m.get(k) ?? { tokens: 0, cost: 0 }), inPeriod: true });
      }
    } else {
      const n = period === "all" ? Math.max(span, 7) : 30,
        from = addDays(today, -(n - 1));
      const m = new Map();
      for (const r of data.rows)
        if (r.d >= from) {
          const x = m.get(r.d) ?? { tokens: 0, cost: 0 };
          x.tokens += tokensOf(r);
          x.cost += r.cost ?? 0;
          m.set(r.d, x);
        }
      for (let i = 0; i < n; i++) {
        const k = addDays(from, i);
        bars.push({ key: k, label: dayLabel(k), ...(m.get(k) ?? { tokens: 0, cost: 0 }), inPeriod: k >= start });
      }
    }
    const price = data.plan.price,
      days = p.days ?? span;
    const planCost =
      price == null ? null : p.days === 30 ? price : p.days ? (price * p.days) / MONTH : price * Math.max(1, Math.ceil(span / MONTH));
    return { rows, tot, estimated, models, fav, top, bars, planCost, days, start };
  }, [data, period]);
  const continueRow = projects.slice(0, 3);
  const empty = !!data && !data.rows.length;
  const plan = data?.plan;
  const planLabel = plan?.kind ? PLANS.find((p) => p.id === plan.kind)?.label : null;
  const saved = v && v.planCost != null ? v.tot.cost - v.planCost : null;
  const cacheHit = v && v.tot.inp ? v.tot.read / v.tot.inp : null;
  const maxBar = v ? Math.max(1e-9, ...v.bars.map((b) => (metric === "tokens" ? b.tokens : b.cost))) : 1;
  const hint = plan?.detected
    ? /max/.test(plan.detected)
      ? ["max5", "max20"]
      : /pro/.test(plan.detected)
        ? ["pro"]
        : /team/.test(plan.detected)
          ? ["team"]
          : []
    : [];
  const hide = !!plan?.hide && !plan.kind;
  const ask = !!data && !plan?.kind && !hide;
  const pill = data && (
    <div className={`uh-plan ${planOpen ? "open" : ""}`} ref={planRef}>
      <button
        type="button"
        className="uh-plan-pill"
        aria-haspopup="dialog"
        aria-expanded={planOpen}
        title="Change your Claude plan"
        onClick={() => setPlanOpen((o) => !o)}
      >
        <span className="ellipsis">{hide ? "Savings hidden" : `Plan: ${planText(plan)}`}</span>
        <b>{hide ? "Show" : "Change"}</b>
        <ChevronDown size={12} />
      </button>
      {planOpen && (
        <div className="uh-plan-pop" role="dialog" aria-label="Your Claude plan">
          <small className="muted">Your Claude plan, used only to work out what you save.</small>
          <PlanChooser plan={plan} onSaved={planSaved} hint={hint} />
        </div>
      )}
    </div>
  );
  return (
    <>
      {continueRow.length > 0 && (
        <section className="panel uh-continue" aria-label="Continue where you left off">
          <div className="row uh-continue-head">
            <h3 className="grow">Continue where you left off</h3>
            <button className="text-btn" onClick={() => go("projects")}>
              All projects
            </button>
          </div>
          <div className="uh-continue-list">
            {continueRow.map((p) => (
              <button key={p.id} className="list-row" onClick={() => go("editor", p.id)}>
                <span className="well">
                  <Film size={15} strokeWidth={1.7} />
                </span>
                <span className="grow ellipsis" title={p.name}>
                  {p.name}
                </span>
                <time>{ago(p.opened_at || p.updated_at)}</time>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className={`uh ${on ? "on" : ""} ${empty ? "uh-none" : ""}`} aria-label="Your Claude usage">
        <div className="uh-head">
          <div className="grow">
            <h3>Your Claude usage</h3>
            <small className="muted">What Claude did in your videos, and what the same tokens would cost on the pay-per-token API.</small>
          </div>
          {hide && pill}
          <div className="tabs sm" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={period === p.id}
                className={period === p.id ? "active" : ""}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {ask && (
          <div className="uh-ask" role="group" aria-label="Your Claude plan">
            <span className="grow">
              <b>Which Claude plan are you on?</b>
              <small className="muted">
                {"Used only to work out what you save. "}
                {plan?.detected ? `Claude Code says "${plan.detected}".` : "You can change it any time."}
              </small>
            </span>
            <PlanChooser plan={plan} onSaved={planSaved} hint={hint} />
          </div>
        )}
        <div className={`uh-stats ${hide ? "three" : ""}`}>
          <div className="uh-stat" style={{ ["--i"]: 0 }}>
            <span className="uh-k">Tokens used</span>
            <b className="uh-v" data-stat="tokens">
              {v && !empty ? <Count v={v.tot.tokens} fmt={fmtCompact} /> : "—"}
            </b>
            <span className="uh-s">
              {v && !empty ? (
                <>
                  {v.tot.runs}
                  {" run"}
                  {v.tot.runs === 1 ? "" : "s"}
                  {cacheHit != null && (
                    <>
                      {" · "}
                      {Math.round(cacheHit * 100)}% from cache
                    </>
                  )}
                </>
              ) : (
                "No Claude runs yet"
              )}
            </span>
          </div>
          <div className="uh-stat" style={{ ["--i"]: 1 }}>
            <span className="uh-k">
              API equivalent<sup>*</sup>
            </span>
            <b className="uh-v" data-stat="cost">
              {v && !empty ? <Count v={v.tot.cost} fmt={fmtUsd} delay={90} /> : "—"}
            </b>
            <span className="uh-s">estimate at API list prices</span>
          </div>
          {!hide && (
            <div className={`uh-stat accent ${planOpen ? "raised" : ""}`} style={{ ["--i"]: 2 }}>
              <span className="uh-k">{saved != null && saved < 0 ? "Plan pays for itself at" : "You saved"}</span>
              <b className="uh-v" data-stat="saved">
                {v && !empty && saved != null ? (
                  saved >= 0 ? (
                    <Count v={saved} fmt={fmtUsd} delay={180} />
                  ) : (
                    <Count v={v.planCost} fmt={fmtUsd} delay={180} />
                  )
                ) : (
                  "—"
                )}
              </b>
              <span className="uh-s">
                {!plan?.kind
                  ? "Pick your plan to see it"
                  : empty
                    ? `${planLabel} plan`
                    : saved != null && saved < 0
                      ? `${fmtUsd(v.tot.cost)} so far ${PERIOD_WORDS[period]}`
                      : `vs ${planLabel} ${PERIOD_WORDS[period]}`}
              </span>
              {pill}
            </div>
          )}
          <div className="uh-stat" style={{ ["--i"]: 3 }}>
            <span className="uh-k">Favourite model</span>
            <b className="uh-v uh-model" data-stat="model">
              {v?.fav ? (
                <>
                  <i className="uh-dot" style={{ background: FAMILY_COLOR[v.fav.family] }} />
                  {v.fav.label}
                </>
              ) : (
                "—"
              )}
            </b>
            <span className="uh-s">
              {v?.fav && v.tot.tokens ? `${Math.round((v.fav.tokens / v.tot.tokens) * 100)}% of the tokens` : "by tokens used"}
            </span>
          </div>
        </div>
        {v && !empty && !hide && plan?.price != null && saved != null && (
          <p className="uh-sentence" data-stat="sentence">
            {"You'd have paid "}
            <b>{fmtUsd(v.tot.cost)}</b>
            {" on the API · your plan costs "}
            <b>{fmtUsd(v.planCost)}</b> {PERIOD_WORDS[period]}
            {" · "}
            {saved >= 0 ? (
              <>
                {"you saved "}
                <b className="good">{fmtUsd(saved)}</b>.
              </>
            ) : (
              <>
                {"it pays for itself after another "}
                <b>{fmtUsd(-saved)}</b>
                {" of API-equivalent use."}
              </>
            )}
          </p>
        )}
        <div className="uh-grid">
          <div className="uh-card uh-chart-card">
            <div className="row uh-card-head">
              <h4 className="grow">
                {metric === "tokens" ? "Tokens" : "API equivalent"}
                {" per "}
                {period === "all" && v && v.bars.length && v.bars[0].key.length === 7 ? "month" : "day"}
              </h4>
              <div className="tabs sm" role="tablist" aria-label="Chart shows">
                <button
                  role="tab"
                  aria-selected={metric === "tokens"}
                  className={metric === "tokens" ? "active" : ""}
                  onClick={() => setMetric("tokens")}
                >
                  Tokens
                </button>
                <button
                  role="tab"
                  aria-selected={metric === "cost"}
                  className={metric === "cost" ? "active" : ""}
                  onClick={() => setMetric("cost")}
                >
                  $
                </button>
              </div>
            </div>
            <div className="uh-bars" role="img" aria-label={`${metric === "tokens" ? "Tokens" : "API-equivalent dollars"} per day`}>
              <div className="uh-gridlines">
                <i />
                <i />
                <i />
              </div>
              {(v?.bars ?? Array.from({ length: 30 }, (_, i) => ({ key: String(i), label: "", tokens: 0, cost: 0, inPeriod: true }))).map(
                (b, i, all) => {
                  const val = metric === "tokens" ? b.tokens : b.cost,
                    h = empty ? 0 : val / maxBar;
                  return (
                    <div
                      key={b.key}
                      className={`uh-bar ${b.inPeriod ? "" : "out"}`}
                      tabIndex={empty || !val ? -1 : 0}
                      aria-label={`${b.label}: ${metric === "tokens" ? fmtCompact(val) + " tokens" : fmtUsd(val)}`}
                    >
                      <i
                        style={{
                          height: `${on ? Math.max(val ? 1.5 : 0, h * 100) : 0}%`,
                          transitionDelay: `${on ? Math.round((i / Math.max(1, all.length)) * 420) : 0}ms`,
                        }}
                      />
                      {!empty && (
                        <span className={`uh-tip ${i > all.length * 0.7 ? "left" : ""}`}>
                          <b>{metric === "tokens" ? fmtCompact(b.tokens) : fmtUsd(b.cost)}</b>
                          {metric === "tokens" ? ` tokens · ${fmtUsd(b.cost)}` : ` · ${fmtCompact(b.tokens)} tokens`}
                          <small>{b.label}</small>
                        </span>
                      )}
                    </div>
                  );
                },
              )}
              {empty && (
                <div className="uh-empty-note">
                  <b>Nothing yet</b>
                  <span>
                    Your first Claude edit or build shows up here: tokens, the model it used and what it would have cost on the API.
                  </span>
                </div>
              )}
            </div>
            {v && !empty && (
              <div className="uh-axis">
                <span>{v.bars[0]?.label}</span>
                <span>{v.bars[v.bars.length - 1]?.label}</span>
              </div>
            )}
          </div>
          {!hide && (
            <div className="uh-card uh-ring-card">
              <h4>Plan vs API</h4>
              <SavingsRing api={v && !empty ? v.tot.cost : 0} plan={v?.planCost ?? null} on={on} empty={empty} />
              <div className="uh-ring-legend">
                {v && !empty && v.planCost != null && v.tot.cost < v.planCost ? (
                  <>
                    <span>
                      <i style={{ background: "#8a8a8a" }} />
                      API equivalent
                    </span>
                    <span>
                      <i style={{ background: "#2f2f2f" }} />
                      {"Rest of "}
                      {planLabel}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <i style={{ background: "#5c5c5c" }} />
                      Plan{plan?.kind ? ` · ${planLabel}` : ""}
                    </span>
                    <span>
                      <i style={{ background: "var(--mint)" }} />
                      Saved
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="uh-card">
            <h4>Models</h4>
            <div className="uh-stack" aria-label="Share of tokens by model">
              {v && !empty
                ? v.models.map((m, i) => (
                    <i
                      key={m.label}
                      title={`${m.label}: ${fmtCompact(m.tokens)} tokens`}
                      style={{
                        width: on ? `${(m.tokens / Math.max(1, v.tot.tokens)) * 100}%` : 0,
                        background: m.family === "none" ? "#3c3c3c" : FAMILY_COLOR[m.family],
                        transitionDelay: `${200 + i * 90}ms`,
                      }}
                    />
                  ))
                : null}
            </div>
            <div className="uh-legend">
              {v && !empty ? (
                v.models.slice(0, 5).map((m) => (
                  <div key={m.label} className="uh-legend-row">
                    <i className="uh-dot" style={{ background: m.family === "none" ? "#555" : FAMILY_COLOR[m.family] }} />
                    <span className="grow ellipsis" title={m.label}>
                      {m.label}
                      {m.family === "none" && <sup>†</sup>}
                    </span>
                    <span className="muted">{fmtCompact(m.tokens)}</span>
                    <span className="uh-pct">{Math.round((m.tokens / Math.max(1, v.tot.tokens)) * 100)}%</span>
                  </div>
                ))
              ) : (
                <p className="small muted">The models Claude used, by share of tokens.</p>
              )}
            </div>
          </div>
          <div className="uh-card">
            <h4>Top projects</h4>
            <div className="uh-hbars">
              {v && !empty && v.top.length ? (
                v.top.map((t, i) => (
                  <button
                    key={t.id}
                    className="uh-hbar"
                    onClick={() => data?.projects[t.id] && t.name !== "Removed project" && go("editor", t.id)}
                    title={`Open ${t.name}`}
                  >
                    <span className="uh-hbar-top">
                      <span className="grow ellipsis" title={t.name}>
                        {t.name}
                      </span>
                      <span className="muted">{fmtCompact(t.tokens)}</span>
                    </span>
                    <span className="uh-hbar-track">
                      <i
                        style={{
                          width: on ? `${(t.tokens / Math.max(1, v.top[0].tokens)) * 100}%` : 0,
                          transitionDelay: `${260 + i * 80}ms`,
                        }}
                      />
                    </span>
                  </button>
                ))
              ) : (
                <p className="small muted">The projects that used the most tokens show up here.</p>
              )}
            </div>
          </div>
        </div>
        <p className="uh-foot">
          <sup>*</sup>
          {" An estimate at Anthropic's API list prices (input, output, cache reads and 5-minute cache writes per model, as listed on "}
          {PRICE_DATE}), not a bill: on your plan you pay the plan price.
          {v?.estimated && (
            <>
              {" "}
              <sup>†</sup>
              {
                " Runs before per-turn records only kept totals: their tokens count, their dollars are Claude Code's own estimate for each run, and their model and cache split are unknown."
              }
            </>
          )}
          {data && data.unpricedRuns > 0 && (
            <>
              {" "}
              {data.unpricedRuns}
              {" older run"}
              {data.unpricedRuns === 1 ? "" : "s"}
              {" had no cost recorded and "}
              {data.unpricedRuns === 1 ? "is" : "are"}
              {" not priced."}
            </>
          )}
          {data && data.unknownModels.length > 0 && (
            <>
              {" Not priced (model not in the price list): "}
              {data.unknownModels.join(", ")}.
            </>
          )}
          {!!data?.harvest?.runs && (
            <span data-harvest-runs={data.harvest.runs}>
              {" Library harvests (Claude looking back over a built video for things to reuse): "}
              {data.harvest.runs}
              {" run"}
              {data.harvest.runs === 1 ? "" : "s"}
              {", "}
              {fmtCompact(data.harvest.tokens)}
              {" tokens"}
              {data.harvest.cost ? ` (about ${fmtUsd(data.harvest.cost)})` : ""}, included above.
            </span>
          )}
          {plan?.kind && (
            <>
              {" Plan: "}
              {planLabel}
              {" at "}
              {fmtUsd(plan.price ?? 0)}
              {" a month."}
            </>
          )}
          {hide && <>{" Savings are hidden (no plan set)."}</>}
        </p>
      </section>
    </>
  );
}
const PRICE_DATE = "9 Oct 2026";
function SavingsRing({ api: api2, plan, on, empty }) {
  const R = 46,
    C = 2 * Math.PI * R;
  const whole = Math.max(api2, plan ?? 0, 1e-9);
  const planPart = plan == null || empty ? 0 : Math.min(plan, whole) / whole;
  const savedPart = plan == null || empty ? 0 : Math.max(0, api2 - plan) / whole;
  const paidOff = plan != null && plan > 0 ? Math.min(1, api2 / plan) : null;
  return (
    <div className="uh-ring" data-stat="ring">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={R} className="uh-ring-bg" />
        {plan != null && api2 < plan ? (
          <circle cx="60" cy="60" r={R} className="uh-ring-part" stroke="#8a8a8a" strokeDasharray={`${on ? (paidOff ?? 0) * C : 0} ${C}`} />
        ) : (
          <>
            <circle cx="60" cy="60" r={R} className="uh-ring-part" stroke="#5c5c5c" strokeDasharray={`${on ? planPart * C : 0} ${C}`} />
            <circle
              cx="60"
              cy="60"
              r={R}
              className="uh-ring-part saved"
              stroke="var(--mint)"
              strokeDasharray={`${on ? savedPart * C : 0} ${C}`}
              strokeDashoffset={-planPart * C}
            />
          </>
        )}
      </svg>
      <div className="uh-ring-mid">
        {empty || plan == null ? (
          <>
            <b>—</b>
            <small>{plan == null ? "no plan set" : "no runs yet"}</small>
          </>
        ) : api2 >= plan ? (
          <>
            <b>{plan > 0 ? `${(api2 / plan).toFixed(api2 / plan >= 10 ? 0 : 1)}×` : "∞"}</b>
            <small>your plan's value</small>
          </>
        ) : (
          <>
            <b>{Math.round((paidOff ?? 0) * 100)}%</b>
            <small>of the way to paying for itself</small>
          </>
        )}
      </div>
    </div>
  );
}
