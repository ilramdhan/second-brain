import { createFileRoute } from "@tanstack/react-router";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Dipanggil berkala oleh cron: kirim pengingat deadline via Telegram (≤ 24 jam ke depan).
// Jalankan ini ATAU /api/public/n8n/reminders, bukan keduanya.
// Auth: `Authorization: Bearer <secret>` dengan SECOND_BRAIN_CRON_SECRET(_PREVIOUS), CRON_SECRET
// (Vercel Cron) atau token lama app_config.cron_token. GET didukung untuk Vercel Cron.
async function handle(request: Request) {
  const { authorizeCronRequest } = await import("@/server/cronAuth.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const auth = await authorizeCronRequest(request, {
    loadLegacyToken: async () => {
      const { data } = await supabaseAdmin
        .from("app_config")
        .select("value")
        .eq("key", "cron_token")
        .maybeSingle();
      return data?.value ?? null;
    },
  });
  if (auth !== "ok") return json({ error: "unauthorized" }, 401);

  const { findDueReminders, markReminded } = await import("@/server/reminders.server");
  let due;
  try {
    due = await findDueReminders({ leadMs: 24 * 60 * 60 * 1000, includeOverdue: true, limit: 500 });
  } catch (error) {
    console.error("reminders:", error instanceof Error ? error.message : error);
    return json({ error: "query failed" }, 500);
  }
  if (!due.length) return json({ success: true, sent: 0 });

  const now = new Date();
  const { sendTelegram } = await import("@/lib/telegram.server");
  const reminded: string[] = [];
  for (const { task, chatId } of due) {
    const dueAt = new Date(task.due_date);
    const err = await sendTelegram(
      chatId,
      `${dueAt < now ? "🔴 Terlambat" : "⏰ Segera jatuh tempo"}: ${task.title}\nDeadline: ${dueAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
    );
    if (!err) reminded.push(task.id);
  }
  await markReminded(reminded);
  return json({ success: true, sent: reminded.length });
}

export const Route = createFileRoute("/api/public/hooks/reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});
