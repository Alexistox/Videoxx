import { updateIssues } from "../projects/issues";
import { notifyStudio, readVersions, requireStudio, studioOf } from "./stages";
import { clip, newVersion } from "./versions";

const runs = new Map();
export function noteRun(projectId, o) {
  runs.set(projectId, o);
  if (o.fix && o.issues?.length) {
    const { dir } = requireStudio(projectId);
    updateIssues(dir, (i) => (o.issues.includes(i.id) && (i.status === "open" || i.status === "reopened") ? { status: "fixing" } : null));
    notifyStudio(projectId);
  }
}
export function forgetRun(projectId) {
  runs.delete(projectId);
  try {
    updateIssues(requireStudio(projectId).dir, (i) => (i.status === "fixing" ? { status: "open" } : null));
    notifyStudio(projectId);
  } catch {}
}
export async function afterTurn(projectId, ev) {
  let w = null;
  try {
    w = studioOf(projectId);
  } catch {
    return null;
  }
  if (!w) return null;
  const run = runs.get(projectId);
  runs.delete(projectId);
  const changed = (ev.files ?? [])
    .map((f) => String(f?.file ?? ""))
    .filter((f) => f && f !== "project.json" && f !== "CLAUDE.md" && !f.startsWith(".claude/"));
  const lookChanged = w.studio.mode === "look" && (w.studio.look?.at ?? null) !== (readVersions(w.dir).slice(-1)[0]?.lookAt ?? null);
  try {
    if (!changed.length && !lookChanged) return null;
    const label = run?.fix
      ? `Fix round (${run.issues?.length ? `${run.issues.length} issue${run.issues.length === 1 ? "" : "s"}` : "all open"})`
      : clip(ev.edit?.instruction, 80) || "Claude turn";
    return await newVersion(projectId, label, { mp4: !!run?.fix, reason: run?.fix ? "fix" : "turn" });
  } finally {
    try {
      updateIssues(w.dir, (i) => (i.status === "fixing" ? { status: "open" } : null));
    } catch {}
    notifyStudio(projectId);
  }
}
