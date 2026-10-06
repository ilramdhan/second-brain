import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckSquare, FolderKanban, Loader2, Plus, Sparkles, StickyNote } from "lucide-react";

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
import { useSearch, useSemanticSearch, useSemanticStatus, type SemanticHit } from "@/lib/data";
import { usePreferences } from "@/lib/preferences";
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
 */
export default function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const { t } = usePreferences();
  const { openTask, newTask } = useTaskDialog();
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
        <CommandGroup heading={t("searchActions")}>
          <CommandItem value="action-new-task" onSelect={() => run(() => newTask())}>
            <Plus /> {t("searchNewTask")}
          </CommandItem>
        </CommandGroup>
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
