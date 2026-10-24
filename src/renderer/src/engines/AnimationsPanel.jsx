import { useEffect, useState } from "react";
import { FolderOpenIcon, TrashIcon, UploadIcon } from "lucide-react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { isMac } from "../help/keys";
import { Spinner } from "../components/ui";

export function AnimationsPanel() {
  const { toast } = useApp();
  const [lib, setLib] = useState(null),
    [busy, setBusy] = useState(false),
    [prog, setProg] = useState(null);
  const [sure, setSure] = useState(null),
    [q, setQ] = useState("");
  const load = () =>
    api
      .animsList()
      .then(setLib)
      .catch((e) => toast(e.message, "bad"));
  useEffect(() => {
    load();
    const off1 = on("anims:changed", () => load()),
      off2 = on("anims:progress", (p) => setProg(p && p.total && p.done < p.total ? p : null));
    return () => {
      off1?.();
      off2?.();
    };
  }, []);
  const doImport = async () => {
    setBusy(true);
    try {
      const r = await api.animsImport();
      const n = r.imported.length,
        bits = [
          n ? `${n} clip${n === 1 ? "" : "s"} added` : null,
          r.skipped.length ? `${r.skipped.length} already there` : null,
          r.failed.length ? `${r.failed.length} could not be read` : null,
        ].filter(Boolean);
      if (bits.length) toast(bits.join(", ") + (r.failed.length ? `: ${r.failed[0].error}` : ""), r.failed.length && !n ? "bad" : "info");
      load();
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
      setProg(null);
    }
  };
  const remove = async (id) => {
    if (sure !== id) {
      setSure(id);
      return;
    }
    setSure(null);
    try {
      await api.animsRemove(id);
      load();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const list = (lib?.user ?? []).filter(
    (e) => !q.trim() || (e.name + " " + e.tags.join(" ")).toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <section className="panel" style={{ marginTop: 25 }} aria-label="Character animations">
      <div className="settings-row anims-row" data-setting="character-animations">
        <div className="l">
          <h3>Character animations</h3>
          <p>
            {"The moves 3D reconstruction characters can make: Claude picks them by name or kind (sit, phone, walk…). "}
            {lib ? `${lib.builtin} free clips come with the app.` : ""}
            {
              " Add your own from mixamo.com: sign in with your own free Adobe account, pick a motion, then Download as FBX, Without Skin, 30 frames per second, and tick In Place for walks and runs. Import the files here, or drop them into the inbox folder and they are added by themselves. Your clips stay on this computer."
            }
          </p>
          <button className="btn small ghost" onClick={() => api.animsFolder().catch((e) => toast(e.message, "bad"))}>
            <FolderOpenIcon size={14} />
            {isMac ? "Show in Finder" : "Show in File Explorer"}
          </button>
        </div>
        <div className="r">
          <div className="opt">
            <span>
              Your clips
              <small>{lib ? `${lib.user.length} of your own${lib.user.length ? "" : " yet"} · inbox: ${lib.inbox}` : "Checking…"}</small>
            </span>
            <button className="btn small" disabled={busy} onClick={doImport}>
              {busy ? <Spinner size={12} /> : <UploadIcon size={14} />}Import FBX…
            </button>
          </div>
          {prog && (
            <div className="opt anims-progress">
              <span>
                {"Importing "}
                {prog.done + 1}
                {" of "}
                {prog.total}
                <small>{prog.file}</small>
              </span>
            </div>
          )}
          {!!lib?.user.length && lib.user.length > 8 && (
            <input
              className="input compact"
              aria-label="Search your animations"
              placeholder="Search your clips"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: "100%", margin: "6px 0" }}
            />
          )}
          {!!lib?.user.length && (
            <div className="anims-list" role="list" style={{ maxHeight: 320, overflowY: "auto" }}>
              {list.map((e) => (
                <div key={e.id} role="listitem" className="opt anims-item" data-anim={e.id}>
                  <span>
                    {e.name}
                    <small>
                      {e.duration.toFixed(1)}
                      {" s"}
                      {e.loop ? " · loops" : ""}
                      {e.inPlace ? "" : " · travels"}
                      {" · "}
                      {e.tags.join(", ")}
                    </small>
                  </span>
                  <button className="btn small ghost" title={`Remove ${e.name}`} onClick={() => remove(e.id)}>
                    <TrashIcon size={13} />
                    {sure === e.id ? "Remove?" : "Remove"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
