import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRightIcon,
  AudioLinesIcon,
  ClapperboardIcon,
  CornerDownLeftIcon,
  PanelsTopLeftIcon,
  PlusIcon,
  SearchIcon,
  SearchXIcon,
  Settings,
  SlidersHorizontalIcon,
  TvMinimalPlayIcon,
  VideoIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { I, Modal } from "../components/ui";
import { findFolded, fold } from "../lib/fold";
import { searchSettings } from "../settings/settingsRegistry";
import { ANALYTICS, BRAND_NAME, NAVS, thing } from "./GlideNav";

export function Palette() {
  const {
    setPalette,
    projects,
    go,
    setNewProject,
    projectId,
    refreshProjects,
    toast,
    brand,
    setBrand,
    channels,
    setChannel,
    openVoiceover,
    openSettings,
  } = useApp();
  const nav = NAVS[brand],
    other = brand === "personal" ? "faceless" : "personal";
  const [qy, setQ] = useState("");
  const [i, setI] = useState(0);
  const cur = projects.find((p) => p.id === projectId),
    voiceFor = brand === "faceless" && cur && cur.exists !== false && !cur.lab ? cur : null;
  const items = useMemo(() => {
    const base = [
      { t: `New ${thing(brand)}`, k: "Action", run: () => setNewProject(true) },
      ...(brand === "faceless"
        ? [
            {
              t: "Import a project folder",
              k: "Action",
              run: async () => {
                const d = await api.pickFolder("Import a project folder");
                if (!d) return;
                try {
                  const p = await api.importProject(d);
                  await refreshProjects();
                  go("editor", p.id);
                } catch (e) {
                  toast(e.message, "bad");
                }
              },
            },
          ]
        : []),
      { t: `Switch to ${BRAND_NAME[other]}`, k: "Workspace", run: () => setBrand(other) },
      ...(projectId ? [{ t: "Open editor", k: "Page", ic: ClapperboardIcon, run: () => go("editor") }] : []),
      // the Graphics panel of the video open now (speed, quality, post processing)
      ...(projectId && brand === "faceless" && cur && !cur.lab
        ? [
            {
              t: `Graphics for “${cur.name}”`,
              nm: cur.name,
              k: "Action",
              ic: SlidersHorizontalIcon,
              kw: "graphics quality fps bloom shadows post processing render scale performance colour color grade ambient occlusion depth of field exposure anti-aliasing",
              run: () => {
                go("editor");
                setTimeout(() => window.dispatchEvent(new CustomEvent("cz-open-graphics", { detail: projectId })), 60);
              },
            },
          ]
        : []),
      ...(voiceFor
        ? [
            {
              t: `Make the voiceover for “${voiceFor.name}”`,
              nm: voiceFor.name,
              k: "Action",
              ic: AudioLinesIcon,
              run: () => openVoiceover(voiceFor.id),
            },
          ]
        : []),
      ...[...nav.main, ...nav.more, ...ANALYTICS, { id: "settings", label: "Settings", icon: Settings }].map((n) => ({
        t: n.label,
        k: "Page",
        ic: n.icon,
        run: () => go(n.id),
      })),
      ...(channels.length
        ? [
            {
              t: "All channels",
              k: "Channel",
              ic: TvMinimalPlayIcon,
              run: () => {
                setChannel("all");
                go("channels");
              },
            },
          ]
        : []),
      ...channels.map((c) => ({
        t: c.name,
        k: "Channel",
        ic: TvMinimalPlayIcon,
        kw: c.handle ?? "",
        run: () => {
          setChannel(c.id);
          go("channels");
        },
      })),
      // found by its @handle too
      ...projects.map((p) => ({
        t: p.name,
        k: "Project",
        ic: brand === "personal" ? VideoIcon : ClapperboardIcon,
        run: () => go("editor", p.id),
      })),
    ];
    const s = fold(qy.trim());
    const sets = s
      ? searchSettings(qy)
          .slice(0, 5)
          .map((e) => ({ t: `Settings: ${e.title}`, k: "Setting", ic: Settings, run: () => openSettings(e.id) }))
      : [];
    if (!s) return base;
    const own = (x) => fold(`${x.nm ? x.t.replace(x.nm, "") : x.t} ${x.kw ?? ""}`).includes(s);
    const hits = base.filter((x) => fold(`${x.t} ${x.kw ?? ""}`).includes(s));
    return [...hits.filter(own), ...hits.filter((x) => !own(x)), ...sets];
  }, [qy, projects, projectId, brand, channels]);
  useEffect(() => setI(0), [qy]);
  const pick = (k) => {
    const it = items[k];
    if (!it) return;
    setPalette(false);
    it.run();
  };
  const KIND_ICON = {
    Action: PlusIcon,
    Workspace: ArrowLeftRightIcon,
    Page: PanelsTopLeftIcon,
    Project: ClapperboardIcon,
    Channel: TvMinimalPlayIcon,
  };
  const marked = (t) => {
    const r = findFolded(t, qy.trim());
    return !r ? (
      t
    ) : (
      <>
        {t.slice(0, r[0])}
        <mark>{t.slice(r[0], r[1])}</mark>
        {t.slice(r[1])}
      </>
    );
  };
  return (
    <Modal title="Command palette" onClose={() => setPalette(false)} className="palette">
      <div style={{ padding: "14px 16px 4px" }}>
        <div className="search">
          <SearchIcon {...I} />
          <input
            autoFocus
            placeholder="Search projects, channels, pages and actions"
            value={qy}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setI((x) => Math.min(items.length - 1, x + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setI((x) => Math.max(0, x - 1));
              }
              if (e.key === "Enter") {
                e.preventDefault();
                pick(i);
              }
            }}
          />
        </div>
      </div>
      <div className="palette-results" role="listbox">
        {items.map((it, k) => {
          const Ic = it.ic ?? KIND_ICON[it.k] ?? SearchIcon;
          return (
            <button
              key={k}
              role="option"
              aria-selected={k === i}
              className={k === i ? "on" : ""}
              onMouseEnter={() => setI(k)}
              onClick={() => pick(k)}
            >
              <span className="pal-ic">
                <Ic size={15} strokeWidth={1.7} />
              </span>
              <span className="ellipsis" title={it.t}>
                {marked(it.t)}
              </span>
              <small>{it.k}</small>
              {k === i && <CornerDownLeftIcon className="pal-enter" size={13} strokeWidth={1.7} />}
            </button>
          );
        })}
        {!items.length && (
          <div className="palette-empty">
            <SearchXIcon size={22} strokeWidth={1.6} />
            <b>No results for “{qy.trim()}”</b>
            <span>Try a project name, a page like Renders, or “new”.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
