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
const asciiName = (s) =>
  unaccent(s)
    .replace(/[^A-Za-z0-9_\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
export const slugOf = (s, max = 48) => asciiName(s).toLowerCase().replace(/[_-]+/g, "-").slice(0, max);
