export const PACE_DEFAULT = 12,
  PACE_MIN = 4,
  PACE_MAX = 30;
export const speechPace = (base) => (base === "toon" ? 1.35 : base === "stickstory" ? 160 / 150 : 1);
function visualPlan(seconds, perMinute) {
  const ppm = Math.min(PACE_MAX, Math.max(PACE_MIN, Number(perMinute) || PACE_DEFAULT));
  const secs = Math.max(15, Number(seconds) || 60);
  const images = Math.max(6, Math.round((ppm * secs) / 60));
  const chapters = Math.max(5, Math.min(16, Math.round(secs <= 90 ? secs / 8 : 9 + (secs - 90) / 45)));
  return {
    perMinute: ppm,
    images,
    chapters,
    perChapter: Math.max(2, Math.round(images / chapters)),
    every: +(60 / ppm).toFixed(1),
    // seconds between new pictures
    budget: Math.max(40, Math.ceil(images * 1.25) + 5),
    // the make_image cap: the plan plus room for remakes
  };
}
const mmssOf = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export function paceLine(seconds, perMinute) {
  const p = visualPlan(seconds, perMinute);
  return `about ${p.perChapter} per chapter, ${p.images} pictures in a ${mmssOf(seconds)} video (${p.chapters} chapters)`;
}
