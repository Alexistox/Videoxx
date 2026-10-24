import { useEffect, useRef, useState } from "react";
import { ImagePlusIcon, XIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Modal, Spinner } from "../components/ui";
import { ChannelField, startChannel } from "../channels/ChannelEditor";
import { ChannelLessons } from "../youtube/ChannelLessons";

const IMG = /\.(png|jpe?g|webp)$/i;
export function NewVideo({ onClose }) {
  const { go, refreshProjects, toast, newPrefill, channel, listChannel, page, channels } = useApp();
  const prefill = useRef(newPrefill).current;
  const [chan, setChan] = useState(() => startChannel(prefill, { page, channel, listChannel }));
  const [title, setTitle] = useState(prefill?.name ?? "");
  const [idea, setIdea] = useState("");
  const [concept, setConcept] = useState(prefill?.topic?.trim() ?? "");
  const [thumb, setThumb] = useState(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    setPreview(null);
    if (thumb)
      api
        .imagePreview(thumb)
        .then(setPreview)
        .catch(() => {});
  }, [thumb]);
  const pick = async () => {
    const f = await api.pickFile("Choose a thumbnail image", [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]);
    if (f) setThumb(f);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (!IMG.test(f.name)) {
      toast("The thumbnail must be a PNG, JPG or WebP image.", "bad");
      return;
    }
    const p = window.suite.pathForFile(f);
    if (p) setThumb(p);
  };
  const create = async () => {
    if (!title.trim()) {
      toast("Give the video a title first.", "bad");
      return;
    }
    setBusy(true);
    try {
      const p = await api.personalCreate({
        title,
        thumbnailIdea: idea,
        concept,
        thumbnailFile: thumb,
        channelId: channels.some((c) => c.id === chan) ? chan : null,
        ...(prefill?.ideaId ? { ideaId: prefill.ideaId } : {}),
      });
      await refreshProjects();
      onClose(true);
      toast(`Planned "${p.name}". Next: drop your footage into the editor.`);
      go("editor", p.id);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New video" onClose={() => onClose()}>
      <div className="modal-body nv">
        <div className="field">
          <label htmlFor="nv-title">Title</label>
          <input
            id="nv-title"
            className="input"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. I let Claude edit my videos for a week"
            onKeyDown={(e) => e.key === "Enter" && !busy && create()}
          />
        </div>
        <ChannelField id="nv-channel" value={chan} onChange={setChan} />
        <ChannelLessons channelId={chan} personal />
        <div className="field">
          <label htmlFor="nv-idea">Thumbnail idea</label>
          <input
            id="nv-idea"
            className="input"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="What the thumbnail shows, e.g. my face, shocked, next to a timeline on fire"
          />
        </div>
        <div className="field">
          <label htmlFor="nv-concept">
            {"Core concept "}
            <span className="dim">(optional)</span>
          </label>
          <textarea
            id="nv-concept"
            className="input"
            rows={3}
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="The one idea the video delivers, the hook, what viewers walk away with."
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>
            {"Thumbnail image "}
            <span className="dim">(optional: you can also make one in Thumbnails)</span>
          </label>
          {thumb ? (
            <div className="nv-thumb">
              {preview ? <img src={preview} alt="Thumbnail" /> : <span className="nv-ph" />}
              <span className="grow ellipsis path">{thumb}</span>
              <button className="icon-btn sm" aria-label="Remove thumbnail" onClick={() => setThumb(null)}>
                <XIcon size={14} />
              </button>
            </div>
          ) : (
            <div
              className={`drop-zone ${over ? "over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <button className="btn" onClick={pick}>
                <ImagePlusIcon size={16} strokeWidth={1.7} />
                Choose image…
              </button>
              <span className="small">or drop it here</span>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => onClose()}>
            Cancel
          </button>
          <button className="btn primary" onClick={create} disabled={busy || !title.trim()}>
            {busy && <Spinner size={15} />}Plan video
          </button>
        </div>
      </div>
    </Modal>
  );
}
