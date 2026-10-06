// Optional server-side error reporting to Sentry (plan item 8.1).
//
// Enabled only when SENTRY_DSN is set; otherwise every export is a cheap no-op and nothing is
// imported or sent. Uses `@sentry/core`'s runtime-agnostic `ServerRuntimeClient` with a plain
// `fetch` transport instead of `@sentry/node`: the Node SDK pulls in OpenTelemetry and relies on
// `--import` preloading / module patching, which Nitro's bundled Vercel functions do not run, and
// we only need "send this exception" (no auto-instrumentation). The same code works on Node,
// Vercel and Cloudflare.
//
// Privacy: no request bodies, headers, cookies, query strings or IPs; user id only (see
// src/lib/monitoring-config.ts and SECURITY.md → "Error monitoring").
import type { Client, ErrorEvent, Event, StackParser } from "@sentry/core";

import {
  parseSampleRate,
  readDsn,
  scrubBreadcrumb,
  scrubEvent,
  stripQuery,
} from "@/lib/monitoring-config";

type Env = Record<string, string | undefined>;

export type ServerErrorContext = {
  /** Where the error was caught, e.g. "ssr", "server_fn", "n8n". */
  source: string;
  request?: Request;
  userId?: string;
  tags?: Record<string, string>;
};

let clientPromise: Promise<Client | undefined> | undefined;

function env(): Env {
  return typeof process !== "undefined" ? (process.env ?? {}) : {};
}

export function isServerMonitoringEnabled(e: Env = env()): boolean {
  return readDsn(e["SENTRY_DSN"]) != null;
}

async function createClient(e: Env): Promise<Client | undefined> {
  const dsn = readDsn(e["SENTRY_DSN"]);
  if (!dsn) return undefined;
  const core = await import("@sentry/core");
  const { ServerRuntimeClient, nodeStackLineParser } = await import("@sentry/core/server");
  const stackParser: StackParser = core.createStackParser(nodeStackLineParser());
  const client = new ServerRuntimeClient({
    dsn,
    environment: e["SENTRY_ENVIRONMENT"] || e["VERCEL_ENV"] || "production",
    release: e["SENTRY_RELEASE"] || e["VERCEL_GIT_COMMIT_SHA"] || undefined,
    tracesSampleRate: parseSampleRate(e["SENTRY_TRACES_SAMPLE_RATE"]),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    platform: "javascript",
    runtime: { name: "node", version: typeof process !== "undefined" ? process.version : "" },
    stackParser,
    integrations: [
      core.dedupeIntegration(),
      core.linkedErrorsIntegration(),
      core.functionToStringIntegration(),
    ],
    transport: (options) =>
      core.createTransport(options, async (request) => {
        const res = await fetch(options.url, { method: "POST", body: request.body as BodyInit });
        return {
          statusCode: res.status,
          headers: {
            "x-sentry-rate-limits": res.headers.get("x-sentry-rate-limits"),
            "retry-after": res.headers.get("retry-after"),
          },
        };
      }),
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  client.init();
  return client;
}

function getClient(e: Env = env()): Promise<Client | undefined> {
  if (!isServerMonitoringEnabled(e)) return Promise.resolve(undefined);
  clientPromise ??= createClient(e).catch((error: unknown) => {
    console.warn("[sentry] init failed", error instanceof Error ? error.message : error);
    return undefined;
  });
  return clientPromise;
}

/** Builds the minimal, scrubbed request context attached to server events. */
export function requestContext(request: Request | undefined): Event["request"] | undefined {
  if (!request) return undefined;
  return { url: stripQuery(request.url), method: request.method };
}

/**
 * Reports an unexpected server error. Never throws; returns once the event is flushed (bounded
 * by `timeoutMs`) so serverless functions don't freeze before the request leaves.
 */
export async function captureServerError(
  error: unknown,
  context: ServerErrorContext,
  timeoutMs = 2000,
): Promise<void> {
  try {
    const client = await getClient();
    if (!client) return;
    const { Scope } = await import("@sentry/core");
    const scope = new Scope();
    scope.setClient(client);
    scope.setTag("source", context.source);
    if (context.tags) scope.setTags(context.tags);
    if (context.userId) scope.setUser({ id: context.userId });
    const req = requestContext(context.request);
    if (req) {
      scope.addEventProcessor((event) => ({ ...event, request: req }));
      try {
        scope.setTag("route", new URL(context.request!.url).pathname);
      } catch {
        // relative or malformed URL; skip the tag
      }
    }
    client.captureException(error, undefined, scope);
    await client.flush(timeoutMs);
  } catch (reportError) {
    console.warn(
      "[sentry] capture failed",
      reportError instanceof Error ? reportError.message : reportError,
    );
  }
}

/** Test hook: forget the cached client. */
export function resetServerMonitoringForTests() {
  clientPromise = undefined;
}
