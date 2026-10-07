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
  "Halo! Saya bot Second Brain. Kirim catatan apa pun ke sini dan akan masuk ke Inbox Anda. " +
  "Pesan dengan tanggal/prioritas/estimasi, atau /task <teks>, langsung jadi tugas lengkap " +
  "(proyek, penanggung jawab, tanggal, estimasi, tag, dependensi, komentar). /note <teks> atau " +
  'pesan yang diawali "catatan:" jadi catatan rapi (subjudul, poin, checklist, tag, tautan).\n\n' +
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
        // The public demo has no Telegram bot: the webhook does not exist there.
        const { isDemoMode } = await import("@/server/demo/mode.server");
        if (isDemoMode())
          return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
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

        // `/note …` / note-like text → a full note (below). `/task …` or free text with a task signal (date, priority, estimate, status) → one
        // fully filled task (AI extraction, regex fallback), same pipeline as n8n mode.
        // Everything else lands in the Inbox.
        const { parseCommand } = await import("@/server/n8n/bot.server");
        const command = parseCommand(text);
        const { appTimezone } = await import("@/server/n8n/time.server");
        const { looksLikeTask, describeResolvedTask } = await import("@/server/taskExtract.server");
        const clock = { now: new Date(), tz: appTimezone() };
        const { looksLikeNote, describeResolvedNote } = await import("@/server/noteExtract.server");
        // `/note …`, or free text starting with "catatan:"/"note:" or holding a [[link]] → one
        // fully filled note (title, blocks, status, project, tags, links, properties).
        const noteText =
          command && (command.cmd === "note" || command.cmd === "catatan")
            ? command.args
            : !command && looksLikeNote(text)
              ? text
              : null;
        if (noteText) {
          const { captureNoteFromText } = await import("@/server/noteCapture.server");
          const result = await captureNoteFromText(profile.id, noteText.slice(0, 4000), {
            clock,
            origin: new URL(request.url).origin,
          });
          const { sendTelegram } = await import("@/lib/telegram.server");
          await sendTelegram(chatId, describeResolvedNote(result.resolved, result.via), {
            parse_mode: "HTML",
          });
          return new Response(JSON.stringify({ ok: true }));
        }
        const taskText =
          command && (command.cmd === "task" || command.cmd === "tugas")
            ? command.args
            : !command && looksLikeTask(text, clock.now, clock.tz)
              ? text
              : null;
        if (taskText) {
          const { captureTaskFromText } = await import("@/server/taskCapture.server");
          const result = await captureTaskFromText(profile.id, taskText.slice(0, 4000), {
            clock,
            origin: new URL(request.url).origin,
          });
          const { sendTelegram } = await import("@/lib/telegram.server");
          await sendTelegram(
            chatId,
            describeResolvedTask(result.resolved, result.via, clock.tz, {
              dependencies: result.dependencies,
              comments: result.comments,
            }),
            { parse_mode: "HTML" },
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
