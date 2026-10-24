import path from "node:path";
import fs from "node:fs";
import { ws } from "../core/workspace";
import { q, uid } from "../db/db";
import {
  assignChannel,
  board,
  checkChannel,
  createChannel,
  createIdea,
  createIdeas,
  deleteChannel,
  deleteIdea,
  deleteIdeas,
  listChannels,
  listIdeas,
  moveCard,
  reorderChannels,
  restoreIdea,
  setAvatar,
  setDueMany,
  setPlan,
  updateChannel,
  updateIdea,
} from "../channels/channels";

export function registerChannelsIpc(h, send) {
  const changed = (v, what = "channels") => {
    send("channels:changed", { what });
    return v;
  };
  h("channels:list", () => listChannels());
  h("channels:create", (o) => changed(createChannel(o)));
  h("channels:update", (id, patch) => changed(updateChannel(String(id), patch || {})));
  h("channels:delete", (id) => changed(deleteChannel(String(id))));
  h("channels:reorder", (ids) => changed(reorderChannels(ids)));
  h("channels:setAvatar", (id, file) => changed(setAvatar(String(id), file === null ? null : String(file))));
  h("channels:board", () => board());
  h("channels:ideas", () => listIdeas());
  h("channels:move", (o) => changed(moveCard(o), "board"));
  h("channels:assign", (projectIds, channelId) => changed(assignChannel(projectIds, channelId), "board"));
  h("channels:plan", (projectId, patch) => changed(setPlan(String(projectId), patch || {}), "board"));
  h("channels:dueMany", (ids, dueAt) => changed(setDueMany(ids, dueAt), "board"));
  h("channels:ideaRestore", (row) => changed(restoreIdea(row || {}), "ideas"));
  h("channels:ideaCreate", (o) => changed(createIdea(o), "ideas"));
  h("channels:ideaCreateMany", (titles, channelId) => changed(createIdeas(titles, channelId), "ideas"));
  h("channels:ideaUpdate", (id, patch) => changed(updateIdea(String(id), patch || {}), "ideas"));
  h("channels:ideaDelete", (id) => changed(deleteIdea(String(id)), "ideas"));
  h("channels:ideaDeleteMany", (ids) => changed(deleteIdeas(ids), "ideas"));
  if (process.env.CZ_TEST_HOOKS === "1") {
    h("test:fakeProjects", (n, channelIds) => {
      const ids = [],
        t = Date.now();
      for (let i = 0; i < Math.min(500, +n || 0); i++) {
        const id = uid("prj_"),
          dir = path.join(ws.projects(), `zz-load-${t}-${i}`),
          personal = i % 7 === 6,
          at = new Date(t - i * 6e4).toISOString();
        fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
        fs.mkdirSync(path.join(dir, "out"), { recursive: true });
        const stage = i % 5;
        if (personal) {
          fs.writeFileSync(
            path.join(dir, "project.json"),
            JSON.stringify({ kind: "personal", title: `Load video ${i}`, thumbnailIdea: "", concept: "", thumbnail: null }),
          );
          fs.writeFileSync(
            path.join(dir, "media.json"),
            JSON.stringify({ media: stage > 1 ? [{ id: "m1", file: "x.mp4", role: "screen" }] : [] }),
          );
          fs.writeFileSync(
            path.join(dir, "edit.json"),
            JSON.stringify({ version: 1, clips: [], cams: {}, xfade: 0.02, signedOff: null, source: "default" }),
          );
        } else {
          fs.writeFileSync(
            path.join(dir, "project.json"),
            JSON.stringify({
              title: `Load project ${i}`,
              style: "pixel-art",
              targetLength: 120,
              end: stage > 2 ? 95 + i : 0,
              scenes: stage > 2 ? ["s1"] : [],
              settings: {},
            }),
          );
          if (stage > 0) fs.writeFileSync(path.join(dir, "script.txt"), "word ".repeat(60));
          if (stage > 1) fs.writeFileSync(path.join(dir, "audio", "source.wav"), "RIFF");
          if (stage > 2) {
            fs.mkdirSync(path.join(dir, "scenes"), { recursive: true });
            fs.writeFileSync(path.join(dir, "scenes", "s1.js"), "// test");
          }
          if (stage > 3) fs.writeFileSync(path.join(dir, "out", "video.mp4"), "");
        }
        const ch = Array.isArray(channelIds) && channelIds.length ? channelIds[i % channelIds.length] : null;
        q.run(
          "INSERT INTO projects(id,name,slug,path,preset_id,style_id,kind,status,created_at,updated_at,opened_at,channel_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          personal ? `Load video ${i}` : `Load project ${i}`,
          path.basename(dir),
          dir,
          personal ? null : "crisp",
          personal ? "personal" : "pixel-art",
          personal ? "personal" : "faceless",
          "draft",
          at,
          at,
          null,
          ch ? checkChannel(ch) : null,
        );
        ids.push(id);
      }
      return changed(ids, "board");
    });
    h("test:clearFakeProjects", () => {
      const rows = q.all("SELECT id, path FROM projects WHERE slug LIKE 'zz-load-%'");
      for (const r of rows) {
        q.run("DELETE FROM projects WHERE id=?", r.id);
        if (r.path.startsWith(ws.projects())) fs.rmSync(r.path, { recursive: true, force: true });
      }
      return changed(rows.length, "board");
    });
    h("test:projectStage", (id) =>
      q.get("SELECT channel_id, stage, stage_auto, stage_at, stage_order, due_at, plan_note FROM projects WHERE id=?", id),
    );
    h("test:setStatus", (id, status) => q.run("UPDATE projects SET status=? WHERE id=?", String(status), String(id)));
  }
}
