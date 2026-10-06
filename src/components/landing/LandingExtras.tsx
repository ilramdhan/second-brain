import { TECH_LOGOS, TechLogoMark, type TechLogo } from "@/components/landing/tech-logos";
import { usePreferences } from "@/lib/preferences";

/*
 * Landing extras: the tech stack marquee (and a re-export of the shared back-to-top button). Static markup that renders
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

/** The landing uses the shared back-to-top button (src/components/common/BackToTop.tsx). */
export { BackToTop } from "@/components/common/BackToTop";
