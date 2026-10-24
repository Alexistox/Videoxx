import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CropIcon,
  FilmIcon,
  FolderOpenIcon,
  ImagePlusIcon,
  PlayIcon,
  ScissorsIcon,
  SmartphoneIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { api, on } from "../../lib/api";
import { fmtTime, secs } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Busy, Spinner, Toggle } from "../../components/ui";
import { Picker, Segmented } from "../../components/Picker";
import { CARD_SECONDS, VERTICAL_MAX_RATE, captionAt, trailerRange, verticalFile, verticalStem } from "./verticalCut";

const KEY = (id) => `cz-vertical-${id}`;
const WIN = 9 / 16 / (16 / 9);
const capY = (fill) => (fill === "blur" ? 1440 : 1340) / 1920;
const dur = (s) => (s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const headlineOf = (i, length) => i.defaults.line1 ?? i.defaults.headlines[length === "full" ? "full" : "trailer"];
const CAP_W = 940 / 1080;
function Phone({ img, fill, x, pixel, caption, onX, children }) {
  const box = useRef(null),
    drag = useRef(null),
    cap = useRef(null);
  const [dragging, setDragging] = useState(false);
  useLayoutEffect(() => {
    const c = cap.current,
      b = box.current;
    if (!c || !b) return;
    c.style.fontSize = "";
    const w = c.offsetWidth,
      max = b.clientWidth * CAP_W;
    if (w > max) c.style.fontSize = `${(parseFloat(getComputedStyle(c).fontSize) * max) / w}px`;
  });
  const can = fill === "crop" && !!onX && !!img;
  const down = (e) => {
    if (!can || e.button !== 0) return;
    drag.current = { px: e.clientX, x };
    e.target.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const move = (e) => {
    const d = drag.current,
      b = box.current;
    if (!d || !b || !onX) return;
    const w = b.clientWidth,
      imgW = (b.clientHeight * 16) / 9;
    onX(Math.max(0, Math.min(1, d.x - (e.clientX - d.px) / Math.max(1, imgW - w))));
  };
  const up = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div
      ref={box}
      className={`ex-phone ${pixel ? "pixel" : ""} ${can ? "can-drag" : ""} ${dragging ? "dragging" : ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onDoubleClick={() => can && onX(0.5)}
      title={can ? "Drag to move the picture, double-click to centre it" : void 0}
    >
      {children ??
        (img ? (
          fill === "blur" ? (
            <>
              <img className="ex-ph-img ex-ph-bg" src={img} alt="" draggable={false} />
              <img className="ex-ph-fg" src={img} alt="" draggable={false} style={pixel ? { width: "88.9%", left: "5.55%" } : void 0} />
            </>
          ) : (
            <img className="ex-ph-img" src={img} alt="" draggable={false} style={{ objectPosition: `${x * 100}% 50%` }} />
          )
        ) : (
          <div className="ex-ph-wait">
            <Spinner />
          </div>
        ))}
      {!children && img && caption && (
        <div className="ex-cap" style={{ top: `${capY(fill) * 100}%` }}>
          <span ref={cap}>
            {caption.words.map((w, i) => (
              <Fragment key={i}>
                {i && caption.gaps?.[i - 1] !== 0 ? " " : ""}
                {i === caption.active ? <b>{w}</b> : w}
              </Fragment>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
const PhoneNote = ({ icon, children }) => (
  <Phone img={null} fill="native" x={0.5} pixel={false} caption={null}>
    <div className="ex-ph-err">
      {icon}
      <span>{children}</span>
    </div>
  </Phone>
);
const unseen = new Map();
const dialogs = new Map(),
  followed = new Set();
function follow(projectId) {
  if (followed.has(projectId)) return;
  followed.add(projectId);
  const off = on("render:done", (d) => {
    if (d.projectId !== projectId) return;
    off();
    followed.delete(projectId);
    const shown = dialogs.get(projectId);
    if (shown) {
      shown(d);
      return;
    }
    if (d.cancelled) return;
    unseen.set(projectId, d.error ? { error: d.error } : { res: d.result });
  });
}
export function VerticalTab({ projectId, shots, sel, name, head, busy, setBusy, onClose }) {
  const { toast, go, working, refreshProjects, claude, signIn } = useApp();
  const [info, setInfo] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [o, setO] = useState(null);
  const [frames, setFrames] = useState({});
  const asked = useRef(new Set());
  const [sample, setSample] = useState(0);
  const [view, setView] = useState("video");
  const [card, setCard] = useState({ img: null, busy: false, err: null });
  const [logoV, setLogoV] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const cardReq = useRef(0),
    started = useRef(false),
    strip = useRef(false);
  const [prog, setProg] = useState(null);
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [making, setMaking] = useState(false);
  const [srcData, setSrcData] = useState(null);
  const status = useRef(null);
  useEffect(() => {
    if (busy || res || error) requestAnimationFrame(() => status.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [busy, !!res, !!error]);
  const load = useCallback(
    () =>
      api
        .verticalInfo(projectId)
        .then((i) => {
          setInfo(i);
          setLoadErr(null);
          return i;
        })
        .catch((e) => {
          setLoadErr(e.message);
          return null;
        }),
    [projectId],
  );
  const ended = useRef(() => {});
  ended.current = (d) => {
    setBusy(false);
    setProg(null);
    if (d.cancelled) toast("Export cancelled. Partial files removed.");
    else if (d.error) setError(d.error);
    else setRes(d.result);
    load();
  };
  const attach = (r) => {
    setBusy(true);
    setProg(r.prog);
    follow(projectId);
  };
  const busyNow = useRef(busy);
  busyNow.current = busy;
  useEffect(() => {
    const u = unseen.get(projectId);
    if (u) {
      unseen.delete(projectId);
      if (u.res) setRes(u.res);
      else setError(u.error ?? null);
    }
    const mine = (d) => ended.current(d);
    dialogs.set(projectId, mine);
    return () => {
      if (dialogs.get(projectId) === mine) dialogs.delete(projectId);
      if (busyNow.current) follow(projectId);
    };
  }, []);
  useEffect(
    () =>
      on("project:changed", (e) => {
        if (e.projectId === projectId && e.reload) load();
      }),
    [projectId, load],
  );
  useEffect(() => {
    Promise.all([load(), api.exportRunning(projectId).catch(() => null)]).then(([i, run2]) => {
      if (!i) return;
      const mine =
        run2 && run2.kind !== "video"
          ? {}
          : (() => {
              try {
                return JSON.parse(localStorage.getItem(KEY(projectId)) || "{}");
              } catch {
                return {};
              }
            })();
      const s = { ...(i.saved || {}), ...mine },
        line = (v, d) => (typeof v === "string" ? v : d);
      const length = s.length === "trailer" || (s.length === "range" && sel) ? s.length : "full";
      setO({
        name: "",
        source: i.tall ? "cut" : s.source === "reframe" && i.reframe.can ? "reframe" : "cut",
        fit: s.fit === "blur" ? "blur" : "crop",
        x: typeof s.x === "number" ? Math.max(0, Math.min(1, s.x)) : 0.5,
        captions: s.captions ?? (i.captions.words > 0 && !(i.tall && i.captions.engine && !i.captions.own)),
        length,
        start: Math.max(0, Math.round(s.start ?? 0)),
        max: [30, 45, 60].includes(s.max) ? s.max : 60,
        endCard: {
          on: s.endCard?.on ?? true,
          lines: [line(s.endCard?.lines?.[0], headlineOf(i, length)), line(s.endCard?.lines?.[1], i.defaults.line2)],
          picture: s.endCard?.picture ?? (i.picture.logo ? "logo" : "cover"),
        },
      });
      if (run2 && run2.kind !== "video") attach(run2);
    });
  }, [projectId]);
  const set = (patch) =>
    setO((v) => {
      const n = { ...v, ...patch };
      const usual = (len) => info.defaults.headlines[len === "full" ? "full" : "trailer"];
      if (info && patch.length && patch.length !== v.length && v.endCard.lines[0] === usual(v.length))
        n.endCard = { ...n.endCard, lines: [usual(n.length), n.endCard.lines[1]] };
      const def = [info ? headlineOf(info, n.length) : null, info?.defaults.line2];
      try {
        localStorage.setItem(
          KEY(projectId),
          JSON.stringify({
            ...n,
            name: void 0,
            endCard: { ...n.endCard, lines: n.endCard.lines.map((l, k) => (l === def[k] ? null : l)) },
          }),
        );
      } catch {}
      return n;
    });
  const setCardOpt = (patch) => set({ endCard: { ...o.endCard, ...patch } });
  useEffect(
    () =>
      on("render:progress", (p) => {
        if (p.projectId === projectId) setProg(p);
      }),
    [projectId],
  );
  const sib = info?.reframe.project ?? null,
    sibBusy = !!sib && (working.has(sib.id) || sib.state === "running");
  useEffect(() => {
    if (sib && !working.has(sib.id) && info?.reframe.project?.state === "running") load();
  }, [sib && working.has(sib.id)]);
  const source = o?.source ?? "cut",
    native = !!info && (info.tall || source === "reframe"),
    fill = native ? "native" : (o?.fit ?? "crop");
  const useSib = source === "reframe" && !!sib,
    stamp = sib?.stamp ?? 0;
  useEffect(() => {
    if (!useSib) return;
    let live = true;
    setSrcData(null);
    api
      .verticalShots(projectId, "reframe")
      .then((d) => {
        if (live) setSrcData(d ?? { shots: [], end: 0, phrases: [], stamp: 0 });
      })
      .catch(() => {
        if (live) setSrcData({ shots: [], end: 0, phrases: [], stamp: 0 });
      });
    return () => {
      live = false;
    };
  }, [useSib, sib?.id, stamp]);
  const srcShots = useSib ? (srcData?.shots ?? null) : shots;
  const srcEnd = useSib ? srcData?.end || info?.end || 0 : (info?.end ?? 0),
    srcPhrases = useSib ? (srcData?.phrases ?? []) : (info?.phrases ?? []);
  const ownCaps = !!info && native && (info.tall ? info.captions.own : sib ? !!sib.captions : info.captions.look);
  const range = useMemo(() => {
    if (!info || !o) return null;
    const shotAt = (t) => {
      const l = srcShots ?? [];
      let k = 0;
      while (k + 1 < l.length && l[k + 1].t0 <= t + 0.01) k++;
      return k;
    };
    if (o.length === "range" && sel) {
      const from = Math.max(0, Math.min(sel[0], srcEnd)),
        to = Math.max(from, Math.min(sel[1], srcEnd));
      return { from, to, first: shotAt(from), last: shotAt(Math.max(from, to - 0.05)), endsOn: "range" };
    }
    if (o.length === "trailer" && srcShots?.length) return trailerRange(srcShots, o.start, o.max, o.endCard.on, srcEnd, srcPhrases);
    return { from: 0, to: srcEnd, first: 0, last: Math.max(0, (srcShots?.length ?? 1) - 1), endsOn: "end" };
  }, [info, o?.length, o?.start, o?.max, o?.endCard.on, srcShots, srcEnd, srcPhrases, sel?.[0], sel?.[1]]);
  const times = useMemo(() => {
    const l = srcShots ?? [];
    if (!range || !l.length) return [];
    const parts = l
      .map((s) => ({ a: Math.max(s.t0, range.from), b: Math.min(s.t1 ?? range.to, range.to) }))
      .filter((x) => x.b - x.a > 0.05);
    if (!parts.length) return [+((range.from + range.to) / 2).toFixed(2)];
    const n = Math.min(6, parts.length);
    return Array.from({ length: n }, (_, k) => parts[Math.floor(((k + 0.5) * parts.length) / n)]).map((x) => +((x.a + x.b) / 2).toFixed(2));
  }, [srcShots, range?.from, range?.to]);
  useEffect(() => setSample(0), [times.join()]);
  const srcKey = useSib ? "reframe" : "cut",
    capsOn = !ownCaps || !!o?.captions,
    scenesAt = useSib ? stamp : (info?.stamp ?? 0);
  const fkey = `${srcKey}:${scenesAt}:${ownCaps ? (capsOn ? "c" : "n") : ""}`,
    got = frames[fkey];
  const missing = times.filter((t) => !got || !(String(t) in got)),
    canAsk = !!info && !!o && !(source === "reframe" && !sib);
  useEffect(() => {
    if (!canAsk) return;
    const ask = missing.filter((t) => !asked.current.has(`${fkey}@${t}`));
    if (!ask.length) return;
    ask.forEach((t) => asked.current.add(`${fkey}@${t}`));
    const put = (urls) =>
      setFrames((m) => ({
        ...m,
        [fkey]: { ...m[fkey], ...Object.fromEntries(ask.map((t, i) => [String(t), urls ? (urls[i] ?? null) : false])) },
      }));
    api
      .verticalFrames(projectId, srcKey, ask, capsOn)
      .then(put)
      .catch(() => put(null));
  }, [canAsk, fkey, missing.join()]);
  const imgs = !times.length || missing.length ? null : times.map((t) => got[String(t)]),
    idx = imgs?.length ? Math.min(sample, imgs.length - 1) : 0;
  const frameErr = !!imgs && imgs[idx] === null;
  const frameFail = !!imgs && imgs[idx] === false;
  const cardKey =
    o && range ? JSON.stringify([o.endCard.lines, o.endCard.picture, srcKey, scenesAt, +range.to.toFixed(2), o.captions, logoV]) : "";
  useEffect(() => {
    if (view !== "card" || !o?.endCard.on || !range || !info) return;
    const t = setTimeout(() => {
      const n = ++cardReq.current;
      setCard((c) => ({ ...c, busy: true, err: null }));
      api
        .endCardPreview(projectId, { source: srcKey, card: o.endCard, t: Math.max(0, range.to - 0.1), to: range.to, captions: o.captions })
        .then((img) => {
          if (n === cardReq.current) setCard({ img, busy: false, err: null });
        })
        .catch((e) => {
          if (n === cardReq.current) setCard((c) => ({ ...c, busy: false, err: e.message }));
        });
    }, 450);
    return () => clearTimeout(t);
  }, [view, cardKey, o?.endCard.on]);
  if (loadErr)
    return (
      <>
        <div className="ex-v">
          <div className="ex-v-form">
            {head}
            <div className="hint bad">
              <TriangleAlertIcon size={18} />
              <div>
                <b>The vertical export could not load</b>
                <p>{loadErr}</p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  if (!info || !o || !range)
    return (
      <>
        <div className="ex-v">
          <div className="ex-v-form">
            {head}
            <div className="ex-loading">
              <Busy text="Loading…" />
            </div>
          </div>
        </div>
      </>
    );
  const caps = info.captions;
  const total = range.to - range.from + (o.endCard.on ? CARD_SECONDS : 0);
  const shotOpts = (srcShots ?? []).map((s, i) => ({
    value: String(i),
    label: `${i + 1}. ${s.name.replace(/^\d+[a-z]?:\s*/i, "") || "Shot"}`,
    hint: fmtTime(s.t0),
  }));
  const noShots = !!srcShots && !srcShots.length;
  const ready = !noShots && !!srcShots && (source === "cut" || (!!sib && !sibBusy));
  const kind = o.length === "trailer" ? "trailer" : o.length === "range" ? "clip" : "vertical",
    taken = new Set(info.outFiles.map((f) => f.toLowerCase()));
  const file = name.trim() ? verticalFile(verticalStem(name), kind, (f) => taken.has(f.toLowerCase())) : null;
  const sizeMb = Math.max(1, Math.ceil((total * VERTICAL_MAX_RATE) / 8 / 1e6));
  const estimate = info.speed ? secs(Math.max(5, total / info.speed) * 1e3) : null;
  const tS = times[idx] ?? 0,
    inRange = o.length !== "full" && tS >= range.from && tS < range.to;
  const capWords =
    !ownCaps && o.captions && caps.words > 0 && imgs?.[idx]
      ? captionAt(srcPhrases, inRange ? range.from : 0, inRange ? range.to : srcEnd, tS)
      : null;
  const logoLabel = info.picture.from === "channel" ? "Channel picture" : "Logo";
  const picture = o.endCard.picture === "logo" && !info.picture.logo ? "cover" : o.endCard.picture;
  const where = o.x < 0.35 ? "the left" : o.x > 0.65 ? "the right" : "the middle";
  const l1 = o.endCard.lines[0] ?? "",
    usualHead = info.defaults.headlines[o.length === "full" ? "full" : "trailer"];
  const headFrom = !l1.trim()
    ? "blank"
    : l1 === usualHead
      ? "usual"
      : info.defaults.line1 && l1 === info.defaults.line1
        ? "memory"
        : "typed";
  const l2 = o.endCard.lines[1] ?? "",
    nameFrom =
      info.channel && l2 === info.channel.name
        ? "channel"
        : l2 === info.defaults.title
          ? "title"
          : info.defaults.from === "memory" && l2 === info.defaults.line2
            ? "memory"
            : l2.trim()
              ? "typed"
              : "blank";
  const lock = busy;
  const pickX = (el, cx) => {
    const r = el.getBoundingClientRect();
    set({ x: Math.max(0, Math.min(1, (cx - r.left - (r.width * WIN) / 2) / (r.width * (1 - WIN)))) });
  };
  const run = async () => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    setError(null);
    setRes(null);
    setProg(null);
    try {
      const r = await api.exportVertical(projectId, {
        ...o,
        name: verticalStem(name),
        startAt: o.length === "trailer" ? (srcShots?.[range.first]?.t0 ?? null) : null,
        range: o.length === "range" ? [range.from, range.to] : null,
      });
      if (r.cancelled) toast("Export cancelled. Partial files removed.");
      else setRes(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setProg(null);
      started.current = false;
      load();
    }
  };
  const makeReframe = async () => {
    if (!claude?.loggedIn) {
      toast("Claude is not connected yet. The 9:16 version is laid out by your Claude: sign in, then try again.", "bad", {
        label: "Sign in",
        run: signIn,
      });
      return;
    }
    setMaking(true);
    try {
      const r = await api.reframe(projectId);
      await load();
      refreshProjects();
      if (r.started)
        toast("Claude is laying out the 9:16 version. Keep working; open it any time to watch.", "ok", {
          label: "Open it",
          run: () => go("editor", r.project.id),
        });
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setMaking(false);
    }
  };
  const chooseLogo = async () => {
    const f = await api.pickFile("Choose your logo or channel picture", [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp"] }]);
    if (!f) return;
    try {
      await api.setEndCardLogo(f);
      await load();
      setCardOpt({ picture: "logo" });
      setLogoV((v) => v + 1);
      setView("card");
      setConfirmRemove(false);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const removeLogo = async () => {
    try {
      await api.setEndCardLogo(null);
      setInfo((i) => i && { ...i, picture: { ...i.picture, logo: null, from: null, wordmark: false } });
      setCardOpt({ picture: "cover" });
      setLogoV((v) => v + 1);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setConfirmRemove(false);
    }
  };
  const openSib = sib && (
    <button className="btn small" disabled={lock} onClick={() => go("editor", sib.id)}>
      {sibBusy ? (
        "Open it to watch"
      ) : sib.state === "done" ? (
        <>
          <SmartphoneIcon size={14} />
          Open the 9:16 project
        </>
      ) : (
        "Open it"
      )}
    </button>
  );
  const pct = prog ? (prog.pct != null ? prog.pct : prog.frame / Math.max(1, prog.frames)) * 100 : 2;
  return (
    <>
      <div className="ex-v">
        <div className="ex-v-form">
          {head}
          {info.tall ? (
            <p className="help ex-lead">
              {info.reframeOf ? (
                <>
                  {"This is the 9:16 version of "}
                  <b>{info.reframeOf.name}</b>.
                </>
              ) : (
                "This video is already 9:16."
              )}
              {" Export it full length or as a trailer for Shorts, with captions and an end card."}
            </p>
          ) : (
            <div className="field">
              <label>Made from</label>
              <Segmented
                id="ex-source"
                ariaLabel="Vertical video made from"
                value={source}
                disabled={lock}
                onChange={(v) => {
                  set({ source: v });
                  setSample(0);
                  if (v === "reframe") load();
                }}
                options={[
                  { value: "cut", label: "Vertical cut", icon: <CropIcon size={15} strokeWidth={1.8} /> },
                  { value: "reframe", label: "Reframed version", icon: <SparklesIcon size={15} strokeWidth={1.8} /> },
                ]}
              />
              <span className="help">
                {source === "cut"
                  ? "The 16:9 video turned tall: quick, no Claude needed. For just a trailer, pick Trailer under Length: only that part is exported."
                  : "A real 9:16 version: Claude lays every scene out again for the tall frame."}
              </span>
            </div>
          )}
          {!info.tall && source === "cut" && (
            <>
              <div className="field">
                <label>Fill the frame</label>
                <Segmented
                  id="ex-fit"
                  ariaLabel="Fill the frame"
                  value={o.fit}
                  disabled={lock}
                  onChange={(v) => {
                    set({ fit: v });
                    setView("video");
                  }}
                  options={[
                    { value: "crop", label: "Crop to fill" },
                    { value: "blur", label: "Fit with blurred background" },
                  ]}
                />
                <span className="help">
                  {o.fit === "crop"
                    ? `Keeps ${where} third of the picture, enlarged${info.pixel ? " with hard pixels" : ""}. Pick what stays in view below. ${info.pixel ? "Wide titles and HUD text get cut: Fit keeps them whole." : "Wide titles and side-by-side shots get cut: Fit, or the Reframed version, keeps them whole."}`
                    : "The whole 16:9 picture in the middle, on a blurred copy of itself."}
                </span>
              </div>
              {o.fit === "crop" && (
                <div className="field">
                  <label htmlFor="ex-x">Position</label>
                  <div
                    className={`ex-strip ${info.pixel ? "pixel" : ""} ${lock ? "off" : ""}`}
                    onPointerDown={(e) => {
                      if (lock || e.button !== 0) return;
                      strip.current = true;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      pickX(e.currentTarget, e.clientX);
                      setView("video");
                    }}
                    onPointerMove={(e) => {
                      if (!strip.current) return;
                      if (!(e.buttons & 1)) {
                        strip.current = false;
                        return;
                      }
                      pickX(e.currentTarget, e.clientX);
                    }}
                    onPointerUp={() => {
                      strip.current = false;
                    }}
                    onPointerCancel={() => {
                      strip.current = false;
                    }}
                    onLostPointerCapture={() => {
                      strip.current = false;
                    }}
                  >
                    {imgs?.[idx] ? (
                      <img src={imgs[idx]} alt="" draggable={false} />
                    ) : (imgs && !imgs[idx]) || noShots ? (
                      <div className="ex-ph-err small">No picture for this shot</div>
                    ) : (
                      <div className="ex-ph-wait">
                        <Spinner />
                      </div>
                    )}
                    <i className="ex-win" style={{ left: `${o.x * (1 - WIN) * 100}%`, width: `${WIN * 100}%` }} />
                  </div>
                  <div className="row ex-x">
                    <span className="small">Left</span>
                    <input
                      id="ex-x"
                      type="range"
                      className="range grow"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(o.x * 100)}
                      aria-label="Crop position"
                      disabled={lock}
                      onChange={(e) => {
                        set({ x: +e.target.value / 100 });
                        setView("video");
                      }}
                    />
                    <span className="small">Right</span>
                    <button className="btn tiny" disabled={lock || Math.abs(o.x - 0.5) < 5e-3} onClick={() => set({ x: 0.5 })}>
                      Centre
                    </button>
                  </div>
                  <span className="help">
                    The same position is used for the whole video. Check it on a few shots with the arrows under the phone.
                  </span>
                </div>
              )}
            </>
          )}
          {!info.tall && source === "reframe" && (
            <div className="ex-reframe">
              {!info.reframe.can ? (
                <div className="hint warn">
                  <TriangleAlertIcon size={18} />
                  <div>
                    <b>
                      {info.reframe.styleName}
                      {" can't be reframed"}
                    </b>
                    <p>{info.reframe.why}</p>
                    <button className="btn small" style={{ marginTop: 10 }} disabled={lock} onClick={() => set({ source: "cut" })}>
                      Use the vertical cut
                    </button>
                  </div>
                </div>
              ) : !sib ? (
                <div className="note">
                  <b className="ex-b">Make a real 9:16 version</b>
                  <p>
                    {"Claude copies this project to "}
                    <b>
                      {info.title}
                      {" (9:16)"}
                    </b>
                    {
                      " (same voiceover, timing and sound) and lays every scene out again for the tall frame, checking each shot as it goes. It runs on your Claude plan and takes about as long as a build. This video stays exactly as it is."
                    }
                  </p>
                  <p>
                    {"Only need a trailer for Shorts? "}
                    <button className="btn tiny" disabled={lock} onClick={() => set({ source: "cut", length: "trailer" })}>
                      Make a trailer from the vertical cut
                    </button>
                    {" It needs no 9:16 version."}
                  </p>
                  <button className="btn small" onClick={makeReframe} disabled={making || lock}>
                    {making ? <Spinner size={13} /> : <SparklesIcon size={14} />}Make the 9:16 version
                  </button>
                </div>
              ) : sibBusy ? (
                <div className="note">
                  <Busy text="Claude is laying out the 9:16 version" />
                  <p>You can close this and keep working. Export it here when Claude is done.</p>
                  {openSib}
                </div>
              ) : sib.state === "done" ? (
                <div className="note">
                  <b className="ex-b">
                    {sib.name}
                    {" is ready"}
                  </b>
                  <p>Export it here with the options below, or open it to fine-tune shots with Claude.</p>
                  {openSib}
                </div>
              ) : sib.state === "reverted" ? (
                <div className="hint warn">
                  <TriangleAlertIcon size={18} />
                  <div>
                    <b>The 9:16 layout was undone</b>
                    <p>
                      {sib.name}
                      {
                        " is back to the 16:9 layout (the layout was undone in its History). Lay it out again with Claude, or open it and redo it there."
                      }
                    </p>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="btn small" onClick={makeReframe} disabled={making || lock}>
                        {making ? <Spinner size={13} /> : <SparklesIcon size={14} />}Lay it out again
                      </button>
                      {openSib}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="hint warn">
                  <TriangleAlertIcon size={18} />
                  <div>
                    <b>{sib.state ? "The layout stopped before it finished" : "Claude hasn't laid it out yet"}</b>
                    <p>
                      {sib.name}
                      {" exists, but some scenes may still be laid out for 16:9. Let Claude continue, or open it and ask for what's left."}
                    </p>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="btn small" onClick={makeReframe} disabled={making || lock}>
                        {making ? <Spinner size={13} /> : <SparklesIcon size={14} />}
                        {sib.state ? "Continue with Claude" : "Lay it out with Claude"}
                      </button>
                      {openSib}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="opt">
            <span>
              Captions
              <small>
                {!caps.words && !ownCaps
                  ? "No timed words yet: run Time words first."
                  : ownCaps
                    ? info.tall || sib
                      ? "The video's own captions."
                      : "The 9:16 version will show the video's own captions."
                    : native && caps.engine
                      ? "Its look has no captions of its own, so these are big word-by-word captions in the lower part."
                      : caps.engine
                        ? "Big word-by-word captions in the lower part. The 16:9 captions are left out (they would be cut off)."
                        : "Big word-by-word captions in the lower part, from the timed words."}
              </small>
            </span>
            <Toggle
              label="Captions"
              on={o.captions && (ownCaps || !!caps.words)}
              disabled={lock || (!ownCaps && !caps.words)}
              onChange={(v) => {
                set({ captions: v });
                setView("video");
              }}
            />
          </div>
          <div className="field ex-len">
            <label>Length</label>
            <Segmented
              id="ex-length"
              ariaLabel="Length"
              value={o.length}
              disabled={lock}
              onChange={(v) => set({ length: v })}
              options={[
                { value: "full", label: "Full video", hint: dur(srcEnd) },
                { value: "trailer", label: "Trailer", hint: "Shorts" },
                ...(sel ? [{ value: "range", label: "Selected", hint: `${fmtTime(sel[0])}–${fmtTime(sel[1])}` }] : []),
              ]}
            />
            {o.length === "range" && (
              <span className="help ex-sum">
                <ScissorsIcon size={12} />
                {"The range selected on the timeline · "}
                {fmtTime(range.from)}
                {" → "}
                {fmtTime(range.to)}
                {" · "}
                {(range.to - range.from).toFixed(1)}
                {" s"}
                {o.endCard.on ? ` · + ${CARD_SECONDS} s end card = ${total.toFixed(1)} s` : ""}
                {total > 60.05 ? " · longer than a Short (60 s)" : ""}
              </span>
            )}
            {o.length === "trailer" && (
              <>
                <div className="row ex-trailer">
                  <div className="grow">
                    <span className="label">Starts at</span>
                    <Picker
                      id="ex-start"
                      ariaLabel="Trailer starts at shot"
                      value={String(range.first)}
                      options={shotOpts}
                      onChange={(v) => set({ start: +v })}
                      disabled={lock || !shotOpts.length}
                      menuWidth={340}
                    />
                  </div>
                  <div>
                    <span className="label">Up to</span>
                    <Segmented
                      id="ex-max"
                      ariaLabel="Longest trailer"
                      value={String(o.max)}
                      disabled={lock}
                      onChange={(v) => set({ max: +v })}
                      options={[
                        { value: "30", label: "30 s" },
                        { value: "45", label: "45 s" },
                        { value: "60", label: "60 s" },
                      ]}
                    />
                  </div>
                </div>
                {!!srcShots?.length && (
                  <span className="help ex-sum">
                    <ScissorsIcon size={12} />
                    {range.last > range.first ? `Shots ${range.first + 1}–${range.last + 1}` : `Shot ${range.first + 1}`}
                    {" · "}
                    {fmtTime(range.from)}
                    {" → "}
                    {fmtTime(range.to)}
                    {" · "}
                    {(range.to - range.from).toFixed(1)}
                    {" s"}
                    {range.endsOn === "shot"
                      ? " · ends where a shot ends"
                      : range.endsOn === "phrase"
                        ? " · ends after a sentence (the next shot is too long)"
                        : range.endsOn === "end"
                          ? " · to the end of the video"
                          : ""}
                    {o.endCard.on ? ` · + ${CARD_SECONDS} s end card = ${total.toFixed(1)} s` : ""}
                  </span>
                )}
              </>
            )}
            {o.length !== "full" && srcEnd > 0 && (
              <span className="help ex-only">
                {"Only these "}
                {dur(range.to - range.from)}
                {" are rendered, not the whole "}
                {dur(srcEnd)}
                {" video: "}
                {native ? "straight from its 9:16 scenes" : "cut from the 16:9 scenes, nothing is rebuilt for 9:16"}
                {estimate ? `. About ${estimate} to export.` : "."}
              </span>
            )}
          </div>
          <div className={`opt ${o.endCard.on ? "ex-open" : ""}`}>
            <span>
              End card
              <small>
                {CARD_SECONDS}
                {" s at the end: where to watch the full video, your name and picture."}
              </small>
            </span>
            <Toggle
              label="End card"
              on={o.endCard.on}
              disabled={lock}
              onChange={(v) => {
                setCardOpt({ on: v });
                setView(v ? "card" : "video");
                if (v)
                  requestAnimationFrame(() => document.querySelector(".ex-card")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
              }}
            />
          </div>
          {o.endCard.on && (
            <div className="ex-card">
              <div className="field">
                <label htmlFor="ex-l1">Headline</label>
                <input
                  id="ex-l1"
                  className="input"
                  maxLength={60}
                  value={o.endCard.lines[0] ?? ""}
                  disabled={lock}
                  onFocus={() => setView("card")}
                  onChange={(e) => setCardOpt({ lines: [e.target.value, o.endCard.lines[1]] })}
                  placeholder="No headline"
                />
                <span className="help ex-name-help">
                  {headFrom === "usual"
                    ? `The usual headline for ${o.length === "full" ? "a full video" : o.length === "range" ? "a clip" : "a trailer"}.`
                    : headFrom === "memory"
                      ? "From an earlier end card: a headline you type carries over to your next videos."
                      : headFrom === "blank"
                        ? "No headline on the card."
                        : "A headline you type carries over to your next videos."}
                  {headFrom !== "usual" && (
                    <button
                      className="text-btn link"
                      disabled={lock}
                      onClick={() => setCardOpt({ lines: [usualHead, o.endCard.lines[1]] })}
                    >
                      Use the usual headline
                    </button>
                  )}
                </span>
              </div>
              <div className="field">
                <label htmlFor="ex-l2">Name</label>
                <input
                  id="ex-l2"
                  className="input"
                  maxLength={48}
                  value={l2}
                  disabled={lock}
                  onFocus={() => setView("card")}
                  onChange={(e) => setCardOpt({ lines: [o.endCard.lines[0], e.target.value] })}
                  placeholder="No name"
                />
                <span className="help ex-name-help">
                  {nameFrom === "channel"
                    ? `From the channel ${info.channel.name}.`
                    : nameFrom === "title"
                      ? "The video's title. A channel name you type instead is remembered for your next videos."
                      : nameFrom === "memory"
                        ? "Remembered from an earlier end card (a channel name carries over to your next videos)."
                        : nameFrom === "blank"
                          ? "No name on the card."
                          : "A channel name is remembered for your next videos (a title isn't)."}
                  {nameFrom !== "title" && nameFrom !== "channel" && (
                    <button
                      className="text-btn link"
                      disabled={lock}
                      onClick={() => setCardOpt({ lines: [o.endCard.lines[0], info.defaults.title] })}
                    >
                      Use the title
                    </button>
                  )}
                </span>
              </div>
              <div className="field" style={{ marginBottom: 6 }}>
                <label>Picture</label>
                <div className="row ex-pic">
                  <Segmented
                    id="ex-picture"
                    ariaLabel="End card picture"
                    value={picture}
                    disabled={lock}
                    onChange={(v) => {
                      if (v === "logo" && !info.picture.logo) {
                        chooseLogo();
                        return;
                      }
                      setCardOpt({ picture: v });
                      setView("card");
                    }}
                    options={[
                      { value: "logo", label: info.picture.logo ? logoLabel : "Logo…" },
                      { value: "cover", label: "Video picture" },
                    ]}
                  />
                  {info.picture.logo && (
                    <img
                      className={`ex-logo ${info.picture.wordmark ? "wordmark" : ""} ${info.picture.dark ? "dark" : ""}`}
                      src={info.picture.logo}
                      alt={info.picture.from === "channel" ? "The channel picture" : "Your logo"}
                    />
                  )}
                  {info.picture.from !== "channel" && !confirmRemove && (
                    <button className="text-btn link" disabled={lock} onClick={chooseLogo}>
                      <ImagePlusIcon size={13} />
                      {info.picture.logo ? "Change" : "Choose a logo"}
                    </button>
                  )}
                  {info.picture.from === "logo" &&
                    (confirmRemove ? (
                      <span className="ex-confirm" role="group" aria-label="Remove the logo">
                        Remove it from every video's end card?
                        <button className="text-btn bad" onClick={removeLogo}>
                          Remove
                        </button>
                        <button className="text-btn" onClick={() => setConfirmRemove(false)}>
                          Keep it
                        </button>
                      </span>
                    ) : (
                      <button className="text-btn" disabled={lock} onClick={() => setConfirmRemove(true)}>
                        Remove
                      </button>
                    ))}
                </div>
                <span className="help">
                  {picture === "logo"
                    ? info.picture.from === "channel"
                      ? `The picture of the channel ${info.channel?.name ?? ""}, in a circle. Change it on the Channels page.`
                      : "In a circle, like a channel avatar. One logo for all your videos."
                    : "The video's card picture with a play button."}
                </span>
                {info.picture.note && (
                  <span className="help warn" style={{ display: "block", marginTop: 4 }}>
                    {info.picture.note}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="ex-v-side">
          <div className="tabs sm" role="tablist" aria-label="Preview">
            <button
              role="tab"
              aria-selected={view === "video"}
              className={view === "video" ? "active" : ""}
              onClick={() => setView("video")}
            >
              <FilmIcon size={13} />
              Shots
            </button>
            <button
              role="tab"
              aria-selected={view === "card"}
              className={view === "card" ? "active" : ""}
              disabled={!o.endCard.on}
              onClick={() => setView("card")}
            >
              End card
            </button>
          </div>
          {view === "card" && o.endCard.on ? (
            <Phone img={null} fill="native" x={0.5} pixel={false} caption={null}>
              {card.img ? (
                <img className="ex-ph-img" src={card.img} alt="End card preview" draggable={false} />
              ) : (
                !card.err && (
                  <div className="ex-ph-wait">
                    <Spinner />
                  </div>
                )
              )}
              {card.busy && card.img && (
                <span className="ex-ph-busy">
                  <Spinner size={13} />
                </span>
              )}
              {card.err && (
                <div className="ex-ph-err">
                  <TriangleAlertIcon size={16} />
                  <span>{card.err}</span>
                </div>
              )}
            </Phone>
          ) : source === "reframe" && !info.reframe.can ? (
            <PhoneNote icon={<SmartphoneIcon size={18} />}>
              {info.reframe.styleName}
              {" can't be reframed. Use the vertical cut: it shows here."}
            </PhoneNote>
          ) : source === "reframe" && !sib ? (
            <PhoneNote icon={<SmartphoneIcon size={18} />}>The 9:16 version appears here once Claude has made it.</PhoneNote>
          ) : noShots ? (
            <PhoneNote icon={<TriangleAlertIcon size={16} />}>
              {useSib ? (
                <>
                  {sib.name}
                  {" has no shots to show: its scenes failed to load. Open it and fix the error it shows."}
                </>
              ) : (
                "This video has no shots to show: its scenes failed to load, or there are none yet. Fix the error the editor shows first."
              )}
            </PhoneNote>
          ) : frameFail ? (
            <PhoneNote icon={<TriangleAlertIcon size={16} />}>No preview: the frames could not be rendered.</PhoneNote>
          ) : frameErr ? (
            <PhoneNote icon={<TriangleAlertIcon size={16} />}>
              {useSib ? (
                <>
                  {"This shot of "}
                  {sib.name}
                  {" has an error, so it has no preview. Open it and fix it there (the export would stop at it too)."}
                </>
              ) : (
                "This shot has an error, so it has no preview. Fix it in the editor first (the export would stop there too)."
              )}
            </PhoneNote>
          ) : (
            <Phone
              img={imgs?.[idx] || null}
              fill={fill}
              x={o.x}
              pixel={info.pixel && !native}
              caption={capWords}
              onX={lock ? void 0 : (x) => set({ x })}
            />
          )}
          {view === "video" && imgs && imgs.length > 1 && !(source === "reframe" && !sib) && (
            <div className="ex-samples">
              <button
                className="icon-btn sm"
                aria-label="Previous sample"
                onClick={() => setSample((i) => (Math.min(i, imgs.length - 1) + imgs.length - 1) % imgs.length)}
              >
                <ChevronLeftIcon size={15} />
              </button>
              <span className="small">
                {idx + 1}
                {" / "}
                {imgs.length}
                {" · "}
                {fmtTime(times[idx] ?? 0)}
              </span>
              <button
                className="icon-btn sm"
                aria-label="Next sample"
                onClick={() => setSample((i) => (Math.min(i, imgs.length - 1) + 1) % imgs.length)}
              >
                <ChevronRightIcon size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
      <div ref={status}>
        {busy && (
          <div>
            <div className="progress">
              <i style={{ width: `${pct}%` }} />
            </div>
            <small>
              {prog?.phase
                ? `${prog.phase}… ${Math.round(pct)} %${prog.left ? ` · about ${secs(prog.left * 1e3)} left` : ""}`
                : prog
                  ? `Rendering the frames… ${Math.round(pct)} % · ${prog.frame} / ${prog.frames} frames · ${Math.round(prog.fps)} fps`
                  : "Starting the renderer…"}
            </small>
            <small className="dim ex-bg-note">
              You can close this window: the export keeps going (its progress shows in the sidebar) and the app tells you when it's done.
            </small>
          </div>
        )}
        {res && (
          <div className="note" style={{ marginTop: 18 }}>
            <b style={{ fontWeight: 500 }}>
              {"Done in "}
              {res.seconds.toFixed(1)}s
            </b>
            {" · "}
            {res.path.split(/[\\/]/).pop()}
            {" · "}
            {res.duration.toFixed(1)}
            {" s"}
            {res.notes?.map((n, i) => (
              <p key={i} className="help" style={{ marginTop: 6 }}>
                {n}
              </p>
            ))}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn small" onClick={() => api.open(res.path)}>
                <PlayIcon size={14} />
                Play
              </button>
              <button className="btn small" onClick={() => api.reveal(res.path)}>
                <FolderOpenIcon size={14} />
                Show in folder
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="hint bad" style={{ marginTop: 18 }}>
            <TriangleAlertIcon size={18} />
            <div>
              <b>Export failed</b>
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>
      <div className="modal-actions">
        <span className="small ex-out" title="The file is at most this big (8 Mbit/s); simple pictures come out smaller">
          {"1080×1920 · "}
          {total.toFixed(1)}
          {" s · up to "}
          {sizeMb}
          {" MB"}
          {estimate ? ` · about ${estimate}` : ""}
          {" ·"}
          {file ? <b>{file}</b> : <span className="ex-warn">Type a file name</span>}
        </span>
        {busy && (
          <button className="btn ex-cancel" onClick={() => api.cancelExport(projectId)}>
            Cancel export
          </button>
        )}
        <button className="btn ex-close" onClick={onClose}>
          {busy ? "Close, keep exporting" : "Close"}
        </button>
        <button
          className="btn primary"
          onClick={run}
          disabled={busy || !ready || !file}
          title={
            !file
              ? "Type a file name first"
              : noShots
                ? "There are no shots to export"
                : !ready && source === "reframe"
                  ? !info.reframe.can
                    ? `${info.reframe.styleName} can't be reframed: use the vertical cut`
                    : sib
                      ? "Claude is still laying out the 9:16 version"
                      : "Make the 9:16 version first"
                  : void 0
          }
        >
          {busy ? <Spinner size={14} /> : <SmartphoneIcon size={15} />}
          {o.length === "trailer" ? "Export trailer" : o.length === "range" ? "Export clip" : "Export vertical"}
        </button>
      </div>
    </>
  );
}
