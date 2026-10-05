import { createFileRoute } from "@tanstack/react-router";

// Scheduled digests (workflow 02): ?kind=morning|evening|overdue|weekly[&user_id=].
export const Route = createFileRoute("/api/public/n8n/digest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleN8n, json, readQuery } = await import("@/server/n8n/http.server");
        return handleN8n(request, async () => {
          const { digestQuerySchema } = await import("@/server/n8n/schemas.server");
          const query = readQuery(request, digestQuerySchema);
          const { buildDigests } = await import("@/server/n8n/digest.server");
          return json(await buildDigests(query.kind, query.user_id));
        });
      },
    },
  },
});
