import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRoundIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { api } from "../lib/api";
import { Spinner } from "../components/ui";
import { Picker } from "../components/Picker";
import { lang } from "../settings/languages";
import { SampleButton, useSample } from "./useSample";

export const usd = (n) =>
  n > 0 && n < 0.01
    ? "less than 1 cent"
    : n < 1
      ? `${Math.round(n * 100)} cent${Math.round(n * 100) === 1 ? "" : "s"}`
      : `$${n.toFixed(2)}`;
const FISH_S1 = "en zh ja de fr es ko ar ru nl it pl pt".split(" ");
const fishSpeaksIt = (model, code) => model !== "s1" || FISH_S1.includes(code);
export const fishIdOf = (t) =>
  /fish\.audio\/(?:[a-z-]+\/)?m\/([\w-]{8,64})/i.exec(t)?.[1] ?? (/^[\w-]{16,64}$/.test(t.trim()) ? t.trim() : null);
export function useFishNames(ids) {
  const [names, setNames] = useState({}),
    asked = useRef(new Set());
  const want = [...new Set(ids.filter(Boolean))].sort().join(" ");
  useEffect(() => {
    for (const id of want ? want.split(" ") : []) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      api.fishVoiceName(id).then(
        (n) => {
          if (n) setNames((m) => ({ ...m, [id]: n }));
        },
        () => {},
      );
    }
  }, [want]);
  return names;
}
export function FishFields({ value, onChange, onKey, keyHint, language }) {
  const L = lang(language),
    code = L.code;
  const [voices, setVoices] = useState(null),
    [models, setModels] = useState(null);
  const [err, setErr] = useState(null),
    [loading, setLoading] = useState(false),
    [paste, setPaste] = useState(""),
    [pasteOpen, setPasteOpen] = useState(false);
  const sample = useSample();
  const load = useCallback(
    async (force = false) => {
      setErr(null);
      setLoading(true);
      api
        .fishModels()
        .then(setModels)
        .catch(() => setModels(null));
      try {
        setVoices(await api.fishVoices(code, force));
      } catch (e) {
        setErr(e.message);
        setVoices(null);
      } finally {
        setLoading(false);
      }
    },
    [code],
  );
  const firstKey = useRef(true);
  useEffect(() => {
    load(!firstKey.current);
    firstKey.current = false;
  }, [load, keyHint]);
  useEffect(() => {
    if (voices?.length && !value.voiceId) {
      const p = voices.find((v) => v.own) ?? voices[0];
      onChange({ voiceId: p.id, voiceName: p.name });
    }
  }, [voices, value.voiceId]);
  useEffect(() => {
    if (models?.length && (!models.some((m) => m.id === value.model) || !fishSpeaksIt(value.model, code)))
      onChange({ model: (models.find((m) => fishSpeaksIt(m.id, code)) ?? models[0]).id });
  }, [models, code, value.model]);
  const listed = voices?.find((v) => v.id === value.voiceId);
  const linked = useFishNames(voices && value.voiceId && !listed && !value.voiceName ? [value.voiceId] : []);
  useEffect(() => {
    const n = linked[value.voiceId];
    if (n && !value.voiceName) onChange({ voiceName: n });
  }, [linked, value.voiceId, value.voiceName]);
  const opts = useMemo(() => {
    const o = (voices ?? []).map((v) => ({
      value: v.id,
      label: v.name,
      group: v.own ? "Your voices" : `Popular on Fish Audio${code !== "en" ? ` (${L.name})` : ""}`,
      badge: v.own ? "Yours" : void 0,
      hint:
        [
          v.hint,
          !v.own && v.uses
            ? `${v.uses >= 1e6 ? `${(v.uses / 1e6).toFixed(1)}M` : v.uses >= 1e3 ? `${Math.round(v.uses / 1e3)}k` : v.uses} uses`
            : "",
        ]
          .filter(Boolean)
          .join(" · ") || void 0,
      icon: <span className="vo-initial">{v.name.slice(0, 1)}</span>,
      keywords: `${v.hint} ${v.languages.join(" ")}`,
    }));
    if (value.voiceId && !voices?.some((v) => v.id === value.voiceId))
      o.unshift({
        value: value.voiceId,
        label: value.voiceName || "Voice from a link",
        group: "Picked",
        icon: <span className="vo-initial">{(value.voiceName || "V").slice(0, 1)}</span>,
      });
    return o;
  }, [voices, value.voiceId, value.voiceName, code]);
  const mOpts = useMemo(
    () =>
      (models ?? []).map((m) => ({
        value: m.id,
        label: m.name,
        disabled: !fishSpeaksIt(m.id, code),
        hint: fishSpeaksIt(m.id, code) ? m.hint : `Doesn't speak ${L.name}`,
      })),
    [models, code],
  );
  const usePaste = () => {
    const id = fishIdOf(paste);
    if (!id) return;
    onChange({ voiceId: id, voiceName: voices?.find((v) => v.id === id)?.name ?? "" });
    setPaste("");
    setPasteOpen(false);
  };
  return (
    <div className="vo-fields">
      <div className="vo-grid">
        <div className="field">
          <label htmlFor="vo-fish-voice">Voice</label>
          <div className="vo-pickrow">
            <Picker
              id="vo-fish-voice"
              value={value.voiceId}
              options={opts}
              onChange={(id) => onChange({ voiceId: id, voiceName: voices?.find((v) => v.id === id)?.name ?? value.voiceName ?? "" })}
              menuWidth={380}
              placeholder={err ? "Voices could not load" : "Loading voices…"}
              disabled={!opts.length}
              search={opts.length > 6}
            />
            <SampleButton
              s={sample}
              id={value.voiceId}
              title={
                listed?.preview
                  ? "Hear Fish Audio's sample of this voice"
                  : "Hear it read one sentence (a fraction of a cent of your credit)"
              }
              onPlay={() => sample.play(`fish:${value.voiceId}`, { provider: "fish", voiceId: value.voiceId, fish: value, language: code })}
            />
          </div>
          <span className="help vo-voices-help">
            {listed?.hint ? (
              <span className="ellipsis" title={listed.hint}>
                {listed.hint}
              </span>
            ) : (
              <span>
                {voices ? `${voices.filter((v) => v.own).length} of your own, ${voices.filter((v) => !v.own).length} popular` : ""}
              </span>
            )}
            <button type="button" className="text-btn" onClick={() => setPasteOpen(!pasteOpen)}>
              Paste a voice link
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={() => load(true)}
              disabled={loading}
              title="Load the list again (a voice you just cloned on fish.audio)"
            >
              {loading ? "Loading…" : "Refresh list"}
            </button>
          </span>
          {pasteOpen && (
            <div className="vo-pickrow vo-fish-paste">
              <input
                className="input"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && usePaste()}
                placeholder="https://fish.audio/m/… (any voice in Fish Audio's library)"
                spellCheck={false}
                autoFocus
              />
              <button className="btn small" onClick={usePaste} disabled={!fishIdOf(paste)}>
                Use it
              </button>
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="vo-fish-model">Model</label>
          <Picker
            id="vo-fish-model"
            value={value.model}
            options={mOpts}
            onChange={(id) => onChange({ model: id })}
            menuWidth={340}
            placeholder="Loading models…"
            disabled={!models?.length}
          />
          <span className="help">
            {models?.find((m) => m.id === value.model)?.hint ?? ""}
            {code !== "en" ? ` · Reads ${L.name} from the text itself.` : ""}
          </span>
        </div>
      </div>
      {err && (
        <div className="hint bad vo-hint">
          <TriangleAlertIcon size={18} />
          <div>
            <b>
              {/did not accept/.test(err)
                ? "Fish Audio did not accept your key"
                : /Could not reach/.test(err)
                  ? "Fish Audio could not be reached"
                  : "Your voices could not load"}
            </b>
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
      <div className="field vo-fish-speed">
        <span className="label">
          {"Speed "}
          <span className="dim">{Math.round(value.speed * 100)}%</span>
        </span>
        <input
          className="range vo-range"
          type="range"
          min={0.7}
          max={1.5}
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
export const fishOf = (c, per) => {
  const m = { voiceId: null, voiceName: null, model: "s2.1-pro", speed: 1, ...(c ?? {}), ...(per ?? {}) };
  return { voiceId: m.voiceId ?? "", voiceName: m.voiceName ?? "", model: m.model || "s2.1-pro", speed: +m.speed || 1 };
};
