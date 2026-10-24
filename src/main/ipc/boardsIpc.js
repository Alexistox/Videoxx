import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { dialog, nativeImage } from "electron";
import { setConfig } from "../core/config";
import { q } from "../db/db";
import {
  addImage,
  boardDir,
  boardFile,
  boardForProject,
  boardUrl,
  brandOf,
  createBoard,
  deleteBoard,
  getBoard,
  imageDims,
  listBoards,
  renameBoard,
  revealImage,
  saveBoard,
} from "../characters/boards";
import { cancelGeneration, keyStatus, modelInfo, resumeGenerations, setKey, startGeneration } from "../images/higgsfield";
import { setKey as setKey$1 } from "../images/fal";
import { mergeModels } from "../images/overrides";
import { flowPicture, flowState, openFlow } from "../images/flow";
import { generatePicture, globalImageModels, isProviderSetting, providerStatus } from "../images/providers";
import { installThumbnail, setThumbnail } from "../personal/personalProjects";
import { projectUrl } from "../projects/fileServer";

export function registerBoardsIpc(h, send, getWin) {
  const emit = (ev) => send("higgsfield:job", { ...ev, url: ev.file ? boardUrl(ev.boardId, ev.file) : null });
  resumeGenerations(boardDir, emit);
  h("boards:list", (brand) => listBoards(brandOf(brand)));
  h("boards:create", (name, brand) => createBoard(name, brandOf(brand)));
  h("boards:forProject", (projectId) => {
    const p = q.get("SELECT name, kind FROM projects WHERE id=?", projectId);
    if (!p) throw new Error("That project no longer exists.");
    return boardForProject(projectId, p.name, brandOf(p.kind));
  });
  h("boards:dims", async (id, file) => imageDims(boardFile(id, file)));
  h("boards:get", (id) => getBoard(id));
  h("boards:save", (id, data) => saveBoard(id, data));
  h("boards:rename", (id, name) => renameBoard(id, name));
  h("boards:delete", (id) => deleteBoard(id));
  h("boards:addImage", (id, src) => addImage(id, src));
  h("boards:reveal", (id, file) => revealImage(id, file));
  h("boards:startDrag", (id, file) => {
    const f = boardFile(id, file),
      icon = nativeImage.createFromPath(f);
    getWin()?.webContents.startDrag({ file: f, icon: icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 160 }) });
  });
  h("boards:saveAs", async (id, file) => {
    const f = boardFile(id, file);
    const r = await dialog.showSaveDialog(getWin(), {
      title: "Save image",
      defaultPath: path.join(os.homedir(), "Downloads", `thumbnail${path.extname(f)}`),
      filters: [{ name: "Image", extensions: [path.extname(f).slice(1)] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.copyFileSync(f, r.filePath);
    return r.filePath;
  });
  h("boards:useAsThumbnail", (id, file, projectId) => {
    const p = q.get("SELECT kind, path FROM projects WHERE id=?", projectId);
    if (!p) throw new Error("That project no longer exists.");
    if (p.kind === "personal") return projectUrl(projectId, setThumbnail(projectId, boardFile(id, file))) + "?v=" + Date.now();
    const dir = path.join(p.path, ".suite");
    fs.mkdirSync(dir, { recursive: true });
    return projectUrl(projectId, ".suite/" + installThumbnail(dir, boardFile(id, file))) + "?v=" + Date.now();
  });
  h("higgsfield:status", () => ({ ...keyStatus(), models: modelInfo() }));
  h("higgsfield:setKey", (key2) => setKey(key2));
  h("images:status", () => providerStatus());
  h("images:setProvider", (p) => {
    setConfig({ images: { provider: isProviderSetting(p) ? p : "auto" } });
    return providerStatus();
  });
  h("images:flowState", () => flowState());
  h("images:flowOpen", async () => {
    await openFlow();
    return providerStatus();
  });
  h("images:flowTest", async () => {
    const r = await flowPicture({ prompt: "A small red apple on a plain white table, soft daylight, simple photo.", aspect: "16:9" });
    const im = nativeImage.createFromBuffer(r.buf),
      s = im.getSize();
    return {
      url:
        "data:image/jpeg;base64," +
        im
          .resize({ width: Math.min(640, s.width) })
          .toJPEG(85)
          .toString("base64"),
      width: s.width,
      height: s.height,
    };
  });
  if (process.env.CZ_TEST_HOOKS === "1")
    h("images:flowTestGenerate", async (prompt, refs, aspect, upscale2k) => {
      const r = await generatePicture({ prompt, aspect: aspect ?? "16:9", refs: refs ?? [], upscale2k: !!upscale2k });
      const s = nativeImage.createFromBuffer(r.buf).getSize();
      return {
        bytes: r.buf.length,
        width: s.width,
        height: s.height,
        provider: r.provider,
        model: r.model,
        cost: r.cost,
        upscaled: r.upscaled,
        note: r.note,
      };
    });
  h("images:setFalKey", async (key2) => {
    await setKey$1(key2);
    return providerStatus();
  });
  h("images:setModel", (service, model) => {
    const m = mergeModels(globalImageModels(), { [String(service)]: model || null });
    setConfig({ images: { model: { [String(service)]: m[service] ?? null } } });
    return providerStatus();
  });
  h("higgsfield:generate", (boardId, nodeId, req) => {
    if (!q.get("SELECT id FROM boards WHERE id=?", boardId)) throw new Error("That board no longer exists.");
    const refs = (req.refs || []).map((f) => boardFile(boardId, f));
    const r = startGeneration(boardId, nodeId, boardDir(boardId), { ...req, refs }, emit);
    return { ...r, url: null };
  });
  h("higgsfield:cancel", (genId) => cancelGeneration(genId));
}
