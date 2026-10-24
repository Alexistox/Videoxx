import { useEffect, useMemo, useState } from "react";
import { Link2Icon, PlusIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Picker } from "../components/Picker";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { compact } from "./format";
import { YtAvatar, levelText } from "./useYtStatus";

export function LinkPicker({ yt, id }) {
  const { channels, refreshChannels, toast } = useApp();
  const opts = useMemo(
    () => [
      { value: "none", label: "Not linked", icon: <ChannelAvatar c={null} size={22} /> },
      {
        value: "__new",
        label: `Make a channel from “${yt.title}”`,
        hint: "Its name, handle and picture",
        icon: (
          <span className="ch-plus">
            <PlusIcon size={14} strokeWidth={2} />
          </span>
        ),
      },
      ...channels.map((c) => ({
        value: c.id,
        label: c.name,
        hint: c.handle ?? void 0,
        icon: <ChannelAvatar c={c} size={22} />,
        disabled: !!c.yt_channel_id && c.yt_channel_id !== yt.id,
        badge: c.yt_channel_id && c.yt_channel_id !== yt.id ? "Linked" : void 0,
      })),
    ],
    [channels, yt.id, yt.title],
  );
  const pick = async (v) => {
    try {
      const was = yt.linkedChannelId && v !== yt.linkedChannelId ? (channels.find((c) => c.id === yt.linkedChannelId) ?? null) : null;
      const lessons = was ? (await api.ytApproved(was.id).catch(() => [])).length : 0;
      if (v === "__new") {
        const c = await api.ytChannelFrom(yt.id);
        toast(`Linked to your channel "${c.name}".`);
      } else {
        await api.ytLink(yt.id, v === "none" ? null : v);
        if (v !== "none") toast(`Linked to "${channels.find((c) => c.id === v)?.name}".`);
      }
      if (was && lessons)
        toast(
          `The ${lessons === 1 ? "lesson" : `${lessons} lessons`} kept for "${was.name}" stay with it, but stop guiding its scripts until it is linked to a YouTube channel again.`,
          "info",
        );
      await refreshChannels();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const cur = yt.linkedChannelId && channels.some((c) => c.id === yt.linkedChannelId) ? yt.linkedChannelId : "none";
  return (
    <Picker
      id={id}
      value={cur}
      options={opts}
      onChange={pick}
      menuWidth={300}
      ariaLabel={`Your Videoxx channel for ${yt.title}`}
      className="yt-linkpick"
    />
  );
}
export function LinkStep({ yt }) {
  const { channels, refreshChannels, toast } = useApp();
  const [sugg, setSugg] = useState(null);
  useEffect(() => {
    if (!yt.linkedChannelId)
      api
        .ytLinkSuggestion(yt.id)
        .then(setSugg)
        .catch(() => {});
  }, [yt.id]);
  const s = sugg && !yt.linkedChannelId ? channels.find((c) => c.id === sugg) : null;
  return (
    <div className="yt-linkstep">
      <div className="yt-linkstep-top">
        <YtAvatar c={yt} size={44} />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="ellipsis" dir="auto">
            {yt.title}
          </b>
          <small>
            {[yt.handle, yt.hiddenSubs ? "subscribers hidden" : `${compact(yt.subs)} subscribers`, levelText(yt)]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </div>
      </div>
      <label className="label" htmlFor={`yt-link-${yt.id}`}>
        Add it to which of your Videoxx channels?
      </label>
      <div className="row wrap yt-linkstep-row">
        <LinkPicker yt={yt} id={`yt-link-${yt.id}`} />
        {s && (
          <button
            className="btn small yt-use"
            title={`Link to your channel “${s.name}”`}
            onClick={async () => {
              try {
                await api.ytLink(yt.id, s.id);
                await refreshChannels();
                toast(`Linked to "${s.name}".`);
              } catch (e) {
                toast(e.message, "bad");
              }
            }}
          >
            <Link2Icon size={14} />
            <span className="ellipsis" dir="auto">
              Use “{s.name}”
            </span>
          </button>
        )}
      </div>
      <span className="help">
        Its projects then show their views on the Channels board, and what works on YouTube can guide their scripts.
      </span>
    </div>
  );
}
