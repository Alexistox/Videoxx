import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import { resourcesDir } from "../core/workspace";
import { log } from "../core/log";
import { getSecret, secretHint, setSecret } from "../core/secrets";
import { openExternal } from "../core/openExternal";

const REAL = {
  data: "https://www.googleapis.com",
  analytics: "https://youtubeanalytics.googleapis.com",
  token: "https://oauth2.googleapis.com",
  auth: "https://accounts.google.com",
};
export const base = (k) => (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_YOUTUBE_BASE) || REAL[k];
export const SCOPE_DATA = "https://www.googleapis.com/auth/youtube.readonly",
  SCOPE_ANALYTICS = "https://www.googleapis.com/auth/yt-analytics.readonly";
const KEY = "youtube.apiKey",
  CLIENT = "youtube.client",
  TOKEN = (channelId) => `youtube.token.${channelId}`;
export function keyStatus() {
  const hint = secretHint(KEY);
  return { hasKey: !!hint, hint };
}
export const apiKey = () => getSecret(KEY);
export async function setApiKey(key2) {
  if (!key2) {
    setSecret(KEY, null);
    return keyStatus();
  }
  key2 = String(key2)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (/^GOCSPX-/.test(key2))
    throw new Error(
      "That is a client secret (it starts with GOCSPX-). The API key starts with AIza: Google Cloud > APIs & Services > Credentials > API keys.",
    );
  if (/\.apps\.googleusercontent\.com$/.test(key2))
    throw new Error("That is a client ID. The API key starts with AIza: Google Cloud > APIs & Services > Credentials > API keys.");
  if (!/^AIza[\w-]{30,}$/.test(key2))
    throw new Error(
      "That does not look like a Google API key. It starts with AIza and is 39 characters long (Google Cloud > APIs & Services > Credentials).",
    );
  await getJson(`${base("data")}/youtube/v3/channels?part=id&id=UC_x5XG1OV2P6uZZ5FSM9Ttw&key=${encodeURIComponent(key2)}`, "data");
  setSecret(KEY, key2);
  return keyStatus();
}
const CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;
function builtinClient() {
  try {
    const f =
      (process.env.CZ_TEST_HOOKS === "1" && process.env.CZ_GOOGLE_OAUTH_FILE) ||
      path.join(resourcesDir(), "resources", "google-oauth.json");
    if (!fs.existsSync(f)) return null;
    const c = readClientJson(fs.readFileSync(f, "utf8"));
    return { ...c, builtin: true };
  } catch (e) {
    log("built-in Google client unreadable", e?.message);
    return null;
  }
}
function readClientJson(text) {
  let o;
  try {
    o = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error(
      "That file is not the client file from Google Cloud (it is not JSON). Download it again from Clients, then the download button of your Desktop client.",
    );
  }
  if (o?.web)
    throw new Error('That is a Web application client. Make a client of the type "Desktop app" (step 5 of the guide) and use that one.');
  const c = o?.installed ?? o;
  const id = String(c?.client_id ?? "").trim(),
    secret = String(c?.client_secret ?? "").trim();
  if (!CLIENT_ID.test(id))
    throw new Error("That file has no Desktop app client in it. Download the JSON of a Desktop app client from Google Cloud > Clients.");
  if (!secret)
    throw new Error("That file has no client secret in it. Download the JSON of your Desktop app client again (Google Cloud > Clients).");
  return { id, secret };
}
function client() {
  const own = getSecret(CLIENT);
  if (own)
    try {
      const c = JSON.parse(own);
      if (c?.id) return { id: c.id, secret: c.secret ?? "", builtin: false };
    } catch {}
  return builtinClient();
}
export function clientStatus() {
  const c = client();
  return {
    has: !!c,
    builtin: !!c?.builtin,
    own: !!getSecret(CLIENT),
    hasBuiltin: !!c?.builtin || !!builtinClient(),
    id: c ? `ending in …${c.id.replace(/\.apps\.googleusercontent\.com$/, "").slice(-6)}` : null,
  };
}
export function setClient(o) {
  if (!o) {
    setSecret(CLIENT, null);
    return clientStatus();
  }
  let id = String(o.id ?? "").trim(),
    secret = String(o.secret ?? "").trim();
  if (o.file) {
    const f = String(o.file);
    if (!/\.json$/i.test(f) || !fs.existsSync(f)) throw new Error("Pick the .json file you downloaded for your Desktop client.");
    if (fs.statSync(f).size > 64 * 1024) throw new Error("That file is too big to be a client file from Google Cloud.");
    ({ id, secret } = readClientJson(fs.readFileSync(f, "utf8")));
  }
  if (/^AIza/.test(id)) throw new Error("That is an API key. The client ID ends in .apps.googleusercontent.com (Google Cloud > Clients).");
  if (!CLIENT_ID.test(id))
    throw new Error(
      "A client ID looks like 1234567890-abc123.apps.googleusercontent.com. Copy it from your Desktop app client in Google Cloud > Clients.",
    );
  if (!secret)
    throw new Error(
      "Paste the client secret too. It is next to the client ID in Google Cloud > Clients (it starts with GOCSPX-); Google asks for it when you sign in.",
    );
  if (!/^[\w-]{10,}$/.test(secret))
    throw new Error("That client secret looks wrong. It usually starts with GOCSPX- (copy it from the same client).");
  setSecret(CLIENT, JSON.stringify({ id, secret }));
  return clientStatus();
}
const access = new Map();
const stored = new Map();
export function tokenOf(channelId) {
  if (stored.has(channelId)) return stored.get(channelId);
  let t = null;
  try {
    const s = getSecret(TOKEN(channelId));
    t = s ? JSON.parse(s) : null;
  } catch {
    t = null;
  }
  stored.set(channelId, t);
  return t;
}
export const hasToken = (channelId) => !!tokenOf(channelId);
function saveToken(channelId, t) {
  setSecret(TOKEN(channelId), t ? JSON.stringify(t) : null);
  stored.set(channelId, t);
  if (!t) access.delete(channelId);
}
export const grantedAnalytics = (channelId) => !!tokenOf(channelId)?.scope.split(/\s+/).includes(SCOPE_ANALYTICS);
const SCOPE_UPLOAD = "https://www.googleapis.com/auth/youtube.upload";
export const grantedUpload = (channelId) => !!tokenOf(channelId)?.scope.split(/\s+/).includes(SCOPE_UPLOAD);
export const tokenExpires = (channelId) => tokenOf(channelId)?.expires ?? null;
export class SignedOut extends Error {
  signedOut = true;
}
async function tokenRequest(form) {
  const renew = form.grant_type === "refresh_token";
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${base("token")}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(3e4),
    }).catch((e) => {
      log("google token request failed", e?.cause?.code || e?.name, e?.message);
      throw Object.assign(new Error("Could not reach Google. Check the internet connection and try again."), { network: true });
    });
    const text = await r.text();
    let b = null;
    try {
      b = JSON.parse(text);
    } catch {
      b = null;
    }
    if (r.ok && b?.access_token) return b;
    log("google token error", r.status, text.slice(0, 400));
    const err = String(b?.error ?? "");
    if (err === "invalid_grant")
      throw new SignedOut("Google ended this sign-in (it was removed, it expired, or the password changed). Sign in with Google again.");
    if (err === "invalid_client" || err === "unauthorized_client")
      throw Object.assign(
        new Error("Google did not accept your app's client ID or secret. Check them in Settings > YouTube (step 5 of the guide)."),
        { badClient: true },
      );
    if (r.status >= 500 || /^(internal_failure|backend_error|temporarily_unavailable|server_error)$/i.test(err)) {
      if (attempt === 0) {
        await new Promise((res) => setTimeout(res, 1200));
        continue;
      }
      throw Object.assign(
        new Error(
          renew
            ? "Google's sign-in service did not answer just now. Try again in a minute: you are still signed in."
            : "Google's sign-in service did not answer just now. Start the sign-in again in a minute.",
        ),
        { transient: true },
      );
    }
    throw new Error(
      renew
        ? "Google did not renew this channel's sign-in just now. Try again in a minute; if it keeps happening, sign in with Google again."
        : "Google could not finish the sign-in. Start it again; if it keeps happening, check your Google app in Settings > YouTube (steps 4 and 5 of the guide).",
    );
  }
}
export async function accessToken(channelId) {
  const a = access.get(channelId);
  if (a && a.exp > Date.now() + 6e4) return a.token;
  const t = tokenOf(channelId);
  if (!t) throw new SignedOut("This channel is not signed in with Google.");
  const ask = (secret) =>
    tokenRequest({
      grant_type: "refresh_token",
      refresh_token: t.refresh,
      client_id: t.clientId,
      ...(secret ? { client_secret: secret } : {}),
    });
  const c = client(),
    fresh = c && c.id === t.clientId && c.secret && c.secret !== t.clientSecret ? c.secret : null;
  let r;
  try {
    if (fresh) {
      try {
        r = await ask(fresh);
        saveToken(channelId, { ...t, clientSecret: fresh });
      } catch (e) {
        if (!e?.badClient) throw e;
        r = await ask(t.clientSecret);
      }
    } else r = await ask(t.clientSecret);
  } catch (e) {
    if (e?.badClient)
      throw new SignedOut(
        "Google no longer accepts the sign-in app this channel signed in with (its client or secret was changed or deleted). Sign in with Google again.",
      );
    throw e;
  }
  access.set(channelId, { token: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1e3 });
  return r.access_token;
}
export const dropAccess = (channelId) => {
  access.delete(channelId);
};
export async function revoke(channelId) {
  const t = tokenOf(channelId);
  if (!t) return;
  if (!sharedWith(t.refresh, channelId)) await revokeToken(t.refresh);
  saveToken(channelId, null);
}
export function revokeToken(token) {
  return fetch(`${base("token")}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(15e3),
  }).then(
    () => void 0,
    (e) => log("google revoke failed (removed here anyway)", e?.message),
  );
}
let sharedWith = () => false;
export const setSharedCheck = (fn) => {
  sharedWith = fn;
};
function explain(status, body, kind, url = "") {
  const e = body?.error ?? {},
    reasons = [...(e.errors ?? []).map((x) => x?.reason), ...(e.details ?? []).map((x) => x?.reason)].filter(Boolean).map(String);
  const has = (...r) => reasons.some((x) => r.includes(x)),
    msg = String(e.message ?? "");
  const api = kind === "analytics" ? "YouTube Analytics API" : "YouTube Data API v3";
  let text;
  if (has("API_KEY_INVALID", "keyInvalid") || /API key not valid/i.test(msg))
    text = "Google did not accept the API key. Check that you copied all of it (Settings > YouTube).";
  else if (
    has(
      "API_KEY_SERVICE_BLOCKED",
      "API_KEY_HTTP_REFERRER_BLOCKED",
      "API_KEY_IP_ADDRESS_BLOCKED",
      "API_KEY_ANDROID_APP_BLOCKED",
      "API_KEY_IOS_APP_BLOCKED",
    )
  )
    text = `This API key is not allowed to use the ${api}. In Google Cloud > Credentials, edit the key and allow the ${api} (or remove the key's restrictions).`;
  else if (has("accessNotConfigured", "SERVICE_DISABLED") || /has not been used in project|is disabled/i.test(msg))
    text = `The ${api} is not switched on in your Google Cloud project. Switch it on (step 2 of the guide in Settings > YouTube), wait a minute, then try again.`;
  else if (has("quotaExceeded", "dailyLimitExceeded", "RATE_LIMIT_EXCEEDED", "rateLimitExceeded", "userRateLimitExceeded"))
    text =
      "Your Google project used up today's YouTube quota. It starts again at midnight Pacific time; the app keeps showing the numbers it already has.";
  else if (has("insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT") && /\/commentThreads\b|\/comments\b/.test(url))
    text = "YouTube shares comments with the app only through a Google API key: add one in Settings > YouTube.";
  else if (has("insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
    text =
      kind === "analytics"
        ? "You did not allow the app to see your YouTube Analytics when you signed in. Sign in with Google again and tick both boxes."
        : "You did not allow the app to see your YouTube account when you signed in. Sign in with Google again and tick both boxes.";
  else if (has("channelNotFound") || status === 404) text = "YouTube has no channel like that.";
  else if (has("forbidden", "channelForbidden"))
    text = "YouTube does not share this with the app (it is not your channel, or the channel limits it).";
  else if (status === 401) text = "Google did not accept the sign-in. Sign in with Google again.";
  else if (status >= 500) text = "YouTube had a problem answering just now. Try again in a minute.";
  else text = `YouTube answered ${status}: ${msg.slice(0, 200) || "no details"}`;
  const err = new Error(text);
  err.status = status;
  err.reasons = reasons;
  return err;
}
export async function getJson(url, kind, bearer) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      headers: { Accept: "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      signal: AbortSignal.timeout(3e4),
    }).catch((e) => {
      log("youtube request failed", e?.cause?.code || e?.name, e?.message);
      throw Object.assign(new Error("Could not reach YouTube. Check the internet connection and try again."), { network: true });
    });
    const text = await r.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (r.ok) return body ?? {};
    if (r.status >= 500 && attempt === 0) {
      await new Promise((res) => setTimeout(res, 1200));
      continue;
    }
    log("youtube api error", r.status, url.replace(/key=[^&]+/, "key=…").slice(0, 220), text.slice(0, 500));
    throw explain(r.status, body, kind, url.split("?")[0]);
  }
}
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let flow = null;
const PAGE = (title, text, ok) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#171717;color:#e8e8e8;font:15px/1.5 -apple-system,Segoe UI,Inter,Arial,sans-serif}
main{max-width:440px;padding:34px 36px;border:1px solid #333;border-radius:18px;background:#202020;text-align:center}
b{display:block;font-size:20px;margin-bottom:8px;color:${ok ? "#89bea4" : "#db9393"}}p{margin:0;color:#a8a8a8}</style></head>
<body><main><b>${title}</b><p>${text}</p></main></body></html>`;
export function signIn(upload = false) {
  const c = client();
  if (!c)
    return Promise.reject(
      new Error("Set up your Google app first: follow the guide in Settings > YouTube (it takes about 10 minutes, once)."),
    );
  flow?.cancel("Sign-in cancelled: a new one started.");
  const verifier = b64url(crypto.randomBytes(48)),
    challenge = b64url(crypto.createHash("sha256").update(verifier).digest()),
    state = b64url(crypto.randomBytes(24));
  return new Promise((resolve, reject) => {
    let done = false,
      redirect = "",
      timer;
    const finish = (err, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => server.close(), 300);
      flow = null;
      if (err) reject(err);
      else resolve(v);
    };
    const server = http.createServer(async (req, res) => {
      const port = server.address().port;
      if (req.headers.host !== `127.0.0.1:${port}`) {
        res.writeHead(403);
        return res.end();
      }
      const u = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (u.pathname !== "/oauth2callback") {
        res.writeHead(404);
        return res.end();
      }
      const send = (code2, title, text, ok) => {
        res.writeHead(code2, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(PAGE(title, text, ok));
      };
      if (u.searchParams.get("state") !== state)
        return send(400, "This sign-in page is out of date", "Start the sign-in again from Videoxx.", false);
      const err = u.searchParams.get("error");
      if (err) {
        send(
          200,
          err === "access_denied" ? "Sign-in cancelled" : "Sign-in did not work",
          "You can close this tab and go back to Videoxx.",
          false,
        );
        if (err !== "access_denied") log("google sign-in answered", err, u.searchParams.get("error_description") ?? "");
        return finish(
          new Error(
            err === "access_denied"
              ? "You cancelled the Google sign-in (or did not allow access). Nothing was connected."
              : /^(org_internal|admin_policy_enforced)$/.test(err)
                ? "Google did not allow this account to sign in to your app (its organisation or the app's audience limits it). Use the account that owns the channel, and check that the app's audience is External (step 4 of the guide)."
                : "Google could not sign you in. Start again; if it keeps happening, check your Google app (steps 4 and 5 of the guide in Settings > YouTube).",
          ),
        );
      }
      const code = u.searchParams.get("code");
      if (!code) return send(400, "Sign-in did not work", "Google sent no sign-in code. Start again from Videoxx.", false);
      try {
        const t = await tokenRequest({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: redirect,
          client_id: c.id,
          ...(c.secret ? { client_secret: c.secret } : {}),
        });
        if (!t.refresh_token)
          throw new Error(
            "Google did not give the app a lasting sign-in. Remove the app's access at myaccount.google.com/permissions, then sign in again.",
          );
        const scope = t.scope ?? "";
        if (!scope.split(/\s+/).includes(SCOPE_DATA))
          throw new Error("You did not allow the app to see your YouTube account. Sign in again and tick the boxes Google shows.");
        send(200, "You are signed in", "Videoxx can see your channel now. Close this tab and go back to the app.", true);
        finish(null, {
          accessToken: t.access_token,
          accessExpires: Date.now() + (t.expires_in || 3600) * 1e3,
          refresh: t.refresh_token,
          scope,
          expires: t.refresh_token_expires_in ? new Date(Date.now() + t.refresh_token_expires_in * 1e3).toISOString() : null,
        });
      } catch (e) {
        send(200, "Sign-in did not work", "Go back to Videoxx: it says what to do.", false);
        finish(e);
      }
    });
    server.on("error", (e) => {
      log("google sign-in: the loopback server failed", e.code, e.message);
      finish(new Error("The app could not wait for Google's answer on this computer. Try again; if it keeps happening, restart the app."));
    });
    server.listen(0, "127.0.0.1", () => {
      redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;
      const q = new URLSearchParams({
        client_id: c.id,
        redirect_uri: redirect,
        response_type: "code",
        scope: `${SCOPE_DATA} ${SCOPE_ANALYTICS}${upload ? " " + SCOPE_UPLOAD : ""}`,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        prompt: "select_account consent",
        include_granted_scopes: "true",
      });
      const url = `${base("auth")}/o/oauth2/v2/auth?${q}`;
      flow = { server, url, cancel: (why) => finish(Object.assign(new Error(why || "Sign-in cancelled."), { cancelled: true })) };
      timer = setTimeout(
        () => finish(new Error("The Google sign-in took longer than 10 minutes, so it was stopped. Start it again when you are ready.")),
        10 * 6e4,
      );
      openExternal(url).catch((e) => {
        log("google sign-in: the browser did not open", e?.message);
        finish(new Error("Your browser could not be opened for the Google sign-in. Check that a default browser is set, then try again."));
      });
    });
  });
}
export const signInOpen = () => !!flow;
export function cancelSignIn() {
  flow?.cancel();
}
export function reopenSignIn() {
  if (flow) openExternal(flow.url);
  return !!flow;
}
export function storeToken(channelId, r) {
  const c = client();
  saveToken(channelId, {
    refresh: r.refresh,
    scope: r.scope,
    clientId: c.id,
    clientSecret: c.secret,
    expires: r.expires,
    at: new Date().toISOString(),
  });
  access.set(channelId, { token: r.accessToken, exp: r.accessExpires });
}
export function forgetToken(channelId) {
  saveToken(channelId, null);
}
