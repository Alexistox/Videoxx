import { textRuns } from "./scriptText";

export const PACES = {
  short: null,
  natural: { sentence: 0.75, para: 1.33, section: 1.6 },
  long: { sentence: 1, para: 1.78, section: 2.13 },
};
export const isSentencePause = (v) => v === "short" || v === "natural" || v === "long";
export const stylePace = (base) => (base === "stickstory" ? "natural" : "short");
function sentences(p) {
  const out = [];
  let last = 0;
  for (const m of p.matchAll(/[.!?…]+["'”’»)\]]*\s+|[。！？]+[」』”’）)]*\s*|[।॥]+\s*/g)) {
    const end = m.index + m[0].length;
    if (end >= p.length) break;
    out.push(p.slice(last, end).trim());
    last = end;
  }
  if (last < p.length) out.push(p.slice(last).trim());
  return out.filter(Boolean);
}
function pack(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = "";
  const add = (piece, sep) => {
    if (!cur) cur = piece;
    else if (cur.length + sep.length + piece.length <= max) cur += sep + piece;
    else {
      out.push(cur);
      cur = piece;
    }
  };
  for (const para of text.split("\n\n")) {
    if (para.length <= max) {
      add(para, "\n\n");
      continue;
    }
    sentences(para).forEach((s, i) => {
      const sep = i ? " " : "\n\n";
      if (s.length <= max) return add(s, sep);
      let rest = s;
      while (rest.length > max) {
        const at = Math.max(rest.lastIndexOf(" ", max), rest.lastIndexOf("、", max) + 1, rest.lastIndexOf("，", max) + 1);
        const k = at > max / 2 ? at : max;
        add(rest.slice(0, k).trim(), sep);
        rest = rest.slice(k).trim();
      }
      if (rest) add(rest, " ");
    });
  }
  if (cur) out.push(cur);
  return out;
}
export const NARRATOR_ONLY = (_key) => "";
export function chunksOf(secs, max, voiceOf, pace = null) {
  const out = [];
  let lead = 0;
  const addBeat = (b) => {
    const last = out[out.length - 1];
    if (last) last.beat = +((last.beat ?? 0) + b).toFixed(3);
    else lead += b;
  };
  secs.forEach((s, i) => {
    if (!pace && !s.runs?.some((r) => r.beat || voiceOf(r.speaker))) {
      out.push(...pack(s.text, max).map((text, k, all) => ({ section: i, text, last: k === all.length - 1 })));
      return;
    }
    const start = out.length;
    let narration = "",
      paraGap = false;
    const flush = () => {
      if (narration) for (const text of pack(narration, max)) out.push({ section: i, text, last: false });
      narration = "";
    };
    for (const r of s.runs ?? textRuns(s.text)) {
      if (r.beat) {
        flush();
        addBeat(r.beat);
        continue;
      }
      const voice = voiceOf(r.speaker),
        who = voice ? { speaker: r.speaker, name: r.name, voice } : {};
      if (pace) {
        if (r.para) paraGap = true;
        for (const t of sentences(r.text))
          for (const text of pack(t, max)) {
            if (out.length > start) out[out.length - 1].gap = paraGap ? pace.para : pace.sentence;
            out.push({ section: i, text, last: false, ...who });
            paraGap = false;
          }
        continue;
      }
      if (!voice) {
        narration = narration ? narration + (r.para ? "\n\n" : " ") + r.text : r.text;
        continue;
      }
      flush();
      for (const text of pack(r.text, max)) out.push({ section: i, text, last: false, ...who });
    }
    flush();
    if (out.length > start) {
      const end = out[out.length - 1];
      end.last = true;
      if (pace) end.gap = pace.section;
    }
  });
  if (lead && out.length) out[0].lead = +lead.toFixed(3);
  return out;
}
