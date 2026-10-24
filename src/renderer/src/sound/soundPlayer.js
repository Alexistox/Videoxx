import { useEffect, useState } from "react";
import { api } from "../lib/api";

let player = null,
  playerUrl = "",
  playingId = "";
const listeners = new Set();
export function stopSound() {
  player?.pause();
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  player = null;
  playerUrl = "";
  playingId = "";
  listeners.forEach((l) => l(""));
}
export async function playSound(id) {
  stopSound();
  const r = await api.sfxAudio(id);
  playerUrl = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }));
  player = new Audio(playerUrl);
  playingId = id;
  listeners.forEach((l) => l(id));
  player.onended = () => stopSound();
  await player.play().catch(() => stopSound());
}
export function usePlaying() {
  const [p, setP] = useState(playingId);
  useEffect(() => {
    listeners.add(setP);
    return () => {
      listeners.delete(setP);
    };
  }, []);
  return p;
}
