import { useEffect, useMemo, useState } from "react";
import { CalendarClockIcon, LightbulbIcon, TriangleAlertIcon } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../state/AppProvider";
import { STAGE_LABEL, daysUntil, dueChip, dueState } from "./stages";
import { markColor } from "./ChannelAvatar";
import { showDueOnBoard } from "./Channels";

const SHOWN = 6;
export function ComingUp() {
  const { channels, openProject, go, setChannel, toast, allProjects, brand } = useApp();
  const [data, setData] = useState(null);
  useEffect(() => {
    api
      .channelBoard()
      .then(setData)
      .catch(() => {});
  }, []);
  const all = useMemo(() => {
    if (!data) return [];
    const list = [
      ...Object.values(data.cards)
        .filter((c) => c.due)
        .map((c) => ({
          key: c.id,
          title: c.name ?? "",
          due: c.due,
          stage: c.stage,
          channelId: c.channelId ?? null,
          idea: false,
          kind: c.kind,
          missing: c.missing,
        })),
      ...data.ideas
        .filter((i) => i.due_at)
        .map((i) => ({ key: i.id, title: i.title, due: i.due_at, stage: i.stage, channelId: i.channel_id, idea: true })),
    ];
    return list
      .filter((r) => ["over", "soon", "week"].includes(dueState(r.due, r.stage) ?? ""))
      .sort((a, b) => daysUntil(a.due) - daysUntil(b.due));
  }, [data]);
  if (!all.length) return null;
  const rows = all.slice(0, SHOWN),
    more = all.length - rows.length,
    late = all.filter((r) => dueState(r.due, r.stage) === "over").length;
  const open = (r) => {
    if (r.idea) {
      setChannel(r.channelId ?? "none");
      go("channels");
      return;
    }
    if (r.missing) {
      const p = allProjects.find((x) => x.id === r.key)?.path;
      toast(`The project folder is missing${p ? `: ${p}` : ""}. Put it back (or connect its drive), then open it.`, "bad");
      return;
    }
    openProject({ id: r.key, kind: r.kind });
  };
  const board = (due) => {
    if (due) showDueOnBoard(brand);
    setChannel("all");
    go("channels");
  };
  return (
    <section className="panel pad ch-soon" aria-label="Coming up">
      <div className="row">
        <CalendarClockIcon size={17} strokeWidth={1.7} />
        <h3 className="grow">
          {"Coming up "}
          <small className="dim ch-soon-n">
            {all.length}
            {" due this week"}
            {late ? `, ${late} of them late` : ""}
          </small>
        </h3>
        <button className="text-btn" onClick={() => board(false)}>
          Open the board
        </button>
      </div>
      <div className="col" style={{ gap: 2, marginTop: 8 }}>
        {rows.map((r) => {
          const c = channels.find((x) => x.id === r.channelId);
          return (
            <button
              key={r.key}
              className={`list-row ${r.missing ? "ch-soon-missing" : ""}`}
              onClick={() => open(r)}
              title={r.missing ? "Its folder is missing" : void 0}
            >
              <span className="well" style={c ? { color: markColor(c.color) } : void 0}>
                {r.idea ? (
                  <LightbulbIcon size={14} strokeWidth={1.8} />
                ) : (
                  <i className="ch-soon-dot" style={{ background: c ? markColor(c.color) : "#777" }} />
                )}
              </span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="ellipsis" style={{ display: "block" }}>
                  {r.title}
                </span>
                <small className="dim">
                  {[c?.name ?? "No channel", STAGE_LABEL[r.stage]].join(" · ")}
                  {r.missing && (
                    <span className="ch-soon-warn">
                      <TriangleAlertIcon size={11} strokeWidth={2} />
                      Folder missing
                    </span>
                  )}
                </small>
              </span>
              <span className={`ch-due ${dueState(r.due, r.stage)}`}>{dueChip(r.due)}</span>
            </button>
          );
        })}
        {more > 0 && (
          <button className="text-btn link ch-soon-more" onClick={() => board(true)}>
            {more}
            {" more due this week or late: show them on the board"}
          </button>
        )}
      </div>
    </section>
  );
}
