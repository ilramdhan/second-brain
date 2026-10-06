import { createFileRoute } from "@tanstack/react-router";

// Daily reset of the public demo (Phase 10, docs/DEMO.md). 404 unless APP_MODE=demo.
// Vercel Cron (demo builds only, vite.config.ts) calls GET with `Authorization: Bearer
// $CRON_SECRET` at 00:00 WIB; n8n workflow 09 (optional) calls POST with `x-api-key`.
async function handle(request: Request) {
  const { handleDemoReset } = await import("@/server/demo/resetRoute.server");
  return handleDemoReset(request);
}

export const Route = createFileRoute("/api/public/n8n/demo/reset")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
