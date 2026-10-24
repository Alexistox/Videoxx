const STAGES = ["idea", "script", "voiceover", "building", "review", "ready", "scheduled", "published"];
export const isStage = (s) => typeof s === "string" && STAGES.includes(s);
const stageIndex = (s) => STAGES.indexOf(s);
export function effectiveStage(auto, manual, autoWhenSet) {
  if (!manual) return { stage: auto, manual: false, revert: false };
  if (manual === auto) return { stage: auto, manual: false, revert: true };
  if (autoWhenSet && auto !== autoWhenSet && stageIndex(auto) > stageIndex(manual)) return { stage: auto, manual: false, revert: true };
  return { stage: manual, manual: true, revert: false };
}
