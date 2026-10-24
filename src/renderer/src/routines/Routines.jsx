import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  ClapperboardIcon,
  CopyIcon,
  DownloadIcon,
  FilePlusCornerIcon,
  FileUpIcon,
  FolderOpenIcon,
  LayersIcon,
  LoaderCircleIcon,
  MonitorPlayIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TrashIcon,
  TriangleAlertIcon,
  UploadIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import { api, isMyLook, isOwnStyle, offeredLook, on } from "../lib/api";
import { ago, fmtLength, parseLength } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { isMac } from "../help/keys";
import { Modal, Spinner, Toggle } from "../components/ui";
import { CLAUDE_EFFORTS } from "../engines/claudeModels";
import { engineOf, modelName } from "../engines/models";
import { useGoogleState } from "../engines/ExperimentalGoogle";
import { useCodexState } from "../engines/ChatGPTEngine";
import { EffortSelect, ModelSelect } from "../engines/ModelSelect";
import { Segmented } from "../components/Picker";
import { LanguagePicker } from "../settings/LanguagePicker";
import { BrandColor } from "../settings/project/SettingsControls";
import { ProjectChoicesForm, choicesSummary, mergeChoices } from "../settings/project/ProjectChoicesForm";
import { fitSettings } from "../thumbnails/board";
import { ModelSelects } from "../thumbnails/ModelSelects";
import { isFormatTwin } from "../looks/lookFormat";
import { LengthField } from "../projects/NewProject";
import {
  BUILD_COST,
  BUILD_EXTRAS,
  CATEGORY_LABEL,
  IMAGE_SERVICE_NAMES,
  NODE,
  SCRIPT_PRESETS,
  TEMPLATES,
  extrasFor,
  levelExtras,
  nodeLevel,
  qualityLevels,
  serviceFor,
  topicFormatOf,
  upstreamStyles,
  variantName,
  writeSkillLine,
} from "./nodes";
import { QualitySlider } from "../editor/panels/EffortSlider";
import { ICONS } from "./summary";
import { RoutineCanvas } from "./RoutineCanvas";
import { demoFrame, makeDemo } from "./demo";

const LAST = "cz-routine";
const FILE_MANAGER = isMac ? "Finder" : "Explorer";
const RUN_LABEL = {
  running: "Running",
  done: "Finished",
  partial: "Finished with problems",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  waiting: "Waiting",
};
const ITEM_LABEL = {
  waiting: "Waiting",
  running: "Working",
  done: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Not made",
  approval: "Needs your approval",
  rejected: "Rejected",
  interrupted: "Interrupted",
};
export function Routines() {
  const { toast, channels, openProject, refreshProjects, allProjects } = useApp();
  const [list, setList] = useState(null);
  const [cur, setCur] = useState(null);
  const [graph, setGraphState] = useState(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [ctx, setCtx] = useState(null);
  const [styles, setStyles] = useState([]);
  const [looks, setLooks] = useState([]);
  const [problems, setProblems] = useState([]);
  const [runs, setRuns] = useState([]);
  const [realRun, setRun] = useState(null);
  const [demo, setDemo] = useState(null);
  const [demoSpeed, setDemoSpeed] = useState(() => {
    try {
      return +(localStorage.getItem("cz-demo-speed") || 8) || 8;
    } catch {
      return 8;
    }
  });
  const [, setDemoTick] = useState(0);
  useEffect(() => {
    if (!demo) return;
    const i = setInterval(() => setDemoTick((x) => x + 1), 100);
    return () => clearInterval(i);
  }, [demo]);
  const run = demo ? demoFrame(demo).run : realRun;
  const [itemId, setItemId] = useState(null);
  const [drawer, setDrawer] = useState(true);
  const [finding, setFinding] = useState(null);
  const [qy, setQ] = useState("");
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return localStorage.getItem("cz-routines-rail") !== "closed";
    } catch {
      return true;
    }
  });
  const toggleRail = () =>
    setRailOpen((o) => {
      try {
        localStorage.setItem("cz-routines-rail", o ? "closed" : "open");
      } catch {}
      return !o;
    });
  const [starting, setStarting] = useState(false);
  const [confirmRun, setConfirmRun] = useState(null);
  const canvas = useRef(null);
  const gRef = useRef(null);
  gRef.current = graph;
  const past = useRef([]),
    future = useRef([]);
  const loadList = useCallback(
    () =>
      api
        .routines()
        .then(setList)
        .catch((e) => toast(e.message, "bad")),
    [toast],
  );
  const loadCtx = useCallback(
    () =>
      api
        .routineContext()
        .then(setCtx)
        .catch(() => {}),
    [],
  );
  const open = useCallback(
    async (id, pick) => {
      flush();
      try {
        const r = await api.routine(id);
        setCur(r);
        setName(r.name);
        setGraphState(r.graph);
        past.current = [];
        future.current = [];
        setSelected(new Set());
        setRun(null);
        setItemId(pick?.itemId ?? null);
        try {
          localStorage.setItem(LAST, id);
        } catch {}
        api
          .routineRuns(id)
          .then((rs) => {
            setRuns(rs);
            const live = rs.find((x) => x.id === pick?.runId) ?? rs.find((x) => x.live) ?? rs[0];
            if (live)
              api
                .routineRunGet(live.id)
                .then(setRun)
                .catch(() => {});
          })
          .catch(() => {});
      } catch (e) {
        toast(e.message, "bad");
      }
    },
    [toast],
  );
  const showVideo = (routineId, runId, id) => {
    if (cur?.id !== routineId) {
      open(routineId, { runId, itemId: id });
      return;
    }
    api
      .routineRunGet(runId)
      .then((x) => {
        setRun(x);
        setItemId(id);
        setDrawer(true);
      })
      .catch((e) => toast(e.message, "bad"));
  };
  const [folded, setFolded] = useState(new Set());
  useEffect(() => {
    loadCtx();
    api
      .styles()
      .then((s) => setStyles(s.filter((x) => !x.lab && !x.hidden && (x.custom ? !x.missing : !x.legacy))))
      .catch(() => {});
    api
      .presets()
      .then(setLooks)
      .catch(() => {});
    api
      .routines()
      .then((l) => {
        setList(l);
        let last = null;
        try {
          last = localStorage.getItem(LAST);
        } catch {}
        const pick = l.find((x) => x.id === last) ?? l[0];
        if (pick) open(pick.id);
      })
      .catch((e) => toast(e.message, "bad"));
  }, []);
  const listT = useRef(0);
  useEffect(() => {
    const offs = [
      on("routines:changed", () => {
        loadList();
      }),
      on("routines:finding", (f) => setFinding(f)),
      on("routines:item", (it) => {
        setRun((r) =>
          r && r.id === it.runId
            ? { ...r, items: r.items.some((x) => x.id === it.id) ? r.items.map((x) => (x.id === it.id ? it : x)) : [...r.items, it] }
            : r,
        );
        if (!listT.current)
          listT.current = window.setTimeout(() => {
            listT.current = 0;
            loadList();
          }, 1500);
      }),
      on("routines:run", (e) => {
        if (!cur) return;
        api
          .routineRuns(cur.id)
          .then(setRuns)
          .catch(() => {});
        setRun((r) => {
          if (r && r.id === e.runId)
            api
              .routineRunGet(e.runId)
              .then(setRun)
              .catch(() => {});
          else if (!r)
            api
              .routineRunGet(e.runId)
              .then((x) => x.routineId === cur.id && setRun(x))
              .catch(() => {});
          return r;
        });
        if (e.status !== "running") refreshProjects().catch(() => {});
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [cur?.id]);
  const saveT = useRef(0),
    pending = useRef(null),
    owner = useRef(null);
  owner.current = cur?.id ?? null;
  const flush = () => {
    clearTimeout(saveT.current);
    const p = pending.current;
    pending.current = null;
    if (p)
      api
        .routineSave(p.id, { graph: p.graph })
        .then(() => loadList())
        .catch((e) => toast(e.message, "bad"));
  };
  const persist = (g) => {
    const id = owner.current;
    if (!id) return;
    clearTimeout(saveT.current);
    pending.current = { id, graph: g };
    saveT.current = window.setTimeout(flush, 500);
  };
  const update = useCallback((fn, record = false) => {
    setGraphState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      if (next === prev) return prev;
      if (record) {
        past.current.push(prev);
        if (past.current.length > 150) past.current.shift();
        future.current = [];
      }
      persist(next);
      return next;
    });
  }, []);
  const undo = () => {
    const p = past.current.pop();
    if (!p || !gRef.current) return;
    future.current.push(gRef.current);
    const d = { ...p, view: gRef.current.view };
    setGraphState(d);
    persist(d);
  };
  const redo = () => {
    const f = future.current.pop();
    if (!f || !gRef.current) return;
    past.current.push(gRef.current);
    const d = { ...f, view: gRef.current.view };
    setGraphState(d);
    persist(d);
  };
  useEffect(() => () => flush(), []);
  useEffect(() => {
    if (!graph) return;
    const t = setTimeout(
      () =>
        api
          .routineCheck(graph)
          .then(setProblems)
          .catch(() => {}),
      350,
    );
    return () => clearTimeout(t);
  }, [graph?.nodes, graph?.edges, ctx]);
  const byNode = useMemo(() => {
    const m = new Map();
    for (const p of problems) if (p.nodeId) m.set(p.nodeId, [...(m.get(p.nodeId) ?? []), p.text]);
    return m;
  }, [problems]);
  const errors = problems.filter((p) => !p.warn),
    warnTexts = useMemo(() => new Set(problems.filter((p) => p.warn).map((p) => p.text)), [problems]);
  const create = async (template) => {
    try {
      const t = template ? TEMPLATES.find((x) => x.id === template) : null;
      const r = await api.routineCreate(t?.name ?? "New routine", template);
      await loadList();
      await open(r.id);
      setTimeout(() => canvas.current?.fit(false), 60);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const rename = async (v) => {
    if (!cur || v.trim() === cur.name) return;
    try {
      const r = await api.routineSave(cur.id, { name: v });
      setCur((c) => c && { ...c, name: r.name });
      setName(r.name);
      loadList();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const remove = async (id) => {
    const r = list?.find((x) => x.id === id);
    if (!r || !confirm(`Delete the routine “${r.name}”? Its runs go too; the videos it made stay.`)) return;
    try {
      await api.routineDelete(id);
      const l = await api.routines();
      setList(l);
      if (cur?.id === id) {
        setCur(null);
        setGraphState(null);
        setRuns([]);
        setRun(null);
        if (l[0]) open(l[0].id);
      }
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const duplicate = async (id) => {
    try {
      flush();
      const r = await api.routineDuplicate(id);
      await loadList();
      open(r.id);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const saveSettings = async (patch) => {
    if (!cur) return;
    const s = { ...cur.settings, ...patch };
    setCur({ ...cur, settings: s });
    try {
      const r = await api.routineSave(cur.id, { settings: s });
      setCur((c) => c && { ...c, settings: r.settings });
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const exportJson = () => {
    if (!cur || !graph) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { kind: "videoxx-routine", version: 1, name: cur.name, graph: { ...graph, view: void 0 }, settings: cur.settings },
          null,
          1,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${cur.name.replace(/[^\w -]+/g, "").trim() || "routine"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2e3);
  };
  const importRef = useRef(null);
  const importJson = async (f) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await api.routineImport(data);
      await loadList();
      open(r.id);
      toast(`Imported “${r.name}”. Check the channels and files it uses.`, "ok");
    } catch (e) {
      toast(e instanceof SyntaxError ? "That file is not a routine (.json exported from Routines)." : e.message, "bad");
    }
  };
  const start = async (force = false, parallel = false) => {
    if (!cur || !graph) return;
    flush();
    if (errors.length) {
      setConfirmRun({ problems: errors, parallel });
      return;
    }
    const warns = problems.filter((p) => p.warn);
    if (warns.length && !force) {
      setConfirmRun({ problems: warns, parallel });
      return;
    }
    setConfirmRun(null);
    setStarting(true);
    try {
      await new Promise((r2) => setTimeout(r2, 120));
      const { runId } = await api.routineRun(cur.id, parallel);
      const r = await api.routineRunGet(runId);
      setRun(r);
      setItemId(null);
      setDrawer(true);
      api.routineRuns(cur.id).then(setRuns);
      loadList();
      if (parallel) toast("Parallel build started: each build is listed under the routine on the left.", "ok");
    } catch (e) {
      toast(e.message.split("\n")[0], "bad");
    } finally {
      setStarting(false);
    }
  };
  const effortTest = async (variants, audio) => {
    if (!cur || !graph) return;
    flush();
    if (errors.length && !audio?.length) {
      setConfirmRun({ problems: errors });
      return;
    }
    setStarting(true);
    try {
      await new Promise((r2) => setTimeout(r2, 120));
      const { runIds } = await api.routineEffortTest(cur.id, variants, audio);
      const r = await api.routineRunGet(runIds[0]);
      setRun(r);
      setItemId(null);
      setDrawer(true);
      api.routineRuns(cur.id).then(setRuns);
      loadList();
      toast(
        `Effort test started: ${runIds.length} builds of the same video, one per variant. Each is listed under the routine on the left.`,
        "ok",
      );
    } catch (e) {
      toast(e.message.split("\n")[0], "bad");
    } finally {
      setStarting(false);
    }
  };
  const testLevels = useMemo(() => {
    const b = graph?.nodes.find((n) => n.type === "buildVideo" && !n.off);
    if (!b || !graph) return null;
    const bases = [
      ...new Set(
        upstreamStyles(graph, b.id).map((id) => {
          const st = styles.find((x) => x.id === id);
          return st?.base ?? st?.id ?? id;
        }),
      ),
    ];
    const levels = qualityLevels(bases.length === 1 ? bases[0] : null),
      lv = nodeLevel(b.settings);
    return { levels, current: levels.find((l) => l.key === lv)?.name ?? "Standard" };
  }, [graph, styles]);
  const liveRun = demo ? (run?.live ? { id: "demo" } : void 0) : runs.find((r) => r.live);
  const liveCount = demo ? (run?.live ? 1 : 0) : runs.filter((r) => r.live).length;
  const startDemo = async () => {
    if (!cur || !graph) return;
    flush();
    let last = null;
    for (const r of runs.filter((x) => !x.live)) {
      try {
        const x = await api.routineRunGet(r.id);
        if (x.items.some((i) => Object.values(i.nodes).some((s) => s.status === "done"))) {
          last = x;
          break;
        }
      } catch {}
    }
    setItemId(null);
    setDrawer(true);
    setSelected(new Set());
    setDemo(makeDemo(graph, last, demoSpeed));
  };
  const setSpeed = (v) => {
    setDemoSpeed(v);
    try {
      localStorage.setItem("cz-demo-speed", String(v));
    } catch {}
    setDemo((d) => {
      if (!d) return d;
      const t = Math.min(d.total, ((performance.now() - d.t0) / 1e3) * d.speed);
      return { ...d, speed: v, t0: performance.now() - (t / v) * 1e3 };
    });
  };
  useEffect(() => {
    setDemo(null);
  }, [cur?.id]);
  const demoStep =
    demo && run
      ? (run.items.flatMap((it) => Object.entries(it.nodes)).find(([, s]) => s.status === "running" || s.status === "approval")?.[0] ??
        null)
      : null;
  useEffect(() => {
    if (demoStep) canvas.current?.panTo(demoStep);
  }, [demoStep]);
  const delRun = (id) => {
    if (!cur) return;
    api
      .routineRunDelete(id)
      .then(() => {
        if (run?.id === id) setRun(null);
        api.routineRuns(cur.id).then(setRuns);
      })
      .catch((e) => toast(e.message, "bad"));
  };
  const cancel = async () => {
    const id = run?.live ? run.id : (liveRun?.id ?? run?.id);
    if (!id) return;
    try {
      await api.routineCancel(id);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const item =
    run?.items.find((x) => x.id === itemId) ??
    run?.items.find((x) => x.status === "running" || x.status === "approval") ??
    (run?.items.length ? run.items[run.items.length - 1] : null);
  const sourcesWorking =
    run?.live && !run.items.length
      ? Object.fromEntries(
          (run.graph.nodes ?? [])
            .filter((n) => NODE[n.type]?.accepts === null && NODE[n.type]?.out && !n.off)
            .map((n) => [n.id, { status: "running", startedAt: run.startedAt, log: finding?.runId === run.id ? [finding.line] : [] }]),
        )
      : null;
  const states = item ? item.nodes : sourcesWorking;
  const thumbOf = item?.projectId && item.ctx?.thumbnail ? (allProjects.find((p) => p.id === item.projectId)?.thumb ?? null) : null;
  const images = useMemo(
    () =>
      thumbOf && item
        ? Object.fromEntries(
            Object.entries(item.nodes)
              .filter(([id, s]) => ["done", "warn"].includes(s.status) && graph?.nodes.find((n) => n.id === id)?.type === "thumbnail")
              .map(([id]) => [id, thumbOf]),
          )
        : void 0,
    [thumbOf, item, graph?.nodes],
  );
  const showGraph = graph;
  const sctx = useMemo(
    () => ({
      channel: (id) => channels.find((c) => c.id === id)?.name ?? null,
      style: (id) => styles.find((s) => s.id === id)?.name ?? null,
      look: (id) => looks.find((l) => l.id === id)?.name ?? null,
      yt: (id) => ctx?.yt.find((y) => y.id === id)?.title ?? null,
      ytAny: (id) => ctx?.ytAll?.find((y) => y.id === id)?.title ?? null,
      skills: () => ctx,
    }),
    [channels, styles, looks, ctx],
  );
  const sel = selected.size === 1 ? (graph?.nodes.find((n) => selected.has(n.id)) ?? null) : null;
  const filtered = (list ?? []).filter((r) => !qy.trim() || r.name.toLowerCase().includes(qy.trim().toLowerCase()));
  return (
    <div className="rt-page">
      {!railOpen && (
        <aside className="rt-rail-mini">
          <button className="icon-btn" onClick={toggleRail} title="Show routines and templates" aria-label="Show routines and templates">
            <PanelLeftOpenIcon size={17} strokeWidth={1.7} />
          </button>
          <button className="icon-btn" onClick={() => create()} title="A new, empty routine" aria-label="New routine">
            <PlusIcon size={16} />
          </button>
        </aside>
      )}
      {railOpen && (
        <aside className="rt-rail">
          <div className="rt-rail-head">
            <h3>Routines</h3>
            <span className="grow" />
            <button className="btn small" onClick={() => create()} title="A new, empty routine">
              <PlusIcon size={14} />
              New
            </button>
            <button
              className="icon-btn"
              onClick={toggleRail}
              title="Hide routines and templates (more room for the canvas)"
              aria-label="Hide routines and templates"
            >
              <PanelLeftCloseIcon size={17} strokeWidth={1.7} />
            </button>
          </div>
          {(list?.length ?? 0) > 4 && (
            <div className="search rt-search">
              <SearchIcon size={14} />
              <input placeholder="Search routines" value={qy} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className="rt-list">
            {list === null ? (
              <div className="rt-empty">
                <Spinner />
              </div>
            ) : !list.length ? (
              <div className="rt-empty">No routines yet. Start from a template below, or a new one.</div>
            ) : (
              filtered.map((r) => {
                const vids = r.live ?? [],
                  unfolded = vids.length > 0 && !folded.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <div
                      className={`rt-item ${cur?.id === r.id ? "on" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => open(r.id)}
                      onKeyDown={(e) => e.key === "Enter" && open(r.id)}
                    >
                      <span className="rt-item-ic">
                        <WorkflowIcon size={15} />
                        {r.running && <i className="dot busy" />}
                      </span>
                      <span className="grow ellipsis">
                        <b className="ellipsis">{r.name}</b>
                        <small>
                          {r.running
                            ? vids.length > 1
                              ? `${vids.length} videos in the making`
                              : "Running now"
                            : r.nextRun
                              ? `Next run ${new Date(r.nextRun).toLocaleString([], {
                                  weekday: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`
                              : r.last_run_at
                                ? `Ran ${ago(r.last_run_at)}`
                                : `${r.nodes} node${r.nodes === 1 ? "" : "s"}`}
                        </small>
                      </span>
                      <span className="rt-item-tools">
                        <button
                          className="icon-btn"
                          title="Duplicate"
                          aria-label="Duplicate"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicate(r.id);
                          }}
                        >
                          <CopyIcon size={13} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Delete"
                          aria-label="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(r.id);
                          }}
                        >
                          <TrashIcon size={13} />
                        </button>
                      </span>
                      {vids.length > 0 && (
                        <button
                          className="icon-btn rt-fold"
                          data-rt-fold
                          title={unfolded ? "Hide the videos being made" : "Show the videos being made, one per project"}
                          aria-label={unfolded ? "Hide the videos being made" : "Show the videos being made"}
                          aria-expanded={unfolded}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolded((f) => {
                              const n = new Set(f);
                              if (n.has(r.id)) n.delete(r.id);
                              else n.add(r.id);
                              return n;
                            });
                          }}
                        >
                          {unfolded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
                        </button>
                      )}
                    </div>
                    {unfolded && (
                      <div className="rt-vids" data-rt-vids>
                        {vids.map((v) => {
                          const on2 = cur?.id === r.id && run?.id === v.runId && (v.itemId ? item?.id === v.itemId : true);
                          return (
                            <div
                              key={v.itemId ?? v.runId}
                              className={`rt-vid ${on2 ? "on" : ""}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => showVideo(r.id, v.runId, v.itemId)}
                              onKeyDown={(e) => e.key === "Enter" && showVideo(r.id, v.runId, v.itemId)}
                            >
                              <StatusDot s={v.status} />
                              <span className="grow ellipsis">
                                <b className="ellipsis">{v.label || "Video"}</b>
                                <small className="ellipsis">
                                  {v.status === "running"
                                    ? v.step || "Starting…"
                                    : v.status === "approval"
                                      ? "Waiting for your approval"
                                      : (ITEM_LABEL[v.status] ?? v.status)}
                                </small>
                              </span>
                              {v.projectId && (
                                <button
                                  className="icon-btn"
                                  title="Open this project in the editor"
                                  aria-label="Open in the editor"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openProject({ id: v.projectId, kind: "faceless" });
                                  }}
                                >
                                  <ClapperboardIcon size={12} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Fragment>
                );
              })
            )}
          </div>
          <div className="rt-tpl-head">Templates</div>
          <div className="rt-tpls">
            {TEMPLATES.map((t) => (
              <button key={t.id} className="rt-tpl" onClick={() => create(t.id)} title="Make a new routine from this template">
                <b>{t.name}</b>
                <small>{t.desc}</small>
              </button>
            ))}
          </div>
        </aside>
      )}
      <section className="rt-main">
        {!cur || !graph ? (
          <div className="rt-none">
            <WorkflowIcon size={30} strokeWidth={1.3} />
            <b>Make videos end to end, by themselves</b>
            <span>
              A routine is a chain of steps on a canvas: where topics come from, the script, the voice, the build, quality checks, the
              render, the thumbnail and publishing. Run it with one click or on a schedule.
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn small primary" onClick={() => create("explainer")}>
                <FilePlusCornerIcon size={14} />
                Start from a template
              </button>
              <button className="btn small" onClick={() => create()}>
                <PlusIcon size={14} />
                Empty routine
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="rt-top">
              <input
                className="rt-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={(e) => rename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                  if (e.key === "Escape") {
                    setName(cur.name);
                    e.target.blur();
                  }
                }}
                aria-label="Routine name"
              />
              <button
                className={`rt-check ${errors.length ? "bad" : problems.length ? "warn" : "ok"}`}
                onClick={() => {
                  setSelected(new Set());
                }}
                title={problems.map((p) => p.text).join("\n") || "Ready to run"}
              >
                {errors.length ? (
                  <>
                    <TriangleAlertIcon size={14} />
                    {errors.length}
                    {" to fix"}
                  </>
                ) : problems.length ? (
                  <>
                    <TriangleAlertIcon size={14} />
                    {problems.length}
                    {" warning"}
                    {problems.length === 1 ? "" : "s"}
                  </>
                ) : (
                  <>
                    <CircleCheckIcon size={14} />
                    Ready
                  </>
                )}
              </button>
              {cur.nextRun && (
                <span className="rt-sched" title="This routine runs by itself while the app is open">
                  <CalendarClockIcon size={14} />
                  {"Next "}
                  {new Date(cur.nextRun).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <span className="grow" />
              {!demo && (
                <button className="btn small ghost" onClick={() => importRef.current?.click()} title="Import a routine (.json)">
                  <FileUpIcon size={14} />
                  Import
                </button>
              )}
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  importJson(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {!demo && (
                <button className="btn small ghost" onClick={exportJson} title="Save this routine as a .json file to share or keep">
                  <DownloadIcon size={14} />
                  Export
                </button>
              )}
              {demo ? (
                <span className="rt-demo on">
                  <select className="input compact" value={demo.speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Demo speed">
                    {[4, 8, 16, 32].map((v) => (
                      <option key={v} value={v}>
                        {v}×
                      </option>
                    ))}
                  </select>
                  <button className="btn small" onClick={() => setDemo(null)} title="End the demo (nothing was changed)">
                    <SquareIcon size={13} />
                    End demo
                  </button>
                </span>
              ) : (
                !liveRun && (
                  <span
                    className="rt-demo"
                    title="Plays this routine's last run back on the canvas, sped up, for a recording. Nothing real happens."
                  >
                    <select className="input compact" value={demoSpeed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Demo speed">
                      {[4, 8, 16, 32].map((v) => (
                        <option key={v} value={v}>
                          {v}×
                        </option>
                      ))}
                    </select>
                    <button className="btn small ghost" onClick={startDemo}>
                      <MonitorPlayIcon size={14} />
                      Demo
                    </button>
                  </span>
                )
              )}
              {demo ? null : liveRun ? (
                <>
                  <button
                    className="btn small primary"
                    data-rt-parallel
                    onClick={() => start(false, true)}
                    disabled={starting}
                    title="Start another build of this routine now, next to the one going: it finds its own topic and makes its own video"
                  >
                    <LayersIcon size={13} />
                    Start parallel build
                  </button>
                  <button
                    className="btn small danger"
                    onClick={cancel}
                    title={liveCount > 1 ? "Cancel the build shown in Runs" : "Cancel this run"}
                  >
                    <SquareIcon size={13} />
                    Cancel run
                  </button>
                </>
              ) : (
                <button
                  className="btn small primary"
                  onClick={() => start()}
                  disabled={starting}
                  title={errors.length ? "Fix the problems first" : "Run this routine now"}
                >
                  {starting ? <Spinner size={13} /> : <PlayIcon size={13} />}Run
                </button>
              )}
            </div>
            <div className="rt-body">
              <div className="rt-canvas">
                {showGraph && (
                  <RoutineCanvas
                    key={cur.id}
                    ref={canvas}
                    graph={showGraph}
                    update={update}
                    undo={undo}
                    redo={redo}
                    selected={selected}
                    setSelected={setSelected}
                    states={states}
                    problems={byNode}
                    sctx={sctx}
                    images={images}
                  />
                )}
              </div>
              <aside className="rt-inspector">
                {sel ? (
                  <NodeInspector
                    key={sel.id}
                    n={sel}
                    graph={showGraph}
                    ctx={ctx}
                    styles={styles}
                    looks={looks}
                    problems={byNode.get(sel.id) ?? []}
                    warns={warnTexts}
                    state={states?.[sel.id] ?? null}
                    item={item}
                    onChange={(settings) =>
                      update(
                        (g) => ({
                          ...g,
                          nodes: g.nodes.map((x) => (x.id === sel.id ? { ...x, settings: { ...x.settings, ...settings } } : x)),
                        }),
                        false,
                      )
                    }
                    onOff={(off) => update((g) => ({ ...g, nodes: g.nodes.map((x) => (x.id === sel.id ? { ...x, off } : x)) }), true)}
                    onDelete={() => {
                      update(
                        (g) => ({
                          ...g,
                          nodes: g.nodes.filter((x) => x.id !== sel.id),
                          edges: g.edges.filter((e) => e.from !== sel.id && e.to !== sel.id),
                        }),
                        true,
                      );
                      setSelected(new Set());
                    }}
                    refreshCtx={loadCtx}
                  />
                ) : (
                  <RoutineInspector
                    settings={cur.settings}
                    onChange={saveSettings}
                    problems={problems}
                    show={(id) => {
                      setSelected(new Set([id]));
                      canvas.current?.centerOn(id);
                    }}
                    selected={selected.size}
                    onEffortTest={demo || liveRun || starting ? null : effortTest}
                    testLevels={testLevels}
                  />
                )}
              </aside>
            </div>
            <div className={`rt-runs ${drawer ? "open" : ""}`}>
              <button className="rt-runs-head" onClick={() => setDrawer(!drawer)}>
                <b>Runs</b>
                {liveRun ? (
                  <>
                    <span className="badge blue">
                      <LoaderCircleIcon size={11} className="spin" />
                      {liveCount > 1 ? `${liveCount} builds running` : "Running"}
                    </span>
                    <RunNow run={run?.live ? run : null} finding={finding} />
                  </>
                ) : runs[0] ? (
                  <small>
                    {RUN_LABEL[runs[0].status] ?? runs[0].status}
                    {" · "}
                    {ago(runs[0].startedAt)}
                  </small>
                ) : (
                  <small>Not run yet</small>
                )}
                <span className="grow" />
                {drawer ? <ChevronDownIcon size={15} /> : <ChevronUpIcon size={15} />}
              </button>
              {drawer && (
                <div className="rt-runs-body">
                  <div className="rt-run-list">
                    {demo && run && (
                      <button className="rt-run on">
                        <StatusDot s={run.status} />
                        <span className="grow ellipsis">
                          <b>{RUN_LABEL[run.status] ?? run.status}</b>
                          <small>
                            {new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </small>
                        </span>
                        <small>
                          {run.items.filter((i) => i.status === "done").length}/{run.items.length}
                        </small>
                      </button>
                    )}
                    {!demo && !runs.length && <div className="rt-empty">Press Run to make the first videos.</div>}
                    {!demo &&
                      runs.map((r) => (
                        <button
                          key={r.id}
                          className={`rt-run ${run?.id === r.id ? "on" : ""}`}
                          onClick={() => {
                            api
                              .routineRunGet(r.id)
                              .then((x) => {
                                setRun(x);
                                setItemId(null);
                              })
                              .catch((e) => toast(e.message, "bad"));
                          }}
                        >
                          <StatusDot s={r.status} />
                          <span className="grow ellipsis">
                            <b>{RUN_LABEL[r.status] ?? r.status}</b>
                            <small>
                              {new Date(r.startedAt).toLocaleString([], {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {r.trigger === "schedule"
                                ? " · scheduled"
                                : r.trigger?.startsWith("test:")
                                  ? ` · ${variantName({ level: r.trigger.split(":")[1], effort: r.trigger.split(":")[2] })}`
                                  : ""}
                            </small>
                          </span>
                          <small>
                            {r.counts.done ?? 0}/{Object.values(r.counts).reduce((a, b) => a + b, 0)}
                          </small>
                          {!r.live && (
                            <span
                              className="rt-run-del"
                              role="button"
                              tabIndex={0}
                              data-rt-run-del
                              title="Delete this run from the list (the videos stay)"
                              aria-label="Delete this run"
                              onClick={(e) => {
                                e.stopPropagation();
                                delRun(r.id);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  delRun(r.id);
                                }
                              }}
                            >
                              <TrashIcon size={12} />
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                  <div className="rt-items">
                    {run ? (
                      <>
                        <div className="rt-items-head">
                          <span className="grow ellipsis">
                            {run.summary ||
                              (run.live
                                ? `${run.items.length} video${run.items.length === 1 ? "" : "s"} · ${run.items.filter((i) => i.status === "done").length} done`
                                : RUN_LABEL[run.status])}
                          </span>
                          {!demo &&
                            !run.live &&
                            ["interrupted", "partial", "failed", "cancelled"].includes(run.status) &&
                            run.items.some((i) => !["done", "rejected"].includes(i.status)) && (
                              <button
                                className="btn tiny"
                                onClick={() =>
                                  api
                                    .routineResume(run.id)
                                    .then(() => api.routineRuns(cur.id).then(setRuns))
                                    .catch((e) => toast(e.message, "bad"))
                                }
                              >
                                <RotateCcwIcon size={12} />
                                Resume
                              </button>
                            )}
                          {!demo && !run.live && (
                            <button
                              className="btn tiny ghost"
                              title="Delete this run from the list (the videos stay)"
                              onClick={() =>
                                api
                                  .routineRunDelete(run.id)
                                  .then(() => {
                                    setRun(null);
                                    api.routineRuns(cur.id).then(setRuns);
                                  })
                                  .catch((e) => toast(e.message, "bad"))
                              }
                            >
                              <TrashIcon size={12} />
                            </button>
                          )}
                        </div>
                        {!run.items.length && (
                          <div className="rt-empty">
                            {run.live ? (
                              <>
                                <Spinner size={14} /> {finding?.runId === run.id ? finding.line : "Finding the topics…"}
                              </>
                            ) : (
                              "No videos in this run."
                            )}
                          </div>
                        )}
                        {run.items.map((it) => (
                          <ItemRow
                            key={it.id}
                            it={it}
                            run={run}
                            demo={!!demo}
                            on={item?.id === it.id}
                            pick={() => setItemId(it.id === itemId ? null : it.id)}
                            open={() => it.projectId && openProject({ id: it.projectId, kind: "faceless" })}
                            toast={toast}
                          />
                        ))}
                      </>
                    ) : (
                      <div className="rt-empty">Pick a run to see its videos.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>
      {confirmRun && (
        <Modal title={errors.length ? "Fix these first" : "Run anyway?"} onClose={() => setConfirmRun(null)}>
          <div className="modal-body">
            <ul className="rt-problems">
              {confirmRun.problems.map((p, i) => (
                <li key={i} className={p.warn ? "warn" : "bad"}>
                  <TriangleAlertIcon size={13} />
                  <span>{p.text}</span>
                  {p.nodeId && (
                    <button
                      className="btn tiny ghost"
                      onClick={() => {
                        setConfirmRun(null);
                        setSelected(new Set([p.nodeId]));
                        canvas.current?.centerOn(p.nodeId);
                      }}
                    >
                      Show
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="btn small ghost" onClick={() => setConfirmRun(null)}>
                Back
              </button>
              {!errors.length && (
                <button className="btn small primary" onClick={() => start(true, confirmRun.parallel)}>
                  <PlayIcon size={13} />
                  Run anyway
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
const StatusDot = ({ s }) =>
  s === "running" ? <LoaderCircleIcon size={13} className="spin rt-spin" /> : <span className={`rt-dot ${s}`} />;
const BUILTIN_VOICES = [
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian (deep male narrator)" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam (male, dominant)" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel (male, British broadcaster)" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George (male, warm storyteller)" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie (male, natural)" },
  { id: "EXAVITQu4vr4xnxePrK2", name: "Sarah (female, soft)" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda (female, warm)" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura (female, upbeat)" },
];
function useTick(on2) {
  const [, t] = useState(0);
  useEffect(() => {
    if (!on2) return;
    const i = setInterval(() => t((x) => x + 1), 1e3);
    return () => clearInterval(i);
  }, [on2]);
}
const dur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1e3));
  return s >= 3600
    ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
    : s >= 60
      ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
      : `${s}s`;
};
function progressOf(it, run) {
  const order = Object.keys(it.nodes).filter((id) => !run.graph.nodes.find((n) => n.id === id)?.off);
  const done = order.filter((id) => ["done", "warn"].includes(it.nodes[id].status)).length;
  const curId =
    order.find((id) => ["running", "approval"].includes(it.nodes[id].status)) ?? order.find((id) => it.nodes[id].status === "failed");
  const label = curId ? (NODE[run.graph.nodes.find((n) => n.id === curId)?.type ?? ""]?.label ?? "") : "";
  return { done, total: order.length, label, cur: curId ? it.nodes[curId] : null, step: curId ? order.indexOf(curId) + 1 : done };
}
function RunNow({ run, finding }) {
  useTick(true);
  if (!run) return null;
  const it = run.items.find((x) => x.status === "running" || x.status === "approval"),
    pr = it ? progressOf(it, run) : null;
  const what = !run.items.length
    ? finding?.runId === run.id
      ? finding.line
      : "Finding the topics"
    : it && pr
      ? `Video ${run.items.indexOf(it) + 1} of ${run.items.length} · step ${pr.step} of ${pr.total}: ${pr.label}${it.status === "approval" ? " (waiting for you)" : ""}`
      : "Finishing";
  return (
    <small className="rt-now ellipsis">
      {what}
      {" · "}
      {dur(Date.now() - Date.parse(run.startedAt))}
    </small>
  );
}
function ItemRow({ it, run, demo, on: on2, pick, open, toast }) {
  useTick(it.status === "running");
  const { allProjects } = useApp(),
    thumb = it.projectId && it.ctx?.thumbnail ? (allProjects.find((p) => p.id === it.projectId)?.thumb ?? null) : null;
  const pr = progressOf(it, run),
    last = pr.cur?.log?.length ? pr.cur.log[pr.cur.log.length - 1] : "";
  const pct = it.status === "done" ? 100 : pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
  const act = (p) => p.catch((e) => toast(e.message, "bad"));
  return (
    <div className={`rt-run-item ${on2 ? "on" : ""} st-${it.status}`} onClick={pick} role="button" tabIndex={0}>
      <StatusDot s={it.status} />
      {thumb && <img className="rt-item-thumb" src={thumb} alt="" />}
      <span className="grow ellipsis rt-item-main">
        <b className="ellipsis">{it.label || `Video ${it.idx + 1}`}</b>
        <small className="ellipsis">
          {it.status === "running" && pr.label
            ? `Step ${pr.step} of ${pr.total}: ${pr.label}${last ? ` · ${last}` : "…"}${pr.cur?.startedAt ? ` · ${dur(Date.now() - Date.parse(pr.cur.startedAt))}` : ""}`
            : it.status === "failed"
              ? it.error
              : it.status === "approval"
                ? `Step ${pr.step} of ${pr.total}: waiting for your approval`
                : (ITEM_LABEL[it.status] ?? it.status)}
        </small>
        {pr.total > 0 && (
          <span className={`rt-bar ${it.status}`}>
            <i style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      {pr.total > 0 && (
        <small className="rt-prog">
          {pr.done}/{pr.total}
          {it.startedAt ? ` · ${dur((it.finishedAt ? Date.parse(it.finishedAt) : Date.now()) - Date.parse(it.startedAt))}` : ""}
        </small>
      )}
      {!demo && (
        <span className="rt-item-acts" onClick={(e) => e.stopPropagation()}>
          {it.status === "approval" && (
            <>
              <button className="btn tiny primary" onClick={() => act(api.routineApprove(run.id, it.id, true))}>
                <ThumbsUpIcon size={12} />
                Approve
              </button>
              <button className="btn tiny danger" onClick={() => act(api.routineApprove(run.id, it.id, false))}>
                <ThumbsDownIcon size={12} />
                Reject
              </button>
            </>
          )}
          {["failed", "cancelled", "interrupted"].includes(it.status) && (
            <button
              className="btn tiny"
              title="Make this video again from the step that did not finish"
              onClick={() => act(api.routineResume(run.id, it.id))}
            >
              <RotateCcwIcon size={12} />
              Retry
            </button>
          )}
          {it.projectId && (
            <button className="btn tiny ghost" title="Open in the editor" onClick={open}>
              <ClapperboardIcon size={12} />
            </button>
          )}
          {it.ctx?.video && (
            <button className="btn tiny ghost" title={`Show the video in ${FILE_MANAGER}`} onClick={() => api.reveal(it.ctx.video)}>
              <FolderOpenIcon size={12} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
const DEFAULT_TEST = [
  { level: "standard", effort: "low" },
  { level: "polish", effort: "low" },
  { level: "ultra", effort: "medium" },
];
function RoutineInspector({ settings, onChange, problems, show, selected, onEffortTest, testLevels }) {
  const google = useGoogleState();
  const codex = useCodexState();
  const variants = (settings.test ?? DEFAULT_TEST).filter((v) => !testLevels || testLevels.levels.some((l) => l.key === v.level));
  const effortNow = settings.effort ? CLAUDE_EFFORTS.find((e) => e.id === settings.effort)?.name : "Same as Settings";
  const [useRec, setUseRec] = useState(true),
    [rec, setRec] = useState([]);
  const needRec = useRec && !rec.length;
  const setVariants = (test) => onChange({ test });
  const dupes = new Set(variants.map((v) => v.level + "/" + v.effort)).size < variants.length;
  return (
    <div className="rt-insp">
      <div className="rt-insp-head">
        <WorkflowIcon size={15} />
        <b>Routine settings</b>
      </div>
      {selected > 1 && (
        <p className="small" style={{ marginBottom: 14 }}>
          {selected}
          {" nodes selected. Select one to change its settings."}
        </p>
      )}
      {problems.length > 0 && (
        <div className="rt-insp-sec">
          <div className="label">Before it can run</div>
          <ul className="rt-problems">
            {problems.map((p, i) => (
              <li key={i} className={p.warn ? "warn" : "bad"}>
                <TriangleAlertIcon size={13} />
                <span>{p.text}</span>
                {p.nodeId && (
                  <button className="btn tiny ghost" onClick={() => show(p.nodeId)}>
                    Show
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rt-insp-sec">
        <div className="label">Hard limits</div>
        <Num label="Videos per run, at most" v={settings.perRun} min={1} max={100} on={(v) => onChange({ perRun: v })} />
        <Num label="Videos per day, at most" v={settings.perDay} min={1} max={500} on={(v) => onChange({ perDay: v })} />
        <div className="field">
          <label>Videos at the same time</label>
          <Segmented
            value={String(settings.parallel)}
            options={[
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              { value: "3", label: "3" },
            ]}
            onChange={(v) => onChange({ parallel: +v })}
            ariaLabel="Videos at the same time"
          />
        </div>
        <div className="field">
          <label>When a video fails</label>
          <Segmented
            value={settings.onFailure}
            options={[
              { value: "skip", label: "Go on with the next" },
              { value: "stop", label: "Stop the run" },
            ]}
            onChange={(v) => onChange({ onFailure: v })}
            ariaLabel="When a video fails"
          />
        </div>
      </div>
      <div className="rt-insp-sec">
        <div className="label">Claude for this routine</div>
        <div className="field">
          <label>Model</label>
          <ModelSelect
            value={settings.model}
            onChange={(v) => onChange({ model: v })}
            ariaLabel="Routine model"
            style={{ width: "100%" }}
            globalLabel="Same as Settings"
            google={google}
            codex={codex}
            extra={settings.model === "claude-haiku-4-5-20251001" ? [{ value: settings.model, label: "Haiku 4.5" }] : []}
          />
        </div>
        {engineOf(settings.model) === "codex" && (
          <p className="small dim">
            ChatGPT runs the edits and text steps on your own Codex and ChatGPT plan. Web research (Topic finder) still runs on Claude, and
            so does any step ChatGPT can't run: the run log says so.
          </p>
        )}
        {engineOf(settings.model) === "google" ? (
          <p className="small dim">
            Google models have no effort setting. Web research (Topic finder) still runs on Claude, and so does any step Google can't run:
            the run log says so.
          </p>
        ) : (
          <div className="field">
            <label>Effort</label>
            <EffortSelect
              value={settings.effort}
              onChange={(v) => onChange({ effort: v })}
              ariaLabel="Routine effort"
              globalLabel="Same as Settings"
              style={{ width: "100%" }}
            />
          </div>
        )}
        <p className="small">
          Routine tasks never stop to ask for permission; their edits stay inside each video's folder, and every edit can be reverted in the
          editor.
        </p>
      </div>
      {engineOf(settings.model) !== "google" && testLevels && (
        <div className="rt-insp-sec" data-rt-effort-test>
          <div className="label">Effort test</div>
          <p className="small dim">
            A comparison, separate from Run: it makes the same video once per row, all at the same time, each in its own project named after
            its row.
          </p>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Voiceover</label>
            <Segmented
              value={useRec ? "rec" : "routine"}
              options={[
                { value: "rec", label: "My recording" },
                { value: "routine", label: "The routine's steps" },
              ]}
              onChange={(v) => setUseRec(v === "rec")}
              ariaLabel="Effort test voiceover"
            />
          </div>
          {useRec ? (
            <>
              <div className="rt-files" data-rt-test-rec>
                {rec.map((f, i) => (
                  <div key={f + i} className="rt-file">
                    <span className="ellipsis" title={f}>
                      {f.split(/[\\/]/).pop()}
                    </span>
                    <button className="icon-btn" aria-label="Remove" onClick={() => setRec(rec.filter((_, k) => k !== i))}>
                      <XIcon size={12} />
                    </button>
                  </div>
                ))}
                <button
                  className="btn tiny"
                  onClick={async () => {
                    const r = await api.pickFiles("Your voiceover", [
                      { name: "Audio or video", extensions: ["wav", "mp3", "m4a", "flac", "ogg", "aac", "mp4", "mov", "webm", "mkv"] },
                    ]);
                    if (Array.isArray(r) && r.length) setRec([...rec, ...r]);
                  }}
                >
                  <PlusIcon size={12} />
                  {rec.length ? "Add another part" : "Pick your recording"}
                </button>
              </div>
              <p className="small dim">
                Your recording goes into one project (Create project's settings), cleaned and timed once, then copied for every row: every
                build starts at once from the same script and narration. Topic, script and voiceover steps are skipped.
              </p>
            </>
          ) : (
            <p className="small dim">
              Each row runs the routine from the start on the same topic, so each writes its own script and voiceover at its own effort.
            </p>
          )}
          <p className="small dim">
            {"Each row replaces, for its video only, the Build video step's quality (now "}
            {testLevels.current}
            {") and the Effort above (now "}
            {effortNow}). Nothing in the routine changes: Run keeps using those.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr) 26px",
              gap: 6,
              alignItems: "center",
              marginTop: 10,
            }}
          >
            <small className="dim">Build quality</small>
            <small className="dim">
              {settings.model ? modelName(settings.model, google) : "Claude"}
              {" effort"}
            </small>
            <span />
            {variants.map((v, i) => (
              <Fragment key={i}>
                <select
                  className="input compact"
                  style={{ width: "100%" }}
                  value={v.level}
                  data-rt-variant={i}
                  aria-label={`Build quality ${i + 1}`}
                  onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, level: e.target.value } : x)))}
                >
                  {testLevels.levels.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <select
                  className="input compact"
                  style={{ width: "100%" }}
                  value={v.effort}
                  aria-label={`Effort ${i + 1}`}
                  onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, effort: e.target.value } : x)))}
                >
                  {CLAUDE_EFFORTS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn tiny ghost"
                  title="Remove this row"
                  aria-label={`Remove row ${i + 1}`}
                  onClick={() => setVariants(variants.filter((_, j) => j !== i))}
                >
                  <XIcon size={12} />
                </button>
              </Fragment>
            ))}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <button
              className="btn small ghost"
              data-rt-variant-add
              disabled={variants.length >= 8}
              onClick={() => setVariants([...variants, variants[variants.length - 1] ?? DEFAULT_TEST[0]])}
            >
              <PlusIcon size={13} />
              Add
            </button>
            <span className="grow" />
            <button
              className="btn small primary"
              data-rt-effort-run
              disabled={!onEffortTest || variants.length < 2 || dupes || needRec}
              onClick={() => onEffortTest?.(variants, useRec ? rec : void 0)}
              title={
                !onEffortTest
                  ? "Wait for the run going now to finish"
                  : variants.length < 2
                    ? "Add at least two rows"
                    : dupes
                      ? "Two rows are the same"
                      : needRec
                        ? "Pick your recording first"
                        : "Start one build per row now"
              }
            >
              <LayersIcon size={13} />
              {"Run "}
              {variants.length}
              {" builds"}
            </button>
          </div>
          {dupes && <p className="small dim">Two rows are the same: change one.</p>}
        </div>
      )}
    </div>
  );
}
function Num({ label, v, min, max, step = 1, unit, on: on2 }) {
  const [t, setT] = useState(String(v ?? ""));
  useEffect(() => setT(String(v ?? "")), [v]);
  const commit = () => {
    const n = +t;
    if (t.trim() === "" || !isFinite(n)) {
      setT(String(v));
      return;
    }
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    setT(String(c));
    if (c !== v) on2(c);
  };
  return (
    <div className="field">
      <label>{label}</label>
      <div className="rt-num">
        <input
          className="input compact"
          type="number"
          value={t}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setT(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        {unit && <span>{unit}</span>}
      </div>
    </div>
  );
}
function NodeInspector({ n, graph, warns, ctx, styles, looks, problems, state, item, onChange, onOff, onDelete, refreshCtx }) {
  const def = NODE[n.type],
    s = n.settings,
    Ic = ICONS[def.icon];
  const { channels, toast, allProjects } = useApp();
  const thumbUrl =
    n.type === "thumbnail" && state && ["done", "warn"].includes(state.status) && item?.projectId
      ? (allProjects.find((p) => p.id === item.projectId)?.thumb ?? null)
      : null;
  const [eleven, setEleven] = useState(null);
  const [allowing, setAllowing] = useState(false);
  const [elevenErr, setElevenErr] = useState(null);
  const [fishList, setFishList] = useState(null);
  const [choiceInfo, setChoiceInfo] = useState(null);
  useEffect(() => {
    if (n.type === "createProject")
      api
        .choiceDefaults()
        .then((d) => setChoiceInfo({ global: d.global, services: d.services, models: d.models, claude: d.claude }))
        .catch(() => {});
  }, [n.type]);
  useEffect(() => {
    if (n.type === "voiceover" && s.provider === "fish" && ctx?.hasFish)
      api
        .fishVoices("en")
        .then(setFishList)
        .catch(() => setFishList([]));
  }, [n.type, s.provider, ctx?.hasFish]);
  useEffect(() => {
    if (n.type === "voiceover" && ctx?.hasEleven)
      api
        .elevenVoices()
        .then(setEleven)
        .catch((e) => {
          setEleven([]);
          setElevenErr(String(e?.message ?? e).replace(/^.*Error: /, ""));
        });
  }, [n.type, ctx?.hasEleven]);
  const base = (() => {
    const st = styles.find((x) => x.id === (s.styleId || "flat"));
    return st ? (st.custom ? "custom" : (st.base ?? st.id)) : s.styleId;
  })();
  const shown = (f) =>
    (!f.showIf || f.showIf.is.includes(s[f.showIf.key])) &&
    (!f.onlyBase || f.onlyBase.includes(n.type === "buildVideo" ? (extras?.one ?? "") : base));
  const extras =
    n.type === "buildVideo"
      ? (() => {
          const ids = graph ? upstreamStyles(graph, n.id) : [],
            sts = ids.map((id) => styles.find((x) => x.id === id));
          const bases = [...new Set(sts.map((st, i) => st?.base ?? st?.id ?? ids[i]))],
            one = bases.length === 1 ? bases[0] : null;
          const name = one ? (sts[0]?.name ?? ids[0]) : null;
          return { one, name, many: bases.length > 1, first: BUILD_EXTRAS[0].key, byKey: new Map(extrasFor(one).map((x) => [x.key, x])) };
        })()
      : null;
  const extraField = (f, x) => (
    <Fragment key={f.key}>
      {f.key === extras.first && (
        <p className="rt-extras-for">
          {extras.one ? (
            <>
              {"Worded for "}
              <b>{extras.name}</b>: what Claude is told is this style's own.
            </>
          ) : extras.many ? (
            "Videos of several styles come through here: each gets these in its own style's words, and a style skips the ones it doesn't use."
          ) : (
            "Connect a Create project before it to see the wording for its style."
          )}
        </p>
      )}
      {x.off ? (
        <div className="field rt-toggle-wrap rt-extra-off">
          <div className="rt-toggle-row">
            <label>{x.label}</label>
            {s[f.key] ? (
              field(f)
            ) : (
              <span className="rt-off-tag">
                {"Not for "}
                {extras.name}
              </span>
            )}
          </div>
          <small>
            {x.off}
            {s[f.key] ? " It is skipped: switch it off." : ""}
          </small>
        </div>
      ) : (
        <div className="field rt-toggle-wrap">
          <div className="rt-toggle-row">
            <label>{x.label}</label>
            {field(f)}
          </div>
          <small>{BUILD_COST}</small>
          <details className="rt-detail">
            <summary>What Claude is told</summary>
            <p>{x.detail}</p>
          </details>
        </div>
      )}
    </Fragment>
  );
  const field = (f) => {
    const v = s[f.key],
      set = (x) => onChange({ [f.key]: x });
    switch (f.kind) {
      case "text":
        return <input className="input compact" value={v ?? ""} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />;
      case "textarea":
        return (
          <textarea
            className="input compact"
            rows={n.type === "myScript" || n.type === "topicList" ? 8 : 3}
            value={v ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => set(e.target.value)}
          />
        );
      case "number":
        return <NumIn v={v} f={f} set={set} />;
      case "range":
        return (
          <div className="rt-range">
            <input type="range" min={f.min} max={f.max} step={f.step ?? 1} value={v ?? f.min ?? 0} onChange={(e) => set(+e.target.value)} />
            <span>{v ?? f.min ?? 0}</span>
          </div>
        );
      case "toggle":
        return <Toggle on={!!v} onChange={set} label={f.label} />;
      case "color":
        return <BrandColor value={v || null} onChange={(x) => set(x ?? "")} label={f.label} />;
      case "select": {
        const auto =
          f.key === "ytFormat"
            ? { long: "Long-form", short: "Shorts", both: "Both" }[topicFormatOf(graph, { id: n.id, settings: { ytFormat: "auto" } })]
            : null;
        return (
          <select className="input compact" value={v ?? f.unset ?? ""} onChange={(e) => set(e.target.value)}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {auto && o.value === "auto" ? ` (${auto})` : ""}
              </option>
            ))}
          </select>
        );
      }
      case "time":
        return <input className="input compact" type="time" value={v ?? "09:00"} onChange={(e) => set(e.target.value)} />;
      case "days":
        return (
          <div className="rt-days">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => {
              const on2 = (v ?? []).includes(i);
              return (
                <button
                  key={i}
                  className={on2 ? "on" : ""}
                  onClick={() => set(on2 ? (v ?? []).filter((x) => x !== i) : [...(v ?? []), i].sort())}
                  aria-pressed={on2}
                  title={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}
                >
                  {d}
                </button>
              );
            })}
          </div>
        );
      case "channel":
        return (
          <select className="input compact" value={v ?? ""} onChange={(e) => set(e.target.value)}>
            <option value="">{n.type === "createProject" ? "The topic's channel (or none)" : "None"}</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        );
      case "style": {
        const opt = (st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ),
          own = styles.filter(isOwnStyle),
          gone = !!styles.length && !styles.some((st) => st.id === (v || "flat"));
        return (
          <select
            className="input compact rt-style"
            value={v || "flat"}
            onChange={(e) =>
              onChange({ styleId: e.target.value, presetId: "", styleName: styles.find((st) => st.id === e.target.value)?.name ?? "" })
            }
          >
            {gone && (
              <option value={v} disabled>
                {s.styleName ? `${s.styleName} (deleted)` : "A style that is gone"}
              </option>
            )}
            {own.length ? (
              <>
                <optgroup label="Built-in styles">{styles.filter((st) => !isOwnStyle(st)).map(opt)}</optgroup>
                <optgroup label="Your styles">{own.map(opt)}</optgroup>
              </>
            ) : (
              styles.map(opt)
            )}
          </select>
        );
      }
      case "look": {
        const st = styles.find((x) => x.id === (s.styleId || "flat")),
          pickFormat = (st?.controls.find((c) => c.path === "format")?.options?.length ?? 0) > 1;
        const defFormat = looks.find((p) => p.id === st?.defaultLook)?.settings?.format;
        const mine = looks
          .filter((l) => (l.style_id || "pixel-art") === (s.styleId || "flat") && offeredLook(st, l))
          .filter((l, _, all) => !pickFormat || !isFormatTwin(l, all, defFormat) || l.id === v);
        return (
          <select className="input compact" value={v ?? ""} onChange={(e) => set(e.target.value)}>
            <option value="">The style's default look</option>
            {mine.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {isMyLook(l) ? " (yours)" : ""}
              </option>
            ))}
          </select>
        );
      }
      case "language": {
        const st = n.type === "createProject" ? styles.find((x) => x.id === (s.styleId || "flat")) : null;
        return (
          <LanguagePicker
            value={v || ""}
            onChange={set}
            ariaLabel="Language"
            base={st ? (st.custom ? "collage" : (st.base ?? st.id)) : void 0}
          />
        );
      }
      case "kokoroVoice":
        return ctx?.hasKokoro ? (
          <select className="input compact" value={v ?? ""} onChange={(e) => set(e.target.value)}>
            <option value="">The one picked last for the language</option>
            {(ctx.kokoro ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
                {" ("}
                {k.language}
                {k.gender ? `, ${k.gender}` : ""})
              </option>
            ))}
          </select>
        ) : (
          <p className="small">{"Not installed (Settings > Media > Voiceover)."}</p>
        );
      case "fishVoice":
        return ctx?.hasFish ? (
          <>
            <select
              className="input compact"
              value={(fishList ?? []).some((x) => x.id === v) || !v ? (v ?? "") : "__id"}
              onChange={(e) => set(e.target.value === "__id" ? v || " " : e.target.value)}
            >
              <option value="">The one picked last in the Voiceover window</option>
              {(fishList ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.own ? " (yours)" : ""}
                </option>
              ))}
              <option value="__id">A voice by its ID or link…</option>
            </select>
            {v && !(fishList ?? []).some((x) => x.id === v) && (
              <input
                className="input compact"
                style={{ marginTop: 6 }}
                value={String(v).trim()}
                placeholder="Paste a voice link from fish.audio"
                onChange={(e) => {
                  const t = e.target.value;
                  set(/fish\.audio\/(?:[a-z-]+\/)?m\/([\w-]{8,64})/i.exec(t)?.[1] ?? (t.trim() || " "));
                }}
                spellCheck={false}
              />
            )}
          </>
        ) : (
          <p className="small">{"No Fish Audio key (Settings > Media > Voiceover)."}</p>
        );
      case "elevenVoice":
        return ctx?.hasEleven ? (
          <select className="input compact" value={v ?? ""} onChange={(e) => set(e.target.value)}>
            <option value="">The one picked last in the Voiceover window</option>
            {(eleven ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
            {(elevenErr || !eleven?.length) && (
              <optgroup label="ElevenLabs built-in voices">
                {BUILTIN_VOICES.filter((b) => !eleven?.some((x) => x.id === b.id)).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            )}
            {v && !eleven?.some((x) => x.id === v) && !BUILTIN_VOICES.some((b) => b.id === v) && (
              <option value={v}>
                {"Voice ID "}
                {v}
              </option>
            )}
          </select>
        ) : (
          <p className="small">{"No ElevenLabs key (Settings > Media > Voiceover)."}</p>
        );
      case "files":
        return (
          <div className="rt-files">
            {(v ?? []).map((f2, i) => (
              <div key={f2 + i} className="rt-file">
                <span className="ellipsis" title={f2}>
                  {f2.split(/[\\/]/).pop()}
                </span>
                <button className="icon-btn" aria-label="Remove" onClick={() => set((v ?? []).filter((_, k) => k !== i))}>
                  <XIcon size={12} />
                </button>
              </div>
            ))}
            <button
              className="btn tiny"
              onClick={async () => {
                const r = await api.pickFiles("Add recordings", [
                  { name: "Audio or video", extensions: ["wav", "mp3", "m4a", "flac", "ogg", "aac", "mp4", "mov", "webm", "mkv"] },
                ]);
                if (Array.isArray(r) && r.length) set([...(v ?? []), ...r]);
              }}
            >
              <PlusIcon size={12} />
              Add recordings
            </button>
          </div>
        );
      case "projectChoices": {
        const vals = v && typeof v === "object" ? v : {},
          sum = choicesSummary(vals, choiceInfo);
        const patch = (p) => set(mergeChoices(vals, p));
        const st = styles.find((x) => x.id === (s.styleId || "flat"));
        return (
          <details className="rt-choices">
            <summary>
              <span className={sum ? "set" : ""}>{sum || "As in Settings"}</span>
            </summary>
            {choiceInfo ? (
              <ProjectChoicesForm
                vals={vals}
                onChange={patch}
                info={choiceInfo}
                base={st ? (st.base ?? st.id) : null}
                styleName={st?.name ?? "This style"}
                aria=" (Create project)"
              />
            ) : (
              <Spinner size={13} />
            )}
          </details>
        );
      }
      case "quality": {
        const one = extras?.one ?? null,
          lv = nodeLevel(s),
          told = extrasFor(one).filter((x) => !x.off && levelExtras(lv, one).includes(x.key));
        return (
          <div className="rt-quality" data-rt-quality>
            <QualitySlider
              base={one}
              value={lv}
              onChange={(k) => onChange({ level: k, props: false, polish: false, scenes: false, ultra: false })}
            />
            {told.length > 0 && (
              <details className="rt-detail">
                <summary>What Claude is told</summary>
                {told.map((x) => (
                  <p key={x.key}>{x.detail}</p>
                ))}
              </details>
            )}
          </div>
        );
      }
      case "scriptSkillOwn":
        return (
          <OwnSkillField
            v={v}
            set={(x) => {
              set(x);
              refreshCtx();
            }}
          />
        );
      case "thumbRefs":
        return (
          <ThumbRefsField
            v={Array.isArray(v) ? v : []}
            set={(x) => {
              set(x);
              refreshCtx();
            }}
          />
        );
      case "thumbAnalysis":
        return <ThumbAnalysisField v={v ?? ""} set={set} refs={Array.isArray(s.refImages) ? s.refImages : []} />;
      case "imageGen":
        return <ThumbImageGen s={s} onChange={onChange} />;
      case "length":
        return (
          <LengthField
            value={typeof v === "string" ? v : fmtLength(+v || 120)}
            onChange={(x) => {
              const sec = parseLength(x);
              onChange({ [f.key]: sec ?? x });
            }}
          />
        );
      case "ytfollow":
        return (
          <>
            <YtFollow
              value={v ?? ""}
              set={set}
              ctx={ctx}
              refreshCtx={refreshCtx}
              empty={
                n.type === "thumbnail"
                  ? "The video's channel (its linked YouTube channel)"
                  : n.type === "titleDesc"
                    ? "The Topic finder's channel, else the board's linked one"
                    : "The linked YouTube channel of “Videos go to channel”"
              }
            />
            {n.type === "ideaGenerator" && <KnownVideosLine yt={v ?? ""} channelId={s.channelId ?? ""} format={topicFormatOf(graph, n)} />}
          </>
        );
      case "ytchannel": {
        const yt = ctx?.yt ?? [];
        return (
          <>
            {yt.length ? (
              <select className="input compact" value={v ?? ""} onChange={(e) => set(e.target.value)}>
                <option value="">Pick a channel</option>
                {yt.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.title}
                    {y.upload ? "" : " (uploads not allowed yet)"}
                  </option>
                ))}
              </select>
            ) : (
              <p className="small">Sign in a YouTube channel first (YouTube page).</p>
            )}
            {(!v || !yt.find((y) => y.id === v)?.upload) && (
              <button
                className="btn tiny"
                disabled={allowing}
                style={{ marginTop: 8 }}
                onClick={async () => {
                  setAllowing(true);
                  try {
                    const r = await api.routineAllowUpload();
                    refreshCtx();
                    if (r.channels[0] && !v) set(r.channels[0]);
                    toast("Uploads allowed for the channel you signed in with.", "ok");
                  } catch (e) {
                    toast(e.message, "bad");
                  } finally {
                    setAllowing(false);
                  }
                }}
              >
                {allowing ? <Spinner size={12} /> : <UploadIcon size={12} />}Allow uploads (sign in with Google)
              </button>
            )}
          </>
        );
      }
    }
    return null;
  };
  return (
    <div className="rt-insp">
      <div className={`rt-insp-head rn-${def.category}`}>
        <span className="rn-ic">{Ic && <Ic size={14} strokeWidth={1.8} />}</span>
        <b>{def.label}</b>
        <small>{CATEGORY_LABEL[def.category]}</small>
        <span className="grow" />
        {n.type !== "note" && (
          <span
            className="rt-onoff"
            title={n.off ? "Switched off: runs pass through it (M)" : "Switch this node off without removing it (M)"}
          >
            <small>{n.off ? "Off" : "On"}</small>
            <Toggle on={!n.off} onChange={(v) => onOff(!v)} label="Node on" />
          </span>
        )}
        <button className="icon-btn" title="Delete this node" aria-label="Delete this node" onClick={onDelete}>
          <TrashIcon size={14} />
        </button>
      </div>
      <p className="small rt-desc">{def.desc}</p>
      {n.off && <p className="rt-offnote">Switched off: runs pass through this node as if it were not there.</p>}
      {problems.length > 0 && (
        <ul className="rt-problems">
          {problems.map((p, i) => (
            <li key={i} className={warns.has(p) ? "warn" : "bad"}>
              <TriangleAlertIcon size={13} />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
      {thumbUrl && (
        <div className="rt-thumb">
          <img src={thumbUrl} alt={`Thumbnail of ${item?.label ?? "the video"}`} />
          {item?.ctx?.thumbnail && (
            <button className="btn tiny" onClick={() => api.reveal(item.ctx.thumbnail)}>
              <FolderOpenIcon size={12} />
              {"Show in "}
              {FILE_MANAGER}
            </button>
          )}
        </div>
      )}
      {n.type === "thumbnail" &&
        item &&
        state &&
        ["done", "warn"].includes(state.status) &&
        (item.ctx?.thumbVariations?.length ?? 0) > 1 && <ThumbVariations key={item.id} runId={item.runId} itemId={item.id} />}
      {state && (
        <div className={`rt-out st-${state.status}`}>
          <div className="label">
            In “{item?.label}
            {"”: "}
            {
              {
                waiting: "waiting",
                running: "working",
                done: "done",
                failed: "failed",
                skipped: "skipped",
                approval: "waiting for you",
                warn: "done, with a warning",
              }[state.status]
            }
          </div>
          {state.error && <p className="rt-err">{state.error}</p>}
          {state.note && <p className="small">{state.note}</p>}
          {state.log?.length ? <pre className="rt-log">{state.log.slice(-14).join("\n")}</pre> : null}
        </div>
      )}
      {def.fields.filter(shown).map((f) =>
        extras && extras.byKey.has(f.key) ? (
          extraField(f, extras.byKey.get(f.key))
        ) : f.kind === "toggle" ? (
          <div key={f.key} className="field rt-toggle-wrap">
            <div className="rt-toggle-row">
              <label>{f.label}</label>
              {field(f)}
            </div>
            {f.hint && <small>{f.hint}</small>}
            {f.detail && (
              <details className="rt-detail">
                <summary>What Claude is told</summary>
                <p>{f.detail}</p>
              </details>
            )}
          </div>
        ) : (
          <div key={f.key} className="field">
            <label>{f.label}</label>
            {field(f)}
            {f.hint && <small>{f.hint}</small>}
            {f.key === "scriptSkill" && n.type === "writeScript" && (
              <p className="rt-skill-line" data-rt-skill-line>
                {"Each run writes with: "}
                <b>{writeSkillLine(s, ctx)}</b>
              </p>
            )}
            {f.key === "preset" && n.type === "writeScript" && SCRIPT_PRESETS.find((x) => x.value === s.preset)?.detail && (
              <details className="rt-detail">
                <summary>What Claude is told</summary>
                <p>{SCRIPT_PRESETS.find((x) => x.value === s.preset).detail}</p>
              </details>
            )}
          </div>
        ),
      )}
    </div>
  );
}
function NumIn({ v, f, set }) {
  const [t, setT] = useState(String(v ?? ""));
  useEffect(() => setT(String(v ?? "")), [v]);
  const commit = () => {
    const n = +t;
    if (t.trim() === "" || !isFinite(n)) {
      setT(String(v ?? ""));
      return;
    }
    const c = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
    setT(String(c));
    if (c !== v) set(c);
  };
  return (
    <div className="rt-num">
      <input
        className="input compact"
        type="number"
        value={t}
        min={f.min}
        max={f.max}
        step={f.step}
        onChange={(e) => setT(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      {f.unit && <span>{f.unit}</span>}
    </div>
  );
}
function OwnSkillField({ v, set }) {
  const { toast } = useApp();
  const [info, setInfo] = useState(void 0),
    [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState(null);
  useEffect(() => {
    let live = true;
    if (v?.id)
      api
        .ownSkillGet(v.id)
        .then((r) => {
          if (live) setInfo(r);
        })
        .catch(() => live && setInfo(null));
    else setInfo(void 0);
    return () => {
      live = false;
    };
  }, [v?.id]);
  const take = async (p, msg) => {
    setBusy(true);
    try {
      const r = await p;
      if (r) {
        setInfo(r);
        set({ id: r.id, name: r.name });
        setPaste(null);
        toast(msg, "ok");
      }
    } catch (e) {
      toast(String(e?.message ?? e).replace(/^.*Error: /, ""), "bad");
    } finally {
      setBusy(false);
    }
  };
  const verb = v?.id ? "Replace with" : "Add";
  return (
    <div className="rt-ownskill" data-rt-ownskill>
      {v?.id && (
        <div className="rt-ownskill-cur">
          <b data-ownskill-name>{info?.name ?? v.name}</b>
          {info === null ? (
            <small className="rt-err">Not on this computer: add it again.</small>
          ) : info ? (
            <>
              <small>
                {info.files.length}
                {" file"}
                {info.files.length === 1 ? "" : "s"}
              </small>
              {info.preview && <pre data-ownskill-preview>{info.preview}</pre>}
            </>
          ) : (
            <Spinner size={12} />
          )}
        </div>
      )}
      {paste === null ? (
        <div className="row wrap" style={{ gap: 6 }}>
          <button
            className="btn tiny"
            disabled={busy}
            onClick={() => take(api.ownSkillPick("file"), v?.id ? "Skill replaced for this node." : "Skill added to this node.")}
          >
            <PlusIcon size={12} />
            {verb}
            {" a file"}
          </button>
          <button
            className="btn tiny"
            disabled={busy}
            onClick={() => take(api.ownSkillPick("folder"), v?.id ? "Skill replaced for this node." : "Skill added to this node.")}
          >
            <FolderOpenIcon size={12} />
            {verb}
            {" a folder"}
          </button>
          <button className="btn tiny" disabled={busy} onClick={() => setPaste("")}>
            Paste text
          </button>
          {v?.id && (
            <button
              className="btn tiny"
              disabled={busy}
              onClick={() => {
                set(null);
                setInfo(void 0);
              }}
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <div>
          <textarea
            className="input compact"
            rows={5}
            autoFocus
            value={paste}
            placeholder="How you write scripts: voice, hook, structure, rules…"
            onChange={(e) => setPaste(e.target.value)}
            aria-label="This node's scripting skill (pasted)"
          />
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button
              className="btn tiny primary"
              disabled={busy || !paste.trim()}
              onClick={() => take(api.ownSkillPaste(paste), "Skill saved for this node.")}
            >
              Save
            </button>
            <button className="btn tiny" disabled={busy} onClick={() => setPaste(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function ThumbRefsField({ v, set }) {
  const { toast } = useApp();
  const [urls, setUrls] = useState({}),
    [busy, setBusy] = useState(false);
  const ids = v.map((r) => r.id).join("|");
  useEffect(() => {
    let live = true;
    if (v.length)
      api
        .thumbRefsGet(v.map((r) => r.id))
        .then((r) => {
          if (live) setUrls(Object.fromEntries(r.map((x) => [x.id, x.url])));
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [ids]);
  const add = async () => {
    setBusy(true);
    try {
      const got = await api.thumbRefsPick();
      if (!got.length) return;
      const next = [...v, ...got.filter((g) => !v.some((x) => x.id === g.id))];
      if (next.length > 5) toast(`Up to 5 reference thumbnails: the first 5 are kept.`, "bad");
      set(next.slice(0, 5));
    } catch (e) {
      toast(String(e?.message ?? e).replace(/^.*Error: /, ""), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rt-trefs" data-rt-trefs>
      {v.length > 0 && (
        <div className="rt-trefs-grid">
          {v.map((r) => (
            <div key={r.id} className="rt-tref" title={r.name}>
              {urls[r.id] ? (
                <img src={urls[r.id]} alt={r.name} />
              ) : (
                <span className="rt-tref-gone">{urls[r.id] === null ? "Not on this computer" : ""}</span>
              )}
              <button className="icon-btn" aria-label={`Remove ${r.name}`} onClick={() => set(v.filter((x) => x.id !== r.id))}>
                <XIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {v.length < 5 && (
        <button className="btn tiny" disabled={busy} onClick={add}>
          {busy ? <Spinner size={12} /> : <PlusIcon size={12} />}Add reference thumbnails
        </button>
      )}
    </div>
  );
}
function ThumbAnalysisField({ v, set, refs }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      set(await api.thumbAnalyze(refs.map((r) => r.id)));
      toast("Claude analysed the reference thumbnails. Edit the text as you like.", "ok");
    } catch (e) {
      toast(String(e?.message ?? e).replace(/^.*Error: /, ""), "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rt-tanalysis" data-rt-tanalysis>
      <textarea
        className="input compact"
        rows={v ? 9 : 3}
        value={v}
        onChange={(e) => set(e.target.value)}
        aria-label="The reference thumbnails' formula"
        placeholder={
          refs.length
            ? "Press Analyse: Claude looks at your references and writes their layout, formula, colours, typography and effects here."
            : "Add reference thumbnails first."
        }
      />
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button className="btn tiny" disabled={busy || !refs.length} onClick={run}>
          {busy ? <Spinner size={12} /> : <RotateCcwIcon size={12} />}
          {busy ? "Claude is looking at them…" : v.trim() ? "Analyse again" : "Analyse with Claude"}
        </button>
      </div>
    </div>
  );
}
function ThumbImageGen({ s, onChange }) {
  const [models, setModels] = useState(null),
    [img, setImg] = useState(null);
  useEffect(() => {
    api
      .hfStatus()
      .then((r) => setModels(r.models))
      .catch(() => setModels([]));
    api
      .imagesStatus()
      .then(setImg)
      .catch(() => setImg(null));
  }, []);
  if (!img || !models) return <Spinner size={13} />;
  const has = { higgsfield: img.higgsfield.hasKey, fal: img.fal.hasKey, custom: !!img.custom, flow: !!img.flow?.opened };
  const want = s.service || img.setting,
    eff = serviceFor(want, has),
    name = (c) => IMAGE_SERVICE_NAMES[c];
  const missing = (c) => (has[c] ? "" : c === "custom" ? " (not set up)" : " (no key yet)");
  const waiting = want !== "auto" && eff !== want;
  const line = waiting
    ? `${name(want)} ${want === "custom" ? "is not set up" : "has no key yet"} (Settings > Media > Image generation): ${eff ? `the pictures are made on ${name(eff)} until then.` : "no pictures can be made until then."}`
    : eff
      ? `The pictures are made on ${name(eff)}.`
      : "Image generation is not set up yet (Settings > Media > Image generation).";
  const def = img.models?.higgsfield ?? img.defaultModel,
    hm = models.find((m) => m.id === (s.model || def));
  const shown = { model: s.model || "", ...fitSettings(hm, { resolution: s.resolution || "2k", quality: s.quality || "high" }) };
  return (
    <div className="rt-imggen" data-rt-imggen>
      <select
        className="input compact"
        value={s.service || ""}
        onChange={(e) => onChange({ service: e.target.value })}
        aria-label="Thumbnail picture service"
      >
        <option value="">
          As in Settings ({img.setting === "auto" ? "Automatic" : img.setting === "flow" ? "Google Flow" : name(img.setting)}
          {img.setting !== "auto" && img.setting !== "flow" ? missing(img.setting) : ""})
        </option>
        {["higgsfield", "fal", "custom"]
          .filter((c) => c !== "custom" || img.custom)
          .map((c) => (
            <option key={c} value={c}>
              {name(c)}
              {c === "custom" && img.custom ? `: ${img.custom}` : ""}
              {missing(c)}
            </option>
          ))}
      </select>
      <small className={waiting || !eff ? "rt-imggen-warn" : ""}>{line}</small>
      {eff === "higgsfield" && (
        <div className="rt-imggen-row">
          <ModelSelects
            models={models}
            value={shown}
            aspect={false}
            className="input compact"
            defaultModel={def}
            ariaPrefix="Thumbnail "
            onChange={(x) =>
              onChange({
                ...("model" in x ? { model: x.model || "" } : {}),
                ...(x.resolution !== void 0 ? { resolution: x.resolution } : {}),
                ...(x.quality !== void 0 ? { quality: x.quality } : {}),
              })
            }
          />
        </div>
      )}
      {eff === "fal" && <small>Fal.ai makes the pictures with FLUX.2: there is no model to pick.</small>}
      {eff === "custom" && (
        <input
          className="input compact"
          value={s.model ?? ""}
          maxLength={100}
          placeholder={img.models?.custom ? `Default (${img.models.custom})` : "The connector's own model"}
          onChange={(e) => onChange({ model: e.target.value })}
          aria-label="Thumbnail image model (custom API)"
        />
      )}
    </div>
  );
}
function ThumbVariations({ runId, itemId }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    api
      .thumbVariations(runId, itemId)
      .then((r) => {
        if (live) setD(r);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runId, itemId]);
  if (!d || d.list.length < 2) return null;
  return (
    <div className="rt-tvars" data-rt-tvars>
      <div className="label">
        {d.list.length}
        {" variations"}
        {d.pick?.why ? " · Claude picked one" : ""}
      </div>
      {d.pick?.why && (
        <p className="small rt-tvars-why">
          {"Variation "}
          {d.pick.winner}
          {": "}
          {d.pick.why}
        </p>
      )}
      <div className="rt-trefs-grid">
        {d.list.map((x) => (
          <div key={x.n} className={`rt-tref ${x.winner ? "win" : ""}`} title={x.error ?? x.prompt}>
            {x.url ? <img src={x.url} alt={`Variation ${x.n}`} /> : <span className="rt-tref-gone">Failed</span>}
            <b>
              {x.n}
              {x.winner ? " · used" : ""}
            </b>
          </div>
        ))}
      </div>
    </div>
  );
}
function KnownVideosLine({ yt, channelId, format }) {
  const { toast } = useApp();
  const [k, setK] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .routineKnownVideos(yt, channelId, false, format)
      .then((r) => {
        if (live) setK(r);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [yt, channelId, format]);
  if (!k) return null;
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.routineKnownVideos(yt, channelId, true, format);
      setK(r);
      if (r?.error) toast(`Could not read the channel again (${r.error}); kept the ${r.total} known ${k.word}.`, "bad");
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const since = k.lastRun
    ? `${k.lastRun.added} new since last run${k.foundSince ? `, ${k.foundSince} found after it` : ""}`
    : "not run yet";
  const line =
    k.state === "never"
      ? `Known ${k.word}: not read yet`
      : k.state === "failed"
        ? `Known ${k.word}: not read yet (the last read failed)`
        : `Known ${k.word}: ${k.total} (${k.onChannel !== k.total ? `${k.onChannel} on the channel now, ` : ""}${since})`;
  return (
    <>
      <details className="rt-known">
        <summary>
          <span className="rt-known-line" title={k.state === "failed" ? (k.readError ?? "") : void 0}>
            {line}
          </span>
          <button
            className="btn tiny ghost"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              refresh();
            }}
            title="Read the channel again now and add any new videos"
          >
            {busy ? <Spinner size={12} /> : <RotateCcwIcon size={12} />}Refresh
          </button>
        </summary>
        <p className="small">
          Every video ever read from the channel is kept here, even when a later read returns fewer (private, unlisted and deleted ones too:
          their topics were covered). Topics are never repeated from this list{k.topics ? ` or the ${k.topics} topics found before` : ""}.
        </p>
        <ul className="rt-known-list">
          {k.videos.map((x, i) => (
            <li key={i}>
              <span className="ellipsis" title={x.t}>
                {x.t}
              </span>
              {x.at && <small>{x.live ? x.at : `${x.at} · not on the channel`}</small>}
              {!x.at && !x.live && <small>not on the channel</small>}
            </li>
          ))}
        </ul>
      </details>
      {k.read && (
        <p className={`small rt-known-read${k.read.how === "feed" ? " warn" : ""}`}>
          {k.read.text}
          {k.read.how === "page" && (k.longs || k.shorts) ? ` (${k.longs} long-form, ${k.shorts} Shorts)` : ""}.
        </p>
      )}
    </>
  );
}
function YtFollow({ value, set, ctx, refreshCtx, empty }) {
  const { toast } = useApp();
  const [add, setAdd] = useState(""),
    [adding, setAdding] = useState(false),
    [googling, setGoogling] = useState(false),
    gTry = useRef(0);
  const all = ctx?.ytAll ?? [];
  const reading = all.some((y) => y.syncing);
  useEffect(() => {
    if (!reading) return;
    const iv = setInterval(refreshCtx, 2e3);
    return () => clearInterval(iv);
  }, [reading]);
  const choose = (id) => {
    set(id);
    const y = all.find((x) => x.id === id);
    if (y && !y.videos && !y.syncing)
      api
        .ytSync(id)
        .then(refreshCtx)
        .catch(() => {});
  };
  const picked = (id, title) => {
    set(id);
    refreshCtx();
    toast(`Following ${title}. Reading its videos…`, "ok");
    api
      .ytSync(id)
      .then(() => {
        refreshCtx();
        toast(`${title}: its videos are read.`, "ok");
      })
      .catch((e) => toast(e.message, "bad"));
  };
  const addIt = async () => {
    if (!add.trim() || adding) return;
    setAdding(true);
    try {
      const r = await api.ytAdd(add.trim());
      setAdd("");
      picked(r.channel.id, r.channel.title);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setAdding(false);
    }
  };
  const google = async () => {
    if (googling) {
      gTry.current++;
      setGoogling(false);
      return;
    }
    const k = ++gTry.current;
    setGoogling(true);
    try {
      const r = await api.ytSignIn();
      const c = r.channels[0];
      if (c && k === gTry.current) picked(c.id, c.title);
    } catch (e) {
      if (k === gTry.current) toast(e.message, "bad");
    } finally {
      if (k === gTry.current) setGoogling(false);
    }
  };
  return (
    <div className="rt-ytf">
      {all.length > 0 && (
        <select className="input compact" value={value} onChange={(e) => choose(e.target.value)}>
          <option value="">{empty}</option>
          {all.map((y) => (
            <option key={y.id} value={y.id}>
              {y.title}
              {y.own ? " (yours)" : ""}
              {" · "}
              {y.syncing ? "reading its videos…" : y.failed ? "last read failed" : !y.read ? "not read yet" : `${y.videos} videos`}
            </option>
          ))}
        </select>
      )}
      <div className="rt-ytf-add">
        <input
          className="input compact"
          value={add}
          onChange={(e) => setAdd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addIt()}
          placeholder={all.length ? "Or add another: @handle or channel link" : "Paste its @handle or channel link"}
        />
        <button className="btn tiny" data-ytf-add disabled={!add.trim() || adding} onClick={addIt}>
          {adding ? <Spinner size={12} /> : <PlusIcon size={12} />}Add
        </button>
      </div>
      <button
        className="btn tiny ghost"
        data-ytf-google
        onClick={google}
        title={
          googling
            ? "Stop waiting for the Google sign-in in your browser"
            : "Your own channel, with its full analytics (needs your Google app, Settings > YouTube)"
        }
      >
        {googling ? (
          <>
            <Spinner size={12} />
            Waiting for Google in your browser… stop waiting
          </>
        ) : (
          "Or sign in with Google (your own channel)"
        )}
      </button>
    </div>
  );
}
