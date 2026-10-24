import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import { getConfig } from "./config";
import { isMacStub } from "./install";

const IGNORE = `# Videoxx: generated / heavy files stay out of history
out/
.suite/
node_modules/
*.h264
audio/*.wav
audio/*.incoming
!audio/beds.json
.claude/skills/
`;
export function ensureIgnore(dir) {
  const gi = path.join(dir, ".gitignore");
  const have = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const lines = new Set(have.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORE.split("\n").filter((l) => l.trim() && !lines.has(l.trim()));
  if (!have) fs.writeFileSync(gi, IGNORE);
  else if (missing.length)
    fs.appendFileSync(
      gi,
      `${have.endsWith("\n") ? "" : "\n"}${missing.join("\n")}
`,
    );
}
function git(cwd, args, allowFail = false) {
  return new Promise((res, rej) => {
    cp.execFile(
      getConfig().tools.git,
      args,
      {
        cwd,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Videoxx",
          GIT_AUTHOR_EMAIL: "suite@videoxx.local",
          GIT_COMMITTER_NAME: "Videoxx",
          GIT_COMMITTER_EMAIL: "suite@videoxx.local",
        },
      },
      (err, stdout, stderr) =>
        err && !allowFail ? rej(new Error(`git ${args[0]}: ${stderr || err.message}`)) : res(String(stdout).trim()),
    );
  });
}
let available = null;
export async function gitAvailable() {
  if (available === null)
    available = isMacStub(getConfig().tools.git)
      ? false
      : await git(process.cwd(), ["--version"]).then(
          () => true,
          () => false,
        );
  return available;
}
export function forgetGit() {
  available = null;
}
export async function ensureRepo(dir) {
  if (!(await gitAvailable())) return false;
  ensureIgnore(dir);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    await git(dir, ["init", "-q"]);
    await git(dir, ["config", "core.autocrlf", "false"]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "Project created", "--allow-empty"]);
  }
  return true;
}
export async function snapshot(dir, message) {
  if (!(await ensureRepo(dir))) return null;
  try {
    const f = path.join(dir, "project.json"),
      b = fs.readFileSync(f);
    if (b[0] === 239 && b[1] === 187 && b[2] === 191) fs.writeFileSync(f, b.subarray(3));
  } catch {}
  await git(dir, ["add", "-A"]);
  const dirty = await git(dir, ["status", "--porcelain"], true);
  if (dirty) await git(dir, ["commit", "-q", "-m", message.slice(0, 200)]);
  return git(dir, ["rev-parse", "HEAD"]);
}
export async function rehash(dir, paths) {
  if (!(await gitAvailable()) || !fs.existsSync(path.join(dir, ".git"))) return;
  await git(dir, ["rm", "-r", "--cached", "-q", "--ignore-unmatch", "--", ...paths], true);
}
export async function changedFiles(dir, from, to) {
  if (!from || !to || from === to) return [];
  const out = await git(dir, ["diff", "--numstat", from, to], true);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [a, r, f] = l.split("	");
      return { file: f, added: +a || 0, removed: +r || 0 };
    });
}
export async function diff(dir, from, to, file) {
  return git(dir, ["diff", "--unified=3", from, to, ...[]], true);
}
export async function revertRange(dir, from, to, label) {
  await snapshot(dir, "Before revert");
  await git(dir, ["revert", "--no-commit", `${from}..${to}`]).catch(async (e) => {
    await git(dir, ["revert", "--abort"], true);
    throw e;
  });
  await git(dir, ["commit", "-q", "-m", `Revert: ${label}`.slice(0, 200)]);
  return git(dir, ["rev-parse", "HEAD"]);
}
export async function restoreTo(dir, commit, label) {
  await snapshot(dir, "Before restore");
  await git(dir, ["read-tree", "--reset", "-u", commit]);
  await git(dir, ["commit", "-q", "--allow-empty", "-m", `Restore: ${label}`.slice(0, 200)]);
  return git(dir, ["rev-parse", "HEAD"]);
}
export async function reapplyRange(dir, from, to, label) {
  await snapshot(dir, "Before redo");
  await git(dir, ["cherry-pick", "--no-commit", `${from}..${to}`]).catch(async () => {
    await git(dir, ["cherry-pick", "--abort"], true);
    await git(dir, ["reset", "--hard", "-q", "HEAD"], true);
    throw new Error("Later edits changed the same lines, so this edit cannot be re-applied automatically. Ask Claude to redo it instead.");
  });
  await git(dir, ["commit", "-q", "--allow-empty", "-m", `Redo: ${label}`.slice(0, 200)]);
  return git(dir, ["rev-parse", "HEAD"]);
}
export async function log(dir, n = 50) {
  if (!(await gitAvailable()) || !fs.existsSync(path.join(dir, ".git"))) return [];
  const out = await git(dir, ["log", `-${n}`, "--pretty=format:%H%x09%cI%x09%s"], true);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash, date, subject] = l.split("	");
      return { hash, date, subject };
    });
}
