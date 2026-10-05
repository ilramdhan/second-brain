import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckSquare, FolderKanban, Loader2, Plus, StickyNote } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { useDebounced } from "@/hooks/use-debounced";
import { useSearch } from "@/lib/data";

/**
 * Cmd+K palette. Mounted (and lazy-loaded) by the layout only while open; the search runs in
 * Postgres on `id,title` with a debounce instead of subscribing to the full task/note lists.
 */
export default function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const { openTask, newTask } = useTaskDialog();
  const [term, setTerm] = useState("");
  const debounced = useDebounced(term, 200);
  const { data, isFetching } = useSearch(debounced, open);
  const tasks = data?.tasks ?? [];
  const projects = data?.projects ?? [];
  const notes = data?.notes ?? [];

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} commandProps={{ shouldFilter: false }}>
      <CommandInput
        placeholder="Cari tugas, proyek, catatan…"
        value={term}
        onValueChange={setTerm}
      />
      <CommandList>
        <CommandEmpty>
          {isFetching || term !== debounced ? (
            <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            "Tidak ditemukan."
          )}
        </CommandEmpty>
        <CommandGroup heading="Aksi">
          <CommandItem value="action-new-task" onSelect={() => run(() => newTask())}>
            <Plus /> Tugas baru
          </CommandItem>
        </CommandGroup>
        {tasks.length > 0 && (
          <CommandGroup heading="Tugas">
            {tasks.map((t) => (
              <CommandItem
                key={t.id}
                value={`task ${t.id}`}
                onSelect={() => run(() => openTask(t.id))}
              >
                <CheckSquare /> {t.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {projects.length > 0 && (
          <CommandGroup heading="Proyek">
            {projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.id}`}
                onSelect={() =>
                  run(() => navigate({ to: "/projects/$projectId", params: { projectId: p.id } }))
                }
              >
                <FolderKanban /> {p.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {notes.length > 0 && (
          <CommandGroup heading="Catatan">
            {notes.map((n) => (
              <CommandItem
                key={n.id}
                value={`note ${n.id}`}
                onSelect={() =>
                  run(() => navigate({ to: "/notes/$noteId", params: { noteId: n.id } }))
                }
              >
                <StickyNote /> {n.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
