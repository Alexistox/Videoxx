import { useEffect, useMemo, useState } from "react";
import { PlayIcon, SquareIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Spinner } from "../components/ui";

let sampleEl = null,
  sampleUrl = "",
  sampleToken = 0,
  sampleSt = null,
  owners = 0;
const sampleSubs = new Set();
const setSample = (s) => {
  sampleSt = s;
  sampleSubs.forEach((f) => f(s));
};
function stopSample() {
  sampleToken++;
  sampleEl?.pause();
  sampleEl = null;
  if (sampleUrl) URL.revokeObjectURL(sampleUrl);
  sampleUrl = "";
  setSample(null);
}
export function useSample() {
  const { toast } = useApp();
  const me = useMemo(() => ++owners, []);
  const [st, setSt] = useState(sampleSt);
  useEffect(() => {
    sampleSubs.add(setSt);
    return () => {
      sampleSubs.delete(setSt);
      if (sampleSt?.owner === me) stopSample();
    };
  }, [me]);
  const play = async (id, o) => {
    if (sampleSt?.id === id && sampleSt.owner === me) {
      stopSample();
      return;
    }
    stopSample();
    const token = ++sampleToken;
    setSample({ id, owner: me, phase: "loading" });
    try {
      const r = await api.voicePreview(o);
      if (token !== sampleToken) return;
      const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
      sampleUrl = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      const a = new Audio(sampleUrl);
      sampleEl = a;
      a.onended = () => {
        if (sampleEl === a) stopSample();
      };
      await a.play();
      if (token === sampleToken) setSample({ id, owner: me, phase: "playing" });
    } catch (e) {
      if (token === sampleToken) {
        setSample(null);
        toast(e.message, "bad");
      }
    }
  };
  return { st: st?.owner === me ? st : null, play, stop: stopSample };
}
export function SampleButton({ s, id, onPlay, title }) {
  const mine = s.st?.id === id;
  return (
    <button
      type="button"
      className={`icon-btn vo-play ${mine && s.st?.phase === "playing" ? "active" : ""}`}
      disabled={!id}
      onClick={onPlay}
      aria-label={mine ? "Stop the sample" : "Play a sample of this voice"}
      title={mine ? "Stop" : title}
    >
      {mine && s.st?.phase === "loading" ? (
        <Spinner size={14} />
      ) : mine ? (
        <SquareIcon size={13} strokeWidth={2} />
      ) : (
        <PlayIcon size={15} strokeWidth={1.8} />
      )}
    </button>
  );
}
