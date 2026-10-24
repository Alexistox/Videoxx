import { XF_DEFAULT, camTime, continues, covers, layoutTimeline, segIndexAt, srcTimeAt } from "./timelineEdit";
import { drawFrame } from "./canvasDraw";

let onPlayError = () => {};
export const setPlayErrorHandler = (fn) => {
  onPlayError = fn;
};
export class PersonalEngine {
  constructor(canvas, clock) {
    this.canvas = canvas;
    this.clock = clock;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.offs.push(
      clock.onPlaying((p) => (p ? this.play() : this.pause())),
      clock.on((t) => {
        if (!this.internal && !this.playing) this.seek(t);
      }),
    );
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }
  canvas;
  clock;
  ctx;
  edit = { version: 1, clips: [], cams: {}, xfade: XF_DEFAULT, signedOff: null };
  media = new Map();
  layout = null;
  bg = null;
  segs = [];
  duration = 0;
  slot = [];
  camSlot = [];
  pool = new Map();
  cur = -1;
  raf = 0;
  playing = false;
  dirty = true;
  internal = false;
  fades = [];
  offs = [];
  volume = 1;
  muted = false;
  rate = 1;
  /** frames drawn / cuts crossed while playing (tests read these) */
  stats = {
    frames: 0,
    cuts: 0,
    lastCutError: 0,
    maxCutError: 0,
    blankScreen: 0,
    blankCam: 0,
    camSeeks: 0,
    maxCamOff: 0,
    held: 0,
    blankStill: 0,
    seeked: 0,
  };
  destroy() {
    cancelAnimationFrame(this.raf);
    this.offs.forEach((f) => f());
    for (const els of this.pool.values())
      for (const el of els) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
    this.pool.clear();
  }
  setData(edit, media, layout, bg) {
    const was = this.playing;
    if (was) this.pauseElements();
    this.edit = edit;
    this.layout = layout;
    this.bg = bg;
    const old = this.media;
    this.media = new Map(media.map((m) => [m.id, m]));
    for (const [id, els] of this.pool) {
      const m = this.media.get(id);
      if (!m?.url || old.get(id)?.url !== m.url) {
        els.forEach((e) => {
          e.pause();
          e.removeAttribute("src");
          e.load();
        });
        this.pool.delete(id);
      }
    }
    const { segs, duration } = layoutTimeline(edit, media);
    this.segs = segs;
    this.duration = duration;
    this.clock.end = duration;
    this.slot = segs.map(() => 0);
    this.camSlot = segs.map(() => 0);
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1].clip,
        b = segs[i].clip;
      this.slot[i] = continues(a, b) ? this.slot[i - 1] : a.src === b.src ? 1 - this.slot[i - 1] : 0;
      this.camSlot[i] =
        segs[i].cam && segs[i].cam === segs[i - 1].cam ? (continues(a, b) ? this.camSlot[i - 1] : 1 - this.camSlot[i - 1]) : 0;
    }
    this.cur = -1;
    if (this.clock.t > duration) this.clock.set(duration);
    this.seek(this.clock.t);
    if (was) this.play();
    this.dirty = true;
  }
  /** What is showing right now (tests and the status line). */
  state() {
    const s = this.segs[this.cur],
      el = this.segEl(this.cur),
      ce = this.camEl(this.cur),
      src = s ? s.clip.in + (this.clock.t - s.start) : null;
    return {
      cur: this.cur,
      t: this.clock.t,
      src,
      el: el?.currentTime ?? null,
      cam: s?.cam ?? null,
      camWant: s && src !== null ? this.camTarget(this.cur, src) : null,
      camEl: ce?.currentTime ?? null,
      playing: this.playing,
      stats: this.stats,
    };
  }
  setLayout(layout, bg) {
    this.layout = layout;
    this.bg = bg;
    this.dirty = true;
  }
  setVolume(v, muted) {
    this.volume = v;
    this.muted = muted;
    this.applyVolumes();
  }
  setRate(r) {
    this.rate = r;
    for (const els of this.pool.values()) els.forEach((e) => (e.playbackRate = r));
  }
  redraw() {
    this.dirty = true;
  }
  failed = new Set();
  el(id, slot) {
    const m = this.media.get(id);
    if (!m?.url) return null;
    let els = this.pool.get(id);
    if (!els) {
      els = [0, 1].map(() => {
        const v = document.createElement("video");
        v.preload = "auto";
        v.playsInline = true;
        v.muted = m.role === "facecam";
        v.src = m.url;
        v.playbackRate = this.rate;
        v.addEventListener("seeked", () => {
          this.dirty = true;
          this.stats.seeked++;
          const p = this.pending.get(v);
          if (p !== void 0) {
            this.pending.delete(v);
            if (Math.abs(v.currentTime - p) > 2e-3) {
              try {
                v.currentTime = p;
              } catch {}
            }
          }
        });
        v.addEventListener("loadeddata", () => {
          this.dirty = true;
        });
        v.addEventListener("error", () => {
          if (!this.failed.has(id)) {
            this.failed.add(id);
            onPlayError(id, v.error?.message || `media error ${v.error?.code ?? ""}`);
          }
        });
        return v;
      });
      this.pool.set(id, els);
    }
    return els[slot];
  }
  segEl(i) {
    const s = this.segs[i];
    return s ? this.el(s.clip.src, this.slot[i]) : null;
  }
  camEl(i) {
    const s = this.segs[i];
    return s?.cam ? this.el(s.cam, this.camSlot[i]) : null;
  }
  camTarget(i, screenT) {
    const s = this.segs[i],
      sync = s?.cam ? this.edit.cams[s.cam] : null;
    return sync && covers(sync, screenT) ? camTime(sync, screenT) : null;
  }
  // one seek at a time per element: while one runs, only the newest target is kept and started when it lands, so a fast
  // scrub shows a stream of real frames instead of queueing seeks the decoder can't finish
  pending = new Map();
  setTime(el, t, tol = 2e-3) {
    t = Math.max(0, t);
    if (el.seeking) {
      this.pending.set(el, t);
      return;
    }
    this.pending.delete(el);
    if (Math.abs(el.currentTime - t) > tol) {
      try {
        el.currentTime = t;
      } catch {}
    }
  }
  /** Park everything for timeline time t (paused): the clip's frame, the facecam frame, the next clip preloaded. */
  seek(t) {
    const i = segIndexAt(this.segs, t);
    this.cur = i;
    if (i < 0) {
      this.dirty = true;
      return;
    }
    const s = this.segs[i],
      src = srcTimeAt(s, Math.min(t, s.end)),
      el = this.segEl(i);
    if (el) this.setTime(el, src);
    const ce = this.camEl(i),
      ct = this.camTarget(i, src);
    if (ce && ct !== null) this.setTime(ce, ct, 0.01);
    this.preload(i + 1);
    this.dirty = true;
  }
  preload(i) {
    const s = this.segs[i];
    if (!s) return;
    const el = this.segEl(i);
    if (el && el !== this.segEl(i - 1) && el.paused) this.setTime(el, s.clip.in);
    const ce = this.camEl(i),
      ct = this.camTarget(i, s.clip.in);
    if (ce && ce !== this.camEl(i - 1) && ce.paused && ct !== null) this.setTime(ce, ct, 0.01);
  }
  applyVolumes() {
    const v = this.muted ? 0 : this.volume;
    for (const [id, els] of this.pool)
      if (this.media.get(id)?.role !== "facecam")
        els.forEach((e) => {
          if (!this.fades.some((f) => f.el === e)) e.volume = v;
        });
  }
  play() {
    if (this.playing || !this.segs.length) return;
    if (this.clock.t >= this.duration - 0.01) this.clock.set(0);
    this.seek(this.clock.t);
    const el = this.segEl(this.cur);
    if (!el) return;
    this.playing = true;
    this.fades = [];
    el.volume = this.muted ? 0 : this.volume;
    el.play().catch(() => {});
    const ce = this.camEl(this.cur);
    if (ce && this.camTarget(this.cur, srcTimeAt(this.segs[this.cur], this.clock.t)) !== null) ce.play().catch(() => {});
  }
  pauseElements() {
    for (const els of this.pool.values()) els.forEach((e) => e.pause());
    this.fades = [];
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.pauseElements();
    this.applyVolumes();
    this.seek(this.clock.t);
  }
  fade(el, from, to, dur, pauseAtEnd = false) {
    this.fades = this.fades.filter((f) => f.el !== el);
    el.volume = Math.max(0, Math.min(1, from));
    this.fades.push({ el, from, to, t0: performance.now(), dur: Math.max(1, dur * 1e3), pauseAtEnd });
  }
  runFades(now) {
    this.fades = this.fades.filter((f) => {
      const k = Math.min(1, (now - f.t0) / f.dur),
        g = f.to > f.from ? Math.sin((k * Math.PI) / 2) : Math.cos((k * Math.PI) / 2);
      f.el.volume = Math.max(0, Math.min(1, f.from + (f.to - f.from) * (f.to > f.from ? g : 1 - g)));
      if (k >= 1 && f.pauseAtEnd) f.el.pause();
      return k < 1;
    });
  }
  tick() {
    const now = performance.now();
    if (this.playing) {
      this.runFades(now);
      let s = this.segs[this.cur],
        el = this.segEl(this.cur);
      if (!s || !el) {
        this.clock.setPlaying(false);
        return;
      }
      let t = s.start + (el.currentTime - s.clip.in);
      while (s && (t >= s.end - 5e-4 || el.ended)) {
        const n = this.cur + 1,
          ns = this.segs[n];
        if (!ns) {
          this.pauseElements();
          this.internal = true;
          this.clock.set(this.duration);
          this.internal = false;
          this.clock.setPlaying(false);
          return;
        }
        const nel = this.segEl(n),
          ce2 = this.camEl(this.cur),
          nce = this.camEl(n);
        const err = t - s.end;
        this.stats.lastCutError = err;
        this.stats.maxCutError = Math.max(this.stats.maxCutError, Math.abs(err));
        this.stats.cuts++;
        if (nel !== el) {
          this.setTime(nel, ns.clip.in, 0.03);
          const v = this.muted ? 0 : this.volume,
            xf = s.cutAfter ? (this.edit.xfade ?? XF_DEFAULT) : 0;
          if (xf > 0 && this.media.get(s.clip.src)?.audio) {
            this.fade(el, el.volume, 0, xf, true);
            this.fade(nel, 0, v, xf);
          } else {
            el.pause();
            nel.volume = v;
          }
          nel.play().catch(() => {});
        }
        if (nce && nce !== ce2) {
          const ct2 = this.camTarget(n, ns.clip.in);
          if (ct2 !== null) {
            this.setTime(nce, ct2, 0.03);
            nce.play().catch(() => {});
          }
        }
        if (ce2 && ce2 !== nce) ce2.pause();
        this.cur = n;
        s = ns;
        el = nel;
        t = s.start + Math.max(0, el.currentTime - s.clip.in);
        this.preload(n + 1);
      }
      this.preload(this.cur + 1);
      const ce = this.camEl(this.cur),
        ct = this.camTarget(this.cur, s.clip.in + (t - s.start));
      if (ce) {
        if (ct === null) {
          if (!ce.paused) ce.pause();
        } else {
          if (ce.paused) ce.play().catch(() => {});
          const off = ce.currentTime - ct;
          if (!ce.seeking) this.stats.maxCamOff = Math.max(this.stats.maxCamOff, Math.abs(off));
          if (Math.abs(off) > 0.5 && !ce.seeking) {
            this.stats.camSeeks++;
            this.setTime(ce, ct, 0.01);
            ce.playbackRate = this.rate;
          } else {
            const r = Math.abs(off) < 0.015 ? this.rate : this.rate * (1 - Math.max(-0.12, Math.min(0.12, off * 1.5)));
            if (Math.abs(ce.playbackRate - r) > 4e-3) ce.playbackRate = r;
          }
        }
      }
      this.internal = true;
      this.clock.set(Math.min(t, this.duration));
      this.internal = false;
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.draw(now);
    }
  }
  waitSince = 0;
  // the last good frame of each layer, kept small (the preview never shows more): what a layer shows while it seeks
  hold = {
    screen: { c: document.createElement("canvas"), ok: false },
    cam: { c: document.createElement("canvas"), ok: false },
    full: { c: document.createElement("canvas"), ok: false },
  };
  layer(k, v) {
    const h = this.hold[k];
    if (v && v.videoWidth) {
      const max = k === "cam" ? 1080 : 1920,
        f = Math.min(1, max / v.videoWidth),
        w = Math.round(v.videoWidth * f),
        hh = Math.round(v.videoHeight * f);
      if (h.c.width !== w || h.c.height !== hh) {
        h.c.width = w;
        h.c.height = hh;
      }
      h.c.getContext("2d").drawImage(v, 0, 0, w, hh);
      h.ok = true;
      return v;
    }
    return h.ok ? h.c : null;
  }
  /** tests: set to [] to record every drawn frame's facecam state */
  trace = null;
  draw(now = performance.now()) {
    const c = this.canvas,
      W = c.width,
      H = c.height;
    if (!W || !H) return;
    const i = this.cur,
      s = this.segs[i],
      L = this.layout;
    if (!L) {
      this.ctx.fillStyle = "#111";
      this.ctx.fillRect(0, 0, W, H);
      return;
    }
    if (!s) {
      drawFrame(this.ctx, W, H, L, this.bg, { mode: "layout", screen: null, cam: null, placeholders: true });
      return;
    }
    const el = this.segEl(i),
      ok = (v) => !!v && v.readyState >= 2 && !v.seeking,
      ready = (v) => (ok(v) ? v : null);
    const src = s.clip.in + (this.clock.t - s.start),
      ce = s.role === "screen" ? this.camEl(i) : null,
      showCam = !!ce && this.camTarget(i, src) !== null;
    const has = !!this.media.get(s.clip.src)?.url;
    if (!this.playing && has) {
      const scr = this.layer(s.role === "screen" ? "screen" : "full", ok(el) ? el : null),
        cam = showCam ? this.layer("cam", ok(ce) ? ce : null) : null;
      if (scr && (!showCam || cam)) {
        if (!ok(el) || (showCam && !ok(ce))) {
          this.dirty = true;
          this.stats.held++;
        }
        if (s.role === "screen") drawFrame(this.ctx, W, H, L, this.bg, { mode: "layout", screen: scr, cam, placeholders: false });
        else drawFrame(this.ctx, W, H, L, this.bg, { mode: "full", screen: null, cam: null, full: scr });
        this.stats.frames++;
        this.waitSince = 0;
        return;
      }
    }
    if (has && (!ok(el) || (showCam && !ok(ce)))) {
      if (!this.waitSince) this.waitSince = now;
      const working = !!el?.seeking || !!ce?.seeking || (el?.networkState === 2 && (el?.readyState ?? 0) < 2);
      if (working || now - this.waitSince < 1500) {
        this.dirty = true;
        this.stats.held++;
        return;
      }
    } else this.waitSince = 0;
    if (has && !ok(el)) this.stats[this.playing ? "blankScreen" : "blankStill"]++;
    if (showCam && !ok(ce)) this.stats[this.playing ? "blankCam" : "blankStill"]++;
    if (s.role === "screen")
      drawFrame(this.ctx, W, H, L, this.bg, { mode: "layout", screen: ready(el), cam: showCam ? ready(ce) : null, placeholders: !has });
    else drawFrame(this.ctx, W, H, L, this.bg, { mode: "full", screen: null, cam: null, full: ready(el) });
    this.stats.frames++;
    if (this.trace && this.playing && s.role === "screen" && L.cam.visible)
      this.trace.push({
        at: now,
        t: this.clock.t,
        seg: i,
        cam: showCam ? s.cam : null,
        el: ce ? (this.pool.get(s.cam)?.indexOf(ce) ?? -1) : -1,
        ct: ce?.currentTime ?? null,
        want: showCam ? this.camTarget(i, src) : null,
        rate: ce?.playbackRate ?? null,
      });
  }
}
