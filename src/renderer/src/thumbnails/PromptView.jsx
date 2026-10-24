import { useMemo, useState } from "react";
import { DownloadIcon, FolderOpenIcon, ImagePlusIcon, LayoutGridIcon, RotateCcwIcon, SparklesIcon, StarIcon, XIcon } from "lucide-react";
import { MOD } from "../help/keys";
import { Busy } from "../components/ui";
import { Lightbox } from "../components/Lightbox";
import { DEFAULTS, STATUS, ratio, running } from "./board";
import { MentionField, usedRefs } from "./MentionField";
import { ModelSelects } from "./ModelSelects";

export function PromptView(p) {
  const c = { text: "", refs: [], ...DEFAULTS, ...(p.data.compose ?? {}) };
  const [drop, setDrop] = useState(false);
  const [light, setLight] = useState(null);
  const nodes = useMemo(() => new Map(p.data.nodes.map((n) => [n.id, n])), [p.data.nodes]);
  const refNodes = c.refs.map((id) => nodes.get(id)).filter(Boolean);
  const refs = refNodes.map((n, i) => ({
    name: `img${i + 1}`,
    url: n.file ? p.base + encodeURIComponent(n.file) : null,
    label: n.name ?? "Image",
  }));
  const used = usedRefs(c.text, refs),
    model = p.models.find((m) => m.id === c.model) ?? p.models[0];
  const set = (patch) => p.setCompose({ ...c, ...patch });
  const results = useMemo(
    () =>
      p.data.nodes
        .filter((n) => n.type === "output" && n.genId && p.gens[n.genId])
        .map((n) => ({ n, g: p.gens[n.genId] }))
        .sort((a, b) => b.g.created_at.localeCompare(a.g.created_at)),
    [p.data.nodes, p.gens],
  );
  const reuse = (g, n) => {
    const promptId = p.data.edges.find((e) => e.to === n.id)?.from,
      prompt = promptId ? nodes.get(promptId) : null;
    const refIds = promptId
      ? p.data.edges
          .filter((e) => e.to === promptId)
          .map((e) => e.from)
          .filter((id) => nodes.get(id)?.type === "image")
      : [];
    const params = (() => {
      try {
        return JSON.parse(g.params);
      } catch {
        return {};
      }
    })();
    p.setCompose({
      text: prompt?.text ?? g.prompt,
      refs: refIds,
      model: g.model,
      aspect: params.aspect_ratio ?? c.aspect,
      resolution: params.resolution ?? c.resolution,
      quality: params.quality ?? c.quality,
    });
  };
  return (
    <div
      className="pv"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDrop(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDrop(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(false);
        const fs = [...e.dataTransfer.files].map((f) => window.suite.pathForFile(f)).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
        if (fs.length) p.attach(fs);
      }}
    >
      <div
        className={`pv-box ${drop ? "drop" : ""}`}
        onPaste={(e) => {
          const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
          if (f) {
            e.preventDefault();
            const r = new FileReader();
            r.onload = () => p.attach(null, String(r.result));
            r.readAsDataURL(f);
          }
        }}
      >
        {refs.length > 0 && (
          <div className="pv-refs">
            {refs.map((r, i) => (
              <span
                key={r.name}
                className={`pv-ref ${used.has(r.name) ? "used" : ""}`}
                title={`${r.label} · type @${r.name} in the prompt`}
              >
                {r.url && <img src={r.url} alt={r.label} />}
                <b>@{r.name}</b>
                <button aria-label={`Remove ${r.name}`} onClick={() => set({ refs: c.refs.filter((_, j) => j !== i) })}>
                  <XIcon size={11} />
                </button>
                {r.url && (
                  <span className="pv-ref-big">
                    <img src={r.url} alt="" />
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
        <MentionField
          value={c.text}
          onChange={(v) => set({ text: v })}
          refs={refs}
          rows={4}
          className="pv-field"
          onSubmit={() => p.run(c)}
          placeholder={
            refs.length
              ? 'Describe the thumbnail. Type @ to point at a reference: "the face from @img1 on the left, big bold text…"'
              : "Describe the thumbnail you want…"
          }
        />
        {model && refs.length > model.maxRefs && (
          <div className="tn-warn" style={{ marginTop: 8 }}>
            {model.maxRefs
              ? `${model.label} takes ${model.maxRefs} reference${model.maxRefs === 1 ? "" : "s"}; ${refs.length} are attached.`
              : `${model.label} can't use references. Pick GPT Image 2.5, Grok, Qwen or Ideogram.`}
          </div>
        )}
        <div className="pv-row">
          <button className="btn small" onClick={() => p.attach(null)} title="Add reference images (or drop / paste them)">
            <ImagePlusIcon size={14} />
            Reference
          </button>
          <ModelSelects models={p.models} value={c} onChange={(x) => set(x)} />
          <span className="grow" />
          <button
            className="btn primary"
            disabled={!p.hasKey || !c.text.trim()}
            onClick={() => p.run(c)}
            title={p.hasKey ? `Generate (${MOD}+Enter)` : "Add your Higgsfield key first"}
          >
            <SparklesIcon size={15} />
            Generate
          </button>
        </div>
      </div>
      {results.length > 0 ? (
        <div className="pv-grid">
          {results.map(({ n, g }) => {
            const live = running(g.status);
            return (
              <div key={n.id} className={`pv-card ${live ? "live" : ""}`}>
                <div className="pv-pic" style={{ aspectRatio: `1 / ${ratio(n.aspectHint)}` }}>
                  {g.status === "completed" && g.url ? (
                    <img
                      src={g.url}
                      alt={g.prompt}
                      className="tn-reveal"
                      onClick={(e) => setLight({ id: n.id, from: e.currentTarget.getBoundingClientRect() })}
                      title="Open big"
                    />
                  ) : live ? (
                    <div className="tn-shimmer">
                      <Busy text={STATUS[g.status]} since={new Date(g.created_at).getTime() || void 0} size={18} kind="orbit" />
                    </div>
                  ) : (
                    <div className="tn-fail">
                      <span>{g.error ?? "Cancelled."}</span>
                    </div>
                  )}
                </div>
                <p className="pv-prompt" title={g.prompt}>
                  {g.prompt}
                </p>
                <div className="pv-acts">
                  {g.status === "completed" && g.file && (
                    <>
                      <button className="btn tiny primary" onClick={() => p.useAsThumb(g.file)}>
                        <StarIcon size={12} />
                        Use as thumbnail
                      </button>
                      <button className="icon-btn sm" title="Save a copy" aria-label="Save a copy" onClick={() => p.saveAs(g.file)}>
                        <DownloadIcon size={14} />
                      </button>
                      <button className="icon-btn sm" title="Show in folder" aria-label="Show in folder" onClick={() => p.reveal(g.file)}>
                        <FolderOpenIcon size={14} />
                      </button>
                    </>
                  )}
                  {live && (
                    <button className="btn tiny" onClick={() => p.cancel(g.id)}>
                      <XIcon size={12} />
                      Cancel
                    </button>
                  )}
                  <span className="grow" />
                  <button
                    className="icon-btn sm"
                    title="Prompt again from this one"
                    aria-label="Prompt again from this one"
                    onClick={() => reuse(g, n)}
                  >
                    <RotateCcwIcon size={14} />
                  </button>
                  <button
                    className="icon-btn sm"
                    title="Show on the canvas"
                    aria-label="Show on the canvas"
                    onClick={() => p.showOnCanvas(n.id)}
                  >
                    <LayoutGridIcon size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="pv-empty">
          {"Generated images appear here, newest first. Pick one with "}
          <b>Use as thumbnail</b>
          {" and it shows up on the video."}
          {((n) =>
            n > 0 && (
              <>
                <br />
                <button className="btn small pv-to-canvas" onClick={p.toCanvas}>
                  <LayoutGridIcon size={14} />
                  {n}
                  {" item"}
                  {n === 1 ? "" : "s"}
                  {" on the canvas"}
                </button>
              </>
            ))(p.data.nodes.filter((n) => n.type !== "output").length)}
        </p>
      )}
      {light && (
        <Lightbox
          items={results
            .filter((r) => r.g.status === "completed" && r.g.url && r.g.file)
            .map((r) => ({ id: r.n.id, file: r.g.file, url: r.g.url, label: r.g.prompt.slice(0, 80) }))}
          start={light.id}
          from={light.from}
          onClose={() => setLight(null)}
          actions={(it) => ({
            useAsThumb: () => p.useAsThumb(it.file),
            saveAs: () => p.saveAs(it.file),
            reveal: () => p.reveal(it.file),
            dragOut: () => p.dragOut(it.file),
          })}
        />
      )}
    </div>
  );
}
