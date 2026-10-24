import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { BrowserWindow } from "electron";
import { templatesDir, ws } from "../core/workspace";
import { log } from "../core/log";
import { q } from "../db/db";
import { slugOf } from "../core/text";
import { serverUrl } from "../projects/fileServer";

const now = () => Date.now();
export const charsRoot = () => path.join(ws.root(), "characters");
const libFile = () => path.join(charsRoot(), "library.json");
const readJson$h = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const MO = {
  id: "mo",
  name: "Mo",
  about: "The style's original character: navy side-swept bob with a top bun, mustard sweater, navy trousers.",
  source: "builtin",
  status: "ready",
  created: 0,
  updated: 0,
};
const validId = (id) => /^[a-z0-9][\w-]{0,63}$/i.test(id);
export function charDir(id) {
  if (id === "mo" || id === "__gen") return path.join(templatesDir(), "flat");
  if (!validId(id)) return null;
  const d = path.join(charsRoot(), id);
  return fs.existsSync(path.join(d, "character.js")) ? d : null;
}
export const characterFile = (id) => {
  const d = charDir(id);
  return d ? path.join(d, "character.js") : null;
};
async function withViewer(id, job) {
  const win = new BrowserWindow({
    show: false,
    width: 540,
    height: 720,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const run = (code, ms = 6e4) =>
    Promise.race([
      win.webContents.executeJavaScript(code),
      new Promise((_, rej) => setTimeout(() => rej(new Error("The character viewer stopped responding.")), ms)),
    ]);
  try {
    await win.loadURL(`${serverUrl()}/c/${id}/charview.html?mode=tool`);
    for (let i = 0; i < 300 && !(await run("window.ready === true || !!window.bootError", 5e3)); i++)
      await new Promise((r) => setTimeout(r, 100));
    const boot = await run("window.bootError || null");
    if (boot) throw new Error("The character does not load: " + String(boot).split("\n")[0]);
    return await job(run);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
async function checkCharacter(id) {
  return withViewer(id, async (run) => {
    const r = await run("window.check()", 12e4);
    return r.ok ? null : r.issues.map((x) => `${x.shot}: ${x.detail}`).join("\n");
  });
}
async function renderThumb(id) {
  const url = await withViewer(id, (run) => run("window.still()"));
  fs.writeFileSync(path.join(charsRoot(), id, "thumb.png"), Buffer.from(url.split(",")[1], "base64"));
}
let labBusy = () => false;
export const setLabBusyCheck = (f) => {
  labBusy = f;
};
function settleOrphan(m) {
  if (m.status !== "designing" || Date.now() - m.updated < 6e4 || (m.lab && labBusy(m.lab))) return m;
  const lab = m.lab ? q.get("SELECT id FROM projects WHERE id=?", m.lab) : null;
  m.status = "failed";
  m.updated = now();
  m.error = lab
    ? "Interrupted: Claude stopped before finishing (the app was closed or the task was stopped). Open its lab and ask Claude to continue, or delete it."
    : "Interrupted: its character lab was removed before Claude finished. Delete it and describe the character again.";
  writeMeta(m);
  applyToWaitingProjects(m);
  return m;
}
const metaOf = (id) => {
  const m = readJson$h(path.join(charsRoot(), id, "character.json"));
  return m?.id === id ? m : null;
};
const writeMeta = (m) => fs.writeFileSync(path.join(charsRoot(), m.id, "character.json"), JSON.stringify(m, null, 1));
const defaultCharacter = () => {
  const d = readJson$h(libFile())?.default;
  return d && (d === "mo" || metaOf(d)?.status === "ready") ? d : "mo";
};
export function setDefaultCharacter(id) {
  if (id !== "mo" && metaOf(id)?.status !== "ready") throw new Error("That character is not ready yet.");
  fs.mkdirSync(charsRoot(), { recursive: true });
  fs.writeFileSync(libFile(), JSON.stringify({ ...(readJson$h(libFile()) || {}), default: id }, null, 1));
}
const view = (m) => {
  const dir = m.id === "mo" ? null : path.join(charsRoot(), m.id),
    thumb = dir && fs.existsSync(path.join(dir, "thumb.png"));
  return {
    ...m,
    default: m.id === defaultCharacter(),
    view: `${serverUrl()}/c/${m.id}/charview.html`,
    thumb:
      m.id === "mo"
        ? `${serverUrl()}/c/mo/thumb.png`
        : thumb
          ? `${serverUrl()}/c/${m.id}/thumb.png?v=${Math.round(fs.statSync(path.join(dir, "thumb.png")).mtimeMs)}`
          : null,
  };
};
let firstRun = null;
export async function listCharacters() {
  if (!readJson$h(libFile())) {
    firstRun ??= randomCharacter()
      .then((c) => setDefaultCharacter(c.id))
      .catch((e) => {
        log("first character failed", e.message);
        setDefaultCharacter("mo");
      })
      .finally(() => {
        firstRun = null;
      });
    await firstRun;
  }
  const list = [MO];
  if (fs.existsSync(charsRoot()))
    for (const id of fs.readdirSync(charsRoot())) {
      const m = metaOf(id);
      if (m) list.push(settleOrphan(m));
    }
  const def = defaultCharacter();
  return list.sort((a, b) => +(b.id === def) - +(a.id === def) || b.created - a.created).map(view);
}
const NAMES = {
  "#1f1a2e": "black",
  "#2e1f17": "dark brown",
  "#4a2c18": "brown",
  "#6b3e1f": "chestnut",
  "#a0612e": "auburn",
  "#c8452c": "ginger",
  "#d9a35a": "dark blonde",
  "#f2cf74": "blonde",
  "#ece6f2": "white",
  "#9aa0b0": "grey",
  "#26306e": "navy",
  "#2bb3a6": "teal",
  "#ff6fae": "pink",
  "#7b4dff": "violet",
  "#3d7bff": "blue",
  "#ffb51f": "mustard",
  "#ff5a5f": "coral",
  "#1ec98b": "green",
  "#2aa8ff": "sky-blue",
  "#ff8a1c": "orange",
  "#ff4fa3": "pink",
  "#ffffff": "white",
  "#14b8b0": "teal",
  "#e83f6f": "raspberry",
  "#ffd93d": "yellow",
  "#5ad1ff": "cyan",
  "#9be15d": "lime",
  "#ff9f8a": "salmon",
  "#3459e6": "royal-blue",
};
const HAIR_W = {
  bob: "bob",
  crop: "short",
  curls: "curly",
  afro: "afro",
  long: "long",
  ponytail: "ponytail",
  spiky: "spiky",
  buzz: "buzz-cut",
  bald: "",
  bun: "top-bun",
  braids: "braided",
};
const TOP_W = { sweater: "sweater", tee: "T-shirt", hoodie: "hoodie", collar: "shirt", jacket: "jacket", stripes: "striped T-shirt" };
const EXTRA_W = {
  glasses: "round glasses",
  "glasses-square": "square glasses",
  freckles: "freckles",
  beard: "a beard",
  mustache: "a mustache",
  earrings: "earrings",
  cap: "a cap",
  beanie: "a beanie",
  headband: "a headband",
  headphones: "headphones",
  scarf: "a scarf",
  bowtie: "a bow tie",
  lashes: "long lashes",
};
function describeLook(l) {
  const c = (h) => NAMES[String(h).toLowerCase()] ?? "";
  const hair = l.hair?.style === "bald" ? "bald" : `${c(l.hair?.color)} ${HAIR_W[l.hair?.style] ?? ""} hair`.replace(/\s+/g, " ").trim();
  const ex = (l.extras || []).map((e) => EXTRA_W[e]).filter(Boolean);
  return `${hair[0].toUpperCase()}${hair.slice(1)}, ${`${c(l.top?.color)} ${TOP_W[l.top?.style] ?? "top"}`.trim()}${ex.length ? `, ${ex.join(" and ")}` : ""}.`;
}
const signature = (l) =>
  JSON.stringify([l.skin, l.hair?.style, l.hair?.color, l.top?.style, l.top?.color, [...(l.extras || [])].sort()]).toLowerCase();
const HATS = ["cap", "beanie", "headband", "headphones"];
const hatOf = (l) => {
  const h = (l.extras || []).find((e) => HATS.includes(e));
  return h ? `${h}:${String(l.extraColor).toLowerCase()}` : null;
};
const js = (s) => JSON.stringify(s);
function characterSource(name, about, look, header) {
  return `// ${header}
// The project's main character: character(p) in models.js draws this one. Keep it consistent across the whole video.
export const name = ${js(name)};
export const about = ${js(about)};
export const look = ${JSON.stringify(look, null, 1).replace(/\n\s*/g, " ")};
export const parts = {};
`;
}
function newId(name) {
  let id = `${slugOf(name, 24).replace(/^-|-$/g, "") || "character"}-${crypto.randomBytes(3).toString("hex")}`;
  while (fs.existsSync(path.join(charsRoot(), id))) id += "x";
  return id;
}
export async function randomCharacter() {
  fs.mkdirSync(charsRoot(), { recursive: true });
  const taken = new Set();
  for (const id2 of fs.readdirSync(charsRoot())) {
    const m2 = metaOf(id2);
    if (m2?.signature) taken.add(m2.signature);
  }
  const names = new Set(),
    hats = new Set();
  for (const id2 of fs.readdirSync(charsRoot())) {
    const m2 = metaOf(id2);
    if (!m2) continue;
    names.add(m2.name);
    try {
      const h = hatOf(
        JSON.parse(fs.readFileSync(path.join(charsRoot(), id2, "character.js"), "utf8").match(/export const look = (.*);/)?.[1] ?? "{}"),
      );
      if (h) hats.add(h);
    } catch {}
  }
  const found = await withViewer("__gen", async (run) => {
    for (let i = 0; i < 12; i++) {
      const seed = crypto.randomInt(1, 2 ** 31 - 1),
        look2 = await run(`window.gen(${seed})`);
      if (taken.has(signature(look2)) || (hatOf(look2) && hats.has(hatOf(look2)))) continue;
      const chk = await run(`window.check(${JSON.stringify(look2)})`, 12e4);
      if (!chk.ok) {
        log("random character failed the gate", seed, JSON.stringify(chk.issues).slice(0, 300));
        continue;
      }
      if (names.has(look2.name)) look2.name = (await run(`window.gen(${seed + 7919})`)).name;
      return { seed, look: look2 };
    }
    throw new Error("Could not make a new character (every try matched one you have or failed the quality check).");
  });
  const { name, ...look } = found.look,
    about = describeLook(look),
    id = newId(name),
    t = now();
  fs.mkdirSync(path.join(charsRoot(), id));
  fs.writeFileSync(
    path.join(charsRoot(), id, "character.js"),
    characterSource(name, about, look, `Main character "${name}": made by Videoxx (random, seed ${found.seed}).`),
  );
  const m = { id, name, about, source: "random", status: "ready", seed: found.seed, signature: signature(look), created: t, updated: t };
  writeMeta(m);
  try {
    await renderThumb(id);
  } catch (e) {
    log("character thumb failed", id, e.message);
  }
  return view(m);
}
export async function deleteCharacter(id) {
  if (id === "mo") throw new Error("Mo is built in and cannot be deleted.");
  const m = metaOf(id);
  if (!m) return;
  if (settleOrphan(m).status === "designing") throw new Error("Claude is still designing this character. Stop it in its lab first.");
  if (defaultCharacter() === id) setDefaultCharacter("mo");
  fs.rmSync(path.join(charsRoot(), id), { recursive: true, force: true });
}
export function renameCharacter(id, name) {
  const m = metaOf(id);
  if (!m) throw new Error("Character not found");
  name = String(name || "")
    .trim()
    .slice(0, 40);
  if (!name) return view(m);
  const f = path.join(charsRoot(), id, "character.js");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/export const name = [^;\n]+;/, `export const name = ${js(name)};`));
  m.name = name;
  m.updated = now();
  writeMeta(m);
  return view(m);
}
export async function startDesign(description, labDirFor) {
  description = String(description || "").trim();
  if (description.length < 3) throw new Error("Describe the character first (a few words is enough).");
  const base = await randomCharacter();
  const m = metaOf(base.id);
  m.source = "claude";
  m.prompt = description.slice(0, 1e3);
  m.status = "designing";
  m.signature = void 0;
  m.updated = now();
  const lab = await labDirFor(m);
  m.lab = lab.projectId;
  writeMeta(m);
  fs.copyFileSync(path.join(charsRoot(), m.id, "character.js"), path.join(lab.dir, "character.js"));
  return { character: view(m), projectId: lab.projectId };
}
const exportedString = (src, key2) => {
  const r = src.match(new RegExp(`export const ${key2}\\s*=\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`));
  return r ? r[2].replace(/\\(['"`\\])/g, "$1") : null;
};
export async function afterLabTask(projectId, status, error) {
  const p = q.get("SELECT * FROM projects WHERE id=?", projectId);
  if (!p) return null;
  const lab = readJson$h(path.join(p.path, "project.json"))?.characterLab;
  if (!lab?.id) return null;
  const m = metaOf(lab.id);
  if (!m) return null;
  const src = path.join(p.path, "character.js"),
    dst = path.join(charsRoot(), m.id, "character.js");
  const text = fs.existsSync(src) ? fs.readFileSync(src, "utf8") : "";
  const changed = text && text !== (fs.existsSync(dst) ? fs.readFileSync(dst, "utf8") : "");
  if (status === "done" || status === "no-change") {
    if (changed) {
      const prev = fs.readFileSync(dst, "utf8");
      fs.writeFileSync(dst, text);
      let problem = null;
      try {
        problem = await checkCharacter(m.id);
      } catch (e) {
        problem = e.message;
      }
      if (problem) {
        fs.writeFileSync(dst, prev);
        m.status = m.status === "designing" ? "failed" : m.status;
        m.error = `Not saved: the design does not pass the quality check yet.
${problem}`.slice(0, 1500);
      } else {
        m.name = exportedString(text, "name") || m.name;
        m.about = exportedString(text, "about") || m.about;
        m.status = "ready";
        m.error = null;
      }
    } else if (m.status === "designing") {
      m.status = "ready";
      m.error = null;
    }
  } else if (m.status === "designing") {
    m.status = "failed";
    m.error = error || "Claude stopped before finishing the design.";
  }
  m.updated = now();
  writeMeta(m);
  if (m.status === "ready") {
    try {
      await renderThumb(m.id);
    } catch (e) {
      log("character thumb failed", m.id, e.message);
    }
  }
  applyToWaitingProjects(m);
  return view(m);
}
function applyToWaitingProjects(m) {
  if (m.status === "designing") return;
  for (const p of q.all("SELECT id, path FROM projects WHERE style_id='flat'")) {
    const f = path.join(p.path, "project.json"),
      pj = readJson$h(f);
    if (pj?.character?.id !== m.id || !pj.character.pending) continue;
    try {
      if (m.status === "ready") fs.copyFileSync(path.join(charsRoot(), m.id, "character.js"), path.join(p.path, "character.js"));
      pj.character = { id: m.id, name: m.name };
      fs.writeFileSync(f, JSON.stringify(pj, null, 1));
    } catch (e) {
      log("apply character", p.id, e.message);
    }
  }
}
export async function waitForCharacter(projectDir, signal, onWait) {
  let told = false;
  for (;;) {
    const pj = readJson$h(path.join(projectDir, "project.json")),
      id = pj?.character?.pending ? pj.character.id : null,
      m = id ? metaOf(id) : null;
    if (!m || settleOrphan(m).status !== "designing" || signal.aborted) {
      if (m && m.status !== "designing") applyToWaitingProjects(m);
      return;
    }
    if (!told) {
      onWait();
      told = true;
    }
    await new Promise((r) => setTimeout(r, 3e3));
  }
}
export async function characterForProject(dir, choice = {}) {
  let id = choice.id || defaultCharacter();
  if (choice.random) id = (await randomCharacter()).id;
  const f = characterFile(id) ?? characterFile("mo");
  fs.copyFileSync(f, path.join(dir, "character.js"));
  const meta = id === "mo" ? MO : (metaOf(id) ?? MO);
  return { id: meta.id, name: meta.name };
}
export const noMainCharacter = (dir) => !!readJson$h(path.join(dir, "project.json"))?.character?.none;
export const NO_MAIN_CHARACTER = "No recurring main character: use scene-specific people/objects only";
export const characterAbout = (dir) => {
  try {
    const s = fs.readFileSync(path.join(dir, "character.js"), "utf8");
    return { name: exportedString(s, "name"), about: exportedString(s, "about"), parts: /parts\s*=\s*\{\s*\S/.test(s) };
  } catch {
    return null;
  }
};
const libraryForPrompt = () => {
  const out = [];
  if (fs.existsSync(charsRoot()))
    for (const id of fs.readdirSync(charsRoot())) {
      const m = metaOf(id);
      if (m?.status === "ready") out.push(`- ${m.name}: ${m.about}`);
    }
  return [`- Mo: ${MO.about}`, ...out].slice(0, 30).join("\n");
};
export function characterPrompt(projectDir, instruction) {
  const lab = readJson$h(path.join(projectDir, "project.json"))?.characterLab || {};
  return `Design the main character for flat explainer videos in this CHARACTER LAB, from the user's description.
The user's description: ${instruction || lab.description || "(none)"}

The character is character.js in this folder (name, about, look, parts). It starts as a random character only so the lab
runs: replace it with your design. scenes/gallery.js shows it in every pose and expression, a head close-up, walking,
flipped and at phone size among other people; leave the gallery as it is, except to add a shot that shows a part you made
(e.g. a tail from the side).
Characters the user already has (make this one clearly different from all of them at a glance):
${libraryForPrompt()}

Do this:
1. Read .claude/skills/flat-explainer-video/references/characters.md (the rig, the trait catalog, the parts contract),
   QUALITY_STANDARD.md and the character section of STYLE_GUIDE.md.
2. Design it on paper first (write it at the top of character.js as a comment): the silhouette that makes it recognisable
   at phone size, a palette of 3-4 colours that reads on the style's backgrounds (night purple, sky blue, sunset orange,
   mint), what in the description must show. Use the trait catalog (look) wherever it fits; draw what it can't as parts.
3. Write character.js: name (a short first name fitting the description unless the user gave one), about (one sentence,
   what you see), look, parts. Parts are drawn with the engine's primitives only (shaded(), ball(), crescent(),
   capsulePts(), clipPts(), circlePts(), blob(), stick()), import only from './engine.js', light from the top-left,
   shading CUT from the outline (withRole('detail') inside the form), never laid on top. Keep the rig contract
   (characters.md): the face, the joints and the expressions must keep working, so poses, follow-through and expressions
   work in every video.
4. Prove it like any element: check_preview, then check_layout until it says Clean (it measures shading drawn outside the
   form in every shot), then render_frames at 0.5, 2.0, 4.5, 6.0, 7.5, 9.0, 12.0 and look closely: proportions, every
   expression readable, nothing floating or detached when it moves, the flipped side, readable and distinctive at phone
   size. Fix and check again (at most 3 rounds).
5. Finish with one sentence: the character's name and what makes them recognisable. The app checks the character
   again and saves it to the user's character library.
Don't touch project.json, audio/ or the engine.`;
}
