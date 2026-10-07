// Turns one free-text message into a fully filled note, server-side. Shared by the Telegram bot
// (app mode webhook and n8n mode), n8n capture, the inbox "Jadikan catatan (AI)" button and the
// in-app "Catatan dari teks" prefill (which only extracts; the user saves from the form).
//
//   1. loadNoteCandidates: accessible projects, visible note titles and tags in use (service
//      role, every query scoped to the user like src/server/n8n/service.server.ts).
//   2. extractNoteFields: aiExtractNote when AI is available and the per-user AI budget allows
//      it; otherwise, or on any AI error, the local fallback (same gate as tasks).
//   3. resolveNoteExtraction (noteExtract.server.ts): validates values and references.
//   4. writeExtractedNote: inserts blocks + the mirrored `content` and derived index columns
//      (withNoteIndex, migration 0018), then runs the note automation rules ("created").
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { withNoteIndex } from "@/lib/blocks";

import { accessibleProjectIds, scopeFilter } from "./n8n/service.server";
import { runNoteAutomationRules } from "./noteAutomationEngine.server";
import {
  NOTE_CANDIDATE_LIMITS,
  fallbackNoteExtraction,
  resolveNoteExtraction,
  type ExtractedNote,
  type NoteCandidates,
  type NoteClock,
  type ResolvedNote,
} from "./noteExtract.server";
import { extractWithFallback, serviceExtractDeps, type ExtractDeps } from "./taskCapture.server";
import { MAX_EXTRACT_INPUT } from "./taskExtract.server";

type Db = SupabaseClient<Database>;

/** Loads what a note may reference, scoped to `userId` (never other users' rows). */
export async function loadNoteCandidates(
  userId: string,
  db: Db = supabaseAdmin,
): Promise<NoteCandidates> {
  const projectIds = await accessibleProjectIds(userId);
  const [{ data: projects }, { data: notes }] = await Promise.all([
    projectIds.length
      ? db
          .from("projects")
          .select("id,name")
          .in("id", projectIds)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(NOTE_CANDIDATE_LIMITS.projects)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    db
      .from("notes")
      .select("id,title,tags")
      .or(scopeFilter(userId, projectIds))
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);
  const freq = new Map<string, number>();
  for (const n of notes ?? []) for (const t of n.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
  return {
    projects: projects ?? [],
    notes: (notes ?? [])
      .filter((n) => n.title.trim())
      .slice(0, NOTE_CANDIDATE_LIMITS.notes)
      .map((n) => ({ id: n.id, title: n.title })),
    tags: [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, NOTE_CANDIDATE_LIMITS.tags)
      .map(([t]) => t),
  };
}

export type NoteExtractDeps = Pick<ExtractDeps, "assertAi" | "consume"> & {
  ai: (text: string, candidates: NoteCandidates, clock: NoteClock) => Promise<ExtractedNote>;
};

/** AI extraction with the local fallback. Never throws for AI reasons. */
export function extractNoteFields(
  text: string,
  candidates: NoteCandidates,
  clock: NoteClock,
  deps: NoteExtractDeps,
) {
  const input = text.slice(0, MAX_EXTRACT_INPUT);
  return extractWithFallback(
    "note",
    deps,
    () => deps.ai(input, candidates, clock),
    () => fallbackNoteExtraction(input),
  );
}

/** Default deps for bot/n8n callers: service-role limiter for `userId`. */
export function serviceNoteExtractDeps(userId: string, request: Request): NoteExtractDeps {
  const { assertAi, consume } = serviceExtractDeps(userId, request);
  return {
    assertAi,
    consume,
    ai: async (text, candidates, clock) => {
      const { aiExtractNote } = await import("@/lib/ai.server");
      return aiExtractNote(request, text, candidates, clock);
    },
  };
}

/** The insert row for a resolved note: blocks + content + links/refs/excerpt (withNoteIndex). */
export function noteInsertRow(userId: string, resolved: ResolvedNote) {
  const n = resolved.insert;
  return withNoteIndex({
    user_id: userId,
    title: n.title,
    blocks: n.blocks as unknown as Json,
    status: n.status,
    project_id: n.project_id,
    tags: n.tags,
    pinned: n.pinned,
    properties: n.properties as Json,
  });
}

/**
 * Inserts the resolved note as `userId` through `db` (the caller's RLS client in server functions,
 * the service role for bot/n8n), then runs the note automation rules for "created".
 */
export async function writeExtractedNote(
  db: Db,
  userId: string,
  resolved: ResolvedNote,
  origin: string | null,
) {
  const { data: note, error } = await db
    .from("notes")
    .insert(noteInsertRow(userId, resolved))
    .select("id,title,tags")
    .single();
  if (error || !note) throw new Error(`note insert failed: ${error?.message}`);
  await runNoteAutomationRules(db, userId, { event: "created", noteId: note.id }, origin).catch(
    (e) => console.error("[capture] note automations failed", e),
  );
  return note;
}

/** Full pipeline for bot/n8n callers (service role, scoped to `userId`). */
export async function captureNoteFromText(
  userId: string,
  text: string,
  opts: {
    clock: NoteClock;
    origin: string | null;
    request?: Request;
    deps?: NoteExtractDeps;
    /** Explicit values from the caller (n8n capture fields) applied after validation. */
    adjust?: (resolved: ResolvedNote, candidates: NoteCandidates) => void;
  },
) {
  const candidates = await loadNoteCandidates(userId);
  const request = opts.request ?? new Request("https://capture.internal/note");
  const { extraction, via } = await extractNoteFields(
    text,
    candidates,
    opts.clock,
    opts.deps ?? serviceNoteExtractDeps(userId, request),
  );
  const resolved = resolveNoteExtraction(extraction, candidates, text);
  opts.adjust?.(resolved, candidates);
  const note = await writeExtractedNote(supabaseAdmin, userId, resolved, opts.origin);
  return { note, resolved, via };
}
