import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, on } from "../lib/api";
import { fmtTime, unheardWords } from "../lib/format";
import { useApp } from "../state/AppProvider";
import {
  AudioLines,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  Film,
  FlaskConical,
  FolderOpen,
  Gauge,
  Hammer,
  Keyboard,
  Music,
  NotebookText,
  Palette,
  Pause,
  PenLine,
  Play,
  RefreshCw,
  Repeat,
  Settings2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Busy, Empty, Modal, Spinner } from "../components/ui";
import { Picker } from "../components/Picker";
import { aLang, lang, otherScriptLanguage, styleDraws } from "../settings/languages";
import { LanguagePicker } from "../settings/LanguagePicker";
import { ProjectSettingsPanel } from "../settings/project/ProjectSettingsPanel2";
import { LAYERS_EVENT, commitLayers } from "../state/layerHistory";
import { SoundDialog } from "../sound/SoundDialog";
import { EditorChannel } from "../channels/ChannelEditor";
import { spokenScript } from "../script/scriptText";
import { VoiceoverPanel } from "../voice/VoiceoverPanel";
import { Clock, useClockText, useClockValue, usePlaying } from "../player/clock";
import { PQ_OPTIONS, getPreviewQuality, setPreviewQuality } from "../player/previewQuality";
import { Preview } from "../player/Preview";
import { isStandard, premiumMsg, usePlan } from "../state/usePlan";
import { TrimSilences } from "../../../../editor/TrimSilences";
import { Timeline } from "../../../../editor/Timeline";
import { ClaudePanel } from "../../../../editor/ClaudePanel";
import { GraphicsPanel } from "../../../../editor/panels/GraphicsPanel";
import { LookPanel } from "./panels/LookPanel";
import { Coach } from "./panels/Coach";
import { NotesPanel } from "./panels/NotesPanel";
import { KeysPanel } from "./panels/KeysPanel";
import { BuildPanel } from "./panels/BuildPanel";
import { UltraPanel } from "./panels/UltraPanel";
import { FindPanel } from "./panels/FindPanel";
import { GotoPanel } from "./panels/GotoPanel";
import { takeExportRequest } from "../state/exportRequest";
import { ExportPanel } from "./panels/ExportPanel";
import { ScriptView } from "./panels/ScriptView";
import { ScriptPanel } from "./panels/ScriptPanel";
import { PersonalEditor } from "../personal/PersonalEditor";
import { STYLES_MOVED, selLabel } from "./selectionLabel";

const settle = (s) => (s.index === 0 ? s.t0 : Math.min(s.t0 + 0.3, (s.t0 + s.t1) / 2));
const STEP_ICON = {
  script: PenLine,
  voice: AudioLines,
  clean: WandSparkles,
  timeline: Clock3,
  storyboard: FileText,
  scenes: Hammer,
  sound: Music,
  export: Film,
};
const NOT_TIMED = "Clean the audio and time the words first: the video would still have the previous narration.";
const NOT_TIMED_WORDS = "Time the words first: the scenes would not follow the narration.";
export function Editor() {
  const { projectId, allProjects, openStudio } = useApp();
  const p = allProjects.find((x) => x.id === projectId),
    kind = p?.kind;
  const studio = p?.labKind === "studio";
  useEffect(() => {
    if (studio && p) openStudio(p.id);
  }, [studio, p?.id]);
  if (studio) return null;
  return kind === "personal" ? <PersonalEditor /> : <FacelessEditor />;
}
function FacelessEditor() {
  const { projectId, go, toast, refreshProjects, working, voiceReq, clearVoiceReq, rewriteReq, openRewrite, clearRewriteReq } = useApp();
  const clock = useMemo(() => new Clock(), [projectId]);
  const [st, setSt] = useState(null);
  const [host, setHost] = useState(null);
  const [base, setBase] = useState("");
  const [err, setErr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [shots, setShots] = useState([]);
  const [cues, setCues] = useState([]);
  const [thumbs, setThumbs] = useState([]);
  const [edits, setEdits] = useState([]);
  const thumbTimer = useRef(0);
  const thumbsStale = useRef("all");
  const shotsRef = useRef([]);
  const [bootError, setBootError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [selection, setSel] = useState([]);
  const [tl, setTl] = useState({ phrases: [], events: null, beds: [] });
  const [wave, setWave] = useState(null);
  const [title, setTitle] = useState("");
  const [look, setLook] = useState(false);
  const [gfx, setGfx] = useState(false),
    [gpu, setGpu] = useState(null);
  const [gfxStats, setGfxStats] = useState(() => {
    try {
      return localStorage.getItem("cz-gfx-stats") === "1";
    } catch {
      return false;
    }
  });
  const showStats = (on2) => {
    setGfxStats(on2);
    try {
      localStorage.setItem("cz-gfx-stats", on2 ? "1" : "0");
    } catch {}
  };
  useEffect(() => {
    const open = (e) => {
      if (e.detail === projectId) setGfx(true);
    };
    window.addEventListener("cz-open-graphics", open);
    return () => window.removeEventListener("cz-open-graphics", open);
  }, [projectId]);
  const [exp, setExp] = useState(false);
  useEffect(() => {
    if (takeExportRequest(projectId)) setExp((e) => e || "any");
    const ask = (e) => {
      if (e.detail === projectId && takeExportRequest(projectId)) setExp((x) => x || "any");
    };
    window.addEventListener("cz-open-export", ask);
    return () => window.removeEventListener("cz-open-export", ask);
  }, [projectId]);
  const [pipe, setPipe] = useState(null);
  const [buildReq, setBuildReq] = useState({ n: 0, notes: "" });
  const [scriptReq, setScriptReq] = useState({ n: 0, notes: "" });
  const [scriptDlg, setScriptDlg] = useState(false);
  const [scriptView, setScriptView] = useState(false);
  const [voiceDlg, setVoiceDlg] = useState(null);
  const [voiceJob, setVoiceJob] = useState(null);
  const voicingRef = useRef(false);
  voicingRef.current = voiceJob?.status === "running";
  const untimedRef = useRef("");
  untimedRef.current = st?.untimed ? (st.voiceNew ? NOT_TIMED : NOT_TIMED_WORDS) : "";
  const [lookName, setLookName] = useState(null);
  const [multiLang, setMultiLang] = useState(false);
  const [pq, setPq] = useState(getPreviewQuality);
  const [drawn, setDrawn] = useState(null);
  useEffect(() => {
    api
      .config()
      .then((c) => {
        setMultiLang(c.language?.mode === "multi");
        const q = c.ui?.previewQuality;
        if (q && q !== getPreviewQuality()) {
          setPreviewQuality(q, false);
          setPq(q);
        }
      })
      .catch(() => {});
  }, []);
  const langShown = useRef(false);
  const [styleName, setStyleName] = useState("");
  const [fixReq, setFixReq] = useState({ n: 0, text: "" });
  const fixWithClaude = (errors) =>
    setFixReq(() => ({
      n: Date.now(),
      text: `The preview reports these errors. Find the cause in the scene code, fix it, and check the preview is clean afterwards:
${errors.slice(0, 2e3)}`,
    }));
  const [buildDlg, setBuildDlg] = useState(false);
  const ultraLocked = isStandard(usePlan());
  const [ultraDlg, setUltraDlg] = useState(null),
    [ultraReq, setUltraReq] = useState({ n: 0, notes: "", shots: [] });
  const [ultraLive, setUltraLive] = useState(new Set()),
    sawBusy = useRef(false);
  const [reloading, setReloading] = useState(false);
  const [notes, setNotes] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const loopRef = useRef(null);
  const rateRef = useRef(1);
  rateRef.current = rate;
  clock.rate = rate;
  const [keys, setKeys] = useState(false);
  const [pjSettings, setPjSettings] = useState(false),
    [soundDlg, setSoundDlg] = useState(false),
    [trimDlg, setTrimDlg] = useState(false);
  const [layersV, setLayersV] = useState(null);
  const [hideLeft, setHideLeft] = useState(false);
  const [hideRight, setHideRight] = useState(false);
  const [muted, setMuted] = useState(false);
  const [audioDur, setAudioDur] = useState(0);
  const newEnd = useRef(0);
  newEnd.current = st?.untimed && audioDur > 0 ? audioDur : 0;
  const [goto, setGoto] = useState(false);
  const [find, setFind] = useState(false);
  const [coach, setCoach] = useState(() => {
    try {
      return !localStorage.getItem("cz-coach-editor");
    } catch {
      return false;
    }
  });
  const endCoach = () => {
    setCoach(false);
    try {
      localStorage.setItem("cz-coach-editor", "1");
    } catch {}
  };
  const selRef = useRef([]);
  const preview = useRef(null);
  const audio = useRef(null);
  const curIdx = useClockValue(
    clock,
    useCallback((v) => shots.findIndex((s) => v >= s.t0 && v < s.t1), [shots]),
  );
  const timecode = useRef(null);
  useClockText(
    clock,
    timecode,
    useCallback((v) => fmtTime(v, 2), []),
  );
  const playing = usePlaying(clock);
  const loadStatus = useCallback(async () => {
    if (projectId) {
      const s = await api.status(projectId);
      setSt(s);
      return s;
    }
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    setLayersV(null);
    api
      .layers(projectId)
      .then(setLayersV)
      .catch(() => {});
    const h = (e) => {
      if (e.detail?.projectId === projectId) setLayersV(e.detail.view);
    };
    window.addEventListener(LAYERS_EVENT, h);
    return () => window.removeEventListener(LAYERS_EVENT, h);
  }, [projectId]);
  const loadTimeline = useCallback(
    async (s) => {
      if (!projectId) return;
      setTl(await api.timeline(projectId));
      const src = s?.previewAudio ?? st?.previewAudio;
      setWave(src ? await api.waveform(projectId, src).catch(() => null) : null);
    },
    [projectId, st?.previewAudio],
  );
  useEffect(() => {
    if (!projectId) return;
    let dead = false;
    api
      .openProject(projectId)
      .then((r) => {
        if (dead) return;
        setSt(r.status);
        setHost(r.host);
        setBase(r.base);
        setTitle(r.status.title);
        clock.end = r.status.end;
        loadTimeline(r.status);
        if (!r.git) toast("Git is not installed: edits work, but can’t be reverted.", "info");
      })
      .catch((e) => setErr(e.message));
    return () => {
      dead = true;
      api.closeProject();
    };
  }, [projectId]);
  const loadEdits = useCallback(() => {
    if (projectId)
      api
        .edits(projectId)
        .then(setEdits)
        .catch(() => {});
  }, [projectId]);
  useEffect(() => {
    loadEdits();
  }, [loadEdits]);
  const marks = useMemo(
    () =>
      edits
        .filter((e) => e.files.length && e.status !== "running")
        .map((e) => {
          const s = e.selection?.[0];
          const t = e.compare?.time ?? s?.time ?? s?.range?.[0] ?? s?.shot?.t0;
          return typeof t === "number" ? { t, text: e.instruction || "Build", status: e.status } : null;
        })
        .filter(Boolean),
    [edits],
  );
  useEffect(() => {
    if (title) document.title = `${title} · Videoxx`;
    return () => {
      document.title = "Videoxx";
    };
  }, [title]);
  useEffect(() => {
    if (!st) return;
    Promise.all([api.presets(), api.styles()]).then(([l, ss]) => {
      if (st.styleLab) {
        setStyleName("Style lab");
        setLookName(st.styleLab.name);
        return;
      }
      if (st.characterLab) {
        setStyleName("Character lab");
        setLookName(st.character?.name ?? "character");
        return;
      }
      setLookName(l.find((p) => p.id === st.project.preset_id)?.name ?? null);
      setStyleName(ss.find((x) => x.id === st.style)?.name ?? st.styleName ?? "Style");
    });
  }, [st?.project.preset_id, st?.style, st?.styleLab?.name, st?.character?.name]);
  useEffect(() => {
    if (!projectId || !st) return;
    let want = false;
    try {
      want = sessionStorage.getItem("cz-write-script") === projectId;
      if (want) sessionStorage.removeItem("cz-write-script");
    } catch {}
    if (want) setScriptReq({ n: Date.now(), notes: "" });
  }, [projectId, !!st]);
  useEffect(() => {
    const changed = (e) => {
      if (e.projectId !== projectId) return;
      loadEdits();
      if (e.reload) {
        setReloadKey((k) => k + 1);
        setReloading(true);
        setLogs([]);
      }
      const files = (e.files ?? []).map((f) => (typeof f === "string" ? f : String(f?.file ?? ""))).filter(Boolean);
      const st2 = thumbsStale.current;
      if (st2 !== "all") files.forEach((f) => st2.add(f));
      if (files.some((f) => f.startsWith("audio/") || f === "project.json")) loadStatus().then((s) => loadTimeline(s));
      else loadStatus();
    };
    const offDone = on("claude:event", (ev) => {
      if (ev.type === "done" && ev.files?.length) changed({ projectId: ev.projectId, files: ev.files, reload: true });
    });
    const offChanged = on("project:changed", changed);
    return () => {
      offDone();
      offChanged();
    };
  }, [projectId, loadStatus, loadTimeline, loadEdits]);
  useEffect(() => {
    if (!projectId) return;
    api
      .voiceJob(projectId)
      .then(setVoiceJob)
      .catch(() => {});
    let last = "";
    return on("voice:progress", (j) => {
      if (j.projectId !== projectId) return;
      setVoiceJob(j);
      const key = `${j.status}:${j.phase}:${j.installed}`;
      if (key === last) return;
      last = key;
      if (j.installed) loadStatus().then((s) => loadTimeline(s));
    });
  }, [projectId, loadStatus, loadTimeline]);
  useEffect(() => {
    if (voiceReq && voiceReq.projectId === projectId) {
      setVoiceDlg({});
      clearVoiceReq();
    }
  }, [voiceReq, projectId]);
  useEffect(() => {
    if (rewriteReq && rewriteReq.projectId === projectId) {
      setScriptDlg(true);
      clearRewriteReq();
    }
  }, [rewriteReq, projectId]);
  const [, setOtherSeen] = useState(0);
  useEffect(() => {
    if (st) clock.end = newEnd.current || st.end || clock.end;
  }, [st?.untimed, st?.end, audioDur]);
  const player = useRef(null);
  if (audio.current) player.current = audio.current;
  useEffect(
    () => () => {
      const a = player.current;
      if (a) {
        a.pause();
        a.removeAttribute("src");
        a.load();
      }
    },
    [],
  );
  useEffect(() => {
    if (projectId)
      api.setSelection(
        projectId,
        selection.map(({ rect, ...s }) => s),
      );
  }, [selection, projectId]);
  const range =
    selection.find((s) => s.kind === "range" || s.kind === "phrase")?.range ??
    (selection.find((s) => s.kind === "shot")?.shot
      ? [selection.find((s) => s.kind === "shot").shot.t0, selection.find((s) => s.kind === "shot").shot.t1]
      : null);
  loopRef.current = loop && range ? range : null;
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);
  useEffect(() => {
    if (audio.current) audio.current.muted = muted;
  }, [muted]);
  selRef.current = selection;
  useEffect(() => {
    const a = audio.current;
    let raf = 0,
      t0 = 0,
      c0 = 0;
    const off = clock.onPlaying((p) => {
      cancelAnimationFrame(raf);
      if (p) {
        if (clock.t >= clock.end - 0.05) clock.set(0);
        const lp = loopRef.current;
        if (lp && (clock.t < lp[0] || clock.t >= lp[1])) clock.set(lp[0]);
        const inAudio = (t) => !!(a && a.src) && t < (a.duration || Infinity) - 0.05;
        if (a && a.src) {
          a.currentTime = clock.t;
          a.playbackRate = rateRef.current;
          if (inAudio(clock.t)) a.play().catch(() => {});
        }
        t0 = performance.now();
        c0 = clock.t;
        let lastSet = clock.t,
          lastRate = rateRef.current;
        const tick = () => {
          if (Math.abs(clock.t - lastSet) > 1e-3) {
            if (a && a.src) {
              a.currentTime = clock.t;
              if (inAudio(clock.t) && a.paused) a.play().catch(() => {});
            }
            t0 = performance.now();
            c0 = clock.t;
          }
          if (rateRef.current !== lastRate) {
            c0 = c0 + ((performance.now() - t0) / 1e3) * lastRate;
            t0 = performance.now();
            lastRate = rateRef.current;
          }
          const v = a && a.src && !a.paused ? a.currentTime : c0 + ((performance.now() - t0) / 1e3) * rateRef.current;
          const lp2 = loopRef.current;
          if (lp2 && v >= lp2[1]) {
            if (a && a.src) a.currentTime = lp2[0];
            t0 = performance.now();
            c0 = lp2[0];
            clock.set(lp2[0]);
            lastSet = lp2[0];
            raf = requestAnimationFrame(tick);
            return;
          }
          if (v >= clock.end) {
            clock.set(clock.end);
            clock.setPlaying(false);
            return;
          }
          clock.set(v);
          lastSet = clock.t;
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } else a?.pause();
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
      a?.pause();
    };
  }, [clock, base]);
  useEffect(() => {
    const key = (e) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      const mod = e.ctrlKey || e.metaKey,
        k = e.key.toLowerCase();
      if (mod && k === "i") {
        e.preventDefault();
        document.querySelector(".composer textarea")?.focus();
        return;
      }
      if (mod && k === "b") {
        e.preventDefault();
        setHideLeft((v) => !v);
        return;
      }
      if (mod && k === "f") {
        e.preventDefault();
        setFind(true);
        return;
      }
      if (mod && k === "e") {
        e.preventDefault();
        if (voicingRef.current) toast("Wait for the voiceover to finish: the video would still have the old narration.", "info");
        else if (untimedRef.current && shots.length) toast(untimedRef.current, "info");
        else if (shots.length) setExp("any");
        return;
      }
      if (mod && k === "j") {
        e.preventDefault();
        setHideRight((v) => !v);
        return;
      }
      const tag = e.target?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      const setRange = (a, b) =>
        setSel((s) => [...s.filter((x) => x.kind !== "range"), { kind: "range", range: [Math.min(a, b), Math.max(a, b)] }]);
      const cur = selRef.current.find((x) => x.kind === "range")?.range;
      if (e.code === "Space") {
        e.preventDefault();
        clock.setPlaying(!clock.playing);
      }
      const at = e.altKey ? clock.t : (shots.flatMap((s) => [s.t0, s.t1]).find((b) => Math.abs(b - clock.t) <= 0.35) ?? clock.t);
      if (!mod && k === "i") setRange(at, cur && cur[1] > at ? cur[1] : clock.end);
      else if (!mod && k === "o") setRange(cur && cur[0] < at ? cur[0] : 0, at);
      else if (!mod && k === "x") setSel((s) => s.filter((x) => x.kind !== "range"));
      else if (!mod && k === "k") clock.setPlaying(false);
      else if (!mod && k === "l") {
        if (clock.playing) setRate((r) => (r >= 2 ? 1 : r === 1 ? 1.5 : 2));
        else {
          setRate(1);
          clock.setPlaying(true);
        }
      } else if (!mod && k === "j") {
        clock.setPlaying(false);
        clock.set(clock.t - 2);
      } else if (!mod && k === "g") {
        e.preventDefault();
        setGoto(true);
      } else if (!mod && k === "m") setMuted((v) => !v);
      else if (!mod && k === "f") {
        const s = document.querySelector(".stage");
        if (document.fullscreenElement) document.exitFullscreen();
        else s?.requestFullscreen().catch(() => {});
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        clock.setPlaying(false);
        clock.set(clock.t + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === "Home") clock.set(0);
      else if (e.key === "End") clock.set(clock.end);
      else if (e.key === "[" || e.key === "]") {
        const i = shots.findIndex((s) => clock.t >= s.t0 && clock.t < s.t1);
        const n = shots[Math.max(0, Math.min(shots.length - 1, i + (e.key === "]" ? 1 : -1)))];
        if (n) clock.set(settle(n));
      } else if (!mod && (e.key === "=" || e.key === "+")) preview.current?.zoom(1.5);
      else if (!mod && e.key === "-") preview.current?.zoom(1 / 1.5);
      else if (!mod && e.key === "0") preview.current?.zoom(0);
      else if (e.key === "Escape") setSel([]);
      else if (e.key === "?") setKeys(true);
      else if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && k === "z") || k === "y") && projectId) {
        e.preventDefault();
        api.edits(projectId).then((list) => {
          const last = list.find((x) => x.status === "reverted" && x.files.length);
          if (!last) return toast("Nothing to redo.", "info");
          toast(`Re-apply “${last.instruction.slice(0, 60)}”?`, "info", {
            label: "Re-apply",
            run: () =>
              api
                .reapply(last.id)
                .then(() => toast("Edit re-applied."))
                .catch((err2) => toast(err2.message, "bad")),
          });
        });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && projectId) {
        e.preventDefault();
        api.edits(projectId).then((list) => {
          const last = list.find((x) => x.status === "done" && x.files.length);
          if (!last) return toast("No edit to undo.", "info");
          toast(`Undo “${last.instruction.slice(0, 60)}”?`, "info", {
            label: "Revert",
            run: () =>
              api
                .revert(last.id)
                .then(() =>
                  toast("Edit reverted.", "ok", {
                    label: "Re-apply",
                    run: () =>
                      api
                        .reapply(last.id)
                        .then(() => toast("Edit re-applied."))
                        .catch((err2) => toast(err2.message, "bad")),
                  }),
                )
                .catch((err2) => toast(err2.message, "bad")),
          });
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [clock, shots, projectId]);
  const busy = !!projectId && working.has(projectId);
  useEffect(() => {
    if (busy) sawBusy.current = true;
    else if (sawBusy.current) {
      sawBusy.current = false;
      setUltraLive(new Set());
    }
  }, [busy]);
  useEffect(() => {
    if (!ultraLive.size) return;
    const t = setTimeout(() => {
      if (!sawBusy.current) setUltraLive(new Set());
    }, 2e4);
    return () => clearTimeout(t);
  }, [ultraLive]);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const refreshThumbs = useCallback(() => {
    clearTimeout(thumbTimer.current);
    thumbTimer.current = window.setTimeout(() => {
      const list = shotsRef.current,
        stale = thumbsStale.current;
      if (!projectId || !list.length || busyRef.current) return;
      const all = stale === "all" || [...stale].some((f) => !f.startsWith("scenes/"));
      const todo = list.filter((s) => all || stale.has(s.file ?? ""));
      thumbsStale.current = new Set();
      if (!todo.length) return;
      if (all) setThumbs((prev) => prev.slice(0, list.length));
      (async () => {
        for (let k = 0; k < todo.length; k += 8) {
          const part = todo.slice(k, k + 8);
          if (busyRef.current) {
            thumbsStale.current = "all";
            return;
          }
          const urls = await api.shotThumbs(
            projectId,
            part.map((s) => +(s.t0 + Math.min(1.5, (s.t1 - s.t0) * 0.5)).toFixed(2)),
            part.map((s) => s.file ?? null),
          );
          setThumbs((prev) => {
            const next = prev.slice(0, list.length);
            part.forEach((s, i) => {
              next[s.index] = urls[i];
            });
            return next;
          });
        }
      })().catch(() => {
        thumbsStale.current = "all";
      });
    }, 1200);
  }, [projectId]);
  useEffect(() => {
    if (!busy) refreshThumbs();
  }, [busy, refreshThumbs]);
  const coverMade = useRef(false);
  const onReady = useCallback(
    (info) => {
      setReloading(false);
      setShots(info.shots);
      setCues(info.cues ?? []);
      clock.end = newEnd.current || info.end || clock.end;
      setGpu(info.gpu ?? null);
      const prev = shotsRef.current;
      shotsRef.current = info.shots;
      if (
        prev.length !== info.shots.length ||
        prev.some((s, i) => Math.abs(s.t0 - info.shots[i].t0) > 0.01 || Math.abs(s.t1 - info.shots[i].t1) > 0.01)
      )
        thumbsStale.current = "all";
      refreshThumbs();
      setSel((s) => (s.some((x) => x.rect) ? s.map(({ rect, ...x }) => x) : s));
      if (projectId) {
        api.reportShots(projectId, info.shots);
        if (!coverMade.current && info.shots.length && !info.errors?.some((e) => e.level === "error"))
          ((coverMade.current = true),
            api
              .thumbnail(projectId, Math.min(info.end * 0.3, 20))
              .then(() => refreshProjects())
              .catch(() => {}));
      }
    },
    [projectId, refreshThumbs],
  );
  const scrub = useRef({ last: 0, timer: 0 });
  const scrubAudio = useCallback(
    (at) => {
      const a = audio.current,
        sc = scrub.current,
        now = performance.now();
      if (!a || !a.src || clock.playing || now - sc.last < 70) return;
      sc.last = now;
      a.currentTime = at;
      a.play().catch(() => {});
      clearTimeout(sc.timer);
      sc.timer = window.setTimeout(() => {
        if (!clock.playing) a.pause();
      }, 90);
    },
    [clock],
  );
  const onLog = useCallback((level, text) => setLogs((l) => [...l.slice(-60), { level, text }]), []);
  const onPick = useCallback((r, additive) => {
    const item = { kind: r.kind, time: r.time, shot: r.shot, element: r.element, rect: r.rect };
    setSel((s) => (additive ? [...s, item] : [item]));
  }, []);
  const onTimelineSelect = useCallback(
    (item, additive) =>
      setSel((s) => {
        if (additive) return [...s, item];
        return [item];
      }),
    [],
  );
  const snapshot = useCallback(async () => {
    const url = await preview.current?.frame(0.5);
    if (!url) return null;
    const boxes = selection.filter((s) => s.rect && s.time !== void 0 && Math.abs(s.time - clock.t) < 0.05);
    if (!boxes.length) return { frame: url, plain: url };
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    g.strokeStyle = "#89ffc0";
    g.lineWidth = 3;
    boxes.forEach((b) => g.strokeRect(b.rect.x * c.width, b.rect.y * c.height, b.rect.w * c.width, b.rect.h * c.height));
    return { frame: c.toDataURL("image/jpeg", 0.85), plain: url };
  }, [selection, clock]);
  const onEditDone = useCallback(() => {
    loadStatus();
    loadTimeline();
    loadEdits();
  }, [loadStatus, loadTimeline, loadEdits]);
  const chatSeek = useCallback(
      (v) => {
        clock.setPlaying(false);
        clock.set(v);
      },
      [clock],
    ),
    chatTime = useCallback(() => clock.t, [clock]);
  const runStep = async (step) => {
    if (!projectId) return false;
    if (step === "scenes" || step === "storyboard") {
      setBuildDlg(true);
      return false;
    }
    if (step === "script") {
      st?.steps.find((s) => s.id === "script")?.done ? setScriptView(true) : setScriptDlg(true);
      return false;
    }
    if (step === "export") {
      setExp("video");
      return false;
    }
    if (step === "voice") {
      setVoiceDlg({});
      return false;
    }
    const map = { clean: "clean", timeline: "timeline", sound: "sound" };
    setPipe({ step, lines: [], busy: true, since: Date.now() });
    let timing = null;
    const off = on("pipeline:log", (e) => {
      if (e.projectId !== projectId) return;
      setPipe((p) => (p ? { ...p, lines: [...p.lines.slice(-300), e.line] } : p));
      const m = /matched (\d+) of (\d+) script words/.exec(e.line);
      if (m) timing = { matched: +m[1], total: +m[2] };
    });
    try {
      const r = await api.runStep(projectId, map[step], { tightenPauses: false });
      setPipe((p) => (p ? { ...p, busy: false } : p));
      const unheard = step === "timeline" && timing ? unheardWords({ autoTime: true, timing }) : 0;
      if (unheard)
        toast(
          `Timed, but ${unheard} of ${timing.total} words of the script were not heard: check that the voiceover says the script as written, in ${lang(st?.language).name}. Their times are guessed.`,
          "info",
        );
      else
        toast(
          step === "sound" && r?.pass === false ? "Mixed, but the voice-to-bed check failed. Lower bed gains in audio/beds.json." : "Done.",
          step === "sound" && r?.pass === false ? "info" : "ok",
        );
      const s = await loadStatus();
      loadTimeline(s);
      setReloadKey((k) => k + 1);
      return true;
    } catch (e) {
      setPipe((p) => (p ? { ...p, busy: false, error: e.message } : p));
      return false;
    } finally {
      off();
    }
  };
  const cleanAndTime = async () => {
    if (await runStep("clean")) await runStep("timeline");
  };
  const topRef = useRef(null),
    [langShort, setLangShort] = useState(false),
    langFull = useRef(0);
  const [saveTick, setSaveTick] = useState(false),
    bar = useRef({ tick: false, short: false });
  const barReady = !!st && !!host;
  useLayoutEffect(() => {
    const top = topRef.current;
    if (!top) return;
    const fit = () => {
      const save = top.querySelector(":scope > .save-state"),
        grow = top.querySelector(":scope > .grow"),
        btn = top.querySelector("#ed-lang");
      if (!save || !grow) return;
      const w = (e) => e.getBoundingClientRect().width,
        txt = save.querySelector(".ss-txt"),
        TXT = 56;
      let { tick, short } = bar.current;
      if (!btn) short = false;
      if (short) {
        if (w(grow) >= (langFull.current || w(btn) + 70) - w(btn) + 9) short = false;
      } else if (tick) {
        if (w(grow) >= TXT + 9) tick = false;
        else if (btn && w(grow) < 1) {
          langFull.current = w(btn);
          short = true;
        }
      } else if (txt && txt.scrollWidth > txt.clientWidth + 1 && txt.clientWidth < TXT) tick = true;
      bar.current = { tick, short };
      setSaveTick(tick);
      setLangShort(short);
    };
    fit();
    const ro = new ResizeObserver(fit);
    for (const e of [top, top.querySelector(":scope > .save-state"), top.querySelector(":scope > .grow")]) if (e) ro.observe(e);
    return () => ro.disconnect();
  }, [barReady, st?.language, langShown.current]);
  if (!projectId)
    return (
      <div className="page">
        <Empty icon={<Film size={28} />} title="No project open" text="Open a project to edit it.">
          <button className="btn primary" onClick={() => go("projects")}>
            Go to projects
          </button>
        </Empty>
      </div>
    );
  if (err)
    return (
      <div className="page">
        <div className="hint bad">
          <TriangleAlert size={18} />
          <div>
            <b>Could not open this project</b>
            <p>{err}</p>
          </div>
        </div>
        <button className="btn" onClick={() => go("projects")}>
          Back to projects
        </button>
      </div>
    );
  if (!st || !host)
    return (
      <div className="loading">
        <Busy text="Opening project…" size={22} kind="orbit" />
      </div>
    );
  const curShot = curIdx >= 0 ? shots[curIdx] : void 0;
  const voiceStopped = voiceJob?.status === "failed" && !voiceJob.seen;
  const stoppedAt = !voiceStopped ? null : !voiceJob.installed ? "voice" : voiceJob.phase === "clean" ? "clean" : "timeline";
  const voicing = voiceJob?.status === "running";
  const end = newEnd.current || st.end;
  const errorsNow = logs.filter((l) => l.level === "error" || l.text.startsWith("cue miss"));
  const saveFrame = async () => {
    try {
      const f = await api.saveFrame(projectId, clock.t);
      toast(`Saved ${f.split(/[\\/]/).pop()}`, "ok", {
        label: "Copy image",
        run: () =>
          api
            .copyImage(f)
            .then(() => toast("Frame copied. Paste it anywhere."))
            .catch((err2) => toast(err2.message, "bad")),
      });
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const upgradeEngine = async () => {
    const pkg = st.stylePkg?.mine ? st.stylePkg : null;
    try {
      setSt(await api.upgradeEngine(projectId));
      setReloadKey((k) => k + 1);
      toast(
        pkg
          ? `This video has ${pkg.name} v${pkg.latest} now. History can undo it.`
          : "Engine updated. The old one is in .suite/engine.before-upgrade.js.",
      );
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  if (multiLang || (st.language && st.language !== "en")) langShown.current = true;
  const langLock = voicing
    ? `A voiceover is being made in ${lang(st.language).name}: change the language when it has finished`
    : busy
      ? "Claude is working on this video: change its language when it has finished"
      : pipe?.busy && (pipe.step === "clean" || pipe.step === "timeline")
        ? "The audio is being cleaned and timed: change the language when it has finished"
        : null;
  const setLanguage = async (code) => {
    try {
      const s = await api.setMeta(projectId, { language: code });
      setSt(s);
      const L = lang(code),
        had = [
          s.scriptWords > 0 && "script",
          s.steps.find((x) => x.id === "voice")?.done && "voiceover",
          s.scenes.length > 0 && "scenes",
        ].filter(Boolean);
      const script = s.scriptWords > 0 ? await api.readText(projectId, "script.txt").catch(() => null) : null;
      const other = script ? otherScriptLanguage(spokenScript(script, L.code), L.code) : null;
      const rest = other ? had.filter((h) => h !== "script") : had;
      const keep = rest.length
        ? ` The ${rest.join(", ").replace(/, ([^,]*)$/, " and $1")} you have ${rest.length === 1 && rest[0] !== "scenes" ? "stays as it is" : "stay as they are"}.`
        : "";
      const old = L.code !== "en" && !!s.langEngine && !s.langEngine.accents && !s.engineCurrent;
      const gone =
        !multiLang && L.code === "en" ? " English only is on (Settings > Language): this button goes when you leave this video." : "";
      const scriptNote = other
        ? ` The script is still in ${lang(other).name}: Rewrite with Claude writes it in ${L.name} (a voice would read it as ${L.name}).`
        : "";
      toast(
        `${L.name} from now on: Claude writes, the voice reads and the words are timed in ${L.name}.${scriptNote}${keep}${old ? " Update the engine so cues find words with accents." : ""}${gone}`,
        "info",
        other
          ? { label: "Rewrite script", run: () => openRewrite(projectId) }
          : old
            ? { label: "Update engine", run: upgradeEngine }
            : void 0,
      );
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const otherKey = `cz-otherlang:${projectId}`,
    otherNow = st.scriptLanguage ? `${st.scriptAt}|${st.language}|${st.scriptLanguage}` : "";
  const otherHidden = (() => {
    try {
      return !!otherNow && localStorage.getItem(otherKey) === otherNow;
    } catch {
      return false;
    }
  })();
  const hideOther = () => {
    try {
      localStorage.setItem(otherKey, otherNow);
    } catch {}
    setOtherSeen((n) => n + 1);
  };
  const saveTitle = async () => {
    const v = title.trim();
    if (v && v !== st.title) {
      try {
        await api.renameProject(projectId, v);
        loadStatus();
        refreshProjects();
      } catch (e) {
        toast(e.message, "bad");
        setTitle(st.title);
      }
    }
  };
  return (
    <div
      className={`editor page-enter ${hideLeft ? "no-left" : ""} ${hideRight ? "no-right" : ""} ${st.style && st.style !== "pixel-art" ? "smooth" : ""}`}
    >
      <div className="ed-top" ref={topRef}>
        <input
          className="ed-title"
          aria-label="Project title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
          size={Math.max(8, title.length)}
          title={title}
        />
        {!st.styleLab && !st.characterLab && (
          <button
            className="icon-btn ed-settings-btn"
            title="Project settings: this project's own image generation, voiceover, Claude model, real media and sound"
            aria-label="Project settings"
            onClick={() => setPjSettings(true)}
          >
            <Settings2 size={16} strokeWidth={1.7} />
          </button>
        )}
        <span
          className={`save-state ${saveTick ? "ss-tick" : ""}`}
          title={saveTick ? (reloading ? "Reloading preview" : "Saved locally · git history") : void 0}
        >
          {reloading ? (
            <>
              <Spinner size={12} />
              <span className="ss-txt">Reloading preview</span>
            </>
          ) : (
            <>
              <Check size={12} />
              <span className="ss-txt">Saved locally · git history</span>
            </>
          )}
        </span>
        <EditorChannel projectId={projectId} />
        {st.styleLab && (
          <span
            className="lab-chip"
            title={`An old style lab for "${st.styleLab.name}". ${STYLES_MOVED} The styles it saved before keep working.`}
          >
            <FlaskConical size={14} strokeWidth={1.8} />
            Style lab
          </span>
        )}
        {st.characterLab && (
          <span
            className="lab-chip"
            title="Character lab: Claude designs this character in character.js. Every change that finishes is checked and saved to your Characters (Styles page)."
          >
            <FlaskConical size={14} strokeWidth={1.8} />
            Character lab
          </span>
        )}
        <span className="grow" />
        {voicing || voiceStopped ? (
          <button
            className={`btn small ed-voice ${stoppedAt === "voice" && !voiceJob.interrupted ? "bad" : stoppedAt ? "warn" : ""}`}
            onClick={() => setVoiceDlg({})}
            title={voiceStopped ? voiceJob.error : "Open the voiceover to follow it"}
          >
            {voicing ? <Spinner size={12} /> : <TriangleAlert size={14} />}
            <span className="ellipsis">
              {stoppedAt === "voice"
                ? "Voiceover stopped"
                : stoppedAt === "clean"
                  ? "Cleaning stopped"
                  : stoppedAt
                    ? "Timing stopped"
                    : voiceJob.phase === "clean"
                      ? "Cleaning the audio…"
                      : voiceJob.phase === "timeline"
                        ? "Timing the words…"
                        : "Making the voiceover…"}
            </span>
          </button>
        ) : (
          !st.styleLab &&
          !st.characterLab && (
            <button className="icon-btn ed-voice-btn" title="Voiceover" aria-label="Voiceover" onClick={() => setVoiceDlg({})}>
              <AudioLines size={17} strokeWidth={1.7} />
            </button>
          )
        )}
        {!st.engineCurrent &&
          !st.styleLab &&
          !st.characterLab &&
          (st.stylePkg?.mine ? (
            <button
              className="btn small ed-update-style"
              title={`This video uses version ${st.stylePkg.version} of your style "${st.stylePkg.name}". Update gives it version ${st.stylePkg.latest}: its engine, look notes and skill. Your scenes and settings stay, and History can undo it.`}
              onClick={upgradeEngine}
            >
              <RefreshCw size={14} />
              <span className="upd-long">
                {st.stylePkg.name}
                {" v"}
                {st.stylePkg.latest}
                {" is available · "}
              </span>
              Update
            </button>
          ) : (
            <button
              className="btn small ed-update-engine"
              title="Replaces engine.js with the Suite's newest engine. Your scenes and settings stay; the old engine is kept in .suite/."
              onClick={upgradeEngine}
            >
              <RefreshCw size={14} />
              Update
              <span className="upd-long">
                {" engine "}
                {st.engineVersion ? `v${st.engineVersion} → v${st.latestEngine}` : ""}
              </span>
            </button>
          ))}
        {langShown.current && !st.styleLab && !st.characterLab && (
          <span
            className="ed-lang"
            title={
              langLock ?? `The narration's language: Claude writes, the voice reads and the words are timed in ${lang(st.language).name}`
            }
          >
            <LanguagePicker
              id="ed-lang"
              className={`lg-pick ${langShort ? "lg-short" : ""}`}
              ariaLabel="Language of this video"
              value={st.language || "en"}
              base={st.styleBase ?? st.style}
              onChange={setLanguage}
              typeAhead={false}
              disabled={!!langLock}
            />
          </span>
        )}
        <button
          className="btn small look-btn"
          title={`Style and look: ${styleName ? `${styleName} · ` : ""}${lookName ?? st.project.preset_id ?? "custom"}`}
          onClick={() => setLook(true)}
        >
          <Palette size={15} strokeWidth={1.7} />
          <span className="look-t">
            {styleName ? (
              <span className="look-style">
                {styleName}
                {" · "}
              </span>
            ) : null}
            {lookName ?? st.project.preset_id ?? "custom"}
          </span>
        </button>
        {!st.characterLab && (
          <button
            className={`btn small gfx-btn ${gfx ? "active" : ""}`}
            aria-pressed={gfx}
            title="Graphics: render scale, shadows, post processing, colour grade and export quality, live in the preview"
            onClick={() => setGfx((g) => !g)}
          >
            <SlidersHorizontal size={15} strokeWidth={1.7} />
            <span className="gfx-btn-t">Graphics</span>
          </button>
        )}
        <button
          className="icon-btn"
          title="Project notes (storyboard, CLAUDE.md, style)"
          aria-label="Project notes"
          onClick={() => setNotes(true)}
        >
          <NotebookText size={17} strokeWidth={1.7} />
        </button>
        <button className="icon-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setKeys(true)}>
          <Keyboard size={17} strokeWidth={1.7} />
        </button>
        <button className="icon-btn" title="Open project folder" aria-label="Open project folder" onClick={() => api.open(st.project.path)}>
          <FolderOpen size={17} strokeWidth={1.7} />
        </button>
        <button
          className="btn small primary"
          onClick={() => setExp("any")}
          disabled={!st.end || !shots.length || voicing || !!st.untimed}
          title={
            voicing
              ? "Wait for the voiceover to finish: the video would still have the old narration"
              : !shots.length
                ? "Build the video first: there are no scenes to export yet"
                : st.untimed
                  ? untimedRef.current
                  : void 0
          }
        >
          <Download size={15} strokeWidth={1.7} />
          Export
        </button>
      </div>
      <aside className="ed-left" aria-label="Shots and pipeline">
        {st.characterLab ? (
          <>
            <div className="sec-title">Character lab</div>
            <p className="small lab-note">
              {"These shots only show the character "}
              <b>{st.character?.name ?? ""}</b>
              {
                " in every pose, close up, walking and at phone size. Ask Claude in the chat for changes; each finished change is checked and saved to your characters."
              }
            </p>
            <button
              className="btn small"
              style={{ marginLeft: 6 }}
              onClick={() => {
                try {
                  sessionStorage.setItem("cz-styles-tab", "flat:characters");
                } catch {}
                go("presets");
              }}
            >
              Your characters
            </button>
          </>
        ) : st.styleLab ? (
          <>
            <div className="sec-title">Style lab</div>
            <p className="small lab-note">
              {"This sample video only showed the style "}
              <b>{st.styleLab.name}</b>
              {
                " while it was made here. Making whole styles moved to the Style Kit: build them in Claude Code, then import them in Styles > Custom. The styles this lab saved keep working in your videos."
              }
            </p>
            <button
              className="btn small"
              style={{ marginLeft: 6 }}
              onClick={() => {
                try {
                  sessionStorage.setItem("cz-styles-tab", "custom:");
                } catch {}
                go("presets");
              }}
            >
              {"Styles > Custom"}
            </button>
          </>
        ) : (
          <>
            <div className="sec-title">Pipeline</div>
            {st.steps.map((s, i) => {
              const Icon = STEP_ICON[s.id] ?? ChevronRight;
              const done = (id) => !!st.steps.find((x) => x.id === id)?.done;
              const needs = {
                script: null,
                voice: null,
                clean: "voice",
                timeline: "clean",
                storyboard: "timeline",
                scenes: "timeline",
                sound: st.voiceNew ? "timeline" : "scenes",
                export: st.untimed ? "timeline" : "scenes",
              };
              const making = voicing && s.id === "voice",
                stopped = s.id === stoppedAt;
              const claudeBusy = busy && ["voice", "clean", "timeline"].includes(s.id) && !making && !stopped;
              const can =
                (!needs[s.id] || done(needs[s.id])) &&
                !(voicing && ["clean", "timeline", "scenes", "sound", "export"].includes(s.id)) &&
                !claudeBusy &&
                (s.id !== "export" || (!!st.end && shots.length > 0));
              const setup = s.id === "scenes" && !can && !s.done;
              const action =
                s.id === "script"
                  ? "Write"
                  : s.id === "voice"
                    ? "Add"
                    : s.id === "clean"
                      ? "Run"
                      : s.id === "timeline"
                        ? "Run"
                        : s.id === "storyboard"
                          ? null
                          : s.id === "scenes"
                            ? "Build"
                            : s.id === "sound"
                              ? "Mix"
                              : "Export";
              return (
                <div
                  key={s.id}
                  className={`step ${s.done && !stopped ? "done" : ""} ${stopped ? `stopped ${s.id === "voice" && !voiceJob.interrupted ? "" : "warn"}` : ""}`}
                  title={
                    stopped
                      ? voiceJob.error
                      : s.id === "storyboard"
                        ? "Written by Claude during the build"
                        : voicing && !can
                          ? "Wait for the voiceover to finish"
                          : claudeBusy
                            ? "Claude is working on this project: wait until it has finished"
                            : !can
                              ? `Needs: ${st.steps.find((x) => x.id === needs[s.id])?.label}`
                              : void 0
                  }
                >
                  <span className="c">
                    {making ? (
                      <Spinner size={10} />
                    ) : stopped ? (
                      <TriangleAlert size={11} />
                    ) : s.done ? (
                      <Check size={11} strokeWidth={2.2} />
                    ) : (
                      <Icon size={11} />
                    )}
                  </span>
                  {making ? (
                    <span className="ellipsis">
                      {voiceJob.phase === "clean"
                        ? "Cleaning the audio"
                        : voiceJob.phase === "timeline"
                          ? "Timing the words"
                          : "Making the voiceover"}
                      …
                    </span>
                  ) : stopped && s.id === "voice" ? (
                    <span className="ellipsis">Voiceover stopped</span>
                  ) : (
                    s.label
                  )}
                  {s.stale && (
                    <span
                      className="dim"
                      title={
                        s.id === "export"
                          ? "The narration or its sound changed after this export: export again for a video with it"
                          : "Scenes changed after the mix: shot boundaries and accents may have moved"
                      }
                      style={{ fontSize: 11 }}
                    >
                      outdated
                    </span>
                  )}
                  {action && (
                    <button
                      className="btn tiny"
                      disabled={!can && !setup}
                      title={setup ? "Set up the build now: your direction and extras are kept until it can start" : void 0}
                      onClick={() => (stopped ? setVoiceDlg({}) : runStep(s.id))}
                    >
                      {making || stopped
                        ? "View"
                        : setup
                          ? "Set up"
                          : !s.done || s.id === "export"
                            ? action
                            : s.id === "voice"
                              ? "Replace"
                              : s.id === "script"
                                ? "Open"
                                : "Redo"}
                    </button>
                  )}
                </div>
              );
            })}
            {st.steps.find((s) => s.id === "clean")?.done && (
              <button
                className="btn small sound-fx-btn trim-btn"
                onClick={() => setTrimDlg(true)}
                title="Cut the pauses in the voiceover so the video stays snappy: waveform, the cuts in red, how much to remove"
              >
                Trim silences
              </button>
            )}
            {st.steps.some((s) => s.id === "sound") && (
              <button
                className="btn small sound-fx-btn"
                onClick={() => setSoundDlg({ at: clock.t })}
                title="Audio layers you place yourself (music, effects, ambience), your sound effects library and the automatic sound design: mixed again in seconds, no Claude"
              >
                {"Music & effects"}
              </button>
            )}
            {shots.length > 0 &&
              (() => {
                const picked = [...new Set(selection.map((x) => x.shot?.index).filter((i) => typeof i === "number"))].sort((a, b) => a - b);
                const label =
                  picked.length === 1
                    ? `Ultraedit shot ${picked[0] + 1}`
                    : picked.length
                      ? `Ultraedit ${picked.length} shots`
                      : "Ultraedit";
                return (
                  <button
                    className={`btn small ultra-btn ${picked.length && !ultraLocked ? "glow" : ""}`}
                    onClick={() =>
                      ultraLocked
                        ? toast(premiumMsg("Ultraedit"), "info")
                        : setUltraDlg(picked.length ? picked : curShot ? [curShot.index] : [])
                    }
                    title={
                      ultraLocked
                        ? premiumMsg("Ultraedit")
                        : picked.length
                          ? "Opus 5.5 upgrades the selected shots one by one: more detail and depth, visual inconsistencies fixed, before and after for each"
                          : "Select shots in the list or on the timeline (Shift+click for more), or upgrade the shot you are on"
                    }
                  >
                    <Sparkles size={14} />
                    {label}
                    {ultraLocked && <span className="premium-pill">Premium</span>}
                  </button>
                );
              })()}
          </>
        )}
        <div className="sec-title" style={{ marginTop: 18 }}>
          {"Shots "}
          <span className="dim">{shots.length || ""}</span>
        </div>
        {!shots.length && (
          <p className="small" style={{ padding: "0 6px" }}>
            {st.scenes.length ? "Loading…" : "No scenes yet. Build the video with Claude (Pipeline, Scenes built)."}
          </p>
        )}
        {shots.map((s) => {
          const on2 = curShot?.index === s.index,
            sel = selection.some((x) => x.shot?.index === s.index);
          return (
            <button
              key={s.index}
              className={`shot-row ${on2 ? "on" : ""} ${sel ? "sel" : ""} ${ultraLive.has(s.index) ? "ultra-live" : ""}`}
              onClick={(e) => {
                clock.setPlaying(false);
                clock.set(settle(s));
                onTimelineSelect(
                  { kind: "shot", time: s.t0, shot: { index: s.index, name: s.name, file: s.file, line: s.line, t0: s.t0, t1: s.t1 } },
                  e.shiftKey || e.ctrlKey || e.metaKey,
                );
              }}
            >
              <span className="n">{s.index + 1}</span>
              {thumbs[s.index] ? (
                <img className="shot-thumb" src={thumbs[s.index]} alt="" loading="lazy" />
              ) : (
                <span className="shot-thumb" />
              )}
              <span className="grow" title={s.name}>
                <span className="nm">{s.name.replace(/^\d+[a-z]?:\s*/i, "")}</span>
                <span className="tm">
                  {fmtTime(s.t0)}
                  {" · "}
                  {(s.t1 - s.t0).toFixed(1)}
                  {"s · "}
                  {s.file?.replace("scenes/", "")}
                </span>
              </span>
            </button>
          );
        })}
        {errorsNow.length > 0 && (
          <>
            <div className="sec-title" style={{ marginTop: 18, color: "var(--err)" }}>
              Preview warnings
            </div>
            <div className="log-box" style={{ maxHeight: 160 }}>
              {errorsNow.slice(-12).map((l, i) => (
                <div key={i}>{l.text}</div>
              ))}
            </div>
            <div className="row" style={{ margin: "6px 6px" }}>
              <button className="text-btn" onClick={() => setLogs([])}>
                Clear
              </button>
              <span className="grow" />
              <button
                className="btn tiny"
                onClick={() =>
                  fixWithClaude(
                    errorsNow
                      .slice(-12)
                      .map((l) => l.text)
                      .join("\n"),
                  )
                }
              >
                <Sparkles size={12} />
                Fix with Claude
              </button>
            </div>
          </>
        )}
      </aside>
      <section className="ed-center" aria-label="Preview">
        <Preview
          ref={preview}
          aspect={st.aspect || 16 / 9}
          host={host}
          reloadKey={reloadKey}
          clock={clock}
          selection={selection}
          onPick={onPick}
          onReady={onReady}
          onLog={onLog}
          onBootError={(msg) => {
            setBootError(msg);
            if (msg) setReloading(false);
          }}
          bootError={bootError}
          label={selLabel}
          onFix={fixWithClaude}
          quality={pq}
          onDrawn={setDrawn}
          stats={gfxStats ? { gpu } : null}
          aside={
            gfx ? (
              <GraphicsPanel
                key={projectId}
                projectId={projectId}
                preview={preview}
                saved={st.settings?.graphics}
                styleName={styleName}
                stats={gfxStats}
                onStats={showStats}
                onClose={() => setGfx(false)}
                engineOld={!st.engineCurrent}
                onUpdateEngine={upgradeEngine}
              />
            ) : null
          }
        />
        <audio
          ref={audio}
          src={st.previewAudio ? `${base}${st.previewAudio}?v=${st.previewAudioAt ?? 0}` : void 0}
          preload="auto"
          onLoadedMetadata={(e) => setAudioDur(e.currentTarget.duration || 0)}
          onEmptied={() => setAudioDur(0)}
          onError={() => setAudioDur(0)}
        />
        {st.untimed &&
          !voicing &&
          (() => {
            const built = st.steps.find((x) => x.id === "scenes")?.done;
            return (
              <div className="warn-bar vo-newbar" role="status">
                <AudioLines size={14} />
                <span className="grow">
                  {st.voiceNew
                    ? built
                      ? "This is the new voiceover, not cleaned and timed yet: the scenes and an export still follow the previous one."
                      : "Your voiceover is not cleaned and timed yet: Claude builds the scenes to its timing."
                    : built
                      ? "The words of this voiceover are not timed yet: the scenes still follow the previous timing."
                      : "The words of this voiceover are not timed yet: Claude builds the scenes to their timing."}
                </span>
                <button
                  className="btn tiny"
                  onClick={() => (st.voiceNew ? cleanAndTime() : runStep("timeline"))}
                  disabled={busy || !!pipe?.busy}
                  title={
                    busy
                      ? "Claude is working on this project: wait until it has finished"
                      : st.voiceNew
                        ? "Clean audio, then Time words"
                        : void 0
                  }
                >
                  {st.voiceNew ? <WandSparkles size={12} /> : <Clock3 size={12} />}
                  {st.voiceNew ? "Clean and time" : "Time words"}
                </button>
              </div>
            );
          })()}
        {st.scriptLanguage &&
          !otherHidden &&
          !st.styleLab &&
          !st.characterLab &&
          (() => {
            const O = lang(st.scriptLanguage),
              V = lang(st.language),
              drawn2 = styleDraws(st.styleBase ?? st.style, O.code);
            return (
              <div className="warn-bar vo-newbar ed-otherlang" role="status">
                <TriangleAlert size={14} />
                <span className="grow">
                  {"The script is in "}
                  {O.name}
                  {", but this video is "}
                  {V.name}
                  {": the voice, the timing and the words on screen would follow "}
                  {V.name}.
                </span>
                {drawn2 && (
                  <button
                    className="btn tiny"
                    onClick={() => setLanguage(O.code)}
                    disabled={!!langLock}
                    title={langLock ?? `The voice, the timing and Claude follow ${O.name}`}
                  >
                    {"Make it "}
                    {aLang(O.code)}
                    {" video"}
                  </button>
                )}
                <button
                  className="btn tiny"
                  onClick={() => setScriptDlg(true)}
                  disabled={busy}
                  title={busy ? "Claude is working on this project: wait until it has finished" : `Claude writes the script in ${V.name}`}
                >
                  {"Rewrite in "}
                  {V.name}
                </button>
                <button
                  className="icon-btn sm"
                  aria-label="Hide"
                  title="Hide this until the script or the video's language changes"
                  onClick={hideOther}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })()}
        {errorsNow.length > 0 && (
          <div className="warn-bar" role="status">
            <TriangleAlert size={14} />
            <span
              className="grow"
              title={errorsNow
                .slice(-6)
                .map((l) => l.text)
                .join("\n")}
            >
              {errorsNow.length === 1 ? "Preview warning: " : `${errorsNow.length} preview warnings. Latest: `}
              {errorsNow[errorsNow.length - 1].text}
            </span>
            <button
              className="btn tiny"
              onClick={() =>
                fixWithClaude(
                  errorsNow
                    .slice(-12)
                    .map((l) => l.text)
                    .join("\n"),
                )
              }
            >
              <Sparkles size={12} />
              Fix with Claude
            </button>
            <button className="icon-btn sm" aria-label="Dismiss warnings" title="Dismiss" onClick={() => setLogs([])}>
              <X size={13} />
            </button>
          </div>
        )}
        <div className="transport">
          <button
            className="icon-btn"
            aria-label="Previous shot"
            title="Previous shot ( [ )"
            onClick={() => {
              const i = shots.findIndex((s) => clock.t >= s.t0 && clock.t < s.t1);
              const n = shots[Math.max(0, i - (clock.t - (shots[i]?.t0 ?? 0) > 0.5 ? 0 : 1))];
              if (n) clock.set(settle(n));
            }}
          >
            <SkipBack size={17} strokeWidth={1.7} />
          </button>
          <button
            className="icon-btn"
            aria-label={playing ? "Pause" : "Play"}
            title="Play / pause (Space)"
            onClick={() => clock.setPlaying(!playing)}
          >
            {playing ? <Pause size={19} strokeWidth={1.7} /> : <Play size={19} strokeWidth={1.7} />}
          </button>
          <button
            className="icon-btn"
            aria-label="Next shot"
            title="Next shot ( ] )"
            onClick={() => {
              const n = shots.find((s) => s.t0 > clock.t + 0.02);
              if (n) clock.set(settle(n));
            }}
          >
            <SkipForward size={17} strokeWidth={1.7} />
          </button>
          <span className="timecode">
            <span ref={timecode} className="tc-now" />{" "}
            <span>
              {"/ "}
              {fmtTime(end, 1)}
            </span>
          </span>
          {(() => {
            const s = curShot ? `Shot ${curShot.index + 1} · ${curShot.name.replace(/^\d+[a-z]?:\s*/i, "")}` : "";
            return (
              <span className="small ellipsis grow" title={s || void 0}>
                {s}
              </span>
            );
          })()}
          <button className="icon-btn sm" title="Save this frame as a 1080p PNG in out/" aria-label="Save frame" onClick={saveFrame}>
            <Camera size={15} strokeWidth={1.7} />
          </button>
          <button
            className={`icon-btn sm ${muted ? "active" : ""}`}
            title="Mute (M)"
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX size={15} strokeWidth={1.7} /> : <Volume2 size={15} strokeWidth={1.7} />}
          </button>
          <button
            className={`icon-btn sm ${loop ? "active" : ""}`}
            disabled={!range}
            aria-pressed={loop}
            title={range ? `Loop ${fmtTime(range[0])}–${fmtTime(range[1])}` : "Select a shot, phrase or range to loop it"}
            aria-label="Loop selection"
            onClick={() => setLoop(!loop)}
          >
            <Repeat size={15} strokeWidth={1.7} />
          </button>
          {(() => {
            const name = (k) => (k >= 1 ? "Full" : k >= 0.5 ? "Half" : "Quarter");
            const text =
              pq === "auto"
                ? drawn && drawn.scalable && drawn.asked < 1
                  ? `Auto · ${name(drawn.asked)}`
                  : "Auto"
                : name(pq === "half" ? 0.5 : pq === "quarter" ? 0.25 : 1);
            const tip = `Preview quality: how big the live preview is drawn. Lower plays smoother on a slow computer; exports, saved frames and Claude's frames always stay full size.${drawn && !drawn.scalable ? ` This project's engine always draws the preview at full size${pq !== "full" ? " (Update engine, when the Pipeline offers it, adds the smaller sizes)" : ""}.` : drawn && drawn.scale < 1 ? ` Drawn at ${Math.round(drawn.scale * 100)}% now.` : ""}`;
            return (
              <span className="pq-wrap" title={tip} data-scale={drawn?.scale ?? ""}>
                <Picker
                  id="ed-pq"
                  className="lg-compact pq-pick"
                  ariaLabel="Preview quality"
                  value={pq}
                  typeAhead={false}
                  menuWidth={330}
                  options={PQ_OPTIONS}
                  onChange={(v) => {
                    const q = v;
                    setPq(q);
                    setPreviewQuality(q)?.catch(() => {});
                  }}
                  trigger={() => (
                    <>
                      <Gauge size={14} strokeWidth={1.7} />
                      <span className="pk-val">{text}</span>
                    </>
                  )}
                />
              </span>
            );
          })()}
          <div className="seg-ctl" role="radiogroup" aria-label="Playback speed">
            {[0.5, 1, 1.5, 2].map((r) => (
              <button key={r} role="radio" aria-checked={rate === r} className={rate === r ? "on" : ""} onClick={() => setRate(r)}>
                {r}×
              </button>
            ))}
          </div>
        </div>
        <Timeline
          clock={clock}
          end={end || 1}
          shots={shots}
          cues={cues}
          phrases={st.untimed ? [] : tl.phrases}
          wave={wave}
          events={tl.events}
          beds={tl.beds}
          selection={selection}
          onSelect={onTimelineSelect}
          onScrub={scrubAudio}
          marks={marks}
          glow={ultraLive}
          layers={layersV?.layers}
          layerWords={layersV?.words}
          onAddLayer={(t) => setSoundDlg({ tab: "layers", at: t })}
          onLayerMove={(id, t) => {
            const v = layersV;
            if (!v || !projectId) return;
            const next = JSON.parse(JSON.stringify(v.layers)),
              c = next.clips.find((x) => x.id === id);
            if (!c) return;
            let wi = -1,
              bd = 0.12;
            v.words.forEach((w, i) => {
              const d = Math.abs(w.s - t);
              if (d < bd) {
                bd = d;
                wi = i;
              }
            });
            c.start = t;
            c.anchor = wi >= 0 ? { word: wi, text: v.words[wi].w, offset: +(t - v.words[wi].s).toFixed(3) } : null;
            commitLayers(projectId, v.layers, next)
              .then((r) => {
                if (r.report) loadStatus();
              })
              .catch((e) => toast(e.message, "bad"));
          }}
        />
      </section>
      <ClaudePanel
        onSeek={chatSeek}
        getTime={chatTime}
        projectId={projectId}
        selection={selection}
        setSelection={setSel}
        label={selLabel}
        snapshot={snapshot}
        onEditDone={onEditDone}
        buildRequest={buildReq}
        ultraRequest={ultraReq}
        scriptRequest={scriptReq}
        fixRequest={fixReq}
        audioBusy={
          voicing
            ? "A voiceover is being made for this project."
            : pipe?.busy && (pipe.step === "clean" || pipe.step === "timeline")
              ? `${pipe.step === "clean" ? "The audio is being cleaned" : "The words are being timed"}.`
              : null
        }
      />
      {look && (
        <LookPanel
          projectId={projectId}
          status={st}
          t={clock.t}
          onClose={() => setLook(false)}
          onApplied={(s) => {
            setSt(s);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {notes && <NotesPanel projectId={projectId} dir={st.project.path} onClose={() => setNotes(false)} />}
      {keys && <KeysPanel onClose={() => setKeys(false)} />}
      {trimDlg && (
        <Modal
          title="Trim silences"
          onClose={() => {
            setTrimDlg(false);
            loadStatus().then((s) => loadTimeline(s));
          }}
          className="pjs-modal trim-modal"
        >
          <div className="modal-body">
            <TrimSilences
              projectId={projectId}
              onApplied={() => {
                loadStatus().then((s) => loadTimeline(s));
                setReloadKey((k) => k + 1);
              }}
            />
          </div>
        </Modal>
      )}
      {soundDlg && (
        <SoundDialog
          projectId={projectId}
          tab={soundDlg.tab}
          at={soundDlg.at}
          snaps={[...shots.map((s) => s.t0), ...cues.map((c) => c.t)]}
          onClose={() => {
            setSoundDlg(false);
            loadStatus().then((s) => loadTimeline(s));
          }}
          onMixed={() => loadStatus().then((s) => loadTimeline(s))}
        />
      )}
      {pjSettings && (
        <ProjectSettingsPanel
          projectId={projectId}
          status={st}
          styleName={styleName}
          onClose={() => setPjSettings(false)}
          onSettings={async (s) => {
            setSt(await api.applySettings(projectId, s));
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {exp && (
        <ExportPanel
          projectId={projectId}
          status={st}
          range={range}
          shots={shots}
          initialTab={exp === "video" ? "video" : void 0}
          onClose={() => {
            setExp(false);
            loadStatus();
          }}
        />
      )}
      {coach && shots.length > 0 && <Coach onDone={endCoach} />}
      {scriptDlg && st && (
        <ScriptPanel
          projectId={projectId}
          status={st}
          onClose={() => setScriptDlg(false)}
          onStart={(notes2, language) => {
            setScriptDlg(false);
            loadStatus();
            setScriptReq({ n: Date.now(), notes: notes2, language });
          }}
        />
      )}
      {scriptView && (
        <ScriptView
          projectId={projectId}
          dir={st.project.path}
          language={st.language}
          reading={voicing && voiceJob?.provider !== "file" && voiceJob?.phase === "generate"}
          onClose={() => setScriptView(false)}
          onSaved={loadStatus}
          onRewrite={() => {
            setScriptView(false);
            setScriptDlg(true);
          }}
          base={st.styleBase ?? st.style}
          styleName={styleName}
          onLanguage={langLock ? void 0 : setLanguage}
          onVoiceover={() => {
            setScriptView(false);
            loadStatus();
            setVoiceDlg({ tab: "tts" });
          }}
        />
      )}
      {voiceDlg && (
        <VoiceoverPanel
          key={st.language || "en"}
          projectId={projectId}
          status={st}
          base={base}
          tab={voiceDlg.tab}
          busy={busy}
          onClose={() => {
            setVoiceDlg(null);
            loadStatus().then((s) => loadTimeline(s));
          }}
          onWriteScript={() => {
            setVoiceDlg(null);
            setScriptDlg(true);
          }}
          onLanguage={langLock ? void 0 : setLanguage}
        />
      )}
      {buildDlg && (
        <BuildPanel
          projectId={projectId}
          base={st.styleBase ?? st.style}
          styleName={styleName}
          rebuild={st.steps.find((s) => s.id === "scenes")?.done ?? false}
          onClose={() => setBuildDlg(false)}
          notReady={
            !st.steps.find((s) => s.id === "timeline")?.done
              ? "The build starts once the script is voiced and its words are timed."
              : voicing
                ? "A voiceover is being made: the build starts when it is finished and timed."
                : null
          }
          settings={st.settings}
          onSettings={async (s) => {
            setSt(await api.applySettings(projectId, s));
            setReloadKey((k) => k + 1);
          }}
          onStart={(notes2, extras) => {
            setBuildDlg(false);
            setBuildReq({ n: Date.now(), notes: notes2, extras });
          }}
        />
      )}
      {ultraDlg && (
        <UltraPanel
          projectId={projectId}
          shots={shots}
          thumbs={thumbs}
          initial={ultraDlg}
          plusOk={(st.styleBase ?? st.style) === "recon"}
          onClose={() => setUltraDlg(null)}
          onStart={(notes2, picked, plus, opts) => {
            setUltraDlg(null);
            setUltraLive(new Set(picked));
            setUltraReq({ n: Date.now(), notes: notes2, shots: picked, plus, ...(opts ?? {}) });
          }}
        />
      )}
      {find && (
        <FindPanel
          phrases={tl.phrases}
          onPick={(p) => {
            clock.setPlaying(false);
            clock.set(p.s + 0.01);
            setSel([{ kind: "phrase", range: [p.s, p.e], element: { text: p.text } }]);
            setFind(false);
          }}
          onClose={() => setFind(false)}
        />
      )}
      {goto && (
        <GotoPanel
          end={st.end}
          onGo={(v) => {
            clock.setPlaying(false);
            clock.set(v);
            setGoto(false);
          }}
          onClose={() => setGoto(false)}
        />
      )}
      {pipe && (
        <Modal title={`Pipeline · ${pipe.step}`} onClose={() => !pipe.busy && setPipe(null)}>
          <div className="modal-body">
            <div className="row" style={{ marginBottom: 12 }}>
              {pipe.busy ? (
                <Busy text="Running…" since={pipe.since} />
              ) : pipe.error ? (
                <span style={{ color: "var(--err)" }}>{pipe.error}</span>
              ) : (
                <>
                  <Check size={16} style={{ color: "var(--mint)" }} />
                  Finished
                </>
              )}
            </div>
            <div className="log-box" style={{ maxHeight: 320 }}>
              {pipe.lines.join("\n") || "…"}
            </div>
            <div className="modal-actions">
              {pipe.busy ? (
                <button className="btn" onClick={() => projectId && api.cancelStep(projectId)}>
                  Cancel
                </button>
              ) : (
                <button className="btn" onClick={() => setPipe(null)}>
                  Close
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
