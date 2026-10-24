import path from "node:path";
import fs from "node:fs";
import { ws } from "../core/workspace";
import { log } from "../core/log";
import { DESCRIBE_SYSTEM, cleanLook, isCharId, lookSummary, newCharId, randomLook } from "./looks";
import { claudeOnce } from "../app/help";

const dir = () => path.join(ws.root(), "characters", "toon");
export function listToonChars() {
  let files = [];
  try {
    files = fs.readdirSync(dir()).filter((f) => /^c_[a-z0-9]+\.json$/.test(f));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir(), f), "utf8")),
        look = cleanLook(j.look);
      if (look && isCharId(j.id)) out.push({ id: j.id, name: look.name, look, about: lookSummary(look), created: j.created });
    } catch {}
  }
  return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}
export function saveToonChar(c) {
  const look = cleanLook(c?.look);
  if (!look) throw new Error("That character is missing a body, skin, hair or top.");
  const id = isCharId(c.id) ? c.id : newCharId();
  fs.mkdirSync(dir(), { recursive: true });
  const rec = { id, name: look.name, look, about: lookSummary(look), created: new Date().toISOString() };
  fs.writeFileSync(path.join(dir(), id + ".json"), JSON.stringify(rec, null, 2));
  return rec;
}
export function removeToonChar(id) {
  if (!isCharId(id)) throw new Error("Unknown character.");
  try {
    fs.unlinkSync(path.join(dir(), id + ".json"));
  } catch {}
}
export async function describeToonChar(text) {
  const words = String(text || "")
    .trim()
    .slice(0, 600);
  if (words.length < 3) throw new Error("Describe the character in a few words.");
  const answer =
    process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_TOONCHAR_FAKE === "1"
      ? JSON.stringify({ ...randomLook(42), name: "Testy", role: "test character" })
      : await claudeOnce(DESCRIBE_SYSTEM, `Design this character: """${words}"""`, [], "sonnet");
  let j;
  try {
    j = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1));
  } catch {
    j = null;
  }
  const look = cleanLook(j);
  if (!look) {
    log("toon character: unusable answer", answer.slice(0, 300));
    throw new Error("Claude answered in a way that could not be used. Try again, or describe it a little differently.");
  }
  return { look, about: lookSummary(look) };
}
