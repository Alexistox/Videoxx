import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { templatesDir } from "../core/workspace";
import { log } from "../core/log";

const PIPELINE_SCRIPTS = ["audio_prep.py", "transcribe.py", "align.py", "mix.py", "sound_design.py", "sfxlib.py"];
const SKILL = path.join("skill", "pixel-explainer-video", "scripts");
const installedScripts = () => process.env.CZ_PIPELINE_SCRIPTS_DIR || path.join(templatesDir(), SKILL);
const spareScripts = () =>
  app.isPackaged ? path.join(app.getAppPath(), "pipeline-scripts") : path.join(app.getAppPath(), "templates", SKILL);
const healedScripts = () => path.join(app.getPath("userData"), "pipeline-scripts", app.getVersion());
const missingIn = (dir) =>
  PIPELINE_SCRIPTS.filter((f) => {
    try {
      return !fs.statSync(path.join(dir, f)).isFile();
    } catch {
      return true;
    }
  });
export function reinstallHint() {
  return process.platform === "darwin"
    ? "Download Videoxx again and drag it into Applications (your projects and settings are kept)."
    : "Reinstall Videoxx: run the installer again (your projects and settings are kept). If it happens again, your antivirus may be removing the file: allow the Videoxx folder.";
}
class MissingScriptError extends Error {}
export function pipelineScriptsDir() {
  const dir = installedScripts(),
    miss = missingIn(dir);
  if (!miss.length) return dir;
  const healed = healedScripts();
  if (!missingIn(healed).length) return healed;
  const spare = spareScripts();
  if (!missingIn(spare).length) {
    try {
      fs.mkdirSync(healed, { recursive: true });
      for (const f of fs.readdirSync(spare)) if (f.endsWith(".py")) fs.copyFileSync(path.join(spare, f), path.join(healed, f));
      log(`pipeline scripts: ${miss.join(", ")} missing from ${dir}; restored from the app's spare copy into ${healed}`);
      if (!missingIn(healed).length) return healed;
    } catch (e) {
      log("pipeline scripts: could not restore the spare copy:", e?.message);
    }
  }
  throw new MissingScriptError(
    `Videoxx is missing one of its own files (${miss.join(", ")}), so the audio steps cannot run. ${reinstallHint()}`,
  );
}
export function scriptsHealth() {
  const missing = missingIn(installedScripts());
  try {
    const d = pipelineScriptsDir();
    return d === installedScripts()
      ? { ok: true, restored: false, missing, text: "All there" }
      : {
          ok: true,
          restored: true,
          missing,
          text: `Restored (${missing.join(", ")} had gone missing from the app's folder; the app uses its spare copy)`,
        };
  } catch (e) {
    return { ok: false, restored: false, missing, text: e.message };
  }
}
