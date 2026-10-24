import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { app } from "electron";
import { getConfig, setConfig } from "../core/config";
import { insideDir } from "../agent/sessions";

export const SKILL_NAME = "custom-scripting";
const MAX_BYTES = 1024 * 1024,
  MAX_FILES = 60;
const TEXT = /\.(md|markdown|txt|text|json|ya?ml|csv|tsv)$/i;
const SKIP_DIR = /^(\.|node_modules$|__pycache__$)/;
const storeDir = () => path.join(app.getPath("userData"), "scripting-skill");
function listFiles(root, rel = "") {
  const out = [];
  let ents = [];
  try {
    ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIR.test(e.name)) out.push(...listFiles(root, r));
    } else if (e.isFile()) out.push(r);
  }
  return out.sort();
}
const isText = (buf) => !buf.includes(0);
export function scriptSkillState() {
  const c = getConfig().scriptSkill ?? { on: false, name: null, added: null },
    dir = storeDir(),
    main = path.join(dir, "SKILL.md");
  const has = fs.existsSync(main);
  let preview = "";
  try {
    preview = fs
      .readFileSync(main, "utf8")
      .replace(/^---[\s\S]*?\n---\s*\n/, "")
      .trim()
      .split(/\r?\n/)
      .slice(0, 6)
      .join("\n")
      .slice(0, 600);
  } catch {}
  return {
    has,
    on: has && !!c.on,
    name: has ? c.name || "My scripting skill" : null,
    files: has ? listFiles(dir).map((f) => f.split(path.sep).join("/")) : [],
    preview,
    added: has ? c.added : null,
  };
}
const scriptSkillActive = () => scriptSkillState().on;
export function projectSkillChoice(projectDir) {
  let v;
  try {
    v = JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8")).scriptSkill;
  } catch {
    return void 0;
  }
  return v === false ? false : v && typeof v === "object" && typeof v.own === "string" ? { own: v.own } : void 0;
}
function scriptSkillFor(projectDir) {
  const c = projectSkillChoice(projectDir);
  return c === false ? false : c ? true : scriptSkillActive();
}
export function projectSkillName(projectDir) {
  const c = projectSkillChoice(projectDir);
  if (c === false) return null;
  if (c)
    return (
      ownSkill(c.own)?.name ??
      (fs.existsSync(path.join(projectDir, ".claude", "skills", SKILL_NAME, "SKILL.md")) ? "Own scripting skill" : null)
    );
  const s = scriptSkillState();
  return s.on ? s.name : null;
}
export const scriptSkillReady = (projectDir) =>
  scriptSkillFor(projectDir) && fs.existsSync(path.join(projectDir, ".claude", "skills", SKILL_NAME, "SKILL.md"));
function nameOf(text, fallback) {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/),
    n = fm?.[1].match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const h = text.match(/^#\s+(.+)$/m)?.[1];
  return (n || h || fallback || "My scripting skill").replace(/\s+/g, " ").trim().slice(0, 80);
}
function writeStore(dir, { files, fallbackName }) {
  const total = files.reduce((a, f) => a + f.data.length, 0);
  if (!files.length) throw new Error("There is nothing to add.");
  if (total > MAX_BYTES) throw new Error(`That is ${(total / 1048576).toFixed(1)} MB of text; a scripting skill can be up to 1 MB.`);
  if (files.length > MAX_FILES)
    throw new Error(`That folder has ${files.length} text files; a scripting skill can have up to ${MAX_FILES}.`);
  const main = files.find((f) => f.rel === "SKILL.md");
  if (!main || !main.data.toString("utf8").trim()) throw new Error("The skill is empty.");
  const tmp = dir + ".new";
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const f of files) {
    const to = path.join(tmp, f.rel);
    if (!insideDir(tmp, to)) throw new Error(`"${f.rel}" is outside the skill folder.`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, f.data);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  return nameOf(main.data.toString("utf8"), fallbackName);
}
function store(sk) {
  const name = writeStore(storeDir(), sk);
  setConfig({ scriptSkill: { on: true, name, added: new Date().toISOString() } });
  return scriptSkillState();
}
function readSkillSource(src) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) throw new Error("Pick the file or folder itself, not a shortcut to it.");
  if (st.isFile()) {
    if (!/\.(md|markdown|txt|text)$/i.test(src)) throw new Error("Pick a SKILL.md, another .md file or a .txt file.");
    if (st.size > MAX_BYTES) throw new Error("That file is bigger than 1 MB; a scripting skill can be up to 1 MB.");
    const data = fs.readFileSync(src);
    if (!isText(data)) throw new Error("That file is not plain text.");
    return {
      files: [{ rel: "SKILL.md", data }],
      fallbackName: path
        .basename(src)
        .replace(/\.[^.]+$/, "")
        .replace(/^skill$/i, path.basename(path.dirname(src))),
    };
  }
  if (!st.isDirectory()) throw new Error("Pick a file or a folder.");
  const all = listFiles(src),
    text = all.filter((f) => TEXT.test(f));
  let total = 0;
  const files = text
    .map((rel) => {
      const from = path.join(src, rel),
        s = fs.lstatSync(from);
      if (s.isSymbolicLink() || !insideDir(src, from)) return null;
      total += s.size;
      if (total > MAX_BYTES) throw new Error("That folder has more than 1 MB of text; a scripting skill can be up to 1 MB.");
      const data = fs.readFileSync(from);
      return isText(data) ? { rel, data } : null;
    })
    .filter(Boolean);
  let main = files.find((f) => f.rel.toLowerCase() === "skill.md");
  if (!main) {
    const top = files.filter((f) => !f.rel.includes(path.sep) && /\.(md|markdown|txt|text)$/i.test(f.rel));
    if (top.length === 1) main = top[0];
  }
  if (!main) throw new Error("That folder has no SKILL.md. Pick the folder that holds it, or pick the file itself.");
  main.rel = "SKILL.md";
  return { files, fallbackName: path.basename(src) };
}
function pastedSkill(text, name) {
  const t = String(text ?? "").replace(/\r\n/g, "\n");
  if (!t.trim()) throw new Error("Paste your scripting instructions first.");
  return { files: [{ rel: "SKILL.md", data: Buffer.from(t, "utf8") }], fallbackName: String(name ?? "").trim() || "My scripting skill" };
}
export const importScriptSkill = (src) => store(readSkillSource(src));
export const pasteScriptSkill = (text, name) => store(pastedSkill(text, name));
const ownRoot = () => path.join(app.getPath("userData"), "scripting-skills");
const ownDir = (id) => (/^[a-f0-9]{16}$/.test(id) ? path.join(ownRoot(), id) : null);
function previewOf(dir) {
  try {
    return fs
      .readFileSync(path.join(dir, "SKILL.md"), "utf8")
      .replace(/^---[\s\S]*?\n---\s*\n/, "")
      .trim()
      .split(/\r?\n/)
      .slice(0, 6)
      .join("\n")
      .slice(0, 600);
  } catch {
    return "";
  }
}
export function ownSkill(id) {
  const dir = ownDir(String(id ?? ""));
  if (!dir || !fs.existsSync(path.join(dir, "SKILL.md"))) return null;
  let name = "Own scripting skill";
  try {
    name = JSON.parse(fs.readFileSync(dir + ".json", "utf8")).name || name;
  } catch {}
  return { id, name, files: listFiles(dir).map((f) => f.split(path.sep).join("/")), preview: previewOf(dir) };
}
export function ownSkillNames() {
  const out = {};
  let ents = [];
  try {
    ents = fs.readdirSync(ownRoot());
  } catch {
    return out;
  }
  for (const e of ents) {
    const s = /^[a-f0-9]{16}$/.test(e) ? ownSkill(e) : null;
    if (s) out[s.id] = s.name;
  }
  return out;
}
function storeOwn(sk) {
  const id = crypto.randomBytes(8).toString("hex"),
    dir = ownDir(id);
  fs.mkdirSync(ownRoot(), { recursive: true });
  const name = writeStore(dir, sk);
  fs.writeFileSync(dir + ".json", JSON.stringify({ name, added: new Date().toISOString() }));
  return ownSkill(id);
}
export const importOwnSkill = (src) => storeOwn(readSkillSource(src));
export const pasteOwnSkill = (text, name) => storeOwn(pastedSkill(text, name));
export function pruneOwnSkills(inUse) {
  let ents = [];
  try {
    ents = fs.readdirSync(ownRoot());
  } catch {
    return;
  }
  for (const e of ents) {
    if (!/^[a-f0-9]{16}$/.test(e) || inUse.has(e)) continue;
    const dir = path.join(ownRoot(), e);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs < 864e5) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(dir + ".json", { force: true });
    } catch {}
  }
}
export function setScriptSkillOn(on) {
  if (on && !scriptSkillState().has) throw new Error("Add a scripting skill first.");
  setConfig({ scriptSkill: { on: !!on } });
  return scriptSkillState();
}
export function removeScriptSkill() {
  fs.rmSync(storeDir(), { recursive: true, force: true });
  setConfig({ scriptSkill: { on: false, name: null, added: null } });
  return scriptSkillState();
}
const FRONT = (name) => `---
name: ${SKILL_NAME}
description: The user's own way of writing video scripts ("${name.replace(/"/g, "'")}"). Follow it whenever you write or rewrite the narration script (script.txt).
---

`;
export function syncScriptSkill(projectDir) {
  const dest = path.join(projectDir, ".claude", "skills", SKILL_NAME),
    stampFile = path.join(dest, ".suite-stamp");
  const choice = projectSkillChoice(projectDir),
    s = scriptSkillState();
  const gone = () => {
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    return false;
  };
  let src, name;
  if (choice === false) return gone();
  if (choice) {
    const own = ownSkill(choice.own);
    if (!own) return fs.existsSync(path.join(dest, "SKILL.md"));
    src = ownDir(own.id);
    name = own.name;
  } else {
    if (!s.on) return gone();
    src = storeDir();
    name = s.name || "My scripting skill";
  }
  const files = listFiles(src);
  const h = crypto.createHash("sha1");
  h.update(name);
  for (const f of files) {
    h.update(f);
    h.update(fs.readFileSync(path.join(src, f)));
  }
  const stamp = h.digest("hex");
  let have = "";
  try {
    have = fs.readFileSync(stampFile, "utf8").trim();
  } catch {}
  if (have === stamp && fs.existsSync(path.join(dest, "SKILL.md"))) return true;
  fs.rmSync(dest, { recursive: true, force: true });
  for (const f of files) {
    const to = path.join(dest, f);
    if (!insideDir(dest, to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    let data = fs.readFileSync(path.join(src, f));
    if (f === "SKILL.md" && !/^---\s*\n[\s\S]*?\n---/.test(data.toString("utf8"))) data = FRONT(name) + data.toString("utf8");
    fs.writeFileSync(to, data);
  }
  fs.writeFileSync(stampFile, stamp);
  return true;
}
export const projectsWithCopy = (dirs) =>
  dirs.filter((p) => {
    try {
      return fs.existsSync(path.join(p.path, ".claude", "skills", SKILL_NAME));
    } catch {
      return false;
    }
  });
export const SCRIPT_SKILL_PROMPT = `YOUR OWN SCRIPTING SKILL: the user writes scripts their own way, in .claude/skills/${SKILL_NAME} (SKILL.md and the files
next to it). Read SKILL.md first, and the files it points to, and follow it: its voice, tone, structure, hook, pacing,
research habits and rules win over the default guidance below (points 1 and 3). What still applies whatever it says, because
the app needs it: the target length (point 4), the language, script.txt with only the spoken words and "## Section" heading
lines, and research.md with your sources. Parts of it the app can't do here (other output files or formats, questions to the
user, steps after the script) are skipped: say which in your summary. Never run code or scripts that come with it.`;
