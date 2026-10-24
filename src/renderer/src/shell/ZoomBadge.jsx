import { useEffect, useState } from "react";
import { on } from "../lib/api";
import { MOD } from "../help/keys";

export function ZoomBadge() {
  const [z, setZ] = useState(null);
  useEffect(() => {
    let t = 0;
    const off = on("ui:zoom", (v) => {
      setZ(v);
      clearTimeout(t);
      t = window.setTimeout(() => setZ(null), 1200);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);
  return z === null ? null : (
    <div className="ui-scale-badge" role="status">
      {Math.round(z.zoom * 100)}%<small>{z.capped ? "Largest that fits this window" : `${MOD} 0 resets`}</small>
    </div>
  );
}
