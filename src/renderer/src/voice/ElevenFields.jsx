import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, KeyRoundIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { api } from "../lib/api";
import { Spinner } from "../components/ui";
import { Picker } from "../components/Picker";
import { lang } from "../settings/languages";
import { SettingsControls } from "../settings/project/SettingsControls";
import { SampleButton, useSample } from "./useSample";

const elControls = (m) => [
  {
    path: "stability",
    label: "Stability",
    type: "range",
    min: 0,
    max: 1,
    step: m && !m.stitching ? 0.5 : 0.05,
    fmt: "pct",
    help:
      m && !m.stitching
        ? `${m.name}: Creative (0%), Natural (50%) or Robust (100%).`
        : "Lower: more emotion and variety. Higher: steadier and more even.",
  },
  {
    path: "similarity",
    label: "Similarity",
    type: "range",
    min: 0,
    max: 1,
    step: 0.05,
    fmt: "pct",
    help: "How closely it sticks to the original voice.",
  },
  ...(m?.style === false
    ? []
    : [
        {
          path: "style",
          label: "Style exaggeration",
          type: "range",
          min: 0,
          max: 1,
          step: 0.05,
          fmt: "pct",
          help: "More of the voice’s own style. Above 0% it is slower to make and less steady.",
        },
      ]),
  {
    path: "speed",
    label: "Speed",
    type: "range",
    min: 0.7,
    max: 1.2,
    step: 0.05,
    fmt: "pct",
    help: "How fast it reads (100% is the voice’s own pace).",
  },
  ...(m?.boost === false
    ? []
    : [
        {
          path: "speakerBoost",
          label: "Speaker boost",
          type: "toggle",
          help: "Even closer to the original voice; a little slower to make.",
        },
      ]),
];
const NARRATORS = /^(Brian|George|Daniel|Rachel|Adam|Sarah)$/;
const elErrTitle = (e) =>
  /not allowed to list your voices/.test(e)
    ? "Your voices could not be listed"
    : /did not accept/.test(e)
      ? "ElevenLabs did not accept your key"
      : /Could not reach/.test(e)
        ? "ElevenLabs could not be reached"
        : "Your voices could not load";
const speaks = (m, code) => !m || !m.langs?.length || m.langs.includes(code);
export function ElevenFields({ value, onChange, onKey, keyHint, onStatus, language }) {
  const L = lang(language),
    foreign = !!language && L.code !== "en";
  const [voices, setVoices] = useState(null),
    [models, setModels] = useState(null);
  const [err, setErr] = useState(null),
    [modelErr, setModelErr] = useState(false),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false);
  const sample = useSample();
  const load = useCallback(async (force = false) => {
    setErr(null);
    setLoading(true);
    const m = api.elevenModels().then(
      (l) => {
        setModels(l);
        setModelErr(false);
      },
      () => {
        setModels(null);
        setModelErr(true);
      },
    );
    try {
      setVoices(await api.elevenVoices(force));
    } catch (e) {
      setErr(e.message);
      setVoices(null);
    } finally {
      await m;
      setLoading(false);
    }
  }, []);
  const firstKey = useRef(true);
  useEffect(() => {
    load(!firstKey.current);
    firstKey.current = false;
  }, [load, keyHint]);
  const noList = !!err && /not allowed to list your voices/.test(err);
  const gone = !!voices?.length && !!value.voiceId && !voices.some((v) => v.id === value.voiceId);
  const ok = (!!voices?.length && !gone) || (noList && !!value.voiceId);
  useEffect(() => {
    onStatus?.(ok);
  }, [ok]);
  useEffect(() => {
    if (voices?.length && !value.voiceId) {
      const speaksIt = (v) => foreign && v.languages.includes(L.code);
      const p =
        voices.find((v) => v.own && speaksIt(v)) ??
        voices.find(speaksIt) ??
        voices.find((v) => v.own) ??
        voices.find((v) => NARRATORS.test(v.name)) ??
        voices[0];
      onChange({ voiceId: p.id, voiceName: p.name });
    }
  }, [voices, value.voiceId, L.code]);
  useEffect(() => {
    if (
      models?.length &&
      (!models.some((m) => m.id === value.modelId) ||
        (foreign &&
          !speaks(
            models.find((m) => m.id === value.modelId),
            L.code,
          )))
    )
      onChange({ modelId: (models.find((m) => !foreign || speaks(m, L.code)) ?? models[0]).id });
  }, [models, L.code, value.modelId]);
  const native = (v) => foreign && v.languages.includes(L.code);
  const vOpts = useMemo(
    () =>
      (voices ?? [])
        .map((v) => ({
          value: v.id,
          label: v.name,
          hint: [native(v) ? `Native ${L.name}` : "", v.hint || v.description].filter(Boolean).join(" · ") || void 0,
          group: v.own ? "Your voices" : native(v) ? `${L.name} voices` : "ElevenLabs voices",
          badge:
            v.category === "cloned"
              ? "Cloned"
              : v.category === "generated"
                ? "Designed"
                : v.category === "professional"
                  ? "Pro clone"
                  : void 0,
          icon: <span className="vo-initial">{v.name.slice(0, 1)}</span>,
          keywords: `${v.description} ${v.languages.join(" ")}`,
        }))
        .sort(
          (a, b) =>
            (a.group === "Your voices" ? 0 : a.group === "ElevenLabs voices" ? 2 : 1) -
            (b.group === "Your voices" ? 0 : b.group === "ElevenLabs voices" ? 2 : 1),
        ),
    [voices, L.code],
  );
  const mOpts = useMemo(
    () =>
      (models ?? []).map((m) => {
        const off = foreign && !speaks(m, L.code);
        return {
          value: m.id,
          label: m.name,
          group: m.older ? "Older models" : "Models",
          disabled: off,
          hint: off
            ? `Doesn't speak ${L.name}`
            : [m.hint, m.languages ? `${m.languages} languages` : "", m.cost !== 1 ? `${m.cost}× characters` : ""]
                .filter(Boolean)
                .join(" · "),
        };
      }),
    [models, L.code],
  );
  const model = models?.find((m) => m.id === value.modelId),
    voice = voices?.find((v) => v.id === value.voiceId);
  const shown =
    model && !model.stitching
      ? { ...value, stability: [0, 0.5, 1].reduce((b, v) => (Math.abs(v - value.stability) < Math.abs(b - value.stability) ? v : b), 0.5) }
      : value;
  return (
    <div className="vo-fields">
      <div className="vo-grid">
        <div className="field">
          <label htmlFor="vo-el-voice">Voice</label>
          {noList ? (
            <>
              <input
                id="vo-el-voice"
                className="input"
                value={value.voiceId}
                onChange={(e) => onChange({ voiceId: e.target.value.trim(), voiceName: "" })}
                placeholder="Paste a voice ID from ElevenLabs"
                spellCheck={false}
              />
              <span className="help">
                {value.voiceId && value.voiceName
                  ? `The voice ID of ${value.voiceName}.`
                  : "A voice’s ID: on elevenlabs.io, open My Voices, then the voice’s ⋯ menu > Copy voice ID."}
              </span>
            </>
          ) : (
            <div className="vo-pickrow">
              <Picker
                id="vo-el-voice"
                value={value.voiceId}
                options={vOpts}
                onChange={(id) => onChange({ voiceId: id, voiceName: voices?.find((v) => v.id === id)?.name ?? "" })}
                menuWidth={360}
                placeholder={err ? "Voices could not load" : gone ? "Pick a voice" : "Loading your voices…"}
                disabled={!voices?.length}
                search={vOpts.length > 6}
              />
              <SampleButton
                s={sample}
                id={gone ? "" : value.voiceId}
                title={
                  voice && !voice.preview
                    ? "Hear it read one sentence (uses about 90 of your characters)"
                    : !foreign
                      ? "Hear a sample of this voice"
                      : voice?.samples?.includes(L.code)
                        ? `Hear ElevenLabs' sample of this voice speaking ${L.name}`
                        : `Hear ElevenLabs' sample of this voice (it has none in ${L.name})`
                }
                onPlay={() =>
                  sample.play(value.voiceId, { provider: "elevenlabs", voiceId: value.voiceId, eleven: value, language: L.code })
                }
              />
            </div>
          )}
          {gone && (
            <span className="help warn vo-gone">
              {value.voiceName ? `${value.voiceName} is` : "The voice picked before is"}
              {" no longer on your ElevenLabs account (removed there, or this key is another account's). Pick a voice."}
            </span>
          )}
          {voices && voices.length > 0 && (
            <span className="help vo-voices-help">
              {voice?.description ? (
                <span className="ellipsis" title={voice.description}>
                  {voice.description}
                </span>
              ) : (
                <span>
                  {voices.length}
                  {" voices on your account"}
                </span>
              )}
              <button
                type="button"
                className="text-btn"
                onClick={() => load(true)}
                disabled={loading}
                title="Load the list again (a voice you just cloned or added on ElevenLabs)"
              >
                {loading ? "Loading…" : "Refresh list"}
              </button>
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="vo-el-model">Model</label>
          <Picker
            id="vo-el-model"
            value={value.modelId}
            options={mOpts}
            onChange={(id) => onChange({ modelId: id })}
            menuWidth={340}
            placeholder={modelErr ? "Models could not load" : "Loading models…"}
            disabled={!models?.length}
          />
          {model && (
            <span className={`help ${foreign && !speaks(model, L.code) ? "warn" : ""}`}>
              {foreign ? (speaks(model, L.code) ? `Reads ${L.name}. ` : `${model.name} doesn't speak ${L.name}: pick another model. `) : ""}
              {model.hint}
              {model.cost !== 1 ? ` · uses ${model.cost}× characters` : ""}
            </span>
          )}
        </div>
      </div>
      {err && (
        <div className="hint bad vo-hint">
          <TriangleAlertIcon size={18} />
          <div>
            <b>{elErrTitle(err)}</b>
            <p>{err}</p>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn small" onClick={() => load(true)} disabled={loading}>
                {loading ? <Spinner size={13} /> : <RefreshCwIcon size={13} />}Try again
              </button>
              {onKey && (
                <button className="btn small" onClick={onKey}>
                  <KeyRoundIcon size={13} />
                  Change key
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <button type="button" className={`vo-more ${more ? "open" : ""}`} aria-expanded={more} onClick={() => setMore(!more)}>
        <ChevronDownIcon size={14} strokeWidth={1.8} />
        Voice settings
        <span className="dim">
          {Math.round(shown.stability * 100)}
          {"% stability · "}
          {Math.round(value.similarity * 100)}% similarity{value.speed !== 1 ? ` · ${Math.round(value.speed * 100)}% speed` : ""}
        </span>
      </button>
      {more && (
        <div className="vo-settings">
          <SettingsControls controls={elControls(model)} settings={shown} onChange={(p, v) => onChange({ [p]: v })} />
          <button
            className="text-btn"
            onClick={() => onChange({ stability: 0.5, similarity: 0.75, style: 0, speed: 1, speakerBoost: true })}
          >
            Reset to the defaults
          </button>
        </div>
      )}
    </div>
  );
}
