import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownIcon,
  ArrowRightLeftIcon,
  ArrowUpIcon,
  CalendarClockIcon,
  ChartLineIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ClapperboardIcon,
  EllipsisIcon,
  EyeIcon,
  FilmIcon,
  FolderOpenIcon,
  GripVerticalIcon,
  KanbanIcon,
  LayoutGridIcon,
  LightbulbIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  RefreshCwIcon,
  Rows3Icon,
  SearchIcon,
  SquarePlayIcon,
  StickyNoteIcon,
  TextCursorInputIcon,
  TrashIcon,
  TriangleAlertIcon,
  TvMinimalPlayIcon,
  Undo2Icon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import { api, on } from "../lib/api";
import { ago, fmtLength } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { ALT, MOD, isMac } from "../help/keys";
import { I, Modal, Spinner } from "../components/ui";
import { fold } from "../lib/fold";
import { Picker, Segmented } from "../components/Picker";
import { DATE_LIMITS, STAGES, STAGE_LABEL, dateProblem, dueChip, dueLabel, dueState, isEnter } from "./stages";
import { ChannelAvatar, markColor } from "./ChannelAvatar";
import { ActionMenu } from "./ActionMenu";
import { ChannelEditor, ChannelFilter, channelItems } from "./ChannelEditor";
import { DueDialog } from "./DueDialog";
import { NoteDialog } from "./NoteDialog";
import { LinkVideoDialog } from "../youtube/LinkVideoDialog";
import { showYouTube } from "../youtube/YouTube";

const prefsKey = (b) => `cz-chboard-${b}`;
const loadPrefs = (b) => {
  const d = { kind: "all", week: false, stage: "all", compact: false, collapsed: [] };
  try {
    const own = localStorage.getItem(prefsKey(b));
    if (own) return { ...d, ...JSON.parse(own) };
    const old = JSON.parse(localStorage.getItem("cz-board") || "{}");
    return { ...d, compact: !!old.compact, collapsed: Array.isArray(old.collapsed) ? old.collapsed : [] };
  } catch {
    return d;
  }
};
const HINT = {
  idea: "Ideas you have not started yet. Type one above, or drag a video here to park it.",
  script: "New Faceless projects wait here until their script is written.",
  voiceover: "The script is written: the voiceover comes next.",
  building: "The voiceover (or, for Personal videos, the footage) is in: the video is being built.",
  review: "Scenes are built: watch it through, fix what is off, export.",
  ready: "Exported or rendered, ready to upload.",
  // (the automatic way first: a card placed by hand stays put, one linked to its YouTube video follows it)
  scheduled:
    "Scheduled on YouTube. Link a project to its YouTube video (card menu > YouTube video…) and it moves here by itself, with its date.",
  published:
    "Live on YouTube. Link a project to its YouTube video (card menu > YouTube video…) and it moves here by itself, with its views.",
};
export const showDueOnBoard = (b) => {
  try {
    localStorage.setItem(prefsKey(b), JSON.stringify({ ...loadPrefs(b), kind: "all", week: true, stage: "all" }));
  } catch {}
};
const IN_PROGRESS = ["script", "voiceover", "building", "review"];
const inColumn = (a, b) => a.order - b.order || b.recent - a.recent;
const byPlace = (a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || inColumn(a, b);
const boardScroll = new Map();
const editable = (t) => t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
const isDelKey = (e) => (e.key === "Delete" && !e.ctrlKey && !e.metaKey && !e.altKey) || (isMac && e.key === "Backspace" && e.metaKey);
const DEL_KEY = isMac ? "⌘⌫" : "Delete key";
const time = (s) => {
  const t = s ? Date.parse(s) : NaN;
  return isNaN(t) ? 0 : t;
};
const sameMonth = (s) => {
  if (!s) return false;
  const d = new Date(s),
    n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
};
export function Channels() {
  const { channels, channel, setChannel, allProjects, refreshProjects, refreshChannels, toast, startNew, brand, go } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [prefs, setPrefsState] = useState(() => loadPrefs(brand));
  const setPrefs = (p) =>
    setPrefsState((o) => {
      const n = { ...o, ...p };
      try {
        localStorage.setItem(prefsKey(brand), JSON.stringify(n));
      } catch {}
      return n;
    });
  const [qy, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const loading = useRef(0),
    pending = useRef(0),
    inflight = useRef(false),
    again = useRef(false);
  const load = useCallback(async () => {
    if (pending.current) return;
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    const n = ++loading.current;
    try {
      const d = await api.channelBoard();
      if (n === loading.current && !pending.current) {
        setData(d);
        setErr(null);
      }
    } catch (e) {
      if (n === loading.current) setErr(e.message);
    } finally {
      inflight.current = false;
      if (again.current) {
        again.current = false;
        load();
      }
    }
  }, []);
  const loadIdeas = useCallback(async () => {
    if (pending.current || inflight.current) {
      load();
      return;
    }
    try {
      const ideas = await api.channelIdeas();
      if (!pending.current && !inflight.current) setData((d) => d && { ...d, ideas });
      else load();
    } catch {
      load();
    }
  }, [load]);
  useEffect(() => {
    load();
    refreshProjects();
    refreshChannels().catch(() => {});
    const off = on("channels:changed", (e) => {
      if (e?.what === "ideas") loadIdeas();
      else load();
    });
    const offs = [on("project:changed", () => load()), on("personal:changed", () => load())];
    const focus = () => load();
    const vis = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 3e4);
    return () => {
      off();
      offs.forEach((f) => f());
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", vis);
      clearInterval(t);
    };
  }, []);
  const sel = channel !== "all" && channel !== "none" && !channels.some((c) => c.id === channel) ? "all" : channel;
  const cur = channels.find((c) => c.id === sel) ?? null;
  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const prevItems = useRef(new Map());
  const all = useMemo(() => {
    if (!data) return [];
    const proj = new Map(allProjects.map((p) => [p.id, p]));
    const out = [],
      seen = new Map();
    const keep = (it, sig) => {
      const o = prevItems.current.get(it.key),
        x = o && o.sig === sig ? o.it : it;
      seen.set(it.key, { sig, it: x });
      out.push(x);
    };
    for (const info of Object.values(data.cards)) {
      const p = proj.get(info.id);
      keep(
        {
          key: info.id,
          type: "project",
          title: info.name || p?.name || "Untitled",
          stage: info.stage,
          channelId: info.channelId ?? null,
          due: info.due ?? null,
          note: info.note ?? null,
          order: info.order ?? -time(info.created),
          recent: time(info.recent),
          kind: info.kind,
          project: p,
          info,
        },
        `${JSON.stringify(info)}|${p ? `${p.name}|${p.thumb}|${p.style_id}|${p.path}` : ""}`,
      );
    }
    for (const i of data.ideas)
      keep(
        {
          key: i.id,
          type: "idea",
          title: i.title,
          stage: i.stage,
          channelId: i.channel_id,
          due: i.due_at,
          note: i.notes,
          order: i.sort,
          recent: time(i.updated_at),
          kind: null,
          idea: i,
        },
        JSON.stringify(i),
      );
    prevItems.current = seen;
    return out;
  }, [data, allProjects]);
  const inSel = (it) => sel === "all" || (sel === "none" ? !it.channelId || !byId.has(it.channelId) : it.channelId === sel);
  const counts = useMemo(() => {
    const c = { all: all.length, none: 0 };
    for (const it of all) {
      if (it.channelId && byId.has(it.channelId)) c[it.channelId] = (c[it.channelId] ?? 0) + 1;
      else c.none++;
    }
    return c;
  }, [all, byId]);
  const q = fold(qy.trim());
  const passes = useCallback(
    (it) =>
      inSel(it) &&
      (prefs.kind === "all" || !it.kind || it.kind === prefs.kind) &&
      (!prefs.week || ["over", "soon", "week"].includes(dueState(it.due, it.stage) ?? "")) &&
      (!q ||
        fold(`${it.title} ${it.note ?? ""} ${it.info?.style ?? ""} ${it.channelId ? (byId.get(it.channelId)?.name ?? "") : ""}`).includes(
          q,
        )),
    [sel, prefs.kind, prefs.week, q, byId],
  );
  const shown = useMemo(() => all.filter(passes), [all, passes]);
  const scoped = useMemo(() => all.filter(inSel), [all, sel, byId]);
  const filtered = prefs.kind !== "all" || prefs.week || !!q;
  const hiddenN = all.filter(inSel).length - shown.length;
  const hidden =
    (prefs.kind !== "all" || prefs.week) && hiddenN > 0
      ? {
          n: hiddenN,
          why: [
            prefs.kind !== "all" && `${prefs.kind === "faceless" ? "Faceless" : "Personal"} only`,
            prefs.week && "Due this week",
            q && "the search",
          ]
            .filter(Boolean)
            .join(", "),
        }
      : null;
  const clearFilters = () => {
    setQ("");
    setPrefs({ kind: "all", week: false, stage: "all" });
  };
  const ideaItem = (i) => ({
    key: i.id,
    type: "idea",
    title: i.title,
    stage: i.stage,
    channelId: i.channel_id,
    due: i.due_at,
    note: i.notes,
    order: i.sort,
    recent: 0,
    kind: null,
    idea: i,
  });
  const hides = (it) => !passes(it) || (prefs.stage !== "all" && prefs.stage !== it.stage);
  const ideasAdded = (l) => {
    const hid = l.filter((i) => hides(ideaItem(i))).length;
    if (!hid) return;
    toast(
      l.length === 1
        ? `Added "${l[0].title}", but the filters hide it.`
        : `Added ${l.length} ideas, but the filters hide ${hid === l.length ? "them" : hid}.`,
      "info",
      { label: "Show it", run: clearFilters },
    );
  };
  const ideaSaved = (i, was) => {
    const it = ideaItem(i);
    if (!inSel(it)) {
      const to = i.channel_id ? (byId.get(i.channel_id)?.name ?? "its channel") : "No channel";
      toast(`${was ? "Moved" : "Added"} "${i.title}" to ${to}.`, "ok", { label: "Show", run: () => setChannel(i.channel_id ?? "none") });
    } else if (hides(it))
      toast(`${was ? "Saved" : "Added"} "${i.title}", but the filters hide it.`, "info", { label: "Show it", run: clearFilters });
  };
  const move = useCallback(
    async (keys, stage, order) => {
      const ks = new Set(keys);
      setData((d) => {
        if (!d) return d;
        const idx = new Map(order.map((k, i) => [k, i]));
        const cards = { ...d.cards };
        for (const [k, c] of Object.entries(cards)) {
          const o = idx.get(k),
            moved = ks.has(k);
          if (o === void 0 && !moved) continue;
          cards[k] = { ...c, ...(o !== void 0 ? { order: o } : {}), ...(moved ? { stage, manual: stage !== c.auto } : {}) };
        }
        const ideas = d.ideas.map((i) =>
          ks.has(i.id) || idx.has(i.id)
            ? { ...i, ...(idx.has(i.id) ? { sort: idx.get(i.id) } : {}), ...(ks.has(i.id) ? { stage } : {}) }
            : i,
        );
        return { ...d, cards, ideas };
      });
      pending.current++;
      try {
        await api.moveCard({ ids: keys, stage, order });
      } catch (e) {
        toast(e.message, "bad");
      } finally {
        pending.current--;
      }
      load();
    },
    [load, toast],
  );
  const setDue = useCallback(
    async (keys, d) => {
      const ks = new Set(keys);
      setData(
        (x) =>
          x && {
            ...x,
            cards: Object.fromEntries(Object.entries(x.cards).map(([k, c]) => [k, ks.has(k) ? { ...c, due: d } : c])),
            ideas: x.ideas.map((i) => (ks.has(i.id) ? { ...i, due_at: d } : i)),
          },
      );
      pending.current++;
      try {
        await api.dueMany(keys, d);
      } catch (e) {
        toast(e.message, "bad");
      } finally {
        pending.current--;
      }
      load();
    },
    [load, toast],
  );
  const assign = useCallback(
    async (its, ch) => {
      const l = its.filter((it) => (it.channelId ?? null) !== ch);
      if (!l.length) return;
      try {
        await api.assignChannel(
          l.map((it) => it.key),
          ch,
        );
        const name = ch ? (byId.get(ch)?.name ?? "the channel") : null,
          what = l.length === 1 ? `"${l[0].title}"` : `${l.length} cards`;
        toast(
          name ? `Moved ${what} to ${name}.` : `${what} ${l.length === 1 ? "has" : "have"} no channel now.`,
          "ok",
          sel !== "all" && sel !== (ch ?? "none") ? { label: "Show", run: () => setChannel(ch ?? "none") } : void 0,
        );
      } catch (e) {
        toast(e.message, "bad");
      }
      load();
      refreshChannels().catch(() => {});
    },
    [byId, sel, load],
  );
  const [railMenu, setRailMenu] = useState(null);
  const reorder = async (ids) => {
    try {
      await api.channelReorder(ids);
      await refreshChannels();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const shift = (c, d) => {
    const ids = channels.map((x) => x.id),
      i = ids.indexOf(c.id),
      j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids);
  };
  const chDrag = useRef(null);
  const [chOver, setChOver] = useState(null);
  const railRef = useRef(null);
  const chDown = (e, c) => {
    if (e.button !== 0 || e.target.closest(".ch-rail-more")) return;
    if (e.pointerType === "touch" && !e.target.closest(".ch-grip")) return;
    chDrag.current = { id: c.id, y0: e.clientY, started: false, over: -1 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const chMove = (e) => {
    const d = chDrag.current;
    if (!d) return;
    if (!d.started && Math.abs(e.clientY - d.y0) < 5) return;
    d.started = true;
    const rail = railRef.current,
      rb = rail?.getBoundingClientRect();
    if (rail && rb) {
      if (e.clientY < rb.top + 40) rail.scrollTop -= 12;
      else if (e.clientY > rb.bottom - 40) rail.scrollTop += 12;
    }
    const rows = [...(railRef.current?.querySelectorAll(".ch-rail-row.chan") ?? [])].filter((r) => r.dataset.dropChannel !== d.id);
    let i = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return e.clientY < b.top + b.height / 2;
    });
    if (i < 0) i = rows.length;
    if (i !== d.over) {
      d.over = i;
      setChOver({ id: d.id, index: i });
    }
  };
  const chUp = () => {
    const d = chDrag.current;
    chDrag.current = null;
    setChOver(null);
    if (!d?.started) return;
    suppressRailClick.current = true;
    setTimeout(() => {
      suppressRailClick.current = false;
    }, 0);
    const ids = channels.map((c) => c.id).filter((x) => x !== d.id);
    ids.splice(d.over, 0, d.id);
    if (ids.join() !== channels.map((c) => c.id).join()) reorder(ids);
  };
  const suppressRailClick = useRef(false);
  useEffect(() => {
    const key = (e) => {
      if (e.key !== "Escape" || !chDrag.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const started = chDrag.current.started;
      chDrag.current = null;
      setChOver(null);
      if (started) {
        suppressRailClick.current = true;
        setTimeout(() => {
          suppressRailClick.current = false;
        }, 0);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const railItems = (c, inHead = false) => [
    ...(inHead
      ? []
      : [{ value: "open", label: "Show its board", icon: <KanbanIcon size={14} strokeWidth={1.8} />, run: () => setChannel(c.id) }]),
    { value: "edit", label: "Edit channel…", icon: <PencilIcon size={14} strokeWidth={1.8} />, run: () => setEditing(c) },
    {
      value: "new",
      label: `New ${brand === "personal" ? "video" : "project"} in this channel`,
      icon: <PlusIcon size={14} strokeWidth={1.8} />,
      run: () => startNew({ channelId: c.id }),
    },
    ...(c.yt_channel_id
      ? [
          {
            value: "yt",
            label: "Its YouTube numbers",
            icon: <ChartLineIcon size={14} strokeWidth={1.8} />,
            run: () => {
              showYouTube(c.yt_channel_id);
              go("youtube");
            },
          },
        ]
      : []),
    {
      value: "up",
      label: "Move up",
      icon: <ArrowUpIcon size={14} strokeWidth={1.8} />,
      hint: inHead ? "In the list of channels" : void 0,
      disabled: channels[0]?.id === c.id,
      run: () => shift(c, -1),
    },
    {
      value: "down",
      label: "Move down",
      icon: <ArrowDownIcon size={14} strokeWidth={1.8} />,
      hint: inHead ? "In the list of channels" : void 0,
      disabled: channels[channels.length - 1]?.id === c.id,
      run: () => shift(c, 1),
    },
  ];
  const [dropCh, setDropCh] = useState(null);
  const railOrder = useMemo(() => {
    if (!chOver) return channels;
    const l = channels.filter((c) => c.id !== chOver.id);
    l.splice(
      chOver.index,
      0,
      channels.find((c) => c.id === chOver.id),
    );
    return l;
  }, [channels, chOver]);
  const stats = (cid) => {
    const l = all.filter((it) => (cid === null ? !it.channelId || !byId.has(it.channelId) : it.channelId === cid));
    return {
      progress: l.filter((it) => it.type === "project" && IN_PROGRESS.includes(it.stage)).length,
      ideas: l.filter((it) => it.stage === "idea").length,
      due: l.filter((it) => ["over", "soon", "week"].includes(dueState(it.due, it.stage) ?? "")).length,
      late: l.filter((it) => dueState(it.due, it.stage) === "over").length,
      ready: l.filter((it) => it.stage === "ready").length,
      published: l.filter(
        (it) =>
          it.stage === "published" &&
          (sameMonth(it.info?.publishedAt) || sameMonth(it.info?.stageAt) || (it.type === "idea" && sameMonth(it.idea?.updated_at))),
      ).length,
    };
  };
  const newHere = (kind) => startNew({ channelId: cur?.id ?? null, ...{} });
  const tilesRef = useRef(null);
  useEffect(() => {
    const t = tilesRef.current;
    if (!t) return;
    const wheel = (e) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        !e.deltaY ||
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ||
        t.scrollWidth <= t.clientWidth + 1
      )
        return;
      e.preventDefault();
      t.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    };
    t.addEventListener("wheel", wheel, { passive: false });
    return () => t.removeEventListener("wheel", wheel);
  }, [sel === "all"]);
  const thing = brand === "personal" ? "video" : "project";
  return (
    <div className="ch-page page-enter">
      <aside
        className="ch-rail"
        aria-label="Channels"
        ref={railRef}
        onPointerMove={chMove}
        onPointerUp={chUp}
        onPointerCancel={() => {
          chDrag.current = null;
          setChOver(null);
        }}
      >
        <div className="ch-rail-title">
          <TvMinimalPlayIcon size={15} strokeWidth={1.8} />
          Channels
        </div>
        <button className={`ch-rail-row all ${sel === "all" ? "on" : ""}`} onClick={() => setChannel("all")} aria-current={sel === "all"}>
          <span className="ch-av all">
            <LayoutGridIcon size={14} strokeWidth={1.8} />
          </span>
          <span className="grow ellipsis">All channels</span>
          <small>{counts.all || ""}</small>
        </button>
        <div className="ch-rail-list">
          {railOrder.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              data-drop-channel={c.id}
              aria-current={sel === c.id}
              className={`ch-rail-row chan ${sel === c.id ? "on" : ""} ${chOver?.id === c.id ? "lifted" : ""} ${dropCh === c.id ? "drop" : ""}`}
              onClick={() => {
                if (!suppressRailClick.current) setChannel(c.id);
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                  e.preventDefault();
                  setChannel(c.id);
                }
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  shift(c, e.key === "ArrowUp" ? -1 : 1);
                }
                if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                  e.preventDefault();
                  setRailMenu({ at: e.currentTarget, c });
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setRailMenu({ at: { x: e.clientX, y: e.clientY }, c });
              }}
              onPointerDown={(e) => chDown(e, c)}
              title={`${c.name}${c.handle ? ` · ${c.handle}` : ""}
Drag to reorder (${ALT} ↑ / ↓ with the keyboard). Drop a card here to move it to this channel.`}
            >
              <span className="ch-grip" aria-hidden="true">
                <GripVerticalIcon size={13} strokeWidth={1.8} />
              </span>
              <ChannelAvatar c={c} size={24} />
              <span className="grow ellipsis" dir="auto">
                {c.name}
              </span>
              {counts[c.id] ? <small>{counts[c.id]}</small> : null}
              <button
                className="icon-btn sm ch-rail-more"
                aria-label={`${c.name}: channel menu`}
                onClick={(e) => {
                  e.stopPropagation();
                  const el = e.currentTarget;
                  setRailMenu((m) => (m?.c.id === c.id && m.at === el ? (e.detail > 1 ? m : null) : { at: el, c }));
                }}
              >
                <EllipsisIcon size={15} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
        <button
          className={`ch-rail-row none ${sel === "none" ? "on" : ""} ${dropCh === "none" ? "drop" : ""}`}
          data-drop-channel="none"
          onClick={() => setChannel("none")}
          aria-current={sel === "none"}
          title="Videos and ideas in no channel. Drop a card here to take it out of its channel."
        >
          <ChannelAvatar c={null} size={24} />
          <span className="grow ellipsis">No channel</span>
          <small>{counts.none || ""}</small>
        </button>
        {!channels.length && (
          <div className="ch-rail-empty">
            <b>Group your videos by channel</b>
            <p>One channel per YouTube channel you run: each gets its own board, and the overview shows them side by side.</p>
          </div>
        )}
        <button className="btn small ch-rail-new" onClick={() => setEditing("new")}>
          <PlusIcon size={14} strokeWidth={1.9} />
          New channel
        </button>
      </aside>
      <div className="ch-main">
        <header className="ch-head">
          {cur ? (
            <ChannelAvatar c={cur} size={46} />
          ) : (
            <span className={`ch-av big ${sel === "none" ? "none" : "all"}`}>
              {sel === "none" ? <ChannelAvatar c={null} size={46} /> : <LayoutGridIcon size={22} strokeWidth={1.7} />}
            </span>
          )}
          <div className="grow ch-head-txt">
            <h1 className="ellipsis" title={cur?.name} dir="auto">
              {cur ? cur.name : sel === "none" ? "No channel" : "All channels"}
            </h1>
            {(() => {
              const s = cur
                ? [cur.handle, cur.description].filter(Boolean).join(" · ") || "Its videos and ideas, from idea to published."
                : sel === "none"
                  ? "Videos and ideas not in a channel yet. Drag one onto a channel in the list to move it."
                  : channels.length
                    ? "Every video and idea across your channels, from idea to published."
                    : "Every video and idea, from idea to published. Make channels to give each one its own board.";
              return (
                <div className="sub ellipsis" dir="auto" title={s}>
                  {s}
                </div>
              );
            })()}
          </div>
          <div className="ch-head-sel">
            <ChannelFilter id="ch-pick" value={sel} onChange={setChannel} counts={counts} />
          </div>
          <div className="actions">
            <button className="btn ch-newch" title="New channel" onClick={() => setEditing("new")}>
              <PlusIcon size={15} strokeWidth={1.8} />
              <span>New channel</span>
            </button>
            {cur && (
              <button className="btn ch-editch" title="Edit channel" onClick={() => setEditing(cur)}>
                <PencilIcon size={15} strokeWidth={1.8} />
                <span>Edit channel</span>
              </button>
            )}
            {cur && (
              <button
                className="icon-btn ch-head-more"
                aria-label={`${cur.name}: channel menu`}
                title="More: move the channel up or down"
                onClick={(e) => {
                  const el = e.currentTarget,
                    n = e.detail;
                  setRailMenu((m) => (m?.inHead && m.at === el ? (n > 1 ? m : null) : { at: el, c: cur, inHead: true }));
                }}
              >
                <EllipsisIcon size={17} strokeWidth={1.8} />
              </button>
            )}
            <button className="btn primary" onClick={() => newHere()}>
              <PlusIcon {...I} />
              {"New "}
              {thing}
            </button>
          </div>
        </header>
        {sel === "all" && (
          <div className="ch-tiles" role="list" aria-label="Channels at a glance" ref={tilesRef}>
            {channels.map((c) => {
              const s = stats(c.id);
              return (
                <button
                  key={c.id}
                  role="listitem"
                  className="ch-tile"
                  onClick={() => setChannel(c.id)}
                  style={{ "--chc": markColor(c.color) }}
                  title={`Open ${c.name}`}
                >
                  <span className="ch-tile-head">
                    <ChannelAvatar c={c} size={26} />
                    <b className="ellipsis" dir="auto">
                      {c.name}
                    </b>
                  </span>
                  <TileStats s={s} last={["published", s.published]} />
                </button>
              );
            })}
            {(() => {
              const s = stats(null);
              return counts.none > 0 && channels.length > 0 ? (
                <button role="listitem" className="ch-tile none" onClick={() => setChannel("none")} title="Videos and ideas in no channel">
                  <span className="ch-tile-head">
                    <ChannelAvatar c={null} size={26} />
                    <b>No channel</b>
                  </span>
                  <TileStats s={s} last={["cards", counts.none]} />
                </button>
              ) : null;
            })()}
            {!channels.length && (
              <button role="listitem" className="ch-tile add" onClick={() => setEditing("new")}>
                <PlusIcon size={18} strokeWidth={1.8} />
                <b>Make your first channel</b>
                <small>Each channel gets its own board; this overview compares them.</small>
              </button>
            )}
          </div>
        )}
        <div className="ch-tools">
          <label className="search">
            <SearchIcon {...I} />
            <input
              placeholder={cur ? "Search this channel" : "Search the board"}
              value={qy}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search the board"
              onKeyDown={(e) => {
                if (e.key === "Escape" && qy) {
                  e.stopPropagation();
                  setQ("");
                }
              }}
            />
            {qy && (
              <button className="icon-btn sm" aria-label="Clear the search" onClick={() => setQ("")}>
                <XIcon size={14} />
              </button>
            )}
          </label>
          <Segmented
            id="ch-kind"
            ariaLabel="Which videos"
            className="ch-kind"
            value={prefs.kind}
            onChange={(v) => setPrefs({ kind: v })}
            options={[
              { value: "all", label: "All" },
              { value: "faceless", label: "Faceless" },
              { value: "personal", label: "Personal" },
            ]}
          />
          <button
            className={`btn small ch-week ${prefs.week ? "active" : ""}`}
            aria-pressed={prefs.week}
            onClick={() => setPrefs({ week: !prefs.week })}
            title="Only what is due in the next 7 days (or late)"
          >
            <CalendarClockIcon size={14} strokeWidth={1.8} />
            <span>Due this week</span>
          </button>
          <StagePick value={prefs.stage} onChange={(v) => setPrefs({ stage: v })} />
          <button
            className="icon-btn ch-density"
            onClick={() => setPrefs({ compact: !prefs.compact })}
            aria-label={prefs.compact ? "Show pictures on the cards" : "Compact cards"}
            title={prefs.compact ? "Show pictures on the cards" : "Compact cards (no pictures)"}
          >
            {prefs.compact ? <LayoutGridIcon size={17} strokeWidth={1.7} /> : <Rows3Icon size={17} strokeWidth={1.7} />}
          </button>
        </div>
        {err && (
          <div className="hint bad" role="alert">
            <TriangleAlertIcon size={18} />
            <div>
              <b>The board could not be read</b>
              <p>{err}</p>
            </div>
            <button className="btn small" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {!data && !err ? (
          <div className="loading">
            <Spinner size={22} kind="orbit" />
            Reading your projects…
          </div>
        ) : (
          data && (
            <Board
              items={shown}
              scoped={scoped}
              everything={all}
              prefs={prefs}
              setPrefs={setPrefs}
              channels={channels}
              byId={byId}
              showChannel={sel === "all"}
              filtered={filtered}
              hidden={hidden}
              scope={sel}
              newIdeaChannel={cur?.id ?? null}
              onMove={move}
              onAssign={assign}
              onDue={setDue}
              reload={load}
              reloadIdeas={loadIdeas}
              setDropCh={setDropCh}
              onShowAll={clearFilters}
              onIdeasAdded={ideasAdded}
              onIdeaSaved={ideaSaved}
              onNewChannel={() => setEditing("new")}
              empty={!all.some(inSel)}
            />
          )
        )}
      </div>
      {railMenu && (
        <ActionMenu
          key={railMenu.c.id}
          at={railMenu.at}
          label="Channel menu"
          onClose={() => setRailMenu(null)}
          items={railItems(railMenu.c, railMenu.inHead)}
        />
      )}
      {editing && (
        <ChannelEditor
          channel={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            if (editing === "new") setChannel(c.id);
            load();
          }}
          onDeleted={() => {
            if (editing !== "new" && editing.id === sel) setChannel("all");
            load();
          }}
        />
      )}
    </div>
  );
}
function TileStats({ s, last }) {
  return (
    <span className="ch-tile-stats">
      <span title="Projects between Script and Review">
        <b>{s.progress}</b>
        <small>in progress</small>
      </span>
      <span className={s.late ? "late" : s.due ? "due" : ""} title="Due in the next 7 days, or late">
        <b>{s.due}</b>
        <small>{s.late ? `due · ${s.late} late` : "due this week"}</small>
      </span>
      <span>
        <b>{s.ready}</b>
        <small>ready</small>
      </span>
      <span title={last[0] === "published" ? "Published this month" : void 0}>
        <b>{last[1]}</b>
        <small>{last[0] === "published" ? "out this month" : last[1] === 1 ? "card" : "cards"}</small>
      </span>
    </span>
  );
}
function StagePick({ value, onChange }) {
  const opts = useMemo(
    () => [
      { value: "all", label: "All stages" },
      ...STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s], icon: <i className={`ch-dot chs-${s}`} /> })),
    ],
    [],
  );
  return (
    <Picker
      id="ch-stage"
      value={value}
      options={opts}
      onChange={(v) => onChange(v)}
      ariaLabel="Stage"
      menuWidth={200}
      className="ch-stagepick"
    />
  );
}
function Board({
  items,
  scoped,
  everything,
  prefs,
  setPrefs,
  channels,
  byId,
  showChannel,
  filtered,
  hidden,
  scope,
  newIdeaChannel,
  onMove,
  onAssign,
  onDue,
  reload,
  reloadIdeas,
  setDropCh,
  onShowAll,
  onIdeasAdded,
  onIdeaSaved,
  onNewChannel,
  empty,
}) {
  const { toast, dismiss, openProject, startNew, refreshProjects, brand } = useApp();
  const cols = useMemo(() => {
    const m = new Map(STAGES.map((s) => [s, []]));
    for (const it of items) m.get(it.stage)?.push(it);
    for (const l of m.values()) l.sort(inColumn);
    return m;
  }, [items]);
  const visible = prefs.stage === "all" ? STAGES : STAGES.filter((s) => s === prefs.stage);
  const boardRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const D = useRef(null),
    overRef = useRef(null),
    suppress = useRef(false);
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [dueFor, setDueFor] = useState(null),
    [noteFor, setNoteFor] = useState(null),
    [ideaFor, setIdeaFor] = useState(null);
  const [newCh, setNewCh] = useState(null),
    [ytFor, setYtFor] = useState(null);
  const [picked, setPicked] = useState(new Set()),
    anchor = useRef(null);
  const shownKeys = useMemo(() => new Set(items.map((it) => it.key)), [items]);
  const pickedItems = useMemo(() => scoped.filter((it) => picked.has(it.key)), [scoped, picked]);
  const pickedHidden = pickedItems.filter((it) => !shownKeys.has(it.key)).length;
  const pickedRef = useRef(pickedItems);
  pickedRef.current = pickedItems;
  useEffect(() => {
    setPicked((p) => {
      if (!p.size) return p;
      const keys = new Set(scoped.map((it) => it.key)),
        n = new Set([...p].filter((k) => keys.has(k)));
      return n.size === p.size ? p : n;
    });
  }, [scoped]);
  const [bulkMenu, setBulkMenu] = useState(null);
  const bulkRef = useRef(null);
  useEffect(() => {
    const on2 = pickedItems.length > 0;
    document.body.classList.toggle("ch-picking", on2);
    const b = bulkRef.current,
      ro = b
        ? new ResizeObserver(() => document.body.style.setProperty("--ch-bulk-h", `${Math.round(b.getBoundingClientRect().height)}px`))
        : null;
    if (b) ro.observe(b);
    return () => {
      ro?.disconnect();
      document.body.classList.remove("ch-picking");
      document.body.style.removeProperty("--ch-bulk-h");
    };
  }, [pickedItems.length > 0]);
  const togglePick = (it) => {
    anchor.current = it.key;
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(it.key)) n.delete(it.key);
      else n.add(it.key);
      return n;
    });
  };
  const rangePick = (it) => {
    const col = cols.get(it.stage) ?? [],
      a = col.findIndex((x) => x.key === anchor.current),
      b = col.findIndex((x) => x.key === it.key);
    if (a < 0 || !picked.size) {
      anchor.current = it.key;
      setPicked((p) => (p.has(it.key) ? p : new Set(p).add(it.key)));
      return;
    }
    setPicked((p) => {
      const n = new Set(p);
      col.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => n.add(x.key));
      return n;
    });
  };
  const fullCols = useMemo(() => {
    const m = new Map(STAGES.map((s) => [s, []]));
    for (const it of everything) m.get(it.stage)?.push(it);
    for (const l of m.values()) l.sort(inColumn);
    return m;
  }, [everything]);
  const fullRef = useRef(fullCols);
  fullRef.current = fullCols;
  const placeIn = (stage, keys, before) => {
    const ks = new Set(keys),
      full = (fullRef.current.get(stage) ?? []).map((x) => x.key).filter((k) => !ks.has(k));
    const shown = (colsRef.current.get(stage) ?? []).map((x) => x.key).filter((k) => !ks.has(k));
    let at = before ? full.indexOf(before) : shown.length ? full.indexOf(shown[shown.length - 1]) + 1 : 0;
    if (at < 0) at = shown.length ? full.length : 0;
    full.splice(at, 0, ...keys);
    return full;
  };
  const reorderShown = (stage, shownOrder) => {
    const full = (fullRef.current.get(stage) ?? []).map((x) => x.key),
      set = new Set(shownOrder);
    const slots = full.flatMap((k, i) => (set.has(k) ? [i] : []));
    if (slots.length !== shownOrder.length) return null;
    slots.forEach((s, j) => {
      full[s] = shownOrder[j];
    });
    return full;
  };
  const moveGroup = (group, stage, index = 0) => {
    const keys = [...group].sort(byPlace).map((x) => x.key),
      ks = new Set(keys),
      rest = (cols.get(stage) ?? []).filter((x) => !ks.has(x.key));
    onMove(keys, stage, placeIn(stage, keys, rest[index]?.key ?? null));
  };
  const clickT = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const scopedRef = useRef(scoped);
  scopedRef.current = scoped;
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const open = (it) => {
    if (it.type === "idea") {
      setIdeaFor(it);
      return;
    }
    if (it.info?.missing) {
      toast(`The project folder is missing${it.project?.path ? `: ${it.project.path}` : ""}.`, "bad");
      return;
    }
    openProject({ id: it.key, kind: it.kind });
  };
  const hit = (x, y) => {
    const el = document.elementsFromPoint(x, y).find((e) => !e.closest(".toasts, .ch-ghost, .ch-bulk, .ch-offview")) ?? null;
    const chan = el?.closest("[data-drop-channel]");
    if (chan) return { channel: chan.dataset.dropChannel };
    const col = el?.closest(".ch-col[data-stage]");
    if (!col || col.classList.contains("collapsed")) {
      const c = col?.dataset.stage;
      return c ? { stage: c, index: 0 } : null;
    }
    const stage = col.dataset.stage;
    const rects = [...col.querySelectorAll(".ch-col-list > .ch-card:not(.dragging)")].map((c) => c.getBoundingClientRect());
    const grid = rects.some((r, i) => i > 0 && Math.abs(r.top - rects[i - 1].top) < 2);
    const rowBottom = (r) => Math.max(...rects.filter((o) => Math.abs(o.top - r.top) < 2).map((o) => o.bottom));
    let index = rects.findIndex((b) => (grid ? y < b.top || (y <= rowBottom(b) && x < b.left + b.width / 2) : y < b.top + b.height / 2));
    if (index < 0) index = rects.length;
    return { stage, index };
  };
  const track = () => {
    const d = D.current;
    if (!d) return;
    const t = hit(d.x, d.y),
      prev = overRef.current;
    overRef.current = t;
    if (JSON.stringify(t) !== JSON.stringify(prev)) {
      setOver(t && "stage" in t ? t : null);
      setDropCh(t && "channel" in t ? t.channel : null);
    }
  };
  const autoScroll = () => {
    const d = D.current;
    if (!d || !d.started) return;
    const b = boardRef.current;
    if (b) {
      const r = b.getBoundingClientRect(),
        e = 56;
      let sx = 0;
      if (d.x < r.left + e && d.x > r.left - 40) sx = -Math.ceil((r.left + e - d.x) / 4);
      else if (d.x > r.right - e && d.x < r.right + 40) sx = Math.ceil((d.x - (r.right - e)) / 4);
      if (sx) {
        b.scrollLeft += sx;
        track();
      }
    }
    const list = document.elementFromPoint(d.x, d.y)?.closest(".ch-col-list");
    if (list) {
      const r = list.getBoundingClientRect(),
        e = 44;
      let sy = 0;
      if (d.y < r.top + e) sy = -Math.ceil((r.top + e - d.y) / 4);
      else if (d.y > r.bottom - e) sy = Math.ceil((d.y - (r.bottom - e)) / 4);
      if (sy) {
        list.scrollTop += sy;
        track();
      }
    }
    const rail = document.querySelector(".ch-rail"),
      rr = rail?.getBoundingClientRect();
    if (rail && rr && rr.width > 0 && rail.scrollHeight > rail.clientHeight + 1 && d.x >= rr.left && d.x <= rr.right + 30) {
      const e = 56;
      let sy = 0;
      if (d.y < rr.top + e) sy = -Math.ceil((rr.top + e - d.y) / 4);
      else if (d.y > rr.bottom - e) sy = Math.ceil((d.y - (rr.bottom - e)) / 4);
      if (sy) {
        rail.scrollTop += sy;
        track();
      }
    }
    d.raf = requestAnimationFrame(autoScroll);
  };
  const endDrag = (drop) => {
    const d = D.current;
    D.current = null;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    d.ghost?.remove();
    document.body.classList.remove("ch-dragging");
    const t = overRef.current;
    overRef.current = null;
    setDrag(null);
    setOver(null);
    setDropCh(null);
    if (!d.started) return;
    suppress.current = true;
    setTimeout(() => {
      suppress.current = false;
    }, 0);
    if (!drop || !t) return;
    const it = itemsRef.current.find((x) => x.key === d.key);
    if (!it) return;
    const group = d.group && d.group.size > 1 ? scopedRef.current.filter((x) => d.group.has(x.key)).sort(byPlace) : [it];
    if ("channel" in t) {
      onAssign(group, t.channel === "none" ? null : t.channel);
      return;
    }
    const keys = group.map((x) => x.key),
      ks = new Set(keys),
      list = (colsRef.current.get(t.stage) ?? []).filter((x) => !ks.has(x.key)).map((x) => x.key);
    const from = (colsRef.current.get(t.stage) ?? []).map((x) => x.key),
      before = list[t.index] ?? null;
    list.splice(t.index, 0, ...keys);
    if (list.join() === from.join()) return;
    const order = group.every((x) => x.stage === t.stage && from.includes(x.key)) ? reorderShown(t.stage, list) : null;
    onMove(keys, t.stage, order ?? placeIn(t.stage, keys, before));
  };
  useEffect(() => {
    const key = (e) => {
      if (e.key !== "Escape") return;
      if (D.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        endDrag(false);
      } else if (pickedRef.current.length && !editable(e.target) && !document.querySelector('.pk-menu, [aria-modal="true"]')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPicked(new Set());
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      if (D.current) endDrag(false);
    };
  }, []);
  const openKeys = useRef([]);
  openKeys.current = items
    .filter((it) => visible.includes(it.stage) && !(prefs.collapsed.includes(it.stage) && visible.length > 1))
    .map((it) => it.key);
  useEffect(() => {
    const key = (e) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== "a" ||
        editable(e.target) ||
        document.querySelector('.pk-menu:not(.out), [aria-modal="true"]')
      )
        return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      if (openKeys.current.length) {
        setPicked(new Set(openKeys.current));
        anchor.current = openKeys.current[0];
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const down = (e, it) => {
    if (e.button !== 0 || renaming === it.key || e.target.closest("button, input, textarea, a, .ch-noDrag")) return;
    const el = e.currentTarget,
      r = el.getBoundingClientRect();
    D.current = {
      key: it.key,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      started: false,
      ghost: null,
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      h: r.height,
      raf: 0,
      pointer: e.pointerId,
      el,
    };
  };
  const moveP = (e) => {
    const d = D.current;
    if (!d || e.pointerId !== d.pointer) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
      if (!(e.buttons & 1)) {
        D.current = null;
        return;
      }
      d.started = true;
      clearTimeout(clickT.current);
      setOpening(null);
      try {
        boardRef.current?.setPointerCapture(d.pointer);
      } catch {}
      const r = d.el.getBoundingClientRect(),
        g = d.el.cloneNode(true);
      g.classList.add("ch-ghost");
      g.style.width = `${r.width}px`;
      g.removeAttribute("data-key");
      g.removeAttribute("tabindex");
      document.body.appendChild(g);
      d.ghost = g;
      document.body.classList.add("ch-dragging");
      const group = picked.has(d.key) && picked.size > 1 ? new Set(picked) : new Set([d.key]);
      if (group.size > 1) {
        const n = document.createElement("span");
        n.className = "ch-ghost-n";
        n.textContent = String(group.size);
        g.appendChild(n);
      }
      setDrag({ key: d.key, h: d.h, group });
      d.group = group;
      d.raf = requestAnimationFrame(autoScroll);
    }
    track();
    if (d.ghost) {
      const t = overRef.current,
        rail = t && "channel" in t ? document.querySelector(".ch-rail")?.getBoundingClientRect() : null;
      d.ghost.classList.toggle("mini", !!rail);
      const my = Math.max(4, Math.min(e.clientY - 14, innerHeight - d.ghost.offsetHeight * 0.5 - 6));
      d.ghost.style.transform = rail
        ? `translate(${rail.right + 10}px, ${my}px) scale(.5)`
        : `translate(${e.clientX - d.dx}px, ${e.clientY - d.dy}px) rotate(1.5deg)`;
    }
  };
  const up = (e) => {
    const d = D.current;
    if (!d || e.pointerId !== d.pointer) return;
    endDrag(true);
  };
  const groupOf = (it) => (picked.has(it.key) && pickedItems.length > 1 ? pickedItems : [it]);
  const stageItems = (it, group = [it]) =>
    STAGES.map((s) => ({
      value: "st:" + s,
      label: STAGE_LABEL[s],
      icon: <i className={`ch-dot chs-${s}`} />,
      hint:
        group.length === 1 && it.info && s === it.info.auto
          ? s === it.stage
            ? "Automatic, from its files"
            : "Where its files put it (back to automatic)"
          : void 0,
      badge: group.every((x) => x.stage === s) ? "Now" : void 0,
      disabled: group.every((x) => x.stage === s),
      run: () => {
        moveGroup(group, s);
        if (group.length > 1) setPicked(new Set());
        focusCard(it.key);
      },
    }));
  const setPlan = async (it, patch, then = true) => {
    try {
      if (it.type === "idea")
        await api.ideaUpdate(it.key, {
          ...(patch.dueAt !== void 0 ? { dueAt: patch.dueAt } : {}),
          ...(patch.planNote !== void 0 ? { notes: patch.planNote } : {}),
        });
      else await api.setPlan(it.key, patch);
    } catch (e) {
      toast(e.message, "bad");
    }
    if (then) (it.type === "idea" ? reloadIdeas : reload)();
  };
  const startFrom = (it, kind) => startNew({ name: it.title, topic: it.note ?? "", channelId: it.channelId, ideaId: it.key, kind });
  const delRun = useRef(null);
  const delIdea = (it) => delIdeas([it]);
  const delIdeas = async (list) => {
    try {
      if (list.length === 1) await api.ideaDelete(list[0].key);
      else await api.ideaDeleteMany(list.map((x) => x.key));
      reloadIdeas();
    } catch (e) {
      toast(e.message, "bad");
      reloadIdeas();
      return;
    }
    const prev = delRun.current && Date.now() - delRun.current.at < 7e3 ? delRun.current : null;
    if (prev) dismiss(prev.toast);
    const its = [...(prev?.its ?? []), ...list],
      it = its[its.length - 1],
      run = { its, toast: 0, at: Date.now() };
    const undo = async () => {
      if (delRun.current === run) delRun.current = null;
      try {
        for (const x of its) {
          if (x.idea) await api.ideaRestore(x.idea);
          else await api.ideaCreate({ title: x.title, notes: x.note, channelId: x.channelId, stage: x.stage, dueAt: x.due });
        }
        reloadIdeas();
        if (its.length > 1) toast(`${its.length} ideas are back.`);
      } catch (e) {
        toast(e.message, "bad");
        reloadIdeas();
      }
    };
    run.toast = toast(
      its.length === 1 ? `Deleted the idea "${it.title}".` : `Deleted ${its.length} ideas ("${its[0].title}" … "${it.title}").`,
      "ok",
      { label: its.length === 1 ? "Undo" : `Undo all ${its.length}`, run: undo },
    );
    delRun.current = run;
  };
  const itemsFor = (it) => {
    const group = groupOf(it),
      many = group.length > 1;
    const chans = channelItems(channels, many ? "__several" : it.channelId && byId.has(it.channelId) ? it.channelId : null, (id) => {
      if (id === "new") setNewCh(group);
      else {
        onAssign(group, id);
        if (many) setPicked(new Set());
      }
    });
    const common = [
      {
        value: "stage",
        label: "Move to stage",
        icon: <KanbanIcon size={14} strokeWidth={1.8} />,
        sub: stageItems(it, group),
        subTitle: many ? `Move ${group.length} cards to stage` : "Move to stage",
        hint: many ? void 0 : STAGE_LABEL[it.stage],
      },
      {
        value: "channel",
        label: "Move to channel",
        icon: <ArrowRightLeftIcon size={14} strokeWidth={1.8} />,
        sub: chans,
        subTitle: many ? `Move ${group.length} cards to channel` : "Move to channel",
        hint: many ? void 0 : it.channelId ? byId.get(it.channelId)?.name : "No channel",
      },
      {
        value: "due",
        label: "Due date…",
        icon: <CalendarClockIcon size={14} strokeWidth={1.8} />,
        hint: !many && it.due ? dueLabel(it.due, it.stage) : void 0,
        run: () => setDueFor(group),
      },
    ];
    const own =
      it.type === "idea"
        ? [
            { value: "edit", label: "Edit idea…", icon: <PencilIcon size={14} strokeWidth={1.8} />, run: () => setIdeaFor(it) },
            { value: "rename", label: "Rename", icon: <TextCursorInputIcon size={14} strokeWidth={1.8} />, run: () => setRenaming(it.key) },
            {
              value: "startF",
              label: "Start a Faceless project",
              icon: <ClapperboardIcon size={14} strokeWidth={1.8} />,
              group: "Make it",
              run: () => startFrom(it, "faceless"),
            },
            {
              value: "startP",
              label: "Start a Personal video",
              icon: <VideoIcon size={14} strokeWidth={1.8} />,
              group: "Make it",
              run: () => startFrom(it, "personal"),
            },
          ]
        : [
            {
              value: "open",
              label: "Open",
              icon: it.kind === "personal" ? <VideoIcon size={14} strokeWidth={1.8} /> : <ClapperboardIcon size={14} strokeWidth={1.8} />,
              run: () => open(it),
            },
            { value: "rename", label: "Rename", icon: <TextCursorInputIcon size={14} strokeWidth={1.8} />, run: () => setRenaming(it.key) },
          ];
    const ownPlan =
      it.type === "idea"
        ? []
        : [
            {
              value: "note",
              label: it.note ? "Edit plan note…" : "Plan note…",
              icon: <StickyNoteIcon size={14} strokeWidth={1.8} />,
              run: () => setNoteFor(it),
            },
            {
              value: "yt",
              label: "YouTube video…",
              icon: <SquarePlayIcon size={14} strokeWidth={1.8} />,
              hint:
                it.info?.views != null
                  ? `${it.info.views.toLocaleString()} views`
                  : it.stage === "scheduled" || it.stage === "published"
                    ? void 0
                    : "Once it is up",
              run: () => setYtFor(it),
            },
            ...(it.info?.manual
              ? [
                  {
                    value: "auto",
                    label: "Back to automatic",
                    icon: <Undo2Icon size={14} strokeWidth={1.8} />,
                    hint: `Its files put it in ${STAGE_LABEL[it.info.auto]}`,
                    run: () => setPlan(it, { stage: "auto" }),
                  },
                ]
              : []),
          ];
    const delN = many ? group.filter((x) => x.type === "idea" && shownKeys.has(x.key)).length : 1;
    const last =
      it.type === "idea"
        ? [
            {
              value: "del",
              label: delN > 1 ? `Delete ${delN} picked ideas` : "Delete idea",
              icon: <TrashIcon size={14} strokeWidth={1.8} className="ch-danger" />,
              hint: DEL_KEY,
              group: " ",
              run: () => (delN > 1 ? delKey(it) : delIdea(it)),
            },
          ]
        : it.project?.path
          ? [
              {
                value: "folder",
                label: isMac ? "Show in Finder" : "Show in Explorer",
                icon: <FolderOpenIcon size={14} strokeWidth={1.8} />,
                group: " ",
                run: () => {
                  if (it.info?.missing) toast(`The project folder is missing: ${it.project.path}`, "bad");
                  else api.open(it.project.path).catch((e) => toast(e.message, "bad"));
                },
              },
            ]
          : [];
    if (!many) return [...own, ...[...common, ...ownPlan].map((c) => ({ ...c, group: "Plan" })), ...last];
    return [
      ...common.map((c) => ({ ...c, group: `All ${group.length} picked cards` })),
      ...[...own, ...ownPlan].map((c) => ({ ...c, group: "This card" })),
      ...last,
    ];
  };
  const step = (it, d) => {
    const i = STAGES.indexOf(it.stage) + d;
    if (i < 0 || i >= STAGES.length) return;
    moveGroup(groupOf(it), STAGES[i]);
  };
  const nudge = (it, d) => {
    const g = new Set(
        groupOf(it)
          .filter((x) => x.stage === it.stage)
          .map((x) => x.key),
      ),
      l = (cols.get(it.stage) ?? []).map((x) => x.key);
    let moved = false;
    if (d < 0) {
      for (let i = 1; i < l.length; i++)
        if (g.has(l[i]) && !g.has(l[i - 1])) {
          [l[i - 1], l[i]] = [l[i], l[i - 1]];
          moved = true;
        }
    } else
      for (let i = l.length - 2; i >= 0; i--)
        if (g.has(l[i]) && !g.has(l[i + 1])) {
          [l[i], l[i + 1]] = [l[i + 1], l[i]];
          moved = true;
        }
    if (moved) onMove([...g], it.stage, reorderShown(it.stage, l) ?? l);
  };
  const delKey = (it) => {
    let list = [it];
    if (picked.size) {
      const sel = pickedItems.filter((x) => shownKeys.has(x.key)),
        projects = sel.filter((x) => x.type === "project").length;
      list = sel.filter((x) => x.type === "idea");
      if (!list.length) {
        toast(
          projects
            ? `${isMac ? "⌘⌫" : "Delete"} removes ideas only: ${projects === 1 ? "the picked card is a" : `the ${projects} picked cards are`} ${thing}${projects === 1 ? "" : "s"} (${thing}s are deleted on the ${brand === "personal" ? "Videos" : "Projects"} page).`
            : "The picked ideas are hidden by the search or the filters: nothing was deleted.",
          "info",
        );
        return;
      }
    } else if (it.type !== "idea") return;
    const gone = new Set(list.map((x) => x.key)),
      col = cols.get(it.stage) ?? [],
      i = col.findIndex((x) => x.key === it.key);
    const next = gone.has(it.key) ? [...col.slice(i + 1), ...col.slice(0, Math.max(0, i)).reverse()].find((x) => !gone.has(x.key)) : it;
    setPicked((p) => {
      const n = new Set(p);
      gone.forEach((k) => n.delete(k));
      return n;
    });
    delIdeas(list);
    if (next) focusCard(next.key);
  };
  const thing = brand === "personal" ? "video" : "project";
  const focusCard = (key) => requestAnimationFrame(() => boardRef.current?.querySelector(`.ch-card[data-key="${key}"]`)?.focus());
  const cardKeys = (e, it) => {
    if (e.target !== e.currentTarget) return;
    const k = e.key,
      col = cols.get(it.stage) ?? [],
      i = col.findIndex((x) => x.key === it.key);
    if (k === "Enter") {
      e.preventDefault();
      open(it);
    } else if (k === "F2") {
      e.preventDefault();
      setRenaming(it.key);
    } else if (k === " ") {
      e.preventDefault();
      togglePick(it);
    } else if (isDelKey(e) && (it.type === "idea" || picked.size > 0)) {
      e.preventDefault();
      delKey(it);
    } else if (k === "ContextMenu" || (e.shiftKey && k === "F10")) {
      e.preventDefault();
      setMenu({ at: e.currentTarget, it });
    } else if (e.altKey && (k === "ArrowLeft" || k === "ArrowRight")) {
      e.preventDefault();
      step(it, k === "ArrowLeft" ? -1 : 1);
      focusCard(it.key);
    } else if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) {
      e.preventDefault();
      nudge(it, k === "ArrowUp" ? -1 : 1);
      focusCard(it.key);
    } else if (!e.altKey && (k === "ArrowUp" || k === "ArrowDown")) {
      e.preventDefault();
      const n = col[i + (k === "ArrowUp" ? -1 : 1)];
      if (n) focusCard(n.key);
    } else if (!e.altKey && (k === "ArrowLeft" || k === "ArrowRight")) {
      e.preventDefault();
      const d = k === "ArrowLeft" ? -1 : 1;
      for (let s = visible.indexOf(it.stage) + d; s >= 0 && s < visible.length; s += d) {
        const l = cols.get(visible[s]) ?? [];
        if (l.length && !prefs.collapsed.includes(visible[s])) {
          focusCard(l[Math.min(i, l.length - 1)].key);
          break;
        }
      }
    }
  };
  const click = (e, it) => {
    if (suppress.current || renaming === it.key || e.target.closest("button, input, textarea, a")) return;
    clearTimeout(clickT.current);
    if (e.ctrlKey || e.metaKey) {
      togglePick(it);
      return;
    }
    if (e.shiftKey) {
      rangePick(it);
      return;
    }
    if (picked.size) setPicked(new Set());
    const onTitle = !!e.target.closest(".ch-title");
    if (e.detail >= 2) {
      setOpening(null);
      if (onTitle) setRenaming(it.key);
      return;
    }
    const at = { x: e.clientX, y: e.clientY };
    if (onTitle) {
      setOpening(it.key);
      clickT.current = window.setTimeout(() => {
        setOpening(null);
        openNow(it, at);
      }, 300);
    } else openNow(it, at);
  };
  const openNow = (it, at) => {
    const until = Date.now() + 500,
      evs = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "contextmenu"];
    const off2 = () => evs.forEach((n) => window.removeEventListener(n, eat, true));
    const eat = (ev) => {
      if (Date.now() > until) {
        off2();
        return;
      }
      const m = ev;
      if (Math.abs(m.clientX - at.x) <= 8 && Math.abs(m.clientY - at.y) <= 8) {
        ev.stopPropagation();
        ev.preventDefault();
      }
    };
    evs.forEach((n) => window.addEventListener(n, eat, true));
    setTimeout(off2, 520);
    open(it);
  };
  const [opening, setOpening] = useState(null);
  useEffect(() => () => clearTimeout(clickT.current), []);
  const dbl = (e) => {
    e.preventDefault();
  };
  const actsNow = useRef(null);
  actsNow.current = {
    down,
    click,
    dbl,
    keys: cardKeys,
    start: (it) => startFrom(it, brand),
    rename: (it, n, byKey) => rename(it, n, byKey),
    cancelRename: (it) => {
      setRenaming(null);
      focusCard(it.key);
    },
    ctx: (e, it) => {
      e.preventDefault();
      clearTimeout(clickT.current);
      setOpening(null);
      setMenu({ at: { x: e.clientX, y: e.clientY }, it });
    },
    menu: (el, n, it) => setMenu((m) => (m?.it.key === it.key && m.at === el ? (n > 1 ? m : null) : { at: el, it })),
  };
  const acts = useMemo(
    () => ({
      down: (e, it) => actsNow.current.down(e, it),
      click: (e, it) => actsNow.current.click(e, it),
      dbl: (e) => actsNow.current.dbl(e),
      keys: (e, it) => actsNow.current.keys(e, it),
      start: (it) => actsNow.current.start(it),
      rename: (it, n, b) => actsNow.current.rename(it, n, b),
      cancelRename: (it) => actsNow.current.cancelRename(it),
      ctx: (e, it) => actsNow.current.ctx(e, it),
      menu: (el, n, it) => actsNow.current.menu(el, n, it),
    }),
    [],
  );
  const rename = async (it, name, byKey = false) => {
    setRenaming(null);
    if (byKey) focusCard(it.key);
    const n = name.replace(/\s+/g, " ").trim();
    if (!n || n === it.title) return;
    try {
      if (it.type === "idea") await api.ideaUpdate(it.key, { title: n });
      else if (it.kind === "personal") await api.personalSetPlan(it.key, { title: n });
      else await api.renameProject(it.key, n);
      if (it.type !== "idea") await refreshProjects();
    } catch (e) {
      toast(e.message, "bad");
    }
    (it.type === "idea" ? reloadIdeas : reload)();
  };
  const toggleCol = (s) =>
    setPrefs({ collapsed: prefs.collapsed.includes(s) ? prefs.collapsed.filter((x) => x !== s) : [...prefs.collapsed, s] });
  const inView = items.filter((it) => visible.includes(it.stage)).length,
    elsewhere = STAGES.filter((s) => !visible.includes(s) && cols.get(s)?.length);
  const restoring = useRef(null);
  useLayoutEffect(() => {
    const b = boardRef.current;
    if (!b) return;
    const s = boardScroll.get(scope) ?? { left: 0, tops: {} };
    const apply = () => {
      b.scrollLeft = s.left;
      b.querySelectorAll(".ch-col[data-stage]").forEach((c) => {
        const l = c.querySelector(".ch-col-list");
        if (l) l.scrollTop = s.tops[c.dataset.stage] ?? 0;
      });
    };
    restoring.current = s;
    apply();
    const ro = new ResizeObserver(() => {
      if (restoring.current === s) apply();
    });
    ro.observe(b);
    const stop = () => {
      if (restoring.current === s) restoring.current = null;
    };
    const t = setTimeout(() => {
      stop();
      ro.disconnect();
      save();
    }, 1200);
    b.addEventListener("pointerdown", stop);
    b.addEventListener("wheel", stop, { passive: true });
    b.addEventListener("keydown", stop);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      stop();
      b.removeEventListener("pointerdown", stop);
      b.removeEventListener("wheel", stop);
      b.removeEventListener("keydown", stop);
    };
  }, [scope]);
  const keepScroll = () => {
    if (!restoring.current) save();
    measureOff();
  };
  const lastOff = useRef(""),
    [off, setOff] = useState({ l: null, r: null });
  const measureOff = () => {
    const b = boardRef.current;
    if (!b) return;
    const br = b.getBoundingClientRect(),
      side = {
        l: null,
        r: null,
        at: { left: Math.round(br.left + 28), right: Math.round(innerWidth - br.right + 28), top: Math.round(br.bottom - 23) },
      };
    if (b.scrollWidth > b.clientWidth + 1)
      b.querySelectorAll(".ch-col[data-stage]").forEach((c) => {
        const r = c.getBoundingClientRect(),
          s = c.dataset.stage,
          n = colsRef.current.get(s)?.length ?? 0;
        const k = r.left >= br.right - 48 ? "r" : r.right <= br.left + 48 ? "l" : null;
        if (!n || !k) return;
        const o = side[k];
        side[k] = { n: (o?.n ?? 0) + n, stages: [...(o?.stages ?? []), s] };
      });
    if (!side.l && !side.r) delete side.at;
    const j = JSON.stringify(side);
    if (j !== lastOff.current) {
      lastOff.current = j;
      setOff(side);
    }
  };
  useLayoutEffect(() => {
    measureOff();
    const b = boardRef.current,
      ro = b ? new ResizeObserver(() => measureOff()) : null;
    if (b) ro.observe(b);
    addEventListener("resize", measureOff);
    return () => {
      ro?.disconnect();
      removeEventListener("resize", measureOff);
    };
  }, [cols, prefs.stage, prefs.collapsed.join(), prefs.compact]);
  const offLabel = (o) =>
    `${o.n} in ${o.stages.length > 2 ? `${STAGE_LABEL[o.stages[0]]} and ${o.stages.length - 1} more` : o.stages.map((s) => STAGE_LABEL[s]).join(", ")}`;
  const bringIn = (k) => {
    const o = JSON.parse(lastOff.current || "{}")[k] ?? null,
      b = boardRef.current;
    if (!o || !b) return;
    const c = b.querySelector(`.ch-col[data-stage="${k === "r" ? o.stages[0] : o.stages[o.stages.length - 1]}"]`);
    if (!c) return;
    const br = b.getBoundingClientRect(),
      r = c.getBoundingClientRect();
    b.scrollTo({ left: b.scrollLeft + (k === "r" ? r.right - br.right + 28 : r.left - br.left - 28), behavior: "smooth" });
  };
  const save = () => {
    const b = boardRef.current;
    if (!b) return;
    const tops = {};
    b.querySelectorAll(".ch-col[data-stage]").forEach((c) => {
      const l = c.querySelector(".ch-col-list");
      if (l?.scrollTop) tops[c.dataset.stage] = l.scrollTop;
    });
    boardScroll.set(scope, { left: b.scrollLeft, tops });
  };
  useEffect(() => {
    const b = boardRef.current;
    if (!b) return;
    const wheel = (e) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        !e.deltaY ||
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ||
        b.scrollWidth <= b.clientWidth + 1
      )
        return;
      const list = e.target.closest?.(".ch-col-list");
      if (list && list.scrollHeight > list.clientHeight + 1) return;
      e.preventDefault();
      b.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    };
    b.addEventListener("wheel", wheel, { passive: false });
    return () => b.removeEventListener("wheel", wheel);
  }, []);
  return (
    <>
      {filtered && !inView && (
        <p className="muted ch-nomatch">
          {elsewhere.length && prefs.stage !== "all"
            ? `No cards in ${STAGE_LABEL[prefs.stage]} match. ${items.length} ${items.length === 1 ? "does" : "do"} in ${elsewhere.map((s) => STAGE_LABEL[s]).join(", ")}.`
            : "No cards match."}{" "}
          <button className="text-btn link" onClick={onShowAll}>
            Show everything
          </button>
        </p>
      )}
      {!(filtered && !inView) && hidden && (
        <p className="muted ch-nomatch ch-hidden">
          <EyeIcon size={13} strokeWidth={1.8} />
          {hidden.n} {hidden.n === 1 ? "card is" : "cards are"}
          {" hidden by the filters ("}
          {hidden.why}).{" "}
          <button className="text-btn link" onClick={onShowAll}>
            Show everything
          </button>
        </p>
      )}
      <div
        ref={boardRef}
        className={`ch-board ${prefs.compact ? "compact" : ""} ${visible.length === 1 ? "one" : ""} ${drag ? "dragging" : ""}`}
        onPointerMove={moveP}
        onPointerUp={up}
        onScrollCapture={keepScroll}
        onPointerCancel={() => endDrag(false)}
        onLostPointerCapture={(e) => {
          if (D.current?.started && e.target === boardRef.current) endDrag(false);
        }}
      >
        {!drag &&
          off.at &&
          ["l", "r"].map((k) => {
            const o = off[k];
            return (
              o && (
                <button
                  key={k}
                  className={`ch-offview ${k}`}
                  style={{ top: off.at.top, ...(k === "r" ? { right: off.at.right } : { left: off.at.left }) }}
                  onClick={() => bringIn(k)}
                  title={`${o.n} ${o.n === 1 ? "card" : "cards"} out of sight ${k === "r" ? "to the right" : "to the left"}, in ${o.stages.map((s) => STAGE_LABEL[s]).join(", ")}. Click to scroll to them.`}
                >
                  {k === "l" && <ChevronsLeftIcon size={13} strokeWidth={1.9} />}
                  <span>{offLabel(o)}</span>
                  {k === "r" && <ChevronsRightIcon size={13} strokeWidth={1.9} />}
                </button>
              )
            );
          })}
        {visible.map((s) => {
          const list = cols.get(s) ?? [],
            closed = prefs.collapsed.includes(s) && visible.length > 1,
            here = over?.stage === s;
          const late = list.filter((it) => dueState(it.due, it.stage) === "over").length;
          const rest = here && drag ? list.filter((x) => !drag.group.has(x.key)) : list,
            before = here && drag ? (rest[over.index]?.key ?? null) : void 0;
          return (
            <section
              key={s}
              className={`ch-col chs-${s} ${closed ? "collapsed" : ""} ${here ? "over" : ""}`}
              data-stage={s}
              aria-label={`${STAGE_LABEL[s]}: ${list.length}`}
            >
              <header
                className="ch-col-head"
                onDoubleClick={(e) => {
                  if (visible.length > 1 && !e.target.closest("button")) toggleCol(s);
                }}
              >
                <i className={`ch-dot chs-${s}`} />
                <b>{STAGE_LABEL[s]}</b>
                <small>{list.length}</small>
                {late > 0 && !closed && (
                  <span className="ch-late" title={`${late} late`}>
                    {late}
                    {" late"}
                  </span>
                )}
                {visible.length > 1 && (
                  <button
                    className="icon-btn sm ch-col-fold"
                    onClick={() => toggleCol(s)}
                    aria-label={closed ? `Show ${STAGE_LABEL[s]}` : `Fold ${STAGE_LABEL[s]}`}
                    title={closed ? "Show this column" : "Fold this column"}
                  >
                    {closed ? <ChevronsRightIcon size={14} strokeWidth={1.8} /> : <ChevronsLeftIcon size={14} strokeWidth={1.8} />}
                  </button>
                )}
              </header>
              {closed ? (
                <button className="ch-col-closed" onClick={() => toggleCol(s)} aria-label={`Show ${STAGE_LABEL[s]}`}>
                  <span>{STAGE_LABEL[s]}</span>
                  <small>{list.length}</small>
                </button>
              ) : (
                <>
                  {s === "idea" && (
                    <QuickIdea
                      channelId={newIdeaChannel}
                      onAdded={(l) => {
                        reloadIdeas();
                        onIdeasAdded(l);
                      }}
                    />
                  )}
                  <div className="ch-col-list">
                    {list.map((it) => (
                      <Fragment key={it.key}>
                        {before === it.key && <div className="ch-drop" style={{ height: drag.h }} />}
                        <Card
                          it={it}
                          ch={it.channelId ? (byId.get(it.channelId) ?? null) : null}
                          showChannel={showChannel}
                          compact={prefs.compact}
                          dragging={!!drag?.group.has(it.key)}
                          picked={picked.has(it.key)}
                          opening={opening === it.key}
                          renaming={renaming === it.key}
                          brand={brand}
                          acts={acts}
                        />
                      </Fragment>
                    ))}
                    {before === null && <div className="ch-drop" style={{ height: drag.h }} />}
                    {!list.length && !(here && drag) && (
                      <div className="ch-col-empty">
                        {empty && s === "idea" && channels.length === 0 ? (
                          <>
                            <b>Nothing here yet</b>
                            <span>{HINT[s]}</span>
                            <button className="btn small" onClick={onNewChannel}>
                              <PlusIcon size={14} />
                              New channel
                            </button>
                          </>
                        ) : (
                          <span>{HINT[s]}</span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>
      {menu && (
        <ActionMenu
          key={menu.it.key}
          at={menu.at}
          label={`${menu.it.title}: menu`}
          onClose={() => setMenu(null)}
          items={itemsFor(menu.it)}
          width={262}
        />
      )}
      {dueFor && (
        <DueDialog
          title={dueFor.length === 1 ? dueFor[0].title : `${dueFor.length} cards`}
          value={dueFor.length === 1 ? dueFor[0].due : null}
          canClear={dueFor.some((it) => !!it.due)}
          onClose={() => setDueFor(null)}
          onSave={(d) =>
            onDue(
              dueFor.map((it) => it.key),
              d,
            )
          }
        />
      )}
      {noteFor && (
        <NoteDialog
          title={noteFor.title}
          value={noteFor.note}
          onClose={() => setNoteFor(null)}
          onSave={(n) => setPlan(noteFor, { planNote: n })}
        />
      )}
      {ideaFor && (
        <IdeaDialog
          it={ideaFor === "new" ? null : ideaFor}
          channelId={newIdeaChannel}
          onClose={() => setIdeaFor(null)}
          onSaved={(r) => {
            reloadIdeas();
            onIdeaSaved(r, ideaFor === "new" ? null : ideaFor);
          }}
          onStart={(it, kind) => startFrom(it, kind)}
          onDelete={delIdea}
        />
      )}
      {newCh && (
        <ChannelEditor
          onClose={() => setNewCh(null)}
          onSaved={(c) => {
            const its = newCh;
            setNewCh(null);
            onAssign(its, c.id);
            if (its.length > 1) setPicked(new Set());
          }}
        />
      )}
      {ytFor && (
        <LinkVideoDialog
          projectId={ytFor.key}
          name={ytFor.title}
          onClose={() => {
            const k = ytFor.key;
            setYtFor(null);
            reload();
            focusCard(k);
          }}
        />
      )}
      {pickedItems.length > 0 && (
        <div ref={bulkRef} className="ch-bulk" role="toolbar" aria-label="Picked cards">
          <b>
            {pickedItems.length}
            {" picked"}
          </b>
          {pickedHidden > 0 && (
            <small className="ch-bulk-hid" title="Picked cards the search or the filters hide right now: the buttons act on them too">
              {pickedHidden}
              {" hidden by the filters"}
            </small>
          )}
          <button className="btn small" title="Move to stage" onClick={(e) => setBulkMenu({ at: e.currentTarget, kind: "stage" })}>
            <KanbanIcon size={14} strokeWidth={1.8} />
            <span>Move to stage</span>
          </button>
          <button className="btn small" title="Move to channel" onClick={(e) => setBulkMenu({ at: e.currentTarget, kind: "channel" })}>
            <ArrowRightLeftIcon size={14} strokeWidth={1.8} />
            <span>Move to channel</span>
          </button>
          <button className="btn small" title="Due date" onClick={() => setDueFor(pickedItems)}>
            <CalendarClockIcon size={14} strokeWidth={1.8} />
            <span>Due date</span>
          </button>
          <button className="icon-btn sm" aria-label="Unpick all" title="Unpick all (Esc)" onClick={() => setPicked(new Set())}>
            <XIcon size={15} />
          </button>
        </div>
      )}
      {bulkMenu && (
        <ActionMenu
          key={bulkMenu.kind}
          at={bulkMenu.at}
          label="Picked cards"
          onClose={() => setBulkMenu(null)}
          items={
            bulkMenu.kind === "stage"
              ? STAGES.map((s) => ({
                  value: "st:" + s,
                  label: STAGE_LABEL[s],
                  icon: <i className={`ch-dot chs-${s}`} />,
                  run: () => {
                    moveGroup(pickedItems, s);
                    setPicked(new Set());
                  },
                }))
              : channelItems(channels, "__several", (id) => {
                  if (id === "new") setNewCh(pickedItems);
                  else {
                    onAssign(pickedItems, id);
                    setPicked(new Set());
                  }
                })
          }
        />
      )}
    </>
  );
}
const Card = memo(
  CardView,
  (a, b) =>
    a.it === b.it &&
    a.ch?.id === b.ch?.id &&
    a.ch?.name === b.ch?.name &&
    a.ch?.color === b.ch?.color &&
    a.showChannel === b.showChannel &&
    a.compact === b.compact &&
    a.dragging === b.dragging &&
    a.picked === b.picked &&
    a.opening === b.opening &&
    a.renaming === b.renaming &&
    a.brand === b.brand &&
    a.acts === b.acts,
);
function CardView({ it, ch, showChannel, compact, dragging, picked, opening, renaming, brand, acts }) {
  const info = it.info,
    due = dueState(it.due, it.stage),
    thumb = it.project?.thumb;
  const len = info ? (info.length > 0 ? fmtLength(info.length) : info.target ? `~${fmtLength(info.target)}` : "") : "";
  const pct = info ? Math.round((info.done / Math.max(1, info.total)) * 100) : 0;
  const ahead = info ? STAGES.indexOf(it.stage) > STAGES.indexOf(info.auto) : false;
  const out = it.stage === "scheduled" || it.stage === "published";
  const mode = info
    ? info.manual
      ? `Placed in ${STAGE_LABEL[it.stage]} by hand${info.stageAt ? ` ${ago(info.stageAt)}` : ""}. ${out ? "It stays there until you choose Back to automatic in its menu." : `${ahead ? `It goes back to automatic once its files reach ${STAGE_LABEL[it.stage]} (now: ${STAGE_LABEL[info.auto]})` : `Its files are further along (${STAGE_LABEL[info.auto]}): it stays here until they move on to another stage`}, or with Back to automatic in its menu.`}`
      : `Automatic: follows the project's files.${info.next ? ` Next: ${info.next}.` : ""}`
    : "";
  return (
    <article
      className={`ch-card ${it.type} ${dragging ? "dragging" : ""} ${picked ? "picked" : ""} ${opening ? "opening" : ""} ${showChannel && ch ? "has-ch" : ""} ${info?.missing ? "missing" : ""}`}
      data-key={it.key}
      tabIndex={0}
      style={ch ? { "--chc": markColor(ch.color) } : void 0}
      aria-label={`${it.type === "idea" ? "Idea" : it.kind === "personal" ? "Personal video" : "Project"}: ${it.title}. ${STAGE_LABEL[it.stage]}${info?.manual ? ", placed by hand" : ""}.`}
      aria-selected={picked}
      title={`${it.title}
Click to open, drag to move, right-click for more (${ALT} ← / → moves it a stage, ${MOD}-click picks several)`}
      onPointerDown={(e) => acts.down(e, it)}
      onClick={(e) => acts.click(e, it)}
      onDoubleClick={acts.dbl}
      onKeyDown={(e) => acts.keys(e, it)}
      onContextMenu={(e) => acts.ctx(e, it)}
    >
      {it.type === "project" && !compact && (
        <div
          className={`ch-cover ${it.kind === "personal" ? "personal" : ""} ${it.project?.style_id === "pixel-art" ? "pixel" : ""} ${thumb ? "" : "nopic"}`}
        >
          {thumb ? (
            <img src={thumb} alt="" loading="lazy" draggable={false} onError={(e) => (e.target.style.display = "none")} />
          ) : it.kind === "personal" ? (
            <VideoIcon size={22} strokeWidth={1.5} />
          ) : (
            <FilmIcon size={22} strokeWidth={1.5} />
          )}
          {len && (
            <span className="ch-len" title={info && !info.length && info.target ? "Planned length" : "Length"}>
              {len}
            </span>
          )}
          {info?.tall && (
            <span className="ch-tall" title="Vertical 9:16">
              9:16
            </span>
          )}
        </div>
      )}
      {opening && (
        <span className="ch-opening" role="status" aria-label="Opening">
          <Spinner size={12} />
        </span>
      )}
      <div className="ch-card-body">
        {showChannel && ch && (
          <div className="ch-card-ch">
            <i />
            <span className="ellipsis" dir="auto">
              {ch.name}
            </span>
          </div>
        )}
        <div className="ch-title-row">
          {it.type === "idea" && (
            <span className="ch-idea-ic">
              <LightbulbIcon size={13} strokeWidth={1.9} />
            </span>
          )}
          {it.type === "project" && compact && (
            <span className="ch-mini">
              {thumb ? (
                <img src={thumb} alt="" draggable={false} />
              ) : it.kind === "personal" ? (
                <VideoIcon size={12} />
              ) : (
                <FilmIcon size={12} />
              )}
            </span>
          )}
          {renaming ? (
            <RenameField value={it.title} onDone={(n, byKey) => acts.rename(it, n, byKey)} onCancel={() => acts.cancelRename(it)} />
          ) : (
            <h4 className="ch-title" title="Double-click to rename">
              {it.title}
            </h4>
          )}
        </div>
        {(info || it.due) && (
          <div className="ch-meta">
            {info && (
              <span className="ch-tag" title={info.look ? `${info.style} · ${info.look}` : info.style}>
                {info.style}
              </span>
            )}
            {compact && len && <span className="ch-meta-len">{len}</span>}
            {it.due && (
              <span className={`ch-due ${due ?? "done"}`} title={it.due}>
                <CalendarClockIcon size={11} strokeWidth={2} />
                {dueChip(it.due, it.stage)}
              </span>
            )}
            {info?.views != null && (
              <span className="ch-views" title="Views on YouTube">
                <EyeIcon size={11} strokeWidth={2} />
                {info.views.toLocaleString()}
              </span>
            )}
            {it.stage === "scheduled" && info?.publishedAt && !isNaN(Date.parse(info.publishedAt)) && (
              <span
                className="ch-views"
                title={`Goes public on YouTube ${new Date(info.publishedAt).toLocaleString(void 0, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}`}
              >
                <SquarePlayIcon size={11} strokeWidth={2} />
                {new Date(info.publishedAt).toLocaleDateString(void 0, { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
        )}
        {it.note && <p className="ch-note">{it.note}</p>}
        {info?.missing && (
          <p className="ch-warn">
            <TriangleAlertIcon size={12} />
            Folder missing
          </p>
        )}
        {info?.unreadable && (
          <p
            className="ch-warn"
            title="Something in its folder is not what the app expects (a file where a folder should be, or no permission to read it)."
          >
            <TriangleAlertIcon size={12} />
            Its files could not be read
          </p>
        )}
        {info && (
          <div className="ch-prog" title={`${info.done} of ${info.total} steps done${info.next ? ` · next: ${info.next}` : ""}`}>
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="ch-foot">
          {info ? (
            <span className={`ch-mode ${info.manual ? "manual" : ""}`} title={mode}>
              {info.manual ? (
                <>
                  <PinIcon size={11} strokeWidth={2} />
                  By hand
                </>
              ) : (
                <>
                  <RefreshCwIcon size={11} strokeWidth={2} />
                  Auto
                </>
              )}
            </span>
          ) : (
            <button
              className="btn tiny ch-start"
              onClick={() => acts.start(it)}
              title={`Start a ${brand === "personal" ? "video" : "project"} from this idea, filled in with it (its menu has both kinds: Faceless project, Personal video)`}
            >
              {"Start "}
              {brand === "personal" ? "video" : "project"}
            </button>
          )}
          <span className="grow" />
          <button
            className="icon-btn sm ch-more"
            aria-label={`${it.title}: menu`}
            onClick={(e) => {
              e.stopPropagation();
              acts.menu(e.currentTarget, e.detail, it);
            }}
          >
            <EllipsisIcon size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </article>
  );
}
function RenameField({ value, onDone, onCancel }) {
  const [v, setV] = useState(value),
    done = useRef(false);
  const finish = (save, byKey = false) => {
    if (done.current) return;
    done.current = true;
    save ? onDone(v, byKey) : onCancel();
  };
  return (
    <input
      className="ch-rename"
      autoFocus
      value={v}
      maxLength={200}
      aria-label="Name"
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (isEnter(e)) {
          e.preventDefault();
          finish(true, true);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
const listLines = (text) =>
  text
    .split(/\r\n?|\n/)
    .map((l) =>
      l
        .replace(/^\s*(?:[-*•‣◦·–]|\d{1,3}[.)]|\[[ xX]?\])\s+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
const TITLE_MAX = 200;
function QuickIdea({ channelId, onAdded }) {
  const { toast } = useApp();
  const [v, setV] = useState(""),
    [busy, setBusy] = useState(0);
  const queue = useRef(Promise.resolve());
  const save = (titles) => {
    setBusy((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        const made =
          titles.length === 1 ? [await api.ideaCreate({ title: titles[0], channelId })] : await api.ideaCreateMany(titles, channelId);
        onAdded(made);
        if (made.length > 1)
          toast(`Added ${made.length} ideas, one per line.`, "ok", {
            label: "Undo",
            run: () => {
              api.ideaDeleteMany(made.map((i) => i.id)).catch((e) => toast(e.message, "bad"));
            },
          });
      } catch (e) {
        toast(e.message, "bad");
        if (titles.length === 1) setV((cur) => cur || titles[0]);
      } finally {
        setBusy((n) => n - 1);
      }
    });
  };
  const add = () => {
    const t = v.trim();
    if (!t) return;
    setV("");
    save([t]);
  };
  const paste = (e) => {
    const text = e.clipboardData.getData("text/plain"),
      lines = listLines(text);
    if (lines.length > 1) {
      e.preventDefault();
      save(lines.slice(0, 200));
      if (lines.length > 200) toast(`Only the first 200 lines were added (the list has ${lines.length}).`, "info");
      return;
    }
    const el = e.currentTarget,
      room = TITLE_MAX - (v.length - ((el.selectionEnd ?? 0) - (el.selectionStart ?? 0)));
    if (text.trim().length > room)
      toast(`An idea's title holds ${TITLE_MAX} characters, so the end was left out. Its notes (open the idea) take the rest.`, "info");
  };
  return (
    <div className="ch-quick-idea">
      <PlusIcon size={14} strokeWidth={1.9} />
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Add an idea…"
        aria-label="Add an idea"
        maxLength={TITLE_MAX}
        onPaste={paste}
        title="Enter adds it. Paste a list to add one idea per line."
        onKeyDown={(e) => {
          if (isEnter(e)) {
            e.preventDefault();
            add();
          }
          if (e.key === "Escape" && v) {
            e.stopPropagation();
            setV("");
          }
        }}
      />
      {busy > 0 && <Spinner size={12} />}
    </div>
  );
}
function IdeaDialog({ it, channelId, onClose, onSaved, onStart, onDelete }) {
  const { toast, channels, brand } = useApp();
  const [title, setTitle] = useState(it?.title ?? ""),
    [notes, setNotes] = useState(it?.note ?? "");
  const [ch, setCh] = useState(it ? (it.channelId ?? "none") : (channelId ?? "none"));
  const [stage, setStage] = useState(it?.stage ?? "idea"),
    [due, setDue] = useState(it?.due ?? "");
  const dueRef = useRef(null),
    [partial, setPartial] = useState(false),
    [dueMsg, setDueMsg] = useState(null);
  const readDue = () => {
    const el = dueRef.current;
    if (el) {
      setPartial(el.validity.badInput);
      if (!dateProblem(el, el.value)) setDueMsg(null);
    }
  };
  const clearDue = () => {
    if (dueRef.current) dueRef.current.value = "";
    setDue("");
    setPartial(false);
    setDueMsg(null);
    dueRef.current?.focus();
  };
  const chOpts = useMemo(
    () => [
      { value: "none", label: "No channel", icon: <ChannelAvatar c={null} size={20} /> },
      ...channels.map((c) => ({ value: c.id, label: c.name, icon: <ChannelAvatar c={c} size={20} /> })),
    ],
    [channels],
  );
  const stOpts = useMemo(() => STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s], icon: <i className={`ch-dot chs-${s}`} /> })), []);
  const save = async (then) => {
    if (!title.trim()) {
      toast("Write the idea first.", "bad");
      return;
    }
    const p = dateProblem(dueRef.current, due);
    if (p) {
      setDueMsg(`${p} Or clear it.`);
      dueRef.current?.focus();
      return;
    }
    const patch = { title, notes: notes || null, channelId: ch === "none" ? null : ch, stage, dueAt: due || null };
    try {
      const r = it ? await api.ideaUpdate(it.key, patch) : await api.ideaCreate(patch);
      onSaved(r);
      onClose();
      then?.({
        key: r.id,
        type: "idea",
        title: r.title,
        stage: r.stage,
        channelId: r.channel_id,
        due: r.due_at,
        note: r.notes,
        order: r.sort,
        recent: 0,
        kind: null,
        idea: r,
      });
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const dirty = () =>
    title !== (it?.title ?? "") ||
    notes !== (it?.note ?? "") ||
    ch !== (it ? (it.channelId ?? "none") : (channelId ?? "none")) ||
    stage !== (it?.stage ?? "idea") ||
    due !== (it?.due ?? "") ||
    partial;
  return (
    <Modal title={it ? "Idea" : "New idea"} onClose={onClose} className="ch-idea-modal" dirty={dirty}>
      <div
        className="modal-body"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <input
          className="np-title"
          autoFocus
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="The idea, as a working title"
          aria-label="Idea"
          onPaste={(e) => {
            const lines = listLines(e.clipboardData.getData("text/plain"));
            if (lines.length < 2) return;
            e.preventDefault();
            const el = e.currentTarget,
              a = el.selectionStart ?? title.length,
              b = el.selectionEnd ?? a;
            setTitle((title.slice(0, a) + lines[0] + title.slice(b)).slice(0, TITLE_MAX));
            setNotes((n) => [n.trimEnd(), ...lines.slice(1)].filter(Boolean).join("\n"));
          }}
          onKeyDown={(e) => {
            if (isEnter(e) && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="field">
          <label htmlFor="ch-idea-notes">
            {"Notes "}
            <span className="dim">· become the topic Claude researches, and the plan note</span>
          </label>
          <textarea
            id="ch-idea-notes"
            className="input"
            rows={5}
            maxLength={5e3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Angle, hook, sources, what viewers asked for…"
          />
        </div>
        <div className="ch-idea-grid">
          <div className="field">
            <label htmlFor="ch-idea-ch">Channel</label>
            <Picker id="ch-idea-ch" value={ch} options={chOpts} onChange={setCh} menuWidth={240} />
          </div>
          <div className="field">
            <label htmlFor="ch-idea-stage">Stage</label>
            <Picker id="ch-idea-stage" value={stage} options={stOpts} onChange={(v) => setStage(v)} menuWidth={200} />
          </div>
          <div className="field">
            <label htmlFor="ch-idea-due">
              Due
              {(due || partial) && (
                <button type="button" className="text-btn ch-due-clear" onClick={clearDue}>
                  Clear
                </button>
              )}
            </label>
            <input
              ref={dueRef}
              id="ch-idea-due"
              type="date"
              className="input"
              {...DATE_LIMITS}
              value={due}
              onChange={(e) => {
                setDue(e.target.value);
                readDue();
              }}
              onKeyUp={readDue}
              onBlur={readDue}
              aria-describedby={dueMsg ? "ch-idea-due-msg" : void 0}
            />
          </div>
        </div>
        {dueMsg && (
          <span id="ch-idea-due-msg" className="help warn ch-idea-due-msg" role="alert">
            {dueMsg}
          </span>
        )}
        <div className="modal-actions ch-idea-actions">
          {it && (
            <button
              className="btn ghost ch-del"
              onClick={() => {
                onClose();
                onDelete(it);
              }}
            >
              <TrashIcon size={14} />
              Delete
            </button>
          )}
          <span className="np-keys" aria-hidden="true">
            <kbd>{MOD}</kbd>
            <kbd>{isMac ? "↩" : "Enter"}</kbd>to save
          </span>
          <button
            className="btn"
            onClick={() => save((s) => onStart(s, brand === "personal" ? "personal" : "faceless"))}
            title="Saves the idea and opens the new project dialog with it filled in"
          >
            {brand === "personal" ? <VideoIcon size={15} strokeWidth={1.8} /> : <ClapperboardIcon size={15} strokeWidth={1.8} />}
            {"Start "}
            {brand === "personal" ? "video" : "project"}
          </button>
          <button className="btn primary" onClick={() => save()}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
