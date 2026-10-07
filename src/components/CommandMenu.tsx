import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  CheckSquare,
  FolderKanban,
  Inbox,
  Keyboard,
  Languages,
  Loader2,
  Moon,
  Pencil,
  Plus,
  Sparkles,
  StickyNote,
  Zap,
  type LucideIcon,
} from "lucide-react";

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
import { getActiveSelection } from "@/hooks/use-keyboard-nav";
import {
  useNoteActions,
  useSearch,
  useSemanticSearch,
  useSemanticStatus,
  useTaskActions,
  useTasks,
  type SemanticHit,
} from "@/lib/data";
import { usePreferences, type MessageKey } from "@/lib/preferences";
import { matchesCommand } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export type SearchMode = "keyword" | "semantic";
const MODE_STORAGE_KEY = "second-brain-search-mode";

function readMode(): SearchMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === "semantic" ? "semantic" : "keyword";
  } catch {
    return "keyword";
  }
}

/**
 * Cmd+K palette. Mounted (and lazy-loaded) by the layout only while open. Two modes:
 *  - keyword: Postgres `ilike` on `id,title` with a debounce (no full list subscriptions);
 *  - semantic: embedding search over tasks and notes (src/lib/semantic.functions.ts), offered
 *    only when the server has an AI provider (or is the demo). If it fails, the keyword results
 *    are shown instead, so the palette always finds something.
 * Above the results it lists commands (new task/note, capture, theme, language, every page, the
 * shortcut sheet), filtered locally by the typed words, plus actions for the task or note that
 * was selected with j/k on the page behind it.
 */
export default function CommandMenu({
  open,
  onOpenChange,
  pages,
  onQuickCapture,
  onQuickTask,
  onShortcuts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pages: readonly { to: string; key: MessageKey; icon: LucideIcon }[];
  onQuickCapture: () => void;
  onQuickTask: () => void;
  onShortcuts: () => void;
}) {
  const navigate = useNavigate();
  const { t, locale, setLocale, setTheme } = usePreferences();
  const { openTask, newTask } = useTaskDialog();
  const { setStatus } = useTaskActions();
  const { create: createNote } = useNoteActions();
  const { data: allTasks } = useTasks();
  // The item selected on the page when the palette opened (snapshot: the palette is mounted
  // only while open).
  const [selection] = useState(getActiveSelection);
  const selectedTask =
    selection?.kind === "task" ? allTasks?.find((x) => x.id === selection.id) : undefined;
  const [term, setTerm] = useState("");
  const [preferred, setPreferred] = useState<SearchMode>(readMode);
  const { data: status } = useSemanticStatus(open);
  const semanticAvailable = status?.available === true;
  const mode: SearchMode = preferred === "semantic" && semanticAvailable ? "semantic" : "keyword";

  const debounced = useDebounced(term, mode === "semantic" ? 400 : 200);
  const semantic = useSemanticSearch(debounced, open && mode === "semantic");
  const semanticFailed = mode === "semantic" && semantic.isError;
  const showKeyword = mode === "keyword" || semanticFailed;
  const keyword = useSearch(debounced, open && showKeyword);

  const tasks = showKeyword ? (keyword.data?.tasks ?? []) : [];
  const projects = showKeyword ? (keyword.data?.projects ?? []) : [];
  const notes = showKeyword ? (keyword.data?.notes ?? []) : [];
  const hits: SemanticHit[] =
    mode === "semantic" && !semanticFailed ? (semantic.data?.hits ?? []) : [];
  const fetching = showKeyword ? keyword.isFetching : semantic.isFetching;
  const pending = fetching || term !== debounced;

  const setMode = (next: SearchMode) => {
    setPreferred(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // storage blocked: the choice lasts for this palette only
    }
  };

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const openNote = (id: string) =>
    run(() => navigate({ to: "/notes/$noteId", params: { noteId: id } }));

  type Command = { id: string; label: string; icon: LucideIcon; run: () => void };
  const actions: Command[] = [
    { id: "new-task", label: t("searchNewTask"), icon: Plus, run: () => newTask() },
    {
      id: "new-note",
      label: t("cmdNewNote"),
      icon: StickyNote,
      run: () =>
        void createNote({ title: "Tanpa judul", content: "", status: "idea" }).then((row) => {
          if (row) void navigate({ to: "/notes/$noteId", params: { noteId: row.id } });
        }),
    },
    { id: "quick-task", label: t("quickTask"), icon: Zap, run: onQuickTask },
    { id: "quick-capture", label: t("quickCapture"), icon: Inbox, run: onQuickCapture },
    {
      id: "theme",
      label: t("cmdToggleTheme"),
      icon: Moon,
      run: () => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
    },
    {
      id: "language",
      label: t("cmdSwitchLanguage"),
      icon: Languages,
      run: () => setLocale(locale === "id" ? "en" : "id"),
    },
    { id: "shortcuts", label: t("kbTitle"), icon: Keyboard, run: onShortcuts },
  ];
  const selectionActions: Command[] = selectedTask
    ? [
        {
          id: "sel-open",
          label: `${t("cmdOpenSelected")}: ${selectedTask.title}`,
          icon: Pencil,
          run: () => openTask(selectedTask.id),
        },
        {
          id: "sel-toggle",
          label: `${t(selectedTask.status === "done" ? "cmdMarkUndone" : "cmdMarkDone")}: ${selectedTask.title}`,
          icon: CheckCircle2,
          run: () => void setStatus(selectedTask, selectedTask.status === "done" ? "todo" : "done"),
        },
      ]
    : selection?.kind === "note"
      ? [
          {
            id: "sel-open",
            label: t("cmdOpenSelectedNote"),
            icon: StickyNote,
            run: () => openNote(selection.id),
          },
        ]
      : [];
  const pageCommands: Command[] = pages.map((p) => ({
    id: `page-${p.to}`,
    label: `${t("cmdGoTo")} ${t(p.key)}`,
    icon: p.icon,
    run: () => void navigate({ to: p.to }),
  }));
  const commandGroups = [
    { heading: t("cmdSelected"), items: selectionActions },
    { heading: t("searchActions"), items: actions },
    { heading: t("cmdPages"), items: pageCommands },
  ].map((g) => ({ ...g, items: g.items.filter((c) => matchesCommand(c.label, term)) }));

  const emptyText =
    mode === "semantic" && debounced.trim().length < 2
      ? t("searchSemanticHint")
      : t("searchNoResults");

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} commandProps={{ shouldFilter: false }}>
      <CommandInput
        placeholder={mode === "semantic" ? t("searchPlaceholderSemantic") : t("searchPlaceholder")}
        value={term}
        onValueChange={setTerm}
      />
      <div
        role="group"
        aria-label={t("searchModeLabel")}
        className="flex items-center gap-1 border-b px-3 py-1.5 text-xs"
      >
        {(["keyword", "semantic"] as const).map((m) => {
          const disabled = m === "semantic" && !semanticAvailable;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              disabled={disabled}
              title={disabled ? t("searchModeSemanticUnavailable") : undefined}
              onClick={() => setMode(m)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {m === "semantic" && <Sparkles className="h-3.5 w-3.5" aria-hidden />}
              {m === "keyword" ? t("searchModeKeyword") : t("searchModeSemantic")}
            </button>
          );
        })}
        <span className="sr-only" aria-live="polite">
          {pending ? t("searchLoading") : ""}
        </span>
        {semanticFailed && (
          <span role="status" className="ml-auto text-muted-foreground">
            {t("searchSemanticFailed")}
          </span>
        )}
      </div>
      <CommandList>
        <CommandEmpty>
          {pending ? (
            <Loader2
              className="mx-auto h-4 w-4 animate-spin text-muted-foreground"
              aria-label={t("searchLoading")}
            />
          ) : (
            emptyText
          )}
        </CommandEmpty>
        {commandGroups.map(
          (g) =>
            g.items.length > 0 && (
              <CommandGroup key={g.heading} heading={g.heading}>
                {g.items.map((c) => (
                  <CommandItem key={c.id} value={`command ${c.id}`} onSelect={() => run(c.run)}>
                    <c.icon /> {c.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ),
        )}
        {hits.length > 0 && (
          <CommandGroup heading={t("searchSemanticResults")}>
            {hits.map((h) => {
              const pct = Math.round(h.similarity * 100);
              const kind = h.type === "task" ? t("searchTaskLabel") : t("searchNoteLabel");
              return (
                <CommandItem
                  key={`${h.type}-${h.id}`}
                  value={`semantic ${h.type} ${h.id}`}
                  aria-label={`${kind}: ${h.title || "—"}, ${pct}% ${t("searchSimilarity")}`}
                  onSelect={() => (h.type === "task" ? run(() => openTask(h.id)) : openNote(h.id))}
                >
                  {h.type === "task" ? <CheckSquare /> : <StickyNote />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{h.title || "—"}</span>
                    {h.snippet && (
                      <span className="truncate text-xs text-muted-foreground">{h.snippet}</span>
                    )}
                  </span>
                  <span
                    className="ml-2 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground"
                    aria-hidden
                  >
                    {pct}%
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {tasks.length > 0 && (
          <CommandGroup heading={t("tasks")}>
            {tasks.map((task) => (
              <CommandItem
                key={task.id}
                value={`task ${task.id}`}
                onSelect={() => run(() => openTask(task.id))}
              >
                <CheckSquare /> {task.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {projects.length > 0 && (
          <CommandGroup heading={t("searchProjects")}>
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
          <CommandGroup heading={t("notes")}>
            {notes.map((n) => (
              <CommandItem key={n.id} value={`note ${n.id}`} onSelect={() => openNote(n.id)}>
                <StickyNote /> {n.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
