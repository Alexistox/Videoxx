import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  CpuIcon,
  FilmIcon,
  FolderOpenIcon,
  ImagePlusIcon,
  KeyboardIcon,
  Maximize2Icon,
  MoveIcon,
  PauseIcon,
  PlayIcon,
  Redo2Icon,
  ScissorsIcon,
  Undo2Icon,
  Volume2Icon,
  VolumeXIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { api, on } from "../lib/api";
import { fmtTime } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { ALT, MOD, isMac } from "../help/keys";
import { Modal, Spinner } from "../components/ui";
import { EditorChannel } from "../channels/ChannelEditor";
import { Clock, useClockTime, usePlaying } from "../player/clock";
import { emptyEdit, layoutTimeline, removeClip, rippleAfter, rippleBefore, segIndexAt, split, trimClip } from "./timelineEdit";
import { PersonalEngine, setPlayErrorHandler } from "./PersonalEngine";
import { PTimeline } from "./PTimeline";
import { FOOTAGE_EXT, FootageBin } from "./FootageBin";
import { LayoutPanel, loadBackground } from "./LayoutPanel";
import { RenderPanel } from "./RenderPanel";
import { PClaudePanel } from "./PClaudePanel";

const KEYS = () => [
  ["Space", "Play / pause"],
  ["S", "Split the clip at the playhead"],
  ["Q", "Delete from the clip start to the playhead (ripple)"],
  ["W", "Delete from the playhead to the clip end (ripple)"],
  [isMac ? "Delete" : "Delete / Backspace", "Delete the selected clip (ripple)"],
  ["← / →", "One frame back / forward"],
  ["Shift + ← / →", "One second back / forward"],
  ["↑ / ↓", "Previous / next cut"],
  [isMac ? "fn ← / fn →" : "Home / End", "Start / end"],
  ["J / K / L", "Back 2 s / pause / play (L again: 2×)"],
  [`${MOD} + Z`, "Undo"],
  [`${MOD} + Shift + Z`, "Redo"],
  ["+ / -", "Zoom the timeline"],
  [`${ALT} + scroll`, "Zoom the timeline around the mouse"],
  ["Middle-drag", "Move the timeline"],
  ["0", "Fit the timeline"],
  ["M", "Mute"],
  ["?", "This sheet"],
];
export function PersonalEditor() {
  const { projectId, toast, refreshProjects, go, setThumbFor } = useApp();
  const clock = useMemo(() => new Clock(), [projectId]);
  const t = useClockTime(clock, 20),
    playing = usePlaying(clock);
  const [plan, setPlan] = useState(null);
  const [thumbUrl, setThumbUrl] = useState(null);
  const [media, setMedia] = useState([]);
  const [edit, setEditState] = useState(emptyEdit());
  const [layout, setLayout] = useState(null);
  const [bg, setBg] = useState(null);
  const [waves, setWaves] = useState({});
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("footage");
  const [flowHost, setFlowHost] = useState(null);
  const [rtab, setRtab] = useState("claude");
  const [keysOpen, setKeysOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [title, setTitle] = useState("");
  const [saved, setSaved] = useState(true);
  const [encoder, setEncoder] = useState(null);
  const [dropping, setDropping] = useState(false);
  const [render, setRender] = useState(false);
  const canvas = useRef(null),
    stage = useRef(null),
    engine = useRef(null),
    tl = useRef(null);
  const undo = useRef([]),
    redo = useRef([]);
  const editRef = useRef(edit);
  editRef.current = edit;
  const mediaInfo = useMemo(
    () =>
      media.map((m) => ({ id: m.id, role: m.role, duration: m.duration, fps: m.fps, audio: m.audio, width: m.width, height: m.height })),
    [media],
  );
  const { segs, duration } = useMemo(() => layoutTimeline(edit, mediaInfo), [edit, mediaInfo]);
  const fps = media.find((m) => m.role === "screen")?.fps || 30;
  const names = useMemo(
    () =>
      Object.fromEntries(
        media.map((m) => [
          m.id,
          (m.role === "screen" && media.filter((x) => x.role === "screen").length < 2
            ? "Screen recording"
            : m.name.replace(/\.[^.]+$/, "")) +
            (m.proxyState === "pending" || m.proxyState === "working"
              ? ` (preview copy ${m.proxyState === "working" ? `${m.progress ?? 0}%` : "waiting"})`
              : ""),
        ]),
      ),
    [media],
  );
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    (async () => {
      try {
        const o = await api.personalOpen(projectId);
        if (!alive) return;
        setPlan(o.plan);
        setTitle(o.plan.title);
        setThumbUrl(o.thumbnailUrl);
        const [m, e, l] = await Promise.all([api.pMedia(projectId), api.pEdit(projectId), api.pLayout(projectId)]);
        if (!alive) return;
        setMedia(m);
        setEditState(e);
        setLayout(l);
        setBg(await loadBackground(l.background.image));
      } catch (err) {
        toast(err.message, "bad");
      }
    })();
    api
      .pEncoder()
      .then(setEncoder)
      .catch(() => {});
    setPlayErrorHandler((mediaId, why) => {
      api
        .pPlayFailed(projectId, mediaId, why)
        .then(setMedia)
        .catch(() => {});
    });
    const off = on("personal:media", (ev) => {
      if (ev.projectId !== projectId) return;
      setMedia((list) =>
        list.map((x) => (x.id === ev.media.id ? { ...x, ...ev.media, url: ev.media.proxyState === "ready" ? (x.url ?? null) : x.url } : x)),
      );
      if (ev.media.proxyState === "ready" || ev.media.proxyState === "direct") api.pMedia(projectId).then(setMedia);
    });
    const off2 = on("personal:changed", async (ev) => {
      if (ev.projectId !== projectId) return;
      if (ev.files.includes("media.json")) setMedia(await api.pMedia(projectId));
      if (ev.files.includes("edit.json") || ev.files.includes("media.json")) {
        const e = await api.pEdit(projectId);
        if (
          JSON.stringify(e.clips) !== JSON.stringify(editRef.current.clips) ||
          JSON.stringify(e.cams) !== JSON.stringify(editRef.current.cams)
        ) {
          if (Date.now() - lastSave.current > 1500) {
            undo.current.push(editRef.current.clips);
            setEditState(e);
          }
        }
      }
      if (ev.files.includes("layout.json") && Date.now() - lastLayoutSave.current > 1500) {
        const l = await api.pLayout(projectId);
        setLayout(l);
        loadBackground(l.background.image).then(setBg);
      }
    });
    return () => {
      alive = false;
      off();
      off2();
    };
  }, [projectId]);
  useEffect(() => {
    if (!canvas.current) return;
    const e = new PersonalEngine(canvas.current, clock);
    engine.current = e;
    window.__pengine = e;
    window.__pclock = clock;
    const ro = new ResizeObserver(() => {
      const r = stage.current.getBoundingClientRect(),
        d = Math.min(2, devicePixelRatio);
      canvas.current.width = Math.min(1920, Math.round(r.width * d));
      canvas.current.height = Math.min(1080, Math.round(r.height * d));
      e.redraw();
    });
    ro.observe(stage.current);
    return () => {
      ro.disconnect();
      e.destroy();
      engine.current = null;
    };
  }, [clock]);
  const engineMedia = useMemo(() => media.map((m) => ({ ...mediaInfo.find((x) => x.id === m.id), url: m.url })), [media, mediaInfo]);
  useEffect(() => {
    engine.current?.setData(edit, engineMedia, layout, bg);
  }, [edit, engineMedia]);
  useEffect(() => {
    engine.current?.setLayout(layout, bg);
  }, [layout, bg]);
  useEffect(() => {
    engine.current?.setVolume(1, muted);
  }, [muted]);
  useEffect(() => {
    if (!projectId) return;
    for (const m of media)
      if (
        m.audio &&
        (m.role === "screen" || m.role === "intro") &&
        (m.proxyState === "ready" || m.proxyState === "direct") &&
        !(m.id in waves)
      ) {
        setWaves((w) => ({ ...w, [m.id]: null }));
        api
          .pWaveform(projectId, m.id)
          .then((wv) => setWaves((w) => ({ ...w, [m.id]: wv })))
          .catch(() => {});
      }
  }, [media, projectId]);
  const saveTimer = useRef(0),
    lastSave = useRef(0),
    lastLayoutSave = useRef(0);
  const persist = useCallback(
    (e) => {
      setSaved(false);
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        if (!projectId) return;
        lastSave.current = Date.now();
        api
          .pSaveEdit(projectId, e)
          .then(() => {
            lastSave.current = Date.now();
            setSaved(true);
          })
          .catch((err) => toast(err.message, "bad"));
      }, 350);
    },
    [projectId],
  );
  const commit = useCallback(
    (clips, newT, record = true) => {
      const cur = editRef.current;
      if (record) {
        undo.current.push(cur.clips);
        if (undo.current.length > 200) undo.current.shift();
        redo.current = [];
      }
      const next = { ...cur, clips, signedOff: null, source: "manual" };
      setEditState(next);
      persist(next);
      if (newT !== void 0) {
        clock.setPlaying(false);
        clock.set(newT);
      }
    },
    [persist, clock],
  );
  const doUndo = () => {
    const c = undo.current.pop();
    if (!c) return;
    redo.current.push(editRef.current.clips);
    commit(c, void 0, false);
  };
  const doRedo = () => {
    const c = redo.current.pop();
    if (!c) return;
    undo.current.push(editRef.current.clips);
    commit(c, void 0, false);
  };
  const cutS = () => {
    const r = split(editRef.current, mediaInfo, clock.t);
    if (r) {
      commit(r);
      setSelected(null);
    }
  };
  const cutQ = () => {
    const r = rippleBefore(editRef.current, mediaInfo, clock.t);
    if (r) {
      commit(r.clips, r.t);
      setSelected(null);
      tl.current?.reveal(r.t);
    }
  };
  const cutW = () => {
    const r = rippleAfter(editRef.current, mediaInfo, clock.t);
    if (r) {
      commit(r.clips, r.t);
      setSelected(null);
    }
  };
  const delSel = () => {
    if (selected === null || !segs[selected]) return;
    const start = segs[selected].start;
    commit(removeClip(editRef.current, selected), start);
    setSelected(null);
  };
  const trimLive = useRef(null);
  const onTrim = (i, side, value, done) => {
    const src = media.find((m) => m.id === editRef.current.clips[i]?.src);
    if (!src) return;
    if (!trimLive.current) trimLive.current = editRef.current.clips;
    const clips = trimClip({ ...editRef.current, clips: trimLive.current }, i, side, value, src.duration);
    if (done) {
      const before = trimLive.current;
      trimLive.current = null;
      undo.current.push(before);
      redo.current = [];
      commit(clips, void 0, false);
    } else setEditState((e) => ({ ...e, clips }));
  };
  useEffect(() => {
    const key = (e) => {
      const el = e.target;
      if (el?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[aria-modal="true"]')) return;
      const mod = e.ctrlKey || e.metaKey,
        k = e.key.toLowerCase(),
        step = 1 / fps;
      const go2 = (v) => {
        clock.setPlaying(false);
        clock.set(Math.max(0, Math.min(duration, v)));
        tl.current?.reveal(clock.t);
      };
      if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? doRedo() : doUndo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        doRedo();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        clock.setPlaying(!clock.playing);
      } else if (k === "s") {
        e.preventDefault();
        cutS();
      } else if (k === "q") {
        e.preventDefault();
        cutQ();
      } else if (k === "w") {
        e.preventDefault();
        cutW();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        delSel();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go2(clock.t - (e.shiftKey ? 1 : step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go2(clock.t + (e.shiftKey ? 1 : step));
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const i = segIndexAt(segs, clock.t);
        const s = segs[e.key === "ArrowUp" ? (clock.t - (segs[i]?.start ?? 0) > 0.05 ? i : i - 1) : i + 1];
        go2(s ? s.start : e.key === "ArrowUp" ? 0 : duration);
      } else if (e.key === "Home") {
        e.preventDefault();
        go2(0);
      } else if (e.key === "End") {
        e.preventDefault();
        go2(duration);
      } else if (k === "j") go2(clock.t - 2);
      else if (k === "k") clock.setPlaying(false);
      else if (k === "l") {
        if (clock.playing) engine.current?.setRate(engine.current.rate >= 2 ? 1 : 2);
        else {
          engine.current?.setRate(1);
          clock.setPlaying(true);
        }
      } else if (e.key === "+" || e.key === "=") tl.current?.zoom(1.5);
      else if (e.key === "-") tl.current?.zoom(1 / 1.5);
      else if (e.key === "0") tl.current?.fit();
      else if (k === "m") setMuted((m) => !m);
      else if (e.key === "?") setKeysOpen(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(
    () => () => {
      clock.setPlaying(false);
    },
    [clock],
  );
  const layoutTimer = useRef(0);
  const changeLayout = (l) => {
    const bgChanged = l.background.image !== layout?.background.image;
    setLayout(l);
    if (bgChanged) loadBackground(l.background.image).then(setBg);
    clearTimeout(layoutTimer.current);
    layoutTimer.current = window.setTimeout(() => {
      if (!projectId) return;
      lastLayoutSave.current = Date.now();
      api
        .pSaveLayout(projectId, l)
        .then(() => {
          lastLayoutSave.current = Date.now();
        })
        .catch((e) => toast(e.message, "bad"));
    }, 300);
  };
  const onDrop = async (e) => {
    e.preventDefault();
    setDropping(false);
    if (!projectId) return;
    const files = [...e.dataTransfer.files].map((f) => window.suite.pathForFile(f)).filter((f) => f && FOOTAGE_EXT.test(f));
    if (!files.length) {
      toast("Drop video or audio files (screen recording, facecam, intro).", "bad");
      return;
    }
    try {
      const m = await api.pAddMedia(projectId, files);
      setMedia(m);
      setTab("footage");
      const e2 = await api.pEdit(projectId);
      setEditState(e2);
      toast(`Added ${files.length} file${files.length > 1 ? "s" : ""}. Making smooth preview copies…`);
    } catch (err) {
      toast(err.message, "bad");
    }
  };
  const mediaChanged = async (m) => {
    setMedia(m);
    if (projectId) setEditState(await api.pEdit(projectId));
  };
  const saveTitle = async () => {
    if (!projectId || !plan || title.trim() === plan.title) return;
    try {
      setPlan(await api.personalSetPlan(projectId, { title }));
      refreshProjects();
    } catch (e) {
      toast(e.message, "bad");
      setTitle(plan.title);
    }
  };
  const pickThumb = async () => {
    if (!projectId) return;
    const f = await api.pickFile("Choose a thumbnail image", [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]);
    if (!f) return;
    try {
      setThumbUrl(await api.personalSetThumbnail(projectId, f));
      refreshProjects();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const savePlanField = async (k, v) => {
    if (!projectId || !plan || plan[k] === v) return;
    try {
      setPlan(await api.personalSetPlan(projectId, { [k]: v }));
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const claudeFinished = useCallback(
    async (kind, ok) => {
      if (!projectId || !ok) return;
      const [m, e] = await Promise.all([api.pMedia(projectId), api.pEdit(projectId)]);
      setMedia(m);
      if (JSON.stringify(e.clips) !== JSON.stringify(editRef.current.clips)) {
        undo.current.push(editRef.current.clips);
        setEditState(e);
      }
      if (kind === "cut" || kind === "intro") {
        clock.setPlaying(false);
        clock.set(0);
        tl.current?.fit();
      }
    },
    [projectId, clock],
  );
  const seg = segs[segIndexAt(segs, t)];
  const proxiesBusy = media.filter((m) => m.proxyState === "working" || m.proxyState === "pending");
  if (!projectId) return null;
  return (
    <div
      className={`editor personal-editor page-enter ${dropping ? "dropping" : ""}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false);
      }}
      onDrop={onDrop}
    >
      <div className="ed-top">
        <input
          className="ed-title"
          aria-label="Video title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
          size={Math.max(8, title.length)}
        />
        <span className="save-state">
          {saved ? (
            <>
              <CheckIcon size={12} />
              Saved
            </>
          ) : (
            <>
              <Spinner size={12} />
              Saving
            </>
          )}
        </span>
        <EditorChannel projectId={projectId} />
        <span className="grow" />
        {encoder && (
          <span className={`enc-badge ${encoder.gpu ? "gpu" : ""}`} title={`Preview copies and the final render use: ${encoder.name}`}>
            <CpuIcon size={12} />
            {encoder.gpu ? "GPU" : "CPU"}
          </span>
        )}
        <button className="icon-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setKeysOpen(true)}>
          <KeyboardIcon size={17} strokeWidth={1.7} />
        </button>
        <button
          className="icon-btn"
          title="Open the video's folder"
          aria-label="Open the video's folder"
          onClick={async () => {
            const o = await api.personalOpen(projectId);
            api.open(o.path);
          }}
        >
          <FolderOpenIcon size={17} strokeWidth={1.7} />
        </button>
        <button
          className="btn small primary"
          onClick={() => {
            clock.setPlaying(false);
            setRender(true);
          }}
          disabled={!segs.length || !layout}
          title={
            edit.signedOff
              ? `Signed off ${new Date(edit.signedOff).toLocaleString()}`
              : "Watch it through first, then sign off the final render"
          }
        >
          <FilmIcon size={15} strokeWidth={1.7} />
          {edit.signedOff ? "Render again" : "Sign off & render"}
        </button>
      </div>
      <aside className="ed-left" aria-label="Footage and layout">
        <div className="seg-ctl ptabs" role="tablist" aria-label="Left panel">
          <button role="tab" aria-selected={tab === "footage"} className={tab === "footage" ? "on" : ""} onClick={() => setTab("footage")}>
            Footage
          </button>
          <button role="tab" aria-selected={tab === "layout"} className={tab === "layout" ? "on" : ""} onClick={() => setTab("layout")}>
            Layout
          </button>
          <button
            role="tab"
            aria-selected={tab === "workflows"}
            className={tab === "workflows" ? "on" : ""}
            onClick={() => setTab("workflows")}
          >
            Workflows
          </button>
        </div>
        {tab === "footage" ? (
          <FootageBin projectId={projectId} media={media} setMedia={mediaChanged} />
        ) : tab === "workflows" ? (
          <div className="pflows-host" ref={setFlowHost} />
        ) : (
          layout && <LayoutPanel layout={layout} onChange={changeLayout} />
        )}
      </aside>
      <section className="ed-center" aria-label="Preview and timeline">
        <div className="stage-wrap">
          <div className="stage pstage" ref={stage}>
            <canvas ref={canvas} className="pcanvas" aria-label="Video preview" />
            {tab === "layout" && layout && <LayoutHandles layout={layout} onChange={changeLayout} />}
            {!media.length && (
              <div className="stage-msg">
                <ImagePlusIcon size={26} strokeWidth={1.4} />
                <b>Drop your footage anywhere here</b>
                <span>The screen recording, your facecam clips and the intro.</span>
              </div>
            )}
            {proxiesBusy.length > 0 && (
              <div className="stage-badge">
                <Spinner size={12} />
                {"Preparing preview "}
                {Math.round(proxiesBusy.reduce((a, m) => a + (m.progress ?? 0), 0) / proxiesBusy.length)}%
              </div>
            )}
          </div>
        </div>
        <div className="transport">
          <button
            className="icon-btn"
            aria-label={playing ? "Pause" : "Play"}
            title="Play / pause (Space)"
            onClick={() => clock.setPlaying(!playing)}
            disabled={!segs.length}
          >
            {playing ? <PauseIcon size={19} strokeWidth={1.7} /> : <PlayIcon size={19} strokeWidth={1.7} />}
          </button>
          <span className="timecode">
            {fmtTime(t, 2)}{" "}
            <span>
              {"/ "}
              {fmtTime(duration, 1)}
            </span>
          </span>
          <span className="small ellipsis grow">
            {seg
              ? `${seg.role === "intro" ? "Intro" : `Clip ${seg.index + 1} of ${segs.length}`} · source ${fmtTime(seg.clip.in, 1)}–${fmtTime(seg.clip.out, 1)}`
              : ""}
          </span>
          <button
            className={`icon-btn sm ${muted ? "active" : ""}`}
            title="Mute (M)"
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeXIcon size={15} strokeWidth={1.7} /> : <Volume2Icon size={15} strokeWidth={1.7} />}
          </button>
        </div>
        <div className="timeline ptimeline">
          <div className="tl-head">
            <span>Timeline</span>
            <span className="dim ellipsis">
              {"S split · Q / W delete to the playhead · drag an edge to trim · "}
              {ALT}+scroll to zoom · middle-drag to move
            </span>
            <span className="grow" />
            <button className="icon-btn sm" title={`Undo (${MOD}+Z)`} aria-label="Undo" onClick={doUndo}>
              <Undo2Icon size={14} strokeWidth={1.7} />
            </button>
            <button className="icon-btn sm" title={`Redo (${MOD}+Shift+Z)`} aria-label="Redo" onClick={doRedo}>
              <Redo2Icon size={14} strokeWidth={1.7} />
            </button>
            <button className="icon-btn sm" title="Split at the playhead (S)" aria-label="Split" onClick={cutS}>
              <ScissorsIcon size={14} strokeWidth={1.7} />
            </button>
            <button className="icon-btn sm" title="Zoom out (-)" aria-label="Zoom out" onClick={() => tl.current?.zoom(1 / 1.5)}>
              <ZoomOutIcon size={14} strokeWidth={1.7} />
            </button>
            <button className="icon-btn sm" title="Zoom in (+)" aria-label="Zoom in" onClick={() => tl.current?.zoom(1.5)}>
              <ZoomInIcon size={14} strokeWidth={1.7} />
            </button>
            <button className="icon-btn sm" title="Fit (0)" aria-label="Fit the timeline" onClick={() => tl.current?.fit()}>
              <Maximize2Icon size={14} strokeWidth={1.7} />
            </button>
          </div>
          <PTimeline
            ref={tl}
            clock={clock}
            segs={segs}
            duration={duration}
            edit={edit}
            media={mediaInfo}
            waves={waves}
            selected={selected}
            onSelect={setSelected}
            onTrim={onTrim}
            names={names}
          />
        </div>
      </section>
      <aside className="ed-right" aria-label="Claude and the video plan">
        <div className="seg-ctl ptabs rtabs" role="tablist" aria-label="Right panel">
          <button role="tab" aria-selected={rtab === "claude"} className={rtab === "claude" ? "on" : ""} onClick={() => setRtab("claude")}>
            Claude
          </button>
          <button role="tab" aria-selected={rtab === "plan"} className={rtab === "plan" ? "on" : ""} onClick={() => setRtab("plan")}>
            Plan
          </button>
        </div>
        <div className="pclaude-wrap" hidden={rtab !== "claude"}>
          <PClaudePanel
            projectId={projectId}
            media={media}
            onFinished={claudeFinished}
            flowHost={tab === "workflows" ? flowHost : null}
            onStarted={() => setRtab("claude")}
            onShowWorkflows={() => setTab("workflows")}
          />
        </div>
        {rtab === "plan" && (
          <div className="plan-panel">
            <div className="sec-title">Thumbnail</div>
            <button className="plan-thumb" onClick={pickThumb} title="Choose a thumbnail image (or make one in Thumbnails)">
              {thumbUrl ? (
                <img src={thumbUrl} alt="Thumbnail" />
              ) : (
                <span>
                  <ImagePlusIcon size={20} strokeWidth={1.5} />
                  Add a thumbnail
                </span>
              )}
            </button>
            <button
              className="text-btn plan-link"
              onClick={() => {
                setThumbFor(projectId);
                go("thumbnails");
              }}
            >
              Make one in Thumbnails →
            </button>
            <div className="sec-title" style={{ marginTop: 14 }}>
              Thumbnail idea
            </div>
            <textarea
              key={"i" + (plan ? 1 : 0)}
              className="input plan-field"
              rows={2}
              defaultValue={plan?.thumbnailIdea}
              onBlur={(e) => savePlanField("thumbnailIdea", e.target.value)}
              placeholder="What the thumbnail shows"
            />
            <div className="sec-title" style={{ marginTop: 14 }}>
              Core concept
            </div>
            <textarea
              key={"c" + (plan ? 1 : 0)}
              className="input plan-field"
              rows={4}
              defaultValue={plan?.concept}
              onBlur={(e) => savePlanField("concept", e.target.value)}
              placeholder="The one idea the video delivers"
            />
          </div>
        )}
      </aside>
      {render && layout && (
        <RenderPanel
          projectId={projectId}
          duration={duration}
          clips={segs.length}
          layout={layout}
          bg={bg}
          onClose={() => {
            setRender(false);
            api.pEdit(projectId).then((e) => setEditState((x) => ({ ...x, signedOff: e.signedOff })));
          }}
        />
      )}
      {keysOpen && (
        <Modal title="Keyboard shortcuts" onClose={() => setKeysOpen(false)}>
          <div className="modal-body">
            <div className="kv">
              {KEYS().map(([k, d]) => (
                <Fragment key={k}>
                  <span>
                    <kbd style={{ fontSize: 11, padding: "3px 6px" }}>{k}</kbd>
                  </span>
                  <span>{d}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function LayoutHandles({ layout, onChange }) {
  const ref = useRef(null);
  const start = (e, which, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const r = ref.current.getBoundingClientRect(),
      b0 = { ...layout[which] },
      x0 = e.clientX,
      y0 = e.clientY;
    const ratio = which === "cam" ? 1920 / 1080 : b0.h / b0.w;
    const moveFn = (ev) => {
      const dx = (ev.clientX - x0) / r.width,
        dy = (ev.clientY - y0) / r.height;
      const b = { ...b0 };
      if (mode === "move") {
        b.x = Math.min(1 - b.w * 0.2, Math.max(-b.w * 0.8, b0.x + dx));
        b.y = Math.min(1 - b.h * 0.2, Math.max(-b.h * 0.8, b0.y + dy));
      } else {
        const sx = mode[1] === "r" ? 1 : -1;
        let w = Math.max(0.06, b0.w + sx * dx);
        let h = w * ratio;
        if (which === "cam") h = (w * 1920) / 1080;
        b.w = w;
        b.h = h;
        if (mode[1] === "l") b.x = b0.x + b0.w - w;
        if (mode[0] === "t") b.y = b0.y + b0.h - h;
      }
      onChange({ ...layout, [which]: b });
    };
    const upFn = () => {
      window.removeEventListener("pointermove", moveFn);
      window.removeEventListener("pointerup", upFn);
    };
    window.addEventListener("pointermove", moveFn);
    window.addEventListener("pointerup", upFn);
  };
  const box = (which, label) => {
    const b = layout[which];
    if (which === "cam" && !layout.cam.visible) return null;
    return (
      <div
        className={`lh-box ${which}`}
        style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
        onPointerDown={(e) => start(e, which, "move")}
        aria-label={`Move the ${label}`}
      >
        <span className="lh-label">
          <MoveIcon size={11} />
          {label}
        </span>
        {["tl", "tr", "bl", "br"].map((c) => (
          <i key={c} className={`lh-h ${c}`} onPointerDown={(e) => start(e, which, c)} />
        ))}
      </div>
    );
  };
  return (
    <div className="lh" ref={ref}>
      {box("screen", "Screen recording")}
      {box("cam", "Facecam")}
    </div>
  );
}
