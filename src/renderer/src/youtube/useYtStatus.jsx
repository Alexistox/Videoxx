import { useEffect, useState } from "react";
import { api, on } from "../lib/api";
import { ChannelAvatar } from "../channels/ChannelAvatar";

export function useYtStatus() {
  const [s, setS] = useState(null);
  const [steps, setSteps] = useState({});
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .ytStatus()
        .then((v) => {
          if (alive) setS(v);
        })
        .catch(() => {});
    load();
    const offs = [
      on("youtube:changed", load),
      on("youtube:sync", (e) => {
        setSteps((m) => {
          const n = { ...m };
          if (e.state === "running") n[e.channelId] = e.step ?? "Reading";
          else delete n[e.channelId];
          return n;
        });
        if (e.state !== "running") load();
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((f) => f());
    };
  }, []);
  return {
    status: s,
    steps,
    reload: () =>
      api
        .ytStatus()
        .then(setS)
        .catch(() => {}),
  };
}
export const YtAvatar = ({ c, size = 28 }) => <ChannelAvatar c={{ name: c.title, color: "#5a5a5a", avatarUrl: c.avatarUrl }} size={size} />;
export const levelText = (c) =>
  c.access === "oauth" && !c.signedIn
    ? "Signed out"
    : c.signedIn
      ? c.analytics
        ? "Full analytics"
        : "Signed in, no analytics"
      : "Public stats";
