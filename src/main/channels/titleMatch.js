const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "why",
  "how",
  "what",
  "who",
  "when",
  "with",
  "your",
  "you",
  "my",
  "i",
  "it",
  "its",
  "this",
  "that",
  "these",
  "vs",
  "at",
  "by",
  "from",
  "be",
  "do",
  "does",
  "did",
  "we",
  "our",
  "about",
  "into",
  "than",
  "then",
  "there",
  "they",
  "can",
  "will",
  "just",
  "actually",
  "really",
]);
export const norm = (s) =>
  s
    .normalize("NFD")
    .replace(new RegExp("\\p{M}", "gu"), "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const stem = (w) =>
  w.length > 4 && w.endsWith("ies")
    ? w.slice(0, -3) + "y"
    : w.length > 4 && /(?:s|x|z|ch|sh)es$/.test(w)
      ? w.slice(0, -2)
      : w.length > 3 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)
        ? w.slice(0, -1)
        : w;
const words = (s) => [
  ...new Set(
    norm(s)
      .split(" ")
      .filter((w) => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w)))
      .map(stem),
  ),
];
export const prep = (s) => ({ n: norm(s), t: words(s) });
export class Matcher {
  df = new Map();
  n;
  constructor(all) {
    this.n = Math.max(1, all.length);
    for (const x of all) for (const w of x.t) this.df.set(w, (this.df.get(w) ?? 0) + 1);
  }
  weight(w) {
    return Math.log(1 + this.n / Math.max(1, this.df.get(w) ?? 1));
  }
  total(x) {
    let s = 0;
    for (const w of x.t) s += this.weight(w);
    return s;
  }
  /** A video's title against a project's. */
  compare(video, project) {
    if (!video.n || !project.n) return { s: 0, close: false };
    if (video.n === project.n) return { s: 1, close: true };
    if (!video.t.length || !project.t.length) return { s: 0, close: false };
    let both = 0;
    const ps = new Set(project.t);
    for (const w of video.t) if (ps.has(w)) both += this.weight(w);
    if (!both) return { s: 0, close: false };
    const tp = this.total(project),
      s = (2 * both) / (this.total(video) + tp);
    const [short, long] = video.n.length <= project.n.length ? [video, project] : [project, video];
    if (short.t.length >= 2 && short.n.length >= 10 && ` ${long.n} `.includes(` ${short.n} `)) return { s: Math.max(s, 0.85), close: true };
    return { s, close: s >= 0.55 && both / tp >= 0.8 };
  }
}
export function pairs(m, videos, projects, min = 0.3) {
  const byWord = new Map(),
    exact = new Map();
  const add = (map, k, p) => {
    const l = map.get(k);
    if (l) l.push(p);
    else map.set(k, [p]);
  };
  for (const p of projects) {
    add(exact, p.title.n, p);
    for (const w of p.title.t) add(byWord, w, p);
  }
  const out = [];
  for (const v of videos) {
    const seen = new Set(exact.get(v.title.n) ?? []);
    for (const w of v.title.t) for (const p of byWord.get(w) ?? []) seen.add(p);
    for (const p of seen) {
      const c = m.compare(v.title, p.title);
      if (c.s >= min) out.push({ v, p, ...c });
    }
  }
  return out;
}
