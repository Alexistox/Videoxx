import {
  AudioLines,
  AudioWaveform,
  Bell,
  CalendarClock,
  Columns3,
  FileText,
  Film,
  FolderPlus,
  Hammer,
  Image,
  Lightbulb,
  ListChecks,
  ListOrdered,
  Mic,
  Music,
  PenLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
  StickyNote,
  Timer,
  TvMinimalPlay,
  Type,
  Upload,
  UserCheck,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { lang } from "../settings/languages";
import { BUILD_EXTRAS, SCRIPT_PRESETS, levelName, nextRun, nodeLevel, writeSkillLine } from "../../../../routines/nodes";

export const ICONS = {
  Lightbulb,
  ListOrdered,
  TvMinimalPlay,
  Sparkles,
  FileText,
  AudioLines,
  CalendarClock,
  FolderPlus,
  PenLine,
  ListChecks,
  Mic,
  AudioWaveform,
  Timer,
  Hammer,
  ShieldCheck,
  Music,
  Film,
  Smartphone,
  Image,
  Type,
  UserCheck,
  Columns3,
  Bell,
  Upload,
  StickyNote,
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const count = (s) =>
  String(s ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim()).length;
const FAIL = { fix: "Claude fixes problems", stop: "stops on a problem", warn: "warns on a problem" };
export function summary(n, c) {
  const s = n.settings ?? {};
  switch (n.type) {
    case "topic":
      return [s.topic || "No topic yet", s.notes ? "With notes" : ""].filter(Boolean);
    case "topicList": {
      const k = count(s.topics);
      return [k ? `${k} topic${k === 1 ? "" : "s"}: one video each` : "No topics yet"];
    }
    case "channelIdeas":
      return [
        s.channelId ? (c.channel(s.channelId) ?? "Deleted channel") : "No channel picked",
        `Next ${s.count || 1} idea${(s.count || 1) === 1 ? "" : "s"}`,
      ];
    case "ideaGenerator":
      return [
        s.ytChannel
          ? `Studies ${c.ytAny(s.ytChannel) ?? "a channel you no longer follow"}`
          : s.channelId
            ? `Studies ${c.channel(s.channelId) ?? "a deleted channel"}`
            : "No channel to study yet",
        `${s.look === "all" ? "All public videos" : `Latest ${s.lastN || 10} videos`} → ${s.count || 1} new topic${(s.count || 1) === 1 ? "" : "s"}${s.web ? " · web research" : ""}`,
      ];
    case "myScript":
      return [s.title || "Untitled", s.script ? `${String(s.script).split(/\s+/).filter(Boolean).length} words` : "No script yet"];
    case "myAudio":
      return [s.title || "Untitled", `${(s.files ?? []).length} recording${(s.files ?? []).length === 1 ? "" : "s"}`];
    case "schedule": {
      if (!s.on) return ["Off"];
      const when =
        s.mode === "hours"
          ? `Every ${s.hours} hours`
          : s.mode === "weekdays"
            ? `${(s.days ?? []).map((d) => DAYS[d]).join(" ")} at ${s.time}`
            : `Every day at ${s.time}`;
      const nx = nextRun(s, new Date());
      return [when, nx ? `Next: ${nx.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""].filter(Boolean);
    }
    case "createProject":
      return [
        `${c.style(s.styleId) ?? s.styleId}${s.presetId ? ` · ${c.look(s.presetId) ?? "look"}` : ""}`,
        `${s.format === "vertical" ? "9:16" : "16:9"} · ${fmtLen(s.length)}${s.language ? ` · ${lang(s.language).name}` : ""}${s.channelId ? ` · ${c.channel(s.channelId) ?? "deleted channel"}` : ""}`,
      ];
    case "writeScript":
      return [
        SCRIPT_PRESETS.find((p) => p.value === s.preset)?.label ?? "Balanced",
        `Length within ±${s.tolerance}%${s.notes ? " · with notes" : ""}`,
        writeSkillLine(s, c.skills?.() ?? null),
      ];
    case "scriptRules": {
      const r = [
        count(s.banned) && `${count(s.banned)} banned`,
        count(s.required) && `${count(s.required)} required`,
        s.maxSentence > 0 && `sentences ≤ ${s.maxSentence} words`,
        s.minWords > 0 && `≥ ${s.minWords} words`,
        s.maxWords > 0 && `≤ ${s.maxWords} words`,
      ].filter(Boolean);
      return [r.length ? r.join(" · ") : "No rules yet", FAIL[s.onFail] ?? ""].filter(Boolean);
    }
    case "voiceover":
      return [
        s.provider === "elevenlabs"
          ? "ElevenLabs"
          : s.provider === "fish"
            ? "Fish Audio"
            : s.provider === "kokoro"
              ? "Local voice"
              : "ElevenLabs, Fish Audio or local voice",
        `Then cleaned and timed (≥ ${s.minMatch}%)`,
      ];
    case "cleanAudio":
      return [s.tighten ? "Tightens long pauses" : "Keeps the pauses"];
    case "timeWords":
      return [`At least ${s.minMatch}% of words`];
    case "buildVideo":
      return [
        `Quality: ${levelName(nodeLevel(s))}${s.depth ? ` · ${BUILD_EXTRAS[0].short}` : ""}${+s.timeLimit > 0 ? ` · ${s.timeLimit} min limit` : ""}`,
        s.notes ? "With your instructions" : "",
      ].filter(Boolean);
    case "qualityCheck":
      return [`Layout ≤ ${s.maxLayout} · length ±${s.lengthTol}%${s.blank ? " · blank shots" : ""}`, FAIL[s.onFail] ?? ""];
    case "soundDesign":
      return [s.strict ? "Stops if the voice is buried" : "Music, ambience, effects"];
    case "render":
      return [`${s.quality === "uhd" ? "4K" : "Full HD"}${s.captions ? " · captions file" : " · no captions file"}`];
    case "vertical":
      return [
        `${s.source === "reframe" ? "Reframed by Claude" : s.fit === "blur" ? "Fit on blur" : "Crop to fill"} · ${s.length === "trailer" ? `trailer ${s.max}s` : "full"}`,
        [s.captions && "captions", s.endCard && "end card"].filter(Boolean).join(" · "),
      ].filter(Boolean);
    case "thumbnail": {
      const n22 = Math.min(8, Math.max(1, Math.round(+s.count || 1))),
        many = n22 > 1 ? [`${n22} variations${s.pickBest !== false ? " · Claude picks the best" : ""}`] : [];
      return s.mode === "frame"
        ? [`Frame at ${s.at}%`]
        : s.mode === "ai"
          ? ["AI picture from your template", ...many]
          : s.mode === "refs"
            ? [`In the style of ${(s.refImages ?? []).length} reference thumbnail${(s.refImages ?? []).length === 1 ? "" : "s"}`, ...many]
            : ["AI picture designed by Claude", `Learns from ${s.learn} thumbnails${s.refs ? " · finds references" : ""}`, ...many];
    }
    case "titleDesc":
      return [
        s.ytChannel ? `In ${c.ytAny(s.ytChannel) ?? "the channel"}'s title style` : "In the channel's title style",
        ["3 title options", s.chapters ? "chapters" : "", "tags"].filter(Boolean).join(" · "),
      ];
    case "approval":
      return [s.note || "Waits for you"];
    case "moveStage":
      return [`To ${String(s.stage || "review").replace(/^./, (x) => x.toUpperCase())}`];
    case "notify":
      return [s.text || "", s.open ? "Opens the exports folder" : ""].filter(Boolean);
    case "upload":
      return [
        s.ytChannel ? (c.yt(s.ytChannel) ?? "Channel not signed in") : "No channel picked",
        s.privacy === "scheduled"
          ? `Scheduled, ${s.publishIn} h later`
          : String(s.privacy || "private").replace(/^./, (x) => x.toUpperCase()),
      ];
  }
  return [];
}
const fmtLen = (s) => {
  if (typeof s === "string") return s;
  s = +s || 0;
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : `${s} s`;
};
