import fs from "node:fs";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default;
const [bundle, modsFile, anJson] = process.argv.slice(2);
const code = fs.readFileSync(bundle, "utf8");
const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
const mods = JSON.parse(fs.readFileSync(modsFile, "utf8"));
const st = JSON.parse(fs.readFileSync(anJson, "utf8"));
const declLine = new Map(); for (const s of st) for (const n of s.names) declLine.set(n, s.start);
const modAt = (line) => { let m = null; for (const x of mods) if (x.start_line <= line) m = x; return m?.path; };
for (const n of ast.program.body) {
  if (n.type !== "VariableDeclaration") continue;
  const d = n.declarations[0];
  const src = code.slice(d.init?.start ?? 0, (d.init?.start ?? 0) + 80);
  if (!/Object\.freeze\(\/\* @__PURE__ \*\/ Object\.defineProperty\(\{/.test(src)) continue;
  const obj = d.init.arguments[0].arguments[0];
  const members = obj.properties.filter((p) => p.type === "ObjectProperty" && p.key.name !== "__proto__").map((p) => [p.key.name, p.value.name]);
  const by = {};
  for (const [k, v] of members) { const m = modAt(declLine.get(v)); (by[m] ||= []).push(k); }
  console.log(`${d.id.name} @L${n.loc.start.line} in ${modAt(n.loc.start.line)}:`, JSON.stringify(Object.fromEntries(Object.entries(by).map(([m, ks]) => [m, ks.length]))));
}
