import { useEffect, useMemo, useRef, useState } from "react";
import { api, on } from "../lib/api";
import { fmtLength, fmtPlayed, unheardWords } from "../lib/format";
import { voiceDialogs } from "../state/voiceDialogs";
import { useApp } from "../state/AppProvider";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  Cpu,
  FileText,
  Fish,
  KeyRound,
  Mic,
  Minus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Upload,
  WandSparkles,
  X,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { isMac } from "../help/keys";
import { Busy, Modal, Spinner } from "../components/ui";
import { OwnRisk, useCustomApi } from "../engines/CustomApiPanel";
import { Segmented } from "../components/Picker";
import { aLang, cantDrawWhy, lang, otherScriptLanguage, styleDraws } from "../settings/languages";
import { LangMark } from "../settings/LanguagePicker";
import { KeyDialog } from "../thumbnails/KeyDialog";
import { spokenScript } from "../script/scriptText";
import { stylePace } from "../script/chunks";
import { AUDIO_EXT, KOKORO_LANGS, cleanSettings, day, isAudio, nf, tierName, useElevenAccount, useVoiceStatus } from "./useVoiceStatus";
import { ElevenFields } from "./ElevenFields";
import { FishFields, fishOf, usd } from "./FishFields";
import { KokoroInstallCard } from "./KokoroInstallCard";
import { CustomVoiceField } from "./CustomVoiceField";
import { KokoroFields } from "./KokoroFields";
import { CharacterVoices } from "./CharacterVoices";

const recMemory = new Map();
const autoMemory = new Map();
const MAX_RECORDINGS = 500;
let recWatch = false;
function watchRecordings() {
  if (recWatch) return;
  recWatch = true;
  on("voice:progress", (j) => {
    if (j.provider === "file" && j.status === "done") recMemory.delete(j.projectId);
  });
}
const names = (l) =>
  l.length <= 3
    ? l.map((x) => x.name).join(", ")
    : `${l
        .slice(0, 2)
        .map((x) => x.name)
        .join(", ")} and ${l.length - 2} more`;
const droppedPaths = (e) => [...e.dataTransfer.files].map((f) => window.suite.pathForFile(f)).filter(Boolean);
const dragsFiles = (e) => e.dataTransfer.types.includes("Files");
function Recordings({ files, setFiles, gap, setGap, incoming, clearIncoming }) {
  const { toast } = useApp();
  const [over, setOver] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (incoming?.length) {
      clearIncoming();
      add(incoming);
    }
  }, [incoming]);
  const add = async (paths) => {
    const base = (p) => p.split(/[\\/]/).pop() ?? p;
    if (paths.some((p) => !isAudio(p))) {
      try {
        const ex = await api.voiceExpand(paths);
        const empty = ex.folders.filter((f) => !f.count);
        if (empty.length)
          toast(
            `${names(empty)} ${empty.length === 1 ? "has" : "have"} no recordings in ${empty.length === 1 ? "it" : "them"} (only the files right inside a folder are added).`,
            "bad",
          );
        paths = ex.files;
      } catch {}
    }
    const ok = paths.filter(isAudio),
      skipped = paths.filter((p) => !isAudio(p)).map((p) => ({ name: base(p) }));
    if (skipped.length) toast(`${names(skipped)} ${skipped.length === 1 ? "is" : "are"} not audio or video.`, "bad");
    const twice = ok.filter((p) => files.some((f) => f.file === p)).map((p) => ({ name: base(p) }));
    if (twice.length) toast(`${names(twice)} ${twice.length === 1 ? "is" : "are"} already in the list.`, "info");
    let todo = ok.filter((p) => !files.some((f) => f.file === p));
    if (files.length + todo.length > MAX_RECORDINGS) {
      toast(`Up to ${MAX_RECORDINGS} recordings can be joined: ${files.length + todo.length - MAX_RECORDINGS} were not added.`, "bad");
      todo = todo.slice(0, Math.max(0, MAX_RECORDINGS - files.length));
    }
    if (!todo.length) return;
    setBusy(true);
    try {
      const got = await api.voiceProbe(todo);
      if (got.some((g) => g.error === "ffmpeg is missing")) {
        toast(
          "ffmpeg was not found, so the recordings can’t be read. Install it, or set its path in Settings > System > Tool paths.",
          "bad",
        );
        return;
      }
      const gone = got.filter((g) => g.error === "not found"),
        broken = got.filter((g) => g.error === "unreadable"),
        silent = got.filter((g) => !g.error && !g.audio);
      if (gone.length) toast(`${names(gone)}: no longer there.`, "bad");
      if (broken.length)
        toast(
          `${names(broken)} could not be read (${broken.length === 1 ? "it may be damaged, or not really audio" : "they may be damaged, or not really audio"}).`,
          "bad",
        );
      if (silent.length) toast(`${names(silent)}: no sound in ${silent.length === 1 ? "it" : "them"}.`, "bad");
      setFiles((cur) => [...cur, ...got.filter((g) => g.audio && !cur.some((f) => f.file === g.file))]);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const pick = async () => {
    const f = await api.pickFiles("Choose the recording(s)", [{ name: "Audio or video", extensions: AUDIO_EXT }]);
    if (f?.length) add(f);
  };
  const keep = useRef(null),
    list = useRef(null);
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= files.length) return;
    const n = files.slice();
    [n[i], n[j]] = [n[j], n[i]];
    keep.current = { file: files[i].file, d };
    setFiles(n);
  };
  useEffect(() => {
    const k = keep.current;
    keep.current = null;
    if (!k) return;
    const row = [...(list.current?.children ?? [])].find((r) => r.dataset.file === k.file);
    const btns = [...(row?.querySelectorAll("button[data-move]") ?? [])],
      same = btns.find((b) => +b.dataset.move === k.d);
    (same && !same.disabled ? same : btns.find((b) => !b.disabled))?.focus();
  }, [files]);
  const [drag, setDrag] = useState(null);
  const grab = (i) => (e) => {
    if (e.button !== 0 || e.target.closest("button") || files.length < 2) return;
    e.preventDefault();
    const el = e.currentTarget,
      rows = [...list.current.children].map((r) => r.getBoundingClientRect()),
      y0 = e.clientY;
    const step = rows.length > 1 ? rows[1].top - rows[0].top : rows[0].height;
    let to = i,
      moved = false;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const dy = ev.clientY - y0;
      if (!moved && Math.abs(dy) < 4) return;
      moved = true;
      to = Math.max(0, Math.min(rows.length - 1, Math.round(i + dy / step)));
      setDrag({ from: i, to, dy, step });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      setDrag(null);
      if (moved && to !== i)
        setFiles((cur) => {
          const n = cur.slice();
          const [f] = n.splice(i, 1);
          n.splice(to, 0, f);
          return n;
        });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };
  const shift = (k) =>
    !drag
      ? 0
      : k === drag.from
        ? drag.dy
        : drag.from < drag.to && k > drag.from && k <= drag.to
          ? -drag.step
          : drag.from > drag.to && k >= drag.to && k < drag.from
            ? drag.step
            : 0;
  const total = files.reduce((s, f) => s + (f.duration ?? 0), 0) + Math.max(0, files.length - 1) * gap;
  const drop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    add(droppedPaths(e));
  };
  return (
    <div className="vo-files">
      {files.length > 0 && (
        <ol ref={list} className={`vo-list ${drag ? "sorting" : ""}`} aria-label="Recordings, in the order they play">
          {files.map((f, i) => (
            <li
              key={f.file}
              data-file={f.file}
              className={`vo-file ${drag?.from === i ? "dragging" : ""}`}
              onPointerDown={grab(i)}
              style={drag ? { transform: `translateY(${shift(i)}px)` } : void 0}
              title={files.length > 1 ? "Drag to put it in another place" : void 0}
            >
              <span className="vo-n">{i + 1}</span>
              <span className="np-file-ico">
                <AudioLines size={16} strokeWidth={1.8} />
              </span>
              <span className="vo-file-txt">
                <b className="ellipsis" title={f.file}>
                  {f.name}
                </b>
                <small>{f.duration != null ? fmtLength(f.duration) : "length unknown"}</small>
              </span>
              <button
                className="icon-btn sm"
                data-move="-1"
                aria-label={`Move ${f.name} up`}
                title="Earlier"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="icon-btn sm"
                data-move="1"
                aria-label={`Move ${f.name} down`}
                title="Later"
                disabled={i === files.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                className="icon-btn sm"
                aria-label={`Remove ${f.name}`}
                title="Remove"
                onClick={() => setFiles((cur) => cur.filter((x) => x !== f))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className={`np-drop ${over ? "over" : ""}`}
        onClick={pick}
        disabled={busy}
        onDragOver={(e) => {
          if (dragsFiles(e)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setOver(false);
        }}
        onDrop={drop}
      >
        <span className="np-drop-ico">
          {busy ? <Spinner size={15} /> : over ? <Upload size={17} strokeWidth={1.8} /> : <Mic size={17} strokeWidth={1.8} />}
        </span>
        <span className="np-drop-txt">
          <b>{over ? "Drop them" : files.length ? "Add another recording…" : "Choose your recording…"}</b>
          <small>
            {"or drop "}
            {files.length ? "more" : "one or several"}
            {" anywhere in this window · WAV, MP3, M4A, FLAC, OGG, AIFF, WMA and more, or a video"}
          </small>
        </span>
      </button>
      {files.length > 1 && (
        <div className="vo-join">
          <span className="small">Played in this order with</span>
          <select className="input compact" aria-label="Pause between recordings" value={gap} onChange={(e) => setGap(+e.target.value)}>
            {[0, 0.25, 0.5, 1, 1.5, 2].map((g) => (
              <option key={g} value={g}>
                {g ? `${g} s` : "no"}
                {" pause"}
              </option>
            ))}
          </select>
          <span className="small">
            {"between them · "}
            {fmtLength(total)}
            {" in all"}
          </span>
        </div>
      )}
      {files.length === 1 && (
        <p className="help">
          {files[0].keep ? "Used as it is." : "Turned into a WAV file (the format the app works in)."}
          {" Add more files to join them in order (for a long script recorded in parts)."}
        </p>
      )}
    </div>
  );
}
function JobView({ job, base, language }) {
  const [details, setDetails] = useState(false);
  const unheard = unheardWords(job);
  const steps = job.autoTime
    ? [
        ["clean", "Clean the audio"],
        ["timeline", "Time the words"],
      ]
    : [];
  const order = ["generate", "join", "clean", "timeline", "done"],
    at = order.indexOf(job.phase);
  const stepState = (p2) => {
    const k = order.indexOf(p2);
    return job.status === "running"
      ? k < at
        ? "done"
        : k === at
          ? "run"
          : "wait"
      : job.status === "done"
        ? "done"
        : k < at
          ? "done"
          : k === at
            ? "bad"
            : "wait";
  };
  const making =
    job.provider === "file" ? (job.sections.length > 1 ? "Joining your recordings" : "Adding your recording") : "Making the voiceover";
  const Icon = ({ s }) =>
    s === "run" ? (
      <Spinner size={12} />
    ) : s === "done" || s === "cached" ? (
      <Check size={12} strokeWidth={2.2} />
    ) : s === "bad" ? (
      <X size={12} strokeWidth={2.2} />
    ) : s === "stopped" ? (
      <Minus size={12} strokeWidth={2.2} />
    ) : null;
  const secMark = (i) =>
    job.status !== "running" && !job.installed && job.sections[i].state === "run"
      ? job.status === "cancelled" || job.interrupted
        ? "stopped"
        : "bad"
      : job.sections[i].state;
  const after = job.phase === "clean" ? "Cleaning the audio" : "Timing the words";
  const runAt = job.sections.findIndex((s) => s.state === "run"),
    list = useRef(null);
  useEffect(() => {
    list.current?.querySelector(".vo-step.run")?.scrollIntoView({ block: "nearest" });
  }, [runAt, job.phase]);
  const ended = job.status !== "running";
  useEffect(() => {
    if (ended) list.current?.closest(".modal-scroll")?.scrollTo({ top: 0 });
  }, [ended, job.startedAt]);
  const p = job.part,
    making_ = job.status === "running" && job.phase === "generate" && job.provider !== "file";
  const inSec = p?.sec ?? (job.sections.length === 1 && p ? { done: p.done, total: p.total } : null);
  const where = making_
    ? [
        job.sections.length > 1 && runAt >= 0 ? `Section ${runAt + 1} of ${job.sections.length}` : "",
        inSec && inSec.total > 1
          ? `${p.unit === "part" ? "part" : "sentence"} ${Math.min(inSec.done + 1, inSec.total)} of ${inSec.total}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .replace(/^./, (c) => c.toUpperCase())
    : "";
  return (
    <div className="vo-job">
      <div className="vo-job-head">
        {job.status === "running" ? (
          <Busy
            text={job.phase === "clean" ? "Cleaning the audio…" : job.phase === "timeline" ? "Timing the words…" : `${making}…`}
            since={job.startedAt}
          />
        ) : job.status === "done" ? (
          <span className="vo-done">
            <Check size={16} strokeWidth={2.2} />
            Voiceover ready{job.duration ? ` · ${fmtPlayed(job.duration)}` : ""}
          </span>
        ) : job.status === "cancelled" ? (
          <span className="vo-stopped">
            <Minus size={16} strokeWidth={2.2} />
            Stopped
          </span>
        ) : job.installed ? (
          <span className="vo-warned">
            <TriangleAlert size={16} />
            {"The voiceover is in; "}
            {after.toLowerCase()}
            {" did not finish"}
          </span>
        ) : job.interrupted ? (
          <span className="vo-stopped">
            <Minus size={16} strokeWidth={2.2} />
            Stopped when the app closed
          </span>
        ) : (
          <span className="vo-failed">
            <TriangleAlert size={16} />
            The voiceover stopped
          </span>
        )}
        <span className="small dim ellipsis">{job.label}</span>
      </div>
      {making_ && (where || job.retry) && (
        <div className="vo-where">
          {p && p.total > 1 && (
            <div className="progress" aria-label="Progress">
              <i style={{ width: `${Math.max(2, (p.done / p.total) * 100)}%` }} />
            </div>
          )}
          <span className="small">{where}</span>
          {job.retry && <span className="small vo-warn">{job.retry}</span>}
        </div>
      )}
      {ended && (job.status === "done" || job.scriptChanged || job.status === "failed" || job.note) && (
        <div className="vo-result">
          {job.status === "done" && job.source && (
            <audio
              className="vo-audio"
              controls
              preload="metadata"
              src={`${base}${job.autoTime ? "audio/clean.wav" : job.source}?v=${job.finishedAt}`}
              aria-label="The new voiceover"
            />
          )}
          {job.status === "done" &&
            (unheard ? (
              <div className="hint warn vo-hint vo-unheard">
                <TriangleAlert size={18} />
                <div>
                  <b>
                    {"Timed, but "}
                    {unheard}
                    {" of "}
                    {job.timing.total}
                    {" words of the script were not heard"}
                  </b>
                  <p>
                    {"Their times are guessed between the words around them. Check that the voiceover says the script as written, in "}
                    {lang(language).name}
                    {
                      " (the video's language): if the script is in another language, rewrite it (or set the video's language) and make the voiceover again."
                    }
                    {job.charged ? ` Used about ${nf(job.charged)} ElevenLabs characters.` : ""}
                    {job.usd ? ` Cost about ${usd(job.usd)} of Fish Audio credit.` : ""}
                  </p>
                </div>
              </div>
            ) : (
              <p className="help">
                {job.autoTime
                  ? "Cleaned and timed: Claude can build the scenes to it now."
                  : "Next: clean the audio and time the words (Clean and time, under the preview). Scenes are built and exported to the timed voiceover."}
                {job.charged ? ` Used about ${nf(job.charged)} ElevenLabs characters.` : ""}
                {job.usd ? ` Cost about ${usd(job.usd)} of Fish Audio credit.` : ""}
              </p>
            ))}
          {job.scriptChanged && (
            <div className="hint warn vo-hint">
              <TriangleAlert size={18} />
              <div>
                <b>The script changed while it was being read</b>
                <p>
                  This voiceover (and its timing) reads the script as it was when you pressed Make. Make it again to hear the new text
                  {job.provider === "elevenlabs" ? ": the sections that did not change are reused for free" : ""}.
                </p>
              </div>
            </div>
          )}
          {job.status === "failed" && (
            <div className={`hint ${job.interrupted ? "warn" : "bad"} vo-hint`}>
              <TriangleAlert size={18} />
              <div>
                <b>{job.installed ? `${after} did not finish` : job.interrupted ? "It did not finish" : "Nothing was changed"}</b>
                <p>{job.error}</p>
                {job.note && <p>{job.note}</p>}
              </div>
            </div>
          )}
          {job.status === "cancelled" && job.note && <p className="help">{job.note}</p>}
        </div>
      )}
      <ol className="vo-steps" ref={list}>
        {job.sections.map((s, i) => (
          <li key={i} className={`vo-step ${secMark(i)}`}>
            <span className="c">
              <Icon s={secMark(i)} />
            </span>
            <span className="grow ellipsis" title={s.title}>
              {s.title}
            </span>
            {s.chars > 0 && (
              <small>
                {nf(s.chars)}
                {" characters"}
              </small>
            )}
            {s.state === "cached" && <em>already made</em>}
          </li>
        ))}
        {steps.map(([p2, t]) => {
          const s = job.installed ? stepState(p2) : "wait";
          return (
            <li key={p2} className={`vo-step ${s}`}>
              <span className="c">
                <Icon s={s} />
              </span>
              <span className="grow">{t}</span>
            </li>
          );
        })}
      </ol>
      {job.log.length > 0 && (
        <>
          <button className="text-btn" onClick={() => setDetails(!details)}>
            {details ? "Hide details" : "Show details"}
          </button>
          {details && (
            <div className="log-box" style={{ maxHeight: 160, marginTop: 6 }}>
              {job.log.slice(-80).join("\n")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
function firstTab(vs, want, language = "en", own) {
  const local = vs.kokoro.installed && (language === "en" || !!lang(language).kokoro);
  const gen = vs.elevenlabs.hasKey ? "elevenlabs" : vs.fish.hasKey ? "fish" : local ? "kokoro" : "elevenlabs";
  const pref = own?.voice === "custom" ? (own.custom ? "custom" : "auto") : (own?.voice ?? vs.config.provider);
  if (want === "tts") return pref === "kokoro" || pref === "elevenlabs" || pref === "fish" || pref === "custom" ? pref : gen;
  if (want) return want;
  if (pref !== "auto") return pref;
  return vs.elevenlabs.hasKey ? "elevenlabs" : vs.fish.hasKey ? "fish" : local ? "kokoro" : "file";
}
export function VoiceoverPanel({ projectId, status, base, tab: want, busy, onClose, onWriteScript, onLanguage }) {
  const { toast, dismissTag } = useApp();
  const [vs, reload] = useVoiceStatus();
  const code = lang(status.language).code,
    ownPicks = code !== "en";
  const [tab, setTab] = useState(null);
  const custom = useCustomApi("voice");
  const [customVoice, setCustomVoice] = useState({ voice: "", voiceName: "" });
  const pickCustom = (v) => {
    setCustomVoice(v);
    api.setConfig({ voice: { custom: v } }).catch(() => {});
  };
  const [eleven, setEleven] = useState(null),
    [kokoro, setKokoro] = useState(null);
  const [fish, setFish] = useState(null),
    [fishKeyOpen, setFishKeyOpen] = useState(false),
    [fishCredit, setFishCredit] = useState(null);
  const [files, setFiles] = useState(() => recMemory.get(projectId)?.files ?? []),
    [gap, setGap] = useState(() => recMemory.get(projectId)?.gap ?? 0.5),
    [autoTime, setAutoTime] = useState(true),
    [fresh, setFresh] = useState(false);
  const styleBase = status.styleBase ?? status.style ?? "";
  const [pace, setPace] = useState(() => stylePace(styleBase));
  const pickPace = (v) => {
    setPace(v);
    api.setConfig({ voice: { pace: { [styleBase]: v } } }).catch(() => {});
  };
  const [job, setJob] = useState(null),
    [showing, setShowing] = useState(false),
    [starting, setStarting] = useState(false),
    [keyOpen, setKeyOpen] = useState(false);
  const [est, setEst] = useState(null),
    [estErr, setEstErr] = useState(null),
    [estN, setEstN] = useState(0);
  const startRef = useRef(false),
    [elOk, setElOk] = useState(true);
  const [incoming, setIncoming] = useState(null),
    [dropOver, setDropOver] = useState(false);
  const [spoken, setSpoken] = useState(null);
  const [scriptLang, setScriptLang] = useState(null);
  const [cast, setCast] = useState(null);
  const castOf = (p) => cast?.saved?.[p] ?? {};
  const setCastFor = (p) => (v) => {
    setCast((c) => (c ? { ...c, saved: { ...c.saved, [p]: v } } : c));
    api.voiceSetSpeakers(projectId, p, v).catch((e) => toast(e.message, "bad"));
  };
  useEffect(() => {
    api
      .voiceSpeakers(projectId)
      .then(setCast)
      .catch(() => setCast(null));
    api
      .voiceScriptWords(projectId)
      .then(setSpoken)
      .catch(() => setSpoken(0));
    api
      .readText(projectId, "script.txt")
      .then((t) => setScriptLang(t ? otherScriptLanguage(spokenScript(t, code), code) : null))
      .catch(() => setScriptLang(null));
  }, [projectId, status.scriptWords, status.files.script, status.scriptAt, code]);
  const [acct, loadAcct] = useElevenAccount(!!vs?.elevenlabs.hasKey);
  const [ownVoice, setOwnVoice] = useState(null);
  useEffect(() => {
    api
      .projectOverrides(projectId)
      .then((o) => setOwnVoice({ voice: o.own.voice ?? null, custom: !!o.services.customVoice }))
      .catch(() => setOwnVoice({ voice: null, custom: false }));
  }, [projectId]);
  useEffect(() => {
    if (!vs || tab || !ownVoice) return;
    setTab(!want && recMemory.get(projectId)?.files.length ? "file" : firstTab(vs, want, status.language, ownVoice));
    const per = ownPicks ? vs.config.langs?.[code] : null;
    setEleven(cleanSettings({ ...vs.config.elevenlabs, ...(per?.elevenlabs ?? {}) }));
    setKokoro({ ...vs.config.kokoro, ...(per?.kokoro ?? {}) });
    setCustomVoice({ voice: vs.config.custom?.voice ?? "", voiceName: vs.config.custom?.voiceName ?? "" });
    setFish(fishOf(vs.config.fish, per?.fish));
    setPace(vs.config.pace?.[styleBase] ?? stylePace(styleBase));
    if (!recMemory.has(projectId)) setGap(vs.config.gap ?? 0.5);
    setAutoTime(autoMemory.get(projectId) ?? vs.config.autoTime !== false);
  }, [vs, ownVoice]);
  const picks = useRef({}),
    pickTimer = useRef(0),
    loadedPicks = useRef(false);
  const savePicks = () => {
    clearTimeout(pickTimer.current);
    const p = picks.current;
    picks.current = {};
    if (Object.keys(p).length) api.setConfig({ voice: p }).catch(() => {});
  };
  useEffect(() => {
    if (!eleven || !kokoro || !fish) return;
    if (!loadedPicks.current) {
      loadedPicks.current = true;
      return;
    }
    const el = { ...eleven, voiceName: eleven.voiceName || null },
      fi = { ...fish, voiceId: fish.voiceId || null, voiceName: fish.voiceName || null };
    picks.current = ownPicks ? { gap, langs: { [code]: { elevenlabs: el, kokoro, fish: fi } } } : { gap, elevenlabs: el, kokoro, fish: fi };
    clearTimeout(pickTimer.current);
    pickTimer.current = window.setTimeout(savePicks, 400);
  }, [eleven, kokoro, fish, gap]);
  useEffect(() => () => savePicks(), []);
  useEffect(() => {
    voiceDialogs.add(projectId);
    api
      .voiceJob(projectId)
      .then((j) => {
        if (j?.status === "running" || (j && j.status !== "cancelled" && !j.seen && (j.status === "failed" || unheardWords(j) > 0))) {
          setJob(j);
          setShowing(true);
          if (j.status !== "running") api.voiceSeen(projectId).catch(() => {});
        }
      })
      .catch(() => {});
    const off = on("voice:progress", (j) => {
      if (j.projectId !== projectId) return;
      setJob(j);
      if (j.status !== "running" && !j.seen) api.voiceSeen(projectId).catch(() => {});
    });
    return () => {
      off();
      voiceDialogs.delete(projectId);
    };
  }, [projectId]);
  useEffect(() => {
    if (files.length) recMemory.set(projectId, { files, gap });
    else recMemory.delete(projectId);
  }, [files, gap, projectId]);
  useEffect(watchRecordings, []);
  const running = job?.status === "running",
    showJob = !!job && (running || showing);
  useEffect(() => {
    if (showJob) dismissTag(`voice:${projectId}`);
  }, [showJob, projectId]);
  const view = useRef({ job: showJob, at: 0 });
  if (view.current.job !== showJob) view.current = { job: showJob, at: Date.now() };
  const settled = (fn) => () => {
    if (Date.now() - view.current.at > 400) fn();
  };
  const castReq = (p) => (cast ? { speakers: castOf(p) } : {});
  const estReq = useMemo(
    () =>
      tab === "elevenlabs" && eleven?.voiceId
        ? { provider: tab, eleven, fresh, pace, ...castReq(tab) }
        : tab === "fish" && fish?.voiceId
          ? { provider: tab, fish, fresh, pace, ...castReq(tab) }
          : tab === "kokoro" && kokoro
            ? { provider: tab, kokoro, pace }
            : null,
    [tab, eleven, kokoro, fish, fresh, cast, pace],
  );
  useEffect(() => {
    if (tab === "fish" && vs?.fish.hasKey)
      api
        .fishCredit()
        .then(setFishCredit)
        .catch(() => setFishCredit(null));
  }, [tab, vs?.fish.hasKey, showing]);
  useEffect(() => {
    if (!estReq || !spoken) {
      setEst(null);
      return;
    }
    const t = setTimeout(
      () =>
        api
          .voiceEstimate(projectId, estReq)
          .then((e) => {
            setEst(e);
            setEstErr(null);
          })
          .catch((e) => {
            setEst(null);
            setEstErr(e.message);
          }),
      250,
    );
    return () => clearTimeout(t);
  }, [estReq, projectId, spoken, status.scriptWords, status.scriptAt, estN]);
  const autoFresh = useRef(false);
  useEffect(() => {
    if (est?.current && !fresh) {
      autoFresh.current = true;
      setFresh(true);
    } else if (est && !est.current && autoFresh.current) {
      autoFresh.current = false;
      setFresh(false);
    }
  }, [est?.current, est?.reusable]);
  if (!vs || !tab || !eleven || !kokoro || !fish)
    return (
      <Modal title="Voiceover" onClose={onClose} className="vo-modal">
        <div className="modal-body">
          <Busy text="Loading…" />
        </div>
      </Modal>
    );
  const hasScript = spoken !== 0,
    kokoroReady = vs.kokoro.installed;
  const L = lang(status.language),
    foreign = L.code !== "en",
    kokoroLang = !foreign || !!L.kokoro;
  const replacing = status.steps.find((s) => s.id === "voice")?.done,
    built = status.steps.find((s) => s.id === "scenes")?.done;
  const canGo =
    !starting &&
    !busy &&
    (tab === "file"
      ? files.length > 0
      : !spoken
        ? false
        : tab === "custom"
          ? !!custom?.setup
          : tab === "elevenlabs"
            ? vs.elevenlabs.hasKey && !!eleven.voiceId && elOk
            : tab === "fish"
              ? vs.fish.hasKey && !!fish.voiceId
              : kokoroReady && kokoroLang && !!kokoro.voice);
  const start = async (req) => {
    if (startRef.current) return;
    startRef.current = true;
    setStarting(true);
    try {
      savePicks();
      const j = await api.voiceStart(projectId, req);
      setJob(j);
      setShowing(true);
      setFresh(false);
      autoFresh.current = false;
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setStarting(false);
      startRef.current = false;
    }
  };
  const reqFor = (p) =>
    p === "file"
      ? { provider: "file", files: files.map((f) => f.file), gap, autoTime }
      : p === "elevenlabs"
        ? {
            provider: "elevenlabs",
            eleven,
            autoTime,
            fresh: fresh && !autoFresh.current,
            retake: current || autoFresh.current,
            pace,
            ...castReq(p),
          }
        : p === "fish"
          ? {
              provider: "fish",
              fish,
              autoTime,
              fresh: fresh && !autoFresh.current,
              retake: current || autoFresh.current,
              pace,
              ...castReq(p),
            }
          : p === "custom"
            ? { provider: "custom", custom: customVoice, autoTime, pace, ...castReq(p) }
            : { provider: "kokoro", kokoro, autoTime, pace, ...castReq(p) };
  const castView = (p, narrator) =>
    !!cast?.speakers.length && (
      <CharacterVoices
        provider={p}
        speakers={cast.speakers}
        value={castOf(p)}
        onChange={setCastFor(p)}
        narrator={narrator}
        language={L.code}
        eleven={eleven}
        fish={fish}
        kokoroSpeed={kokoro.speed}
      />
    );
  const go = () => {
    if (canGo) start(reqFor(tab));
  };
  const retry = () => {
    if (!job || busy) return;
    start({ ...(job.req ?? reqFor(job.provider)), fresh: false, retake: false });
  };
  const canRetry = !!job && job.status === "failed" && !job.installed && !(job.provider === "file" && job.interrupted);
  const allMade = !!est && est.cached > 0 && est.cached === est.chunks && !fresh,
    current = (tab === "elevenlabs" || tab === "fish") && !!est?.current;
  const otherLang = tab !== "file" && hasScript && !!scriptLang;
  const goLabel =
    tab === "file"
      ? files.length > 1
        ? `Join ${files.length} recordings`
        : files.length
          ? "Use this recording"
          : "Add a recording first"
      : otherLang
        ? `Read it as ${L.name} anyway`
        : current
          ? "Make a new take"
          : allMade
            ? "Use the voiceover made before"
            : replacing
              ? "Make a new voiceover"
              : "Make the voiceover";
  const onDropFiles = (e) => {
    if (!dragsFiles(e)) return;
    e.preventDefault();
    setDropOver(false);
    if (running) {
      toast("A voiceover is being made right now: add the recording when it has finished.", "info");
      return;
    }
    const paths = droppedPaths(e);
    if (!paths.length) return;
    if (showJob) {
      setShowing(false);
      setJob(null);
    }
    setTab("file");
    setEst(null);
    setIncoming(paths);
  };
  const dialogProps = {
    onDragOver: (e) => {
      if (dragsFiles(e)) {
        e.preventDefault();
        if (!dropOver) setDropOver(true);
      }
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDropOver(false);
    },
    onDrop: onDropFiles,
    // any drop ends the drop look, also one the dashed zone takes for itself (the window stayed green, its hint over Close)
    onDropCapture: () => setDropOver(false),
  };
  const left = acct?.account ? acct.account.left : null,
    short = tab === "elevenlabs" && est && left !== null && est.credits > left;
  const noScript = (
    <div className="vo-card">
      <span className="vo-card-ico">
        <FileText size={18} strokeWidth={1.7} />
      </span>
      <div className="vo-card-txt">
        <b>No script yet</b>
        <p>The voice reads your script. Write it first (Claude can write it from a topic), or switch to My recording.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn small primary" onClick={onWriteScript}>
            Write the script
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <Modal title="Voiceover" onClose={onClose} className={`vo-modal ${dropOver ? "vo-dropping" : ""}`} dialogProps={dialogProps}>
      <div className="modal-body">
        {dropOver && (
          <div className="vo-drophint" aria-hidden="true">
            <Upload size={15} strokeWidth={1.8} />
            {running ? "A voiceover is being made: add it when it has finished" : "Drop to use as your recording"}
          </div>
        )}
        {busy && !showJob && (
          <p className="vo-replace vo-busy">
            <TriangleAlert size={13} />
            Claude is working on this project. Make the voiceover when it has finished: a new voiceover changes the timing it builds to.
          </p>
        )}
        {showJob ? (
          <JobView job={job} base={base} language={code} />
        ) : (
          <>
            <Segmented
              id="vo-tab"
              ariaLabel="Where the voiceover comes from"
              className="vo-tabs"
              value={tab}
              onChange={(v) => {
                if (v !== tab) {
                  setTab(v);
                  setEst(null);
                }
              }}
              options={[
                {
                  value: "file",
                  label: "My recording",
                  hint: files.length && tab !== "file" ? `${files.length} added` : void 0,
                  icon: <Mic size={14} strokeWidth={1.8} />,
                },
                { value: "elevenlabs", label: "ElevenLabs", icon: <Sparkles size={14} strokeWidth={1.8} /> },
                { value: "fish", label: "Fish Audio", icon: <Fish size={14} strokeWidth={1.8} /> },
                { value: "kokoro", label: "Local voice", hint: "free", icon: <Cpu size={14} strokeWidth={1.8} /> },
                ...(custom?.setup || tab === "custom"
                  ? [{ value: "custom", label: "Custom API", icon: <WandSparkles size={14} strokeWidth={1.8} /> }]
                  : []),
              ]}
            />
            {scriptLang && hasScript && (
              <div className="hint warn vo-hint vo-otherlang">
                <TriangleAlert size={18} />
                <div>
                  <b>
                    {"The script is in "}
                    {lang(scriptLang).name}
                    {", but this video is "}
                    {L.name}
                  </b>
                  <p>
                    {tab === "file"
                      ? `The words of your recording are timed as ${L.name}`
                      : `A voice would read the ${lang(scriptLang).name} words as ${L.name}`}
                    , and many of them would not be found when they are timed.
                    {!styleDraws(status.styleBase ?? status.style, scriptLang)
                      ? ` ${status.styleName || "This style"} can't write ${lang(scriptLang).name}: ${cantDrawWhy(status.styleBase ?? status.style, scriptLang)}.`
                      : ""}
                  </p>
                  <div className="row wrap" style={{ marginTop: 10 }}>
                    <button className="btn small" onClick={settled(onWriteScript)}>
                      <FileText size={14} />
                      {"Rewrite it in "}
                      {L.name}
                    </button>
                    {onLanguage && styleDraws(status.styleBase ?? status.style, scriptLang) && (
                      <button className="btn small" onClick={settled(() => onLanguage(scriptLang))}>
                        {"Make it "}
                        {aLang(scriptLang)}
                        {" video"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {foreign && tab !== "file" && (tab !== "kokoro" || kokoroLang) && (
              <p className="vo-langline">
                <LangMark code={L.code} />
                {"This video is in "}
                {L.name}
                {": "}
                {tab === "elevenlabs"
                  ? `every voice reads it in ${L.name}; native ${L.name} voices sound most natural.`
                  : `the voice reads it in ${L.name}.`}
              </p>
            )}
            {replacing && (
              <p className="vo-replace">
                <TriangleAlert size={13} />
                {"This replaces the voiceover you have now (the old one goes to the "}
                {isMac ? "Trash" : "Recycle Bin"}).
                {built ? " Your scenes are timed to it: cues follow the new words, but shot lengths change with the new pacing." : ""}
              </p>
            )}
            <div key={tab} className="vo-pane">
              {tab === "file" && (
                <Recordings
                  files={files}
                  setFiles={setFiles}
                  gap={gap}
                  setGap={setGap}
                  incoming={incoming}
                  clearIncoming={() => setIncoming(null)}
                />
              )}
              {tab === "elevenlabs" &&
                (!vs.elevenlabs.hasKey ? (
                  <div className="vo-card">
                    <span className="vo-card-ico">
                      <Sparkles size={18} strokeWidth={1.7} />
                    </span>
                    <div className="vo-card-txt">
                      <b>Your ElevenLabs voices</b>
                      <p>
                        Natural voices that read your script, including the ones you cloned or designed on ElevenLabs. It uses your own
                        account's characters. Paste an API key from your account once: it is stored encrypted on this computer.
                      </p>
                      <div className="row" style={{ marginTop: 12 }}>
                        <button className="btn small primary" onClick={() => setKeyOpen(true)}>
                          <KeyRound size={14} />
                          Add ElevenLabs key
                        </button>
                        <button
                          className="btn small"
                          onClick={() => api.external("https://elevenlabs.io/app/developers/api-keys").catch(() => {})}
                        >
                          Get a key
                        </button>
                      </div>
                    </div>
                  </div>
                ) : !hasScript ? (
                  noScript
                ) : (
                  <>
                    <ElevenFields
                      value={eleven}
                      onChange={(p) => setEleven((e) => ({ ...e, ...p }))}
                      onKey={() => setKeyOpen(true)}
                      keyHint={vs.elevenlabs.hint}
                      onStatus={setElOk}
                      language={L.code}
                    />
                    {castView("elevenlabs", { id: eleven.voiceId, name: eleven.voiceName ?? "" })}
                    {est && (
                      <Estimate
                        est={est}
                        extra={
                          <>
                            {est.credits === 0 ? (
                              <span>Uses no characters: every part was made before and is reused for free.</span>
                            ) : acct?.account ? (
                              short ? (
                                <span>
                                  {"Needs about "}
                                  <b>{nf(est.credits)}</b>
                                  {" characters: your account has only "}
                                  <b>{nf(acct.account.left)}</b>
                                  {" left this month ("}
                                  {tierName(acct.account.tier)}).
                                </span>
                              ) : (
                                <span>
                                  {"Uses about "}
                                  <b>{nf(est.credits)}</b>
                                  {" of your "}
                                  <b>{nf(acct.account.left)}</b>
                                  {" characters left this month ("}
                                  {tierName(acct.account.tier)}).
                                </span>
                              )
                            ) : acct?.restricted ? (
                              <span>
                                {"Uses about "}
                                <b>{nf(est.credits)}</b>
                                {" characters. (Your key may not read your balance.)"}
                              </span>
                            ) : (
                              <span>
                                {"Uses about "}
                                <b>{nf(est.credits)}</b>
                                {" characters."}
                              </span>
                            )}
                            {current ? (
                              <span>
                                This voice, these settings and this script are the voiceover you have now: this makes a new take of it.
                              </span>
                            ) : (
                              est.cached > 0 && (
                                <span>
                                  {est.cached === est.chunks
                                    ? "You made this exact voiceover before: it is reused for free."
                                    : `${est.cached} of ${est.chunks} parts are already made and are reused for free.`}
                                </span>
                              )
                            )}
                          </>
                        }
                      />
                    )}
                    {short && (
                      <div className="hint warn vo-hint">
                        <TriangleAlert size={18} />
                        <div>
                          <b>Not enough characters left</b>
                          <p>
                            {"This needs about "}
                            {nf(est.credits)}
                            {" characters and your account has "}
                            {nf(left)}
                            {" left"}
                            {acct?.account?.resetsAt ? ` until ${day(acct.account.resetsAt)}` : ""}
                            {". "}
                            {acct?.account?.canExtend
                              ? "Your plan bills the extra."
                              : "It will stop part way; the parts made so far are kept and reused when you continue."}
                          </p>
                        </div>
                      </div>
                    )}
                    {est && est.reusable > 0 && (
                      <label className="check vo-fresh">
                        <input
                          type="checkbox"
                          checked={fresh || current}
                          disabled={current}
                          onChange={(e) => {
                            autoFresh.current = false;
                            setFresh(e.target.checked);
                          }}
                        />
                        <span>Make every part new (a new take, charged again)</span>
                      </label>
                    )}
                  </>
                ))}
              {tab === "fish" &&
                (!vs.fish.hasKey ? (
                  <div className="vo-card">
                    <span className="vo-card-ico">
                      <Fish size={18} strokeWidth={1.7} />
                    </span>
                    <div className="vo-card-txt">
                      <b>Fish Audio voices</b>
                      <p>
                        Natural voices in 80+ languages, your own clones too, on your Fish Audio account's API credit: about 15 cents for a
                        10-minute video. Paste an API key from your account once: it is stored encrypted on this computer.
                      </p>
                      <div className="row" style={{ marginTop: 12 }}>
                        <button className="btn small primary" onClick={() => setFishKeyOpen(true)}>
                          <KeyRound size={14} />
                          Add Fish Audio key
                        </button>
                        <button className="btn small" onClick={() => api.external("https://fish.audio/app/api-keys/").catch(() => {})}>
                          Get a key
                        </button>
                      </div>
                    </div>
                  </div>
                ) : !hasScript ? (
                  noScript
                ) : (
                  <>
                    <FishFields
                      value={fish}
                      onChange={(p) => setFish((f) => ({ ...f, ...p }))}
                      onKey={() => setFishKeyOpen(true)}
                      keyHint={vs.fish.hint}
                      language={L.code}
                    />
                    {castView("fish", { id: fish.voiceId, name: fish.voiceName ?? "" })}
                    {est && (
                      <Estimate
                        est={est}
                        extra={
                          <>
                            {!est.usd ? (
                              <span>Costs nothing: every part was made before and is reused for free.</span>
                            ) : (
                              <span>
                                {"Costs about "}
                                <b>{usd(est.usd)}</b>
                                {" of your Fish Audio credit"}
                                {fishCredit != null ? (
                                  <>
                                    {" (you have "}
                                    <b>${fishCredit.toFixed(2)}</b>)
                                  </>
                                ) : (
                                  ""
                                )}
                                .
                              </span>
                            )}
                            {current ? (
                              <span>
                                This voice, these settings and this script are the voiceover you have now: this makes a new take of it.
                              </span>
                            ) : (
                              est.cached > 0 && (
                                <span>
                                  {est.cached === est.chunks
                                    ? "You made this exact voiceover before: it is reused for free."
                                    : `${est.cached} of ${est.chunks} parts are already made and are reused for free.`}
                                </span>
                              )
                            )}
                          </>
                        }
                      />
                    )}
                    {est && fishCredit != null && (est.usd ?? 0) > fishCredit && (
                      <div className="hint warn vo-hint">
                        <TriangleAlert size={18} />
                        <div>
                          <b>Not enough credit left</b>
                          <p>
                            {"This costs about "}
                            {usd(est.usd)}
                            {" and your Fish Audio account has $"}
                            {fishCredit.toFixed(2)}. It will stop part way; the parts made so far are kept and reused when you continue. Add
                            credit at fish.audio.
                          </p>
                        </div>
                      </div>
                    )}
                    {est && est.reusable > 0 && (
                      <label className="check vo-fresh">
                        <input
                          type="checkbox"
                          checked={fresh || current}
                          disabled={current}
                          onChange={(e) => {
                            autoFresh.current = false;
                            setFresh(e.target.checked);
                          }}
                        />
                        <span>Make every part new (a new take, charged again)</span>
                      </label>
                    )}
                  </>
                ))}
              {tab === "kokoro" &&
                (!kokoroLang ? (
                  <div className="vo-card">
                    <span className="vo-card-ico">
                      <Cpu size={18} strokeWidth={1.7} />
                    </span>
                    <div className="vo-card-txt">
                      <b>
                        {"The local voice doesn't speak "}
                        {L.name}
                      </b>
                      <p>
                        {"It reads "}
                        {KOKORO_LANGS}
                        {". For this "}
                        {L.name}
                        {" video, use ElevenLabs or Fish Audio voices (they speak "}
                        {L.name}) or your own recording.
                      </p>
                      <div className="row" style={{ marginTop: 12 }}>
                        <button
                          className="btn small"
                          onClick={() => {
                            setTab("elevenlabs");
                            setEst(null);
                          }}
                        >
                          <Sparkles size={14} />
                          ElevenLabs
                        </button>
                        <button
                          className="btn small"
                          onClick={() => {
                            setTab("fish");
                            setEst(null);
                          }}
                        >
                          <Sparkles size={14} />
                          Fish Audio
                        </button>
                        <button
                          className="btn small"
                          onClick={() => {
                            setTab("file");
                            setEst(null);
                          }}
                        >
                          <Mic size={14} />
                          My recording
                        </button>
                      </div>
                    </div>
                  </div>
                ) : !kokoroReady ? (
                  <KokoroInstallCard k={vs.kokoro} />
                ) : !hasScript ? (
                  noScript
                ) : (
                  <>
                    <KokoroFields value={kokoro} onChange={(p) => setKokoro((k) => ({ ...k, ...p }))} language={L.code} />
                    {castView("kokoro", {
                      id: kokoro.voice,
                      name: kokoro.voice ? kokoro.voice.slice(3, 4).toUpperCase() + kokoro.voice.slice(4) : "",
                    })}
                    {est && (
                      <Estimate
                        est={est}
                        extra={
                          <span>
                            Made on this computer, free
                            {vs.kokoro.rtf ? `: about ${fmtLength(Math.max(5, est.seconds / vs.kokoro.rtf))} to make` : ""}.
                          </span>
                        }
                      />
                    )}
                  </>
                ))}
              {tab === "custom" &&
                (!custom?.setup ? (
                  <div className="vo-card">
                    <span className="vo-card-ico">
                      <WandSparkles size={18} strokeWidth={1.7} />
                    </span>
                    <div className="vo-card-txt">
                      <b>
                        {"Your own voice service "}
                        <OwnRisk />
                      </b>
                      <p>{"Set it up in Settings > Media > Custom APIs: describe the service and your Claude connects it."}</p>
                    </div>
                  </div>
                ) : !hasScript ? (
                  noScript
                ) : (
                  <div className="vo-card">
                    <span className="vo-card-ico">
                      <WandSparkles size={18} strokeWidth={1.7} />
                    </span>
                    <div className="vo-card-txt">
                      <b>
                        {custom.setup.name} <OwnRisk />
                      </b>
                      <p>
                        Reads the script section by section through the connector your Claude wrote
                        {custom.setup.notes ? ` (${custom.setup.notes})` : ""}. It uses that service's credits. If it fails, your current
                        voiceover stays as it is.
                      </p>
                      <CustomVoiceField value={customVoice} onChange={pickCustom} />
                      {castView("custom", { id: customVoice.voice, name: customVoice.voiceName })}
                    </div>
                  </div>
                ))}
              {estErr && tab !== "file" && tab !== "custom" && hasScript && <p className="help vo-warn">{estErr}</p>}
            </div>
            {tab !== "file" &&
              hasScript &&
              !(tab === "kokoro" && (!kokoroLang || !kokoroReady)) &&
              !(tab === "custom" && !custom?.setup) && (
                <div className="field vo-pace" style={{ marginTop: 16, marginBottom: 0 }}>
                  <span className="label">Pause between sentences</span>
                  <Segmented
                    id="vo-pace"
                    ariaLabel="Pause between sentences"
                    value={pace}
                    onChange={pickPace}
                    options={[
                      { value: "short", label: "Short" },
                      { value: "natural", label: "Natural", hint: "0.75 s" },
                      { value: "long", label: "Long", hint: "1 s" },
                    ]}
                  />
                  <span className="help">
                    {pace === "short"
                      ? "The voice keeps its own pace."
                      : `Every sentence gets ${pace === "natural" ? "0.75" : "1"} s of silence after it, more at a blank line: for stories.`}
                    {" A line like (beat 3s) adds that much silence where it is; (beat) is 1.5 s."}
                  </span>
                </div>
              )}
            {!(tab === "kokoro" && !kokoroLang) && (
              <label className="check vo-auto">
                <input
                  type="checkbox"
                  checked={autoTime}
                  onChange={(e) => {
                    setAutoTime(e.target.checked);
                    autoMemory.set(projectId, e.target.checked);
                  }}
                />
                <span>
                  {"Then clean the audio and time the words "}
                  <span className="dim">
                    (needed before Claude builds the scenes
                    {tab === "elevenlabs" ? "; ElevenLabs sends the word timings, so no transcription is needed" : ""})
                  </span>
                </span>
              </label>
            )}
          </>
        )}
        <div className="modal-actions">
          {showJob ? (
            <>
              {running ? (
                <>
                  <span className="small dim vo-bg">Keeps going if you close this window (not if you quit the app).</span>
                  <button
                    className="btn"
                    onClick={settled(() => api.voiceCancel(projectId))}
                    title="Stop making it (parts already made are kept)"
                  >
                    Stop
                  </button>
                  <button className="btn" onClick={settled(onClose)}>
                    Close
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn"
                    onClick={settled(() => {
                      const p = job.provider;
                      setShowing(false);
                      setJob(null);
                      if (p !== tab) {
                        setTab(p);
                        setEst(null);
                      }
                      reload();
                      loadAcct(true);
                      setEstN((n) => n + 1);
                    })}
                  >
                    {job.status === "done" ? "Make another" : "Back"}
                  </button>
                  {canRetry && (
                    <button
                      className="btn"
                      onClick={settled(retry)}
                      disabled={starting || !!busy}
                      title={`Makes it again the same way: ${job.label}`}
                    >
                      <RefreshCw size={14} />
                      Try again
                    </button>
                  )}
                  <button className="btn primary" onClick={settled(onClose)}>
                    Done
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button className="btn" onClick={settled(onClose)}>
                Close
              </button>
              <button className="btn primary" onClick={settled(go)} disabled={!canGo}>
                {starting ? <Spinner size={14} /> : tab === "file" ? <Check size={15} /> : <AudioLines size={15} />}
                {goLabel}
              </button>
            </>
          )}
        </div>
      </div>
      {keyOpen && (
        <KeyDialog
          provider="elevenlabs"
          hf={vs.elevenlabs}
          onClose={() => setKeyOpen(false)}
          onSaved={() => {
            reload();
            loadAcct(true);
          }}
        />
      )}
      {fishKeyOpen && <KeyDialog provider="fish" hf={vs.fish} onClose={() => setFishKeyOpen(false)} onSaved={() => reload()} />}
    </Modal>
  );
}
function Estimate({ est, extra: given }) {
  const extra = est.beats?.count ? (
    <>
      {given}
      <span>
        {"Includes "}
        {est.beats.count}
        {" beat"}
        {est.beats.count === 1 ? "" : "s"}
        {": "}
        {Math.round(est.beats.seconds * 10) / 10}
        {" s of silence."}
      </span>
    </>
  ) : (
    given
  );
  return (
    <div className="vo-est">
      <div className="vo-est-nums">
        <span>
          <b>{fmtLength(est.seconds)}</b>
          <small>about this long</small>
        </span>
        {lang(est.language).unit !== "char" && (
          <span>
            <b>{nf(est.words)}</b>
            <small>words</small>
          </span>
        )}
        <span>
          <b>{nf(est.chars)}</b>
          <small>characters</small>
        </span>
        <span>
          <b>{est.sections.length}</b>
          <small>{est.sections.length === 1 ? "section" : "sections"}</small>
        </span>
      </div>
      {extra && <div className="vo-est-note">{extra}</div>}
    </div>
  );
}
