import { createFileRoute } from "@tanstack/react-router";

// App → Google Calendar sync for every connected user (workflow 07, every 30 min).
export const Route = createFileRoute("/api/public/n8n/calendar/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleN8n, json, readJson } = await import("@/server/n8n/http.server");
        return handleN8n(request, async () => {
          const { calendarSyncSchema } = await import("@/server/n8n/schemas.server");
          const body = await readJson(request, calendarSyncSchema);
          const { syncCalendars } = await import("@/server/n8n/calendarSync.server");
          return json(
            await syncCalendars({
              sinceMinutes: body.since_minutes,
              limit: body.limit,
              mode: body.mode,
              ...(body.user_id ? { userId: body.user_id } : {}),
            }),
          );
        });
      },
    },
  },
});
