import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useApp } from "../../state/AppProvider";
import { Modal, Spinner } from "../../components/ui";
import { getAt, setAt } from "./SettingsControls";
import { ProjectChoicesForm } from "./ProjectChoicesForm";
import { MusicSection, PROJECT_MODEL_EVENT } from "./ProjectSettingsPanel";
import { MainCharacterSection } from "./MainCharacterSection";

export function ProjectSettingsPanel({ projectId, status, styleName, onSettings, onClose }) {
  const { toast } = useApp();
  const [ov, setOv] = useState(null),
    [pc, setPc] = useState(null);
  const [set, setSet] = useState(status.settings),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    api
      .projectOverrides(projectId)
      .then(setOv)
      .catch((e) => toast(e.message, "bad"));
    api
      .projectModel(projectId)
      .then(setPc)
      .catch(() => {});
  }, [projectId]);
  const change = async ({ model, effort, ...patch }) => {
    try {
      if (model !== void 0 || effort !== void 0) {
        const next = await api.setProjectModel(projectId, {
          ...(model !== void 0 ? { model } : {}),
          ...(effort !== void 0 ? { effort } : {}),
        });
        setPc(next);
        window.dispatchEvent(new CustomEvent(PROJECT_MODEL_EVENT, { detail: { projectId, pc: next } }));
      }
      if (Object.keys(patch).length) setOv(await api.setProjectOverrides(projectId, patch));
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const flip = async (p, v) => {
    const n = setAt(set, p, v);
    setSaving(true);
    try {
      await onSettings(n);
      setSet(n);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setSaving(false);
    }
  };
  if (!ov || !pc)
    return (
      <Modal title="Project settings" onClose={onClose}>
        <div className="modal-body">
          <Spinner />
        </div>
      </Modal>
    );
  const isOn = (p, def) => {
    const v = getAt(set, p);
    return v === void 0 ? def : v !== false;
  };
  return (
    <Modal title="Project settings" onClose={onClose} className="pjs-modal">
      <div className="modal-body">
        <p className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
          {"What this project does differently. "}
          <b style={{ fontWeight: 500 }}>Global setting</b>
          {" follows Settings; anything you pick here is for this project only."}
        </p>
        <ProjectChoicesForm
          vals={{ ...ov.own, ...(pc.model ? { model: pc.model } : {}), ...(pc.effort ? { effort: pc.effort } : {}) }}
          onChange={change}
          info={{
            global: ov.global,
            services: ov.services,
            models: ov.models,
            claude: { globalModel: pc.globalModel, globalEffort: pc.globalEffort },
          }}
          effective={ov.effective}
          base={status.styleBase ?? status.style}
          styleName={styleName}
          real={{ isOn, flip, disabled: saving }}
        />
        {(status.styleBase ?? status.style) === "flat" && !status.characterLab && (
          <MainCharacterSection projectId={projectId} character={status.character ?? null} />
        )}
        <MusicSection projectId={projectId} />
        <p className="pjs-foot">
          {
            "Saved as you pick. The global ones are in Settings > AI engines (model, effort) and Settings > Media (image generation, voiceover, sound)."
          }
        </p>
      </div>
    </Modal>
  );
}
