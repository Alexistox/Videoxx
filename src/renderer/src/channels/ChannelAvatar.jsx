import { useEffect, useState } from "react";
import { CircleDashed } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16),
    f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
  return /^#[0-9a-f]{6}$/i.test(hex) ? 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255) : 0.5;
};
export const inkOn = (c) => (lum(c) < 0.18 ? "#f2f2f2" : "#141414");
export function markColor(c) {
  if (!/^#[0-9a-f]{6}$/i.test(c) || lum(c) >= 0.15) return c;
  const n = parseInt(c.slice(1), 16),
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let t = 0.1; t <= 1; t += 0.05) {
    const m =
      "#" +
      rgb
        .map((v) =>
          Math.round(v + (255 - v) * t)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (lum(m) >= 0.15) return m;
  }
  return "#9a9a9a";
}
export const initials = (name) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase() || "?";
export function ChannelAvatar({ c, size = 28 }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [c?.avatarUrl]);
  if (!c)
    return (
      <span className="ch-av none" style={{ width: size, height: size }} aria-hidden="true">
        <CircleDashed size={Math.round(size * 0.6)} strokeWidth={1.6} />
      </span>
    );
  return (
    <span
      className={`ch-av ${lum(c.color) < 0.05 ? "dark" : ""}`}
      style={{ width: size, height: size, background: c.color, color: inkOn(c.color), fontSize: Math.max(9, Math.round(size * 0.38)) }}
      aria-hidden="true"
    >
      {c.avatarUrl && !broken ? <img src={c.avatarUrl} alt="" draggable={false} onError={() => setBroken(true)} /> : initials(c.name)}
    </span>
  );
}
export function ChannelChip({ c, onClick, title, chipRef }) {
  const body = (
    <>
      <i style={{ background: c ? markColor(c.color) : "transparent" }} className={c ? "" : "none"} />
      <span className="ellipsis" dir="auto">
        {c ? c.name : "No channel"}
      </span>
    </>
  );
  return onClick ? (
    <button
      ref={chipRef}
      type="button"
      className={`ch-chip ${c ? "" : "ch-chip-none"}`}
      onClick={onClick}
      title={title ?? (c ? `Channel: ${c.name}. Click to move it.` : "Not in a channel. Click to pick one.")}
    >
      {body}
    </button>
  ) : (
    <span className={`ch-chip ${c ? "" : "ch-chip-none"}`} title={c ? `Channel: ${c.name}` : "No channel"}>
      {body}
    </span>
  );
}
