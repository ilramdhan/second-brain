import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Same bound as the server-side extractor (MAX_EXTRACT_INPUT in taskExtract.server.ts).
const MAX_CAPTURE_CHARS = 4000;
/** Same tighter demo bound as the other AI server functions (ai.functions.ts). */
const DEMO_MAX_CAPTURE_CHARS = 2000;

/**
 * Inbox → one fully filled task ("Jadikan tugas (AI)"). AI structured extraction when available
 * (per-user AI budget), otherwise the local regex parser; references are validated against the
 * caller's own projects/members/open tasks and the task, its dependencies and comments are written
 * with the caller's RLS client, followed by the automation rules. The inbox item is marked
 * processed. Returns the created task and which fields were filled.
 */
export const captureInboxTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      itemId: z.guid(),
      text: z.string().trim().min(1, "Teks kosong").max(MAX_CAPTURE_CHARS, "Teks terlalu panjang"),
    }),
  )
  .handler(async ({ data, context }) => {
    const request = getRequest();
    const { isDemoMode } = await import("@/server/demo/mode.server");
    if (isDemoMode() && data.text.length > DEMO_MAX_CAPTURE_CHARS)
      throw new Error(`Batas demo: teks maks ${DEMO_MAX_CAPTURE_CHARS} karakter.`);
    const { loadTaskCandidates, extractTaskFields, writeExtractedTask } =
      await import("@/server/taskCapture.server");
    const { resolveExtraction } = await import("@/server/taskExtract.server");
    const { appTimezone } = await import("@/server/n8n/time.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item } = await context.supabase
      .from("inbox_items")
      .select("id,status")
      .eq("id", data.itemId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!item || item.status !== "pending") throw new Error("Item Inbox sudah diproses");

    const clock = { now: new Date(), tz: appTimezone() };
    // Candidate names come from the service role, scoped to the caller's own access.
    const candidates = await loadTaskCandidates(context.userId, supabaseAdmin);
    const { extraction, via, reason } = await extractTaskFields(data.text, candidates, clock, {
      assertAi: async () => {
        const { assertAiAvailable } = await import("./ai.server");
        await assertAiAvailable();
      },
      consume: async () => {
        const { enforceRateLimit, AI_RATE_LIMIT } = await import("@/server/rateLimit.server");
        await enforceRateLimit(context.supabase, AI_RATE_LIMIT);
        return true;
      },
      ai: async (text, c, clk) => {
        const { aiExtractTask } = await import("./ai.server");
        return aiExtractTask(request, text, c, clk);
      },
    });
    const resolved = resolveExtraction(extraction, candidates, clock, data.text);
    let origin: string | null;
    try {
      origin = new URL(request.url).origin;
    } catch {
      origin = null;
    }
    const written = await writeExtractedTask(context.supabase, context.userId, resolved, origin);
    await context.supabase
      .from("inbox_items")
      .update({ status: "processed" })
      .eq("id", item.id)
      .eq("user_id", context.userId);
    return {
      id: written.task.id,
      title: written.task.title,
      via,
      fallbackReason: reason ?? null,
      filled: resolved.filled,
      dropped: resolved.dropped,
      dependencies: written.dependencies,
      comments: written.comments,
    };
  });
