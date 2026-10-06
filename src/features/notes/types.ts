import type { Json, Tables } from "@/integrations/supabase/types";

/** Full note row (editor, inserts). */
export type Note = Tables<"notes">;
/** Row in the notes list cache (`qk.notes`): no `blocks`. */
export type NoteSummary = Pick<
  Note,
  | "id"
  | "title"
  | "excerpt"
  | "tags"
  | "status"
  | "pinned"
  | "project_id"
  | "position"
  | "properties"
  | "created_at"
  | "updated_at"
>;
export type NoteDetail = NoteSummary & Pick<Note, "blocks" | "content">;
export type NoteBlocks = Pick<
  Note,
  "id" | "title" | "tags" | "project_id" | "blocks" | "content" | "links" | "refs"
>;
/** A note returned by `useBacklinks`. `blocks`/`content` are only set for linked notes. */
export type Backlink = { id: string; title: string; blocks: Json | null; content: string | null };
