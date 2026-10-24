import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIcon,
  ChevronDownIcon,
  GaugeIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import { api } from "../../lib/api";
import { useApp } from "../../state/AppProvider";
import { Spinner, Toggle } from "../../components/ui";
import { fold } from "../../lib/fold";

const GFX_SECTIONS = [
  {
    id: "perf",
    label: "Performance",
    help: 'Make the preview faster on this computer. Exports use them only with Export quality "Same as preview".',
  },
  { id: "image", label: "Image", help: "Exposure, tone mapping, edge smoothing and the camera lens for the whole video." },
  { id: "light", label: "Lighting & shadows", help: "Shadows, ambient occlusion, fog and how much the room reflects." },
  { id: "post", label: "Post processing", help: "Camera effects laid over the 3D image: depth of field, bloom, grain, vignette." },
  { id: "grade", label: "Colour grade", help: "Colour and contrast of the 3D image. Text and cards on top keep their colours." },
  {
    id: "export",
    label: "Export quality",
    help: "How exports, stills and Claude’s frame checks are drawn. Slower, never shown in the live preview.",
  },
];
const GFX_CONTROLS = [
  // ---- performance (preview only) ----
  {
    key: "scale",
    section: "perf",
    type: "range",
    min: 0.25,
    max: 2,
    step: 0.05,
    unit: "%",
    def: 1,
    scope: "preview",
    label: "Render scale",
    words: "resolution pixels speed fast",
    help: "How many pixels the 3D preview draws. Lower is faster and softer, above 100% is sharper and slower.",
  },
  {
    key: "lite",
    section: "perf",
    type: "toggle",
    def: false,
    scope: "preview",
    label: "Fast effects",
    words: "performance heavy passes speed",
    help: "Skips the heavy effects in the preview (ambient occlusion, depth of field, bloom, soft shadows, edge smoothing).",
  },
  {
    key: "maxFps",
    section: "perf",
    type: "select",
    def: 0,
    scope: "preview",
    host: true,
    label: "Frame rate cap",
    words: "fps frames per second speed",
    options: [
      { value: 0, label: "No cap (30 fps)" },
      { value: 24, label: "24 fps" },
      { value: 15, label: "15 fps" },
      { value: 10, label: "10 fps" },
    ],
    help: "Draw fewer frames while playing, so a slow computer keeps up with the sound.",
  },
  // ---- image ----
  {
    key: "exposure",
    section: "image",
    type: "range",
    min: -2,
    max: 2,
    step: 0.05,
    unit: "EV",
    def: 0,
    scope: "both",
    label: "Exposure",
    words: "brightness bright dark",
    help: "Brighter or darker 3D image, in camera stops.",
  },
  {
    key: "toneMap",
    section: "image",
    type: "select",
    def: "neutral",
    scope: "both",
    label: "Tone mapping",
    words: "aces agx filmic hdr",
    options: [
      { value: "neutral", label: "Neutral (default)" },
      { value: "aces", label: "ACES filmic" },
      { value: "agx", label: "AgX" },
      { value: "none", label: "None (linear)" },
    ],
    help: "How bright light is squeezed into the picture. Neutral keeps colours true; ACES and AgX look more like film.",
  },
  {
    key: "aa",
    section: "image",
    type: "select",
    def: "msaa",
    scope: "both",
    label: "Anti-aliasing",
    words: "jaggies edges smooth msaa fxaa smaa",
    options: [
      { value: "msaa", label: "MSAA 4x (default)" },
      { value: "msaa8", label: "MSAA 8x" },
      { value: "fxaa", label: "FXAA (fast)" },
      { value: "msaa-fxaa", label: "MSAA + FXAA (smoothest)" },
      { value: "off", label: "Off" },
    ],
    help: "Smooths jagged edges. FXAA is the cheapest; MSAA 8x the cleanest.",
  },
  {
    key: "fovScale",
    section: "image",
    type: "range",
    min: 0.6,
    max: 1.5,
    step: 0.01,
    unit: "x",
    def: 1,
    scope: "both",
    label: "Field of view",
    words: "fov lens zoom wide",
    help: "Widens or narrows every camera. Above 1 shows more around the subject.",
  },
  // ---- lighting & shadows ----
  {
    key: "shadows",
    section: "light",
    type: "toggle",
    def: true,
    scope: "both",
    label: "Shadows",
    words: "shadow",
    help: "Objects cast shadows. Off is faster but things look like they float.",
  },
  {
    key: "shadowSize",
    section: "light",
    type: "select",
    def: null,
    scope: "both",
    label: "Shadow detail",
    words: "shadow map resolution",
    options: [
      { value: 512, label: "Low (512)" },
      { value: 1024, label: "Medium (1024)" },
      { value: 2048, label: "High (2048)" },
      { value: 4096, label: "Ultra (4096)" },
    ],
    help: "How sharp shadow edges are. Lower is faster.",
  },
  {
    key: "shadowSoft",
    section: "light",
    type: "toggle",
    def: true,
    scope: "both",
    label: "Soft shadows",
    words: "shadow blur pcf",
    help: "Blurred shadow edges like a studio light. Off gives crisp, harder shadows.",
  },
  {
    key: "ao",
    section: "light",
    type: "toggle",
    def: true,
    scope: "both",
    label: "Ambient occlusion",
    words: "ao gtao contact shadows corners",
    help: "Soft darkening where things meet (corners, feet on the floor). The most expensive effect.",
  },
  {
    key: "aoStrength",
    section: "light",
    type: "range",
    min: 0,
    max: 2,
    step: 0.05,
    unit: "x",
    def: 1,
    scope: "both",
    label: "AO strength",
    words: "ambient occlusion",
    help: "How dark the occlusion is.",
  },
  {
    key: "aoRadius",
    section: "light",
    type: "range",
    min: 0.25,
    max: 3,
    step: 0.05,
    unit: "x",
    def: 1,
    scope: "both",
    label: "AO radius",
    words: "ambient occlusion",
    help: "How far the occlusion spreads from corners.",
  },
  {
    key: "fog",
    section: "light",
    type: "range",
    min: 0,
    max: 3,
    step: 0.05,
    unit: "x",
    def: 1,
    scope: "both",
    label: "Fog density",
    words: "haze atmosphere distance",
    help: "How quickly far things fade into the background. 0 = no fog.",
  },
  {
    key: "env",
    section: "light",
    type: "range",
    min: 0,
    max: 3,
    step: 0.05,
    unit: "x",
    def: 1,
    scope: "both",
    label: "Environment light",
    words: "reflections ambient ibl",
    help: "The soft light and reflections from the room around the scene.",
  },
  // ---- post processing ----
  {
    key: "dof",
    section: "post",
    type: "select",
    def: "look",
    scope: "both",
    label: "Depth of field",
    words: "dof focus blur bokeh",
    options: [
      { value: "look", label: "As the look says" },
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ],
    help: "Blurs what is in front of and behind the subject, like a real lens.",
  },
  {
    key: "dofStrength",
    section: "post",
    type: "range",
    min: 0,
    max: 3,
    step: 0.05,
    unit: "x",
    def: 1,
    scope: "both",
    label: "Focus blur",
    words: "dof aperture bokeh",
    help: "How strong the depth-of-field blur is.",
  },
  {
    key: "dofFocus",
    section: "post",
    type: "range",
    min: -5,
    max: 5,
    step: 0.05,
    unit: "m",
    def: 0,
    scope: "both",
    label: "Focus distance",
    words: "dof",
    help: "Moves the sharp plane nearer (negative) or further (positive) than the subject.",
  },
  {
    key: "bloom",
    section: "post",
    type: "select",
    def: "look",
    scope: "both",
    label: "Bloom",
    words: "glow highlights",
    options: [
      { value: "look", label: "As the look says" },
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ],
    help: "Bright parts glow softly into their surroundings.",
  },
  {
    key: "bloomStrength",
    section: "post",
    type: "range",
    min: 0,
    max: 1.5,
    step: 0.01,
    unit: "",
    def: null,
    scope: "both",
    label: "Bloom strength",
    words: "glow",
    help: "How much the bright parts glow.",
  },
  {
    key: "bloomThreshold",
    section: "post",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "",
    def: null,
    scope: "both",
    label: "Bloom threshold",
    words: "glow",
    help: "How bright something must be to glow. Lower makes more of the picture glow.",
  },
  {
    key: "grain",
    section: "post",
    type: "range",
    min: 0,
    max: 0.15,
    step: 2e-3,
    unit: "",
    def: null,
    scope: "both",
    label: "Film grain",
    words: "noise",
    help: "Fine moving noise like film.",
  },
  {
    key: "vignette",
    section: "post",
    type: "range",
    min: 0,
    max: 0.8,
    step: 0.01,
    unit: "",
    def: null,
    scope: "both",
    label: "Vignette",
    words: "dark corners edges",
    help: "Darker corners that pull the eye to the centre.",
  },
  {
    key: "ca",
    section: "post",
    type: "range",
    min: 0,
    max: 0.02,
    step: 5e-4,
    unit: "",
    def: null,
    scope: "both",
    label: "Chromatic aberration",
    words: "colour fringe lens",
    help: "A thin colour fringe toward the corners, like a cheap lens.",
  },
  {
    key: "sharpen",
    section: "post",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "",
    def: 0,
    scope: "both",
    label: "Sharpen",
    words: "detail crisp",
    help: "Crisper edges and texture.",
  },
  // ---- colour grade ----
  {
    key: "contrast",
    section: "grade",
    type: "range",
    min: 0.5,
    max: 1.6,
    step: 0.01,
    unit: "x",
    def: 1,
    scope: "both",
    label: "Contrast",
    words: "grade",
    help: "Distance between darks and brights.",
  },
  {
    key: "saturation",
    section: "grade",
    type: "range",
    min: 0,
    max: 2,
    step: 0.01,
    unit: "x",
    def: 1,
    scope: "both",
    label: "Saturation",
    words: "colour desaturate black and white grade",
    help: "0 = black and white, 1 = as built, above 1 = richer colour.",
  },
  {
    key: "cap",
    section: "grade",
    type: "range",
    min: 0.6,
    max: 1,
    step: 5e-3,
    unit: "",
    def: 1,
    scope: "both",
    label: "Highlight cap",
    words: "whites milky clip grade",
    help: "The brightest the picture gets. Lower gives soft, milky whites.",
  },
  {
    key: "lift",
    section: "grade",
    type: "range",
    min: -0.1,
    max: 0.2,
    step: 5e-3,
    unit: "",
    def: 0,
    scope: "both",
    label: "Lift (shadows)",
    words: "blacks faded grade",
    help: "Raises (faded film) or crushes the darkest parts.",
  },
  {
    key: "gamma",
    section: "grade",
    type: "range",
    min: 0.5,
    max: 2,
    step: 0.01,
    unit: "",
    def: 1,
    scope: "both",
    label: "Gamma (midtones)",
    words: "grade",
    help: "Brighter or darker midtones, blacks and whites stay.",
  },
  {
    key: "gain",
    section: "grade",
    type: "range",
    min: 0.5,
    max: 1.6,
    step: 0.01,
    unit: "x",
    def: 1,
    scope: "both",
    label: "Gain (highlights)",
    words: "grade brightness",
    help: "Scales the bright parts.",
  },
  {
    key: "warmth",
    section: "grade",
    type: "range",
    min: -1,
    max: 1,
    step: 0.01,
    unit: "",
    def: 0,
    scope: "both",
    label: "Temperature",
    words: "warm cold blue orange white balance grade",
    help: "Cooler (blue) or warmer (orange).",
  },
  {
    key: "tint",
    section: "grade",
    type: "range",
    min: -1,
    max: 1,
    step: 0.01,
    unit: "",
    def: 0,
    scope: "both",
    label: "Tint",
    words: "green magenta grade",
    help: "Toward magenta (negative) or green (positive).",
  },
  // ---- export ----
  {
    key: "exportSs",
    section: "export",
    type: "select",
    def: null,
    scope: "export",
    label: "Supersampling",
    words: "ss quality render resolution",
    options: [
      { value: 1, label: "1x (fast)" },
      { value: 1.5, label: "1.5x" },
      { value: 2, label: "2x (default)" },
      { value: 3, label: "3x (slow, cleanest)" },
    ],
    help: "The 3D image is drawn this many times larger and shrunk down: no shimmer on fine detail. Slower exports.",
  },
  {
    key: "exportBitrate",
    section: "export",
    type: "select",
    def: "standard",
    scope: "export",
    label: "Encode quality",
    words: "bitrate mp4 file size",
    options: [
      { value: "standard", label: "Standard (16 Mbps)" },
      { value: "high", label: "High (28 Mbps)" },
      { value: "max", label: "Maximum (45 Mbps)" },
    ],
    help: "Higher keeps grain and fine detail in the file; the file gets bigger.",
  },
  {
    key: "exportSamples",
    section: "export",
    type: "select",
    def: 1,
    scope: "export",
    label: "Motion blur",
    words: "frame sampling subframes shutter",
    options: [
      { value: 1, label: "Off" },
      { value: 2, label: "2 samples" },
      { value: 4, label: "4 samples" },
      { value: 8, label: "8 samples (slow)" },
    ],
    help: "Each exported frame is the average of several moments, like a film camera shutter. Exports take that many times longer.",
  },
];
const GFX_BY_KEY = Object.fromEntries(GFX_CONTROLS.map((c) => [c.key, c]));
const GFX_LOOKS = [
  { id: "studio", label: "Studio", help: "Neutral: the look as built", grade: {} },
  {
    id: "investigation",
    label: "Investigation",
    help: "Desaturated, cool, milky highlights",
    grade: { saturation: 0.55, contrast: 1.12, cap: 0.82, warmth: -0.25, lift: 0.01 },
  },
  { id: "noir", label: "Noir", help: "Black and white, hard contrast", grade: { saturation: 0, contrast: 1.3, gamma: 0.9, cap: 0.95 } },
  { id: "warm", label: "Warm", help: "Golden hour", grade: { warmth: 0.45, saturation: 1.1, gain: 1.04, tint: -0.05 } },
  { id: "cold", label: "Cold", help: "Blue winter light", grade: { warmth: -0.5, saturation: 0.85, contrast: 1.05 } },
  { id: "washed", label: "Washed", help: "Faded film", grade: { lift: 0.08, contrast: 0.85, saturation: 0.7, cap: 0.9 } },
];
const GRADE_KEYS = GFX_CONTROLS.filter((c) => c.section === "grade").map((c) => c.key);
function withGradeLook(g, id) {
  const L = GFX_LOOKS.find((l) => l.id === id);
  if (!L) return g;
  const o = { ...g };
  for (const k of GRADE_KEYS) delete o[k];
  return { ...o, ...L.grade };
}
function gradeLookOf(g) {
  for (const L of GFX_LOOKS) if (GRADE_KEYS.every((k) => (g[k] ?? GFX_BY_KEY[k].def) === (L.grade[k] ?? GFX_BY_KEY[k].def))) return L.id;
  return null;
}
const GFX_PRESETS = [
  {
    id: "fast",
    label: "Fast preview",
    help: "Half resolution, no heavy effects: smooth on a slow computer. Exports unchanged.",
    values: { scale: 0.5, lite: true },
  },
  {
    id: "balanced",
    label: "Balanced",
    help: "Slightly smaller preview, simpler shadows: the look stays.",
    values: { scale: 0.75, shadowSize: 2048 },
  },
  { id: "quality", label: "Quality", help: "Full resolution with every effect.", values: { scale: 1, aa: "msaa8", shadowSize: 4096 } },
  {
    id: "export",
    label: "Export",
    help: "Cleanest exports: 3x supersampling, high bitrate, 2-sample motion blur.",
    values: { exportSs: 3, exportBitrate: "high", exportSamples: 2 },
  },
];
const EXPORT_QUALITIES = [
  {
    id: "preview",
    label: "Same as preview",
    hint: "Uses every Graphics setting, the preview-only ones too (render scale, fast effects): looks like the live preview, speed to match.",
  },
  {
    id: "draft",
    label: "Draft (fastest)",
    hint: "About 3-4x faster: no supersampling, no ambient occlusion, depth of field or bloom, small hard shadows, no edge smoothing. Still 1920x1080.",
  },
  { id: "standard", label: "Standard", hint: "Your Graphics settings as saved for exports (2x supersampling unless you changed it)." },
  { id: "max", label: "Maximum", hint: "About 2x slower than Standard: 3x supersampling, MSAA 8x, sharpest shadows, highest bitrate." },
];
function checkOne(c, v) {
  if (v === null) return c.def === null ? null : `${c.label}: needs a value.`;
  if (c.type === "toggle") return typeof v === "boolean" ? null : `${c.label} must be on or off.`;
  if (c.type === "select") return c.options.some((o) => o.value === v) ? null : `${c.label}: "${String(v)}" is not one of its choices.`;
  if (typeof v !== "number" || !isFinite(v)) return `${c.label} must be a number.`;
  if (v < c.min - 1e-9 || v > c.max + 1e-9) return `${c.label} must be between ${c.min} and ${c.max}.`;
  return null;
}
function validateGraphics(g) {
  if (g === void 0) return null;
  if (!g || typeof g !== "object" || Array.isArray(g)) return "Graphics settings must be an object.";
  for (const [k, v] of Object.entries(g)) {
    const c = GFX_BY_KEY[k];
    if (!c) return `Unknown graphics setting "${k}".`;
    const e = checkOne(c, v);
    if (e) return e;
  }
  return null;
}
function compactGraphics(g) {
  const o = {};
  for (const [k, v] of Object.entries(g || {})) {
    const c = GFX_BY_KEY[k];
    if (c && v !== void 0 && v !== null && v !== c.def) o[k] = v;
  }
  return o;
}
function fmtGfx(c, v) {
  if (v === null || v === void 0) return "look";
  if (c.type === "toggle") return v ? "On" : "Off";
  if (c.type === "select") return String(c.options.find((o) => o.value === v)?.label ?? v);
  if (c.unit === "%") return `${Math.round(v * 100)}%`;
  if (c.unit === "x") return `${(+v).toFixed(2)}×`;
  if (c.unit === "EV") return `${v > 0 ? "+" : ""}${(+v).toFixed(2)} EV`;
  if (c.unit === "m") return `${v > 0 ? "+" : ""}${(+v).toFixed(2)} m`;
  return (+v).toFixed(c.step && c.step < 0.01 ? 3 : 2);
}
const SCOPE = {
  preview: { text: "Preview only", tip: "Only the live preview: exports are not affected" },
  export: { text: "Export", tip: "Only exports, stills and Claude’s frame checks" },
};
export function GraphicsPanel({ projectId, preview, saved, styleName, stats, onStats, onClose, onUpdateEngine, engineOld }) {
  const { toast } = useApp();
  const [vals, setVals] = useState(() => compactGraphics(saved || {}));
  const [info, setInfo] = useState(null);
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("cz-gfx-closed") || "[]"));
    } catch {
      return new Set();
    }
  });
  const [presets, setPresets] = useState([]);
  const [naming, setNaming] = useState(null);
  const [bench, setBench] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [saving, setSaving] = useState("idle");
  const valsRef = useRef(vals);
  valsRef.current = vals;
  const rootRef = useRef(null);
  useEffect(() => {
    let live = true;
    const load = (n = 0) =>
      preview.current?.info().then((i) => {
        if (!live) return;
        if (i?.graphics) setInfo(i.graphics);
        else if (n < 20) setTimeout(() => load(n + 1), 500);
      });
    load();
    api
      .gfxPresets()
      .then(setPresets)
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("cz-gfx-closed", JSON.stringify([...closed]));
    } catch {}
  }, [closed]);
  const inflight = useRef(false),
    queued = useRef(null),
    saveTimer = useRef(0);
  const send = (values) => {
    if (inflight.current) {
      queued.current = values;
      return;
    }
    inflight.current = true;
    preview.current
      ?.graphics(values, true)
      .then((r) => {
        if (r) setInfo((i) => ({ ...(i || r), ...r }));
      })
      .finally(() => {
        inflight.current = false;
        const nx = queued.current;
        queued.current = null;
        if (nx) send(nx);
      });
  };
  const pendingSave = useRef(false);
  const persist = (values) => {
    window.clearTimeout(saveTimer.current);
    setSaving("saving");
    pendingSave.current = true;
    saveTimer.current = window.setTimeout(() => {
      pendingSave.current = false;
      api
        .saveGraphics(projectId, values)
        .then(() => setSaving("saved"))
        .catch((e) => {
          setSaving("error");
          toast(e.message, "bad");
        });
    }, 450);
  };
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      if (pendingSave.current) api.saveGraphics(projectId, valsRef.current).catch(() => {});
    },
    [],
  );
  const commit = (next) => {
    const c = compactGraphics(next),
      err = validateGraphics(c);
    if (err) {
      toast(err, "bad");
      return;
    }
    setVals(c);
    send(c);
    persist(c);
  };
  const setKey = (k, v) => {
    const n = { ...valsRef.current };
    if (v === null || v === void 0) delete n[k];
    else n[k] = v;
    commit(n);
  };
  const resetSection = (s) => {
    const n = { ...valsRef.current };
    for (const c of GFX_CONTROLS) if (c.section === s) delete n[c.key];
    commit(n);
  };
  const supported = useMemo(() => new Set(info?.supported ?? ["maxFps"]), [info]);
  const shown = (c) => supported.has(c.key);
  const shownControls = GFX_CONTROLS.filter(shown);
  const qq = fold(q.trim());
  const match = (c) =>
    !qq || fold(`${c.label} ${c.help} ${c.words ?? ""} ${GFX_SECTIONS.find((s) => s.id === c.section)?.label}`).includes(qq);
  const valueOf = (c) => vals[c.key] ?? (c.def === null ? (info?.look?.[c.key] ?? null) : c.def);
  const look = gradeLookOf(vals);
  const measure = async () => {
    setMeasuring(true);
    try {
      const r = await preview.current?.bench(8);
      if (r) setBench({ median: r.median, drawn: r.drawn });
    } finally {
      setMeasuring(false);
    }
  };
  const savePreset = async () => {
    const n = (naming || "").trim();
    if (!n) return;
    try {
      setPresets(await api.saveGfxPreset(n, vals));
      setNaming(null);
      toast(`Saved the graphics preset “${n}”.`);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const delPreset = async (p) => {
    try {
      setPresets(await api.deleteGfxPreset(p.name));
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const same = (a) => JSON.stringify(compactGraphics(a)) === JSON.stringify(vals);
  const onKey = (e) => {
    if (e.key === "Escape" && !e.target.closest("input[type=text], input[type=search]")) {
      e.stopPropagation();
      onClose();
    }
  };
  const row = (c) => {
    const v = valueOf(c),
      set = c.key in vals,
      scope = SCOPE[c.scope];
    let input;
    if (c.type === "toggle") input = <Toggle on={!!v} onChange={(x) => setKey(c.key, x)} label={c.label} />;
    else if (c.type === "select")
      input = (
        <select
          className="input compact gfx-sel"
          aria-label={c.label}
          value={v === null ? "" : String(v)}
          onChange={(e) => {
            const o = c.options.find((o2) => String(o2.value) === e.target.value);
            setKey(c.key, o ? o.value : null);
          }}
        >
          {c.def === null && (
            <option value="">As the look says{info?.look?.[c.key] != null ? ` (${fmtGfx(c, info.look[c.key])})` : ""}</option>
          )}
          {c.options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
    else
      input = (
        <span className="gfx-range">
          <input
            className="range"
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={v ?? c.min}
            aria-label={c.label}
            onChange={(e) => setKey(c.key, +e.target.value)}
          />
          <NumberBox c={c} v={v} onSet={(x) => setKey(c.key, x)} onBad={(msg) => toast(msg, "bad")} />
        </span>
      );
    return (
      <div key={c.key} className={`gfx-row ${set ? "set" : ""}`} data-gfx={c.key}>
        <div className="gfx-l" title={c.help}>
          <span className="gfx-name">
            {c.label}
            {scope && (
              <span className={`gfx-scope ${c.scope}`} title={scope.tip}>
                {scope.text}
              </span>
            )}
          </span>
          <small>{c.help}</small>
        </div>
        <div className="gfx-r">
          {input}
          <button
            className="icon-btn sm gfx-reset"
            aria-label={`Reset ${c.label}`}
            title={`Reset ${c.label} to ${c.def === null ? "the look’s value" : fmtGfx(c, c.def)}`}
            disabled={!set}
            onClick={() => setKey(c.key, null)}
          >
            <RotateCcwIcon size={12} />
          </button>
        </div>
      </div>
    );
  };
  return (
    <div className="gfx-panel" ref={rootRef} role="dialog" aria-label="Graphics" onKeyDown={onKey}>
      <div className="gfx-head">
        <b>Graphics</b>
        <span className="dim small ellipsis">{styleName}</span>
        <span className="grow" />
        <span className={`gfx-save ${saving}`} aria-live="polite">
          {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved to this video" : saving === "error" ? "Not saved" : ""}
        </span>
        <button className="icon-btn sm" aria-label="Close Graphics" title="Close (Esc)" onClick={onClose}>
          <XIcon size={15} />
        </button>
      </div>
      <div className="gfx-body">
        <div className="gfx-tools">
          <label className="search gfx-search">
            <SearchIcon size={13} />
            <input
              type="search"
              placeholder="Search: shadows, bloom, fps…"
              aria-label="Search graphics settings"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <span className="row gfx-stat-row">
            <span className="row small" style={{ gap: 6 }}>
              <Toggle on={stats} onChange={onStats} label="Show the frame rate on the preview" />
              <ActivityIcon size={13} />
              FPS readout
            </span>
            <span className="grow" />
            <button
              className="btn tiny"
              onClick={measure}
              disabled={measuring}
              title="Draws the frame on screen 8 times and shows how long one frame takes at these settings"
            >
              {measuring ? <Spinner size={11} /> : <GaugeIcon size={12} />}Measure
            </button>
            {bench && (
              <span className="small gfx-bench" title={bench.drawn ? `3D image ${bench.drawn[0]}×${bench.drawn[1]} px` : void 0}>
                {bench.median.toFixed(1)}
                {" ms · ~"}
                {Math.min(999, Math.round(1e3 / Math.max(1, bench.median)))}
                {" fps"}
              </span>
            )}
          </span>
        </div>
        {info && !info.engine && (
          <div className="gfx-note">
            {engineOld ? (
              <>
                {"This video's engine is older than the Graphics switches. "}
                <button className="btn tiny" onClick={onUpdateEngine}>
                  <RefreshCwIcon size={12} />
                  Update engine
                </button>
                {" adds them; your scenes stay."}
              </>
            ) : (
              <>
                This style draws without these switches; only the frame rate cap and the readout work here. 3D reconstruction has the full
                set.
              </>
            )}
          </div>
        )}
        {!info && (
          <div className="gfx-note">
            <Spinner size={12} />
            {" Waiting for the preview…"}
          </div>
        )}
        {!qq && (
          <div className="gfx-presets">
            <div className="row wrap" style={{ gap: 6 }}>
              {GFX_PRESETS.filter((p) => Object.keys(p.values).some((k) => supported.has(k))).map((p) => (
                <button
                  key={p.id}
                  className={`btn tiny ${Object.keys(p.values).every((k) => vals[k] === p.values[k]) ? "active" : ""}`}
                  title={p.help}
                  onClick={() =>
                    commit(
                      p.id === "export"
                        ? { ...vals, ...p.values }
                        : { ...Object.fromEntries(Object.entries(vals).filter(([k]) => GFX_BY_KEY[k]?.section !== "perf")), ...p.values },
                    )
                  }
                >
                  {p.label}
                </button>
              ))}
              <button
                className="btn tiny"
                title="Every switch back to what the look says (removes this video's graphics settings)"
                disabled={!Object.keys(vals).length}
                onClick={() => commit({})}
              >
                <RotateCcwIcon size={11} />
                Reset to look
              </button>
            </div>
            {(presets.length > 0 || naming !== null) && (
              <div className="row wrap gfx-user" style={{ gap: 6 }}>
                {presets.map((p) => (
                  <span key={p.name} className={`gfx-chip ${same(p.values) ? "active" : ""}`}>
                    <button className="text-btn" title={`Use “${p.name}”`} onClick={() => commit(p.values)}>
                      {p.name}
                    </button>
                    <button
                      className="icon-btn sm"
                      aria-label={`Delete preset ${p.name}`}
                      title="Delete this preset"
                      onClick={() => delPreset(p)}
                    >
                      <TrashIcon size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {naming === null ? (
              <button className="text-btn small" onClick={() => setNaming("")}>
                <SaveIcon size={12} />
                {" Save these as a preset…"}
              </button>
            ) : (
              <form
                className="row gfx-name-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  savePreset();
                }}
              >
                <input
                  className="input compact"
                  autoFocus
                  maxLength={40}
                  placeholder="Preset name"
                  aria-label="Preset name"
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                />
                <button className="btn tiny primary" type="submit" disabled={!naming.trim()}>
                  Save
                </button>
                <button className="btn tiny" type="button" onClick={() => setNaming(null)}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        )}
        {GFX_SECTIONS.map((s) => {
          const cs = shownControls.filter((c) => c.section === s.id && match(c));
          if (!cs.length) return null;
          const open = !!qq || !closed.has(s.id),
            any = cs.some((c) => c.key in vals);
          return (
            <section key={s.id} className="gfx-sec" data-sec={s.id}>
              <div className="gfx-sec-head">
                <button
                  className="gfx-sec-t"
                  aria-expanded={open}
                  onClick={() =>
                    setClosed((o) => {
                      const n = new Set(o);
                      n.has(s.id) ? n.delete(s.id) : n.add(s.id);
                      return n;
                    })
                  }
                >
                  <ChevronDownIcon size={13} className={open ? "" : "gfx-rot"} />
                  {s.label}
                  {any && <span className="gfx-dot" title="Changed from the look" />}
                </button>
                <button
                  className="text-btn small"
                  disabled={!any}
                  onClick={() => resetSection(s.id)}
                  title={`Reset ${s.label} to the look`}
                >
                  Reset
                </button>
              </div>
              {open && (
                <>
                  <p className="help gfx-sec-help">{s.help}</p>
                  {s.id === "grade" && !qq && (
                    <div className="row wrap gfx-looks" style={{ gap: 5 }}>
                      {GFX_LOOKS.map((L) => (
                        <button
                          key={L.id}
                          className={`btn tiny ${look === L.id ? "active" : ""}`}
                          aria-pressed={look === L.id}
                          title={L.help}
                          onClick={() => commit(withGradeLook(vals, L.id))}
                        >
                          {L.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {s.id === "export" && !qq && <ExportQualityPick projectId={projectId} />}
                  {cs.map(row)}
                </>
              )}
            </section>
          );
        })}
        {qq && !shownControls.some(match) && (
          <p className="help" style={{ padding: "10px 2px" }}>
            Nothing matches “{q.trim()}”.
          </p>
        )}
      </div>
    </div>
  );
}
const exqKey = (id) => `cz-exq-${id}`;
export function getExportQuality(projectId) {
  try {
    const v = localStorage.getItem(exqKey(projectId));
    if (EXPORT_QUALITIES.some((q) => q.id === v)) return v;
  } catch {}
  return "standard";
}
export function ExportQualityPick({ projectId, disabled }) {
  const [v, setV] = useState(() => getExportQuality(projectId));
  useEffect(() => {
    const f = () => setV(getExportQuality(projectId));
    window.addEventListener("cz-exq", f);
    return () => window.removeEventListener("cz-exq", f);
  }, [projectId]);
  const set = (x) => {
    setV(x);
    try {
      localStorage.setItem(exqKey(projectId), x);
    } catch {}
    window.dispatchEvent(new Event("cz-exq"));
  };
  return (
    <div className="field exq">
      <label htmlFor={`exq-${projectId}`}>Export quality</label>
      <select id={`exq-${projectId}`} className="input compact exq-sel" value={v} disabled={disabled} onChange={(e) => set(e.target.value)}>
        {EXPORT_QUALITIES.map((q) => (
          <option key={q.id} value={q.id}>
            {q.id === "preview" ? "Same as preview (use my Graphics settings)" : q.label}
          </option>
        ))}
      </select>
      <span className="help exq-hint">{EXPORT_QUALITIES.find((q) => q.id === v).hint}</span>
    </div>
  );
}
function NumberBox({ c, v, onSet, onBad }) {
  const pct = c.unit === "%",
    shown = v == null ? "" : pct ? String(Math.round(v * 100)) : String(+(+v).toFixed(4));
  const [txt, setTxt] = useState(shown),
    [bad, setBad] = useState(false);
  useEffect(() => {
    setTxt(shown);
    setBad(false);
  }, [shown]);
  const apply = () => {
    if (txt.trim() === shown) return;
    const n = Number(txt.replace(",", ".")),
      val = pct ? n / 100 : n;
    if (!txt.trim() || !isFinite(n) || val < c.min - 1e-9 || val > c.max + 1e-9) {
      setBad(true);
      onBad(`${c.label} must be between ${pct ? `${c.min * 100}% and ${c.max * 100}%` : `${c.min} and ${c.max}`}.`);
      setTxt(shown);
      return;
    }
    setBad(false);
    onSet(val);
  };
  return (
    <input
      className={`input compact gfx-num ${bad ? "bad" : ""}`}
      inputMode="decimal"
      aria-label={`${c.label} value`}
      title={fmtGfx(c, v)}
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          apply();
        }
      }}
    />
  );
}
