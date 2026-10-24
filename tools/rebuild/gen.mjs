// Split a rollup bundle back into ES modules.
// usage: node gen.mjs <config.json>
// config: { kind: "main"|"ren", bundle, outRoot, firstLine, modules: [{start_line, path}], assetDir?, report }
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import * as t from "@babel/types";
import * as prettier from "prettier";
const traverse = _traverse.default;
const generate = _generate.default;

const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const REN = cfg.kind === "ren";
const code = fs.readFileSync(cfg.bundle, "utf8");
const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
const report = { warnings: [], forwardImports: [], crossWrites: [], jsxFallbacks: 0, renamedTop: 0, renamedLocal: 0, comments: { before: 0, after: 0 } };
const PURE = /^\s*[#@]__PURE__\s*$/;

// ---------- 1. classify top-level statements ----------
let prog;
traverse(ast, { Program(p) { prog = p; p.stop(); } });
const body = prog.get("body");
const stmtOf = (p) => { let s = p; while (s.parentPath && s.parentPath.node !== ast.program) s = s.parentPath; return ast.program.body.indexOf(s.node); };

// comments between statements: keep them only as leading comments of the next statement
for (const [i, n] of ast.program.body.entries()) {
  if (n.trailingComments) n.trailingComments = n.trailingComments.filter((c) => c.loc.start.line === n.loc.end.line && !(ast.program.body[i + 1]?.leadingComments || []).includes(c));
}

const kindOf = []; // "app" | "external" | "asset" | "vendor" | "drop"
const externals = new Map(); // local -> source
const assets = new Map(); // local -> file name in bundle dir
const nsInfo = new Map(); // namespace object name -> { line, members: [[key, binding]] }
const VENDOR = { reactExports: "react", React: "react-default", jsxRuntimeExports: "jsx", clientExports: "react-dom/client", reactDomExports: "react-dom" };
for (const [i, n] of ast.program.body.entries()) {
  const line = n.loc.start.line;
  let k = "app";
  if (line < cfg.firstLine) k = REN ? "vendor" : "drop";
  if (cfg.lucideRange && line >= cfg.lucideRange[0] && line <= cfg.lucideRange[1]) k = "lucide";
  if (t.isVariableDeclaration(n) && n.declarations.length === 1) {
    const d = n.declarations[0];
    if (t.isIdentifier(d.id) && t.isCallExpression(d.init) && t.isIdentifier(d.init.callee, { name: "require" }) && t.isStringLiteral(d.init.arguments[0])) {
      k = "external"; externals.set(d.id.name, d.init.arguments[0].value);
    }
    // const X = "" + new URL("file", import.meta.url).href
    if (t.isIdentifier(d.id) && t.isBinaryExpression(d.init) && t.isMemberExpression(d.init.right) && t.isNewExpression(d.init.right.object) && t.isIdentifier(d.init.right.object.callee, { name: "URL" })) {
      k = "asset"; assets.set(d.id.name, d.init.right.object.arguments[0].value);
    }
    if (REN && t.isIdentifier(d.id) && VENDOR[d.id.name]) k = "vendor";
    // rollup namespace object (from a dynamic import of a module in the same chunk)
    const fr = d.init;
    if (t.isCallExpression(fr) && t.isMemberExpression(fr.callee) && t.isIdentifier(fr.callee.property, { name: "freeze" }) && t.isCallExpression(fr.arguments[0]) && t.isObjectExpression(fr.arguments[0].arguments[0]) && fr.arguments[0].arguments[0].properties.some((p) => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: "__proto__" }))) {
      k = "ns";
      nsInfo.set(d.id.name, { line, members: fr.arguments[0].arguments[0].properties.filter((p) => !t.isIdentifier(p.key, { name: "__proto__" })).map((p) => [p.key.name, p.value.name]) });
    }
  }
  kindOf[i] = k;
}

// ---------- 2. assign app statements to modules ----------
const mods = cfg.modules.slice().sort((a, b) => a.start_line - b.start_line).map((m, j) => ({ ...m, j, stmts: [], imports: new Map(), exports: new Set(), ext: new Set(), assetUse: new Set(), vendorUse: new Set() }));
const modOfStmt = [];
const modAtLine = (line) => { let m = null; for (const mm of mods) if (mm.start_line <= line) m = mm; return m; };
for (const mm of mods) { mm.lucideUse = new Set(); mm.nsUse = new Set(); mm.reexports = new Map(); mm.aliasExports = []; }
for (const [i, n] of ast.program.body.entries()) {
  if (kindOf[i] !== "app") continue;
  let m = null;
  for (const mm of mods) if (mm.start_line <= n.loc.start.line) m = mm;
  if (!m) { report.warnings.push(`statement at L${n.loc.start.line} before first module`); m = mods[0]; }
  m.stmts.push(i); modOfStmt[i] = m;
}

// ---------- 3. bindings: imports / exports / cross-module writes ----------
const declMod = new Map(); // binding name -> module
for (const [name, b] of Object.entries(prog.scope.bindings)) {
  const si = stmtOf(b.path);
  if (kindOf[si] === "app") declMod.set(name, modOfStmt[si]);
}
for (const [name, b] of Object.entries(prog.scope.bindings)) {
  const si = stmtOf(b.path);
  const k = kindOf[si];
  for (const r of b.referencePaths) {
    const ri = stmtOf(r); if (kindOf[ri] !== "app") continue;
    const um = modOfStmt[ri];
    if (k === "external") um.ext.add(name);
    else if (k === "asset") um.assetUse.add(name);
    else if (k === "vendor") um.vendorUse.add(name);
    else if (k === "ns") um.nsUse.add(name);
    else if (k === "lucide") um.lucideUse.add(name);
    else if (k === "app") {
      const dm = declMod.get(name);
      if (dm !== um) {
        um.imports.set(name, dm); dm.exports.add(name);
        if (dm.j > um.j) {
          // a forward import is harmless inside functions; at module top level it changes evaluation order
          const top = !r.getFunctionParent();
          report.forwardImports.push({ name, from: dm.path, into: um.path, line: r.node.loc.start.line, top });
        }
      }
    } else if (k === "drop") report.warnings.push(`app code uses dropped helper ${name} at L${r.node.loc.start.line}`);
  }
  for (const v of b.constantViolations) {
    const vi = stmtOf(v); if (kindOf[vi] !== "app") continue;
    if (k === "app" && modOfStmt[vi] !== declMod.get(name)) report.crossWrites.push({ name, declared: declMod.get(name).path, writtenIn: modOfStmt[vi].path, line: v.node.loc.start.line });
  }
}
// namespace objects -> dynamic import() of the module that holds the members (or a barrel of re-exports)
for (const [name, ns] of nsInfo) {
  const owners = new Set(ns.members.map(([, v]) => declMod.get(v)));
  for (const [, v] of ns.members) declMod.get(v).exports.add(v);
  ns.host = modAtLine(ns.line);
  if (owners.size === 1) ns.target = [...owners][0];
  else {
    ns.target = ns.host;
    for (const [k, v] of ns.members) { const o = declMod.get(v); if (!ns.host.reexports.has(o)) ns.host.reexports.set(o, []); ns.host.reexports.get(o).push([k, v]); }
  }
}
if (cfg.checkOnly) { fs.writeFileSync(cfg.report, JSON.stringify(report, null, 1)); console.log(JSON.stringify({ fwdTop: report.forwardImports.filter((f) => f.top).length, fwd: report.forwardImports.length, crossWrites: report.crossWrites.length, warnings: report.warnings.length })); process.exit(0); }

// ---------- 4. helpers for naming ----------
const strip = (n) => n.replace(/\$\d+$/, "");
const topNames = new Set(Object.keys(prog.scope.bindings));
const progOf = (file) => { let pp; traverse(file, { Program(p) { pp = p; p.stop(); } }); return pp; };

// rename `from` -> `to` at module top level only if nothing can be captured or shadowed
function safeRename(pp, from, to) {
  if (from === to || !t.isValidIdentifier(to)) return false;
  const sc = pp.scope;
  if (sc.hasOwnBinding(to) || sc.globals[to] || t.isValidIdentifier(to) === false) return false;
  const b = sc.getOwnBinding(from);
  const sites = b ? [...b.referencePaths, ...b.constantViolations] : [];
  if (!b) pp.traverse({ Identifier(q) { if (q.node.name === from && q.isReferencedIdentifier() && !q.scope.hasBinding(from, true)) sites.push(q); } });
  for (const r of sites) if (r.scope.getBinding(to) || r.scope.hasBinding(to, true)) return false;
  if (b) sc.rename(from, to);
  else for (const r of sites) r.node.name = to;
  return true;
}

// ---------- 5. JSX conversion ----------
const JSX_NAME = /^[A-Za-z_$][\w$-]*$/;
function jsxName(typeNode) {
  if (t.isStringLiteral(typeNode)) return JSX_NAME.test(typeNode.value) && /^[a-z]/.test(typeNode.value) ? t.jsxIdentifier(typeNode.value) : null;
  if (t.isIdentifier(typeNode)) return /^[A-Z]/.test(typeNode.name) ? t.jsxIdentifier(typeNode.name) : null;
  if (t.isMemberExpression(typeNode) && !typeNode.computed && t.isIdentifier(typeNode.property)) {
    const o = t.isIdentifier(typeNode.object) ? t.jsxIdentifier(typeNode.object.name) : jsxName(typeNode.object);
    return o ? t.jsxMemberExpression(o, t.jsxIdentifier(typeNode.property.name)) : null;
  }
  return null;
}
const isFragmentType = (n) => t.isMemberExpression(n) && !n.computed && t.isIdentifier(n.property, { name: "Fragment" }) && t.isIdentifier(n.object) && ["jsxRuntimeExports", "reactExports", "React"].includes(n.object.name);
const safeText = (s) => s.length > 0 && !/[{}<>&\n\r\t\u00a0]/.test(s) && s.trim() === s;
const safeAttrStr = (s) => !/["\\&\n\r]/.test(s);
function toChild(e) {
  if (t.isJSXElement(e) || t.isJSXFragment(e)) return e;
  if (t.isStringLiteral(e) && safeText(e.value)) return t.jsxText(e.value);
  return t.jsxExpressionContainer(e);
}
function convertJsx(file, flags) {
  traverse(file, {
    CallExpression: {
      exit(p) {
        const c = p.node.callee;
        if (!(t.isMemberExpression(c) && t.isIdentifier(c.object, { name: "jsxRuntimeExports" }) && t.isIdentifier(c.property) && ["jsx", "jsxs"].includes(c.property.name))) return;
        const [type, props, key] = p.node.arguments;
        if (p.node.arguments.length > 3) { report.jsxFallbacks++; return; }
        const many = c.property.name === "jsxs";
        const frag = isFragmentType(type);
        const name = frag ? null : jsxName(type);
        if (!frag && !name) { report.jsxFallbacks++; report.warnings.push(`jsx fallback at L${p.node.loc?.start.line}: ${generate(type).code}`); return; }
        const attrs = [];
        let children = [];
        if (key && !t.isIdentifier(key, { name: "undefined" })) attrs.push(t.jsxAttribute(t.jsxIdentifier("key"), t.isStringLiteral(key) && safeAttrStr(key.value) ? t.stringLiteral(key.value) : t.jsxExpressionContainer(key)));
        const propList = t.isObjectExpression(props) ? props.properties : props && !t.isNullLiteral(props) ? [t.spreadElement(props)] : [];
        const lastSpread = propList.map((q) => t.isSpreadElement(q)).lastIndexOf(true);
        propList.forEach((q, qi) => {
          let attr;
          if (t.isSpreadElement(q)) attr = t.jsxSpreadAttribute(q.argument);
          else if (t.isObjectProperty(q) && !q.computed && (t.isIdentifier(q.key) || t.isStringLiteral(q.key))) {
            const k = t.isIdentifier(q.key) ? q.key.name : q.key.value;
            const v = q.value;
            if (k === "children" && qi > lastSpread && qi === propList.length - 1) {
              if (many && t.isArrayExpression(v)) children = v.elements.map((e) => toChild(e ?? t.nullLiteral()));
              else children = [toChild(v)];
              return;
            }
            if (!JSX_NAME.test(k) || k === "key") attr = t.jsxSpreadAttribute(t.objectExpression([q]));
            else if (t.isBooleanLiteral(v, { value: true })) attr = t.jsxAttribute(t.jsxIdentifier(k), null);
            else if (t.isStringLiteral(v) && safeAttrStr(v.value)) attr = t.jsxAttribute(t.jsxIdentifier(k), t.stringLiteral(v.value));
            else attr = t.jsxAttribute(t.jsxIdentifier(k), t.jsxExpressionContainer(v));
          } else attr = t.jsxSpreadAttribute(t.objectExpression([q]));
          if (q.leadingComments?.length || q.trailingComments?.length) {
            // JSX attributes cannot carry comments reliably: keep them inside the value expression when possible
            const holder = t.isJSXAttribute(attr) && t.isJSXExpressionContainer(attr.value) ? attr.value.expression : t.isJSXSpreadAttribute(attr) ? attr.argument : null;
            if (holder) { holder.leadingComments = [...(q.leadingComments || []), ...(holder.leadingComments || [])]; holder.trailingComments = [...(holder.trailingComments || []), ...(q.trailingComments || [])]; }
            else report.lostComments = (report.lostComments || 0) + (q.leadingComments?.length || 0) + (q.trailingComments?.length || 0);
          }
          attrs.push(attr);
        });
        let el;
        if (frag && attrs.length === 0) el = t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), children);
        else {
          const nm = frag ? t.jsxIdentifier("Fragment") : name;
          if (frag) flags.fragment = true;
          const selfClose = children.length === 0;
          el = t.jsxElement(t.jsxOpeningElement(nm, attrs, selfClose), selfClose ? null : t.jsxClosingElement(t.cloneNode(nm)), children, selfClose);
        }
        p.replaceWith(el);
      },
    },
  });
}

function stripPure(file) {
  traverse(file, { enter(p) { for (const k of ["leadingComments", "trailingComments", "innerComments"]) if (p.node[k]) p.node[k] = p.node[k].filter((c) => !PURE.test(c.value)); } });
}

// local variables renamed by rollup to avoid a top-level name (text -> text2, r2 -> r22): restore when safe
function restoreLocals(file) {
  traverse(file, {
    Scopable(p) {
      if (p.isProgram()) return;
      for (const [name, b] of Object.entries(p.scope.bindings)) {
        if (b.scope !== p.scope || !/\d$/.test(name)) continue;
        const base = name.slice(0, -1);
        if (!topNames.has(base) && !externals.has(base)) continue;
        if (!t.isValidIdentifier(base) || p.scope.hasBinding(base, true) || p.scope.getProgramParent().globals[base]) continue;
        let clash = false;
        b.scope.path.traverse({ Identifier(q) { if (q.node.name === base && (q.isReferencedIdentifier() || q.isBindingIdentifier())) { clash = true; q.stop(); } } });
        if (b.scope.path.node.id?.name === base) clash = true;
        if (clash) continue;
        b.scope.rename(name, base);
        report.renamedLocal++;
      }
    },
  });
  // { text: text } -> { text }
  traverse(file, { ObjectProperty(p) { const n = p.node; if (!n.computed && t.isIdentifier(n.key) && t.isIdentifier(n.value) && n.key.name === n.value.name) n.shorthand = true; } });
}

// ---------- 6. build each module ----------
const rel = (fromFile, toFile) => { let r = path.posix.relative(path.posix.dirname(fromFile), toFile); if (!r.startsWith(".")) r = "./" + r; return r.replace(/\.jsx?$/, ""); };
const cleanAsset = (f) => f.replace(/-[A-Za-z0-9_-]{8}(\.\w+)$/, "$1");
const assetTarget = (local, f) => (local.startsWith("__vite_glob_") ? `${cfg.srcRoot}/assets/recon-figures/${cleanAsset(f)}` : `${cfg.srcRoot}/assets/${cleanAsset(f)}`);
const legal = (id) => id.replace(/^node:/, "node_").replace(/-(\w)/g, (_, c) => c.toUpperCase()).replace(/[^\w$]/g, "_");

// pass 1: statements, exports, rename own $N declarations
const publicName = new Map();
for (const m of mods) {
  const file = t.file(t.program([]));
  file.program.body = m.stmts.map((i) => {
    const s = t.cloneNode(ast.program.body[i], true, false);
    for (const c of s.leadingComments || []) report.comments.before += PURE.test(c.value) ? 0 : 1;
    return s;
  });
  m.declared = new Set(m.stmts.flatMap((i) => Object.keys(t.getBindingIdentifiers(ast.program.body[i], false, true))).filter((n) => declMod.get(n) === m));
  // rename before adding export keywords: Babel's renamer would otherwise keep the old export name
  const pp = progOf(file);
  for (const d of m.declared) {
    if (strip(d) !== d && safeRename(pp, d, strip(d))) { publicName.set(d, strip(d)); report.renamedTop++; } else publicName.set(d, d);
  }
  const expFinal = new Set([...m.exports].map((n) => publicName.get(n)));
  file.program.body = file.program.body.map((s) => {
    const names = Object.keys(t.getBindingIdentifiers(s, false, true));
    if (!names.some((n) => expFinal.has(n))) return s;
    if (!(t.isFunctionDeclaration(s) || t.isClassDeclaration(s) || t.isVariableDeclaration(s))) { report.warnings.push(`${m.path}: cannot export from ${s.type} (${names})`); return s; }
    const e = t.exportNamedDeclaration(s, []);
    e.leadingComments = s.leadingComments; s.leadingComments = null;
    return e;
  });
  m.file = file;
}
for (const [, ns] of nsInfo) if (ns.target !== ns.host || ns.host.reexports.size === 0) {
  const al = ns.members.filter(([k, v]) => publicName.get(v) !== k);
  if (al.length) ns.target.file.program.body.push(t.exportNamedDeclaration(null, al.map(([k, v]) => t.exportSpecifier(t.identifier(publicName.get(v)), t.identifier(k)))));
}
for (const m of mods) for (const [o, list] of m.reexports)
  m.file.program.body.push(t.exportNamedDeclaration(null, list.map(([k, v]) => t.exportSpecifier(t.identifier(publicName.get(v)), t.identifier(k))), t.stringLiteral(rel(m.path, o.path))));

// pass 2: imports, JSX, external namespaces, cleanup, print
const fileText = new Map();
for (const m of mods) {
  const file = m.file;
  const byMod = new Map();
  for (const [name, dm] of m.imports) { if (!byMod.has(dm)) byMod.set(dm, []); byMod.get(dm).push(name); }
  const imports = [];
  for (const [dm, names] of [...byMod].sort((a, b) => a[0].j - b[0].j))
    imports.push(t.importDeclaration(names.sort().map((n) => t.importSpecifier(t.identifier(n), t.identifier(publicName.get(n)))), t.stringLiteral(rel(m.path, dm.path))));
  for (const a of [...m.assetUse].sort()) if (!a.startsWith("__vite_glob_")) imports.push(t.importDeclaration([t.importDefaultSpecifier(t.identifier(a))], t.stringLiteral(rel(m.path, assetTarget(a, assets.get(a))))));
  file.program.body.unshift(...imports);
  let pp = progOf(file);
  pp.scope.crawl();
  for (const [n] of m.imports) safeRename(pp, n, publicName.get(n));
  for (const a of m.assetUse) if (!a.startsWith("__vite_glob_")) safeRename(pp, a, strip(a));

  // vite glob -> import.meta.glob
  traverse(file, { CallExpression(p) {
    const n = p.node;
    if (t.isMemberExpression(n.callee) && t.isIdentifier(n.callee.object, { name: "Object" }) && t.isIdentifier(n.callee.property, { name: "assign" }) && n.arguments.length === 1 && t.isObjectExpression(n.arguments[0]) && n.arguments[0].properties.some((q) => t.isIdentifier(q.value) && q.value.name.startsWith("__vite_glob_"))) {
      const keys = n.arguments[0].properties.map((q) => q.key.value);
      const want = rel(m.path, `${cfg.srcRoot}/assets/recon-figures/x.png`).replace(/\/x\.png$/, "");
      if (path.posix.dirname(keys[0]) !== want) report.warnings.push(`${m.path}: glob dir ${path.posix.dirname(keys[0])} but assets resolve to ${want}`);
      p.replaceWith(t.callExpression(t.memberExpression(t.metaProperty(t.identifier("import"), t.identifier("meta")), t.identifier("glob")), [t.stringLiteral(`${want}/*.png`), t.objectExpression([t.objectProperty(t.identifier("eager"), t.booleanLiteral(true)), t.objectProperty(t.identifier("import"), t.stringLiteral("default"))])]));
    }
  } });

  traverse(file, { CallExpression(p) {
    const n = p.node;
    if (t.isMemberExpression(n.callee) && t.isIdentifier(n.callee.property, { name: "then" }) && t.isCallExpression(n.callee.object) && t.isMemberExpression(n.callee.object.callee) && t.isIdentifier(n.callee.object.callee.object, { name: "Promise" }) && n.arguments.length === 1 && t.isArrowFunctionExpression(n.arguments[0]) && t.isIdentifier(n.arguments[0].body) && nsInfo.has(n.arguments[0].body.name) && !p.scope.hasBinding(n.arguments[0].body.name)) {
      p.replaceWith(t.importExpression(t.stringLiteral(rel(m.path, nsInfo.get(n.arguments[0].body.name).target.path))));
    }
  } });
  // a namespace object used as a value: static namespace import
  const nsLeft = new Set();
  traverse(file, { Identifier(p) { if (nsInfo.has(p.node.name) && p.isReferencedIdentifier() && !p.scope.hasBinding(p.node.name)) nsLeft.add(p.node.name); } });
  for (const n of nsLeft) {
    file.program.body.unshift(t.importDeclaration([t.importNamespaceSpecifier(t.identifier(n))], t.stringLiteral(rel(m.path, nsInfo.get(n).target.path))));
    const pq = progOf(file); pq.scope.crawl(); safeRename(pq, n, strip(n));
  }
  if (m.lucideUse.size) {
    const pq = progOf(file); pq.scope.crawl();
    const specs = [];
    for (const n of [...m.lucideUse].sort()) {
      const base = strip(n);
      const local = safeRename(pq, n, base) ? base : safeRename(pq, n, base + "Icon") ? base + "Icon" : null;
      if (!local) { report.warnings.push(`${m.path}: could not name icon ${n}`); continue; }
      specs.push(t.importSpecifier(t.identifier(local), t.identifier(local)));
    }
    file.program.body.unshift(t.importDeclaration(specs, t.stringLiteral("lucide-react")));
  }
  const flags = { fragment: false };
  if (REN) convertJsx(file, flags);
  stripPure(file);

  // external / vendor namespaces -> named imports where nothing collides
  pp = progOf(file); pp.scope.crawl();
  const names = new Set();
  traverse(file, { Scopable(p) { for (const n of Object.keys(p.scope.bindings)) names.add(n); } });
  for (const n of Object.keys(pp.scope.globals)) names.add(n);
  const nsList = REN
    ? [["reactExports", "react"], ["React", "react"], ["clientExports", "react-dom/client"], ["reactDomExports", "react-dom"], ["jsxRuntimeExports", "react/jsx-runtime"]]
    : [...externals.keys()].filter((n) => m.ext.has(n)).map((n) => [n, externals.get(n)]);
  const named = new Map(); // src -> Set(names)
  const head = [];
  let needReactDefault = false;
  const addNamed = (src, k) => { if (!named.has(src)) named.set(src, new Set()); named.get(src).add(k); };
  for (const [ns, src] of nsList) {
    const members = new Map();
    let onlyMembers = true, used = false;
    traverse(file, { Identifier(p) {
      if (p.node.name !== ns || !p.isReferencedIdentifier() || p.scope.hasBinding(ns, true)) return;
      used = true;
      const par = p.parentPath;
      if (par.isMemberExpression() && par.node.object === p.node && !par.node.computed) { const k = par.node.property.name; if (!members.has(k)) members.set(k, []); members.get(k).push(par); }
      else onlyMembers = false;
    } });
    if (!used) continue;
    const wantsNamed = REN || legal(src) === ns;
    const collide = [...members.keys()].some((k) => names.has(k) || k === "default");
    if (wantsNamed && onlyMembers && !collide) {
      for (const [k, ps] of members) { for (const q of ps) q.replaceWith(t.identifier(k)); addNamed(src, k); names.add(k); }
    } else if (REN) {
      // keep as React.x (default import) / namespace for the rest
      if (src === "react") { traverse(file, { Identifier(p) { if (p.node.name === ns && !p.scope.hasBinding(ns, true)) p.node.name = "React"; } }); needReactDefault = true; }
      else { const alias = ns === "clientExports" ? "ReactDOMClient" : ns === "reactDomExports" ? "ReactDOM" : "jsxRuntime"; traverse(file, { Identifier(p) { if (p.node.name === ns && !p.scope.hasBinding(ns, true)) p.node.name = alias; } }); head.push(t.importDeclaration([t.importNamespaceSpecifier(t.identifier(alias))], t.stringLiteral(src))); }
      report.warnings.push(`${m.path}: kept namespace for ${src}`);
    } else if (wantsNamed) head.push(t.importDeclaration([t.importNamespaceSpecifier(t.identifier(ns))], t.stringLiteral(src)));
    else head.push(t.importDeclaration([t.importDefaultSpecifier(t.identifier(ns))], t.stringLiteral(src)));
  }
  if (flags.fragment) addNamed("react", "Fragment");
  for (const [src, ks] of named) {
    const specs = [...ks].sort().map((k) => t.importSpecifier(t.identifier(k), t.identifier(k)));
    if (src === "react" && needReactDefault) { specs.unshift(t.importDefaultSpecifier(t.identifier("React"))); needReactDefault = false; }
    head.push(t.importDeclaration(specs, t.stringLiteral(src)));
  }
  if (needReactDefault) head.push(t.importDeclaration([t.importDefaultSpecifier(t.identifier("React"))], t.stringLiteral("react")));
  file.program.body.unshift(...head);

  restoreLocals(file);
  traverse(file, { enter(p) { for (const k of ["leadingComments", "trailingComments", "innerComments"]) report.comments.after += (p.node[k] || []).filter((c) => !PURE.test(c.value)).length; } });

  const isImp = (s) => t.isImportDeclaration(s);
  const g = (body) => generate(t.file(t.program(body)), { comments: true, jsescOption: { minimal: true } }).code;
  let out = g(file.program.body.filter(isImp)) + "\n\n" + g(file.program.body.filter((s) => !isImp(s)));
  try {
    out = await prettier.format(out, { parser: "babel", printWidth: 140, trailingComma: "all", objectWrap: "collapse" });
  } catch (e) { report.warnings.push(`${m.path}: prettier failed: ${String(e.message).slice(0, 300)}`); }
  fileText.set(m.path, out);
}

// ---------- 7. write ----------
for (const [p, txt] of fileText) {
  if (!txt.trim()) { report.warnings.push(`${p}: empty, not written`); continue; }
  const full = path.join(cfg.outRoot, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, txt);
}
if (REN) for (const [local, f] of assets) {
  const dst = path.join(cfg.outRoot, assetTarget(local, f));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(path.dirname(cfg.bundle), f), dst);
}
fs.writeFileSync(cfg.report, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ files: fileText.size, fwdTop: report.forwardImports.filter((f) => f.top).length, fwd: report.forwardImports.length, crossWrites: report.crossWrites.length, jsxFallbacks: report.jsxFallbacks, renamedTop: report.renamedTop, renamedLocal: report.renamedLocal, comments: report.comments, lostComments: report.lostComments || 0, warnings: report.warnings.length }));
