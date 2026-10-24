import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { isMac } from "../help/keys";
import { Spinner, Toggle } from "../components/ui";
import { Segmented } from "../components/Picker";
import { LANGUAGES, lang, styleCoverage } from "./languages";
import { LanguagePicker } from "./LanguagePicker";

export const Dot = ({ ok, warn }) => <span className={`dot ${ok ? "ok" : warn ? "warn" : "bad"}`} />;
const ago = (iso) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - +new Date(iso)) / 6e4);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
export function updateLine(u) {
  if (!u) return [false, true, "Checking…"];
  switch (u.state) {
    case "off":
      return [false, true, `Automatic updates are off: ${u.reason}.`];
    case "idle":
    case "checking":
      return [true, false, "Checking for updates…"];
    case "none":
      return [true, false, `Up to date · checked ${ago(u.checkedAt)}`];
    case "downloading":
      return [true, true, `Downloading ${u.version}… ${u.percent}%`];
    case "ready":
      return [
        true,
        false,
        u.download && u.viaLauncher
          ? `Version ${u.version} is out. Install now: Videoxx closes, the Videoxx Launcher installs it and opens it again.`
          : u.download
            ? `Version ${u.version} is out. Download it and drag it into Applications (replace the old one).`
            : `Version ${u.version} is ready. It installs when you close the app.`,
      ];
    case "error":
      return [false, true, u.message];
  }
}
export const Hint = ({ cmd, shell }) => {
  const { toast } = useApp();
  if (!cmd) return null;
  return (
    <button
      className="btn tiny"
      title={cmd}
      onClick={async () => {
        await api.copy(cmd);
        toast(`Install command copied. Run it in ${shell || "a terminal"}, then Run checks.`);
      }}
    >
      Copy install command
    </button>
  );
};
export function useSpeech() {
  const [sp, setSp] = useState(null);
  useEffect(() => {
    api
      .speechState()
      .then(setSp)
      .catch(() => {});
    return on("speech:state", setSp);
  }, []);
  return sp;
}
const busy = (sp) => sp?.status === "running" || sp?.status === "verifying";
export function GraphicsRow() {
  const [g, setG] = useState(null);
  useEffect(() => {
    api
      .graphicsState()
      .then(setG)
      .catch(() => {});
  }, []);
  if (!g) return null;
  const set = async (mode) => {
    if (mode === g.mode) return;
    setG(await api.setGraphics(mode));
    window.dispatchEvent(new Event("cz-graphics"));
  };
  const running =
    g.active === "software"
      ? "Running in software graphics: previews and exports are drawn by the processor, so they are slower."
      : g.webgl && /^disabled|unavailable/.test(g.webgl)
        ? "Running on the graphics card, but it gives no 3D (WebGL)."
        : g.active === "safe"
          ? "Running in Safe display: 3D on the graphics card, the window shown in software."
          : "Running on the graphics card.";
  const faster = g.safeAvailable ? "Safe display" : "the graphics card";
  const why = g.climbing
    ? ` Trying ${faster} after the update: if the window stays dark, the app goes back to software by itself.`
    : g.by === "launcher" && g.mode !== "auto"
      ? ` The Videoxx launcher picked ${g.mode === "safe" ? "Safe display" : "software"} because the window stayed dark or empty.`
      : !g.auto || g.mode === "auto"
        ? ""
        : g.why === "blank"
          ? ` The app switched to ${g.mode === "safe" ? "Safe display" : "software"} by itself because its window stayed dark or empty on the screen.`
          : " The app switched to software by itself because the graphics card could not start the 3D preview.";
  const keep = async (v) => setG(await api.setGraphicsKeep(v));
  const options = [
    { value: "auto", label: "Automatic", hint: "The graphics card (fastest)" },
    ...(g.safeAvailable ? [{ value: "safe", label: "Safe display", hint: "For a dark window, 3D stays fast" }] : []),
    { value: "software", label: "Software", hint: "Slower, works on unsupported graphics" },
  ];
  const target = g.mode === "software" ? "software graphics" : g.mode === "safe" ? "Safe display" : "the graphics card";
  return (
    <div className="settings-row" data-setting="graphics">
      <div className="l">
        <h3>Graphics</h3>
        <p>
          How the preview and your videos are drawn.
          {g.safeAvailable ? " Pick Safe display if the app window stays dark or empty: 3D still runs on your graphics card." : ""}
          {" Pick Software if the preview says it can't create WebGL, or stays black: slower, but works on graphics the app can't use"}
          {isMac ? " (like an older Mac with OpenCore Legacy Patcher)" : " (like an old or broken graphics driver)"}.
        </p>
      </div>
      <div className="r">
        <Segmented
          id="gfx-mode"
          ariaLabel="Graphics"
          value={g.forced ? g.active : g.mode}
          onChange={set}
          disabled={g.forced}
          options={options}
        />
        <span className="help">
          {running}
          {why}
          {g.forced ? " Set for this start by CZ_GRAPHICS." : ""}
        </span>
        {g.mode !== "auto" && !g.forced && !g.climbing && (
          <div className="row">
            <span className="help grow">
              Updated your graphics driver? Try the graphics card again (if the window goes dark, the app asks and comes back here).
            </span>
            <button className="btn small" data-gfx-retry onClick={() => set("auto")}>
              Try the graphics card again
            </button>
          </div>
        )}
        {g.mode === "software" && !g.forced && (
          <div className="row" data-gfx-keep>
            <span className="help grow">
              {"Keep software graphics after updates. Off: after each update the app tries "}
              {faster}
              {" once and comes back to software by itself if the window stays dark."}
            </span>
            <Toggle label="Keep software graphics after updates" on={g.keep} onChange={keep} />
          </div>
        )}
        {g.restartNeeded && (
          <div className="row">
            <span className="help warn grow">
              {"Restart the app to use "}
              {target}.
            </span>
            <button className="btn small primary" onClick={() => api.graphicsRestart()}>
              <RefreshCwIcon size={14} />
              Restart now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
export function SpeechRow({ signedIn, mode = "english" }) {
  const sp = useSpeech(),
    { toast } = useApp(),
    [open, setOpen] = useState(false),
    [size, setSize] = useState("base");
  const label = mode === "multi" ? "Transcription, other languages" : "Transcription";
  if (!sp)
    return mode === "multi" ? null : (
      <>
        <span data-setting="transcription">{label}</span>
        <span className="row">
          <Spinner size={12} />
        </span>
      </>
    );
  const miss = sp.uncovered ?? [];
  if (mode === "multi" && sp.mode !== "multi" && !(busy(sp) && sp.job === "multi") && !miss.length) return null;
  const start = async () => {
    setOpen(true);
    const s2 = await api.speechSetup(mode);
    if (s2.status === "failed") toast(s2.error || "Could not start.", "bad");
  };
  const whisper = async () => {
    setOpen(true);
    const s2 = await api.speechStableTs(mode, size);
    if (s2.status === "failed") toast(s2.error || "Could not start.", "bad");
  };
  const s = mode === "multi" ? sp.multi : sp.setup,
    mine = sp.job === mode || (!sp.job && mode === "english"),
    L = lang(sp.language);
  const own = sp.own && mode === "english",
    ownMulti = sp.own && mode === "multi",
    ownCovers = ownMulti && L.v3 && !miss.length;
  const missNames =
    miss.length <= 2
      ? miss.map((c) => lang(c).name).join(" and ")
      : `${miss
          .slice(0, 2)
          .map((c) => lang(c).name)
          .join(", ")} and ${miss.length - 2} more`;
  const them = miss.length === 1 ? lang(miss[0]).name : "them";
  const setupBtn = (title) => (
    <button className="btn tiny primary" onClick={start} disabled={!signedIn || busy(sp)} title={signedIn ? title : "Connect Claude first"}>
      {sp.status === "failed" && mine ? "Try again" : "Set up with Claude"}
    </button>
  );
  const msg = (icon, t) => (
    <span className="sp-msg">
      {icon}
      {t}
    </span>
  );
  return (
    <>
      <span data-setting={mode === "english" ? "transcription" : void 0}>{label}</span>
      <span className={`row speech-row ${mode === "multi" ? "multi" : ""}`}>
        {busy(sp) && mine ? (
          <>
            {msg(
              <Spinner size={12} />,
              sp.status === "verifying"
                ? `Testing it on spoken samples…`
                : sp.how === "stable-ts"
                  ? "Installing Whisper on the CPU (stable-ts): about 1 GB the first time…"
                  : mode === "multi"
                    ? "Claude is picking and installing the best speech model for several languages…"
                    : "Claude is picking and installing the best speech model for this computer…",
            )}
            <button className="btn tiny" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide" : "Show"}
              {" progress"}
            </button>
            <button className="btn tiny" onClick={() => api.speechCancel()}>
              Stop
            </button>
          </>
        ) : own ? (
          <>{msg(<Dot ok />, "Parakeet (your own install)")}</>
        ) : ownCovers ? (
          <>
            {msg(
              <Dot ok />,
              `Parakeet v3 (your own install): ${L.code === "en" ? `${V3_OTHERS} languages` : `${L.name} and ${V3_OTHERS - 1} more languages`}${s ? ` · ${s.model} for the others` : ""}`,
            )}
          </>
        ) : ownMulti && !miss.length && s?.languages?.includes(L.code) ? (
          <>
            {msg(<Dot ok />, `Parakeet v3 (your own install): ${V3_OTHERS} languages · ${s.model} for ${L.name} and the others`)}
            <button
              className="btn tiny"
              title="Claude checks for a better model for this computer and switches only if it passes the test"
              onClick={start}
              disabled={!signedIn || busy(sp)}
            >
              Redo with Claude
            </button>
          </>
        ) : ownMulti && s ? (
          <>
            {msg(
              <Dot ok={false} warn />,
              `Parakeet v3 (your own install): ${V3_OTHERS} languages · ${s.model}: ${s.languages?.length ?? 1} languages, not ${missNames}. Whisper does ${them} for now.`,
            )}
            <button
              className="btn tiny"
              title={`Your Claude looks for a model that also does ${missNames} and switches only if it passes the test (uses Claude)`}
              onClick={start}
              disabled={!signedIn || busy(sp)}
            >
              Redo with Claude
            </button>
          </>
        ) : s ? (
          <>
            {msg(
              mode === "multi" && miss.length ? <Dot ok={false} warn /> : <Dot ok />,
              `${s.model} on the ${s.device}${s.speed ? ` · ${Math.round(s.speed)}x real time` : ""}${mode === "multi" && s.languages ? ` · ${s.languages.length} languages` : ""}${mode === "multi" && miss.length ? `, not ${missNames}: Whisper does ${them} for now` : ""}`,
            )}
            <button
              className="btn tiny"
              title={
                mode === "multi" && miss.length
                  ? `Your Claude looks for a model that also does ${missNames} and switches only if it passes the test (uses Claude)`
                  : "Claude checks for a better model for this computer and switches only if it passes the test"
              }
              onClick={start}
              disabled={!signedIn || busy(sp)}
            >
              Redo with Claude
            </button>
          </>
        ) : mode === "english" && sp.multi?.languages?.includes("en") ? (
          <>
            {msg(<Dot ok />, `${sp.multi.model} (the setup for several languages does English too)`)}
            <button
              className="btn tiny"
              title="Claude installs a model made for English (usually a little more accurate for it)"
              onClick={start}
              disabled={!signedIn || busy(sp)}
            >
              Set up for English
            </button>
          </>
        ) : ownMulti ? (
          <>
            {msg(
              <Dot ok={false} warn />,
              `Parakeet v3 (your own install): ${V3_OTHERS} languages, not ${missNames}. ${sp.status === "failed" && mine ? `The setup for ${missNames} did not finish: ${(sp.error || "it stopped").replace(/\.$/, "")}.` : `Whisper does ${them} for now.`}`,
            )}
            {setupBtn(`Your Claude picks a local speech model for ${missNames} and the other languages and installs it`)}
          </>
        ) : sp.status === "failed" && mine ? (
          <>
            {msg(<Dot ok={false} />, sp.error)}
            {setupBtn(
              `Your Claude checks this computer, picks the best local speech model${mode === "multi" ? " for several languages" : ""} and installs it`,
            )}
          </>
        ) : (
          <>
            {msg(
              <Dot ok={false} warn />,
              mode === "multi"
                ? "Not set up yet: Whisper is used for other languages for now."
                : "Not set up yet: Whisper is used for now.",
            )}
            {setupBtn(
              `Your Claude checks this computer, picks the best local speech model${mode === "multi" ? " for several languages" : ""} and installs it`,
            )}
          </>
        )}
        {!own && !ownCovers && !(busy(sp) && mine) && !/stable-ts/.test(s?.model ?? "") && (
          <span className="row sp-whisper">
            <select
              className="input compact"
              aria-label="Whisper model"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              disabled={busy(sp)}
            >
              <option value="base">Base (fastest)</option>
              <option value="small">Small (more accurate)</option>
            </select>
            <button
              className="btn tiny"
              disabled={busy(sp)}
              onClick={whisper}
              title="The app installs OpenAI Whisper with stable-ts into its own folder (about 1 GB with PyTorch) and tests it on a spoken sample. Runs on any computer without a GPU, exact word timings, nothing leaves this computer. No Claude needed."
            >
              Whisper on the CPU
            </button>
          </span>
        )}
      </span>
      {s && !own && !ownCovers && !(busy(sp) && mine) && s.why && (
        <>
          <span />
          <span className="small">{s.why}</span>
        </>
      )}
      {open && mine && sp.log.length > 0 && (
        <>
          <span />
          <div className="log-box speech-log" style={{ maxHeight: 180 }}>
            {sp.log.slice(-60).join("\n")}
          </div>
        </>
      )}
    </>
  );
}
const V3_OTHERS = LANGUAGES.filter((l) => l.v3 && l.code !== "en").length;
export function LanguageSection({ signedIn }) {
  const sp = useSpeech(),
    { toast, brand } = useApp(),
    [saving, setSaving] = useState(false);
  if (!sp)
    return (
      <section className="panel" style={{ marginTop: 25 }} aria-label="Language">
        <div className="settings-row">
          <div className="l">
            <h3>Language</h3>
          </div>
          <div className="r">
            <Spinner />
          </div>
        </div>
      </section>
    );
  const multi = sp.mode === "multi",
    L = lang(sp.language),
    working = busy(sp) && sp.job === "multi",
    failed = sp.status === "failed" && sp.job === "multi";
  const set = async (p) => {
    setSaving(true);
    try {
      const s = await api.setLanguage(p);
      toast(
        busy(s) && s.job === "multi" && !busy(sp)
          ? "Saved. Claude is setting up transcription for several languages on this computer."
          : "Saved.",
      );
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setSaving(false);
    }
  };
  const start = async () => {
    const s = await api.speechSetup("multi");
    if (s.status === "failed") toast(s.error || "Could not start.", "bad");
  };
  const others = LANGUAGES.filter((l) => l.code !== "en"),
    named = ["es", "fr", "de", "pl"].map((c) => lang(c).name);
  const msg = (icon, t) => (
    <span className="lg-msg">
      {icon}
      {t}
    </span>
  );
  return (
    <section className="panel" style={{ marginTop: 25 }} aria-label="Language">
      <div className="settings-row">
        <div className="l">
          <h3>Language</h3>
          <p>
            {brand === "personal"
              ? "The language of your Faceless videos (switch to Faceless Brand to make them): Claude writes the script and the words on screen in it, the voices read it, and the app times its words."
              : "The language your videos are narrated in. Claude writes the script and the words on screen in it, the voices read it, and the app times its words."}
          </p>
        </div>
        <div className="r">
          {brand === "personal" && (
            <span className="help warn lg-personal">
              Personal Brand videos are edited in English: their footage is transcribed and cut as English speech, whatever you pick here.
            </span>
          )}
          <Segmented
            id="lg-mode"
            ariaLabel="My videos are in"
            className="lg-modes"
            value={sp.mode}
            onChange={(m) => m !== sp.mode && !saving && set({ mode: m })}
            options={[
              { value: "english", label: "English only" },
              { value: "multi", label: "Several languages" },
            ]}
          />
          {!multi ? (
            <span className="help">
              {"New videos are in English; a video made in another language keeps it. Pick Several languages to make videos in "}
              {named.slice(0, -1).join(", ")}
              {", "}
              {named.at(-1)}
              {" and "}
              {others.length - named.length}
              {" more."}
            </span>
          ) : (
            <>
              <div className="opt">
                <span>
                  New videos start in<small>Each video has its own: set it in New project or in the editor.</small>
                </span>
                <div className="lg-default">
                  <LanguagePicker id="lg-default" className="lg-compact" value={sp.language} onChange={(c) => set({ default: c })} />
                </div>
              </div>
              <div className={`lg-line ${failed && !working && !sp.transcribes ? "bad" : ""}`} role="status">
                {working ? (
                  <>
                    {msg(
                      <Spinner size={12} />,
                      sp.status === "verifying"
                        ? "Testing transcription on spoken samples…"
                        : "Claude is setting up transcription for several languages (System check shows its progress)…",
                    )}
                    <button className="btn tiny" onClick={() => api.speechCancel()}>
                      Stop
                    </button>
                  </>
                ) : sp.transcribes ? (
                  <>{msg(<Dot ok />, `${L.name} is transcribed with ${sp.transcribes.replace(/ in \w+$/, "")}.`)}</>
                ) : failed ? (
                  <>
                    {msg(
                      <Dot ok={false} />,
                      `The setup for several languages did not finish: ${(sp.error || "it stopped").replace(/\.$/, "")}. ${L.name} uses Whisper (slower) for now.`,
                    )}
                    <button
                      className="btn tiny primary"
                      onClick={start}
                      disabled={!signedIn}
                      title={
                        signedIn
                          ? "Your Claude picks the best local speech model for several languages and installs it"
                          : "Connect Claude first"
                      }
                    >
                      Try again
                    </button>
                  </>
                ) : sp.multi ? (
                  <>
                    {msg(
                      <Dot ok={false} warn />,
                      `${sp.multi.model} (the setup for several languages) doesn't do ${L.name}: Whisper is used for it (slower).`,
                    )}
                    <button
                      className="btn tiny"
                      onClick={start}
                      disabled={!signedIn || busy(sp)}
                      title={
                        signedIn
                          ? `Your Claude looks for a model that also does ${L.name} and switches only if it passes the test (uses Claude)`
                          : "Connect Claude first"
                      }
                    >
                      Redo with Claude
                    </button>
                  </>
                ) : (
                  <>
                    {msg(<Dot ok={false} warn />, `Nothing on this computer transcribes ${L.name} yet: Whisper is used (slower).`)}
                    <button
                      className="btn tiny primary"
                      onClick={start}
                      disabled={!signedIn || busy(sp)}
                      title={
                        signedIn
                          ? "Your Claude picks the best local speech model for several languages and installs it"
                          : "Connect Claude first"
                      }
                    >
                      Set up with Claude
                    </button>
                  </>
                )}
              </div>
              <span className="help">
                {LANGUAGES.length}
                {" languages. Each style writes the ones its fonts have letters for (of the "}
                {LANGUAGES.length}
                {": "}
                {styleCoverage()}; your own styles like Vox), and New project says which. Arabic and other right-to-left languages are not
                offered yet. System check (the System tab) shows the transcription for each.
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
