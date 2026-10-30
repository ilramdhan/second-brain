// Pure security helpers for the Telegram bot webhook. Kept free of I/O so they can be
// unit-tested; the webhook route loads this module with `await import(...)`.
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. `provided` is copied into a buffer of the expected length so
 * `timingSafeEqual` always runs over the same number of bytes: the time depends only on the length
 * of `expected`, never on its content. No hashing, so a secret is never treated as a password
 * digest (CodeQL js/insufficient-password-hash).
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const want = Buffer.from(expected, "utf8");
  const got = Buffer.from(provided, "utf8");
  const padded = Buffer.alloc(want.length);
  got.copy(padded, 0, 0, want.length);
  return timingSafeEqual(padded, want) && got.length === want.length;
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
