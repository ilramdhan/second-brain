import { createFileRoute } from "@tanstack/react-router";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number };
    text?: string;
  };
}

const LINK_HOWTO =
  "Untuk menghubungkan akun: buka Second Brain → Pengaturan → Bot Telegram → " +
  '"Hubungkan Telegram", lalu kirim ke sini: /link KODE (kode berlaku 10 menit, sekali pakai).';
const START_TEXT =
  "Halo! Saya bot Second Brain. Kirim catatan apa pun ke sini dan akan masuk ke Inbox Anda.\n\n" +
  LINK_HOWTO;
const NOT_LINKED_TEXT = "Akun belum terhubung.\n\n" + LINK_HOWTO;
const LINK_FAILED_TEXT =
  "Kode tidak valid atau sudah kedaluwarsa. Buat kode baru di Pengaturan → Bot Telegram, " +
  "lalu kirim /link KODE.";

async function sendTelegramMessage(chatId: number, text: string) {
  const { sendTelegram } = await import("@/lib/telegram.server");
  await sendTelegram(chatId, text);
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

        const { parseLinkCommand, parseStartPayload } =
          await import("@/server/telegramLinkCode.server");

        // /start tanpa kode: kirim instruksi tautan akun. `/start <kode>` (deep link dari
        // Settings, t.me/<bot>?start=<kode>) diperlakukan sama dengan `/link <kode>`.
        const startPayload = parseStartPayload(text);
        if (startPayload === "") {
          await sendTelegramMessage(chatId, START_TEXT);
          return new Response(JSON.stringify({ ok: true }));
        }

        // /link <kode> — tautkan chat ini ke akun lewat kode sekali pakai dari Settings.
        // Pesan seragam untuk kode salah, kedaluwarsa, atau sudah dipakai (tanpa enumerasi).
        const linkArg = startPayload ?? parseLinkCommand(text);
        if (linkArg !== null) {
          const { redeemTelegramLinkCode } = await import("@/server/telegramLink.server");
          const result = await redeemTelegramLinkCode(linkArg, String(chatId), username);
          await sendTelegramMessage(
            chatId,
            result.ok
              ? "Akun terhubung! Semua pesan Anda sekarang masuk ke Inbox Second Brain."
              : LINK_FAILED_TEXT,
          );
          return new Response(JSON.stringify({ ok: true }));
        }

        // Pesan biasa → masuk Inbox milik user yang terhubung
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("telegram_chat_id", String(chatId))
          .maybeSingle();

        if (!profile) {
          await sendTelegramMessage(chatId, NOT_LINKED_TEXT);
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
