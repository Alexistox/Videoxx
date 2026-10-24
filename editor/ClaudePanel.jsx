import { memo, useCallback, useEffect, useRef, useState } from "react";
import { api, on } from "../src/renderer/src/lib/api";
import { ago, money, secs } from "../src/renderer/src/lib/format";
import { useApp } from "../src/renderer/src/state/AppProvider";
import {
  AudioLines,
  Brain,
  Check,
  CodeXml,
  FileDiff,
  LogIn,
  MessagesSquare,
  Plus,
  Redo2,
  RotateCcw,
  RotateCcwClock,
  SendHorizontal,
  Sparkles,
  Sprout,
  Square,
  TriangleAlert,
  Undo2,
  Wrench,
  X,
} from "../node_modules/lucide-react/dist/esm/lucide-react";
import { Busy, Modal, Spinner, StatusBadge } from "../src/renderer/src/components/ui";
import { MentionField } from "../src/renderer/src/refs/MentionField";
import { effortName } from "../src/renderer/src/engines/claudeModels";
import { engineOf, modelName, withEngine, workingText } from "../src/renderer/src/engines/models";
import { useGoogleState } from "../src/renderer/src/engines/ExperimentalGoogle";
import { useCodexState } from "../src/renderer/src/engines/ChatGPTEngine";
import { ModelPicker } from "../src/renderer/src/engines/ModelSelect";
import { lang } from "../src/renderer/src/settings/languages";
import { PROJECT_MODEL_EVENT } from "../src/renderer/src/settings/project/ProjectSettingsPanel";
import { requestLibraryInbox } from "../state/libraryInbox";
import { hideTimeLimit } from "../routines/nodes";
import { ContextMeter } from "./ContextMeter";
import { RefButton, RefsPanel, RefsUsed, addDropped } from "./RefsPanel";
import { Md } from "./Md";
import { Compare, ToolGroup, srcOf } from "./ToolGroup";

const queues = new Map();
const handledRequests = new Set();
const requestLabel = (kind, raw = "") => {
  const text = hideTimeLimit(raw);
  return kind === "ultra"
    ? `Ultraedit${text ? ": " + text : ""}`
    : kind === "build"
      ? `Build the video${text ? ": " + text : ""}`
      : kind === "style"
        ? `Build the style: ${text}`
        : kind === "script"
          ? `Research and write the script${text ? ": " + text : ""}`
          : text;
};
export const ClaudePanel = memo(ClaudePanel$1);
function ClaudePanel$1({
  onSeek,
  getTime,
  projectId,
  selection,
  setSelection,
  label,
  snapshot,
  onEditDone,
  buildRequest,
  ultraRequest,
  fixRequest,
  scriptRequest,
  audioBusy,
  lockedModel,
}) {
  const google = useGoogleState();
  const codex = useCodexState();
  const audioRef = useRef(audioBusy);
  audioRef.current = audioBusy;
  const lockedRef = useRef(lockedModel);
  lockedRef.current = lockedModel;
  const { claude, signIn, signingIn, toast, noticeImageKey, go } = useApp();
  const [tab, setTab] = useState("chat");
  const [items, setItems] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [task, setTask] = useState(null);
  const [stream, setStream] = useState("");
  const draftKey = `cz-draft-${projectId}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      text ? localStorage.setItem(draftKey, text) : localStorage.removeItem(draftKey);
    } catch {}
  }, [text]);
  const [images, setImages] = useState([]);
  const [refsOpen, setRefsOpen] = useState(false),
    field = useRef(null);
  const addImageFile = (f) =>
    new Promise((res) => {
      if (!f.type.startsWith("image/")) return res();
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        setImages((x) => [...x, c.toDataURL("image/jpeg", 0.88)].slice(0, 4));
        URL.revokeObjectURL(img.src);
        res();
      };
      img.onerror = () => res();
      img.src = URL.createObjectURL(f);
    });
  const [scope, setScope] = useState("selection");
  const [mode, setMode] = useState("edit");
  const newSession = useRef(false);
  const [freshPending, setFreshPending] = useState(false);
  const [edits, setEdits] = useState([]);
  const [threads, setThreads] = useState([]);
  const [diff, setDiff] = useState(null);
  const [model, setModel] = useState(null);
  const [engine, setEngine] = useState("claude"),
    [fellBack, setFellBack] = useState(false);
  const [pc, setPc] = useState(null);
  useEffect(() => {
    api
      .projectModel(projectId)
      .then(setPc)
      .catch(() => {});
    const f = (e) => {
      const d = e.detail;
      if (d?.projectId === projectId && d.pc) setPc(d.pc);
    };
    window.addEventListener(PROJECT_MODEL_EVENT, f);
    return () => window.removeEventListener(PROJECT_MODEL_EVENT, f);
  }, [projectId]);
  const pickClaude = async (v) => {
    try {
      const next = await api.setProjectModel(projectId, v);
      setPc(next);
      if (v.model !== void 0)
        toast(
          `This project runs on ${modelName(next.effective.model)}${v.model ? "" : " (the global setting)"} from the next request.${threadId ? " A new model re-reads the conversation once, so that request uses a little more of your plan." : ""}`,
          "info",
        );
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const [started, setStarted] = useState(0);
  const log = useRef(null);
  const taskRef = useRef(null);
  taskRef.current = task;
  const scrollDown = () => requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }));
  const loadHistory = useCallback(() => {
    api.edits(projectId).then(setEdits);
    api.threads(projectId).then(setThreads);
  }, [projectId]);
  useEffect(() => {
    loadHistory();
    api.running().then(async (r) => {
      const mine = r.find((x) => x.projectId === projectId);
      if (!mine) {
        const t = await api.projectThread(projectId);
        if (t) await openThread(t, true);
        return;
      }
      if (mine.threadId) await openThread(mine.threadId, true);
      setTask(mine.taskId);
      runningKind.current = mine.kind ?? null;
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
  const selKey = selection.map((s) => s.kind).join(",");
  useEffect(() => {
    setScope(selection.length ? (selection.every((s) => s.kind === "shot") ? "shot" : "selection") : "video");
  }, [selKey]);
  const openThread = async (id, keepLive = false) => {
    const msgs = await api.messages(id);
    const out = [];
    for (const m of msgs) {
      const c = m.content;
      if (m.role === "user") out.push({ k: "user", text: requestLabel(c.kind, c.text), selection: c.selection ?? [], scope: c.scope });
      else if (m.role === "assistant") out.push({ k: "assistant", text: c.text });
      else if (m.role === "note") out.push({ k: "note", text: c.text, warn: !!c.warn });
      else if (m.role === "tool") {
        const last = out[out.length - 1];
        const t = { id: String(m.id), summary: c.summary, done: true, error: false };
        if (last?.k === "tools") last.list.push(t);
        else out.push({ k: "tools", list: [t] });
      } else if (m.role === "error") out.push({ k: "error", text: c.text, auth: c.auth });
    }
    setItems((prev) => (keepLive ? [...out, ...prev] : out));
    setThreadId(id);
    setTab("chat");
    newSession.current = false;
    setFreshPending(false);
    scrollDown();
  };
  useEffect(
    () =>
      on("claude:event", (ev) => {
        if (ev.projectId !== projectId) return;
        if (ev.type === "started" && ev.kind === "studio" && !taskRef.current) {
          setTask(ev.taskId);
          setThreadId(ev.threadId);
          setStarted(Date.now());
          runningKind.current = "studio";
          setTab("chat");
          scrollDown();
          return;
        }
        if (ev.type === "starting") {
          setTask(ev.taskId);
          setStarted(Date.now());
          setEngine("google");
          setFellBack(false);
          setItems((x) => [...x, { k: "note", text: ev.text }]);
          scrollDown();
          return;
        }
        if (ev.type === "started" && ev.engine) setEngine(ev.engine);
        if (ev.type === "init") setModel(ev.model);
        else if (ev.type === "delta") {
          setStream((s) => s + ev.text);
          scrollDown();
        } else if (ev.type === "text") {
          setStream("");
          setItems((x) => [...x, { k: "assistant", text: ev.text }]);
          scrollDown();
        } else if (ev.type === "note") {
          if (ev.warn) setFellBack(true);
          setItems((x) => [...x, { k: "note", text: ev.text, warn: !!ev.warn }]);
          scrollDown();
        } else if (ev.type === "tool") {
          setStream("");
          setItems((x) => {
            const last = x[x.length - 1];
            const t = { id: ev.id, summary: ev.summary, done: false, error: false };
            return last?.k === "tools" ? [...x.slice(0, -1), { ...last, list: [...last.list, t] }] : [...x, { k: "tools", list: [t] }];
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
          setStream("");
          setTask(null);
          setItems((x) => [
            ...x.map((it) => (it.k === "tools" ? { ...it, list: it.list.map((t) => ({ ...t, done: true })) } : it)),
            ...(ev.error ? [{ k: "error", text: ev.error, auth: ev.auth }] : []),
            {
              k: "result",
              status: ev.status,
              files: ev.files,
              cost: ev.cost,
              ms: ev.ms,
              editId: ev.editId,
              error: ev.error,
              compare: ev.compare,
              reused:
                ev.kind === "build" || ev.kind === "ultra"
                  ? (() => {
                      try {
                        return JSON.parse(ev.edit?.lib_used || "[]").length;
                      } catch {
                        return 0;
                      }
                    })()
                  : null,
            },
          ]);
          loadHistory();
          scrollDown();
          if (ev.files?.length) onEditDone(ev.files);
          const L = ev.language ? lang(ev.language.to).name : "";
          if (ev.language?.applied)
            toast(
              `Claude wrote the script in ${L}: the video is ${L} from now on (the voice reads and the words are timed in it). Revert takes both back.`,
            );
          else if (ev.language) toast(`The script was not rewritten, so the video keeps its language (not ${L}).`, "info");
          else if (ev.status === "done" && !lockedRef.current)
            toast(`${ev.engine === "codex" ? "ChatGPT" : "Claude"} changed ${ev.files.length} file${ev.files.length === 1 ? "" : "s"}.`);
          if (ev.status === "done" || ev.status === "no-change") runNextRef.current();
          else if (queueRef.current.length)
            toast(
              `${ev.status === "cancelled" ? "Stopped" : "That edit failed"}. ${queueRef.current.length} queued edit(s) kept - press Run queue to continue.`,
              "info",
            );
        }
      }),
    [projectId, loadHistory, onEditDone],
  );
  const [harvests, setHarvests] = useState({});
  useEffect(
    () =>
      on("library:harvest", (ev) => {
        if (ev.projectId === projectId && ev.sourceEditId) setHarvests((h) => ({ ...h, [ev.sourceEditId]: ev }));
      }),
    [projectId],
  );
  useEffect(
    () =>
      on("claude:frames", (f) => {
        if (f.projectId === projectId) {
          if (f.match)
            setItems((x) => {
              let i = -1;
              for (let k = x.length - 1; k >= 0; k--) {
                const it = x[k];
                if (it.k === "match" && it.m.shot === f.match.shot) {
                  i = k;
                  break;
                }
              }
              if (i < 0) return [...x, { k: "match", m: f.match }];
              const prev = x[i].m,
                newPass = f.match.pass != null && f.match.pass !== prev.pass;
              const m = {
                ...prev,
                ...(newPass ? { score: null, summary: void 0 } : {}),
                ...Object.fromEntries(Object.entries(f.match).filter(([, v]) => v != null)),
              };
              const n = [...x];
              n[i] = { k: "match", m };
              return n;
            });
          else setItems((x) => [...x, { k: "frames", frames: f.frames }]);
          scrollDown();
        }
      }),
    [projectId],
  );
  useEffect(
    () =>
      on("rules:suggested", (r) => {
        if (!r.projectId || r.projectId === projectId) setItems((x) => [...x, { k: "rule", id: r.id, text: r.text, scope: r.scope }]);
      }),
    [projectId],
  );
  const [queue, setQueue] = useState(() => queues.get(projectId) ?? []);
  const queueRef = useRef([]);
  queueRef.current = queue;
  useEffect(() => {
    queues.set(projectId, queue);
  }, [queue, projectId]);
  const runningKind = useRef(null);
  const start = async (job, fromQueue = false) => {
    runningKind.current = job.kind;
    const fresh = newSession.current;
    newSession.current = false;
    setFreshPending(false);
    setItems((x) => [
      ...x,
      {
        k: "user",
        text: requestLabel(job.kind, job.instruction) + (job.language ? ` (in ${lang(job.language).name})` : ""),
        selection: job.selection,
        scope: job.kind === "edit" ? job.scope : void 0,
      },
    ]);
    setTab("chat");
    scrollDown();
    setFellBack(false);
    setEngine("claude");
    setModel(null);
    try {
      const r = await api.run({
        projectId,
        threadId: fresh ? null : threadId,
        newSession: fresh,
        kind: job.kind,
        extras: job.extras,
        shots: job.shots,
        model: job.model,
        effort: job.effort,
        ultraMinutes: job.minutes,
        instruction: job.instruction,
        selection: job.selection,
        scope: job.scope,
        frame: job.frame,
        beforeFrame: job.plain,
        images: job.images,
        time: job.time,
        language: job.language,
      });
      setTask(r.taskId);
      setThreadId(r.threadId);
      setStarted(Date.now());
      if (r.engine) setEngine(r.engine);
    } catch (e) {
      setTask(null);
      setItems((x) => [...x, { k: "error", text: e.message }]);
      if (/Fal\.ai API key first/.test(e.message)) noticeImageKey("This video needs pictures, but image generation is not set up yet.");
    }
  };
  const send = async (kind = mode, instruction = text, over, language) => {
    if (!claude?.loggedIn) {
      if (instruction !== text || kind === "build" || kind === "script" || kind === "ultra")
        pending.current = { kind, instruction, over, language };
      toast(
        pending.current
          ? "Claude is not connected yet. This starts as soon as you sign in."
          : "Claude is not connected yet. Your instruction is kept.",
        "bad",
        { label: "Sign in", run: signIn },
      );
      return;
    }
    if (kind !== "build" && kind !== "script" && kind !== "ultra" && !instruction.trim()) return;
    if (audioRef.current && kind !== "ask") {
      toast(`${audioRef.current} Ask Claude when it is finished: your instruction is kept.`, "info");
      return;
    }
    const snap = kind === "build" || kind === "script" || kind === "ultra" ? null : await snapshot().catch(() => null);
    const job = {
      extras: kind === "build" ? extrasRef.current : void 0,
      shots: kind === "ultra" ? shotsRef.current : void 0,
      ...(kind === "ultra" && plusRef.current ? { extras: ["ultraplus"], ...ultraOptsRef.current } : {}),
      kind,
      instruction,
      selection: over?.selection ?? selection,
      scope: over?.scope ?? scope,
      images,
      time: getTime?.() ?? null,
      frame: snap?.frame ?? null,
      plain: snap?.plain ?? null,
      language,
    };
    if (instruction === text) setText("");
    setImages([]);
    if (
      task &&
      (kind === "script" || kind === "build" || kind === "ultra") &&
      (runningKind.current === kind || queueRef.current.some((j) => j.kind === kind))
    ) {
      toast(
        kind === "script"
          ? "Claude is already writing the script."
          : kind === "ultra"
            ? "An Ultraedit is already running or queued."
            : "Claude is already building the video.",
        "info",
      );
      return;
    }
    if (task) {
      setQueue((q) => [...q, job]);
      toast("Queued. It runs when Claude finishes the current task.", "info");
      return;
    }
    start(job);
  };
  const pending = useRef(null);
  useEffect(() => {
    const p = pending.current;
    if (claude?.loggedIn && p) {
      pending.current = null;
      send(p.kind, p.instruction, p.over, p.language);
    }
  }, [claude?.loggedIn]);
  const runNext = () => {
    const [next, ...rest] = queueRef.current;
    if (!next) return;
    if (audioRef.current && next.kind !== "ask") {
      toast(`${audioRef.current} ${queueRef.current.length} queued edit(s) kept: press Run queue then.`, "info");
      return;
    }
    setQueue(rest);
    setTimeout(() => start(next, true), 300);
  };
  const runNextRef = useRef(runNext);
  runNextRef.current = runNext;
  const once = (n) => !!n && !handledRequests.has(n) && !!handledRequests.add(n);
  useEffect(() => {
    if (once(buildRequest.n)) {
      extrasRef.current = buildRequest.extras ?? [];
      send("build", buildRequest.notes);
    }
  }, [buildRequest.n]);
  const extrasRef = useRef([]);
  const shotsRef = useRef([]),
    plusRef = useRef(false),
    ultraOptsRef = useRef({});
  useEffect(() => {
    if (once(ultraRequest?.n)) {
      shotsRef.current = ultraRequest.shots;
      plusRef.current = !!ultraRequest.plus;
      ultraOptsRef.current = ultraRequest.plus
        ? { model: ultraRequest.model, effort: ultraRequest.effort, minutes: ultraRequest.minutes || void 0 }
        : {};
      send("ultra", ultraRequest.notes);
    }
  }, [ultraRequest?.n]);
  useEffect(() => {
    if (once(fixRequest.n)) send("edit", fixRequest.text, { selection: [], scope: "video" });
  }, [fixRequest.n]);
  useEffect(() => {
    if (once(scriptRequest?.n)) send("script", scriptRequest.notes, void 0, scriptRequest.language);
  }, [scriptRequest?.n]);
  const newChat = () => {
    if (task) return;
    setItems([]);
    setThreadId(null);
    newSession.current = true;
    setFreshPending(true);
    setStream("");
  };
  const revert = async (editId) => {
    try {
      await api.revert(editId);
      toast("Edit reverted. The preview is reloading.", "ok", { label: "Re-apply", run: () => reapply(editId) });
      loadHistory();
      setItems((x) => x.map((it) => (it.k === "result" && it.editId === editId ? { ...it, status: "reverted" } : it)));
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const reapply = async (editId) => {
    try {
      await api.reapply(editId);
      toast("Edit re-applied. The preview is reloading.");
      loadHistory();
      setItems((x) => x.map((it) => (it.k === "result" && it.editId === editId ? { ...it, status: "done" } : it)));
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const restore = (e, i) =>
    toast(
      i === 0
        ? `Undo "${e.instruction.slice(0, 50)}"?`
        : `Go back to before "${e.instruction.slice(0, 40)}"? This undoes it and the ${i} edit${i === 1 ? "" : "s"} after it; each can be re-applied.`,
      "info",
      {
        label: "Restore",
        run: () =>
          api
            .restore(e.id)
            .then((r) => {
              toast(`Restored. ${r.undone} edit${r.undone === 1 ? "" : "s"} undone.`);
              loadHistory();
            })
            .catch((err) => toast(err.message, "bad")),
      },
    );
  const showDiff = async (editId, title) => {
    const t = await api.diff(editId);
    setDiff({ title, text: t || "No file changes." });
  };
  const answer = async (it, allow) => {
    await api.permission(it.taskId, it.requestId, allow);
    setItems((x) => x.map((y) => (y === it ? { ...it, answer: allow } : y)));
  };
  const answerRule = async (it, keep) => {
    if (keep) await api.updateRule(it.id, { status: "active" });
    else await api.deleteRule(it.id);
    setItems((x) => x.map((y) => (y === it ? { ...it, answer: keep ? "kept" : "dismissed" } : y)));
    toast(keep ? "Rule saved to Memory." : "Suggestion dismissed.");
  };
  const placeholder = selection.length
    ? `What should change about ${selection.length === 1 ? label(selection[0]) : `these ${selection.length} things`}?`
    : mode === "ask"
      ? "Ask about the video…"
      : "Describe a change, or click something in the preview first…";
  return (
    <aside className="ed-right" aria-label="Claude">
      <div className="agent-head">
        <Sparkles size={17} strokeWidth={1.7} style={{ color: "var(--mint)" }} />
        <h3>{!lockedModel && engineOf(pc?.effective.model) === "codex" ? "ChatGPT" : "Claude"}</h3>
        <span className="grow cl-model-head">
          {lockedModel ? (
            <span
              className="cl-model-chip own"
              title="Every run in a Style Studio workspace (stages, fixes, chat) is Opus 5.5 at high effort or more, whatever the setting."
            >
              {lockedModel}
            </span>
          ) : (
            pc && (
              <span
                className={`cl-model-chip${pc.model || pc.effort ? " own" : ""}`}
                data-model={pc.effective.model ?? ""}
                data-effort={pc.effective.effort}
                title={
                  engineOf(pc.effective.model) === "codex"
                    ? `This project runs on ${modelName(pc.effective.model)} through your own Codex and your ChatGPT plan (Settings > AI engines; ${pc.model ? "its own setting, below the input" : "the global setting in Settings"}) at ${effortName(pc.effective.effort).toLowerCase()} effort. Ultraedit, the Style Studio and character design always run on Claude.`
                    : engineOf(pc.effective.model) === "google"
                      ? `This project runs on ${modelName(pc.effective.model, google)} through CLIProxyAPI (Settings > Experimental, at your own risk; ${pc.model ? "its own setting, below the input" : "the global setting in Settings"}). Effort does not apply to Google models. Ultraedit, the Style Studio and character design always run on Claude.`
                      : `This project runs on ${pc.effective.model ? modelName(pc.effective.model) : "your Claude Code account's default model"} at ${effortName(pc.effective.effort).toLowerCase()} effort (${pc.model || pc.effort ? "its own setting, below the input" : "the global setting in Settings"}). Ultraedit always runs on Opus 5.5.`
                }
              >
                {modelName(pc.effective.model, google)}
              </span>
            )
          )}
        </span>
        <div className="tabs sm" role="tablist">
          <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
            <MessagesSquare size={13} />
            Chat
          </button>
          <button
            role="tab"
            aria-selected={tab === "history"}
            className={tab === "history" ? "active" : ""}
            onClick={() => {
              setTab("history");
              loadHistory();
            }}
          >
            <RotateCcwClock size={13} />
            History
          </button>
        </div>
        <button className="icon-btn sm" onClick={newChat} disabled={!!task} aria-label="New conversation" title="New conversation">
          <Plus size={16} strokeWidth={1.7} />
        </button>
      </div>
      <ContextMeter projectId={projectId} onFresh={newChat} freshPending={freshPending} busy={!!task} />
      {tab === "history" ? (
        <div className="agent-log">
          <div className="sec-title">Edits</div>
          {!edits.length && <p className="small">Edits appear here with an exact undo.</p>}
          {edits.map((e, idx) => (
            <div key={e.id} className="result-card" style={{ background: "transparent", borderColor: "#303030" }}>
              <div className="row">
                <span className="grow" style={{ fontSize: 13, color: "#ddd" }}>
                  {e.instruction || "(build)"}
                </span>
                <StatusBadge s={e.status} />
              </div>
              {e.compare && <Compare c={e.compare} onSeek={onSeek} />}
              {e.summary && (
                <span className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {e.summary.length > 220 ? e.summary.slice(0, 220) + "…" : e.summary}
                </span>
              )}
              <div className="row small meta-row">
                <span>{ago(e.created_at)}</span>
                <span>
                  {e.files.length}
                  {" file"}
                  {e.files.length === 1 ? "" : "s"}
                </span>
                <span>{secs(e.duration_ms)}</span>
                <span>{money(e.cost_usd)}</span>
                <span className="grow" />
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                {e.files.length > 0 && (
                  <button className="btn tiny" onClick={() => showDiff(e.id, e.instruction)}>
                    <FileDiff size={12} />
                    Changes
                  </button>
                )}
                {e.files.length > 0 && !["reverted", "running"].includes(e.status) && (
                  <button className="btn tiny" onClick={() => revert(e.id)}>
                    <Undo2 size={12} />
                    Revert
                  </button>
                )}
                {e.files.length > 0 && e.status === "reverted" && (
                  <button className="btn tiny" onClick={() => reapply(e.id)}>
                    <Redo2 size={12} />
                    Re-apply
                  </button>
                )}
                {e.commit_before && idx > 0 && e.status !== "running" && (
                  <button
                    className="btn tiny"
                    title="Put the project back exactly as it was before this edit"
                    onClick={() => restore(e, edits.slice(0, idx).filter((x) => x.status === "done" && x.files.length).length)}
                  >
                    <RotateCcw size={12} />
                    Restore to here
                  </button>
                )}
                {e.thread_id && (
                  <button className="btn tiny" onClick={() => openThread(e.thread_id)}>
                    Open
                  </button>
                )}
              </div>
            </div>
          ))}
          {threads.length > 0 && (
            <>
              <div className="sec-title" style={{ marginTop: 10 }}>
                Conversations
              </div>
              {threads.map((t) => (
                <button key={t.id} className="list-row" onClick={() => openThread(t.id)}>
                  <MessagesSquare size={14} />
                  <span className="grow ellipsis">{t.title}</span>
                  <time>{ago(t.updated_at)}</time>
                </button>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="agent-log" ref={log} aria-live="polite">
          {!items.length && !task && (
            <div className="col" style={{ gap: 12, marginTop: 6 }}>
              <p className="muted" style={{ fontSize: 13 }}>
                Click anything in the preview (a character, a label, a shot) or select a range in the timeline, then say what to change.
              </p>
              <div className="note" style={{ fontSize: 12, lineHeight: 1.6 }}>
                This project has one Claude Code session: it remembers every edit you make here. Each edit is checked against rendered
                frames and can be reverted exactly. Press + to start the project's conversation over. When it grows very long, the app
                starts a fresh one with a summary of your edits, to keep your Claude usage low.
              </div>
              {!claude?.loggedIn && (
                <button className="btn primary" onClick={signIn} disabled={signingIn}>
                  {signingIn ? <Spinner size={15} /> : <LogIn size={15} />}Sign in to Claude
                </button>
              )}
            </div>
          )}
          {items.map((it, i) => {
            if (it.k === "user")
              return (
                <div key={i} className="msg user">
                  {it.text}
                  {it.selection.length > 0 && (
                    <div className="chips">
                      {it.selection.map((s, j) => (
                        <span
                          key={j}
                          className={`chip ${s.kind === "hud" ? "hud" : s.kind === "shot" ? "shot" : ["range", "phrase", "cue"].includes(s.kind) ? "range" : ""}`}
                        >
                          <span>{label(s)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            if (it.k === "assistant")
              return (
                <div key={i} className="msg assistant md">
                  <Md text={it.text} />
                </div>
              );
            if (it.k === "note")
              return (
                <div key={i} className={`note claude-note${it.warn ? " warn" : ""}`} style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {it.warn && <TriangleAlert size={12} style={{ verticalAlign: -2, marginRight: 4 }} />}
                  {it.text}
                </div>
              );
            if (it.k === "tools") return <ToolGroup key={i} list={it.list} />;
            if (it.k === "error")
              return (
                <div key={i} className="msg err">
                  <div className="row">
                    <TriangleAlert size={14} />
                    <span className="grow">{it.text}</span>
                  </div>
                  {it.auth && (
                    <button className="btn tiny" style={{ marginTop: 8 }} onClick={signIn}>
                      <LogIn size={12} />
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
                        <Check size={12} />
                        Allow
                      </button>
                      <button className="btn tiny" onClick={() => answer(it, false)}>
                        <X size={12} />
                        Deny
                      </button>
                    </div>
                  ) : (
                    <small>{it.answer ? "Allowed" : "Denied"}</small>
                  )}
                </div>
              );
            if (it.k === "rule")
              return (
                <div key={i} className="perm" style={{ borderColor: "#405a4b", background: "#80bc990a" }}>
                  <div className="row">
                    <Brain size={14} />
                    <b style={{ fontWeight: 500 }}>
                      {"Remember for "}
                      {it.scope === "global" ? "all videos" : "this video"}?
                    </b>
                  </div>
                  <span style={{ color: "#cfdcd4" }}>{it.text}</span>
                  {!it.answer ? (
                    <div className="row">
                      <button className="btn tiny" onClick={() => answerRule(it, true)}>
                        <Check size={12} />
                        Keep rule
                      </button>
                      <button className="btn tiny" onClick={() => answerRule(it, false)}>
                        Dismiss
                      </button>
                    </div>
                  ) : (
                    <small>{it.answer === "kept" ? "Saved to Memory" : "Dismissed"}</small>
                  )}
                </div>
              );
            if (it.k === "match")
              return (
                <div key={i} className="match-card" data-match-card={it.m.shot} aria-label={`Ultraedit+ shot ${it.m.shot}`}>
                  <div className="row">
                    <Sparkles size={13} />
                    <b>
                      {"Ultraedit+ shot "}
                      {it.m.shot}
                    </b>
                    <span className="grow" />
                    <span className="small">
                      {it.m.pass ? `pass ${it.m.pass}` : "target"}
                      {it.m.diff != null ? ` · diff ${it.m.diff.toFixed(3)}` : ""}
                      {it.m.issues != null ? ` · ${it.m.issues} issue${it.m.issues === 1 ? "" : "s"}` : ""}
                    </span>
                    {it.m.score != null && (
                      <span
                        className={`match-score ${it.m.score >= 8 ? "good" : ""}`}
                        title={it.m.summary || "The score of a fresh critic"}
                      >
                        {it.m.score}/10
                      </span>
                    )}
                  </div>
                  <div className="match-pics">
                    <a href={it.m.target} target="_blank" rel="noreferrer" title="The target frame">
                      <img src={it.m.target} alt="Target" />
                      <span>Target</span>
                    </a>
                    {it.m.side && (
                      <a href={it.m.side} target="_blank" rel="noreferrer" title="Target | render">
                        <img src={it.m.side} alt="Target and render side by side" />
                        <span>Target | render</span>
                      </a>
                    )}
                  </div>
                </div>
              );
            if (it.k === "frames")
              return (
                <div key={i} className="frame-strip" aria-label="Frames Claude checked">
                  {it.frames.map((f) => (
                    <button key={f.url} title={`Jump to ${f.time.toFixed(2)}s`} onClick={() => onSeek?.(f.time)}>
                      <img src={f.url} alt={`Frame at ${f.time.toFixed(1)}s`} />
                      <span>{f.time.toFixed(1)}s</span>
                    </button>
                  ))}
                </div>
              );
            if (it.k === "result")
              return (
                <div key={i} className={`result-card ${["failed"].includes(it.status) ? "fail" : ""}`}>
                  <div className="row">
                    <StatusBadge s={it.status} />
                    <span className="small">
                      {secs(it.ms)}
                      {" · "}
                      {money(it.cost)}
                    </span>
                  </div>
                  {it.compare && it.status !== "reverted" && <Compare c={it.compare} onSeek={onSeek} />}
                  {it.files.length > 0 && (
                    <div className="files">
                      {it.files.map((f) => (
                        <span key={f.file}>
                          {f.file} <span style={{ color: "#9fcfb2" }}>+{f.added}</span>{" "}
                          <span style={{ color: "#d99f9f" }}>−{f.removed}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {it.files.length > 0 && it.status !== "reverted" && (
                    <div className="row">
                      <button className="btn tiny" onClick={() => showDiff(it.editId, "Changes")}>
                        <FileDiff size={12} />
                        View changes
                      </button>
                      <button className="btn tiny" onClick={() => revert(it.editId)}>
                        <Undo2 size={12} />
                        Revert
                      </button>
                    </div>
                  )}
                  {it.files.length > 0 && it.status === "reverted" && (
                    <div className="row">
                      <button className="btn tiny" onClick={() => reapply(it.editId)}>
                        <Redo2 size={12} />
                        Re-apply
                      </button>
                    </div>
                  )}
                  {it.reused != null &&
                    (() => {
                      const hv = harvests[it.editId],
                        n = hv?.type === "done" ? (hv.proposed ?? []).filter((x) => x.status === "proposed").length : 0;
                      if (!it.reused && !hv) return null;
                      return (
                        <div className="cl-harvest" data-harvest={hv?.type ?? "none"}>
                          <Sprout size={13} />
                          <span className="grow">
                            {[
                              `Reused ${it.reused} from the Library`,
                              hv?.type === "queued" || hv?.type === "started"
                                ? "growing the library…"
                                : hv?.type === "done"
                                  ? `${n} new proposed`
                                  : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {hv?.type === "done" && n > 0 && (
                            <button
                              className="btn tiny"
                              onClick={() => {
                                requestLibraryInbox();
                                go("library");
                              }}
                            >
                              Review
                            </button>
                          )}
                        </div>
                      );
                    })()}
                </div>
              );
            return null;
          })}
          {stream && <div className="msg assistant">{stream}</div>}
          {task && (
            <div className="working">
              <Busy
                text={engine === "google" && !model ? "Starting Google models" : workingText(engine)}
                since={started || void 0}
                kind="orbit"
              />
              {model && (
                <span
                  className={`model-chip${fellBack ? " fallback" : ""}`}
                  title={
                    fellBack
                      ? "The model picked could not be used for this run, so it runs on Claude (your Claude plan): see the note above."
                      : void 0
                  }
                >
                  {modelName(withEngine(model, engine), google)}
                  {fellBack ? " · on Claude instead" : ""}
                </span>
              )}
              <span className="grow" />
              <button className="btn tiny" onClick={() => api.stop(task)}>
                <Square size={11} />
                Stop
              </button>
            </div>
          )}
        </div>
      )}
      <div className="composer">
        {selection.length > 0 && (
          <div className="chips">
            {selection.map((s, i) => (
              <span
                key={i}
                className={`chip ${s.kind === "hud" ? "hud" : s.kind === "shot" ? "shot" : ["range", "phrase", "cue"].includes(s.kind) ? "range" : ""}`}
                title={label(s)}
              >
                <span>{label(s)}</span>
                {srcOf(s) && (
                  <button
                    aria-label="Open the source code"
                    title={`Open ${srcOf(s).file}:${srcOf(s).line}`}
                    onClick={() => api.openSource(projectId, srcOf(s).file, srcOf(s).line).catch((e) => toast(e.message, "bad"))}
                  >
                    <CodeXml size={12} />
                  </button>
                )}
                <button aria-label="Remove from selection" onClick={() => setSelection(selection.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              </span>
            ))}
            <button className="text-btn" onClick={() => setSelection([])}>
              Clear
            </button>
          </div>
        )}
        {queue.length > 0 && (
          <div className="queue" aria-label="Queued edits">
            <div className="row">
              <span className="sec-title" style={{ margin: 0 }}>
                {"Queued · "}
                {queue.length}
              </span>
              <span className="grow" />
              {!task && (
                <button className="btn tiny" onClick={runNext}>
                  Run queue
                </button>
              )}
              <button className="text-btn" onClick={() => setQueue([])}>
                Clear
              </button>
            </div>
            {queue.map((j, i) => (
              <div key={i} className="queue-item">
                <span className="n">{i + 1}</span>
                <span className="grow ellipsis">
                  {j.kind === "ultra" ? requestLabel("ultra", j.instruction) : hideTimeLimit(j.instruction || "") || "Build the video"}
                </span>
                {j.selection.length > 0 && (
                  <span className="small">
                    {j.selection.length}
                    {" sel."}
                  </span>
                )}
                <button className="icon-btn sm" aria-label="Remove from queue" onClick={() => setQueue((q) => q.filter((_, k) => k !== i))}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {tab === "chat" && !text && !task && selection.length > 0 && mode === "edit" && (
          <div className="chips">
            {(selection[0].kind === "hud"
              ? [
                  "Make this text bigger",
                  "Move it so it doesn’t cover the subject",
                  "Change its colour to match the scene",
                  "Show it a beat later",
                ]
              : selection[0].kind === "object"
                ? ["Make it bigger", "Move the camera closer to it", "Add more detail to this model", "Change its colour"]
                : selection[0].kind === "cue"
                  ? [
                      "Make this happen a beat later",
                      "Make this happen earlier",
                      "Key this to a different word",
                      "Make this moment land harder visually",
                    ]
                  : [
                      "Make this shot more dynamic with a slow camera move",
                      "Improve the lighting and depth",
                      "Add more detail to the set",
                      "Tighten the timing to the narration",
                    ]
            ).map((s) => (
              <button key={s} className="btn tiny ghost" style={{ border: "1px solid #333" }} onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {tab === "chat" && !text && !task && !selection.length && (
          <div className="chips">
            {(mode === "edit"
              ? [
                  "Review the whole video and fix what looks wrong",
                  "Make all on-screen text easier to read on a phone",
                  "Check every visual lands on its spoken word",
                ]
              : ["What would make this video better?", "Which shots are weakest, and why?", "Write a YouTube title and description"]
            ).map((s) => (
              <button key={s} className="btn tiny ghost" style={{ border: "1px solid #333" }} onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="chips">
            {images.map((u, i) => (
              <span key={i} className="thumb-chip">
                <img src={u} alt={`Reference ${i + 1}`} />
                <button aria-label="Remove image" onClick={() => setImages((x) => x.filter((_, j) => j !== i))}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {audioBusy && mode === "edit" && (
          <p className="vo-claude-wait" role="status">
            <AudioLines size={13} />
            {audioBusy.split(/(?<=\.)\s/)[0]}
            {" Claude can change the video when it is finished; questions can be asked now."}
          </p>
        )}
        <MentionField
          ref={field}
          projectId={projectId}
          aria-label="Instruction for Claude"
          value={text}
          onChange={setText}
          placeholder={task ? `Queue the next change while ${engine === "codex" ? "ChatGPT" : "Claude"} works…` : placeholder}
          onAddReference={() => setRefsOpen(true)}
          corner={<RefButton projectId={projectId} onClick={() => setRefsOpen(true)} className="ghost" compact />}
          onPaste={(e) => {
            const fs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (fs.length) {
              e.preventDefault();
              fs.forEach(addImageFile);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            const all = [...e.dataTransfer.files],
              fs = all.filter((f) => f.type.startsWith("image/")),
              other = all.filter((f) => !f.type.startsWith("image/"));
            if (!all.length) return;
            e.preventDefault();
            fs.forEach(addImageFile);
            if (other.length) {
              const l = await addDropped(projectId, other, toast);
              if (l.length) field.current?.insert(l.map((r) => "@" + r.tag).join(" "));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
              e.preventDefault();
              send();
            }
          }}
          rows={3}
        />
        <RefsUsed projectId={projectId} text={text} title="References" onAdd={() => setRefsOpen(true)} />
        {refsOpen && <RefsPanel projectId={projectId} onClose={() => setRefsOpen(false)} onInsert={(t) => field.current?.insert(t)} />}
        <div className="row">
          <div className="seg-ctl" role="radiogroup" aria-label="Scope">
            {mode === "edit" ? (
              [
                ["selection", "Selection"],
                ["shot", "Shot"],
                ["video", "Whole video"],
              ].map(([v, l]) => (
                <button
                  key={v}
                  role="radio"
                  aria-checked={scope === v}
                  className={scope === v ? "on" : ""}
                  onClick={() => setScope(v)}
                  disabled={v !== "video" && !selection.length}
                >
                  {l}
                </button>
              ))
            ) : (
              <button className="on">Question</button>
            )}
          </div>
          <span className="grow" />
          <button
            className="icon-btn sm"
            title={mode === "edit" ? "Switch to asking a question" : "Switch to editing"}
            aria-label="Toggle ask mode"
            onClick={() => setMode(mode === "edit" ? "ask" : "edit")}
          >
            {mode === "edit" ? "?" : <Wrench size={14} />}
          </button>
          {task && (
            <button className="btn small" onClick={() => api.stop(task)}>
              <Square size={13} />
              Stop
            </button>
          )}
          {(!task || text.trim()) && (
            <button
              className="btn small primary"
              onClick={() => send()}
              disabled={!text.trim() || (!!audioBusy && mode === "edit")}
              title={audioBusy && mode === "edit" ? audioBusy : void 0}
            >
              <SendHorizontal size={14} />
              {task ? "Queue" : mode === "edit" ? "Apply" : "Ask"}
            </button>
          )}
        </div>
        {pc && !lockedModel && (
          <div className="cl-model-row">
            <ModelPicker
              model={pc.model}
              effort={pc.effort}
              globalModel={pc.globalModel}
              globalEffort={pc.globalEffort}
              effectiveModel={pc.effective.model}
              effectiveEffort={pc.effective.effort}
              google={google}
              codex={codex}
              onPick={pickClaude}
            />
          </div>
        )}
      </div>
      {diff && (
        <Modal title={diff.title} onClose={() => setDiff(null)} wide>
          <div className="modal-body">
            <pre className="diff">
              {diff.text.split("\n").map((l, i) => (
                <span
                  key={i}
                  className={
                    l.startsWith("+") && !l.startsWith("+++")
                      ? "a"
                      : l.startsWith("-") && !l.startsWith("---")
                        ? "d"
                        : l.startsWith("@@")
                          ? "h"
                          : ""
                  }
                >
                  {l + "\n"}
                </span>
              ))}
            </pre>
          </div>
        </Modal>
      )}
    </aside>
  );
}
