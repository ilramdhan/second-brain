// Redeems a one-time `/link <code>` (or `/start <code>` deep link) for a Telegram chat. Shared by
// the app-mode webhook and the n8n-mode bot endpoint so both enforce exactly the same rules.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { hashLinkCode, normalizeLinkCode } from "./telegramLinkCode.server";

export type LinkResult = { ok: true; userId: string } | { ok: false };

export async function redeemTelegramLinkCode(
  rawCode: string,
  chatId: string,
  username: string | null,
): Promise<LinkResult> {
  const code = normalizeLinkCode(rawCode);
  if (!code) return { ok: false };
  const now = new Date().toISOString();
  // Atomic: succeeds only for an unused, unexpired code.
  const { data: redeemed } = await supabaseAdmin
    .from("telegram_link_codes")
    .update({ used_at: now })
    .eq("code_hash", hashLinkCode(code))
    .is("used_at", null)
    .gt("expires_at", now)
    .select("user_id")
    .maybeSingle();
  if (!redeemed) return { ok: false };

  // A chat is linked to at most one account.
  await supabaseAdmin
    .from("profiles")
    .update({ telegram_chat_id: null, telegram_username: null })
    .eq("telegram_chat_id", chatId)
    .neq("id", redeemed.user_id);
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ telegram_chat_id: chatId, telegram_username: username })
    .eq("id", redeemed.user_id);
  if (error) {
    console.error("[telegram] failed to link chat", error.message);
    return { ok: false };
  }
  return { ok: true, userId: redeemed.user_id };
}
