import { useEffect, useRef, useState } from "react";
import { CopyIcon, LockIcon, Palette, PlusIcon, SaveIcon, SlidersHorizontalIcon, TrashIcon, WandSparklesIcon } from "lucide-react";
import { api, isOwnStyle, offeredLook, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Spinner } from "../components/ui";
import { SettingsControls, setAt } from "../settings/project/SettingsControls";
import { isStandard, premiumMsg, usePlan } from "../state/usePlan";
import { LOOK_PREVIEW, STYLE_PREVIEW, STYLE_PREVIEW_TALL } from "./stylePreviews";
import { CustomStyleCard, ImportRuns, KitActions, NoCustomStyles } from "./StyleKit";
import { Characters } from "./Characters";

export function Presets() {
  const { toast, projects, startStudio } = useApp();
  const std = isStandard(usePlan());
  const newLook = (id) => (std ? toast(premiumMsg("The Style Studio")) : startStudio({ mode: "look", target: id }));
  const [hoverLook, setHoverLook] = useState(null);
  const [group, setGroup] = useState("builtin");
  const [all, setAll] = useState([]);
  const [styles, setStyles] = useState([]);
  const [kit, setKit] = useState(null);
  const [styleId, setStyleId] = useState("pixel-art");
  const [hoverStyle, setHoverStyle] = useState(null);
  const list = all.filter(
    (p) =>
      (p.style_id || "pixel-art") === styleId &&
      offeredLook(
        styles.find((x) => x.id === styleId),
        p,
      ),
  );
  const style = styles.find((x) => x.id === styleId && (group === "custom" ? isOwnStyle(x) : !isOwnStyle(x)));
  const customs = styles.filter((s2) => isOwnStyle(s2) && !s2.missing);
  const loadStyles = () => {
    api
      .styleKitInfo()
      .then(setKit)
      .catch(() => {});
    return api.styles().then((l) => {
      setStyles(l);
      return l;
    });
  };
  useEffect(() => {
    loadStyles();
    return on("styles:changed", () => {
      loadStyles();
      api
        .presets()
        .then(setAll)
        .catch(() => {});
    });
  }, []);
  const [sel, setSel] = useState("crisp");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("looks");
  const load = async (keep) => {
    const l = await api.presets();
    setAll(l);
    const p = l.find((x) => x.id === (keep ?? sel)) ?? l[0];
    if (p) {
      setSel(p.id);
      setDraft(structuredClone(p));
    }
  };
  useEffect(() => {
    load();
  }, []);
  const set = (path, v) => setDraft((d) => (d ? { ...d, settings: setAt(d.settings, path, v) } : d));
  const dup = async () => {
    if (!draft) return;
    const p = await api.savePreset({ name: draft.name + " copy", description: draft.description, settings: draft.settings, styleId });
    toast("Duplicated. Edit your copy.");
    load(p.id);
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await api.savePreset({ id: draft.id, name: draft.name, description: draft.description, settings: draft.settings });
      toast("Preset saved. Apply it to a project from the editor’s Look panel.");
      load(draft.id);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!draft) return;
    try {
      await api.deletePreset(draft.id);
      toast("Look deleted.");
      load(style?.defaultLook ?? "crisp");
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  useEffect(() => {
    const st = styles.find((x) => x.id === styleId);
    if (st) setGroup(isOwnStyle(st) ? "custom" : "builtin");
  }, [styleId, styles.length]);
  const lastIn = useRef({ builtin: "pixel-art", custom: null });
  const mineIn = (g) => (x) => !x.legacy && !x.hidden && !x.missing && (g === "custom" ? isOwnStyle(x) : !isOwnStyle(x));
  const switchGroup = (g) => {
    if (g === group) return;
    const cur = styles.find((x) => x.id === styleId);
    if (cur) lastIn.current[isOwnStyle(cur) ? "custom" : "builtin"] = cur.id;
    setGroup(g);
    const next = styles.find((x) => x.id === lastIn.current[g] && mineIn(g)(x)) ?? styles.find(mineIn(g));
    if (next) pickStyle(next.id);
    else {
      setStyleId("");
      setDraft(null);
    }
  };
  const pickStyle = (id, from = styles, looks = all) => {
    setStyleId(id);
    const st = from.find((x) => x.id === id),
      p = looks.find((x) => x.id === st?.defaultLook) ?? looks.find((x) => (x.style_id || "pixel-art") === id);
    if (p) {
      setSel(p.id);
      setDraft(structuredClone(p));
    }
  };
  const afterDelete = async (id) => {
    const l = await loadStyles();
    const next = l.find((x) => x.id !== id && mineIn("custom")(x));
    if (next) pickStyle(next.id, l);
    else {
      setStyleId("");
      setDraft(null);
    }
  };
  useEffect(() => {
    if (!styles.length || !all.length) return;
    let want = null;
    try {
      want = sessionStorage.getItem("cz-styles-tab");
      sessionStorage.removeItem("cz-styles-tab");
    } catch {}
    if (want === "flat:characters") {
      pickStyle("flat");
      setTab("characters");
    } else if (want?.startsWith("custom:")) {
      const id = want.slice(7);
      setGroup("custom");
      if (styles.some((x) => x.id === id)) pickStyle(id);
      else {
        const f = styles.find(mineIn("custom"));
        if (f) pickStyle(f.id);
        else {
          setStyleId("");
          setDraft(null);
        }
      }
    }
  }, [styles.length, all.length]);
  const hasChars = !!style && (style.id === "flat" || style.base === "flat");
  const s = style ? draft?.settings : void 0,
    ro = !!draft?.builtin;
  const used = projects.filter((p) => p.preset_id === draft?.id && !p.lab).length;
  const looksOf = (st) => all.filter((p) => (p.style_id || "pixel-art") === st.id && offeredLook(st, p)).length;
  return (
    <div className="page page-enter">
      <div className="page-head">
        <div>
          <h1>Styles</h1>
          <div className="sub">
            What kind of video a project is. Each style has its own looks: bundles of resolution, outlines and post-processing you apply to
            a whole video at once.
          </div>
        </div>
      </div>
      <div className="seg-ctl style-group" role="tablist" aria-label="Which styles">
        <button
          role="tab"
          aria-selected={group === "builtin"}
          className={group === "builtin" ? "on" : ""}
          onClick={() => switchGroup("builtin")}
        >
          Built-in
        </button>
        <button
          role="tab"
          aria-selected={group === "custom"}
          className={group === "custom" ? "on" : ""}
          onClick={() => switchGroup("custom")}
        >
          Custom{customs.length ? ` (${customs.length})` : ""}
        </button>
      </div>
      {group === "builtin" && (
        <div className="style-strip" role="tablist" aria-label="Styles">
          {styles
            .filter((st) => (!st.legacy || st.id === styleId) && (!st.hidden || st.id === styleId) && !isOwnStyle(st))
            .map((st) => (
              <div
                key={st.id}
                className="sd-cardwrap"
                onMouseEnter={() => setHoverStyle(st.id)}
                onMouseLeave={() => setHoverStyle((h) => (h === st.id ? null : h))}
              >
                <button
                  role="tab"
                  aria-selected={st.id === styleId}
                  className={`style-card ${st.id === styleId ? "on" : ""}`}
                  onClick={() => pickStyle(st.id)}
                  onFocus={() => setHoverStyle(st.id)}
                  onBlur={() => setHoverStyle((h) => (h === st.id ? null : h))}
                >
                  <span className="row">
                    <Palette size={16} strokeWidth={1.7} />
                    <b>{st.name}</b>
                    <span className="grow" />
                    <small className="dim">{((n) => `${n} look${n === 1 ? "" : "s"}`)(looksOf(st))}</small>
                  </span>
                  <small className="muted">{st.tagline}</small>
                  {hoverStyle === st.id && (STYLE_PREVIEW[st.id] || st.preview) && (
                    <span className={`style-preview ${STYLE_PREVIEW_TALL.has(st.id) ? "tall" : ""}`} aria-hidden="true">
                      <video src={STYLE_PREVIEW[st.id] || st.preview} autoPlay muted loop playsInline />
                    </span>
                  )}
                </button>
                {!st.legacy && !st.missing && (
                  <button
                    className="btn tiny sd-newlook"
                    onClick={() => newLook(st.id)}
                    aria-label={`New look for ${st.name}`}
                    title={`A look = ${st.name} with your own settings (colours, grade, camera, captions). A style with new elements is made with the Style Kit (Custom tab).`}
                  >
                    <WandSparklesIcon size={12} />
                    New look{std && <span className="premium-pill">Premium</span>}
                  </button>
                )}
              </div>
            ))}
        </div>
      )}
      {group === "custom" && (
        <>
          <KitActions />
          <ImportRuns />
          {customs.length ? (
            <>
              <div className="sec-title" style={{ margin: "4px 0 10px" }}>
                Your styles
              </div>
              <div className="sk-grid" role="list" aria-label="Your styles">
                {customs.map((st) => (
                  <div key={st.id} role="listitem">
                    <CustomStyleCard
                      st={st}
                      info={kit?.styles.find((x) => x.id === st.id) ?? null}
                      on={st.id === styleId}
                      looks={looksOf(st)}
                      onSelect={() => pickStyle(st.id)}
                      onNewLook={() => newLook(st.id)}
                      onDeleted={() => afterDelete(st.id)}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <NoCustomStyles />
          )}
        </>
      )}
      {style && group === "builtin" && (
        <p className="muted" style={{ fontSize: 13, margin: "0 0 18px", maxWidth: 900 }}>
          {style.description}
        </p>
      )}
      {hasChars && (
        <div className="seg-ctl look-tabs" role="tablist" aria-label={`${style.name} sections`}>
          <button role="tab" aria-selected={tab === "looks"} className={tab === "looks" ? "on" : ""} onClick={() => setTab("looks")}>
            Looks
          </button>
          <button
            role="tab"
            aria-selected={tab === "characters"}
            className={tab === "characters" ? "on" : ""}
            onClick={() => setTab("characters")}
          >
            Characters
          </button>
        </div>
      )}
      {hasChars && tab === "characters" && <Characters />}
      {style && !(hasChars && tab === "characters") && (
        <>
          <div className="sec-title" style={{ margin: "0 0 10px" }}>
            {"Looks in "}
            {style.name}
          </div>
          <div className="preset-grid">
            <section className="panel" style={{ padding: 8 }} aria-label="Looks">
              {list.map((p) => {
                const pv =
                  LOOK_PREVIEW[p.id] ??
                  (style && isOwnStyle(style) && p.id === style.defaultLook && style.poster
                    ? { video: style.preview ?? void 0, poster: style.poster }
                    : p.preview
                      ? { poster: p.preview }
                      : null);
                return (
                  <button
                    key={p.id}
                    className={`preset-item ${sel === p.id ? "on" : ""}`}
                    onClick={() => {
                      setSel(p.id);
                      setDraft(structuredClone(p));
                    }}
                    onMouseEnter={() => setHoverLook(p.id)}
                    onMouseLeave={() => setHoverLook((h) => (h === p.id ? null : h))}
                  >
                    {pv && (
                      <span className={`look-thumb ${pv.tall ? "tall" : ""}`}>
                        {hoverLook === p.id && pv.video ? (
                          <video src={pv.video} poster={pv.poster} autoPlay muted loop playsInline />
                        ) : (
                          <img src={pv.poster} alt="" />
                        )}
                      </span>
                    )}
                    <span className="row">
                      {p.name}
                      {p.origin === "studio" ? (
                        <span className="sd-yours" title="A look you made in the Style Studio">
                          Yours
                        </span>
                      ) : (
                        p.builtin && <LockIcon size={12} className="dim" />
                      )}
                    </span>
                    <small className="muted">{p.description}</small>
                  </button>
                );
              })}
              {style && !style.legacy && !style.missing && (
                <button className="preset-item custom-look" onClick={() => newLook(style.id)}>
                  <span className="row">
                    <PlusIcon size={14} strokeWidth={2} />
                    New look{std && <span className="premium-pill">Premium</span>}
                  </span>
                  <small className="muted">
                    Describe the look you want (with reference images or videos): Claude sets it up in the Style Studio, the app checks it,
                    you save it.
                  </small>
                </button>
              )}
            </section>
            {draft && s ? (
              <section className="panel pad" aria-label="Look settings">
                <div className="row" style={{ marginBottom: 18 }}>
                  <SlidersHorizontalIcon size={18} strokeWidth={1.7} />
                  <input
                    className="ed-title grow"
                    value={draft.name}
                    disabled={ro}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    aria-label="Look name"
                  />
                  {ro && (
                    <span className="badge gray">
                      <i />
                      {draft.origin === "studio"
                        ? "Made in the Style Studio · read-only"
                        : isOwnStyle(style)
                          ? "The style's own look · read-only"
                          : "Built-in · read-only"}
                    </span>
                  )}
                  <small>
                    {used}
                    {" project"}
                    {used === 1 ? "" : "s"}
                  </small>
                </div>
                <div className="field">
                  <label>Description</label>
                  <input
                    className="input"
                    disabled={ro}
                    value={draft.description ?? ""}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>
                {style && (
                  <SettingsControls
                    controls={style.controls.filter((c) => c.path !== "format")}
                    settings={s}
                    onChange={(p, v) => !ro && set(p, v)}
                    disabled={ro}
                  />
                )}
                <div className="modal-actions">
                  {!ro && (
                    <button className="btn danger" onClick={del}>
                      <TrashIcon size={15} />
                      Delete
                    </button>
                  )}
                  {draft.origin === "studio" && (
                    <button
                      className="btn danger"
                      onClick={() =>
                        toast(
                          `Delete the look "${draft.name}"? Projects using it keep their settings and move to ${style?.name ?? "the style"}'s default look. Its Studio workspace stays.`,
                          "info",
                          { label: "Delete", run: del },
                        )
                      }
                    >
                      <TrashIcon size={15} />
                      Delete
                    </button>
                  )}
                  <span className="grow" />
                  <button className="btn" onClick={dup}>
                    <CopyIcon size={15} />
                    Duplicate
                  </button>
                  {!ro && (
                    <button className="btn primary" onClick={save} disabled={busy}>
                      {busy ? <Spinner size={14} /> : <SaveIcon size={15} />}Save look
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <div className="loading">
                <Spinner />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
