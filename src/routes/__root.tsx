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
import { AUTHOR, OG_IMAGE, SITE_NAME } from "@/lib/landing";
import { PreferencesProvider } from "@/lib/preferences";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";
import { PwaUpdatePrompt } from "@/components/common/PwaUpdatePrompt";

import appCss from "../styles.css?url";
import { describeError, reportError } from "../lib/error-reporting";
import { isConfigError } from "../lib/errors";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
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
  useEffect(() => {
    reportError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  const config = isConfigError(error);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {config ? "Aplikasi belum dikonfigurasi" : "Halaman ini gagal dimuat"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {config
            ? "Variabel lingkungan Supabase tidak ditemukan. VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY harus diisi saat build (nilainya ditanam ke bundle), lalu build dan deploy ulang. Lihat .env.example."
            : "Terjadi kesalahan. Coba muat ulang, atau kembali ke beranda."}
        </p>
        {import.meta.env.DEV && (
          <pre className="mt-4 max-h-60 overflow-auto rounded bg-muted p-3 text-left text-xs text-muted-foreground">
            {error instanceof Error ? (error.stack ?? error.message) : describeError(error)}
          </pre>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              void router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Coba lagi
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ke beranda
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
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
        content: "Asisten catatan dan tugas pribadi: tangkap pikiran cepat, AI yang merapikan.",
      },
      { name: "application-name", content: SITE_NAME },
      { name: "apple-mobile-web-app-title", content: SITE_NAME },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "author", content: AUTHOR },
      { name: "color-scheme", content: "light dark" },
      { name: "format-detection", content: "telephone=no, date=no, email=no, address=no" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: SITE_NAME },
      { property: "og:description", content: "Asisten catatan dan tugas pribadi dengan AI." },
      { property: "og:image", content: OG_IMAGE.url },
      { property: "og:image:width", content: String(OG_IMAGE.width) },
      { property: "og:image:height", content: String(OG_IMAGE.height) },
      { property: "og:image:alt", content: OG_IMAGE.alt },
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
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
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
  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster position="top-center" richColors />
        <PwaUpdatePrompt />
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
