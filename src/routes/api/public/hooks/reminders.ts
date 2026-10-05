import { createFileRoute } from "@tanstack/react-router";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

async function sendTelegramMessage(chatId: string, text: string) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["TELEGRAM_API_KEY"];
  if (!apiKey || !connectionKey) return;
  await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Connection-Api-Key": connectionKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// Dipanggil berkala oleh cron: kirim pengingat deadline via Telegram
export const Route = createFileRoute("/api/public/hooks/reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Verifikasi token cron yang disimpan di tabel app_config (hanya service_role)
        const auth = request.headers.get("authorization");
        const { data: cfg } = await supabaseAdmin
          .from("app_config")
          .select("value")
          .eq("key", "cron_token")
          .maybeSingle();
        if (!cfg?.value || auth !== `Bearer ${cfg.value}`) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }

        const now = new Date();
        const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const { data: tasks, error } = await supabaseAdmin
          .from("tasks")
          .select("id, user_id, title, due_date")
          .neq("status", "done")
          .eq("reminded", false)
          .not("due_date", "is", null)
          .lte("due_date", in24h.toISOString());

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }

        let sent = 0;
        for (const task of tasks ?? []) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("telegram_chat_id")
            .eq("id", task.user_id)
            .maybeSingle();
          if (!profile?.telegram_chat_id) continue;

          const due = new Date(task.due_date!);
          const isOverdue = due < now;
          await sendTelegramMessage(
            profile.telegram_chat_id,
            `${isOverdue ? "🔴 Terlambat" : "⏰ Segera jatuh tempo"}: ${task.title}\nDeadline: ${due.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`,
          );
          await supabaseAdmin.from("tasks").update({ reminded: true }).eq("id", task.id);
          sent++;
        }

        return new Response(JSON.stringify({ success: true, sent }));
      },
    },
  },
});
