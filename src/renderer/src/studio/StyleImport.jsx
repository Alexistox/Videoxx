import { useEffect, useState } from "react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import {
  ArrowLeft,
  CircleCheck,
  CircleDot,
  CircleMinus,
  Copy,
  Download,
  PackagePlus,
  Sparkles,
  Square,
  TriangleAlert,
  WandSparkles,
  X,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Spinner } from "../components/ui";
import { isStandard, premiumMsg, usePlan } from "../state/usePlan";
import { baseName, errText, runName } from "../looks/StyleKit";

const IC = {
  wait: <CircleDot size={15} className="dim" />,
  running: <Spinner size={14} />,
  ok: <CircleCheck size={15} />,
  fail: <TriangleAlert size={15} />,
  skip: <CircleMinus size={15} className="dim" />,
};
const SEV = [
  ["high", "High", "These stop the style from being added."],
  ["medium", "Medium", "Worth fixing; they don't block it."],
  ["low", "Low", "Small things."],
  ["info", "Notes", ""],
];
const whereText = (w) =>
  [
    w.file ? `${w.file}${w.line ? `:${w.line}` : ""}` : null,
    w.view ? `view ${w.view}` : null,
    w.aspect,
    typeof w.t === "number" ? `${w.t.toFixed(1)} s` : null,
  ]
    .filter(Boolean)
    .join(" · ");
export function StyleImport() {
  const { importId, go, toast, startNew } = useApp();
  const std = isStandard(usePlan());
  const [run, setRun] = useState(void 0),
    [busy, setBusy] = useState(null);
  useEffect(() => {
    if (!importId) {
      setRun(null);
      return;
    }
    api
      .importState(importId)
      .then(setRun)
      .catch(() => setRun(null));
    return on("styles:importChanged", (r) => {
      if (r?.id === importId) setRun(r.status === "cancelled" ? null : { ...r });
    });
  }, [importId]);
  const toStyles = (styleId) => {
    try {
      sessionStorage.setItem("cz-styles-tab", `custom:${styleId ?? ""}`);
    } catch {}
    go("presets");
  };
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
  if (run === void 0)
    return (
      <div className="loading">
        <Spinner />
      </div>
    );
  if (!run)
    return (
      <div className="page page-enter sk-imp">
        <button className="btn ghost small sk-back" onClick={() => toStyles()}>
          <ArrowLeft size={14} />
          Styles
        </button>
        <div className="hint warn">
          <TriangleAlert size={18} />
          <div>
            <b>This import is gone</b>
            <p>{"It was cancelled or finished. Import the package again from Styles > Custom > Import style."}</p>
          </div>
        </div>
      </div>
    );
  const checkOnly = !!run.checkOnly,
    pkg = run.pkg,
    name = runName(run);
  const live = run.status === "running" || run.status === "fixing",
    fixing = run.status === "fixing" || !!run.fix?.running;
  const high = run.findings.filter((f) => f.sev === "high"),
    shown = run.findings,
    gone = run.status === "installed";
  const canFix = !checkOnly && run.status === "needs-fix" && high.length > 0;
  const lastRound = run.fix?.rounds?.[run.fix.rounds.length - 1] ?? null;
  const frameFor = (w) => {
    if (gone) return null;
    const l = (run.frames ?? []).filter((f) => (!w.view || f.view === w.view) && (!w.aspect || f.aspect === w.aspect));
    if (!w.view && !w.aspect) return null;
    return typeof w.t === "number" ? (l.sort((a, b) => Math.abs(a.t - w.t) - Math.abs(b.t - w.t))[0] ?? null) : (l[0] ?? null);
  };
  const fix = () => (std ? toast(premiumMsg("Custom styles")) : job("fix", () => api.importFix(run.id).then(setRun)));
  const copyList = () =>
    job("copy", async () => {
      const t = await api.importFixList(run.id);
      await api.copy(t);
      toast("Fix list copied. Paste it into Claude Code in your Style Kit.");
    });
  const cancel = () =>
    job("cancel", async () => {
      await api.importCancel(run.id);
      toast(checkOnly ? "Re-check closed." : "Import cancelled. Your package file is untouched.");
      toStyles(run.checkOnly);
    });
  const add = () =>
    std
      ? toast(premiumMsg("Custom styles"))
      : job("add", async () => {
          const r = await api.importInstall(run.id);
          setRun({ ...r });
        });
  const exportPkg = () =>
    job("export", async () => {
      const r = await api.exportPackage(run.checkOnly);
      if (r) toast(`Package saved: ${r.file}`, "ok");
    });
  const kind = checkOnly
    ? `Re-check${pkg ? ` of v${pkg.prevVersion ?? pkg.version}` : ""}`
    : pkg?.isUpdate
      ? `Update: v${pkg.prevVersion} → v${pkg.version}`
      : pkg
        ? "New style"
        : "Style package";
  const head = run.noSample
    ? { cls: "warn", icon: <TriangleAlert size={18} />, b: "Made before the Style Kit: nothing to check", p: run.error ?? "" }
    : run.status === "running"
      ? {
          cls: "run",
          icon: <Spinner size={16} />,
          b: "Checking the style…",
          p: "Every view is loaded and rendered in every format, the way your videos will be. This takes a minute or two; you can leave this page meanwhile.",
        }
      : run.status === "fixing"
        ? {
            cls: "run",
            icon: <Spinner size={16} />,
            b: `Claude is fixing it: round ${Math.max(1, run.round)} of ${run.maxRounds}`,
            p: run.fix?.activity || "It changes only this style's files; then the app checks everything again.",
          }
        : run.status === "needs-fix"
          ? {
              cls: "warn",
              icon: <TriangleAlert size={18} />,
              b: `${high.length} problem${high.length === 1 ? "" : "s"} to fix${checkOnly ? "" : " before it can be added"}`,
              p: checkOnly
                ? "Copy fix list and paste it into Claude Code in your Style Kit, then import the fixed package."
                : lastRound
                  ? `Claude did ${run.fix.rounds.length} round${run.fix.rounds.length === 1 ? "" : "s"}; what is left needs Claude Code in your Style Kit: Copy fix list.`
                  : "Let Claude fix it here, or Copy fix list and paste it into Claude Code in your Style Kit.",
            }
          : run.status === "ready"
            ? {
                cls: "ok",
                icon: <CircleCheck size={18} />,
                b: checkOnly ? "Everything passed" : "Everything passed",
                p: checkOnly
                  ? "The style is fine as it is installed."
                  : `Add it to your styles: it shows up in New project, Routines and the Look panel${pkg?.isUpdate ? `, as v${pkg.version}. Videos made with v${pkg.prevVersion} keep it until you update them` : ""}.`,
              }
            : run.status === "installed"
              ? {
                  cls: "ok",
                  icon: <CircleCheck size={18} />,
                  b: `Added: ${name} v${run.result?.version ?? pkg?.version ?? 1} is in your styles`,
                  p: "Pick it in New project under Custom styles.",
                }
              : {
                  cls: "bad",
                  icon: <TriangleAlert size={18} />,
                  b: run.status === "failed" && run.items[0]?.status === "fail" ? "The package was refused" : "The check stopped",
                  p: run.error ?? "Start the import again.",
                };
  const findingsFirst = !live && high.length > 0;
  return (
    <div className={`page page-enter sk-imp ${findingsFirst ? "sk-ffirst" : ""}`}>
      <button className="btn ghost small sk-back" onClick={() => toStyles(run.result?.id ?? run.checkOnly)}>
        <ArrowLeft size={14} />
        Styles
      </button>
      <header className="sk-imp-head">
        <span className="sk-imp-ic">
          <PackagePlus size={20} strokeWidth={1.7} />
        </span>
        <div className="grow">
          <h1 className="ellipsis" title={name}>
            {name}
          </h1>
          <div className="sk-imp-meta">
            <span className="sk-chip kind">{kind}</span>
            {pkg && (
              <span>
                {"Built on "}
                {baseName(pkg.base)}
              </span>
            )}
            {pkg?.aspects?.length ? <span>{pkg.aspects.join(" · ")}</span> : null}
            <span className="dim ellipsis" title={run.source}>
              {run.source.split(/[\\/]/).filter(Boolean).pop()}
            </span>
          </div>
        </div>
      </header>
      {pkg?.asNew && !checkOnly ? (
        <p className="sk-asnew" role="note">
          {pkg.asNew}
        </p>
      ) : null}
      <div className={`sk-state ${head.cls}`} role="status">
        {head.icon}
        <div className="grow">
          <b>{head.b}</b>
          <p>{head.p}</p>
        </div>
        {fixing && (
          <button
            className="btn small sk-stop"
            onClick={() => job("stop", () => api.importStop(run.id).then(setRun))}
            disabled={busy === "stop"}
          >
            <Square size={12} />
            Stop
          </button>
        )}
      </div>
      {run.status === "installed" ? (
        <div className="sk-done">
          <button className="btn primary sk-use" onClick={() => startNew({ styleId: run.result.id })}>
            <Sparkles size={15} />
            Use it in a new project
          </button>
          <button className="btn sk-backstyles" onClick={() => toStyles(run.result?.id)}>
            Back to Styles
          </button>
        </div>
      ) : (
        <div className="sk-bar">
          {canFix && (
            <button
              className="btn primary sk-fix"
              onClick={fix}
              disabled={!!busy || live}
              title="A Claude inside Videoxx fixes it. It can only change this style's files; the app checks everything again after each round (up to 3)."
            >
              {busy === "fix" ? <Spinner size={14} /> : <WandSparkles size={15} />}Let Claude fix it
              {std && <span className="premium-pill">Premium</span>}
            </button>
          )}
          {!live && (high.length > 0 || run.findings.some((f) => f.sev === "medium")) && (
            <button
              className={`btn ${run.status === "needs-fix" && !canFix ? "primary" : ""} sk-copy`}
              onClick={copyList}
              disabled={!!busy}
              title="The problems as text, for Claude Code in your Style Kit"
            >
              {busy === "copy" ? <Spinner size={14} /> : <Copy size={15} />}Copy fix list
            </button>
          )}
          {checkOnly && (
            <button className="btn sk-export" onClick={exportPkg} disabled={!!busy}>
              <Download size={15} />
              Export package
            </button>
          )}
          <span className="grow" />
          <button className="btn ghost sk-cancel" onClick={cancel} disabled={!!busy}>
            {checkOnly ? (
              <>Done</>
            ) : (
              <>
                <X size={15} />
                Cancel import
              </>
            )}
          </button>
          {!checkOnly && (
            <button
              className="btn primary sk-add"
              onClick={add}
              disabled={run.status !== "ready" || !!busy}
              title={run.status === "ready" ? void 0 : "When every check has passed"}
            >
              {busy === "add" ? <Spinner size={14} /> : <CircleCheck size={15} />}Add to my styles
              {std && <span className="premium-pill">Premium</span>}
            </button>
          )}
        </div>
      )}
      {run.fix?.rounds?.length ? (
        <section className="sk-sec" aria-label="What Claude changed">
          <h2>What Claude changed</h2>
          <ol className="sk-rounds">
            {run.fix.rounds.map((r) => (
              <li key={r.round}>
                <b>
                  {"Round "}
                  {r.round}
                </b>
                <span>
                  {r.changed.length ? `Changed ${r.changed.join(", ")}` : "Changed nothing"}
                  {r.highAfter != null ? ` · high problems ${r.highBefore} → ${r.highAfter}` : ""}
                </span>
                {r.reasons.length > 0 && <small className="dim">{r.reasons.join(" ")}</small>}
                {r.refused.length > 0 && (
                  <small className="dim">
                    {"Not allowed (left unchanged): "}
                    {r.refused.join(", ")}
                  </small>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {!run.noSample && (
        <section className="sk-sec sk-sec-check" aria-label="Checklist">
          <h2>The checklist</h2>
          <ol className="sk-checklist">
            {run.items.map((i) => (
              <li key={i.id} className={`sk-item s-${i.status}`} data-item={i.id}>
                <span className="sk-item-ic">{IC[i.status]}</span>
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                  <b>{i.label}</b>
                  {i.detail && <small className="sk-item-detail">{i.detail}</small>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {shown.length > 0 && (
        <section className="sk-sec" aria-label="Findings">
          <h2>What the checks found</h2>
          {SEV.map(([sev, label, why]) => {
            const l = shown.filter((f) => f.sev === sev);
            if (!l.length) return null;
            return (
              <div key={sev} className={`sk-sevgroup sev-${sev}`}>
                <div className="sk-sevhead">
                  <span className={`sk-sev sev-${sev}`}>{label}</span>
                  <span className="small dim">
                    {l.length}
                    {" · "}
                    {why}
                  </span>
                </div>
                <ul className="sk-findings">
                  {l.map((f, n) => {
                    const fr = frameFor(f.where),
                      w = whereText(f.where);
                    return (
                      <li key={`${f.id}-${n}`} className={`sk-finding sev-${f.sev}`} data-check={f.id}>
                        <div className="grow col" style={{ gap: 4, minWidth: 0 }}>
                          <b className="sk-f-what">{f.finding}</b>
                          {f.meaning && (
                            <span className="sk-f-mean">
                              <i>What it means:</i> {f.meaning}
                            </span>
                          )}
                          {f.fix && (
                            <span className="sk-f-fix">
                              <i>How to fix:</i> {f.fix}
                            </span>
                          )}
                          <small className="sk-f-where">
                            {f.id}
                            {w ? ` · ${w}` : ""}
                          </small>
                        </div>
                        {fr && (
                          <a
                            className={`sk-f-frame ${fr.aspect === "9:16" ? "tall" : ""}`}
                            href={fr.url}
                            target="_blank"
                            rel="noreferrer"
                            title={`${fr.view} · ${fr.aspect} · ${fr.t.toFixed(1)} s`}
                            onClick={(e) => e.preventDefault()}
                          >
                            <img src={fr.url} alt="" loading="lazy" />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>
      )}
      {!gone && run.exports && Object.keys(run.exports).length > 0 && (
        <section className="sk-sec sk-sec-exports" aria-label="Sample exports">
          <h2>The sample, exported</h2>
          <p className="small dim">
            5 seconds of the sample in each format, made the way your exports are (sound off; turn it on in the player).
          </p>
          <div className="sk-exports">
            {Object.entries(run.exports).map(([a, url]) => (
              <figure key={a} className={`sk-export-fig ${a === "9:16" ? "tall" : ""}`}>
                <video src={url} controls muted playsInline preload="metadata" />
                <figcaption>{a}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
