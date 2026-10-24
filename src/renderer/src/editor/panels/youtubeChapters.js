export function youtubeChapters(shots) {
  const nice = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : s);
  let marks = shots
    .filter((s) => s.chapterFirst && s.chapter)
    .map((s) => ({
      t: s.t0,
      title: nice(
        String(Array.isArray(s.chapter) ? (s.chapter[1] ?? s.chapter[0]) : s.chapter)
          .split("·")[0]
          .trim(),
      ),
    }));
  if (marks.length < 2) {
    const seen = new Set();
    marks = shots
      .filter((s) => {
        const k = s.file ?? "";
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((s) => ({
        t: s.t0,
        title: s.name
          .replace(/^\d+[a-z]?:\s*/i, "")
          .replace(/^title:\s*/i, "")
          .replace(/["“”]/g, "")
          .split(/\s[-–—]\s|;/)[0]
          .trim()
          .slice(0, 60),
      }));
  }
  if (!marks.length || marks[0].t > 1) marks.unshift({ t: 0, title: "Intro" });
  else marks[0] = { ...marks[0], t: 0 };
  const out = [];
  for (const m of marks) if (!out.length || m.t - out[out.length - 1].t >= 10) out.push(m);
  const ts = (t) => {
    const s = Math.floor(t),
      h = Math.floor(s / 3600),
      m = Math.floor(s / 60) % 60,
      ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  };
  return out.map((m) => `${ts(m.t)} ${m.title}`);
}
