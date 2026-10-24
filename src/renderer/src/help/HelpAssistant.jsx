import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  ExternalLinkIcon,
  FlagIcon,
  ImagePlusIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  MessageCircleQuestionMarkIcon,
  SendIcon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  XIcon,
} from "lucide-react";
import { api, on } from "../lib/api";
import { recentErrors } from "../lib/errors";
import { useApp } from "../state/AppProvider";
import { keys } from "./keys";

const HELLO =
  "Hi! Ask me anything about Videoxx: where a setting is, how to do something, or what a message means. You can paste a screenshot or an error too.";
const SUGGEST = [
  "How do I turn down the film grain?",
  "My export failed",
  "Claude shows as not connected",
  "How do I make a vertical (9:16) video?",
];
const EMPTY = { title: "", what: "", expected: "", steps: "", error: "" };
const mem = { msgs: [], draft: { ...EMPTY }, shots: [], includeInfo: true, sending: null };
const MAX_SHOTS = 3;
async function fileToDataUrl(f, max = 1568) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type) || f.size > 15e6) return null;
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.width, img.height, 1));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
const imagesOf = (dt) => [...(dt?.files ?? [])].filter((f) => f.type.startsWith("image/"));
function Rich({ text }) {
  return (
    <>
      {text
        .split(/(\*\*[^*\n]{1,80}\*\*)/g)
        .map((p, i) =>
          p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
            <strong key={i}>{p.slice(2, -2)}</strong>
          ) : (
            <Fragment key={i}>{p}</Fragment>
          ),
        )}
    </>
  );
}
function Shots({ shots, onRemove, onOpen }) {
  if (!shots.length) return null;
  return (
    <div className="help-shots">
      {shots.map((s, i) => (
        <div key={i} className="help-shot">
          <button className="help-shot-img" onClick={() => onOpen(s)} aria-label={`Screenshot ${i + 1}: view larger`}>
            <img src={s} alt="" />
          </button>
          {onRemove && (
            <button className="help-shot-x" onClick={() => onRemove(i)} aria-label={`Remove screenshot ${i + 1}`}>
              <XIcon size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
export function HelpAssistant() {
  const { toast, help, closeHelp, openHelp, page, brand, projectId } = useApp();
  const [mode, setMode] = useState(help.mode);
  const [msgs, setMsgsState] = useState(mem.msgs);
  const setMsgs = (f) => setMsgsState((m) => (mem.msgs = f(m)));
  const [q, setQ] = useState("");
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [big, setBig] = useState(null);
  const [drag, setDrag] = useState(false);
  const panel = useRef(null),
    list = useRef(null),
    input = useRef(null),
    stick = useRef(true);
  const place = () => ({ page, brand, projectId, errors: recentErrors() });
  useEffect(() => {
    setMode(help.mode);
    if (help.error) {
      mem.draft = { ...EMPTY, title: titleFrom(help.error), error: help.error };
      setDraftState(mem.draft);
    }
  }, [help.n]);
  useEffect(() => {
    if (mode === "chat") input.current?.focus();
  }, [mode]);
  useEffect(() => {
    const l = list.current;
    if (l && stick.current) l.scrollTo({ top: l.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);
  useEffect(() => {
    const k = (e) => {
      if (e.key !== "Escape" || big || e.defaultPrevented || document.querySelector(".backdrop > .modal")) return;
      const a = document.activeElement;
      if (a && !panel.current?.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      e.preventDefault();
      closeHelp();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [closeHelp, big]);
  const addImages = async (files) => {
    const urls = (await Promise.all(files.slice(0, MAX_SHOTS).map((f) => fileToDataUrl(f)))).filter(Boolean);
    if (files.length && !urls.length) toast("That file is not a picture Videoxx can read (PNG, JPEG, WebP or GIF).", "info");
    return urls;
  };
  const capture = async () => {
    setCapturing(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      return await api.helpCapture();
    } catch (e) {
      toast(`Could not take the screenshot: ${e.message}`, "bad");
      return null;
    } finally {
      setCapturing(false);
    }
  };
  const ask = async (text = q) => {
    text = text.trim();
    if ((!text && !pending.length) || busy) return;
    const imgs = pending,
      history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text, images: imgs }]);
    setQ("");
    setPending([]);
    setBusy(true);
    stick.current = true;
    try {
      const r = await api.helpAsk(history, text, imgs, place());
      setMsgs((m) => [...m, { role: "assistant", text: r.text, id: r.id, answered: r.answered }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `Sorry, I could not answer just now. ${e.message}`, error: true }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const rate = (i, solved) => {
    const m = msgs[i];
    if (m.id) api.helpFeedback(m.id, solved);
    setMsgs((all) => all.map((x, k) => (k === i ? { ...x, rated: true } : x)));
    if (!solved) startReport();
  };
  const onPaste = async (e) => {
    const fs = imagesOf(e.clipboardData);
    if (!fs.length) return;
    e.preventDefault();
    const u = await addImages(fs);
    setPending((p) => [...p, ...u].slice(0, MAX_SHOTS));
  };
  const onDrop = async (e) => {
    e.preventDefault();
    setDrag(false);
    const u = await addImages(imagesOf(e.dataTransfer));
    if (mode === "report") setShots((s) => [...s, ...u].slice(0, MAX_SHOTS));
    else setPending((p) => [...p, ...u].slice(0, MAX_SHOTS));
  };
  const [draft, setDraftState] = useState(mem.draft);
  const setDraft = (patch) => setDraftState((d) => (mem.draft = { ...d, ...patch }));
  const [shots, setShotsState] = useState(mem.shots);
  const setShots = (f) => setShotsState((s) => (mem.shots = f(s)));
  const [includeInfo, setInclude] = useState(mem.includeInfo);
  const [writing, setWriting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [sending, setSendingState] = useState(mem.sending);
  const setSending = (s) => setSendingState((mem.sending = s));
  const chatHas = msgs.some((m) => m.role === "user");
  const startReport = async () => {
    setMode("report");
    const chatShots = msgs.flatMap((m) => m.images ?? []);
    if (chatShots.length && !mem.shots.length) setShots(() => chatShots.slice(0, MAX_SHOTS));
    if (!mem.draft.what.trim() && chatHas) await fillFromChat();
  };
  const fillFromChat = async () => {
    setWriting(true);
    try {
      const d = await api.helpDraft(
        msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text })),
        shots.length ? shots : msgs.flatMap((m) => m.images ?? []),
        place(),
      );
      setDraft({
        title: d.title || draft.title,
        what: d.what || draft.what,
        expected: d.expected || draft.expected,
        steps: d.steps || draft.steps,
        error: draft.error || d.error,
      });
    } catch (e) {
      toast(`Could not write the report from the chat: ${e.message}`, "bad");
    } finally {
      setWriting(false);
    }
  };
  useEffect(() => {
    if (mode === "report")
      api
        .helpContext({ page, brand, projectId })
        .then(setCtx)
        .catch(() => {});
  }, [mode]);
  useEffect(() => {
    mem.includeInfo = includeInfo;
  }, [includeInfo]);
  const ok = draft.title.trim().length >= 5 && (draft.what.trim().length >= 10 || draft.error.trim().length >= 10);
  const bodyText = () =>
    [
      draft.what.trim(),
      draft.expected.trim() && `Expected: ${draft.expected.trim()}`,
      draft.steps.trim() &&
        `Steps:
${draft.steps.trim()}`,
      draft.error.trim() &&
        `Error message:
${draft.error.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  const showPreview = async () => {
    setPreview(
      preview
        ? null
        : await api.helpClean(`${draft.title.trim()}

${bodyText()}`),
    );
  };
  useEffect(() => {
    if (preview !== null)
      api
        .helpClean(
          `${draft.title.trim()}

${bodyText()}`,
        )
        .then(setPreview);
  }, [draft]);
  const post = async () => {
    if (!ok || sending?.status === "opening") return;
    try {
      const r = await api.helpCreate(draft, includeInfo, shots);
      setSending({ reportId: r.id, status: "opening" });
      const e = await api.helpPost(r.id);
      setSending({ reportId: r.id, status: e.status, url: e.url, detail: e.detail });
    } catch (e) {
      setSending(null);
      toast(e.message, "bad");
    }
  };
  useEffect(
    () =>
      on("help:report", (e) => {
        if (!mem.sending || e.id !== mem.sending.reportId) return;
        setSending({ ...mem.sending, status: e.status, url: e.url ?? mem.sending.url });
        if (e.status === "posted") {
          mem.draft = { ...EMPTY };
          setDraftState(mem.draft);
          setShots(() => []);
          refreshReports();
        }
      }),
    [],
  );
  const copyReport = async () => {
    await api.copy(
      await api.helpClean(`${draft.title.trim()}

${bodyText()}`),
    );
    toast("Report copied (without personal paths). Paste it wherever you like.", "ok");
  };
  const [reports, setReports] = useState(null);
  const refreshReports = () =>
    api
      .helpReports()
      .then(setReports)
      .catch(() => setReports([]));
  useEffect(() => {
    if (mode === "reports") refreshReports();
  }, [mode]);
  const repost = async (id) => {
    setMode("report");
    setSending({ reportId: id, status: "opening" });
    try {
      const e = await api.helpPost(id);
      setSending({ reportId: id, status: e.status, url: e.url, detail: e.detail });
    } catch (e) {
      setSending(null);
      toast(e.message, "bad");
    }
  };
  const errs = useMemo(() => recentErrors(1), [help.n, mode]);
  const tabs = [
    ["chat", "Ask", <MessageCircleQuestionMarkIcon size={14} />],
    ["report", "Report a problem", <FlagIcon size={14} />],
  ];
  return (
    <div
      ref={panel}
      className={`help-panel ${capturing ? "capturing" : ""} ${drag ? "drag" : ""}`}
      role="dialog"
      aria-label="Help"
      onDragOver={(e) => {
        if (imagesOf(e.dataTransfer).length || [...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (!panel.current?.contains(e.relatedTarget)) setDrag(false);
      }}
      onDrop={onDrop}
    >
      <div className="help-head">
        <div className="help-tabs" role="tablist">
          {tabs.map(([m, label, icon]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "on" : ""}
              onClick={() => (m === "report" && mode !== "report" ? startReport() : setMode(m))}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button className="icon-btn sm" aria-label="Close help" title="Close (Esc)" onClick={closeHelp}>
          <XIcon size={15} />
        </button>
      </div>
      {mode === "chat" && (
        <>
          <div
            className="help-list"
            ref={list}
            aria-live="polite"
            onScroll={(e) => {
              const l = e.currentTarget;
              stick.current = l.scrollHeight - l.scrollTop - l.clientHeight < 40;
            }}
          >
            <div className="help-msg assistant">
              <div className="help-bubble">{HELLO}</div>
            </div>
            {!msgs.length && (
              <div className="help-suggest">
                {errs[0] && (
                  <button
                    className="help-chip warn"
                    onClick={() =>
                      ask(`I got this message: "${errs[0].replace(/^\[[^\]]*\]\s*/, "")}". What does it mean and how do I fix it?`)
                    }
                  >
                    <CircleAlertIcon size={13} />
                    <span>
                      {"Ask about: "}
                      {errs[0].replace(/^\[[^\]]*\]\s*/, "").slice(0, 70)}
                    </span>
                  </button>
                )}
                {SUGGEST.map((s) => (
                  <button key={s} className="help-chip" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`help-msg ${m.role}`}>
                {m.images?.length ? <Shots shots={m.images} onOpen={setBig} /> : null}
                {m.text && (
                  <div className={`help-bubble ${m.error ? "err" : ""}`}>
                    <Rich text={m.text} />
                  </div>
                )}
                {m.role === "assistant" && !m.error && m.answered === false && (
                  <button className="btn tiny help-cta" onClick={startReport}>
                    <FlagIcon size={12} />
                    Report this problem
                  </button>
                )}
                {m.id && !m.rated && (
                  <div className="help-rate">
                    <span>Did this help?</span>
                    <button onClick={() => rate(i, true)} aria-label="Yes, it helped" title="Yes">
                      <ThumbsUpIcon size={13} />
                    </button>
                    <button onClick={() => rate(i, false)} aria-label="No, it did not help: report the problem" title="No: report it">
                      <ThumbsDownIcon size={13} />
                    </button>
                  </div>
                )}
                {m.rated && m.id && (
                  <div className="help-rate done">
                    <CheckIcon size={12} />
                    Thanks
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="help-msg assistant">
                <div className="help-bubble help-dots" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
          </div>
          <div className="help-compose">
            <Shots shots={pending} onOpen={setBig} onRemove={(i) => setPending((p) => p.filter((_, k) => k !== i))} />
            <div className="help-input">
              <textarea
                ref={input}
                rows={1}
                value={q}
                placeholder="Ask a question, or paste an error or screenshot"
                maxLength={4e3}
                onChange={(e) => {
                  setQ(e.target.value);
                  const t = e.target;
                  t.style.height = "auto";
                  t.style.height = Math.min(140, t.scrollHeight) + "px";
                }}
                onPaste={onPaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    ask();
                  }
                }}
              />
              <div className="help-tools">
                <button
                  className="icon-btn sm"
                  title="Screenshot of the app"
                  aria-label="Attach a screenshot of the app"
                  disabled={pending.length >= MAX_SHOTS || busy}
                  onClick={async () => {
                    const s = await capture();
                    if (s) setPending((p) => [...p, s].slice(0, MAX_SHOTS));
                  }}
                >
                  <CameraIcon size={15} />
                </button>
                <button
                  className="help-send"
                  onClick={() => ask()}
                  disabled={busy || (!q.trim() && !pending.length)}
                  aria-label="Send"
                  title="Send (Enter)"
                >
                  <SendIcon size={14} />
                </button>
              </div>
            </div>
            <div className="help-hint">
              {"Enter sends · Shift+Enter new line · paste a screenshot with "}
              {keys("V")}
            </div>
          </div>
        </>
      )}
      {mode === "report" &&
        (sending ? (
          <div className="help-body help-sending">
            {sending.status === "opening" && (
              <>
                <LoaderCircleIcon className="spin" size={22} />
                <b>Preparing the report…</b>
                <p>Your report is being prepared on this computer.</p>
              </>
            )}
            {sending.status === "filled" && (
              <>
                <LoaderCircleIcon className="spin" size={22} />
                <b>Report ready</b>
                <p>Read the report, then copy it and send it wherever you get support.</p>
              </>
            )}
            {sending.status === "signin" && (
              <>
                <CircleAlertIcon size={22} />
                <b>Could not prepare the report</b>
                <p>Copy the report from this window and send it wherever you get support.</p>
              </>
            )}
            {sending.status === "posted" && (
              <>
                <span className="help-ok">
                  <CheckIcon size={20} />
                </span>
                <b>Posted. Thank you!</b>
                <p>Your report was saved on this computer.</p>
                <div className="help-row">
                  {sending.url && (
                    <button className="btn small" onClick={() => api.external(sending.url)}>
                      <ExternalLinkIcon size={13} />
                      Open my post
                    </button>
                  )}
                  <button
                    className="btn small primary"
                    onClick={() => {
                      setSending(null);
                      setMode("chat");
                    }}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
            {sending.status === "abandoned" && (
              <>
                <CircleAlertIcon size={22} />
                <b>Not posted</b>
                <p>The report was not sent. It is saved under My reports, and you can copy it from there.</p>
                <div className="help-row">
                  <button className="btn small" onClick={() => setSending(null)}>
                    <ArrowLeftIcon size={13} />
                    Edit the report
                  </button>
                  <button className="btn small primary" onClick={() => setSending(null)}>
                    Back to the report
                  </button>
                </div>
              </>
            )}
            {sending.status === "failed" && (
              <>
                <CircleAlertIcon size={22} />
                <b>The report could not be prepared</b>
                <p>{sending.detail || "Copy the report and send it wherever you get support."}</p>
                <div className="help-row">
                  <button className="btn small" onClick={() => setSending(null)}>
                    <ArrowLeftIcon size={13} />
                    Back
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="help-body help-report">
              <p className="help-intro">
                Write down what went wrong, then copy the report (personal paths removed) and send it wherever you get support.
              </p>
              {chatHas && (
                <button className="btn tiny help-fill" onClick={fillFromChat} disabled={writing}>
                  {writing ? (
                    <>
                      <LoaderCircleIcon className="spin" size={12} />
                      Writing it from your chat…
                    </>
                  ) : (
                    <>
                      <SparklesIcon size={12} />
                      Fill in from my chat
                    </>
                  )}
                </button>
              )}
              <label className="help-field">
                <span>Title</span>
                <input
                  value={draft.title}
                  maxLength={100}
                  placeholder="e.g. Export stops at 40% on a Vox project"
                  onChange={(e) => setDraft({ title: e.target.value })}
                />
              </label>
              <label className="help-field">
                <span>What happened?</span>
                <textarea
                  rows={4}
                  value={draft.what}
                  maxLength={3e3}
                  placeholder="What you did, and what went wrong"
                  onChange={(e) => setDraft({ what: e.target.value })}
                  onPaste={async (e) => {
                    const f = imagesOf(e.clipboardData);
                    if (f.length) {
                      e.preventDefault();
                      const u = await addImages(f);
                      setShots((s) => [...s, ...u].slice(0, MAX_SHOTS));
                    }
                  }}
                />
              </label>
              <label className="help-field">
                <span>
                  {"What did you expect? "}
                  <small>optional</small>
                </span>
                <input
                  value={draft.expected}
                  maxLength={600}
                  placeholder="e.g. The video exports"
                  onChange={(e) => setDraft({ expected: e.target.value })}
                />
              </label>
              <label className="help-field">
                <span>
                  {"Steps to make it happen "}
                  <small>optional</small>
                </span>
                <textarea
                  rows={3}
                  value={draft.steps}
                  maxLength={1500}
                  placeholder={"1. Open a project\n2. Click Export\n3. …"}
                  onChange={(e) => setDraft({ steps: e.target.value })}
                />
              </label>
              <label className="help-field">
                <span>
                  {"Error message "}
                  <small>optional: paste it exactly</small>
                </span>
                <textarea
                  className="mono"
                  rows={3}
                  value={draft.error}
                  maxLength={1500}
                  placeholder="Paste the message the app showed"
                  onChange={(e) => setDraft({ error: e.target.value })}
                />
              </label>
              <div className="help-field">
                <span>
                  {"Screenshots "}
                  <small>
                    {shots.length}/{MAX_SHOTS}
                  </small>
                </span>
                <Shots shots={shots} onOpen={setBig} onRemove={(i) => setShots((s) => s.filter((_, k) => k !== i))} />
                {shots.length < MAX_SHOTS && (
                  <div className="help-row">
                    <button
                      className="btn tiny"
                      onClick={async () => {
                        const s = await capture();
                        if (s) setShots((x) => [...x, s].slice(0, MAX_SHOTS));
                      }}
                    >
                      <CameraIcon size={12} />
                      Capture the app
                    </button>
                    <label className="btn tiny">
                      <ImagePlusIcon size={12} />
                      Add a picture
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        multiple
                        hidden
                        onChange={async (e) => {
                          const u = await addImages([...(e.target.files ?? [])]);
                          setShots((s) => [...s, ...u].slice(0, MAX_SHOTS));
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <small className="help-hint inline">
                      {"or paste one with "}
                      {keys("V")}
                    </small>
                  </div>
                )}
                {shots.length > 0 && (
                  <small className="help-hint inline">
                    Screenshots are not copied with the text: attach them yourself, and check they show nothing private.
                  </small>
                )}
              </div>
              <label className="help-check">
                <input type="checkbox" checked={includeInfo} onChange={(e) => setInclude(e.target.checked)} />
                <span>
                  Add my app version and system
                  {ctx ? (
                    <small>
                      {" ("}
                      {String(ctx.app)}
                      {" · "}
                      {String(ctx.system)}
                      {ctx.graphics ? ` · ${ctx.graphics}` : ""})
                    </small>
                  ) : null}
                </span>
              </label>
              <button className="text-btn help-preview-toggle" onClick={showPreview} aria-expanded={preview !== null}>
                <ChevronDownIcon size={13} className={preview !== null ? "up" : ""} />
                What will be copied
              </button>
              {preview !== null && (
                <pre className="help-preview">
                  {preview}
                  {`

Report CZ-…  ·  ${includeInfo && ctx ? `${ctx.app} · ${ctx.system}` : (ctx?.app ?? "")}`}
                </pre>
              )}
            </div>
            <div className="help-foot">
              <small className="help-hint">
                {ok ? "Nothing is sent: the report goes to your clipboard." : "Add a title and say what happened."}
              </small>
              <button
                className="btn small primary"
                onClick={copyReport}
                disabled={!ok}
                title="Copy the report (personal paths removed) to send it yourself"
              >
                <CopyIcon size={13} />
                Copy report
              </button>
            </div>
          </>
        ))}
      {mode === "reports" && (
        <div className="help-body help-reports">
          {reports === null ? (
            <p className="help-hint">Loading…</p>
          ) : !reports.length ? (
            <div className="help-empty">
              <ListChecksIcon size={22} />
              <b>No reports yet</b>
              <p>Problems you report from here are kept in this list.</p>
              <button className="btn small" onClick={startReport}>
                <FlagIcon size={13} />
                Report a problem
              </button>
            </div>
          ) : (
            reports.map((r) => (
              <div key={r.id} className="help-rep">
                <div className="help-rep-top">
                  <b title={r.title}>{r.title}</b>
                  <span className={`help-pill ${r.status}`}>{r.status === "posted" ? "Posted" : "Not posted"}</span>
                </div>
                <small>
                  {new Date(r.createdAt).toLocaleString(void 0, { dateStyle: "medium", timeStyle: "short" })}
                  {" · "}
                  {r.ref}
                  {r.shots ? ` · ${r.shots} screenshot${r.shots > 1 ? "s" : ""}` : ""}
                </small>
                {r.url ? (
                  <div className="help-row">
                    <button className="btn tiny" onClick={() => api.external(r.url)}>
                      <ExternalLinkIcon size={12} />
                      Open post
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
      {drag && (
        <div className="help-drop">
          <ImagePlusIcon size={22} />
          Drop the picture to add it
        </div>
      )}
      {big && (
        <div
          className="help-lightbox"
          role="dialog"
          aria-label="Screenshot"
          onClick={() => setBig(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setBig(null);
            }
          }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <img src={big} alt="Screenshot" />
          <button className="icon-btn" aria-label="Close" onClick={() => setBig(null)}>
            <XIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
function todo(detail) {
  let s = {};
  try {
    s = JSON.parse(detail || "{}");
  } catch {
    return [];
  }
  return [];
}
function titleFrom(err) {
  const s = err
    .replace(/^\[[^\]]*\]\s*/, "")
    .split(/(?<=[.!?])\s|\n/)[0]
    .trim();
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}
