import fs from "node:fs";
import { parse } from "@babel/parser";
import _generate from "@babel/generator";
const generate = _generate.default;
const [a, b, fa = "1", fb = "1", out] = process.argv.slice(2);
const norm = (s) => s.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\b([A-Za-z_][\w]*?)(\$\d+|\d+)\b/g, "$1").replace(/\s+/g, "");
function load(f, from) {
  const ast = parse(fs.readFileSync(f, "utf8"), { sourceType: "module", plugins: ["jsx"] });
  const decl = new Map(), eff = [];
  for (const n of ast.program.body) {
    if (n.loc.start.line < from) continue;
    if (["FunctionDeclaration", "ClassDeclaration", "VariableDeclaration"].includes(n.type)) {
      for (const d of n.type === "VariableDeclaration" ? n.declarations : [n]) { const nm = (d.id?.name || "?").replace(/\$\d+$/, ""); if (!decl.has(nm)) decl.set(nm, []); decl.get(nm).push(norm(generate(d).code)); }
    } else eff.push(norm(generate(n).code));
  }
  return { decl, eff };
}
const A = load(a, +fa), B = load(b, +fb);
const lines = [];
for (const [k, v] of A.decl) {
  const w = B.decl.get(k) || []; const ws = new Set(w);
  for (const body of v) if (!ws.has(body) && w.length) {
    // closest rebuilt body: first differing char
    const c = w.reduce((best, x) => { let i = 0; while (i < x.length && x[i] === body[i]) i++; return i > best[0] ? [i, x] : best; }, [-1, ""]);
    const i = c[0];
    lines.push(`## ${k}\n  orig: …${body.slice(Math.max(0, i - 80), i + 120)}\n  new : …${c[1].slice(Math.max(0, i - 80), i + 120)}`);
  }
}
lines.push("\n### side effects (orig)"); A.eff.forEach((e, i) => lines.push(`${i}: ${e.slice(0, 120)}`));
lines.push("\n### side effects (new)"); B.eff.forEach((e, i) => lines.push(`${i}: ${e.slice(0, 120)}`));
fs.writeFileSync(out, lines.join("\n"));
