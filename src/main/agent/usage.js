import path from "node:path";
import fs from "node:fs";
import { getConfig, setConfig } from "../core/config";
import { ws } from "../core/workspace";
import { q, uid } from "../db/db";

const std = (input, output) => ({ input, output, cacheRead: +(input * 0.1).toFixed(4), cacheWrite: +(input * 1.25).toFixed(4) });
const PRICES = [
  { match: /fable-5-1/, label: "Fable 5.1", family: "fable", verified: true, input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  { match: /mythos-5-1/, label: "Mythos 5.1", family: "fable", verified: true, input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  { match: /fable-5(?!-\d)/, label: "Fable 5", family: "fable", verified: true, input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  { match: /opus-5-5/, label: "Opus 5.5", family: "opus", verified: true, input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { match: /opus-5(?!-\d)/, label: "Opus 5", family: "opus", verified: true, derived: true, ...std(5, 25) },
  { match: /opus-4-8/, label: "Opus 4.8", family: "opus", verified: true, derived: true, ...std(5, 25) },
  { match: /opus-4-7/, label: "Opus 4.7", family: "opus", verified: true, derived: true, ...std(5, 25) },
  { match: /opus-4-6/, label: "Opus 4.6", family: "opus", verified: true, derived: true, ...std(5, 25) },
  { match: /opus-4-5/, label: "Opus 4.5", family: "opus", verified: false, ...std(5, 25) },
  { match: /opus-4(-1)?(?!-\d)|opus-4-1/, label: "Opus 4.1", family: "opus", verified: false, ...std(15, 75) },
  { match: /sonnet-5-5/, label: "Sonnet 5.5", family: "sonnet", verified: true, input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { match: /sonnet-5(?!-\d)/, label: "Sonnet 5", family: "sonnet", verified: true, derived: true, ...std(2, 10) },
  { match: /sonnet-4-6/, label: "Sonnet 4.6", family: "sonnet", verified: true, derived: true, ...std(3, 15) },
  { match: /sonnet-4(-5)?(?!-\d)|sonnet-4-5/, label: "Sonnet 4.5", family: "sonnet", verified: false, ...std(3, 15) },
  {
    match: /haiku-5-5/,
    label: "Haiku 5.5",
    family: "haiku",
    verified: true,
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    note: "prompts over 100K tokens cost $0.50 / $2.50; priced here at the short-prompt rate",
  },
  { match: /haiku-4-5/, label: "Haiku 4.5", family: "haiku", verified: true, derived: true, ...std(1, 5) },
];
function priceOf(model) {
  const m = String(model ?? "").toLowerCase();
  if (!m) return null;
  const hit = PRICES.find((p) => p.match.test(m));
  if (hit) return hit;
  const fam = /opus/.test(m)
    ? "Opus 5.5"
    : /sonnet/.test(m)
      ? "Sonnet 5.5"
      : /haiku/.test(m)
        ? "Haiku 5.5"
        : /fable|mythos/.test(m)
          ? "Fable 5.1"
          : null;
  return fam ? (PRICES.find((p) => p.label === fam) ?? null) : null;
}
function costOf(model, t) {
  const p = priceOf(model);
  if (!p) return null;
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1e6;
}
const PLANS = [
  { id: "pro", label: "Pro", price: 20 },
  { id: "max5", label: "Max 5x", price: 100 },
  { id: "max20", label: "Max 20x", price: 200 },
  { id: "team", label: "Team", price: 30 },
  { id: "other", label: "Other", price: null },
];
const planPrice = (kind, custom) =>
  kind === "other"
    ? custom != null && isFinite(+custom) && +custom >= 0
      ? +custom
      : null
    : (PLANS.find((p) => p.id === kind)?.price ?? null);
let testFromRowid = 0;
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function usagePlan() {
  const p = getConfig().claudePlan ?? {};
  const kind = PLANS.some((x) => x.id === p.kind) ? p.kind : null;
  const custom = p.custom != null && isFinite(+p.custom) ? +p.custom : null;
  return {
    kind,
    custom,
    price: planPrice(kind, custom),
    detected: typeof p.detected === "string" ? p.detected : null,
    hide: !kind && p.hide === true,
  };
}
export function setUsagePlan(kind, custom) {
  const prev = getConfig().claudePlan ?? {};
  const k = PLANS.some((x) => x.id === kind) ? kind : null;
  const c = custom != null && isFinite(+custom) && +custom >= 0 ? Math.min(1e5, +custom) : null;
  setConfig({ claudePlan: { ...prev, kind: k, custom: k === "other" ? c : (prev.custom ?? null), hide: kind === "hide" } });
  return usagePlan();
}
export function noteSubscription(type) {
  const t = typeof type === "string" ? type.trim().toLowerCase().slice(0, 40) : "";
  if (!t || getConfig().claudePlan?.detected === t) return;
  setConfig({ claudePlan: { ...getConfig().claudePlan, detected: t } });
}
export function usageSummary() {
  const rows = [],
    unknown = new Set();
  const turns = q.all(
    `SELECT date(t.at,'localtime') d, t.model, e.project_id p, SUM(t.input) i, SUM(t.cache_read) cr, SUM(t.cache_write) cw, SUM(t.output) o,
      COUNT(DISTINCT t.edit_id) runs FROM claude_turns t JOIN edits e ON e.id=t.edit_id WHERE e.rowid>=? AND COALESCE(e.engine,'claude')='claude' GROUP BY d, t.model, e.project_id`,
    testFromRowid,
  );
  for (const r of turns) {
    const t = { input: +r.i || 0, cacheRead: +r.cr || 0, cacheWrite: +r.cw || 0, output: +r.o || 0 };
    const pe = priceOf(r.model),
      cost = costOf(r.model, t);
    if (!pe && r.model) unknown.add(String(r.model));
    rows.push({
      d: r.d,
      model: r.model ?? null,
      label: pe?.label ?? (r.model ? String(r.model) : "Unknown model"),
      family: pe?.family ?? "other",
      projectId: r.p,
      ...t,
      runs: +r.runs || 0,
      cost,
      estimated: !pe,
    });
  }
  const old = q.all(
    `SELECT date(e.created_at,'localtime') d, e.project_id p, SUM(COALESCE(e.tokens_in,0)) i, SUM(COALESCE(e.tokens_out,0)) o,
      SUM(CASE WHEN e.cost_usd>0 THEN e.cost_usd ELSE 0 END) c, SUM(e.cost_usd>0) priced, COUNT(*) runs FROM edits e
      WHERE e.rowid>=? AND COALESCE(e.engine,'claude')='claude' AND (COALESCE(e.tokens_in,0)>0 OR COALESCE(e.tokens_out,0)>0) AND NOT EXISTS (SELECT 1 FROM claude_turns t WHERE t.edit_id=e.id)
      GROUP BY d, e.project_id`,
    testFromRowid,
  );
  let unpriced = 0;
  for (const r of old) {
    unpriced += (+r.runs || 0) - (+r.priced || 0);
    rows.push({
      d: r.d,
      model: null,
      label: "Earlier runs",
      family: "other",
      projectId: r.p,
      input: +r.i || 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: +r.o || 0,
      runs: +r.runs || 0,
      cost: +r.priced ? +r.c || 0 : null,
      estimated: true,
    });
  }
  const ids = [...new Set(rows.map((r) => r.projectId))];
  const projects = {};
  for (const id of ids) {
    const p = q.get("SELECT name, style_id, kind FROM projects WHERE id=?", id);
    projects[id] = { name: p?.name ?? "Removed project", style: p ? (p.kind === "personal" ? "personal" : (p.style_id ?? null)) : null };
  }
  const firstDay = rows.reduce((a, r) => (!a || r.d < a ? r.d : a), null);
  const harvest = { runs: 0, tokens: 0, cost: 0 },
    hruns = new Set();
  for (const r of q.all(
    `SELECT t.edit_id e, t.model, t.input i, t.cache_read cr, t.cache_write cw, t.output o FROM claude_turns t JOIN edits e ON e.id=t.edit_id WHERE e.rowid>=? AND e.kind='harvest'`,
    testFromRowid,
  )) {
    const t = { input: +r.i || 0, cacheRead: +r.cr || 0, cacheWrite: +r.cw || 0, output: +r.o || 0 };
    hruns.add(r.e);
    harvest.tokens += t.input + t.cacheRead + t.cacheWrite + t.output;
    harvest.cost += costOf(r.model, t) ?? 0;
  }
  harvest.runs = hruns.size;
  harvest.cost = +harvest.cost.toFixed(4);
  return { rows, projects, firstDay, today: localDay(), plan: usagePlan(), unpricedRuns: unpriced, unknownModels: [...unknown], harvest };
}
export function testUsage(mode, seed) {
  const maxRow = () => +(q.get("SELECT COALESCE(MAX(rowid),0) m FROM edits")?.m ?? 0);
  if (mode === "clear") {
    q.run("DELETE FROM edits WHERE id LIKE 'usagetest-%'");
    for (const p of q.all("SELECT id, path FROM projects WHERE id LIKE 'usagetest-%'")) {
      q.run("DELETE FROM projects WHERE id=?", p.id);
      try {
        fs.rmSync(p.path, { recursive: true, force: true });
      } catch {}
    }
    testFromRowid = 0;
    return true;
  }
  testFromRowid = maxRow() + 1;
  if (mode === "empty" || !seed) return true;
  const pids = [];
  seed.projects.forEach((name, i) => {
    const id = `usagetest-${uid("p")}`,
      dir = path.join(ws.projects(), `zz-usage-${Date.now()}-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ title: name, style: "pixel-art", scenes: [], settings: {} }));
    q.run(
      "INSERT INTO projects(id,name,slug,path,preset_id,style_id,kind,status,created_at,updated_at,opened_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id,
      name,
      `zz-usage-${i}`,
      dir,
      null,
      i ? "collage" : "pixel-art",
      "faceless",
      "draft",
      "2020-01-01T00:00:00.000Z",
      "2020-01-01T00:00:00.000Z",
      "2020-01-01T00:00:00.000Z",
    );
    pids.push(id);
  });
  const dayAt = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };
  seed.turns.forEach((s, i) => {
    const id = `usagetest-${uid("e")}`,
      at = dayAt(s.daysAgo);
    q.run(
      "INSERT INTO edits(id,project_id,instruction,status,created_at,finished_at) VALUES(?,?,?,?,?,?)",
      id,
      pids[s.project],
      "usage test",
      "done",
      at,
      at,
    );
    q.run(
      "INSERT INTO claude_turns(edit_id,n,at,model,input,cache_read,cache_write,output) VALUES(?,?,?,?,?,?,?,?)",
      id,
      1,
      at,
      s.model,
      s.input,
      s.cacheRead,
      s.cacheWrite,
      s.output,
    );
  });
  (seed.legacy ?? []).forEach((s) => {
    const at = dayAt(s.daysAgo);
    q.run(
      "INSERT INTO edits(id,project_id,instruction,status,created_at,finished_at,tokens_in,tokens_out,cost_usd) VALUES(?,?,?,?,?,?,?,?,?)",
      `usagetest-${uid("e")}`,
      pids[s.project],
      "usage test (older)",
      "done",
      at,
      at,
      s.tin,
      s.tout,
      s.cost,
    );
  });
  return pids;
}
