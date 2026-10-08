import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Diamond, Plus, Rocket } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/PageHeader";
import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { TaskRows, useTaskRowLookups } from "@/components/tasks/TaskItem";
import { byId, tasksByDay } from "@/lib/task-maps";
import { Button, IconButton, ResponsiveButton, pressableFocus } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { color, priorityOf } from "@/lib/constants";
import {
  dateToIso,
  dayKey,
  shiftIso,
  taskRange,
  useMilestones,
  useProjects,
  useTaskActions,
  useTasks,
  type Task,
} from "@/lib/data";
import { cn } from "@/lib/utils";
import {
  KEYBOARD_CODES,
  dayLabel,
  dayNavigator,
  dndAnnouncements,
  droppableKeyboardCoordinates,
  screenReaderInstructions,
} from "@/lib/dnd-a11y";
import { PageContainer } from "@/components/common/PageContainer";
import { milestonesQuery, preloadQueries, projectsQuery, tasksQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";
import { tr, useI18n } from "@/lib/preferences";
import { pageHead } from "@/lib/page-head";
import {
  CALENDAR_MOVES,
  matchShortcut,
  moveCalendarDay,
  shouldIgnoreShortcut,
} from "@/lib/shortcuts";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: (ctx) =>
    pageHead(ctx, {
      title: "metaCalendarTitle",
      desc: "metaCalendarDesc",
      ogDesc: "metaCalendarOgDesc",
    }),
  loader: ({ context }) =>
    preloadQueries(context.queryClient, tasksQuery, projectsQuery, milestonesQuery),
  component: CalendarPage,
  errorComponent: RouteError,
});

type View = "day" | "week" | "month" | "year";
const WEEK_OPTS = { weekStartsOn: 1 as const };
/** Short weekday names Monday → Sunday in the given date-fns locale ("Sen" … "Min" in ID). */
const weekdays = (locale: ReturnType<typeof useI18n>["dateFns"]) =>
  Array.from({ length: 7 }, (_, i) =>
    format(addDays(startOfWeek(new Date(2026, 0, 5), WEEK_OPTS), i), "EEE", { locale }),
  );

function CalendarPage() {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: milestones = [] } = useMilestones();
  const { update } = useTaskActions();
  const { newTask } = useTaskDialog();
  const [dragging, setDragging] = useState<Task | null>(null);
  const { t, dateFns } = useI18n();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    // Draggable ids are `move|resize:<taskId>:<yyyy-MM-dd>`, so the start day is the last part.
    useSensor(KeyboardSensor, {
      keyboardCodes: KEYBOARD_CODES,
      coordinateGetter: droppableKeyboardCoordinates(
        dayNavigator,
        (id) => String(id).split(":").at(-1) ?? null,
      ),
    }),
  );
  const accessibility = useMemo(
    () => ({
      screenReaderInstructions,
      announcements: dndAnnouncements({
        itemName: (a) => {
          const d = a.data.current as { task: Task; mode: "move" | "resize" } | undefined;
          if (!d) return tr("taskCalItemTask");
          return d.mode === "resize"
            ? tr("taskCalItemDueNamed", { title: d.task.title })
            : tr("taskCalItemTaskNamed", { title: d.task.title });
        },
        targetName: (id) => dayLabel(String(id)),
      }),
    }),
    [],
  );

  // Computed once per tasks change; pushes in place (was a copy of the day's array per task).
  const byDay = useMemo(() => tasksByDay(tasks), [tasks]);
  const projectById = useMemo(() => byId(projects), [projects]);

  const markers = useMemo(() => {
    const m = new Map<
      string,
      { id: string; label: string; kind: "milestone" | "launch"; done?: boolean | undefined }[]
    >();
    const push = (
      k: string,
      v: { id: string; label: string; kind: "milestone" | "launch"; done?: boolean | undefined },
    ) => m.set(k, [...(m.get(k) ?? []), v]);
    milestones.forEach(
      (ms) =>
        ms.due_date &&
        push(ms.due_date, { id: ms.id, label: ms.title, kind: "milestone", done: ms.done }),
    );
    projects.forEach(
      (p) =>
        p.launch_date &&
        push(p.launch_date, {
          id: p.id,
          label: t("taskCalLaunch", { name: p.name }),
          kind: "launch",
        }),
    );
    return m;
  }, [milestones, projects, t]);

  const colorFor = useCallback(
    (t: Task) => {
      const p = t.project_id ? projectById.get(t.project_id) : undefined;
      return p ? color(p.color).soft : priorityOf(t.priority).className;
    },
    [projectById],
  );

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const overId = e.over?.id as string | undefined;
    const data = e.active.data.current as
      { task: Task; mode: "move" | "resize"; from: string } | undefined;
    if (!overId || !data) return;
    const target = new Date(`${overId}T00:00:00`);
    const { task } = data;
    if (data.mode === "move") {
      const delta = differenceInCalendarDays(target, new Date(`${data.from}T00:00:00`));
      if (!delta) return;
      update(task.id, {
        start_date: shiftIso(task.start_date, delta),
        due_date: shiftIso(task.due_date, delta),
        reminded: false,
      });
      toast.success(
        t("taskCalMovedTo", {
          date: format(addDays(new Date(task.due_date ?? task.start_date!), delta), "d MMM", {
            locale: dateFns,
          }),
        }),
      );
    } else {
      const r = taskRange(task)!;
      if (target < r.start) {
        toast.error(t("taskDueBeforeStart"));
        return;
      }
      update(task.id, {
        start_date: task.start_date ?? task.due_date,
        due_date: dateToIso(overId),
        reminded: false,
      });
      toast.success(t("taskCalExtended"));
    }
  }

  const step = (dir: 1 | -1) =>
    setCursor((c) =>
      view === "day"
        ? addDays(c, dir)
        : view === "week"
          ? addWeeks(c, dir)
          : view === "month"
            ? addMonths(c, dir)
            : addYears(c, dir),
    );

  const title =
    view === "day"
      ? format(cursor, "EEEE, d MMMM yyyy", { locale: dateFns })
      : view === "week"
        ? `${format(startOfWeek(cursor, WEEK_OPTS), "d MMM", { locale: dateFns })} – ${format(endOfWeek(cursor, WEEK_OPTS), "d MMM yyyy", { locale: dateFns })}`
        : view === "month"
          ? format(cursor, "MMMM yyyy", { locale: dateFns })
          : format(cursor, "yyyy");

  // Keyboard (src/lib/shortcuts.ts, scope "calendar"): in the month/week grid the cursor day is
  // the focused cell (roving tabindex); h/j/k/l move it from anywhere, arrows and Enter while a
  // cell has focus. Enter adds a task on that day, t jumps to today, [ and ] page the period.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef(false);
  const latest = useRef({ view, cursor, step, newTask, dragging });
  useLayoutEffect(() => {
    latest.current = { view, cursor, step, newTask, dragging };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      const m = matchShortcut(e, "calendar");
      if (!m) return;
      const { view, cursor, step, newTask, dragging } = latest.current;
      // A chip being dragged with the keyboard owns the arrows/Enter/Esc.
      if (dragging || document.querySelector("[aria-pressed=true]")) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const onCell = !!target?.hasAttribute("data-cal-day");
      if (m.binding.inList && !onCell) return;
      if (m.id === "calToday") {
        e.preventDefault();
        pendingFocus.current = onCell;
        setCursor(startOfDay(new Date()));
        return;
      }
      if (m.id === "calPrev" || m.id === "calNext") {
        e.preventDefault();
        pendingFocus.current = onCell;
        step(m.id === "calPrev" ? -1 : 1);
        return;
      }
      if (view !== "month" && view !== "week") return;
      if (m.id === "calNewTask") {
        e.preventDefault();
        newTask({ due_date: dateToIso(dayKey(cursor)) });
        return;
      }
      if (CALENDAR_MOVES[m.id] !== undefined) {
        e.preventDefault();
        pendingFocus.current = true;
        setCursor(moveCalendarDay(cursor, m.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const cursorKey = dayKey(cursor);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const el = gridRef.current?.querySelector<HTMLElement>(
      `[data-cal-day="${CSS.escape(cursorKey)}"]`,
    );
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [cursorKey, view]);

  const cellProps = {
    cursorKey,
    onFocusDay: (d: Date) => {
      if (dayKey(d) !== cursorKey) setCursor(d);
    },
    byDay,
    markers,
    colorFor,
    onAdd: (d: Date) => newTask({ due_date: dateToIso(dayKey(d)) }),
    onMore: (d: Date) => {
      setCursor(d);
      setView("day");
    },
  };

  return (
    <PageContainer>
      <PageHeader
        title={t("taskCalTitle")}
        subtitle={t("taskCalSubtitle")}
        actions={
          <ResponsiveButton
            onClick={() => newTask({ due_date: dateToIso(dayKey(cursor)) })}
            icon={<Plus />}
            label={t("taskAddButton")}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton
            variant="secondary"
            size="icon-sm"
            onClick={() => step(-1)}
            label={t("taskCalPrevious")}
          >
            <ChevronLeft />
          </IconButton>
          <Button variant="secondary" size="sm" onClick={() => setCursor(startOfDay(new Date()))}>
            {t("taskCalToday")}
          </Button>
          <IconButton
            variant="secondary"
            size="icon-sm"
            onClick={() => step(1)}
            label={t("taskCalNext")}
          >
            <ChevronRight />
          </IconButton>
          <h2 className="ml-2 text-base font-semibold capitalize">{title}</h2>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="day">{t("taskCalDay")}</TabsTrigger>
            <TabsTrigger value="week">{t("taskCalWeek")}</TabsTrigger>
            <TabsTrigger value="month">{t("taskCalMonth")}</TabsTrigger>
            <TabsTrigger value="year">{t("taskCalYear")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <DndContext
        sensors={sensors}
        accessibility={accessibility}
        onDragStart={(e) => setDragging((e.active.data.current as { task: Task }).task)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        {(view === "month" || view === "week") && (
          <div ref={gridRef}>
            {view === "month" ? (
              <MonthGrid cursor={cursor} {...cellProps} />
            ) : (
              <WeekGrid cursor={cursor} {...cellProps} />
            )}
          </div>
        )}
        {view === "day" && (
          <DayView
            day={cursor}
            tasks={byDay.get(dayKey(cursor)) ?? []}
            markers={markers.get(dayKey(cursor)) ?? []}
          />
        )}
        {view === "year" && (
          <YearView
            cursor={cursor}
            byDay={byDay}
            onPick={(d) => {
              setCursor(d);
              setView("day");
            }}
          />
        )}
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium shadow-lg",
                colorFor(dragging),
              )}
            >
              {dragging.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </PageContainer>
  );
}

type CellProps = {
  /** The cursor day: the grid's one tab stop. */
  cursorKey: string;
  onFocusDay: (d: Date) => void;
  byDay: Map<string, Task[]>;
  markers: Map<
    string,
    { id: string; label: string; kind: "milestone" | "launch"; done?: boolean | undefined }[]
  >;
  colorFor: (t: Task) => string;
  onAdd: (d: Date) => void;
  onMore: (d: Date) => void;
};

function MonthGrid({ cursor, ...p }: { cursor: Date } & CellProps) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), WEEK_OPTS),
    end: endOfWeek(endOfMonth(cursor), WEEK_OPTS),
  });
  const { t, dateFns } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("kbCalGridLabel")}
      className="overflow-hidden rounded-2xl border bg-card"
    >
      <div className="grid grid-cols-7 border-b bg-secondary/40">
        {weekdays(dateFns).map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-[11px] font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => (
          <DayCell
            key={d.toISOString()}
            day={d}
            dim={!isSameMonth(d, cursor)}
            max={3}
            minH="min-h-20 sm:min-h-28"
            {...p}
          />
        ))}
      </div>
    </div>
  );
}

function WeekGrid({ cursor, ...p }: { cursor: Date } & CellProps) {
  const days = eachDayOfInterval({
    start: startOfWeek(cursor, WEEK_OPTS),
    end: endOfWeek(cursor, WEEK_OPTS),
  });
  const { t, dateFns } = useI18n();
  const names = weekdays(dateFns);
  return (
    <div
      role="group"
      aria-label={t("kbCalGridLabel")}
      className="scrollbar-subtle overflow-x-auto rounded-2xl border bg-card"
    >
      <div className="grid min-w-[720px] grid-cols-7">
        {days.map((d, i) => (
          <div key={d.toISOString()} className="flex flex-col">
            <div className="border-b bg-secondary/40 px-2 py-2 text-center text-[11px] font-medium text-muted-foreground">
              {names[i]}
            </div>
            <DayCell day={d} max={50} minH="min-h-[420px]" {...p} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DayCell({
  day,
  dim,
  max,
  minH,
  cursorKey,
  onFocusDay,
  byDay,
  markers,
  colorFor,
  onAdd,
  onMore,
}: { day: Date; dim?: boolean | undefined; max: number; minH: string } & CellProps) {
  const k = dayKey(day);
  const { setNodeRef, isOver } = useDroppable({ id: k });
  const items = byDay.get(k) ?? [];
  const marks = markers.get(k) ?? [];
  const shown = items.slice(0, max);
  const { t } = useI18n();
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={dayLabel(k)}
      data-cal-day={k}
      tabIndex={k === cursorKey ? 0 : -1}
      aria-current={isToday(day) ? "date" : undefined}
      onFocus={(e) => {
        // A click on a dimmed day of the next/previous month must not page the month.
        if (e.target === e.currentTarget && !dim) onFocusDay(day);
      }}
      className={cn(
        "group relative flex flex-col gap-1 border-b border-r p-1 outline-none motion-safe:transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        minH,
        dim && "bg-secondary/30",
        isOver && "bg-accent",
      )}
    >
      <div className="flex items-center justify-between px-0.5">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-xs",
            isToday(day)
              ? "bg-primary font-semibold text-primary-foreground"
              : dim
                ? "text-muted-foreground/60"
                : "text-muted-foreground",
          )}
        >
          {format(day, "d")}
        </span>
        {/* eslint-disable-next-line no-restricted-syntax -- exception: dense calendar-cell control (tap-target gives 44px) */}
        <button
          type="button"
          onClick={() => onAdd(day)}
          className="tap-target rounded p-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none text-muted-foreground opacity-0 hover:bg-background focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
          aria-label={t("taskCalAddOnDay")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {marks.map((m) => (
        <div
          key={m.id}
          className={cn(
            "flex items-center gap-1 truncate rounded px-1 text-[10px] font-medium text-foreground",
            m.done && "line-through opacity-60",
          )}
        >
          {m.kind === "launch" ? (
            <Rocket className="h-3 w-3 shrink-0 text-primary" />
          ) : (
            <Diamond className="h-3 w-3 shrink-0 text-warning" />
          )}
          <span className="truncate">{m.label}</span>
        </div>
      ))}
      {shown.map((t) => (
        <CalendarChip key={t.id} task={t} day={k} className={colorFor(t)} />
      ))}
      {items.length > max && (
        <Button
          variant="link"
          size="inline"
          onClick={() => onMore(day)}
          className="ml-1 justify-start text-[10px] text-muted-foreground"
        >
          {t("taskCalMore", { count: items.length - max })}
        </Button>
      )}
    </div>
  );
}

function CalendarChip({ task, day, className }: { task: Task; day: string; className: string }) {
  const { openTask } = useTaskDialog();
  const { t } = useI18n();
  const {
    setNodeRef: setMoveNode,
    attributes: moveAttributes,
    listeners: moveListeners,
    isDragging,
  } = useDraggable({
    id: `move:${task.id}:${day}`,
    data: { task, mode: "move", from: day },
    attributes: { roleDescription: t("taskCalMovable") },
  });
  const {
    setNodeRef: setResizeNode,
    attributes: resizeAttributes,
    listeners: resizeListeners,
  } = useDraggable({
    id: `resize:${task.id}:${day}`,
    data: { task, mode: "resize", from: day },
    attributes: { roleDescription: t("taskCalResizeHandle") },
  });
  const r = taskRange(task);
  const isEnd = r && dayKey(r.end) === day;
  return (
    <div
      ref={setMoveNode}
      {...moveAttributes}
      {...moveListeners}
      aria-label={task.title}
      onClick={() => openTask(task.id)}
      onKeyDown={(e) => {
        moveListeners?.["onKeyDown"]?.(e);
        // Enter opens the editor (Space picks the chip up); ignored while dragging.
        if (e.key === "Enter" && !isDragging && e.target === e.currentTarget) {
          e.preventDefault();
          openTask(task.id);
        }
      }}
      className={cn(
        "relative flex cursor-grab touch-manipulation items-center truncate rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring py-0.5 pl-1.5 pr-3 text-[10px] font-medium leading-tight sm:text-[11px]",
        className,
        task.status === "done" && "line-through opacity-60",
        isDragging && "opacity-30",
      )}
      title={task.title}
    >
      <span className="truncate">{task.title}</span>
      {isEnd && (
        <span
          ref={setResizeNode}
          {...resizeAttributes}
          {...resizeListeners}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize rounded-r-md hover:bg-foreground/15 focus-visible:bg-foreground/25 focus-visible:outline-none"
          aria-label={t("taskCalChangeDue", { title: task.title })}
        />
      )}
    </div>
  );
}

function DayView({
  day,
  tasks,
  markers,
}: {
  day: Date;
  tasks: Task[];
  markers: { id: string; label: string; kind: string }[];
}) {
  const { data: projects = [] } = useProjects();
  const { data: all = [] } = useTasks();
  const lookups = useTaskRowLookups(all, projects);
  const { newTask } = useTaskDialog();
  const { setNodeRef } = useDroppable({ id: dayKey(day) });
  const { t } = useI18n();
  return (
    <div ref={setNodeRef} className="space-y-3 rounded-2xl border bg-card p-4">
      {markers.map((m) => (
        <p key={m.id} className="flex items-center gap-2 text-sm font-medium">
          {m.kind === "launch" ? (
            <Rocket className="h-4 w-4 text-primary" />
          ) : (
            <Diamond className="h-4 w-4 text-warning" />
          )}
          {m.label}
        </p>
      ))}
      <TaskRows tasks={tasks} lookups={lookups} />
      {tasks.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("taskCalNoTasksDay")}</p>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => newTask({ due_date: dateToIso(dayKey(day)) })}
      >
        <Plus /> {t("taskAddTask")}
      </Button>
    </div>
  );
}

function YearView({
  cursor,
  byDay,
  onPick,
}: {
  cursor: Date;
  byDay: Map<string, Task[]>;
  onPick: (d: Date) => void;
}) {
  const { t, dateFns } = useI18n();
  const names = weekdays(dateFns);
  const months = Array.from({ length: 12 }, (_, i) => new Date(cursor.getFullYear(), i, 1));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {months.map((m) => {
        const days = eachDayOfInterval({
          start: startOfWeek(m, WEEK_OPTS),
          end: endOfWeek(endOfMonth(m), WEEK_OPTS),
        });
        return (
          <div key={m.toISOString()} className="rounded-2xl border bg-card p-3">
            <h3 className="mb-2 text-sm font-semibold capitalize">
              {format(m, "MMMM", { locale: dateFns })}
            </h3>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {names.map((d) => (
                <span key={d} className="text-[9px] text-muted-foreground">
                  {d[0]}
                </span>
              ))}
              {days.map((d) => {
                const n = byDay.get(dayKey(d))?.length ?? 0;
                const inMonth = isSameMonth(d, m);
                return (
                  // eslint-disable-next-line no-restricted-syntax -- exception: year-heatmap day cell
                  <button
                    type="button"
                    key={d.toISOString()}
                    onClick={() => onPick(d)}
                    disabled={!inMonth}
                    className={cn(
                      "aspect-square rounded text-[10px] motion-safe:transition-colors",
                      pressableFocus,
                      !inMonth && "invisible",
                      isToday(d) && "ring-1 ring-primary",
                      n === 0
                        ? "hover:bg-accent"
                        : n < 3
                          ? "bg-primary/20 hover:bg-primary/30"
                          : "bg-primary/45 text-primary-foreground hover:bg-primary/60",
                    )}
                    title={n ? t("taskCalTaskCount", { count: n }) : undefined}
                  >
                    {format(d, "d")}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
