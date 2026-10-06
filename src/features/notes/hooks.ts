import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAutomations } from "@/features/automations/hooks";

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
import { addedTags, noteEventRelevant, type NoteSnapshot } from "@/lib/automation-types";
import { runAutomations } from "@/lib/automations.functions";

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

/** Plain edits (autosave) re-check `note_updated` rules at most this often per note. */
const UPDATE_EVENT_THROTTLE_MS = 60_000;
const lastUpdateEvent = new Map<string, number>();

/**
 * Note CRUD plus note automations: after a create/update the caller's `note_created`,
 * `note_updated` and `note_tagged` rules run server-side (`runAutomations`), like
 * `useTaskActions` does for tasks. Actions there write directly and never re-trigger rules.
 */
export function useNoteActions() {
  const qc = useQueryClient();
  const crud = useCrud<NoteSummary, TablesInsert<"notes">, TablesUpdate<"notes">>(
    "notes",
    qk.notes,
  );
  const { data: rules = [] } = useAutomations();
  const run = useServerFn(runAutomations);

  function automate(
    event: "created" | "updated",
    noteId: string,
    tags: readonly string[],
    before?: NoteSnapshot,
  ) {
    const added = addedTags(event === "created" ? [] : before?.tags, tags).length;
    if (!noteEventRelevant(rules, event, added)) return;
    if (event === "updated" && !added) {
      const last = lastUpdateEvent.get(noteId) ?? 0;
      if (Date.now() - last < UPDATE_EVENT_THROTTLE_MS) return;
      lastUpdateEvent.set(noteId, Date.now());
    }
    run({ data: { entity: "note", event, noteId, ...(before ? { before } : {}) } })
      .then((r) => {
        if (!r.ran) return;
        if (r.changed) {
          void qc.invalidateQueries({ queryKey: qk.notes });
          void qc.invalidateQueries({ queryKey: qk.tasks });
        }
        void qc.invalidateQueries({ queryKey: qk.automations });
      })
      .catch((e) => console.error("note automation failed", e));
  }

  async function create(input: Omit<TablesInsert<"notes">, "user_id">) {
    const row = await crud.create(input);
    if (row) automate("created", row.id, row.tags ?? []);
    return row;
  }

  async function update(id: string, patch: TablesUpdate<"notes">) {
    // The list cache, or the open note's detail cache when the list was never loaded.
    const before =
      qc.getQueryData<NoteSummary[]>(qk.notes)?.find((n) => n.id === id) ??
      qc.getQueryData<NoteSummary>(qk.note(id));
    await crud.update(id, patch);
    const snap: NoteSnapshot | undefined = before && {
      title: before.title,
      tags: before.tags,
      project_id: before.project_id,
    };
    automate("updated", id, patch.tags ?? before?.tags ?? [], snap);
  }

  return { ...crud, create, update };
}
