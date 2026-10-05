// Authentication for /api/public/n8n/*: header `x-api-key` must equal N8N_API_KEY (or
// N8N_API_KEY_PREVIOUS while rotating), compared in constant time. Fails closed: with no key
// configured every request is rejected (500 so the misconfiguration is visible in n8n).
import { matchesAnySecret } from "../cronAuth.server";

export type N8nAuthResult = "ok" | "unauthorized" | "not-configured";

export function n8nKeysFromEnv(env: Record<string, string | undefined> = process.env) {
  return [env["N8N_API_KEY"], env["N8N_API_KEY_PREVIOUS"]]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
}

export function authorizeN8nRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): N8nAuthResult {
  const keys = n8nKeysFromEnv(env);
  if (!keys.length) return "not-configured";
  const provided = request.headers.get("x-api-key")?.trim() || null;
  return matchesAnySecret(provided, keys) ? "ok" : "unauthorized";
}
