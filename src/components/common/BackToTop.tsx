import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/** True when the visitor asked the OS for reduced motion (always false outside the browser). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The element that actually scrolls: `container` when it is a scroll box (overflow-y auto/scroll
 * and taller content), otherwise the window (`null`). Pages in the app shell and the landing
 * scroll the window; a layout that makes `main` the scroller is handled the same way.
 */
export function resolveScroller(container: HTMLElement | null | undefined): HTMLElement | null {
  if (!container || typeof window === "undefined") return null;
  const { overflowY } = window.getComputedStyle(container);
  const scrolls = /(auto|scroll|overlay)/.test(overflowY);
  return scrolls && container.scrollHeight > container.clientHeight ? container : null;
}

/**
 * Floating "back to top" button, shared by the landing page and every authenticated page.
 *
 * - Appears after about one viewport of scrolling (`threshold`, default the viewport height).
 * - Scrolls smoothly, or instantly with `prefers-reduced-motion`.
 * - Moves focus to `focusId` (the page's `<main>`) without scrolling, so keyboard and screen
 *   reader users continue from the top too.
 * - Hidden with `visibility: hidden` until shown, which keeps it out of the tab order and the
 *   accessibility tree while the fade still animates.
 * - Placement comes from `className` (e.g. above the mobile bottom nav and its FAB in the app).
 */
export function BackToTop({
  focusId = "main",
  className,
  threshold,
}: {
  focusId?: string;
  className?: string;
  threshold?: number;
}) {
  const { t } = usePreferences();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const main = document.getElementById(focusId);
    const update = () => {
      const scroller = resolveScroller(main);
      const top = scroller ? scroller.scrollTop : window.scrollY;
      setVisible(top > (threshold ?? window.innerHeight));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    main?.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      main?.removeEventListener("scroll", update);
    };
  }, [focusId, threshold]);

  return (
    // eslint-disable-next-line no-restricted-syntax -- exception: floating round FAB with visibility transition
    <button
      type="button"
      onClick={() => {
        const main = document.getElementById(focusId);
        const behavior = prefersReducedMotion() ? "auto" : "smooth";
        const scroller = resolveScroller(main);
        if (scroller) scroller.scrollTo({ top: 0, behavior });
        else window.scrollTo({ top: 0, behavior });
        main?.focus({ preventScroll: true });
      }}
      aria-label={t("backToTop")}
      title={t("backToTop")}
      data-visible={visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "fixed right-4 bottom-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border bg-background text-foreground shadow-lg transition-[opacity,transform,visibility] duration-200 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none sm:right-6 sm:bottom-6",
        "mb-[env(safe-area-inset-bottom)]",
        visible ? "visible translate-y-0 opacity-100" : "invisible translate-y-2 opacity-0",
        className,
      )}
    >
      <ArrowUp className="h-5 w-5" aria-hidden />
    </button>
  );
}
