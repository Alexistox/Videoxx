import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  BookOpen,
  ChartLine,
  Check,
  Clock3,
  Ellipsis,
  ExternalLink,
  Eye,
  Film,
  Info,
  KeyRound,
  Lightbulb,
  Link2,
  ListFilter,
  LogIn,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  ThumbsUp,
  Trash,
  TriangleAlert,
  Unplug,
  Users,
  Video,
  X,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Busy, Empty, Modal, Spinner } from "../components/ui";
import { Picker, Segmented } from "../components/Picker";
import { STAGE_LABEL, isEnter, swallowClicks } from "../channels/stages";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import { ActionMenu } from "../channels/ActionMenu";
import { ytPageChannel } from "../channels/ChannelEditor";
import {
  boardSays,
  change,
  channelUrl,
  clock,
  compact,
  dateShort,
  hours,
  int,
  pct,
  since,
  sourceLabel,
  studioUrl,
  undoSays,
  videoUrl,
} from "./format";
import { YtAvatar, levelText, useYtStatus } from "./useYtStatus";
import { LinkPicker } from "./LinkStep";
import { publicReader } from "./ChannelDialogs";
import { useYtDialogs } from "./YouTubeSettings";
import { Bars, DayChart, RetentionChart, Spark } from "./Charts";

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
export const showYouTube = (ytId) => store.set("cz-yt-channel", ytId);
const STALE = 4 * 36e5;
export function YouTube() {
  const { toast, channels } = useApp();
  const { status, steps } = useYtStatus();
  const [sel, setSelState] = useState(() => store.get("cz-yt-channel") ?? "");
  const setSel = (id) => {
    setSelState(id);
    store.set("cz-yt-channel", id);
  };
  const dlg = useYtDialogs({ onAdded: setSel });
  const list = status?.channels ?? [];
  const cur = list.find((c) => c.id === sel) ?? list[0] ?? null;
  const linkedId = cur?.linkedChannelId ?? null;
  useEffect(() => {
    ytPageChannel.id = linkedId;
    return () => {
      ytPageChannel.id = null;
    };
  }, [linkedId]);
  const [ov, setOv] = useState(null),
    [err, setErr] = useState(null);
  const curId = cur?.id ?? null;
  const loading = useRef(0);
  const load = useCallback(async () => {
    if (!curId) return;
    const n = ++loading.current;
    try {
      const o = await api.ytOverview(curId);
      if (n === loading.current) {
        setOv(o);
        setErr(null);
      }
    } catch (e) {
      if (n === loading.current) setErr(e.message);
    }
  }, [curId]);
  useEffect(() => {
    setOv(null);
    load();
  }, [curId]);
  useEffect(
    () =>
      on("youtube:changed", (e) => {
        if (e.what !== "insights" && (!e.channelId || e.channelId === curId)) load();
      }),
    [curId, load],
  );
  useEffect(() => on("channels:changed", () => load()), [load]);
  useEffect(() => {
    if (cur && !cur.syncing && !steps[cur.id] && (!cur.fetchedAt || Date.now() - Date.parse(cur.fetchedAt) > STALE))
      api.ytSync(cur.id).catch(() => {});
  }, [curId]);
  const [period, setPeriodState] = useState(() => {
    const v = Number(store.get("cz-yt-period"));
    return v === 7 || v === 90 ? v : 28;
  });
  const setPeriod = (p) => {
    setPeriodState(p);
    store.set("cz-yt-period", String(p));
  };
  const [open, setOpen] = useState(null);
  const [menu, setMenu] = useState(null);
  const step = cur ? steps[cur.id] : void 0,
    busy = !!step || !!cur?.syncing;
  const refresh = () => {
    if (!cur || busy) return;
    const t = cur.title;
    api
      .ytSync(cur.id)
      .then((r) =>
        r.access === "oauth" && !r.signedIn
          ? toast(`${t}: Google ended the sign-in, so only the public numbers were read.`, "info")
          : r.error
            ? toast(`${t}: not everything could be read (the note at the top says what).`, "info")
            : toast(`${t} is up to date.`),
      )
      .catch((e) => toast(e.message, "bad"));
  };
  const withDialogs = (page) => (
    <>
      {page}
      {dlg.ui}
    </>
  );
  if (!status)
    return withDialogs(
      <div className="loading">
        <Spinner size={22} kind="orbit" />
        Reading your channels…
      </div>,
    );
  if (!list.length)
    return withDialogs(
      <div className="page page-enter yt-page">
        <div className="page-head">
          <div>
            <h1>YouTube</h1>
            <div className="sub">How your videos do, from your own channels.</div>
          </div>
        </div>
        <Empty
          icon={<ChartLine size={28} strokeWidth={1.7} />}
          title="See how your videos do"
          text="Follow your YouTube channels here: views and subscribers for any channel with a free Google API key, and watch time, how long people watch and where they come from when you sign in with Google. Published videos then show on the Channels board with their views."
        >
          <div className="row wrap" style={{ justifyContent: "center" }}>
            <button className="btn" onClick={() => dlg.guide()}>
              <BookOpen size={15} />
              Setup guide
            </button>
            <button className="btn" onClick={dlg.add}>
              <Plus size={15} />
              Follow a channel
            </button>
            <button className="btn primary" onClick={() => (status.client.has ? dlg.signIn() : dlg.guide("client"))}>
              <LogIn size={15} />
              Sign in with Google
            </button>
          </div>
        </Empty>
      </div>,
    );
  const linked = cur?.linkedChannelId ? (channels.find((c) => c.id === cur.linkedChannelId) ?? null) : null;
  const opts = list.map((c) => ({
    value: c.id,
    label: c.title,
    hint: [c.handle, levelText(c)].filter(Boolean).join(" · "),
    icon: <YtAvatar c={c} size={22} />,
  }));
  return withDialogs(
    <div className="page page-enter yt-page">
      <div className="yt-head">
        {cur && <YtAvatar c={cur} size={52} />}
        <div className="yt-head-txt">
          <h1 className="ellipsis" dir="auto" title={cur?.title}>
            {cur?.title}
          </h1>
          <div className="sub">
            {cur?.handle && <span>{cur.handle}</span>}
            <span>{cur?.hiddenSubs ? "Subscribers hidden" : `${compact(cur?.subs)} subscribers`}</span>
            <span className={`yt-level ${cur?.analytics ? "full" : ""}`}>{cur && levelText(cur)}</span>
            {linked ? (
              <span className="yt-linked" title={`Linked to your channel ${linked.name}`}>
                <ChannelAvatar c={linked} size={16} />
                <span className="ellipsis" dir="auto">
                  {linked.name}
                </span>
              </span>
            ) : (
              cur && <span className="yt-unlinked">Not linked to one of your channels</span>
            )}
          </div>
        </div>
        <div className="actions yt-head-actions">
          {list.length > 1 && (
            <Picker
              id="yt-pick"
              value={cur?.id ?? ""}
              options={opts}
              onChange={setSel}
              ariaLabel="YouTube channel"
              menuWidth={320}
              className="yt-pick"
            />
          )}
          <button
            className="btn yt-refresh"
            onClick={refresh}
            disabled={busy}
            title={cur?.fetchedAt ? `Read ${since(cur.fetchedAt)}` : "Not read yet"}
          >
            {busy ? <Spinner size={14} /> : <RefreshCw size={15} />}
            <span>{busy ? (step ?? "Reading…") : "Refresh"}</span>
          </button>
          {cur && (
            <button
              className="icon-btn"
              aria-label="Open the channel on YouTube"
              title="Open on YouTube"
              onClick={() => api.external(channelUrl(cur)).catch(() => {})}
            >
              <ExternalLink size={17} strokeWidth={1.7} />
            </button>
          )}
          <button className="icon-btn" aria-label="Follow another channel" title="Follow another channel" onClick={dlg.add}>
            <Plus size={18} strokeWidth={1.7} />
          </button>
          {cur && (
            <button
              className="icon-btn yt-head-menu"
              aria-label={`${cur.title}: menu`}
              title="Sign-in and following"
              onClick={(e) => {
                const el = e.currentTarget;
                setMenu((m) => (m === el ? null : el));
              }}
            >
              <Ellipsis size={18} strokeWidth={1.7} />
            </button>
          )}
          {cur && menu && (
            <ActionMenu
              at={menu}
              label={`${cur.title}: menu`}
              onClose={() => setMenu(null)}
              width={300}
              items={[
                // (a word joiner after the hyphen: "sign-in" never breaks as "sign-" / "in")
                ...(cur.access === "oauth" || cur.signedIn
                  ? [
                      {
                        value: "disconnect",
                        label: "Stop using the Google sign-⁠in…",
                        keywords: "sign-in sign out disconnect",
                        hint: "Keeps public stats",
                        icon: <Unplug size={14} strokeWidth={1.8} />,
                        run: () => dlg.disconnect(cur),
                      },
                    ]
                  : []),
                {
                  value: "remove",
                  label: "Stop following…",
                  keywords: "remove",
                  icon: <Trash size={14} strokeWidth={1.8} className="ch-danger" />,
                  run: () => dlg.remove(cur),
                },
              ]}
            />
          )}
        </div>
      </div>
      {cur && (
        <Notices
          c={cur}
          reader={publicReader(status, cur.id)}
          onSignIn={() => (status.client.has ? dlg.signIn() : dlg.guide("client"))}
          onPublic={() => dlg.disconnect(cur)}
        />
      )}
      {err && (
        <div className="hint bad" role="alert">
          <TriangleAlert size={18} />
          <div>
            <b>The numbers could not be read</b>
            <p>{err}</p>
          </div>
          <button className="btn small" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {!ov && !err ? (
        <div className="loading">
          <Spinner size={22} kind="orbit" />
          {"Reading "}
          {cur?.title}…
        </div>
      ) : (
        ov && <Body ov={ov} period={period} setPeriod={setPeriod} onOpen={setOpen} onReload={load} onKey={() => dlg.guide("key")} />
      )}
      <p className="yt-foot small dim">
        <Info size={13} />
        YouTube's analytics lag about two days. Impressions and click-through rate are not shared through YouTube's analytics API, so they
        are not shown here: see them in YouTube Studio.{!cur?.analytics && " Public subscriber counts are rounded by YouTube."}
      </p>
      {open && (
        <VideoPanel
          videoId={open}
          onClose={() => setOpen(null)}
          onKey={() => {
            setOpen(null);
            dlg.guide("key");
          }}
          onSignIn={() => (status.client.has ? dlg.signIn() : dlg.guide("client"))}
        />
      )}
    </div>,
  );
}
const endedWhy = (error) => {
  const s = (error ?? "")
    .replace(/^Signed out: /, "")
    .replace(/\s*Sign in with Google again\.?$/, "")
    .trim();
  const m = /^Google ended this sign-in \((.+)\)\.?$/.exec(s);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)}.` : s;
};
function Notices({ c, reader, onSignIn, onPublic }) {
  const out = c.access === "oauth" && !c.signedIn;
  const soon = c.signedIn && c.expires && Date.parse(c.expires) - Date.now() < 3 * 864e5;
  if (out)
    return (
      <div className="hint warn yt-ended">
        <TriangleAlert size={18} />
        <div>
          <b>Google ended the sign-in for this channel</b>
          <p>
            {endedWhy(c.error) || "The numbers shown are the last ones the app read."}{" "}
            {reader === "key"
              ? "Public numbers still update with your API key."
              : reader === "other"
                ? "Public numbers still update through the Google sign-in of your other channel."
                : `Its numbers stay as they were read${c.fetchedAt ? ` ${since(c.fetchedAt)}` : ""}: with no Google API key saved (Settings > YouTube), only a new sign-in updates them.`}
          </p>
        </div>
        <div className="yt-hint-acts">
          <button className="btn small" onClick={onSignIn}>
            <LogIn size={14} />
            Sign in again
          </button>
          <button className="btn small ghost" onClick={onPublic} title="Keep the channel with public stats only, without this note">
            Public stats only
          </button>
        </div>
      </div>
    );
  return (
    <>
      {c.access === "public" && (
        <div className="hint yt-hint">
          <Sparkles size={18} />
          <div>
            <b>Public stats</b>
            <p>
              Views, likes and comments as YouTube shows them to everyone. Is it your channel? Sign in with Google to see watch time, how
              long people watch each video and where they come from.
            </p>
          </div>
          <button className="btn small" onClick={onSignIn}>
            <LogIn size={14} />
            Sign in with Google
          </button>
        </div>
      )}
      {c.signedIn && !c.analytics && (
        <div className="hint warn">
          <TriangleAlert size={18} />
          <div>
            <b>Analytics are not allowed for this channel</b>
            <p>When you signed in, the YouTube Analytics box was not ticked. Sign in again and tick both boxes.</p>
          </div>
          <button className="btn small" onClick={onSignIn}>
            <LogIn size={14} />
            Sign in again
          </button>
        </div>
      )}
      {soon && (
        <div className="hint warn yt-soon">
          <Clock3 size={18} />
          <div>
            <b>
              {"Google signs you out on "}
              {dateShort(c.expires)}
            </b>
            <p>
              {
                "Your Google app is in Testing, so Google ends its sign-ins after 7 days. To stay signed in for good, publish the app (guide step 4 in Settings > YouTube), then sign in again: a sign-in made while it was in Testing still ends on "
              }
              {dateShort(c.expires)}.
            </p>
          </div>
          <button className="btn small" onClick={onSignIn}>
            <LogIn size={14} />
            Sign in again
          </button>
        </div>
      )}
      {c.error && !out && (
        <div className="hint warn" role="status">
          <TriangleAlert size={18} />
          <div>
            <b>{c.readFailed ? "The last read did not work" : "Not everything could be read"}</b>
            <p>
              {c.error}
              {c.readFailed && c.fetchedAt ? ` The numbers shown were read ${since(c.fetchedAt)}.` : ""}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
function Body({ ov, period, setPeriod, onOpen, onReload, onKey }) {
  const c = ov.channel,
    full = c.analytics || ov.days.length > 0;
  const [metric, setMetricState] = useState(() => store.get("cz-yt-metric") || "views");
  const setMetric = (m) => {
    setMetricState(m);
    store.set("cz-yt-metric", m);
  };
  const k = useMemo(() => {
    const d = ov.days,
      now = d.slice(-period),
      before = d.length >= period * 2 ? d.slice(-period * 2, -period) : null;
    const sum = (l, f) => l.reduce((s, x) => s + f(x), 0);
    const avg = (l, f) => {
      const v = sum(l, (x) => x.views);
      return v ? sum(l, (x) => (f(x) ?? 0) * x.views) / v : null;
    };
    const val = {
      views: (l) => sum(l, (x) => x.views),
      minutes: (l) => sum(l, (x) => x.minutes),
      subs: (l) => sum(l, (x) => x.subsGained - x.subsLost),
      dur: (l) => avg(l, (x) => x.avgDuration),
      pct: (l) => avg(l, (x) => x.avgPct),
    };
    const tile = (f) => {
      const a = f(now),
        b = before ? f(before) : null;
      return { cur: a, prev: b, delta: a == null ? null : change(a, b) };
    };
    return {
      now,
      before,
      through: d.length ? d[d.length - 1].day : null,
      views: tile(val.views),
      minutes: tile(val.minutes),
      subs: tile(val.subs),
      dur: tile(val.dur),
      pct: tile(val.pct),
    };
  }, [ov.days, period]);
  const pub = useMemo(() => {
    const s = ov.snapshots.filter((x) => x.views != null);
    const last = s[s.length - 1],
      cutoff = new Date(Date.now() - period * 864e5).toISOString().slice(0, 10);
    const from = [...s].reverse().find((x) => x.day <= cutoff) ?? s[0];
    const perDay = [];
    for (let i = 1; i < s.length; i++) {
      const gap = Math.max(1, Math.round((Date.parse(s[i].day) - Date.parse(s[i - 1].day)) / 864e5));
      perDay.push({ day: s[i].day, value: Math.max(0, ((s[i].views ?? 0) - (s[i - 1].views ?? 0)) / gap) });
    }
    return { last, from: from && last && from.day < last.day ? from : null, perDay: perDay.filter((x) => x.day > cutoff) };
  }, [ov.snapshots, period]);
  const chart =
    metric === "views"
      ? {
          days: k.now.map((x) => ({ day: x.day, value: x.views })),
          prev: k.before?.map((x) => x.views),
          name: "Views",
          unit: "views",
          format: int,
        }
      : metric === "hours"
        ? {
            days: k.now.map((x) => ({ day: x.day, value: x.minutes / 60 })),
            prev: k.before?.map((x) => x.minutes / 60),
            name: "Watch hours",
            unit: "hours",
            format: (v) => v.toLocaleString(void 0, { maximumFractionDigits: 1 }),
          }
        : {
            days: k.now.map((x) => ({ day: x.day, value: x.subsGained - x.subsLost })),
            prev: k.before?.map((x) => x.subsGained - x.subsLost),
            name: "Subscribers",
            unit: "subscribers (net)",
            format: int,
          };
  const pubSpan =
    ov.snapshots.length > 1 ? (Date.parse(ov.snapshots[ov.snapshots.length - 1].day) - Date.parse(ov.snapshots[0].day)) / 864e5 : 0;
  const periodText = !full
    ? c.fetchedAt
      ? `Read ${since(c.fetchedAt)}`
      : c.syncing
        ? "Being read now"
        : "Not read yet"
    : !k.through
      ? "No analytics yet"
      : k.before
        ? `Through ${dateShort(k.through)}, compared with the ${period} days before`
        : `Through ${dateShort(k.through)}: ${k.now.length < period ? `the ${k.now.length} days YouTube has so far` : `the last ${period} days`}, with no ${period} days before them to compare with yet`;
  return (
    <>
      <div className="yt-bar-row">
        {(full || pubSpan > 7) && (
          <Segmented
            id="yt-period"
            ariaLabel="Period"
            className="yt-seg"
            value={String(period)}
            onChange={(v) => setPeriod(+v)}
            options={[
              { value: "7", label: "7 days" },
              { value: "28", label: "28 days" },
              { value: "90", label: "90 days" },
            ]}
          />
        )}
        <span className="small dim">{periodText}</span>
      </div>
      {full ? (
        <div className="yt-kpis" role="list" aria-label="The numbers">
          <Kpi icon={<Eye size={15} />} label="Views" value={int(k.views.cur)} delta={k.views.delta} spark={k.now.map((x) => x.views)} />
          <Kpi
            icon={<Clock3 size={15} />}
            label="Watch hours"
            value={hours(k.minutes.cur)}
            delta={k.minutes.delta}
            spark={k.now.map((x) => x.minutes)}
          />
          <Kpi
            icon={<Users size={15} />}
            label="Subscribers"
            value={(k.subs.cur ?? 0) > 0 ? `+${int(k.subs.cur)}` : int(k.subs.cur)}
            delta={k.subs.delta}
            note="gained minus lost"
          />
          <Kpi
            icon={<ChartLine size={15} />}
            label="Avg view duration"
            value={clock(k.dur.cur)}
            delta={k.dur.delta}
            note={k.pct.cur != null ? `${pct(k.pct.cur, 1)} of each video watched` : void 0}
            title={
              k.pct.delta != null
                ? `Average percentage viewed: ${pct(k.pct.cur, 1)} (${k.pct.delta >= 0 ? "+" : ""}${k.pct.delta.toFixed(1)}% on the period before)`
                : void 0
            }
          />
        </div>
      ) : (
        <div className="yt-kpis" role="list" aria-label="The numbers">
          <Kpi
            icon={<Users size={15} />}
            label="Subscribers"
            value={c.hiddenSubs ? "Hidden" : compact(c.subs)}
            delta={pub.from && c.subs != null && pub.from.subs != null ? change(c.subs, pub.from.subs) : null}
            note={pub.from ? `since ${dateShort(pub.from.day)}` : void 0}
          />
          <Kpi
            icon={<Eye size={15} />}
            label="Views, all time"
            value={compact(c.views)}
            note={
              pub.from && pub.last
                ? `+${int((pub.last.views ?? 0) - (pub.from.views ?? 0))} since ${dateShort(pub.from.day)}`
                : "growth shows once it is read on a second day"
            }
          />
          <Kpi icon={<Film size={15} />} label="Videos" value={int(c.videos)} />
          <Kpi
            icon={<ThumbsUp size={15} />}
            label="Likes on recent videos"
            value={ov.videos.length ? compact(ov.videos.slice(0, 20).reduce((s, v) => s + (v.likes ?? 0), 0)) : "—"}
            note={
              ov.videos.length
                ? `the newest ${Math.min(20, ov.videos.length)} video${ov.videos.length === 1 ? "" : "s"}`
                : "once its videos are read"
            }
          />
        </div>
      )}
      <section className="panel yt-chart-panel" aria-label="Per day">
        <header className="yt-panel-head">
          <h3>{full ? `${chart.name} per day` : "Views gained per day"}</h3>
          {full && (
            <Segmented
              id="yt-metric"
              ariaLabel="What the chart shows"
              value={metric}
              onChange={setMetric}
              className="yt-seg yt-metric"
              options={[
                { value: "views", label: "Views" },
                { value: "hours", label: "Watch hours" },
                { value: "subs", label: "Subscribers" },
              ]}
            />
          )}
          {full && k.before && (
            <span className="yt-legend">
              <i className="now" />
              {"Last "}
              {period}
              {" days"}
              <i className="prev" />
              {"The "}
              {period}
              {" before"}
            </span>
          )}
        </header>
        {full ? (
          k.now.length ? (
            <DayChart
              key={metric + period}
              days={chart.days}
              prev={k.before ? chart.prev : null}
              name={chart.name}
              unit={chart.unit}
              format={chart.format}
            />
          ) : (
            <p className="yt-chart-empty">
              YouTube has no daily numbers for this channel yet. They usually show a day or two after the first views.
            </p>
          )
        ) : pub.perDay.length >= 2 ? (
          <DayChart days={pub.perDay} name="Views gained" unit="views (from the daily totals)" />
        ) : (
          <p className="yt-chart-empty">
            {
              "Public stats have no daily history: the app saves the channel's totals each day it reads them. The growth above shows once it is read on a second day; the views gained per day show here once there are two days of gains to draw (from the third day it is read). "
            }
            {
              // (what brings the full history depends on why it is missing: the Analytics box, a sign-in Google ended, none yet)
              c.signedIn
                ? "The full daily history needs the YouTube Analytics permission: sign in again and tick both boxes."
                : c.access === "oauth"
                  ? "Sign in with Google again for the full daily history."
                  : c.own
                    ? "Sign in with Google for this channel to see its full daily history."
                    : "Sign in with Google for the full daily history of your own channels."
            }
          </p>
        )}
      </section>
      <div className="yt-pair">
        <Lessons yt={c} />
        <CommentsCard comments={ov.comments} onOpen={onOpen} read={!!c.fetchedAt} needKey={!!ov.commentsNeedKey} onKey={onKey} />
      </div>
      <VideoTable ov={ov} onOpen={onOpen} onReload={onReload} />
    </>
  );
}
function Kpi({ icon, label, value, delta, spark, note, title }) {
  const d = delta == null || !isFinite(delta) ? null : delta;
  return (
    <div className="yt-kpi" role="listitem" title={title}>
      <span className="yt-kpi-l">
        {icon}
        {label}
      </span>
      <b className="yt-kpi-v">{value}</b>
      <span className="yt-kpi-f">
        {d !== null && (
          <span className={`yt-delta ${Math.abs(d) < 0.5 ? "flat" : d > 0 ? "up" : "down"}`} title="Compared with the period before">
            {Math.abs(d) < 0.5 ? (
              "±0%"
            ) : (
              <>
                {d > 0 ? <ArrowUp size={11} strokeWidth={2.4} /> : <ArrowDown size={11} strokeWidth={2.4} />}
                {Math.abs(d) >= 100 ? Math.round(Math.abs(d)) : Math.abs(d).toFixed(1)}%
              </>
            )}
          </span>
        )}
        {note && <small>{note}</small>}
        {spark && spark.length > 2 && <Spark values={spark} />}
      </span>
    </div>
  );
}
const COLS = [
  { key: "title", label: "Video" },
  { key: "published", label: "Published", cls: "yt-c-date" },
  { key: "views", label: "Views", num: true },
  { key: "minutes", label: "Watch hours", num: true, full: true, cls: "yt-c-hours" },
  { key: "avgPct", label: "Avg % viewed", num: true, full: true, cls: "yt-c-pct" },
  { key: "likes", label: "Likes", num: true, cls: "yt-c-likes" },
  { key: "comments", label: "Comments", num: true, cls: "yt-c-comments" },
];
const dateOf = (v) => v.publishedAt ?? v.publishAt ?? v.uploadedAt ?? "";
const sortVal = (v, k) => (k === "title" ? v.title.toLowerCase() : k === "published" ? dateOf(v) : (v[k] ?? -1));
const dateCell = (v) =>
  v.status === "scheduled"
    ? { text: dateShort(v.publishAt), muted: true, title: "Goes public on this day" }
    : v.status === "published"
      ? { text: dateShort(v.publishedAt ?? v.uploadedAt), muted: false }
      : (v.uploadedAt ?? v.publishedAt)
        ? {
            text: `Uploaded ${dateShort(v.uploadedAt ?? v.publishedAt)}`,
            muted: true,
            title: v.status === "private" ? "Private: the day it was uploaded" : "Unlisted: the day it was uploaded",
          }
        : { text: "—", muted: true };
const SHOWN = [
  { value: "public", label: "Public", hint: "and scheduled" },
  { value: "all", label: "All videos" },
  { value: "hidden", label: "Private and unlisted" },
];
const shownBy = (f) => (v) =>
  f === "all" ||
  (f === "public" ? v.status === "published" || v.status === "scheduled" : v.status === "private" || v.status === "unlisted");
const SORT_WORDS = {
  published: ["Newest first", "Oldest first"],
  views: ["Most viewed", "Least viewed"],
  minutes: ["Most watch time", "Least watch time"],
  avgPct: ["Highest % viewed", "Lowest % viewed"],
  likes: ["Most liked", "Least liked"],
  comments: ["Most comments", "Fewest comments"],
  title: ["Title, Z to A", "Title, A to Z"],
};
function VideoTable({ ov, onOpen, onReload }) {
  const { toast, openProject, allProjects } = useApp();
  const full = ov.channel.analytics || ov.videos.some((v) => v.minutes != null);
  const [saved, setSortState] = useState(() => {
    try {
      const s = JSON.parse(store.get("cz-yt-sort") || "");
      if (s?.key in SORT_WORDS && (s.dir === 1 || s.dir === -1)) return s;
    } catch {}
    return { key: "published", dir: -1 };
  });
  const put = (n) => {
    store.set("cz-yt-sort", JSON.stringify(n));
    setSortState(n);
  };
  const sort = !full && (saved.key === "minutes" || saved.key === "avgPct") ? { key: "published", dir: -1 } : saved;
  const setSort = (key) => put({ key, dir: sort.key === key ? -sort.dir : key === "title" ? 1 : -1 });
  const sortOpts = useMemo(() => {
    const keys = ["published", "views", ...(full ? ["minutes", "avgPct"] : []), "likes", "comments"];
    const l = keys.map((k) => ({ value: `${k}:-1`, label: SORT_WORDS[k][0] }));
    l.splice(1, 0, { value: "published:1", label: SORT_WORDS.published[1] });
    l.push({ value: "title:1", label: SORT_WORDS.title[1] });
    const now = `${sort.key}:${sort.dir}`;
    if (!l.some((o) => o.value === now)) l.push({ value: now, label: SORT_WORDS[sort.key][sort.dir > 0 ? 1 : 0] });
    return l;
  }, [full, sort.key, sort.dir]);
  const [qy, setQ] = useState(""),
    [all, setAll] = useState(false);
  const fKey = `cz-yt-shown-${ov.channel.id}`;
  const [filter, setFilterState] = useState(() => {
    const v = store.get(fKey);
    return v === "all" || v === "hidden" ? v : "public";
  });
  useEffect(() => {
    const v = store.get(fKey);
    setFilterState(v === "all" || v === "hidden" ? v : "public");
  }, [fKey]);
  const setFilter = (v) => {
    const n = v === "all" || v === "hidden" ? v : "public";
    setFilterState(n);
    store.set(fKey, n);
  };
  const inFilter = useMemo(() => ov.videos.filter(shownBy(filter)).length, [ov.videos, filter]);
  const cols = COLS.filter((c) => !c.full || full);
  const rows = useMemo(() => {
    const q = qy.trim().toLowerCase();
    const l = ov.videos
      .filter(shownBy(filter))
      .filter((v) => !q || v.title.toLowerCase().includes(q) || (v.projectName ?? "").toLowerCase().includes(q));
    return l.sort((a, b) => {
      const x = sortVal(a, sort.key),
        y = sortVal(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || dateOf(b).localeCompare(dateOf(a));
    });
  }, [ov.videos, sort.key, sort.dir, qy, filter]);
  const shown = all || qy ? rows : rows.slice(0, 50);
  const capped = ov.videos.length >= 500 && (ov.channel.videos ?? 0) > ov.videos.length;
  const own = ov.channel.own;
  const link = async (v, projectId, name) => {
    swallowClicks();
    try {
      const r = await api.ytLinkVideo(v.id, projectId);
      onReload();
      toast(`Linked "${v.title}" to the project "${name}".${r.joined ? ` It joins ${r.joined}.` : ""}`, "ok", {
        label: "Undo",
        run: () =>
          api
            .ytUndoLink(r.undo)
            .then((u) => {
              onReload();
              toast(undoSays(u, v.title, name), "info");
            })
            .catch((e) => toast(e.message, "bad")),
      });
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  return (
    <section className="panel yt-videos" aria-label="Videos">
      <header className="yt-panel-head">
        <h3>
          {"Videos "}
          <small className="yt-vcount">
            {inFilter < ov.videos.length
              ? `${int(inFilter)} of ${int(ov.videos.length)}`
              : capped
                ? `the newest ${int(ov.videos.length)} of ${int(ov.channel.videos)}`
                : ov.videos.length}
          </small>
          {capped && (
            <span
              className="yt-cap-i"
              title={`The app reads a channel's newest ${int(ov.videos.length)} videos; older ones are on YouTube.`}
            >
              <Info size={13} />
            </span>
          )}
        </h3>
        {ov.videos.length > 1 && (
          <Picker
            id="yt-sort"
            value={`${sort.key}:${sort.dir}`}
            options={sortOpts}
            onChange={(v) => {
              const [k, d] = v.split(":");
              put({ key: k, dir: d === "1" ? 1 : -1 });
            }}
            ariaLabel="Sort the videos"
            menuWidth={210}
            className="yt-sortpick"
            trigger={(o) => (
              <>
                <ArrowDownUp size={14} strokeWidth={1.8} />
                <span className="pk-val">{o?.label ?? "Sort"}</span>
              </>
            )}
          />
        )}
        {ov.videos.length > 0 && (
          <Picker
            id="yt-shown"
            value={filter}
            options={SHOWN}
            onChange={setFilter}
            ariaLabel="Which videos to show"
            menuWidth={220}
            className="yt-sortpick yt-shownpick"
            trigger={(o) => (
              <>
                <ListFilter size={14} strokeWidth={1.8} />
                <span className="pk-val">{o?.label ?? "Public"}</span>
              </>
            )}
          />
        )}
        <label className="search yt-search">
          <Search size={15} strokeWidth={1.8} />
          <input
            placeholder="Search videos"
            value={qy}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search videos"
            onKeyDown={(e) => {
              if (e.key === "Escape" && qy) {
                e.stopPropagation();
                setQ("");
              }
            }}
          />
          {qy && (
            <button className="icon-btn sm" aria-label="Clear the search" onClick={() => setQ("")}>
              <X size={14} />
            </button>
          )}
        </label>
      </header>
      {!ov.videos.length ? (
        <p className="yt-chart-empty">
          {ov.channel.fetchedAt
            ? "No videos yet."
            : ov.channel.syncing
              ? "No videos yet: the channel is being read."
              : ov.channel.readFailed
                ? "Its videos are not read yet: the last read did not work (the note at the top says why). Refresh tries again."
                : "Its videos are not read yet: Refresh reads them."}
        </p>
      ) : (
        <div className="yt-table-wrap">
          <table className={`yt-table ${full ? "full" : "pub"}`}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className={`sort ${c.num ? "num" : ""} ${c.cls ?? ""}`}
                    aria-sort={sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}
                  >
                    <button className={`yt-th ${sort.key === c.key ? "on" : ""}`} onClick={() => setSort(c.key)}>
                      {c.label}
                      {sort.key === c.key &&
                        (sort.dir > 0 ? <ArrowUp size={11} strokeWidth={2.2} /> : <ArrowDown size={11} strokeWidth={2.2} />)}
                    </button>
                  </th>
                ))}
                {own && <th className="yt-c-proj">Project</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr
                  key={v.id}
                  tabIndex={0}
                  data-video={v.id}
                  onClick={(e) => {
                    if (!e.target.closest("button")) onOpen(v.id);
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                      e.preventDefault();
                      onOpen(v.id);
                    }
                  }}
                  title="Open its numbers"
                >
                  <td className="yt-c-video">
                    <div className="yt-vcell">
                      <span className="yt-thumb">
                        {v.thumbUrl ? <img src={v.thumbUrl} alt="" loading="lazy" draggable={false} /> : <Video size={14} />}
                        {v.duration != null && <i>{clock(v.duration)}</i>}
                      </span>
                      <span className="yt-vt">
                        <span className="yt-vtitle" dir="auto">
                          {v.title}
                        </span>
                        {v.status !== "published" && (
                          <span className={`yt-st ${v.status}`}>
                            {v.status === "scheduled"
                              ? `Scheduled · ${dateShort(v.publishAt)}`
                              : v.status === "unlisted"
                                ? "Unlisted"
                                : "Private"}
                          </span>
                        )}
                        {v.status !== "scheduled" && dateCell(v).text !== "—" && (
                          <span className={`yt-vdate ${dateCell(v).muted ? "muted" : ""}`}>{dateCell(v).text}</span>
                        )}
                      </span>
                    </div>
                  </td>
                  {(() => {
                    const dc = dateCell(v);
                    return (
                      <td className={`yt-c-date ${dc.muted ? "muted" : ""}`} title={dc.title}>
                        {dc.text}
                      </td>
                    );
                  })()}
                  <td className="num">{int(v.views)}</td>
                  {full && <td className="num yt-c-hours">{hours(v.minutes)}</td>}
                  {full && (
                    <td className="num yt-c-pct">
                      {v.avgPct == null ? (
                        "—"
                      ) : (
                        <span className="yt-pct">
                          <span className="yt-pct-t">
                            <i style={{ width: `${Math.min(100, v.avgPct)}%` }} />
                          </span>
                          {pct(v.avgPct)}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="num yt-c-likes">{int(v.likes)}</td>
                  <td className="num yt-c-comments">{int(v.comments)}</td>
                  {own && (
                    <td className="yt-c-proj">
                      {v.projectId ? (
                        <button
                          className="yt-proj"
                          title={`Open the project "${v.projectName}"`}
                          onClick={() =>
                            openProject({ id: v.projectId, kind: v.projectKind ?? allProjects.find((p) => p.id === v.projectId)?.kind })
                          }
                        >
                          {v.projectKind === "personal" ? <Video size={12} /> : <Film size={12} />}
                          <span className="ellipsis" dir="auto">
                            {v.projectName}
                          </span>
                        </button>
                      ) : v.suggestion ? (
                        <button
                          className="yt-sugg"
                          title={`Looks like your project "${v.suggestion.name}". Click to link them: the board then shows it with its views.`}
                          onClick={() => link(v, v.suggestion.projectId, v.suggestion.name)}
                        >
                          <Link2 size={12} />
                          <span className="ellipsis" dir="auto">
                            {v.suggestion.name}
                          </span>
                          <b className="yt-sugg-q" aria-hidden="true">
                            ?
                          </b>
                        </button>
                      ) : (
                        <span className="yt-none">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="yt-chart-empty">
              {qy.trim() ? (
                <>
                  No video matches “{qy.trim()}”{filter !== "all" ? " here: try All videos" : ""}.
                </>
              ) : filter === "public" ? (
                "No public videos yet: All videos shows the private and unlisted ones."
              ) : (
                "No private or unlisted videos."
              )}
            </p>
          )}
          {rows.length > shown.length && (
            <button className="btn small yt-more" onClick={() => setAll(true)}>
              {"Show all "}
              {rows.length}
              {" videos"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
const KIND = { working: "Works", topic: "Topic idea", hook: "Opening", length: "Length", avoid: "Avoid", other: "Note" };
function Lessons({ yt }) {
  const { toast, channels, brand } = useApp();
  const ch = yt.linkedChannelId ? (channels.find((c) => c.id === yt.linkedChannelId) ?? null) : null;
  const chId = ch?.id ?? null;
  const [l, setL] = useState(null),
    [running, setRunning] = useState(false),
    [since0, setSince] = useState(0);
  const [edit, setEdit] = useState(null),
    [mine, setMine] = useState(""),
    [allKept, setAllKept] = useState(false);
  const here = useRef(chId);
  here.current = chId;
  const load = useCallback(() => {
    const id = chId;
    if (!id) return;
    api
      .ytInsights(id)
      .then((r) => {
        if (here.current !== id) return;
        setL(r.list);
        setRunning(r.running);
        setSince(r.since ?? 0);
      })
      .catch(() => {});
  }, [chId]);
  useEffect(() => {
    setL(null);
    setEdit(null);
    setAllKept(false);
    load();
  }, [chId]);
  useEffect(
    () =>
      on("youtube:changed", (e) => {
        if (e.what === "insights") load();
      }),
    [load],
  );
  const adding = useRef(false);
  if (!ch)
    return (
      <section className="panel yt-card yt-lessons-card" aria-label="What's working">
        <header className="yt-panel-head">
          <h3>
            <Lightbulb size={15} />
            What's working
          </h3>
        </header>
        <p className="yt-card-p">
          {yt.access === "oauth"
            ? "Link this YouTube channel to one of your channels: Claude can then read its numbers and comments and suggest lessons for the scripts of that channel's projects."
            : "Is it one of your channels? Link it: Claude then reads its numbers and comments and suggests lessons for that channel's scripts. A channel you follow to learn from needs no link: its videos and comments are here to read."}
        </p>
        <LinkPicker yt={yt} id="yt-lessons-link" />
      </section>
    );
  const ask = async () => {
    const id = ch.id,
      name = ch.name;
    setRunning(true);
    setSince(Date.now());
    try {
      const r = await api.ytInsightsRun(id);
      load();
      const n = r.added.length,
        what = `${n} lesson${n === 1 ? "" : "s"}`;
      if (here.current !== id)
        toast(
          n
            ? `Claude's ${n === 1 ? "suggestion is" : `${n} suggestions are`} for your channel "${name}", which is no longer linked to this YouTube channel: link it again to see ${n === 1 ? "it" : "them"}.`
            : "Claude found nothing new to suggest.",
          "info",
        );
      else
        toast(
          n
            ? `Claude suggests ${what} from ${r.read.videos} videos and ${r.read.comments} comments. Keep the ones that ring true.`
            : "Claude found nothing new to suggest.",
          n ? "ok" : "info",
        );
    } catch (e) {
      toast(e.message, /^Stopped:/.test(e.message) ? "info" : "bad");
    } finally {
      if (here.current === id) {
        setRunning(false);
        load();
      }
    }
  };
  const stop = () => {
    if (ch) api.ytInsightsCancel(ch.id).catch(() => {});
  };
  const act = async (fn) => {
    try {
      await fn();
      load();
      return true;
    } catch (e) {
      toast(e.message, "bad");
      return false;
    }
  };
  const save = async () => {
    if (!edit || !edit.text.trim()) return;
    const e2 = edit;
    if (await act(() => api.ytInsightUpdate(e2.id, { text: e2.text, status: "approved" }))) setEdit((x) => (x?.id === e2.id ? null : x));
  };
  const once = (fn) => () => {
    swallowClicks();
    fn();
  };
  const add = async () => {
    const t = mine.trim();
    if (!t || adding.current) return;
    adding.current = true;
    try {
      if (await act(() => api.ytInsightAdd(ch.id, t))) setMine((m) => (m.trim() === t ? "" : m));
    } finally {
      adding.current = false;
    }
  };
  const all = edit && l && !l.some((x) => x.id === edit.id) ? [edit.row, ...l] : (l ?? []);
  const kept = all.filter((x) => x.status === "approved"),
    sugg = all.filter((x) => x.status === "suggested");
  const KEPT_SHOWN = 5,
    keptShown = allKept || kept.length <= KEPT_SHOWN + 1 ? kept : kept.filter((x, i) => i < KEPT_SHOWN || x.id === edit?.id);
  const remove = (x) =>
    act(async () => {
      await api.ytInsightDismiss(x.id);
      if (x.status === "approved")
        toast("Lesson removed.", "info", {
          label: "Undo",
          run: () =>
            api
              .ytInsightUpdate(x.id, { status: "approved" })
              .then(load)
              .catch((e) => toast(e.message, "bad")),
        });
    });
  const row = (x) => (
    <li key={x.id} className={`yt-ins ${x.status}`} data-insight={x.id}>
      <span className={`yt-ins-k k-${x.kind}`}>{KIND[x.kind] ?? "Note"}</span>
      {edit?.id === x.id ? (
        <div className="yt-ins-edit">
          <textarea
            className="input"
            autoFocus
            rows={3}
            value={edit.text}
            maxLength={400}
            aria-label="Lesson"
            onChange={(e) => setEdit({ id: x.id, text: e.target.value, row: x })}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (isEnter(e) && !e.shiftKey) {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setEdit(null);
              }
            }}
          />
          <div className="row">
            <button className="btn tiny primary" onClick={save} disabled={!edit.text.trim()}>
              Save
            </button>
            <button className="btn tiny" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p dir="auto">{x.text}</p>
          {x.why && <small dir="auto">{x.why}</small>}
          <div className="yt-ins-acts">
            {x.status === "suggested" && (
              <button className="btn tiny primary" onClick={once(() => act(() => api.ytInsightUpdate(x.id, { status: "approved" })))}>
                <Check size={12} />
                Keep
              </button>
            )}
            <button className="btn tiny" onClick={() => setEdit({ id: x.id, text: x.text, row: x })}>
              <Pencil size={12} />
              Edit
            </button>
            <button className="btn tiny ghost" onClick={once(() => remove(x))}>
              {x.status === "suggested" ? "Dismiss" : "Remove"}
            </button>
          </div>
        </>
      )}
    </li>
  );
  const personal = brand === "personal";
  return (
    <section className="panel yt-card yt-lessons-card" aria-label="What's working">
      <header className="yt-panel-head">
        <h3>
          <Lightbulb size={15} />
          What's working
        </h3>
        <button
          className="btn small"
          onClick={ask}
          disabled={running}
          title="Claude reads the numbers, the retention of the main videos and the comments, then suggests lessons"
        >
          {running ? <Spinner size={13} /> : <Sparkles size={14} />}Ask Claude
        </button>
      </header>
      {running && (
        <div className="yt-busy-row">
          <Busy text="Claude is reading the numbers and comments…" since={since0 || void 0} className="yt-busy" />
          <button className="btn tiny ghost" onClick={stop} title="Claude stops reading; nothing is added">
            Stop
          </button>
        </div>
      )}
      {l === null ? (
        <div className="yt-card-p">
          <Spinner size={14} />
        </div>
      ) : !kept.length && !sugg.length && !running ? (
        <p className="yt-card-p">
          {"Ask Claude what works on "}
          {ch.name}
          {": it reads the views, how long people watch and the comments, and suggests lessons. "}
          {personal
            ? `The ones you keep show when you plan a new video for ${ch.name}, and guide Claude's scripts for its Faceless videos.`
            : `The ones you keep guide Claude's scripts for ${ch.name} and show in New project.`}
        </p>
      ) : (
        <ul className="yt-ins-list">
          {sugg.length > 0 && <li className="yt-ins-h">Suggested · keep the ones that ring true</li>}
          {sugg.map(row)}
          {kept.length > 0 && (
            <li className="yt-ins-h">
              {personal ? `Kept · shown in New video for ${ch.name}` : `Kept · guiding the scripts of ${ch.name}`}
            </li>
          )}
          {keptShown.map(row)}
          {keptShown.length < kept.length && (
            <li className="yt-ins-more">
              <button className="btn small yt-more" onClick={() => setAllKept(true)}>
                {"Show all "}
                {kept.length}
                {" kept lessons"}
              </button>
            </li>
          )}
        </ul>
      )}
      <div className="yt-ins-add">
        <input
          className="input compact"
          value={mine}
          onChange={(e) => setMine(e.target.value)}
          placeholder="Add your own lesson"
          aria-label="Add your own lesson"
          maxLength={400}
          onKeyDown={(e) => {
            if (isEnter(e)) add();
          }}
        />
        <button className="btn small" onClick={add} disabled={!mine.trim()}>
          Add
        </button>
      </div>
    </section>
  );
}
const NeedKey = ({ onKey }) => (
  <div className="yt-needkey">
    <p className="yt-chart-empty">{"Comments need a free Google API key (Settings > YouTube)."}</p>
    <button className="btn small" onClick={onKey}>
      <KeyRound size={13} />
      Add an API key
    </button>
  </div>
);
function CommentsCard({ comments, onOpen, read, needKey, onKey }) {
  const [more, setMore] = useState(false);
  const l = more ? comments : comments.slice(0, 5);
  return (
    <section className="panel yt-card" aria-label="Recent comments">
      <header className="yt-panel-head">
        <h3>
          <MessageSquare size={15} />
          Recent comments
        </h3>
      </header>
      {needKey && <NeedKey onKey={onKey} />}
      {!comments.length ? (
        needKey ? null : (
          <p className="yt-card-p">
            {read
              ? "No comments yet (or YouTube does not share them for this channel)."
              : "Not read yet: the comments come with the channel's first read."}
          </p>
        )
      ) : (
        <ul className="yt-comments">
          {l.map((c) => (
            <Comment key={c.id} c={c} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {comments.length > 5 && !more && (
        <button className="btn small yt-more" onClick={() => setMore(true)}>
          {"Show "}
          {comments.length - 5}
          {" more"}
        </button>
      )}
    </section>
  );
}
function Comment({ c, onOpen }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="yt-comment">
      <div className="yt-cm-head">
        <b className="ellipsis" dir="auto">
          {c.author || "Someone"}
        </b>
        <small>{since(c.publishedAt)}</small>
        {c.likes > 0 && (
          <small className="yt-cm-likes">
            <ThumbsUp size={11} />
            {c.likes}
          </small>
        )}
      </div>
      <p
        className={open ? "open" : ""}
        dir="auto"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={open ? void 0 : "Click to read all of it"}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        {c.text}
      </p>
      {c.videoTitle && onOpen && c.videoId && (
        <button className="text-btn yt-cm-video ellipsis" onClick={() => onOpen(c.videoId)} dir="auto">
          {"on "}
          {c.videoTitle}
        </button>
      )}
    </li>
  );
}
function PanelComments({ comments }) {
  const [all, setAll] = useState(false);
  const l = all ? comments : comments.slice(0, 8);
  return (
    <>
      <ul className="yt-comments in-panel">
        {l.map((c) => (
          <Comment key={c.id} c={c} />
        ))}
      </ul>
      {comments.length > l.length && (
        <button className="btn small yt-more" onClick={() => setAll(true)}>
          {"Show "}
          {comments.length - l.length}
          {" more"}
        </button>
      )}
    </>
  );
}
const twinSays = (p) => {
  const d = p.created ? new Date(p.created) : null,
    t = p.twin,
    f = t.folder.length > 26 ? `${t.folder.slice(0, 10)}…${t.folder.slice(-13)}` : t.folder;
  const made =
    d && !isNaN(+d)
      ? `made ${d.toLocaleString(void 0, {
          day: "numeric",
          month: "short",
          ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : null;
  return [
    p.channelName ?? "No channel",
    made,
    t.stage ? `${STAGE_LABEL[t.stage] ?? t.stage}${t.length ? `, ${clock(t.length)}` : ""}` : null,
    `folder ${f}`,
  ]
    .filter(Boolean)
    .join(" · ");
};
function Locked({ text, onSignIn, label }) {
  return (
    <div className="yt-locked">
      <p className="yt-chart-empty">{text}</p>
      {onSignIn && (
        <button className="btn small" onClick={onSignIn}>
          <LogIn size={13} />
          {label ?? "Sign in again"}
        </button>
      )}
    </div>
  );
}
function VideoPanel({ videoId, onClose, onSignIn, onKey }) {
  const { toast, openProject } = useApp();
  const [d, setD] = useState(null),
    [err, setErr] = useState(null),
    [busy, setBusy] = useState(false);
  const read = useCallback(
    async (force = false) => {
      setBusy(true);
      try {
        setD(await api.ytVideo(videoId, force));
        setErr(null);
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy(false);
      }
    },
    [videoId],
  );
  useEffect(() => {
    read();
  }, [videoId]);
  const v = d?.video;
  const link = async (pid) => {
    if (!v) return;
    try {
      const r = await api.ytLinkVideo(v.id, pid === "none" ? null : pid);
      await read();
      toast(
        pid === "none"
          ? "The video is not linked to a project now."
          : `Linked to the project "${r.video.projectName}".${r.joined ? ` It joins ${r.joined}.` : ""} ${boardSays(v)}`,
        "ok",
        {
          label: "Undo",
          run: () =>
            api
              .ytUndoLink(r.undo)
              .then((u) => {
                read();
                if (pid !== "none") toast(undoSays(u, v.title, r.video.projectName ?? ""), "info");
              })
              .catch((e) => toast(e.message, "bad")),
        },
      );
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const ret = d?.retention ?? null,
    at = (x) => (ret?.length ? Math.round(ret.reduce((b, p) => (Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b), ret[0]).y * 100) : null);
  const opts = useMemo(() => {
    if (!d) return [];
    const n = new Map();
    for (const p of d.choices) n.set(p.name, (n.get(p.name) ?? 0) + 1);
    const choices = d.gone ? d.choices.filter((p) => p.id === d.video.projectId) : d.choices;
    return [
      { value: "none", label: "Not linked" },
      ...choices.map((p) => ({
        value: p.id,
        label: p.name,
        icon: p.kind === "personal" ? <Video size={14} /> : <Film size={14} />,
        group: p.likely ? "Likely" : "Your projects",
        hint:
          [p.linkedTo ? `Linked to "${p.linkedTo}" now: picking it moves the link here` : null, p.twin ? twinSays(p) : null]
            .filter(Boolean)
            .join(" · ") || void 0,
        badge: p.likely ? `${Math.round(p.score * 100)}% match` : void 0,
      })),
    ];
  }, [d]);
  const who = d?.owner;
  const unread = !!d?.readFailed && !d?.detailAt,
    notYet = <p className="yt-chart-empty">Not read yet: YouTube could not be reached. Read again once it can be.</p>;
  const lockedWhy = (what) =>
    who === "ended"
      ? what === "ret"
        ? "Google ended the sign-in for this channel, so how long people watch this video can't be read now. Sign in again to see it."
        : "Google ended the sign-in for this channel: sign in again to see where viewers came from."
      : who === "no-analytics"
        ? what === "ret"
          ? "When you signed in, the YouTube Analytics box was not ticked, so YouTube does not share how long people watch. Sign in again and tick both boxes."
          : "This needs the YouTube Analytics box too: sign in again and tick both boxes."
        : who === "own"
          ? what === "ret"
            ? "YouTube shares how long people watch a video only with its channel's owner: sign in with Google for this channel to see it."
            : "Only the channel's owner sees this: sign in with Google for this channel."
          : what === "ret"
            ? "YouTube shares how long people watch a video only with its channel's owner. Is it your channel? Sign in with Google for it (Settings > YouTube)."
            : "Only the channel's owner sees this: on your own channels, once you sign in with Google.";
  const lockedAct = who === "other" ? void 0 : onSignIn,
    lockedLabel = who === "own" ? "Sign in with Google" : "Sign in again";
  return (
    <Modal title="Video" onClose={onClose} wide className="yt-video-modal">
      <div className="modal-body">
        {!d && !err ? (
          <div className="loading">
            <Spinner size={20} kind="orbit" />
            Reading the video…
          </div>
        ) : err && !d ? (
          <div className="hint bad" role="alert">
            <TriangleAlert size={18} />
            <div>
              <b>The video could not be read</b>
              <p>{err}</p>
            </div>
            <button className="btn small" onClick={() => read()}>
              Try again
            </button>
          </div>
        ) : (
          v &&
          d && (
            <>
              <div className="yt-v-top">
                <span className="yt-v-thumb">
                  {v.thumbUrl ? <img src={v.thumbUrl} alt="" draggable={false} /> : <Video size={22} />}
                  {v.duration != null && <i>{clock(v.duration)}</i>}
                </span>
                <div className="yt-v-txt">
                  <h3 dir="auto">{v.title}</h3>
                  <p className="small">
                    {d.gone
                      ? "No longer on YouTube (deleted, or made private)"
                      : v.status === "scheduled"
                        ? `Scheduled for ${dateShort(v.publishAt, true)}`
                        : v.status === "private"
                          ? `${v.views ? "Private" : "Private, not published"}${v.uploadedAt ? ` · uploaded ${dateShort(v.uploadedAt, true)}` : ""}`
                          : `Published ${dateShort(v.publishedAt, true)}`}
                    {!d.gone && v.status === "unlisted" ? " · Unlisted" : ""}
                    {d.detailAt && (
                      <span className="dim">
                        {" · read "}
                        {since(d.detailAt)}
                      </span>
                    )}
                  </p>
                  {!d.gone && (
                    <div className="row wrap yt-v-acts">
                      <button className="btn small" onClick={() => api.external(videoUrl(v.id)).catch(() => {})}>
                        <ExternalLink size={13} />
                        Open on YouTube
                      </button>
                      {who !== "other" && (
                        <button
                          className="btn small"
                          onClick={() => api.external(studioUrl(v.id)).catch(() => {})}
                          title="Impressions and click-through rate are there"
                        >
                          <ExternalLink size={13} />
                          YouTube Studio
                        </button>
                      )}
                      <button className="btn small" onClick={() => read(true)} disabled={busy}>
                        {busy ? <Spinner size={13} /> : <RefreshCw size={13} />}Read again
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {(() => {
                const stats = [
                  ["Views", int(v.views)],
                  ["Watch hours", hours(v.minutes)],
                  ["Avg view duration", clock(v.avgDuration)],
                  ["Avg % viewed", pct(v.avgPct, 1)],
                  ["Likes", int(v.likes)],
                  ["Comments", int(v.comments)],
                  ["Subscribers gained", int(v.subsGained)],
                ].filter(([, val]) => d.analytics || val !== "—");
                return (
                  <div className={`yt-v-stats ${stats.length > 4 ? "many" : ""}`} style={{ "--n": Math.max(stats.length, 3) }}>
                    {stats.map(([l, val]) => (
                      <div key={l}>
                        <small>{l}</small>
                        <b>{val}</b>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div className="yt-v-proj">
                <label className="label" htmlFor="yt-v-project">
                  Project
                </label>
                <Picker
                  id="yt-v-project"
                  value={v.projectId ?? "none"}
                  options={opts}
                  onChange={link}
                  search
                  menuWidth={360}
                  ariaLabel="The project this video came from"
                  disabled={d.gone && !v.projectId}
                />
                {v.projectId && (
                  <button
                    className="btn small"
                    onClick={() => {
                      onClose();
                      openProject({ id: v.projectId, kind: v.projectKind });
                    }}
                  >
                    Open the project
                  </button>
                )}
                <span className="help">
                  {d.gone
                    ? v.projectId
                      ? "The video is no longer on YouTube, so the Channels board no longer shows the project as published. Unlink it here if it is gone for good."
                      : "The video is no longer on YouTube, so it can't be linked to a project."
                    : v.status === "private"
                      ? v.projectId
                        ? "The video is private: on the Channels board the project stays where its files put it until the video is public or scheduled."
                        : "Link the project it came from: once the video is public or scheduled, the Channels board shows it there."
                      : `${v.projectId ? "On the Channels board the project shows" : "Link the project it came from: the Channels board then shows it"} as ${v.status === "scheduled" ? "Scheduled, with the day it goes public" : "Published, with its views"}.`}
                </span>
              </div>
              {d.note && (
                <div className="hint warn">
                  <TriangleAlert size={18} />
                  <div>
                    <b>{d.readFailed ? "It could not be read again just now" : "Not everything could be read"}</b>
                    <p>
                      {d.note}
                      {!d.readFailed
                        ? ""
                        : d.detailAt
                          ? ` These are the numbers read ${since(d.detailAt)}.`
                          : ` These are the numbers from the channel's last read${d.fetchedAt ? `, ${since(d.fetchedAt)}` : ""}.`}
                    </p>
                  </div>
                </div>
              )}
              <section className="yt-v-sec" aria-label="Audience retention">
                <h4>Audience retention</h4>
                {ret?.length ? (
                  <>
                    <p className="yt-ret-sum">
                      {"Still watching: "}
                      {v.duration && v.duration > 60 ? (
                        <>
                          {"at 30 seconds "}
                          <b>{at(30 / v.duration)}%</b>
                        </>
                      ) : (
                        <>
                          {"a quarter of the way in "}
                          <b>{at(0.25)}%</b>
                        </>
                      )}
                      {" · halfway "}
                      <b>{at(0.5)}%</b>
                      {" · at the end "}
                      <b>{at(1)}%</b>
                    </p>
                    <RetentionChart points={ret} duration={v.duration} />
                    {!d.analytics && (
                      <Locked
                        text={`These are the numbers read ${since(d.detailAt)}. ${who === "ended" ? "Google ended the sign-in for this channel, so they no longer update." : "They no longer update: the YouTube Analytics box is not ticked."}`}
                        onSignIn={lockedAct}
                        label={lockedLabel}
                      />
                    )}
                  </>
                ) : !d.analytics ? (
                  <Locked text={lockedWhy("ret")} onSignIn={lockedAct} label={lockedLabel} />
                ) : unread ? (
                  notYet
                ) : (
                  <p className="yt-chart-empty">
                    YouTube has no retention data for this video yet. It shows once enough people have watched it.
                  </p>
                )}
              </section>
              <div className="yt-v-two">
                <section className="yt-v-sec" aria-label="Traffic sources">
                  <h4>Where viewers came from</h4>
                  {d.traffic?.length ? (
                    <Bars
                      items={d.traffic.map((t) => ({
                        label: sourceLabel(t.source),
                        value: t.views,
                        note: `${hours(t.minutes)} watch hours`,
                      }))}
                    />
                  ) : !d.analytics ? (
                    <Locked text={lockedWhy("traffic")} />
                  ) : unread ? (
                    notYet
                  ) : (
                    <p className="yt-chart-empty">No traffic data yet.</p>
                  )}
                </section>
                <section className="yt-v-sec" aria-label="Comments">
                  <h4>Comments</h4>
                  {d.commentsNeedKey && <NeedKey onKey={onKey} />}
                  {d.commentsOff ? (
                    <p className="yt-chart-empty">Comments are turned off for this video.</p>
                  ) : !d.comments.length ? (
                    d.commentsNeedKey ? null : unread ? (
                      notYet
                    ) : (
                      <p className="yt-chart-empty">No comments yet.</p>
                    )
                  ) : (
                    <PanelComments comments={d.comments} />
                  )}
                </section>
              </div>
            </>
          )
        )}
      </div>
    </Modal>
  );
}
