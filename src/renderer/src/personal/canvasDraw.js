function camCrop(vw, vh, bw, bh, zoom, fx, fy) {
  const a = bw / bh;
  let cw = vw,
    ch = vw / a;
  if (ch > vh) {
    ch = vh;
    cw = vh * a;
  }
  cw /= zoom;
  ch /= zoom;
  const cx = Math.min(vw - cw / 2, Math.max(cw / 2, fx * vw)),
    cy = Math.min(vh - ch / 2, Math.max(ch / 2, fy * vh));
  return { sx: cx - cw / 2, sy: cy - ch / 2, sw: cw, sh: ch };
}
const srcSize = (s) =>
  !s
    ? [0, 0]
    : s instanceof HTMLVideoElement
      ? [s.videoWidth, s.videoHeight]
      : s instanceof HTMLImageElement
        ? [s.naturalWidth, s.naturalHeight]
        : [s.width, s.height];
const boxPx = (b, W, H) => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H, r: (b.radius * H) / 1080 });
function drawBackground(ctx, W, H, L, bg) {
  ctx.fillStyle = L.background.color;
  ctx.fillRect(0, 0, W, H);
  if (bg && bg.naturalWidth) {
    const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight),
      w = bg.naturalWidth * s,
      h = bg.naturalHeight * s;
    ctx.save();
    if (L.background.blur) ctx.filter = `blur(${(L.background.blur * H) / 1080}px)`;
    const m = L.background.blur ? ((L.background.blur * H) / 1080) * 2 : 0;
    ctx.drawImage(bg, (W - w) / 2 - m, (H - h) / 2 - m, w + 2 * m, h + 2 * m);
    ctx.restore();
  }
  if (L.background.dim) {
    ctx.fillStyle = `rgba(0,0,0,${L.background.dim})`;
    ctx.fillRect(0, 0, W, H);
  }
}
function drawShadow(ctx, b, strength, H) {
  if (strength <= 0) return;
  const s = H / 1080;
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${0.62 * strength})`;
  ctx.shadowBlur = 46 * s;
  ctx.shadowOffsetY = 14 * s;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, b.r);
  ctx.fill();
  ctx.restore();
}
function drawInBox(ctx, src, b, fit, crop) {
  const [vw, vh] = srcSize(src);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, b.r);
  ctx.clip();
  if (!src || !vw || !vh) {
    ctx.fillStyle = "#000";
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  if (src && vw && vh) {
    if (crop) {
      const c = camCrop(vw, vh, b.w, b.h, crop.zoom, crop.fx, crop.fy);
      ctx.drawImage(src, c.sx, c.sy, c.sw, c.sh, b.x, b.y, b.w, b.h);
    } else {
      const s = fit === "cover" ? Math.max(b.w / vw, b.h / vh) : Math.min(b.w / vw, b.h / vh),
        w = vw * s,
        h = vh * s;
      if (w < b.w - 0.5 || h < b.h - 0.5) {
        ctx.fillStyle = "#000";
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
      ctx.drawImage(src, b.x + (b.w - w) / 2, b.y + (b.h - h) / 2, w, h);
    }
  }
  ctx.restore();
}
function placeholder(ctx, b, label, H) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, b.r);
  ctx.clip();
  const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  g.addColorStop(0, "#2a2a2e");
  g.addColorStop(1, "#1b1b1e");
  ctx.fillStyle = g;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = "#8a8a90";
  ctx.font = `500 ${Math.max(11, (20 * H) / 1080)}px Inter, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2);
  ctx.restore();
}
export function drawFrame(ctx, W, H, L, bg, f) {
  if (f.mode === "full") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (f.full) drawInBox(ctx, f.full, { x: 0, y: 0, w: W, h: H, r: 0 }, "contain");
    return;
  }
  drawBackground(ctx, W, H, L, bg);
  const sb = boxPx(L.screen, W, H),
    cb = boxPx(L.cam, W, H);
  drawShadow(ctx, sb, L.screen.shadow, H);
  if (f.screen || !f.placeholders) drawInBox(ctx, f.screen, sb, L.screen.fit);
  else placeholder(ctx, sb, "Screen recording", H);
  if (L.cam.visible && (f.cam || f.placeholders)) {
    drawShadow(ctx, cb, L.cam.shadow, H);
    if (f.cam) drawInBox(ctx, f.cam, cb, "cover", { zoom: L.cam.zoom, fx: L.cam.focusX, fy: L.cam.focusY });
    else placeholder(ctx, cb, "Facecam", H);
  }
}
export function renderAssets(L, bg, W, H) {
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const px = (b) => {
    const p = boxPx(b, W, H);
    return { x: Math.round(p.x), y: Math.round(p.y), w: even(p.w), h: even(p.h), r: p.r };
  };
  const sb = px(L.screen),
    cb = px(L.cam);
  const base = document.createElement("canvas");
  base.width = W;
  base.height = H;
  const bx = base.getContext("2d");
  drawBackground(bx, W, H, L, bg);
  drawShadow(bx, sb, L.screen.shadow, H);
  if (L.cam.visible) drawShadow(bx, cb, L.cam.shadow, H);
  const mask = (b) => {
    const c = document.createElement("canvas");
    c.width = b.w;
    c.height = b.h;
    const x = c.getContext("2d");
    x.fillStyle = "#fff";
    x.beginPath();
    x.roundRect(0, 0, b.w, b.h, b.r);
    x.fill();
    return c.toDataURL("image/png");
  };
  return {
    W,
    H,
    base: base.toDataURL("image/png"),
    screenMask: mask(sb),
    camMask: mask(cb),
    screen: sb,
    cam: cb,
    camVisible: L.cam.visible,
    screenFit: L.screen.fit,
    camCrop: { zoom: L.cam.zoom, fx: L.cam.focusX, fy: L.cam.focusY },
  };
}
