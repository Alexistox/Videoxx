// Videoxx add-on: the "Connections" panel at the top of Settings > Media. Many named connections
// for pictures and voice (API keys, local tools, command-line tools such as the Higgsfield CLI);
// "Use" puts one into the app's own slot. Plain DOM, part of the original code.
(() => {
  const ANCHOR = '[data-setting="image"]';
  const ID = "vx-connections";
  const invoke = (ch, ...a) =>
    window.suite.invoke(ch, ...a).catch((e) => {
      throw new Error(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    });

  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
    return e;
  };
  const select = (options, value, onchange) => {
    const s = el("select", { onchange: () => onchange?.(s.value) }, options.map(([v, label]) => el("option", { value: v, selected: v === value }, label)));
    return s;
  };

  const KIND_NAME = { image: "Pictures", voice: "Voice" };
  const ADD_TYPES = [
    ["hf-cli", "Higgsfield CLI (signed in on this computer)", ["image", "voice"]],
    ["builtin:elevenlabs", "ElevenLabs API key", ["voice"]],
    ["builtin:fish", "Fish Audio API key", ["voice"]],
    ["builtin:higgsfield", "Higgsfield API key", ["image"]],
    ["builtin:fal", "Fal.ai API key", ["image"]],
    ["claude:apikey", "Another service with an API key (Claude writes the connector)", ["image", "voice"]],
    ["claude:local", "A local tool, e.g. ComfyUI or a local TTS (Claude writes the connector)", ["image", "voice"]],
    ["claude:cli", "A command-line tool (Claude writes the connector)", ["image", "voice"]],
  ];
  const VARIANTS = [["elevenlabs", "ElevenLabs"], ["minimax", "MiniMax"], ["seed_speech", "Seed Speech"], ["vibe_voice", "Vibe Voice"], ["cozy_voice", "Cozy Voice"]];

  let state = null, hfModels = null, lastNote = { text: "", bad: false };

  const describe = (c) => {
    if (c.via === "builtin") return `${c.provider} key ${c.keyHint || ""}`;
    if (c.template === "higgsfield-cli-image") return `Higgsfield CLI · ${c.settings.model}`;
    if (c.template === "higgsfield-cli-voice") return `Higgsfield CLI · ${c.settings.variant}`;
    if (c.auth === "local") return `local tool · ${c.url}`;
    if (c.auth === "cli") return `command-line tool · ${c.cliPath}`;
    return `API key ${c.keyHint || "(none)"}`;
  };

  async function use(c, note) {
    const r = await invoke("customapi:vxActivate", { id: c.id });
    await invoke("config:set", r.kind === "image" ? { images: { provider: r.provider } } : { voice: { provider: r.provider } });
    if (r.kind === "voice" && r.provider === "custom") invoke("voice:customVoices", true).catch(() => {});
    note(`${KIND_NAME[r.kind]} now use "${c.name}". Reopen Settings to see it in the sections below.`);
    await refresh();
  }

  function row(c, note) {
    const extra = [];
    if (c.template === "higgsfield-cli-image" && hfModels?.image?.length) {
      extra.push(select(hfModels.image.map((m) => [m.id, m.name]), c.settings.model, async (model) => {
        await invoke("customapi:vxUpdate", { id: c.id, settings: { model } });
        note(`"${c.name}" now uses ${model}.`);
        await refresh();
      }));
    }
    if (c.template === "higgsfield-cli-voice") {
      extra.push(select(VARIANTS, c.settings.variant, async (variant) => {
        await invoke("customapi:vxUpdate", { id: c.id, settings: { variant } });
        note(`"${c.name}" now uses ${variant}.`);
        await refresh();
      }));
    }
    return el("div", { style: "display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.06);flex-wrap:wrap" },
      el("div", { style: "flex:1;min-width:200px" },
        el("b", {}, c.name),
        c.active ? el("span", { style: "margin-left:8px;font-size:11px;padding:2px 8px;border-radius:9px;background:rgba(126,226,168,.15);color:#7ee2a8" }, "In use") : null,
        el("small", { style: "display:block;opacity:.65" }, describe(c))),
      ...extra,
      c.active ? null : el("button", { class: "btn small primary", onclick: () => use(c, note).catch((e) => note(e.message, true)) }, "Use"),
      c.via === "adapter" ? el("button", { class: "btn small", onclick: async () => {
        note(c.kind === "image" ? `Testing "${c.name}": making one small picture (uses a little credit)…` : `Testing "${c.name}": listing its voices…`);
        const r = await invoke("customapi:vxTest", { id: c.id }).catch((e) => ({ ok: false, message: e.message }));
        note(r.message, !r.ok);
      } }, "Test") : null,
      el("button", { class: "btn small ghost", onclick: async () => {
        if (!confirm(`Remove the connection "${c.name}"?`)) return;
        await invoke("customapi:vxRemove", { id: c.id });
        note(`Removed "${c.name}".${c.active ? " The app keeps using it until you pick another one." : ""}`);
        await refresh();
      } }, "Remove"));
  }

  function addForm(note) {
    const kind = select([["image", "Pictures"], ["voice", "Voice"]], "image", () => sync());
    const type = el("select", { onchange: () => sync() });
    const name = el("input", { placeholder: "Name (optional), e.g. Eleven work account", style: "width:100%" });
    const key = el("input", { type: "password", placeholder: "API key", autocomplete: "off", spellcheck: "false", style: "width:100%" });
    const url = el("input", { placeholder: "Address, e.g. http://127.0.0.1:8188", style: "width:100%" });
    const cli = el("input", { placeholder: "Program path, e.g. C:\\tools\\mytool.exe", style: "width:100%" });
    const desc = el("textarea", { rows: 3, placeholder: "What it is and how to use it: service or tool name, model, a link to its docs, anything Claude should know.", style: "width:100%" });
    const hfInfo = el("small", { style: "display:block;opacity:.7" });
    const fields = { name, key, url, cli, desc, hfInfo };
    const sync = () => {
      const k = kind.value, prev = type.value;
      type.replaceChildren(...ADD_TYPES.filter(([, , kinds]) => kinds.includes(k)).map(([v, label]) => el("option", { value: v }, label)));
      if ([...type.options].some((o) => o.value === prev)) type.value = prev;
      const t = type.value;
      const show = { name: true, key: t.startsWith("builtin:") || t === "claude:apikey", url: t === "claude:local", cli: t === "claude:cli", desc: t.startsWith("claude:"), hfInfo: t === "hf-cli" };
      for (const [f, e] of Object.entries(fields)) e.style.display = show[f] ? "" : "none";
      hfInfo.textContent = state?.higgsfieldCli ? `Found: ${state.higgsfieldCli}. Credits come from the workspace selected in the CLI.` : "The Higgsfield CLI was not found. Install it (npm install -g @higgsfield/cli) and run: higgsfield auth login";
    };
    const add = el("button", { class: "btn small primary", onclick: async () => {
      const t = type.value, k = kind.value;
      try {
        if (t === "hf-cli") {
          const c = await invoke("customapi:vxAddTemplate", { template: k === "image" ? "higgsfield-cli-image" : "higgsfield-cli-voice", name: name.value });
          note(`Added "${c.name}". Press Use to switch to it.`);
        } else if (t.startsWith("builtin:")) {
          const c = await invoke("customapi:vxAddBuiltin", { provider: t.slice(8), name: name.value, key: key.value });
          note(`Added "${c.name}". Press Use to switch to it.`);
        } else {
          await createWithClaude(k, t.slice(7), note);
        }
        name.value = key.value = url.value = cli.value = desc.value = "";
        await refresh();
      } catch (e) {
        note(e.message, true);
      }
    } }, "Add");

    async function createWithClaude(k, auth, note) {
      const b = await invoke("customapi:vxBegin", { kind: k, auth, name: name.value, key: key.value, url: url.value, cliPath: cli.value, description: desc.value });
      note("Claude is reading the docs and writing the connector. This takes a few minutes…");
      let s = await invoke("customapi:setup", k, b.brief, b.key);
      for (let i = 0; i < 900 && (s.status === "running" || s.status === "verifying"); i++) {
        await new Promise((r) => setTimeout(r, 2000));
        s = await invoke("customapi:state", k);
        const last = (s.log || []).slice(-1)[0];
        if (last) note(`Claude: ${String(last).slice(0, 160)}`);
      }
      if (s.status !== "ready") throw new Error(s.error || "Claude could not finish the connector.");
      const c = await invoke("customapi:vxCapture", { kind: k });
      await invoke("config:set", k === "image" ? { images: { provider: "custom" } } : { voice: { provider: "custom" } });
      note(`"${c.name}" works and is now in use for ${KIND_NAME[k].toLowerCase()}.`);
    }

    setTimeout(sync);
    return el("div", { style: "margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08);display:grid;gap:8px" },
      el("b", {}, "Add a connection"),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, kind, type),
      hfInfo, name, key, url, cli, desc,
      el("div", {}, add));
  }

  function render() {
    const note = el("small", { style: "display:block;margin-top:8px;min-height:1em" });
    const show = () => {
      note.textContent = lastNote.text;
      note.style.color = lastNote.bad ? "#ff8a8a" : "";
    };
    // the message survives the re-render that follows most actions
    const say = (text, bad) => {
      lastNote = { text, bad: !!bad };
      show();
    };
    show();
    const lists = ["image", "voice"].map((k) => {
      const mine = state.connectors.filter((c) => c.kind === k);
      return el("div", { style: "margin-top:12px" },
        el("b", { style: "font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.7" }, KIND_NAME[k]),
        mine.length ? mine.map((c) => row(c, say)) : el("small", { style: "display:block;opacity:.6;padding:6px 0" }, "No connections yet."));
    });
    const section = el("section", { id: ID, class: "panel", style: "margin-top:25px", "aria-label": "Connections" },
      el("div", { class: "settings-row", "data-setting": "vx-connections", style: "display:block" },
        el("div", { class: "l" },
          el("h3", {}, "Connections"),
          el("p", {}, "Keep several services, keys and tools for pictures and voice, and switch with Use. Keys are stored encrypted on this computer.")),
        ...lists, addForm(say), note));
    return section;
  }

  async function refresh() {
    state = await invoke("customapi:vxList");
    if (!hfModels && state.higgsfieldCli) hfModels = await invoke("customapi:vxHfModels").catch(() => null);
    const old = document.getElementById(ID);
    if (old) {
      const fresh = render();
      old.replaceWith(fresh);
    }
  }

  let busy = false;
  async function mount() {
    if (busy || document.getElementById(ID)) return;
    const anchor = document.querySelector(ANCHOR)?.closest("section");
    if (!anchor) return;
    busy = true;
    try {
      state = await invoke("customapi:vxList");
      if (!hfModels && state.higgsfieldCli) hfModels = await invoke("customapi:vxHfModels").catch(() => null);
      if (!document.getElementById(ID) && anchor.isConnected) anchor.before(render());
    } catch {
      // without the main-side add-on there is nothing to show
    } finally {
      busy = false;
    }
  }

  new MutationObserver(() => mount()).observe(document.documentElement, { childList: true, subtree: true });
})();
