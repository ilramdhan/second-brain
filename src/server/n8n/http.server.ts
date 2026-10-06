// Request plumbing shared by every /api/public/n8n/* route: auth, zod validation and a uniform
// JSON error shape (`{"error": "..."}`) that n8n shows in its execution log.
import { z, ZodError, type ZodType } from "zod";

import { isDemoMode } from "../demo/mode.server";
import { authorizeN8nRequest } from "./auth.server";

export const MAX_BODY_BYTES = 1024 * 1024;

export class N8nHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "N8nHttpError";
  }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

export function zodMessage(error: ZodError) {
  const issue = error.issues[0];
  if (!issue) return "invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Reads and validates a JSON body (size-capped). */
export async function readJson<S extends ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new N8nHttpError(413, "body too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new N8nHttpError(413, "body too large");
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new N8nHttpError(400, "invalid JSON body");
    }
  }
  return schema.parse(raw);
}

/** Validates the query string (`?a=1&b=2` → object of strings). */
export function readQuery<S extends ZodType>(request: Request, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(new URL(request.url).searchParams));
}

export type HandleN8nOptions = {
  /**
   * Keep the endpoint reachable on the public demo (`APP_MODE=demo`). Every n8n endpoint is a
   * 404 there by default, checked before auth, because the demo has no real users, bots or
   * calendars to serve; only endpoints built for the demo (the daily reset) opt in.
   */
  allowInDemo?: boolean;
};

/**
 * Wraps a handler with x-api-key auth and error mapping. Unexpected errors are logged and
 * returned as a generic 500 (no stack traces or database messages leak to n8n).
 */
export async function handleN8n(
  request: Request,
  handler: () => Promise<Response>,
  options: HandleN8nOptions = {},
): Promise<Response> {
  if (!options.allowInDemo && isDemoMode()) return json({ error: "not found" }, 404);
  const auth = authorizeN8nRequest(request);
  if (auth === "not-configured") {
    console.error("[n8n] N8N_API_KEY is not set; rejecting request");
    return json({ error: "N8N_API_KEY not configured" }, 500);
  }
  if (auth !== "ok") return json({ error: "unauthorized" }, 401);
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ZodError) return json({ error: zodMessage(error) }, 400);
    if (error instanceof N8nHttpError) return json({ error: error.message }, error.status);
    console.error("[n8n] handler failed", error instanceof Error ? error.message : error);
    const { captureServerError } = await import("../sentry.server");
    await captureServerError(error, { source: "n8n", request });
    return json({ error: "internal error" }, 500);
  }
}
