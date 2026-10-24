import { useEffect, useState } from "react";
import { api, on } from "../src/renderer/src/lib/api";
import { useApp } from "../src/renderer/src/state/AppProvider";
import {
  Check,
  FlaskConical,
  Shuffle,
  Sparkles,
  Trash,
  TriangleAlert,
  UserRound,
  WandSparkles,
} from "../node_modules/lucide-react/dist/esm/lucide-react";
import { Spinner } from "../src/renderer/src/components/ui";
import { isStandard, premiumMsg, usePlan } from "../src/renderer/src/state/usePlan";

const SOURCE = { builtin: "Built in", random: "Random", claude: "Designed by Claude" };
export function Characters() {
  const { toast, go, claude, refreshProjects } = useApp();
  const std = isStandard(usePlan());
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(null);
  const [desc, setDesc] = useState("");
  const [change, setChange] = useState(null);
  const [steps, setSteps] = useState({});
  const load = (pick) =>
    api
      .characters()
      .then((l) => {
        setList(l);
        setSel((s) => pick ?? (s && l.some((c2) => c2.id === s) ? s : (l[0]?.id ?? null)));
      })
      .catch((e) => toast(e.message, "bad"));
  useEffect(() => {
    load();
    const offs = [
      on("characters:changed", (c2) => {
        load();
        if (c2.status === "ready") toast(`${c2.name} is ready in your characters.`, "ok");
        else if (c2.status === "failed") toast(`${c2.name}: ${String(c2.error ?? "not finished").split("\n")[0]}`, "bad");
      }),
      on("characters:progress", (p) => setSteps((x) => ({ ...x, [p.projectId]: p.step }))),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  const c = list?.find((x) => x.id === sel) ?? null;
  const random = async () => {
    setBusy("random");
    try {
      const n = await api.randomCharacter();
      await load(n.id);
      toast(`Meet ${n.name}. Make them the default to use them in new videos.`, "ok");
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const create = async () => {
    if (std) return toast(premiumMsg("Designing characters with Claude"));
    if (!claude?.loggedIn) {
      toast("Connect Claude first (Settings): Claude designs the character.", "bad");
      return;
    }
    setBusy("create");
    try {
      const r = await api.createCharacter(desc.trim());
      setDesc("");
      await load(r.character.id);
      refreshProjects();
      toast("Claude is designing your character in a character lab (about 5-15 minutes). It appears here when it is done.", "ok", {
        label: "Watch",
        run: () => go("editor", r.projectId),
      });
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const makeDefault = async (id) => {
    try {
      setList(await api.setDefaultCharacter(id));
      toast("Default character set: new videos in this style star them.", "ok");
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const refine = async () => {
    if (!c) return;
    if (!claude?.loggedIn) {
      toast("Connect Claude first (Settings).", "bad");
      return;
    }
    setBusy("refine");
    try {
      const pid = await api.refineCharacter(c.id, change ?? "");
      setChange(null);
      refreshProjects();
      go("editor", pid);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const del = (x) =>
    toast(`Delete ${x.name}? Videos that already use them keep their copy.`, "info", {
      label: "Delete",
      run: async () => {
        try {
          await api.deleteCharacter(x.id);
          await load();
          toast("Character deleted.");
        } catch (e) {
          toast(e.message, "bad");
        }
      },
    });
  if (!list)
    return (
      <div className="loading">
        <Spinner /> <span className="small">Loading your characters…</span>
      </div>
    );
  return (
    <div className="chars">
      <section className="panel pad chars-make" aria-label="Make a character">
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={random} disabled={!!busy}>
            {busy === "random" ? <Spinner size={14} /> : <Shuffle size={15} strokeWidth={1.8} />}Random character
          </button>
          <span className="small dim">or</span>
          <input
            className="input grow"
            style={{ minWidth: 260 }}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            maxLength={600}
            aria-label="Describe a character"
            placeholder="Describe one, e.g. a retired astronaut with a white beard and a patched flight jacket"
            onKeyDown={(e) => e.key === "Enter" && desc.trim().length >= 3 && !busy && create()}
          />
          <button className="btn primary" onClick={create} disabled={!!busy || desc.trim().length < 3}>
            {busy === "create" ? <Spinner size={14} /> : <Sparkles size={15} strokeWidth={1.8} />}Design with Claude
            {std && <span className="premium-pill">Premium</span>}
          </button>
        </div>
        <span className="help">
          Random characters are made instantly from the style's parts and are yours alone. A described one is designed by Claude (Opus) in a
          character lab, checked in every pose, and lands here when it's done.
        </span>
      </section>
      <div className="chars-body">
        <div className="char-grid" role="listbox" aria-label="Your characters">
          {list.map((ch) => (
            <button
              key={ch.id}
              role="option"
              aria-selected={ch.id === sel}
              className={`char-card ${ch.id === sel ? "on" : ""}`}
              onClick={() => {
                setSel(ch.id);
                setChange(null);
              }}
            >
              <span className="char-thumb">
                {ch.status === "designing" ? (
                  <Spinner size={22} />
                ) : ch.thumb ? (
                  <img src={ch.thumb} alt="" />
                ) : (
                  <UserRound size={30} strokeWidth={1.4} />
                )}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <b className="ellipsis">{ch.name}</b>
                {ch.default && (
                  <span className="badge mint">
                    <Check size={11} />
                    Default
                  </span>
                )}
              </span>
              <small className="muted">
                {ch.status === "designing"
                  ? (ch.lab && steps[ch.lab]) || "Claude is designing…"
                  : ch.status === "failed"
                    ? "Not finished"
                    : SOURCE[ch.source]}
              </small>
            </button>
          ))}
        </div>
        {c && (
          <section className="panel pad char-detail" aria-label={c.name}>
            <div className="char-stage">
              {c.status === "ready" ? (
                <iframe key={`${c.id}-${c.updated}`} src={c.view} title={`${c.name}, live preview`} />
              ) : c.status === "designing" ? (
                <div className="char-wait">
                  <Spinner size={26} />
                  <span>{(c.lab && steps[c.lab]) || "Claude is designing this character…"}</span>
                </div>
              ) : (
                <div className="char-wait">
                  <TriangleAlert size={24} />
                  <span>Not finished</span>
                </div>
              )}
            </div>
            <div className="char-info">
              <div className="row" style={{ gap: 8 }}>
                <h3>{c.name}</h3>
                <span className="badge gray">{SOURCE[c.source]}</span>
              </div>
              <p className="muted">{c.about}</p>
              {c.prompt && <p className="small dim">Asked for: “{c.prompt}”</p>}
              {c.error && (
                <p className="small err-text" style={{ whiteSpace: "pre-wrap" }}>
                  {c.error}
                </p>
              )}
              <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {c.default ? (
                  <span className="badge mint">
                    <Check size={12} />
                    Default for new videos
                  </span>
                ) : (
                  <button className="btn primary small" disabled={c.status !== "ready"} onClick={() => makeDefault(c.id)}>
                    <Check size={14} />
                    Use as default
                  </button>
                )}
                {c.lab && (
                  <button className="btn small" onClick={() => go("editor", c.lab)}>
                    <FlaskConical size={14} strokeWidth={1.8} />
                    {c.status === "designing" ? "Watch Claude design it" : "Open its lab"}
                  </button>
                )}
                {c.id !== "mo" && c.status !== "designing" && change === null && (
                  <button className="btn small" onClick={() => setChange("")}>
                    <WandSparkles size={14} strokeWidth={1.8} />
                    Change with Claude
                  </button>
                )}
                {c.id !== "mo" && c.status !== "designing" && !c.default && (
                  <button className="btn small danger" onClick={() => del(c)}>
                    <Trash size={14} />
                    Delete
                  </button>
                )}
              </div>
              {change !== null && (
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <input
                    className="input grow"
                    autoFocus
                    value={change}
                    onChange={(e) => setChange(e.target.value)}
                    placeholder="What should change? e.g. give her a red scarf and curly hair"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) refine();
                      if (e.key === "Escape") setChange(null);
                    }}
                    aria-label="What should change"
                  />
                  <button className="btn primary small" onClick={refine} disabled={!!busy}>
                    {busy === "refine" ? <Spinner size={13} /> : <Sparkles size={14} />}Open lab{change.trim() ? " and ask" : ""}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
