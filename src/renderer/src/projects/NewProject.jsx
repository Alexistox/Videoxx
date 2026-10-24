import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLinesIcon,
  BookOpenTextIcon,
  BoxIcon,
  BoxesIcon,
  ChevronDownIcon,
  DicesIcon,
  FaceSlightlySmilingIcon,
  FileTextIcon,
  FolderOpenIcon,
  Gamepad2Icon,
  Grid3x3Icon,
  LightbulbIcon,
  NewspaperIcon,
  PackagePlusIcon,
  PersonStandingIcon,
  ShapesIcon,
  SparklesIcon,
  TimerIcon,
  UploadIcon,
  UserRoundIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import { api, isMyLook, isOwnStyle, offeredLook } from "../lib/api";
import { fmtLength, parseLength } from "../lib/format";
import { useApp } from "../state/AppProvider";
import { MOD, isMac } from "../help/keys";
import { Modal, Spinner, Toggle } from "../components/ui";
import { MenuList, Picker, Popover, Segmented } from "../components/Picker";
import { aLang, cantDrawWhy, charsetNote, lang, otherScriptLanguage, styleDraws, whoCanDraw, wordUnit } from "../settings/languages";
import { LanguagePicker } from "../settings/LanguagePicker";
import { PACE_DEFAULT, paceLine, speechPace } from "../settings/project/visualPace";
import { FIG_ROLES, roleFigure } from "../settings/project/figures";
import { FiguresPicker } from "../settings/project/FiguresPicker";
import { BrandColor, getAt, setAt } from "../settings/project/SettingsControls";
import { ProjectChoicesForm, choicesSummary, mergeChoices } from "../settings/project/ProjectChoicesForm";
import { ChannelField, startChannel, useChannelDefaults } from "../channels/ChannelEditor";
import { spokenScript } from "../script/scriptText";
import { lengthNote, scriptLength } from "../script/scriptLength";
import { ChannelLessons } from "../youtube/ChannelLessons";
import { isStandard, premiumMsg, usePlan } from "../state/usePlan";
import { LOOK_PREVIEW, STYLE_PREVIEW, STYLE_PREVIEW_TALL } from "../looks/stylePreviews";
import { isFormatTwin } from "../looks/lookFormat";
import { useStyleKit } from "../looks/StyleKit";
import { TOON_PICK_NONE, ToonCharacters, toonSettings } from "../looks/ToonCharacters";

const WPM = 150;
const LENGTHS = [
  ["Shorts", ["0:30", "0:45", "1:00"]],
  ["Videos", ["2:00", "3:00", "5:00", "8:00", "10:00"]],
  ["Long-form", ["12:00", "15:00", "20:00", "25:00", "30:00", "40:00", "45:00"]],
];
const FORMAT_KEY = "cz-np-format";
const usedFormats = () => {
  try {
    return JSON.parse(localStorage.getItem(FORMAT_KEY) || "{}") || {};
  } catch {
    return {};
  }
};
const lastFormat = (styleId) => usedFormats()[styleId];
const rememberFormat = (styleId, f) => {
  try {
    localStorage.setItem(FORMAT_KEY, JSON.stringify({ ...usedFormats(), [styleId]: f }));
  } catch {}
};
function StyleGlyph({ s }) {
  const base = isOwnStyle(s) ? "custom" : (s.base ?? s.id);
  const Icon =
    base === "pixel-art"
      ? Grid3x3Icon
      : base === "flat"
        ? ShapesIcon
        : base === "stickman"
          ? PersonStandingIcon
          : base === "recon"
            ? BoxIcon
            : base === "lowpoly"
              ? Gamepad2Icon
              : base === "toon"
                ? FaceSlightlySmilingIcon
                : base === "stickstory"
                  ? BookOpenTextIcon
                  : base === "custom" || base === "starter"
                    ? SparklesIcon
                    : NewspaperIcon;
  return (
    <span className={`np-glyph g-${base}`}>
      <Icon size={13} strokeWidth={2} />
    </span>
  );
}
export function LengthField({ value, onChange, wpm = WPM, unit = "words" }) {
  const wrap = useRef(null),
    input = useRef(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  const opts = useMemo(
    () =>
      LENGTHS.flatMap(([group, list]) =>
        list.map((v) => ({
          value: v,
          label: v,
          group,
          hint: `~${(Math.round((((parseLength(v) ?? 0) / 60) * wpm) / 5) * 5).toLocaleString()} ${unit}`,
        })),
      ),
    [wpm, unit],
  );
  const secs = parseLength(value),
    cur = opts.find((o) => parseLength(o.value) === secs),
    bad = !!value.trim() && !secs;
  const near = () =>
    secs ? opts.reduce((b, o, i) => (Math.abs(parseLength(o.value) - secs) < Math.abs(parseLength(opts[b].value) - secs) ? i : b), 0) : 3;
  const show = () => {
    setActive(near());
    setOpen(true);
  };
  const pick = (o) => {
    onChange(o.value);
    setOpen(false);
    input.current?.focus();
  };
  const move = (i) => setActive(Math.max(0, Math.min(opts.length - 1, i)));
  const keys = (e) => {
    const k = e.key;
    if (k === "ArrowDown") {
      e.preventDefault();
      open ? move(active + 1) : show();
    } else if (k === "ArrowUp") {
      e.preventDefault();
      open ? move(active - 1) : show();
    } else if (open && (k === "PageDown" || k === "PageUp")) {
      e.preventDefault();
      move(active + (k === "PageDown" ? 5 : -5));
    } else if (open && (k === "Home" || k === "End") && e.altKey) {
      e.preventDefault();
      move(k === "Home" ? 0 : opts.length - 1);
    } else if (k === "Enter" && open && active >= 0 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      pick(opts[active]);
    } else if (k === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (k === "Tab") setOpen(false);
  };
  return (
    <>
      <div
        ref={wrap}
        className={`np-len ${open ? "open" : ""} ${bad ? "bad" : ""}`}
        title={bad ? "Use minutes:seconds, e.g. 7:30" : void 0}
        onMouseDown={(e) => {
          if (e.target !== input.current) {
            e.preventDefault();
            input.current?.focus();
            open ? setOpen(false) : show();
          }
        }}
      >
        <TimerIcon size={14} strokeWidth={1.8} />
        <input
          ref={input}
          id="np-length"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(false);
          }}
          onKeyDown={keys}
          onMouseDown={() => !open && show()}
          onBlur={() => {
            if (secs) onChange(fmtLength(secs));
          }}
          placeholder="2:00"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls="np-length-list"
          aria-label="Length"
          aria-invalid={bad || void 0}
        />
        <ChevronDownIcon className="pk-chev" size={15} strokeWidth={1.8} />
      </div>
      <Popover anchor={wrap} open={open} onClose={() => setOpen(false)} width={230} className="pk-inline">
        <MenuList
          id="np-length-list"
          options={opts}
          active={active}
          value={cur?.value}
          onHover={(i) => i >= 0 && setActive(i)}
          onPick={pick}
        />
        <div className="pk-foot">Or type any length, e.g. 7:30</div>
      </Popover>
    </>
  );
}
function NpScriptSkill({ skill, setSkill, off, setOff }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false),
    [paste, setPaste] = useState(null);
  const run = async (f, ok) => {
    setBusy(true);
    try {
      const before = skill?.added,
        n = await f();
      setSkill(n);
      if (n.added !== before) {
        toast(ok);
        setOff(false);
        setPaste(null);
      }
    } catch (e) {
      toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad");
    } finally {
      setBusy(false);
    }
  };
  const has = !!skill?.has,
    verb = has ? "Replace with" : "Add";
  return (
    <div data-np-skill style={{ marginBottom: 10 }}>
      <div className="opt">
        <span>
          Your scripting skill
          <small>
            {!has
              ? "Add your own way of writing scripts (a .md or .txt file, a skill folder, or pasted text). It is kept in Settings > AI engines and used for every video from now on."
              : skill.on
                ? `"${skill.name}" (Settings > AI engines): Claude follows it when it writes this video's script.${off ? " Off for this video." : ""}`
                : "Your scripting skill is switched off in Settings > AI engines."}
          </small>
        </span>
        {has && (
          <Toggle label="Use my scripting skill for this video" on={skill.on && !off} disabled={!skill.on} onChange={(v) => setOff(!v)} />
        )}
      </div>
      <div className="row wrap" style={{ marginTop: 6 }}>
        <button
          type="button"
          className="btn small"
          disabled={busy}
          onClick={() => run(() => api.scriptSkillPick("file"), "Scripting skill saved. Claude follows it from now on.")}
        >
          {verb}
          {" a file"}
        </button>
        <button
          type="button"
          className="btn small"
          disabled={busy}
          onClick={() => run(() => api.scriptSkillPick("folder"), "Scripting skill saved. Claude follows it from now on.")}
        >
          <FolderOpenIcon size={14} />
          {verb}
          {" a folder"}
        </button>
        <button type="button" className="btn small" disabled={busy} onClick={() => setPaste(paste === null ? "" : null)}>
          Paste text
        </button>
      </div>
      {paste !== null && (
        <div style={{ marginTop: 8 }}>
          <textarea
            className="input"
            rows={5}
            aria-label="Scripting instructions"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste your scripting skill or instructions here (how you open, the tone, the structure, words to avoid...)"
            style={{ width: "100%", resize: "vertical" }}
          />
          <div className="row">
            <button
              type="button"
              className="btn small primary"
              disabled={busy || !paste.trim()}
              onClick={() => run(() => api.scriptSkillPaste(paste), "Scripting skill saved. Claude follows it from now on.")}
            >
              Save
            </button>
            <button type="button" className="btn small" onClick={() => setPaste(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function NewProject({ onClose }) {
  const { go, refreshProjects, toast, noticeImageKey, claude, newPrefill, channel, listChannel, page, channels } = useApp();
  const std = isStandard(usePlan());
  const prefill = useRef(newPrefill).current;
  const [chan, setChan] = useState(() => startChannel(prefill, { page, channel, listChannel }));
  const [name, setName] = useState(prefill?.name ?? "");
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("hibit");
  const [styles, setStyles] = useState([]);
  const [styleId, setStyleId] = useState(prefill?.styleId ?? "pixel-art");
  const [topic, setTopic] = useState(prefill?.topic?.trim() ?? "");
  const [length, setLength] = useState("2:00");
  const [multi, setMulti] = useState(false),
    [language, setLanguage] = useState("en");
  const [ownLang, setOwnLang] = useState(false),
    langOn = multi || ownLang;
  const [grp, setGrp] = useState(prefill?.styleId ? "custom" : "builtin"),
    grpTouched = useRef(!!prefill?.styleId);
  const lastBuiltin = useRef("pixel-art");
  const [keptPace, setKeptPace] = useState({});
  useEffect(() => {
    api.styles().then(setStyles);
    api.config().then((c) => {
      if (!chDefaults.lengthSet.current) setLength(fmtLength(c.video?.length ?? 120));
      if (c.language?.mode === "multi") {
        const code = lang(c.language.default).code;
        setMulti(true);
        setLanguage(code);
        setStyleId((s) => (s === "pixel-art" && !styleDraws("pixel-art", code) ? "flat" : s));
      }
      if (c.voice?.pace && typeof c.voice.pace === "object") setKeptPace(c.voice.pace);
      if (!grpTouched.current && c.ui?.npStyles === "custom") setGrp("custom");
    });
  }, []);
  const L = lang(langOn ? language : "en"),
    wpm = L.wpm;
  const [audio, setAudio] = useState(null);
  const [script, setScript] = useState("");
  const [source, setSource] = useState("topic");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.presets().then(setPresets);
  }, []);
  useEffect(() => {
    const st2 = styles.find((x) => x.id === styleId);
    if (st2 && presets.find((p) => p.id === presetId)?.style_id !== styleId) setPresetId(st2.defaultLook);
  }, [styleId, styles, presets]);
  const chDefaults = useChannelDefaults(chan, { styles, presets, styleId, presetId, length, setStyleId, setPresetId, setLength });
  const [over, setOver] = useState(false);
  const st = styles.find((x) => x.id === styleId);
  const mineList = styles.filter((s) => isOwnStyle(s) && !s.missing),
    noCustom = grp === "custom" && !!styles.length && !mineList.length;
  useEffect(() => {
    if (!st || st.missing) return;
    if (isOwnStyle(st)) setGrp("custom");
    else {
      lastBuiltin.current = st.id;
      setGrp("builtin");
    }
  }, [styleId]);
  useEffect(() => {
    if (!styles.length || grp !== "custom" || (st && isOwnStyle(st) && !st.missing)) return;
    const next = mineList.find((x) => x.id === prefill?.styleId) ?? mineList[0];
    if (next) setStyleId(next.id);
  }, [styles.length, grp]);
  const pickGroup = (g) => {
    if (g === grp) return;
    grpTouched.current = true;
    setGrp(g);
    api.setConfig({ ui: { npStyles: g } }).catch(() => {});
    if (g === "builtin" && st && isOwnStyle(st))
      setStyleId(langOn && !styleDraws(lastBuiltin.current, language) ? "flat" : lastBuiltin.current);
  };
  const kitBtns = useStyleKit();
  const formats = st?.controls.find((c) => c.path === "format")?.options ?? [],
    pickFormat = formats.length > 1;
  const defFormat = presets.find((p) => p.id === st?.defaultLook)?.settings?.format;
  const looks = presets
    .filter((p) => (p.style_id || "pixel-art") === styleId && offeredLook(st, p))
    .filter((p, _, mine) => !pickFormat || !isFormatTwin(p, mine, defFormat));
  const [format, setFormat] = useState("vertical");
  useEffect(() => {
    const f = lastFormat(styleId) ?? defFormat;
    if (f === "vertical" || f === "landscape") setFormat(f);
  }, [styleId, defFormat]);
  const flat = !!st && (st.id === "flat" || st.base === "flat"),
    base = st ? (st.custom ? "collage" : (st.base ?? st.id)) : null;
  const [chars, setChars] = useState([]);
  const [charPick, setCharPick] = useState("");
  const [charDesc, setCharDesc] = useState("");
  const [toonPick, setToonPick] = useState(TOON_PICK_NONE),
    [toonSaved, setToonSaved] = useState([]);
  useEffect(() => {
    if (flat && !chars.length)
      api
        .characters()
        .then((l) => {
          setChars(l);
          setCharPick((p) => p || (l.find((c) => c.default)?.id ?? "mo"));
        })
        .catch(() => {});
  }, [flat]);
  const takeAudio = (f) => {
    setAudio(f);
    if (!name)
      setName(
        f
          .split(/[\\/]/)
          .pop()
          .replace(/\.[^.]+$/, "")
          .replace(/[_-]+/g, " "),
      );
  };
  const pickAudio = async () => {
    const f = await api.pickFile("Choose the voiceover", [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "flac", "ogg"] }]);
    if (f) takeAudio(f);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (!/\.(wav|mp3|m4a|flac|ogg)$/i.test(f.name)) {
      toast("That is not an audio file.", "bad");
      return;
    }
    const p = window.suite.pathForFile(f);
    if (p) takeAudio(p);
  };
  const create = async () => {
    if (busy) return;
    if (noCustom) {
      toast("Pick a style first: import one, or switch to Built-in.", "info");
      return;
    }
    setBusy(true);
    try {
      const len2 = parseLength(length) ?? 120;
      if (flat && charPick === "__describe" && std) {
        toast(premiumMsg("Designing characters with Claude"), "bad");
        setBusy(false);
        return;
      }
      if (flat && charPick === "__describe" && charDesc.trim().length < 3) {
        toast("Describe the main character, or pick one.", "bad");
        setBusy(false);
        return;
      }
      if (flat && charPick === "__describe" && !claude?.loggedIn) {
        toast("Connect Claude first (Settings): Claude designs the character. Or pick one of your characters.", "bad");
        setBusy(false);
        return;
      }
      if (flat && !charPick) {
        toast("Your characters are still loading. Try again in a moment.", "info");
        setBusy(false);
        return;
      }
      const toonSet = base === "toon" ? toonSettings(toonPick, toonSaved) : null;
      const character = !flat
        ? void 0
        : charPick === "__none"
          ? { none: true }
          : charPick === "__random"
            ? { random: true }
            : charPick === "__describe"
              ? { describe: charDesc.trim() }
              : { id: charPick || null };
      if (langOn && !styleDraws(base, language)) {
        toast(`${st?.name ?? "This style"} can't write ${L.name}: ${cantDrawWhy(base, language)}. ${whoCanDraw(language)}`, "bad");
        setBusy(false);
        return;
      }
      const p = await api.createProject({
        name: name.trim() || topic.trim().slice(0, 60) || "Untitled video",
        presetId,
        styleId,
        audioPath: audio,
        script,
        brief,
        topic,
        length: len2,
        ...(base === "collage" ? { pace } : {}),
        ...(pickFormat ? { format } : {}),
        ...(character ? { character } : {}),
        ...(langOn ? { language } : {}),
        brand,
        ...(Object.keys(choices).length ? { choices } : {}),
        ...(realChanged || figs || toonSet
          ? { settings: { ...real, ...(figs ? { figures: figs } : {}), ...(toonSet ? { characters: toonSet } : {}) } }
          : {}),
        ...(skill?.has && skillOff ? { scriptSkill: false } : {}),
        channelId: channels.some((c) => c.id === chan) ? chan : null,
        ...(prefill?.ideaId ? { ideaId: prefill.ideaId } : {}),
      });
      if (pickFormat) rememberFormat(styleId, format);
      if (toonSet) for (const c of toonPick.own) api.toonCharSave({ id: c.id, look: c.look }).catch(() => {});
      api.setConfig({ ui: { npStyles: grp } }).catch(() => {});
      if (topic.trim() && !script.trim()) {
        try {
          sessionStorage.setItem("cz-write-script", p.id);
        } catch {}
      }
      const picked2 = styles.find((s) => s.id === styleId);
      if (picked2?.needsImageKey ?? (picked2?.base ?? styleId) === "collage")
        api
          .imagesStatus()
          .then((s) => {
            if (!s.active) noticeImageKey(`"${p.name}" is ready, but Claude will need to make its pictures.`);
          })
          .catch(() => {});
      await refreshProjects();
      onClose(true);
      toast(
        topic.trim() && !script.trim()
          ? `Created "${p.name}". Claude is researching and writing the script.`
          : `Created "${p.name}". Next: prepare the audio in the pipeline panel.`,
      );
      go("editor", p.id);
      if (p.characterError) toast(`The project uses your default character: the new one could not be started (${p.characterError})`, "bad");
      else if (character && "describe" in character)
        toast(
          "Claude is designing the main character in a character lab (Styles > Flat explainer > Characters). The build waits for it.",
          "info",
        );
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const preset = presets.find((p) => p.id === presetId);
  const [pace, setPace] = useState(PACE_DEFAULT);
  useEffect(() => {
    setPace(preset?.settings?.pace?.perMinute ?? PACE_DEFAULT);
  }, [presetId]);
  const [brand, setBrand] = useState(null);
  useEffect(() => {
    setBrand(preset?.settings?.brand?.color ?? null);
  }, [presetId]);
  const [advOpen, setAdvOpen] = useState(false),
    [choices, setChoices] = useState({}),
    [info, setInfo] = useState(null);
  const [skill, setSkill] = useState(null),
    [skillOff, setSkillOff] = useState(false);
  useEffect(() => {
    api
      .scriptSkillState()
      .then(setSkill)
      .catch(() => {});
  }, []);
  useEffect(() => {
    api
      .choiceDefaults()
      .then((d) => setInfo({ global: d.global, services: d.services, models: d.models, claude: d.claude }))
      .catch(() => {});
  }, []);
  const pickChoice = (patch) => setChoices((c) => mergeChoices(c, patch));
  const [real, setReal] = useState({});
  useEffect(() => setReal({}), [styleId]);
  const realMedia = {
    isOn: (p, def) => {
      const v = getAt(real, p) ?? getAt(preset?.settings ?? {}, p);
      return v === void 0 ? def : v !== false;
    },
    flip: (p, v) => setReal((r) => setAt(r, p, v)),
  };
  const [figs, setFigs] = useState(null),
    [figOpen, setFigOpen] = useState(false);
  useEffect(() => {
    setFigs(null);
    setFigOpen(false);
  }, [styleId]);
  const realChanged = Object.keys(real).length > 0,
    summary = [choicesSummary(choices, info), skillOff && skill?.on ? "Not my scripting skill" : ""].filter(Boolean).join(" · ");
  const styleOpts = useMemo(
    () =>
      (grp === "builtin"
        ? [
            // (hidden styles - the Studio's starter base - only with the dev switch CZ_SHOW_STARTER=1, which marks it devPick)
            ...styles
              .filter((s) => !isOwnStyle(s) && (!s.legacy || s.id === styleId) && (!s.hidden || s.devPick || s.id === styleId))
              .map((s) => ({ s, group: "Built-in" })),
          ]
        : [
            // the member's own: imported Style Kit packages, styles published from the old Style Studio and old lab styles (with
            // their preview video, poster and version)
            ...styles.filter((s) => isOwnStyle(s) && !s.missing).map((s) => ({ s, group: "Your styles" })),
          ]
      ).map(({ s, group }) => {
        const video = STYLE_PREVIEW[s.id] || s.preview || void 0;
        return {
          value: s.id,
          label: s.name,
          hint: s.tagline,
          group,
          icon: <StyleGlyph s={s} />,
          keywords: s.description,
          badge: s.mine && !s.custom && s.version ? `v${s.version}` : void 0,
          preview: video
            ? {
                video,
                poster: s.poster ?? void 0,
                tall: STYLE_PREVIEW_TALL.has(s.id) || (!!s.aspects?.length && s.aspects[0] === "9:16" && !s.aspects.includes("16:9")),
              }
            : s.poster
              ? { poster: s.poster }
              : null,
        };
      }),
    [styles, styleId, grp],
  );
  const lookOpts = useMemo(
    () =>
      looks.map((p) => ({
        value: p.id,
        label: p.name,
        hint: p.description ?? void 0,
        badge: isMyLook(p) ? "Yours" : void 0,
        preview:
          LOOK_PREVIEW[p.id] ??
          (st && isOwnStyle(st) && p.id === st.defaultLook && st.preview
            ? { video: st.preview, poster: st.poster ?? void 0 }
            : p.preview
              ? { poster: p.preview }
              : null),
      })),
    [presets, styleId, styles],
  );
  const ready = chars.filter((c) => c.status === "ready"),
    picked = ready.find((c) => c.id === charPick);
  const charOpts = useMemo(
    () =>
      !chars.length
        ? []
        : [
            ...ready.map((c) => ({
              value: c.id,
              label: c.name,
              hint: c.about,
              badge: c.default ? "Default" : void 0,
              group: "Your characters",
              icon: c.thumb ? <img src={c.thumb} alt="" /> : <UserRoundIcon size={15} strokeWidth={1.8} />,
              preview: c.thumb ? { poster: c.thumb, square: true } : null,
            })),
            {
              value: "__random",
              label: "A random new character",
              hint: "Made when the project is created and added to your characters",
              group: "Something new",
              icon: <DicesIcon size={15} strokeWidth={1.8} />,
            },
            {
              value: "__describe",
              label: "Describe a new character…",
              hint: "Claude (Opus) designs them in a character lab",
              badge: std ? "Premium" : void 0,
              group: "Something new",
              icon: <WandSparklesIcon size={15} strokeWidth={1.8} />,
            },
            {
              value: "__none",
              label: "No main character (decide later)",
              hint: "Each scene gets its own people and objects; turn one on later in Project settings",
              group: "Something new",
              icon: <UserRoundIcon size={15} strokeWidth={1.8} />,
            },
          ],
    [chars, std],
  );
  const charRow = charOpts.find((o) => o.value === charPick);
  const lookPicker = (
    <Picker
      id="np-preset"
      value={presetId}
      options={lookOpts}
      onChange={setPresetId}
      menuWidth={340}
      placeholder="Loading looks…"
      disabled={!lookOpts.length}
    />
  );
  const sp = speechPace(base),
    target = parseLength(length),
    targetWords = target ? Math.round((target / 60) * wpm * sp) : null;
  const other = useMemo(() => (script.trim() ? otherScriptLanguage(spokenScript(script, L.code), L.code) : null), [script, L.code]),
    SL = lang(other ?? L.code);
  const len = useMemo(() => scriptLength(script, SL.code, base, keptPace[base ?? ""]), [script, SL.code, base, keptPace]);
  const scriptWords = len.words,
    spoken = len.seconds,
    off = target && scriptWords > 20 ? spoken / target : 1;
  const cantDraw = langOn && !!base && !styleDraws(base, language),
    otherDrawn = !!other && styleDraws(base, other);
  const takeOther = () => {
    if (!other) return;
    setOwnLang(true);
    setLanguage(other);
  };
  const otherRef = useRef(null);
  useEffect(() => {
    if (other) otherRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [other]);
  const file = audio ? { base: audio.split(/[\\/]/).pop(), dir: audio.replace(/[\\/][^\\/]*$/, "") } : null;
  const shortcut = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      create();
    }
  };
  return (
    <Modal title="New project" onClose={() => onClose()} className="np-modal">
      <div className="modal-body" onKeyDown={shortcut}>
        <section className="np-sec">
          <header>
            <span className="np-idx">01</span>
            <h3>The video</h3>
          </header>
          <input
            id="np-name"
            className="np-title"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name your video"
            aria-label="Title"
            onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && !e.metaKey && create()}
            spellCheck={false}
          />
          <ChannelField
            id="np-channel"
            value={chan}
            onChange={setChan}
            note={chDefaults.from ? `Style, look and length follow your last project in ${chDefaults.from}.` : null}
          />
          <ChannelLessons channelId={chan} />
          <div className="field">
            <span className="label">
              {"Voiceover "}
              <span className="dim">· you can add it later</span>
            </span>
            {file ? (
              <div className="np-file">
                <span className="np-file-ico">
                  <AudioLinesIcon size={17} strokeWidth={1.8} />
                </span>
                <span className="np-file-txt">
                  <b className="ellipsis">{file.base}</b>
                  <small className="ellipsis path" title={audio}>
                    {file.dir}
                  </small>
                </span>
                <button className="btn tiny ghost" onClick={pickAudio}>
                  Replace
                </button>
                <button className="icon-btn sm" aria-label="Remove audio" onClick={() => setAudio(null)}>
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`np-drop ${over ? "over" : ""}`}
                onClick={pickAudio}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <span className="np-drop-ico">
                  {over ? <UploadIcon size={17} strokeWidth={1.8} /> : <AudioLinesIcon size={17} strokeWidth={1.8} />}
                </span>
                <span className="np-drop-txt">
                  <b>{over ? "Drop it" : "Choose audio file…"}</b>
                  <small>or drop it here · WAV, MP3, M4A, FLAC, OGG</small>
                </span>
              </button>
            )}
            <span className="help">Scenes are timed to the voiceover, so they're built once it's in.</span>
          </div>
        </section>
        <section className="np-sec">
          <header>
            <span className="np-idx">02</span>
            <h3>Look</h3>
          </header>
          <Segmented
            id="np-stylegroup"
            ariaLabel="Which styles"
            className="np-stylegroup"
            value={grp}
            onChange={pickGroup}
            options={[
              { value: "builtin", label: "Built-in" },
              { value: "custom", label: <>Custom styles{mineList.length ? <small>{mineList.length}</small> : null}</> },
            ]}
          />
          {noCustom ? (
            <div className="np-nocustom" role="note">
              <b>No custom styles yet</b>
              <span className="help">Build one in Claude Code with the Style Kit, then import it: it shows up here.</span>
              <div className="row wrap" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn small primary np-import"
                  disabled={kitBtns.picking}
                  onClick={() => kitBtns.importFrom("zip", () => onClose())}
                >
                  {kitBtns.picking ? <Spinner size={13} /> : <PackagePlusIcon size={14} />}Import style
                  {kitBtns.std && <span className="premium-pill">Premium</span>}
                </button>
                <button type="button" className="btn small np-getkit" disabled={kitBtns.kitBusy} onClick={kitBtns.getKit}>
                  {kitBtns.kitBusy ? <Spinner size={13} /> : <BoxesIcon size={14} />}
                  {kitBtns.kitBusy ? "Writing the kit…" : "Get the Style Kit"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="np-grid">
                <div className="field">
                  <label htmlFor="np-style">Style</label>
                  <Picker
                    id="np-style"
                    value={styleId}
                    options={styleOpts}
                    onChange={setStyleId}
                    menuWidth={340}
                    placeholder="Loading styles…"
                    disabled={!styles.length}
                  />
                </div>
                {pickFormat ? (
                  <div className="field">
                    <span className="label">Format</span>
                    <Segmented
                      id="np-format"
                      ariaLabel="Format"
                      value={format}
                      onChange={setFormat}
                      options={formats.map((o) => {
                        const [, label, ratio] = /^(.*?)\s*(\d+:\d+)?$/.exec(o.label);
                        return {
                          value: String(o.value),
                          label,
                          hint: ratio,
                          icon: <i className={`np-ar ${o.value === "landscape" ? "wide" : "tall"}`} />,
                        };
                      })}
                    />
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="np-preset">Look</label>
                    {lookPicker}
                  </div>
                )}
                <div className="field">
                  <label htmlFor="np-length">Length</label>
                  <LengthField value={length} onChange={setLength} wpm={Math.round(wpm * sp)} unit={wordUnit(L.code)} />
                </div>
              </div>
              {pickFormat && lookOpts.length > 1 && (
                <div className="field np-lookfield">
                  <label htmlFor="np-preset">Look</label>
                  {lookPicker}
                </div>
              )}
              {preset && (
                <p className="np-note">
                  {pickFormat
                    ? `${format === "landscape" ? "1920×1080 for YouTube and the web" : "1080×1920 for Shorts, Reels and TikTok"}. ${preset.description}`
                    : preset.description}
                </p>
              )}
              {base === "collage" && (
                <div className="field np-pacefield">
                  <label htmlFor="np-pace">
                    {"Pictures per minute "}
                    <span className="dim">
                      {pace}
                      {" (one every "}
                      {Math.round(60 / pace)}
                      {" s)"}
                    </span>
                  </label>
                  <input
                    id="np-pace"
                    className="range"
                    type="range"
                    min={4}
                    max={30}
                    step={1}
                    value={pace}
                    onChange={(e) => setPace(+e.target.value)}
                  />
                  <span className="help">
                    {"How busy the video is: "}
                    {paceLine(parseLength(length) ?? 120, pace)}. Longer videos get more pictures, so they stay lively. You can change it
                    later in the Look.
                  </span>
                </div>
              )}
              {st && (
                <div className="field np-brandfield">
                  <label htmlFor="np-brand">
                    {"Brand colour "}
                    <span className="dim">{brand ? brand : "style default"}</span>
                  </label>
                  <BrandColor id="np-brand" value={brand} onChange={setBrand} />
                  <span className="help">
                    {st.controls.find((c) => c.path === "brand.color")?.help ?? "Your channel's colour for the style's accents."}
                    {" You can change it later in the Look."}
                  </span>
                </div>
              )}
              {langOn && (
                <div className="field np-langfield">
                  <label htmlFor="np-lang">Language</label>
                  <LanguagePicker id="np-lang" value={language} onChange={setLanguage} base={base} />
                  <span className={`help ${cantDraw ? "warn" : ""}`}>
                    {cantDraw
                      ? `${st?.name} can't write ${L.name}: ${cantDrawWhy(base, language)}. ${whoCanDraw(language)}`
                      : `The script, the voice and the words on screen are in ${L.name}. ${charsetNote(base)}`}
                  </span>
                </div>
              )}
              {base === "recon" && (
                <div className="field np-figfield">
                  <span className="label">
                    {"Characters "}
                    <span className="dim">{figs ? "chosen" : "automatic"}</span>
                  </span>
                  {!figOpen ? (
                    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                      <span className="help" style={{ margin: 0 }}>
                        {FIG_ROLES.slice(0, 4)
                          .map((r) => {
                            const e = roleFigure(figs, r.id);
                            return `${r.label}: ${e.body}, ${e.finish}`;
                          })
                          .join(" · ")}
                      </span>
                      <button type="button" id="np-figs" className="btn small" onClick={() => setFigOpen(true)}>
                        Choose characters…
                      </button>
                    </div>
                  ) : (
                    <FiguresPicker value={figs} theme={preset?.settings?.theme} onChange={setFigs} />
                  )}
                  <span className="help">
                    Faceless mannequins, male or female, each role in its own finish and colour. Scenes name the role, so you can change the
                    whole cast later in the Look.
                  </span>
                </div>
              )}
              {flat && (
                <div className="field np-charfield">
                  <label htmlFor="np-char">Main character</label>
                  <Picker
                    id="np-char"
                    size="lg"
                    value={charPick}
                    options={charOpts}
                    onChange={setCharPick}
                    disabled={!chars.length}
                    search={charOpts.length > 7}
                    trigger={(o) => (
                      <>
                        <span className={`np-face ${picked?.thumb ? "" : "glyph"}`}>
                          {picked?.thumb ? <img src={picked.thumb} alt="" /> : (o?.icon ?? <Spinner size={14} />)}
                        </span>
                        <span className="pk-two">
                          <b>
                            {o?.label ?? "Loading your characters…"}
                            {o?.badge && <em className="pk-badge">{o.badge}</em>}
                          </b>
                          {o?.hint && <small>{o.hint}</small>}
                        </span>
                      </>
                    )}
                  />
                  {charPick === "__describe" && (
                    <>
                      <textarea
                        className="input"
                        rows={2}
                        value={charDesc}
                        onChange={(e) => setCharDesc(e.target.value)}
                        aria-label="Describe the main character"
                        autoFocus
                        placeholder="Who stars in this video? e.g. a cheerful marine biologist with a sun hat and a wetsuit"
                      />
                      {!claude?.loggedIn && (
                        <span className="help warn">Connect Claude in Settings first: Claude designs the character.</span>
                      )}
                    </>
                  )}
                  {charPick && charRow && charPick !== picked?.id && charPick !== "__describe" && (
                    <span className="help">{charRow.hint}.</span>
                  )}
                </div>
              )}
              {base === "toon" && (
                <ToonCharacters
                  value={toonPick}
                  onChange={setToonPick}
                  claudeOk={!!claude?.loggedIn}
                  saved={toonSaved}
                  setSaved={setToonSaved}
                  builtin={(st?.controls.find((c) => c.path === "characters.main")?.options ?? []).map((o) => ({
                    value: String(o.value),
                    label: String(o.label),
                  }))}
                />
              )}
            </>
          )}
        </section>
        <section className="np-sec">
          <header>
            <span className="np-idx">03</span>
            <h3>Story</h3>
            <span className="dim">optional</span>
          </header>
          <Segmented
            id="np-source"
            ariaLabel="Where the script comes from"
            className="np-source"
            value={source}
            onChange={setSource}
            options={[
              {
                value: "topic",
                label: <>Claude writes it{source !== "topic" && topic.trim() && <i className="np-dot" />}</>,
                icon: <LightbulbIcon size={14} strokeWidth={1.8} />,
              },
              {
                value: "script",
                label: <>I have a script{source !== "script" && script.trim() && <i className="np-dot" />}</>,
                icon: <FileTextIcon size={14} strokeWidth={1.8} />,
              },
            ]}
          />
          {source === "topic" ? (
            <div key="topic" className="field np-pane">
              <textarea
                id="np-topic"
                className="input oneline"
                rows={Math.min(5, topic.split("\n").length)}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                aria-label="Topic"
                placeholder="A topic, e.g. Why the PS2 could do so much with 32 MB of RAM"
              />
              <span className="help">
                Claude researches it and writes the narration{langOn && L.code !== "en" ? ` in ${L.name}` : ""}
                {targetWords ? `: about ${targetWords.toLocaleString()} ${wordUnit(L.code)} for ${length}` : ""}.
                {skill?.on && (
                  <span data-np-skill-note>
                    {" "}
                    {skillOff ? (
                      "Not with your scripting skill"
                    ) : (
                      <>
                        {"With your scripting skill "}
                        <b style={{ fontWeight: 500 }}>{skill.name}</b>
                      </>
                    )}
                    {". "}
                    <button
                      type="button"
                      className="text-btn link"
                      onClick={() => {
                        setAdvOpen(true);
                        setTimeout(
                          () => document.getElementById("np-adv")?.parentElement?.scrollIntoView({ block: "start", behavior: "smooth" }),
                          30,
                        );
                      }}
                    >
                      Change for this video
                    </button>
                  </span>
                )}
              </span>
            </div>
          ) : (
            <div key="script" className="field np-pane">
              <textarea
                id="np-script"
                className="input"
                rows={5}
                value={script}
                onChange={(e) => setScript(e.target.value)}
                aria-label="Script"
                placeholder="Paste the exact narration text. It becomes the proofread transcript, so timing matches word for word."
              />
              <span className="help np-count">
                {scriptWords ? (
                  <>
                    <b>
                      {scriptWords.toLocaleString()} {wordUnit(SL.code)}
                    </b>
                    {" · about "}
                    {fmtLength(spoken)}
                    {" spoken"}
                    {lengthNote(len)}
                    {(off > 1.25 || off < 0.75) && (
                      <span className="warn">
                        {" · "}
                        {off > 1 ? "longer" : "shorter"}
                        {" than the "}
                        {length}
                        {" you set"}
                      </span>
                    )}
                  </>
                ) : (
                  "Your own narration, word for word."
                )}
              </span>
              {other && (
                <div ref={otherRef} className="help warn np-otherlang" role="status">
                  <span>
                    {"This script is in "}
                    {SL.name}
                    {", but the video is "}
                    {L.name}
                    {langOn ? "" : " (Settings > Language: English only)"}
                    {": the voice would read it and its words would be timed as "}
                    {L.name}
                    {", and Claude would write the words on screen in "}
                    {L.name}.
                    {otherDrawn
                      ? ""
                      : ` ${st?.name ?? "This style"} can't write ${SL.name}: ${cantDrawWhy(base, other)}. ${whoCanDraw(other)}`}
                    {otherDrawn && std && " " + premiumMsg("Other languages")}
                  </span>
                  {otherDrawn && !std && (
                    <button type="button" className="btn tiny" onClick={takeOther}>
                      {"Make it "}
                      {aLang(other)}
                      {" video"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="np-brief">
              {"Direction for Claude "}
              <span className="dim">· optional</span>
            </label>
            <textarea
              id="np-brief"
              className="input"
              rows={2}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Tone, characters, what to emphasise, camera style…"
            />
          </div>
        </section>
        <section className={`np-sec np-adv ${advOpen ? "open" : ""}`}>
          <button
            type="button"
            id="np-adv"
            className="np-adv-head"
            aria-expanded={advOpen}
            aria-controls="np-adv-body"
            onClick={(e) => {
              const sec = e.currentTarget.parentElement;
              setAdvOpen(!advOpen);
              if (!advOpen) setTimeout(() => sec?.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
            }}
          >
            <span className="np-idx">04</span>
            <h3>This project's settings</h3>
            <span className={`np-adv-sum ellipsis ${summary || realChanged ? "set" : ""}`}>
              {summary || realChanged
                ? [summary, realChanged ? "Real media changed" : ""].filter(Boolean).join(" · ")
                : "Claude model, pictures, voice and sound as in Settings"}
            </span>
            <ChevronDownIcon className="np-adv-chev" size={15} strokeWidth={1.8} />
          </button>
          {advOpen && (
            <div id="np-adv-body" className="np-adv-body">
              <p className="help">
                Used from the start: Claude researches and writes with this model and effort. Global setting follows Settings. You can
                change all of it later in the editor (Project settings).
              </p>
              <NpScriptSkill skill={skill} setSkill={setSkill} off={skillOff} setOff={setSkillOff} />
              {info ? (
                <ProjectChoicesForm
                  vals={choices}
                  onChange={pickChoice}
                  info={info}
                  base={base}
                  styleName={st?.name ?? "This style"}
                  aria=" (new project)"
                  hideOff
                  real={
                    base === "recon" || base === "stickman" || base === "lowpoly" || base === "toon" || base === "stickstory"
                      ? realMedia
                      : null
                  }
                />
              ) : (
                <Spinner size={15} />
              )}
            </div>
          )}
        </section>
        <div className="modal-actions">
          <span className="np-keys" aria-hidden="true">
            <kbd>{MOD}</kbd>
            <kbd>{isMac ? "↩" : "Enter"}</kbd>to create
          </span>
          <button className="btn" onClick={() => onClose()}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={create}
            disabled={busy || noCustom}
            title={noCustom ? "Pick a style first: import one, or switch to Built-in" : void 0}
          >
            {busy && <Spinner size={15} />}Create project
          </button>
        </div>
      </div>
    </Modal>
  );
}
