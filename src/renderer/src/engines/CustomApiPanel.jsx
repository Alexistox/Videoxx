import { useEffect, useState } from "react";
import { SquareIcon, TrashIcon, TriangleAlertIcon, WandSparklesIcon } from "lucide-react";
import { api, on } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { Spinner } from "../components/ui";

export const OwnRisk = () => (
  <span
    className="own-risk"
    title="Not a supported feature: the connector is written by your Claude for a service the app doesn't know. If it breaks, remove it and use a built-in service."
  >
    <TriangleAlertIcon size={11} strokeWidth={2.2} />
    At your own risk
  </span>
);
export function useCustomApi(kind) {
  const [s, setS] = useState(null);
  useEffect(() => {
    api
      .customApiState(kind)
      .then(setS)
      .catch(() => {});
    return on("customapi:state", (x) => {
      if (x.kind === kind) setS(x);
    });
  }, [kind]);
  return s;
}
const PLACEHOLDER = {
  image: "Kie.ai, model nano-banana. Docs: https://docs.kie.ai … Use the reference pictures when there are some.",
  voice: 'Fish Audio, my cloned voice "Narrator". Docs: https://docs.fish.audio … MP3 output.',
};
const PICK_MODEL = "<the model you picked on kie.ai>";
const QUICK_STARTS = {
  image: [
    {
      name: "Kie.ai",
      brief: `Kie.ai (https://kie.ai): one pay-as-you-go API for many image and video models. API docs: https://docs.kie.ai
Auth: my API key as a Bearer token (Authorization: Bearer <key>).
Generation is asynchronous: create a task for the model, poll the task until it is done, then download the picture from the URL it returns.
Model: ${PICK_MODEL}
Make one picture per request in the size asked for, and pass the reference pictures when there are some (if the model takes them).`,
    },
  ],
  voice: [],
};
export function CustomApiPanel({ kind }) {
  const { toast } = useApp();
  const s = useCustomApi(kind);
  const [brief, setBrief] = useState(""),
    [key, setKey] = useState(""),
    [open, setOpen] = useState(false);
  useEffect(() => {
    if (s?.setup?.brief && !brief) setBrief(s.setup.brief);
  }, [s?.setup?.brief]);
  const busy = s?.status === "running" || s?.status === "verifying";
  const what = kind === "image" ? "picture" : "voice";
  const run = () =>
    api
      .customApiSetup(kind, brief, key || void 0)
      .then((x) => {
        setKey("");
        if (x.status === "failed" && x.error) toast(x.error, "bad");
      })
      .catch((e) => toast(e.message, "bad"));
  return (
    <div className="custom-api">
      <div className="opt">
        <span>
          {"Custom "}
          {what}
          {" API "}
          <OwnRisk />
          <small>
            {s?.setup
              ? `Set up: ${s.setup.name}${s.setup.notes ? ` · ${s.setup.notes}` : ""}`
              : `Any ${what} service you like: describe it and your Claude connects it.`}
          </small>
        </span>
        <span className="row" style={{ gap: 6 }}>
          {s?.setup && !busy && (
            <button
              className="btn small ghost"
              onClick={() =>
                api
                  .customApiRemove(kind)
                  .then(() => {
                    setBrief("");
                    toast(`Custom ${what} API removed.`);
                  })
                  .catch((e) => toast(e.message, "bad"))
              }
              title="Delete the connector and its key"
            >
              <TrashIcon size={13} />
              Remove
            </button>
          )}
          <button className="btn small" onClick={() => setOpen((o) => !o)}>
            {s?.setup ? "Change" : "Set up"}
          </button>
        </span>
      </div>
      {(open || busy) && (
        <div className="custom-api-form">
          {QUICK_STARTS[kind].length > 0 && (
            <div className="row ca-quick">
              <span className="small">Quick start</span>
              {QUICK_STARTS[kind].map((q) => (
                <button
                  key={q.name}
                  className="btn tiny"
                  disabled={busy}
                  title={`Fills in what Claude needs to know about ${q.name}. Pick the model, paste your ${q.name} API key, then Set up with Claude. ${q.name} is not built into the app: the connector is your Claude's, at your own risk.`}
                  onClick={() => {
                    setBrief(q.brief);
                    requestAnimationFrame(() => {
                      const t = document.getElementById(`ca-brief-${kind}`);
                      const i = q.brief.indexOf(PICK_MODEL);
                      if (t && i >= 0) {
                        t.focus();
                        t.setSelectionRange(i, i + PICK_MODEL.length);
                      }
                    });
                  }}
                >
                  {q.name}
                </button>
              ))}
              <OwnRisk />
            </div>
          )}
          <label className="label" htmlFor={`ca-brief-${kind}`}>
            Which service, which model, anything Claude should know (a link to its API docs helps)
          </label>
          <textarea
            id={`ca-brief-${kind}`}
            className="input"
            rows={3}
            value={brief}
            disabled={busy}
            placeholder={PLACEHOLDER[kind]}
            onChange={(e) => setBrief(e.target.value)}
          />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input
              className="input compact grow"
              type="password"
              value={key}
              disabled={busy}
              placeholder={
                s?.keyHint ? `API key saved, ends in …${s.keyHint} (paste to replace)` : "API key (stored encrypted on this computer)"
              }
              onChange={(e) => setKey(e.target.value)}
              aria-label={`Custom ${what} API key`}
            />
            {busy ? (
              <button className="btn small" onClick={() => api.customApiCancel(kind)}>
                <SquareIcon size={12} />
                Stop
              </button>
            ) : (
              <button
                className="btn small primary"
                disabled={brief.trim().length < 10 || brief.includes(PICK_MODEL)}
                title={brief.includes(PICK_MODEL) ? `Write the model you want in place of ${PICK_MODEL} first` : void 0}
                onClick={run}
              >
                <WandSparklesIcon size={14} />
                Set up with Claude
              </button>
            )}
          </div>
          {brief.includes(PICK_MODEL) && (
            <span className="help warn ca-pick">
              {"Pick the model: write its name in place of "}
              {PICK_MODEL}
              {" (the models and their prices are listed on kie.ai)."}
            </span>
          )}
          <span className="help">
            {
              "Claude reads the service's docs, writes a small connector in its own folder (nothing in the app changes) and tests it; then the app makes a sample "
            }
            {what}
            {" with it. It uses your Claude and the service's credits. If it ever breaks, Remove it."}
          </span>
          {s && (s.log.length > 0 || s.error) && (
            <div className="log-box custom-api-log">
              {busy && <Spinner size={12} />} {[...s.log.slice(-12), ...(s.error ? [s.error] : [])].join("\n")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
