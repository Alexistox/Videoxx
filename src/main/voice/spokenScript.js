import { lang } from "../styles/languages";

const BEAT_WORD = "beat|pause|pausa|pauze|paus|silence";
const UNIT = "(ms|milliseconds?|s|secs?|seconds?)";
const BEAT_AFTER = new RegExp(
  `^\\s*[([]\\s*(?:(long|longer)\\s+)?(${BEAT_WORD})(?:\\s*[:,-]?\\s*(\\d+(?:[.,]\\d+)?)[\\s-]*${UNIT}?)?\\s*[)\\]]\\s*$`,
  "i",
);
const BEAT_BEFORE = new RegExp(`^\\s*[([]\\s*(\\d+(?:[.,]\\d+)?)[\\s-]*${UNIT}?[\\s-]*(?:long\\s+)?(?:${BEAT_WORD})\\s*[)\\]]\\s*$`, "i");
export function beatOf(line) {
  const s = String(line ?? ""),
    after = BEAT_AFTER.exec(s),
    before = after ? null : BEAT_BEFORE.exec(s);
  const num = after?.[3] ?? before?.[1],
    unit = (after?.[4] ?? before?.[2] ?? "").toLowerCase();
  let secs;
  if (num != null) secs = parseFloat(num.replace(",", ".")) / (/^m/.test(unit) ? 1e3 : 1);
  else if (after) secs = after[1] ? 2.5 : /^beat$/i.test(after[2]) ? 1.5 : null;
  else return null;
  return secs == null || !Number.isFinite(secs) ? null : Math.round(Math.min(60, Math.max(0.1, secs)) * 100) / 100;
}
export function headingOf(line) {
  const m = /^\s{0,3}#{1,6}(?:\s+(.*?))?\s*$/.exec(line);
  return m ? (m[1] ?? "").replace(/\s+#+\s*$/, "").trim() : null;
}
const HASHTAGS = /^\s*(#[\p{L}\p{N}_]+[\s,]*)+$/u;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}⃣︎️‍]/gu;
const DIRECTION_ANY =
  "pause[sd]?|beat|laugh(?:s|ing)?|chuckles?|sighs?|whisper(?:s|ed|ing)?|slow(?:er|ly)?|soft(?:er|ly)?|quiet(?:er|ly)?|loud(?:er|ly)?|emphasis|narrator|voice[- ]?over|sfx|music|b-?roll|cut to|on[- ]?screen|text on screen|graphic|footage";
const DIRECTION_EN = `${DIRECTION_ANY}|fast(?:er)?|dramatic(?:ally)?|v\\.?o\\.?|visual|tone`;
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const FILLERS = {
  en: "a|an|the|then|with|for effect|for|effect|long|longer|short|brief|slight|slightly|very|more|a bit|bit|little|he|she|they|swells?|fades?|rises?|stops?|in|out|up|down|under|background|again|gently|heavily|deeply",
  es: "un|una|el|la|los|las|larga|largo|breve|corta|corto|muy|m[aá]s|de fondo|fondo|con",
  fr: "un|une|le|la|les|longue|long|courte|court|br[eè]ve|tr[eè]s|plus|de fond|en fond|avec",
  de: "ein|eine|einen|kurze|kurz|lange|lang|sehr|etwas|im hintergrund|hintergrund|mit",
  it: "un|una|il|la|lo|lunga|lungo|breve|corta|corto|molto|pi[uù]|di sottofondo|sottofondo|con",
  pt: "um|uma|o|a|longa|longo|breve|curta|curto|muito|mais|de fundo|fundo|com",
  nl: "een|de|het|lange|lang|korte|kort|heel|wat|op de achtergrond|achtergrond|met",
};
const DIRECTIONS = {
  es: "pausa|pausas|silencio|risa|risas|r[ií]e|se r[ií]e|riendo|suspira|suspiro|susurra|susurrando|susurro|despacio|m[aá]s despacio|lento|lentamente|m[aá]s lento|m[aá]s r[aá]pido|deprisa|suavemente|en voz baja|dram[aá]tico|dram[aá]tica|[eé]nfasis|narrador|narradora|voz en off|m[uú]sica|en pantalla|texto en pantalla",
  ca: "pausa|silenci|riu|rialles|sospira|xiuxiueja|a poc a poc|m[eé]s lent|lentament|m[eé]s r[aà]pid|suaument|en veu baixa|dram[aà]tic|[eè]mfasi|narrador|narradora|veu en off|m[uú]sica|en pantalla",
  fr: "pause|silence|rire|rires|rit|soupir|soupire|chuchote|chuchotant|murmure|lentement|plus lent|plus lentement|plus vite|doucement|[aà] voix basse|dramatique|emphase|narrateur|narratrice|voix off|musique|[aà] l.[eé]cran|texte [aà] l.[eé]cran",
  de: "pause|stille|lacht|lachen|lachend|seufzt|seufzer|fl[uü]stert|fl[uü]sternd|langsam|langsamer|schneller|leise|leiser|dramatisch|betont|betonung|sprecher|sprecherin|erz[aä]hler|erz[aä]hlerin|musik|auf dem bildschirm|einblendung",
  it: "pausa|silenzio|ride|risata|risate|sospira|sospiro|sussurra|sussurrando|lentamente|pi[uù] lento|pi[uù] veloce|sottovoce|drammatico|drammatica|enfasi|narratore|narratrice|voce fuori campo|musica|sullo schermo|testo a schermo",
  pt: "pausa|sil[eê]ncio|ri|risos|risada|suspira|suspiro|sussurra|sussurrando|devagar|mais devagar|lentamente|mais r[aá]pido|suavemente|em voz baixa|dram[aá]tico|dram[aá]tica|[eê]nfase|narrador|narradora|locu[cç][aã]o|m[uú]sica|na tela|no ecr[aã]",
  nl: "pauze|stilte|lacht|lachend|zucht|zuchten|fluistert|fluisterend|langzaam|langzamer|sneller|zachtjes|dramatisch|nadruk|verteller|vertelster|muziek|in beeld|op het scherm",
  sv: "paus|tystnad|skrattar|skratt|suckar|viskar|viskande|l[aå]ngsamt|l[aå]ngsammare|snabbare|tyst|dramatiskt|betoning|ber[aä]ttare|speakerr[oö]st|musik|p[aå] sk[aä]rmen",
  da: "pause|stilhed|griner|sukker|hvisker|langsomt|langsommere|hurtigere|dramatisk|betoning|fort[aæ]ller|musik|p[aå] sk[aæ]rmen",
  no: "pause|stillhet|latter|sukker|hvisker|sakte|saktere|raskere|dramatisk|betoning|forteller|musikk|p[aå] skjermen",
  fi: "tauko|hiljaisuus|nauraa|naurua|huokaa|kuiskaa|kuiskaten|hitaasti|hitaammin|nopeammin|hiljaa|hiljaisemmin|dramaattisesti|painotus|kertoja|selostaja|musiikki|ruudulla",
  id: "jeda|hening|tertawa|menghela napas|mendesah|berbisik|pelan-pelan|lebih pelan|lebih cepat|dramatis|penekanan|narator|sulih suara|musik|di layar",
  pl: "pauza|cisza|[sś]miech|[sś]mieje si[eę]|wzdycha|westchnienie|szepcze|szeptem|wolniej|powoli|szybciej|cicho|ciszej|g[lł]o[sś]niej|dramatycznie|nacisk|narrator|narratorka|lektor|muzyka|na ekranie",
  cs: "pauza|ticho|sm[ií]ch|sm[eě]je se|vzdech|vzdychne|[sš]ept[aá]|[sš]eptem|pomalu|pomaleji|rychleji|potichu|ti[sš]eji|hlasit[eě]ji|dramaticky|d[uů]raz|vyprav[eě][cč]|hudba|na obrazovce",
  sk: "pauza|ticho|smiech|smeje sa|vzdych|vzdychne|[sš]epk[aá]|[sš]eptom|pomaly|pomal[sš]ie|r[yý]chlej[sš]ie|potichu|hlasnej[sš]ie|dramaticky|d[oô]raz|rozpr[aá]va[cč]|hudba|na obrazovke",
  sl: "premor|pavza|ti[sš]ina|smeh|se smeje|vzdihne|[sš]epeta|po[cč]asi|po[cč]asneje|hitreje|tiho|glasneje|dramati[cč]no|poudarek|pripovedovalec|glasba|na zaslonu",
  hr: "pauza|stanka|ti[sš]ina|smijeh|smije se|uzdah|uzdahne|[sš]ap[cć]e|polako|sporije|br[zž]e|tiho|glasnije|dramati[cč]no|naglasak|pripovjeda[cč]|glazba|na ekranu",
  ro: "pauz[aă]|lini[sșş]te|r[aâ]de|r[aâ]sete|suspin[aă]|[sșş]opte[sșş]te|[iî]ncet|mai [iî]ncet|mai repede|[iî]n [sșş]oapt[aă]|dramatic|narator|naratoare|voce din off|muzic[aă]|pe ecran",
  hu: "sz[uü]net|csend|nevet|nevet[eé]s|s[oó]hajt|suttog|lassan|lassabban|gyorsabban|halkan|halkabban|hangosabban|dr[aá]maian|hangs[uú]ly|narr[aá]tor|mes[eé]l[oő]|zene|a k[eé]perny[oő]n",
  et: "paus|vaikus|naerab|naer|ohkab|sosistab|aeglaselt|aeglasemalt|kiiremini|vaikselt|valjemini|dramaatiliselt|r[oõ]huga|jutustaja|diktor|muusika|ekraanil",
  lv: "pauze|klusums|smejas|smiekli|nop[uū][sš]as|[cč]ukst|l[eē]n[aā]m|l[eē]n[aā]k|[aā]tr[aā]k|klusi|klus[aā]k|ska[lļ][aā]k|dramatiski|uzsvars|st[aā]st[iī]t[aā]js|m[uū]zika|uz ekr[aā]na",
  lt: "pauz[eė]|tyla|juokiasi|juokas|atsidusta|[sš]nabžda|[sš]nibžda|l[eė]tai|l[eė][cč]iau|grei[cč]iau|tyliai|tyliau|garsiau|drami[sš]kai|pabr[eė][zž]imas|pasakotojas|diktorius|muzika|ekrane",
  tr: "duraklama|sessizlik|g[uü]ler|g[uü]lme|i[cç] [cç]eker|f[iı]s[iı]ldar|yava[sş]|yava[sş][cç]a|daha yava[sş]|daha h[iı]zl[iı]|al[cç]ak sesle|dramatik|vurgu|anlat[iı]c[iı]|d[iı][sş] ses|m[uü]zik|ekranda",
};
const wordsRe = (alt, flags = "giu") => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, flags);
const dirOf = new Map();
const listsOf = (code) => {
  let r = dirOf.get(code);
  if (!r) {
    const alt = [code === "en" ? DIRECTION_EN : DIRECTION_ANY, DIRECTIONS[code]].filter(Boolean).join("|");
    r = { dir: wordsRe(alt), label: new RegExp(`^\\s*(?:${alt})\\s*:`, "iu"), filler: FILLERS[code] ? wordsRe(FILLERS[code]) : null };
    dirOf.set(code, r);
  }
  return r;
};
export function isDirection(inner, code) {
  const n = words(inner);
  if (!n || n > 12) return false;
  const { dir, label, filler } = listsOf(code);
  if (label.test(inner)) return true;
  if (n > 6 || new RegExp("\\p{N}", "u").test(inner)) return false;
  let hits = 0;
  const rest = inner.replace(dir, (m) => {
    hits += words(m);
    return " ";
  });
  if (!hits) return false;
  const others = words((filler ? rest.replace(filler, " ") : rest).replace(/[^\p{L}\p{N}'’-]+/gu, " "));
  return hits > others;
}
const QUOTES = (code) => (code === "de" || code === "da" ? { open: "»›", close: "«‹" } : { open: "«‹", close: "»›" });
const closing = (code) => new RegExp(` ([,.;:!?…%‰€${QUOTES(code).close}]+)`, "g");
const opening = (code) => new RegExp(`([¿¡${QUOTES(code).open}]+) `, "g");
export function spokenLine(line, language) {
  if (headingOf(line) !== null || HASHTAGS.test(line)) return "";
  const L = lang(language),
    N = L.number,
    n = N.toLocaleLowerCase();
  let l = line
    .replace(/<!--.*?-->/g, " ")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+•]\s+/, "")
    .replace(new RegExp("^\\s*#(\\d+)[.:)]?\\s+(?=\\p{Lu})", "u"), `${N} $1: `)
    .replace(/(^|[^\p{L}\p{N}&#])#(\d)/gu, `$1${n} $2`)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\((?:https?:|www\.|\/)[^)]*\)/g, "$1")
    .replace(/^\s*\[[^\]]*\]\s*:/, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(([^()]*)\)/g, (m, inner, at, all) =>
      // (directions), not (asides)
      !all.slice(0, at).trim() || isDirection(inner, L.code) ? " " : m,
    )
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, "$1$2")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_]+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`+/g, "")
    .replace(/\*+/g, " ")
    .replace(EMOJI, " ")
    .replace(/[ \t    ]+/g, " ")
    .replace(closing(L.code), "$1")
    .replace(opening(L.code), "$1")
    .trim();
  if (/^[-*_=~#\s]*$/.test(l)) l = "";
  return l.startsWith(n + " ") && /\d/.test(l.charAt(n.length + 1)) ? N + l.slice(n.length) : l;
}
export function spokenScript(text, language) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      out.push("");
      continue;
    }
    const s = spokenLine(line, language);
    if (s) out.push(s);
  }
  return out.join("\n");
}
