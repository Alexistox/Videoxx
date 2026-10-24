// Videoxx add-on: the "Asset library" panel in Settings > Media. One switch per 3D style: on = Claude may search, add
// and place library models (Kenney, Quaternius, Poly Haven, Poly Pizza ... saved on this computer); off = it builds
// everything from the style's own elements. Plain DOM, part of the original code.
(() => {
  const ANCHOR = '[data-setting="image"]';
  const ID = "vx-assets";
  const MODEL_ENGINES = new Set(["lowpoly", "recon", "toon", "starter"]);
  const invoke = (ch, ...a) => window.suite.invoke(ch, ...a);

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

  function build(styles, st) {
    const note = el("small", { style: "display:block;margin-top:8px;min-height:1em" });
    const rows = styles.map((s) => {
      const box = el("input", { type: "checkbox", id: `vx-assets-${s.id}`, ...(st.disabled[s.id] ? {} : { checked: true }) });
      box.addEventListener("change", async () => {
        try {
          await invoke("styles:vxAssetsSet", { styleId: s.id, use: box.checked });
          note.textContent = box.checked ? `${s.name}: Claude may use library assets.` : `${s.name}: Claude builds without library assets.`;
          note.style.color = "";
        } catch (e) {
          box.checked = !box.checked;
          note.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
          note.style.color = "#ff8a8a";
        }
      });
      const hint = s.engine === "lowpoly" ? "its built-in sets and people always use the library" : s.engine === "starter" ? "needs the Videoxx asset loader in the style (Surreal Broll has it)" : "";
      return el("label", { for: `vx-assets-${s.id}`, style: "display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid rgba(255,255,255,.06);cursor:pointer" },
        box, el("span", {}, el("b", {}, s.name), hint ? el("small", { style: "display:block;opacity:.65" }, hint) : null));
    });
    return el("section", { id: ID, class: "panel", style: "margin-top:25px", "aria-label": "Asset library" },
      el("div", { class: "settings-row", "data-setting": "vx-assets", style: "display:block" },
        el("div", { class: "l" },
          el("h3", {}, "Asset library"),
          el("p", {}, "Free 3D models, textures and skies (CC0 / CC-BY, credited) that Claude can search, download and place in 3D styles. Switch a style off to keep its videos to its own elements.")),
        el("div", { style: "margin-top:10px" }, ...rows), note));
  }

  let busy = false;
  async function mount() {
    if (busy || document.getElementById(ID)) return;
    const anchor = document.querySelector(ANCHOR)?.closest("section");
    if (!anchor) return;
    busy = true;
    try {
      const [styles, st] = await Promise.all([invoke("styles:list"), invoke("styles:vxAssetsGet")]);
      const list = (styles || []).filter((s) => MODEL_ENGINES.has(s.engine) && s.id !== "starter" && !s.devPick);
      const after = document.getElementById("vx-connections") || anchor.previousElementSibling;
      if (!document.getElementById(ID) && anchor.isConnected) (after && after.isConnected ? after : anchor).after(build(list, st));
    } catch {
      // without the main-side add-on there is nothing to show
    } finally {
      busy = false;
    }
  }

  new MutationObserver(() => mount()).observe(document.documentElement, { childList: true, subtree: true });
})();
