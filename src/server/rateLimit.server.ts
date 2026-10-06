// Per-user rate limiting backed by the `consume_rate_limit` Postgres function (migration 0011).
// The function uses auth.uid(), so it must be called with the caller's RLS client
// (`context.supabase` from requireSupabaseAuth), never with the service-role client.

export type RateLimitRule = { bucket: string; max: number; windowSeconds: number };

/** Shared budget for every AI gateway call (brain dump, paraphrase, summary, OCR, voice). */
export const AI_RATE_LIMIT: RateLimitRule = { bucket: "ai", max: 30, windowSeconds: 600 };

/**
 * Background embedding of edited tasks/notes for semantic search (each call embeds up to a few
 * batches in one provider request each). Separate from AI_RATE_LIMIT so indexing never blocks
 * the interactive AI features; the semantic search query itself still uses AI_RATE_LIMIT.
 */
export const SEMANTIC_INDEX_RATE_LIMIT: RateLimitRule = {
  bucket: "ai_embed",
  max: 60,
  windowSeconds: 600,
};

/**
 * Default demo write quota (migration 0019). Enforced in Postgres by the `zz_demo_write`
 * statement triggers through `consume_rate_limit`, only when `app_config.demo_mode = 'on'`;
 * `demo_write_max` / `demo_write_window` in `app_config` override these values. Errors start
 * with "Batas demo: ".
 */
export const DEMO_WRITE_LIMIT: RateLimitRule = {
  bucket: "demo_write",
  max: 600,
  windowSeconds: 3600,
};

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

/** Human-friendly window ("10 menit", "1 jam", "45 detik"). */
export function formatWindow(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} jam`;
  if (seconds % 60 === 0) return `${seconds / 60} menit`;
  return `${seconds} detik`;
}

export function rateLimitMessage(rule: RateLimitRule): string {
  return `Batas penggunaan AI tercapai (${rule.max} permintaan per ${formatWindow(rule.windowSeconds)}). Coba lagi sebentar lagi.`;
}

type RpcClient = {
  rpc: (
    fn: "consume_rate_limit",
    args: { _bucket: string; _max: number; _window_seconds: number },
  ) => PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
};

/**
 * Consumes one unit of `rule` for the current user. Throws `RateLimitError` when the budget is
 * exhausted. Fails closed: if the limiter itself errors, the call is rejected too, so a broken
 * or missing migration cannot turn into unlimited AI spend.
 */
export async function enforceRateLimit(client: RpcClient, rule: RateLimitRule): Promise<void> {
  const { data, error } = await client.rpc("consume_rate_limit", {
    _bucket: rule.bucket,
    _max: rule.max,
    _window_seconds: rule.windowSeconds,
  });
  if (error) {
    console.error("rate limit check failed:", error.message);
    throw new RateLimitError("Layanan AI sedang tidak tersedia. Coba lagi nanti.");
  }
  if (data !== true) throw new RateLimitError(rateLimitMessage(rule));
}

/** Decoded size of a base64 string without decoding it (ignores whitespace-free padding). */
export function base64DecodedBytes(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
