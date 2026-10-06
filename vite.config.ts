import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import tsConfigPaths from "vite-tsconfig-paths";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

// Deploy target for production builds. Defaults to Vercel (emits `.vercel/output`, Build Output
// API). Override with `NITRO_PRESET=<preset>` (e.g. `node-server`, `cloudflare-module`).
const nitroPreset = process.env["NITRO_PRESET"] || "vercel";

// VITE_* values are inlined at build time; the browser Supabase client cannot start without these.
const REQUIRED_CLIENT_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];

/**
 * Workbox service worker (`/sw.js`, scope `/`), generated at build time. The hashed client
 * assets are precached; navigations are network-first (falling back to the last cached copy,
 * then `/offline.html`); auth, API and server-function traffic always goes to the network.
 * `registerType: "prompt"` + `virtual:pwa-register/react` drive the "new version" toast in
 * src/components/common/PwaUpdatePrompt.tsx. The web manifest stays in public/.
 */
const PRECACHED_PUBLIC_FILES = [
  "offline.html",
  "manifest.webmanifest",
  "favicon.svg",
  "favicon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
];

function pwa(): PluginOption {
  const plugins = VitePWA({
    strategies: "generateSW",
    filename: "sw.js",
    scope: "/",
    registerType: "prompt",
    injectRegister: false,
    // TanStack Start builds several Vite environments and Nitro points the client build at the
    // host's static dir (`.vercel/output/static` for the vercel preset). Glob and write sw.js in
    // the *client* environment's outDir, which is what the host serves as static files.
    integration: {
      configureOptions(viteConfig, options) {
        const clientOutDir = viteConfig.environments["client"]?.build.outDir;
        if (clientOutDir) options.outDir = clientOutDir;
      },
    },
    manifest: false,
    devOptions: { enabled: false },
    workbox: {
      globPatterns: ["assets/**/*.{js,css,woff2}"],
      // Nitro copies public/ into the static dir only after the client build, so these are not
      // globbed; their revision is a content hash so an edit re-downloads them.
      additionalManifestEntries: PRECACHED_PUBLIC_FILES.map((file) => ({
        url: `/${file}`,
        revision: createHash("sha256")
          .update(readFileSync(new URL(`./public/${file}`, import.meta.url)))
          .digest("hex")
          .slice(0, 16),
      })),
      // Hashed file names: no cache-busting query needed.
      dontCacheBustURLsMatching: /^assets\//,
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      cleanupOutdatedCaches: true,
      inlineWorkboxRuntime: true,
      // The pre-Workbox hand-written worker used `second-brain-shell-v*` caches.
      importScripts: ["/sw-legacy-cleanup.js"],
      navigateFallback: null,
      // Only same-origin pages and images are cached. Server functions (`/_serverFn`), API and
      // public endpoints (`/api/*`), OAuth popups and Supabase (another origin) always hit the
      // network. Workbox serialises these matchers into sw.js, so they must not use closures.
      runtimeCaching: [
        {
          urlPattern: ({ request, url, sameOrigin }) =>
            sameOrigin &&
            request.mode === "navigate" &&
            !/^\/(?:api|_serverFn|oauth)(?:\/|$)/.test(url.pathname),
          handler: "NetworkFirst",
          options: {
            cacheName: "pages",
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 32, maxAgeSeconds: 7 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [200] },
            precacheFallback: { fallbackURL: "/offline.html" },
          },
        },
        {
          urlPattern: ({ request, url, sameOrigin }) =>
            sameOrigin &&
            request.destination === "image" &&
            !/^\/(?:api|_serverFn|oauth)(?:\/|$)/.test(url.pathname),
          handler: "CacheFirst",
          options: {
            cacheName: "images",
            expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [200] },
          },
        },
      ],
    },
  });
  // Generate the worker once, after the client build (not again after the SSR/Nitro builds).
  return plugins.map((plugin) =>
    plugin.name === "vite-plugin-pwa:build"
      ? { ...plugin, applyToEnvironment: (environment) => environment.name === "client" }
      : plugin,
  );
}

export default defineConfig(({ command, mode }) => {
  const isDevBuild = command === "build" && mode === "development";

  // Inline VITE_* variables (from .env files and the process env) as import.meta.env.* constants.
  const viteEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(viteEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  // On Vercel, fail the build instead of shipping a client bundle without Supabase config:
  // the browser client would throw on hydration and every page would show the error page.
  if (command === "build" && process.env["VERCEL"]) {
    const missing = REQUIRED_CLIENT_ENV.filter((key) => !viteEnv[key]);
    if (missing.length > 0) {
      throw new Error(
        `Missing build-time env for the client bundle: ${missing.join(", ")}. ` +
          "Set them in Vercel → Settings → Environment Variables (Production and Preview) and redeploy.",
      );
    }
  }

  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    // Route-level code splitting is always on: TanStack Start forces the router plugin's
    // `autoCodeSplitting` (it is omitted from the Start options schema), so every file in
    // src/routes gets its own chunk. Heavy pieces mounted by the layout are React.lazy instead.
    tanstackStart({
      // Server-only modules must never be pulled into the client bundle.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      server: { entry: "server" },
    }),
    // Nitro only packages the production server; `vite dev` uses TanStack Start's dev server.
    command === "build" ? nitro({ preset: nitroPreset }) : null,
    viteReact(),
    pwa(),
  ];

  return {
    plugins,
    define: envDefine,
    ...(isDevBuild
      ? {
          environments: {
            client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
          },
        }
      : {}),
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": srcDir },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    // Pre-bundle lazily discovered deps so mid-session re-optimization doesn't load two React copies.
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@dnd-kit/core",
        "@tanstack/react-virtual",
        "cmdk",
        "@radix-ui/react-dialog",
        "@radix-ui/react-select",
        "@radix-ui/react-slot",
        "@radix-ui/react-tabs",
        "class-variance-authority",
        "date-fns",
        "date-fns/locale",
        "d3-force",
        "@radix-ui/react-dropdown-menu",
        "@radix-ui/react-switch",
      ],
      ignoreOutdatedRequests: true,
    },
    server: {
      host: "::",
      port: 8080,
      watch: { awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 } },
    },
  };
});
