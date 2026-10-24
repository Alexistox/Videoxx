import { useEffect, useMemo, useRef, useState } from "react";
import { api, offeredLook } from "../lib/api";
import { fmtLength } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { ImagePlus, Plus, TriangleAlert } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { MOD, isMac } from "../help/keys";
import { Modal, Spinner } from "../components/ui";
import { Picker } from "../components/Picker";
import { CHANNEL_COLORS, CHANNEL_COLOR_NAMES, dueChip, dueState, isEnter } from "./stages";
import { ChannelAvatar, ChannelChip, initials, inkOn } from "./ChannelAvatar";
import { ActionMenu } from "./ActionMenu";

const chOpts = (channels, current, extra = true) => [
  ...channels.map((c) => ({
    value: "ch:" + c.id,
    label: c.name,
    hint: c.handle ?? void 0,
    icon: <ChannelAvatar c={c} size={22} />,
    badge: c.id === current ? "Now" : void 0,
    disabled: c.id === current,
  })),
  {
    value: "ch:none",
    label: "No channel",
    icon: <ChannelAvatar c={null} size={22} />,
    badge: !current ? "Now" : void 0,
    disabled: !current,
  },
  ...(extra
    ? [
        {
          value: "ch:new",
          label: "New channel…",
          icon: (
            <span className="ch-plus">
              <Plus size={14} strokeWidth={2} />
            </span>
          ),
        },
      ]
    : []),
];
export function channelItems(channels, current, onPick) {
  return chOpts(channels, current).map((o) => ({
    ...o,
    run: () => onPick(o.value === "ch:none" ? null : o.value === "ch:new" ? "new" : o.value.slice(3)),
  }));
}
export function useMoveToChannel() {
  const { channels, allProjects, toast, refreshProjects, refreshChannels } = useApp();
  const [menu, setMenu] = useState(null);
  const [making, setMaking] = useState(null);
  const move = async (ids, ch, name) => {
    const before = new Map(),
      names = [];
    for (const id of ids) {
      const p = allProjects.find((x) => x.id === id),
        was = p?.channel_id ?? null;
      before.set(was, [...(before.get(was) ?? []), id]);
      if (p) names.push(p.name);
    }
    const what = names.length === 1 && ids.length === 1 ? `"${names[0]}"` : `${ids.length} videos`;
    try {
      await api.assignChannel(ids, ch);
      await Promise.all([refreshProjects(), refreshChannels()]);
      const undo = async () => {
        try {
          for (const [was, l] of before) await api.assignChannel(l, was);
          await Promise.all([refreshProjects(), refreshChannels()]);
          toast(`${what} ${ids.length === 1 ? "is" : "are"} back where ${ids.length === 1 ? "it was" : "they were"}.`);
        } catch (e) {
          toast(e.message, "bad");
        }
      };
      toast(
        ch ? `Moved ${what} to ${name ?? channels.find((c) => c.id === ch)?.name ?? "the channel"}.` : `Took ${what} out of its channel.`,
        "ok",
        { label: "Undo", run: undo },
      );
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const ui = (
    <>
      {menu && (
        <ActionMenu
          key={menu.ids.join()}
          at={menu.at}
          label="Move to channel"
          onClose={() => setMenu(null)}
          items={channelItems(channels, menu.current, (id) => (id === "new" ? setMaking(menu.ids) : move(menu.ids, id)))}
        />
      )}
      {making && (
        <ChannelEditor
          onClose={() => setMaking(null)}
          onSaved={(c) => {
            const ids = making;
            setMaking(null);
            move(ids, c.id, c.name);
          }}
        />
      )}
    </>
  );
  return {
    open: (at, ids, current, clicks = 1) => setMenu((m) => (m && m.at === at ? (clicks > 1 ? m : null) : { at, ids, current })),
    ui,
  };
}
export function EditorChannel({ projectId }) {
  const { allProjects, channels } = useApp();
  const mv = useMoveToChannel();
  const p = allProjects.find((x) => x.id === projectId);
  if (!p || p.lab || !channels.length) return null;
  const c = channels.find((x) => x.id === p.channel_id) ?? null,
    due = dueState(p.due_at, p.stage ?? void 0);
  return (
    <span className="ch-edtop">
      <ChannelChip c={c} onClick={(e) => mv.open(e.currentTarget, [p.id], c?.id ?? null, e.detail)} />
      {p.due_at && (
        <span className={`ch-due ${due ?? "done"}`} title={`Due ${p.due_at} (set on the Channels board)`}>
          {dueChip(p.due_at, p.stage)}
        </span>
      )}
      {mv.ui}
    </span>
  );
}
export function ChannelFilter({ id, value, onChange, counts, allLabel = "All channels" }) {
  const { channels } = useApp();
  const opts = useMemo(
    () => [
      {
        value: "all",
        label: allLabel,
        icon: (
          <span className="ch-av all">
            <LayersGlyph />
          </span>
        ),
        badge: counts ? String(counts.all ?? 0) : void 0,
      },
      ...channels.map((c) => ({
        value: c.id,
        label: c.name,
        icon: <ChannelAvatar c={c} size={22} />,
        badge: counts ? String(counts[c.id] ?? 0) : void 0,
        group: "Channels",
        keywords: c.handle ?? "",
      })),
      { value: "none", label: "No channel", icon: <ChannelAvatar c={null} size={22} />, badge: counts ? String(counts.none ?? 0) : void 0 },
    ],
    [channels, counts, allLabel],
  );
  const cur = value !== "all" && value !== "none" && !channels.some((c) => c.id === value) ? "all" : value;
  return <Picker id={id} value={cur} options={opts} onChange={onChange} ariaLabel="Channel" menuWidth={260} className="ch-filter" />;
}
export function ChannelField({ id, value, onChange, note }) {
  const { channels } = useApp();
  const opts = useMemo(
    () => [
      { value: "none", label: "No channel", icon: <ChannelAvatar c={null} size={22} /> },
      ...channels.map((c) => ({ value: c.id, label: c.name, hint: c.handle ?? void 0, icon: <ChannelAvatar c={c} size={22} /> })),
    ],
    [channels],
  );
  if (!channels.length) return null;
  return (
    <div className="field np-chfield">
      <label htmlFor={id}>Channel</label>
      <Picker id={id} value={channels.some((c) => c.id === value) ? value : "none"} options={opts} onChange={onChange} menuWidth={300} />
      {note && <span className="help ch-from">{note}</span>}
    </div>
  );
}
export function useChannelDefaults(chan, o) {
  const { channels, refreshChannels } = useApp();
  const last = useRef(null),
    touched = useRef(false),
    lengthSet = useRef(false);
  const [from, setFrom] = useState(null);
  useEffect(() => {
    refreshChannels().catch(() => {});
  }, []);
  if (
    last.current &&
    !touched.current &&
    (o.styleId !== last.current.styleId ||
      o.presetId !== last.current.presetId ||
      (last.current.length !== null && o.length !== last.current.length))
  )
    touched.current = true;
  useEffect(() => {
    if (touched.current || !o.styles.length || !o.presets.length) return;
    const c = channels.find((x) => x.id === chan),
      d = c?.settings?.lastNew;
    const st = d ? o.styles.find((s) => s.id === d.styleId && !s.missing && !s.legacy && !s.hidden) : void 0;
    if (!c || !d || !st) {
      setFrom(null);
      return;
    }
    const looks = o.presets.filter((p) => (p.style_id || "pixel-art") === st.id && offeredLook(st, p));
    const look = d.presetId && looks.some((p) => p.id === d.presetId) ? d.presetId : st.defaultLook;
    const len = d.length ? fmtLength(d.length) : null;
    last.current = { styleId: st.id, presetId: look, length: len };
    if (len) lengthSet.current = true;
    o.setStyleId(st.id);
    o.setPresetId(look);
    if (len) o.setLength(len);
    setFrom(c.name);
  }, [chan, o.styles.length, o.presets.length, channels]);
  return { from: touched.current ? null : from, lengthSet };
}
export const ytPageChannel = { id: null };
export function startChannel(prefill, at) {
  if (prefill && prefill.channelId !== void 0) return prefill.channelId ?? "none";
  const c =
    at.page === "channels"
      ? at.channel
      : at.page === "projects"
        ? at.listChannel
        : at.page === "youtube"
          ? (ytPageChannel.id ?? "none")
          : "none";
  return c !== "all" && c !== "none" ? c : "none";
}
const LayersGlyph = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
export function ChannelEditor({ channel, onClose, onSaved, onDeleted }) {
  const { toast, refreshChannels, refreshProjects, channels } = useApp();
  const [name, setName] = useState(channel?.name ?? "");
  const [handle, setHandle] = useState(channel?.handle ?? "");
  const [color, setColor] = useState(
    channel?.color ?? CHANNEL_COLORS.find((c) => !channels.some((x) => x.color === c)) ?? CHANNEL_COLORS[0],
  );
  const [desc, setDesc] = useState(channel?.description ?? "");
  const [pic, setPic] = useState(null);
  const [busy, setBusy] = useState(false),
    [over, setOver] = useState(false),
    [confirmDel, setConfirmDel] = useState(false),
    [lessons, setLessons] = useState(0);
  useEffect(() => {
    if (confirmDel && channel)
      api
        .ytInsights(channel.id)
        .then((r) => setLessons(r.list.filter((x) => x.status === "approved").length))
        .catch(() => {});
  }, [confirmDel]);
  const shown = pic ? pic.preview : (channel?.avatarUrl ?? null);
  const delBtn = useRef(null);
  useEffect(() => {
    if (confirmDel) delBtn.current?.focus();
  }, [confirmDel]);
  const dirty = () =>
    name !== (channel?.name ?? "") ||
    handle !== (channel?.handle ?? "") ||
    desc !== (channel?.description ?? "") ||
    !!pic ||
    (!!channel && color !== channel.color);
  const takePic = async (f) => {
    if (!/\.(png|jpe?g|webp)$/i.test(f)) {
      toast("The picture must be a PNG, JPG or WebP image.", "bad");
      return;
    }
    const preview = await api.imagePreview(f).catch(() => null);
    const shows =
      preview &&
      (await new Promise((r) => {
        const im = new Image();
        im.onload = () => r(im.naturalWidth > 0);
        im.onerror = () => r(false);
        im.src = preview;
      }));
    if (!preview || !shows) {
      toast(preview ? "That picture could not be read. Try a PNG or JPG." : "That picture could not be read (or it is over 25 MB).", "bad");
      return;
    }
    setPic({ file: f, preview });
  };
  const choose = async () => {
    const f = await api.pickFile("Choose the channel picture", [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]);
    if (f) takePic(f);
  };
  const save = async () => {
    if (busy) return;
    if (!name.trim()) {
      toast("Give the channel a name.", "bad");
      return;
    }
    setBusy(true);
    try {
      let c = channel
        ? await api.channelUpdate(channel.id, { name, handle: handle || null, color, description: desc || null })
        : await api.channelCreate({ name, handle: handle || null, color, description: desc || null });
      if (pic) {
        try {
          c = await api.channelAvatar(c.id, pic.file);
        } catch (e) {
          toast(`The channel is saved, but not its picture. ${e.message}`, "bad");
        }
      }
      await refreshChannels();
      onSaved?.(c);
      onClose();
      toast(channel ? "Channel saved." : `Made the channel "${c.name}".`);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!channel) return;
    try {
      const r = await api.channelDelete(channel.id);
      await Promise.all([refreshChannels(), refreshProjects()]);
      onClose();
      onDeleted?.();
      toast(
        `Deleted "${channel.name}".${r.projects || r.ideas ? ` Its ${[r.projects && `${r.projects} video${r.projects === 1 ? "" : "s"}`, r.ideas && `${r.ideas} idea${r.ideas === 1 ? "" : "s"}`].filter(Boolean).join(" and ")} ${r.projects + r.ideas === 1 ? "is" : "are"} kept, with no channel.` : ""}`,
      );
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const keys = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };
  const swatchKeys = (e) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d || !e.target.dataset.color) return;
    e.preventDefault();
    const i = CHANNEL_COLORS.indexOf(e.target.dataset.color),
      c = CHANNEL_COLORS[(i + d + CHANNEL_COLORS.length) % CHANNEL_COLORS.length];
    setColor(c);
    e.currentTarget.querySelector(`[data-color="${c}"]`)?.focus();
  };
  return (
    <Modal title={channel ? "Edit channel" : "New channel"} onClose={onClose} className="ch-edit" dirty={dirty}>
      <div className="modal-body" onKeyDown={keys}>
        <div className="ch-edit-top">
          <div
            className={`ch-edit-pic ${over ? "over" : ""}`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                setOver(true);
              }
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              const p = f && window.suite.pathForFile(f);
              if (p) takePic(p);
            }}
          >
            <button
              type="button"
              className="ch-edit-av"
              onClick={choose}
              aria-label="Choose the channel picture"
              title="Choose a picture (or drop one here)"
              style={{ background: shown ? "#1b1b1b" : color }}
            >
              {shown ? <img src={shown} alt="" /> : <span style={{ color: inkOn(color) }}>{initials(name || "New channel")}</span>}
              <em>
                <ImagePlus size={15} strokeWidth={1.8} />
              </em>
            </button>
            {shown && (
              <button type="button" className="text-btn" onClick={() => setPic({ file: null, preview: null })}>
                Remove picture
              </button>
            )}
          </div>
          <div className="grow">
            <div className="field">
              <label htmlFor="ch-name">Name</label>
              <input
                id="ch-name"
                className="input"
                autoFocus
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Space Facts Daily"
                onKeyDown={(e) => isEnter(e) && !e.ctrlKey && !e.metaKey && save()}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="ch-handle">
                {"YouTube handle "}
                <span className="dim">· optional</span>
              </label>
              <input
                id="ch-handle"
                className="input"
                value={handle}
                maxLength={120}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@spacefactsdaily"
                spellCheck={false}
                onKeyDown={(e) => isEnter(e) && !e.ctrlKey && !e.metaKey && save()}
              />
            </div>
          </div>
        </div>
        <div className="field">
          <span className="label">
            {"Colour "}
            <span className="dim">· marks its videos on the boards</span>
          </span>
          <div className="ch-swatches" role="radiogroup" aria-label="Colour" onKeyDown={swatchKeys}>
            {CHANNEL_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={CHANNEL_COLOR_NAMES[c] ?? c}
                title={CHANNEL_COLOR_NAMES[c]}
                data-color={c}
                tabIndex={color === c || (i === 0 && !CHANNEL_COLORS.includes(color)) ? 0 : -1}
                className={color === c ? "on" : ""}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
            <label
              className={`ch-swatch-custom ${CHANNEL_COLORS.includes(color) ? "" : "on"}`}
              title="Any colour"
              style={CHANNEL_COLORS.includes(color) ? void 0 : { background: color }}
            >
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Any colour" />
              <Plus size={13} strokeWidth={2} />
            </label>
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ch-desc">
            {"About "}
            <span className="dim">· optional, for you</span>
          </label>
          <textarea
            id="ch-desc"
            className="input"
            rows={2}
            maxLength={500}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What the channel is about, who it is for, how often it posts…"
          />
        </div>
        <div className="modal-actions">
          {channel && !confirmDel && (
            <button className="btn ghost ch-del" onClick={() => setConfirmDel(true)}>
              Delete channel
            </button>
          )}
          {confirmDel ? (
            <>
              <span className="ch-confirm">
                <TriangleAlert size={15} strokeWidth={1.8} />
                Delete "{channel.name}
                {'"? '}
                {channel.projects + channel.ideas
                  ? `Its ${channel.projects + channel.ideas} ${channel.projects + channel.ideas === 1 ? "card stays" : "cards stay"}, with no channel.`
                  : "It is empty."}
                {lessons > 0 &&
                  ` The ${lessons === 1 ? "lesson" : `${lessons} lessons`} kept from its YouTube numbers ${lessons === 1 ? "goes" : "go"} with it.`}
              </span>
              <button className="btn" onClick={() => setConfirmDel(false)}>
                Keep it
              </button>
              <button ref={delBtn} className="btn danger" onClick={del}>
                Delete channel
              </button>
            </>
          ) : (
            <>
              <span className="np-keys" aria-hidden="true">
                <kbd>{MOD}</kbd>
                <kbd>{isMac ? "↩" : "Enter"}</kbd>to save
              </span>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={busy}>
                {busy && <Spinner size={15} />}
                {channel ? "Save" : "Make channel"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
