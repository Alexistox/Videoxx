import broadsheet from "../assets/collage-broadsheet.mp4";
import broadsheetJpg from "../assets/collage-broadsheet.jpg";
import collage from "../assets/collage.mp4";
import flat from "../assets/flat.mp4";
import investigation from "../assets/recon-investigation.mp4";
import investigationJpg from "../assets/recon-investigation.jpg";
import lowpoly from "../assets/lowpoly.mp4";
import lpBright from "../assets/lowpoly-bright.mp4";
import lpBrightJpg from "../assets/lowpoly-bright.jpg";
import lpMoody from "../assets/lowpoly-moody.mp4";
import lpMoodyJpg from "../assets/lowpoly-moody.jpg";
import pixel from "../assets/pixel-art.mp4";
import pixelJpg from "../assets/pixel-art.jpg";
import press from "../assets/collage-press.mp4";
import pressJpg from "../assets/collage-press.jpg";
import recon from "../assets/recon.mp4";
import reconJpg from "../assets/recon-studio.jpg";
import sepia from "../assets/collage-sepia.mp4";
import sepiaJpg from "../assets/collage-sepia.jpg";
import stickman from "../assets/stickman.mp4";
import stickmanJpg from "../assets/stickman-paint.jpg";
import vertical from "../assets/collage-press-vertical.mp4";
import verticalJpg from "../assets/collage-press-vertical.jpg";

export const STYLE_PREVIEW = { "pixel-art": pixel, collage, flat, stickman, recon, lowpoly };
export const STYLE_PREVIEW_TALL = new Set(["flat", "lowpoly", "toon"]);
export const LOOK_PREVIEW = {
  crisp: { video: pixel, poster: pixelJpg },
  "collage-press": { video: press, poster: pressJpg },
  "collage-sepia": { video: sepia, poster: sepiaJpg },
  "collage-broadsheet": { video: broadsheet, poster: broadsheetJpg },
  "collage-press-vertical": { video: vertical, poster: verticalJpg, tall: true },
  "stickman-paint": { video: stickman, poster: stickmanJpg },
  "recon-studio": { video: recon, poster: reconJpg },
  "recon-investigation": { video: investigation, poster: investigationJpg },
  "lowpoly-bright": { video: lpBright, poster: lpBrightJpg, tall: true },
  "lowpoly-moody": { video: lpMoody, poster: lpMoodyJpg, tall: true },
};
