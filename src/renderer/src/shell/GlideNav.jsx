import { useEffect, useRef } from "react";
import {
  Brain,
  ChartLine,
  Clapperboard,
  Film,
  House,
  ImagePlus,
  LayoutTemplate,
  Library,
  PanelsTopLeft,
  SlidersHorizontal,
  TvMinimalPlay,
  Video,
  Workflow,
} from "../../../../node_modules/lucide-react/dist/esm/lucide-react";

export const ANALYTICS = [{ id: "youtube", label: "YouTube", icon: ChartLine }];
export const NAVS = {
  faceless: {
    main: [
      { id: "home", label: "Home", icon: House },
      { id: "projects", label: "Projects", icon: PanelsTopLeft },
      { id: "channels", label: "Channels", icon: TvMinimalPlay },
      { id: "editor", label: "Editor", icon: Clapperboard },
    ],
    section: "Workspace",
    more: [
      { id: "presets", label: "Styles", icon: SlidersHorizontal },
      { id: "library", label: "Library", icon: Library },
      { id: "memory", label: "Memory", icon: Brain },
      { id: "thumbnails", label: "Thumbnails", icon: ImagePlus },
      { id: "routines", label: "Routines", icon: Workflow },
      { id: "renders", label: "Renders", icon: Film },
    ],
  },
  personal: {
    main: [
      { id: "home", label: "Home", icon: House },
      { id: "projects", label: "Videos", icon: Video },
      { id: "channels", label: "Channels", icon: TvMinimalPlay },
      { id: "editor", label: "Editor", icon: Clapperboard },
    ],
    section: "Studio",
    more: [
      { id: "thumbnails", label: "Thumbnails", icon: ImagePlus },
      { id: "layouts", label: "Layouts", icon: LayoutTemplate },
      { id: "renders", label: "Renders", icon: Film },
    ],
  },
};
export const BRAND_NAME = { faceless: "Faceless Brand", personal: "Personal Brand" };
export const thing = (b) => (b === "personal" ? "video" : "project");
export function GlideNav({ className, children, style }) {
  const ref = useRef(null),
    glide = useRef(null);
  useEffect(() => {
    const nav = ref.current,
      g = glide.current;
    const over = (e) => {
      const b = e.target.closest("button");
      if (!b || !nav.contains(b) || b.disabled) {
        g.classList.remove("on");
        return;
      }
      const jump = !g.classList.contains("on");
      if (jump) g.style.transition = "none";
      g.style.transform = `translateY(${b.offsetTop}px)`;
      g.style.height = `${b.offsetHeight}px`;
      if (jump) {
        void g.offsetHeight;
        g.style.transition = "";
      }
      g.classList.add("on");
    };
    const leave = () => g.classList.remove("on");
    nav.addEventListener("pointerover", over);
    nav.addEventListener("pointerleave", leave);
    return () => {
      nav.removeEventListener("pointerover", over);
      nav.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <nav ref={ref} className={`${className} glide-nav`} style={style}>
      <span ref={glide} className="nav-glide" aria-hidden="true" />
      {children}
    </nav>
  );
}
