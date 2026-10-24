import { fileStem } from "../core/fileStem";

export const CARD_SECONDS = 3.5;
const SHORT_MAX = 60;
export const verticalStem = (name) => fileStem(name).replace(/_(vertical|trailer|clip)(_\d+)?$/, "") || "video";
export const VERTICAL_KINDS = ["vertical", "trailer", "clip"];
export const VERTICAL_NAME = /_(vertical|trailer|clip)(_\d+)?\.mp4$/i;
export function verticalFile(stem, kind, taken) {
  let name = `${stem}_${kind}`;
  for (let i = 2; taken(`${name}.mp4`); i++) name = `${stem}_${kind}_${i}`;
  return `${name}.mp4`;
}
export function startShot(shots, index, at) {
  if (typeof at !== "number" || !isFinite(at) || !shots.length) return index;
  let best = 0;
  shots.forEach((s, i) => {
    if (Math.abs(s.t0 - at) < Math.abs(shots[best].t0 - at)) best = i;
  });
  return best;
}
const tidy = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const wideLen = (s) => [...s].reduce((n, c) => n + (/[ᄀ-ᇿ⺀-鿿가-퟿豈-﫿＀-￯]/u.test(c) ? 2 : 1), 0);
export function captionCards(phrases, from, to) {
  const words = phrases
    .flatMap((p) => p.words || [])
    .filter((w) => w.s >= from - 0.05 && w.s < to - 0.05 && tidy(w.w))
    .map((w) => ({
      w: tidy(w.w),
      s: Math.max(0, w.s - from),
      e: Math.min(to - from, Math.max(w.s, w.e) - from),
      ...(w.ns ? { ns: 1 } : {}),
    }));
  const cards = [];
  let cur = null;
  for (const w of words) {
    const last2 = cur?.words[cur.words.length - 1],
      len = cur ? wideLen(cur.words.map((x) => x.w + (x.ns ? "" : " ")).join("")) + wideLen(w.w) : 0;
    if (!cur || cur.words.length >= (last2?.ns ? 6 : 3) || len > 16 || w.s - cur.e > 0.25 || /[.,?!;:、。，！？；：]$/.test(last2.w)) {
      cur = { s: w.s, e: w.e, until: 0, words: [w] };
      cards.push(cur);
    } else {
      cur.words.push(w);
      cur.e = w.e;
    }
  }
  cards.forEach((c, i) => (c.until = Math.min(cards[i + 1]?.s ?? Infinity, c.e + 0.6, to - from)));
  return cards;
}
export function trailerRange(shots, start, maxTotal, card, end, phrases = []) {
  const i0 = Math.max(0, Math.min(Math.round(start) || 0, shots.length - 1));
  const from = shots[i0]?.t0 ?? 0,
    body = Math.max(3, Math.min(SHORT_MAX, maxTotal) - (card ? CARD_SECONDS : 0));
  const limit = Math.min(end, from + body);
  const shotOf = (t) => {
    let k = i0;
    while (k + 1 < shots.length && shots[k + 1].t0 < t - 0.01) k++;
    return k;
  };
  if (limit >= end - 0.01) return { from, to: end, first: i0, last: shots.length - 1, endsOn: "end" };
  let to = 0;
  for (let k = i0; k < shots.length; k++) if (shots[k].t1 <= limit + 0.01 && shots[k].t1 > from + 0.5) to = shots[k].t1;
  if (to && to - from >= body * 0.6) return { from, to, first: i0, last: shotOf(to), endsOn: "shot" };
  const said = phrases.filter((p) => p.e > from + 1 && p.e + 0.15 <= limit).map((p) => Math.min(limit, p.e + 0.15));
  const ph = said.length ? Math.max(...said) : 0;
  if (ph > to) return { from, to: ph, first: i0, last: shotOf(ph), endsOn: "phrase" };
  if (to) return { from, to, first: i0, last: shotOf(to), endsOn: "shot" };
  return { from, to: limit, first: i0, last: shotOf(limit), endsOn: "limit" };
}
