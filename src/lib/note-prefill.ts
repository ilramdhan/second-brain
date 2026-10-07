// "Catatan dari teks" form mapping (client-safe, pure). The server function draftNoteFromText
// returns a validated draft; the form shows it as editable fields (content as markdown, so the
// user can review headings, lists and checklists in one textarea) and nothing is saved until the
// user presses save, which goes through useNoteActions.create like every other new note.
import type { Json } from "@/integrations/supabase/types";
import { loadBlocks, toMarkdown, type Block } from "@/lib/blocks";

export type NoteDraft = {
  title: string;
  blocks: Block[];
  status: string;
  project_id: string | null;
  tags: string[];
  pinned: boolean;
  properties: Record<string, string | number>;
};

export type NoteForm = {
  title: string;
  /** Markdown (toMarkdown of the drafted blocks). */
  content: string;
  status: string;
  projectId: string | null;
  tags: string[];
  pinned: boolean;
  properties: [string, string][];
};

export const emptyNoteForm = (projectId: string | null = null): NoteForm => ({
  title: "",
  content: "",
  status: "idea",
  projectId,
  tags: [],
  pinned: false,
  properties: [],
});

/**
 * Draft → form. `keepProject` (the project page the dialog was opened from) wins when the draft
 * names none.
 */
export function draftToForm(draft: NoteDraft, keepProject: string | null = null): NoteForm {
  const blocks = draft.blocks.filter((b) => b.text || b.type === "divider");
  return {
    title: draft.title,
    content: blocks.length ? toMarkdown(blocks) : "",
    status: draft.status,
    projectId: draft.project_id ?? keepProject,
    tags: [...draft.tags],
    pinned: draft.pinned,
    properties: Object.entries(draft.properties).map(([k, v]) => [k, String(v)]),
  };
}

/** Form → note insert for useNoteActions.create (blocks are the source of truth). */
export function formToInsert(form: NoteForm) {
  const blocks = loadBlocks({ blocks: [], content: form.content });
  const properties = Object.fromEntries(
    form.properties
      .filter(([k, v]) => k.trim() && v.trim())
      .map(([k, v]) => [
        k.trim().toLowerCase().replace(/\s+/g, "_"),
        !Number.isNaN(Number(v.trim())) ? Number(v.trim()) : v.trim(),
      ]),
  );
  return {
    title: form.title.trim().slice(0, 300) || "Tanpa judul",
    blocks: blocks as unknown as Json,
    content: toMarkdown(blocks),
    status: form.status,
    project_id: form.projectId,
    tags: form.tags,
    pinned: form.pinned,
    properties: properties as Json,
  };
}
