import { createFileRoute } from "@tanstack/react-router";

// n8n mode of the Telegram bot (workflow 01). Contract: integrations/n8n/README.md.
export const Route = createFileRoute("/api/public/n8n/bot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleN8n, json, readJson } = await import("@/server/n8n/http.server");
        return handleN8n(request, async () => {
          const { botSchema } = await import("@/server/n8n/schemas.server");
          const body = await readJson(request, botSchema);
          const svc = await import("@/server/n8n/service.server");
          // Telegram update_id is unique per bot: a retried n8n execution gets the same reply.
          const key = String(body.update_id);
          const claim = await svc.claimEvent("telegram", key, null);
          if (claim.duplicate) {
            return json(claim.response ?? { method: "none", duplicate: true });
          }
          try {
            const { handleBot } = await import("@/server/n8n/bot.server");
            const reply = await handleBot(body, new URL(request.url).origin);
            await svc.storeEventResponse("telegram", key, reply);
            return json(reply);
          } catch (error) {
            await svc.releaseEvent("telegram", key);
            throw error;
          }
        });
      },
    },
  },
});
