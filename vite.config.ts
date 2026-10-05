// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Deploy target. Lovable (and any build without these env vars) keeps the wrapper's default
// `cloudflare-module` target; inside the Lovable sandbox the wrapper forces its own preset anyway.
// - `NITRO_PRESET=<preset>` is read by Nitro directly and wins for any target.
// - On Vercel (`VERCEL` is set by the build environment) we pin the `vercel` preset so the build
//   emits `.vercel/output` (Build Output API) instead of a Cloudflare worker.
const nitro =
  process.env["VERCEL"] && !process.env["NITRO_PRESET"] ? { preset: "vercel" as const } : undefined;

export default defineConfig({
  ...(nitro ? { nitro } : {}),
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // Pre-bundle lazily discovered deps so mid-session re-optimization doesn't load two React copies.
    optimizeDeps: {
      include: [
        "@dnd-kit/core",
        "cmdk",
        "@radix-ui/react-dialog",
        "@radix-ui/react-select",
        "@radix-ui/react-slot",
        "@radix-ui/react-tabs",
        "class-variance-authority",
        "date-fns",
        "date-fns/locale",
        "d3-force",
        "@radix-ui/react-popover",
        "@radix-ui/react-dropdown-menu",
        "@radix-ui/react-switch",
      ],
    },
  },
});
