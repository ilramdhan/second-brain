import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Semantic search server functions (plan item 9.1). Everything runs as the caller (RLS client),
// so a user only ever indexes and finds rows they can read (own + shared projects). See
// src/server/semantic.server.ts for the queue design and migration 0020 for the SQL side.

const MAX_QUERY_CHARS = 500;

/** Whether semantic search can run here; the UI falls back to keyword search when it cannot. */
export const getSemanticStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { isDemoMode } = await import("@/server/demo/mode.server");
    const { embeddingModelId } = await import("./ai.server");
    try {
      return { available: true, demo: isDemoMode(), model: await embeddingModelId() };
    } catch {
      return { available: false, demo: false, model: null };
    }
  });

/**
 * Embeds rows whose embedding is missing or outdated. Called (debounced) after task/note edits,
 * before a search, and in a loop by Settings → "Indeks ulang" (`batches` > 1). Uses its own
 * budget (`SEMANTIC_INDEX_RATE_LIMIT`) so background indexing never eats the AI budget of the
 * interactive features.
 */
export const syncSemanticIndexFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ batches: z.number().int().min(1).max(5).default(1) }))
  .handler(async ({ data, context }) => {
    const { assertAiAvailable } = await import("./ai.server");
    await assertAiAvailable();
    const { enforceRateLimit, SEMANTIC_INDEX_RATE_LIMIT } =
      await import("@/server/rateLimit.server");
    await enforceRateLimit(context.supabase, SEMANTIC_INDEX_RATE_LIMIT);
    const { syncSemanticIndex } = await import("@/server/semantic.server");
    return syncSemanticIndex(context.supabase, {
      batches: data.batches,
      signal: getRequest().signal,
    });
  });

/** Nearest tasks and notes for a free-text query. One unit of the shared AI budget per call. */
export const semanticSearchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      query: z
        .string()
        .trim()
        .min(2, "Kata kunci terlalu pendek")
        .max(MAX_QUERY_CHARS, `Kata kunci terlalu panjang (maks ${MAX_QUERY_CHARS} karakter)`),
      limit: z.number().int().min(1).max(30).default(20),
    }),
  )
  .handler(async ({ data, context }) => {
    const { assertAiAvailable } = await import("./ai.server");
    await assertAiAvailable();
    const { enforceRateLimit, AI_RATE_LIMIT } = await import("@/server/rateLimit.server");
    await enforceRateLimit(context.supabase, AI_RATE_LIMIT);
    const { isDemoMode } = await import("@/server/demo/mode.server");
    const { semanticSearch } = await import("@/server/semantic.server");
    return semanticSearch(context.supabase, data.query, {
      limit: data.limit,
      signal: getRequest().signal,
      demo: isDemoMode(),
    });
  });
