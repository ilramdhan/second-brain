// Security response headers (ANALYSIS S11, plan item 1.9). Single source of truth for:
//   * vercel.json `headers` (static assets + SSR on Vercel) — kept in sync by
//     src/server/securityHeaders.test.ts, and
//   * src/server.ts, which adds them to every SSR/API response in production builds on any host
//     (Lovable/Cloudflare, Vercel, Node). On Vercel the static-asset responses get them from
//     vercel.json; values are identical, so a header present twice is harmless. Dev is skipped
//     because the Lovable editor preview embeds the dev server in an iframe.
//
// CSP is split in two:
//   * `Content-Security-Policy` (ENFORCED) only contains directives that cannot break the app:
//     no framing (clickjacking), no <base> hijacking, no plugins, forms post to self only.
//   * `Content-Security-Policy-Report-Only` holds the full resource policy. TanStack Start emits
//     inline hydration scripts without a nonce, so script-src needs 'unsafe-inline', and the
//     Supabase host can be a custom domain. Watch the browser console for violations, then move
//     the policy to the enforced header (see SECURITY.md → "Content Security Policy").
// This module must stay free of Node-only imports (it runs on Cloudflare Workers as well).

export const CSP_ENFORCED = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CSP_ENFORCED,
  "Content-Security-Policy-Report-Only": CSP_REPORT_ONLY,
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // microphone: voice capture in QuickCapture. Everything else the app never uses.
  "Permissions-Policy":
    "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()",
};

/**
 * True when src/server.ts should add the headers: production builds only, unless explicitly
 * disabled with `SECURITY_HEADERS=off` (e.g. a host that already sets its own policy).
 */
export function shouldApplyServerHeaders(env: Record<string, string | undefined>, prod: boolean) {
  return prod && env["SECURITY_HEADERS"] !== "off";
}

/**
 * Returns a response carrying the security headers. Existing values set by a route win (so a
 * route can opt into a different policy). Immutable responses are copied.
 */
export function withSecurityHeaders(response: Response): Response {
  const missing = Object.entries(SECURITY_HEADERS).filter(([k]) => !response.headers.has(k));
  if (!missing.length) return response;
  try {
    for (const [k, v] of missing) response.headers.set(k, v);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    for (const [k, v] of missing) headers.set(k, v);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
