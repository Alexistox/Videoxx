import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../src/renderer/src/lib/api";
import { useApp } from "../src/renderer/src/state/AppProvider";
import {
  CornerDownLeft,
  Eye,
  FileQuestionMark,
  FolderOpen,
  Link2,
  Paperclip,
  Plus,
  Trash,
  TriangleAlert,
} from "../node_modules/lucide-react/dist/esm/lucide-react";
import { isMac } from "../src/renderer/src/help/keys";
import { Modal, Spinner } from "../src/renderer/src/components/ui";
import { KIND_WORD, fmtT, mentionOf, parseMentions, refMeta, shortPath } from "../src/renderer/src/refs/mentions";
import { putRef, reloadRefs, useRefThumb, useRefs } from "../src/renderer/src/refs/useRefs";
import { KindIcon, openRef } from "../src/renderer/src/refs/MentionField";

const FOLDER_APP = isMac ? "Finder" : "Explorer";
export function RefButton({ projectId, onClick, className = "", compact }) {
  const { refs } = useRefs(projectId),
    n = refs?.length ?? 0,
    missing = refs?.filter((r) => !r.exists).length ?? 0;
  return (
    <button
      type="button"
      className={`btn tiny rf-btn ${compact ? "compact" : ""} ${className}`}
      onClick={onClick}
      aria-label={`References (${n})`}
      title={
        missing
          ? `${missing} reference file${missing === 1 ? " is" : "s are"} missing: open to relink`
          : "References: point Claude at your own images, videos, audio or PDFs (type @ to mention one)"
      }
    >
      <Paperclip size={12} />
      {!compact && "Reference"}
      {n > 0 && <span className={`rf-count ${missing ? "warn" : ""}`}>{n}</span>}
    </button>
  );
}
export async function addDropped(projectId, files, toast) {
  const paths = [...files]
    .map((f) => {
      try {
        return window.suite.pathForFile(f);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  if (!paths.length) return [];
  const models = paths.filter((p) => /\.(glb|gltf|fbx|obj|dae|stl|ply|3mf|zip)$/i.test(p));
  if (models.length) toast(`Importing ${models.length === 1 ? "the 3D model" : `${models.length} 3D models`} into this project...`, "info");
  try {
    const added = await api.refsAdd(projectId, paths, { folders: true });
    await reloadRefs(projectId);
    for (const r of added.filter((r2) => r2.kind === "model" && r2.model))
      toast(
        r.model.error
          ? `${r.name}: could not convert it here, so Claude will convert it when you mention @${r.tag}.`
          : `@${r.tag} ${r.name} is in assets/models. Tell Claude what it should replace.`,
        r.model.error ? "info" : void 0,
      );
    if (!added.length) toast("Nothing to add: drop images, videos, audio, PDFs or 3D models.", "info");
    return added;
  } catch (e) {
    toast(e.message, "bad");
    return [];
  }
}
export function RefsPanel({ projectId, onClose, onInsert }) {
  const { toast } = useApp();
  const { refs, error } = useRefs(projectId);
  const [busy, setBusy] = useState(false),
    [drag, setDrag] = useState(0),
    [pathText, setPathText] = useState(""),
    [fresh, setFresh] = useState(new Set());
  const markFresh = (l) => setFresh(new Set(l.map((r) => r.id)));
  const pick = async () => {
    setBusy(true);
    try {
      const l = await api.refsPick(projectId);
      if (l?.length) {
        markFresh(l);
        await reloadRefs(projectId);
      }
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const addPath = async () => {
    const p = pathText.trim().replace(/^["']|["']$/g, "");
    if (!p) return;
    setBusy(true);
    try {
      const l = await api.refsAdd(projectId, [p], { folders: true });
      await reloadRefs(projectId);
      if (l.length) {
        markFresh(l);
        setPathText("");
      } else toast("That path is not an image, video, audio file or PDF this app can read.", "bad");
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const drop = async (e) => {
    e.preventDefault();
    setDrag(0);
    if (!e.dataTransfer.files.length) return;
    setBusy(true);
    markFresh(await addDropped(projectId, e.dataTransfer.files, toast));
    setBusy(false);
  };
  const list = refs ?? [];
  return createPortal(
    <Modal
      title="References"
      wide
      onClose={onClose}
      className={`rf-panel ${drag ? "rf-dragging" : ""}`}
      dialogProps={{
        onDragEnter: (e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDrag((d) => d + 1);
          }
        },
        onDragLeave: () => setDrag((d) => Math.max(0, d - 1)),
        onDragOver: (e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        },
        onDrop: drop,
      }}
    >
      <div className="modal-body">
        <div className="rf-addbar">
          <div className="grow">
            <b>Points to your file. Nothing is copied.</b>
            <p>
              {"So any size works: a 1-hour video is fine, you pick the seconds that matter. Mention a reference as "}
              <code>@vid1</code>
              {" and Claude looks at it."}
            </p>
          </div>
          <button className="btn small primary" onClick={pick} disabled={busy}>
            {busy ? <Spinner size={13} /> : <Plus size={14} />}Add reference
          </button>
        </div>
        <form
          className="rf-pathrow"
          onSubmit={(e) => {
            e.preventDefault();
            addPath();
          }}
        >
          <input
            className="input compact"
            aria-label="Paste a file path"
            placeholder={
              isMac ? "Or paste a path, e.g. /Users/you/Movies/interview.mov" : "Or paste a path, e.g. D:\\Footage\\interview.mp4"
            }
            value={pathText}
            onChange={(e) => setPathText(e.target.value)}
          />
          <button className="btn small" type="submit" disabled={!pathText.trim() || busy}>
            Add path
          </button>
        </form>
        {error && (
          <div className="hint warn" style={{ marginTop: 14 }}>
            <TriangleAlert size={18} />
            <div>
              <b>The references could not be read</b>
              <p>{error}</p>
            </div>
          </div>
        )}
        {refs === null ? (
          <div className="rf-grid">
            {[0, 1].map((i) => (
              <div key={i} className="rf-card skel">
                <span className="rf-thumb" />
                <div className="rf-body">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </div>
        ) : !list.length ? (
          <div
            className="rf-empty"
            onClick={pick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick();
              }
            }}
          >
            <Paperclip size={22} />
            <b>No references yet</b>
            <p>
              {"Drop images, videos, audio or PDFs here, paste a path above, or pick files. Then type "}
              <code>@</code>
              {" in your direction to mention one."}
            </p>
          </div>
        ) : (
          <div className="rf-grid">
            {list.map((r) => (
              <RefCard
                key={r.id}
                projectId={projectId}
                r={r}
                fresh={fresh.has(r.id)}
                onInsert={
                  onInsert
                    ? (t) => {
                        onInsert(t);
                        onClose();
                      }
                    : void 0
                }
              />
            ))}
          </div>
        )}
        <div className="rf-drop-veil" aria-hidden="true">
          <Plus size={22} />
          Drop to add as references<small>Files stay where they are</small>
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
function RefCard({ projectId, r, fresh, onInsert }) {
  const { toast } = useApp();
  const u = useRefThumb(projectId, r, r.kind === "video" && r.ranges[0] ? r.ranges[0].start : void 0, 320);
  const [confirm2, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!confirm2) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 3500);
      return;
    }
    setBusy(true);
    try {
      await api.refsRemove(projectId, r.id);
      await reloadRefs(projectId);
    } catch (e) {
      toast(e.message, "bad");
      setBusy(false);
    }
  };
  const relink = async () => {
    const p = await api.pickFile(`Where is ${r.name} now?`);
    if (!p) return;
    setBusy(true);
    try {
      putRef(projectId, await api.refsRelink(projectId, r.id, p));
      toast(`Relinked @${r.tag}.`);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const view = () => openRef(projectId, r.id, { onInsert });
  return (
    <div className={`rf-card ${r.exists ? "" : "missing"} ${fresh ? "fresh" : ""}`} data-tag={r.tag}>
      <button className="rf-thumb" onClick={r.exists ? view : relink} aria-label={r.exists ? `Open @${r.tag}` : `Relink @${r.tag}`}>
        {!r.exists ? (
          <span className="rf-thumb-ph bad">
            <FileQuestionMark size={22} />
            File not found
          </span>
        ) : u ? (
          <img src={u} alt="" draggable={false} />
        ) : (
          <span className="rf-thumb-ph">
            <KindIcon kind={r.kind} size={22} />
          </span>
        )}
        <span className="rf-kind">
          <KindIcon kind={r.kind} size={11} />
          {KIND_WORD[r.kind]}
        </span>
        {r.probe?.duration ? <span className="rf-dur-badge">{fmtT(r.probe.duration, 0)}</span> : null}
      </button>
      <div className="rf-body">
        <div className="rf-title">
          <span className={`rf-tag k-${r.kind}`}>@{r.tag}</span>
          <b className="ellipsis" title={r.label || r.name}>
            {r.label || r.name}
          </b>
        </div>
        <div className="rf-meta">
          {r.exists ? refMeta(r) : "Moved, renamed or on a drive that is not connected"}
          {r.ranges.length > 0 && (
            <>
              {" · "}
              <span className="rf-ranges-n">
                {r.ranges.length}
                {" range"}
                {r.ranges.length === 1 ? "" : "s"}
              </span>
            </>
          )}
        </div>
        <div className="rf-path" title={r.path}>
          {shortPath(r.path, 52)}
        </div>
        <div className="rf-actions">
          {!r.exists ? (
            <button className="btn tiny rf-relink" onClick={relink} disabled={busy}>
              <Link2 size={12} />
              Relink…
            </button>
          ) : (
            <>
              {onInsert && (
                <button
                  className="btn tiny primary rf-insert"
                  onClick={() => onInsert(mentionOf(r.tag))}
                  title={`Insert @${r.tag} at the cursor`}
                >
                  <CornerDownLeft size={12} />
                  Insert
                </button>
              )}
              <button className="btn tiny rf-open" onClick={view}>
                <Eye size={12} />
                {r.kind === "video" || r.kind === "audio" ? "Pick parts" : "View"}
              </button>
            </>
          )}
          <span className="grow" />
          {r.exists && (
            <button
              className="icon-btn sm"
              onClick={() => api.reveal(r.path).catch((e) => toast(e.message, "bad"))}
              title={`Show in ${FOLDER_APP}`}
              aria-label={`Show in ${FOLDER_APP}`}
            >
              <FolderOpen size={13} />
            </button>
          )}
          <button
            className={`icon-btn sm rf-remove ${confirm2 ? "confirm" : ""}`}
            onClick={remove}
            disabled={busy}
            title={confirm2 ? "Click again to remove (your file is not touched)" : "Remove from this project (your file is not touched)"}
            aria-label={confirm2 ? `Confirm removing @${r.tag}` : `Remove @${r.tag}`}
          >
            {confirm2 ? <span className="rf-sure">Remove?</span> : <Trash size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
export function RefsUsed({ projectId, text, title = "Used in this build", onAdd }) {
  const { refs } = useRefs(projectId);
  const byTag = useMemo(() => new Map((refs ?? []).map((r) => [r.tag, r])), [refs]);
  const items = useMemo(() => {
    const seen = new Set();
    return parseMentions(text).filter((m) => {
      const k = m.raw;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [text]);
  if (!items.length || refs === null) return null;
  return (
    <div className="rf-used" aria-label={title}>
      <span className="rf-used-h">{title}</span>
      {items.map((m) => {
        const r = byTag.get(m.tag);
        if (!r)
          return (
            <button
              key={m.raw}
              type="button"
              className="rf-chip bad"
              onClick={onAdd}
              title="No reference has this tag: Claude would not know what it means"
            >
              <TriangleAlert size={11} />@{m.tag}
              <span>not in this project</span>
            </button>
          );
        const bad = m.badRange || (m.range && r.probe?.duration != null && m.range[1] > r.probe.duration + 0.5);
        return <UsedChip key={m.raw} projectId={projectId} r={r} range={m.range} bad={!!bad} />;
      })}
    </div>
  );
}
function UsedChip({ projectId, r, range, bad }) {
  const u = useRefThumb(projectId, r, range ? range[0] : void 0, 96);
  const what = !r.exists
    ? "file missing"
    : bad
      ? "range not valid"
      : range
        ? `${fmtT(range[0])}–${fmtT(range[1])}`
        : r.kind === "video" || r.kind === "audio"
          ? r.ranges.length
            ? `${r.ranges.length} saved range${r.ranges.length === 1 ? "" : "s"}`
            : "first 20 s"
          : r.label || r.name;
  return (
    <button
      type="button"
      className={`rf-chip k-${r.kind} ${!r.exists ? "missing" : bad ? "bad" : ""}`}
      onClick={() => openRef(projectId, r.id, { range: range ?? void 0 })}
      title={!r.exists ? `${r.path} is not there any more: open References to relink it` : `${r.label || r.name} · ${r.path}`}
    >
      {u ? <img src={u} alt="" /> : <KindIcon kind={r.kind} size={11} />}@{r.tag}
      <span>{what}</span>
    </button>
  );
}
