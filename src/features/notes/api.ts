import { queryOptions } from "@tanstack/react-query";

import type { Backlink, NoteBlocks, NoteDetail, NoteSummary } from "@/features/notes/types";
import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { ilikePattern } from "@/lib/query-cache";

// Notes list: no `blocks` (the jsonb source of truth) and no `content` (its markdown mirror);
// cards show the stored 200-character `excerpt` (migration 0018) and full-text search runs in
// Postgres (`useNoteSearch`).
export const NOTE_LIST_COLS =
  "id,title,excerpt,tags,status,pinned,project_id,position,properties,created_at,updated_at";
export const NOTE_DETAIL_COLS = `${NOTE_LIST_COLS},content,blocks`;
/** Only what the block index (transclusion/refs) and the graph need. */
export const NOTE_BLOCK_COLS = "id,title,tags,project_id,blocks,content,links,refs";

export const notesQuery = queryOptions({
  queryKey: qk.notes,
  queryFn: async (): Promise<NoteSummary[]> => {
    const { data, error } = await supabase
      .from("notes")
      .select(NOTE_LIST_COLS)
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});

/** One note with its blocks, for the editor. `null` when missing, trashed or archived. */
export const noteQuery = (id: string) =>
  queryOptions({
    queryKey: qk.note(id),
    queryFn: async (): Promise<NoteDetail | null> => {
      const { data, error } = await supabase
        .from("notes")
        .select(NOTE_DETAIL_COLS)
        .eq("id", id)
        .is("deleted_at", null)
        .is("archived_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

/**
 * Blocks of every visible note, for backlinks, block refs/embeds and the graph. Only the note
 * editor and graph routes subscribe to it, so other pages never download note bodies.
 */
export const noteBlocksQuery = queryOptions({
  queryKey: qk.noteBlocks,
  queryFn: async (): Promise<NoteBlocks[]> => {
    const { data, error } = await supabase
      .from("notes")
      .select(NOTE_BLOCK_COLS)
      .is("deleted_at", null)
      .is("archived_at", null);
    if (error) throw error;
    return data;
  },
});

/**
 * Notes linking to this one by `[[title]]` or referencing one of `blockIds`, plus unlinked
 * mentions of the title. Answered by Postgres (`note_backlinks`, GIN indexes on `links`/`refs`,
 * migration 0018) under the caller's RLS, instead of parsing every note on each keystroke.
 * `title` is normalised like the stored links (trim + lower-case); callers should pass debounced
 * values so typing does not issue one request per key.
 */
export const backlinksQuery = (noteId: string, title: string, blockIds: readonly string[]) => {
  const t = title.trim().toLowerCase();
  const ids = [...blockIds].sort();
  return queryOptions({
    queryKey: ["notes", "backlinks", noteId, t, ids.join(",")],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("note_backlinks", {
        _note_id: noteId,
        _title: t,
        _block_ids: ids,
      });
      if (error) throw error;
      const linked: Backlink[] = [];
      const unlinked: Backlink[] = [];
      for (const r of data ?? [])
        (r.linked ? linked : unlinked).push({
          id: r.id,
          title: r.title,
          blocks: r.blocks,
          content: r.content,
        });
      return { linked, unlinked };
    },
  });
};

/**
 * Ids of visible notes whose title or markdown `content` matches `term` (`ilike` in Postgres).
 * Used by the notes list, which no longer downloads `content`. `null` while the term is empty.
 */
export const noteSearchQuery = (term: string) => {
  const t = term.trim();
  return queryOptions({
    queryKey: ["notes", "search", t],
    enabled: !!t,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<Set<string>> => {
      // Double-quoted so commas/parentheses in the term cannot break the PostgREST `or` list.
      const pattern = `"${ilikePattern(t).replace(/[\\"]/g, (c) => `\\${c}`)}"`;
      const { data, error } = await supabase
        .from("notes")
        .select("id")
        .is("deleted_at", null)
        .is("archived_at", null)
        .or(`title.ilike.${pattern},content.ilike.${pattern}`)
        .limit(1000);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.id));
    },
  });
};
