import { createFileRoute } from "@tanstack/react-router";

// Optional: n8n error/automation events (workflow 03) → activity_logs (no user, source "n8n").
export const Route = createFileRoute("/api/public/n8n/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleN8n, json, readJson } = await import("@/server/n8n/http.server");
        return handleN8n(request, async () => {
          const { eventSchema } = await import("@/server/n8n/schemas.server");
          const body = await readJson(request, eventSchema);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("activity_logs").insert({
            user_id: null,
            action: body.type,
            entity_type: "n8n",
            source: "n8n",
            metadata: {
              workflow: body.workflow ?? null,
              node: body.node ?? null,
              message: body.message ?? null,
              execution_id: body.execution_id ?? null,
              execution_url: body.execution_url ?? null,
              at: body.at ?? new Date().toISOString(),
            },
          });
          if (error) throw new Error(error.message);
          return json({ ok: true });
        });
      },
    },
  },
});
