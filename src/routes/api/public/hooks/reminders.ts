import { createFileRoute } from "@tanstack/react-router";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Dipanggil berkala oleh cron: kirim pengingat deadline via Telegram.
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

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data: tasks, error } = await supabaseAdmin
    .from("tasks")
    .select("id, user_id, title, due_date")
    .neq("status", "done")
    .eq("reminded", false)
    .is("deleted_at", null)
    .is("archived_at", null)
    .not("due_date", "is", null)
    .lte("due_date", in24h.toISOString())
    .limit(500);
  if (error) {
    console.error("reminders: task query failed", error.message);
    return json({ error: "query failed" }, 500);
  }
  if (!tasks?.length) return json({ success: true, sent: 0 });

  // One profile query for all owners instead of one per task.
  const userIds = [...new Set(tasks.map((t) => t.user_id))];
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, telegram_chat_id")
    .in("id", userIds);
  const chatByUser = new Map(
    (profiles ?? []).filter((p) => p.telegram_chat_id).map((p) => [p.id, p.telegram_chat_id!]),
  );

  const { sendTelegram } = await import("@/lib/telegram.server");
  const reminded: string[] = [];
  for (const task of tasks) {
    const chatId = chatByUser.get(task.user_id);
    if (!chatId) continue;
    const due = new Date(task.due_date!);
    const isOverdue = due < now;
    const err = await sendTelegram(
      chatId,
      `${isOverdue ? "🔴 Terlambat" : "⏰ Segera jatuh tempo"}: ${task.title}\nDeadline: ${due.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
    );
    if (!err) reminded.push(task.id);
  }
  if (reminded.length) {
    await supabaseAdmin.from("tasks").update({ reminded: true }).in("id", reminded);
  }
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
