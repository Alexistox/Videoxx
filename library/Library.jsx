import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, on } from "../src/renderer/src/lib/api";
import { ago } from "../src/renderer/src/lib/format";
import { useApp } from "../src/renderer/src/state/AppProvider";
import {
  Activity,
  Aperture,
  Archive,
  ArchiveRestore,
  AudioLines,
  Box,
  Check,
  Clapperboard,
  Copy,
  ExternalLink,
  FileCode,
  Flag,
  FolderOpen,
  Grid3x3,
  Image,
  Inbox,
  Library as Library$1,
  Lightbulb,
  ListChecks,
  Palette,
  Pencil,
  PersonStanding,
  Play,
  Search,
  ShieldCheck,
  Ship,
  Sprout,
  Square,
  Trash,
  TriangleAlert,
  Type,
  X,
} from "../node_modules/lucide-react/dist/esm/lucide-react";
import { isMac } from "../src/renderer/src/help/keys";
import { Spinner } from "../src/renderer/src/components/ui";
import { takeLibraryInbox } from "../state/libraryInbox";

const FOLDER_APP = isMac ? "Finder" : "Explorer";
const TRASH = isMac ? "Trash" : "Recycle Bin";
const KIND = {
  model: ["3D model", Box],
  module: ["Code module", FileCode],
  material: ["Material", Palette],
  texture: ["Texture", Grid3x3],
  image: ["Picture", Image],
  sprite: ["Sprite", PersonStanding],
  font: ["Font", Type],
  sound: ["Sound", AudioLines],
  anim: ["Animation", Activity],
  pose: ["Pose", PersonStanding],
  recipe: ["Scene recipe", Clapperboard],
  look: ["Look", Aperture],
  solution: ["Solution", Lightbulb],
  pitfall: ["Pitfall", TriangleAlert],
  check: ["Check", ListChecks],
};
const SOURCE = {
  ws: "Mine",
  seed: "Built-in",
  lowpoly: "Low poly assets",
  sfx: "Sounds",
  char: "Characters",
  sprite: "Sprites",
  fig: "3D figures",
  img: "Pictures",
};
const SOURCE_ORDER = ["ws", "seed", "lowpoly", "sfx", "char", "sprite", "fig", "img"];
const STATUS = {
  proposed: ["Proposed", ""],
  accepted: ["Accepted", "gray"],
  verified: ["Verified", "blue"],
  proven: ["Proven", "mint"],
  flagged: ["Flagged", "red"],
  retired: ["Retired", "gray"],
};
const STATUS_ORDER = ["proposed", "accepted", "verified", "proven", "flagged", "retired"];
const BASE_NAMES = {
  any: "Any style",
  recon: "3D reconstruction",
  lowpoly: "Low poly shorts",
  flat: "Flat explainer",
  collage: "Vox",
  stickman: "MS Paint stick figures",
  "pixel-art": "Pixel art",
  starter: "Starter",
};
const TABS = [
  ["all", "All"],
  ["assets", "Assets"],
  ["scenes", "Scenes"],
  ["knowhow", "Know-how"],
];
const FED_NOTE = {
  lowpoly: "Part of the low poly asset library: Claude places it in low poly and 3D reconstruction videos by its id.",
  sfx: "Part of your sound effects: the sound design picks it by its category (Settings > Media > Sound effects library).",
  char: "One of your Flat explainer characters (Characters in Styles): new Flat videos can star it.",
  sprite: "Stick-figure sprites drawn for an earlier video: later videos reuse them for free.",
  fig: "A rigged person model for 3D reconstruction videos (Look > Characters copies it into a video).",
  img: "A picture Claude made for one of your videos. When another video asks for the same picture (same look and prompt), it is copied from there for free.",
};
const SCOPE_LETTER = { G: "Every style", R: "This style only", I: "One video only" };
const PAGE = 120;
const StatusBadge = ({ s }) => {
  const [t, c] = STATUS[s] ?? [s, "gray"];
  return (
    <span className={`badge ${c} lby-status`} data-status={s}>
      <i />
      {t}
    </span>
  );
};
function KindBadge({ k }) {
  const [t, Ic] = KIND[k] ?? [k, Box];
  return (
    <span className="badge gray lby-kind">
      <Ic size={11} strokeWidth={1.8} />
      {t}
    </span>
  );
}
let audio = null;
export function Library() {
  const { toast, allProjects, setLibProposed } = useApp();
  const [query, setQuery] = useState(""),
    [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [f, setF] = useState({});
  const [data, setData] = useState(null),
    [limit, setLimit] = useState(PAGE),
    [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [styleNames, setStyleNames] = useState({});
  const [trash, setTrash] = useState(0);
  const [lastH, setLastH] = useState(null),
    [hvBusy, setHvBusy] = useState({});
  const harvestable = useMemo(
    () =>
      [...allProjects]
        .filter((p) => p.kind !== "personal" && p.exists !== false && p.labKind !== "character")
        .sort((a, b) => String(b.opened_at || b.updated_at || "").localeCompare(String(a.opened_at || a.updated_at || ""))),
    [allProjects],
  );
  const [hvProject, setHvProject] = useState("");
  const hvPick = hvProject && harvestable.some((p) => p.id === hvProject) ? hvProject : (harvestable[0]?.id ?? "");
  const loadLastH = () =>
    api
      .libraryLastHarvest()
      .then(setLastH)
      .catch(() => {});
  useEffect(() => {
    loadLastH();
    api
      .libraryHarvestState()
      .then((s) =>
        setHvBusy(
          Object.fromEntries([...(s?.queued ?? []).map((id) => [id, "queued"]), ...(s?.running ?? []).map((id) => [id, "running"])]),
        ),
      )
      .catch(() => {});
    return on("library:harvest", (ev) => {
      setHvBusy((b) => {
        const n = { ...b };
        if (ev.type === "queued" || ev.type === "started") n[ev.projectId] = ev.type === "queued" ? "queued" : "running";
        else delete n[ev.projectId];
        return n;
      });
      if (ev.type === "done") {
        loadLastH();
        const name = allProjectsRef.current.find((p) => p.id === ev.projectId)?.name ?? "the project";
        toast(
          ev.status === "done"
            ? `Harvest of ${name} done: ${ev.proposed?.length ?? 0} new proposed${ev.accepted?.length ? ` (${ev.accepted.length} accepted: they passed the checks)` : ""}${ev.merged?.length ? `, ${ev.merged.length} already here` : ""}.`
            : `The harvest of ${name} stopped (${ev.status}).`,
          ev.status === "done" ? "ok" : "info",
        );
      }
      if (ev.type === "skipped") toast(`No harvest: ${ev.reason}`, "info");
    });
  }, []);
  const allProjectsRef = useRef(allProjects);
  allProjectsRef.current = allProjects;
  const harvestNow = async (pid) => {
    try {
      const r = await api.libraryHarvestNow(pid);
      const name = allProjects.find((p) => p.id === pid)?.name ?? "the project";
      if (r.state === "queued")
        toast(`Claude looks back over ${name} for things to reuse. It waits until Claude is not working on that project.`);
      else if (r.state === "running") toast(`Claude is already harvesting ${name}.`, "info");
      else toast(r.reason ?? "No harvest.", "info");
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const decide = async (id, accept) => {
    try {
      if (accept) await api.libraryUpdate(id, { status: "accepted" });
      else await api.libraryDelete(id);
      toast(
        accept
          ? "Accepted: Claude reuses it from now on."
          : `Rejected: it waits in the library's deleted items until you move them to the ${TRASH}.`,
      );
      loadLastH();
      load();
      loadTrash();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const seq = useRef(0);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);
  const load = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const o = { query: q || void 0, tab: tab === "all" ? null : tab, ...f, limit };
      const d = await api.libraryBrowse(o);
      if (n !== seq.current) return;
      setData(d);
      setLibProposed(d.proposed);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [q, tab, f, limit]);
  useEffect(() => {
    load();
  }, [load]);
  const loadRef = useRef(load);
  loadRef.current = load;
  const loadTrash = () =>
    api
      .libraryTrash()
      .then((t) => setTrash(t.count))
      .catch(() => {});
  useEffect(() => {
    loadTrash();
    api
      .styles()
      .then((l) => setStyleNames(Object.fromEntries(l.map((s) => [s.id, s.name]))))
      .catch(() => {});
    return on("library:changed", () => {
      loadRef.current();
      loadTrash();
    });
  }, []);
  useEffect(() => setLimit(PAGE), [q, tab, f]);
  useEffect(() => {
    if (takeLibraryInbox()) {
      setTab("all");
      setF({ status: "proposed" });
    }
  }, []);
  const baseName = (b) => BASE_NAMES[b] ?? styleNames[b] ?? b;
  const scopeName = (s) => {
    const [k, v] = s.split(":");
    if (k === "global") return "Everywhere";
    if (k === "project") return `Only in ${allProjects.find((p) => p.id === v)?.name ?? "one video"}`;
    return `Only ${baseName(v)}`;
  };
  const pick = (k, v) => setF((x) => ({ ...x, [k]: x[k] === v ? null : v }));
  const anyFilter = Object.values(f).some(Boolean);
  const showInbox = () => {
    setTab("all");
    setF({ status: "proposed" });
    setQuery("");
  };
  const emptyTrash = async () => {
    try {
      const r = await api.libraryEmptyTrash();
      setTrash(r.count);
      toast(`${r.moved} deleted ${r.moved === 1 ? "entry" : "entries"} moved to the ${TRASH}.`);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const facet = (k, title, order, label) => {
    const c = data?.counts[k] ?? {},
      vals = Object.keys(c).filter((v) => c[v] > 0 || f[k] === v);
    if (f[k] && !vals.includes(f[k])) vals.push(f[k]);
    const sorted = order
      ? [...order.filter((v) => vals.includes(v)), ...vals.filter((v) => !order.includes(v)).sort()]
      : vals.sort((a, b) => (c[b] ?? 0) - (c[a] ?? 0) || label(a).localeCompare(label(b)));
    if (!sorted.length) return null;
    return (
      <div className="lby-facet" data-facet={k} role="group" aria-label={title}>
        <h4>{title}</h4>
        {sorted.map((v) => (
          <button
            key={v}
            className={f[k] === v ? "on" : ""}
            aria-pressed={f[k] === v}
            data-value={v}
            onClick={() => pick(k, v)}
            title={label(v)}
          >
            <span className="ellipsis">{label(v)}</span>
            <small>{c[v] ?? 0}</small>
          </button>
        ))}
      </div>
    );
  };
  const rows = data?.rows ?? [];
  return (
    <div className="page page-enter lby">
      <div className="page-head">
        <div>
          <h1>Library</h1>
          <div className="sub">
            Everything Claude can reuse instead of building it again: 3D models, code, materials, scene recipes and the fixes it learned.
            Claude searches it before it builds, so every video makes the next one faster.
          </div>
        </div>
        <div className="actions">
          {harvestable.length > 0 && (
            <div
              className="lby-harvest"
              title="Claude takes a short read-only look back over a video and proposes what later videos can reuse. It also runs after every build (Settings > AI engines)."
            >
              <select
                className="input compact"
                aria-label="Project to harvest"
                value={hvPick}
                onChange={(e) => setHvProject(e.target.value)}
              >
                {harvestable.slice(0, 40).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="btn small" disabled={!hvPick || !!hvBusy[hvPick]} onClick={() => harvestNow(hvPick)}>
                {hvBusy[hvPick] ? <Spinner size={13} /> : <Sprout size={14} />}
                {hvBusy[hvPick] === "running" ? "Harvesting…" : hvBusy[hvPick] === "queued" ? "Waiting…" : "Harvest now"}
              </button>
            </div>
          )}
          {trash > 0 && (
            <button
              className="btn small ghost"
              onClick={emptyTrash}
              title={`Entries you deleted wait in the library's own deleted items. This moves them to the ${TRASH}.`}
            >
              <Trash size={14} />
              {"Move "}
              {trash}
              {" deleted to the "}
              {TRASH}
            </button>
          )}
        </div>
      </div>
      {lastH && (lastH.proposed ?? []).some((x) => x.status === "proposed") && (
        <section className="lby-hv panel" aria-label="From the last harvest">
          <div className="lby-hv-head">
            <Sprout size={16} strokeWidth={1.7} />
            <span className="grow">
              <b>From the last harvest</b>
              {" of "}
              {lastH.projectName || "a video"}
              {lastH.at ? ` (${ago(lastH.at)})` : ""}
              {": Claude proposes "}
              {(lastH.proposed ?? []).filter((x) => x.status === "proposed").length}{" "}
              {(lastH.proposed ?? []).filter((x) => x.status === "proposed").length === 1 ? "entry" : "entries"}.
              {lastH.reused ? ` That video reused ${lastH.reused}.` : ""}
            </span>
          </div>
          <ul>
            {(lastH.proposed ?? [])
              .filter((x) => x.status === "proposed")
              .map((x) => (
                <li key={x.id} data-id={x.id}>
                  <KindBadge k={x.kind} />
                  <button className="text-btn link grow ellipsis" onClick={() => setOpenId(x.id)} title={x.summary || x.title}>
                    {x.title}
                  </button>
                  <button className="btn tiny primary" onClick={() => decide(x.id, true)}>
                    <Check size={12} />
                    Accept
                  </button>
                  <button className="btn tiny" onClick={() => decide(x.id, false)}>
                    <X size={12} />
                    Reject
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
      {!!data?.proposed && f.status !== "proposed" && (
        <div className="lby-inbox" role="status">
          <Inbox size={17} strokeWidth={1.7} />
          <span className="grow">
            <b>
              {data.proposed}
              {" proposed "}
              {data.proposed === 1 ? "entry waits" : "entries wait"}
              {" for you."}
            </b>
            {" Claude added "}
            {data.proposed === 1 ? "it" : "them"}
            {" while building. Accept what is worth keeping; Claude only reuses accepted entries."}
          </span>
          <button className="btn small" onClick={showInbox}>
            Review
          </button>
        </div>
      )}
      {f.status === "proposed" && (
        <div className="lby-inbox on" role="status">
          <Inbox size={17} strokeWidth={1.7} />
          <span className="grow">Showing the proposed entries. Open one to accept or delete it.</span>
          <button className="btn small ghost" onClick={() => setF((x) => ({ ...x, status: null }))}>
            Show everything
          </button>
        </div>
      )}
      <div className="toolbar lby-bar">
        <div className="search">
          <Search size={16} strokeWidth={1.7} />
          <input
            id="lby-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the library: glow, brick wall, flicker, chair…"
            aria-label="Search the library"
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
          />
          {loading && <Spinner size={13} />}
        </div>
        <div className="tabs" role="tablist" aria-label="Library sections">
          {TABS.map(([t, l]) => (
            <button
              key={t}
              role="tab"
              data-tab={t}
              aria-selected={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {l}
              {t !== "all" && data ? <small className="lby-tabn">{data.tabs[t]}</small> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="lby-body">
        <aside className="lby-filters" aria-label="Filters">
          {anyFilter && (
            <button className="text-btn link lby-clear" onClick={() => setF({})}>
              Clear filters
            </button>
          )}
          {facet("source", "Source", SOURCE_ORDER, (v) => SOURCE[v] ?? v)}
          {facet("kind", "Kind", Object.keys(KIND), (v) => KIND[v]?.[0] ?? v)}
          {facet("base", "Style", null, baseName)}
          {facet("scope", "Where it applies", null, scopeName)}
          {facet("status", "Status", STATUS_ORDER, (v) => STATUS[v]?.[0] ?? v)}
        </aside>
        <div className="lby-main">
          <div className="lby-count small dim">
            {data ? `${data.total} ${data.total === 1 ? "entry" : "entries"}${q ? ` for “${q}”` : ""}` : ""}
            {data && !data.fts ? " (simple search on this computer)" : ""}
          </div>
          {!data ? (
            <div className="loading">
              <Spinner /> <span className="small">Loading the library…</span>
            </div>
          ) : !rows.length ? (
            <div className="empty lby-empty">
              <div className="ic">
                <Library$1 size={28} strokeWidth={1.7} />
              </div>
              <h3>{q ? `Nothing for “${q}”` : "Nothing here yet"}</h3>
              <p>
                {q
                  ? "Try another word, another tab, or clear the filters."
                  : "Claude adds what it builds and the fixes it finds while it makes your videos. They show up here."}
              </p>
              {(anyFilter || tab !== "all") && (
                <button
                  className="btn small"
                  onClick={() => {
                    setF({});
                    setTab("all");
                  }}
                >
                  Show everything
                </button>
              )}
            </div>
          ) : (
            <div className="lby-grid" role="list">
              {rows.map((r) => (
                <Card key={r.id} r={r} baseName={baseName} on={openId === r.id} open={() => setOpenId(r.id)} />
              ))}
            </div>
          )}
          {data && data.total > rows.length && (
            <div className="lby-more">
              <button className="btn small" onClick={() => setLimit((l) => l + PAGE)}>
                Show more ({data.total - rows.length}
                {" left)"}
              </button>
            </div>
          )}
        </div>
      </div>
      {openId && (
        <Drawer
          key={openId}
          id={openId}
          dev={!!data?.dev}
          baseName={baseName}
          scopeName={scopeName}
          onOpen={setOpenId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            load();
            loadTrash();
          }}
        />
      )}
    </div>
  );
}
function Card({ r, on: on2, open, baseName }) {
  const [bad, setBad] = useState(false);
  const [, Ic] = KIND[r.kind] ?? ["", Box],
    pic = !!r.thumb && !bad;
  return (
    <button
      role="listitem"
      className={`lby-card ${on2 ? "on" : ""} ${r.status === "proposed" ? "proposed" : ""}`}
      data-id={r.id}
      onClick={open}
      title={r.summary || r.title}
    >
      <span className={`lby-thumb ${pic ? "" : "txt"}`}>
        {pic ? (
          <img src={r.thumb} alt="" loading="lazy" onError={() => setBad(true)} />
        ) : (
          <>
            <Ic size={18} strokeWidth={1.5} />
            {r.summary && <span className="lby-snip">{r.summary}</span>}
          </>
        )}
        {r.source !== "seed" && r.source !== "ws" && <span className="lby-src">{SOURCE[r.source]}</span>}
      </span>
      <b className="lby-title">{r.title}</b>
      <span className="lby-badges">
        <KindBadge k={r.kind} />
        {r.status !== "accepted" && <StatusBadge s={r.status} />}
      </span>
      <span className="lby-chips">
        {r.bases.slice(0, 3).map((b) => (
          <span key={b} className="lby-chip">
            {baseName(b)}
          </span>
        ))}
        {r.bases.length > 3 && <span className="lby-chip">+{r.bases.length - 3}</span>}
      </span>
      {(r.uses > 0 || r.wins > 0 || r.fails > 0) && (
        <small className="lby-uses">
          {"Used "}
          {r.uses}×{r.wins ? ` · worked ${r.wins}` : ""}
          {r.fails ? ` · failed ${r.fails}` : ""}
        </small>
      )}
    </button>
  );
}
function Drawer({ id, dev, onClose, onOpen, onChanged, baseName, scopeName }) {
  const { toast, allProjects, openProject } = useApp();
  const [d, setD] = useState(null),
    [err, setErr] = useState(null);
  const [file, setFile] = useState(null),
    [code, setCode] = useState(null),
    [codeErr, setCodeErr] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false),
    [playing, setPlaying] = useState(false);
  const reload = () =>
    api
      .libraryDetail(id)
      .then((x) => {
        setD(x);
        setErr(null);
        return x;
      })
      .catch((e2) => {
        setErr(e2.message);
        return null;
      });
  useEffect(() => {
    reload().then((x) => {
      if (!x) return;
      const e2 = x.entry,
        first =
          e2?.entry && x.files.includes(e2.entry)
            ? e2.entry
            : (x.files.find((f) => /\.(m?js|json|md|txt|glsl)$/i.test(f)) ?? x.files[0] ?? null);
      setFile(first);
    });
    const key = (ev) => {
      if (ev.key === "Escape" && !document.querySelector('[aria-modal="true"]')) onClose();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      audio?.pause();
      audio = null;
    };
  }, [id]);
  const isImg = (f) => /\.(png|jpe?g|webp|svg|gif)$/i.test(f);
  useEffect(() => {
    setCode(null);
    setCodeErr(null);
    if (!file || isImg(file)) return;
    api
      .libraryFile(id, file)
      .then((c) => setCode(c))
      .catch((e2) => setCodeErr(e2.message));
  }, [file]);
  const e = d?.entry ?? null,
    row = d?.row;
  const run = async (what, fn, done) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      await reload();
      onChanged();
    } catch (x) {
      toast(x.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (s, done) => run(s, () => api.libraryUpdate(id, { status: s }), done);
  const del = async () => {
    setBusy(true);
    try {
      const r = await api.libraryDelete(id);
      onChanged();
      onClose();
      toast(`Deleted “${row?.title ?? id}”. It waits in the library's deleted items until you move them to the ${TRASH}.`, "ok", {
        label: "Undo",
        run: async () => {
          try {
            await api.libraryRestore(r.name);
            onChanged();
            toast("Brought back.");
          } catch (x) {
            toast(x.message, "bad");
          }
        },
      });
    } catch (x) {
      toast(x.message, "bad");
      setBusy(false);
    }
  };
  const save = async () => {
    if (!edit) return;
    await run(
      "edit",
      () =>
        api.libraryUpdate(id, {
          title: edit.title,
          summary: edit.summary,
          tags: edit.tags
            .split(/[,\n]/)
            .map((t) => t.trim())
            .filter(Boolean),
          scope: edit.scope,
        }),
      "Saved.",
    );
    setEdit(null);
  };
  const ship = async () => {
    setBusy(true);
    try {
      const r = await api.libraryShip(id);
      onChanged();
      onClose();
      toast(`Copied into the app's built-in library (${r.to}). It ships with the next release; your own copy is in the deleted items.`);
    } catch (x) {
      toast(x.message, "bad");
      setBusy(false);
    }
  };
  const play = async () => {
    if (playing) {
      audio?.pause();
      audio = null;
      setPlaying(false);
      return;
    }
    try {
      const r = await api.sfxAudio(id.slice(4));
      audio = new Audio(URL.createObjectURL(new Blob([r.bytes], { type: r.mime })));
      audio.onended = () => setPlaying(false);
      setPlaying(true);
      await audio.play();
    } catch (x) {
      setPlaying(false);
      toast(x.message, "bad");
    }
  };
  const projectOf = (p) =>
    allProjects.find(
      (x) =>
        (p?.projectId && x.id === p.projectId) ||
        (p?.project && x.name === p.project) ||
        (p?.project && x.path?.replace(/\\/g, "/").endsWith("/" + p.project)),
    );
  const own = row?.source === "seed" || row?.source === "ws";
  const usage = e?.usage ? (typeof e.usage === "string" ? e.usage : [e.usage.import, e.usage.example].filter(Boolean).join("\n\n")) : "";
  const scopes = useMemo(() => {
    const b = (row?.bases ?? "").split(/\s+/).filter((x) => x && x !== "any");
    const l = ["global", ...b.map((x) => `base:${x}`)];
    if (row?.scope && !l.includes(row.scope)) l.push(row.scope);
    return l;
  }, [row?.bases, row?.scope]);
  const params = e?.doc?.params && typeof e.doc.params === "object" ? Object.entries(e.doc.params) : [];
  const prov = e?.provenance ?? [];
  return (
    <>
      <div className="lby-scrim" onClick={onClose} />
      <aside className="lby-drawer" role="dialog" aria-label={row?.title ?? id} data-id={id}>
        <div className="lby-dhead">
          {d?.thumb && <img className="lby-dthumb" src={d.thumb} alt="" onError={(ev) => (ev.currentTarget.style.display = "none")} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <h2>{row?.title ?? id}</h2>
            <div className="lby-badges">
              {row && <KindBadge k={row.kind} />}
              {row && <StatusBadge s={row.status} />}
              {row && <span className="badge gray">{SOURCE[row.source] ?? row.source}</span>}
              {own && row && <span className="badge gray">v{row.version}</span>}
              <button
                className="lby-id mono"
                title="Copy the id (Claude finds it by this)"
                onClick={() => api.copy(id).then(() => toast("Id copied."))}
              >
                {id}
                <Copy size={11} />
              </button>
            </div>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>
        {err ? (
          <p className="err-text small">{err}</p>
        ) : !d ? (
          <div className="loading">
            <Spinner />
          </div>
        ) : (
          <div className="lby-dbody">
            {row?.summary && <p className="lby-summary">{row.summary}</p>}
            <div className="lby-actions">
              {d.editable && row?.status === "proposed" && (
                <button
                  className="btn small primary"
                  disabled={busy}
                  onClick={() => setStatus("accepted", "Accepted: Claude reuses it from now on.")}
                >
                  <Check size={14} />
                  Accept
                </button>
              )}
              {d.editable && (row?.status === "accepted" || row?.status === "flagged") && (
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => setStatus("verified", "Marked as verified.")}
                  title="It worked in a real video"
                >
                  <ShieldCheck size={14} />
                  Verify
                </button>
              )}
              {d.editable && row?.status !== "flagged" && row?.status !== "retired" && row?.status !== "proposed" && (
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => setStatus("flagged", "Flagged: Claude skips it unless you search for flagged entries.")}
                  title="Something is wrong with it: Claude stops reusing it"
                >
                  <Flag size={14} />
                  Flag
                </button>
              )}
              {d.editable && !edit && (
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() =>
                    setEdit({ title: row.title, summary: row.summary ?? "", tags: (e?.tags ?? []).join(", "), scope: row.scope })
                  }
                >
                  <Pencil size={14} />
                  Edit
                </button>
              )}
              {d.editable && row?.status !== "retired" && row?.status !== "proposed" && (
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => setStatus("retired", "Retired: kept, but Claude no longer uses it.")}
                  title="Keep it, but Claude no longer uses it"
                >
                  <Archive size={14} />
                  Retire
                </button>
              )}
              {d.editable && row?.status === "retired" && (
                <button className="btn small" disabled={busy} onClick={() => setStatus("accepted", "Back in use.")}>
                  <ArchiveRestore size={14} />
                  Bring back
                </button>
              )}
              {d.editable && (
                <button className="btn small danger" disabled={busy} onClick={del}>
                  <Trash size={14} />
                  Delete
                </button>
              )}
              {d.canReveal && (
                <button className="btn small ghost" onClick={() => api.libraryReveal(id).catch((x) => toast(x.message, "bad"))}>
                  <FolderOpen size={14} />
                  {"Show in "}
                  {FOLDER_APP}
                </button>
              )}
              {row?.source === "sfx" && (
                <button className="btn small ghost" onClick={play}>
                  {playing ? <Square size={13} /> : <Play size={14} />}
                  {playing ? "Stop" : "Play"}
                </button>
              )}
              {dev && d.editable && (
                <button
                  className="btn small ghost lby-ship"
                  disabled={busy}
                  onClick={ship}
                  title="Developer build only: copies this entry into templates/library, so it comes with the app"
                >
                  <Ship size={14} />
                  Ship with the app
                </button>
              )}
            </div>
            {row?.source === "seed" && (
              <p className="small dim lby-note">
                Built in: comes with the app and stays read-only. Claude copies it into a video when it uses it.
              </p>
            )}
            {row && !own && <p className="small dim lby-note">{FED_NOTE[row.source] ?? "Indexed where it lives; read-only here."}</p>}
            {edit && (
              <div className="lby-edit panel pad">
                <div className="field">
                  <label htmlFor="lby-title">Title</label>
                  <input
                    id="lby-title"
                    className="input"
                    value={edit.title}
                    maxLength={120}
                    onChange={(x) => setEdit({ ...edit, title: x.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="lby-summary">Summary</label>
                  <textarea
                    id="lby-summary"
                    className="input"
                    rows={3}
                    maxLength={400}
                    value={edit.summary}
                    onChange={(x) => setEdit({ ...edit, summary: x.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="lby-tags">
                    {"Tags "}
                    <span className="dim">(comma separated: the words Claude searches with)</span>
                  </label>
                  <input id="lby-tags" className="input" value={edit.tags} onChange={(x) => setEdit({ ...edit, tags: x.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="lby-scope">Where Claude may use it</label>
                  <select id="lby-scope" className="input" value={edit.scope} onChange={(x) => setEdit({ ...edit, scope: x.target.value })}>
                    {scopes.map((s) => (
                      <option key={s} value={s}>
                        {scopeName(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn small ghost" onClick={() => setEdit(null)}>
                    Cancel
                  </button>
                  <button className="btn small primary" disabled={busy || !edit.title.trim()} onClick={save}>
                    Save
                  </button>
                </div>
              </div>
            )}
            {e?.problem && (
              <section className="lby-sec">
                <h3>The problem and the fix</h3>
                <table className="lby-table lby-problem">
                  <tbody>
                    {e.problem.symptom && (
                      <tr>
                        <th>What you see</th>
                        <td>{e.problem.symptom}</td>
                      </tr>
                    )}
                    {e.problem.cause && (
                      <tr>
                        <th>Why</th>
                        <td>{e.problem.cause}</td>
                      </tr>
                    )}
                    {e.problem.fix && (
                      <tr>
                        <th>Fix</th>
                        <td>{e.problem.fix}</td>
                      </tr>
                    )}
                    {e.problem.detect && (
                      <tr>
                        <th>How to spot it</th>
                        <td>{e.problem.detect}</td>
                      </tr>
                    )}
                    {e.problem.scopeLetter && (
                      <tr>
                        <th>Applies to</th>
                        <td>{SCOPE_LETTER[e.problem.scopeLetter] ?? e.problem.scopeLetter}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            )}
            {(e?.doc?.when || e?.doc?.avoid || e?.doc?.gotchas?.length || params.length > 0) && (
              <section className="lby-sec">
                <h3>How to use it</h3>
                {e?.doc?.when && (
                  <p>
                    <b>When:</b> {e.doc.when}
                  </p>
                )}
                {e?.doc?.avoid && (
                  <p>
                    <b>Not for:</b> {e.doc.avoid}
                  </p>
                )}
                {!!e?.doc?.gotchas?.length && (
                  <>
                    <b className="small">Watch out</b>
                    <ul className="lby-gotchas">
                      {e.doc.gotchas.map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </>
                )}
                {params.length > 0 && (
                  <table className="lby-table">
                    <tbody>
                      {params.map(([k, v]) => (
                        <tr key={k}>
                          <th className="mono">{k}</th>
                          <td>{typeof v === "string" ? v : JSON.stringify(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}
            {usage && (
              <section className="lby-sec">
                <h3>What Claude writes</h3>
                <pre className="lby-code small-code">{usage}</pre>
              </section>
            )}
            {own && d.files.length > 0 && (
              <section className="lby-sec">
                <h3>
                  {"Files "}
                  <span className="dim small">(read-only)</span>
                </h3>
                <div className="lby-files" role="tablist">
                  {d.files.map((x) => (
                    <button key={x} role="tab" aria-selected={file === x} className={file === x ? "on" : ""} onClick={() => setFile(x)}>
                      {x}
                    </button>
                  ))}
                </div>
                {file && isImg(file) ? (
                  <div className="lby-imgview">
                    <img src={d.fileBase + file.split("/").map(encodeURIComponent).join("/")} alt={file} />
                  </div>
                ) : codeErr ? (
                  <p className="small dim">{codeErr}</p>
                ) : code ? (
                  <CodeView text={code.text} truncated={code.truncated} />
                ) : file ? (
                  <div className="loading">
                    <Spinner size={14} />
                  </div>
                ) : null}
              </section>
            )}
            {d.fed && (d.fed.facts.length > 0 || d.fed.file) && (
              <section className="lby-sec">
                <h3>Details</h3>
                <ul className="lby-facts">
                  {d.fed.file && <li className="mono">{d.fed.file}</li>}
                  {d.fed.facts.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </section>
            )}
            {d.engines.length > 0 && (
              <section className="lby-sec">
                <h3>Needs</h3>
                <p className="small">
                  {d.engines.join(", ")}
                  {" (older videos get “Update engine” first)"}
                </p>
              </section>
            )}
            {row && (
              <section className="lby-sec">
                <h3>Styles</h3>
                <div className="lby-chips">
                  {(row.bases ?? "")
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((b) => (
                      <span key={b} className="lby-chip">
                        {baseName(b)}
                      </span>
                    ))}
                </div>
                <p className="small dim" style={{ marginTop: 6 }}>
                  {scopeName(row.scope)}
                </p>
              </section>
            )}
            <section className="lby-sec lby-used">
              <h3>Used in</h3>
              <p className="small dim">
                {"Found "}
                {d.uses.hits}
                {"× in searches · used "}
                {d.uses.uses}
                {"× · worked "}
                {d.uses.wins}
                {"× · failed "}
                {d.uses.fails}×
              </p>
              {d.usedIn.length > 0 ? (
                <div className="lby-links">
                  {d.usedIn.map((pid) => {
                    const p = allProjects.find((x) => x.id === pid);
                    return p ? (
                      <button key={pid} className="text-btn link" onClick={() => openProject(p)}>
                        {p.name}
                      </button>
                    ) : (
                      <span key={pid} className="small dim">
                        a deleted video
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="small dim">Not used in a video yet.</p>
              )}
            </section>
            {prov.length > 0 && (
              <section className="lby-sec">
                <h3>Where it comes from</h3>
                <ul className="lby-prov">
                  {prov.slice(0, 12).map((p, i) => {
                    const pr = projectOf(p);
                    return (
                      <li key={i}>
                        <span className="grow">
                          <b>{p.project ?? "a project"}</b>
                          {p.file ? (
                            <span className="mono">
                              {" "}
                              {p.file}
                              {p.lines ? `:${p.lines}` : ""}
                            </span>
                          ) : null}
                          <span className="dim"> {[p.at, p.by].filter(Boolean).join(" · ")}</span>
                        </span>
                        {pr && (
                          <button className="btn small ghost" onClick={() => openProject(pr)}>
                            Open
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {(e?.licence || d.fed?.licence || row?.licence) && (
              <section className="lby-sec">
                <h3>Licence</h3>
                <p className="small">
                  {licenceText(e?.licence?.id ?? d.fed?.licence ?? row?.licence ?? "own")}
                  {e?.licence?.author || d.fed?.author ? ` · by ${e?.licence?.author || d.fed?.author}` : ""}
                </p>
                {(e?.licence?.credit_text || d.fed?.credit) && (
                  <p className="small dim">
                    {"Credit: "}
                    {e?.licence?.credit_text || d.fed?.credit}
                  </p>
                )}
                {(e?.licence?.source_url || d.fed?.source_url) && (
                  <button className="text-btn link small" onClick={() => api.external(String(e?.licence?.source_url || d.fed?.source_url))}>
                    {"Source "}
                    <ExternalLink size={11} />
                  </button>
                )}
              </section>
            )}
            {d.related.length > 0 && (
              <section className="lby-sec">
                <h3>Related</h3>
                <div className="lby-related">
                  {d.related.map((r) =>
                    r.exists ? (
                      <button key={r.id} className="lby-rel" onClick={() => onOpen(r.id)} title={r.id}>
                        {r.kind && <KindBadge k={r.kind} />}
                        <span className="ellipsis">{r.title}</span>
                      </button>
                    ) : (
                      <span key={r.id} className="lby-rel missing mono" title="Not in this library">
                        {r.id}
                      </span>
                    ),
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
function licenceText(id) {
  return (
    {
      own: "Made here (yours to use)",
      "CC0-1.0": "CC0 (public domain, no credit needed)",
      "CC-BY-4.0": "CC BY 4.0 (credit the author)",
      "CC-BY-3.0": "CC BY 3.0 (credit the author)",
      PD: "Public domain",
    }[id] ?? id
  );
}
function CodeView({ text, truncated }) {
  const lines = useMemo(() => text.replace(/\r\n/g, "\n").split("\n"), [text]);
  return (
    <div className="lby-codeview" role="region" aria-label="File contents (read-only)">
      <pre>
        <code>
          {lines.map((l, i) => (
            <div key={i} className="ln">
              <span>{i + 1}</span>
              {l || " "}
            </div>
          ))}
        </code>
      </pre>
      {truncated && (
        <p className="small dim" style={{ padding: "6px 10px" }}>
          Only the first part of this long file is shown.
        </p>
      )}
    </div>
  );
}
