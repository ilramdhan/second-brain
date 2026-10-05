const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

/** Sends a Telegram message via the connector gateway. Returns an error string or null. */
export async function sendTelegram(chatId: string, text: string): Promise<string | null> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["TELEGRAM_API_KEY"];
  if (!lovableKey || !connectionKey) return "Bot Telegram belum dihubungkan";
  const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connectionKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Telegram send failed [${res.status}]: ${body}`);
    return `Telegram gagal [${res.status}]`;
  }
  return null;
}
