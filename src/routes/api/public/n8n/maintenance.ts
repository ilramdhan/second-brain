import { createFileRoute } from "@tanstack/react-router";

// Daily housekeeping (workflow 02): purge old trash, expired link codes, rate limits, n8n events.
export const Route = createFileRoute("/api/public/n8n/maintenance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleN8n, json, readJson } = await import("@/server/n8n/http.server");
        return handleN8n(request, async () => {
          const { maintenanceSchema } = await import("@/server/n8n/schemas.server");
          const body = await readJson(request, maintenanceSchema);
          const { runMaintenance } = await import("@/server/n8n/maintenance.server");
          return json(await runMaintenance(body));
        });
      },
    },
  },
});
