import { useEffect, useState } from "react";
import { MonitorCogIcon } from "lucide-react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";

const GRAPHICS_SWITCHED =
  "This computer's graphics can't draw the 3D preview, so the app switched to software graphics (slower, but works on unsupported graphics). Restart the app to use them.";
export function GraphicsButton() {
  const { toast } = useApp();
  const [g, setG] = useState(null);
  useEffect(() => {
    const load = () =>
      api
        .graphicsState()
        .then(setG)
        .catch(() => {});
    const off = on("graphics:switched", (d) => {
      load();
      if (d?.to === "safe") return;
      toast(GRAPHICS_SWITCHED, "bad", { label: "Restart now", run: () => api.graphicsRestart() }, "graphics");
    });
    window.addEventListener("cz-graphics", load);
    load();
    try {
      const c = document.createElement("canvas"),
        gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) api.graphicsFailed("the app could not create any WebGL context").catch(() => {});
      else gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {}
    return () => {
      off();
      window.removeEventListener("cz-graphics", load);
    };
  }, []);
  if (!g?.restartNeeded) return null;
  return (
    <button
      className="conn update gfx-chip"
      onClick={() => api.graphicsRestart()}
      title={
        g.mode === "software"
          ? "Software graphics: slower, but works on graphics this app cannot use. Settings > System > Graphics."
          : g.mode === "safe"
            ? "Safe display: 3D stays on the graphics card, the window is shown in a way that works on more computers. Settings > System > Graphics."
            : "Back to the graphics card. Settings > System > Graphics."
      }
    >
      <MonitorCogIcon size={15} strokeWidth={1.8} />
      <span className="grow ellipsis">
        {"Restart for "}
        {g.mode === "software" ? "software graphics" : g.mode === "safe" ? "safe display" : "card graphics"}
        <small className="dim">Click to restart the app now</small>
      </span>
    </button>
  );
}
