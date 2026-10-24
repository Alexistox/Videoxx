const SPECIAL = {
  ß: "ss",
  ẞ: "SS",
  ł: "l",
  Ł: "L",
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "Th",
  ı: "i",
  ħ: "h",
  Ħ: "H",
  ŧ: "t",
  Ŧ: "T",
  ŀ: "l",
  Ŀ: "L",
  ŋ: "ng",
  Ŋ: "Ng",
  ĸ: "k",
  ſ: "s",
  ƒ: "f",
};
const plain = (c) => SPECIAL[c] ?? c.normalize("NFKD").replace(new RegExp("\\p{M}+", "gu"), "");
export const unaccent = (s) => [...String(s ?? "")].map(plain).join("");
export const fold = (s) => unaccent(s).toLowerCase();
export function findFolded(text, query) {
  const q = fold(query);
  if (!q) return null;
  let f = "";
  const from = [],
    to = [];
  for (let i = 0; i < text.length;) {
    const c = String.fromCodePoint(text.codePointAt(i)),
      p = plain(c).toLowerCase();
    for (let k = 0; k < p.length; k++) {
      from.push(i);
      to.push(i + c.length);
    }
    f += p;
    i += c.length;
  }
  const at = f.indexOf(q);
  return at < 0 ? null : [from[at], to[at + q.length - 1]];
}
const asciiName = (s) =>
  unaccent(s)
    .replace(/[^A-Za-z0-9_\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
export const slugOf = (s, max = 48) => asciiName(s).toLowerCase().replace(/[_-]+/g, "-").slice(0, max);
