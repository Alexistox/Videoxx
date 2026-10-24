import { useState } from "react";
import { useApp } from "../state/AppProvider";
import { ImagePlus } from "../../../../node_modules/lucide-react/dist/esm/lucide-react";
import { Modal } from "../components/ui";
import { KeyDialog } from "../thumbnails/KeyDialog";

export function ImageKeyNotice() {
  const { keyNotice, noticeImageKey, openSettings, toast } = useApp();
  const [adding, setAdding] = useState(null);
  if (!keyNotice) return null;
  const close = () => {
    setAdding(null);
    noticeImageKey(null);
  };
  if (adding)
    return (
      <KeyDialog
        provider={adding}
        hf={null}
        onClose={() => setAdding(null)}
        onSaved={(s) => {
          if (s.hasKey) {
            toast(
              `${adding === "fal" ? "Fal.ai" : "Higgsfield"} is set up: Claude makes the pictures there. Start again when you're ready.`,
              "ok",
            );
            close();
          }
        }}
      />
    );
  return (
    <Modal title="Set up image generation first" onClose={close}>
      <div className="modal-body col image-key-notice" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <ImagePlus size={20} strokeWidth={1.7} style={{ flex: "none", marginTop: 2, color: "var(--mint)" }} />
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            {keyNotice}
            {" Vox and custom-style videos get every picture from your own "}
            <b>Higgsfield</b>
            {" or "}
            <b>Fal.ai</b>
            {" account (about a cent per picture). Add an API key for either one; the app uses whichever you set up."}
          </p>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          Without one, Claude can't make the pictures, and the video would come out with poor stand-ins, so it won't start.
        </p>
        <div className="modal-actions">
          <button
            className="btn"
            onClick={() => {
              close();
              openSettings("image");
            }}
          >
            Open Settings
          </button>
          <span className="grow" />
          <button className="btn" onClick={() => setAdding("fal")}>
            Add Fal.ai key
          </button>
          <button className="btn primary" onClick={() => setAdding("higgsfield")}>
            Add Higgsfield key
          </button>
        </div>
      </div>
    </Modal>
  );
}
