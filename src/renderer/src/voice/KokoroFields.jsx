import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Picker } from "../components/Picker";
import { lang } from "../settings/languages";
import { SampleButton, useSample } from "./useSample";

export const kokoroSpeaks = (v, code) => (lang(code).kokoro ?? "").includes(v.id[0]);
export function KokoroFields({ value, onChange, language }) {
  const [voices, setVoices] = useState(null);
  const sample = useSample();
  const L = lang(language),
    only = !!language;
  useEffect(() => {
    api
      .kokoroVoices()
      .then(setVoices)
      .catch(() => setVoices([]));
  }, []);
  const usable = (v) => !only || kokoroSpeaks(v, L.code);
  useEffect(() => {
    if (voices?.length && !voices.some((v) => v.id === value.voice && usable(v))) {
      const p = voices.find(usable) ?? voices[0];
      onChange({ voice: p.id });
    }
  }, [voices, L.code, value.voice]);
  const opts = useMemo(
    () =>
      (voices ?? []).filter(usable).map((v) => ({
        value: v.id,
        label: v.name,
        group: v.language,
        hint: v.gender === "female" ? "Female" : "Male",
        badge: v.best ? "Best" : void 0,
        // the language is the group
        icon: <span className="vo-initial">{v.name.slice(0, 1)}</span>,
        keywords: v.id,
      })),
    [voices, L.code],
  );
  return (
    <div className="vo-grid">
      <div className="field">
        <label htmlFor="vo-kk-voice">Voice</label>
        <div className="vo-pickrow">
          <Picker
            id="vo-kk-voice"
            value={value.voice}
            options={opts}
            onChange={(id) => onChange({ voice: id })}
            menuWidth={300}
            placeholder="Loading voices…"
            disabled={!voices?.length}
          />
          <SampleButton
            s={sample}
            id={value.voice ? `${value.voice}@${value.speed}` : ""}
            title="Hear a sample (made on this computer: the first one takes a few seconds)"
            onPlay={() => sample.play(`${value.voice}@${value.speed}`, { provider: "kokoro", voiceId: value.voice, speed: value.speed })}
          />
        </div>
        <span className="help">
          {!only
            ? "The voices marked Best sound the most natural."
            : L.code === "en"
              ? "The English voices (US and UK). A video in another language gets the voices of its language: set its language first."
              : !opts.length
                ? `The local voice's ${L.name} voices.`
                : `The local voice has ${opts.length} ${L.code === "pt" ? "Brazilian Portuguese" : L.name} voice${opts.length === 1 ? "" : "s"}; ElevenLabs has many more.`}
        </span>
      </div>
      <div className="field">
        <span className="label">
          {"Speed "}
          <span className="dim">{Math.round(value.speed * 100)}%</span>
        </span>
        <input
          className="range vo-range"
          type="range"
          min={0.7}
          max={1.3}
          step={0.05}
          value={value.speed}
          onChange={(e) => onChange({ speed: +e.target.value })}
          aria-label="Speed"
        />
        <span className="help">100% is the voice's own pace.</span>
      </div>
    </div>
  );
}
