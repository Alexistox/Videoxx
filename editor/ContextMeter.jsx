import { useCallback, useEffect, useRef, useState } from "react";
import { api, on } from "../src/renderer/src/lib/api";
import { Plus } from "../node_modules/lucide-react/dist/esm/lucide-react";
import { modelName } from "../src/renderer/src/engines/models";

const tok = (n) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`
    : n >= 1e4
      ? `${Math.round(n / 1e3)}k`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k`
        : String(Math.round(n));
const MARK = 0.8;
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const LIMIT_NAME = {
  five_hour: "5-hour limit",
  seven_day: "Weekly limit",
  seven_day_opus: "Weekly Opus limit",
  seven_day_sonnet: "Weekly Sonnet limit",
};
export function ContextMeter({ projectId, onFresh, freshPending = false, busy = false }) {
  const [u, setU] = useState(null);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const load = useCallback(() => {
    api
      .contextUsage(projectId)
      .then(setU)
      .catch(() => {});
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(
    () =>
      on("claude:event", (ev) => {
        if (ev.projectId !== projectId) return;
        if (ev.type === "usage" && ev.usage) setU((prev) => (ev.usage.hasData || !prev ? ev.usage : { ...prev, live: true }));
        else if (ev.type === "init") setU((prev) => (prev ? { ...prev, live: true } : prev));
        else if (ev.type === "done") load();
      }),
    [projectId, load],
  );
  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!u) return null;
  const has = u.hasData && u.context != null && !freshPending;
  const ctx = has ? u.context : 0,
    share = ctx / u.compactAt;
  const state = !has ? "none" : ctx >= u.amberAt ? "near" : share >= 0.5 ? "mid" : "idle";
  const fill = Math.min(1, share * MARK);
  const label = freshPending ? "New conversation on your next request" : has ? null : u.live ? "Measuring…" : "No usage recorded yet";
  const run = u.run,
    conv = u.conversation;
  const total = (x) => x.input + x.cacheRead + x.cacheWrite + x.output;
  const plan = u.plan;
  return (
    <div className={`ctxm ${u.live ? "live" : ""}`} data-state={state} ref={box}>
      <button
        className="ctxm-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          has ? `Claude's conversation: ${tok(ctx)} of ${tok(u.compactAt)} tokens before it is summarised. Details` : "Claude usage details"
        }
        title={
          has
            ? `${tok(ctx)} tokens in Claude's conversation. At ${tok(u.compactAt)} it is summarised automatically. Click for details.`
            : "Click for details"
        }
      >
        <span className="ctxm-track" aria-hidden="true">
          <span className="ctxm-fill" style={{ width: `${(fill * 100).toFixed(2)}%` }} />
          <span className="ctxm-mark" style={{ left: `${MARK * 100}%` }} />
        </span>
        <span className="ctxm-label">
          {label ?? (
            <>
              <b>{tok(ctx)}</b>
              <span>
                {" / "}
                {tok(u.compactAt)}
                {" context"}
              </span>
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="ctxm-pop" role="dialog" aria-label="Context and token usage">
          <div className="ctxm-pop-head">
            <span className="grow">{u.separate ? "Ultraedit’s conversation" : "Claude’s conversation"}</span>
            {u.model && <span className="ctxm-model">{modelName(u.model)}</span>}
          </div>
          {has ? (
            <>
              <div className="ctxm-big">
                <b>{tok(ctx)}</b>
                {" of "}
                {tok(u.compactAt)}
                {" tokens"}
                <span>{Math.min(100, Math.round(share * 100))}% of the way to the summary point</span>
              </div>
              <p className="ctxm-limit">
                {u.freshNext && !u.live
                  ? "It reached the summary point: your next request starts a fresh conversation with a short summary of your edits."
                  : `At ${tok(u.compactAt)} the conversation is summarised automatically; a progress file keeps the build on track.`}
                {u.window ? ` The model can hold up to ${tok(u.window)}; summarising earlier keeps your usage down.` : ""}
              </p>
            </>
          ) : (
            <p className="ctxm-limit">
              {freshPending
                ? "You started a new conversation: nothing is used until your next request."
                : "Nothing recorded for this conversation yet. The numbers appear after Claude’s next request."}
            </p>
          )}
          {has && run && (
            <div className="ctxm-sec">
              <div className="ctxm-sec-t">
                {u.live ? "This run so far" : "Last run"}
                <span>
                  {tok(total(run))}
                  {" tokens · "}
                  {run.turns}
                  {" step"}
                  {run.turns === 1 ? "" : "s"}
                </span>
              </div>
              <dl className="ctxm-rows">
                <dt>
                  New input<small>what was new in each step</small>
                </dt>
                <dd data-k="input">{tok(run.input)}</dd>
                <dt>
                  Read from cache<small>the earlier conversation, re-read cheaply</small>
                </dt>
                <dd data-k="cacheRead">{tok(run.cacheRead)}</dd>
                <dt>
                  Read fresh<small>tokens Claude had to re-read in full (no cache)</small>
                </dt>
                <dd data-k="cacheWrite">{tok(run.cacheWrite)}</dd>
                <dt>
                  Written by Claude<small>its replies and code</small>
                </dt>
                <dd data-k="output">{tok(run.output)}</dd>
                <dt>
                  Images sent<small>frames and pictures Claude looked at</small>
                </dt>
                <dd data-k="images">{run.images}</dd>
              </dl>
            </div>
          )}
          {has && (
            <dl className="ctxm-rows ctxm-sum">
              {conv && (
                <>
                  <dt>
                    This conversation
                    <small>
                      {conv.runs}
                      {" request"}
                      {conv.runs === 1 ? "" : "s"}, every step counted
                    </small>
                  </dt>
                  <dd data-k="conversation">{tok(total(conv))}</dd>
                </>
              )}
              {u.cacheHit != null && (
                <>
                  <dt>
                    Cache hit<small>share of the last step read from the cache</small>
                  </dt>
                  <dd data-k="cacheHit">{Math.round(u.cacheHit * 100)}%</dd>
                </>
              )}
            </dl>
          )}
          <div className="ctxm-plan" data-k="plan">
            {plan && plan.utilization != null ? (
              <>
                {LIMIT_NAME[plan.type ?? ""] ?? "Plan limit"}
                {": "}
                <b>{Math.round(plan.utilization * 100)}% used</b>
                {plan.resetsAt ? `, resets ${clock(plan.resetsAt)}` : ""}
              </>
            ) : plan && plan.status !== "allowed" ? (
              <>
                {LIMIT_NAME[plan.type ?? ""] ?? "Plan limit"}
                {": "}
                {plan.status === "rejected" ? "reached" : "getting close"}
                {plan.resetsAt ? `, resets ${clock(plan.resetsAt)}` : ""}
              </>
            ) : (
              "Your plan’s usage limit shows here when Claude Code reports it (claude.ai sign-ins)."
            )}
          </div>
          {onFresh && !u.live && !busy && !freshPending && has && (
            <button
              className="btn tiny ctxm-fresh"
              onClick={() => {
                onFresh();
                setOpen(false);
              }}
            >
              <Plus size={12} />
              Start a fresh conversation
            </button>
          )}
        </div>
      )}
    </div>
  );
}
