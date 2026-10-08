import { useMemo, useState } from "react";
import { addDays, format, isToday, isTomorrow } from "date-fns";
import { CalendarClock, KanbanSquare, List, Plus } from "lucide-react";

import { Kanban } from "@/components/Kanban";
import { LoadMore, usePaged } from "@/components/common/LoadMore";
import {
  rowProps,
  TaskCard,
  TaskRows,
  useTaskRowLookups,
  type TaskRowLookups,
} from "@/components/tasks/TaskItem";
import {
  applyTaskFilter,
  EMPTY_FILTER,
  TaskFilters,
  type TaskFilter,
} from "@/components/tasks/TaskFilters";
import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { Button } from "@/components/ui/button";
import { useKeyboardNav, type NavState } from "@/hooks/use-keyboard-nav";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TASK_STATUS } from "@/lib/constants";
import { useI18n, usePreferences } from "@/lib/preferences";
import { useMe, useProjects, useTaskActions, useTasks, type Task } from "@/lib/data";
import { dayKeyOf, upcomingBuckets } from "@/lib/task-maps";
import { enumLabel } from "@/components/tasks/labels";

export function TaskViews({ projectId }: { projectId?: string | undefined }) {
  const { data: allTasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: me } = useMe();
  const { newTask, openTask } = useTaskDialog();
  const { setStatus } = useTaskActions();
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_FILTER);
  const [showDone, setShowDone] = useState(false);
  const { t } = usePreferences();
  const statusColumns = useMemo(
    () => TASK_STATUS.map((c) => ({ id: c.id, label: enumLabel(t, "status", c.id, c.label) })),
    [t],
  );

  const scoped = useMemo(
    () => allTasks.filter((t) => !t.parent_id && (!projectId || t.project_id === projectId)),
    [allTasks, projectId],
  );
  const tags = useMemo(() => [...new Set(scoped.flatMap((t) => t.tags))].sort(), [scoped]);
  const filtered = useMemo(() => applyTaskFilter(scoped, filter, me?.id), [scoped, filter, me?.id]);
  const listItems = useMemo(
    () =>
      filtered
        .filter((t) => showDone || t.status !== "done")
        .sort(
          (a, b) =>
            Number(a.status === "done") - Number(b.status === "done") ||
            (a.due_date ?? "9").localeCompare(b.due_date ?? "9"),
        ),
    [filtered, showDone],
  );
  const open = useMemo(() => filtered.filter((t) => t.status !== "done"), [filtered]);
  const lookups = useTaskRowLookups(allTasks, projects);

  const paged = usePaged(listItems, 25, `${JSON.stringify(filter)}-${showDone}`);

  // Upcoming buckets live here (not in <Upcoming>) so j/k walk them in display order.
  const todayKey = dayKeyOf(new Date());
  const upcoming = useMemo(() => {
    const today = new Date(`${todayKey}T00:00:00`);
    const buckets = upcomingBuckets(open, today);
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
    const order = [
      ...buckets.overdue,
      ...days.flatMap((d) => buckets.days.get(dayKeyOf(d)) ?? []),
      ...buckets.later,
      ...buckets.noDate,
    ].map((t) => t.id);
    return { buckets, days, order };
  }, [open, todayKey]);

  // Keyboard navigation (j/k, h/l on the board, Enter/o, e, x) over what is on screen.
  const navColumns = useMemo(
    () =>
      view === "board"
        ? TASK_STATUS.map((c) => filtered.filter((t) => t.status === c.id).map((t) => t.id))
        : view === "list"
          ? [paged.visible.map((t) => t.id)]
          : [upcoming.order],
    [view, filtered, paged.visible, upcoming.order],
  );
  const { containerProps, nav } = useKeyboardNav({
    columns: navColumns,
    kind: "task",
    onOpen: openTask,
    onToggle: (id) => {
      const task = filtered.find((t) => t.id === id);
      if (task) lookups.toggle(task);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="list" className="gap-1.5">
              <List className="h-3.5 w-3.5" />
              {t("taskViewList")}
            </TabsTrigger>
            <TabsTrigger value="board" className="gap-1.5">
              <KanbanSquare className="h-3.5 w-3.5" />
              {t("taskViewBoard")}
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              {t("taskViewUpcoming")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => newTask({ project_id: projectId ?? null })}>
          <Plus /> {t("taskAddButton")}
        </Button>
      </div>

      <TaskFilters
        value={filter}
        onChange={setFilter}
        projects={projects}
        tags={tags}
        hideProject={!!projectId}
      />

      {view === "list" && (
        <>
          <div {...containerProps} role="group" aria-label={t("kbTaskListLabel")}>
            <TaskRows tasks={paged.visible} lookups={lookups} nav={nav} />
          </div>
          <LoadMore shown={paged.visible.length} total={paged.total} onMore={paged.more} />
          {listItems.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("taskNoMatch")}</p>
          )}
          <button
            onClick={() => setShowDone(!showDone)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showDone
              ? t("taskHideDone")
              : t("taskShowDone", { count: filtered.filter((x) => x.status === "done").length })}
          </button>
        </>
      )}

      {view === "board" && (
        <div {...containerProps}>
          <Kanban
            nav={nav}
            columns={statusColumns}
            items={filtered}
            getColumn={(t) => t.status}
            onMove={(t, col) => setStatus(t, col)}
            onAdd={(col) => newTask({ status: col, project_id: projectId ?? null })}
            onOpen={(t) => openTask(t.id)}
            itemLabel={(t) => t.title}
            renderCard={(t) => <TaskCard {...rowProps(t, lookups)} />}
          />
        </div>
      )}

      {view === "upcoming" && (
        <div {...containerProps} role="group" aria-label={t("kbTaskListLabel")}>
          <Upcoming buckets={upcoming.buckets} days={upcoming.days} lookups={lookups} nav={nav} />
        </div>
      )}
    </div>
  );
}

function Upcoming({
  buckets,
  days,
  lookups,
  nav,
}: {
  buckets: ReturnType<typeof upcomingBuckets<Task>>;
  days: Date[];
  lookups: TaskRowLookups;
  nav: NavState;
}) {
  const { t, dateFns } = useI18n();
  return (
    <div className="space-y-6">
      <Group title={t("taskGroupOverdue")} items={buckets.overdue} lookups={lookups} nav={nav} />
      {days.map((d) => {
        const items = buckets.days.get(dayKeyOf(d)) ?? [];
        const label = isToday(d)
          ? t("taskGroupToday")
          : isTomorrow(d)
            ? t("taskGroupTomorrow")
            : format(d, "EEEE, d MMM", { locale: dateFns });
        return items.length || isToday(d) ? (
          <Group
            key={d.toISOString()}
            title={label}
            items={items}
            date={d}
            lookups={lookups}
            nav={nav}
          />
        ) : null;
      })}
      <Group title={t("taskGroupLater")} items={buckets.later} lookups={lookups} nav={nav} />
      <Group title={t("taskGroupNoDate")} items={buckets.noDate} lookups={lookups} nav={nav} />
    </div>
  );
}

/** Top-level (not defined inside Upcoming's render), so React keeps its rows mounted. */
function Group({
  title,
  items,
  date,
  lookups,
  nav,
}: {
  title: string;
  items: Task[];
  date?: Date | undefined;
  lookups: TaskRowLookups;
  nav?: NavState | undefined;
}) {
  const { newTask } = useTaskDialog();
  const { t } = useI18n();
  if (items.length === 0 && !date) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between border-b pb-1.5">
        <h3 className="text-sm font-semibold capitalize">
          {title} <span className="font-normal text-muted-foreground">{items.length || ""}</span>
        </h3>
        {date && (
          <button
            onClick={() => newTask({ due_date: date.toISOString() })}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label={t("taskAddTask")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <TaskRows tasks={items} lookups={lookups} nav={nav} />
    </section>
  );
}
