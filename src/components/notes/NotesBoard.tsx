import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { KanbanSquare, LayoutGrid, Pin, Plus, Search } from "lucide-react";

import { Kanban } from "@/components/Kanban";
import { LoadMore, usePaged } from "@/components/common/LoadMore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { color, labelOf, NOTE_STATUS } from "@/lib/constants";
import {
  useNoteActions,
  useNotes,
  useProjects,
  type NoteSummary as Note,
  type Project,
} from "@/lib/data";
import { cn } from "@/lib/utils";

export function NotesBoard({ projectId }: { projectId?: string | undefined }) {
  const { data: notes = [] } = useNotes();
  const { data: projects = [] } = useProjects();
  const { update, create } = useNoteActions();
  const navigate = useNavigate();
  const open = (n: Note) => navigate({ to: "/notes/$noteId", params: { noteId: n.id } });
  async function newNote(status = "idea") {
    const row = await create({
      title: "Tanpa judul",
      content: "",
      status,
      project_id: projectId ?? null,
    });
    if (row) open(row);
  }
  const [view, setView] = useState("grid");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("all");

  // Pinned first, newest first (the server order), re-applied so optimistic edits re-sort.
  const scoped = useMemo(
    () =>
      notes
        .filter((n) => !projectId || n.project_id === projectId)
        .sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at),
        ),
    [notes, projectId],
  );
  const tags = useMemo(() => [...new Set(scoped.flatMap((n) => n.tags))].sort(), [scoped]);
  const filtered = scoped.filter(
    (n) =>
      (tag === "all" || n.tags.includes(tag)) &&
      (!q.trim() || `${n.title} ${n.content}`.toLowerCase().includes(q.toLowerCase())),
  );

  const paged = usePaged(filtered, 24, `${q}-${tag}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="grid" className="gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" />
              Grid
            </TabsTrigger>
            <TabsTrigger value="board" className="gap-1.5">
              <KanbanSquare className="h-3.5 w-3.5" />
              Kanban
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => newNote()}>
          <Plus /> Catatan
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari catatan…"
            className="h-9 pl-8"
          />
        </div>
        {tags.length > 0 && (
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger className="h-9 w-auto min-w-[8.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua tag</SelectItem>
              {tags.map((t) => (
                <SelectItem key={t} value={t}>
                  #{t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {view === "grid" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {paged.visible.map((n) => (
              <NoteCard key={n.id} note={n} projects={projects} onClick={() => open(n)} />
            ))}
            {filtered.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
                Belum ada catatan.
              </p>
            )}
          </div>
          <LoadMore shown={paged.visible.length} total={paged.total} onMore={paged.more} />
        </>
      ) : (
        <Kanban
          columns={NOTE_STATUS}
          items={filtered}
          getColumn={(n) => n.status}
          onMove={(n, status) => update(n.id, { status })}
          onAdd={(status) => newNote(status)}
          renderCard={(n) => (
            <NoteCard note={n} projects={projects} onClick={() => open(n)} compact />
          )}
        />
      )}
    </div>
  );
}

function NoteCard({
  note,
  projects,
  onClick,
  compact,
}: {
  note: Note;
  projects: Project[];
  onClick: () => void;
  compact?: boolean | undefined;
}) {
  const p = projects.find((x) => x.id === note.project_id);
  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/30"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-semibold">{note.title}</h3>
        {note.pinned && <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-primary" />}
      </div>
      {note.content && (
        <p
          className={cn(
            "mt-1 whitespace-pre-line text-xs text-muted-foreground",
            compact ? "line-clamp-3" : "line-clamp-5",
          )}
        >
          {note.content}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {!compact && (
          <span className="rounded-full bg-secondary px-2 py-0.5">
            {labelOf(NOTE_STATUS, note.status)}
          </span>
        )}
        {p && (
          <span className="flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-full", color(p.color).dot)} />
            {p.name}
          </span>
        )}
        {note.tags.map((t) => (
          <span key={t}>#{t}</span>
        ))}
        <span className="ml-auto">
          {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true, locale: localeId })}
        </span>
      </div>
    </button>
  );
}
