import { useQuery } from "@tanstack/react-query";

import {
  backlinksQuery,
  noteBlocksQuery,
  noteQuery,
  noteSearchQuery,
  notesQuery,
} from "@/features/notes/api";
import type { NoteSummary } from "@/features/notes/types";
import { useCrud } from "@/features/shared/crud";
import { qk } from "@/features/shared/query-keys";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export function useNotes() {
  return useQuery(notesQuery);
}
export function useNote(id: string) {
  return useQuery(noteQuery(id));
}
export function useNoteBlocks() {
  return useQuery(noteBlocksQuery);
}
export function useBacklinks(noteId: string, title: string, blockIds: readonly string[]) {
  return useQuery(backlinksQuery(noteId, title, blockIds));
}
export function useNoteSearch(term: string) {
  return useQuery(noteSearchQuery(term));
}

export const useNoteActions = () =>
  useCrud<NoteSummary, TablesInsert<"notes">, TablesUpdate<"notes">>("notes", qk.notes);
