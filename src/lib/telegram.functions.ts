import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Issues a one-time code the signed-in user sends to the bot as `/link <code>`. Previous unused
 * codes of the user are invalidated first, so only the newest code works. Only the SHA-256 hash is
 * stored; the plain code is returned once and never persisted.
 */
export const createTelegramLinkCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // The demo has no Telegram bot: refuse before touching the database.
    const { assertNotDemo } = await import("@/server/demo/mode.server");
    assertNotDemo("Telegram");
    const { generateLinkCode, hashLinkCode, formatLinkCode, linkCodeExpiry } =
      await import("@/server/telegramLinkCode.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: invalidateError } = await supabaseAdmin
      .from("telegram_link_codes")
      .delete()
      .eq("user_id", context.userId)
      .is("used_at", null);
    if (invalidateError) throw new Error("Gagal membuat kode tautan Telegram.");

    const code = generateLinkCode();
    // Insert as the user (RLS: own rows only). expires_at comes from the column default.
    const { data, error } = await context.supabase
      .from("telegram_link_codes")
      .insert({ user_id: context.userId, code_hash: hashLinkCode(code) })
      .select("expires_at")
      .single();
    if (error) throw new Error("Gagal membuat kode tautan Telegram.");

    const { telegramBotUsername, telegramDeepLink } = await import("@/lib/telegram.server");
    const botUsername = telegramBotUsername();
    return {
      code: formatLinkCode(code),
      expiresAt: data?.expires_at ?? linkCodeExpiry().toISOString(),
      // `t.me/<bot>?start=<code>` links the chat in one tap (handled like `/link <code>`).
      deepLink: botUsername ? telegramDeepLink(botUsername, code) : null,
    };
  });
