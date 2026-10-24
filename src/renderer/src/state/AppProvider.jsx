import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, on } from "../lib/api";
import { brief, fmtPlayed, unheardWords } from "../lib/format";
import { voiceDialogs } from "./voiceDialogs";
import { BRAND_KEY, BRAND_PAGES, CHANNEL_KEY, LIST_CHANNEL_CFG, LIST_CHANNEL_KEY } from "./brand";
import { noteError } from "../lib/errors";

const C = createContext(null);
export const useApp = () => useContext(C);
export function AppProvider({ children }) {
  const [page, setPage] = useState("home");
  const [projectId, setProjectId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [claude, setClaude] = useState(null);
  const [allProjects, setProjects] = useState([]);
  const [brand, setBrandState] = useState(() => {
    try {
      return localStorage.getItem(BRAND_KEY) === "personal" ? "personal" : "faceless";
    } catch {
      return "faceless";
    }
  });
  const projects = useMemo(() => allProjects.filter((p) => (p.kind || "faceless") === brand), [allProjects, brand]);
  const [channels, setChannels] = useState([]);
  const [channel, setChannelState] = useState(() => {
    try {
      return localStorage.getItem(CHANNEL_KEY) || "all";
    } catch {
      return "all";
    }
  });
  const [listChannels, setListChannelState] = useState(() => {
    const r = (b) => {
      try {
        return localStorage.getItem(LIST_CHANNEL_KEY[b]) || "all";
      } catch {
        return "all";
      }
    };
    return { faceless: r("faceless"), personal: r("personal") };
  });
  const listChannel = listChannels[brand];
  const [palette, setPalette] = useState(false);
  const [newProject, setNewProjectState] = useState(false);
  const [newPrefill, setNewPrefill] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [loginLog, setLoginLog] = useState([]);
  const [suggestions, setSuggestions] = useState(0);
  const [libProposed, setLibProposed] = useState(0);
  const [working, setWorking] = useState(new Set());
  const where = useRef({ page, projectId, brand });
  where.current = { page, projectId, brand };
  const names = useRef(allProjects);
  names.current = allProjects;
  const [voiceReq, setVoiceReq] = useState(null);
  const showProject = useCallback((pid) => {
    const kind = names.current.find((p) => p.id === pid)?.kind === "personal" ? "personal" : "faceless";
    if (kind !== where.current.brand) {
      setThumbFor(null);
      setBrandState(kind);
      try {
        localStorage.setItem(BRAND_KEY, kind);
      } catch {}
      api.setConfig({ ui: { brand: kind } }).catch(() => {});
    }
    setPage("editor");
    setProjectId(pid);
  }, []);
  const openVoiceover = useCallback(
    (pid) => {
      showProject(pid);
      setVoiceReq({ projectId: pid, n: Date.now() });
    },
    [showProject],
  );
  const clearVoiceReq = useCallback(() => setVoiceReq(null), []);
  const [rewriteReq, setRewriteReq] = useState(null);
  const openRewrite = useCallback(
    (pid) => {
      showProject(pid);
      setRewriteReq({ projectId: pid, n: Date.now() });
    },
    [showProject],
  );
  const clearRewriteReq = useCallback(() => setRewriteReq(null), []);
  const [settingsReq, setSettingsReq] = useState(null);
  const openSettings = useCallback((id) => {
    setPage("settings");
    if (id) setSettingsReq({ id, n: Date.now() });
  }, []);
  const clearSettingsReq = useCallback(() => setSettingsReq(null), []);
  const [studioPrefill, setStudioPrefill] = useState(null),
    [studioId, setStudioId] = useState(null);
  const startStudio = useCallback((p) => {
    setStudioPrefill(p);
    setStudioId(null);
    setPage("studio");
  }, []);
  const openStudio = useCallback((pid) => {
    setStudioPrefill(null);
    setStudioId(pid);
    setPage("studio");
  }, []);
  const studioRef = useRef(null);
  studioRef.current = studioId;
  const [importId, setImportId] = useState(null);
  const openImport = useCallback((id) => {
    setImportId(id);
    setPage("styleimport");
  }, []);
  const tid = useRef(1),
    blockedAt = useRef(0),
    voiceEnded = useRef(new Map()),
    toastTimers = useRef(new Map());
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const dismissTag = useCallback((tag) => setToasts((t) => (t.some((x) => x.tag === tag) ? t.filter((x) => x.tag !== tag) : t)), []);
  const toast = useCallback(
    (text, kind = "ok", action, tag) => {
      const id = tid.current++;
      if (kind === "bad") noteError(text, where.current.page);
      setToasts((t) => [...t.slice(-3), { id, text, kind, action, at: Date.now(), tag }]);
      toastTimers.current.set(
        id,
        window.setTimeout(
          () => {
            toastTimers.current.delete(id);
            dismiss(id);
          },
          kind === "bad" ? 9e3 : action ? 8e3 : 4500,
        ),
      );
      return id;
    },
    [dismiss],
  );
  const holdToast = useCallback(
    (id, hold) => {
      clearTimeout(toastTimers.current.get(id));
      toastTimers.current.delete(id);
      if (!hold)
        toastTimers.current.set(
          id,
          window.setTimeout(() => {
            toastTimers.current.delete(id);
            dismiss(id);
          }, 3500),
        );
    },
    [dismiss],
  );
  const go = useCallback((p, pid) => {
    setPage(p);
    if (pid !== void 0) setProjectId(pid);
  }, []);
  const refreshClaude = useCallback(async () => {
    try {
      const s = await api.claudeStatus();
      setClaude(s);
      return s;
    } catch {
      return null;
    }
  }, []);
  const refreshProjects = useCallback(async () => {
    const p = await api.projects();
    setProjects(p);
    return p;
  }, []);
  const setChannel = useCallback((c) => {
    setChannelState(c);
    try {
      localStorage.setItem(CHANNEL_KEY, c);
    } catch {}
    api.setConfig({ ui: { channel: c } }).catch(() => {});
  }, []);
  const setListChannel = useCallback((c) => {
    const b = where.current.brand;
    setListChannelState((m) => ({ ...m, [b]: c }));
    try {
      localStorage.setItem(LIST_CHANNEL_KEY[b], c);
    } catch {}
    api.setConfig({ ui: { [LIST_CHANNEL_CFG[b]]: c } }).catch(() => {});
  }, []);
  const refreshChannels = useCallback(async () => {
    const l = await api.channels();
    setChannels(l);
    const gone = (c) => c !== "all" && c !== "none" && !l.some((x) => x.id === c);
    setChannelState((c) => {
      if (gone(c)) {
        try {
          localStorage.setItem(CHANNEL_KEY, "all");
        } catch {}
        api.setConfig({ ui: { channel: "all" } }).catch(() => {});
        return "all";
      }
      return c;
    });
    setListChannelState((m) => {
      const n = { ...m };
      let changed = false;
      for (const b of ["faceless", "personal"])
        if (gone(m[b])) {
          n[b] = "all";
          changed = true;
          try {
            localStorage.setItem(LIST_CHANNEL_KEY[b], "all");
          } catch {}
          api.setConfig({ ui: { [LIST_CHANNEL_CFG[b]]: "all" } }).catch(() => {});
        }
      return changed ? n : m;
    });
    return l;
  }, []);
  const setBrand = useCallback((b, then) => {
    if (b === where.current.brand) {
      if (then) {
        setPage(then.page);
        if (then.projectId !== void 0) setProjectId(then.projectId);
      }
      return;
    }
    setThumbFor(null);
    setBrandState(b);
    try {
      localStorage.setItem(BRAND_KEY, b);
    } catch {}
    api.setConfig({ ui: { brand: b } }).catch(() => {});
    if (then) {
      setPage(then.page);
      setProjectId(then.projectId ?? null);
      return;
    }
    if (!BRAND_PAGES[b].includes(where.current.page)) setPage("home");
    api
      .config()
      .then((c) => {
        const last = b === "personal" ? c.lastPersonalProjectId : c.lastProjectId;
        setProjectId(last || null);
        if (!last && where.current.page === "editor") setPage("home");
      })
      .catch(() => setProjectId(null));
  }, []);
  const openProject = useCallback(
    (p) => {
      const b = p.kind === "personal" ? "personal" : "faceless";
      setBrand(b, { page: "editor", projectId: p.id });
    },
    [setBrand],
  );
  const returnBrand = useRef(null);
  const setNewProject = useCallback(
    (v, made) => {
      setNewProjectState(v);
      if (v) return;
      setNewPrefill(null);
      const back = returnBrand.current;
      returnBrand.current = null;
      if (back && !made) setBrand(back);
    },
    [setBrand],
  );
  const startNew = useCallback(
    (prefill) => {
      const b = prefill?.kind;
      if (b && b !== where.current.brand) {
        returnBrand.current = where.current.brand;
        setBrand(b);
      }
      setNewPrefill(prefill ?? null);
      setNewProjectState(true);
    },
    [setBrand],
  );
  const signIn = useCallback(async () => {
    setSigningIn(true);
    setLoginLog([]);
    try {
      const s = await api.claudeLogin();
      setClaude(s);
      toast(s.loggedIn ? "Signed in to Claude." : "Sign-in did not finish. Try again.", s.loggedIn ? "ok" : "bad");
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setSigningIn(false);
    }
  }, [toast]);
  useEffect(() => {
    refreshClaude();
    refreshChannels().catch(() => {});
    refreshProjects()
      .then((list) =>
        api.voiceInterrupted().then((js) =>
          js.forEach((j) => {
            const name = list.find((p) => p.id === j.projectId)?.name;
            if (!name) return;
            toast(
              `The voiceover for “${name}” was stopped when the app closed.${j.installed ? " It is in; cleaning and timing it did not finish." : j.provider === "elevenlabs" ? " The parts already made are kept: finishing it costs only the rest." : ""}`,
              "info",
              { label: "Open", run: () => openVoiceover(j.projectId) },
              `voice:${j.projectId}`,
            );
          }),
        ),
      )
      .catch(() => {});
    api
      .config()
      .then((c) => {
        const b = c.ui?.brand === "personal" ? "personal" : "faceless";
        setBrandState(b);
        try {
          localStorage.setItem(BRAND_KEY, b);
        } catch {}
        const ch = typeof c.ui?.channel === "string" && c.ui.channel ? c.ui.channel : "all";
        setChannelState(ch);
        try {
          localStorage.setItem(CHANNEL_KEY, ch);
        } catch {}
        const lc = (b2) => {
          const v = c.ui?.[LIST_CHANNEL_CFG[b2]];
          const x = typeof v === "string" && v ? v : "all";
          try {
            localStorage.setItem(LIST_CHANNEL_KEY[b2], x);
          } catch {}
          return x;
        };
        setListChannelState({ faceless: lc("faceless"), personal: lc("personal") });
      })
      .catch(() => {});
    api
      .rules()
      .then((r) => setSuggestions(r.filter((x) => x.status === "suggested").length))
      .catch(() => {});
    const libT = window.setTimeout(
      () =>
        api
          .libraryProposed()
          .then(setLibProposed)
          .catch(() => {}),
      2500,
    );
    api
      .running()
      .then((r) => {
        if (r.length) setWorking((w) => new Set([...w, ...r.map((x) => x.projectId)]));
      })
      .catch(() => {});
    const offs = [
      on("projects:covers", () => {
        refreshProjects();
      }),
      // a card picture was made in the background
      // a channel, an idea or a project's place changed (any page): counts, chips and filters follow
      on("channels:changed", (e) => {
        if (e?.what !== "files") refreshChannels().catch(() => {});
        if (e?.what === "board") refreshProjects().catch(() => {});
      }),
      on("claude:login-log", (l) => setLoginLog((x) => [...x.slice(-30), l])),
      on("claude:event", (ev) => {
        if (ev.type === "started") setWorking((w) => new Set(w).add(ev.projectId));
        if (ev.type === "done") {
          setWorking((w) => {
            const n = new Set(w);
            n.delete(ev.projectId);
            return n;
          });
          const here =
            (where.current.page === "editor" && where.current.projectId === ev.projectId) ||
            (where.current.page === "studio" && studioRef.current === ev.projectId);
          const ok = ev.status === "done" || ev.status === "no-change";
          if (!here)
            toast(
              ok
                ? `Claude finished: ${ev.edit?.instruction?.slice(0, 60) || "edit"}${ev.status === "no-change" ? " (no changes)" : ""}`
                : `Claude stopped: ${String(ev.error ?? ev.status).slice(0, 80)}`,
              ok ? "ok" : "bad",
              { label: "Open", run: () => showProject(ev.projectId) },
            );
        }
      }),
      // app-wide: how a voiceover ended, wherever the user is (unless its dialog shows it already); a failure nobody saw
      // also stays marked on the project's Voice step until its dialog has shown it
      on("voice:progress", (j) => {
        if (j.status === "running") return;
        if (j.installed) refreshProjects().catch(() => {});
        if (j.status === "cancelled" || voiceDialogs.has(j.projectId)) return;
        const key = `${j.startedAt}:${j.status}`;
        if (voiceEnded.current.get(j.projectId) === key) return;
        voiceEnded.current.set(j.projectId, key);
        if (j.seen) return;
        const here = where.current.page === "editor" && where.current.projectId === j.projectId;
        const name = names.current.find((p) => p.id === j.projectId)?.name,
          of = !here && name ? ` for “${name}”` : "";
        const changed = j.scriptChanged ? " The script changed while it was being read: make it again for the new text." : "";
        const tag = `voice:${j.projectId}`;
        const unheard = unheardWords(j);
        if (j.status === "done" && unheard)
          toast(
            `Voiceover${of} ready${j.duration ? ` (${fmtPlayed(j.duration)})` : ""}, but ${unheard} of ${j.timing.total} words of the script were not heard when it was timed.${changed}`,
            "info",
            { label: "Open", run: () => openVoiceover(j.projectId) },
            tag,
          );
        else if (j.status === "done")
          toast(
            `Voiceover${of} ready${j.duration ? ` (${fmtPlayed(j.duration)})` : ""}${j.autoTime ? ": cleaned and timed." : "."}${changed}`,
            j.scriptChanged ? "info" : "ok",
            here ? void 0 : { label: "Open", run: () => showProject(j.projectId) },
            tag,
          );
        else
          toast(
            j.installed
              ? `The voiceover${of} is in, but ${j.phase === "clean" ? "cleaning the audio" : "timing the words"} did not finish${brief(j.error)}`
              : `The voiceover${of} stopped${brief(j.error)}`,
            "bad",
            { label: "Open", run: () => openVoiceover(j.projectId) },
            tag,
          );
      }),
      // a routine finished, failed a video or waits for an approval: said wherever you are (Routines shows it already)
      on("routines:notice", (n) => {
        if (where.current.page !== "routines")
          toast(`${n.title}: ${n.body}`, /failed|could not|problems/i.test(n.title) ? "bad" : "info", {
            label: "Open",
            run: () => go("routines"),
          });
      }),
      on("library:changed", (c) => setLibProposed(+c?.proposed || 0)),
      on("rules:suggested", (r) => {
        setSuggestions((n) => n + 1);
        toast(`Claude suggests a ${r.scope} rule: "${r.text}"`, "info", { label: "Review", run: () => go("memory") });
      }),
      // Claude's pictures could not be made (no Higgsfield key, no connection, no credits): say so once a minute, not per image
      on("images:blocked", (b) => {
        if (/API key in Settings first/.test(b.message)) {
          noticeImageKey("Claude needs to make pictures for this video, but image generation is not set up yet.");
          return;
        }
        if (Date.now() - blockedAt.current < 6e4) return;
        blockedAt.current = Date.now();
        toast(
          `Claude can't make the pictures for this video: ${b.message} It stops instead of drawing poor stand-ins; ask it to continue once this is fixed.`,
          "bad",
          { label: "Settings", run: () => openSettings("image") },
        );
      }),
    ];
    const t = setInterval(refreshClaude, 5 * 60 * 1e3);
    return () => {
      offs.forEach((f) => f());
      clearInterval(t);
      clearTimeout(libT);
    };
  }, []);
  const [thumbFor, setThumbFor] = useState(null);
  const [keyNotice, noticeImageKey] = useState(null);
  const [help, setHelp] = useState({ open: false, mode: "chat", n: 0 });
  const openHelp = useCallback(
    (o) => setHelp({ open: true, mode: o?.mode ?? (o?.error ? "report" : "chat"), error: o?.error, where: o?.where, n: Date.now() }),
    [],
  );
  const closeHelp = useCallback(() => setHelp((h) => ({ ...h, open: false })), []);
  const value = useMemo(
    () => ({
      page,
      projectId,
      go,
      toast,
      toasts,
      dismiss,
      dismissTag,
      holdToast,
      claude,
      refreshClaude,
      signIn,
      signingIn,
      loginLog,
      projects,
      allProjects,
      refreshProjects,
      brand,
      setBrand,
      openProject,
      channels,
      refreshChannels,
      channel,
      setChannel,
      listChannel,
      setListChannel,
      palette,
      setPalette,
      newProject,
      setNewProject,
      newPrefill,
      startNew,
      suggestions,
      setSuggestions,
      libProposed,
      setLibProposed,
      working,
      thumbFor,
      setThumbFor,
      keyNotice,
      noticeImageKey,
      voiceReq,
      openVoiceover,
      clearVoiceReq,
      rewriteReq,
      openRewrite,
      clearRewriteReq,
      settingsReq,
      openSettings,
      clearSettingsReq,
      studioPrefill,
      studioId,
      startStudio,
      openStudio,
      importId,
      openImport,
      help,
      openHelp,
      closeHelp,
    }),
    [
      page,
      projectId,
      go,
      toast,
      toasts,
      dismiss,
      dismissTag,
      holdToast,
      claude,
      refreshClaude,
      signIn,
      signingIn,
      loginLog,
      projects,
      allProjects,
      refreshProjects,
      brand,
      setBrand,
      openProject,
      channels,
      refreshChannels,
      channel,
      setChannel,
      listChannel,
      setListChannel,
      palette,
      newProject,
      setNewProject,
      newPrefill,
      startNew,
      suggestions,
      libProposed,
      working,
      thumbFor,
      keyNotice,
      voiceReq,
      openVoiceover,
      clearVoiceReq,
      rewriteReq,
      openRewrite,
      clearRewriteReq,
      settingsReq,
      openSettings,
      clearSettingsReq,
      studioPrefill,
      studioId,
      startStudio,
      openStudio,
      importId,
      openImport,
      help,
      openHelp,
      closeHelp,
    ],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
