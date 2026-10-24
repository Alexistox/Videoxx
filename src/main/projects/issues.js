import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { uid } from "../db/db";

const ISSUE_STATUS = ["open", "fixing", "verify", "fixed", "wontfix", "reopened"];
const ISSUE_SEVERITY = ["high", "medium", "low"];
const OPEN = new Set(["open", "fixing", "reopened"]);
export const isOpen = (i) => OPEN.has(i.status);
export const issuesFile = (dir) => path.join(dir, ".suite", "studio", "issues.json");
export function readIssues(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(issuesFile(dir), "utf8"));
    return Array.isArray(j?.issues) ? j.issues : [];
  } catch {
    return [];
  }
}
let written = () => {};
export const onIssuesWritten = (f) => {
  written = f;
};
const notifyWritten = (dir) => {
  try {
    written(dir);
  } catch {}
};
function writeIssues(dir, issues) {
  const f = issuesFile(dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ issues }, null, 1));
  fs.renameSync(tmp, f);
  notifyWritten(dir);
}
const clip$c = (s, n) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
function issueKey(x) {
  const w = x.where ?? {};
  const parts =
    x.source === "check"
      ? ["check", x.check ?? "", w.element || clip$c(x.title, 120).toLowerCase(), w.file ?? "", w.aspect ?? ""]
      : x.source === "critic"
        ? ["critic", w.view ?? "", w.aspect ?? "", clip$c(x.title, 120).toLowerCase()]
        : [x.source, x.check ?? "", w.view ?? "", w.aspect ?? "", w.element || clip$c(x.title, 120).toLowerCase()];
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}
function cleanWhere(w) {
  if (!w || typeof w !== "object") return {};
  const rect = Array.isArray(w.rect) && w.rect.length === 4 && w.rect.every((v) => typeof v === "number" && isFinite(v)) ? w.rect : null;
  return {
    view: w.view != null ? clip$c(w.view, 40) : null,
    aspect: w.aspect === "9:16" || w.aspect === "16:9" ? w.aspect : null,
    t: num(w.t),
    shot: num(w.shot),
    file: w.file != null ? clip$c(w.file, 200) : null,
    line: num(w.line),
    rect,
    element: w.element != null ? clip$c(w.element, 120) : null,
  };
}
function merge(issues, x, at) {
  const title = clip$c(x.title, 200);
  if (!title) throw new Error("An issue needs a title.");
  const where = cleanWhere(x.where),
    check = x.check ? clip$c(x.check, 40) : null;
  const key2 = issueKey({ source: x.source, check, where, title });
  const same = issues.find((i) => i.key === key2);
  if (same) {
    if (!isOpen(same) && same.status !== "wontfix") {
      same.status = "reopened";
      same.fixedIn = null;
    }
    same.updatedAt = at;
    same.round = x.round ?? same.round;
    if (x.source === "check") {
      same.where = where;
      same.title = title;
      if (x.thumb !== void 0) same.thumb = x.thumb ?? same.thumb;
      if (x.severity) same.severity = x.severity;
    }
    if (x.meaning) same.meaning = clip$c(x.meaning, 1e3);
    if (x.fix) same.fix = clip$c(x.fix, 1e3);
    return { issue: same, added: false };
  }
  const issue = {
    id: uid("iss_"),
    key: key2,
    round: Math.max(1, Math.round(x.round ?? 1)),
    status: "open",
    severity: ISSUE_SEVERITY.includes(x.severity) ? x.severity : "medium",
    source: x.source,
    check,
    where,
    thumb: x.thumb ?? null,
    title,
    meaning: clip$c(x.meaning, 1e3),
    fix: clip$c(x.fix, 1e3),
    fixedIn: null,
    lesson: null,
    createdAt: at,
    updatedAt: at,
  };
  issues.push(issue);
  return { issue, added: true };
}
export function addIssue(dir, x) {
  const issues = readIssues(dir),
    r = merge(issues, x, new Date().toISOString());
  writeIssues(dir, issues);
  return r;
}
export function applyCheckRun(dir, found, covers, version) {
  const issues = readIssues(dir),
    at = new Date().toISOString(),
    seen = new Set();
  let opened = 0,
    reopened = 0,
    closed = 0;
  for (const x of found) {
    const key2 = issueKey({
      source: x.source,
      check: x.check ? clip$c(x.check, 40) : null,
      where: cleanWhere(x.where),
      title: clip$c(x.title, 200),
    });
    if (seen.has(key2)) continue;
    const before = issues.find((i) => i.key === key2);
    const wasOpen = before ? isOpen(before) : false;
    const r = merge(issues, x, at);
    seen.add(r.issue.key);
    if (r.added) opened++;
    else if (!wasOpen && r.issue.status === "reopened") reopened++;
  }
  for (const i of issues)
    if (i.source === "check" && !seen.has(i.key) && (isOpen(i) || i.status === "verify") && covers(i)) {
      i.status = "fixed";
      i.fixedIn = version;
      i.updatedAt = at;
      closed++;
    }
  writeIssues(dir, issues);
  return { opened, reopened, closed, seen: seen.size };
}
export function updateIssue(dir, id, patch) {
  const issues = readIssues(dir),
    i = issues.find((x) => x.id === id);
  if (!i) throw new Error(`There is no issue ${clip$c(id, 40)}.`);
  if (patch.status !== void 0) {
    if (!ISSUE_STATUS.includes(patch.status)) throw new Error("Unknown issue status.");
    i.status = patch.status;
  }
  if (patch.severity !== void 0) {
    if (!ISSUE_SEVERITY.includes(patch.severity)) throw new Error("Unknown severity.");
    i.severity = patch.severity;
  }
  if (patch.lesson !== void 0) i.lesson = patch.lesson ? clip$c(patch.lesson, 1e3) : null;
  if (patch.fixedIn !== void 0) i.fixedIn = patch.fixedIn ? clip$c(patch.fixedIn, 60) : null;
  i.updatedAt = new Date().toISOString();
  writeIssues(dir, issues);
  return i;
}
export function updateIssues(dir, pick) {
  const issues = readIssues(dir),
    at = new Date().toISOString();
  let n = 0;
  for (const i of issues) {
    const p = pick(i);
    if (!p) continue;
    Object.assign(i, p);
    i.updatedAt = at;
    n++;
  }
  if (n) writeIssues(dir, issues);
  return n;
}
export function issueSummary(dir) {
  const all = readIssues(dir),
    open = all.filter(isOpen);
  return {
    total: all.length,
    open: open.length,
    openHigh: open.filter((i) => i.severity === "high").length,
    openMedium: open.filter((i) => i.severity === "medium").length,
    verify: all.filter((i) => i.status === "verify").length,
    fixed: all.filter((i) => i.status === "fixed").length,
  };
}
const pitfallsFile = (dir) => path.join(dir, ".suite", "studio", "pitfalls.jsonl");
export function readLessons(dir) {
  let t = "";
  try {
    t = fs.readFileSync(pitfallsFile(dir), "utf8");
  } catch {
    return [];
  }
  const out = new Map();
  for (const line of t.split("\n")) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line);
      if (l?.lesson && l?.issue) out.set(l.issue, l);
    } catch {}
  }
  return [...out.values()];
}
export function recordLesson(dir, styleName, i, lesson, version) {
  const l = {
    at: new Date().toISOString(),
    issue: i.id,
    check: i.check,
    finding: i.title,
    meaning: i.meaning,
    fix: i.fix,
    lesson: clip$c(lesson, 1e3),
    version,
  };
  fs.mkdirSync(path.dirname(pitfallsFile(dir)), { recursive: true });
  fs.appendFileSync(pitfallsFile(dir), JSON.stringify(l) + "\n");
  writePitfalls(dir, styleName);
  notifyWritten(dir);
}
export function writePitfalls(dir, styleName) {
  const ls = readLessons(dir).sort((a, b) => a.at.localeCompare(b.at));
  const one = (s) => s.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const lines = ls.map(
    (l) =>
      `- **${one(l.finding)}** -> ${one(l.meaning || "it breaks the style")} -> ${one(l.lesson)}.${l.fix && one(l.fix) !== one(l.lesson) ? ` (The fix then: ${one(l.fix)}.)` : ""}`,
  );
  const text = `# ${styleName} - pitfalls

Written by the app (never by hand): every fixed issue's lesson lands here, one line each, so a fault caught once is
never made again in this style. Read it before every stage and every video in the style. Each line: finding -> what it
means -> what to do instead.

${lines.length ? lines.join("\n") : "(No lessons yet.)"}
`;
  const f = path.join(dir, "skill", "PITFALLS.md");
  let has = "";
  try {
    has = fs.readFileSync(f, "utf8");
  } catch {}
  if (has !== text) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return ls.length;
}
