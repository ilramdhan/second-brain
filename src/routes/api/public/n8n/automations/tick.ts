import { createFileRoute } from "@tanstack/react-router";

// Scheduled automation rules (workflow 10, every 5 min): runs every rule whose `next_run_at` is
// due, once per window, then computes the next run. 404 on the public demo (handleN8n default):
// scheduled rules can be created there but never run.
export const Route = createFileRoute("/api/public/n8n/automations/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleN8n, json, readJson } = await import("@/server/n8n/http.server");
        return handleN8n(request, async () => {
          const { automationTickSchema } = await import("@/server/n8n/schemas.server");
          const body = await readJson(request, automationTickSchema);
          const { runDueAutomations } = await import("@/server/scheduledAutomations.server");
          return json(
            await runDueAutomations({
              limit: body.limit,
              origin: new URL(request.url).origin,
              ...(body.user_id ? { userId: body.user_id } : {}),
            }),
          );
        });
      },
    },
  },
});
