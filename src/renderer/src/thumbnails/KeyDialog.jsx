import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Modal, Spinner } from "../components/ui";

export function KeyDialog({ hf, onClose, onSaved, provider = "higgsfield" }) {
  const { toast } = useApp();
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false);
  const fal = provider === "fal",
    eleven = provider === "elevenlabs",
    fish = provider === "fish",
    name = eleven ? "ElevenLabs" : fish ? "Fish Audio" : fal ? "Fal.ai" : "Higgsfield";
  const save = async (v) => {
    setBusy(true);
    try {
      const s = eleven
        ? await api.voiceSetKey(v)
        : fish
          ? await api.fishSetKey(v)
          : fal
            ? (await api.setFalKey(v)).fal
            : await api.hfSetKey(v);
      onSaved(s);
      toast(v ? `${name} key saved (encrypted on this computer).` : `${name} key removed.`);
      onClose();
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${name} API key`} onClose={onClose}>
      <div className="modal-body col" style={{ gap: 12 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          {fish ? (
            <>
              The app reads your script with Fish Audio voices (your own clones too) on your account's API credit: about $15 per million
              characters of text, so a 10-minute video costs around 15 cents. Paste an API key from fish.audio (your account menu, API
              keys). It is checked, then stored encrypted on this computer and only used by the app itself.
            </>
          ) : eleven ? (
            <>
              {
                "The app reads your script with your own ElevenLabs voices, on your account's characters. Paste an API key from elevenlabs.io (Developers, API keys). If you restrict the key, allow "
              }
              <b>Text to Speech</b>
              {", "}
              <b>Voices: read</b>
              {" and "}
              <b>User: read</b>
              {" (to show your characters left). It is checked, then stored encrypted on this computer and only used by the app itself."}
            </>
          ) : fal ? (
            <>
              Claude can make the pictures for Vox and custom-style videos on Fal.ai with your own account (FLUX.2, about a cent each).
              Paste the API key from fal.ai (Dashboard, Keys). It is checked, then stored encrypted on this computer and only used by the
              app itself.
            </>
          ) : (
            <>
              {
                "Thumbnails are made on Higgsfield with your own account (Vox and custom-style pictures can use Higgsfield or Fal.ai). Paste the API key from cloud.higgsfield.ai (API keys): both parts, "
              }
              <code>KEY_ID:KEY_SECRET</code>. It is checked, then stored encrypted on this computer and only used by the app itself.
            </>
          )}
        </p>
        {hf?.hasKey && (
          <div className="note" style={{ padding: "10px 12px" }}>
            A key is saved (ends in …{hf.hint}). Paste a new one to replace it.
          </div>
        )}
        <input
          className="input"
          type="password"
          autoFocus
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={eleven ? "sk_…" : fish ? "Your Fish Audio API key" : "KEY_ID:KEY_SECRET"}
          aria-label={`${name} API key`}
          onKeyDown={(e) => e.key === "Enter" && key.trim() && !busy && save(key)}
        />
        <div className="modal-actions">
          {hf?.hasKey && (
            <button className="btn" onClick={() => save(null)} disabled={busy}>
              Remove key
            </button>
          )}
          <span className="grow" />
          <button
            className="btn"
            onClick={() =>
              api
                .external(
                  eleven
                    ? "https://elevenlabs.io/app/developers/api-keys"
                    : fish
                      ? "https://fish.audio/app/api-keys/"
                      : fal
                        ? "https://fal.ai/dashboard/keys"
                        : "https://cloud.higgsfield.ai/api-keys",
                )
                .catch(() => {})
            }
          >
            Get a key
          </button>
          <button className="btn primary" onClick={() => save(key)} disabled={busy || !key.trim()}>
            {busy ? <Spinner size={14} /> : null}Save key
          </button>
        </div>
      </div>
    </Modal>
  );
}
