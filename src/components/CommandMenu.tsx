import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckSquare, FolderKanban, Plus, StickyNote } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { useNotes, useProjects, useTasks } from "@/lib/data";

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const { openTask, newTask } = useTaskDialog();
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: notes = [] } = useNotes();
  const [, force] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
        force((x) => x + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Cari tugas, proyek, catatan…" />
      <CommandList>
        <CommandEmpty>Tidak ditemukan.</CommandEmpty>
        <CommandGroup heading="Aksi">
          <CommandItem onSelect={() => run(() => newTask())}>
            <Plus /> Tugas baru
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Tugas">
          {tasks.slice(0, 200).map((t) => (
            <CommandItem
              key={t.id}
              value={`task ${t.title} ${t.id}`}
              onSelect={() => run(() => openTask(t.id))}
            >
              <CheckSquare /> {t.title}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Proyek">
          {projects.map((p) => (
            <CommandItem
              key={p.id}
              value={`project ${p.name} ${p.id}`}
              onSelect={() =>
                run(() => navigate({ to: "/projects/$projectId", params: { projectId: p.id } }))
              }
            >
              <FolderKanban /> {p.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Catatan">
          {notes.slice(0, 200).map((n) => (
            <CommandItem
              key={n.id}
              value={`note ${n.title} ${n.id}`}
              onSelect={() =>
                run(() => navigate({ to: "/notes/$noteId", params: { noteId: n.id } }))
              }
            >
              <StickyNote /> {n.title}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
