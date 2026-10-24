import { Fragment } from "react";
import { ALT, MOD, isMac } from "../../help/keys";
import { Modal } from "../../components/ui";

const k = (s) =>
  s
    .replace(/Ctrl/g, MOD)
    .replace(/Alt/g, ALT)
    .replace(/wheel/g, isMac ? "scroll" : "wheel");
const KEYS = [
  ["Space", "Play / pause"],
  ["← / →", "Step one frame"],
  ["Shift + ← / →", "Step one second"],
  ["[ / ]", "Previous / next shot"],
  [isMac ? "fn ← / fn →" : "Home / End", "Start / end"],
  ["Click picture", "Select what is under the cursor"],
  ["Shift + click", "Add to the selection"],
  ["Shift + drag timeline", "Select a time range"],
  [k("Ctrl + wheel"), "Zoom the timeline"],
  ["I / O", k("Set in / out point (snaps to shot edges; Alt = exact)")],
  ["X", "Clear the range"],
  ["= / - / 0", k("Zoom the preview in / out / fit (Ctrl+wheel zooms at the cursor, Alt+drag pans)")],
  ["J / K / L", "Back 2 s / pause / play (L again = faster)"],
  ["G", "Go to a time"],
  ["M", "Mute"],
  ["F", "Full-screen preview"],
  ...[
    ["Ctrl + F", "Find a word in the narration"],
    ["Ctrl + E", "Export"],
    ["Ctrl + B / Ctrl + J", "Hide shots / Claude panel"],
    ["Ctrl + I", "Ask Claude (focus the box)"],
  ].map(([a, b]) => [k(a), b]),
  ["Esc", "Clear the selection"],
  ["Enter", "Send to Claude (Shift+Enter for a new line)"],
  ...[
    ["Ctrl + Z", "Revert the last Claude edit"],
    ["Ctrl + Shift + Z", "Re-apply the last reverted edit"],
    ["Ctrl + K", "Command palette"],
    ["Ctrl + N", "New project"],
  ].map(([a, b]) => [k(a), b]),
  ["?", "This sheet"],
];
export function KeysPanel({ onClose }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="modal-body">
        <div className="kv">
          {KEYS.map(([k2, d]) => (
            <Fragment key={k2}>
              <span>
                <kbd style={{ fontSize: 11, padding: "3px 6px" }}>{k2}</kbd>
              </span>
              <span>{d}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </Modal>
  );
}
