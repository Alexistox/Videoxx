import { countWords, lang } from "../settings/languages";
import { speechPace } from "../settings/project/visualPace";
import { beatsIn, scriptSections } from "./scriptText";
import { NARRATOR_ONLY, PACES, chunksOf, isSentencePause, stylePace } from "./chunks";

function spokenLength(secs, language, pacing, speed = 1) {
  const words = countWords(secs.map((s) => s.text).join(" "), language),
    pace = PACES[pacing] ?? null;
  const beats = beatsIn(secs),
    beatSecs = beats.reduce((n, b) => n + b, 0);
  const pauses = pace
    ? chunksOf(secs, 1500, NARRATOR_ONLY, pace)
        .slice(0, -1)
        .reduce((n, c) => n + Math.max(0, (c.gap ?? 0) - 0.4), 0)
    : secs.length * 0.8;
  return {
    words,
    seconds: Math.round(((words / lang(language).wpm) * 60) / (speed > 0 ? speed : 1) + pauses + beatSecs),
    beats: { count: beats.length, seconds: +beatSecs.toFixed(2) },
    pauses: +pauses.toFixed(2),
    pace: pacing,
  };
}
export function scriptLength(script, language, base, kept) {
  const pacing = isSentencePause(kept) ? kept : stylePace(base);
  return spokenLength(scriptSections(script, language), language, pacing, pacing === "short" ? speechPace(base) : 1);
}
export function lengthNote(l) {
  const has = [
    l.beats.count ? `${l.beats.count} beat${l.beats.count === 1 ? "" : "s"}` : "",
    l.pace !== "short" ? `${l.pace === "natural" ? "Natural" : "Long"} pauses` : "",
  ].filter(Boolean);
  return has.length ? ` with ${has.join(" and ")}` : "";
}
