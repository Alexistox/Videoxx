import path from "node:path";
import fs from "node:fs";
import { app, safeStorage } from "electron";
import { log } from "./log";

const file = () => path.join(app.getPath("userData"), "secrets.json");
function read() {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    return {};
  }
}
function write(o) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(o, null, 1));
}
export function getSecret(name) {
  const v = read()[name];
  if (!v) return null;
  try {
    return safeStorage.decryptString(Buffer.from(v, "base64"));
  } catch {
    return null;
  }
}
export function setSecret(name, value) {
  const o = read();
  if (!value) delete o[name];
  else {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("This computer has no secure key storage available, so the key cannot be saved.");
    o[name] = safeStorage.encryptString(value).toString("base64");
  }
  write(o);
}
export const secretHint = (name) => {
  const s = getSecret(name);
  return s ? s.slice(-4) : null;
};
export function importSecrets() {
  const f = path.join(app.getPath("userData"), "import-secrets.json");
  if (!fs.existsSync(f)) return;
  try {
    const o = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const [k, v] of Object.entries(o)) if (typeof v === "string" && v.trim()) setSecret(k, v.trim());
    log("imported secrets:", Object.keys(o).join(", "));
  } catch (e) {
    log("secret import failed", e.message);
  }
  try {
    fs.rmSync(f, { force: true });
  } catch {}
}
