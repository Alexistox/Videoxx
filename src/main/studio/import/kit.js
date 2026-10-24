import path from "node:path";
import fs from "node:fs";
import cp from "node:child_process";
import os from "node:os";
import { app } from "electron";
import { templatesDir } from "../../core/workspace";
import { log } from "../../core/log";
import { PKG_BASES } from "../../styles/manifest";
import { getStyle } from "../../styles/catalog";
import { getPreset } from "../../styles/presets";

const KIT_FOLDER = "Videoxx Style Kit";
const exists = (f) => {
  try {
    fs.statSync(f);
    return true;
  } catch {
    return false;
  }
};
function basesInfo() {
  const out = {};
  for (const b of PKG_BASES) {
    const st = getStyle(b);
    if (st.id !== b) continue;
    const def = getPreset(st.defaultLook),
      looks = {};
    for (const id of [st.defaultLook, ...(st.looks ?? [])]) {
      const p = getPreset(id);
      if (p) looks[id] = p.settings;
    }
    out[b] = { id: st.defaultLook, name: st.name, settings: def?.settings ?? {}, controls: st.controls, looks };
  }
  return out;
}
export async function makeKit(parent) {
  const p = path.resolve(String(parent || ""));
  if (!parent || !exists(p) || !fs.statSync(p).isDirectory()) throw new Error("Pick the folder the Style Kit goes into.");
  const out = path.join(p, KIT_FOLDER);
  if (exists(out) && fs.readdirSync(out).length && !exists(path.join(out, "kit.json")))
    throw new Error(`"${out}" is not empty and is not a Style Kit: pick another folder (or empty that one).`);
  const script = path.join(templatesDir(), "stylekit", "tools", "make-kit.mjs");
  if (!exists(script)) throw new Error("This app has no Style Kit in its files (reinstall the app).");
  const info = path.join(os.tmpdir(), `cz-kit-bases-${process.pid}-${Date.now().toString(36)}.json`);
  fs.writeFileSync(info, JSON.stringify(basesInfo()));
  try {
    const output = await new Promise((res, rej) => {
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
      for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_)/.test(k)) delete env[k];
      const c = cp.spawn(
        process.execPath,
        [
          script,
          "--templates",
          templatesDir(),
          "--out",
          out,
          "--bases-info",
          info,
          "--app-version",
          app.getVersion(),
          "--runtime",
          process.execPath,
        ],
        { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let so = "",
        se = "";
      c.stdout.on("data", (d) => {
        so += d;
      });
      c.stderr.on("data", (d) => {
        se += d;
      });
      const timer = setTimeout(() => {
        try {
          c.kill();
        } catch {}
        rej(new Error("Writing the Style Kit took over 5 minutes (a very slow disk?). Try another folder."));
      }, 5 * 6e4);
      c.on("error", (e) => {
        clearTimeout(timer);
        rej(new Error(`The Style Kit could not be written: ${e.message}`));
      });
      c.on("close", (code) => {
        clearTimeout(timer);
        code === 0
          ? res(so.trim())
          : rej(
              new Error(
                `The Style Kit could not be written: ${(se || so)
                  .trim()
                  .split("\n")
                  .slice(-3)
                  .join(" ")
                  .replace(/^make-kit:\s*/, "")
                  .slice(0, 400)}`,
              ),
            );
      });
    });
    if (!exists(path.join(out, "kit.json"))) throw new Error("The Style Kit was not written (no kit.json): try another folder.");
    const guide =
      [path.join(out, "Videoxx Style Kit Guide.pdf"), path.join(out, "docs", "GUIDE.md"), path.join(out, "README.md")].find(exists) ?? null;
    log("style kit written", out, output.split("\n").pop());
    return { folder: out, guide, output };
  } finally {
    fs.rmSync(info, { force: true });
  }
}
