import { createContext, useCallback, useContext, useMemo, useRef, useLayoutEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { useNoteActions, useNotes } from "@/lib/data";

/** Normalised key used to match `[[Title]]` against note titles (trimmed, case-insensitive). */
export const noteTitleKey = (title: string) => title.trim().toLowerCase();

export type NoteLinks = {
  /** Normalised note title → note id. */
  titles: ReadonlyMap<string, string>;
  /** Navigate to the note with this title, creating it first when it doesn't exist. */
  openTitle: (title: string) => void;
};

const EMPTY: NoteLinks = { titles: new Map(), openTitle: () => {} };

export const NoteLinksContext = createContext<NoteLinks>(EMPTY);

export const useNoteLinks = () => useContext(NoteLinksContext);

/** Builds the title map once from the shared `useNotes` cache. */
export function useNoteLinksValue(): NoteLinks {
  const { data: notes = [] } = useNotes();
  const { create } = useNoteActions();
  const navigate = useNavigate();

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes) {
      const key = noteTitleKey(n.title);
      // First match wins, like the previous `notes.find` (list is pinned/recent first).
      if (!map.has(key)) map.set(key, n.id);
    }
    return map;
  }, [notes]);

  // Keep `openTitle` referentially stable so memoised fragments don't re-render
  // whenever the notes list or the mutation helpers change identity.
  const latest = useRef({ titles, create, navigate });
  // Synced after commit (not during render) so stable callbacks read the latest values.
  useLayoutEffect(() => {
    latest.current = { titles, create, navigate };
  });
  const openTitle = useCallback(async (title: string) => {
    const { titles, create, navigate } = latest.current;
    const t = title.trim();
    const hit = titles.get(t.toLowerCase());
    if (hit) return navigate({ to: "/notes/$noteId", params: { noteId: hit } });
    const row = await create({ title: t.slice(0, 200), content: "", blocks: [] });
    if (row) {
      toast.success(`Catatan "${t}" dibuat`);
      navigate({ to: "/notes/$noteId", params: { noteId: row.id } });
    }
  }, []);

  return useMemo(() => ({ titles, openTitle }), [titles, openTitle]);
}
