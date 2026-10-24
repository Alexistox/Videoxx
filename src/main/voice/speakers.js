import { countWords, lang } from "../styles/languages";
import { isDirection, spokenLine } from "./spokenScript";

const TAG = /^\s*\[\s*([^[\]\n]{1,60}?)\s*\](?!\()\s*:?\s*(.*)$/;
const NOTE_WORDS = new Set(
  "intro outro hook cta scene shot title card transition image images photo photos picture video clip clips map maps chart graph sound sounds effect effects silence break end start cue note notes chapter section part text caption captions overlay zoom cut fade sting jingle applause gasp gasps cough coughs cry cries crying scream screams screaming yell yells shout shouts shouting cheer cheers cheering giggle giggles inhale inhales exhale exhales breath breathes breathing sniff sniffs groan groans hum hums sings singing excited sad angry happy nervous sarcastic serious calm scared afraid curious surprised shocked tired whispered whispering background ambience ambient animation flashback montage timestamp thumbnail sponsor link links source sources todo tbd fx vfx bgm screen drop beat beats pause pausa silence".split(
    " ",
  ),
);
const caseless = (c) => c.toLowerCase() === c.toUpperCase();
export const speakerKey = (name) =>
  String(name ?? "")
    .normalize("NFKC")
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
function speakerName(inner, language) {
  const name = String(inner ?? "")
    .split(/[,(]/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name.length > 32 || name.split(" ").length > 4) return null;
  if (!new RegExp("^\\p{L}[\\p{L}\\p{M}\\p{N}'’.\\- ]*$", "u").test(name)) return null;
  const first = name[0];
  if (!caseless(first) && first !== first.toUpperCase()) return null;
  if (
    name
      .toLowerCase()
      .split(/[\s-]+/)
      .some((w) => NOTE_WORDS.has(w.replace(/[.'’]/g, "")))
  )
    return null;
  if (isDirection(name, lang(language).code)) return null;
  return name;
}
export function speakerOf(line, language) {
  const m = TAG.exec(String(line ?? ""));
  if (!m || !m[2].trim()) return null;
  const name = speakerName(m[1], language);
  if (!name) return null;
  if (!spokenLine(line, language)) return null;
  return { name, key: speakerKey(name) };
}
export function scriptSpeakers(script, language) {
  const out = new Map();
  for (const line of String(script ?? "").split(/\r?\n/)) {
    const sp = speakerOf(line, language);
    if (!sp) continue;
    const s = out.get(sp.key) ?? { key: sp.key, name: sp.name, lines: 0, words: 0 };
    s.lines++;
    s.words += countWords(spokenLine(line, language), language);
    out.set(sp.key, s);
  }
  return [...out.values()];
}
