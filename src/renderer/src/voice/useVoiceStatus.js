import { useCallback, useEffect, useState } from "react";
import { api, on } from "../lib/api";
import { LANGUAGES } from "../settings/languages";

export const KOKORO_LANGS = (() => {
  const n = LANGUAGES.filter((l) => l.kokoro).map((l) => (l.code === "en" ? "English (US and UK)" : l.name));
  return n.slice(0, -1).join(", ") + " and " + n.at(-1);
})();
export const AUDIO_EXT = [
  "wav",
  "mp3",
  "m4a",
  "flac",
  "ogg",
  "oga",
  "opus",
  "aac",
  "aif",
  "aiff",
  "aifc",
  "caf",
  "wma",
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
];
export const isAudio = (f) => new RegExp(`\\.(${AUDIO_EXT.join("|")})$`, "i").test(f);
export const nf = (n) => Math.round(n).toLocaleString();
export const day = (ms) => new Date(ms).toLocaleDateString(void 0, { month: "short", day: "numeric" });
const TIER = {
  free: "Free",
  starter: "Starter",
  creator: "Creator",
  pro: "Pro",
  scale: "Scale",
  business: "Business",
  growing_business: "Business",
  enterprise: "Enterprise",
};
export const tierName = (t) => TIER[t] ?? (t ? t[0].toUpperCase() + t.slice(1).replace(/_/g, " ") : "");
export const cleanSettings = (c) => ({ ...c, voiceId: c.voiceId ?? "", voiceName: c.voiceName ?? "" });
export function useVoiceStatus() {
  const [vs, setVs] = useState(null);
  const load = useCallback(
    () =>
      api
        .voiceStatus()
        .then((s) => {
          setVs(s);
          return s;
        })
        .catch(() => null),
    [],
  );
  useEffect(() => {
    load();
    return on("voice:install", (s) => {
      setVs((v) => (v ? { ...v, kokoro: { ...v.kokoro, install: s } } : v));
      if (s.status !== "running") load();
    });
  }, [load]);
  return [vs, load];
}
export function useElevenAccount(hasKey) {
  const [acct, setAcct] = useState(null);
  const load = useCallback(
    (force = false) => {
      if (hasKey)
        api
          .voiceAccount(force)
          .then(setAcct)
          .catch(() => setAcct(null));
      else setAcct(null);
    },
    [hasKey],
  );
  useEffect(() => {
    load();
  }, [load]);
  return [acct, load];
}
export const accountLine = (a) =>
  !a
    ? ""
    : a.account
      ? `${tierName(a.account.tier)} plan · ${nf(a.account.left)} of ${nf(a.account.limit)} characters left${a.account.resetsAt ? ` (resets ${day(a.account.resetsAt)})` : ""}`
      : a.restricted
        ? "This key may not read your character balance (User: read)"
        : a.error
          ? "Character balance not available right now"
          : "";
