import { GlobeIcon, Image, MusicIcon, SparklesIcon } from "lucide-react";
import { Toggle } from "../../components/ui";
import { effortName } from "../../engines/claudeModels";
import { engineOf, modelName } from "../../engines/models";
import { useGoogleState } from "../../engines/ExperimentalGoogle";
import { useCodexState } from "../../engines/ChatGPTEngine";
import { EffortSelect, ModelSelect } from "../../engines/ModelSelect";

const IMAGE_CHOICE_NAMES = { auto: "Automatic", higgsfield: "Higgsfield", fal: "Fal.ai", custom: "Custom API", flow: "Google Flow" };
const VOICE_CHOICE_NAMES = {
  auto: "Automatic",
  file: "My recording",
  elevenlabs: "ElevenLabs",
  fish: "Fish Audio",
  kokoro: "Local voice",
  custom: "Custom API",
};
function effectiveImage(vals, info) {
  const sv = info.services,
    want = vals.image ?? info.global.image;
  const has = { higgsfield: sv.higgsfield, fal: sv.fal, custom: !!sv.customImage, flow: !!sv.flow };
  if (want !== "auto" && has[want]) return want;
  return has.higgsfield ? "higgsfield" : has.fal ? "fal" : null;
}
export function mergeChoices(vals, patch) {
  const n = { ...vals };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "imageModel") {
      const m = { ...(n.imageModel ?? {}) };
      for (const [s, x] of Object.entries(v ?? {})) {
        if (x) m[s] = x;
        else delete m[s];
      }
      if (Object.keys(m).length) n.imageModel = m;
      else delete n.imageModel;
    } else if (v === null || v === void 0) delete n[k];
    else n[k] = v;
  }
  return n;
}
export function choicesSummary(vals, info) {
  const out = [];
  if (vals.model) out.push(modelName(vals.model));
  if (vals.effort) out.push(`${effortName(vals.effort)} effort`);
  if (vals.image)
    out.push(
      `Image generation: ${vals.image === "custom" ? `Custom API${info?.services.customImage ? ` (${info.services.customImage})` : ""}` : IMAGE_CHOICE_NAMES[vals.image]}`,
    );
  if (vals.imageModel?.higgsfield)
    out.push(info?.models.higgsfield.find((m) => m.id === vals.imageModel.higgsfield)?.label ?? vals.imageModel.higgsfield);
  if (vals.imageModel?.custom) out.push(vals.imageModel.custom);
  if (vals.voice) out.push(`Voiceover: ${VOICE_CHOICE_NAMES[vals.voice]}`);
  if (vals.music !== void 0) out.push(`Music ${vals.music ? "on" : "off"}`);
  if (vals.sfx !== void 0) out.push(`Sound effects ${vals.sfx ? "on" : "off"}`);
  return out.join(" · ");
}
function Rows({ title, icon, rows }) {
  if (!rows.length) return null;
  return (
    <div className="pjs-sec">
      <div className="pjs-title">
        {icon}
        {title}
      </div>
      {rows.map((r) => (
        <div key={r.label} className={`opt pjs-row ${r.off ? "off" : ""}`} title={r.off ?? void 0}>
          <span>
            {r.label}
            <small>{r.off ? r.off : r.help}</small>
          </span>
          {r.control}
        </div>
      ))}
    </div>
  );
}
export function ProjectChoicesForm({
  vals,
  onChange,
  info,
  base,
  styleName,
  real,
  effective,
  aria = " (project settings)",
  hideOff = false,
  disabled = false,
}) {
  const google = useGoogleState();
  const codex = useCodexState();
  const sv = info.services,
    M = info.models;
  const imgName = (c) => (c === "custom" ? `Custom API${sv.customImage ? `: ${sv.customImage}` : ""}` : (IMAGE_CHOICE_NAMES[c] ?? c));
  const voiceName = (c) => (c === "custom" ? `Custom API${sv.customVoice ? `: ${sv.customVoice}` : ""}` : (VOICE_CHOICE_NAMES[c] ?? c));
  const missing = (has, what = "no key yet") => (has ? "" : ` (${what})`);
  const onOff = (v) => (v ? "On" : "Off");
  const eff = effective ?? { image: effectiveImage(vals, info), music: vals.music ?? info.global.music, sfx: vals.sfx ?? info.global.sfx };
  const effModel = vals.model || info.claude.globalModel,
    draws = base !== "collage" && base !== "stickman";
  const want = vals.image ?? info.global.image,
    waiting = want !== "auto" && eff.image !== want;
  const imgNow = waiting
    ? `${imgName(want)} ${want === "custom" ? "is not set up" : want === "flow" ? "is not opened yet" : "has no key yet"} (Settings > Media > Image generation): ${eff.image ? `pictures are made on ${imgName(eff.image)} until then.` : "no pictures can be made until then."}`
    : eff.image
      ? `Pictures are made on ${imgName(eff.image)}.`
      : "Image generation is not set up yet (Settings > Media > Image generation).";
  const keep = (r) => !(hideOff && r.off);
  const claudeRows = [
    {
      label: "Model",
      help: `Runs on ${effModel ? modelName(effModel) : "your Claude Code account's default model"}: the research and script, the build and your edits. Ultraedit always runs on Opus 5.5; a routine's own Claude settings come first.`,
      control: (
        <ModelSelect
          value={vals.model ?? ""}
          onChange={(v) => onChange({ model: v || null })}
          ariaLabel={`Claude model for this project${aria}`}
          disabled={disabled}
          globalLabel={`Global setting (${modelName(info.claude.globalModel)})`}
          globalHint="Follows Settings > AI engines"
          google={google}
          codex={codex}
        />
      ),
    },
    {
      label: "Effort",
      help:
        engineOf(effModel) === "google"
          ? "Google models have no effort setting: this applies only when the project runs on a Claude model."
          : engineOf(effModel) === "codex"
            ? "How much ChatGPT reasons before it acts (Codex reasoning effort). Higher is more careful and uses more of your ChatGPT plan."
            : "How much Claude thinks before it acts. Higher is more careful and uses more of your plan.",
      control: (
        <EffortSelect
          value={vals.effort ?? ""}
          onChange={(v) => onChange({ effort: v || null })}
          ariaLabel={`Claude effort for this project${aria}`}
          disabled={disabled || engineOf(effModel) === "google"}
          title={engineOf(effModel) === "google" ? "Google models have no effort setting" : void 0}
          globalLabel={`Global setting (${effortName(info.claude.globalEffort)})`}
        />
      ),
    },
  ];
  const svc = eff.image,
    hLabel = (id) => M.higgsfield.find((m) => m.id === id)?.label ?? id ?? "";
  const modelRow =
    svc === "higgsfield"
      ? {
          label: "Default image model",
          help: `make_image uses ${hLabel(vals.imageModel?.higgsfield ?? M.global.higgsfield ?? M.appDefault)} unless Claude picks another one. Claude is told in the project's notes.`,
          control: (
            <select
              className="input compact pjs-sel"
              aria-label="Default image model for this project"
              disabled={disabled}
              value={vals.imageModel?.higgsfield ?? ""}
              onChange={(e) => onChange({ imageModel: { higgsfield: e.target.value || null } })}
            >
              <option value="">Global setting ({hLabel(M.global.higgsfield ?? M.appDefault)})</option>
              {M.higgsfield.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          ),
        }
      : svc === "custom"
        ? {
            label: "Default image model",
            help: `The model your connector gets ("model"), as the service names it. Empty: ${M.global.custom ? `the global one (${M.global.custom})` : "the connector's own"}.`,
            control: (
              <input
                key={vals.imageModel?.custom ?? ""}
                className="input compact pjs-sel"
                aria-label="Default image model for this project"
                disabled={disabled}
                defaultValue={vals.imageModel?.custom ?? ""}
                placeholder={M.global.custom ? `Global setting (${M.global.custom})` : "Global setting"}
                maxLength={100}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (vals.imageModel?.custom ?? "")) onChange({ imageModel: { custom: v || null } });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                }}
              />
            ),
          }
        : {
            label: "Default image model",
            help:
              svc === "fal"
                ? "Fal.ai makes the pictures with FLUX.2 here: there is no model to pick."
                : "Set up image generation first (Settings > Media > Image generation).",
            control: <span />,
          };
  const pictureRows = [
    {
      label: "Image generation",
      help: `${draws ? `${styleName} draws its scenes itself: only AI thumbnails in routines use it. ` : ""}${imgNow}`,
      control: (
        <select
          className="input compact pjs-sel"
          aria-label="Image generation for this project"
          disabled={disabled}
          value={vals.image ?? ""}
          onChange={(e) => onChange({ image: e.target.value || null })}
        >
          <option value="">Global setting ({imgName(info.global.image)})</option>
          <option value="auto">Automatic</option>
          <option value="higgsfield">Higgsfield{missing(sv.higgsfield)}</option>
          <option value="fal">Fal.ai{missing(sv.fal)}</option>
          {(sv.customImage || vals.image === "custom") && (
            <option value="custom">
              {imgName("custom")}
              {missing(!!sv.customImage, "not set up")}
            </option>
          )}
          {(sv.flow || vals.image === "flow") && (
            <option value="flow">Google Flow (at your own risk){missing(!!sv.flow, "not opened yet")}</option>
          )}
        </select>
      ),
    },
    modelRow,
    {
      label: "Voiceover",
      help: "The voice the Voiceover window opens on. A routine's Voiceover node set to Automatic uses it too (ElevenLabs, Fish Audio or the local voice).",
      control: (
        <select
          className="input compact pjs-sel"
          aria-label="Voiceover for this project"
          disabled={disabled}
          value={vals.voice ?? ""}
          onChange={(e) => onChange({ voice: e.target.value || null })}
        >
          <option value="">Global setting ({voiceName(info.global.voice)})</option>
          <option value="auto">Automatic</option>
          <option value="file">My recording</option>
          <option value="elevenlabs">ElevenLabs{missing(sv.elevenlabs)}</option>
          <option value="fish">Fish Audio{missing(sv.fish)}</option>
          <option value="kokoro">Local voice{missing(sv.kokoro, "not installed")}</option>
          {(sv.customVoice || vals.voice === "custom") && (
            <option value="custom">
              {voiceName("custom")}
              {missing(!!sv.customVoice, "not set up")}
            </option>
          )}
        </select>
      ),
    },
  ];
  const onlyRecon =
    base === "stickman" ? null : `Only 3D reconstruction and MS Paint stick figures use real photos: ${styleName} makes its own pictures.`;
  const realRows = !real
    ? []
    : [
        {
          label: base === "stickman" ? "Use real images from the web" : "Real photos and footage",
          help:
            base === "stickman"
              ? "Real photos from Wikimedia Commons (free licences, credited) as framed pictures."
              : "Real photographs and archive film of the event from Wikimedia Commons (free licences, credited).",
          off: base === "recon" || base === "stickman" ? null : onlyRecon,
          control: (
            <Toggle
              label={base === "stickman" ? "Use real images from the web" : "Real photos and footage"}
              disabled={disabled || real.disabled || (base !== "recon" && base !== "stickman")}
              on={base === "recon" ? real.isOn("media.on", true) : base === "stickman" ? real.isOn("web.on", false) : false}
              onChange={(v) => real.flip(base === "recon" ? "media.on" : "web.on", v)}
            />
          ),
        },
        {
          label: "Free 3D models from the web",
          help: "Real machines, vehicles and animals as free downloaded models (CC0 / CC-BY, artists credited).",
          off:
            base === "recon"
              ? null
              : base === "lowpoly"
                ? "Always on in Low poly shorts: free 3D models from its built-in library (CC0 / CC-BY, credited in the description), and every new model Claude finds is saved there for your next videos."
                : base === "toon"
                  ? "3D cartoon shorts builds its own characters, sets and props: no downloaded models, so every video keeps one cartoon look."
                  : base === "stickstory"
                    ? "Stick stories draws its own stick people, sets, maps and graphics: no downloaded models, so every video keeps one drawn look."
                    : `Only 3D reconstruction uses downloaded 3D models: ${styleName} draws its own.`,
          control: (
            <Toggle
              label="Free 3D models from the web"
              disabled={disabled || real.disabled || base !== "recon"}
              on={base === "lowpoly" || (base === "recon" && real.isOn("models.on", true))}
              onChange={(v) => real.flip("models.on", v)}
            />
          ),
        },
        {
          label: "Real maps of the places",
          help: "Maps and terrain of the real places from OpenStreetMap and elevation data.",
          off: base === "recon" ? null : `Only 3D reconstruction draws real maps.`,
          control: (
            <Toggle
              label="Real maps of the places"
              disabled={disabled || real.disabled || base !== "recon"}
              on={base === "recon" && real.isOn("maps.on", true)}
              onChange={(v) => real.flip("maps.on", v)}
            />
          ),
        },
      ];
  const soundSel = (key, label, off = false) => (
    <select
      className="input compact pjs-sel"
      aria-label={label}
      disabled={disabled || off}
      value={vals[key] === void 0 ? "" : vals[key] ? "on" : "off"}
      onChange={(e) => onChange({ [key]: e.target.value === "" ? null : e.target.value === "on" })}
    >
      <option value="">Global setting ({onOff(info.global[key])})</option>
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
  );
  const soundRows = [
    {
      label: "Music",
      help: `Music and ambience under the voice. ${onOff(eff.music)} for this project; a change applies at the next Mix.`,
      off: base === "stickman" ? "MS Paint stick figures have no music: the voice and sound effects only." : null,
      control: soundSel("music", "Music for this project", base === "stickman"),
    },
    {
      label: "Sound effects",
      help: `Sounds on cuts, cards and accents. ${onOff(eff.sfx)} for this project; a change applies at the next Mix.`,
      control: soundSel("sfx", "Sound effects for this project"),
    },
  ];
  return (
    <>
      <Rows title="Claude" icon={<SparklesIcon size={14} strokeWidth={1.8} />} rows={claudeRows} />
      <Rows title="Pictures and voice" icon={<Image size={14} strokeWidth={1.8} />} rows={pictureRows} />
      <Rows title="Real media" icon={<GlobeIcon size={14} strokeWidth={1.8} />} rows={realRows.filter(keep)} />
      <Rows title="Sound" icon={<MusicIcon size={14} strokeWidth={1.8} />} rows={soundRows.filter(keep)} />
    </>
  );
}
