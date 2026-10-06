import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

import { prefersReducedMotion } from "@/components/landing/SiteChrome";
import { TECH_LOGOS, TechLogoMark, type TechLogo } from "@/components/landing/tech-logos";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/*
 * Landing extras: the tech stack marquee and the back-to-top button. Static markup that renders
 * on the server; the marquee animation is pure CSS (`.tech-marquee` in src/styles.css).
 */

function TechItem({ logo }: { logo: TechLogo }) {
  return (
    <li
      className="flex shrink-0 items-center gap-2.5 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium text-card-foreground"
      title={logo.name}
    >
      <TechLogoMark logo={logo} className="h-5 w-5 shrink-0" />
      <span className="whitespace-nowrap">{logo.name}</span>
    </li>
  );
}

/**
 * Logos of the main technologies. With motion allowed, two identical tracks slide right → left
 * and the wrapper translates by -50%, so the loop is seamless; hovering or focusing inside pauses
 * it. The second track is `aria-hidden` (screen readers read the list once). With
 * `prefers-reduced-motion: reduce` the duplicate is hidden and the first track wraps into a
 * static grid.
 */
export function TechMarquee() {
  const { t } = usePreferences();
  return (
    // Focusable region so keyboard users can pause the motion too (:focus-within pauses it).
    <div
      role="region"
      aria-label={t("landingTechListLabel")}
      tabIndex={0}
      className="tech-marquee relative overflow-hidden rounded-xl py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="tech-marquee-track flex w-max motion-reduce:w-full">
        <ul className="flex shrink-0 gap-3 pr-3 motion-reduce:w-full motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:pr-0">
          {TECH_LOGOS.map((logo) => (
            <TechItem key={logo.id} logo={logo} />
          ))}
        </ul>
        <ul aria-hidden className="flex shrink-0 gap-3 pr-3 motion-reduce:hidden">
          {TECH_LOGOS.map((logo) => (
            <TechItem key={logo.id} logo={logo} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Shows after ~one viewport of scrolling; scrolls to the top (instant with reduced motion). */
export function BackToTop() {
  const { t } = usePreferences();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight);
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        // Keep keyboard users at the top of the page too (skip link is the first stop).
        document.getElementById("main")?.focus({ preventScroll: true });
      }}
      aria-label={t("landingBackToTop")}
      title={t("landingBackToTop")}
      // `invisible` (visibility: hidden) keeps it out of the tab order and the accessibility tree
      // until it is shown, while still letting the fade transition run.
      data-visible={visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "fixed right-4 bottom-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border bg-background text-foreground shadow-lg transition-[opacity,transform,visibility] duration-200 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none sm:right-6 sm:bottom-6",
        "mb-[env(safe-area-inset-bottom)]",
        visible ? "visible translate-y-0 opacity-100" : "invisible translate-y-2 opacity-0",
      )}
    >
      <ArrowUp className="h-5 w-5" aria-hidden />
    </button>
  );
}
