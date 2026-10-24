import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { useApp } from "../state/AppProvider";
import {
  Check,
  Clapperboard,
  FolderInput,
  ImagePlus,
  LayoutTemplate,
  LogIn,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Video,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { I, Spinner } from "../components/ui";
import { useSpeech } from "../settings/SettingsRows";
import { ComingUp } from "../channels/ComingUp";
import { UsageHome } from "./UsageHome";

export function Home() {
  const { brand, setNewProject, refreshProjects, go, toast } = useApp();
  const importFolder = async () => {
    const d = await api.pickFolder("Import a project folder");
    if (!d) return;
    try {
      const p = await api.importProject(d);
      await refreshProjects();
      toast(`Imported "${p.name}".`);
      go("editor", p.id);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  return (
    <div className="page page-enter">
      <div className="home">
        <div className="page-head">
          <div>
            <h1>Welcome back</h1>
            <div key={brand} className="sub ws-fade">
              {brand === "personal"
                ? "Plan the video, drop in your footage, and Claude cuts it. You fine-tune on the timeline."
                : "Explainer videos in pixel art, Vox or a style of your own, edited by pointing and asking."}
            </div>
          </div>
          <div className="actions">
            {brand === "personal" ? (
              <button className="btn primary" onClick={() => setNewProject(true)}>
                <Plus {...I} />
                New video
              </button>
            ) : (
              <>
                <button className="btn" onClick={importFolder}>
                  <FolderInput {...I} />
                  Import
                </button>
                <button className="btn primary" onClick={() => setNewProject(true)}>
                  <Plus {...I} />
                  New project
                </button>
              </>
            )}
          </div>
        </div>
        <div key={brand} className="ws-fade">
          {brand === "personal" ? <PersonalHome /> : <FacelessHome />}
        </div>
      </div>
    </div>
  );
}
function FacelessHome() {
  const { claude, projects, go, setNewProject, signIn, signingIn, refreshProjects } = useApp();
  const [stats, setStats] = useState(null);
  const [renders, setRenders] = useState([]);
  const [health, setHealth] = useState(null);
  useEffect(() => {
    api.stats().then(setStats);
    api.renders().then(setRenders);
    api
      .health()
      .then(setHealth)
      .catch(() => {});
    refreshProjects();
  }, []);
  const sp = useSpeech();
  const missing = health
    ? [!health.git && "git", !health.ffmpeg && "ffmpeg", !health.python && "Python", ...(health.pyMissing ?? [])].filter(Boolean)
    : [];
  const checks = [
    {
      done: !!claude?.loggedIn,
      t: "Connect Claude",
      s: "Uses your own Claude Code login: your account, model, skills and memory.",
      act: claude?.loggedIn ? null : (
        <button className="btn small" onClick={signIn} disabled={signingIn}>
          {signingIn ? <Spinner size={14} /> : <LogIn size={14} />}Sign in
        </button>
      ),
    },
    {
      done: !!health && !missing.length,
      t: "Check your tools",
      s: missing.length
        ? `Missing: ${missing.join(", ")}. Settings can install or explain each one.`
        : health
          ? "git, ffmpeg and Python are ready."
          : "Checking…",
      act: missing.length ? (
        <button className="btn small" onClick={() => go("settings")}>
          Review
        </button>
      ) : null,
    },
    // (with several languages in Settings > Language: also the language new videos start in)
    {
      done: !!sp?.ready,
      t: "Set up transcription",
      s:
        sp?.status === "running" || sp?.status === "verifying"
          ? `Claude is picking and installing the best speech model for ${sp.job === "multi" ? "several languages" : "this computer"}…`
          : sp?.status === "failed" && !sp.ready
            ? sp.error || "The setup did not finish."
            : claude?.loggedIn
              ? `Claude checks this computer and installs the best local speech model for it${sp?.mode === "multi" ? ", for several languages" : ""}.`
              : "Starts by itself once Claude is connected.",
      act:
        sp && !sp.ready && claude?.loggedIn && sp.status !== "running" && sp.status !== "verifying" ? (
          <button className="btn small" onClick={() => api.speechSetup()}>
            {sp.status === "failed" ? "Try again" : "Set up"}
          </button>
        ) : sp?.status === "running" || sp?.status === "verifying" ? (
          <Spinner size={14} />
        ) : null,
    },
    {
      done: projects.length > 0,
      t: "Create or import a project",
      s: "Start from a voiceover or a topic, or bring in a project folder you made before.",
      act: projects.length ? null : (
        <button className="btn small" onClick={() => setNewProject(true)}>
          <Plus size={14} />
          New
        </button>
      ),
    },
    {
      done: (stats?.edits ?? 0) > 0,
      t: "Make your first edit",
      s: "Click anything in the preview, say what to change, and Claude edits the scene.",
      act: null,
    },
    {
      done: renders.some((r) => r.status === "done"),
      t: "Export a video",
      s: "GPU render straight to MP4 with the mixed soundtrack.",
      act: null,
    },
  ];
  const done = checks.filter((c) => c.done).length;
  const last = projects[0];
  return (
    <>
      <ComingUp />
      {done < checks.length && (
        <section className="panel pad" style={{ marginBottom: 25 }} aria-label="Getting started">
          <div className="row">
            <h3 className="grow">Getting started</h3>
            <small>
              {done}
              {" of "}
              {checks.length}
            </small>
          </div>
          <div className="progress">
            <i style={{ width: `${(done / checks.length) * 100}%` }} />
          </div>
          {checks.map((c, i) => (
            <div key={i} className={`check-row ${c.done ? "done" : ""}`}>
              <span className="circle">{c.done && <Check size={14} strokeWidth={2} />}</span>
              <span className="t">
                {c.t}
                <small className="muted">{c.s}</small>
              </span>
              {c.act}
            </div>
          ))}
        </section>
      )}
      <div className="quick">
        {[
          {
            icon: Clapperboard,
            t: last ? "Continue editing" : "Open the editor",
            d: last ? last.name : "Pick a project first",
            run: () => (last ? go("editor", last.id) : go("projects")),
          },
          { icon: Plus, t: "New project", d: "Voiceover in, video out", run: () => setNewProject(true) },
          { icon: SlidersHorizontal, t: "Styles", d: "Pixel art, Vox and your own styles", run: () => go("presets") },
          { icon: Sparkles, t: "Memory", d: "Style rules Claude always follows", run: () => go("memory") },
        ].map((q, i) => (
          <button key={i} className="card clickable" onClick={q.run} style={{ padding: 18, border: void 0 }}>
            <div className="tile">
              <q.icon {...I} />
            </div>
            <h3>{q.t}</h3>
            <p className="ellipsis">{q.d}</p>
          </button>
        ))}
      </div>
      <UsageHome projects={projects} />
    </>
  );
}
function PersonalHome() {
  const { claude, projects, go, setNewProject, signIn, signingIn, refreshProjects } = useApp();
  useEffect(() => {
    refreshProjects();
  }, []);
  const last = projects[0];
  return (
    <>
      {!claude?.loggedIn && (
        <section className="panel pad row" style={{ marginBottom: 25 }} aria-label="Connect Claude">
          <span className="grow">
            <b style={{ fontWeight: 500 }}>Connect Claude</b>
            <small className="muted" style={{ display: "block", marginTop: 3 }}>
              Claude cuts your footage with your own Claude Code login.
            </small>
          </span>
          <button className="btn small" onClick={signIn} disabled={signingIn}>
            {signingIn ? <Spinner size={14} /> : <LogIn size={14} />}Sign in
          </button>
        </section>
      )}
      <ComingUp />
      <div className="quick">
        {[
          {
            icon: Clapperboard,
            t: last ? "Continue editing" : "Open the editor",
            d: last ? last.name : "Plan a video first",
            run: () => (last ? go("editor", last.id) : setNewProject(true)),
          },
          { icon: Video, t: "New video", d: "Title, thumbnail, footage", run: () => setNewProject(true) },
          { icon: ImagePlus, t: "Thumbnails", d: "Canvas and prompts, by Higgsfield", run: () => go("thumbnails") },
          { icon: LayoutTemplate, t: "Layouts", d: "Facecam, screen and background", run: () => go("layouts") },
        ].map((q, i) => (
          <button key={i} className="card clickable" onClick={q.run} style={{ padding: 18, border: void 0 }}>
            <div className="tile">
              <q.icon {...I} />
            </div>
            <h3>{q.t}</h3>
            <p className="ellipsis">{q.d}</p>
          </button>
        ))}
      </div>
      <section aria-label="Recent videos">
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 className="grow">Recent videos</h3>
          {projects.length > 0 && (
            <button className="text-btn" onClick={() => go("projects")}>
              All videos
            </button>
          )}
        </div>
        {projects.length ? (
          <div className="video-grid">
            {projects.slice(0, 6).map((p) => (
              <VideoCard key={p.id} p={p} onOpen={() => go("editor", p.id)} />
            ))}
          </div>
        ) : (
          <div className="empty" style={{ minHeight: 220, padding: 40 }}>
            <div className="ic">
              <Video size={28} strokeWidth={1.6} />
            </div>
            <h3>No videos yet</h3>
            <p>Start with the title and the thumbnail idea. Your footage goes in next.</p>
            <button className="btn primary" onClick={() => setNewProject(true)}>
              <Plus {...I} />
              New video
            </button>
          </div>
        )}
      </section>
      <div style={{ height: 33 }} />
      <UsageHome projects={[]} />
    </>
  );
}
export function VideoCard({ p, onOpen }) {
  return (
    <button className="video-card" onClick={onOpen} title={p.name}>
      <span className="vc-thumb">{p.thumb ? <img src={p.thumb} alt="" draggable={false} /> : <Video size={26} strokeWidth={1.4} />}</span>
      <span className="vc-meta">
        <b className="ellipsis">{p.name}</b>
        <time>{ago(p.opened_at || p.updated_at)}</time>
      </span>
    </button>
  );
}
