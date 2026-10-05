import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

// Deploy target for production builds. Defaults to Vercel (emits `.vercel/output`, Build Output
// API). Override with `NITRO_PRESET=<preset>` (e.g. `node-server`, `cloudflare-module`).
const nitroPreset = process.env["NITRO_PRESET"] || "vercel";

export default defineConfig(({ command, mode }) => {
  const isDevBuild = command === "build" && mode === "development";

  // Inline VITE_* variables (from .env files and the process env) as import.meta.env.* constants.
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), "VITE_"))) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
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
      ignoreOutdatedRequests: true,
    },
    server: {
      host: "::",
      port: 8080,
      watch: { awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 } },
    },
  };
});
