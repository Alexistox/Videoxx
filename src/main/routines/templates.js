import { NODE, structuredCloneSafe } from "./nodes";

let seq = 0;
const nn = (type, x, y, settings = {}) => ({
  id: `n_t${++seq}_${type}`,
  type,
  x,
  y,
  settings: { ...structuredCloneSafe(NODE[type].defaults), ...settings },
});
const chain = (nodes) => nodes.slice(1).map((n, i) => ({ id: `e_${nodes[i].id}_${n.id}`, from: nodes[i].id, to: n.id }));
const COL = 320,
  ROW = 240,
  PER = 4;
const row = (types) =>
  types.map((t, i) => {
    const x = (i % PER) * COL,
      y = Math.floor(i / PER) * ROW;
    return Array.isArray(t) ? nn(t[0], x, y, t[1]) : nn(t, x, y);
  });
export const TEMPLATES = [
  {
    id: "next-video",
    name: "Next video for my channel",
    desc: "Claude studies your channel, finds a new topic, then script → voice → build → check → sound → render → thumbnail.",
    make: () => {
      const ns = row([
        ["ideaGenerator", { count: 1 }],
        "createProject",
        ["writeScript", { preset: "deep" }],
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        "notify",
      ]);
      return { nodes: ns, edges: chain(ns) };
    },
  },
  {
    id: "explainer",
    name: "Explainer from a topic",
    desc: "Topic → script → voice → build → check → sound → render → thumbnail.",
    make: () => {
      const ns = row([
        "topic",
        "createProject",
        "writeScript",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        "notify",
      ]);
      return { nodes: ns, edges: chain(ns) };
    },
  },
  {
    id: "batch",
    name: "Batch: topic list to videos",
    desc: "One finished video per line of a list, one after another.",
    make: () => {
      const ns = row([
        "topicList",
        "createProject",
        "writeScript",
        "scriptRules",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        ["moveStage", { stage: "review" }],
        "notify",
      ]);
      return { nodes: ns, edges: chain(ns) };
    },
  },
  {
    id: "daily-short",
    name: "Daily Short for my channel",
    desc: "Every day: Claude finds a new topic for the channel and makes a 9:16 Flat video of it.",
    make: () => {
      const sch = nn("schedule", -COL, 0);
      const ns = row([
        ["ideaGenerator", { count: 1 }],
        ["createProject", { styleId: "flat", format: "vertical", length: 45 }],
        "writeScript",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        ["moveStage", { stage: "ready" }],
        "notify",
      ]);
      return { nodes: [sch, ...ns], edges: chain(ns) };
    },
  },
  {
    id: "my-script",
    name: "My script to finished video",
    desc: "Your script → voice → build → check → sound → render.",
    make: () => {
      const ns = row([
        "myScript",
        "createProject",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        "titleDesc",
        "notify",
      ]);
      return { nodes: ns, edges: chain(ns) };
    },
  },
  {
    id: "autopilot",
    name: "Full channel autopilot",
    desc: "Claude finds ideas, makes the videos, waits for your approval, uploads them privately.",
    make: () => {
      const sch = nn("schedule", -COL, 0);
      const ns = row([
        ["ideaGenerator", { count: 1 }],
        "createProject",
        "writeScript",
        "scriptRules",
        "voiceover",
        "buildVideo",
        "qualityCheck",
        "soundDesign",
        "render",
        "thumbnail",
        "titleDesc",
        "approval",
        "upload",
        "notify",
      ]);
      const v = nn("vertical", PER * COL, 2 * ROW),
        m = nn("moveStage", PER * COL, 3 * ROW + ROW, { stage: "scheduled" });
      return {
        nodes: [sch, ...ns, v, m],
        edges: [...chain(ns), { id: "e_v", from: ns[8].id, to: v.id }, { id: "e_m", from: ns[11].id, to: m.id }],
      };
    },
  },
];
