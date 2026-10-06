import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
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
import { id as localeId } from "date-fns/locale";
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
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Kalender — Second Brain" },
      {
        name: "description",
        content:
          "Kalender harian, mingguan, bulanan, dan tahunan. Geser tugas untuk mengubah tanggal.",
      },
      { property: "og:title", content: "Kalender — Second Brain" },
      {
        property: "og:description",
        content: "Kalender interaktif dengan drag & drop untuk tugas, milestone, dan launch date.",
      },
    ],
  }),
  loader: ({ context }) =>
    preloadQueries(context.queryClient, tasksQuery, projectsQuery, milestonesQuery),
  component: CalendarPage,
  errorComponent: RouteError,
});

type View = "day" | "week" | "month" | "year";
const WEEK_OPTS = { weekStartsOn: 1 as const };
const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

function CalendarPage() {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: milestones = [] } = useMilestones();
  const { update } = useTaskActions();
  const { newTask } = useTaskDialog();
  const [dragging, setDragging] = useState<Task | null>(null);

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
          if (!d) return "Tugas";
          return d.mode === "resize" ? `Tenggat "${d.task.title}"` : `Tugas "${d.task.title}"`;
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
        push(p.launch_date, { id: p.id, label: `Launch: ${p.name}`, kind: "launch" }),
    );
    return m;
  }, [milestones, projects]);

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
        `Dipindah ke ${format(addDays(new Date(task.due_date ?? task.start_date!), delta), "d MMM", { locale: localeId })}`,
      );
    } else {
      const r = taskRange(task)!;
      if (target < r.start) {
        toast.error("Tenggat tidak boleh sebelum tanggal mulai");
        return;
      }
      update(task.id, {
        start_date: task.start_date ?? task.due_date,
        due_date: dateToIso(overId),
        reminded: false,
      });
      toast.success("Rentang tugas diperpanjang");
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
      ? format(cursor, "EEEE, d MMMM yyyy", { locale: localeId })
      : view === "week"
        ? `${format(startOfWeek(cursor, WEEK_OPTS), "d MMM", { locale: localeId })} – ${format(endOfWeek(cursor, WEEK_OPTS), "d MMM yyyy", { locale: localeId })}`
        : view === "month"
          ? format(cursor, "MMMM yyyy", { locale: localeId })
          : format(cursor, "yyyy");

  const cellProps = {
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
        title="Kalender"
        subtitle="Geser tugas untuk pindah tanggal, tarik ujung kanan untuk memperpanjang."
        actions={
          <Button size="sm" onClick={() => newTask({ due_date: dateToIso(dayKey(cursor)) })}>
            <Plus /> Tugas
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => step(-1)}
            aria-label="Sebelumnya"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setCursor(startOfDay(new Date()))}
          >
            Hari ini
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => step(1)}
            aria-label="Berikutnya"
          >
            <ChevronRight />
          </Button>
          <h2 className="ml-2 text-base font-semibold capitalize">{title}</h2>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="day">Hari</TabsTrigger>
            <TabsTrigger value="week">Minggu</TabsTrigger>
            <TabsTrigger value="month">Bulan</TabsTrigger>
            <TabsTrigger value="year">Tahun</TabsTrigger>
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
        {view === "month" && <MonthGrid cursor={cursor} {...cellProps} />}
        {view === "week" && <WeekGrid cursor={cursor} {...cellProps} />}
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
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="grid grid-cols-7 border-b bg-secondary/40">
        {WEEKDAYS.map((d) => (
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
  return (
    <div className="scrollbar-subtle overflow-x-auto rounded-2xl border bg-card">
      <div className="grid min-w-[720px] grid-cols-7">
        {days.map((d, i) => (
          <div key={d.toISOString()} className="flex flex-col">
            <div className="border-b bg-secondary/40 px-2 py-2 text-center text-[11px] font-medium text-muted-foreground">
              {WEEKDAYS[i]}
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
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={dayLabel(k)}
      className={cn(
        "group relative flex flex-col gap-1 border-b border-r p-1 motion-safe:transition-colors",
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
        <button
          onClick={() => onAdd(day)}
          className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label="Tambah tugas di tanggal ini"
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
        <button
          onClick={() => onMore(day)}
          className="px-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
        >
          +{items.length - max} lagi
        </button>
      )}
    </div>
  );
}

function CalendarChip({ task, day, className }: { task: Task; day: string; className: string }) {
  const { openTask } = useTaskDialog();
  const {
    setNodeRef: setMoveNode,
    attributes: moveAttributes,
    listeners: moveListeners,
    isDragging,
  } = useDraggable({
    id: `move:${task.id}:${day}`,
    data: { task, mode: "move", from: day },
    attributes: { roleDescription: "tugas yang dapat dipindah" },
  });
  const {
    setNodeRef: setResizeNode,
    attributes: resizeAttributes,
    listeners: resizeListeners,
  } = useDraggable({
    id: `resize:${task.id}:${day}`,
    data: { task, mode: "resize", from: day },
    attributes: { roleDescription: "pegangan ubah tenggat" },
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
          aria-label={`Ubah tenggat ${task.title}`}
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
        <p className="py-6 text-center text-sm text-muted-foreground">
          Tidak ada tugas di hari ini.
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => newTask({ due_date: dateToIso(dayKey(day)) })}
      >
        <Plus /> Tambah tugas
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
              {format(m, "MMMM", { locale: localeId })}
            </h3>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {WEEKDAYS.map((d) => (
                <span key={d} className="text-[9px] text-muted-foreground">
                  {d[0]}
                </span>
              ))}
              {days.map((d) => {
                const n = byDay.get(dayKey(d))?.length ?? 0;
                const inMonth = isSameMonth(d, m);
                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => onPick(d)}
                    disabled={!inMonth}
                    className={cn(
                      "aspect-square rounded text-[10px] motion-safe:transition-colors",
                      !inMonth && "invisible",
                      isToday(d) && "ring-1 ring-primary",
                      n === 0
                        ? "hover:bg-accent"
                        : n < 3
                          ? "bg-primary/20 hover:bg-primary/30"
                          : "bg-primary/45 text-primary-foreground hover:bg-primary/60",
                    )}
                    title={n ? `${n} tugas` : undefined}
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
