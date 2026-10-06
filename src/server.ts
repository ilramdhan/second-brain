import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { isDemoMode } from "./server/demo/mode.server";
import { shouldApplyServerHeaders, withSecurityHeaders } from "./server/securityHeaders";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
// Optional Sentry reporting (no-op without SENTRY_DSN). Loaded lazily so the SDK stays out of
// the request path when monitoring is off; never throws.
async function captureError(error: unknown, request: Request, source: string) {
  try {
    const { captureServerError } = await import("./server/sentry.server");
    await captureServerError(error, { source, request });
  } catch {
    // monitoring must never break the error page
  }
}

async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const error = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(error);
  await captureError(error, request, "ssr");
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Security headers on every SSR/API response in production (see src/server/securityHeaders.ts).
const applyHeaders = shouldApplyServerHeaders(
  typeof process !== "undefined" ? (process.env ?? {}) : {},
  import.meta.env.PROD,
);
const secure = (response: Response) => (applyHeaders ? withSecurityHeaders(response) : response);

// Public demo (APP_MODE=demo): never indexed, and server functions / API endpoints are rate
// limited per IP. Kept outside withSecurityHeaders so the vercel.json header sync is unaffected.
const demoMode = isDemoMode();
const demo = (response: Response) => (demoMode ? withDemoHeaders(response) : response);

function withDemoHeaders(response: Response): Response {
  try {
    response.headers.set("x-robots-tag", "noindex, nofollow");
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set("x-robots-tag", "noindex, nofollow");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

async function demoRateLimit(request: Request): Promise<Response | null> {
  if (!demoMode) return null;
  const { demoRateLimitResponse, isLimitedPath } = await import("./server/demo/ipRateLimit.server");
  return isLimitedPath(new URL(request.url).pathname) ? demoRateLimitResponse(request) : null;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const limited = await demoRateLimit(request);
      if (limited) return demo(secure(limited));
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return demo(secure(await normalizeCatastrophicSsrResponse(response, request)));
    } catch (error) {
      console.error(error);
      await captureError(error, request, "server_entry");
      return demo(
        secure(
          new Response(renderErrorPage(), {
            status: 500,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        ),
      );
    }
  },
};
