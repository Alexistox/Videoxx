// Compare two bundles: same top-level declarations (by base name) and same order of side-effect statements.
// usage: node compare.mjs <original.js> <rebuilt.js> [firstLineOriginal] [firstLineRebuilt]
import fs from "node:fs";
import { parse } from "@babel/parser";
import _generate from "@babel/generator";
const generate = _generate.default;
const [a, b, fa = "1", fb = "1"] = process.argv.slice(2);
const norm = (s) => s.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\b([A-Za-z_][\w]*?)(\$\d+|\d+)\b/g, "$1").replace(/\s+/g, "");
function load(f, from) {
  const code = fs.readFileSync(f, "utf8");
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
  const decl = new Map(), effects = [];
  for (const n of ast.program.body) {
    if (n.loc.start.line < from) continue;
    const isDecl = n.type === "FunctionDeclaration" || n.type === "ClassDeclaration" || (n.type === "VariableDeclaration" && n.declarations.every((d) => !d.init || /Function|Literal|Object|Array|Class|Template|Identifier|Member|Arrow|Unary|Binary|Logical|Conditional|New|Call|Regex|Sequence|Tagged|Await/.test(d.init.type)));
    if (isDecl) {
      for (const d of n.type === "VariableDeclaration" ? n.declarations : [n]) {
        const nm = d.id?.name ? d.id.name.replace(/\$\d+$/, "") : "?pattern";
        const body = norm(generate(d).code);
        if (!decl.has(nm)) decl.set(nm, []);
        decl.get(nm).push(body);
      }
    } else effects.push(norm(generate(n).code).slice(0, 200));
  }
  return { decl, effects };
}
const A = load(a, +fa), B = load(b, +fb);
let missing = [], extra = [], changed = 0;
for (const [k, v] of A.decl) {
  const w = B.decl.get(k) || [];
  if (w.length < v.length) missing.push(`${k} x${v.length - w.length}`);
  const ws = new Set(w);
  for (const body of v) if (!ws.has(body)) changed++;
}
for (const [k, v] of B.decl) if ((A.decl.get(k) || []).length < v.length) extra.push(`${k} x${v.length - (A.decl.get(k) || []).length}`);
console.log(`declarations: original ${[...A.decl.values()].flat().length}, rebuilt ${[...B.decl.values()].flat().length}`);
console.log(`missing in rebuilt (${missing.length}):`, missing.slice(0, 40).join(", "));
console.log(`extra in rebuilt (${extra.length}):`, extra.slice(0, 40).join(", "));
console.log(`declaration bodies that differ after normalising names: ${changed}`);
console.log(`side-effect statements: original ${A.effects.length}, rebuilt ${B.effects.length}`);
const same = A.effects.length === B.effects.length && A.effects.every((e, i) => e === B.effects[i]);
console.log(`side-effect order identical: ${same}`);
if (!same) {
  for (let i = 0; i < Math.max(A.effects.length, B.effects.length); i++) if (A.effects[i] !== B.effects[i]) { console.log(`first difference at #${i}\n  orig: ${A.effects[i]}\n  new : ${B.effects[i]}`); break; }
}
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify({ missing, extra }, null, 1));
