// Videoxx add-on: the "ChatGPT for side features" panel in Settings, right after the section with the ChatGPT (Codex)
// row. One master switch, the ChatGPT model, and one switch per feature. Plain DOM, part of the original code.
(() => {
  const ANCHOR = '[data-setting="chatgpt"]';
  const ID = "vx-chatgpt";
  const invoke = (ch, ...a) => window.suite.invoke(ch, ...a);
  const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

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

  function build(st) {
    const note = el("small", { style: "display:block;margin-top:8px;min-height:1em" });
    const say = (text, bad) => {
      note.textContent = text;
      note.style.color = bad ? "#ff8a8a" : "";
    };
    const body = el("div", { style: "margin-top:10px" });
    const send = async (input, okText, undo) => {
      try {
        st = await invoke("claude:vxChatgptSet", input);
        say(okText);
        render();
      } catch (e) {
        undo?.();
        say(clean(e), true);
      }
    };

    function render() {
      body.replaceChildren();
      const master = el("input", { type: "checkbox", id: "vx-chatgpt-on", ...(st.enabled ? { checked: true } : {}) });
      master.addEventListener("change", () => send({ enabled: master.checked }, master.checked ? "Side features run on ChatGPT when it is ready; otherwise on Claude." : "Side features run on Claude.", () => (master.checked = !master.checked)));
      body.append(el("label", { for: "vx-chatgpt-on", style: "display:flex;gap:10px;align-items:center;padding:7px 0;cursor:pointer" }, master, el("b", {}, "Use ChatGPT for these features")));

      const pick = el("select", { id: "vx-chatgpt-model", style: "margin-left:10px", ...(st.enabled ? {} : { disabled: true }) },
        ...st.models.map((m) => el("option", { value: m.id, ...(m.id === st.model ? { selected: true } : {}) }, m.name)));
      pick.addEventListener("change", () => send({ model: pick.value }, `Model: ${pick.selectedOptions[0]?.textContent}.`));
      body.append(el("div", { style: "padding:4px 0 8px" }, el("label", { for: "vx-chatgpt-model" }, "Model"), pick));

      for (const [k, name] of Object.entries(st.names)) {
        const box = el("input", { type: "checkbox", id: `vx-chatgpt-${k}`, ...(st.features[k] ? { checked: true } : {}), ...(st.enabled ? {} : { disabled: true }) });
        box.addEventListener("change", () => send({ features: { [k]: box.checked } }, `${name}: ${box.checked ? "ChatGPT" : "Claude"}.`, () => (box.checked = !box.checked)));
        body.append(el("label", { for: `vx-chatgpt-${k}`, style: `display:flex;gap:10px;align-items:center;padding:6px 0 6px 18px;border-top:1px solid rgba(255,255,255,.06);cursor:pointer;${st.enabled ? "" : "opacity:.5"}` }, box, el("span", {}, name)));
      }
    }
    render();

    return el("section", { id: ID, class: "panel", style: "margin-top:25px", "aria-label": "ChatGPT for side features" },
      el("div", { class: "settings-row", "data-setting": "vx-chatgpt", style: "display:block" },
        el("div", { class: "l" },
          el("h3", {}, "ChatGPT for side features"),
          el("p", {}, "Run the app's smaller AI jobs on your ChatGPT plan instead of Claude. Needs ChatGPT (Codex) signed in above. If ChatGPT is not ready or fails, the job runs on Claude as before. Ultraedit, the Style Studio, character design and the critics stay on Claude.")),
        body, note));
  }

  let busy = false;
  async function mount() {
    if (busy || document.getElementById(ID)) return;
    const anchor = document.querySelector(ANCHOR)?.closest("section");
    if (!anchor) return;
    busy = true;
    try {
      const st = await invoke("claude:vxChatgptGet");
      if (!document.getElementById(ID) && anchor.isConnected) anchor.after(build(st));
    } catch {
      // without the main-side add-on there is nothing to show
    } finally {
      busy = false;
    }
  }

  new MutationObserver(() => mount()).observe(document.documentElement, { childList: true, subtree: true });
})();
