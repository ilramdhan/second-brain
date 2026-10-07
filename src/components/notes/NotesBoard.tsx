import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { KanbanSquare, LayoutGrid, Pin, Plus, Search, Sparkles } from "lucide-react";

import { Kanban } from "@/components/Kanban";
import { NoteFromTextDialog } from "@/components/notes/NoteFromTextDialog";
import { LoadMore, usePaged } from "@/components/common/LoadMore";
import { VirtualList } from "@/components/common/VirtualList";
import { chunk, shouldVirtualize } from "@/components/common/virtual";
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
import { useDebounced } from "@/hooks/use-debounced";
import { NAV_ITEM_CLASS, navAttrs, useKeyboardNav, type NavState } from "@/hooks/use-keyboard-nav";
import { usePreferences } from "@/lib/preferences";
import {
  useNoteActions,
  useNoteSearch,
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
  const { t } = usePreferences();
  const open = (n: Note) => navigate({ to: "/notes/$noteId", params: { noteId: n.id } });
  async function newNote(status = "idea") {
    const row = await create({
      title: t("noteUntitled"),
      content: "",
      status,
      project_id: projectId ?? null,
    });
    if (row) open(row);
  }
  const [view, setView] = useState("grid");
  const [fromText, setFromText] = useState(false);
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
  // The list holds only excerpts, so body search runs in Postgres (`ilike` on title + content).
  // Until the server answers, titles and excerpts are matched locally.
  const term = useDebounced(q.trim(), 250);
  const { data: hits } = useNoteSearch(term);
  const needle = q.trim().toLowerCase();
  const filtered = scoped.filter(
    (n) =>
      (tag === "all" || n.tags.includes(tag)) &&
      (!needle ||
        `${n.title} ${n.excerpt}`.toLowerCase().includes(needle) ||
        (term === q.trim() && !!hits?.has(n.id))),
  );

  const paged = usePaged(filtered, 24, `${q}-${tag}`);

  // j/k walk the grid in reading order (h/l between kanban columns), Enter/o/e open.
  const navColumns = useMemo(
    () =>
      view === "board"
        ? NOTE_STATUS.map((c) => filtered.filter((n) => n.status === c.id).map((n) => n.id))
        : [paged.visible.map((n) => n.id)],
    [view, filtered, paged.visible],
  );
  const { containerProps, nav } = useKeyboardNav({
    columns: navColumns,
    kind: "note",
    onOpen: (id) => navigate({ to: "/notes/$noteId", params: { noteId: id } }),
  });

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
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setFromText(true)}>
            <Sparkles /> {t("noteFromTextShort")}
          </Button>
          <Button size="sm" onClick={() => newNote()}>
            <Plus /> {t("noteNewButton")}
          </Button>
        </div>
        <NoteFromTextDialog open={fromText} onOpenChange={setFromText} projectId={projectId} />
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("noteSearchPlaceholder")}
            className="h-9 pl-8"
          />
        </div>
        {tags.length > 0 && (
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger className="h-9 w-auto min-w-[8.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("noteAllTags")}</SelectItem>
              {tags.map((tg) => (
                <SelectItem key={tg} value={tg}>
                  #{tg}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {view === "grid" ? (
        <>
          {shouldVirtualize(paged.visible.length) ? (
            <div {...containerProps} role="group" aria-label={t("kbNoteListLabel")}>
              <VirtualNoteGrid notes={paged.visible} projects={projects} onOpen={open} nav={nav} />
            </div>
          ) : (
            <div
              {...containerProps}
              role="group"
              aria-label={t("kbNoteListLabel")}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {paged.visible.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  projects={projects}
                  onClick={() => open(n)}
                  nav={nav}
                />
              ))}
              {filtered.length === 0 && (
                <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
                  {t("noteEmpty")}
                </p>
              )}
            </div>
          )}
          <LoadMore shown={paged.visible.length} total={paged.total} onMore={paged.more} />
        </>
      ) : (
        <div {...containerProps}>
          <Kanban
            nav={nav}
            columns={NOTE_STATUS}
            items={filtered}
            getColumn={(n) => n.status}
            onMove={(n, status) => update(n.id, { status })}
            onAdd={(status) => newNote(status)}
            onOpen={open}
            itemLabel={(n) => n.title || t("noteUntitled")}
            renderCard={(n) => (
              <NoteCard note={n} projects={projects} onClick={() => open(n)} compact />
            )}
          />
        </div>
      )}
    </div>
  );
}

/** Column count of the `sm:grid-cols-2 lg:grid-cols-3` note grid at the current width. */
function useGridColumns() {
  const query = () =>
    typeof window === "undefined"
      ? 1
      : window.matchMedia("(min-width: 1024px)").matches
        ? 3
        : window.matchMedia("(min-width: 640px)").matches
          ? 2
          : 1;
  const [cols, setCols] = useState(query);
  useEffect(() => {
    const update = () => setCols(query());
    const mqs = ["(min-width: 640px)", "(min-width: 1024px)"].map((q) => window.matchMedia(q));
    mqs.forEach((mq) => mq.addEventListener("change", update));
    update();
    return () => mqs.forEach((mq) => mq.removeEventListener("change", update));
  }, []);
  return cols;
}

/** The note grid windowed row by row; used only above `VIRTUALIZE_THRESHOLD` notes. */
function VirtualNoteGrid({
  notes,
  projects,
  onOpen,
  nav,
}: {
  notes: Note[];
  projects: Project[];
  onOpen: (n: Note) => void;
  nav: NavState;
}) {
  const cols = useGridColumns();
  const rows = useMemo(() => chunk(notes, cols), [notes, cols]);
  return (
    <VirtualList
      as="div"
      items={rows}
      getKey={(row) => row[0]?.id ?? ""}
      estimateSize={170}
      gap={12}
      threshold={0}
      renderItem={(row) => (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {row.map((n) => (
            <NoteCard key={n.id} note={n} projects={projects} onClick={() => onOpen(n)} nav={nav} />
          ))}
        </div>
      )}
    />
  );
}

function NoteCard({
  note,
  projects,
  onClick,
  compact,
  nav,
}: {
  note: Note;
  projects: Project[];
  onClick: () => void;
  compact?: boolean | undefined;
  /** Grid cards are navigable themselves; kanban cards via their draggable wrapper. */
  nav?: NavState | undefined;
}) {
  const { dateFns } = usePreferences();
  const p = projects.find((x) => x.id === note.project_id);
  return (
    <button
      onClick={onClick}
      {...(nav ? navAttrs(note.id, nav.selectedId === note.id, nav.tabStopId === note.id) : {})}
      className={cn(
        "flex w-full flex-col rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/30",
        nav && NAV_ITEM_CLASS,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-semibold">{note.title}</h3>
        {note.pinned && <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-primary" />}
      </div>
      {note.excerpt && (
        <p
          className={cn(
            "mt-1 whitespace-pre-line text-xs text-muted-foreground",
            compact ? "line-clamp-3" : "line-clamp-5",
          )}
        >
          {note.excerpt}
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
          {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true, locale: dateFns })}
        </span>
      </div>
    </button>
  );
}
