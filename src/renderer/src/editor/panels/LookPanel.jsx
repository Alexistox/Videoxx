import { useEffect, useState } from "react";
import { FilmIcon } from "lucide-react";
import { api, isOwnStyle, offeredLook } from "../../lib/api";
import { useApp } from "../../state/AppProvider";
import { Modal, Spinner } from "../../components/ui";
import { SettingsControls, setAt } from "../../settings/project/SettingsControls";
import { sameButFormat, withFormat } from "../../looks/lookFormat";
import { customControls } from "./lookControls";

export function LookPanel({ projectId, status, t, onClose, onApplied }) {
  const { toast } = useApp();
  const [presets, setPresets] = useState([]);
  const [style, setStyle] = useState(null);
  const [s, setS] = useState(status.settings);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(status.project.preset_id);
  const [pv, setPv] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const lab = status.styleLab;
  useEffect(() => {
    api.presets().then((l) => setPresets(lab ? [] : l.filter((p) => (p.style_id || "pixel-art") === status.style)));
    Promise.all([api.styles(), lab ? api.readText(projectId, "style.json").catch(() => null) : null]).then(([ss, sj]) => {
      const st = ss.find((x) => x.id === status.style) ?? null;
      let declared = null;
      try {
        declared = sj ? JSON.parse(sj).controls : null;
      } catch {}
      setStyle(st && lab ? { ...st, controls: customControls(st.controls, declared) } : st);
    });
  }, [status.style, !!lab]);
  const set = (path, v) => {
    setPicked(null);
    setPv(null);
    setS((o) => setAt(o, path, v));
  };
  const preview = async (settings) => {
    setPreviewing(true);
    try {
      setPv(await api.previewLook(projectId, settings, t));
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setPreviewing(false);
    }
  };
  const base = status.styleBase ?? status.style,
    own = status.settings;
  const pick = (p) => {
    const next = ["vox", "collage", "flat", "lowpoly", "toon", "stickstory", "starter", "recon"].includes(base)
      ? withFormat(structuredClone(p.settings), own?.format, base, own?.sheet?.cols)
      : structuredClone(p.settings);
    if (base === "starter" && own?.dim) next.dim = own.dim;
    if (base === "recon" && s?.figures && !next.figures) next.figures = s.figures;
    setPicked(p.id);
    setS(next);
    preview(next);
  };
  const same = sameButFormat;
  const apply = async (fn, msg) => {
    setBusy(true);
    try {
      const r = await fn();
      onApplied(r);
      setS(r.settings);
      toast(msg);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  if (!s)
    return (
      <Modal title="Look" onClose={onClose}>
        <div className="modal-body">
          <p className="muted">This project has no engine settings yet. Upgrade the engine first.</p>
        </div>
      </Modal>
    );
  return (
    <Modal
      title={
        lab
          ? `Look · style lab "${lab.name}"`
          : `Look · ${style?.name ?? status.styleName ?? "render settings"}${style && isOwnStyle(style) ? " (your style)" : ""}`
      }
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        {lab && (
          <p className="help" style={{ margin: "0 0 14px" }}>
            The finishing settings your style is saved with. Colours, paper and art are the style itself: ask Claude in the chat to change
            them.
          </p>
        )}
        {!lab && (
          <div className="field">
            <label>Look</label>
            <div className="row wrap">
              {presets
                .filter((p) => offeredLook(style ?? void 0, p) || p.id === status.project.preset_id)
                .map((p) => (
                  <button
                    key={p.id}
                    className={`btn small ${picked === p.id ? "active" : ""}`}
                    aria-pressed={picked === p.id}
                    disabled={busy || previewing}
                    onClick={() => pick(p)}
                    title={p.description ?? ""}
                  >
                    {p.name}
                    {p.origin === "studio" && (
                      <span className="sd-yours" title="A look you made in the Style Studio">
                        Yours
                      </span>
                    )}
                    {status.project.preset_id === p.id ? (
                      <span className="dim" style={{ fontWeight: 400 }}>
                        {" · current"}
                      </span>
                    ) : null}
                  </button>
                ))}
            </div>
            <span className="help">
              Click a look to preview it on this frame. Applying changes the whole video at once (every shot); scene code is untouched.
            </span>
          </div>
        )}
        {(pv || previewing) && (
          <div className={`look-compare ${status.aspect < 1 ? "tall" : ""}`}>
            <figure>
              <figcaption>Now</figcaption>
              {pv ? (
                <img src={pv.before} alt="Current look" />
              ) : (
                <div className="look-wait">
                  <Spinner />
                </div>
              )}
            </figure>
            <figure>
              <figcaption>With these settings</figcaption>
              {pv && !previewing ? (
                <img src={pv.after} alt="Previewed look" />
              ) : (
                <div className="look-wait">
                  <Spinner />
                </div>
              )}
            </figure>
          </div>
        )}
        {style && (
          <SettingsControls
            controls={style.controls}
            settings={s}
            onChange={set}
            seconds={status.end || status.targetLength}
            projectId={projectId}
          />
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn" disabled={previewing} onClick={() => preview(s)}>
            {previewing ? <Spinner size={14} /> : <FilmIcon size={15} />}Preview
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => {
              const p = presets.find((x) => x.id === picked);
              const look = s && base === "recon" && s.figures ? (({ figures: _f, ...r }) => r)(s) : s,
                asLook =
                  !!p &&
                  same(p.settings, look) &&
                  (!look || look === s || JSON.stringify(s.figures) === JSON.stringify(status.settings?.figures));
              apply(
                () => (asLook ? api.applyPreset(projectId, p.id) : api.applySettings(projectId, s)),
                asLook ? `Applied ${p.name}.` : "Custom settings applied to this project.",
              );
            }}
          >
            {busy && <Spinner size={14} />}Apply to project
          </button>
        </div>
      </div>
    </Modal>
  );
}
