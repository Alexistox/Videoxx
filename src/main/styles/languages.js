export const LANGUAGES = [
  { code: "en", iso3: "eng", name: "English", native: "English", charset: "latin1", wpm: 150, v3: true, kokoro: "ab", number: "Number" },
  { code: "es", iso3: "spa", name: "Spanish", native: "Español", charset: "latin1", wpm: 160, v3: true, kokoro: "e", number: "Número" },
  { code: "fr", iso3: "fra", name: "French", native: "Français", charset: "latin1", wpm: 155, v3: true, kokoro: "f", number: "Numéro" },
  { code: "de", iso3: "deu", name: "German", native: "Deutsch", charset: "latin1", wpm: 130, v3: true, number: "Nummer" },
  { code: "it", iso3: "ita", name: "Italian", native: "Italiano", charset: "latin1", wpm: 150, v3: true, kokoro: "i", number: "Numero" },
  {
    code: "pt",
    iso3: "por",
    name: "Portuguese",
    native: "Português",
    charset: "latin1",
    wpm: 150,
    v3: true,
    kokoro: "p",
    number: "Número",
  },
  { code: "nl", iso3: "nld", name: "Dutch", native: "Nederlands", charset: "latin1", wpm: 140, v3: true, number: "Nummer" },
  { code: "sv", iso3: "swe", name: "Swedish", native: "Svenska", charset: "latin1", wpm: 140, v3: true, number: "Nummer" },
  { code: "da", iso3: "dan", name: "Danish", native: "Dansk", charset: "latin1", wpm: 140, v3: true, letters: "ø", number: "Nummer" },
  { code: "no", iso3: "nor", name: "Norwegian", native: "Norsk", charset: "latin1", wpm: 140, v3: false, letters: "ø", number: "Nummer" },
  { code: "fi", iso3: "fin", name: "Finnish", native: "Suomi", charset: "latin1", wpm: 115, v3: true, number: "Numero" },
  { code: "ca", iso3: "cat", name: "Catalan", native: "Català", charset: "latin1", wpm: 150, v3: false, number: "Número" },
  {
    code: "pl",
    iso3: "pol",
    name: "Polish",
    native: "Polski",
    charset: "latinExt",
    wpm: 130,
    v3: true,
    letters: "ł, ą or ż",
    number: "Numer",
  },
  {
    code: "cs",
    iso3: "ces",
    name: "Czech",
    native: "Čeština",
    charset: "latinExt",
    wpm: 130,
    v3: true,
    letters: "č, ř or ě",
    number: "Číslo",
  },
  {
    code: "sk",
    iso3: "slk",
    name: "Slovak",
    native: "Slovenčina",
    charset: "latinExt",
    wpm: 130,
    v3: true,
    letters: "č, ľ or ť",
    number: "Číslo",
  },
  {
    code: "sl",
    iso3: "slv",
    name: "Slovenian",
    native: "Slovenščina",
    charset: "latinExt",
    wpm: 130,
    v3: true,
    letters: "č, š or ž",
    number: "Številka",
  },
  {
    code: "hr",
    iso3: "hrv",
    name: "Croatian",
    native: "Hrvatski",
    charset: "latinExt",
    wpm: 130,
    v3: true,
    letters: "č, ć or đ",
    number: "Broj",
  },
  {
    code: "ro",
    iso3: "ron",
    name: "Romanian",
    native: "Română",
    charset: "latinExt",
    wpm: 140,
    v3: true,
    letters: "ș, ț or ă",
    number: "Numărul",
  },
  {
    code: "hu",
    iso3: "hun",
    name: "Hungarian",
    native: "Magyar",
    charset: "latinExt",
    wpm: 120,
    v3: true,
    letters: "ő or ű",
    number: "Szám",
  },
  {
    code: "et",
    iso3: "est",
    name: "Estonian",
    native: "Eesti",
    charset: "latinExt",
    wpm: 115,
    v3: true,
    letters: "š or ž",
    number: "Number",
  },
  {
    code: "lv",
    iso3: "lav",
    name: "Latvian",
    native: "Latviešu",
    charset: "latinExt",
    wpm: 125,
    v3: true,
    letters: "ā, ē or ģ",
    number: "Numurs",
  },
  {
    code: "lt",
    iso3: "lit",
    name: "Lithuanian",
    native: "Lietuvių",
    charset: "latinExt",
    wpm: 120,
    v3: true,
    letters: "ą, ė or ų",
    number: "Numeris",
  },
  {
    code: "tr",
    iso3: "tur",
    name: "Turkish",
    native: "Türkçe",
    charset: "latinExt",
    wpm: 120,
    v3: false,
    letters: "ğ, ş or ı",
    number: "Numara",
  },
  {
    code: "ja",
    iso3: "jpn",
    name: "Japanese",
    native: "日本語",
    charset: "cjk",
    wpm: 320,
    v3: false,
    spaced: false,
    unit: "char",
    letters: "Japanese letters",
    number: "第",
    writing:
      "natural written Japanese (kanji and kana as a native writer uses them, no romaji), in the polite desu/masu narration style unless the notes ask for another",
  },
  {
    code: "ko",
    iso3: "kor",
    name: "Korean",
    native: "한국어",
    charset: "hangul",
    wpm: 110,
    v3: false,
    letters: "Korean letters",
    number: "넘버",
    writing: "Korean in Hangul, spaced the standard way",
  },
  {
    code: "zh",
    iso3: "cmn",
    name: "Chinese",
    native: "简体中文",
    charset: "cjk",
    wpm: 240,
    v3: false,
    spaced: false,
    unit: "char",
    letters: "Chinese characters",
    number: "第",
    writing: "Mandarin Chinese written in Simplified characters, with Chinese punctuation (，。！？)",
  },
  {
    code: "hi",
    iso3: "hin",
    name: "Hindi",
    native: "हिन्दी",
    charset: "deva",
    wpm: 140,
    v3: false,
    kokoro: "h",
    letters: "Devanagari letters",
    number: "नंबर",
    writing: "Hindi in Devanagari script (not romanised), with the danda (।) ending sentences",
  },
  {
    code: "th",
    iso3: "tha",
    name: "Thai",
    native: "ไทย",
    charset: "thai",
    wpm: 170,
    v3: false,
    spaced: false,
    letters: "Thai letters",
    number: "อันดับ",
    writing: "Thai in Thai script, with a space between sentences and none between words",
  },
  {
    code: "vi",
    iso3: "vie",
    name: "Vietnamese",
    native: "Tiếng Việt",
    charset: "viet",
    wpm: 170,
    v3: false,
    letters: "ơ, ư or ệ",
    number: "Số",
    writing: "Vietnamese with all its tone marks",
  },
  { code: "id", iso3: "ind", name: "Indonesian", native: "Bahasa Indonesia", charset: "latin1", wpm: 140, v3: false, number: "Nomor" },
  {
    code: "ms",
    iso3: "msa",
    name: "Malay",
    native: "Bahasa Melayu",
    charset: "latin1",
    wpm: 140,
    v3: false,
    number: "Nombor",
    writing: "Malaysian Malay (Bahasa Melayu), not Indonesian",
  },
];
const BY = new Map(LANGUAGES.map((l) => [l.code, l]));
export const ENGLISH = BY.get("en");
export function lang(code) {
  return (
    BY.get(
      String(code ?? "")
        .toLowerCase()
        .split(/[-_]/)[0],
    ) ?? ENGLISH
  );
}
export function langCode(code) {
  const c = String(code ?? "")
    .toLowerCase()
    .split(/[-_]/)[0];
  return BY.has(c) ? c : null;
}
const OWN = ["cjk", "hangul", "thai", "deva"];
const STYLE_CHARSETS = {
  flat: ["latin1", "latinExt", "viet", ...OWN],
  recon: ["latin1", "latinExt", "viet", ...OWN],
  stickman: ["latin1", "latinExt", ...OWN],
  lowpoly: ["latin1", "latinExt", "viet", ...OWN],
  toon: ["latin1", "latinExt", "viet", ...OWN],
  // (3D cartoon shorts: Inter, like low poly)
  stickstory: ["latin1", "latinExt", "viet", ...OWN],
  // (Stick stories: Inter, JetBrains Mono and Oswald, with the preview's pieces)
  "pixel-art": ["latin1", ...OWN],
  collage: ["latin1", ...OWN],
  starter: ["latin1", "latinExt", "viet", ...OWN],
  // (the Studio starter: Inter + JetBrains Mono, like flat / recon)
};
const charsetsOf = (base) => STYLE_CHARSETS[base ?? ""] ?? ["latin1"];
export const styleCharset = (base) => (charsetsOf(base).includes("latinExt") ? "latinExt" : "latin1");
const STYLE_LACKS = { "pixel-art": "ø" };
export function styleDraws(base, code) {
  const l = lang(code);
  if (!charsetsOf(base).includes(l.charset)) return false;
  const lacks = STYLE_LACKS[base ?? ""] ?? "";
  return ![...(l.letters ?? "")].some((c) => lacks.includes(c));
}
export function cantDrawWhy(base, code) {
  return `its fonts have no ${lang(code).letters ?? "letters like ł or ő"}`;
}
const STYLE_NAMES = [
  ["flat", "The Flat explainer"],
  ["recon", "3D reconstruction"],
  ["stickman", "MS Paint stick figures"],
  ["lowpoly", "Low poly shorts"],
  ["toon", "3D cartoon shorts"],
  ["pixel-art", "Pixel art"],
  ["collage", "Vox"],
];
export const whoCanDraw = (code) => {
  const who = STYLE_NAMES.find(([b]) => styleDraws(b, code));
  return who ? `${who[1]} can write ${lang(code).name}.` : `No style can write ${lang(code).name} yet.`;
};
export const styleCoverage = () =>
  STYLE_NAMES.map(([b, n]) => `${n.replace(/^The /, "")} ${LANGUAGES.filter((l) => styleDraws(b, l.code)).length}`).join(", ");
export const languagesFor = (base) => LANGUAGES.filter((l) => styleDraws(base, l.code));
export function charsetNote(base) {
  const no = LANGUAGES.filter((l) => !styleDraws(base, l.code));
  if (!no.length) return "This style writes every language in the list.";
  const names = no.map((l) => l.name),
    list = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(" or ");
  return `This style writes ${LANGUAGES.length - no.length} of the ${LANGUAGES.length} languages: not ${list} (its fonts lack their letters). ${whoCanDraw(no[0].code)}`;
}
export const languageGroup = (l) =>
  ["ja", "ko", "zh"].includes(l.code)
    ? "East Asian"
    : l.code === "hi"
      ? "South Asian"
      : ["th", "vi", "id", "ms"].includes(l.code)
        ? "Southeast Asian"
        : l.charset === "latin1"
          ? "Western European"
          : "Central European and Turkish";
export const aLang = (code) => {
  const n = lang(code).name;
  return `${/^[AEIO]/.test(n) ? "an" : "a"} ${n}`;
};
const COMMON = {
  en: "the and of to is in that it you for was with on are this but not what why how they be have has from by at as or we your its their there which can will",
  es: "el la los las de del que y en un una es por con para se lo como más pero su sus al no este esta muy también porque cuando hay sin sobre entre son está le les",
  fr: "le la les de des du et est un une que qui en pas pour dans ce il elle sur avec au aux plus ne se son sa ses mais ou nous vous ils sont cette",
  de: "der die das und ist nicht ein eine zu den von mit sich auf für dem des es auch im wie aber sie er wir ich sind war wird nur noch",
  it: "il la di che e è un una per non in del della dei con sono si ma come più anche lo gli le nel nella da al alla questo questa",
  pt: "o os as de do da dos das que e em no na nos nas um uma é por para com não mais mas se seu sua ao como também porque quando há sem sobre são está foi",
  nl: "de het een en van is niet dat op te in met zijn voor ook maar er aan die dit wat wordt om als bij",
  sv: "och i att det som en är på med för av till inte den har ett om var men jag de kan så",
  da: "og i at det som en er på med for af til ikke den har et om var men jeg de kan så",
  no: "og i at det som en er på med for av til ikke den har et om var men jeg de kan så",
  fi: "ja on ei se että oli mutta kun niin myös hän joka tämä ovat olla mitä kuin jo vain",
  ca: "el la els les de del que i en un una és per amb no es com més però als al seu seva aquest aquesta són hi ha també",
  pl: "i w z na się nie to że do jest jak co ale o od po tak za są przez dla czy jego",
  cs: "a v se na je že to z s do o jako ale by k i pro není jsou jeho tak už jak",
  sk: "a v sa na je že to z s do o ako ale by k aj pre nie sú jeho tak už",
  sl: "in je v se na da so za z s pa ki ne to kot tudi bi ali po",
  hr: "i je u se na da su za s od ne to kao a ali iz što bi po",
  ro: "și în de la a cu pe că nu este o un din care mai pentru se sunt ce",
  hu: "a az és hogy nem is egy meg de van ez csak már mint volt vagy",
  et: "ja on ei see et oli kui ka aga mis oma nii ning seda",
  lv: "un ir ar no uz par kas ka bet arī tas tā nav to",
  lt: "ir yra kad su iš į ne tai bet kaip buvo jo o jis",
  tr: "ve bir bu da de için ile çok ama gibi daha olan en ne mi ki",
  id: "yang dan di ini itu dengan untuk dari ke tidak ada pada akan juga karena atau adalah bisa saja sudah",
  ms: "yang dan di ini itu dengan untuk dari ke tidak ada pada akan juga kerana atau adalah boleh sahaja telah",
  vi: "và của là có không được trong một những các cho với này người đã để khi thì cũng như từ ra",
};
const commonSets = new Map(Object.entries(COMMON).map(([c, w]) => [c, new Set(w.split(" "))]));
const wordsOf = (text) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}\p{M}]+/u)
    .filter(Boolean);
export function languageScores(text) {
  const ws = wordsOf(text);
  if (ws.length < 25) return [];
  return [...commonSets]
    .map(([code, set]) => ({ code, score: ws.filter((w) => set.has(w)).length / ws.length }))
    .sort((a, b) => b.score - a.score);
}
const CLOSE = ["es ca", "da no", "da sv", "no sv", "cs sk", "id ms"];
const close = (a, b) => CLOSE.includes(`${a} ${b}`) || CLOSE.includes(`${b} ${a}`);
export function scriptLanguage(text) {
  const t = String(text ?? ""),
    n = (re) => (t.match(re) ?? []).length;
  const all = n(new RegExp("\\p{L}", "gu"));
  if (all < 20) return null;
  const kana = n(/[\p{sc=Hiragana}\p{sc=Katakana}]/gu),
    han = n(new RegExp("\\p{sc=Han}", "gu")),
    share = (k) => k / all;
  if (share(kana + han) >= 0.3) return kana >= (kana + han) * 0.1 ? "ja" : "zh";
  if (share(n(new RegExp("\\p{sc=Hangul}", "gu"))) >= 0.3) return "ko";
  if (share(n(new RegExp("\\p{sc=Thai}", "gu"))) >= 0.3) return "th";
  if (share(n(new RegExp("\\p{sc=Devanagari}", "gu"))) >= 0.3) return "hi";
  return null;
}
export function otherScriptLanguage(text, code) {
  const own = scriptLanguage(text),
    wantL = lang(code);
  if (own) return own === wantL.code ? null : own;
  if (!["latin1", "latinExt", "viet"].includes(wantL.charset) && String(text ?? "").match(new RegExp("\\p{L}", "gu"))?.length) {
    const s2 = languageScores(text);
    return s2.length && s2[0].score >= 0.15 ? s2[0].code : String(text ?? "").match(new RegExp("\\p{L}", "gu")).length >= 40 ? "en" : null;
  }
  const s = languageScores(text);
  if (!s.length) return null;
  const want = lang(code).code,
    best = s[0],
    mine = s.find((x) => x.code === want)?.score ?? 0;
  if (best.code === want || best.score < 0.15 || close(best.code, want)) return null;
  if (mine < best.score * 0.5) return best.code;
  const ws = wordsOf(text),
    A = commonSets.get(best.code),
    B = commonSets.get(want);
  const theirs = ws.filter((w) => A.has(w) && !B.has(w)).length,
    ours = ws.filter((w) => B.has(w) && !A.has(w)).length;
  return theirs >= ws.length * 0.06 && theirs >= ours * 3 ? best.code : null;
}
export function screenTextNote(code) {
  const L = lang(code);
  if (L.charset === "cjk")
    return `${L.name} has no spaces between words and each character is about twice as wide as a Latin letter: keep every line on screen short (about 14 characters in a 16:9 video, 9 in 9:16) and break a longer title yourself into lines between phrases, never inside a word (a "\\n" where the engine's text takes one, else one line of text each). Characters may appear one by one, but never spread apart with letter spacing. Use the full-width punctuation of ${L.name} (、。！？「」).`;
  if (L.charset === "hangul")
    return `${L.name} syllables are about twice as wide as Latin letters: keep lines on screen short (about 16 syllables in 16:9, 10 in 9:16) and break them at a space.`;
  if (L.charset === "thai")
    return `${L.name} has no spaces between words and its vowel and tone marks sit above and below the letters: keep lines short and break them yourself between words (never inside one); never reveal ${L.name} text letter by letter, never use letter spacing on it, and give a line room above and below for its marks.`;
  if (L.charset === "deva")
    return `${L.name} letters join into clusters under one headline: never reveal ${L.name} text letter by letter (whole words only), never use letter spacing on it, and give a line room above and below for its vowel signs.`;
  if (L.charset === "viet")
    return `${L.name} stacks tone marks above and below its letters: keep every mark, and give a line room above and below for them.`;
  return "";
}
const segmenters = new Map();
const segmenter = (code) => {
  let s = segmenters.get(code);
  if (!s) segmenters.set(code, (s = new Intl.Segmenter(code, { granularity: "word" })));
  return s;
};
export function wordsIn(text, code) {
  const L = lang(code),
    t = String(text ?? "");
  if (L.spaced !== false) return t.split(/\s+/).filter(Boolean);
  const out = [];
  let carry = "";
  for (const s of segmenter(L.code).segment(t)) {
    const seg = s.segment;
    if (/^\s+$/.test(seg)) continue;
    if (s.isWordLike || /[\p{L}\p{N}]/u.test(seg)) {
      out.push(carry + seg);
      carry = "";
    } else if (/^[「『（(［\[【〔“‘《〈"']+$/u.test(seg) || !out.length) carry += seg;
    else out[out.length - 1] += seg;
  }
  if (carry) {
    if (out.length) out[out.length - 1] += carry;
    else out.push(carry);
  }
  return out;
}
export function countWords(text, code) {
  const L = lang(code),
    t = String(text ?? "");
  if (L.unit === "char") {
    const latin = (t.match(/[A-Za-z0-9À-ɏ]+/g) ?? []).reduce((n, w) => n + Math.ceil(w.length / 2), 0);
    return latin + (t.replace(/[A-Za-z0-9À-ɏ]+/g, "").match(/[\p{L}\p{N}]/gu) ?? []).length;
  }
  if (L.spaced === false) {
    let n = 0;
    for (const s of segmenter(L.code).segment(t)) if (s.isWordLike) n++;
    return n;
  }
  return t.split(/\s+/).filter(Boolean).length;
}
export const wordUnit = (code) => (lang(code).unit === "char" ? "characters" : "words");
export function matchUnits(text, code) {
  const L = lang(code),
    t = String(text ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(new RegExp("\\p{M}+", "gu"), "");
  if (L.spaced === false || L.code === "ko") return t.match(/[\p{L}\p{N}]/gu) ?? [];
  return t
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}
