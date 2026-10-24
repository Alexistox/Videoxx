import { useEffect, useMemo, useRef, useState } from "react";
import { ChartLineIcon, SearchIcon, UnlinkIcon, VideoIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Empty, Modal, Spinner } from "../components/ui";
import { isEnter, swallowClicks } from "../channels/stages";
import { boardSays, clock, compact, dateShort, undoSays } from "./format";

const PAGE = 80;
export function LinkVideoDialog({ projectId, name, onClose }) {
  const { toast, go } = useApp();
  const [d, setD] = useState(null),
    [err, setErr] = useState(null);
  const [qy, setQ] = useState(""),
    [busy, setBusy] = useState(false),
    [limit, setLimit] = useState(PAGE),
    [hi, setHi] = useState(-1);
  const listEl = useRef(null);
  useEffect(() => {
    api
      .ytVideoChoices(projectId)
      .then(setD)
      .catch((e) => setErr(e.message));
  }, [projectId]);
  useEffect(() => setLimit(PAGE), [qy]);
  const matches = useMemo(() => {
    const q = qy.trim().toLowerCase();
    return (d?.videos ?? []).filter(
      (v) => v.id !== d?.current?.id && (!q || v.title.toLowerCase().includes(q) || v.channelTitle.toLowerCase().includes(q)),
    );
  }, [d, qy]);
  const list = matches.slice(0, limit);
  useEffect(() => setHi(qy.trim() && matches.length ? 0 : -1), [qy, d]);
  useEffect(() => {
    if (hi >= 0) listEl.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);
  const followed = (d?.videos ?? []).some((v) => v.mine === false);
  const pick = async (v) => {
    if (busy) return;
    setBusy(true);
    swallowClicks();
    try {
      const target = v ?? d?.current;
      if (!target) return;
      const r = await api.ytLinkVideo(target.id, v ? projectId : null);
      toast(
        v
          ? `"${name}" is the video "${v.title}" now. ${boardSays(v)}${r.joined ? ` It joins ${r.joined}.` : ""}`
          : `"${name}" is not linked to a video now.`,
        "ok",
        {
          label: "Undo",
          run: () =>
            api
              .ytUndoLink(r.undo)
              .then((u) => {
                if (v) toast(undoSays(u, v.title, name), "info");
              })
              .catch((e) => toast(e.message, "bad")),
        },
      );
      onClose();
    } catch (e) {
      toast(e.message, "bad");
      setBusy(false);
    }
  };
  const keys = (e) => {
    if (e.key === "Escape" && qy) {
      e.stopPropagation();
      setQ("");
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.length) setHi((i) => (e.key === "ArrowDown" ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1)));
      return;
    }
    if (isEnter(e)) {
      e.preventDefault();
      const v = hi >= 0 ? list[hi] : list.length === 1 ? list[0] : null;
      if (v) pick(v);
    }
  };
  const row = (v, cur = false, i = -1) => (
    <button
      key={v.id}
      id={cur ? void 0 : `yt-pr-${v.id}`}
      data-i={cur ? void 0 : i}
      className={`yt-pickrow ${cur ? "cur" : ""} ${i === hi && !cur ? "hi" : ""}`}
      onClick={() => !cur && pick(v)}
      disabled={busy || cur}
      data-video={v.id}
      role={cur ? void 0 : "option"}
      aria-selected={cur ? void 0 : i === hi}
    >
      <span className="yt-thumb">
        {v.thumbUrl ? <img src={v.thumbUrl} alt="" loading="lazy" draggable={false} /> : <VideoIcon size={14} />}
        {v.duration != null && <i>{clock(v.duration)}</i>}
      </span>
      <span className="yt-pick-txt">
        <b className="ellipsis" dir="auto">
          {v.title}
        </b>
        <small className="ellipsis">
          {[
            v.mine === false ? `${v.channelTitle} (a channel you follow)` : v.channelTitle,
            v.status === "scheduled"
              ? `scheduled ${dateShort(v.publishAt)}`
              : v.status === "private"
                ? v.uploadedAt
                  ? `private, uploaded ${dateShort(v.uploadedAt)}`
                  : "private"
                : dateShort(v.publishedAt),
            v.views != null ? `${compact(v.views)} views` : null,
            v.projectId && !cur ? `now linked to "${v.projectName}"` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </span>
      {v.likely && !cur && <em className="yt-likely">Likely</em>}
    </button>
  );
  return (
    <Modal title={`YouTube video of "${name}"`} onClose={onClose} className="yt-small yt-linkvideo">
      <div className="modal-body">
        {err ? (
          <div className="hint bad">
            <div>
              <b>The videos could not be read</b>
              <p>{err}</p>
            </div>
          </div>
        ) : !d ? (
          <div className="loading">
            <Spinner size={18} kind="orbit" />
          </div>
        ) : !d.videos.length ? (
          <Empty
            icon={<ChartLineIcon size={26} strokeWidth={1.7} />}
            title="No YouTube videos yet"
            text="Follow your YouTube channel first (the YouTube page, or Settings > YouTube). Its videos then show here to pick from."
          >
            <button
              className="btn"
              onClick={() => {
                onClose();
                go("youtube");
              }}
            >
              Open YouTube
            </button>
          </Empty>
        ) : (
          <>
            {d.current && (
              <>
                <span className="label">Linked now</span>
                <div className="yt-pick-cur">
                  {row(d.current, true)}
                  <button className="btn small" onClick={() => pick(null)} disabled={busy}>
                    <UnlinkIcon size={14} />
                    Unlink
                  </button>
                </div>
              </>
            )}
            <label className="search yt-search">
              <SearchIcon size={15} strokeWidth={1.8} />
              <input
                autoFocus
                placeholder="Search videos and channels"
                value={qy}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search videos"
                role="combobox"
                aria-expanded="true"
                aria-controls="yt-pick-list"
                aria-activedescendant={hi >= 0 && list[hi] ? `yt-pr-${list[hi].id}` : void 0}
                onKeyDown={keys}
              />
            </label>
            <div className="yt-pick-list" role="listbox" id="yt-pick-list" aria-label="Videos" ref={listEl}>
              {list.map((v, i) => row(v, false, i))}
              {!list.length && (
                <p className="muted small" style={{ padding: 10 }}>
                  No video matches.
                </p>
              )}
              {matches.length > list.length && (
                <div className="yt-pick-more">
                  <span className="small dim">
                    {list.length}
                    {" of "}
                    {matches.length} {qy.trim() ? "matches" : "videos"}
                    {qy.trim() ? "" : ": search to find one"}
                  </span>
                  <button className="btn small" onClick={() => setLimit((l) => l + 200)}>
                    {"Show "}
                    {Math.min(200, matches.length - list.length)}
                    {" more"}
                  </button>
                </div>
              )}
            </div>
            <span className="help">
              The likely one comes first (by its title), then your channels' videos{followed ? ", then those of channels you follow" : ""}.
              A video already linked to another project moves here. Type to search, ↓ ↑ and Enter to pick.
            </span>
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
