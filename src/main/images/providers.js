import { getConfig } from "../core/config";
import { MODELS, generateBuffer, keyStatus } from "./higgsfield";
import { FAL_MODEL, generate, keyStatus as keyStatus$2 } from "./fal";
import { IMAGE_COST, IMAGE_MODEL, IMAGE_QUALITY, IMAGE_RES } from "./makeImage";
import { customPicture, customReady, readSetup } from "./customProviders";
import { cleanImageModels, overridesOf } from "./overrides";
import { findChrome, flowPicture, flowReady } from "./flow";

export const PROVIDER_NAMES = { higgsfield: "Higgsfield", fal: "Fal.ai", custom: "Custom API", flow: "Google Flow" };
export const isProviderSetting = (p) => p === "auto" || p === "higgsfield" || p === "fal" || p === "custom" || p === "flow";
export const globalProviderSetting = () => {
  const p = getConfig().images?.provider;
  return isProviderSetting(p) ? p : "auto";
};
const providerSetting = (project) => overridesOf(project).image ?? globalProviderSetting();
export function activeProvider(project, prefer) {
  const has = { higgsfield: keyStatus().hasKey, fal: keyStatus$2().hasKey, custom: customReady("image"), flow: flowReady() },
    want = prefer && prefer !== "auto" ? prefer : providerSetting(project);
  if (want !== "auto" && has[want]) return want;
  if (want === "flow") return null;
  if (want === "auto" && has.flow) return "flow";
  return paidProvider(has);
}
const paidProvider = (has) => (has.higgsfield ? "higgsfield" : has.fal ? "fal" : null);
export const hasImageKey = (project) => activeProvider(project) !== null;
export function providerStatus() {
  return {
    setting: globalProviderSetting(),
    active: activeProvider(),
    higgsfield: keyStatus(),
    fal: keyStatus$2(),
    custom: readSetup("image")?.name ?? null,
    flow: { opened: flowReady(), chrome: !!findChrome() },
    // the global default model per service, and the Higgsfield models to pick from (the app's default first)
    models: globalImageModels(),
    defaultModel: IMAGE_MODEL,
    higgsfieldModels: MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note })),
  };
}
export const globalImageModels = () => cleanImageModels(getConfig().images?.model);
export function defaultImageModel(provider, project) {
  if (provider === "fal" || provider === "flow") return null;
  return overridesOf(project).imageModel?.[provider] ?? globalImageModels()[provider] ?? null;
}
export function imageModelNote(project) {
  const p = activeProvider(project);
  if (!p) return null;
  const m = defaultImageModel(p, project),
    hm = p === "higgsfield" ? MODELS.find((x) => x.id === (m ?? IMAGE_MODEL)) : null;
  const name =
    p === "higgsfield"
      ? `${hm?.label ?? m} (${m ?? IMAGE_MODEL})`
      : p === "fal"
        ? `FLUX.2 (${FAL_MODEL})`
        : p === "flow"
          ? "Nano Banana 2.1 (in the member's own Flow, one picture at a time: slower, so make only the pictures you need)"
          : m
            ? `"${m}"`
            : "its own default";
  const others =
    p === "higgsfield"
      ? ` Other models: pass model = one of ${MODELS.map((x) => x.id).join(", ")} (only when a picture really needs it; they can cost more).`
      : p === "custom"
        ? " Pass model only when a picture needs another one of that service."
        : "";
  return `Pictures (make_image) are made on ${PROVIDER_NAMES[p]}${p === "custom" ? ` (${readSetup("image")?.name ?? "custom"})` : ""} with the default model ${name}${m ? ", chosen by the user" : ""}: leave make_image's model out to use it.${others}`;
}
export async function generatePicture(req, project) {
  const p = activeProvider(project, req.provider);
  if (!p && (req.provider ?? providerSetting(project)) === "flow")
    throw new Error(
      "Google Flow is picked but not set up on this computer yet: Settings > Media > Image generation > Google Flow > Open Flow to sign in, then try again.",
    );
  if (!p) throw new Error("Add a Higgsfield or Fal.ai API key in Settings first (Settings > Media > Image generation).");
  const asked = typeof req.model === "string" && req.model.trim() ? req.model.trim() : null,
    model = asked ?? defaultImageModel(p, project);
  if (p === "flow") {
    const auto = (req.provider ?? providerSetting(project)) === "auto";
    if (asked && !auto) throw new Error("Google Flow makes pictures with Nano Banana 2.1 here: leave model out.");
    try {
      if (asked) throw new Error(`model "${asked}" was asked for`);
      const r2 = await flowPicture({ prompt: req.prompt, aspect: req.aspect, refs: req.refs, upscale2k: !!req.upscale2k });
      return {
        buf: r2.buf,
        model: r2.upscaled ? "flow nano-banana-2.1 2k" : "flow nano-banana-2.1",
        cost: 0,
        provider: p,
        upscaled: r2.upscaled,
        ...(r2.note ? { note: r2.note } : {}),
      };
    } catch (e) {
      const paid = auto ? paidProvider({ higgsfield: keyStatus().hasKey, fal: keyStatus$2().hasKey }) : null;
      if (!paid) throw e;
      const r2 = await generatePicture({ ...req, provider: paid }, project);
      return {
        ...r2,
        note: [`Google Flow could not make it (${e.message.slice(0, 160)}): made on ${PROVIDER_NAMES[paid]} instead.`, r2.note]
          .filter(Boolean)
          .join(" "),
      };
    }
  }
  if (p === "custom") {
    const r2 = await customPicture({ ...req, model });
    return { buf: r2.buf, model: `custom ${readSetup("image")?.name ?? ""}${model ? ` ${model}` : ""}`, cost: r2.cost, provider: p };
  }
  if (p === "fal") {
    if (asked && asked !== FAL_MODEL) throw new Error(`Fal.ai makes pictures with ${FAL_MODEL} here: leave model out.`);
    const r2 = await generate(req);
    return { buf: r2.buf, model: `${FAL_MODEL} 1mp`, cost: r2.cost, provider: p };
  }
  const m = MODELS.find((x) => x.id === (model ?? IMAGE_MODEL));
  if (!m)
    throw new Error(
      `"${model}" is not a Higgsfield model the app knows. Use one of: ${MODELS.map((x) => x.id).join(", ")} (or leave model out).`,
    );
  const quality = m.quality.includes(req.quality ?? IMAGE_QUALITY) ? (req.quality ?? IMAGE_QUALITY) : (m.quality[0] ?? "");
  const resolution = m.resolutions.includes(req.resolution ?? IMAGE_RES) ? (req.resolution ?? IMAGE_RES) : (m.resolutions[0] ?? "");
  const aspect = m.id === IMAGE_MODEL || m.aspects.includes(req.aspect) ? req.aspect : m.aspects[0];
  const r = await generateBuffer({
    model: m.id,
    prompt: req.prompt,
    refs: req.refs,
    aspect,
    resolution,
    quality,
    ...(req.extra && m.id.startsWith("marketing-studio/") ? { extra: req.extra } : {}),
  });
  return {
    buf: r.buf,
    model: m.id === IMAGE_MODEL ? `${IMAGE_MODEL} ${IMAGE_QUALITY} ${IMAGE_RES}` : [m.id, quality, resolution].filter(Boolean).join(" "),
    cost: IMAGE_COST,
    provider: p,
  };
}
