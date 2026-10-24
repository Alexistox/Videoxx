import { useEffect, useMemo, useRef, useState } from "react";
import { api, on } from "../../lib/api";
import { RotateCw, Undo2, UserPlus } from "../../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { FIG_ACTS, FIG_BODIES, FIG_FINISHES, FIG_ROLES, isCustomBody, roleFigure } from "./figures";
import { CharacterUpload } from "./CharacterUpload";

const PICS = import.meta.glob("../../assets/recon-figures/*.png", { eager: true, import: "default" });
const pic = (k) => PICS[`../assets/recon-figures/${k}.png`] ?? null;
const seg = { display: "inline-flex", border: "1px solid #333", borderRadius: 7, overflow: "hidden" };
const segBtn = (on2) => ({
  padding: "3px 8px",
  fontSize: 11.5,
  border: 0,
  background: on2 ? "#3a4a66" : "#1d1d1d",
  color: on2 ? "#fff" : "#bdbdbd",
  cursor: "pointer",
});
const customOf = (b) => (isCustomBody(b) ? b.slice(7) : null);
const figOf = (role, e) => ({ role, body: e.body, ...(e.finish ? { finish: e.finish } : {}), color: e.color });
export function FiguresPicker({ value, onChange, theme, disabled }) {
  const [role, setRole] = useState("main"),
    [act, setAct] = useState("stand"),
    [spin, setSpin] = useState(true);
  const [server, setServer] = useState(null),
    [ready, setReady] = useState(false),
    [shots, setShots] = useState({});
  const [own, setOwn] = useState([]),
    [ownOpen, setOwnOpen] = useState(false);
  useEffect(() => {
    api
      .info()
      .then((i) => setServer(i.server))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const load = () =>
      api
        .charsList()
        .then((r) => setOwn(r.characters.filter((c) => c.status === "ok")))
        .catch(() => {});
    load();
    const off = on("chars:changed", () => {
      load();
      setShots((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !k.includes("|custom:"))));
    });
    return () => {
      off?.();
    };
  }, []);
  const v = value ?? {};
  const put = (id, c) => {
    const n = structuredClone(v);
    if (id === "main") {
      if (c) n.main = c;
      else delete n.main;
    } else {
      n.roles = { ...(n.roles ?? {}) };
      if (c) n.roles[id] = c;
      else delete n.roles[id];
      if (!Object.keys(n.roles).length) delete n.roles;
    }
    onChange(Object.keys(n).length ? n : null);
  };
  const patch = (id, p) => {
    const e = roleFigure(v, id),
      mine = (id === "main" ? v.main : v.roles?.[id]) ?? {};
    const c = {
      body: e.body,
      ...(e.finish ? { finish: e.finish } : {}),
      color: e.color,
      ...(mine.group ? { group: mine.group } : {}),
      ...(mine.name ? { name: mine.name } : {}),
      ...p,
    };
    if (!c.finish) delete c.finish;
    put(id, c);
  };
  const setBody = (id, body) =>
    patch(
      id,
      isCustomBody(body)
        ? { body, finish: void 0 }
        : { body, ...(roleFigure(v, id).finish ? {} : { finish: FIG_ROLES.find((r) => r.id === id)?.finish ?? "matte" }) },
    );
  const th = theme === "investigation" ? "investigation" : "studio",
    eff = roleFigure(v, role);
  const spec = figOf(role, eff),
    key = JSON.stringify(spec);
  const src = useMemo(
    () => (server ? `${server}/fv/charview.html?theme=${th}&act=${act}&fig=${encodeURIComponent(key)}` : null),
    [server, th],
  );
  const frame = useRef(null);
  const post = (m) => {
    if (server) frame.current?.contentWindow?.postMessage(m, server);
  };
  useEffect(() => post({ type: "cz-fig", fig: spec, act, spin }), [key, act, spin, server]);
  const lookKey = (id) => {
    const e = roleFigure(v, id);
    return `${th}|${e.body}|${e.finish}|${e.color}`;
  };
  useEffect(() => {
    const on2 = (e) => {
      if (!server || e.origin !== server || !e.data || typeof e.data !== "object") return;
      if (e.data.type === "cz-ready") setReady(true);
      if (
        e.data.type === "cz-portrait" &&
        typeof e.data.id === "string" &&
        typeof e.data.url === "string" &&
        e.data.url.startsWith("data:image/png")
      )
        setShots((s) => ({ ...s, [e.data.id]: e.data.url }));
    };
    window.addEventListener("message", on2);
    return () => window.removeEventListener("message", on2);
  }, [server]);
  const want = FIG_ROLES.map((r) => lookKey(r.id)).join(",") + "|" + own.map((c) => c.id + c.sheetAt).join(",");
  useEffect(() => {
    if (!ready) return;
    const asked = new Set();
    for (const r of FIG_ROLES) {
      const k = lookKey(r.id);
      if (shots[k] || asked.has(k)) continue;
      asked.add(k);
      post({ type: "cz-portrait", id: k, fig: figOf(r.id, roleFigure(v, r.id)) });
    }
  }, [ready, want]);
  const ownChar = (b) => {
    const id = customOf(b);
    return id ? (own.find((c) => c.id === id) ?? null) : null;
  };
  const effOwn = customOf(eff.body),
    effChar = ownChar(eff.body);
  const bodyAbout = effOwn
    ? effChar
      ? `Your own character ${effChar.name} (${effChar.rig}, ${effChar.height ? effChar.height.toFixed(2) + " m" : "its height"}) on the motion-capture skeleton: every clip, hands that really touch.${eff.finish ? "" : " It keeps its own materials until you pick a finish."}`
      : `Your own character "${effOwn}" is not in your library any more: the male body is drawn instead.`
    : (FIG_BODIES.find((b) => b.id === eff.body)?.about ?? "");
  const about = `${bodyAbout} ${FIG_FINISHES.find((f) => f.id === eff.finish)?.about ?? ""}`;
  return (
    <div className="figs">
      <div className="figs-body">
        <div className="figs-main">
          <table className="figs-table" style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "#8b8b8b", fontSize: 11, textAlign: "left" }}>
                <th style={{ padding: "2px 6px" }}>Role</th>
                <th />
                <th>Body</th>
                <th>Finish</th>
                <th>Colour</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {FIG_ROLES.map((r) => {
                const e = roleFigure(v, r.id),
                  on2 = role === r.id,
                  cid = customOf(e.body),
                  ch = ownChar(e.body);
                const img = shots[lookKey(r.id)] ?? (cid ? (ch?.thumb ?? null) : pic(`${e.body}-${e.finish}`));
                return (
                  <tr
                    key={r.id}
                    className={"figs-row" + (on2 ? " on" : "")}
                    data-role={r.id}
                    data-body={e.body}
                    onClick={() => setRole(r.id)}
                    style={{ background: on2 ? "#232a36" : void 0, cursor: "pointer", borderTop: "1px solid #262626" }}
                  >
                    <td style={{ padding: "3px 6px" }}>
                      <b style={{ fontWeight: 600 }}>{r.label}</b>
                      {!e.own && (
                        <div className="dim" style={{ fontSize: 10.5 }}>
                          Automatic
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 2 }}>
                      {img ? (
                        <img
                          className="figs-portrait"
                          src={img}
                          alt=""
                          style={{ width: 36, height: 48, objectFit: "cover", borderRadius: 4, display: "block", background: "#07080a" }}
                        />
                      ) : (
                        <span style={{ display: "block", width: 36, height: 48, background: "#07080a", borderRadius: 4 }} />
                      )}
                    </td>
                    <td>
                      <select
                        className="input compact figs-body-sel"
                        disabled={disabled}
                        value={e.body}
                        aria-label={`${r.label} body`}
                        title={cid ? (ch?.name ?? cid) : FIG_BODIES.find((b) => b.id === e.body)?.about}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={(ev) => {
                          setRole(r.id);
                          setBody(r.id, ev.target.value);
                        }}
                        style={{ maxWidth: 150, fontSize: 12 }}
                      >
                        {FIG_BODIES.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))}
                        {(own.length > 0 || (cid && !ch)) && (
                          <optgroup label="Your own characters">
                            {own.map((c) => (
                              <option key={c.id} value={`custom:${c.id}`}>
                                {c.name}
                              </option>
                            ))}
                            {cid && !ch && (
                              <option value={e.body}>
                                {cid}
                                {" (missing: male body)"}
                              </option>
                            )}
                          </optgroup>
                        )}
                      </select>
                    </td>
                    <td>
                      <span style={seg} role="radiogroup" aria-label={`${r.label} finish`}>
                        {cid && (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={!e.finish}
                            className="figs-opt-finish"
                            data-v="own"
                            disabled={disabled}
                            title="Its own materials, as uploaded"
                            style={segBtn(!e.finish)}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setRole(r.id);
                              patch(r.id, { finish: void 0 });
                            }}
                          >
                            Own
                          </button>
                        )}
                        {FIG_FINISHES.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            role="radio"
                            aria-checked={e.finish === f.id}
                            className="figs-opt-finish"
                            data-v={f.id}
                            disabled={disabled}
                            title={f.about}
                            style={segBtn(e.finish === f.id)}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setRole(r.id);
                              patch(r.id, { finish: f.id });
                            }}
                          >
                            {f.label}
                          </button>
                        ))}
                      </span>
                    </td>
                    <td>
                      <input
                        type="color"
                        className="figs-color"
                        disabled={disabled || (!!cid && !e.finish)}
                        value={e.color}
                        aria-label={`${r.label} colour`}
                        title={cid && !e.finish ? "Pick a finish to colour your own character" : void 0}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={(ev) => {
                          setRole(r.id);
                          patch(r.id, { color: ev.target.value });
                        }}
                        style={{ width: 34, height: 24, padding: 0, border: "1px solid #333", borderRadius: 5, background: "none" }}
                      />
                    </td>
                    <td>
                      {e.own && (
                        <button
                          type="button"
                          className="icon-btn sm figs-reset"
                          disabled={disabled}
                          title="Back to Automatic (the role's usual look)"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            put(r.id, null);
                          }}
                        >
                          <Undo2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="help figs-about">{about.trim()}</p>
          <div className="figs-own">
            <button
              type="button"
              className={"btn small ghost figs-own-btn" + (ownOpen ? " active" : "")}
              aria-expanded={ownOpen}
              disabled={disabled}
              onClick={() => setOwnOpen(!ownOpen)}
            >
              <UserPlus size={13} />
              Your own characters{own.length ? ` (${own.length})` : ""}
            </button>
            {ownOpen && (
              <div style={{ marginTop: 8 }}>
                <small className="dim" style={{ display: "block", marginBottom: 6 }}>
                  Upload a rigged character, then "Use this character" puts it on the selected role (
                  {FIG_ROLES.find((x) => x.id === role)?.label}).
                </small>
                <CharacterUpload
                  picked={effOwn}
                  onPick={(id) => {
                    if (!disabled) setBody(role, `custom:${id}`);
                  }}
                />
              </div>
            )}
          </div>
        </div>
        <div className="figs-stage">
          <div className="figs-view">
            {src ? (
              <iframe
                ref={frame}
                src={src}
                title={`${FIG_ROLES.find((r) => r.id === role)?.label}: live preview`}
                onLoad={() => post({ type: "cz-fig", fig: spec, act, spin })}
              />
            ) : null}
          </div>
          <div className="figs-ctl">
            <select className="input compact" value={act} onChange={(e) => setAct(e.target.value)} aria-label="Pose">
              {FIG_ACTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={"icon-btn sm" + (spin ? " active" : "")}
              aria-pressed={spin}
              title={spin ? "Stop turning" : "Turn around"}
              onClick={() => setSpin(!spin)}
            >
              <RotateCw size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
