import { memo } from "react";

function inline(s) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.length > 4 && p.startsWith("**") && p.endsWith("**") ? (
      <b key={i} style={{ fontWeight: 600, color: "#eee" }}>
        {p.slice(2, -2)}
      </b>
    ) : p.length > 2 && p.startsWith("`") && p.endsWith("`") ? (
      <code key={i} className="md-code">
        {p.slice(1, -1)}
      </code>
    ) : (
      p
    ),
  );
}
export const Md = memo(function Md2({ text }) {
  return (
    <>
      {text
        .trim()
        .split(/\r?\n/)
        .map((l, i) => {
          const h = /^\s*#{1,4}\s+(.*)$/.exec(l);
          if (h)
            return (
              <div key={i} style={{ fontWeight: 600, color: "#eee", marginTop: 6 }}>
                {inline(h[1])}
              </div>
            );
          const li = /^(\s*)(\d+\.|[-*•])\s+(.*)$/.exec(l);
          if (li)
            return (
              <div key={i} className="md-li" style={{ paddingLeft: li[1].length * 6 }}>
                <span className="md-bullet">{/\d/.test(li[2]) ? li[2] : "•"}</span>
                <span>{inline(li[3])}</span>
              </div>
            );
          return l.trim() ? <div key={i}>{inline(l)}</div> : <div key={i} style={{ height: 8 }} />;
        })}
    </>
  );
});
