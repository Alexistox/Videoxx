import { unaccent } from "./text";

const STEM_MAX = 120;
export function fileStem(s) {
  return unaccent(String(s ?? ""))
    .replace(/\s+/g, "_")
    .replace(/[^\w-]/g, "")
    .replace(/_{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, STEM_MAX)
    .replace(/[_-]+$/, "");
}
