import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isOwnStyle, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import {
  ArrowLeft,
  Bot,
  Boxes,
  Check,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Crosshair,
  Film,
  FolderOpen,
  Gauge,
  GitCompareArrows,
  ImagePlus,
  Info,
  Layers,
  Lock,
  Pause,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Save,
  ScanEye,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  TriangleAlert,
  Undo2,
  User,
  WandSparkles,
  X,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Busy, Modal, Spinner } from "../components/ui";
import { Clock, useClockTime, usePlaying } from "../player/clock";
import { Preview } from "../player/Preview";
import { isStandard, premiumMsg, usePlan } from "../state/usePlan";
import { FOLDER_APP, useStyleKit } from "../looks/StyleKit";
import { RefButton, RefsPanel } from "../../../../editor/RefsPanel";
import { Md } from "../../../../editor/Md";
import { ClaudePanel } from "../../../../editor/ClaudePanel";
import { STYLES_MOVED, selLabel } from "../editor/selectionLabel";

const STAGE_NAME = {
  brief: "Brief",
  study: "Study",
  look: "Look",
  review: "Review",
  save: "Save",
  guide: "Style guide",
  kit: "Kit",
  sample: "Sample",
  publish: "Publish",
};
const STAGE_HINT = {
  brief: "What you want: the name, the style, the frames, a description and your references.",
  study: "Claude studies your references and writes down what makes them work (colours, motion, type) in numbers.",
  look: "Claude sets the look up on the style's own settings and writes its notes. You see it live on the sample video.",
  review:
    "The app checks every version; Claude looks at the frames at full size; you pin what looks wrong. Fix until nothing high is open.",
  save: "Save the look: it shows under its style in New project, the Look panel and Routines.",
  guide: "Claude writes the style guide and restyles the engine; the first three hero frames are your first look at the style.",
  kit: "Every element of the style, shown alone: approve or flag each one.",
  sample: "A short sample video built from the kit only, in every frame.",
  publish: "The app runs its checklist; when it is all green the style appears under Your styles everywhere.",
};
const IMAGE_COST = 0.013;
function aspectsOf(st) {
  const a = st?.aspects;
  if (a?.length) return a;
  const f = st?.controls
    .find((c) => c.path === "format")
    ?.options?.map((o) => (o.value === "vertical" ? "9:16" : o.value === "landscape" ? "16:9" : null))
    .filter(Boolean);
  return f?.length ? f : ["16:9"];
}
const ACT = (a) =>
  !a
    ? null
    : a
        .replace(/^version (\d+): checks$/, "Checking version $1…")
        .replace(/^version (\d+): video (.+)$/, "Rendering the $2 video of v$1…")
        .replace(/^version (\d+)$/, "Saving version $1…")
        .replace(/^back to v(\d+)$/, "Going back to v$1…")
        .replace(/^study: (\S+) (.+)$/, "Measuring $1: $2…")
        .replace(/^publish: (.+)$/, "Publishing: $1…")
        .replace(/^version (\d+): match$/, "Matching v$1 to the targets…")
        .replace(/^critic v(\d+)$/, "The critic is judging v$1…")
        .replace(/^target: reading the picture$/, "Reading the target picture…")
        .replace(/^target: making (\d+) of (\d+)$/, "Making target frame $1 of $2…");
const LOOP_PHASE = {
  version: "saving a version",
  overlays: "matching the targets",
  critic: "the critic is judging",
  fix: "Claude is fixing",
};
const MATCH_KINDS = [
  ["side", "Side by side", "Target left, render right"],
  ["blend", "Blend", "50/50: shapes in the wrong place show double"],
  ["edges", "Edges", "The target's edges in cyan over the render: where they miss, the framing or perspective differs"],
  ["crops", "Crops", "The same regions zoomed: the centre and where they differ most (target left, render right)"],
  ["colours", "Colours", "The mean colour of 12 regions, target vs render: grade and light errors in numbers"],
];
function RegionTable({ regions }) {
  if (!regions?.length)
    return <div className="muted small sd-cmp-none">No colour numbers for this version (made before they existed).</div>;
  return (
    <table className="sd-regions">
      <thead>
        <tr>
          <th>Region</th>
          <th>Target</th>
          <th>Render</th>
          <th title="Render minus target luminance (0-255): negative = the render is darker">Light</th>
          <th title="Colour distance 0-100">Off by</th>
        </tr>
      </thead>
      <tbody>
        {regions.map((r) => (
          <tr key={r.name} className={r.d >= 12 ? "bad" : r.d >= 6 ? "warn" : ""}>
            <td>{r.name}</td>
            <td>
              <i style={{ background: r.target }} />
              {r.target}
            </td>
            <td>
              <i style={{ background: r.render }} />
              {r.render}
            </td>
            <td>
              {r.dL > 0 ? "+" : ""}
              {r.dL}
            </td>
            <td>{r.d}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const fmtT = (t) => `${t.toFixed(1)} s`;
const flat = (o, pre = "") =>
  Object.entries(o ?? {}).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]],
  );
export function Studio() {
  const { studioId, studioPrefill } = useApp();
  return studioId ? (
    <Workspace key={studioId} projectId={studioId} />
  ) : (
    <BriefForm prefill={studioPrefill ?? { mode: "look", target: null }} />
  );
}
function CapInput({ id, value, onChange }) {
  const [s, setS] = useState(String(value));
  useEffect(() => {
    if (s.trim() === "" || +s !== value) setS(String(value));
  }, [value]);
  return (
    <input
      id={id}
      className="input sd-cap"
      type="number"
      min={0}
      max={500}
      value={s}
      onBlur={() => setS(String(value))}
      onChange={(e) => {
        const v = e.target.value;
        setS(v);
        const n = Math.round(+v);
        if (v.trim() !== "" && n >= 0 && n <= 500) onChange(n);
      }}
    />
  );
}
function useFlowImages() {
  const [flow, setFlow] = useState(false);
  useEffect(() => {
    api
      .imagesStatus()
      .then((s) => setFlow(s?.active === "flow"))
      .catch(() => {});
  }, []);
  return flow;
}
const IMG = /\.(png|jpe?g|webp|gif)$/i,
  VID = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
function BriefForm({ prefill }) {
  const { toast, go, refreshProjects, openStudio, claude } = useApp();
  const std = isStandard(usePlan());
  const [styles, setStyles] = useState([]);
  const mode = "look";
  const [target, setTarget] = useState(prefill.target ?? "");
  const [name, setName] = useState(""),
    [desc, setDesc] = useState(""),
    [cap, setCap] = useState(10);
  const [aspects, setAspects] = useState([]);
  const [refs, setRefs] = useState([]),
    [over, setOver] = useState(false),
    [busy, setBusy] = useState(false);
  const flow = useFlowImages();
  useEffect(() => {
    api
      .styles()
      .then((l) => {
        setStyles(l);
        if (!prefill.target) setTarget(l.find((s) => s.id === "flat")?.id ?? l[0]?.id ?? "");
      })
      .catch(() => {});
  }, []);
  const choices = styles.filter((s) => !s.hidden && !s.legacy && !s.missing);
  const st = styles.find((s) => s.id === target);
  const can = ["16:9", "9:16"].filter((a) => aspectsOf(st).includes(a));
  useEffect(() => {
    setAspects(can);
  }, [target, styles.length]);
  const add = (paths) => {
    const ok = paths.filter((p) => IMG.test(p) || VID.test(p));
    if (ok.length < paths.length) toast("Only images and videos can be references here.", "info");
    setRefs((r) => [...new Set([...r, ...ok])].slice(0, 40));
  };
  const pick = async () => {
    const fs = await api.pickFiles("Add reference images or videos", [
      { name: "Images and videos", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "m4v", "webm", "mkv"] },
    ]);
    if (fs?.length) add(fs);
  };
  const start = async () => {
    if (std) {
      toast(premiumMsg("The Style Studio"));
      return;
    }
    if (!claude?.loggedIn)
      toast("Claude is not connected yet: you can set the workspace up now, and sign in before its first stage.", "info");
    setBusy(true);
    try {
      const r = await api.studioCreate({
        mode,
        name: name.trim(),
        target,
        dim: null,
        aspects,
        description: desc.trim(),
        refs,
        imageCap: cap,
      });
      await refreshProjects();
      openStudio(r.projectId);
    } catch (e) {
      toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
      setBusy(false);
    }
  };
  const lookName = "look";
  return (
    <div className="page page-enter sd-briefpage">
      <div className="page-head">
        <div>
          <button className="btn ghost small sd-back" onClick={() => go("presets")}>
            <ArrowLeft size={14} />
            Styles
          </button>
          <h1>New look</h1>
          <div className="sub">A look of your own for a style: its settings and notes, checked on a sample video before you save it.</div>
        </div>
      </div>
      <section className="panel pad sd-brief" aria-label="Brief">
        <p className="help sd-lookonly">
          {
            "Same style, your settings: colours, grade, grain, camera, captions, characters, plus notes for Claude. Nothing new gets drawn, and every fix to the style keeps reaching your look. A style with new elements is built in Claude Code with the Style Kit (Styles > Custom > "
          }
          <b>Get the Style Kit</b>).
        </p>
        <div className="sd-row2">
          <div className="field">
            <label htmlFor="sd-name">Name</label>
            <input
              id="sd-name"
              className="input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Midnight blueprint"
            />
          </div>
          <div className="field">
            <label htmlFor="sd-target">Look for</label>
            <select id="sd-target" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <optgroup label="Built-in styles">
                {choices
                  .filter((s) => !isOwnStyle(s))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
              {choices.some(isOwnStyle) && (
                <optgroup label="Your styles">
                  {choices.filter(isOwnStyle).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Frames</label>
          <div className="row" style={{ gap: 8 }}>
            {["16:9", "9:16"].map((a) => {
              const ok = can.includes(a),
                onA = aspects.includes(a);
              return (
                <label
                  key={a}
                  className={`sd-check ${!ok ? "off" : ""}`}
                  title={ok ? void 0 : `${st?.name ?? "This style"} renders ${can.join(" and ")} only`}
                >
                  <input
                    type="checkbox"
                    disabled={!ok}
                    checked={ok && onA}
                    onChange={() => setAspects((x) => (onA ? x.filter((y) => y !== a) : [...x, a]))}
                  />
                  {a === "16:9" ? "Wide 16:9" : "Vertical 9:16"}
                </label>
              );
            })}
          </div>
          <span className="help">Every version is rendered and checked in each frame you pick.</span>
        </div>
        <div className="field">
          <label htmlFor="sd-desc">Describe it</label>
          <textarea
            id="sd-desc"
            className="input"
            rows={4}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Colours, background, type, how things move… e.g. 'Deep navy backgrounds, cyan line art like a blueprint, white condensed captions, slow pushes.'"
          />
        </div>
        <div className="field">
          <label>
            {"References "}
            <span className="dim">(optional: images or videos; nothing is copied)</span>
          </label>
          <div
            className={`cs-drop ${over ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              add([...e.dataTransfer.files].map((f) => window.suite.pathForFile(f)).filter(Boolean));
            }}
          >
            <button className="btn" onClick={pick} disabled={busy}>
              <ImagePlus size={16} strokeWidth={1.7} />
              Add images or videos…
            </button>
            <span className="small">
              or drop them here. For a long video you pick the seconds that matter in the workspace's References.
            </span>
          </div>
          {refs.length > 0 && (
            <div className="cs-refs">
              {refs.map((r) => (
                <span key={r} className="cs-ref">
                  {VID.test(r) ? <Film size={13} /> : <ImagePlus size={13} />}
                  <span className="ellipsis">{r.split(/[\\/]/).pop()}</span>
                  <button aria-label="Remove" onClick={() => setRefs((x) => x.filter((y) => y !== r))} disabled={busy}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {!flow && (
          <div className="field">
            <label htmlFor="sd-cap">Picture cap</label>
            <div className="row" style={{ gap: 10 }}>
              <CapInput id="sd-cap" value={cap} onChange={setCap} />
              <span className="small">
                {"pictures at most, about "}
                <b>${(cap * IMAGE_COST).toFixed(2)}</b>
                {" on your image account. Claude itself runs on your Claude plan (no cap)."}
              </span>
            </div>
          </div>
        )}
        <div className="modal-actions">
          {busy && (
            <span className="row small" style={{ gap: 8 }}>
              <Spinner size={14} />
              Setting up the workspace…
            </span>
          )}
          <span className="grow" />
          <button className="btn" onClick={() => go("presets")} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary sd-start" onClick={start} disabled={busy || !name.trim() || !aspects.length || !target}>
            <Sparkles size={15} strokeWidth={1.8} />
            {"Start the "}
            {lookName}
            {std && <span className="premium-pill">Premium</span>}
          </button>
        </div>
      </section>
    </div>
  );
}
const NOREQ = { n: 0, notes: "" },
  NOFIX = { n: 0, text: "" };
function Workspace({ projectId }) {
  const { toast, go, working, refreshProjects, setNewProject } = useApp();
  const [st, setSt] = useState(null),
    [err, setErr] = useState(null);
  const [issues, setIssues] = useState([]),
    [versions, setVersions] = useState([]);
  const [styleName, setStyleName] = useState("");
  const [host, setHost] = useState(null),
    [base, setBase] = useState("");
  const [aspect, setAspect] = useState("16:9"),
    [psettings, setPsettings] = useState(null);
  const [reloadKey, setReloadKey] = useState(0),
    [bootError, setBootError] = useState(null);
  const [shots, setShots] = useState([]);
  const [viewStage, setViewStage] = useState(null),
    [verSel, setVerSel] = useState(null);
  const [selection, setSelection] = useState([]);
  const [pin, setPin] = useState(null),
    [pinText, setPinText] = useState(""),
    [pinSev, setPinSev] = useState("medium");
  const [compare, setCompare] = useState(false),
    [refsOpen, setRefsOpen] = useState(false),
    [taskId, setTaskId] = useState(null);
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState(null);
  const [targets, setTargets] = useState([]),
    [loop, setLoop] = useState(null);
  const [centre, setCentre] = useState("gallery"),
    [matchTarget, setMatchTarget] = useState(null);
  const clock = useMemo(() => new Clock(), [projectId]);
  const kitBtns = useStyleKit();
  const t = useClockTime(clock, 15),
    playing = usePlaying(clock);
  const preview = useRef(null);
  const claudeBusy = working.has(projectId);
  const say = (e) => toast(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
  const load = useCallback(async () => {
    try {
      const [s, is, vs, tg, lp] = await Promise.all([
        api.studioState(projectId),
        api.studioIssues(projectId),
        api.studioVersions(projectId),
        api.studioTargets(projectId),
        api.studioLoop(projectId),
      ]);
      setSt(s);
      setIssues(is);
      setVersions(vs);
      setTargets(tg);
      setLoop(lp);
      setErr(null);
    } catch (e) {
      setErr(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  }, [projectId]);
  useEffect(() => {
    load();
    api
      .openProject(projectId)
      .then((r) => {
        setHost(r.host);
        setBase(r.base);
      })
      .catch((e) => setErr(e.message));
    api
      .running()
      .then((r) => {
        const m = r.find((x) => x.projectId === projectId);
        if (m) setTaskId(m.taskId);
      })
      .catch(() => {});
    const offs = [
      on("studio:changed", (e) => {
        if (e?.projectId === projectId) load();
      }),
      on("project:changed", (e) => {
        if (e?.projectId === projectId && e.reload) {
          setReloadKey((k) => k + 1);
        }
      }),
      on("claude:event", (ev) => {
        if (ev.projectId !== projectId) return;
        if (ev.type === "started") setTaskId(ev.taskId);
        if (ev.type === "done") {
          setTaskId(null);
          setReloadKey((k) => k + 1);
          load();
        }
      }),
    ];
    return () => {
      offs.forEach((f) => f());
      api.closeProject();
    };
  }, [projectId]);
  useEffect(() => {
    if (st && !viewStage) setViewStage(st.studio.stage);
    if (st && !st.studio.aspects.includes(aspect)) setAspect(st.studio.aspects[0]);
  }, [st?.studio.stage, st?.studio.aspects.join()]);
  useEffect(() => {
    if (st)
      api
        .styles()
        .then((l) => setStyleName(l.find((x) => x.id === st.studio.target)?.name ?? st.studio.target))
        .catch(() => {});
  }, [st?.studio.target]);
  const lookAt = st?.studio.look?.at ?? "";
  useEffect(() => {
    if (!st) return;
    api
      .studioPreviewSettings(projectId, aspect)
      .then((s) => setPsettings(JSON.stringify(s)))
      .catch(() => setPsettings(null));
  }, [projectId, aspect, lookAt, !!st]);
  const hostUrl = host && psettings ? `${host}?settings=${encodeURIComponent(psettings)}` : null;
  const view = st?.studio.view ?? "",
    v = st?.studio.views[view];
  useEffect(() => {
    clock.end = v?.end ?? 0;
    if (clock.t > clock.end) clock.set(0);
  }, [v?.end]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0,
      last = performance.now();
    const step = (now) => {
      const dt = (now - last) / 1e3;
      last = now;
      let n = clock.t + dt;
      if (n >= clock.end) n = 0;
      clock.set(n);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, clock]);
  const onReady = useCallback((info) => {
    setShots((info?.shots ?? []).map((s) => ({ t0: +s.t0, t1: +s.t1, name: s.name })));
  }, []);
  const onPick = useCallback(
    async (r) => {
      const item = { kind: r.kind, time: r.time, shot: r.shot, element: r.element, rect: r.rect };
      setSelection([item]);
      const frame = (await preview.current?.frame(0.5).catch(() => null)) ?? null;
      setPin({ t: +(r.time ?? clock.t), label: selLabel(item), rect: r.rect ?? null, frame });
      setPinText("");
    },
    [clock],
  );
  const snapshot = useCallback(async () => {
    const url = await preview.current?.frame(0.5);
    return url ? { frame: url, plain: url } : null;
  }, []);
  if (err && !st)
    return (
      <div className="page">
        <div className="hint warn">
          <TriangleAlert size={18} />
          <div>
            <b>This Style Studio workspace can't be opened</b>
            <p>{err}</p>
          </div>
        </div>
      </div>
    );
  if (!st)
    return (
      <div className="loading">
        <Spinner />
      </div>
    );
  const S = st.studio,
    order = st.stages,
    cur = order.indexOf(S.stage),
    shown = viewStage && order.includes(viewStage) ? viewStage : S.stage,
    isCur = shown === S.stage;
  const latest = versions[versions.length - 1] ?? null,
    ver = versions.find((x) => x.v === verSel) ?? latest;
  const kind =
    S.mode === "look"
      ? `Look for ${styleName}`
      : S.mode === "derived"
        ? `Style on top of ${styleName}`
        : `New style · ${(S.dim ?? "2d").toUpperCase()}`;
  const act = ACT(st.activity) ?? (claudeBusy ? "Claude is working…" : busy);
  const open = issues.filter((i) => ["open", "reopened", "fixing"].includes(i.status)),
    verify = issues.filter((i) => i.status === "verify");
  const looping = !!loop && (loop.status === "running" || loop.status === "stopping"),
    jobBusy = looping || !!loop?.critic,
    anyBusy = claudeBusy || jobBusy;
  const scores = versions.filter((x) => x.score).map((x) => ({ v: x.v, value: x.score.value }));
  const stopLoop = () => api.studioLoopStop(projectId).then(load).catch(say);
  const run = async (o = {}) => {
    try {
      await api.studioRun(projectId, { instruction: "", ...o });
    } catch (e) {
      say(e);
    }
  };
  const job = async (what, f, done) => {
    setBusy(what);
    try {
      await f();
      if (done) toast(done);
    } catch (e) {
      say(e);
    } finally {
      setBusy(null);
      load();
    }
  };
  const approve = () =>
    job("Moving on…", async () => {
      const s = await api.studioSetStage(projectId, st.next);
      setSt(s);
      setViewStage(s.studio.stage);
    });
  const reopen = (stage) =>
    job("Going back…", async () => {
      const s = await api.studioSetStage(projectId, stage);
      setSt(s);
      setViewStage(stage);
    });
  const seek = async (i) => {
    const w = i.where ?? {};
    if (w.view && w.view !== view && S.views[w.view]) {
      await api.studioSetView(projectId, w.view).catch(say);
      setReloadKey((k) => k + 1);
    }
    if (w.aspect && w.aspect !== aspect && S.aspects.includes(w.aspect)) setAspect(w.aspect);
    if (typeof w.t === "number") {
      clock.setPlaying(false);
      clock.set(w.t);
    }
    setCentre("preview");
    if (!["brief", "study"].includes(S.stage)) setViewStage(S.stage === "save" || S.stage === "publish" ? "review" : S.stage);
  };
  const setIssue = (id, status) => api.studioIssueUpdate(projectId, id, { status }).then(load).catch(say);
  const addPin = async () => {
    if (!pin || !pinText.trim()) return;
    try {
      await api.studioIssueAdd(projectId, {
        title: pinText.trim().slice(0, 200),
        severity: pinSev,
        where: {
          view,
          aspect,
          t: +pin.t.toFixed(2),
          element: pin.label,
          rect: pin.rect ? [pin.rect.x, pin.rect.y, pin.rect.w, pin.rect.h] : null,
        },
        thumb: pin.frame,
      });
      setPin(null);
      setPinText("");
      setFilter("open");
      load();
    } catch (e) {
      say(e);
    }
  };
  const viewNames = Object.keys(S.views).filter((n) => !S.views[n].expect && !/^mustfail/i.test(n));
  const frames = (ver?.renders?.[aspect]?.frames ?? []).filter((f) => f.view === view).sort((a, b) => a.t - b.t);
  const checks = ver?.checks;
  const isViewer = !["brief", "study"].includes(shown) && !((shown === "save" || shown === "publish") && isCur);
  const matchable = shown === "review",
    showMatch = matchable && centre === "match";
  const galleryable = (shown === "guide" || shown === "kit") && S.mode !== "look",
    showGallery = galleryable && centre !== "preview" && !!latest;
  const seekTarget = (x) => {
    setCentre("preview");
    seek({ where: { view: x.view, aspect: x.aspect, t: x.t } });
  };
  const saveFrames = (latest?.renders?.[S.aspects[0]]?.frames ?? []).filter((f) => f.view === (S.views.sample ? "sample" : view));
  const savePic = saveFrames[Math.floor(saveFrames.length / 2)]?.url ?? null;
  const list = issues
    .filter((i) =>
      filter === "all"
        ? true
        : filter === "open"
          ? ["open", "reopened", "fixing", "verify"].includes(i.status)
          : ["fixed", "wontfix"].includes(i.status),
    )
    .sort(
      (a, b) =>
        (a.status === "verify" ? -1 : 0) - (b.status === "verify" ? -1 : 0) ||
        ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity),
    );
  const end = v?.end ?? 1;
  return (
    <div className="sd-page">
      <header className="sd-top">
        <button className="icon-btn" aria-label="Back to Styles" title="Back to Styles" onClick={() => go("presets")}>
          <ArrowLeft size={17} strokeWidth={1.7} />
        </button>
        <h2 className="ellipsis sd-name" title={S.name}>
          {S.name}
        </h2>
        <span className={`sd-kind k-${S.mode}`}>{kind}</span>
        <span className="grow" />
        {act && (
          <span className="sd-activity" role="status">
            <Spinner size={12} />
            {act}
          </span>
        )}
        {looping && (
          <span
            className="sd-loopchip"
            role="status"
            title="Run until good: fix round, a version with its checks and overlays, the critic every few passes"
          >
            <Repeat size={12} />
            {"Pass "}
            {loop.pass}/{loop.cap}
            {loop.phase ? ` · ${LOOP_PHASE[loop.phase]}` : ""}
            <button className="text-btn sd-loopchip-stop" onClick={stopLoop} disabled={loop.status === "stopping"}>
              {loop.status === "stopping" ? "Stopping…" : "Stop"}
            </button>
          </span>
        )}
        {scores.length > 0 && (
          <span
            className="sd-score"
            title={`The critic's scores (stop at ${loop?.threshold ?? 8}):
${scores.map((s) => `v${s.v}: ${s.value}`).join("\n")}`}
          >
            <Gauge size={12} />
            Score
            {scores.slice(-4).map((s, i) => (
              <Fragment key={s.v}>
                {i > 0 && <span className="sd-score-arrow">→</span>}
                <b className={s.value >= (loop?.threshold ?? 8) ? "ok" : ""}>{s.value}</b>
              </Fragment>
            ))}
          </span>
        )}
        {versions.length > 0 && (
          <select className="input compact sd-ver" aria-label="Version" value={ver?.v ?? ""} onChange={(e) => setVerSel(+e.target.value)}>
            {[...versions].reverse().map((x) => (
              <option key={x.v} value={x.v}>
                v{x.v}
                {" · "}
                {x.label}
                {x.v === latest?.v ? " (latest)" : ""}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn small sd-compare"
          disabled={versions.length < 2}
          onClick={() => setCompare(true)}
          title={versions.length < 2 ? "Two versions are needed to compare" : "Two versions side by side, or as a slider; go back to one"}
        >
          <GitCompareArrows size={14} />
          Compare
        </button>
        {S.aspects.length > 1 && (
          <div className="seg-ctl sd-aspect" role="radiogroup" aria-label="Frame">
            {S.aspects.map((a) => (
              <button key={a} role="radio" aria-checked={aspect === a} className={aspect === a ? "on" : ""} onClick={() => setAspect(a)}>
                {a}
              </button>
            ))}
          </div>
        )}
      </header>
      <nav className="sd-rail" aria-label="Stages">
        <div className="sec-title">Stages</div>
        {order.map((id, i) => {
          const s = S.stages[id]?.status,
            locked = i > cur,
            current = id === S.stage;
          const state = current
            ? s === "running"
              ? "running"
              : "current"
            : s === "stale"
              ? "stale"
              : s === "approved" || (i < cur && s !== "idle")
                ? "approved"
                : s === "done"
                  ? "done"
                  : locked
                    ? "locked"
                    : "idle";
          return (
            <button
              key={id}
              className={`sd-stage st-${state} ${shown === id ? "on" : ""}`}
              disabled={locked}
              onClick={() => setViewStage(id)}
              aria-current={current ? "step" : void 0}
              title={STAGE_HINT[id]}
            >
              <span className="sd-stage-ic">
                {state === "running" ? (
                  <Spinner size={12} />
                ) : state === "approved" || state === "done" ? (
                  <Check size={13} />
                ) : state === "locked" ? (
                  <Lock size={12} />
                ) : state === "stale" ? (
                  <TriangleAlert size={12} />
                ) : (
                  <CircleDot size={13} />
                )}
              </span>
              <span className="grow">
                <b>
                  {i + 1}
                  {". "}
                  {STAGE_NAME[id] ?? id}
                </b>
                <small>
                  {state === "current" && id === "save" && S.saved
                    ? "saved"
                    : state === "current" && id === "publish" && S.published
                      ? `published v${S.published.version}`
                      : state === "current"
                        ? "now"
                        : state === "stale"
                          ? "needs a new look"
                          : state === "locked"
                            ? "later"
                            : state === "approved"
                              ? "approved"
                              : state === "running"
                                ? "Claude is on it"
                                : ""}
                </small>
              </span>
            </button>
          );
        })}
        <span className="grow" />
        <div className="sd-rail-foot">
          <div className="small">
            {open.length}
            {" open issue"}
            {open.length === 1 ? "" : "s"}
            {st.issues.openHigh ? ` · ${st.issues.openHigh} high` : ""}
          </div>
          {claudeBusy && (
            <button
              className="btn small danger block sd-stop"
              onClick={() => taskId && api.studioStop(taskId).catch(say)}
              disabled={!taskId}
            >
              <Square size={12} />
              Stop Claude
            </button>
          )}
        </div>
      </nav>
      <section className="sd-center" aria-label={STAGE_NAME[shown]}>
        {S.mode !== "look" && (
          <div className="sk-moved" role="note">
            <Info size={16} strokeWidth={1.8} />
            <div className="grow">
              <b>Making whole styles moved to the Style Kit</b>
              <span>
                {
                  "This workspace still opens and Claude can still work in it, but it can't publish. Build styles in Claude Code with the Style Kit, then import them in Styles > Custom."
                }
              </span>
            </div>
            <button className="btn tiny sk-moved-kit" onClick={kitBtns.getKit} disabled={kitBtns.kitBusy}>
              {kitBtns.kitBusy ? <Spinner size={11} /> : <Boxes size={12} />}
              {kitBtns.kitBusy ? "Writing the kit…" : "Get the Style Kit"}
            </button>
            <button className="btn tiny ghost sk-moved-folder" onClick={() => api.open(st.dir).catch(say)}>
              <FolderOpen size={12} />
              {"Show in "}
              {FOLDER_APP}
            </button>
          </div>
        )}
        <div className="sd-stagehead">
          <h3>{STAGE_NAME[shown]}</h3>
          <span className="small">{STAGE_HINT[shown]}</span>
          {!isCur && (
            <span className="sd-past">
              {order.indexOf(shown) < cur ? (
                <>
                  {"An earlier stage. "}
                  <button className="text-btn link" onClick={() => reopen(shown)} disabled={anyBusy}>
                    Go back to it
                  </button>
                  {" (the stages after it need a new look)"}
                </>
              ) : (
                "Not reached yet."
              )}
            </span>
          )}
        </div>
        {shown === "brief" && (
          <div className="sd-scroll">
            <BriefSummary st={st} styleName={styleName} projectId={projectId} onRefs={() => setRefsOpen(true)} onSaved={load} />
          </div>
        )}
        {shown === "study" && (
          <StudyPanel
            projectId={projectId}
            st={st}
            isCur={isCur}
            busy={anyBusy || !!busy}
            onRefs={() => setRefsOpen(true)}
            onMeasure={() => job("Measuring the references…", () => api.studioStudy(projectId), "The references are measured.")}
          />
        )}
        {isViewer && (
          <div className="sd-viewer">
            {(viewNames.length > 1 || matchable || galleryable) && (
              <div className="sd-viewrow">
                {viewNames.length > 1 && !showGallery && (
                  <div className="sd-views" role="tablist" aria-label="Views">
                    {viewNames.map((n) => (
                      <button
                        key={n}
                        role="tab"
                        aria-selected={n === view}
                        className={`btn tiny ${n === view ? "active" : ""}`}
                        onClick={() =>
                          api
                            .studioSetView(projectId, n)
                            .then(() => {
                              setReloadKey((k) => k + 1);
                              load();
                            })
                            .catch(say)
                        }
                      >
                        {n[0].toUpperCase() + n.slice(1).replace(/_/g, " ")}
                      </button>
                    ))}
                  </div>
                )}
                {galleryable && (
                  <>
                    <span className="grow" />
                    <div className="seg-ctl tiny sd-centre-mode sd-gallery-mode" role="radiogroup" aria-label="Show in the middle">
                      <button
                        role="radio"
                        aria-checked={showGallery}
                        className={showGallery ? "on" : ""}
                        disabled={!latest}
                        title={!latest ? "Claude's first turn of this stage makes a version" : void 0}
                        onClick={() => {
                          setCentre("gallery");
                          const k = shown === "guide" ? "hero" : "kit";
                          if (S.views[k] && view !== k)
                            api
                              .studioSetView(projectId, k)
                              .then(() => {
                                setReloadKey((x) => x + 1);
                                load();
                              })
                              .catch(say);
                        }}
                      >
                        {shown === "guide" ? "Hero frames" : "Kit gallery"}
                      </button>
                      <button
                        role="radio"
                        aria-checked={!showGallery}
                        className={!showGallery ? "on" : ""}
                        onClick={() => setCentre("preview")}
                      >
                        Live preview
                      </button>
                    </div>
                  </>
                )}
                {matchable && (
                  <>
                    <span className="grow" />
                    <div className="seg-ctl tiny sd-centre-mode" role="radiogroup" aria-label="Show in the middle">
                      <button
                        role="radio"
                        aria-checked={!showMatch}
                        className={!showMatch ? "on" : ""}
                        onClick={() => setCentre("preview")}
                      >
                        Preview
                      </button>
                      <button
                        role="radio"
                        aria-checked={showMatch}
                        className={showMatch ? "on" : ""}
                        onClick={() => setCentre("match")}
                        title="The version's frames over your target frames"
                      >
                        Match{ver?.match?.targets.length ? ` (${ver.match.targets.length})` : ""}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {showMatch ? (
              <MatchView
                ver={ver}
                sel={matchTarget}
                setSel={setMatchTarget}
                hasTargets={targets.length > 0}
                busy={anyBusy || !!st.activity}
                onMatchNow={() => job("Matching…", () => api.studioMatchNow(projectId))}
              />
            ) : showGallery && shown === "guide" ? (
              <HeroFrames
                st={st}
                ver={latest}
                aspect={aspect}
                projectId={projectId}
                issues={issues}
                onChanged={load}
                onShow={(t2, a) => {
                  if (a !== aspect) setAspect(a);
                  seek({ where: { view: "hero", aspect: a, t: t2 } });
                }}
              />
            ) : showGallery ? (
              <KitGallery
                st={st}
                aspect={aspect}
                projectId={projectId}
                busy={anyBusy}
                onChanged={load}
                onShow={(el) => seek({ where: { view: el.view, aspect, t: el.t } })}
              />
            ) : hostUrl ? (
              <Preview
                ref={preview}
                host={hostUrl}
                reloadKey={reloadKey}
                clock={clock}
                selection={selection}
                onPick={onPick}
                onReady={onReady}
                onLog={() => {}}
                onBootError={setBootError}
                bootError={bootError}
                label={selLabel}
                aspect={aspect === "9:16" ? 9 / 16 : 16 / 9}
              />
            ) : (
              <div className="stage-wrap">
                <Busy text="Loading the sample…" size={18} kind="orbit" />
              </div>
            )}
            {pin && (
              <div className="sd-pin" role="dialog" aria-label="Pin an issue">
                <Pin size={14} className="sd-pin-ic" />
                <div className="grow col" style={{ gap: 6 }}>
                  <span className="small">
                    {"At "}
                    {fmtT(pin.t)}
                    {" on "}
                    <b>{pin.label}</b>
                    {" · "}
                    {view}
                    {" · "}
                    {aspect}
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      id="sd-pin-text"
                      className="input compact grow"
                      autoFocus
                      value={pinText}
                      maxLength={200}
                      placeholder="What's wrong here? e.g. the label is cut at the edge"
                      onChange={(e) => setPinText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addPin();
                        if (e.key === "Escape") setPin(null);
                      }}
                    />
                    <select className="input compact" aria-label="Severity" value={pinSev} onChange={(e) => setPinSev(e.target.value)}>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                    <button className="btn small primary sd-pin-add" onClick={addPin} disabled={!pinText.trim()}>
                      Pin issue
                    </button>
                    <button className="icon-btn sm" aria-label="Cancel" onClick={() => setPin(null)}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}
            {!showGallery && (
              <div className="sd-scrub">
                <button className="icon-btn" aria-label={playing ? "Pause" : "Play"} onClick={() => clock.setPlaying(!playing)}>
                  {playing ? <Pause size={17} strokeWidth={1.7} /> : <Play size={17} strokeWidth={1.7} />}
                </button>
                <span className="timecode">
                  {t.toFixed(2)}{" "}
                  <span>
                    {"/ "}
                    {end.toFixed(1)}
                  </span>
                </span>
                <div className="sd-track">
                  {shots.map((s, i) => (
                    <i
                      key={i}
                      className="sd-tick"
                      style={{ left: `${(s.t0 / end) * 100}%` }}
                      title={`Shot ${i + 1}${s.name ? `: ${s.name.replace(/^\d+[a-z]?:\s*/i, "")}` : ""}`}
                    />
                  ))}
                  {issues
                    .filter(
                      (i) =>
                        ["open", "reopened", "fixing", "verify"].includes(i.status) &&
                        i.where?.view === view &&
                        typeof i.where.t === "number" &&
                        (!i.where.aspect || i.where.aspect === aspect),
                    )
                    .map((i) => (
                      <button
                        key={i.id}
                        className={`sd-imark sev-${i.severity}`}
                        style={{ left: `${(i.where.t / end) * 100}%` }}
                        title={i.title}
                        aria-label={`Issue at ${fmtT(i.where.t)}: ${i.title}`}
                        onClick={() => seek(i)}
                      />
                    ))}
                  <i className="sd-fill" style={{ width: `${(Math.min(t, end) / end) * 100}%` }} />
                  <i className="sd-head" style={{ left: `${(Math.min(t, end) / end) * 100}%` }} />
                  <input
                    type="range"
                    min={0}
                    max={end}
                    step={0.01}
                    value={Math.min(t, end)}
                    aria-label="Time"
                    onChange={(e) => {
                      clock.setPlaying(false);
                      clock.set(+e.target.value);
                    }}
                  />
                </div>
                <span className="small sd-pinhint">Click the picture to pin an issue</span>
              </div>
            )}
            {frames.length > 0 && !showGallery && (
              <div className="sd-strip" aria-label={`Frames of v${ver?.v}`}>
                <span className="sd-strip-h">
                  v{ver?.v}
                  <small>{aspect}</small>
                </span>
                {frames.map((f) => (
                  <button
                    key={f.file}
                    className={`sd-frame ${aspect === "9:16" ? "tall" : ""} ${Math.abs(f.t - t) < 0.05 ? "on" : ""}`}
                    onClick={() => {
                      clock.setPlaying(false);
                      clock.set(f.t);
                    }}
                    title={`${fmtT(f.t)}${f.shot != null ? ` · shot ${f.shot + 1}` : ""}`}
                  >
                    <img src={f.url} alt="" loading="lazy" />
                    <small>{f.t.toFixed(1)}</small>
                  </button>
                ))}
              </div>
            )}
            <div className="sd-checks" aria-label="Checks">
              {!ver ? (
                <span className="sd-chip">No version yet: Claude's first turn makes one</span>
              ) : !checks?.ran ? (
                <span className="sd-chip">Checks not run on v{ver.v}</span>
              ) : (
                <>
                  <span className={`sd-chip ${checks.found ? "warn" : "ok"}`}>
                    <ShieldCheck size={12} />v{ver.v}
                    {": "}
                    {checks.pairs.length}
                    {" view × frame checks"}
                    {checks.found ? `, ${checks.found} finding${checks.found === 1 ? "" : "s"}` : ", all clean"}
                  </span>
                  {Object.entries(checks.byCheck)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([k, n]) => (
                      <span key={k} className="sd-chip warn">
                        {k.toUpperCase()} {n}
                      </span>
                    ))}
                </>
              )}
              {S.mode === "look" && S.look && (
                <span
                  className="sd-chip look"
                  title={flat(S.look.settings)
                    .map(([k, x]) => `${k}: ${JSON.stringify(x)}`)
                    .join("\n")}
                >
                  <Layers size={12} />
                  {flat(S.look.settings).length}
                  {" look setting"}
                  {flat(S.look.settings).length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            {matchable && isCur && (
              <MatchBar
                projectId={projectId}
                st={st}
                targets={targets}
                loop={loop}
                view={view}
                aspect={aspect}
                getTime={() => clock.t}
                claudeBusy={claudeBusy}
                onChanged={load}
                onSeek={seekTarget}
                onShow={(id) => {
                  setMatchTarget(id);
                  setCentre("match");
                }}
              />
            )}
          </div>
        )}
        {shown === "publish" && isCur && (
          <PublishPanel
            st={st}
            projectId={projectId}
            busy={anyBusy || !!busy}
            onDone={() => {
              load();
              refreshProjects();
            }}
            onNewProject={() => setNewProject(true)}
            onStyles={() => go("presets")}
            onIssues={() => setViewStage("review")}
          />
        )}
        {shown === "save" && isCur && (
          <SavePanel
            st={st}
            projectId={projectId}
            styleName={styleName}
            pic={savePic}
            tall={S.aspects[0] === "9:16"}
            onSaved={() => {
              load();
              refreshProjects();
            }}
            onNewProject={() => setNewProject(true)}
            onStyles={() => go("presets")}
          />
        )}
        {isCur && shown !== "save" && shown !== "publish" && (
          <div className="sd-actions">
            {!st.gate.ok && st.next && (
              <span className="sd-gate small">
                <TriangleAlert size={13} />
                {"To approve: "}
                {st.gate.missing.join("; ")}.
              </span>
            )}
            <span className="grow" />
            {["study", "look", "guide", "kit", "sample"].includes(shown) && !(shown === "study" && st.gate.ok) && (
              <button
                className="btn small sd-run"
                onClick={() => run({})}
                disabled={anyBusy || (shown === "study" && !!st.activity)}
                title={
                  shown === "study"
                    ? "The app measures your references (if it hasn't yet), then Claude writes the analysis from the numbers and the sheets"
                    : void 0
                }
              >
                <Sparkles size={14} />
                {shown === "study" ? "Study the references" : "Run stage"}
              </button>
            )}
            {shown === "review" && (
              <button
                className="btn small sd-review"
                onClick={() => run({ review: true })}
                disabled={anyBusy}
                title="Claude looks at every view at full size and files what it finds as issues (it changes nothing)"
              >
                <Bot size={14} />
                Run review
              </button>
            )}
            {shown === "review" && (
              <button className="btn small sd-fixall" onClick={() => run({ fix: true })} disabled={anyBusy || !open.length}>
                <WandSparkles size={14} />
                Fix all open{open.length ? ` (${open.length})` : ""}
              </button>
            )}
            {shown !== "brief" && shown !== "study" && (
              <button
                className="btn small sd-checksbtn"
                onClick={() => job("Checking…", () => api.studioChecks(projectId), "Checks done.")}
                disabled={anyBusy || !!st.activity}
                title="Run the app's checks on the workspace as it is now"
              >
                <RefreshCw size={14} />
                Run checks
              </button>
            )}
            {shown !== "brief" && shown !== "study" && (
              <button
                className="btn small sd-next"
                onClick={() => job("Saving a version…", () => api.studioNewVersion(projectId, "Next version"), "New version saved.")}
                disabled={anyBusy || !!st.activity}
                title="Save the workspace as it is now as a version, with its frames, checks and a short video"
              >
                <Save size={14} />
                Next version
              </button>
            )}
            {st.next && (
              <button className="btn small primary sd-approve" onClick={approve} disabled={!st.gate.ok || anyBusy || !!busy}>
                Approve
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        )}
      </section>
      <aside className="sd-right" aria-label="Issues and Claude">
        <div className="sd-issues">
          <div className="sd-issues-head">
            <h3>Issues</h3>
            <small>
              {open.length}
              {" open"}
              {verify.length ? ` · ${verify.length} to check` : ""}
              {" · "}
              {issues.filter((i) => i.status === "fixed").length}
              {" fixed"}
            </small>
            <span className="grow" />
            <div className="seg-ctl tiny" role="radiogroup" aria-label="Show issues">
              {["open", "done", "all"].map((f) => (
                <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                  {f === "open" ? "Open" : f === "done" ? "Done" : "All"}
                </button>
              ))}
            </div>
          </div>
          <div className="sd-issue-list">
            {!list.length && (
              <div className="sd-empty">
                <CircleCheck size={20} strokeWidth={1.6} />
                <b>{filter === "open" ? "Nothing open" : "None yet"}</b>
                <span>
                  {filter === "open"
                    ? "Checks, Claude's review and your pins land here. Click the picture to pin one."
                    : "Fixed and dismissed issues show here."}
                </span>
              </div>
            )}
            {list.map((i) => (
              <IssueRow
                key={i.id}
                i={i}
                base={base}
                busy={anyBusy}
                onSeek={() => seek(i)}
                onFix={() => run({ fix: true, issues: [i.id] })}
                onStatus={(s) => setIssue(i.id, s)}
              />
            ))}
          </div>
        </div>
        <ClaudePanel
          projectId={projectId}
          selection={selection}
          setSelection={setSelection}
          label={selLabel}
          snapshot={snapshot}
          onEditDone={() => load()}
          buildRequest={NOREQ}
          fixRequest={NOFIX}
          onSeek={(x) => {
            clock.setPlaying(false);
            clock.set(x);
          }}
          getTime={() => clock.t}
          lockedModel="Opus 5.5"
        />
      </aside>
      {compare && versions.length > 1 && (
        <CompareDialog
          versions={versions}
          aspects={S.aspects}
          aspect={aspect}
          view={view}
          projectId={projectId}
          busy={anyBusy || !!st.activity}
          onClose={() => setCompare(false)}
          onBack={() => {
            setCompare(false);
            setVerSel(null);
            load();
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {refsOpen && <RefsPanel projectId={projectId} onClose={() => setRefsOpen(false)} />}
    </div>
  );
}
const pct = (v) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const secs = (v) => (v == null ? "–" : `${v} s`);
function Swatches({ list, label }) {
  if (!list.length) return null;
  return (
    <div className="sd-sw-row" aria-label={label}>
      <span className="sd-sw-h small">{label}</span>
      {list.map((s) => (
        <span key={s.hex} className="sd-sw" title={`${s.hex}: ${pct(s.share)} of the frames`}>
          <i style={{ background: s.hex }} />
          <b>{s.hex}</b>
          <small>{pct(s.share)}</small>
        </span>
      ))}
    </div>
  );
}
function StudyPanel({ projectId, st, isCur, busy, onMeasure, onRefs }) {
  const [view, setView] = useState(null),
    [sel, setSel] = useState(0);
  const [big, setBig] = useState(null);
  const studying = /^study:/.test(st.activity ?? "");
  useEffect(() => {
    api
      .studioStudyView(projectId)
      .then(setView)
      .catch(() => {});
  }, [projectId, st.activity, st.gate.missing.join("|"), st.versions]);
  if (!view)
    return (
      <div className="sd-scroll">
        <Spinner />
      </div>
    );
  const S = view.stats,
    items = (S?.refs ?? []).flatMap((r) =>
      r.image
        ? [{ key: r.id, tag: r.tag, ref: r, range: null, name: `${r.tag} · picture` }]
        : r.ranges?.length
          ? r.ranges.map((x, k) => ({
              key: `${r.id}-${k}`,
              tag: r.tag,
              ref: r,
              range: x,
              name: `${r.tag} · ${fmtClock(x.start)}–${fmtClock(x.end)}`,
            }))
          : [{ key: r.id, tag: r.tag, ref: r, range: null, name: `${r.tag} · not measured` }],
    );
  const it = items[Math.min(sel, items.length - 1)],
    R = it?.range,
    img = it?.ref.image;
  const p = view.progress;
  if (!view.refs)
    return (
      <div className="sd-scroll">
        <div className="panel pad sd-note">
          <p>
            {st.gate.ok && isCur
              ? "Nothing to study: this workspace has no references. Approve to go on, or add references in the Brief first."
              : "Add references in the Brief: the app measures them, then Claude writes the analysis."}
          </p>
          <p className="small">
            <button className="text-btn link" onClick={onRefs}>
              Open References
            </button>
          </p>
        </div>
      </div>
    );
  const rows = R
    ? [
        ["Shots", `${R.shots.length} in ${R.len} s`],
        ["Cuts per minute", String(R.cuts.perMin)],
        [
          "Shot length",
          <>
            {"median "}
            <b>{secs(R.shotLen.median)}</b>
            {" · mean "}
            {secs(R.shotLen.mean)}
            {" · p10 "}
            {secs(R.shotLen.p10)}
            {" · p90 "}
            {secs(R.shotLen.p90)}
          </>,
        ],
        ["Light", `mean ${pct(R.light.luma)} · dark ${pct(R.light.dark)} of the frame`],
        [
          "Loudness",
          R.audio ? (
            <>
              {R.audio.lufs ?? "–"}
              {" LUFS · range "}
              {R.audio.lra ?? "–"}
              {" LU · peak "}
              {R.audio.tp ?? "–"}
              {" dBFS"}
            </>
          ) : (
            "no sound"
          ),
        ],
        ["Pauses", R.audio ? `${R.audio.pauses.count} (${R.audio.pauses.perMin} per min, median ${secs(R.audio.pauses.median)})` : "–"],
        [
          "Words per minute",
          R.speech ? `${R.speech.wpm} (${R.speech.talkWpm} while talking)` : "not measured",
          R.speech ? `Transcribed with ${R.speech.by}` : "Needs a transcriber on this computer",
        ],
        [
          "Cuts on a word start",
          R.speech?.cutsOnWords != null ? `${pct(R.speech.cutsOnWords)} (chance ${pct(R.speech.chance)})` : "–",
          "Cuts within 0.15 s of a spoken word's start, and what random cuts would give",
        ],
      ]
    : img
      ? [
          ["Size", `${img.width} × ${img.height}`],
          ["Light", `mean ${pct(img.light.luma)} · dark ${pct(img.light.dark)} of the frame`],
        ]
      : [];
  const notes = [
    ...(S?.notes ?? []),
    ...(it?.ref.error ? [`${it.tag} could not be measured: ${it.ref.error}`] : []),
    ...(it?.ref.notes ?? []),
    ...(R?.notes ?? []),
  ];
  return (
    <div className="sd-scroll sd-study">
      <div className="panel pad sd-study-head">
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <b>What the app measured</b>
          <span className="small">
            {S
              ? `${S.summary.videos} video${S.summary.videos === 1 ? "" : "s"}, ${S.summary.images} picture${S.summary.images === 1 ? "" : "s"} · ${S.summary.shots} shots in ${S.summary.seconds} s${S.summary.cutsPerMin != null ? ` · ${S.summary.cutsPerMin} cuts/min` : ""} · measured in ${Math.max(1, Math.round(S.ms / 1e3))} s`
              : view.measurable
                ? 'Not measured yet: "Study the references" measures them first, or Measure only.'
                : "None of the references is a picture or a video."}
          </span>
          <span className="grow" />
          {view.measurable > 0 && (
            <button
              className="btn small sd-measure"
              onClick={onMeasure}
              disabled={busy || studying}
              title="Cuts, shot lengths, contact sheets, colours, loudness, pauses and (with a transcriber) words: no Claude"
            >
              <RefreshCw size={13} />
              {S ? (view.stale ? "Measure again (references changed)" : "Measure again") : "Measure only"}
            </button>
          )}
        </div>
        {studying && (
          <div className="sd-study-prog" role="progressbar" aria-valuemin={0} aria-valuemax={p?.total || 1} aria-valuenow={p?.done ?? 0}>
            <i style={{ width: p?.total ? `${(p.done / p.total) * 100}%` : "35%" }} className={p?.total ? "" : "ind"} />
            <span className="small">{p ? `${p.what}${p.total ? ` ${p.done}/${p.total}` : ""}` : "Starting…"}</span>
          </div>
        )}
        {notes.length > 0 && (
          <ul className="sd-study-notes small">
            {notes.map((n, i) => (
              <li key={i}>
                <TriangleAlert size={12} />
                {n}
              </li>
            ))}
          </ul>
        )}
        {S && S.summary.palette.length > 0 && <Swatches list={S.summary.palette} label="All references" />}
      </div>
      {items.length > 1 && (
        <div className="seg-ctl tiny sd-study-tabs" role="tablist" aria-label="References">
          {items.map((x, i) => (
            <button key={x.key} role="tab" aria-selected={x === it} className={x === it ? "on" : ""} onClick={() => setSel(i)}>
              {x.name}
            </button>
          ))}
        </div>
      )}
      {it && (R || img) && (
        <div className="sd-study-grid">
          <table className="sd-study-stats" aria-label={`Numbers of ${it.name}`}>
            <tbody>
              {rows.map(([k, v, t]) => (
                <tr key={k} title={t}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sd-study-cols">
            <Swatches list={(R ?? img).palette} label="Palette" />
            <Swatches list={(R ?? img).accents} label="Accents" />
            {img?.url && (
              <button className="sd-study-img" onClick={() => setBig({ url: img.url, title: it.name })}>
                <img src={img.url} alt="" />
              </button>
            )}
          </div>
        </div>
      )}
      {R && R.sheets.length > 0 && (
        <section className="sd-study-sec" aria-label="Contact sheets">
          <h4>
            {"Contact sheets "}
            <small>one frame per shot, 24 to a sheet: click to enlarge</small>
          </h4>
          <div className="sd-sheets">
            {R.sheets.map((s) => (
              <button
                key={s.file}
                className="sd-sheet"
                onClick={() => s.url && setBig({ url: s.url, title: `${it.name}: shots ${s.from}-${s.to}` })}
              >
                {s.url && <img src={s.url} alt={`Shots ${s.from} to ${s.to}`} loading="lazy" />}
                <small>
                  {"Shots "}
                  {s.from}–{s.to}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
      {R && R.shots.length > 0 && (
        <section className="sd-study-sec" aria-label="Shots">
          <h4>
            {"Shots "}
            <small>click one for its frame and its motion (12 frames a second)</small>
          </h4>
          <div className="sd-shots">
            {R.shots.map((s) => (
              <button
                key={s.i}
                className={`sd-shot ${R.height > R.width ? "tall" : ""}`}
                title={`Shot ${s.i + 1} at ${fmtClock(s.start)}, ${s.len} s`}
                onClick={() =>
                  s.url &&
                  setBig({ url: s.url, title: `${it.name}: shot ${s.i + 1} at ${fmtClock(s.start)} (${s.len} s)`, motion: s.motionUrl })
                }
              >
                {s.url && <img src={s.url} alt="" loading="lazy" />}
                <small>
                  <i style={{ background: s.hex }} />
                  {s.len.toFixed(1)}
                  {" s"}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="sd-study-sec sd-analysis" aria-label="The analysis">
        <h4>
          {"reference/ANALYSIS.md "}
          <small>{st.gate.ok ? "filled in" : "Claude writes it from these numbers and sheets"}</small>
        </h4>
        {view.analysis ? (
          <div className="sd-md">
            <Md text={view.analysis} />
          </div>
        ) : (
          <span className="small">Not written yet.</span>
        )}
      </section>
      {big && (
        <Modal title={big.title} onClose={() => setBig(null)} wide className="sd-big">
          <div className="sd-big-body">
            <img className="sd-big-img" src={big.url} alt="" />
            {big.motion && (
              <>
                <div className="small sd-big-cap">Its first second, 12 frames a second</div>
                <img className="sd-big-img" src={big.motion} alt="Motion strip" />
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
const fmtClock = (s) => {
  const m = Math.floor(s / 60),
    x = s - m * 60;
  return `${m}:${x < 10 ? "0" : ""}${x.toFixed(1)}`;
};
function IssueRow({ i, base, busy, onSeek, onFix, onStatus }) {
  const w = i.where ?? {},
    where = [w.view, w.aspect, typeof w.t === "number" ? fmtT(w.t) : null, w.element].filter(Boolean).join(" · ");
  const SRC = { check: ["Check", ShieldCheck], opus: ["Claude", Bot], user: ["You", User], critic: ["Critic", ScanEye] },
    [srcName, SrcIc] = SRC[i.source] ?? SRC.check;
  const rejected = i.source === "critic" && i.status === "wontfix" && !!i.lesson;
  const isOpenI = ["open", "reopened"].includes(i.status);
  return (
    <div className={`sd-issue sev-${i.severity} st-${i.status}`} data-issue={i.id}>
      <button className="sd-issue-main" onClick={onSeek} title="Show it in the preview">
        {i.thumb && base ? (
          <img className="sd-issue-thumb" src={`${base}${i.thumb}`} alt="" loading="lazy" />
        ) : (
          <span className="sd-issue-thumb none">
            <SrcIc size={15} />
          </span>
        )}
        <span className="grow sd-issue-body">
          <span className="sd-issue-top">
            <span className={`sd-src s-${i.source}`}>
              <SrcIc size={11} />
              {srcName}
            </span>
            <span className={`sd-sev sev-${i.severity}`}>{i.severity}</span>
            {i.status === "fixing" && <span className="sd-stat">fixing…</span>}
            {i.status === "verify" && <span className="sd-stat v">fixed? check it</span>}
            {i.status === "reopened" && <span className="sd-stat r">back</span>}
            {i.status === "fixed" && <span className="sd-stat ok">fixed{i.fixedIn ? ` in ${i.fixedIn}` : ""}</span>}
            {i.status === "wontfix" && <span className="sd-stat">{rejected ? "rejected by Claude" : "not an issue"}</span>}
          </span>
          <b className="sd-issue-title">{i.title}</b>
          {where && <small className="sd-where">{where}</small>}
          {i.meaning && (
            <small className="sd-meaning">
              {i.source === "critic" ? <b>{"Evidence: "}</b> : null}
              {i.meaning}
            </small>
          )}
          {i.fix && (
            <small className="sd-fix">
              <b>Fix:</b> {i.fix}
            </small>
          )}
          {i.lesson && i.status !== "open" && (
            <small className="sd-fix">
              <b>{rejected ? "Why Claude rejects it:" : "Lesson:"}</b> {i.lesson}
            </small>
          )}
        </span>
      </button>
      {(isOpenI || i.status === "verify" || i.status === "fixed" || i.status === "wontfix") && (
        <div className="sd-issue-actions">
          {isOpenI && (
            <button className="btn tiny primary" onClick={onFix} disabled={busy}>
              <WandSparkles size={11} />
              Fix it
            </button>
          )}
          {isOpenI && (
            <button className="btn tiny" onClick={() => onStatus("wontfix")}>
              Not an issue
            </button>
          )}
          {i.status === "verify" && (
            <button className="btn tiny primary" onClick={() => onStatus("fixed")}>
              <Check size={11} />
              OK
            </button>
          )}
          {i.status === "verify" && (
            <button className="btn tiny" onClick={() => onStatus("reopened")}>
              Not fixed
            </button>
          )}
          {(i.status === "fixed" || i.status === "wontfix") && i.source !== "check" && (
            <button className="btn tiny ghost" onClick={() => onStatus("reopened")}>
              {rejected ? "Reopen (fix it anyway)" : "Reopen"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
function BriefSummary({ st, styleName, projectId, onRefs, onSaved }) {
  const { toast } = useApp();
  const S = st.studio;
  const [desc, setDesc] = useState(S.description),
    [cap, setCap] = useState(S.imageCap);
  const flow = useFlowImages();
  const dirty = desc !== S.description || cap !== S.imageCap;
  const save = () =>
    api
      .studioSetBrief(projectId, { description: desc, imageCap: cap })
      .then(() => {
        onSaved();
        toast("Brief saved.");
      })
      .catch((e) => toast(e.message, "bad"));
  return (
    <div className="panel pad sd-brief">
      <dl className="sd-facts">
        <dt>Name</dt>
        <dd>{S.name}</dd>
        <dt>{S.mode === "look" ? "Look for" : S.mode === "derived" ? "On top of" : "Starts from"}</dt>
        <dd>{S.mode === "scratch" ? `The plain starter engine (${(S.dim ?? "2d").toUpperCase()})` : styleName}</dd>
        <dt>Frames</dt>
        <dd>{S.aspects.join(" and ")}</dd>
      </dl>
      <div className="field">
        <label htmlFor="sd-brief-desc">Description</label>
        <textarea id="sd-brief-desc" className="input" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="field">
        <label>References</label>
        <div className="row" style={{ gap: 10 }}>
          <RefButton projectId={projectId} onClick={onRefs} />
          <span className="small">
            Images and videos (for a video, Pick parts chooses the seconds Claude studies). Mention one in the chat as @vid1.
          </span>
        </div>
      </div>
      {!flow && (
        <div className="field">
          <label htmlFor="sd-brief-cap">Picture cap</label>
          <div className="row" style={{ gap: 10 }}>
            <CapInput id="sd-brief-cap" value={cap} onChange={setCap} />
            <span className="small">
              {"at most, about "}
              <b>${(cap * IMAGE_COST).toFixed(2)}</b>
              {" on your image account."}
            </span>
          </div>
        </div>
      )}
      {dirty && (
        <div className="modal-actions">
          <span className="grow" />
          <button
            className="btn small"
            onClick={() => {
              setDesc(S.description);
              setCap(S.imageCap);
            }}
          >
            Undo
          </button>
          <button className="btn small primary" onClick={save}>
            <Save size={13} />
            Save brief
          </button>
        </div>
      )}
    </div>
  );
}
function SavePanel({ st, projectId, styleName, pic, tall, onSaved, onNewProject, onStyles }) {
  const { toast } = useApp();
  const S = st.studio;
  const [name, setName] = useState(S.saved?.name ?? S.name),
    [desc, setDesc] = useState(S.description),
    [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.studioSaveLook(projectId, { name: name.trim(), description: desc.trim() });
      toast(`Saved "${r.name}" as a look for ${r.styleName}.`);
      onSaved();
    } catch (e) {
      toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sd-scroll">
      <div className="panel pad sd-brief sd-save">
        {S.saved && (
          <div className="sd-saved" role="status">
            <CircleCheck size={18} />
            <div>
              <b>
                Saved as "{S.saved.name}
                {'" for '}
                {styleName}
              </b>
              <p className="small">
                It is in New project, the editor's Look panel and Routines, marked as yours. Saving again replaces it with what the
                workspace has now.
              </p>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn small" onClick={onNewProject}>
                  New project with it
                </button>
                <button className="btn small" onClick={onStyles}>
                  See it in Styles
                </button>
              </div>
            </div>
          </div>
        )}
        <div className={`sd-save-grid ${tall ? "tall" : ""}`}>
          {pic ? (
            <figure className="sd-save-pic">
              <img src={pic} alt="The look's preview picture" />
              <figcaption className="small">Its preview picture (from the latest version)</figcaption>
            </figure>
          ) : null}
          <div>
            <div className="field">
              <label htmlFor="sd-look-name">Look name</label>
              <input id="sd-look-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sd-look-desc">Description</label>
              <textarea id="sd-look-desc" className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            {S.look && (
              <div className="sd-look-settings" aria-label="What the look changes">
                <span className="small">What it changes</span>
                {flat(S.look.settings).map(([k, x]) => (
                  <span key={k} className="sd-chip look">
                    <code>{k}</code> {JSON.stringify(x)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="small">
          {"The app checks the settings against "}
          {styleName}
          {
            " before saving. Its notes (skill/LOOK.md) and the lessons of every fixed issue go with it, so Claude follows them in every video of this look."
          }
        </p>
        <div className="modal-actions">
          <span className="grow" />
          <button className="btn primary sd-savelook" onClick={save} disabled={busy || !name.trim()}>
            {busy ? <Spinner size={14} /> : <Save size={15} />}
            {S.saved ? "Save again" : "Save look"}
          </button>
        </div>
      </div>
    </div>
  );
}
const midOf = (s) => s.t0 + (s.t1 - s.t0) / 2;
const SEV_ORDER = ["high", "medium", "low"];
function HeroFrames({ st, ver, aspect, projectId, issues, onChanged, onShow }) {
  const { toast } = useApp();
  const S = st.studio,
    r = ver.renders?.[aspect],
    tall = aspect === "9:16";
  const views = Object.keys(S.views).filter((n) => /^hero/i.test(n) && !S.views[n].expect);
  const cards = views.flatMap((view) => {
    const shots = r?.shots?.[view] ?? [],
      fr = (r?.frames ?? []).filter((f) => f.view === view);
    const ks = shots.length ? shots.map((_, k) => k) : [...new Set(fr.map((f) => f.shot ?? 0))];
    return ks
      .map((k) => {
        const s = shots[k],
          m = s ? midOf(s) : null,
          f = fr.filter((x) => x.shot === k).sort((a, b) => (m == null ? a.t - b.t : Math.abs(a.t - m) - Math.abs(b.t - m)))[0];
        return {
          view,
          k,
          name: (s?.name ?? "").replace(/^(?:(?:kit|hero|sample)\s*)?\d+[a-z]?\s*[:.-]\s*/i, "").replace(/^Shot \d+$/, ""),
          f,
        };
      })
      .filter((x) => x.f);
  });
  const [note, setNote] = useState(null);
  const comment = async (c) => {
    if (!note?.text.trim()) return;
    try {
      await api.studioIssueAdd(projectId, {
        title: note.text.trim().slice(0, 200),
        severity: "medium",
        where: { view: c.view, aspect, t: c.f.t, shot: c.k, element: c.name || `hero ${c.k + 1}` },
        thumb: c.f.file,
      });
      setNote(null);
      onChanged();
      toast("Your comment is an issue now: Claude fixes it in its next turn (or press Fix it).");
    } catch (e) {
      toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
    }
  };
  if (!cards.length)
    return (
      <div className="sd-matchview empty">
        <Sparkles size={22} strokeWidth={1.5} />
        <b>
          No hero frames in v{ver.v}
          {" ("}
          {aspect})
        </b>
        <span>Run the stage: Claude writes the style guide and scenes/hero.js; the app renders its three shots in every frame.</span>
      </div>
    );
  return (
    <div className="sd-gallery sd-hero" aria-label="Hero frames">
      <div className="sd-gallery-head">
        <b>
          {"Your first look at "}
          {S.name}
        </b>
        <span className="small">
          v{ver.v}
          {" · "}
          {aspect}
          {" · "}
          {cards.length}
          {" hero frame"}
          {cards.length === 1 ? "" : "s"}. Approve the direction below, or comment on a frame: it becomes an issue Claude fixes.
        </span>
      </div>
      <div className={`sd-hero-grid ${tall ? "tall" : ""}`}>
        {cards.map((c) => {
          const key = `${c.view}#${c.k}`,
            on2 = issues.filter(
              (i) =>
                ["open", "reopened", "fixing", "verify"].includes(i.status) &&
                i.where?.view === c.view &&
                i.where.shot === c.k &&
                (!i.where.aspect || i.where.aspect === aspect),
            );
          return (
            <figure key={key} className="sd-hero-card" data-hero={c.k}>
              <button className="sd-hero-img" onClick={() => onShow(c.f.t, aspect)} title="Show this moment in the live preview">
                <img src={c.f.url} alt={`Hero frame ${c.k + 1}`} />
              </button>
              <figcaption>
                <span className="row" style={{ gap: 6, minWidth: 0 }}>
                  <b className="ellipsis">
                    {c.k + 1}
                    {". "}
                    {c.name || `Hero frame ${c.k + 1}`}
                  </b>
                  <span className="grow" />
                  {on2.length ? (
                    on2
                      .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
                      .slice(0, 2)
                      .map((i) => (
                        <span key={i.id} className={`sd-chip ${i.severity === "high" ? "bad" : "warn"}`} title={i.title}>
                          {i.check ? i.check.toUpperCase() : i.source === "user" ? "YOU" : "ISSUE"}
                        </span>
                      ))
                  ) : (
                    <span className="sd-chip ok">
                      <ShieldCheck size={11} />
                      Clean
                    </span>
                  )}
                  <button className="btn tiny sd-hero-comment" onClick={() => setNote(note?.key === key ? null : { key, text: "" })}>
                    <Pin size={11} />
                    Comment
                  </button>
                </span>
                {note?.key === key && (
                  <div className="row sd-hero-note" style={{ gap: 6 }}>
                    <input
                      className="input compact grow"
                      autoFocus
                      aria-label="Your comment on this frame"
                      value={note.text}
                      maxLength={200}
                      placeholder="What should change? e.g. the title type is too thin"
                      onChange={(e) => setNote({ key, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") comment(c);
                        if (e.key === "Escape") setNote(null);
                      }}
                    />
                    <button className="btn tiny primary" onClick={() => comment(c)} disabled={!note.text.trim()}>
                      Add
                    </button>
                  </div>
                )}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
function KitGallery({ st, aspect, projectId, busy, onChanged, onShow }) {
  const { toast } = useApp();
  const els = st.kit ?? [],
    tall = aspect === "9:16",
    ok = els.filter((e) => e.mark?.status === "approved").length;
  const [flag, setFlag] = useState(null),
    [working, setWorking] = useState(false);
  const say = (e) => toast(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
  const mark = async (el, status, note) => {
    try {
      await api.studioKitMark(projectId, el.key, status, note);
      setFlag(null);
      onChanged();
    } catch (e) {
      say(e);
    }
  };
  const clean = els.filter((e) => !e.issues.length && e.mark?.status !== "approved" && e.mark?.status !== "flagged");
  const approveClean = async () => {
    setWorking(true);
    try {
      for (const e of clean) await api.studioKitMark(projectId, e.key, "approved");
      onChanged();
    } catch (e) {
      say(e);
    } finally {
      setWorking(false);
    }
  };
  if (!els.length)
    return (
      <div className="sd-matchview empty">
        <Layers size={22} strokeWidth={1.5} />
        <b>No kit elements yet</b>
        <span>
          Run the stage: Claude builds every element of the style and shows each one alone in scenes/kit*.js (one shot per element). They
          show here to approve.
        </span>
      </div>
    );
  return (
    <div className="sd-gallery sd-kit" aria-label="Kit gallery">
      <div className="sd-gallery-head">
        <b>
          {ok}
          {" of "}
          {els.length}
          {" approved"}
        </b>
        <span className="small">
          Each element alone, at the middle of its kit shot ({aspect}). Approve it, or Flag what is wrong: the flag is an issue Claude
          fixes.
        </span>
        <span className="grow" />
        {clean.length > 0 && (
          <button className="btn tiny sd-kit-approveclean" onClick={approveClean} disabled={working || busy}>
            <Check size={11} />
            {"Approve the "}
            {clean.length}
            {" clean one"}
            {clean.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      <div className={`sd-kit-grid ${tall ? "tall" : ""}`}>
        {els.map((el) => {
          const f = el.frames[aspect],
            m = el.mark?.status;
          return (
            <figure key={el.key} className={`sd-kit-card ${m ? `m-${m}` : ""}`} data-kit={el.key}>
              <button className="sd-kit-img" onClick={() => onShow(el)} title="Show it in the live preview">
                {f ? (
                  <img src={f.url} alt={el.name} loading="lazy" />
                ) : (
                  <span className="muted small">
                    {"no frame in "}
                    {aspect}
                  </span>
                )}
              </button>
              <figcaption>
                <span className="row" style={{ gap: 6, minWidth: 0 }}>
                  <b className="ellipsis" title={el.name}>
                    {el.name}
                  </b>
                  <span className="grow" />
                  {m === "approved" ? (
                    <span className="sd-chip ok">
                      <Check size={11} />
                      Approved
                    </span>
                  ) : m === "flagged" ? (
                    <span className="sd-chip bad">
                      <TriangleAlert size={11} />
                      Flagged
                    </span>
                  ) : null}
                </span>
                <span className="sd-kit-checks">
                  {el.issues.length ? (
                    el.issues.slice(0, 3).map((i) => (
                      <span key={i.id} className={`sd-chip ${i.severity === "high" ? "bad" : "warn"}`} title={i.title}>
                        {i.check ? i.check.toUpperCase() : i.source === "user" ? "Your flag" : "Issue"}
                      </span>
                    ))
                  ) : (
                    <span className="sd-chip ok">
                      <ShieldCheck size={11} />
                      Checks clean
                    </span>
                  )}
                </span>
                {flag?.key === el.key ? (
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      className="input compact grow"
                      autoFocus
                      aria-label={`What is wrong with ${el.name}`}
                      value={flag.text}
                      maxLength={200}
                      placeholder="What is wrong? e.g. the outline is too thin"
                      onChange={(e) => setFlag({ key: el.key, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") mark(el, "flagged", flag.text);
                        if (e.key === "Escape") setFlag(null);
                      }}
                    />
                    <button className="btn tiny danger sd-kit-flaggo" onClick={() => mark(el, "flagged", flag.text)}>
                      Flag
                    </button>
                  </div>
                ) : (
                  <span className="row sd-kit-actions" style={{ gap: 6 }}>
                    {m !== "approved" && (
                      <button className="btn tiny primary sd-kit-approve" onClick={() => mark(el, "approved")} disabled={busy}>
                        <Check size={11} />
                        Approve
                      </button>
                    )}
                    {m !== "flagged" && (
                      <button className="btn tiny sd-kit-flag" onClick={() => setFlag({ key: el.key, text: "" })} disabled={busy}>
                        <TriangleAlert size={11} />
                        Flag…
                      </button>
                    )}
                    {m && (
                      <button className="btn tiny ghost sd-kit-undo" onClick={() => mark(el, null)} disabled={busy}>
                        Undo
                      </button>
                    )}
                  </span>
                )}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
function PublishPanel({ st, projectId, busy, onDone, onNewProject, onStyles, onIssues }) {
  const { toast } = useApp();
  const S = st.studio,
    run = st.publish ?? null,
    running = run?.status === "running";
  const [going, setGoing] = useState(false);
  const publish = async () => {
    setGoing(true);
    try {
      const r = await api.studioPublish(projectId);
      if (r.status === "done") toast(`Published "${r.result?.name}" v${r.result?.version}: it is in Your styles everywhere.`);
      else toast(r.error ?? "Not published: see the checklist.", "bad");
      onDone();
    } catch (e) {
      toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
    } finally {
      setGoing(false);
    }
  };
  const IC = {
    wait: <CircleDot size={15} className="dim" />,
    running: <Spinner size={14} />,
    ok: <CircleCheck size={15} />,
    fail: <TriangleAlert size={15} />,
    skip: <CircleDot size={15} className="dim" />,
  };
  const failed = run?.items.filter((i) => i.status === "fail") ?? [];
  return (
    <div className="sd-scroll">
      <div className="panel pad sd-brief sd-pub" aria-label="Publish">
        {S.published && (
          <div className="sd-saved" role="status">
            <CircleCheck size={18} />
            <div>
              <b>
                Published as "{S.published.name}" v{S.published.version}
              </b>
              <p className="small">
                It is under Your styles in New project, Routines and the Styles page. Publishing again from this workspace updates it (v
                {S.published.version + 1}) and projects in it are offered Update engine.
                {run?.harvest === "queued" || run?.harvest === "running" ? " The Library is learning from it in the background." : ""}
              </p>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button className="btn small" onClick={onNewProject}>
                  New project with it
                </button>
                <button className="btn small" onClick={onStyles}>
                  See it in Styles
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 10, marginBottom: 10 }}>
          <b>The publish checklist</b>
          <span className="small">
            {running
              ? "Running…"
              : run
                ? `${run.status === "done" ? "All green" : `${failed.length} to fix`} · ${new Date(run.at).toLocaleString()} · ${Math.max(1, Math.round(run.ms / 1e3))} s`
                : "Not run yet: Publish runs it."}
          </span>
        </div>
        <ol className="sd-pub-list">
          {(run?.items ?? []).map((i) => (
            <li key={i.id} className={`sd-pub-item s-${i.status}`} data-item={i.id}>
              <span className="sd-pub-ic">{IC[i.status]}</span>
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <b>{i.label}</b>
                {i.detail && <small className="sd-pub-detail">{i.detail}</small>}
                {i.status === "fail" && i.fix && (
                  <small className="sd-fix">
                    <b>How to fix:</b> {i.fix}
                  </small>
                )}
              </span>
            </li>
          ))}
          {!run && (
            <li className="sd-pub-item s-wait">
              <span className="sd-pub-ic">
                <CircleDot size={15} className="dim" />
              </span>
              <span className="grow small">
                Every earlier stage again, style.json, the engine's exports and banned calls, each frame loading and exporting 5 s, no high
                issue open, the must-fail scenes, the looks, the preview video.
              </span>
            </li>
          )}
        </ol>
        <div className="modal-actions">
          {failed.some((i) => i.id === "issues" || i.id.startsWith("aspect:")) && (
            <button className="btn small" onClick={onIssues}>
              Open Review
            </button>
          )}
          <span className="grow" />
          <span className="small dim sd-publish-why">{STYLES_MOVED}</span>
          <button className="btn primary sd-publish" onClick={publish} disabled title={STYLES_MOVED}>
            {going || running ? <Spinner size={14} /> : <Sparkles size={15} />}
            {S.published ? `Publish again (v${S.published.version + 1})` : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
function MatchView({ ver, sel, setSel, hasTargets, busy, onMatchNow }) {
  const [kind, setKind] = useState("side");
  const list = ver?.match?.targets ?? [],
    cur = list.find((x) => x.id === sel) ?? list[0];
  if (!ver || !cur)
    return (
      <div className="sd-matchview empty">
        <Target size={22} strokeWidth={1.5} />
        <b>{!hasTargets ? "No target frames yet" : ver ? `v${ver.v} has no overlays yet` : "No version yet"}</b>
        <span>
          {!hasTargets
            ? "Add the frames the style must match below (from your references, an image, or made from the notes). Every version is then laid over them."
            : "Every new version is matched to the targets. Match this one now:"}
        </span>
        {hasTargets && ver && (
          <button className="btn small sd-matchnow" onClick={onMatchNow} disabled={busy}>
            <RefreshCw size={13} />
            Match v{ver.v}
            {" now"}
          </button>
        )}
        {!!ver?.match?.errors.length && <small className="sd-match-err">{ver.match.errors.join(" · ")}</small>}
      </div>
    );
  const tall = cur.aspect === "9:16";
  return (
    <div className="sd-matchview" aria-label={`Overlays of ${cur.id} in v${ver.v}`}>
      <div className="sd-matchview-bar">
        {list.length > 1 && (
          <div className="seg-ctl tiny" role="radiogroup" aria-label="Target">
            {list.map((x) => (
              <button
                key={x.id}
                role="radio"
                aria-checked={x.id === cur.id}
                className={x.id === cur.id ? "on" : ""}
                onClick={() => setSel(x.id)}
              >
                {x.id}
              </button>
            ))}
          </div>
        )}
        <div className="seg-ctl tiny sd-matchkind" role="radiogroup" aria-label="Overlay">
          {MATCH_KINDS.map(([k, l, tip]) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? "on" : ""}
              title={tip}
              onClick={() => setKind(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="small">
          v{ver.v}
          {" · "}
          {cur.view}
          {" · "}
          {cur.aspect}
          {" · "}
          {cur.t.toFixed(1)}
          {" s · "}
          {Math.round(cur.diff * 100)}% different
          {ver.score ? (
            <>
              {" · score "}
              <b>{ver.score.value}</b>
            </>
          ) : null}
        </span>
      </div>
      <div className={`sd-matchview-img ${kind === "crops" ? "crops" : ""} ${kind === "colours" ? "colours" : ""} ${tall ? "tall" : ""}`}>
        {kind === "colours" ? (
          <RegionTable regions={cur.regions} />
        ) : kind === "crops" ? (
          cur.crops.map((c, k) => (
            <figure key={c.file}>
              <img src={c.url} alt={`Crop ${k + 1}`} />
              <figcaption>
                {c.why === "centre" ? "The centre" : "Where they differ most"}
                {" · target | render"}
              </figcaption>
            </figure>
          ))
        ) : (
          <img src={cur.urls[kind]} alt={MATCH_KINDS.find((m) => m[0] === kind)?.[2]} />
        )}
      </div>
      {(ver.score?.summary || !!ver.match?.errors.length) && (
        <div className="sd-matchview-foot small">
          {ver.score?.summary && (
            <span>
              <ScanEye size={12} /> {ver.score.summary}
            </span>
          )}
          {!!ver.match?.errors.length && <span className="sd-match-err">{ver.match.errors.join(" · ")}</span>}
        </div>
      )}
    </div>
  );
}
function NumIn({ value, min, max, step = 1, label, onCommit, disabled }) {
  const [s, setS] = useState(String(value));
  useEffect(() => {
    setS(String(value));
  }, [value]);
  const commit = () => {
    const n = +s;
    if (s.trim() !== "" && isFinite(n) && n >= min && n <= max && n !== value) onCommit(n);
    else setS(String(value));
  };
  return (
    <input
      className="input compact sd-num"
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={s}
      disabled={disabled}
      onChange={(e) => setS(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
      }}
    />
  );
}
const LOOP_IDLE =
  "The critic (a fresh Claude that only looks) scores the latest version against your targets and notes and files what is off; the loop lets Claude fix, re-checks, and asks it again.";
function loopText(l) {
  if (!l) return LOOP_IDLE;
  const last =
    (l.lastScore != null ? ` Last score ${l.lastScore} (v${l.lastScoreV}).` : "") +
    ((l.scores?.length ?? 0) > 1 && ["running", "done", "stopped", "interrupted", "failed"].includes(l.status)
      ? ` This run: ${l.scores.join(" → ")}.`
      : "");
  switch (l.status) {
    case "running":
      return `Pass ${l.pass} of ${l.cap}: ${l.phase ? LOOP_PHASE[l.phase] : "starting"}…${last}`;
    case "stopping":
      return "Stopping…";
    case "done":
      return `${l.reason}${last}`;
    case "stopped":
      return `Stopped after pass ${l.pass}.${last}`;
    case "interrupted":
      return `Interrupted at pass ${l.pass} (the app was closed). Resume carries on.${last}`;
    case "failed":
      return `${l.reason}${last}`;
    default:
      return l.lastScore != null ? `Last score ${l.lastScore} (v${l.lastScoreV}). ${LOOP_IDLE}` : LOOP_IDLE;
  }
}
const TARGET_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "mov", "m4v", "webm", "mkv"];
function MatchBar({ projectId, st, targets, loop, view, aspect, getTime, claudeBusy, onChanged, onSeek, onShow }) {
  const { toast } = useApp();
  const S = st.studio,
    say = (e) => toast(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
  const [sel, setSel] = useState(null),
    [refs, setRefs] = useState(null),
    [refT, setRefT] = useState({});
  const [gen, setGen] = useState(false),
    [working, setWorking] = useState(null);
  const running = !!loop && (loop.status === "running" || loop.status === "stopping"),
    jobBusy = running || !!loop?.critic,
    full = targets.length >= 8;
  const canResume = !!loop && ["stopped", "interrupted", "failed"].includes(loop.status) && loop.pass > 0 && loop.pass < loop.cap;
  const viewNames = Object.keys(S.views).filter((n) => !S.views[n].expect && !/^mustfail/i.test(n));
  const cur = targets.find((x) => x.id === sel) ?? null;
  const act = async (what, f, done) => {
    setWorking(what);
    try {
      await f();
      if (done);
    } catch (e) {
      say(e);
    } finally {
      setWorking(null);
      onChanged();
    }
  };
  const addFile = () =>
    act("Reading the picture…", async () => {
      const fs = await api.pickFiles("Pick a target frame (an image, or a video: its first frame)", [
        { name: "Images and videos", extensions: TARGET_EXT },
      ]);
      for (const f of fs ?? []) {
        const x = await api.studioTargetAdd(projectId, { path: f });
        setSel(x.id);
      }
    });
  const toggleRefs = async () => {
    if (refs) {
      setRefs(null);
      return;
    }
    try {
      setRefs((await api.refsList(projectId)).filter((r) => r.exists && (r.kind === "image" || r.kind === "video")));
    } catch (e) {
      say(e);
    }
  };
  const addRef = (r) =>
    act("Reading the picture…", async () => {
      const t = r.kind === "video" ? +(refT[r.id] ?? r.ranges?.[0]?.start ?? 0) : void 0;
      const x = await api.studioTargetAdd(projectId, { refId: r.id, t });
      setSel(x.id);
      setRefs(null);
    });
  const patch = (id, p) => api.studioTargetUpdate(projectId, id, p).then(onChanged).catch(say);
  const remove = (id) =>
    api
      .studioTargetRemove(projectId, id)
      .then(() => {
        if (sel === id) setSel(null);
        onChanged();
      })
      .catch(say);
  const setting = (p) => api.studioMatchSettings(projectId, p).then(onChanged).catch(say);
  const start = (resume) => api.studioLoopStart(projectId, { resume }).then(onChanged).catch(say);
  const stop = () => api.studioLoopStop(projectId).then(onChanged).catch(say);
  const critic = () =>
    act("The critic is judging…", () =>
      api
        .studioCritic(projectId)
        .then((r) => toast(`The critic scored v${r.v}: ${r.value} (${r.opened} new issue${r.opened === 1 ? "" : "s"}).`)),
    );
  return (
    <div className="sd-match" aria-label="Match loop">
      <div className="sd-match-row">
        <span
          className="sd-match-h"
          title="The frames the style must match: each one is compared with the version's frame at its view, frame and moment"
        >
          <Target size={13} />
          Targets
        </span>
        <div className="sd-tg-list">
          {targets.map((x) => (
            <button
              key={x.id}
              className={`sd-tg ${x.aspect === "9:16" ? "tall" : ""} ${sel === x.id ? "on" : ""}`}
              data-target={x.id}
              onClick={() => setSel(sel === x.id ? null : x.id)}
              title={`${x.label}
${x.view} · ${x.aspect} · ${x.t.toFixed(1)} s`}
            >
              {x.url ? (
                <img src={x.url} alt="" />
              ) : (
                <span className="sd-tg-none">
                  <Target size={14} />
                </span>
              )}
              <small>
                {x.id}
                {" · "}
                {x.t.toFixed(1)}s
              </small>
            </button>
          ))}
          <button className="btn tiny sd-tg-add" onClick={addFile} disabled={!!working || full}>
            <Plus size={11} />
            Image…
          </button>
          <button className={`btn tiny sd-tg-ref ${refs ? "active" : ""}`} onClick={toggleRefs} disabled={!!working || full}>
            <Film size={11} />
            From a reference
          </button>
          <button
            className="btn tiny sd-tg-gen"
            onClick={() => setGen(true)}
            disabled={!!working || full}
            title="Drawn on your image account from the brief and the style's notes (counts against the picture cap)"
          >
            <Sparkles size={11} />
            Make some…
          </button>
          {working && (
            <span className="small row" style={{ gap: 6 }}>
              <Spinner size={12} />
              {working}
            </span>
          )}
        </div>
      </div>
      {refs && (
        <div className="sd-tg-refs" aria-label="References">
          {!refs.length && (
            <span className="small">No image or video references in this workspace yet: add them in the Brief (References).</span>
          )}
          {refs.map((r) => (
            <div key={r.id} className="sd-tg-refrow">
              <span className="sd-tg-tag">{r.tag}</span>
              <span className="ellipsis small grow" title={r.path}>
                {r.label || r.name}
              </span>
              {r.kind === "video" && (
                <label className="small row" style={{ gap: 4 }}>
                  {"at "}
                  <input
                    className="input compact sd-num"
                    type="number"
                    min={0}
                    step={0.1}
                    aria-label={`Second of ${r.tag}`}
                    value={refT[r.id] ?? String(r.ranges?.[0]?.start ?? 0)}
                    onChange={(e) => setRefT((m) => ({ ...m, [r.id]: e.target.value }))}
                  />
                  {" s"}
                </label>
              )}
              <button className="btn tiny" onClick={() => addRef(r)} disabled={!!working}>
                <Plus size={11} />
                Add
              </button>
            </div>
          ))}
        </div>
      )}
      {cur && (
        <div className="sd-tg-edit" aria-label={`Target ${cur.id}`}>
          <b>{cur.id}</b>
          <span className="ellipsis small sd-tg-label" title={cur.label}>
            {cur.label}
          </span>
          <select className="input compact" aria-label="View" value={cur.view} onChange={(e) => patch(cur.id, { view: e.target.value })}>
            {viewNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {S.aspects.length > 1 && (
            <select
              className="input compact"
              aria-label="Frame"
              value={cur.aspect}
              onChange={(e) => patch(cur.id, { aspect: e.target.value })}
            >
              {S.aspects.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
          <NumIn
            label="Seconds"
            value={cur.t}
            min={0}
            max={S.views[cur.view]?.end ?? 600}
            step={0.1}
            onCommit={(n) => patch(cur.id, { t: n })}
          />
          <span className="small">s</span>
          <button
            className="btn tiny sd-tg-here"
            onClick={() => patch(cur.id, { view, aspect, t: +getTime().toFixed(2) })}
            title="Match it to the moment the preview shows now"
          >
            <Crosshair size={11} />
            Here ({view} {getTime().toFixed(1)}
            {" s)"}
          </button>
          <button className="btn tiny" onClick={() => onSeek(cur)}>
            Show
          </button>
          <button className="btn tiny" onClick={() => onShow(cur.id)}>
            Overlays
          </button>
          <span className="grow" />
          <button className="icon-btn sm" aria-label={`Remove ${cur.id}`} title="Remove this target" onClick={() => remove(cur.id)}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="sd-match-row sd-loop">
        <span className="sd-match-h">
          <Repeat size={13} />
          Run until good
        </span>
        <label className="small sd-loop-set">
          {"score ≥ "}
          <NumIn
            label="Score to reach"
            value={loop?.threshold ?? 8}
            min={1}
            max={10}
            step={0.5}
            onCommit={(n) => setting({ threshold: n })}
          />
        </label>
        <label className="small sd-loop-set">
          {"critic every "}
          <NumIn label="Critic every N passes" value={loop?.every ?? 3} min={1} max={20} onCommit={(n) => setting({ every: n })} />
          {" passes"}
        </label>
        <label className="small sd-loop-set">
          {"at most "}
          <NumIn label="Pass cap" value={loop?.cap ?? 12} min={1} max={60} onCommit={(n) => setting({ cap: n })} />
          {" passes"}
        </label>
        <label
          className="small sd-loop-set"
          title="Stop when this many critics in a row score within ±0.5 of each other (more passes rarely help then). 0 = never."
        >
          {"plateau after "}
          <NumIn
            label="Plateau: critics in a row within half a point"
            value={loop?.plateau ?? 3}
            min={0}
            max={6}
            onCommit={(n) => setting({ plateau: n })}
          />
          {" critics"}
        </label>
        <span className="grow" />
        <button
          className="btn tiny sd-critic"
          onClick={critic}
          disabled={claudeBusy || jobBusy || !!working}
          title="One critic round on the latest version, without the loop"
        >
          <ScanEye size={11} />
          Run critic
        </button>
        {running ? (
          <button className="btn tiny danger sd-loop-stop" onClick={stop} disabled={loop.status === "stopping"}>
            <Square size={10} />
            {loop.status === "stopping" ? "Stopping…" : "Stop"}
          </button>
        ) : loop?.critic ? (
          <button className="btn tiny danger sd-loop-stop" onClick={stop}>
            <Square size={10} />
            Stop the critic
          </button>
        ) : (
          <>
            {canResume && (
              <button className="btn tiny sd-loop-resume" onClick={() => start(true)} disabled={claudeBusy}>
                {"Resume (pass "}
                {loop.pass + 1})
              </button>
            )}
            <button className="btn tiny primary sd-loop-start" onClick={() => start(false)} disabled={claudeBusy || !!working}>
              <Repeat size={11} />
              {canResume ? "Start over" : "Run until good"}
            </button>
          </>
        )}
      </div>
      <div className={`sd-loop-status small ${loop?.status === "failed" ? "bad" : loop?.status === "done" ? "ok" : ""}`} role="status">
        {loopText(loop)}
      </div>
      {gen && <GenerateTargets projectId={projectId} onClose={() => setGen(false)} onDone={onChanged} />}
    </div>
  );
}
function GenerateTargets({ projectId, onClose, onDone }) {
  const { toast } = useApp();
  const [n, setN] = useState(2),
    [q, setQ] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .studioTargetsQuote(projectId, n)
      .then(setQ)
      .catch(() => setQ(null));
  }, [n]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.studioTargetsGenerate(projectId, n);
      toast(`Made ${r.length} target frame${r.length === 1 ? "" : "s"}.`);
      onDone();
      onClose();
    } catch (e) {
      toast(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
      setBusy(false);
      onDone();
    }
  };
  return (
    <Modal title="Make target frames" onClose={onClose} className="sd-gen-modal">
      <div className="modal-body col" style={{ gap: 12 }}>
        <p className="small">
          The app draws them on your image account from the brief's description and the style's notes, one per shot of the main view. They
          are ideal frames, not one consistent camera: frames from your own references are better targets when you have them.
        </p>
        <div className="row" style={{ gap: 10 }}>
          <label htmlFor="sd-gen-n">How many</label>
          <select id="sd-gen-n" className="input compact" value={n} onChange={(e) => setN(+e.target.value)} disabled={busy}>
            {[1, 2, 3, 4].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        {q && (
          <p className="sd-quote">
            {q.count}
            {" picture"}
            {q.count === 1 ? "" : "s"}
            {", about "}
            <b>${q.cost.toFixed(2)}</b>
            {" on your image account. The picture cap has "}
            <b>{q.left}</b>
            {" of "}
            {q.cap}
            {" left."}
          </p>
        )}
        {q && !q.provider && (
          <p className="sd-gen-warn small">
            <TriangleAlert size={13} />
            {"No image account is set up: add a Higgsfield or Fal.ai key in Settings > Media > Image generation."}
          </p>
        )}
        {q && q.provider && !q.notes && (
          <p className="sd-gen-warn small">
            <TriangleAlert size={13} />
            There is nothing to draw them from yet: write the description in the Brief, or fill the style's notes first.
          </p>
        )}
        {q && q.provider && q.notes && !q.fits && (
          <p className="sd-gen-warn small">
            <TriangleAlert size={13} />
            {q.room < q.count
              ? `Only ${q.room} more target${q.room === 1 ? "" : "s"} fit (8 at most).`
              : "That is more than the picture cap leaves: raise the cap in the Brief."}
          </p>
        )}
        <div className="modal-actions">
          <span className="grow" />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary sd-gen-go" onClick={go} disabled={!q || !q.fits || !q.provider || !q.notes || busy}>
            {busy ? <Spinner size={14} /> : <Sparkles size={15} />}
            {"Make "}
            {n}
            {" for about $"}
            {(q?.cost ?? 0).toFixed(2)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
function CompareDialog({ versions, aspects, aspect: a0, view, projectId, busy, onClose, onBack }) {
  const { toast } = useApp();
  const [a, setA] = useState(versions[versions.length - 2].v),
    [b, setB] = useState(versions[versions.length - 1].v),
    [aspect, setAspect] = useState(a0);
  const [k, setK] = useState(50),
    [n, setN] = useState(0),
    [sure, setSure] = useState(false),
    [going, setGoing] = useState(false);
  const A = versions.find((x) => x.v === a),
    B = versions.find((x) => x.v === b);
  const fa = A?.renders?.[aspect]?.frames ?? [],
    fb = B?.renders?.[aspect]?.frames ?? [];
  const pairs = useMemo(
    () =>
      fb
        .map((f) => ({ b: f, a: fa.find((x) => x.view === f.view && Math.abs(x.t - f.t) < 0.02) }))
        .filter((p2) => p2.a)
        .sort((x, y) => (x.b.view === view ? 0 : 1) - (y.b.view === view ? 0 : 1) || x.b.view.localeCompare(y.b.view) || x.b.t - y.b.t),
    [a, b, aspect],
  );
  const p = pairs[Math.min(n, pairs.length - 1)];
  useEffect(() => {
    setN(0);
  }, [a, b, aspect]);
  const hasMatch = versions.some((x) => x.match?.targets.length);
  const [tab, setTab] = useState("frames"),
    [mk, setMk] = useState("side"),
    [mt, setMt] = useState(null);
  const ma = A?.match?.targets ?? [],
    mb = B?.match?.targets ?? [],
    mids = [...new Set([...mb, ...ma].map((x) => x.id))],
    mid = mt && mids.includes(mt) ? mt : mids[0];
  const scored = versions.filter((x) => x.score);
  const back = async () => {
    if (!sure) {
      setSure(true);
      return;
    }
    setGoing(true);
    try {
      await api.studioRollback(projectId, a);
      toast(`Back to v${a}: its files are restored as a new version. Lessons are kept.`);
      onBack();
    } catch (e) {
      toast(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
      setGoing(false);
      setSure(false);
    }
  };
  const vsel = (val, set, label) => (
    <select className="input compact" aria-label={label} value={val} onChange={(e) => set(+e.target.value)}>
      {[...versions].reverse().map((x) => (
        <option key={x.v} value={x.v}>
          v{x.v}
          {" · "}
          {x.label}
        </option>
      ))}
    </select>
  );
  return (
    <Modal title="Compare versions" wide onClose={onClose} className="sd-cmp-modal">
      <div className="modal-body col" style={{ gap: 12 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          {vsel(a, setA, "Before")}
          <span className="dim">→</span>
          {vsel(b, setB, "After")}
          {aspects.length > 1 && (
            <div className="seg-ctl" role="radiogroup" aria-label="Frame">
              {aspects.map((x) => (
                <button key={x} role="radio" aria-checked={aspect === x} className={aspect === x ? "on" : ""} onClick={() => setAspect(x)}>
                  {x}
                </button>
              ))}
            </div>
          )}
          {hasMatch && (
            <div className="seg-ctl sd-cmp-tab" role="radiogroup" aria-label="Compare what">
              {["frames", "match"].map((x) => (
                <button key={x} role="radio" aria-checked={tab === x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>
                  {x === "frames" ? "Frames" : "Match"}
                </button>
              ))}
            </div>
          )}
          <span className="grow" />
          <span className="small">
            v{a}
            {": "}
            {A?.open ?? 0}
            {" open"}
            {A?.score ? ` · score ${A.score.value}` : ""}
            {" · v"}
            {b}
            {": "}
            {B?.open ?? 0}
            {" open"}
            {B?.score ? ` · score ${B.score.value}` : ""}
          </span>
        </div>
        {tab === "match" ? (
          <div className="sd-cmp-match" aria-label="Match">
            <div className="row wrap" style={{ gap: 8 }}>
              {mids.length > 1 && (
                <div className="seg-ctl tiny" role="radiogroup" aria-label="Target">
                  {mids.map((x) => (
                    <button key={x} role="radio" aria-checked={x === mid} className={x === mid ? "on" : ""} onClick={() => setMt(x)}>
                      {x}
                    </button>
                  ))}
                </div>
              )}
              <div className="seg-ctl tiny" role="radiogroup" aria-label="Overlay">
                {MATCH_KINDS.map(([k22, l, tip]) => (
                  <button
                    key={k22}
                    role="radio"
                    aria-checked={mk === k22}
                    className={mk === k22 ? "on" : ""}
                    title={tip}
                    onClick={() => setMk(k22)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="sd-cmp-mcols">
              {[
                [A, a, ma],
                [B, b, mb],
              ].map(([V, vn, l]) => {
                const x = l.find((y) => y.id === mid);
                return (
                  <figure key={`${vn}-${V?.v}`} className={x?.aspect === "9:16" ? "tall" : ""}>
                    <figcaption>
                      v{vn}
                      {V?.score ? (
                        <>
                          {" · score "}
                          <b>{V.score.value}</b>
                        </>
                      ) : (
                        " · not scored"
                      )}
                      {x ? ` · ${Math.round(x.diff * 100)}% different` : ""}
                    </figcaption>
                    {!x ? (
                      <div className="muted small sd-cmp-none">
                        {"No overlays of "}
                        {mid}
                        {" in v"}
                        {vn}.
                      </div>
                    ) : mk === "colours" ? (
                      <RegionTable regions={x.regions} />
                    ) : mk === "crops" ? (
                      <div className="sd-cmp-crops">
                        {x.crops.map((c) => (
                          <img key={c.file} src={c.url} alt="" loading="lazy" />
                        ))}
                      </div>
                    ) : (
                      <img src={x.urls[mk]} alt="" />
                    )}
                  </figure>
                );
              })}
            </div>
            {scored.length > 0 && (
              <div className="sd-score-hist" aria-label="Score history">
                <span className="small">The critic's scores:</span>
                {scored.map((x) => (
                  <span key={x.v} className={`sd-chip ${x.v === a || x.v === b ? "look" : ""}`} title={x.score.summary}>
                    v{x.v} <b>{x.score.value}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : p ? (
          <>
            <div className={`compare sd-cmp ${aspect === "9:16" ? "tall" : ""}`} aria-label="Before and after">
              <img src={p.b.url} alt={`v${b}`} />
              <img src={p.a.url} alt={`v${a}`} style={{ clipPath: `inset(0 ${100 - k}% 0 0)` }} />
              <i style={{ left: `${k}%` }} />
              <span className="l">v{a}</span>
              <span className="r">v{b}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={k}
                onChange={(e) => setK(+e.target.value)}
                aria-label="Slide between the two versions"
              />
            </div>
            <div className="sd-cmp-pairs">
              {pairs.map((q, i) => (
                <button
                  key={q.b.file}
                  className={`sd-cmp-pair ${i === n ? "on" : ""} ${aspect === "9:16" ? "tall" : ""}`}
                  onClick={() => setN(i)}
                  title={`${q.b.view} at ${fmtT(q.b.t)}`}
                >
                  <img src={q.a.url} alt="" loading="lazy" />
                  <img src={q.b.url} alt="" loading="lazy" />
                  <small>
                    {q.b.view} {q.b.t.toFixed(1)}
                  </small>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            {"These two versions have no frames of the same moment in "}
            {aspect}.
          </p>
        )}
        {A?.renders?.[aspect]?.mp4Url && B?.renders?.[aspect]?.mp4Url && (
          <div className="sd-cmp-videos">
            <video src={A.renders[aspect].mp4Url} controls muted playsInline />
            <video src={B.renders[aspect].mp4Url} controls muted playsInline />
          </div>
        )}
        <div className="modal-actions">
          <span className="small grow">
            {sure ? `The files go back to v${a} (as a new version). Issues fixed after it open again; lessons are kept.` : ""}
          </span>
          <button className={`btn ${sure ? "danger" : ""} sd-rollback`} onClick={back} disabled={busy || going}>
            {going ? <Spinner size={14} /> : <Undo2 size={15} />}
            {sure ? `Yes, go back to v${a}` : `Go back to v${a}`}
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
