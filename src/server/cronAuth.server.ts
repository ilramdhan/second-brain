// Authentication for cron-triggered endpoints (e.g. /api/public/hooks/reminders).
//
// Accepted credentials, all compared in constant time (sha256 + timingSafeEqual):
//   * `SECOND_BRAIN_CRON_SECRET` and `SECOND_BRAIN_CRON_SECRET_PREVIOUS` (n8n, GitHub Actions or
//     any external scheduler; the previous value allows zero-downtime rotation)
//   * `CRON_SECRET` (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`)
//   * legacy `app_config.cron_token` (service-role table) — looked up only when a bearer token
//     is present and no env secret matched, so unauthenticated requests never hit the database.
import { secretsMatch } from "./telegramSecurity.server";

/** Extracts the token from `Authorization: Bearer <token>`; null when absent or malformed. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer ([^\s,]+)$/.exec(header ?? "");
  return match?.[1] ?? null;
}

/** Non-empty configured secrets from the environment, current before previous. */
export function cronSecretsFromEnv(env: Record<string, string | undefined> = process.env) {
  return [
    env["SECOND_BRAIN_CRON_SECRET"],
    env["SECOND_BRAIN_CRON_SECRET_PREVIOUS"],
    env["CRON_SECRET"],
  ]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
}

/** True when `token` equals any secret. Every secret is compared (no early exit). */
export function matchesAnySecret(token: string | null, secrets: readonly string[]): boolean {
  if (!token) return false;
  let ok = false;
  for (const secret of secrets) ok = secretsMatch(token, secret) || ok;
  return ok;
}

export type CronAuthResult = "ok" | "unauthorized";

/**
 * Authorizes a cron request. `loadLegacyToken` is only called when a bearer token is present
 * and no env secret matched (backward compatibility with `app_config.cron_token`).
 */
export async function authorizeCronRequest(
  request: Request,
  opts: {
    env?: Record<string, string | undefined>;
    loadLegacyToken?: () => Promise<string | null | undefined>;
  } = {},
): Promise<CronAuthResult> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return "unauthorized";
  if (matchesAnySecret(token, cronSecretsFromEnv(opts.env))) return "ok";
  if (opts.loadLegacyToken) {
    const legacy = (await opts.loadLegacyToken())?.trim();
    if (legacy && matchesAnySecret(token, [legacy])) return "ok";
  }
  return "unauthorized";
}
