// Telegram Bot API client (https://core.telegram.org/bots/api), server-only.
//
// Uses the BotFather token from TELEGRAM_BOT_TOKEN directly; there is no gateway in between.
// The token is part of the request URL, so it is never logged: errors only report the method
// and HTTP status.

const API_BASE = "https://api.telegram.org";
/** Telegram rejects messages longer than 4096 characters. */
export const TELEGRAM_MAX_TEXT = 4096;

export type TelegramSendOptions = {
  parse_mode?: "HTML" | "MarkdownV2";
  reply_markup?: unknown;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
};

export function telegramBotToken(env: Record<string, string | undefined> = process.env) {
  return env["TELEGRAM_BOT_TOKEN"]?.trim() || null;
}

/** Bot username without "@" (optional, used for the t.me deep link in Settings). */
export function telegramBotUsername(env: Record<string, string | undefined> = process.env) {
  const value = env["TELEGRAM_BOT_USERNAME"]?.trim().replace(/^@/, "");
  return value && /^[A-Za-z0-9_]{5,32}$/.test(value) ? value : null;
}

/** Builds `https://t.me/<bot>?start=<payload>`; payload must match Telegram's [A-Za-z0-9_-]{1,64}. */
export function telegramDeepLink(username: string, payload?: string) {
  const url = new URL(`https://t.me/${username}`);
  if (payload && /^[A-Za-z0-9_-]{1,64}$/.test(payload)) url.searchParams.set("start", payload);
  return url.toString();
}

/**
 * Calls a Bot API method. Returns an Indonesian error string, or null on success. Never throws
 * for HTTP errors so callers (reminders, automations) can continue with the next recipient.
 */
export async function callTelegram(
  method: string,
  payload: Record<string, unknown>,
  opts: { token?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const token = opts.token ?? telegramBotToken();
  if (!token) return "Bot Telegram belum dikonfigurasi (TELEGRAM_BOT_TOKEN)";
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let description = "";
      try {
        description = String((JSON.parse(body) as { description?: string }).description ?? "");
      } catch {
        description = "";
      }
      console.error(`Telegram ${method} failed [${res.status}] ${description}`.trim());
      return `Telegram gagal [${res.status}]`;
    }
    return null;
  } catch (error) {
    console.error(`Telegram ${method} failed`, error instanceof Error ? error.message : error);
    return "Telegram tidak dapat dihubungi";
  }
}

/** Sends a text message. Returns an error string or null. */
export async function sendTelegram(
  chatId: string | number,
  text: string,
  options: TelegramSendOptions = {},
): Promise<string | null> {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, TELEGRAM_MAX_TEXT),
    ...options,
  });
}
