import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

let file = "";
export function initLog() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, "main.log");
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + ".1");
  } catch {}
  log(`--- Videoxx ${app.getVersion()} ${process.platform} electron ${process.versions.electron} ---`);
  process.on("uncaughtException", (e) => log("uncaughtException", e.stack || e.message));
  process.on("unhandledRejection", (e) => log("unhandledRejection", e?.stack || String(e)));
}
export function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}
`;
  if (!app.isPackaged) process.stdout.write(line);
  if (file)
    try {
      fs.appendFileSync(file, line);
    } catch {}
}
export const logPath = () => file;
