import { createFileRoute } from "@tanstack/react-router";

// Deadline reminders for n8n (workflow 02, every 15 min). Returns messages; n8n sends them.
// Replaces /api/public/hooks/reminders — run one of the two, not both.
export const Route = createFileRoute("/api/public/n8n/reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleN8n, json, readJson } = await import("@/server/n8n/http.server");
        return handleN8n(request, async () => {
          const { remindersSchema } = await import("@/server/n8n/schemas.server");
          const body = await readJson(request, remindersSchema);
          const { findDueReminders, markReminded } = await import("@/server/reminders.server");
          const { buildReminder } = await import("@/server/n8n/format.server");
          const { appTimezone } = await import("@/server/n8n/time.server");
          const now = new Date();
          const tz = appTimezone();
          const due = await findDueReminders({
            leadMs: body.lead_minutes * 60_000,
            includeOverdue: body.include_overdue,
            limit: body.limit,
            now,
          });
          const messages = due.map(({ task, chatId }) => ({
            chat_id: chatId,
            parse_mode: "HTML" as const,
            task_id: task.id,
            ...buildReminder(task, now, tz),
          }));
          // Marked once the messages are built (at-most-once). Use mark=false to preview.
          if (body.mark) await markReminded(due.map((d) => d.task.id));
          return json({ count: messages.length, messages });
        });
      },
    },
  },
});
