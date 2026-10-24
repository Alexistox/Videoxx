import { useEffect, useRef, useState } from "react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import {
  Boxes,
  Download,
  Ellipsis,
  FolderOpen,
  Info,
  PackagePlus,
  ShieldCheck,
  Sparkles,
  Trash,
  Undo2,
  WandSparkles,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { isMac } from "../help/keys";
import { Spinner } from "../components/ui";
import { MenuList, Popover } from "../components/Picker";
import { isStandard, premiumMsg, usePlan } from "../state/usePlan";

export const FOLDER_APP = isMac ? "Finder" : "Explorer";
const BASE_SHORT = {
  "pixel-art": "Pixel art",
  collage: "Vox",
  flat: "Flat",
  stickman: "Stick figures",
  recon: "3D reconstruction",
  lowpoly: "Low poly",
  starter: "Starter",
};
export const baseName = (b) => (b && BASE_SHORT[b]) || b || "its base";
export const errText = (e) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
const unfinished = (r) => r.status !== "installed" && r.status !== "cancelled";
export const runName = (r) =>
  r.pkg?.name ??
  r.source
    .split(/[\\/]/)
    .filter(Boolean)
    .pop()
    ?.replace(/\.zip$/i, "") ??
  "Style package";
const RUN_STATUS = {
  running: "Checking…",
  "needs-fix": "Needs fixes",
  fixing: "Claude is fixing it",
  ready: "Ready to add",
  installed: "Added",
  failed: "Stopped",
  cancelled: "Cancelled",
};
export function useStyleKit() {
  const { toast, openImport } = useApp();
  const std = isStandard(usePlan());
  const [picking, setPicking] = useState(false),
    [kitBusy, setKitBusy] = useState(false);
  const importFrom = async (how, picked) => {
    if (std) {
      toast(premiumMsg("Custom styles"));
      return;
    }
    if (picking) return;
    setPicking(true);
    try {
      const src = how === "zip" && !isMac ? await api.importPickZip() : await api.importPickFolder();
      if (!src) return;
      picked?.();
      const run = await api.importStart(src);
      openImport(run.id);
    } catch (e) {
      toast(errText(e), "bad");
    } finally {
      setPicking(false);
    }
  };
  const getKit = async () => {
    if (std) {
      toast(premiumMsg("Custom styles"));
      return;
    }
    if (kitBusy) return;
    setKitBusy(true);
    try {
      const k = await api.makeStyleKit();
      if (k)
        toast(
          `The Style Kit is ready: ${k.folder}. ${k.guide ? "Its guide is open: section 4 shows how to start Claude Code in it." : "Start Claude Code in that folder."}`,
          "ok",
        );
    } catch (e) {
      toast(errText(e), "bad");
    } finally {
      setKitBusy(false);
    }
  };
  return { std, picking, kitBusy, importFrom, getKit };
}
export function KitActions() {
  const { std, picking, kitBusy, importFrom, getKit } = useStyleKit();
  const pill = std && <span className="premium-pill">Premium</span>;
  return (
    <div className="sk-actions" role="group" aria-label="Add a style">
      <section className="sk-action sk-import" aria-label="Import style">
        <span className="sk-action-ic">
          <PackagePlus size={19} strokeWidth={1.7} />
        </span>
        <div className="sk-action-body">
          <h3>Import style{pill}</h3>
          <p>Add a style package made with the Style Kit. The app checks it, then adds it to your styles.</p>
          <div className="row wrap sk-action-btns">
            <button className="btn small primary sk-import-zip" onClick={() => importFrom("zip")} disabled={picking}>
              {picking ? <Spinner size={13} /> : <PackagePlus size={14} />}
              {isMac ? "Choose the package…" : "Choose a .zip…"}
            </button>
            {!isMac && (
              <button className="text-btn link sk-import-folder" onClick={() => importFrom("folder")} disabled={picking}>
                or a folder
              </button>
            )}
            {isMac && <span className="small dim">its .zip or its folder</span>}
          </div>
        </div>
      </section>
      <section className="sk-action sk-kit" aria-label="Get the Style Kit">
        <span className="sk-action-ic">
          <Boxes size={19} strokeWidth={1.7} />
        </span>
        <div className="sk-action-body">
          <h3>Get the Style Kit{pill}</h3>
          <p>Build your own styles in Claude Code with Videoxx's engines. The kit comes with a step-by-step guide.</p>
          <div className="row wrap sk-action-btns">
            <button className="btn small sk-getkit" onClick={getKit} disabled={kitBusy}>
              {kitBusy ? (
                <>
                  <Spinner size={13} />
                  Writing the kit…
                </>
              ) : (
                <>
                  <Boxes size={14} />
                  Get the Style Kit
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
export function ImportRuns() {
  const { openImport, toast } = useApp();
  const [runs, setRuns] = useState([]);
  const load = () =>
    api
      .importList()
      .then((l) => setRuns(l.filter(unfinished)))
      .catch(() => {});
  useEffect(() => {
    load();
    const offs = [on("styles:importChanged", load), on("styles:changed", load)];
    return () => offs.forEach((f) => f());
  }, []);
  if (!runs.length) return null;
  return (
    <section className="sk-runs" aria-label="Unfinished imports">
      <div className="sec-title">Unfinished imports</div>
      {runs.map((r) => (
        <div key={r.id} className={`sk-run s-${r.status}`} data-run={r.id}>
          <PackagePlus size={15} strokeWidth={1.7} className="dim" />
          <b className="ellipsis">{runName(r)}</b>
          <span className="small dim">
            {r.checkOnly ? "Re-check" : r.pkg?.isUpdate ? `Update: v${r.pkg.prevVersion} → v${r.pkg.version}` : "New style"}
          </span>
          <span className={`sk-chip s-${r.status}`}>
            {(r.status === "running" || r.status === "fixing") && <Spinner size={11} />}
            {RUN_STATUS[r.status]}
          </span>
          <span className="grow" />
          <button className="btn tiny sk-run-open" onClick={() => openImport(r.id)}>
            Open
          </button>
          <button
            className="btn tiny ghost sk-run-discard"
            onClick={() =>
              api
                .importCancel(r.id)
                .then(load)
                .catch((e) => toast(errText(e), "bad"))
            }
          >
            Discard
          </button>
        </div>
      ))}
    </section>
  );
}
export function CustomStyleCard({ st, info, on: selected, looks, onSelect, onNewLook, onDeleted }) {
  const { toast, openImport } = useApp();
  const std = isStandard(usePlan());
  const pkg = !st.custom;
  const [hover, setHover] = useState(false),
    [busy, setBusy] = useState(null);
  const [menu, setMenu] = useState(false),
    [active, setActive] = useState(-1),
    [kept, setKept] = useState(null);
  const [how, setHow] = useState(false);
  const moreRef = useRef(null),
    howRef = useRef(null);
  const version = info?.version ?? st.version ?? null,
    base = info?.base ?? st.base ?? null;
  const meta = !pkg
    ? `Made in the old style lab · built on ${baseName("collage")}`
    : `${version ? `v${version}` : "v1"} · built on ${baseName(base)} engine${info?.builtOn != null ? ` v${info.builtOn}` : ""}`;
  const tall = !!st.aspects?.length && st.aspects[0] === "9:16" && !st.aspects.includes("16:9");
  const job = async (what, f) => {
    setBusy(what);
    try {
      await f();
    } catch (e) {
      toast(errText(e), "bad");
    } finally {
      setBusy(null);
    }
  };
  const recheck = () =>
    std
      ? toast(premiumMsg("Custom styles"))
      : job("recheck", async () => {
          const r = await api.recheckStyle(st.id);
          openImport(r.id);
        });
  const exportPkg = () =>
    job("export", async () => {
      const r = await api.exportPackage(st.id);
      if (!r) return;
      const say = `Bring this package back: ${r.file}`;
      toast(`Package saved: ${r.file}. To bring it into the Style Kit, tell Claude there: "${say}".`, "ok", {
        label: "Copy",
        run: () =>
          api
            .copy(say)
            .then(() => toast("Copied. Paste it into Claude Code in your Style Kit."))
            .catch(() => {}),
      });
    });
  const openMenu = () => {
    setMenu((m) => !m);
    setActive(-1);
    if (pkg)
      api
        .styleVersions(st.id)
        .then((v) => setKept(v.kept.slice().sort((a, b) => b.version - a.version)))
        .catch(() => setKept([]));
  };
  const goBack = (n) =>
    toast(
      `Go back to v${n} of "${st.name}"? It is added again as the newest version, so the one you have now stays in its versions. Your videos keep the version they use.`,
      "info",
      {
        label: `Go back to v${n}`,
        run: () =>
          job("versions", async () => {
            const r = await api.restoreStyleVersion(st.id, n);
            toast(`"${r.name}" is v${n} again (added as v${r.version}).`);
          }),
      },
    );
  const del = () =>
    toast(`Delete the style "${st.name}"? Its looks go with it. This can't be undone.`, "info", {
      label: "Delete",
      run: () =>
        job("delete", async () => {
          await api.deleteStyle(st.id);
          toast("Style deleted.");
          onDeleted();
        }),
    });
  const opts = [
    ...(pkg
      ? kept === null
        ? [{ value: "v:wait", label: "Loading versions…", group: "Versions", disabled: true }]
        : kept.length
          ? kept.map((k) => ({
              value: `v:${k.version}`,
              label: `Go back to v${k.version}`,
              hint: `Engine v${k.engineVersion}${k.updated ? ` · ${new Date(k.updated).toLocaleDateString()}` : ""}`,
              group: "Versions",
              icon: <Undo2 size={14} />,
            }))
          : [
              {
                value: "v:none",
                label: "No earlier versions",
                hint: "Each import of this style keeps the one before (the last 3).",
                group: "Versions",
                disabled: true,
              },
            ]
      : []),
    ...(st.dir ? [{ value: "folder", label: `Show in ${FOLDER_APP}`, group: "Style", icon: <FolderOpen size={14} /> }] : []),
    { value: "delete", label: "Delete style", group: "Style", icon: <Trash size={14} /> },
  ];
  const pick = (o) => {
    setMenu(false);
    if (o.value.startsWith("v:")) goBack(+o.value.slice(2));
    else if (o.value === "folder" && st.dir) api.open(st.dir).catch((e) => toast(errText(e), "bad"));
    else if (o.value === "delete") del();
  };
  return (
    <div className={`sk-card ${selected ? "on" : ""}`} data-style={st.id}>
      <button
        className="sk-card-main"
        onClick={onSelect}
        aria-pressed={selected}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        <span className={`sk-poster ${tall ? "tall" : ""}`} aria-hidden="true">
          {hover && st.preview ? (
            <video src={st.preview} poster={st.poster ?? void 0} autoPlay muted loop playsInline />
          ) : st.poster ? (
            <img src={st.poster} alt="" />
          ) : (
            <span className="sk-noposter">
              <Sparkles size={22} strokeWidth={1.5} />
            </span>
          )}
        </span>
        <span className="sk-card-txt">
          <b className="sk-name">{st.name}</b>
          <small className="sk-meta">{meta}</small>
          <small className="muted sk-tag">
            {st.tagline}
            {looks > 1 ? ` · ${looks} looks` : ""}
          </small>
        </span>
      </button>
      {info?.engineUpdate && (
        <div className="sk-note" role="note">
          <span>
            {baseName(base)}
            {" engine v"}
            {info.baseEngine}
            {" is available: update it in the Style Kit."}
          </span>
          <button ref={howRef} className="text-btn link sk-note-how" onClick={() => setHow((h) => !h)}>
            How?
          </button>
          <Popover anchor={howRef} open={how} onClose={() => setHow(false)} width={340} className="sk-how">
            <div className="sk-how-body">
              <b>Move "{st.name}" to the new engine</b>
              <ol>
                <li>
                  {"Styles > Custom > "}
                  <b>Get the Style Kit</b>, and pick the same folder as before: the engines are refreshed, your styles stay.
                </li>
                <li>
                  {"Start Claude Code in the kit and type: "}
                  <code>
                    {"Update "}
                    {st.name}
                    {" to the new engine."}
                  </code>
                  {" (Claude runs "}
                  <code>cz rebase</code>, merges and checks it.)
                </li>
                <li>
                  {"Package it and "}
                  <b>Import style</b>
                  {" here: it becomes the next version. Your videos keep theirs until you update them."}
                </li>
              </ol>
              <p className="small dim">Your style keeps working on its own engine: you only need this for what the new engine brings.</p>
            </div>
          </Popover>
        </div>
      )}
      <div className="sk-card-acts">
        {!st.missing && (
          <button
            className="btn tiny sk-newlook"
            onClick={onNewLook}
            title={`A look = ${st.name} with your own settings (colours, grade, camera, captions)`}
          >
            <WandSparkles size={12} />
            New look{std && <span className="premium-pill">Premium</span>}
          </button>
        )}
        {pkg && (
          <button
            className="btn tiny sk-recheck"
            onClick={recheck}
            disabled={!!busy}
            title="Run every import check on this style again (nothing is changed)"
          >
            {busy === "recheck" ? <Spinner size={11} /> : <ShieldCheck size={12} />}Re-check
          </button>
        )}
        {pkg && (
          <button
            className="btn tiny sk-export"
            onClick={exportPkg}
            disabled={!!busy}
            title="Save this style as a package (.zip), e.g. to bring the app's fixes back into the Style Kit"
          >
            {busy === "export" ? <Spinner size={11} /> : <Download size={12} />}Export package
          </button>
        )}
        <span className="grow" />
        <button
          ref={moreRef}
          className="icon-btn sm sk-more"
          aria-label={`More for ${st.name}`}
          aria-expanded={menu}
          title={pkg ? "Versions, folder, delete" : "Folder, delete"}
          onClick={openMenu}
          disabled={!!busy && busy !== "versions"}
        >
          {busy === "delete" || busy === "versions" ? <Spinner size={13} /> : <Ellipsis size={16} />}
        </button>
        <Popover anchor={moreRef} open={menu} onClose={() => setMenu(false)} width={250} maxHeight={Infinity} swallowClick>
          <MenuList id={`sk-menu-${st.id}`} options={opts} active={active} onHover={setActive} onPick={pick} label={`${st.name}: more`} />
        </Popover>
      </div>
    </div>
  );
}
export function NoCustomStyles() {
  return (
    <section className="panel pad custom-empty sk-empty" aria-label="Your styles">
      <Info size={18} strokeWidth={1.7} style={{ color: "var(--mint)" }} />
      <div>
        <h3>No custom styles yet</h3>
        <p className="muted">
          Get the Style Kit and build a style with Claude Code on your computer (its guide walks you through it), then import the package
          here. Your style shows up in New project, Routines and the Look panel, like the built-in ones.
        </p>
      </div>
    </section>
  );
}
