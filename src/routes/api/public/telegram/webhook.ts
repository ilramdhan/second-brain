import { createFileRoute } from "@tanstack/react-router";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number };
    text?: string;
  };
}

async function sendTelegramMessage(chatId: number, text: string) {
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

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Verifikasi header rahasia dari Telegram (fail-closed, constant-time)
        const { checkWebhookSecret } = await import("@/server/telegramSecurity.server");
        const check = checkWebhookSecret(
          request.headers.get("x-telegram-bot-api-secret-token"),
          process.env["TELEGRAM_WEBHOOK_SECRET"],
        );
        if (check !== "ok") {
          if (check === "missing-secret") {
            console.error(
              "[telegram/webhook] TELEGRAM_WEBHOOK_SECRET is not set; rejecting all updates. " +
                "Set it and register it with Telegram via setWebhook(secret_token=...).",
            );
          }
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }

        const update = (await request.json()) as TelegramUpdate;
        const message = update.message;
        if (!message?.text || !message.from) {
          return new Response(JSON.stringify({ ok: true }));
        }

        const chatId = message.chat.id;
        const text = message.text.trim();
        const username = message.from.username ?? null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Perintah /start: kirim instruksi tautan akun
        if (text === "/start") {
          await sendTelegramMessage(
            chatId,
            "Halo! Saya bot Second Brain. Kirim catatan apa pun ke sini dan akan masuk ke Inbox Anda.\n\nUntuk menghubungkan akun, kirim: /link email@anda.com",
          );
          return new Response(JSON.stringify({ ok: true }));
        }

        // /link email — tautkan chat ini ke akun pengguna
        if (text.startsWith("/link ")) {
          const email = text.slice(6).trim().toLowerCase();
          const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
          const target = userData?.users?.find((u) => u.email?.toLowerCase() === email);
          if (target) {
            await supabaseAdmin
              .from("profiles")
              .update({ telegram_chat_id: String(chatId), telegram_username: username })
              .eq("id", target.id);
            await sendTelegramMessage(
              chatId,
              "Akun terhubung! Semua pesan Anda sekarang masuk ke Inbox Second Brain.",
            );
          } else {
            await sendTelegramMessage(
              chatId,
              "Email tidak ditemukan. Pastikan sama dengan email akun Second Brain Anda.",
            );
          }
          return new Response(JSON.stringify({ ok: true }));
        }

        // Pesan biasa → masuk Inbox milik user yang terhubung
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("telegram_chat_id", String(chatId))
          .maybeSingle();

        if (!profile) {
          await sendTelegramMessage(
            chatId,
            "Akun belum terhubung. Kirim: /link email@anda.com (email akun Second Brain Anda).",
          );
          return new Response(JSON.stringify({ ok: true }));
        }

        await supabaseAdmin.from("inbox_items").insert({
          user_id: profile.id,
          content: text,
          source: "telegram",
        });
        await sendTelegramMessage(chatId, "✓ Tersimpan di Inbox");

        return new Response(JSON.stringify({ ok: true }));
      },
    },
  },
});
