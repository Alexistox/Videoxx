const GENERIC_CONTROLS = [
  "format",
  "post.grain",
  "post.vignette",
  "post.warmth",
  "camera.drift",
  "transitions.duration",
  "sheet.cols",
  "pace.perMinute",
  "brand.color",
];
const OPTIONAL_CONTROLS = ["post.paper", "post.halftone", "post.tone", "shadow.opacity", "border"];
const NEUTRAL = {
  "transitions.duration": { label: "Transition length", help: "Travel time between chapters." },
  "brand.color": {
    help: "Your channel's colour for the accents (where the style uses its loud accent colour: stamps, dates, marker, tags). Style default keeps the style's own colours.",
  },
  "sheet.cols": { help: "How many chapters sit side by side on the page (the finale shows them all)." },
};
export function customControls(base, declared) {
  const keep = new Set([
    ...GENERIC_CONTROLS,
    ...(Array.isArray(declared) ? declared.map(String).filter((p) => OPTIONAL_CONTROLS.includes(p)) : []),
  ]);
  return base.filter((c) => c.path !== "theme" && keep.has(c.path)).map((c) => ({ ...c, ...(NEUTRAL[c.path] ?? {}) }));
}
function readObjectLiteral(src, at) {
  const r = new Reader2(src, at);
  try {
    r.ws();
    if (src[r.i] !== "{") return void 0;
    const v = r.value();
    return v && typeof v === "object" && !Array.isArray(v) ? v : void 0;
  } catch {
    return void 0;
  }
}
export function exportedObject(src, name) {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\{`).exec(src);
  return m ? readObjectLiteral(src, m.index + m[0].length - 1) : void 0;
}
const UNKNOWN = Symbol("unknown");
const ID_START = /[A-Za-z_$]/,
  ID_PART = /[\w$]/;
class Reader2 {
  constructor(s, at) {
    this.s = s;
    this.i = at;
  }
  s;
  i;
  depth = 0;
  fail() {
    throw new Error("not a literal");
  }
  /** whitespace and comments */
  ws() {
    const s = this.s;
    for (;;) {
      while (this.i < s.length && /\s/.test(s[this.i])) this.i++;
      if (s.startsWith("//", this.i)) {
        const e = s.indexOf("\n", this.i);
        this.i = e < 0 ? s.length : e + 1;
        continue;
      }
      if (s.startsWith("/*", this.i)) {
        const e = s.indexOf("*/", this.i + 2);
        if (e < 0) this.fail();
        this.i = e + 2;
        continue;
      }
      return;
    }
  }
  value() {
    this.ws();
    const s = this.s,
      c = s[this.i];
    if (c === void 0) this.fail();
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'") return this.string(c);
    if (c === "`") {
      const t = this.template();
      return t === null ? UNKNOWN : t;
    }
    if (/[-+.\d]/.test(c)) {
      const n = this.number();
      if (n !== null) return n;
    }
    if (ID_START.test(c)) {
      const w = this.word(),
        after = (() => {
          const k = this.i;
          this.ws();
          const nx = s[this.i];
          this.i = k;
          return nx;
        })();
      if (after === void 0 || after === "," || after === "}" || after === "]") {
        if (w === "true") return true;
        if (w === "false") return false;
        if (w === "null") return null;
        if (w === "undefined") return void 0;
        if (w === "Infinity") return Infinity;
        if (w === "NaN") return NaN;
      }
    }
    return UNKNOWN;
  }
  /** after an unknown value: moves to the ',' / '}' / ']' that ends it, past brackets, strings and comments */
  skip() {
    const s = this.s;
    let d = 0;
    while (this.i < s.length) {
      this.ws();
      const c = s[this.i];
      if (c === void 0) break;
      if (c === '"' || c === "'") {
        this.string(c);
        continue;
      }
      if (c === "`") {
        this.rawTemplate();
        continue;
      }
      if (c === "(" || c === "[" || c === "{") {
        d++;
        this.i++;
        continue;
      }
      if (c === ")" || c === "]" || c === "}") {
        if (d === 0) return;
        d--;
        this.i++;
        continue;
      }
      if (c === "," && d === 0) return;
      this.i++;
    }
    this.fail();
  }
  object() {
    if (++this.depth > 64) this.fail();
    const o = {};
    this.i++;
    for (;;) {
      this.ws();
      const s = this.s,
        c = s[this.i];
      if (c === "}") {
        this.i++;
        this.depth--;
        return o;
      }
      if (c === void 0) this.fail();
      let key2 = null;
      if (c === '"' || c === "'") key2 = this.string(c);
      else if (ID_START.test(c)) key2 = this.word();
      else if (/\d/.test(c)) {
        const n = this.number();
        key2 = n === null ? null : String(n);
      }
      this.ws();
      if (key2 === null || s[this.i] !== ":") {
        this.skip();
      } else {
        this.i++;
        const start = this.i,
          v = this.value();
        if (v === UNKNOWN) {
          this.i = start;
          this.skip();
        } else {
          this.ws();
          const nx = s[this.i];
          if (nx !== "," && nx !== "}") {
            this.i = start;
            this.skip();
          } else if (v !== void 0 && key2 !== "__proto__" && key2 !== "constructor" && key2 !== "prototype") o[key2] = v;
        }
      }
      this.ws();
      if (s[this.i] === ",") {
        this.i++;
        continue;
      }
      if (s[this.i] === "}") continue;
      this.fail();
    }
  }
  array() {
    if (++this.depth > 64) this.fail();
    const a = [];
    this.i++;
    for (;;) {
      this.ws();
      const s = this.s;
      if (s[this.i] === "]") {
        this.i++;
        this.depth--;
        return a;
      }
      if (s[this.i] === void 0) this.fail();
      const start = this.i,
        v = this.value();
      if (v === UNKNOWN) {
        this.i = start;
        this.skip();
      } else {
        this.ws();
        const nx = s[this.i];
        if (nx !== "," && nx !== "]") {
          this.i = start;
          this.skip();
        } else a.push(v);
      }
      this.ws();
      if (s[this.i] === ",") {
        this.i++;
        continue;
      }
      if (s[this.i] === "]") continue;
      this.fail();
    }
  }
  word() {
    const s = this.s,
      b = this.i;
    this.i++;
    while (this.i < s.length && ID_PART.test(s[this.i])) this.i++;
    return s.slice(b, this.i);
  }
  number() {
    const m = /^[-+]?(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(\d[\d_]*\.?[\d_]*|\.\d[\d_]*)([eE][-+]?\d+)?|Infinity)/.exec(
      this.s.slice(this.i, this.i + 64),
    );
    if (!m) return null;
    const t = m[0].replace(/_/g, ""),
      neg = t.startsWith("-"),
      body = t.replace(/^[-+]/, "");
    const n = /^0[xX]/.test(body)
      ? parseInt(body.slice(2), 16)
      : /^0[bB]/.test(body)
        ? parseInt(body.slice(2), 2)
        : /^0[oO]/.test(body)
          ? parseInt(body.slice(2), 8)
          : Number(body);
    if (Number.isNaN(n)) return null;
    this.i += m[0].length;
    return neg ? -n : n;
  }
  string(q) {
    const s = this.s;
    let out = "";
    this.i++;
    while (this.i < s.length) {
      const c = s[this.i++];
      if (c === q) return out;
      if (c === "\n") this.fail();
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = s[this.i++];
      if (e === "n") out += "\n";
      else if (e === "t") out += "	";
      else if (e === "r") out += "\r";
      else if (e === "b") out += "\b";
      else if (e === "f") out += "\f";
      else if (e === "v") out += "\v";
      else if (e === "0" && !/\d/.test(s[this.i] ?? "")) out += "\0";
      else if (e === "x") {
        out += String.fromCharCode(parseInt(s.slice(this.i, this.i + 2), 16));
        this.i += 2;
      } else if (e === "u") {
        if (s[this.i] === "{") {
          const end = s.indexOf("}", this.i);
          out += String.fromCodePoint(parseInt(s.slice(this.i + 1, end), 16));
          this.i = end + 1;
        } else {
          out += String.fromCharCode(parseInt(s.slice(this.i, this.i + 4), 16));
          this.i += 4;
        }
      } else if (e === "\r") {
        if (s[this.i] === "\n") this.i++;
      } else if (e === "\n");
      else out += e;
    }
    this.fail();
  }
  /** a template literal without ${...} is a plain string; one with an expression is unknown (null) */
  template() {
    const s = this.s,
      b = this.i;
    let out = "";
    this.i++;
    while (this.i < s.length) {
      const c = s[this.i++];
      if (c === "`") return out;
      if (c === "$" && s[this.i] === "{") {
        this.i = b;
        return null;
      }
      if (c === "\\") {
        const e = s[this.i++];
        out += e === "n" ? "\n" : e === "t" ? "	" : e;
        continue;
      }
      out += c;
    }
    this.fail();
  }
  /** skips a template literal, ${...} included */
  rawTemplate() {
    const s = this.s;
    this.i++;
    let d = 0;
    while (this.i < s.length) {
      const c = s[this.i++];
      if (c === "\\") {
        this.i++;
        continue;
      }
      if (d === 0 && c === "`") return;
      if (c === "$" && s[this.i] === "{") {
        d++;
        this.i++;
        continue;
      }
      if (d > 0 && c === "}") d--;
    }
    this.fail();
  }
}
