// Request handling for /api/public/n8n/demo/reset (Phase 10). Kept out of the route file so it is
// unit-tested and never reaches the client bundle.
//
//   * Not the demo (`APP_MODE` unset): 404 before any auth check, like every demo-only surface.
//   * `Authorization: Bearer <secret>` (GET or POST): Vercel Cron sends CRON_SECRET; any
//     SECOND_BRAIN_CRON_SECRET(_PREVIOUS) works too (authorizeCronRequest).
//   * Otherwise POST with `x-api-key` = N8N_API_KEY through handleN8n (`allowInDemo`), for the
//     optional n8n workflow 09.
// The reset itself calls ensureDemoUser(), so the very first seed after a deploy is one request.
import { authorizeCronRequest, bearerToken } from "../cronAuth.server";
import { handleN8n, json } from "../n8n/http.server";
import { isDemoMode } from "./mode.server";

export type ResetFn = () => Promise<unknown>;

const defaultReset: ResetFn = async () => (await import("./seed.server")).resetDemo();

async function run(reset: ResetFn, request: Request) {
  try {
    return json(await reset());
  } catch (error) {
    console.error("[demo] reset failed", error instanceof Error ? error.message : error);
    const { captureServerError } = await import("../sentry.server");
    await captureServerError(error, { source: "demo-reset", request });
    return json({ error: "reset failed" }, 500);
  }
}

export async function handleDemoReset(
  request: Request,
  reset: ResetFn = defaultReset,
): Promise<Response> {
  if (!isDemoMode()) return json({ error: "not found" }, 404);

  if (bearerToken(request.headers.get("authorization"))) {
    // No legacy app_config.cron_token here: the demo only accepts env secrets.
    if ((await authorizeCronRequest(request)) !== "ok") {
      return json({ error: "unauthorized" }, 401);
    }
    return run(reset, request);
  }

  if (request.method !== "POST") return json({ error: "unauthorized" }, 401);
  return handleN8n(request, () => run(reset, request), { allowInDemo: true });
}
