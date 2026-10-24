const compactFmt = new Intl.NumberFormat(void 0, { notation: "compact", maximumFractionDigits: 1 });
export const compact = (n) => (n == null ? "—" : Math.abs(n) < 1e4 ? Math.round(n).toLocaleString() : compactFmt.format(n));
export const compactNum = (n) => compactFmt.format(n);
export const int = (n) => (n == null ? "—" : Math.round(n).toLocaleString());
export const hours = (min) => (min == null ? "—" : (min / 60).toLocaleString(void 0, { maximumFractionDigits: min / 60 < 100 ? 1 : 0 }));
export function clock(s) {
  if (s == null || !isFinite(s)) return "—";
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    x = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
}
export const pct = (v, digits = 0) => (v == null ? "—" : `${v.toFixed(digits)}%`);
export function dateShort(s, withYear) {
  if (!s) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : new Date(s);
  if (isNaN(+d)) return "—";
  return d.toLocaleDateString(void 0, {
    month: "short",
    day: "numeric",
    ...(withYear || d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}
export function since(s) {
  if (!s) return "never";
  const m = Math.round((Date.now() - Date.parse(s)) / 6e4);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
export const change = (cur, prev) =>
  prev == null || !isFinite(prev) ? null : prev === 0 ? (cur === 0 ? 0 : null) : ((cur - prev) / Math.abs(prev)) * 100;
const SOURCE_LABEL = {
  RELATED_VIDEO: "Suggested videos",
  YT_SEARCH: "YouTube search",
  SUBSCRIBER: "Browse features (home, subscriptions)",
  EXT_URL: "External (websites, Google search)",
  PLAYLIST: "Playlists",
  NO_LINK_OTHER: "Direct or unknown",
  NOTIFICATION: "Notifications",
  SHORTS: "Shorts feed",
  YT_CHANNEL: "Channel pages",
  END_SCREEN: "End screens",
  YT_OTHER_PAGE: "Other YouTube pages",
  NO_LINK_EMBEDDED: "Embedded players",
  ADVERTISING: "YouTube ads",
  HASHTAGS: "Hashtag pages",
  ANNOTATION: "Cards and annotations",
  CAMPAIGN_CARD: "Campaign cards",
  LIVE_REDIRECT: "Live redirects",
  PRODUCT_PAGE: "Product pages",
  PROMOTED: "YouTube promotion",
  SOUND_PAGE: "Sound pages",
  VIDEO_REMIXES: "Remixes",
  WATCH_WITH: "Watch with",
  YT_PLAYLIST_PAGE: "Playlist pages",
  HYPERLINK: "Links in YouTube",
};
export const sourceLabel = (s) =>
  SOURCE_LABEL[s] ??
  s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
export const videoUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
export const channelUrl = (c) =>
  c.handle ? `https://www.youtube.com/${encodeURIComponent(c.handle)}` : `https://www.youtube.com/channel/${encodeURIComponent(c.id)}`;
export const studioUrl = (videoId) =>
  `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/analytics/tab-overview/period-default`;
export const boardSays = (v) =>
  v.status === "scheduled"
    ? "The Channels board shows it as Scheduled, with the day it goes public."
    : v.status === "private"
      ? "The video is private: the Channels board shows the project as Published once the video is public (or as Scheduled once it has a date)."
      : "The Channels board shows it as Published, with its views.";
export const undoSays = (u, title, name) =>
  [
    u.undone ? `"${title}" is not linked now.` : `"${title}" was linked differently since, so its link stays as it is.`,
    u.left ? `"${name}" is back in no channel (it left ${u.left}).` : "",
  ]
    .filter(Boolean)
    .join(" ");
