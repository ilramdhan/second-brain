import { format, isBefore, startOfDay } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { CalendarDays, ListChecks, Lock, Repeat, User } from "lucide-react";

import { CheckCircle } from "@/components/tasks/CheckCircle";
import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { color, labelOf, priorityOf, TASK_STATUS } from "@/lib/constants";
import { openBlockers, useDeps, useTaskActions, type Project, type Task } from "@/lib/data";
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

function useBlocked(task: Task, allTasks: Task[]) {
  const { data: deps = [] } = useDeps();
  return task.status === "done" ? [] : openBlockers(task.id, deps, allTasks);
}

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

export function TaskRow({
  task,
  projects,
  allTasks,
}: {
  task: Task;
  projects: Project[];
  allTasks: Task[];
}) {
  const { openTask } = useTaskDialog();
  const { setStatus } = useTaskActions();
  const subs = allTasks.filter((t) => t.parent_id === task.id);
  const done = task.status === "done";
  const blockers = useBlocked(task, allTasks);
  return (
    <li
      onClick={() => openTask(task.id)}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/30",
        done && "opacity-60",
        blockers.length > 0 && "bg-muted/50 text-muted-foreground",
      )}
    >
      <CheckCircle
        done={done}
        onClick={() => setStatus(task, done ? "todo" : "done")}
        className="mt-0.5"
      />
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
          project={projects.find((p) => p.id === task.project_id)}
          subCount={subs.length}
          subDone={subs.filter((s) => s.status === "done").length}
          blockers={blockers}
        />
      </div>
    </li>
  );
}

export function TaskCard({
  task,
  projects,
  allTasks,
}: {
  task: Task;
  projects: Project[];
  allTasks: Task[];
}) {
  const { openTask } = useTaskDialog();
  const subs = allTasks.filter((t) => t.parent_id === task.id);
  const blockers = useBlocked(task, allTasks);
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
        project={projects.find((p) => p.id === task.project_id)}
        subCount={subs.length}
        subDone={subs.filter((s) => s.status === "done").length}
        blockers={blockers}
      />
    </div>
  );
}
