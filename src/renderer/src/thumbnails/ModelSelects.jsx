import { fitSettings } from "./board";

export function ModelSelects({ models, value, onChange, aspect = true, className = "input sm", defaultModel, ariaPrefix = "" }) {
  const def = defaultModel !== void 0 ? (models.find((m) => m.id === defaultModel) ?? models[0]) : null;
  const model = models.find((m) => m.id === value.model) ?? def ?? models[0];
  const pick = (id) => {
    const m = models.find((x) => x.id === id) ?? def ?? void 0;
    onChange({ model: id, ...fitSettings(m, value) });
  };
  return (
    <>
      <select
        className={className}
        value={def && !models.some((m) => m.id === value.model) ? "" : model?.id}
        onChange={(e) => pick(e.target.value)}
        aria-label={`${ariaPrefix}Model`}
        title={model?.note}
      >
        {def && <option value="">Default ({def.label})</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {aspect && (
        <select
          className={className}
          value={value.aspect}
          onChange={(e) => onChange({ aspect: e.target.value })}
          aria-label={`${ariaPrefix}Aspect ratio`}
        >
          {(model?.aspects ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      )}
      {(model?.resolutions.length ?? 0) > 0 && (
        <select
          className={className}
          value={value.resolution}
          onChange={(e) => onChange({ resolution: e.target.value })}
          aria-label={`${ariaPrefix}Resolution`}
        >
          {model.resolutions.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      )}
      {(model?.quality.length ?? 0) > 0 && (
        <select
          className={className}
          value={value.quality}
          onChange={(e) => onChange({ quality: e.target.value })}
          aria-label={`${ariaPrefix}Quality`}
        >
          {model.quality.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      )}
    </>
  );
}
