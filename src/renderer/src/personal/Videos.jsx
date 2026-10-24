import { useEffect, useMemo, useState } from "react";
import { FolderOpenIcon, PlusIcon, SearchIcon, TrashIcon, VideoIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { isMac } from "../help/keys";
import { Empty, I, Modal } from "../components/ui";
import { fold } from "../lib/fold";
import { ChannelChip } from "../channels/ChannelAvatar";
import { ChannelFilter, useMoveToChannel } from "../channels/ChannelEditor";
import { VideoCard } from "../projects/Home";

const TRASH = isMac ? "Trash" : "Recycle Bin";
export function Videos() {
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
  } = useApp();
  const [qy, setQ] = useState("");
  const [del, setDel] = useState(null);
  const mv = useMoveToChannel();
  useEffect(() => {
    refreshProjects();
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
      projects.filter((p) => fold(p.name).includes(fold(qy.trim())) && (sel === "all" || (sel === "none" ? !chOf(p) : chOf(p) === sel))),
    [projects, qy, sel, byId],
  );
  const remove = async (p, files) => {
    try {
      await api.deleteProject(p.id, files);
      setDel(null);
      if (projectId === p.id) go("projects", null);
      await refreshProjects();
      toast(files ? `Moved to the ${TRASH}. Your footage was not touched.` : "Removed from the Suite. Files kept.");
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  return (
    <div className="page page-enter">
      <div className="page-head">
        <div>
          <h1>Videos</h1>
          <div className="sub">Every video you planned: title, thumbnail and edit.</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setNewProject(true)}>
            <PlusIcon {...I} />
            New video
          </button>
        </div>
      </div>
      {projects.length > 0 && (
        <div className="toolbar">
          <label className="search" style={{ maxWidth: 360 }}>
            <SearchIcon {...I} />
            <input placeholder="Search videos" value={qy} onChange={(e) => setQ(e.target.value)} aria-label="Search videos" />
          </label>
          {channels.length > 0 && <ChannelFilter id="pv-channel" value={sel} onChange={setChannel} counts={counts} />}
        </div>
      )}
      {!projects.length ? (
        <Empty
          icon={<VideoIcon size={28} strokeWidth={1.7} />}
          title="No videos yet"
          text="Plan one: the title and thumbnail idea first, your footage next."
        >
          <button className="btn primary" onClick={() => setNewProject(true)}>
            <PlusIcon {...I} />
            New video
          </button>
        </Empty>
      ) : !list.length ? (
        <p className="muted">
          {sel !== "all" && !qy ? (
            <>
              {sel === "none" ? "Every video is in a channel." : `No videos in ${byId.get(sel)?.name} yet.`}{" "}
              <button className="text-btn link" onClick={() => setChannel("all")}>
                Show every channel
              </button>
            </>
          ) : (
            <>
              No videos match.
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
        <div className="video-grid">
          {list.map((p) => (
            <div key={p.id} className="vc-wrap">
              <VideoCard p={p} onOpen={() => go("editor", p.id)} />
              <span className="vc-actions">
                <button className="icon-btn sm" aria-label="Show folder" title="Show folder" onClick={() => api.open(p.path)}>
                  <FolderOpenIcon size={15} strokeWidth={1.7} />
                </button>
                <button className="icon-btn sm" aria-label="Delete video" title="Delete" onClick={() => setDel(p)}>
                  <TrashIcon size={15} strokeWidth={1.7} />
                </button>
              </span>
              {channels.length > 0 && (
                <div className="vc-ch">
                  <ChannelChip c={byId.get(chOf(p) ?? "") ?? null} onClick={(e) => mv.open(e.currentTarget, [p.id], chOf(p), e.detail)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {mv.ui}
      {del && (
        <Modal title={`Delete "${del.name}"?`} onClose={() => setDel(null)}>
          <div className="modal-body">
            <p className="muted">Remove the video from Videoxx. Your footage is never deleted: it stays where it is.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDel(null)}>
                Cancel
              </button>
              <button className="btn" onClick={() => remove(del, false)}>
                Remove, keep folder
              </button>
              <button className="btn danger" onClick={() => remove(del, true)}>
                {"Move project to "}
                {TRASH}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
