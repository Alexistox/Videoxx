// Merge per-chunk partitions into one module list per bundle, snapped to statement starts.
// usage: node merge.mjs <workflow-output.json> <outDir>
import fs from "node:fs";
const [inFile, outDir] = process.argv.slice(2);
const res = JSON.parse(fs.readFileSync(inFile, "utf8")).result;
for (const b of res) {
  const stmts = JSON.parse(fs.readFileSync(`${outDir}/${b.key === "main" ? "main" : "ren"}.json`, "utf8"));
  const starts = new Set(stmts.map((s) => s.start));
  const parts = b.parts.filter(Boolean).sort((x, y) => x.chunk.start - y.chunk.start);
  const mods = [];
  for (const p of parts) {
    p.modules.sort((x, y) => x.start_line - y.start_line);
    p.modules.forEach((m, k) => {
      if (k === 0 && p.continues_previous && mods.length) return; // tail of previous module
      if (!starts.has(m.start_line)) {
        const snap = stmts.find((s) => s.start <= m.start_line && s.end >= m.start_line) || stmts.find((s) => s.start > m.start_line);
        console.log(`${b.key}: snapped L${m.start_line} -> L${snap.start} (${m.path})`);
        m.start_line = snap.start;
      }
      mods.push({ start_line: m.start_line, path: m.path, summary: m.summary });
    });
  }
  // contiguous same path -> merge; non-contiguous repeats -> suffix
  const out = [];
  for (const m of mods) {
    if (out.length && out.at(-1).path === m.path) continue;
    if (out.length && out.at(-1).start_line === m.start_line) { console.log(`${b.key}: duplicate start L${m.start_line}: ${out.at(-1).path} / ${m.path}`); out.pop(); }
    out.push(m);
  }
  const seen = new Map();
  for (const m of out) {
    const n = (seen.get(m.path) || 0) + 1; seen.set(m.path, n);
    if (n > 1) { const np = m.path.replace(/(\.\w+)$/, `${n}$1`); console.log(`${b.key}: repeated path ${m.path} -> ${np}`); m.path = np; }
  }
  fs.writeFileSync(`${outDir}/${b.key}-modules.json`, JSON.stringify(out, null, 1));
  fs.writeFileSync(`${outDir}/${b.key}-layout.txt`, b.layout);
  console.log(`${b.key}: ${out.length} modules`);
}
