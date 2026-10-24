export const DEFAULTS = { model: "marketing-studio/image/sunburst", aspect: "16:9", resolution: "2k", quality: "high" };
export const nid = (p) => p + Math.random().toString(36).slice(2, 10);
const empty = () => ({ v: 1, nodes: [], edges: [], view: { x: 0, y: 0, z: 1 }, mode: "canvas" });
export function normalize(d) {
  const e = empty();
  return {
    v: 1,
    nodes: Array.isArray(d?.nodes) ? d.nodes : [],
    edges: Array.isArray(d?.edges) ? d.edges : [],
    view: d?.view && isFinite(d.view.x) && isFinite(d.view.y) && d.view.z > 0 ? d.view : e.view,
    mode: d?.mode === "prompt" ? "prompt" : "canvas",
    ...(d?.compose && typeof d.compose === "object" ? { compose: d.compose } : {}),
    ...(Array.isArray(d?.dismissed) ? { dismissed: d.dismissed } : {}),
  };
}
export const ratio = (a) => {
  const m = /^(\d+):(\d+)$/.exec(a || "");
  return m ? +m[2] / +m[1] : 9 / 16;
};
export function nodeHeight(n, measured) {
  if (n.type === "image") return n.iw && n.ih ? (n.w * n.ih) / n.iw : n.w * 0.5625;
  if (n.type === "output") return n.w * ratio(n.aspectHint);
  return measured ?? (n.type === "prompt" ? 230 : 60);
}
export function port(n, side, h) {
  const y = n.type === "prompt" ? n.y + 26 : n.y + h / 2;
  return { x: side === "out" ? n.x + n.w : n.x, y };
}
export const canFeed = (from, to) =>
  !!from && !!to && from.id !== to.id && (from.type === "image" || from.type === "output") && to.type === "prompt";
export function refsOf(d, promptId, fileOf) {
  const out = [];
  for (const e of d.edges)
    if (e.to === promptId) {
      const n = d.nodes.find((x) => x.id === e.from);
      if (!n) continue;
      out.push({ name: `img${out.length + 1}`, node: n, file: fileOf(n) });
    }
  return out;
}
export function cable(a, b) {
  const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}
export const STATUS = {
  queued: "Waiting for a free slot",
  uploading: "Uploading references",
  "queued-remote": "In the Higgsfield queue",
  in_progress: "Generating",
  completed: "Done",
  failed: "Failed",
  canceled: "Cancelled",
};
export function fitSettings(m, s) {
  if (!m) return s;
  return {
    aspect: m.aspects.includes(s.aspect ?? "") ? s.aspect : m.aspects.includes("16:9") ? "16:9" : m.aspects[0],
    resolution: m.resolutions.includes(s.resolution ?? "")
      ? s.resolution
      : m.resolutions.includes("2k")
        ? "2k"
        : m.resolutions[m.resolutions.length - 1],
    quality: m.quality.includes(s.quality ?? "") ? s.quality : (m.defQuality ?? m.quality[0]),
  };
}
export const running = (s) => !!s && ["queued", "uploading", "queued-remote", "in_progress"].includes(s);
