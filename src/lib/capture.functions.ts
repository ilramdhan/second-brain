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

type RlsClient = Parameters<typeof import("@/server/rateLimit.server").enforceRateLimit>[0];

/** Gate for server functions: AI availability, then the caller's own AI budget (throws). */
function userAiGate(supabase: RlsClient) {
  return {
    assertAi: async () => {
      const { assertAiAvailable } = await import("./ai.server");
      await assertAiAvailable();
    },
    consume: async () => {
      const { enforceRateLimit, AI_RATE_LIMIT } = await import("@/server/rateLimit.server");
      await enforceRateLimit(supabase, AI_RATE_LIMIT);
      return true;
    },
  };
}

async function enforceDemoCaptureLimit(text: string) {
  const { isDemoMode } = await import("@/server/demo/mode.server");
  if (isDemoMode() && text.length > DEMO_MAX_CAPTURE_CHARS)
    throw new Error(`Batas demo: teks maks ${DEMO_MAX_CAPTURE_CHARS} karakter.`);
}

const captureText = z
  .string()
  .trim()
  .min(1, "Teks kosong")
  .max(MAX_CAPTURE_CHARS, "Teks terlalu panjang");

/** Extracts and validates one note from `text` for the caller (shared by the two functions). */
async function extractNoteForUser(supabase: RlsClient, userId: string, text: string) {
  const request = getRequest();
  const { loadNoteCandidates, extractNoteFields } = await import("@/server/noteCapture.server");
  const { resolveNoteExtraction } = await import("@/server/noteExtract.server");
  const { appTimezone } = await import("@/server/n8n/time.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const clock = { now: new Date(), tz: appTimezone() };
  // Candidate names come from the service role, scoped to the caller's own access.
  const candidates = await loadNoteCandidates(userId, supabaseAdmin);
  const { extraction, via, reason } = await extractNoteFields(text, candidates, clock, {
    ...userAiGate(supabase),
    ai: async (t, c, clk) => {
      const { aiExtractNote } = await import("./ai.server");
      return aiExtractNote(request, t, c, clk);
    },
  });
  return { resolved: resolveNoteExtraction(extraction, candidates, text), via, reason, request };
}

/**
 * Inbox → one fully filled note ("Jadikan catatan (AI)"): title, structured blocks, status,
 * project, tags, links to existing notes, pin and properties, validated against the caller's own
 * data and written with the caller's RLS client (blocks + content + index columns via
 * withNoteIndex), followed by the note automation rules. The inbox item is marked processed.
 */
export const captureInboxNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ itemId: z.guid(), text: captureText }))
  .handler(async ({ data, context }) => {
    await enforceDemoCaptureLimit(data.text);
    const { data: item } = await context.supabase
      .from("inbox_items")
      .select("id,status")
      .eq("id", data.itemId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!item || item.status !== "pending") throw new Error("Item Inbox sudah diproses");
    const { resolved, via, reason, request } = await extractNoteForUser(
      context.supabase,
      context.userId,
      data.text,
    );
    const { writeExtractedNote } = await import("@/server/noteCapture.server");
    let origin: string | null;
    try {
      origin = new URL(request.url).origin;
    } catch {
      origin = null;
    }
    const note = await writeExtractedNote(context.supabase, context.userId, resolved, origin);
    await context.supabase
      .from("inbox_items")
      .update({ status: "processed" })
      .eq("id", item.id)
      .eq("user_id", context.userId);
    return {
      id: note.id,
      title: note.title,
      via,
      fallbackReason: reason ?? null,
      filled: resolved.filled,
      dropped: resolved.dropped,
    };
  });

/**
 * "Catatan dari teks": extracts a note draft for the new-note form WITHOUT saving it. The user
 * reviews title, content, status, project, tags and pin in the form and saves through
 * useNoteActions (which mirrors content/index columns and runs the note rules).
 */
export const draftNoteFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ text: captureText }))
  .handler(async ({ data, context }) => {
    await enforceDemoCaptureLimit(data.text);
    const { resolved, via, reason } = await extractNoteForUser(
      context.supabase,
      context.userId,
      data.text,
    );
    return {
      draft: resolved.insert,
      links: resolved.links.map((l) => l.title),
      via,
      fallbackReason: reason ?? null,
      filled: resolved.filled,
      dropped: resolved.dropped,
    };
  });
