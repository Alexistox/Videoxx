import { useEffect, useRef, useState } from "react";
import { AudioLinesIcon, CpuIcon, FishIcon, MicIcon, SparklesIcon, TrashIcon } from "lucide-react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Spinner, Toggle } from "../components/ui";
import { Picker } from "../components/Picker";
import { aLang, lang } from "../settings/languages";
import { LanguagePicker } from "../settings/LanguagePicker";
import { KeyDialog } from "../thumbnails/KeyDialog";
import { KOKORO_LANGS, accountLine, cleanSettings, useElevenAccount, useVoiceStatus } from "./useVoiceStatus";
import { ElevenFields } from "./ElevenFields";
import { FishFields, fishOf } from "./FishFields";
import { KokoroInstallCard } from "./KokoroInstallCard";
import { KokoroFields } from "./KokoroFields";

const OPENS_ON = [
  { value: "auto", label: "Automatic", icon: <AudioLinesIcon size={13} strokeWidth={1.8} /> },
  { value: "file", label: "My recording", icon: <MicIcon size={13} strokeWidth={1.8} /> },
  { value: "elevenlabs", label: "ElevenLabs", icon: <SparklesIcon size={13} strokeWidth={1.8} /> },
  { value: "fish", label: "Fish Audio", icon: <FishIcon size={13} strokeWidth={1.8} /> },
  { value: "kokoro", label: "Local voice", icon: <CpuIcon size={13} strokeWidth={1.8} /> },
];
const mergePatch = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? mergePatch(a[k], v) : v;
  return out;
};
export function VoiceSettingsSection() {
  const { toast } = useApp();
  const [vs, reload] = useVoiceStatus(),
    [keyOpen, setKeyOpen] = useState(false),
    [fishKeyOpen, setFishKeyOpen] = useState(false);
  const [acct, loadAcct] = useElevenAccount(!!vs?.elevenlabs.hasKey);
  const [fish, setFish] = useState(null),
    [fishCredit, setFishCredit] = useState(null);
  useEffect(() => {
    if (vs?.fish.hasKey)
      api
        .fishCredit(true)
        .then(setFishCredit)
        .catch(() => setFishCredit(null));
    else setFishCredit(null);
  }, [vs?.fish.hasKey, vs?.fish.hint]);
  const [eleven, setEleven] = useState(null),
    [kokoro, setKokoro] = useState(null);
  const [langs, setLangs] = useState(null);
  useEffect(() => {
    api
      .speechState()
      .then((s) => setLangs({ multi: s.mode === "multi", language: s.language }))
      .catch(() => setLangs({ multi: false, language: "en" }));
    return on("speech:state", (s) =>
      setLangs((l) =>
        l?.multi === (s.mode === "multi") && l.language === s.language ? l : { multi: s.mode === "multi", language: s.language },
      ),
    );
  }, []);
  const [forLang, setForLang] = useState(null);
  const code = !langs ? null : !langs.multi ? "en" : (forLang ?? langs.language);
  const [filled, setFilled] = useState(null);
  const fill = (v, c) => {
    const per = c !== "en" ? v.config.langs?.[c] : null;
    setEleven(cleanSettings({ ...v.config.elevenlabs, ...(per?.elevenlabs ?? {}) }));
    setKokoro({ ...v.config.kokoro, ...(per?.kokoro ?? {}) });
    setFish(fishOf(v.config.fish, per?.fish));
    setFilled(c);
  };
  const timer = useRef(0),
    pending = useRef({});
  const flush = () => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = {};
    if (Object.keys(p).length) return api.setConfig({ voice: p });
    return Promise.resolve(null);
  };
  const save = (patch, quiet = true) => {
    pending.current = mergePatch(pending.current, !code || code === "en" ? patch : { langs: { [code]: patch } });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () =>
        flush()
          .then(() => !quiet && toast("Saved."))
          .catch((e) => toast(e.message, "bad")),
      400,
    );
  };
  useEffect(
    () => () => {
      flush().catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (!code) return;
    let dead = false;
    (async () => {
      try {
        await flush();
      } catch {}
      const v = await reload();
      if (!dead && v) fill(v, code);
    })();
    return () => {
      dead = true;
    };
  }, [code]);
  if (!vs || !eleven || !kokoro || !fish || !code)
    return (
      <section className="panel" style={{ marginTop: 25 }} aria-label="Voiceover">
        <div className="settings-row">
          <div className="l">
            <h3>Voiceover</h3>
          </div>
          <div className="r">
            <Spinner />
          </div>
        </div>
      </section>
    );
  const k = vs.kokoro,
    L = lang(code),
    kSpeaks = !!L.kokoro;
  const remove = () =>
    toast(`Remove the local voice from this computer? Getting it back is a ${k.sizeMB} MB download.`, "info", {
      label: "Remove",
      run: async () => {
        try {
          await api.kokoroRemove();
          toast("The local voice was removed from this computer.");
        } catch (e) {
          toast(e.message, "bad");
        } finally {
          reload();
        }
      },
    });
  return (
    <section className="panel" style={{ marginTop: 25 }} aria-label="Voiceover">
      <div className="settings-row">
        <div className="l">
          <h3>Voiceover</h3>
          <p>
            Make the narration in the app from your script: with your ElevenLabs or Fish Audio voices, or with a free voice that runs on
            this computer. Or use your own recording(s). The Voiceover step in the editor opens it.
          </p>
        </div>
        <div className="r">
          <div className="opt">
            <span>
              The Voiceover dialog opens on
              <small>
                Automatic: ElevenLabs once it has a key, else Fish Audio once it has one, else the local voice once it is installed, else
                your recording.
              </small>
            </span>
            <div className="lg-default">
              <Picker
                id="vo-opens"
                className="lg-compact"
                ariaLabel="Voiceover opens on"
                value={vs.config.provider}
                options={OPENS_ON}
                onChange={(v) =>
                  api
                    .setConfig({ voice: { provider: v } })
                    .then(() => {
                      reload();
                      toast("Saved.");
                    })
                    .catch((err) => toast(err.message, "bad"))
                }
              />
            </div>
          </div>
          <div className="opt">
            <span>
              Clean the audio and time the words right after
              <small>Needed before Claude builds the scenes. Switch off to check the voiceover first.</small>
            </span>
            <Toggle
              label="Clean and time after a voiceover"
              on={vs.config.autoTime !== false}
              onChange={(v) =>
                api.setConfig({ voice: { autoTime: v } }).then(() => {
                  reload();
                  toast("Saved.");
                })
              }
            />
          </div>
          {langs?.multi && (
            <div className="opt">
              <span>
                Default voices for
                <small>
                  {"Each language keeps its own: the Voiceover window of "}
                  {aLang(L.code)}
                  {" video opens on these (and remembers the last ones you used)."}
                </small>
              </span>
              <div className="lg-default">
                <LanguagePicker
                  id="vo-deflang"
                  className="lg-compact"
                  ariaLabel="Default voices for videos in"
                  value={code}
                  onChange={setForLang}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="settings-row">
        <div className="l">
          <h3>ElevenLabs</h3>
          <p>
            Your own account: its voices (also the ones you cloned or designed) and its characters. The key is stored encrypted on this
            computer and only used by the app.
          </p>
        </div>
        <div className="r">
          <div className="opt">
            <span>
              ElevenLabs API key
              <small>
                {vs.elevenlabs.hasKey ? `Saved, ends in …${vs.elevenlabs.hint}${acct ? ` · ${accountLine(acct)}` : ""}` : "Not added yet"}
              </small>
            </span>
            <button className="btn small" onClick={() => setKeyOpen(true)}>
              {vs.elevenlabs.hasKey ? "Change" : "Add key"}
            </button>
          </div>
          {vs.elevenlabs.hasKey && (
            <>
              <span className="small dim">
                {langs?.multi
                  ? `Your default voice and model for ${L.name} videos (the window remembers the last ones you used for ${L.name}):`
                  : "Your default voice and model (the dialog remembers the last ones you used):"}
              </span>
              {filled !== code ? (
                <Spinner size={14} />
              ) : (
                <ElevenFields
                  key={code}
                  value={eleven}
                  language={code}
                  onChange={(p) =>
                    setEleven((e) => {
                      const n = { ...e, ...p };
                      save({ elevenlabs: { ...n, voiceName: n.voiceName || null } });
                      return n;
                    })
                  }
                  onKey={() => setKeyOpen(true)}
                  keyHint={vs.elevenlabs.hint}
                />
              )}
            </>
          )}
        </div>
      </div>
      <div className="settings-row">
        <div className="l">
          <h3>Fish Audio</h3>
          <p>
            Your own account: natural voices in 80+ languages (your clones too), on its API credit, about $15 per million characters. The
            key is stored encrypted on this computer and only used by the app.
          </p>
        </div>
        <div className="r">
          <div className="opt">
            <span>
              Fish Audio API key
              <small>
                {vs.fish.hasKey
                  ? `Saved, ends in …${vs.fish.hint}${fishCredit != null ? ` · $${fishCredit.toFixed(2)} API credit left` : ""}`
                  : "Not added yet"}
              </small>
            </span>
            <button className="btn small" onClick={() => setFishKeyOpen(true)}>
              {vs.fish.hasKey ? "Change" : "Add key"}
            </button>
          </div>
          {vs.fish.hasKey && (
            <>
              <span className="small dim">
                {langs?.multi
                  ? `Your default Fish Audio voice for ${L.name} videos:`
                  : "Your default voice and model (the dialog remembers the last ones you used):"}
              </span>
              {filled !== code ? (
                <Spinner size={14} />
              ) : (
                <FishFields
                  key={code}
                  value={fish}
                  language={code}
                  onChange={(p) =>
                    setFish((f) => {
                      const n = { ...f, ...p };
                      save({ fish: { ...n, voiceId: n.voiceId || null, voiceName: n.voiceName || null } });
                      return n;
                    })
                  }
                  onKey={() => setFishKeyOpen(true)}
                  keyHint={vs.fish.hint}
                />
              )}
            </>
          )}
        </div>
      </div>
      <div className="settings-row">
        <div className="l">
          <h3>Local voice</h3>
          <p>
            {"Kokoro 82M: a free voice that runs on this computer, offline. "}
            {KOKORO_LANGS}.
          </p>
        </div>
        <div className="r">
          {k.installed ? (
            <>
              <div className="opt">
                <span>
                  Installed
                  <small>
                    {k.voices}
                    {" voices"}
                    {k.where === "shared" ? " · using the copy HyperFrames already downloaded" : ` · ${k.sizeMB} MB`}
                    {k.rtf ? ` · makes about ${k.rtf}× faster than real time here` : ""}
                  </small>
                </span>
                {k.where === "app" && (
                  <button className="btn small" onClick={remove}>
                    <TrashIcon size={14} />
                    Remove
                  </button>
                )}
              </div>
              {filled !== code ? (
                <Spinner size={14} />
              ) : kSpeaks ? (
                <KokoroFields
                  key={code}
                  value={kokoro}
                  language={code}
                  onChange={(p) =>
                    setKokoro((x) => {
                      const n = { ...x, ...p };
                      save({ kokoro: n });
                      return n;
                    })
                  }
                />
              ) : (
                <p className="small vo-note">
                  {"The local voice doesn't speak "}
                  {L.name}
                  {": "}
                  {L.name}
                  {" videos use your ElevenLabs or Fish Audio voices, or your own recording."}
                </p>
              )}
            </>
          ) : (
            <KokoroInstallCard k={k} compact={false} />
          )}
        </div>
      </div>
      {keyOpen && (
        <KeyDialog
          provider="elevenlabs"
          hf={vs.elevenlabs}
          onClose={() => setKeyOpen(false)}
          onSaved={() => {
            reload();
            loadAcct(true);
          }}
        />
      )}
      {fishKeyOpen && <KeyDialog provider="fish" hf={vs.fish} onClose={() => setFishKeyOpen(false)} onSaved={() => reload()} />}
    </section>
  );
}
