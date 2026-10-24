import path from "node:path";
import fs from "node:fs";
import { now, q, uid } from "../db/db";
import { getPersonal } from "./personalProjects";

const px = (v, of) => Math.round((v / of) * 1e4) / 1e4;
const CLASSIC = {
  background: { image: "builtin:graphite", color: "#0e0e10", dim: 0, blur: 0 },
  screen: { x: 0.07, y: 0.07, w: 0.86, h: 0.86, radius: 22, shadow: 0.6, fit: "contain" },
  cam: {
    x: px(36, 1920),
    y: px(1080 - 36 - 300, 1080),
    w: px(300, 1920),
    h: px(300, 1080),
    radius: 26,
    shadow: 0.6,
    visible: true,
    zoom: 1,
    focusX: 0.5,
    focusY: 0.42,
  },
};
const BUILTIN = [
  { id: "classic", name: "Classic", settings: CLASSIC },
  {
    id: "big-cam",
    name: "Big facecam",
    settings: {
      ...CLASSIC,
      background: { ...CLASSIC.background, image: "builtin:midnight" },
      screen: { ...CLASSIC.screen, x: 0.3, y: 0.12, w: 0.66, h: 0.66 },
      cam: { ...CLASSIC.cam, x: 0.035, y: 0.3, w: px(460, 1920), h: px(460, 1080), radius: 30 },
    },
  },
  {
    id: "screen-focus",
    name: "Screen focus",
    settings: {
      ...CLASSIC,
      background: { ...CLASSIC.background, image: "builtin:aurora" },
      screen: { ...CLASSIC.screen, x: 0.035, y: 0.035, w: 0.93, h: 0.93, radius: 18 },
      cam: { ...CLASSIC.cam, x: px(1920 - 36 - 240, 1920), y: px(1080 - 36 - 240, 1080), w: px(240, 1920), h: px(240, 1080), radius: 22 },
    },
  },
];
function ensureBuiltinLayouts() {
  const t = now();
  for (const b of BUILTIN)
    if (!q.get("SELECT id FROM layouts WHERE id=?", b.id))
      q.run(
        "INSERT INTO layouts(id,name,settings,builtin,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        b.id,
        b.name,
        JSON.stringify(b.settings),
        1,
        b.id === "classic" && !q.get("SELECT id FROM layouts WHERE is_default=1") ? 1 : 0,
        t,
        t,
      );
}
const parse = (r) => ({ ...r, settings: normalize(JSON.parse(r.settings)) });
export function listLayouts() {
  ensureBuiltinLayouts();
  return q.all("SELECT * FROM layouts ORDER BY builtin DESC, name").map(parse);
}
function defaultLayout() {
  ensureBuiltinLayouts();
  const r = q.get("SELECT * FROM layouts WHERE is_default=1") ?? q.get("SELECT * FROM layouts WHERE id='classic'");
  return r ? parse(r).settings : CLASSIC;
}
export function saveLayout(o) {
  const name = o.name.trim() || "My layout",
    settings = JSON.stringify(normalize(o.settings)),
    t = now();
  const row = o.id ? q.get("SELECT * FROM layouts WHERE id=?", o.id) : null;
  if (row && !row.builtin) {
    q.run("UPDATE layouts SET name=?, settings=?, updated_at=? WHERE id=?", name, settings, t, row.id);
    return row.id;
  }
  const id = uid("lay_");
  q.run(
    "INSERT INTO layouts(id,name,settings,builtin,is_default,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    id,
    row?.builtin ? `${name} (mine)` : name,
    settings,
    0,
    0,
    t,
    t,
  );
  return id;
}
export function deleteLayout(id) {
  const r = q.get("SELECT * FROM layouts WHERE id=?", id);
  if (!r) return;
  if (r.builtin) throw new Error("Built-in layouts can't be deleted.");
  q.run("DELETE FROM layouts WHERE id=?", id);
  if (r.is_default) q.run("UPDATE layouts SET is_default=1 WHERE id='classic'");
}
export function setDefaultLayout(id) {
  if (!q.get("SELECT id FROM layouts WHERE id=?", id)) throw new Error("Layout not found");
  q.run("UPDATE layouts SET is_default=0");
  q.run("UPDATE layouts SET is_default=1 WHERE id=?", id);
}
function normalize(s) {
  const c = (v, lo, hi, d) => {
    const n = +v;
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const box = (b, d) => ({
    x: c(b?.x, -0.5, 1, d.x),
    y: c(b?.y, -0.5, 1, d.y),
    w: c(b?.w, 0.05, 1.5, d.w),
    h: c(b?.h, 0.05, 1.5, d.h),
    radius: c(b?.radius, 0, 200, d.radius),
    shadow: c(b?.shadow, 0, 1, d.shadow),
  });
  return {
    background: {
      image: typeof s?.background?.image === "string" ? s.background.image : null,
      color: /^#[0-9a-f]{6}$/i.test(s?.background?.color) ? s.background.color : CLASSIC.background.color,
      dim: c(s?.background?.dim, 0, 0.9, 0),
      blur: c(s?.background?.blur, 0, 40, 0),
    },
    screen: { ...box(s?.screen, CLASSIC.screen), fit: s?.screen?.fit === "cover" ? "cover" : "contain" },
    cam: {
      ...box(s?.cam, CLASSIC.cam),
      visible: s?.cam?.visible !== false,
      zoom: c(s?.cam?.zoom, 1, 3, 1),
      focusX: c(s?.cam?.focusX, 0, 1, 0.5),
      focusY: c(s?.cam?.focusY, 0, 1, 0.42),
    },
  };
}
export function readProjectLayout(id) {
  const p = getPersonal(id),
    f = path.join(p.path, "layout.json");
  try {
    return normalize(JSON.parse(fs.readFileSync(f, "utf8")));
  } catch {
    const d = defaultLayout();
    fs.writeFileSync(f, JSON.stringify(d, null, 1) + "\n");
    return d;
  }
}
export function saveProjectLayout(id, s) {
  const p = getPersonal(id),
    n = normalize(s);
  fs.writeFileSync(path.join(p.path, "layout.json"), JSON.stringify(n, null, 1) + "\n");
  return n;
}
