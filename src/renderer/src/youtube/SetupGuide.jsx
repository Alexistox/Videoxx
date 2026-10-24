import { useEffect, useRef, useState } from "react";
import { CheckIcon, ExternalLinkIcon, FileBracesIcon, LogInIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Modal, Spinner } from "../components/ui";
import { isEnter } from "../channels/stages";
import { useYtStatus } from "./useYtStatus";

const GUIDE = {
  project: "https://console.cloud.google.com/projectcreate",
  dataApi: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  analyticsApi: "https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com",
  credentials: "https://console.cloud.google.com/apis/credentials",
  branding: "https://console.cloud.google.com/auth/branding",
  audience: "https://console.cloud.google.com/auth/audience",
  clients: "https://console.cloud.google.com/auth/clients",
};
const Ext = ({ url, children }) => {
  const { toast } = useApp();
  return (
    <button type="button" className="btn small yt-ext" onClick={() => api.external(url).catch((e) => toast(e.message, "bad"))} title={url}>
      <ExternalLinkIcon size={13} strokeWidth={1.9} />
      {children}
    </button>
  );
};
function Step({ n, title, done, children, refEl }) {
  return (
    <div className={`yt-step ${done ? "done" : ""}`} ref={refEl}>
      <span className="yt-step-n" aria-hidden="true">
        {done ? <CheckIcon size={14} strokeWidth={2.4} /> : n}
      </span>
      <div className="yt-step-b">
        <h4>
          {title}
          {done && <span className="yt-sr">{" (done)"}</span>}
        </h4>
        {children}
      </div>
    </div>
  );
}
export function SetupGuide({ onClose, focus, onSignIn }) {
  const { toast } = useApp();
  const { status } = useYtStatus();
  const [key, setKey] = useState(""),
    [cid, setCid] = useState(""),
    [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(null),
    [over, setOver] = useState(false);
  const [err, setErr] = useState({});
  const keyRef = useRef(null),
    clientRef = useRef(null);
  useEffect(() => {
    const el = focus === "key" ? keyRef.current : focus === "client" ? clientRef.current : null;
    if (el)
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: "center" });
        el.querySelector("input")?.focus();
      });
  }, []);
  const saveKey = async () => {
    if (!key.trim() || busy) return false;
    setBusy("key");
    setErr({});
    try {
      await api.ytSetKey(key);
      setKey("");
      toast("API key saved (encrypted on this computer).");
      return true;
    } catch (e) {
      setErr({ key: e.message });
      keyRef.current?.scrollIntoView({ block: "center" });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const saveClient = async (o) => {
    if (busy) return false;
    setBusy("client");
    setErr({});
    try {
      await api.ytSetClient(o);
      setCid("");
      setSecret("");
      toast("Your Google app is set up. Next: Sign in with Google.");
      return true;
    } catch (e) {
      setErr({ client: e.message });
      clientRef.current?.scrollIntoView({ block: "center" });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const typed = !!(key.trim() || cid.trim());
  const saveTyped = async () => {
    if (busy) return false;
    if (key.trim() && !(await saveKey())) return false;
    if (cid.trim() && !(await saveClient({ id: cid, secret }))) return false;
    return true;
  };
  const done = async () => {
    if (await saveTyped()) onClose();
  };
  const signInNow = async () => {
    if (await saveTyped()) {
      onClose();
      onSignIn?.();
    }
  };
  const pickJson = async () => {
    const f = await api.pickFile("Choose the client file you downloaded from Google Cloud", [
      { name: "Client file", extensions: ["json"] },
    ]);
    if (f) saveClient({ file: f });
  };
  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const p = window.suite.pathForFile(f);
    if (p) saveClient({ file: p });
  };
  const hasKey = !!status?.key.hasKey,
    hasClient = !!status?.client.has,
    builtin = !!status?.client.builtin && !status?.client.own;
  return (
    <Modal
      title="Set up YouTube"
      onClose={onClose}
      wide
      className="yt-guide"
      dirty={() => !!(key.trim() || cid.trim() || secret.trim())}
      focusField={false}
    >
      <div className="modal-body">
        <p className="yt-guide-intro">
          The app reads your numbers with your own free Google Cloud project, so nothing goes through anyone else. It takes about ten
          minutes, once.<b>{" Public stats"}</b>
          {" (subscribers, views, likes and comments of any channel) need steps 1 to 3. "}
          <b>Full analytics</b>
          {" of your own channels (watch time, how long people watch, where they come from) need all six."}
        </p>
        <Step n={1} title="Make a Google Cloud project">
          <p>
            {"Sign in with the Google account you use for YouTube, name the project (for example "}
            <i>Videoxx</i>) and click Create. It is free; no billing is needed.
          </p>
          <div className="row wrap">
            <Ext url={GUIDE.project}>Open Google Cloud</Ext>
          </div>
        </Step>
        <Step n={2} title="Switch on the two YouTube APIs">
          <p>
            {"With your new project selected at the top of the page, open each one and click "}
            <b>Enable</b>.
          </p>
          <div className="row wrap">
            <Ext url={GUIDE.dataApi}>YouTube Data API v3</Ext>
            <Ext url={GUIDE.analyticsApi}>YouTube Analytics API</Ext>
          </div>
        </Step>
        <Step n={3} title="Public stats: make an API key" done={hasKey} refEl={keyRef}>
          <p>
            {"On Credentials, click "}
            <b>Create credentials</b>
            {", then "}
            <b>API key</b>, and copy it. (You can restrict it to the YouTube Data API v3 there.) Paste it here:
          </p>
          {hasKey && (
            <p className="yt-saved">
              <CheckIcon size={13} strokeWidth={2.2} />
              Saved, ends in …{status.key.hint}. Paste another one to replace it.
            </p>
          )}
          <div className="row">
            <Ext url={GUIDE.credentials}>Open Credentials</Ext>
            <input
              className="input compact grow"
              type="password"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setErr((x) => ({ ...x, key: void 0 }));
              }}
              placeholder="AIza…"
              aria-label="Google API key"
              onKeyDown={(e) => {
                if (isEnter(e)) saveKey();
              }}
              spellCheck={false}
            />
            <button className="btn small primary" onClick={saveKey} disabled={!key.trim() || !!busy}>
              {busy === "key" && <Spinner size={13} />}Save key
            </button>
          </div>
          {err.key && (
            <p className="yt-err" role="alert">
              <TriangleAlertIcon size={13} />
              {err.key}
            </p>
          )}
        </Step>
        {builtin ? (
          <div className="note yt-builtin">
            <b>Full analytics:</b>
            {" this app has a Google sign-in built in, so steps 4 and 5 are not needed. You can still use your own Google app below."}
          </div>
        ) : null}
        <Step n={4} title="Full analytics: set up the sign-in screen" done={hasClient}>
          <p>
            {"Open "}
            <b>Google Auth Platform</b>
            {" and click "}
            <b>Get started</b>
            {": an app name (for example "}
            <i>Videoxx (mine)</i>), your email as the support email,<b>{" External"}</b>
            {" as the audience, and your email again as the contact. Then on "}
            <b>Audience</b>
            {", under Test users, click "}
            <b>Add users</b>
            {" and add the Google account that owns your channel."}
          </p>
          <p className="yt-tip-line">
            {"Google signs apps in "}
            <i>Testing</i>
            {" out after 7 days (the app reminds you). To stay signed in, click "}
            <b>Publish app</b>
            {` on the Audience page before you sign in (a sign-in made while it was in Testing still ends after 7 days). Google then shows "Google hasn't verified this app" when you sign in: it is your own app, so click `}
            <b>Advanced</b>
            {", then "}
            <b>Go to</b>
            {" your app."}
          </p>
          <div className="row wrap">
            <Ext url={GUIDE.branding}>Open Google Auth Platform</Ext>
            <Ext url={GUIDE.audience}>Audience and test users</Ext>
          </div>
        </Step>
        <Step n={5} title="Make the sign-in client" done={hasClient} refEl={clientRef}>
          <p>
            {"On "}
            <b>Clients</b>
            {", click "}
            <b>Create client</b>
            {", pick "}
            <b>Desktop app</b>
            {" as the type, name it and click Create. Then drop the downloaded JSON file here, or copy the client ID and secret."}
          </p>
          {hasClient && (
            <p className="yt-saved">
              <CheckIcon size={13} strokeWidth={2.2} />
              {status.client.own ? `Your client is saved (${status.client.id}).` : "Using the built-in sign-in."}
              {" Add another one to replace it."}
            </p>
          )}
          <div className="row wrap">
            <Ext url={GUIDE.clients}>Open Clients</Ext>
          </div>
          <button
            type="button"
            className={`yt-drop ${over ? "over" : ""}`}
            onClick={pickJson}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                setOver(true);
              }
            }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
            disabled={!!busy}
          >
            {over ? <UploadIcon size={17} strokeWidth={1.8} /> : <FileBracesIcon size={17} strokeWidth={1.8} />}
            <span>
              <b>{over ? "Drop it" : "Choose the client file…"}</b>
              <small>or drop the downloaded client_secret….json here</small>
            </span>
          </button>
          <div className="yt-client-fields">
            <input
              className="input compact"
              value={cid}
              onChange={(e) => {
                setCid(e.target.value);
                setErr((x) => ({ ...x, client: void 0 }));
              }}
              placeholder="Client ID: 1234…apps.googleusercontent.com"
              aria-label="Client ID"
              spellCheck={false}
              onKeyDown={(e) => {
                if (isEnter(e) && cid.trim()) saveClient({ id: cid, secret });
              }}
            />
            <input
              className="input compact"
              type="password"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setErr((x) => ({ ...x, client: void 0 }));
              }}
              placeholder="Client secret: GOCSPX-…"
              aria-label="Client secret"
              spellCheck={false}
              onKeyDown={(e) => {
                if (isEnter(e) && cid.trim()) saveClient({ id: cid, secret });
              }}
            />
            <button className="btn small primary" onClick={() => saveClient({ id: cid, secret })} disabled={!cid.trim() || !!busy}>
              {busy === "client" && <Spinner size={13} />}Save client
            </button>
          </div>
          {err.client && (
            <p className="yt-err" role="alert">
              <TriangleAlertIcon size={13} />
              {err.client}
            </p>
          )}
        </Step>
        <Step n={6} title="Sign in with Google">
          <p>
            Your browser opens Google's sign-in. Pick the account (or brand account) that owns the channel and allow both permissions.
            Several channels? Sign in once for each, picking it in Google's list. A channel you only manage through YouTube Studio
            permissions can't be read: sign in with the Google account that owns it.
          </p>
          <div className="row">
            <button
              className="btn small primary"
              disabled={(!hasClient && !cid.trim()) || !!busy}
              onClick={signInNow}
              title={hasClient || cid.trim() ? void 0 : "Do steps 4 and 5 first"}
            >
              <LogInIcon size={14} />
              Sign in with Google
            </button>
          </div>
        </Step>
        <div className="modal-actions">
          <span className="grow small dim">Keys and sign-ins are stored encrypted on this computer and only used by the app.</span>
          <button className={`btn ${typed ? "primary" : ""}`} onClick={done} disabled={!!busy}>
            {busy && <Spinner size={13} />}
            {typed ? "Save and close" : "Done"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
