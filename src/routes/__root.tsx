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
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Second Brain" },
      {
        name: "description",
        content: "Asisten catatan dan tugas pribadi: tangkap pikiran cepat, AI yang merapikan.",
      },
      { name: "theme-color", content: "#1d6f6e" },
      { property: "og:title", content: "Second Brain" },
      { property: "og:description", content: "Asisten catatan dan tugas pribadi dengan AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
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
