import { NODE } from "../../../../routines/nodes";

const WAIT_CAP = 20;
const SIM = {
  ideaGenerator: [
    70,
    [
      "Reading the channel's public videos again from YouTube",
      "Asking Claude for 3 topics",
      "Checking every topic against all public videos",
      "New: a topic the channel has not covered",
    ],
  ],
  topic: [1, []],
  topicList: [1, []],
  channelIdeas: [2, ["Taking the next idea card"]],
  myScript: [1, []],
  myAudio: [1, []],
  createProject: [3, ["Creating the project"]],
  writeScript: [130, ["Searching the web", "Reading sources", "Writing script.txt", "Counting the words"]],
  scriptRules: [2, ["Checking the rules"]],
  voiceover: [80, ["Making the voice", "Cleaning the audio", "Timing the words", "Done"]],
  cleanAudio: [20, ["Cleaning the audio"]],
  timeWords: [15, ["Timing the words"]],
  buildVideo: [
    960,
    [
      "Reading the skill",
      "Writing storyboard.md",
      "Building scenes/s1_intro.js",
      "Checking the preview",
      "Rendering frames to check the shots",
      "Building scenes/s2.js",
      "Rendering frames to check the shots",
      "Building scenes/s3.js",
      "Writing audio/beds.json",
    ],
  ],
  qualityCheck: [
    40,
    ["Checking scenes, layout, length and shots", "Playing every frame for scene errors", "1796 frames played: no scene errors"],
  ],
  soundDesign: [25, ["Sound events", "Mixing"]],
  render: [90, ["Rendering 10%", "Rendering 40%", "Rendering 70%", "Rendering 100%", "Encoding"]],
  vertical: [100, ["Rendering the 9:16 version"]],
  thumbnail: [150, ["Looking at the channel's thumbnails", "Searching for reference pictures", "Writing the prompt", "Making the picture"]],
  titleDesc: [60, ["Title style: kept", "Writing 3 title options"]],
  approval: [WAIT_CAP, ["Waiting for you to approve or reject."]],
  moveStage: [1, []],
  notify: [1, []],
  upload: [120, ["Uploading"]],
};
const SIM_NOTE = {
  ideaGenerator: "Checked new against all public videos of the channel.",
  createProject: "Project created",
  writeScript: "Script written to the target length.",
  scriptRules: "Every rule passes.",
  voiceover: "Local voice, cleaned and timed.",
  buildVideo: "Built.",
  qualityCheck: "Clean: no scene errors in any frame.",
  soundDesign: "Mixed.",
  render: "Exported.",
  thumbnail: "Designed by Claude.",
  titleDesc: "Title written in the channel's style.",
  approval: "Approved.",
  moveStage: "Moved.",
  notify: "Ready.",
  upload: "Uploaded (private).",
};
function orderFrom(g, source) {
  const reach = new Set([source]),
    st = [source];
  while (st.length) {
    const id = st.pop();
    for (const e of g.edges)
      if (e.from === id && !reach.has(e.to)) {
        reach.add(e.to);
        st.push(e.to);
      }
  }
  const indeg = new Map([...reach].map((id) => [id, g.edges.filter((e) => e.to === id && reach.has(e.from)).length]));
  const out = [],
    ready = [...reach].filter((id) => !indeg.get(id));
  const pos = (id) => {
    const n = g.nodes.find((x) => x.id === id);
    return n.x * 10 + n.y / 1e3;
  };
  while (ready.length) {
    ready.sort((a, b) => pos(a) - pos(b));
    const id = ready.shift();
    out.push(id);
    for (const e of g.edges)
      if (e.from === id && reach.has(e.to)) {
        const d = indeg.get(e.to) - 1;
        indeg.set(e.to, d);
        if (!d) ready.push(e.to);
      }
  }
  return out;
}
const secs = (a, b) => (a && b ? Math.max(0, (Date.parse(b) - Date.parse(a)) / 1e3) : 0);
export function makeDemo(graph, last, speed) {
  const tracks = [];
  const usable = last && last.items.some((it) => Object.values(it.nodes).some((s) => s.status === "done" || s.status === "warn"));
  if (usable && last) {
    for (const it of last.items) {
      const g = last.graph,
        steps = [];
      const ids = Object.keys(it.nodes).sort(
        (a, b) => (Date.parse(it.nodes[a].startedAt ?? "") || 0) - (Date.parse(it.nodes[b].startedAt ?? "") || 0),
      );
      let tt = 0;
      const srcDur = it.source && it.startedAt ? Math.min(240, secs(last.startedAt, it.startedAt)) || 30 : 0;
      if (it.source) {
        steps.push({
          nodeId: it.source,
          start: 0,
          end: srcDur,
          status: "done",
          note: it.nodes[it.source]?.note,
          log: it.nodes[it.source]?.log ?? [],
        });
        tt = srcDur;
      }
      for (const id of ids) {
        if (id === it.source) continue;
        const s = it.nodes[id],
          type = g.nodes.find((n) => n.id === id)?.type ?? "";
        if (!["done", "warn", "skipped"].includes(s.status)) continue;
        let d = s.status === "skipped" ? 0 : secs(s.startedAt, s.finishedAt);
        if (type === "approval") d = Math.min(d || WAIT_CAP, WAIT_CAP);
        d = Math.max(s.status === "skipped" ? 0 : 1.5, d);
        steps.push({ nodeId: id, start: tt, end: tt + d, status: s.status, note: s.note, log: s.log ?? [] });
        tt += d;
      }
      tracks.push({ id: it.id, label: it.label, ctx: it.ctx, projectId: it.projectId, start: 0, end: tt, steps });
    }
    let at = 0;
    const par =
      last.items.length > 1 &&
      last.items.some(
        (x, i) => i && x.startedAt && last.items[i - 1].finishedAt && Date.parse(x.startedAt) < Date.parse(last.items[i - 1].finishedAt),
      );
    for (const t of tracks) {
      if (!par) {
        t.steps.forEach((s) => {
          s.start += at;
          s.end += at;
        });
        t.start = at;
        t.end += at;
        at = t.end;
      }
    }
    return {
      speed,
      t0: performance.now(),
      tracks,
      total: Math.max(...tracks.map((t) => t.end)),
      graph: last.graph,
      startedAt: new Date().toISOString(),
      fromRun: true,
    };
  }
  const src = graph.nodes.find(
    (n) => !n.off && NODE[n.type]?.accepts === null && NODE[n.type]?.out && graph.edges.some((e) => e.from === n.id),
  );
  if (src) {
    let tt = 0;
    const steps = [];
    for (const id of orderFrom(graph, src.id)) {
      const n = graph.nodes.find((x) => x.id === id),
        [d, log] = SIM[n.type] ?? [5, []];
      if (n.off) {
        steps.push({ nodeId: id, start: tt, end: tt, status: "skipped", note: "Switched off.", log: [] });
        continue;
      }
      steps.push({ nodeId: id, start: tt, end: tt + d, status: "done", note: SIM_NOTE[n.type], log });
      tt += d;
    }
    const label = n0(src);
    tracks.push({ id: "demo", label, ctx: {}, projectId: null, start: 0, end: tt, steps });
  }
  return { speed, t0: performance.now(), tracks, total: tracks[0]?.end ?? 0, graph, startedAt: new Date().toISOString(), fromRun: false };
}
const n0 = (n) =>
  String(n.settings?.topic || n.settings?.title || n.settings?.topics?.split?.("\n")?.[0] || "Your next video").trim() || "Your next video";
export function demoFrame(d, now = performance.now()) {
  const t = Math.min(d.total, ((now - d.t0) / 1e3) * d.speed),
    wall = Date.now();
  const at = (sec) => new Date(wall - (t - sec) * 1e3).toISOString();
  const items = d.tracks
    .filter((tr) => t >= tr.start)
    .map((tr, idx) => {
      const nodes = {};
      let status = "waiting";
      for (const s of tr.steps) {
        if (t >= s.end && (s.end > s.start || t > s.start))
          nodes[s.nodeId] =
            s.status === "skipped"
              ? { status: "skipped", note: s.note }
              : { status: s.status, startedAt: at(s.start), finishedAt: at(s.end), note: s.note, log: s.log };
        else if (t >= s.start) {
          const k = s.log.length
            ? Math.min(s.log.length, Math.floor(((t - s.start) / Math.max(1e-3, s.end - s.start)) * s.log.length) + 1)
            : 0;
          nodes[s.nodeId] = {
            status: NODE[d.graph.nodes.find((n) => n.id === s.nodeId)?.type ?? ""]?.type === "approval" ? "approval" : "running",
            startedAt: at(s.start),
            log: s.log.slice(0, k),
          };
          status = nodes[s.nodeId].status === "approval" ? "approval" : "running";
        } else nodes[s.nodeId] = { status: "waiting" };
      }
      if (t >= tr.end) status = "done";
      const thumbDone = tr.steps.some((s) => d.graph.nodes.find((n) => n.id === s.nodeId)?.type === "thumbnail" && t >= s.end);
      return {
        id: tr.id,
        runId: "demo",
        idx,
        label: tr.label,
        source: tr.steps[0]?.nodeId ?? "",
        status,
        projectId: tr.projectId,
        ctx: { ...tr.ctx, thumbnail: thumbDone ? (tr.ctx?.thumbnail ?? "demo") : void 0 },
        nodes,
        error: null,
        startedAt: at(tr.start),
        finishedAt: t >= tr.end ? at(tr.end) : null,
      };
    });
  const done = t >= d.total;
  return {
    t,
    done,
    run: {
      id: "demo",
      routineId: "demo",
      status: done ? "done" : "running",
      trigger: "manual",
      startedAt: at(0),
      finishedAt: done ? at(d.total) : null,
      summary: done ? `${items.length} of ${items.length} video${items.length === 1 ? "" : "s"} finished.` : null,
      graph: d.graph,
      items,
      live: !done,
    },
  };
}
