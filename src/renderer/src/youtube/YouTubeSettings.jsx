import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import {
  BookOpen,
  Copy,
  Ellipsis,
  ExternalLink,
  LogIn,
  Plus,
  RefreshCw,
  Trash,
  TriangleAlert,
  Unplug,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Spinner } from "../components/ui";
import { ActionMenu } from "../channels/ActionMenu";
import { channelUrl, dateShort, since } from "./format";
import { YtAvatar, levelText, useYtStatus } from "./useYtStatus";
import { SetupGuide } from "./SetupGuide";
import { LinkPicker } from "./LinkStep";
import { AddChannelDialog } from "./AddChannelDialog";
import { SignInDialog } from "./SignInDialog";
import { DisconnectDialog, ForgetDialog, RemoveDialog } from "./ChannelDialogs";

function ChannelRow({ c, step, onSignIn, onRemove, onDisconnect }) {
  const { toast } = useApp();
  const [menu, setMenu] = useState(null);
  const out = c.access === "oauth" && !c.signedIn,
    busy = !!step || c.syncing;
  const refresh = () => api.ytSync(c.id).catch((e) => toast(e.message, "bad"));
  const items = [
    { value: "refresh", label: "Read it again now", icon: <RefreshCw size={14} strokeWidth={1.8} />, disabled: busy, run: refresh },
    {
      value: "signin",
      label: c.signedIn ? "Sign in with Google again" : out ? "Sign in again" : "Sign in for full analytics",
      icon: <LogIn size={14} strokeWidth={1.8} />,
      run: onSignIn,
    },
    {
      value: "open",
      label: "Open on YouTube",
      icon: <ExternalLink size={14} strokeWidth={1.8} />,
      run: () => api.external(channelUrl(c)).catch(() => {}),
    },
    {
      value: "copy",
      label: "Copy channel ID",
      icon: <Copy size={14} strokeWidth={1.8} />,
      run: () => api.copy(c.id).then(() => toast("Channel ID copied.")),
    },
    // also for a sign-in Google ended: public stats only, without the "sign in again" warning
    // (a word joiner after the hyphen: "sign-in" never breaks as "sign-" / "in")
    ...(c.access === "oauth" || c.signedIn
      ? [
          {
            value: "disconnect",
            label: "Stop using the Google sign-⁠in…",
            keywords: "sign-in disconnect",
            hint: "Keeps public stats",
            icon: <Unplug size={14} strokeWidth={1.8} />,
            group: " ",
            run: onDisconnect,
          },
        ]
      : []),
    {
      value: "remove",
      label: "Stop following…",
      icon: <Trash size={14} strokeWidth={1.8} className="ch-danger" />,
      group: " ",
      run: onRemove,
    },
  ];
  return (
    <div className={`yt-set-row ${out ? "out" : ""}`} data-yt={c.id}>
      <YtAvatar c={c} size={34} />
      <div className="yt-set-txt">
        <b className="ellipsis" dir="auto" title={c.title}>
          {c.title}
        </b>
        <small className="ellipsis">
          {[c.handle, levelText(c), busy ? (step ?? "Reading…") : `read ${since(c.fetchedAt)}`].filter(Boolean).join(" · ")}
        </small>
        {out && (
          <small className="yt-set-warn">
            <TriangleAlert size={11} />
            {"Google ended the sign-in. "}
            <button className="text-btn link" onClick={onSignIn}>
              Sign in again
            </button>
          </small>
        )}
        {!out && c.error && (
          <small className="yt-set-warn" title={c.error}>
            <TriangleAlert size={11} />
            <span className="ellipsis">{c.error}</span>
          </small>
        )}
        {c.signedIn && c.expires && (
          <small
            className="yt-set-note"
            title="Your Google app is in Testing: Google ends its sign-ins after 7 days. To stay signed in, publish it (guide, step 4), then sign in again."
          >
            {"Google signs you out on "}
            {dateShort(c.expires)}
            {" (app in Testing)"}
          </small>
        )}
      </div>
      <LinkPicker yt={c} id={`yt-set-link-${c.id}`} />
      <button className="icon-btn sm" onClick={refresh} disabled={busy} aria-label={`Read ${c.title} again`} title="Read it again now">
        {busy ? <Spinner size={13} /> : <RefreshCw size={15} strokeWidth={1.8} />}
      </button>
      <button
        className="icon-btn sm"
        aria-label={`${c.title}: menu`}
        onClick={(e) => {
          const el = e.currentTarget;
          setMenu((m) => (m === el ? null : el));
        }}
      >
        <Ellipsis size={16} strokeWidth={1.8} />
      </button>
      {menu && <ActionMenu at={menu} label={`${c.title}: menu`} onClose={() => setMenu(null)} items={items} width={300} />}
    </div>
  );
}
export function useYtDialogs(opts) {
  const [d, setD] = useState(null);
  const guide = (focus) => setD({ k: "guide", focus });
  const signIn = () => setD((d2) => (d2?.k === "signin" ? d2 : { k: "signin", n: Date.now() }));
  const added = opts?.onAdded;
  const ui = (
    <>
      {d?.k === "guide" && <SetupGuide focus={d.focus} onClose={() => setD(null)} onSignIn={signIn} />}
      {d?.k === "add" && <AddChannelDialog onClose={() => setD(null)} onGuide={() => guide("key")} onAdded={(c) => added?.(c.id)} />}
      {d?.k === "signin" && (
        <SignInDialog key={d.n} onClose={() => setD(null)} onGuide={() => guide("client")} onAdded={(ids) => ids[0] && added?.(ids[0])} />
      )}
      {d?.k === "remove" && <RemoveDialog yt={d.yt} onClose={() => setD(null)} />}
      {d?.k === "disconnect" && <DisconnectDialog yt={d.yt} onClose={() => setD(null)} onGuide={() => guide("key")} />}
      {d?.k === "forget" && <ForgetDialog what={d.what} onClose={() => setD(null)} />}
    </>
  );
  return {
    ui,
    guide,
    add: () => setD({ k: "add" }),
    signIn,
    remove: (yt) => setD({ k: "remove", yt }),
    disconnect: (yt) => setD({ k: "disconnect", yt }),
    forget: (what) => setD({ k: "forget", what }),
  };
}
export function YouTubeSettings() {
  const { status, steps } = useYtStatus();
  const dlg = useYtDialogs();
  const startSignIn = () => (status?.client.has ? dlg.signIn() : dlg.guide("client"));
  return (
    <section className="panel" style={{ marginTop: 25 }} aria-label="YouTube">
      <div className="settings-row">
        <div className="l">
          <h3>YouTube</h3>
          <p>
            Your channels' numbers in the app (the YouTube page) and on the Channels board. Public stats work with a free Google API key;
            full analytics of your own channels need a sign-in with Google through your own Google Cloud app. Keys and sign-ins are stored
            encrypted on this computer.
          </p>
        </div>
        <div className="r">
          <div className="opt">
            <span>
              Setup guide<small>About ten minutes, once: your own free Google Cloud project.</small>
            </span>
            <button className="btn small" onClick={() => dlg.guide()}>
              <BookOpen size={14} />
              Open the guide
            </button>
          </div>
          <div className="opt">
            <span>
              Google API key (public stats)
              <small>{!status ? "Checking…" : status.key.hasKey ? `Saved, ends in …${status.key.hint}` : "Not added yet"}</small>
            </span>
            <span className="yt-opt-acts">
              {status?.key.hasKey && (
                <button className="btn small ghost" onClick={() => dlg.forget("key")}>
                  Remove
                </button>
              )}
              <button className="btn small" onClick={() => dlg.guide("key")}>
                {status?.key.hasKey ? "Change" : "Add key"}
              </button>
            </span>
          </div>
          <div className="opt">
            <span>
              Google sign-in app (full analytics)
              <small>
                {!status
                  ? "Checking…"
                  : status.client.own
                    ? `Your Desktop client, ${status.client.id}`
                    : status.client.builtin
                      ? "Built into the app"
                      : "Not set up yet: steps 4 and 5 of the guide"}
              </small>
            </span>
            <span className="yt-opt-acts">
              {status?.client.own && (
                <button
                  className="btn small ghost"
                  onClick={() => dlg.forget("client")}
                  title={status.client.hasBuiltin ? "Go back to the sign-in built into the app" : void 0}
                >
                  Remove
                </button>
              )}
              <button className="btn small" onClick={() => dlg.guide("client")}>
                {status?.client.own ? "Change" : "Set up"}
              </button>
            </span>
          </div>
          <div className="yt-set-list" aria-label="YouTube channels you follow">
            {status?.channels.map((c) => (
              <ChannelRow
                key={c.id}
                c={c}
                step={steps[c.id]}
                onSignIn={startSignIn}
                onRemove={() => dlg.remove(c)}
                onDisconnect={() => dlg.disconnect(c)}
              />
            ))}
            {status && !status.channels.length && (
              <p className="small dim yt-set-empty">
                No channels yet. Follow any channel for public stats, or sign in with Google for full analytics of your own.
              </p>
            )}
          </div>
          <div className="row wrap">
            <button className="btn small" onClick={dlg.add}>
              <Plus size={14} />
              Follow a channel
            </button>
            <button className="btn small primary" onClick={startSignIn}>
              <LogIn size={14} />
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
      {dlg.ui}
    </section>
  );
}
