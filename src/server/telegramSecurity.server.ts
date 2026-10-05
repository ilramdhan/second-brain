// Pure security helpers for the Telegram bot webhook. Kept free of I/O so they can be
// unit-tested; the webhook route loads this module with `await import(...)`.
import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Constant-time string comparison. Both sides are hashed first so the buffers passed to
 * `timingSafeEqual` always have equal length and the comparison leaks neither content nor length.
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  return timingSafeEqual(sha256(provided), sha256(expected));
}

export type WebhookSecretCheck = "ok" | "missing-secret" | "mismatch";

/**
 * Fail-closed check of Telegram's `X-Telegram-Bot-Api-Secret-Token` header against
 * `TELEGRAM_WEBHOOK_SECRET`. An unset or empty secret never authorizes a request.
 */
export function checkWebhookSecret(
  header: string | null | undefined,
  secret: string | null | undefined,
): WebhookSecretCheck {
  if (!secret) return "missing-secret";
  return secretsMatch(header, secret) ? "ok" : "mismatch";
}
