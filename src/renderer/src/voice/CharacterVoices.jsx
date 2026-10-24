import { useEffect, useState } from "react";
import { AudioLinesIcon } from "lucide-react";
import { api } from "../lib/api";
import { Picker } from "../components/Picker";
import { lang } from "../settings/languages";
import { SampleButton, useSample } from "./useSample";
import { fishIdOf, useFishNames } from "./FishFields";
import { kokoroSpeaks } from "./KokoroFields";

export function CharacterVoices({ provider, speakers, value, onChange, narrator, language, eleven, fish, kokoroSpeed }) {
  const L = lang(language);
  const [voices, setVoices] = useState(null),
    [paste, setPaste] = useState(null);
  const sample = useSample();
  useEffect(() => {
    let dead = false;
    setVoices(null);
    const list =
      provider === "elevenlabs"
        ? api
            .elevenVoices()
            .then((l) =>
              l.map((v) => ({ id: v.id, name: v.name, hint: v.hint || void 0, group: v.own ? "Your voices" : "ElevenLabs voices" })),
            )
        : provider === "fish"
          ? api
              .fishVoices(L.code)
              .then((l) =>
                l.map((v) => ({ id: v.id, name: v.name, hint: v.hint || void 0, group: v.own ? "Your voices" : "Popular on Fish Audio" })),
              )
          : provider === "kokoro"
            ? api
                .kokoroVoices()
                .then((l) =>
                  l
                    .filter((v) => kokoroSpeaks(v, L.code))
                    .map((v) => ({ id: v.id, name: v.name, hint: v.gender === "female" ? "Female" : "Male", group: v.language })),
                )
            : api.customVoices().then((l) => l.map((v) => ({ id: v.id, name: v.name, hint: v.language ? lang(v.language).name : void 0 })));
    list.then(
      (l) => {
        if (!dead) setVoices(l);
      },
      () => {
        if (!dead) setVoices([]);
      },
    );
    return () => {
      dead = true;
    };
  }, [provider, L.code]);
  const linked = useFishNames(
    provider === "fish" && voices
      ? Object.values(value)
          .filter((v) => v?.voiceId && !v.voiceName && !voices.some((x) => x.id === v.voiceId))
          .map((v) => v.voiceId)
      : [],
  );
  useEffect(() => {
    const named = Object.entries(value).filter(([, v]) => v?.voiceId && !v.voiceName && linked[v.voiceId]);
    if (named.length) onChange({ ...value, ...Object.fromEntries(named.map(([k, v]) => [k, { ...v, voiceName: linked[v.voiceId] }])) });
  }, [linked, value]);
  const set = (key, id, name = "") => {
    const n = { ...value };
    if (id) n[key] = { voiceId: id, ...(name ? { voiceName: name } : {}) };
    else delete n[key];
    onChange(n);
  };
  const opts = (key) => {
    const own = value[key],
      o = [
        {
          value: "",
          label: "Narrator's voice",
          hint: `${narrator.name ? `${narrator.name}: ` : ""}read as part of the narration`,
          icon: <AudioLinesIcon size={13} strokeWidth={1.8} />,
        },
        ...(voices ?? []).map((v) => ({
          value: v.id,
          label: v.name,
          hint: v.hint,
          group: v.group,
          icon: <span className="vo-initial">{v.name.slice(0, 1)}</span>,
          keywords: v.id,
        })),
      ];
    const ownName = own ? own.voiceName || linked[own.voiceId] || "" : "";
    if (own && voices && !voices.some((v) => v.id === own.voiceId))
      o.splice(1, 0, {
        value: own.voiceId,
        label: ownName || "Voice from a link",
        group: "Picked",
        icon: <span className="vo-initial">{(ownName || "V").slice(0, 1)}</span>,
      });
    return o;
  };
  const play = (key, id) => {
    const sid = `${provider}:${key}:${id}`;
    if (provider === "elevenlabs" && eleven)
      sample.play(sid, { provider, voiceId: id, eleven: { ...eleven, voiceId: id }, language: L.code });
    else if (provider === "fish" && fish) sample.play(sid, { provider, voiceId: id, fish: { ...fish, voiceId: id }, language: L.code });
    else if (provider === "kokoro") sample.play(sid, { provider, voiceId: id, speed: kokoroSpeed ?? 1 });
  };
  const usePaste = (key) => {
    const id = fishIdOf(paste?.text ?? "");
    if (!id) return;
    set(key, id, voices?.find((v) => v.id === id)?.name ?? "");
    setPaste(null);
  };
  return (
    <div
      className="vo-cast"
      style={{ marginTop: 16, padding: "12px 14px 14px", border: "1px solid #2f2f2f", borderRadius: 12, background: "#ffffff03" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <b style={{ fontSize: 13, fontWeight: 500 }}>Character voices</b>
        <span className="small dim">
          {speakers.length} {speakers.length === 1 ? "character speaks" : "characters speak"}
          {" in the script"}
        </span>
      </div>
      <p className="help" style={{ margin: "4px 0 12px" }}>
        A line that starts with a name in brackets, like [Mia] You did WHAT?, is spoken in that character's voice, levelled to the narrator.
        A character without a voice of their own is read by the narrator's voice. The picks are kept with this project.
      </p>
      <div className="vo-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {speakers.map((sp, i) => {
          const own = value[sp.key]?.voiceId ?? "",
            id = own || narrator.id;
          return (
            <div key={sp.key} className="field vo-cast-row" data-speaker={sp.key}>
              <label htmlFor={`vo-sp-${i}`}>
                {sp.name}{" "}
                <span className="dim">
                  {"· "}
                  {sp.lines}
                  {" line"}
                  {sp.lines === 1 ? "" : "s"}
                </span>
              </label>
              <div className="vo-pickrow">
                <Picker
                  id={`vo-sp-${i}`}
                  value={own}
                  options={opts(sp.key)}
                  onChange={(v) => set(sp.key, v, voices?.find((x) => x.id === v)?.name ?? "")}
                  menuWidth={360}
                  search={(voices?.length ?? 0) > 6}
                  placeholder="Loading voices…"
                />
                {provider !== "custom" && (
                  <SampleButton
                    s={sample}
                    id={id ? `${provider}:${sp.key}:${id}` : ""}
                    title={own ? `Hear ${sp.name}'s voice` : `Hear the narrator's voice (it reads ${sp.name}'s lines)`}
                    onPlay={() => play(sp.key, id)}
                  />
                )}
              </div>
              <span className="help vo-voices-help">
                <span className="ellipsis">
                  {own
                    ? (voices?.find((v) => v.id === own)?.hint ?? "")
                    : `Uses the narrator's voice${narrator.name ? ` (${narrator.name})` : ""}.`}
                </span>
                {provider === "fish" && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setPaste(paste?.key === sp.key ? null : { key: sp.key, text: "" })}
                  >
                    Paste a voice link
                  </button>
                )}
              </span>
              {paste?.key === sp.key && (
                <div className="vo-pickrow vo-fish-paste">
                  <input
                    className="input"
                    value={paste.text}
                    onChange={(e) => setPaste({ key: sp.key, text: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && usePaste(sp.key)}
                    placeholder="https://fish.audio/m/… (any voice in Fish Audio's library)"
                    spellCheck={false}
                    autoFocus
                    aria-label={`A Fish Audio voice link for ${sp.name}`}
                  />
                  <button className="btn small" onClick={() => usePaste(sp.key)} disabled={!fishIdOf(paste.text)}>
                    Use it
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
