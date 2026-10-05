import { createFileRoute } from "@tanstack/react-router";

// Generic capture (email 08, Google Calendar 07, webhooks). Idempotent by `external_id`.
export const Route = createFileRoute("/api/public/n8n/capture")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleN8n, json, readJson } = await import("@/server/n8n/http.server");
        return handleN8n(request, async () => {
          const { captureSchema } = await import("@/server/n8n/schemas.server");
          const body = await readJson(request, captureSchema);
          const { capture, resolveCaptureUser } = await import("@/server/n8n/capture.server");
          const svc = await import("@/server/n8n/service.server");
          const userId = await resolveCaptureUser(body);
          const key = body.external_id ?? null;
          if (key) {
            const claim = await svc.claimEvent(body.source, key, userId);
            if (claim.duplicate) {
              const prev = (claim.response ?? {}) as Record<string, unknown>;
              return json({ ok: true, ...prev, duplicate: true });
            }
          }
          try {
            const result = await capture(userId, body, new URL(request.url).origin);
            if (key) await svc.storeEventResponse(body.source, key, result);
            return json({ ...result, duplicate: false }, 201);
          } catch (error) {
            if (key) await svc.releaseEvent(body.source, key);
            throw error;
          }
        });
      },
    },
  },
});
