import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon,
  ChevronRightIcon,
  ClapperboardIcon,
  LogInIcon,
  PlusIcon,
  Redo2Icon,
  ScissorsIcon,
  SendHorizontalIcon,
  SquareIcon,
  TriangleAlertIcon,
  Undo2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { api, on } from "../lib/api";
import { ago, secs } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { Busy, Spinner, StatusBadge } from "../components/ui";
import { CODEX_MODELS, modelName, withEngine, workingText } from "../engines/models";
import { GoogleOptgroup, useGoogleState } from "../engines/ExperimentalGoogle";
import { CodexOptgroup, useCodexState } from "../engines/ChatGPTEngine";
import { ContextMeter } from "../editor/ContextMeter";
import { Md } from "../editor/Md";
import { ToolGroup } from "../editor/ToolGroup";

const LABEL = { cut: "Cut the footage", intro: "Edit the intro" };
const label = (kind, text = "") => (kind && LABEL[kind] ? `${LABEL[kind]}${text ? ": " + text : ""}` : text);
export function PClaudePanel({ projectId, media, onFinished, flowHost, onStarted, onShowWorkflows }) {
  const { claude, signIn, signingIn, toast } = useApp();
  const [items, setItems] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [task, setTask] = useState(null);
  const [kind, setKind] = useState(null);
  const [stream, setStream] = useState("");
  const [model, setModel] = useState(null),
    [engine, setEngine] = useState("claude");
  const [started, setStarted] = useState(0);
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState("edit");
  const [wfModel, setWfModelState] = useState("claude-opus-5-5");
  const google = useGoogleState();
  const codex = useCodexState();
  useEffect(() => {
    api
      .config()
      .then((c) => setWfModelState(c.claude.workflowModel || "claude-opus-5-5"))
      .catch(() => {});
  }, []);
  const setWfModel = (m) => {
    setWfModelState(m);
    api.setConfig({ claude: { workflowModel: m } }).catch(() => {});
  };
  const [last, setLast] = useState({});
  const fresh = useRef(false);
  const [freshPending, setFreshPending] = useState(false);
  const log = useRef(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!task) return;
    const iv = setInterval(() => tick((n) => n + 1), 1e3);
    return () => clearInterval(iv);
  }, [task]);
  const scrollDown = () => requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }));
  const loadLast = () =>
    api
      .edits(projectId)
      .then((list) => {
        const o = {};
        for (const e of list) {
          const k = /^Cut the footage/.test(e.instruction) ? "cut" : /^Edit the intro/.test(e.instruction) ? "intro" : null;
          if (k && !o[k]) o[k] = { status: e.status, at: e.created_at };
        }
        setLast(o);
      })
      .catch(() => {});
  const openThread = async (id, keepLive = false) => {
    const msgs = await api.messages(id),
      out = [];
    for (const m of msgs) {
      const c = m.content;
      if (m.role === "user") out.push({ k: "user", text: label(c.kind, c.text), kind: c.kind });
      else if (m.role === "assistant" || m.role === "note") out.push({ k: "assistant", text: c.text });
      else if (m.role === "tool") {
        const lastIt = out[out.length - 1],
          t = { id: String(m.id), summary: c.summary, done: true, error: false };
        if (lastIt?.k === "tools") lastIt.list.push(t);
        else out.push({ k: "tools", list: [t] });
      } else if (m.role === "error") out.push({ k: "error", text: c.text, auth: c.auth });
    }
    setItems((prev) => (keepLive ? [...out, ...prev] : out));
    setThreadId(id);
    scrollDown();
  };
  useEffect(() => {
    loadLast();
    api.running().then(async (r) => {
      const mine = r.find((x) => x.projectId === projectId);
      if (!mine) {
        const t = await api.projectThread(projectId);
        if (t) await openThread(t);
        return;
      }
      if (mine.threadId) await openThread(mine.threadId, true);
      setTask(mine.taskId);
      setKind(mine.kind ?? null);
      setStarted(mine.startedAt || Date.now());
      if (mine.model) setModel(mine.model);
      setEngine(mine.engine || "claude");
      if (mine.permissions?.length)
        setItems((x) => [
          ...x,
          ...mine.permissions.map((p) => ({ k: "perm", taskId: mine.taskId, requestId: p.requestId, summary: p.summary, input: p.input })),
        ]);
    });
  }, [projectId]);
  useEffect(
    () =>
      on("claude:event", (ev) => {
        if (ev.projectId !== projectId) return;
        if (ev.type === "starting") {
          setTask(ev.taskId);
          setKind(ev.kind ?? null);
          setStarted(Date.now());
          setEngine("google");
          setItems((x) => [...x, { k: "assistant", text: ev.text }]);
          scrollDown();
          return;
        }
        if (ev.type === "started" && ev.engine) setEngine(ev.engine);
        if (ev.type === "note" && ev.warn) setEngine("claude");
        if (ev.type === "init") setModel(ev.model);
        else if (ev.type === "delta") {
          setStream((s) => s + ev.text);
          scrollDown();
        } else if (ev.type === "text" || ev.type === "note") {
          setStream("");
          setItems((x) => [...x, { k: "assistant", text: ev.warn ? `⚠ ${ev.text}` : ev.text }]);
          scrollDown();
        } else if (ev.type === "tool") {
          setStream("");
          setItems((x) => {
            const l = x[x.length - 1],
              t = { id: ev.id, summary: ev.summary, done: false, error: false };
            return l?.k === "tools" ? [...x.slice(0, -1), { ...l, list: [...l.list, t] }] : [...x, { k: "tools", list: [t] }];
          });
          scrollDown();
        } else if (ev.type === "tool_done")
          setItems((x) =>
            x.map((it) =>
              it.k === "tools" ? { ...it, list: it.list.map((t) => (t.id === ev.id ? { ...t, done: true, error: ev.error } : t)) } : it,
            ),
          );
        else if (ev.type === "permission") {
          setItems((x) => [...x, { k: "perm", taskId: ev.taskId, requestId: ev.requestId, summary: ev.summary, input: ev.input }]);
          scrollDown();
        } else if (ev.type === "done") {
          const k = kindRef.current;
          setStream("");
          setTask(null);
          setKind(null);
          setItems((x) => [
            ...x.map((it) => (it.k === "tools" ? { ...it, list: it.list.map((t) => ({ ...t, done: true })) } : it)),
            ...(ev.error ? [{ k: "error", text: ev.error, auth: ev.auth }] : []),
            { k: "result", status: ev.status, files: ev.files ?? [], ms: ev.ms, editId: ev.editId, error: ev.error, kind: k ?? void 0 },
          ]);
          loadLast();
          scrollDown();
          const ok = ev.status === "done" || ev.status === "no-change";
          if (k === "cut" && ev.status === "done")
            toast("Claude cut the footage. The timeline is updated: watch it through, then sign off.");
          else if (k === "intro" && ev.status === "done") toast("Claude edited the intro. It is now at the start of the timeline.");
          else if (ev.status === "done")
            toast(
              `${ev.engine === "codex" ? "ChatGPT" : "Claude"} changed ${ev.files?.length ?? 0} file${ev.files?.length === 1 ? "" : "s"}.`,
            );
          onFinished?.(k ?? "edit", ok);
        }
      }),
    [projectId, onFinished],
  );
  const kindRef = useRef(null);
  kindRef.current = kind;
  const run = async (k, instruction) => {
    if (!claude?.loggedIn) {
      toast("Claude is not connected yet.", "bad", { label: "Sign in", run: signIn });
      return;
    }
    if (task) {
      toast("Claude is still working. Wait for it to finish, or stop it first.", "info");
      return;
    }
    if ((k === "edit" || k === "ask") && !instruction.trim()) return;
    const isFresh = fresh.current;
    fresh.current = false;
    setFreshPending(false);
    setItems((x) => [...x, { k: "user", text: label(k, instruction), kind: k }]);
    scrollDown();
    try {
      const r = await api.run({ projectId, threadId: isFresh ? null : threadId, newSession: isFresh, kind: k, instruction });
      setTask(r.taskId);
      setThreadId(r.threadId);
      setKind(k);
      setStarted(Date.now());
      setModel(null);
      if (r.engine) setEngine(r.engine);
      if (k === "cut" || k === "intro") {
        setOpen(null);
        setNotes("");
      } else setText("");
      onStarted?.();
    } catch (e) {
      setTask(null);
      setKind(null);
      setItems((x) => [...x, { k: "error", text: e.message }]);
    }
  };
  const answer = async (it, allow) => {
    await api.permission(it.taskId, it.requestId, allow);
    setItems((x) => x.map((y) => (y === it ? { ...it, answer: allow } : y)));
  };
  const revert = async (editId) => {
    try {
      await api.revert(editId);
      toast("Reverted. The timeline is back to how it was before.", "ok", { label: "Re-apply", run: () => reapply(editId) });
      setItems((x) => x.map((it) => (it.k === "result" && it.editId === editId ? { ...it, status: "reverted" } : it)));
      loadLast();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const reapply = async (editId) => {
    try {
      await api.reapply(editId);
      toast("Re-applied.");
      setItems((x) => x.map((it) => (it.k === "result" && it.editId === editId ? { ...it, status: "done" } : it)));
      loadLast();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const newChat = () => {
    if (task) return;
    setItems([]);
    setThreadId(null);
    fresh.current = true;
    setFreshPending(true);
    setStream("");
  };
  const screen = media.find((m) => m.role === "screen" && !m.derived),
    intro = media.find((m) => m.role === "intro" && !m.derived),
    cams = media.filter((m) => m.role === "facecam" && !m.derived);
  const flows = [
    {
      id: "cut",
      icon: <ScissorsIcon size={16} strokeWidth={1.7} />,
      title: "Cut the footage",
      what: `Keeps only the sentences your video needs, each from your last clean take: restarts, stutters, breaths and dead air never make it in${cams.length ? `. Syncs ${cams.length === 1 ? "the facecam" : `${cams.length} facecam clips into one`}` : ""}. Every cut is listened back and checked before it reaches your timeline.`,
      blocked: !screen
        ? 'Add the screen recording first (mark it "Screen recording" in Footage).'
        : !screen.audio
          ? "The screen recording has no audio: the cut is made from its sound."
          : null,
      time: "usually 20-45 min",
    },
    {
      id: "intro",
      icon: <ClapperboardIcon size={16} strokeWidth={1.7} />,
      title: "Edit the intro",
      what: "Apple-style animated text and graphics on your intro read, then sound effects on every move.",
      blocked: !intro ? 'Add your intro read and mark it "Intro" in Footage.' : null,
      time: "usually 15-30 min",
    },
  ];
  return (
    <div className="pclaude" aria-label="Claude">
      <ContextMeter projectId={projectId} onFresh={newChat} freshPending={freshPending} busy={!!task} />
      <div className="agent-log" ref={log} aria-live="polite">
        {items.length > 0 && (
          <div className="row pflows-head">
            <span className="sec-title grow" style={{ margin: 0 }}>
              Conversation
            </span>
            <button
              className="icon-btn sm"
              onClick={newChat}
              disabled={!!task}
              aria-label="New conversation"
              title="New conversation (Claude starts fresh; the edits stay)"
            >
              <PlusIcon size={15} strokeWidth={1.7} />
            </button>
          </div>
        )}
        {!items.length && !task && (
          <div className="pclaude-empty">
            <p>
              {"Start "}
              <b>Cut the footage</b>
              {" or "}
              <b>Edit the intro</b>
              {" from Workflows, or ask Claude for a change below."}
            </p>
            {onShowWorkflows && (
              <button className="btn small" onClick={onShowWorkflows}>
                Open Workflows
              </button>
            )}
          </div>
        )}
        {flowHost &&
          createPortal(
            <div className="pflows">
              {flows.map((f) => {
                const l = last[f.id],
                  busy = task && kind === f.id,
                  isOpen = open === f.id;
                return (
                  <div key={f.id} className={`pflow ${isOpen ? "open" : ""} ${busy ? "busy" : ""}`}>
                    <button
                      className="pflow-head"
                      onClick={() => setOpen(isOpen ? null : f.id)}
                      aria-expanded={isOpen}
                      disabled={!!task && !busy}
                    >
                      <span className="pflow-ic">{busy ? <Spinner size={14} /> : f.icon}</span>
                      <span className="grow">
                        <b>{f.title}</b>
                        <small>
                          {busy
                            ? `Working · ${secs(Date.now() - (started || Date.now()))}`
                            : l
                              ? `${l.status === "done" ? "Done" : l.status === "reverted" ? "Reverted" : l.status === "failed" ? "Failed" : l.status === "cancelled" ? "Stopped" : l.status} ${ago(l.at)}`
                              : f.time}
                        </small>
                      </span>
                      <ChevronRightIcon size={15} className="pflow-chev" />
                    </button>
                    {isOpen && (
                      <div className="pflow-body">
                        <p>{f.what}</p>
                        {f.blocked ? (
                          <div className="note warn">{f.blocked}</div>
                        ) : (
                          <>
                            <textarea
                              className="input"
                              rows={2}
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder={
                                f.id === "cut"
                                  ? "Notes (optional): e.g. keep the long demo at 12:00, cut the tangent about pricing"
                                  : "Notes (optional): e.g. show the three tools as cards, blue accent"
                              }
                            />
                            <div className="row">
                              <select
                                className="pflow-model"
                                value={wfModel}
                                onChange={(e) => setWfModel(e.target.value)}
                                aria-label="Model for this workflow"
                                title="Opus 5.5: the most careful edit. Sonnet 5.5: faster and lighter on your plan."
                              >
                                <option value="claude-opus-5-5">Opus 5.5</option>
                                <option value="claude-sonnet-5-5">Sonnet 5.5</option>
                                {/^google:/.test(wfModel) && !google?.models.some((m) => `google:${m.id}` === wfModel) && (
                                  <option value={wfModel}>{modelName(wfModel, google)}</option>
                                )}
                                {/^codex:/.test(wfModel) && !(codex?.ready && CODEX_MODELS.some((m) => `codex:${m.id}` === wfModel)) && (
                                  <option value={wfModel}>{modelName(wfModel, google)}</option>
                                )}
                                <CodexOptgroup codex={codex} />
                                <GoogleOptgroup google={google} />
                              </select>
                              <span className="grow" />
                              <button className="btn small primary" onClick={() => run(f.id, notes.trim())} disabled={!!task}>
                                {l?.status === "done" ? "Run again" : "Start"}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>,
            flowHost,
          )}
        {!claude?.loggedIn && (
          <button className="btn primary" onClick={signIn} disabled={signingIn}>
            {signingIn ? <Spinner size={15} /> : <LogInIcon size={15} />}Sign in to Claude
          </button>
        )}
        {items.map((it, i) => {
          if (it.k === "user")
            return (
              <div key={i} className="msg user">
                {it.text}
              </div>
            );
          if (it.k === "assistant")
            return (
              <div key={i} className="msg assistant md">
                <Md text={it.text} />
              </div>
            );
          if (it.k === "tools") return <ToolGroup key={i} list={it.list} />;
          if (it.k === "error")
            return (
              <div key={i} className="msg err">
                <div className="row">
                  <TriangleAlertIcon size={14} />
                  <span className="grow">{it.text}</span>
                </div>
                {it.auth && (
                  <button className="btn tiny" style={{ marginTop: 8 }} onClick={signIn}>
                    <LogInIcon size={12} />
                    Sign in again
                  </button>
                )}
              </div>
            );
          if (it.k === "perm")
            return (
              <div key={i} className="perm">
                <b style={{ fontWeight: 500 }}>
                  {"Claude wants to: "}
                  {it.summary}
                </b>
                <code>{it.input}</code>
                {it.answer === void 0 ? (
                  <div className="row">
                    <button className="btn tiny" onClick={() => answer(it, true)}>
                      <CheckIcon size={12} />
                      Allow
                    </button>
                    <button className="btn tiny" onClick={() => answer(it, false)}>
                      <XIcon size={12} />
                      Deny
                    </button>
                  </div>
                ) : (
                  <small>{it.answer ? "Allowed" : "Denied"}</small>
                )}
              </div>
            );
          if (it.k === "result")
            return (
              <div key={i} className={`result-card ${it.status === "failed" ? "fail" : ""}`}>
                <div className="row">
                  <StatusBadge s={it.status} />
                  <span className="small">{secs(it.ms)}</span>
                </div>
                {it.files.length > 0 && it.status !== "reverted" && (
                  <div className="row">
                    <button className="btn tiny" onClick={() => revert(it.editId)}>
                      <Undo2Icon size={12} />
                      Revert{it.kind === "cut" ? " the cut" : it.kind === "intro" ? " the intro" : ""}
                    </button>
                  </div>
                )}
                {it.files.length > 0 && it.status === "reverted" && (
                  <div className="row">
                    <button className="btn tiny" onClick={() => reapply(it.editId)}>
                      <Redo2Icon size={12} />
                      Re-apply
                    </button>
                  </div>
                )}
              </div>
            );
          return null;
        })}
        {stream && <div className="msg assistant">{stream}</div>}
        {task && (
          <div className="working">
            <Busy text={kind && LABEL[kind] ? LABEL[kind] : workingText(engine)} since={started || void 0} kind="orbit" />
            {model && (
              <span className="model-chip">
                {engine !== "claude" ? modelName(withEngine(model, engine), google) : model.replace(/^claude-/, "")}
              </span>
            )}
            <span className="grow" />
            <button className="btn tiny" onClick={() => api.stop(task)}>
              <SquareIcon size={11} />
              Stop
            </button>
          </div>
        )}
      </div>
      <div className="composer">
        {!text && !task && (
          <div className="chips">
            {(mode === "edit"
              ? ["Tighten the pauses a little more", "Put back the part about the setup", "Cut the last minute"]
              : ["What did you cut, and why?", "Where does the video drag?", "Write chapters for YouTube"]
            ).map((s) => (
              <button key={s} className="btn tiny ghost" style={{ border: "1px solid #333" }} onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <textarea
          aria-label="Instruction for Claude"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={task ? "Claude is working…" : mode === "edit" ? "Ask Claude to change the cut…" : "Ask about the video…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
              e.preventDefault();
              run(mode, text);
            }
          }}
        />
        <div className="row">
          <div className="seg-ctl" role="radiogroup" aria-label="Request type">
            <button role="radio" aria-checked={mode === "edit"} className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>
              <WrenchIcon size={12} />
              Change
            </button>
            <button role="radio" aria-checked={mode === "ask"} className={mode === "ask" ? "on" : ""} onClick={() => setMode("ask")}>
              Question
            </button>
          </div>
          <span className="grow" />
          {task ? (
            <button className="btn small" onClick={() => api.stop(task)}>
              <SquareIcon size={13} />
              Stop
            </button>
          ) : (
            <button className="btn small primary" onClick={() => run(mode, text)} disabled={!text.trim()}>
              <SendHorizontalIcon size={14} />
              {mode === "edit" ? "Apply" : "Ask"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
