import path from "node:path";
import fs from "node:fs";
import { app, dialog, shell } from "electron";
import { getStyle } from "../styles/catalog";
import {
  cancelImport,
  exportPackage,
  fixList,
  getRun,
  installImport,
  listRuns,
  onImportChanged,
  recheck,
  restoreVersion,
  startImport,
  stopImport,
  styleKitInfo,
  versions,
  wsDir,
} from "../studio/import/styleImport";
import { fixImport, fixesOf } from "../studio/import/fixImport";
import { makeKit } from "../studio/import/kit";

export function registerStyleImportIpc(h, send, getWin, takePick = () => null) {
  onImportChanged((run) => send("styles:importChanged", run));
  const mac = process.platform === "darwin";
  h("styles:importPickZip", async () => {
    const t = takePick();
    if (t) return t[0] ?? null;
    const r = await dialog.showOpenDialog(getWin(), {
      title: "Import a style package",
      message: "Pick the style package (.zip) made with cz package",
      properties: ["openFile"],
      filters: [{ name: "Style package", extensions: ["zip"] }],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  h("styles:importPickFolder", async () => {
    const t = takePick();
    if (t) return t[0] ?? null;
    const r = await dialog.showOpenDialog(getWin(), {
      title: "Import a style package",
      message: mac ? "Pick the style package: its .zip or its folder" : "Pick the style package's folder",
      properties: mac ? ["openFile", "openDirectory"] : ["openDirectory"],
      ...(mac ? { filters: [{ name: "Style package", extensions: ["zip"] }] } : {}),
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  h("styles:importStart", (src) => startImport(String(src)));
  h("styles:importState", (id) => (id ? getRun(String(id)) : listRuns()));
  h("styles:importFix", (id) => fixImport(String(id)));
  h("styles:importStop", (id) => stopImport(String(id)));
  h("styles:importInstall", async (id) => {
    const r = await installImport(String(id));
    send("styles:changed", { id: r.result?.id ?? null });
    return r;
  });
  h("styles:importCancel", (id) => cancelImport(String(id)));
  h("styles:importFixList", (id) => fixList(String(id)));
  h("styles:exportPackage", async (styleId) => {
    const st = getStyle(String(styleId)),
      t = takePick();
    const r = t
      ? { canceled: !t[0], filePath: t[0] }
      : await dialog.showSaveDialog(getWin(), {
          title: "Export the style package",
          defaultPath: path.join(app.getPath("documents"), `${st.id}.zip`),
          filters: [{ name: "Style package", extensions: ["zip"] }],
        });
    if (r.canceled || !r.filePath) return null;
    const out = exportPackage(st.id, /\.zip$/i.test(r.filePath) ? r.filePath : `${r.filePath}.zip`);
    if (!t) shell.showItemInFolder(out.file);
    return out;
  });
  h("styles:recheck", (styleId) => recheck(String(styleId)));
  h("styles:versions", (styleId) => versions(String(styleId)));
  h("styles:restoreVersion", (styleId, n) => {
    const r = restoreVersion(String(styleId), Number(n));
    send("styles:changed", { id: r.id });
    return r;
  });
  h("styles:kitMake", async () => {
    const t = takePick();
    const r = t
      ? { canceled: !t[0], filePaths: t }
      : await dialog.showOpenDialog(getWin(), {
          title: "Where should the Style Kit go?",
          message: 'Pick a folder: the app makes "Videoxx Style Kit" in it',
          properties: ["openDirectory", "createDirectory"],
        });
    if (r.canceled || !r.filePaths[0]) return null;
    const k = await makeKit(r.filePaths[0]);
    if (!t) {
      shell.showItemInFolder(path.join(k.folder, "kit.json"));
      if (k.guide) shell.openPath(k.guide).catch(() => {});
    }
    return k;
  });
  h("styles:kitInfo", () => styleKitInfo());
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:styleImport", async (op, a, b) => {
      if (op === "kitMake") return makeKit(String(a));
      if (op === "exportPackage") return exportPackage(String(a), String(b));
      if (op === "fixes") return fixesOf(String(a));
      if (op === "ws") return wsDir(String(a));
      if (op === "recheck") return recheck(String(a));
      if (op === "exists") return fs.existsSync(String(a));
      throw new Error(`unknown op ${op}`);
    });
}
