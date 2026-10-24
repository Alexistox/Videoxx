import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  FilePlusIcon,
  FolderPlusIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SquareIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { playSound, stopSound, usePlaying } from "./soundPlayer";

export function LibraryBrowser({ onAdd, addLabel = "Add to project" }) {
  const { toast } = useApp();
  const [lib, setLib] = useState(null),
    [q, setQ] = useState(""),
    [cat, setCat] = useState(""),
    [who, setWho] = useState("all");
  const [busy, setBusy] = useState(""),
    [edit, setEdit] = useState(null),
    [sure, setSure] = useState(""),
    [over, setOver] = useState(false);
  const playing = usePlaying();
  const load = useCallback(
    () =>
      api
        .sfxList()
        .then(setLib)
        .catch((e) => toast(e.message, "bad")),
    [],
  );
  useEffect(() => {
    load();
    const off = window.suite.on("sfxlib:changed", () => load());
    return () => {
      off();
      stopSound();
    };
  }, []);
  const act = async (label, fn) => {
    setBusy(label);
    try {
      const r = await fn();
      if (r && "user" in r) setLib(r);
      if (r && typeof r.added === "number")
        toast(
          r.added
            ? `Added ${r.added} sound${r.added === 1 ? "" : "s"} to your library${r.same ? ` (${r.same} already there)` : ""}.`
            : r.same
              ? "Those sounds are already in your library."
              : "No sounds found there (wav, mp3, ogg, flac, m4a).",
        );
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy("");
    }
  };
  const list = useMemo(() => {
    if (!lib) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return [...(who !== "builtin" ? lib.user : []), ...(who !== "mine" ? lib.builtin : [])].filter(
      (e) =>
        (!cat || e.category === cat) &&
        words.every((w) => [e.name ?? "", e.id, e.category, ...e.tags].some((t) => t.toLowerCase().includes(w))),
    );
  }, [lib, q, cat, who]);
  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => window.suite.pathForFile(f)).filter(Boolean);
    if (paths.length) act("drop", () => api.sfxImportFiles(paths));
  };
  if (!lib)
    return (
      <div className="sfxl">
        <span className="muted">Loading the library…</span>
      </div>
    );
  const shown = list.slice(0, 200);
  return (
    <div
      className={"sfxl" + (over ? " over" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div className="sfxl-bar">
        <button className="btn sm" disabled={!!busy} onClick={() => act("folder", () => api.sfxImportFolder())}>
          <FolderPlusIcon size={14} />
          {busy === "folder" ? "Adding…" : "Add a folder…"}
        </button>
        <button className="btn sm ghost" disabled={!!busy} onClick={() => act("files", () => api.sfxImportFiles())}>
          <FilePlusIcon size={14} />
          Add files…
        </button>
        <button
          className="btn sm ghost"
          disabled={!!busy}
          title="Look for sounds you put into the library folder yourself"
          onClick={() => act("rescan", () => api.sfxRescan())}
        >
          <RefreshCwIcon size={14} />
          Rescan
        </button>
        <span className="grow" />
        <span className="sfxl-count">
          {lib.user.length}
          {" yours · "}
          {lib.builtin.length}
          {" built-in"}
        </span>
      </div>
      <p className="sfxl-hint">
        Pick a folder of your own sounds (or drop files here). Subfolders become categories ("Whooshes", "Impacts"), words in the file names
        become tags. The app keeps its own copy, so your folder can move. Your sounds win over the built-in ones of the same kind when the
        sound design picks effects.
      </p>
      <div className="sfxl-filter">
        <input
          className="input compact"
          placeholder="Search by name or tag (whoosh, door, paper …)"
          aria-label="Search sounds"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input compact" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {lib.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="tabs sm" role="tablist" aria-label="Whose sounds">
          {["all", "mine", "builtin"].map((w) => (
            <button key={w} role="tab" aria-selected={who === w} className={who === w ? "active" : ""} onClick={() => setWho(w)}>
              {w === "all" ? "All" : w === "mine" ? "Yours" : "Built-in"}
            </button>
          ))}
        </div>
      </div>
      <div className="sfxl-list" role="list">
        {!shown.length && (
          <div className="sfxl-empty">
            {lib.user.length || who !== "mine" ? "No sound matches." : "No sounds of your own yet: Add a folder…"}
          </div>
        )}
        {shown.map((e) => (
          <div key={e.id} className={"sfxl-row" + (e.user ? " mine" : "")} role="listitem" data-id={e.id}>
            <button
              className="icon-btn sm"
              aria-label={playing === e.id ? "Stop" : `Listen to ${e.name || e.id}`}
              onClick={() => (playing === e.id ? stopSound() : playSound(e.id).catch((er) => toast(er.message, "bad")))}
            >
              {playing === e.id ? <SquareIcon size={13} /> : <PlayIcon size={13} />}
            </button>
            {edit?.id === e.id ? (
              <div className="sfxl-edit">
                <input
                  className="input compact"
                  aria-label="Name"
                  value={edit.name}
                  onChange={(x) => setEdit({ ...edit, name: x.target.value })}
                />
                <input
                  className="input compact"
                  aria-label="Category"
                  value={edit.cat}
                  onChange={(x) => setEdit({ ...edit, cat: x.target.value })}
                />
                <input
                  className="input compact grow"
                  aria-label="Tags (comma separated)"
                  value={edit.tags}
                  onChange={(x) => setEdit({ ...edit, tags: x.target.value })}
                />
                <button
                  className="icon-btn sm"
                  aria-label="Save tags"
                  onClick={() => {
                    const v = edit;
                    setEdit(null);
                    act("edit", () =>
                      api.sfxUpdate(v.id, {
                        name: v.name,
                        category: v.cat,
                        tags: v.tags
                          .split(/[,;]+/)
                          .map((t) => t.trim())
                          .filter(Boolean),
                      }),
                    );
                  }}
                >
                  <CheckIcon size={14} />
                </button>
                <button className="icon-btn sm" aria-label="Cancel" onClick={() => setEdit(null)}>
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <div className="sfxl-main">
                <span className="sfxl-name" title={e.file}>
                  {e.name || `${e.category} ${e.id.split(".").slice(2).join(".")}`.trim()}
                </span>
                {e.user && <span className="badge mint sfxl-yours">Yours</span>}
                <span className="sfxl-cat">{e.category}</span>
                <span className="sfxl-tags">{e.tags.slice(0, 6).join(" · ")}</span>
              </div>
            )}
            <span className="sfxl-dur">{e.duration ? `${e.duration.toFixed(1)} s` : ""}</span>
            {e.user && edit?.id !== e.id && (
              <button
                className="icon-btn sm"
                aria-label="Edit name, category and tags"
                onClick={() => setEdit({ id: e.id, cat: e.category, tags: e.tags.join(", "), name: e.name ?? "" })}
              >
                <PencilIcon size={13} />
              </button>
            )}
            {e.user &&
              edit?.id !== e.id &&
              (sure === e.id ? (
                <button
                  className="btn sm danger"
                  onClick={() => {
                    setSure("");
                    act("del", () => api.sfxRemove(e.id));
                  }}
                >
                  Remove?
                </button>
              ) : (
                <button className="icon-btn sm" aria-label="Remove from your library" onClick={() => setSure(e.id)}>
                  <TrashIcon size={13} />
                </button>
              ))}
            {onAdd && (
              <button
                className="btn sm sfxl-add"
                disabled={!!busy}
                onClick={() =>
                  act("add", async () => {
                    await onAdd(e);
                  })
                }
              >
                <PlusIcon size={13} />
                {addLabel}
              </button>
            )}
          </div>
        ))}
        {list.length > shown.length && (
          <div className="sfxl-empty">
            {"Showing "}
            {shown.length}
            {" of "}
            {list.length}: search to narrow it down.
          </div>
        )}
      </div>
    </div>
  );
}
