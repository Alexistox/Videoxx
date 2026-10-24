import { useEffect, useRef, useState } from "react";
import { api } from "./lib/api";
import { useApp } from "./state/AppProvider";
import {
  LifeBuoy,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as Settings$1,
} from "../../../node_modules/lucide-react/dist/esm/lucide-react";
import { keys } from "./help/keys";
import { HelpAssistant } from "./help/HelpAssistant";
import { I, Toasts } from "./components/ui";
import { RefViewerHost } from "./refs/RefViewer";
import { Thumbnails } from "./thumbnails/Thumbnails";
import { Settings } from "./settings/Settings";
import { YouTube } from "./youtube/YouTube";
import { Channels } from "./channels/Channels";
import { Home } from "./projects/Home";
import { Projects } from "./projects/Projects";
import { PREMIUM_PAGES, exportsLeft, isStandard, premiumMsg, usePlan } from "./state/usePlan";
import { NewProject } from "./projects/NewProject";
import { Presets } from "../../../looks/Presets";
import { Memory } from "../../../looks/Memory";
import { Library } from "../../../library/Library";
import { Renders } from "../../../library/Renders";
import { Editor } from "./editor/Editor";
import { Studio } from "./studio/Studio";
import { StyleImport } from "./studio/StyleImport";
import { NewVideo } from "./personal/NewVideo";
import { Layouts } from "./personal/Layouts";
import { Videos } from "./personal/Videos";
import { Routines } from "./routines/Routines";
import { BrandSwitch } from "./shell/BrandSwitch";
import { ImageKeyNotice } from "./shell/ImageKeyNotice";
import { ANALYTICS, BRAND_NAME, GlideNav, NAVS, thing } from "./shell/GlideNav";
import { ConnButton } from "./shell/ConnButton";
import { UpdateButton } from "./shell/UpdateButton";
import { GraphicsButton } from "./shell/GraphicsButton";
import { ExportsButton } from "./shell/ExportsButton";
import { Palette } from "./shell/Palette";
import { ZoomBadge } from "./shell/ZoomBadge";
import logo from "./assets/logo.png";

export function App() {
  const {
    page,
    go,
    projectId,
    palette,
    setPalette,
    newProject,
    setNewProject,
    newPrefill,
    suggestions,
    libProposed,
    projects,
    working,
    brand,
    setBrand,
    toast,
    studioId,
    importId,
    help,
    openHelp,
    closeHelp,
  } = useApp();
  const plan = usePlan(),
    std = isStandard(plan),
    left = exportsLeft(plan);
  const open = (id, label) => (std && PREMIUM_PAGES.has(id) ? toast(premiumMsg(label)) : go(id));
  const lock = (id) => (std && PREMIUM_PAGES.has(id) ? <Lock size={12} className="nav-lock" aria-label="Premium" /> : null);
  const nav = NAVS[brand];
  const [collapsed, setCollapsed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [mac, setMac] = useState(false);
  useEffect(() => {
    api
      .info()
      .then((i) => {
        setPreview(!!i?.preview);
        setMac(i?.platform === "darwin");
        if (i?.testHooks) window.__czToast = toast;
      })
      .catch(() => {});
  }, []);
  const rail = collapsed || page === "editor" || page === "studio";
  useEffect(() => {
    let t = 0;
    const show = (ms) => {
      clearTimeout(t);
      t = window.setTimeout(() => document.querySelector(".ws-nav button.selected")?.scrollIntoView({ block: "nearest" }), ms);
    };
    show(380);
    const resized = () => show(150);
    window.addEventListener("resize", resized);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", resized);
    };
  }, [page, brand, rail]);
  const lastBrand = useRef(brand),
    swapped = lastBrand.current !== brand;
  useEffect(() => {
    lastBrand.current = brand;
  }, [brand]);
  useEffect(() => {
    const key = (e) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        setNewProject(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!projectId && projects.length)
      api.config().then((c) => {
        const last = brand === "personal" ? c.lastPersonalProjectId : c.lastProjectId;
        if (last && projects.some((p) => p.id === last)) go(page, last);
      });
  }, [projects.length, brand]);
  const View = {
    home: Home,
    projects: brand === "personal" ? Videos : Projects,
    channels: Channels,
    youtube: YouTube,
    editor: Editor,
    presets: Presets,
    library: Library,
    memory: Memory,
    renders: Renders,
    settings: Settings,
    thumbnails: Thumbnails,
    layouts: Layouts,
    routines: Routines,
    studio: Studio,
    styleimport: StyleImport,
  }[page];
  return (
    <div className={`app ${rail ? "rail" : ""} ${preview ? "preview" : ""} ${mac ? "mac" : ""}`}>
      <div className="drag" />
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <img src={logo} alt="" />
          <span className="brand-text">
            <span className="brand-name">Videoxx</span>
            <span key={brand} className={`ws-label ${brand}`} aria-live="polite" title={`You are in the ${BRAND_NAME[brand]} workspace`}>
              <i />
              {BRAND_NAME[brand]}
            </span>
          </span>
          {page !== "editor" && page !== "studio" && (
            <button
              className="icon-btn"
              style={{ marginLeft: "auto" }}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen size={17} strokeWidth={1.7} /> : <PanelLeftClose size={17} strokeWidth={1.7} />}
            </button>
          )}
        </div>
        {!rail && (
          <div className="side-switch">
            <BrandSwitch value={brand} onChange={setBrand} />
          </div>
        )}
        <button className="cmd" onClick={() => setPalette(true)} title={`Search (${keys("K")})`}>
          <Search size={16} strokeWidth={1.7} />
          <span>Search or run…</span>
          <kbd>{keys("K")}</kbd>
        </button>
        <GlideNav key={brand} className="nav ws-nav">
          {nav.main.map((n, i) => (
            <button
              key={n.id}
              style={{ "--i": i }}
              className={page === n.id ? "selected" : ""}
              onClick={() => go(n.id)}
              disabled={n.id === "editor" && !projectId}
              title={n.id === "editor" && !projectId ? `Open a ${thing(brand)} first` : n.label}
            >
              <n.icon {...I} />
              <span>{n.label}</span>
              {n.id === "projects" && <small>{projects.length || ""}</small>}
              {n.id === "editor" && working.size > 0 && (
                <small title="Claude is working">
                  <span className="dot busy" />
                </small>
              )}
            </button>
          ))}
          <div className="nav-label" style={{ "--i": nav.main.length }}>
            {nav.section}
          </div>
          {nav.more.map((n, i) => (
            <button
              key={n.id}
              style={{ "--i": nav.main.length + 1 + i }}
              className={`${page === n.id || ((page === "studio" || page === "styleimport") && n.id === "presets") ? "selected" : ""} ${lock(n.id) ? "locked" : ""}`}
              onClick={() => open(n.id, n.label)}
              title={lock(n.id) ? `${n.label} (Premium)` : n.label}
            >
              <n.icon {...I} />
              <span>{n.label}</span>
              {n.id === "memory" && suggestions > 0 && (
                <small style={{ color: "var(--amber)" }}>
                  {suggestions}
                  {" new"}
                </small>
              )}
              {n.id === "library" && libProposed > 0 && (
                <small
                  className="lby-nav-badge"
                  style={{ color: "var(--amber)" }}
                  title={`${libProposed} proposed ${libProposed === 1 ? "entry waits" : "entries wait"} for you`}
                >
                  {libProposed}
                  {" new"}
                </small>
              )}
              {lock(n.id)}
            </button>
          ))}
          <div className="nav-label nav-an" style={{ "--i": nav.main.length + 1 + nav.more.length }}>
            Analytics
          </div>
          {ANALYTICS.map((n, i) => (
            <button
              key={n.id}
              style={{ "--i": nav.main.length + 2 + nav.more.length + i }}
              className={`${page === n.id ? "selected" : ""} ${lock(n.id) ? "locked" : ""}`}
              onClick={() => open(n.id, n.label)}
              title={lock(n.id) ? `${n.label} (Premium)` : n.label}
            >
              <n.icon {...I} />
              <span>{n.label}</span>
              {lock(n.id)}
            </button>
          ))}
        </GlideNav>
        <div className="side-foot">
          <GlideNav className="nav" style={{ marginTop: 0 }}>
            <button onClick={() => setNewProject(true)} title={`New ${thing(brand)} (${keys("N")})`}>
              <Plus {...I} />
              <span>
                {"New "}
                {thing(brand)}
              </span>
            </button>
            <button
              className={help.open ? "selected" : ""}
              onClick={() => (help.open ? closeHelp() : openHelp())}
              title="Help: ask a question or report a problem"
              aria-expanded={help.open}
            >
              <LifeBuoy {...I} />
              <span>Help</span>
            </button>
            <button className={page === "settings" ? "selected" : ""} onClick={() => go("settings")} title="Settings">
              <Settings$1 {...I} />
              <span>Settings</span>
            </button>
          </GlideNav>
          {preview && (
            <div
              className="preview-tag"
              role="note"
              title="Unreleased changes, working on a copy of your projects. Nothing here touches your real projects or your installed app."
            >
              PREVIEW<small>copy of your projects</small>
            </div>
          )}
          {false && plan && (
            <div
              className={`plan-tag ${plan.plan}`}
              role="note"
              title={
                std
                  ? `Standard plan: ${plan.exportsLimit} video exports a month, every style and vertical 9:16. Premium unlocks Ultraedit, Routines, custom styles, characters designed with Claude, 4K, other languages and unlimited exports.`
                  : "Premium plan: everything unlocked"
              }
            >
              {std ? "Standard" : "Premium"}
              {std && left != null && (
                <small>
                  {left}
                  {" of "}
                  {plan.exportsLimit}
                  {" exports left"}
                </small>
              )}
            </div>
          )}
          <ExportsButton />
          <UpdateButton />
          <GraphicsButton />
          <ConnButton />
        </div>
      </aside>
      <main
        key={
          (page === "editor"
            ? "editor-" + projectId
            : page === "studio"
              ? "studio-" + (studioId ?? "brief")
              : page === "styleimport"
                ? "import-" + importId
                : page) +
          "-" +
          brand
        }
        className={`main ${swapped ? "ws-swap" : ""}`}
      >
        <View />
      </main>
      {palette && <Palette />}
      {newProject &&
        ((newPrefill?.kind ?? brand) === "personal" ? (
          <NewVideo onClose={(made) => setNewProject(false, made)} />
        ) : (
          <NewProject onClose={(made) => setNewProject(false, made)} />
        ))}
      <ImageKeyNotice />
      <Toasts />
      <RefViewerHost />
      <ZoomBadge />
      {help.open && <HelpAssistant />}
    </div>
  );
}
export function CrashHelp({ err }) {
  const { help, openHelp } = useApp();
  return (
    <>
      <button className="btn" onClick={() => openHelp({ error: `Something broke in this view: ${err.message}`, where: "crash" })}>
        Report this problem
      </button>
      {help.open && <HelpAssistant />}
    </>
  );
}
