import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import { app } from "electron";
import { getConfig, setConfig } from "./config";
import { CLAUDE_INSTALL, CLAUDE_SHELL } from "../engines/claudeCli";

export const CODEX_INSTALL = "npm install -g @openai/codex";
export const CODEX_UPDATE = "npm install -g @openai/codex@latest";
export const INSTALL =
  process.platform === "win32"
    ? {
        shell: CLAUDE_SHELL,
        claude: CLAUDE_INSTALL,
        git: "winget install --id Git.Git -e",
        ffmpeg: "winget install --id Gyan.FFmpeg -e",
        python: "winget install --id Python.Python.3.12 -e",
        node: "winget install --id OpenJS.NodeJS.LTS -e",
        codex: CODEX_INSTALL,
      }
    : process.platform === "darwin"
      ? {
          shell: CLAUDE_SHELL,
          claude: CLAUDE_INSTALL,
          git: "xcode-select --install",
          ffmpeg: "brew install ffmpeg",
          python: "brew install python",
          node: "brew install node",
          codex: CODEX_INSTALL,
          note: "ffmpeg and Python install with Homebrew. No Homebrew yet? Get it from brew.sh first.",
        }
      : {
          shell: CLAUDE_SHELL,
          claude: CLAUDE_INSTALL,
          git: "sudo apt install git",
          ffmpeg: "sudo apt install ffmpeg",
          python: "sudo apt install python3 python3-venv",
          node: "sudo apt install nodejs npm",
          codex: CODEX_INSTALL,
        };
let clt = null;
export function isMacStub(cmd) {
  if (process.platform !== "darwin") return false;
  let exe = cmd;
  if (!/[\\/]/.test(cmd))
    exe =
      (process.env.PATH || "")
        .split(path.delimiter)
        .map((d) => path.join(d, cmd))
        .find((f) => {
          try {
            return fs.statSync(f).isFile();
          } catch {
            return false;
          }
        }) ?? "";
  if (!/^\/usr\/bin\/(git|python3|pip3)$/.test(exe)) return false;
  if (clt === null) {
    try {
      cp.execFileSync("xcode-select", ["-p"], { stdio: "ignore", timeout: 5e3 });
      clt = true;
    } catch {
      clt = false;
    }
  }
  return !clt;
}
export function forgetMacStubs() {
  clt = null;
}
export const suiteVenv = () => path.join(app.getPath("userData"), "python");
export const suiteVenvPython = () => path.join(suiteVenv(), "bin", "python3");
export const venvPython = (venv) =>
  process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
export const STABLE_TS_PIP = [
  ["install", "--upgrade", "pip"],
  process.platform === "darwin" ? ["install", "torch"] : ["install", "torch", "--index-url", "https://download.pytorch.org/whl/cpu"],
  ["install", "stable-ts"],
];
export function adoptSuitePython(log = () => {}) {
  if (process.platform === "win32") return;
  const py = suiteVenvPython();
  if (getConfig().tools.python === "python3" && fs.existsSync(py)) {
    setConfig({ tools: { python: py } });
    log("using the Suite Python environment", py);
  }
}
