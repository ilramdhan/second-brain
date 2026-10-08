import { Link } from "@tanstack/react-router";
import { Brain, Menu, Monitor, Moon, Play, Sun } from "lucide-react";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { APP_VERSION, GIT_SHA, releaseTagUrl } from "@/lib/app-version";
import {
  demoUrl,
  ENV_EXAMPLE_URL,
  GITHUB_URL,
  LICENSE_URL,
  N8N_DOCS_URL,
  SECURITY_URL,
  SELF_HOST_DOCS_URL,
} from "@/lib/landing";
import { usePreferences, type MessageKey, type Theme } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/components/common/BackToTop";

/*
 * Header and footer shared by the public pages (landing, privacy, terms). No data hooks and no
 * Supabase, so these chunks stay small and render on the server.
 */

export const PAGE = "mx-auto w-full max-w-6xl px-4 sm:px-5 md:px-6";
export const TEXT_LINK =
  "rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Landing sections reachable from the header menu, in page order. */
export const SECTIONS = [
  { id: "fitur", label: "landingNavFeatures" },
  { id: "cara-kerja", label: "landingNavHowItWorks" },
  { id: "integrasi", label: "landingNavIntegrations" },
  { id: "teknologi", label: "landingNavTech" },
  { id: "self-host", label: "landingNavSelfHost" },
  { id: "faq", label: "landingNavFaq" },
] as const satisfies readonly { id: string; label: MessageKey }[];

export type SectionId = (typeof SECTIONS)[number]["id"];

// Shared with the app shell's back-to-top button; re-exported for existing landing imports.
export { prefersReducedMotion };

/**
 * Scrolls to a landing section: smooth unless reduced motion is requested. The hash is updated
 * for sharing/back navigation and focus moves to the section so keyboard and screen reader
 * users continue reading from there.
 */
export function scrollToSection(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  if (window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
  el.focus({ preventScroll: true });
  return true;
}

/** GitHub mark (lucide no longer ships brand icons). */
export function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/** Cycles system → light → dark; same preference store (localStorage) as Settings. */
function ThemeToggle() {
  const { theme, setTheme, t } = usePreferences();
  const Icon = THEME_ICON[theme];
  const next = NEXT_THEME[theme];
  return (
    <Button
      type="button"
      variant="tertiary"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`${t("landingThemeLabel")}: ${t(theme)}`}
      title={`${t("landingThemeLabel")}: ${t(theme)}`}
    >
      <Icon aria-hidden />
    </Button>
  );
}

function LanguageToggle() {
  const { locale, setLocale, t } = usePreferences();
  return (
    <Button
      type="button"
      variant="tertiary"
      size="icon"
      className="text-xs font-semibold"
      onClick={() => setLocale(locale === "id" ? "en" : "id")}
      aria-label={t("landingLanguageLabel")}
      title={t("landingLanguageLabel")}
      lang={locale === "id" ? "en" : "id"}
    >
      {locale === "id" ? "EN" : "ID"}
    </Button>
  );
}

/** Visually hidden "(new tab)" suffix for links that open in a new tab. */
export function NewTab() {
  const { t } = usePreferences();
  return <span className="sr-only"> {t("landingNewTab")}</span>;
}

/**
 * Link to a landing section. On the landing page (`onLanding`) it scrolls in place (smooth,
 * reduced-motion aware); elsewhere it is a plain link to `/#id`. Without JavaScript both are
 * ordinary anchors.
 */
function SectionLink({
  id,
  onLanding,
  className,
  onNavigate,
  children,
}: {
  id: string;
  onLanding: boolean;
  className?: string;
  onNavigate?: (id: string, event: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  return (
    <a
      href={onLanding ? `#${id}` : `/#${id}`}
      className={className}
      onClick={(event) => {
        if (!onLanding || event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (onNavigate) onNavigate(id, event);
        else if (scrollToSection(id)) event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

const NAV_LINK =
  "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Compact menu (below `lg`): the section links, demo, GitHub and sign-in in a shadcn Sheet. */
function MobileMenu({ onLanding, demo }: { onLanding: boolean; demo: string | null }) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  // Section chosen in the sheet; scrolled to once the sheet has closed and released the scroll
  // lock (scrolling while the dialog is open would be undone).
  const pending = useRef<string | null>(null);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="tertiary"
          size="icon"
          className="lg:hidden"
          aria-label={t("landingMenuOpen")}
        >
          <Menu aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex flex-col gap-6"
        onCloseAutoFocus={(event) => {
          const id = pending.current;
          pending.current = null;
          if (!id) return;
          event.preventDefault();
          requestAnimationFrame(() => scrollToSection(id));
        }}
      >
        <SheetHeader>
          <SheetTitle>Second Brain</SheetTitle>
          <SheetDescription>{t("landingMenuDescription")}</SheetDescription>
        </SheetHeader>
        <nav aria-label={t("landingMenuLabel")}>
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <SectionLink
                  id={section.id}
                  onLanding={onLanding}
                  className={cn(NAV_LINK, "block px-3 py-2 text-base")}
                  onNavigate={(id, event) => {
                    event.preventDefault();
                    pending.current = id;
                    setOpen(false);
                  }}
                >
                  {t(section.label)}
                </SectionLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          {demo && (
            <Button asChild>
              <a href={demo}>
                <Play aria-hidden />
                {t("landingDemo")}
              </a>
            </Button>
          )}
          <Button asChild variant="secondary">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GithubMark />
              GitHub
              <NewTab />
            </a>
          </Button>
          <Button asChild>
            <Link to="/login">{t("landingSignIn")}</Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Sticky site header with the section menu (desktop inline, mobile sheet). */
export function SiteHeader({ onLanding = false }: { onLanding?: boolean }) {
  const { t } = usePreferences();
  const demo = demoUrl();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className={cn(PAGE, "flex h-16 items-center justify-between gap-2")}>
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Brain className="h-6 w-6 text-primary" aria-hidden />
          Second Brain
        </Link>
        <nav aria-label={t("landingMenuLabel")} className="hidden lg:block">
          <ul className="flex items-center gap-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <SectionLink id={section.id} onLanding={onLanding} className={NAV_LINK}>
                  {t(section.label)}
                </SectionLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <LanguageToggle />
          <Button asChild variant="tertiary" size="icon" className="hidden xl:inline-flex">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub">
              <GithubMark />
            </a>
          </Button>
          {/* The demo is its own deployment; it opens in the same tab like any other page. */}
          {demo && (
            <Button asChild variant="secondary" className="ml-1 hidden sm:inline-flex">
              <a href={demo}>
                <Play aria-hidden />
                {t("landingDemo")}
              </a>
            </Button>
          )}
          <Button asChild className="ml-1 hidden sm:inline-flex">
            <Link to="/login">{t("landingSignIn")}</Link>
          </Button>
          <MobileMenu onLanding={onLanding} demo={demo} />
        </div>
      </div>
    </header>
  );
}

type FooterLink =
  | { label: MessageKey | "GitHub"; href: string; external?: boolean }
  | { label: MessageKey; section: SectionId }
  | { label: MessageKey; to: "/privacy" | "/terms" };

const FOOTER_COLUMNS: { title: MessageKey; links: FooterLink[] }[] = [
  {
    title: "landingFooterPages",
    links: [
      { label: "landingNavFeatures", section: "fitur" },
      { label: "landingNavHowItWorks", section: "cara-kerja" },
      { label: "landingNavSelfHost", section: "self-host" },
      { label: "GitHub", href: GITHUB_URL, external: true },
    ],
  },
  {
    title: "landingFooterDocs",
    links: [
      { label: "landingFooterSelfHostGuide", href: SELF_HOST_DOCS_URL, external: true },
      { label: "landingFooterN8n", href: N8N_DOCS_URL, external: true },
      { label: "landingFooterEnv", href: ENV_EXAMPLE_URL, external: true },
      { label: "landingNavFaq", section: "faq" },
    ],
  },
  {
    title: "landingFooterLegal",
    links: [
      { label: "legalPrivacy", to: "/privacy" },
      { label: "legalTerms", to: "/terms" },
      { label: "landingLicense", href: LICENSE_URL, external: true },
      { label: "landingSecurity", href: SECURITY_URL, external: true },
    ],
  },
];

/** Column footer: pages, docs, legal, then version (release tag) and the made-in line. */
export function SiteFooter({ onLanding = false }: { onLanding?: boolean }) {
  const { t } = usePreferences();
  const label = (key: MessageKey | "GitHub") => (key === "GitHub" ? key : t(key));
  return (
    <footer className="border-t bg-muted/30">
      <div className={cn(PAGE, "grid gap-8 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4")}>
        <div className="space-y-2">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Brain className="h-5 w-5 text-primary" aria-hidden />
            Second Brain
          </Link>
          <p className="max-w-xs text-muted-foreground">{t("landingFooter")}</p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.title} aria-label={t(column.title)}>
            <h2 className="font-semibold text-foreground">{t(column.title)}</h2>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              {column.links.map((link) => (
                <li key={link.label}>
                  {"section" in link ? (
                    <SectionLink id={link.section} onLanding={onLanding} className={TEXT_LINK}>
                      {label(link.label)}
                    </SectionLink>
                  ) : "to" in link ? (
                    <Link to={link.to} className={TEXT_LINK}>
                      {label(link.label)}
                    </Link>
                  ) : (
                    <a href={link.href} target="_blank" rel="noreferrer" className={TEXT_LINK}>
                      {label(link.label)}
                      <NewTab />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <div
          className={cn(
            PAGE,
            "flex flex-col gap-2 py-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
          )}
        >
          {/* Server and browser years differ only around New Year's Eve. */}
          <p suppressHydrationWarning>
            © {new Date().getFullYear()} Second Brain ·{" "}
            <a href={releaseTagUrl()} target="_blank" rel="noreferrer" className={TEXT_LINK}>
              <span className="font-mono">
                v{APP_VERSION} · {GIT_SHA}
              </span>
              <span className="sr-only"> {t("landingFooterRelease")}</span>
              <NewTab />
            </a>
          </p>
          <p>{t("landingMadeIn")}</p>
        </div>
      </div>
    </footer>
  );
}

/** Skip link to `#main` (first focusable element of every public page). */
export function SkipLink() {
  const { t } = usePreferences();
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t("landingSkip")}
    </a>
  );
}
