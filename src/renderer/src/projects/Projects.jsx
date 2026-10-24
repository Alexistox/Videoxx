import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { ago, fmtTime } from "../lib/format";
import { useApp } from "../state/AppProvider";
import {
  Copy,
  FileArchive,
  Film,
  FolderInput,
  FolderOpen,
  Package,
  Plus,
  Search,
  Sparkles,
  Sprout,
  Trash,
  TriangleAlert,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { isMac } from "../help/keys";
import { Empty, I, Modal, StatusBadge } from "../components/ui";
import { fold } from "../lib/fold";
import { ChannelChip } from "../channels/ChannelAvatar";
import { ChannelFilter, useMoveToChannel } from "../channels/ChannelEditor";

const TRASH = isMac ? "Trash" : "Recycle Bin";
export function Projects() {
  const {
    projects,
    refreshProjects,
    go,
    setNewProject,
    toast,
    projectId,
    channels,
    listChannel: channel,
    setListChannel: setChannel,
    openStudio,
  } = useApp();
  const remove = async (p, files) => {
    try {
      await api.deleteProject(p.id, files);
      setDel(null);
      if (projectId === p.id) go("projects", null);
      await refreshProjects();
      toast(files ? `Moved to the ${TRASH}.` : "Removed from the Suite. Files kept.");
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const [qy, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [del, setDel] = useState(null);
  const [dropping, setDropping] = useState(false);
  const mv = useMoveToChannel();
  useEffect(() => {
    refreshProjects();
  }, []);
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    api
      .recentEdits()
      .then(setRecent)
      .catch(() => {});
  }, []);
  const [looks, setLooks] = useState({});
  useEffect(() => {
    api
      .presets()
      .then((l) => setLooks(Object.fromEntries(l.map((p) => [p.id, p.name]))))
      .catch(() => {});
  }, []);
  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const sel = channels.length && (channel === "none" || byId.has(channel)) ? channel : "all";
  const chOf = (p) => (p.channel_id && byId.has(p.channel_id) ? p.channel_id : null);
  const counts = useMemo(() => {
    const c = { all: projects.length, none: 0 };
    for (const p of projects) {
      const k = chOf(p) ?? "none";
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [projects, byId]);
  const list = useMemo(
    () =>
      projects.filter(
        (p) =>
          (filter === "all" || p.status === filter) &&
          fold(p.name).includes(fold(qy.trim())) &&
          (sel === "all" || (sel === "none" ? !chOf(p) : chOf(p) === sel)),
      ),
    [projects, qy, filter, sel, byId],
  );
  const intoChannel = sel !== "all" && sel !== "none" ? sel : null;
  const importFolder = async () => {
    const d = await api.pickFolder("Import a project folder");
    if (!d) return;
    try {
      const p = await api.importProject(d, intoChannel);
      await refreshProjects();
      toast(`Imported "${p.name}". The original folder is untouched.`);
      go("editor", p.id);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const importZip = async () => {
    const f = await api.pickFile("Import a shared project (.zip)", [{ name: "Zip", extensions: ["zip"] }]);
    if (!f) return;
    try {
      const p = await api.importZip(f, intoChannel);
      await refreshProjects();
      toast(`Imported "${p.name}".`);
      go("editor", p.id);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const onDrop = async (e) => {
    e.preventDefault();
    setDropping(false);
    const f = e.dataTransfer.files[0];
    const src = f && window.suite.pathForFile(f);
    if (!src) return;
    try {
      const p = /\.zip$/i.test(src) ? await api.importZip(src, intoChannel) : await api.importProject(src, intoChannel);
      await refreshProjects();
      toast(`Imported "${p.name}".`);
      go("editor", p.id);
    } catch (err) {
      toast(err.message, "bad");
    }
  };
  const share = async (p) => {
    try {
      const f = await api.exportZip(p.id);
      if (f)
        toast(`Saved ${f.split(/[\\/]/).pop()} (scenes, audio and assets, without renders or history).`, "ok", {
          label: "Show",
          run: () => api.reveal(f),
        });
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  return (
    <div
      className={`page page-enter ${dropping ? "dropping" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false);
      }}
      onDrop={onDrop}
    >
      {dropping && (
        <div className="drop-hint">
          Drop a project folder or a shared .zip to import it{intoChannel ? ` into ${byId.get(intoChannel)?.name}` : ""}
        </div>
      )}
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <div className="sub">Every project is a folder in your workspace with its own history.</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={importFolder}>
            <FolderInput {...I} />
            Import folder
          </button>
          <button className="btn" onClick={importZip}>
            <FileArchive {...I} />
            Import .zip
          </button>
          <button className="btn primary" onClick={() => setNewProject(true)}>
            <Plus {...I} />
            New project
          </button>
        </div>
      </div>
      {projects.length > 0 && (
        <div className="toolbar">
          <label className="search">
            <Search {...I} />
            <input placeholder="Search projects" value={qy} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
          </label>
          {channels.length > 0 && <ChannelFilter id="pr-channel" value={sel} onChange={setChannel} counts={counts} />}
          <div className="tabs" role="tablist">
            {["all", "draft", "editing", "ready"].map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}
      {!projects.length ? (
        <Empty
          icon={<Film size={28} strokeWidth={1.7} />}
          title="No projects yet"
          text="Start from a voiceover or a topic, or import a project folder you made before."
        >
          <div className="row">
            <button className="btn" onClick={importFolder}>
              <FolderInput {...I} />
              Import folder
            </button>
            <button className="btn primary" onClick={() => setNewProject(true)}>
              <Plus {...I} />
              New project
            </button>
          </div>
        </Empty>
      ) : !list.length ? (
        <p className="muted">
          {sel !== "all" && !qy && filter === "all" ? (
            <>
              {sel === "none" ? "Every project is in a channel." : `No projects in ${byId.get(sel)?.name} yet.`}{" "}
              <button className="text-btn link" onClick={() => setChannel("all")}>
                Show every channel
              </button>
            </>
          ) : (
            <>
              No projects match.
              {sel !== "all" && (
                <>
                  {" "}
                  <button className="text-btn link" onClick={() => setChannel("all")}>
                    Look in every channel
                  </button>
                </>
              )}
            </>
          )}
        </p>
      ) : (
        <div className="grid">
          {list.map((p) => (
            <article
              key={p.id}
              className="card clickable"
              tabIndex={0}
              onClick={() => p.exists !== false && (p.labKind === "studio" ? openStudio(p.id) : go("editor", p.id))}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                e.target === e.currentTarget &&
                p.exists !== false &&
                (p.labKind === "studio" ? openStudio(p.id) : go("editor", p.id))
              }
              aria-label={`Open ${p.name}`}
            >
              <div className={`thumb ${p.style_id && p.style_id !== "pixel-art" ? "smooth" : ""}`}>
                {p.thumb ? (
                  <img src={p.thumb} alt="" onError={(e) => (e.target.style.display = "none")} />
                ) : (
                  <>
                    <Film size={26} strokeWidth={1.5} />
                    <span style={{ fontSize: 11 }}>{p.shots || p.duration ? "Preview appears after the first open" : "No scenes yet"}</span>
                  </>
                )}
                <span className="fmt">{p.duration ? fmtTime(p.duration, 0) : "no audio yet"}</span>
              </div>
              <div className="card-body">
                <h3 className="ellipsis">{p.name}</h3>
                <div className="desc">
                  {p.exists === false ? (
                    <span style={{ color: "var(--err)", display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <TriangleAlert size={13} />
                      Folder missing
                    </span>
                  ) : p.lab ? (
                    p.labKind === "character" ? (
                      "Character lab · Claude designs a main character"
                    ) : p.labKind === "studio" ? (
                      "Style Studio workspace · a style or look being made"
                    ) : (
                      "Style lab · sample video of a custom style"
                    )
                  ) : (
                    `${p.shots || 0} ${p.shots === 1 ? "shot" : "shots"} ·${p.preset_id ? `${looks[p.preset_id] ?? p.preset_id} look` : "custom look"}`
                  )}
                </div>
                {channels.length > 0 && !p.lab && (
                  <div className="card-ch">
                    <ChannelChip
                      c={byId.get(chOf(p) ?? "") ?? null}
                      onClick={(e) => {
                        e.stopPropagation();
                        mv.open(e.currentTarget, [p.id], chOf(p), e.detail);
                      }}
                    />
                  </div>
                )}
                <div className="card-foot">
                  <StatusBadge s={p.status} />
                  <span className="grow" title={ago(p.opened_at || p.updated_at)}>
                    {ago(p.opened_at || p.updated_at)
                      .replace(/ ago$/, "")
                      .replace("just now", "now")}
                  </span>
                  <button
                    className="icon-btn sm"
                    aria-label="Show folder"
                    title="Show folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      api.open(p.path);
                    }}
                  >
                    <FolderOpen size={15} strokeWidth={1.7} />
                  </button>
                  <button
                    className="icon-btn sm"
                    aria-label="Duplicate project"
                    title="Duplicate (try something big on a copy)"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const d = await api.duplicateProject(p.id);
                        await refreshProjects();
                        toast(`Created "${d.name}".`, "ok", { label: "Open", run: () => go("editor", d.id) });
                      } catch (err) {
                        toast(err.message, "bad");
                      }
                    }}
                  >
                    <Copy size={15} strokeWidth={1.7} />
                  </button>
                  {p.labKind !== "character" && (
                    <button
                      className="icon-btn sm"
                      aria-label="Harvest now"
                      title="Grow the library from this video: Claude takes a short read-only look back and proposes what later videos can reuse (Library > review)"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const r = await api.libraryHarvestNow(p.id);
                          toast(
                            r.state === "queued"
                              ? `Claude looks back over "${p.name}" for things to reuse. The proposals wait in the Library.`
                              : r.state === "running"
                                ? "Already harvesting this video."
                                : (r.reason ?? "No harvest."),
                            r.state === "queued" ? "ok" : "info",
                          );
                        } catch (err) {
                          toast(err.message, "bad");
                        }
                      }}
                    >
                      <Sprout size={15} strokeWidth={1.7} />
                    </button>
                  )}
                  <button
                    className="icon-btn sm"
                    aria-label="Share as zip"
                    title="Share as .zip (scenes, audio, assets)"
                    onClick={(e) => {
                      e.stopPropagation();
                      share(p);
                    }}
                  >
                    <Package size={15} strokeWidth={1.7} />
                  </button>
                  <button
                    className="icon-btn sm"
                    aria-label="Delete project"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDel(p);
                    }}
                  >
                    <Trash size={15} strokeWidth={1.7} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <section className="panel pad pr-recent" aria-label="Recent edits">
          <h3>Recent edits</h3>
          <div className="col" style={{ marginTop: 10, gap: 2 }}>
            {recent.map((e) => (
              <button key={e.id} className="list-row" onClick={() => go("editor", e.project_id)}>
                <span className="well">
                  <Sparkles size={15} strokeWidth={1.7} />
                </span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="ellipsis" style={{ display: "block" }}>
                    {e.instruction}
                  </span>
                  <small className="dim">{e.project_name}</small>
                </span>
                <StatusBadge s={e.status} />
                <time>{ago(e.created_at)}</time>
              </button>
            ))}
          </div>
        </section>
      )}
      {mv.ui}
      {del && (
        <Modal title={`Delete "${del.name}"?`} onClose={() => setDel(null)}>
          <div className="modal-body">
            <p className="muted">
              {"Remove the project from Videoxx. You can keep the folder on disk, or move it to the "}
              {TRASH}.
            </p>
            <p className="path" style={{ marginTop: 10 }}>
              {del.path}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDel(null)}>
                Cancel
              </button>
              <button className="btn" onClick={() => remove(del, false)}>
                Remove, keep files
              </button>
              <button className="btn danger" onClick={() => remove(del, true)}>
                {"Move to "}
                {TRASH}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
