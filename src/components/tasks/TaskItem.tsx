import { memo, useCallback, useMemo, useRef } from "react";
import { format, isBefore, startOfDay } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { CalendarDays, ListChecks, Lock, Repeat, User } from "lucide-react";

import { CheckCircle } from "@/components/tasks/CheckCircle";
import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { color, labelOf, priorityOf, TASK_STATUS } from "@/lib/constants";
import { useDeps, useTaskActions, type Project, type Task } from "@/lib/data";
import { byId, openBlockersByTask, subtasksByParent } from "@/lib/task-maps";
import { cn } from "@/lib/utils";

function DueLabel({ task }: { task: Task }) {
  if (!task.due_date) return null;
  const d = new Date(task.due_date);
  const late = task.status !== "done" && isBefore(d, startOfDay(new Date()));
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs",
        late ? "text-priority-high" : "text-muted-foreground",
      )}
    >
      <CalendarDays className="h-3 w-3" />
      {task.start_date && format(new Date(task.start_date), "d MMM", { locale: localeId }) + " – "}
      {format(d, "d MMM", { locale: localeId })}
    </span>
  );
}

const NONE: Task[] = [];

export type TaskRowLookups = {
  projectById: Map<string, Project>;
  subsByParent: Map<string, Task[]>;
  blockersByTask: Map<string, Task[]>;
  /** Stable across renders, so memoised rows do not re-render when the parent does. */
  toggle: (task: Task) => void;
};

/**
 * Builds the per-row lookups once in the list parent: one `useTaskActions`/`useDeps`
 * subscription for the whole list instead of one per row, and O(1) map reads instead of
 * scanning all tasks/deps in every row.
 */
export function useTaskRowLookups(allTasks: Task[], projects: Project[]): TaskRowLookups {
  const { data: deps = [] } = useDeps();
  const { setStatus } = useTaskActions();
  const setStatusRef = useRef(setStatus);
  setStatusRef.current = setStatus;
  const toggle = useCallback(
    (task: Task) => void setStatusRef.current(task, task.status === "done" ? "todo" : "done"),
    [],
  );
  const taskById = useMemo(() => byId(allTasks), [allTasks]);
  const projectById = useMemo(() => byId(projects), [projects]);
  const subsByParent = useMemo(() => subtasksByParent(allTasks), [allTasks]);
  const blockersByTask = useMemo(() => openBlockersByTask(deps, taskById), [deps, taskById]);
  return useMemo(
    () => ({ projectById, subsByParent, blockersByTask, toggle }),
    [projectById, subsByParent, blockersByTask, toggle],
  );
}

/** Props for one row/card, read from the lookups. */
export function rowProps(task: Task, l: TaskRowLookups) {
  return {
    task,
    project: task.project_id ? l.projectById.get(task.project_id) : undefined,
    subtasks: l.subsByParent.get(task.id) ?? NONE,
    blockers: l.blockersByTask.get(task.id) ?? NONE,
  };
}

type ItemProps = {
  task: Task;
  project?: Project | undefined;
  subtasks: Task[];
  blockers: Task[];
};

function Meta({
  task,
  project,
  subCount,
  subDone,
  blockers = [],
}: {
  task: Task;
  project?: Project | undefined;
  subCount: number;
  subDone: number;
  blockers?: Task[];
}) {
  const pr = priorityOf(task.priority);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {blockers.length > 0 && (
        <span
          className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          title={blockers.map((b) => b.title).join(", ")}
        >
          <Lock className="h-3 w-3" /> Menunggu {blockers.length}
        </span>
      )}
      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", pr.className)}>
        {pr.label}
      </span>
      <DueLabel task={task} />
      {project && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className={cn("h-2 w-2 rounded-full", color(project.color).dot)} />
          {project.name}
        </span>
      )}
      {subCount > 0 && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <ListChecks className="h-3 w-3" />
          {subDone}/{subCount}
        </span>
      )}
      {(task.assignee_name || task.assignee_id) && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <User className="h-3 w-3" />
          {task.assignee_name ?? "Anggota"}
        </span>
      )}
      {task.recurrence && <Repeat className="h-3 w-3 text-muted-foreground" />}
      {task.tags.map((t) => (
        <span
          key={t}
          className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground"
        >
          #{t}
        </span>
      ))}
    </div>
  );
}

export const TaskRow = memo(function TaskRow({
  task,
  project,
  subtasks,
  blockers,
  onToggle,
}: ItemProps & { onToggle: (task: Task) => void }) {
  const { openTask } = useTaskDialog();
  const done = task.status === "done";
  return (
    <li
      onClick={() => openTask(task.id)}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/30",
        done && "opacity-60",
        blockers.length > 0 && "bg-muted/50 text-muted-foreground",
      )}
    >
      <CheckCircle done={done} onClick={() => onToggle(task)} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("text-sm font-medium", done && "line-through")}>{task.title}</p>
          {task.status !== "todo" && !done && (
            <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
              {labelOf(TASK_STATUS, task.status)}
            </span>
          )}
        </div>
        {task.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{task.description}</p>
        )}
        <Meta
          task={task}
          project={project}
          subCount={subtasks.length}
          subDone={subtasks.filter((s) => s.status === "done").length}
          blockers={blockers}
        />
      </div>
    </li>
  );
});

export const TaskCard = memo(function TaskCard({ task, project, subtasks, blockers }: ItemProps) {
  const { openTask } = useTaskDialog();
  return (
    <div
      onClick={() => openTask(task.id)}
      className={cn(
        "cursor-pointer rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/30",
        blockers.length > 0 && "bg-muted/60 opacity-80",
      )}
    >
      <p
        className={cn(
          "text-sm font-medium",
          task.status === "done" && "text-muted-foreground line-through",
        )}
      >
        {task.title}
      </p>
      {task.description && (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
      )}
      <Meta
        task={task}
        project={project}
        subCount={subtasks.length}
        subDone={subtasks.filter((s) => s.status === "done").length}
        blockers={blockers}
      />
    </div>
  );
});

/** A list of rows for callers that only have the visible tasks (Today, calendar day view). */
export function TaskRows({ tasks, lookups }: { tasks: Task[]; lookups: TaskRowLookups }) {
  return (
    <ul className="space-y-2">
      {tasks.map((t) => (
        <TaskRow key={t.id} {...rowProps(t, lookups)} onToggle={lookups.toggle} />
      ))}
    </ul>
  );
}
