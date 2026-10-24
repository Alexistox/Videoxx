import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Copy, ImagePlus, Pencil, Plus, Star, Trash } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Modal } from "../components/ui";
import { drawFrame } from "./canvasDraw";
import { LayoutPanel, loadBackground } from "./LayoutPanel";
import { LayoutHandles } from "./PersonalEditor";

function Preview({ settings, w = 480 }) {
  const c = useRef(null);
  useEffect(() => {
    let alive = true;
    loadBackground(settings.background.image).then((bg) => {
      if (!alive || !c.current) return;
      const d = Math.min(2, devicePixelRatio),
        W = Math.round(w * d),
        H = Math.round((W * 9) / 16);
      c.current.width = W;
      c.current.height = H;
      drawFrame(c.current.getContext("2d"), W, H, settings, bg, { mode: "layout", screen: null, cam: null, placeholders: true });
    });
    return () => {
      alive = false;
    };
  }, [settings, w]);
  return <canvas ref={c} className="ly-canvas" aria-label="Layout preview" />;
}
export function Layouts() {
  const { toast } = useApp();
  const [list, setList] = useState([]);
  const [bgs, setBgs] = useState([]);
  const [edit, setEdit] = useState(null);
  const reload = () => {
    api
      .layouts()
      .then(setList)
      .catch((e) => toast(e.message, "bad"));
    api
      .backgrounds()
      .then(setBgs)
      .catch(() => {});
  };
  useEffect(reload, []);
  const makeDefault = async (p) => {
    await api.setDefaultLayout(p.id);
    reload();
    toast(`New videos start with "${p.name}".`);
  };
  const remove = (p) =>
    toast(`Delete the layout "${p.name}"? Videos already using it keep their look.`, "info", {
      label: "Delete",
      run: async () => {
        try {
          await api.deleteLayoutPreset(p.id);
          reload();
        } catch (e) {
          toast(e.message, "bad");
        }
      },
    });
  const save = async () => {
    if (!edit || !edit.name.trim()) return;
    try {
      await api.saveLayoutPreset({ id: edit.id, name: edit.name.trim(), settings: edit.settings });
      setEdit(null);
      reload();
      toast(`Saved "${edit.name.trim()}".`);
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const addBg = async () => {
    const f = await api.pickFile("Add a background image", [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }]);
    if (!f) return;
    try {
      await api.addBackground(f);
      reload();
      toast("Background added. Pick it in any layout.");
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const fresh = () => {
    const d = list.find((p) => p.is_default) ?? list[0];
    if (d) setEdit({ id: null, name: "", settings: structuredClone(d.settings) });
  };
  return (
    <div className="page page-enter">
      <div className="page-head">
        <div>
          <h1>Layouts</h1>
          <div className="sub">
            How your Personal Brand videos are framed. The starred one is used for every new video; each video can still change its own in
            the editor.
          </div>
        </div>
        <button className="btn primary" onClick={fresh}>
          <Plus size={15} />
          New layout
        </button>
      </div>
      <div className="ly-grid">
        {list.map((p) => (
          <div key={p.id} className={`ly-card ${p.is_default ? "default" : ""}`}>
            <button
              className="ly-pic"
              onClick={() =>
                setEdit({
                  id: p.builtin ? null : p.id,
                  name: p.builtin ? `${p.name} (mine)` : p.name,
                  settings: structuredClone(p.settings),
                })
              }
              title={p.builtin ? "Copy and change" : "Edit"}
            >
              <Preview settings={p.settings} />
            </button>
            <div className="ly-meta">
              <b className="ellipsis">{p.name}</b>
              {p.builtin ? <span className="ly-tag">Built-in</span> : null}
              <span className="grow" />
              {p.is_default ? (
                <span className="ly-default">
                  <Star size={12} fill="currentColor" />
                  Default
                </span>
              ) : (
                <button className="btn tiny" onClick={() => makeDefault(p)}>
                  <Star size={12} />
                  Make default
                </button>
              )}
            </div>
            <div className="ly-acts">
              {p.builtin ? (
                <button
                  className="btn tiny ghost"
                  onClick={() => setEdit({ id: null, name: `${p.name} (mine)`, settings: structuredClone(p.settings) })}
                >
                  <Copy size={12} />
                  Copy and change
                </button>
              ) : (
                <>
                  <button
                    className="btn tiny ghost"
                    onClick={() => setEdit({ id: p.id, name: p.name, settings: structuredClone(p.settings) })}
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                  <button className="btn tiny ghost" onClick={() => remove(p)}>
                    <Trash size={12} />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="sec-title" style={{ marginTop: 34 }}>
        Backgrounds
      </div>
      <div className="ly-bgs">
        {bgs.map((b) => (
          <BgTile key={b.id} id={b.id} name={b.name} builtin={b.builtin} />
        ))}
        <button className="ly-bg add" onClick={addBg}>
          <ImagePlus size={18} strokeWidth={1.6} />
          <span>Add your own</span>
        </button>
      </div>
      {edit && (
        <Modal title={edit.id ? "Edit layout" : "New layout"} onClose={() => setEdit(null)} wide className="ly-modal">
          <div className="modal-body">
            <div className="ly-edit">
              <div className="ly-edit-stage">
                <div className="ly-stage">
                  <Preview settings={edit.settings} w={760} />
                  <LayoutHandles layout={edit.settings} onChange={(s) => setEdit((e) => e && { ...e, settings: s })} />
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label htmlFor="ly-name">Name</label>
                  <input
                    id="ly-name"
                    className="input"
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    placeholder="e.g. Tutorial, big cam"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && save()}
                  />
                </div>
              </div>
              <div className="ly-edit-panel">
                <LayoutPanel layout={edit.settings} onChange={(s) => setEdit((e) => e && { ...e, settings: s })} hidePresets />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={!edit.name.trim()}>
                Save layout
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function BgTile({ id, name, builtin }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    api
      .backgroundData(id)
      .then(setSrc)
      .catch(() => {});
  }, [id]);
  return (
    <div className="ly-bg" title={name}>
      {src ? <img src={src} alt={name} /> : null}
      <span>
        {name}
        {builtin ? "" : " · yours"}
      </span>
    </div>
  );
}
