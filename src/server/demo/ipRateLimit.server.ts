// Per-IP request limiter for the public demo (Phase 10). Fixed one-minute windows kept in
// memory: enough to blunt scripted abuse of one serverless instance without a database round
// trip on every request. Each instance counts on its own, so the effective budget is a multiple
// of the limit; the database write quota (migration 0019) is the hard cap.

export const DEFAULT_DEMO_IP_LIMIT = 120;
export const WINDOW_MS = 60_000;
/** Upper bound on tracked IPs; expired windows go first, then the oldest entries. */
export const MAX_TRACKED_IPS = 5_000;

type Env = Record<string, string | undefined>;
type Bucket = { start: number; count: number };

export type IpRateLimitResult = { allowed: boolean; retryAfter: number };

/** Client IP: `x-real-ip` (set by Vercel), else the first `x-forwarded-for` hop. */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/** Requests per minute per IP (`DEMO_IP_RATE_LIMIT`, default 120). */
export function demoIpLimit(env: Env = typeof process !== "undefined" ? process.env : {}): number {
  const value = Number(env["DEMO_IP_RATE_LIMIT"]);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DEMO_IP_LIMIT;
}

export function createIpRateLimiter(options: {
  limit: number;
  windowMs?: number;
  maxEntries?: number;
  now?: () => number;
}) {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const maxEntries = options.maxEntries ?? MAX_TRACKED_IPS;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  function makeRoom(at: number) {
    for (const [key, bucket] of buckets) {
      if (at - bucket.start >= windowMs) buckets.delete(key);
    }
    // Still full: drop the oldest insertions (a Map iterates in insertion order).
    while (buckets.size >= maxEntries) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  return {
    consume(ip: string): IpRateLimitResult {
      const at = now();
      let bucket = buckets.get(ip);
      if (!bucket || at - bucket.start >= windowMs) {
        if (bucket) buckets.delete(ip);
        else if (buckets.size >= maxEntries) makeRoom(at);
        bucket = { start: at, count: 0 };
        buckets.set(ip, bucket);
      }
      bucket.count++;
      if (bucket.count <= options.limit) return { allowed: true, retryAfter: 0 };
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((bucket.start + windowMs - at) / 1000)),
      };
    },
    size: () => buckets.size,
  };
}

/** Paths that cost server work: server functions and API endpoints. */
export function isLimitedPath(pathname: string): boolean {
  return /^\/(?:_serverFn|api)(?:\/|$)/.test(pathname);
}

let shared: ReturnType<typeof createIpRateLimiter> | undefined;

/**
 * Applies the instance-wide limiter to `request`. Returns a 429 JSON response with
 * `Retry-After` when the IP is over budget, or `null` when the request may continue.
 */
export function demoRateLimitResponse(request: Request, env?: Env): Response | null {
  shared ??= createIpRateLimiter({ limit: demoIpLimit(env) });
  const result = shared.consume(clientIp(request));
  if (result.allowed) return null;
  return new Response(
    JSON.stringify({ error: "Batas demo: terlalu banyak permintaan. Coba lagi sebentar lagi." }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(result.retryAfter),
      },
    },
  );
}
