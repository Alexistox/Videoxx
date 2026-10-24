import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";

const MARK = "__CZ_PATH__";
export function parseShellPath(out) {
  const m = out.match(new RegExp(`${MARK}([^\\n]*?)${MARK}`));
  return m && m[1].trim() ? m[1].trim() : null;
}
export function mergePaths(...lists) {
  const seen = new Set(),
    out = [];
  for (const l of lists)
    for (const d of (l || "").split(path.delimiter))
      if (d && !seen.has(d)) {
        seen.add(d);
        out.push(d);
      }
  return out.join(path.delimiter);
}
export function pathKind(d) {
  try {
    return fs.statSync(d).isDirectory() ? "dir" : "file";
  } catch (e) {
    if (e?.code === "ENOTDIR") return "through-file";
    for (let up = path.dirname(d), prev = d; up !== prev; prev = up, up = path.dirname(up)) {
      try {
        return fs.statSync(up).isDirectory() ? "missing" : "through-file";
      } catch {}
    }
    return "missing";
  }
}
export function sanitizePath(list, kind = pathKind) {
  const seen = new Set(),
    keep = [],
    dropped = [];
  for (const d of (list || "").split(path.delimiter)) {
    if (!d || seen.has(d)) continue;
    seen.add(d);
    const k = kind(d);
    if (k === "dir") keep.push(d);
    else dropped.push({ entry: d, kind: k });
  }
  return { path: keep.join(path.delimiter), dropped };
}
export const pathProblems = (list = process.env.PATH, kind = pathKind) =>
  sanitizePath(list, kind)
    .dropped.filter((x) => x.kind === "file" || x.kind === "through-file")
    .map((x) => x.entry);
export function pathProblemText(bad) {
  if (!bad.length) return "";
  const where =
    process.platform === "win32"
      ? "Windows Settings > System > About > Advanced system settings > Environment Variables"
      : process.platform === "darwin"
        ? "your shell start-up file (~/.zshrc or ~/.zprofile in your home folder; Terminal: open ~/.zshrc)"
        : "your shell start-up file (~/.bashrc or ~/.profile)";
  return `${bad.length === 1 ? "A folder" : "Folders"} on your computer's PATH ${bad.length === 1 ? "is actually a file (or inside one)" : "are actually files (or inside one)"}:${bad.join(", ")}. Videoxx skips ${bad.length === 1 ? "it" : "them"}; to fix it for good, remove ${bad.length === 1 ? "it" : "them"} from PATH in ${where}.`;
}
export function spawnErrorText(e, cmd) {
  const code = e?.code ?? /\b(ENOTDIR|ENOENT|EACCES)\b/.exec(String(e?.message ?? e))?.[1],
    name = cmd ? path.basename(cmd) : "A tool";
  if (code === "ENOTDIR") {
    const bad = pathProblems();
    return bad.length
      ? pathProblemText(bad)
      : `${name} could not be started: a folder in its path is actually a file. Check your PATH and the tool paths in Settings.`;
  }
  if (code === "ENOENT") return `${name} was not found on this computer. Install it, or set its path in Settings > System > Tool paths.`;
  if (code === "EACCES")
    return `${name} is not allowed to run (no permission to execute it). Check the file's permissions or reinstall it.`;
  return String(e?.message ?? e);
}
export const childPath = (list) => (process.platform === "win32" ? list : sanitizePath(list).path);
export function safeExecFile(cmd, args, opts, cb) {
  try {
    return cp.execFile(cmd, args, opts, (e, o, se) => cb(e, String(o ?? ""), String(se ?? "")));
  } catch (e) {
    cb(e, "", "");
    return null;
  }
}
export const pathInfo = { shell: null, fromShell: false };
function loginShell() {
  try {
    const s = os.userInfo().shell;
    if (s && fs.existsSync(s)) return s;
  } catch {}
  return process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}
function nvmBins(home) {
  const d = path.join(home, ".nvm", "versions", "node");
  try {
    return nvmVersions(
      fs
        .readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    ).map((v) => path.join(d, v, "bin"));
  } catch {
    return [];
  }
}
export const nvmVersions = (names) =>
  names.filter((n) => /^v?\d+(\.\d+)*/.test(n)).sort((a, b) => b.localeCompare(a, void 0, { numeric: true }));
export function fixPath(log = () => {}) {
  if (process.platform === "win32") {
    const bad = pathProblems();
    pathInfo.skipped = bad;
    if (bad.length) log("PATH has entries that are files (left as they are on Windows):", bad.join(" | "));
    return;
  }
  const home = os.homedir();
  let shellPath = null;
  const sh = loginShell();
  pathInfo.shell = sh;
  try {
    const out = cp.execFileSync(sh, ["-ilc", `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, DISABLE_AUTO_UPDATE: "true", ZSH_DISABLE_COMPFIX: "true" },
    });
    shellPath = parseShellPath(out);
  } catch (e) {
    pathInfo.error = e?.message?.split("\n")[0];
    log("login shell PATH unavailable", pathInfo.error);
  }
  pathInfo.fromShell = !!shellPath;
  const usual = [
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"),
    ...nvmBins(home),
  ].join(path.delimiter);
  const merged = mergePaths(shellPath, process.env.PATH, usual),
    clean = sanitizePath(merged);
  pathInfo.skipped = clean.dropped.filter((x) => x.kind === "file" || x.kind === "through-file").map((x) => x.entry);
  process.env.PATH = clean.path;
  if (pathInfo.skipped.length) log("PATH: skipped entries that are files:", pathInfo.skipped.join(" | "));
  log("PATH", shellPath ? "from login shell" : "fallback folders", process.env.PATH);
}
