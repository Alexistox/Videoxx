// list bindings of the inlined lucide region that app code uses, with each icon's name + iconNode
import fs from "node:fs";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
const traverse = _traverse.default, generate = _generate.default;
const [bundle, from, to, out] = process.argv.slice(2);
const ast = parse(fs.readFileSync(bundle, "utf8"), { sourceType: "module", plugins: ["jsx"] });
const inR = (n) => n.loc.start.line >= +from && n.loc.start.line <= +to;
const used = new Map();
traverse(ast, { Program(p) {
  for (const [name, b] of Object.entries(p.scope.bindings)) {
    let s = b.path; while (s.parentPath && s.parentPath.node !== ast.program) s = s.parentPath;
    if (!inR(s.node)) continue;
    const ext = b.referencePaths.filter((r) => { let q = r; while (q.parentPath && q.parentPath.node !== ast.program) q = q.parentPath; return !inR(q.node) && q.node.loc.start.line >= 14239; });
    if (!ext.length) continue;
    const d = b.path.node;
    let icon = null;
    if (d.init?.type === "CallExpression" && d.init.callee.name === "createLucideIcon") {
      const nd = p.scope.getBinding(d.init.arguments[0].name).path.node.init;
      icon = eval("(" + generate(nd).code + ")");
    }
    used.set(name, icon);
  }
  p.stop();
} });
fs.writeFileSync(out, JSON.stringify(Object.fromEntries(used)));
console.log(used.size, [...used.keys()].filter((k) => !used.get(k)).join(" "));
