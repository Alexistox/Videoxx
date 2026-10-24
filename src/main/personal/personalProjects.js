import path from "node:path";
import fs from "node:fs";
import { ws } from "../core/workspace";
import { now, q, uid } from "../db/db";
import { slugOf } from "../core/text";
import { ensureRepo } from "../core/gitSnapshots";
import { emptyEdit } from "./timeline";

const PERSONAL_STRUCTURE = `project.json   title, thumbnail idea, core concept, thumbnail (managed by the Suite)
media.json     the footage: where each file is, its role (screen / facecam / intro) and its proxy
edit.json      the edit: timeline clips (source in/out), facecam sync, sign-off (after a cut: the intro + the rendered cut)
layout.json    how the video is framed: screen, facecam, background, corners
CLAUDE.md      project context Claude reads first (the Suite regenerates the marked block)
thumbnail.png  the thumbnail (Thumbnails tab > Use as thumbnail, or picked when planning)
work/          what the editing skills write (transcripts, sync, intro edit)
out/           final renders; out/edit/ = the cut's deliverables (edited screen recording, one facecam, audio)
.suite/        proxies, waveforms, frames (app cache)`;
const PERSONAL_IGNORE = `# Personal Brand: footage, renders and skill work files stay out of history
work/
media/
*.mp4
*.mov
*.mkv
*.m4a
*.wav
`;
const slugify = (s) => slugOf(s) || "video";
const readJson = (f, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 1) + "\n");
};
export function getPersonal(id) {
  const p = q.get("SELECT * FROM projects WHERE id=?", id);
  if (!p) throw new Error("Project not found");
  if (p.kind !== "personal") throw new Error("That is not a Personal Brand project");
  return p;
}
const projectFile = (p, f) => path.join(p.path, f);
const IMAGE = /\.(png|jpe?g|webp)$/i;
export function installThumbnail(dir, src) {
  if (!IMAGE.test(src) || !fs.existsSync(src)) throw new Error("The thumbnail must be a PNG, JPG or WebP image.");
  for (const f of fs.readdirSync(dir)) if (/^thumbnail\.(png|jpe?g|webp)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  const name = "thumbnail" + path.extname(src).toLowerCase().replace(".jpeg", ".jpg");
  fs.copyFileSync(src, path.join(dir, name));
  return name;
}
export async function createPersonalProject(o) {
  const title = o.title.trim();
  if (!title) throw new Error("Give the video a title.");
  let dir = path.join(ws.projects(), slugify(title)),
    i = 2;
  while (fs.existsSync(dir)) dir = path.join(ws.projects(), `${slugify(title)}-${i++}`);
  for (const d of ["work", "out", ".suite"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const thumbnail = o.thumbnailFile ? installThumbnail(dir, o.thumbnailFile) : null;
  writeJson(path.join(dir, "project.json"), {
    kind: "personal",
    title,
    thumbnailIdea: (o.thumbnailIdea || "").trim(),
    concept: (o.concept || "").trim(),
    thumbnail,
    created: now(),
  });
  writeJson(path.join(dir, "media.json"), { media: [] });
  writeJson(path.join(dir, "edit.json"), emptyEdit());
  fs.writeFileSync(path.join(dir, ".gitignore"), PERSONAL_IGNORE);
  const id = uid("prj_"),
    t = now();
  q.run(
    "INSERT INTO projects(id,name,slug,path,preset_id,style_id,kind,status,created_at,updated_at,opened_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    id,
    title,
    path.basename(dir),
    dir,
    null,
    "personal",
    "personal",
    "draft",
    t,
    t,
    t,
  );
  writePersonalContext(id);
  await ensureRepo(dir);
  return getPersonal(id);
}
export function readPlan(p) {
  const pj = readJson(projectFile(p, "project.json"), {});
  return {
    title: pj.title || p.name,
    thumbnailIdea: pj.thumbnailIdea || "",
    concept: pj.concept || "",
    thumbnail: pj.thumbnail && fs.existsSync(projectFile(p, pj.thumbnail)) ? pj.thumbnail : null,
  };
}
export function setPlan(id, patch) {
  const p = getPersonal(id),
    f = projectFile(p, "project.json");
  if (!fs.existsSync(p.path))
    throw new Error(
      `The video's folder is missing (${p.path}). Put it back, or connect its drive, then ${"title" in patch ? "rename it" : "try again"}.`,
    );
  const pj = readJson(f, {});
  for (const k of ["title", "thumbnailIdea", "concept"]) if (typeof patch[k] === "string") pj[k] = patch[k].trim();
  if (!pj.title) throw new Error("The title cannot be empty.");
  writeJson(f, pj);
  if (pj.title !== p.name) q.run("UPDATE projects SET name=?, updated_at=? WHERE id=?", pj.title, now(), id);
  writePersonalContext(id);
  return readPlan(getPersonal(id));
}
export function setThumbnail(id, file) {
  const p = getPersonal(id),
    f = projectFile(p, "project.json"),
    pj = readJson(f, {});
  pj.thumbnail = installThumbnail(p.path, file);
  writeJson(f, pj);
  q.run("UPDATE projects SET updated_at=? WHERE id=?", now(), id);
  return pj.thumbnail;
}
export function writePersonalContext(id) {
  const p = getPersonal(id),
    plan = readPlan(p),
    f = projectFile(p, "CLAUDE.md");
  const block = `<!-- videoxx:begin (generated by Videoxx; edit outside this block) -->
# ${plan.title}

A Personal Brand video: the creator's own footage (a screen recording with the good microphone audio, one or more facecam
clips, optionally an intro clip) edited into one video. The user watches the edit in the Suite's editor, re-cuts it on
the timeline and signs off the final render.
${
  plan.thumbnailIdea
    ? `
Thumbnail idea: ${plan.thumbnailIdea}`
    : ""
}${
    plan.concept
      ? `
Core concept: ${plan.concept}`
      : ""
  }

## Files
${PERSONAL_STRUCTURE}

## Rules
- Never modify, move or re-encode the footage listed in media.json; read it, and write new files only under work/ and out/.
- Cutting the footage is the talking-head-edit skill, end to end: it renders the edited screen recording and one facecam
  to out/edit/ and writes work/delivery.json when every gate passed; the Suite then puts those two files on the
  timeline (edit.json) as one clip each. Change a cut through work/script.md and the skill's scripts, never by hand; never modify the scripts.
- edit.json times are seconds in the SOURCE file of each clip (in/out); clips play in array order.
<!-- videoxx:end -->`;
  const have = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const out = /<!-- videoxx:begin[\s\S]*?videoxx:end -->/.test(have)
    ? have.replace(/<!-- videoxx:begin[\s\S]*?videoxx:end -->/, block)
    : have
      ? `${block}

${have}`
      : block + "\n";
  fs.writeFileSync(f, out);
}
