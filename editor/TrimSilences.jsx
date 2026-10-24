import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../src/renderer/src/lib/api";
import { useApp } from "../src/renderer/src/state/AppProvider";
import { Spinner } from "../src/renderer/src/components/ui";

const TRIM_DEFAULTS = { thr: -40, minMs: 350, amount: 70 };
const TRIM_TAIL = 0.02,
  TRIM_FRAME = 0.01;
function trimCuts(db, s, keep = []) {
  const cuts = [],
    n = db.length;
  let k = 0;
  while (k < n) {
    if (db[k] < s.thr) {
      let m = k;
      while (m < n && db[m] < s.thr) m++;
      const L = (m - k) * TRIM_FRAME;
      if (k > 0 && m < n && L * 1e3 >= s.minMs && !keep.some(([a, b]) => a < m * TRIM_FRAME && b > k * TRIM_FRAME)) {
        const rem = Math.min((L * s.amount) / 100, L - 2 * TRIM_TAIL);
        if (rem >= 0.03) {
          const mid = ((k + m) * TRIM_FRAME) / 2;
          cuts.push([mid - rem / 2, mid + rem / 2]);
        }
      }
      k = m;
    } else k++;
  }
  return cuts;
}
export function TrimSilences({ projectId, onApplied }) {
  const { toast } = useApp();
  const [v, setV] = useState(null),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const [thr, setThr] = useState(TRIM_DEFAULTS.thr),
    [minMs, setMinMs] = useState(TRIM_DEFAULTS.minMs),
    [amount, setAmount] = useState(TRIM_DEFAULTS.amount);
  const cv = useRef(null);
  const load = () =>
    api
      .trimView(projectId)
      .then((r) => {
        setV(r);
        setThr(r.trim.thr);
        setMinMs(r.trim.minMs);
        setAmount(r.trim.amount);
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [projectId]);
  const cuts = useMemo(() => (v ? trimCuts(v.db, { thr, minMs, amount }, v.keep ?? []) : []), [v, thr, minMs, amount]);
  const saved = cuts.reduce((s, [a, b]) => s + b - a, 0);
  useEffect(() => {
    const c = cv.current;
    if (!c || !v) return;
    const W = c.clientWidth,
      H = c.clientHeight,
      dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(c),
      x = (t) => (t / v.duration) * W;
    g.fillStyle = "rgba(235, 64, 52, .6)";
    for (const [a, b] of cuts) g.fillRect(x(a), 0, Math.max(1, x(b) - x(a)), H);
    g.fillStyle = css.getPropertyValue("--accent").trim() || "#7aa2ff";
    const n = v.peaks.length,
      mx = Math.max(0.05, ...v.peaks);
    for (let i = 0; i < n; i++) {
      const h = Math.max(1, (v.peaks[i] / mx) * (H / 2 - 2));
      g.fillRect((i / n) * W, H / 2 - h, Math.max(1, W / n), h * 2);
    }
    const ty = (Math.pow(10, thr / 20) / mx) * (H / 2 - 2);
    g.fillStyle = "rgba(235, 64, 52, .8)";
    g.fillRect(0, H / 2 - ty, W, 1);
    g.fillRect(0, H / 2 + ty, W, 1);
  }, [v, cuts, thr]);
  const apply = async (t) => {
    setBusy(true);
    try {
      const r = await api.trimApply(projectId, t);
      toast(
        !t
          ? "The pauses are back: the voiceover is untouched again."
          : `Cut ${r.cuts} pauses, ${r.removed.toFixed(1)} s shorter.` +
              (r.moved
                ? " The word times moved with it. Mix the sound again (Pipeline: Sound design mixed)."
                : " Time the words again (Pipeline: Words timed)."),
      );
      onApplied?.();
      await load();
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  if (err) return <p className="small">{err}</p>;
  if (!v)
    return (
      <p className="small">
        <Spinner size={12} />
        {" Reading the voiceover…"}
      </p>
    );
  const same = v.trim.applied && v.trim.thr === thr && v.trim.minMs === minMs && v.trim.amount === amount;
  return (
    <div className="trim-sil">
      <p className="small">
        Red is what gets cut from the pauses. Speech keeps 20 ms on both sides of every cut and each joint gets a 20 ms crossfade, so
        nothing clicks. Your original recording is kept.
      </p>
      <canvas ref={cv} className="trim-wave" aria-label="Voiceover waveform with the cuts in red" />
      <label className="pjs-music-slider">
        <span>Silence below</span>
        <input type="range" min={-60} max={-20} step={1} value={thr} disabled={busy} onChange={(e) => setThr(+e.target.value)} />
        <em>
          {thr}
          {" dB"}
        </em>
      </label>
      <label className="pjs-music-slider">
        <span>Shortest pause to cut</span>
        <input type="range" min={100} max={1500} step={10} value={minMs} disabled={busy} onChange={(e) => setMinMs(+e.target.value)} />
        <em>
          {minMs}
          {" ms"}
        </em>
      </label>
      <label className="pjs-music-slider">
        <span>Amount removed</span>
        <input type="range" min={0} max={100} step={1} value={amount} disabled={busy} onChange={(e) => setAmount(+e.target.value)} />
        <em>{amount}%</em>
      </label>
      <div className="trim-read" data-cuts={cuts.length}>
        {"Cuts "}
        {cuts.length}
        {" pauses, saves "}
        {saved.toFixed(1)}
        {" s (from "}
        {v.duration.toFixed(1)}
        {" s to "}
        {(v.duration - saved).toFixed(1)}
        {" s)"}
      </div>
      <div className="row trim-btns">
        <span className="dim small grow">
          {v.trim.applied ? `Applied: ${v.trim.amount}% of pauses over ${v.trim.minMs} ms` : "Not trimmed now"}
        </span>
        <button className="btn sm ghost" disabled={busy || !v.trim.applied} onClick={() => apply(null)}>
          Reset
        </button>
        <button className="btn sm" disabled={busy || same} onClick={() => apply({ thr, minMs, amount })}>
          {busy ? <Spinner size={11} /> : null}Apply
        </button>
      </div>
    </div>
  );
}
