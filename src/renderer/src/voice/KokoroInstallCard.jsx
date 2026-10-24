import { useEffect, useRef } from "react";
import { CpuIcon, DownloadIcon, TriangleAlertIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Spinner } from "../components/ui";
import { KOKORO_LANGS } from "./useVoiceStatus";

function LogTail({ lines }) {
  const box = useRef(null),
    shown = lines.slice(-30).join("\n");
  useEffect(() => {
    const b = box.current;
    if (b) b.scrollTop = b.scrollHeight;
  }, [shown]);
  return (
    <div ref={box} className="log-box" style={{ maxHeight: 110, marginTop: 8 }}>
      {shown}
    </div>
  );
}
export function KokoroInstallCard({ k, compact }) {
  const { toast } = useApp();
  const i = k.install,
    running = i.status === "running";
  const start = async () => {
    try {
      await api.kokoroInstall();
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  const stepText =
    i.step === "packages"
      ? "Installing the Python package…"
      : i.step === "download"
        ? `Downloading the voice · ${Math.round(i.received / 1e6)} of ${Math.round(i.total / 1e6)} MB`
        : i.step === "test"
          ? "Testing the voice…"
          : "Starting…";
  return (
    <div className={`vo-card ${compact ? "compact" : ""}`}>
      {!compact && (
        <span className="vo-card-ico">
          <CpuIcon size={18} strokeWidth={1.7} />
        </span>
      )}
      <div className="vo-card-txt">
        {!compact && <b>A free voice that runs on this computer</b>}
        {!compact && (
          <p>
            {"Kokoro reads your script offline, at no cost, in "}
            {KOKORO_LANGS}
            {". Natural, but less expressive than ElevenLabs. Set it up once: a download of about "}
            {k.sizeMB}
            {" MB plus a small Python package."}
          </p>
        )}
        {running ? (
          <>
            <div className="progress" aria-label="Install progress">
              <i style={{ width: `${i.total ? Math.max(3, (i.received / i.total) * 100) : 3}%` }} />
            </div>
            <div className="row small">
              <Spinner size={12} />
              <span className="grow">{stepText}</span>
              <button className="btn tiny" onClick={() => api.kokoroCancel()}>
                Stop
              </button>
            </div>
          </>
        ) : i.status === "failed" ? (
          <p className="vo-err">
            <TriangleAlertIcon size={14} />
            {i.error}
          </p>
        ) : k.files ? (
          <p className="small vo-note">
            {i.note ??
              `The voice files are already on this computer${k.where === "shared" ? " (HyperFrames downloaded them)" : ""}: Install only sets up its Python package (about 60 MB).`}
          </p>
        ) : i.note || i.kept ? (
          <p className="small vo-note">
            {i.note ?? `${Math.round(i.kept / 1e6)} of ${k.sizeMB} MB were downloaded before: the install continues from there.`}
          </p>
        ) : null}
        {(running || i.status === "failed") && i.log.length > 0 && <LogTail lines={i.log} />}
        {!running && (
          <div className="row" style={{ marginTop: compact ? 0 : 12 }}>
            <button className="btn small primary" onClick={start}>
              <DownloadIcon size={14} />
              {i.status === "failed"
                ? "Try again"
                : k.files
                  ? "Finish the install"
                  : i.kept
                    ? "Continue the install"
                    : "Install local voice"}
            </button>
            {k.python === null && <span className="small vo-warn">{"Python was not found: see Settings > System check."}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
