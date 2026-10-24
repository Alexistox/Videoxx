import path from "node:path";
import fs from "node:fs";

export const MUSIC_EXT = ["mp3", "wav", "m4a", "ogg", "flac", "aac", "opus"];
const defGain = (style) => (style === "lowpoly" ? -10 : style === "toon" || style === "stickstory" ? -23 : -12);
export function musicOf(dir, style) {
  let m = {};
  try {
    m = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")).music ?? {};
  } catch {}
  const file =
    typeof m.file === "string" && /^audio\/music_user\.[a-z0-9]+$/.test(m.file) && fs.existsSync(path.join(dir, m.file)) ? m.file : null;
  const num = (v, lo, hi, d) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  return {
    file,
    name: file ? String(m.name || path.basename(file)) : null,
    gain: num(m.gain, -40, 0, defGain(style)),
    duck: num(m.duck, 0, 11, 8),
    use: file && m.use !== "style" ? "mine" : "style",
    sfxGain: num(m.sfxGain, -12, 6, 0),
  };
}
function save(dir, m) {
  const f = path.join(dir, "project.json"),
    pj = JSON.parse(fs.readFileSync(f, "utf8"));
  pj.music = { file: m.file, name: m.name, gain: m.gain, duck: m.duck, use: m.use, sfxGain: m.sfxGain };
  fs.writeFileSync(f, JSON.stringify(pj, null, 1));
}
export function addMusic(dir, src, style) {
  const ext = path.extname(src).slice(1).toLowerCase();
  if (!MUSIC_EXT.includes(ext)) throw new Error(`That file is not music the app can use (${MUSIC_EXT.join(", ")}).`);
  if (!fs.statSync(src).isFile()) throw new Error("That is not a file.");
  const cur = musicOf(dir, style);
  if (cur.file)
    try {
      fs.rmSync(path.join(dir, cur.file));
    } catch {}
  const rel = `audio/music_user.${ext}`;
  fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
  fs.copyFileSync(src, path.join(dir, rel));
  const m = { ...cur, file: rel, name: path.basename(src).slice(0, 120), use: "mine" };
  save(dir, m);
  return m;
}
export function setMusic(dir, patch, style) {
  const cur = musicOf(dir, style),
    m = { ...cur };
  if (patch.remove) {
    if (cur.file)
      try {
        fs.rmSync(path.join(dir, cur.file));
      } catch {}
    m.file = null;
    m.name = null;
    m.use = "style";
  }
  if (typeof patch.gain === "number" && isFinite(patch.gain)) m.gain = Math.max(-40, Math.min(0, Math.round(patch.gain)));
  if (typeof patch.duck === "number" && isFinite(patch.duck)) m.duck = Math.max(0, Math.min(11, Math.round(patch.duck)));
  if (typeof patch.sfxGain === "number" && isFinite(patch.sfxGain)) m.sfxGain = Math.max(-12, Math.min(6, Math.round(patch.sfxGain)));
  if (patch.use === "mine" || patch.use === "style") m.use = patch.use === "mine" && m.file ? "mine" : "style";
  save(dir, m);
  return musicOf(dir, style);
}
export function musicArgs(dir, style) {
  const m = musicOf(dir, style);
  return m.use === "mine" && m.file ? ["--music", path.join(dir, m.file), "--music-gain", String(m.gain), "--duck", String(m.duck)] : [];
}
export const sfxGainOf = (dir) => musicOf(dir).sfxGain;
