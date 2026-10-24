import { useEffect, useRef } from "react";
import {
  BrainIcon,
  ChartLineIcon,
  ClapperboardIcon,
  FilmIcon,
  HouseIcon,
  ImagePlusIcon,
  LayoutTemplateIcon,
  Library,
  PanelsTopLeftIcon,
  SlidersHorizontalIcon,
  TvMinimalPlayIcon,
  VideoIcon,
  WorkflowIcon,
} from "lucide-react";

export const ANALYTICS = [{ id: "youtube", label: "YouTube", icon: ChartLineIcon }];
export const NAVS = {
  faceless: {
    main: [
      { id: "home", label: "Home", icon: HouseIcon },
      { id: "projects", label: "Projects", icon: PanelsTopLeftIcon },
      { id: "channels", label: "Channels", icon: TvMinimalPlayIcon },
      { id: "editor", label: "Editor", icon: ClapperboardIcon },
    ],
    section: "Workspace",
    more: [
      { id: "presets", label: "Styles", icon: SlidersHorizontalIcon },
      { id: "library", label: "Library", icon: Library },
      { id: "memory", label: "Memory", icon: BrainIcon },
      { id: "thumbnails", label: "Thumbnails", icon: ImagePlusIcon },
      { id: "routines", label: "Routines", icon: WorkflowIcon },
      { id: "renders", label: "Renders", icon: FilmIcon },
    ],
  },
  personal: {
    main: [
      { id: "home", label: "Home", icon: HouseIcon },
      { id: "projects", label: "Videos", icon: VideoIcon },
      { id: "channels", label: "Channels", icon: TvMinimalPlayIcon },
      { id: "editor", label: "Editor", icon: ClapperboardIcon },
    ],
    section: "Studio",
    more: [
      { id: "thumbnails", label: "Thumbnails", icon: ImagePlusIcon },
      { id: "layouts", label: "Layouts", icon: LayoutTemplateIcon },
      { id: "renders", label: "Renders", icon: FilmIcon },
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
