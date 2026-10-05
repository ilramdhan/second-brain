import { createContext, lazy, Suspense, useContext, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Task } from "@/lib/data";

// The editor (selects, comments, dependencies, focus timer, Google sync) is only downloaded
// the first time a task is opened, not with the app shell.
const TaskEditor = lazy(() => import("@/components/tasks/TaskEditor"));

export type TaskDefaults = Partial<
  Pick<
    Task,
    | "project_id"
    | "status"
    | "due_date"
    | "start_date"
    | "milestone_id"
    | "parent_id"
    | "priority"
    | "title"
    | "description"
    | "tags"
    | "estimate_minutes"
    | "recurrence"
  >
>;

type Ctx = {
  openTask: (id: string) => void;
  newTask: (defaults?: TaskDefaults) => void | undefined;
};
// Keep one context instance across hot reloads so provider and consumers always match.
const g = globalThis as unknown as { __taskDialogCtx?: React.Context<Ctx | null> };
const TaskDialogCtx = (g.__taskDialogCtx ??= createContext<Ctx | null>(null));

export function useTaskDialog() {
  const c = useContext(TaskDialogCtx);
  if (!c) throw new Error("useTaskDialog outside provider");
  return c;
}

export function TaskDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ open: boolean; id: string | null; defaults: TaskDefaults }>({
    open: false,
    id: null,
    defaults: {},
  });
  const value = useMemo<Ctx>(
    () => ({
      openTask: (id) => setState({ open: true, id, defaults: {} }),
      newTask: (defaults = {}) => setState({ open: true, id: null, defaults }),
    }),
    [],
  );
  return (
    <TaskDialogCtx.Provider value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {state.open && (
            <Suspense
              fallback={
                <div className="flex justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <TaskEditor
                key={state.id ?? "new"}
                taskId={state.id}
                defaults={state.defaults}
                onClose={() => setState((s) => ({ ...s, open: false }))}
                onOpen={(id) => setState({ open: true, id, defaults: {} })}
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </TaskDialogCtx.Provider>
  );
}
