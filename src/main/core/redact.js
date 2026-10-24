const SECRETS = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/gi,
  /\b(api[_-]?key|apikey|secret|token|password|passwd|auth|sig|signature|key)(["']?\s*[:=]\s*["'`]?)[^\s"'`&,;]{8,}/gi,
];
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const forms = (p) => [...new Set([p, p.replace(/\\/g, "/"), p.replace(/\//g, "\\")])];
export function redact(text, opt = {}) {
  let t = String(text ?? "");
  const roots = (opt.roots ?? []).filter(([p]) => p && p.length > 3).sort((a, b) => b[0].length - a[0].length);
  for (const [p, rep] of roots) for (const f of forms(p)) t = t.replace(new RegExp(esc(f), "gi"), rep);
  t = t
    .replace(/file:\/\/\/?[^\s'"`)]+/gi, "file://<path>")
    .replace(/\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"`]+/gi, "~")
    .replace(/(^|[\s'"`(=:])\/(?:Users|home)\/[^/\s'"`]+/g, "$1~");
  for (const r of SECRETS)
    t = t.replace(r, (m, k, sep) =>
      k && sep !== void 0 && typeof k === "string" && /^[a-z_-]+$/i.test(k) ? `${k}${sep}<secret>` : "<secret>",
    );
  t = t
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>");
  if (opt.user && opt.user.length > 2 && !/^(user|admin|root|test)$/i.test(opt.user))
    t = t.replace(new RegExp(`\\b${esc(opt.user)}\\b`, "gi"), "<user>");
  return t;
}
export function redactError(text, opt = {}, max = 600) {
  const lines = redact(text, opt)
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const out = [];
  for (const l of lines) if (out[out.length - 1] !== l) out.push(l);
  const s = out.join("\n");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
