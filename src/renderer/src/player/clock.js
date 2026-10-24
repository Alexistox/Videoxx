import { useEffect, useState } from "react";

export class Clock {
  t = 0;
  end = 0;
  playing = false;
  rate = 1;
  ls = new Set();
  pl = new Set();
  set(t) {
    this.t = Math.max(0, Math.min(this.end || t, t));
    this.ls.forEach((f) => f(this.t));
  }
  on(f) {
    this.ls.add(f);
    return () => {
      this.ls.delete(f);
    };
  }
  setPlaying(p) {
    this.playing = p;
    this.pl.forEach((f) => f(p));
  }
  onPlaying(f) {
    this.pl.add(f);
    return () => {
      this.pl.delete(f);
    };
  }
}
export function useClockTime(clock, fps = 12) {
  const [t, setT] = useState(clock.t);
  useEffect(() => {
    let last = 0,
      pending = null;
    const off = clock.on((v) => {
      const now = performance.now();
      if (now - last > 1e3 / fps) {
        last = now;
        setT(v);
      } else if (pending === null)
        pending = window.setTimeout(() => {
          pending = null;
          last = performance.now();
          setT(clock.t);
        }, 1e3 / fps);
    });
    return () => {
      off();
      if (pending) clearTimeout(pending);
    };
  }, [clock, fps]);
  return t;
}
export function useClockValue(clock, of) {
  const [v, setV] = useState(() => of(clock.t));
  useEffect(() => {
    setV(of(clock.t));
    return clock.on((t) => {
      const n = of(t);
      setV((o) => (Object.is(o, n) ? o : n));
    });
  }, [clock, of]);
  return v;
}
export function useClockText(clock, el, fmt, fps = 10) {
  useEffect(() => {
    let last = 0,
      shown = "";
    const put = (t) => {
      const s = fmt(t);
      if (s !== shown && el.current) {
        el.current.textContent = s;
        shown = s;
      }
    };
    put(clock.t);
    let pending = null;
    const off = clock.on((t) => {
      const now = performance.now();
      if (now - last >= 1e3 / fps) {
        last = now;
        put(t);
      } else if (pending === null)
        pending = window.setTimeout(() => {
          pending = null;
          last = performance.now();
          put(clock.t);
        }, 1e3 / fps);
    });
    return () => {
      off();
      if (pending) clearTimeout(pending);
    };
  }, [clock, el, fmt, fps]);
}
export function usePlaying(clock) {
  const [p, setP] = useState(clock.playing);
  useEffect(() => clock.onPlaying(setP), [clock]);
  return p;
}
