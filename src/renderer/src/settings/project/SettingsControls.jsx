import { useEffect, useState } from "react";
import { Toggle } from "../../components/ui";
import { paceLine } from "./visualPace";
import { normHex, textOn } from "../../lib/color";
import { FiguresPicker } from "./FiguresPicker";
import cast_alex from "../../assets/alex.png";
import cast_frank from "../../assets/frank.png";
import cast_jen from "../../assets/jen.png";
import cast_lena from "../../assets/lena.png";
import cast_marcus from "../../assets/marcus.png";
import cast_maya from "../../assets/maya.png";
import cast_rosa from "../../assets/rosa.png";
import cast_tom from "../../assets/tom.png";

export const getAt = (o, path) => path.split(".").reduce((c, k) => (c == null ? c : c[k]), o);
export function setAt(o, path, v) {
  const n = structuredClone(o ?? {}),
    k = path.split(".");
  let c = n;
  k.slice(0, -1).forEach((x) => (c = c[x] ??= {}));
  c[k.at(-1)] = v;
  return n;
}
const show = (c, v) =>
  c.fmt === "pct"
    ? `${Math.round(v * 100)}%`
    : c.fmt === "deg"
      ? `${v}°`
      : c.fmt === "s"
        ? `${(+v).toFixed(2)}s`
        : c.fmt === "x"
          ? `${(+v).toFixed(1)}×`
          : c.fmt === "ppm"
            ? `${v} a minute (one every ${Math.round(60 / v)} s)`
            : (+v).toFixed(Math.max(0, -Math.floor(Math.log10(c.step || 1))));
export function BrandColor({ value, onChange, disabled, label = "Brand colour", id }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = (raw) => {
    const h = normHex(raw);
    if (h === void 0) {
      setDraft(value ?? "");
      return;
    }
    if (h !== value) onChange(h);
  };
  return (
    <span className="brand-color" id={id}>
      <label
        className={`brand-swatch ${value ? "" : "none"}`}
        style={value ? { background: value, color: textOn(value) } : void 0}
        title={value ? `${label}: ${value}` : `${label}: style default`}
      >
        {value ? "Aa" : "—"}
        <input type="color" disabled={disabled} value={value ?? "#e6007e"} aria-label={label} onChange={(e) => onChange(e.target.value)} />
      </label>
      <input
        className="input compact brand-hex"
        disabled={disabled}
        value={draft}
        placeholder="#rrggbb"
        aria-label={`${label} hex`}
        spellCheck={false}
        maxLength={7}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.target.value);
        }}
      />
      {value && !disabled && (
        <button type="button" className="btn tiny ghost" onClick={() => onChange(null)}>
          Style default
        </button>
      )}
    </span>
  );
}
const CAST_THUMBS = {
  "../assets/lowpoly-cast/alex.png": cast_alex,
  "../assets/lowpoly-cast/maya.png": cast_maya,
  "../assets/lowpoly-cast/marcus.png": cast_marcus,
  "../assets/lowpoly-cast/jen.png": cast_jen,
  "../assets/lowpoly-cast/tom.png": cast_tom,
  "../assets/lowpoly-cast/rosa.png": cast_rosa,
  "../assets/lowpoly-cast/frank.png": cast_frank,
  "../assets/lowpoly-cast/lena.png": cast_lena,
};
export function SettingsControls({ controls, settings, onChange, disabled, seconds, projectId }) {
  return (
    <div className="opt-grid">
      {controls.map((c) => {
        const v = getAt(settings, c.path) ?? c.default,
          off = disabled || c.readOnly;
        if (c.type === "figures")
          return (
            <div key={c.path} className="opt figs-opt">
              <span>
                {c.label}
                {c.help && <small>{c.help}</small>}
              </span>
              <FiguresPicker value={v} theme={settings?.theme} disabled={off} projectId={projectId} onChange={(x) => onChange(c.path, x)} />
            </div>
          );
        let input = null;
        if (c.type === "toggle") input = <Toggle label={c.label} disabled={off} on={!!v} onChange={(x) => !off && onChange(c.path, x)} />;
        else if (c.type === "range")
          input = (
            <input
              className="range"
              style={{ width: 150 }}
              type="range"
              disabled={off}
              min={c.min}
              max={c.max}
              step={c.step}
              value={v ?? c.min ?? 0}
              onChange={(e) => onChange(c.path, +e.target.value)}
              aria-label={c.label}
            />
          );
        else if (c.type === "color" && c.clearable)
          input = <BrandColor value={v ?? null} disabled={off} label={c.label} onChange={(x) => onChange(c.path, x)} />;
        else if (c.type === "color")
          input = (
            <input
              type="color"
              disabled={off}
              value={v ?? "#000000"}
              onChange={(e) => onChange(c.path, e.target.value)}
              aria-label={c.label}
              style={{ width: 44, height: 28, background: "transparent", border: 0 }}
            />
          );
        else if (c.type === "select" && c.options?.some((o) => o.img)) {
          input = (
            <div className="cast-grid" role="radiogroup" aria-label={c.label}>
              {c.options.map((o) => {
                const src = o.img ? CAST_THUMBS[`../assets/${o.img}`] : null,
                  on = String(v ?? "") === String(o.value);
                return (
                  <button
                    key={String(o.value)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={"cast-pick" + (on ? " on" : "")}
                    disabled={off}
                    title={o.label}
                    onClick={() => onChange(c.path, o.value)}
                  >
                    {src ? <img src={src} alt="" /> : <span className="cast-auto">Auto</span>}
                    <span className="cast-name">{o.label.split(" (")[0]}</span>
                  </button>
                );
              })}
            </div>
          );
        } else if (c.type === "select") {
          const cur = c.size ? `${v?.width}x${v?.height}` : String(v);
          const ownChars =
            c.path === "characters.main" && settings?.characters?.custom && typeof settings.characters.custom === "object"
              ? Object.entries(settings.characters.custom).map(([id, l]) => ({ value: id, label: `${l?.name || id} (your character)` }))
              : [];
          input = (
            <select
              className="input compact"
              style={{ width: 190 }}
              disabled={off}
              value={cur}
              aria-label={c.label}
              onChange={(e) => {
                const raw = e.target.value;
                if (c.size) {
                  const [w, h] = raw.split("x").map(Number);
                  onChange(c.path, { width: w, height: h });
                } else onChange(c.path, typeof c.options?.[0]?.value === "number" ? +raw : raw);
              }}
            >
              {[...ownChars, ...(c.options || [])].map((o) => (
                <option key={String(o.value)} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        }
        return (
          <div key={c.path} className="opt">
            <span>
              {c.label}
              {c.type === "range" && v != null && <span className="dim"> {show(c, v)}</span>}
              {c.help && (
                <small>
                  {c.help}
                  {c.fmt === "ppm" && seconds ? ` In this video: ${paceLine(seconds, v)}.` : ""}
                </small>
              )}
            </span>
            {input}
          </div>
        );
      })}
    </div>
  );
}
