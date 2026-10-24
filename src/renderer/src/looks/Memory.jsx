import { useEffect, useState } from "react";
import { BrainIcon, CheckIcon, FilmIcon, GlobeIcon, PlusIcon, SparklesIcon, TrashIcon } from "lucide-react";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { Empty, Spinner, Toggle } from "../components/ui";

export function Memory() {
  const { toast, projects, setSuggestions } = useApp();
  const [rules, setRules] = useState([]);
  const [text, setText] = useState("");
  const [scope, setScope] = useState("global");
  const [pid, setPid] = useState("");
  const [tab, setTab] = useState("all");
  const [learning, setLearning] = useState(false);
  const [why, setWhy] = useState({});
  const learn = async () => {
    setLearning(true);
    try {
      const r = await api.learnRules();
      setWhy((w) => ({ ...w, ...Object.fromEntries(r.added.map((a) => [a.id, a.because])) }));
      await load();
      setTab("suggested");
      toast(
        r.added.length
          ? `Claude read ${r.analysed} edits and suggests ${r.added.length} rule${r.added.length === 1 ? "" : "s"}.`
          : `Claude read ${r.analysed} edits and found no clear new preference yet.`,
        r.added.length ? "ok" : "info",
      );
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setLearning(false);
    }
  };
  const load = async () => {
    const r = await api.rules();
    setRules(r);
    setSuggestions(r.filter((x) => x.status === "suggested").length);
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!pid && projects[0]) setPid(projects[0].id);
  }, [projects]);
  const add = async () => {
    try {
      await api.addRule({ scope, projectId: pid, text });
      setText("");
      load();
      toast("Rule saved. Every new Claude session follows it.");
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const list = rules.filter((r) =>
    tab === "all" ? true : tab === "suggested" ? r.status === "suggested" : r.scope === tab && r.status === "active",
  );
  const nSug = rules.filter((r) => r.status === "suggested").length;
  return (
    <div className="page page-enter narrow">
      <div className="page-head">
        <div>
          <h1>Memory</h1>
          <div className="sub">
            Style rules Claude follows in every session. Claude suggests new ones when an edit reveals a preference; you decide what sticks.
          </div>
        </div>
        <div className="actions">
          <button
            className="btn"
            onClick={learn}
            disabled={learning}
            title="Claude reads your recent edit requests and proposes rules for what you keep asking for"
          >
            {learning ? <Spinner size={15} /> : <SparklesIcon size={16} strokeWidth={1.7} />}Learn from my edits
          </button>
        </div>
      </div>
      <section className="panel pad" style={{ marginBottom: 25 }} aria-label="Add a rule">
        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="rule-text">New rule</label>
          <textarea
            id="rule-text"
            className="input"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Never place the camera behind the character being talked about; frame their face or a 3/4 view."
          />
        </div>
        <div className="row wrap">
          <div className="tabs sm" role="radiogroup" aria-label="Scope">
            <button className={scope === "global" ? "active" : ""} onClick={() => setScope("global")}>
              <GlobeIcon size={13} />
              All videos
            </button>
            <button className={scope === "project" ? "active" : ""} onClick={() => setScope("project")} disabled={!projects.length}>
              <FilmIcon size={13} />
              One project
            </button>
          </div>
          {scope === "project" && (
            <select
              className="input compact"
              style={{ width: 240 }}
              value={pid}
              onChange={(e) => setPid(e.target.value)}
              aria-label="Project"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <span className="grow" />
          <button className="btn primary small" onClick={add} disabled={!text.trim()}>
            <PlusIcon size={14} />
            Add rule
          </button>
        </div>
      </section>
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {["all", "global", "project", "suggested"].map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "suggested" ? `Suggested${nSug ? ` (${nSug})` : ""}` : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {!list.length ? (
        <Empty
          icon={<BrainIcon size={28} strokeWidth={1.7} />}
          title={tab === "suggested" ? "No suggestions waiting" : "No rules yet"}
          text="Rules are short, reusable preferences like camera framing, text placement or colour choices. They're written to STYLE.md and given to every Claude session."
        />
      ) : (
        <section className="panel" style={{ padding: "4px 22px" }}>
          {list.map((r) => (
            <div key={r.id} className={`rule-row ${!r.enabled ? "off" : ""}`}>
              <div className="grow">
                <div className="txt">{r.text}</div>
                <div className="meta">
                  {r.scope === "global" ? (
                    <>
                      <GlobeIcon size={12} />
                      All videos
                    </>
                  ) : (
                    <>
                      <FilmIcon size={12} />
                      {r.project_name ?? "deleted project"}
                    </>
                  )}
                  <span>{ago(r.created_at)}</span>
                  {r.status === "suggested" && (
                    <span className="badge">
                      <i />
                      Suggested by Claude
                    </span>
                  )}
                </div>
                {why[r.id] && (
                  <div className="meta" style={{ marginTop: 4 }}>
                    {"Because: "}
                    {why[r.id]}
                  </div>
                )}
              </div>
              {r.status === "suggested" ? (
                <>
                  <button
                    className="btn small"
                    onClick={async () => {
                      await api.updateRule(r.id, { status: "active" });
                      load();
                      toast("Rule kept.");
                    }}
                  >
                    <CheckIcon size={14} />
                    Keep
                  </button>
                  <button
                    className="btn small ghost"
                    onClick={async () => {
                      await api.deleteRule(r.id);
                      load();
                    }}
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <>
                  <Toggle
                    label="Rule enabled"
                    on={!!r.enabled}
                    onChange={async (v) => {
                      await api.updateRule(r.id, { enabled: v });
                      load();
                    }}
                  />
                  <button
                    className="icon-btn"
                    aria-label="Delete rule"
                    onClick={async () => {
                      await api.deleteRule(r.id);
                      load();
                    }}
                  >
                    <TrashIcon size={16} strokeWidth={1.7} />
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
