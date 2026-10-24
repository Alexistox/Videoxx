import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { getConfig } from "./config";

export function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}
export const templatesDir = () => path.join(resourcesDir(), "templates");
export const ws = {
  root: () => getConfig().workspace,
  db: () => path.join(getConfig().workspace, "suite.db"),
  projects: () => path.join(getConfig().workspace, "projects"),
  style: () => path.join(getConfig().workspace, "STYLE.md"),
};
export function ensureWorkspace() {
  fs.mkdirSync(ws.projects(), { recursive: true });
  if (!fs.existsSync(ws.style()))
    fs.writeFileSync(ws.style(), "# Global style rules\n\nRules every Claude session in Videoxx follows. Managed in the Memory page.\n");
}
