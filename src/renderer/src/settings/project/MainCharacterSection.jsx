import { useState } from "react";
import { api } from "../../lib/api";
import { useApp } from "../../state/AppProvider";

export function MainCharacterSection({ projectId, character }) {
  const { toast } = useApp();
  const [none, setNone] = useState(!!character?.none),
    [busy, setBusy] = useState(false);
  const pick = async (on) => {
    setBusy(true);
    try {
      const r = await api.setMainCharacter(projectId, on);
      setNone(r.none);
      toast(
        r.none
          ? "No main character: the next build casts each scene on its own."
          : `${r.name ?? "The main character"} stars again from the next build.`,
      );
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pjs-music pjs-maincharacter">
      <div className="pjs-music-head">
        <b>Main character</b>
        <small>
          Who stars in every scene. With none, Claude casts each scene's own people and objects; turn one on any time (the next build
          follows).
        </small>
      </div>
      <div className="pjs-music-row seg">
        <button className={"btn sm" + (!none ? " on" : " ghost")} disabled={busy} onClick={() => none && pick(true)}>
          {character?.name ?? "Main character"}
        </button>
        <button className={"btn sm" + (none ? " on" : " ghost")} disabled={busy} onClick={() => !none && pick(false)}>
          No main character
        </button>
      </div>
    </div>
  );
}
