import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { RefreshCw } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Picker } from "../components/Picker";
import { lang } from "../settings/languages";

export function CustomVoiceField({ value, onChange }) {
  const [voices, setVoices] = useState(null);
  const load = (force = false) => {
    setVoices(null);
    api
      .customVoices(force)
      .then(setVoices)
      .catch(() => setVoices([]));
  };
  useEffect(() => load(), []);
  useEffect(() => {
    if (voices?.length && !voices.some((v) => v.id === value.voice)) onChange({ voice: voices[0].id, voiceName: voices[0].name });
  }, [voices]);
  const opts = useMemo(
    () =>
      (voices ?? []).map((v) => ({
        value: v.id,
        label: v.name,
        hint: v.language ? lang(v.language).name : void 0,
        icon: <span className="vo-initial">{v.name.slice(0, 1)}</span>,
        keywords: v.id,
      })),
    [voices],
  );
  if (voices && !voices.length)
    return (
      <p className="help vo-cv-none">
        {
          "This connector doesn't list voices: it speaks with the voice it was set up for. To pick voices here, set it up again in Settings > Media > Custom APIs."
        }
      </p>
    );
  return (
    <div className="field vo-cv">
      <label htmlFor="vo-cv-voice">Voice</label>
      <div className="vo-pickrow">
        <Picker
          id="vo-cv-voice"
          value={value.voice}
          options={opts}
          onChange={(id) => onChange({ voice: id, voiceName: voices?.find((v) => v.id === id)?.name ?? "" })}
          menuWidth={340}
          placeholder="Loading voices…"
          disabled={!voices?.length}
        />
        <button
          className="btn small"
          onClick={() => load(true)}
          disabled={!voices}
          title="Load the voices again (after you add one on the service)"
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <span className="help">The voices your service offers, your own first.</span>
    </div>
  );
}
