import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Check, ImagePlus, Save, Star } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Modal, Toggle } from "../components/ui";

const bgCache = new Map();
export async function loadBackground(ref) {
  if (!ref) return null;
  if (!bgCache.has(ref)) bgCache.set(ref, await api.backgroundData(ref).catch(() => null));
  const url = bgCache.get(ref);
  if (!url) return null;
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => {});
  return img;
}
function Thumb({ id, on, onClick, name }) {
  const [src, setSrc] = useState(bgCache.get(id) ?? null);
  useEffect(() => {
    if (!src) {
      (bgCache.has(id)
        ? Promise.resolve(bgCache.get(id))
        : api.backgroundData(id).then((d) => {
            bgCache.set(id, d);
            return d;
          })
      )
        .then(setSrc)
        .catch(() => {});
    }
  }, [id]);
  return (
    <button className={`bg-thumb ${on ? "on" : ""}`} onClick={onClick} title={name} aria-label={`Background ${name}`} aria-pressed={on}>
      {src ? <img src={src} alt="" draggable={false} /> : <span />}
      {on && <Check size={13} />}
    </button>
  );
}
const S = (label, value, min, max, step, set, fmt = (v) => String(Math.round(v))) => (
  <label className="lp-row">
    <span>{label}</span>
    <input
      className="range"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => set(+e.target.value)}
      aria-label={label}
    />
    <em>{fmt(value)}</em>
  </label>
);
export function LayoutPanel({ layout, onChange, presetName, hidePresets }) {
  const { toast } = useApp();
  const [bgs, setBgs] = useState([]);
  const [presets, setPresets] = useState([]);
  const [saveAs, setSaveAs] = useState(null);
  const reload = () => {
    api.backgrounds().then(setBgs);
    api.layouts().then(setPresets);
  };
  useEffect(reload, []);
  const L = layout,
    set = (patch) => onChange({ ...L, ...patch });
  const scr = (p) => set({ screen: { ...L.screen, ...p } });
  const cam = (p) => set({ cam: { ...L.cam, ...p } });
  const scrSize = L.screen.w,
    camPx = Math.round(L.cam.h * 1080);
  const setScrSize = (v) => scr({ w: v, h: v, x: (1 - v) / 2, y: (1 - v) / 2 });
  const setCamPx = (v) => {
    const cx = L.cam.x + L.cam.w / 2,
      cy = L.cam.y + L.cam.h / 2,
      w = v / 1920,
      h = v / 1080;
    const left = L.cam.x < 0.5 - L.cam.w / 2,
      top = L.cam.y < 0.5 - L.cam.h / 2;
    cam({ w, h, x: left ? L.cam.x : cx + L.cam.w / 2 - w, y: top ? L.cam.y : cy + L.cam.h / 2 - h });
  };
  const corner = (c) => {
    const m = 36;
    cam({ x: c[1] === "l" ? m / 1920 : 1 - L.cam.w - m / 1920, y: c[0] === "t" ? m / 1080 : 1 - L.cam.h - m / 1080 });
  };
  const addBg = async () => {
    const f = await api.pickFile("Choose a background image", [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }]);
    if (!f) return;
    try {
      const id = await api.addBackground(f);
      set({ background: { ...L.background, image: id } });
      reload();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const applyPreset = (p) => {
    onChange(p.settings);
    presetName?.(p.name);
    toast(`Layout "${p.name}" applied.`);
  };
  const save = async (name) => {
    try {
      const id = await api.saveLayoutPreset({ name, settings: L });
      reload();
      setSaveAs(null);
      toast(`Saved layout "${name}".`, "ok", {
        label: "Make default",
        run: async () => {
          await api.setDefaultLayout(id);
          reload();
          toast("New videos start with this layout.");
        },
      });
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  return (
    <div className="layout-panel">
      {!hidePresets && (
        <>
          <div className="sec-title">Layout presets</div>
          <div className="lp-presets">
            {presets.map((p) => (
              <button key={p.id} className="lp-preset" onClick={() => applyPreset(p)} title={`Apply "${p.name}"`}>
                {p.is_default ? <Star size={11} fill="currentColor" /> : null}
                <span className="ellipsis">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6, margin: "8px 6px 4px" }}>
            <button className="btn tiny" onClick={() => setSaveAs("")}>
              <Save size={12} />
              Save as preset
            </button>
          </div>
        </>
      )}
      <div className="sec-title" style={{ marginTop: hidePresets ? 0 : 16 }}>
        Background
      </div>
      <div className="bg-grid">
        {bgs.map((b) => (
          <Thumb
            key={b.id}
            id={b.id}
            name={b.name}
            on={L.background.image === b.id}
            onClick={() => set({ background: { ...L.background, image: b.id } })}
          />
        ))}
        <button className="bg-thumb add" onClick={addBg} title="Use your own image" aria-label="Add a background image">
          <ImagePlus size={16} strokeWidth={1.6} />
        </button>
      </div>
      {S(
        "Dim",
        L.background.dim,
        0,
        0.8,
        0.01,
        (v) => set({ background: { ...L.background, dim: v } }),
        (v) => `${Math.round(v * 100)}%`,
      )}
      {S("Blur", L.background.blur, 0, 30, 1, (v) => set({ background: { ...L.background, blur: v } }))}
      <div className="sec-title" style={{ marginTop: 16 }}>
        Screen recording
      </div>
      {S("Size", scrSize, 0.5, 1, 5e-3, setScrSize, (v) => `${Math.round(v * 100)}%`)}
      {S("Corners", L.screen.radius, 0, 60, 1, (v) => scr({ radius: v }))}
      {S(
        "Shadow",
        L.screen.shadow,
        0,
        1,
        0.05,
        (v) => scr({ shadow: v }),
        (v) => `${Math.round(v * 100)}%`,
      )}
      <label className="lp-row">
        <span>Fill the box</span>
        <Toggle
          label="Fill the screen box (crop instead of fit)"
          on={L.screen.fit === "cover"}
          onChange={(v) => scr({ fit: v ? "cover" : "contain" })}
        />
      </label>
      <div className="sec-title" style={{ marginTop: 16 }}>
        Facecam
      </div>
      <label className="lp-row">
        <span>Show</span>
        <Toggle label="Show the facecam" on={L.cam.visible} onChange={(v) => cam({ visible: v })} />
      </label>
      {S("Size", camPx, 120, 640, 2, setCamPx, (v) => `${v}px`)}
      {S("Corners", L.cam.radius, 0, 160, 1, (v) => cam({ radius: v }))}
      {S(
        "Shadow",
        L.cam.shadow,
        0,
        1,
        0.05,
        (v) => cam({ shadow: v }),
        (v) => `${Math.round(v * 100)}%`,
      )}
      {S(
        "Zoom",
        L.cam.zoom,
        1,
        2.5,
        0.01,
        (v) => cam({ zoom: v }),
        (v) => `${v.toFixed(2)}×`,
      )}
      <div className="lp-row">
        <span>Corner</span>
        <div className="lp-corners">
          {["tl", "tr", "bl", "br"].map((c) => (
            <button
              key={c}
              className="lp-corner"
              onClick={() => corner(c)}
              aria-label={`Facecam ${c[0] === "t" ? "top" : "bottom"} ${c[1] === "l" ? "left" : "right"}`}
            >
              <i className={c} />
            </button>
          ))}
        </div>
      </div>
      <p className="small" style={{ margin: "10px 6px" }}>
        Drag the boxes in the preview to move them; drag a corner to resize.
      </p>
      {saveAs !== null && (
        <Modal title="Save layout preset" onClose={() => setSaveAs(null)}>
          <div className="modal-body">
            <div className="field">
              <label htmlFor="lp-name">Name</label>
              <input
                id="lp-name"
                className="input"
                autoFocus
                value={saveAs}
                onChange={(e) => setSaveAs(e.target.value)}
                placeholder="e.g. Tutorial, big cam"
                onKeyDown={(e) => e.key === "Enter" && saveAs.trim() && save(saveAs.trim())}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setSaveAs(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={!saveAs.trim()} onClick={() => save(saveAs.trim())}>
                Save
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
