import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { isDemo } from "@/lib/app-mode";
import { AUTHOR, OG_IMAGE, SITE_NAME } from "@/lib/landing";
import {
  PreferencesProvider,
  currentLocale,
  usePreferences,
  translate,
  type Locale,
  type MessageKey,
} from "@/lib/preferences";
import { DEFAULT_PREFERENCES, type InitialPreferences } from "@/lib/preference-cookies";
import { getInitialPreferences } from "@/lib/preferences-ssr";
import { headT } from "@/lib/page-head";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";
import { PwaUpdatePrompt } from "@/components/common/PwaUpdatePrompt";
import { Button } from "@/components/ui/button";

import appCss from "../styles.css?url";
import { describeError, reportError } from "../lib/error-reporting";
import { isConfigError } from "../lib/errors";
import { initMonitoring } from "../lib/monitoring";

/**
 * The root not-found/error shells can render outside PreferencesProvider (the root component
 * itself may have failed), so they read the locale from the root loader (the `sb_lang` cookie)
 * and fall back to `<html lang>`.
 */
function useShellT() {
  const locale: Locale =
    (Route.useLoaderData() as InitialPreferences | undefined)?.locale ?? currentLocale();
  return (key: MessageKey) => translate(key, locale);
}

function NotFoundComponent() {
  const t = useShellT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("wsNotFoundTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("wsNotFoundBody")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("wsGoHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Catastrophic errors only (root render, the `_authenticated` guard). Page errors are caught by
 * `RouteError` inside the app shell. Production never shows stack traces or raw messages; the
 * config hint names env vars, not their values.
 */
function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const t = useShellT();
  useEffect(() => {
    reportError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  const config = isConfigError(error);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {config ? t("wsConfigErrorTitle") : t("routeErrorTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {config ? t("wsConfigErrorBody") : t("wsRootErrorBody")}
        </p>
        {import.meta.env.DEV && (
          <pre className="mt-4 max-h-60 overflow-auto rounded bg-muted p-3 text-left text-xs text-muted-foreground">
            {error instanceof Error ? (error.stack ?? error.message) : describeError(error)}
          </pre>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              void router.invalidate();
              reset();
            }}
          >
            {t("retry")}
          </Button>
          <Button asChild variant="secondary">
            <a href="/">{t("wsGoHome")}</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: (ctx) => ({
    // Defaults for every page. Public pages (`/`, `/login`) override title, description, robots,
    // canonical and the Open Graph/Twitter tags via publicPageHead() in src/lib/landing.ts;
    // `_authenticated` adds `noindex`. theme-color lives in RootShell: it needs two tags with the
    // same name (light/dark media), and head() keeps only one meta per name.
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: SITE_NAME },
      {
        name: "description",
        content: headT(ctx)("metaAppDesc"),
      },
      { name: "application-name", content: SITE_NAME },
      { name: "apple-mobile-web-app-title", content: SITE_NAME },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "author", content: AUTHOR },
      { name: "color-scheme", content: "light dark" },
      { name: "format-detection", content: "telephone=no, date=no, email=no, address=no" },
      // The public demo is never indexed (public pages repeat this via publicPageHead).
      ...(isDemo() ? [{ name: "robots", content: "noindex, nofollow" }] : []),
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: SITE_NAME },
      { property: "og:description", content: headT(ctx)("metaAppOgDesc") },
      { property: "og:image", content: OG_IMAGE.url },
      { property: "og:image:width", content: String(OG_IMAGE.width) },
      { property: "og:image:height", content: String(OG_IMAGE.height) },
      { property: "og:image:alt", content: headT(ctx)("metaOgImageAlt") },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE.url },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  // Language/theme from the `sb_lang`/`sb_theme` cookies (the request cookies during SSR), so
  // the server renders the visitor's language and hydration matches it. Synchronous and cheap.
  loader: () => getInitialPreferences(),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // Loader data can be missing when the root itself failed (error shell): fall back to "id".
  const locale = (Route.useLoaderData() as InitialPreferences | undefined)?.locale ?? "id";
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Before any stylesheet paints: apply the stored/system theme (no light flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Browser UI colour = the --background token (src/styles.css) of each scheme. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fbfaf7" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#101418" />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const initial = (Route.useLoaderData() as InitialPreferences | undefined) ?? DEFAULT_PREFERENCES;
  // Optional Sentry + web-vitals; a no-op without VITE_SENTRY_DSN (src/lib/monitoring.ts).
  useEffect(() => {
    initMonitoring();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider initialLocale={initial.locale} initialTheme={initial.theme}>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <HeadLocaleSync loaderLocale={initial.locale} />
        <Toaster position="top-center" richColors />
        <PwaUpdatePrompt />
      </PreferencesProvider>
    </QueryClientProvider>
  );
}

/**
 * Route `head()` functions translate titles with the root loader's locale (the `sb_lang` cookie,
 * src/lib/page-head.ts). When the language changes in the app (Settings, Cmd+K, the landing
 * toggle, or a localStorage value from an older install), the provider has already rewritten the
 * cookie: re-running the loaders picks it up and re-renders every `<title>`/description.
 */
function HeadLocaleSync({ loaderLocale }: { loaderLocale: Locale }) {
  const router = useRouter();
  const { locale } = usePreferences();
  useEffect(() => {
    if (locale !== loaderLocale) void router.invalidate();
  }, [locale, loaderLocale, router]);
  return null;
}
