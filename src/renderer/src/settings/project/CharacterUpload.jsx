import { useEffect, useMemo, useState } from "react";
import { api, on } from "../../lib/api";
import { Check, Copy, RefreshCw, Trash, TriangleAlert, Upload } from "../../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Spinner } from "../../components/ui";

const OURS = [
  "pelvis",
  "spine_01",
  "spine_02",
  "spine_03",
  "neck_01",
  "Head",
  ...["l", "r"].flatMap((s) => [
    ...["clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot", "ball"].map((b) => `${b}_${s}`),
    ...["thumb", "index", "middle", "ring", "pinky"].flatMap((f) => ["01", "02", "03"].map((k) => `${f}_${k}_${s}`)),
  ]),
];
const REQUIRED = new Set([
  "pelvis",
  "Head",
  "upperarm_l",
  "lowerarm_l",
  "hand_l",
  "upperarm_r",
  "lowerarm_r",
  "hand_r",
  "thigh_l",
  "calf_l",
  "foot_l",
  "thigh_r",
  "calf_r",
  "foot_r",
]);
const STAGE = {
  reading: "Reading the file…",
  converting: "Finding the skeleton and matching its bones…",
  sheet: "Drawing the test sheet…",
};
export function CharacterUpload({ onPick, picked }) {
  const [list, setList] = useState(null),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState(null),
    [err, setErr] = useState(null);
  const [open, setOpen] = useState(null),
    [licence, setLicence] = useState(""),
    [sure, setSure] = useState(null);
  const load = () =>
    api
      .charsList()
      .then((r) => setList(r.characters))
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const off1 = on("chars:changed", () => load()),
      off2 = on("chars:progress", (p) => setStage(p?.stage && p.stage !== "done" ? p.stage : null));
    return () => {
      off1?.();
      off2?.();
    };
  }, []);
  const upload = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.charsUpload(void 0, { licence: licence.trim() || void 0 });
      if (r) {
        await load();
        setOpen(r.id);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setStage(null);
    }
  };
  const remove = async (id) => {
    if (sure !== id) {
      setSure(id);
      return;
    }
    setSure(null);
    try {
      await api.charsRemove(id);
      if (open === id) setOpen(null);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };
  const cur = list?.find((c) => c.id === open) ?? null;
  return (
    <div className="char-upload" data-chars3d style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn small" disabled={busy} onClick={upload} data-chars3d-upload>
          {busy ? <Spinner size={12} /> : <Upload size={14} />}Upload a character (FBX, GLB, VRM)
        </button>
        <input
          className="input compact"
          aria-label="Licence of the character"
          placeholder="Licence / where it is from (optional)"
          value={licence}
          onChange={(e) => setLicence(e.target.value)}
          style={{ flex: "1 1 200px", minWidth: 160 }}
        />
      </div>
      <small style={{ opacity: 0.75 }}>
        A rigged humanoid: Mixamo, Unreal, Unity / VRoid (VRM), Blender Rigify, Character Creator, Daz and most other skeletons are matched
        by themselves. It moves with every animation the built-in characters have.
      </small>
      {stage && (
        <div className="opt" role="status">
          <span>
            <Spinner size={12} /> {STAGE[stage] ?? "Working…"}
          </span>
        </div>
      )}
      {err && (
        <div className="opt" role="alert" style={{ color: "var(--bad, #e5484d)" }}>
          <span>
            <TriangleAlert size={13} /> {err}
          </span>
        </div>
      )}
      {list && !list.length && <small style={{ opacity: 0.6 }}>No characters of your own yet.</small>}
      {!!list?.length && (
        <div role="list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
          {list.map((c) => (
            <div
              key={c.id}
              role="listitem"
              data-char3d={c.id}
              title={c.name}
              onClick={() => setOpen(open === c.id ? null : c.id)}
              style={{
                cursor: "pointer",
                borderRadius: 8,
                padding: 4,
                border: `2px solid ${picked === c.id ? "var(--accent, #e8742a)" : open === c.id ? "var(--line-strong, #555)" : "transparent"}`,
                background: "var(--bg2, rgba(255,255,255,.04))",
              }}
            >
              {c.thumb ? (
                <img
                  src={c.thumb}
                  alt=""
                  style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", borderRadius: 6, display: "block" }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "4 / 5",
                    borderRadius: 6,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    opacity: 0.7,
                  }}
                >
                  {c.status === "ok" ? "No picture" : "Bones to map"}
                </div>
              )}
              <div style={{ fontSize: 12, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.status !== "ok" ? (
                  <TriangleAlert size={11} />
                ) : c.warnings.length ? (
                  <TriangleAlert size={11} style={{ opacity: 0.6 }} />
                ) : null}{" "}
                {c.name}
              </div>
            </div>
          ))}
        </div>
      )}
      {cur && (
        <CharDetail c={cur} onPick={onPick} onRemove={() => remove(cur.id)} sure={sure === cur.id} onChanged={load} setErr={setErr} />
      )}
    </div>
  );
}
function CharDetail({ c, onPick, onRemove, sure, onChanged, setErr }) {
  const [bones, setBones] = useState(null),
    [map, setMap] = useState({}),
    [edit, setEdit] = useState(c.status !== "ok"),
    [busy, setBusy] = useState(false),
    [paste, setPaste] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    setEdit(c.status !== "ok");
    setBones(null);
    api
      .charsBones(c.id)
      .then((b) => {
        setBones(b);
        setMap(b.map);
      })
      .catch(() => {});
  }, [c.id, c.status]);
  const names = useMemo(() => bones?.bones.map((b) => b.name) ?? [], [bones]);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.charsSetMapping(c.id, map);
      onChanged();
      if (r.status === "ok") setEdit(false);
      else setErr("Still not usable: " + [...r.character.missing.map((m) => "no " + m), ...r.character.problems].slice(0, 4).join("; "));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const resheet = async () => {
    setBusy(true);
    try {
      await api.charsSheet(c.id);
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const fromClaude = (t) => {
    setPaste(t);
    try {
      const j = JSON.parse((/\{[\s\S]*\}/.exec(t) || [""])[0]);
      if (j && typeof j === "object") {
        const m = {};
        for (const [k, v] of Object.entries(j)) if (OURS.includes(k) && typeof v === "string" && names.includes(v)) m[k] = v;
        if (Object.keys(m).length) setMap(m);
      }
    } catch {}
  };
  return (
    <div className="opt" data-char3d-detail={c.id} style={{ display: "block", padding: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ flex: "1 1 auto" }}>{c.name}</b>
        <small style={{ opacity: 0.7 }}>
          {c.rig}
          {" · "}
          {c.height ? `${c.height.toFixed(2)} m` : "?"}
          {" · "}
          {c.bones}
          {" bones · "}
          {c.licence}
        </small>
        {onPick && c.status === "ok" && (
          <button className="btn small" onClick={() => onPick(c.id)}>
            <Check size={13} />
            Use this character
          </button>
        )}
        {c.status === "ok" && (
          <button className="btn small ghost" disabled={busy} onClick={resheet} title="Draw the test sheet again">
            {busy ? <Spinner size={12} /> : <RefreshCw size={13} />}Test again
          </button>
        )}
        <button className="btn small ghost" onClick={() => setEdit(!edit)}>
          {edit ? "Hide bones" : "Bones…"}
        </button>
        <button className="btn small ghost" onClick={onRemove}>
          <Trash size={13} />
          {sure ? "Remove?" : "Remove"}
        </button>
      </div>
      {c.status === "ok" && c.sheet && (
        <img
          src={c.sheet}
          alt={`${c.name} in the test poses`}
          data-char3d-sheet
          style={{ width: "100%", marginTop: 8, borderRadius: 6, display: "block" }}
        />
      )}
      {c.status === "ok" &&
        (c.warnings.length ? (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }} data-char3d-warnings>
            {c.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : (
          <small style={{ display: "block", marginTop: 6, opacity: 0.7 }}>
            Every pose checked: no twisted limbs, hands in place, nothing flying off.
          </small>
        ))}
      {c.status !== "ok" && (
        <p style={{ fontSize: 12, margin: "8px 0 0" }}>
          <TriangleAlert size={12} />
          {" Some bones could not be matched ("}
          {[...c.missing, ...c.problems].slice(0, 4).join("; ")}). Ask Claude, or pick them below.
        </p>
      )}
      {edit && bones && (
        <div style={{ marginTop: 8 }}>
          {c.status !== "ok" && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
              <button
                className="btn small"
                onClick={() => {
                  api
                    .copy(bones.prompt)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                    .catch(() => {});
                }}
              >
                <Copy size={13} />
                {copied ? "Copied" : "Copy for Claude"}
              </button>
              <small style={{ opacity: 0.7 }}>Ask Claude to map the bones, then paste its answer here:</small>
              <textarea
                className="input"
                aria-label="Claude's answer"
                value={paste}
                onChange={(e) => fromClaude(e.target.value)}
                rows={2}
                style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }}
                placeholder={'{ "pelvis": "Hips", ... }'}
              />
            </div>
          )}
          <div style={{ maxHeight: 280, overflowY: "auto", fontSize: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {OURS.map((o) => (
                  <tr key={o}>
                    <td style={{ padding: "2px 6px", whiteSpace: "nowrap", opacity: REQUIRED.has(o) ? 1 : 0.7 }}>
                      {o}
                      {REQUIRED.has(o) ? " *" : ""}
                    </td>
                    <td style={{ padding: "2px 6px", width: "65%" }}>
                      <select
                        className="input compact"
                        aria-label={`Their bone for ${o}`}
                        value={map[o] ?? ""}
                        style={{ width: "100%" }}
                        onChange={(e) =>
                          setMap((m) => {
                            const n = { ...m };
                            if (e.target.value) n[o] = e.target.value;
                            else delete n[o];
                            return n;
                          })
                        }
                      >
                        <option value="">(none)</option>
                        {names.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn small" disabled={busy || [...REQUIRED].some((r) => !map[r])} onClick={save}>
              {busy ? <Spinner size={12} /> : <Check size={13} />}Save the mapping and test
            </button>
            <small style={{ opacity: 0.6, alignSelf: "center" }}>* needed</small>
          </div>
        </div>
      )}
    </div>
  );
}
