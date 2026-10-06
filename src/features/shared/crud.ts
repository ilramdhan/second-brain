import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

import { AUTOMATION_COLS } from "@/features/automations/api";
import { MILESTONE_COLS } from "@/features/milestones/api";
import { NOTE_LIST_COLS } from "@/features/notes/api";
import type { NoteBlocks, NoteSummary } from "@/features/notes/types";
import { PROJECT_COLS } from "@/features/projects/api";
import { qk } from "@/features/shared/query-keys";
import { getUid } from "@/features/shared/session";
import { TASK_COLS } from "@/features/tasks/api";
import { supabase } from "@/integrations/supabase/client";
import { withNoteIndex } from "@/lib/blocks";
import {
  afterPinned,
  insertRow,
  omitKeys,
  patchCached,
  pickKeys,
  removeRows,
} from "@/lib/query-cache";

type TableName = "tasks" | "projects" | "notes" | "milestones" | "automations";

const COLS: Record<TableName, string> = {
  tasks: TASK_COLS,
  projects: PROJECT_COLS,
  notes: NOTE_LIST_COLS,
  milestones: MILESTONE_COLS,
  automations: AUTOMATION_COLS,
};
const NOTE_BLOCK_FIELDS = [
  "id",
  "title",
  "tags",
  "project_id",
  "blocks",
  "content",
  "links",
  "refs",
] as const;
/** Fields the notes list cache (qk.notes) never holds. */
const NOTE_HEAVY_FIELDS = ["blocks", "content", "links", "refs"] as const;

export type Snapshot = [QueryKey, unknown][];
/** Every cached query under `key` (list, detail, blocks...), for rollback. */
export const snapshot = (qc: QueryClient, key: readonly string[]): Snapshot =>
  qc.getQueriesData({ queryKey: key });
export const restore = (qc: QueryClient, snap: Snapshot) =>
  snap.forEach(([k, data]) => qc.setQueryData(k, data));

/**
 * What a patch looks like in a given cached query: the notes list (qk.notes) never holds
 * `blocks`/`content`/`links`/`refs`, the blocks cache only holds its own fields, everything else
 * takes it whole.
 */
function patchFor(table: TableName, queryKey: QueryKey, patch: object): object {
  if (table !== "notes") return patch;
  if (queryKey.length === 1) return omitKeys(patch as Record<string, unknown>, NOTE_HEAVY_FIELDS);
  if (queryKey[1] === "blocks")
    return pickKeys(patch as Record<string, unknown>, NOTE_BLOCK_FIELDS as unknown as string[]);
  return patch;
}

/**
 * Create/update/remove/archive for one entity. The cache is updated directly (optimistic for
 * update/remove/archive, with the inserted row for create); on failure the snapshot is
 * restored and the entity refetched. Successful writes never refetch whole lists.
 */
export function useCrud<Row extends { id: string }, Ins, Upd>(
  table: TableName,
  key: readonly string[],
) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = () => supabase.from(table) as any;

  /** Applies `fn` to every cached query under the entity key. */
  function mapCached(fn: (data: unknown, queryKey: QueryKey) => unknown) {
    for (const [k, data] of qc.getQueriesData({ queryKey: key })) {
      const next = fn(data, k);
      if (next !== data) qc.setQueryData(k, next);
    }
  }
  function fail(snap: Snapshot, message: string) {
    restore(qc, snap);
    toast.error(message);
    void invalidate();
  }

  async function create(raw: Omit<Ins, "user_id">): Promise<Row | null> {
    const user_id = await getUid();
    // Notes store their link index and excerpt next to `blocks` (migration 0018).
    const input = table === "notes" ? withNoteIndex(raw as { blocks?: unknown }) : raw;
    const { data, error } = await from()
      .insert({ ...input, user_id })
      .select(COLS[table])
      .single();
    if (error) {
      toast.error(error.message);
      return null;
    }
    const row = data as Row;
    qc.setQueryData<Row[]>(key, (old) =>
      insertRow(
        old,
        row,
        table === "notes" ? afterPinned(old as unknown as { pinned: boolean }[]) : undefined,
      ),
    );
    if (table === "notes" && qc.getQueryData(qk.noteBlocks)) {
      const extra = input as Partial<NoteBlocks>;
      qc.setQueryData<NoteBlocks[]>(qk.noteBlocks, (old) =>
        insertRow(old, {
          ...pickKeys(row as unknown as NoteSummary, ["id", "title", "tags", "project_id"]),
          blocks: extra.blocks ?? [],
          content: extra.content ?? "",
          links: extra.links ?? [],
          refs: extra.refs ?? [],
        } as NoteBlocks),
      );
    }
    return row;
  }
  async function update(id: string, raw: Upd) {
    const patch: object =
      table === "notes" ? withNoteIndex(raw as { blocks?: unknown }) : (raw as object);
    const withTs =
      table === "milestones" || table === "automations"
        ? patch
        : { ...patch, updated_at: new Date().toISOString() };
    const snap = snapshot(qc, key);
    mapCached((data, k) => patchCached(data, id, patchFor(table, k, withTs as object)));
    const { error } = await from().update(withTs).eq("id", id);
    if (error) fail(snap, error.message);
    else if (table === "notes" && ("content" in patch || "title" in patch)) {
      // Other notes' backlinks and server-side search results may have changed; refetch them
      // on next use instead of now.
      for (const sub of ["backlinks", "search"])
        void qc.invalidateQueries({ queryKey: [...key, sub], refetchType: "none" });
    }
  }
  async function hide(id: string, patch: Record<string, string>, done: string) {
    const snap = snapshot(qc, key);
    // Trashing a task trashes its subtasks too (archiving does not).
    const cascade = table === "tasks" && "deleted_at" in patch;
    mapCached((data) =>
      Array.isArray(data)
        ? removeRows(
            data as { id: string; parent_id?: string | null }[],
            (r) => r.id === id || (cascade && r.parent_id === id),
          )
        : data,
    );
    const { error } = await from().update(patch).eq("id", id);
    if (!error && cascade) await from().update(patch).eq("parent_id", id).is("deleted_at", null);
    if (error) fail(snap, error.message);
    else {
      toast.message(done);
      // The open detail page navigates away itself; mark its cache stale for the next visit
      // without refetching it now.
      void qc.invalidateQueries({ queryKey: [...key, "detail", id], refetchType: "none" });
    }
    void qc.invalidateQueries({ queryKey: ["bin"] });
  }
  async function remove(id: string) {
    const soft = table === "tasks" || table === "notes" || table === "projects";
    if (soft)
      return hide(
        id,
        { deleted_at: new Date().toISOString() },
        "Dipindah ke Tempat Sampah — bisa dikembalikan dalam 30 hari",
      );
    const snap = snapshot(qc, key);
    mapCached((data) =>
      Array.isArray(data) ? removeRows(data as Row[], (r) => r.id === id) : data,
    );
    const { error } = await from().delete().eq("id", id);
    if (error) fail(snap, error.message);
  }
  async function archive(id: string) {
    return hide(id, { archived_at: new Date().toISOString() }, "Diarsipkan");
  }
  return { create, update, remove, archive, invalidate };
}
