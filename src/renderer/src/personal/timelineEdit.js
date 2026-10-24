export const XF_DEFAULT = 0.02;
const MIN_CLIP = 0.1;
const EPS = 1e-4;
export function emptyEdit() {
  return { version: 1, clips: [], cams: {}, xfade: XF_DEFAULT, signedOff: null, source: "default" };
}
export const continues = (a, b) => !!b && a.src === b.src && Math.abs(b.in - a.out) < EPS;
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
export const covers = (s, screenTime) => screenTime >= s.start - EPS && screenTime <= s.end + EPS;
export function segIndexAt(segs, t) {
  let lo = 0,
    hi = segs.length - 1;
  if (hi < 0) return -1;
  if (t >= segs[hi].start) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
export const srcTimeAt = (seg, t) => seg.clip.in + (t - seg.start);
let n = 0;
const clipId = () => "c" + Date.now().toString(36) + (n++).toString(36);
const tidy = (clips) => clips.filter((c) => c.out - c.in >= MIN_CLIP);
export function split(edit, media, t) {
  const { segs } = layoutTimeline(edit, media),
    i = segIndexAt(segs, t);
  if (i < 0) return null;
  const sg = segs[i],
    s = srcTimeAt(sg, t);
  if (s - sg.clip.in < MIN_CLIP || sg.clip.in + (sg.end - sg.start) - s < MIN_CLIP) return null;
  const clips = edit.clips.slice();
  clips.splice(i, 1, { ...sg.clip, out: s }, { ...sg.clip, id: clipId(), in: s });
  return clips;
}
export function rippleBefore(edit, media, t) {
  const r = rippleBeforeRaw(edit, media, t);
  if (!r) return null;
  return { clips: r.clips, t: layoutTimeline({ ...edit, clips: r.clips }, media).segs[r.index]?.start ?? 0 };
}
function rippleBeforeRaw(edit, media, t) {
  const { segs } = layoutTimeline(edit, media),
    i = segIndexAt(segs, t);
  if (i < 0) return null;
  const sg = segs[i],
    s = srcTimeAt(sg, t);
  if (s - sg.clip.in < 0.01) return null;
  const clips = edit.clips.slice();
  clips[i] = { ...sg.clip, in: s };
  return { clips: tidy(clips), index: i };
}
export function rippleAfter(edit, media, t) {
  const r = rippleAfterRaw(edit, media, t);
  if (!r) return null;
  const seg = layoutTimeline({ ...edit, clips: r.clips }, media).segs[r.index];
  return { clips: r.clips, t: seg ? seg.end : t };
}
function rippleAfterRaw(edit, media, t) {
  const { segs } = layoutTimeline(edit, media),
    i = segIndexAt(segs, t);
  if (i < 0) return null;
  const sg = segs[i],
    s = srcTimeAt(sg, t);
  if (sg.end - t < 0.01) return null;
  const clips = edit.clips.slice(),
    last = i === clips.length - 1;
  clips[i] = { ...sg.clip, out: last ? s : Math.min(sg.clip.out, s + (edit.xfade ?? XF_DEFAULT)) };
  if (clips[i].out - clips[i].in < MIN_CLIP) {
    clips.splice(i, 1);
    return { clips, index: Math.max(0, i - 1) };
  }
  return { clips, index: i };
}
export function removeClip(edit, index) {
  return edit.clips.filter((_, i) => i !== index);
}
export function trimClip(edit, index, side, value, sourceDuration) {
  const clips = edit.clips.slice(),
    c = { ...clips[index] };
  if (side === "in") c.in = Math.max(0, Math.min(value, c.out - MIN_CLIP));
  else c.out = Math.min(sourceDuration, Math.max(value, c.in + MIN_CLIP));
  clips[index] = c;
  return clips;
}
