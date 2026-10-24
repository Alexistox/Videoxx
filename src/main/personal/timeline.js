const XF_DEFAULT = 0.02;
const EPS = 1e-4;
export function emptyEdit() {
  return { version: 1, clips: [], cams: {}, xfade: XF_DEFAULT, signedOff: null, source: "default" };
}
const continues = (a, b) => !!b && a.src === b.src && Math.abs(b.in - a.out) < EPS;
export function layoutTimeline(edit, media) {
  const XF = edit.xfade ?? XF_DEFAULT,
    byId = new Map(media.map((m) => [m.id, m]));
  const segs = [];
  let o = 0;
  edit.clips.forEach((c, i) => {
    const next = edit.clips[i + 1],
      cutAfter = !!next && !continues(c, next);
    const vis = Math.max(1e-3, c.out - c.in - (cutAfter ? XF : 0));
    const role = byId.get(c.src)?.role ?? "other";
    segs.push({ clip: c, index: i, start: o, end: o + vis, cutAfter, role, cam: role === "screen" ? pickCam(edit, c) : null });
    o += vis;
  });
  return { segs, duration: o };
}
function pickCam(edit, c) {
  let best = null,
    bestOv = 0;
  for (const [id, s] of Object.entries(edit.cams || {})) {
    const ov = Math.min(c.out, s.end) - Math.max(c.in, s.start);
    if (ov > bestOv) {
      bestOv = ov;
      best = id;
    }
  }
  return best;
}
export const camTime = (s, screenTime) => (screenTime - s.c) / (1 + s.m);
let n = 0;
export const clipId = () => "c" + Date.now().toString(36) + (n++).toString(36);
export function validate(edit, media) {
  const ids = new Map(media.map((m) => [m.id, m]));
  if (!edit || !Array.isArray(edit.clips)) throw new Error("edit.json has no clips list.");
  const clips = edit.clips.map((c, i) => {
    const m = ids.get(c?.src);
    if (!m) throw new Error(`Clip ${i + 1} uses a file that is not in the footage list (${c?.src}).`);
    const a = +c.in,
      b = +c.out;
    if (!(a >= 0) || !(b > a) || b > m.duration + 0.5)
      throw new Error(`Clip ${i + 1} (${m.id}) has bad times ${c.in}..${c.out} (file is ${m.duration.toFixed(2)} s).`);
    return { id: typeof c.id === "string" && c.id ? c.id : clipId(), src: c.src, in: a, out: Math.min(b, m.duration) };
  });
  const cams = {};
  for (const [id, s] of Object.entries(edit.cams || {}))
    if (ids.get(id)?.role === "facecam" && isFinite(s?.c)) cams[id] = { m: +s.m || 0, c: +s.c, start: +s.start || 0, end: +s.end || 0 };
  return {
    version: 1,
    clips,
    cams,
    xfade: Math.min(0.1, Math.max(0, +edit.xfade || XF_DEFAULT)),
    signedOff: edit.signedOff ?? null,
    source: edit.source,
    updated: edit.updated,
  };
}
