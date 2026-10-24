// Videoxx add-on: the "Claude connection" panel at the top of Settings (account login,
// Anthropic API key, or Claude Code token). Plain DOM, part of the original code:
// it waits for the Settings page and adds its own section above "Workspace".
(() => {
  const ANCHOR = '[data-setting="scale"]';
  const ID = "vx-auth";
  const invoke = (ch, ...a) => window.suite.invoke(ch, ...a);

  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };

  const MODES = [
    ["account", "Claude account", "Sign in with your Claude plan (Pro/Max), as before."],
    ["apikey", "Anthropic API key", "Pay per token from console.anthropic.com. No sign-in needed."],
    ["token", "Claude Code token", "A long-lived token from “claude setup-token”; uses your Claude plan."],
  ];

  function build(state) {
    let mode = state.mode;
    const note = el("small", { style: "display:block;margin-top:8px" });
    const say = (text, bad) => {
      note.textContent = text;
      note.style.color = bad ? "#ff8a8a" : "";
    };

    const keyInput = el("input", { type: "password", placeholder: state.apikey ? `Saved ${state.apikey}: paste a new key to replace it` : "sk-ant-api03-…", autocomplete: "off", spellcheck: "false", style: "width:100%" });
    const tokenInput = el("input", { type: "password", placeholder: state.token ? `Saved ${state.token}: paste a new token to replace it` : "sk-ant-oat01-…", autocomplete: "off", spellcheck: "false", style: "width:100%" });
    const keyRow = el("div", { style: "margin-top:10px" }, keyInput);
    const tokenRow = el("div", { style: "margin-top:10px" }, tokenInput);

    const radios = MODES.map(([value, label, help]) =>
      el("label", { style: "display:flex;gap:8px;align-items:flex-start;margin:6px 0;cursor:pointer" },
        el("input", { type: "radio", name: "vx-auth-mode", value, ...(value === mode ? { checked: "" } : {}), onchange: () => { mode = value; show(); } }),
        el("span", {}, el("b", {}, label), el("small", { style: "display:block;opacity:.7" }, help))));

    const fallbackBox = el("input", { type: "checkbox", ...(state.fallback ? { checked: "" } : {}) });
    const fallbackKey = el("input", { type: "password", placeholder: state.apikey ? `API key ${state.apikey} is saved: paste a new one to replace it` : "API key for the fallback: sk-ant-api03-…", autocomplete: "off", spellcheck: "false", style: "width:100%;margin-top:6px" });
    const fallbackNow = el("small", { style: "display:block;margin-top:6px" });
    const backBtn = el("button", { class: "btn tiny", style: "margin-left:8px", onclick: async () => {
      render(await invoke("claude:vxAuthSet", { backToPlan: true }));
      say("Back on your Claude plan.");
    } }, "Back to my plan now");
    const fallbackRow = el("div", { style: "margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)" },
      el("label", { style: "display:flex;gap:8px;align-items:flex-start;cursor:pointer" }, fallbackBox,
        el("span", {}, el("b", {}, "When my Claude plan runs out, use my API key"),
          el("small", { style: "display:block;opacity:.7" }, "Only while the plan's limit lasts: Videoxx goes back to the plan when it resets. Billed per token on the key. The run that hit the limit stops; start it again and it runs on the key."))),
      fallbackKey, el("div", {}, fallbackNow, backBtn));
    const render = (s) => {
      const until = s.limitedUntil ? new Date(s.limitedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
      fallbackNow.textContent = s.onFallback ? `Now on the API key ${s.apikey}: your plan resets at ${until}.` : until ? `Your plan was out of usage until ${until}.` : "";
      backBtn.style.display = s.onFallback ? "" : "none";
    };
    render(state);

    const show = () => {
      keyRow.style.display = mode === "apikey" ? "" : "none";
      tokenRow.style.display = mode === "token" ? "" : "none";
      testBtn.style.display = mode === "apikey" || fallbackBox.checked ? "" : "none";
      fallbackRow.style.display = mode === "apikey" ? "none" : "";
      fallbackKey.style.display = fallbackBox.checked ? "" : "none";
    };
    fallbackBox.addEventListener("change", () => show());

    const saveBtn = el("button", { class: "btn small primary", onclick: async () => {
      try {
        const patch = { mode, fallback: fallbackBox.checked };
        if (keyInput.value.trim()) patch.apikey = keyInput.value;
        if (fallbackKey.value.trim()) patch.apikey = fallbackKey.value;
        if (tokenInput.value.trim()) patch.token = tokenInput.value;
        const s = await invoke("claude:vxAuthSet", patch);
        keyInput.value = "";
        fallbackKey.value = "";
        tokenInput.value = "";
        fallbackKey.placeholder = s.apikey ? `API key ${s.apikey} is saved: paste a new one to replace it` : "API key for the fallback: sk-ant-api03-…";
        render(s);
        if (s.fallback && !s.apikey && s.mode !== "apikey") {
          say("Saved, but the fallback needs an API key: paste one above.", true);
          return;
        }
        keyInput.placeholder = s.apikey ? `Saved ${s.apikey}: paste a new key to replace it` : "sk-ant-api03-…";
        tokenInput.placeholder = s.token ? `Saved ${s.token}: paste a new token to replace it` : "sk-ant-oat01-…";
        if (s.active !== s.mode) say(s.mode === "apikey" ? "Saved, but no API key yet: Claude keeps using your account." : "Saved, but no token yet: Claude keeps using your account.", true);
        else say(s.mode === "account" ? "Claude uses your Claude account." : s.mode === "apikey" ? `Claude now runs on the API key ${s.apikey}.` : `Claude now runs on the token ${s.token}.`);
        invoke("claude:status").catch(() => {});
      } catch (e) {
        say(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
      }
    } }, "Save");

    const testBtn = el("button", { class: "btn small", style: "margin-left:8px", onclick: async () => {
      say("Checking the key…");
      const r = await invoke("claude:vxAuthTest").catch((e) => ({ ok: false, message: e.message }));
      say(r.message, !r.ok);
    } }, "Test key");

    const clearBtn = el("button", { class: "btn small ghost", style: "margin-left:8px", onclick: async () => {
      const s = await invoke("claude:vxAuthSet", { mode: "account", apikey: "", token: "", fallback: false, backToPlan: true });
      mode = s.mode;
      fallbackBox.checked = false;
      render(s);
      radios.forEach((r) => { r.querySelector("input").checked = r.querySelector("input").value === mode; });
      keyInput.placeholder = "sk-ant-api03-…";
      tokenInput.placeholder = "sk-ant-oat01-…";
      show();
      say("Key and token removed. Claude uses your Claude account.");
    } }, "Remove saved key/token");

    const section = el("section", { id: ID, class: "panel", style: "margin-top:25px", "aria-label": "Claude connection" },
      el("div", { class: "settings-row", "data-setting": "vx-auth", style: "display:block" },
        el("div", { class: "l" },
          el("h3", {}, "Claude connection"),
          el("p", {}, "How Videoxx connects to Claude. A key or token is stored encrypted on this computer.")),
        el("div", { style: "margin-top:10px" }, ...radios, keyRow, tokenRow, fallbackRow,
          el("div", { style: "margin-top:12px" }, saveBtn, testBtn, clearBtn), note)));
    show();
    say(state.onFallback ? `Now: the API key ${state.apikey} (plan out of usage).` : state.active === "account" ? "Now: your Claude account." : state.active === "apikey" ? `Now: the API key ${state.apikey}.` : `Now: the token ${state.token}.`);
    return section;
  }

  let busy = false;
  async function mount() {
    if (busy || document.getElementById(ID)) return;
    const anchor = document.querySelector(ANCHOR)?.closest("section");
    if (!anchor) return;
    busy = true;
    try {
      const state = await invoke("claude:vxAuthGet");
      if (!document.getElementById(ID) && anchor.isConnected) anchor.before(build(state));
    } catch {
      // without the main-side add-on there is nothing to show
    } finally {
      busy = false;
    }
  }

  new MutationObserver(() => mount()).observe(document.documentElement, { childList: true, subtree: true });
})();
