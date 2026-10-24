import fs from "node:fs";
import { setConfig } from "../core/config";
import { now, q } from "../db/db";
import { encoders } from "../pipeline/ffmpeg";
import { createPersonalProject, getPersonal, readPlan, setPlan, setThumbnail, writePersonalContext } from "../personal/personalProjects";
import { addMedia, onMediaEvent, readMedia, removeMedia, setRole } from "../personal/media";
import { playFailed, queueProxy, resumeProxies, waveform } from "../personal/proxies";
import { placeFootage, readEdit, saveEdit } from "../personal/edit";
import { afterPersonalTask, ensurePersonalSkills } from "../personal/personalAgent";
import { adoptNewProject, checkChannel } from "../channels/channels";
import { mediaUrl, projectUrl } from "../projects/fileServer";
import { watchProject } from "../projects/watcher";
import { deleteLayout, listLayouts, readProjectLayout, saveLayout, saveProjectLayout, setDefaultLayout } from "../personal/layouts";
import { addBackground, backgroundData, listBackgrounds } from "../personal/backgrounds";
import { PRESETS, cancelRender, renderEdit } from "../personal/renderEdit";

function mediaView(id) {
  const p = getPersonal(id);
  return readMedia(p).map((m) => ({
    ...m,
    url: m.proxyState === "ready" && m.proxy ? projectUrl(id, m.proxy) : m.proxyState === "direct" ? mediaUrl(id, m.id) : null,
    missing: !fs.existsSync(m.file),
  }));
}
export function registerPersonalIpc(h, send) {
  onMediaEvent((e) => send("personal:media", e));
  if (process.env.CZ_TEST_HOOKS === "1") h("test:personalAfter", (id, kind) => afterPersonalTask(id, kind));
  if (process.env.CZ_TEST_HOOKS === "1")
    h("test:personalStart", (id) => {
      ensurePersonalSkills(getPersonal(id).path);
      return true;
    });
  h("personal:create", async (o) => {
    const channelId = checkChannel(o.channelId);
    const p = await createPersonalProject(o);
    adoptNewProject(p.id, { channelId, ideaId: o.ideaId });
    if (channelId || o.ideaId) send("channels:changed", { what: "board" });
    return getPersonal(p.id);
  });
  h("personal:open", (id) => {
    const p = getPersonal(id);
    q.run("UPDATE projects SET opened_at=? WHERE id=?", now(), id);
    setConfig({ lastPersonalProjectId: id });
    writePersonalContext(id);
    resumeProxies(id);
    watchProject(id, p.path, (pid, files) => {
      const f = files.filter((x) => /^(edit|media|layout|project)\.json$/.test(x));
      if (f.length) send("personal:changed", { projectId: pid, files: f });
    });
    const t = readPlan(p).thumbnail;
    return { plan: readPlan(p), thumbnailUrl: t ? projectUrl(id, t) + "?v=" + Date.now() : null, path: p.path };
  });
  h("personal:plan", (id) => {
    const p = getPersonal(id),
      plan = readPlan(p);
    return { ...plan, thumbnailUrl: plan.thumbnail ? projectUrl(id, plan.thumbnail) : null };
  });
  h("personal:setPlan", (id, patch) => setPlan(id, patch));
  h("personal:imagePreview", (file) => {
    const m = /\.(png|jpe?g|webp)$/i.exec(String(file));
    if (!m || !fs.existsSync(file) || fs.statSync(file).size > 25 * 1024 * 1024) return null;
    return `data:image/${m[1].toLowerCase().replace("jpg", "jpeg")};base64,${fs.readFileSync(file).toString("base64")}`;
  });
  h("personal:setThumbnail", (id, file) => {
    const f = setThumbnail(id, file);
    return projectUrl(id, f) + "?v=" + Date.now();
  });
  h("personal:media", (id) => mediaView(id));
  h("personal:addMedia", async (id, files, role) => {
    await addMedia(id, (files || []).map(String), role);
    placeFootage(id);
    return mediaView(id);
  });
  h("personal:setRole", (id, mediaId, role) => {
    setRole(id, mediaId, role);
    placeFootage(id);
    return mediaView(id);
  });
  h("personal:playFailed", (id, mediaId, why) => {
    playFailed(id, mediaId, String(why || "").slice(0, 200));
    return mediaView(id);
  });
  h("personal:removeMedia", (id, mediaId) => {
    removeMedia(id, mediaId);
    return mediaView(id);
  });
  h("personal:retryProxy", (id, mediaId) => {
    queueProxy(id, mediaId);
    return mediaView(id);
  });
  h("personal:waveform", (id, mediaId) => waveform(id, mediaId));
  h("personal:encoder", async () => {
    const e = await encoders();
    return { name: e.name, gpu: e.gpu };
  });
  h("personal:edit", (id) => readEdit(getPersonal(id)));
  h("personal:saveEdit", (id, edit) => saveEdit(id, edit, "manual"));
  h("personal:renderPresets", () => PRESETS);
  h("personal:render", async (id, assets, presetId) => {
    const p = getPersonal(id),
      e = readEdit(p);
    saveEdit(id, { ...e, signedOff: now() }, e.source === "claude" ? "claude" : "manual");
    try {
      return await renderEdit(id, assets, presetId, (pr) => send("personal:job", { projectId: id, kind: "render", ...pr }));
    } finally {
      send("channels:changed", { what: "files" });
    }
  });
  h("personal:cancelRender", (id) => cancelRender(id));
  h("personal:layout", (id) => readProjectLayout(id));
  h("personal:saveLayout", (id, s) => saveProjectLayout(id, s));
  h("layouts:list", () => listLayouts());
  h("layouts:save", (o) => saveLayout(o));
  h("layouts:delete", (id) => deleteLayout(id));
  h("layouts:setDefault", (id) => setDefaultLayout(id));
  h("layouts:backgrounds", () => listBackgrounds());
  h("layouts:addBackground", (file) => addBackground(String(file)));
  h("layouts:backgroundData", (ref) => backgroundData(ref));
}
export function personalThumb(id) {
  try {
    const p = getPersonal(id),
      t = readPlan(p).thumbnail;
    return t ? projectUrl(id, t) : null;
  } catch {
    return null;
  }
}
