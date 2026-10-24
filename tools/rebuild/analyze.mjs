// Parse a bundle and list its top-level statements with line ranges, declared names,
// top-level names each one references, and cross-statement assignments.
// usage: node analyze.mjs <bundle.js> <out.json> <out-index.txt> [fromLine]
import fs from "node:fs";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default;

const [file, outJson, outIdx, fromLineArg] = process.argv.slice(2);
const fromLine = Number(fromLineArg || 1);
const code = fs.readFileSync(file, "utf8");
const ast = parse(code, { sourceType: "module", plugins: ["jsx"], errorRecovery: false });

const stmts = ast.program.body.map((n, i) => ({ i, n, start: n.loc.start.line, end: n.loc.end.line }));
// comments directly above a statement belong to it
const declOf = new Map(); // name -> stmt index
const declared = stmts.map(() => []);
traverse(ast, {
  Program(p) {
    for (const [name, b] of Object.entries(p.scope.bindings)) {
      let s = b.path;
      while (s.parentPath && s.parentPath.node !== ast.program) s = s.parentPath;
      const idx = ast.program.body.indexOf(s.node);
      declOf.set(name, idx);
      declared[idx].push(name);
    }
  },
});
const refs = stmts.map(() => new Set());
const writes = stmts.map(() => new Set());
traverse(ast, {
  Program(p) {
    for (const [name, b] of Object.entries(p.scope.bindings)) {
      const d = declOf.get(name);
      for (const r of b.referencePaths) {
        let s = r;
        while (s.parentPath && s.parentPath.node !== ast.program) s = s.parentPath;
        const idx = ast.program.body.indexOf(s.node);
        if (idx !== d) refs[idx].add(name);
      }
      for (const v of b.constantViolations) {
        let s = v;
        while (s.parentPath && s.parentPath.node !== ast.program) s = s.parentPath;
        const idx = ast.program.body.indexOf(s.node);
        if (idx !== d) writes[idx].add(name);
      }
    }
  },
});
const lines = code.split("\n");
const out = stmts.map((s) => ({
  i: s.i,
  start: s.start,
  end: s.end,
  type: s.n.type,
  names: declared[s.i],
  refs: [...refs[s.i]],
  writes: [...writes[s.i]],
}));
fs.writeFileSync(outJson, JSON.stringify(out));
const idx = out
  .filter((s) => s.start >= fromLine)
  .map((s) => `L${s.start}-${s.end}\t${s.type.replace("Declaration", "").replace("Statement", "")}\t${s.names.join(",") || lines[s.start - 1].trim().slice(0, 60)}`);
fs.writeFileSync(outIdx, idx.join("\n"));
console.log(`${out.length} statements; cross-writes:`, out.filter((s) => s.writes.length).map((s) => `L${s.start}:${s.writes}`).join(" "));
