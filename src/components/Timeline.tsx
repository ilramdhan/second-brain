import { useId, useMemo, useRef, useState } from "react";
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  isToday,
  isWeekend,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, Diamond, Rocket } from "lucide-react";

import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { Button } from "@/components/ui/button";
import { NAV_ITEM_CLASS, navAttrs, useKeyboardNav, type NavState } from "@/hooks/use-keyboard-nav";
import { color } from "@/lib/constants";
import {
  shiftIso,
  taskRange,
  useTaskActions,
  type Milestone,
  type Project,
  type Task,
} from "@/lib/data";
import { timelineKeyAction } from "@/lib/dnd-a11y";
import { currentDateLocale, tr, useI18n } from "@/lib/preferences";
import { cn } from "@/lib/utils";

const W = 36;
const DAYS = 42;

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; delta: number };

export function Timeline({
  tasks,
  projects,
  milestones,
  groupByProject = true,
}: {
  tasks: Task[];
  projects: Project[];
  milestones: Milestone[];
  groupByProject?: boolean | undefined;
}) {
  const [from, setFrom] = useState(() => startOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 }));
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const { update } = useTaskActions();
  const { openTask } = useTaskDialog();
  const hintId = useId();
  const { t: tl, dateFns } = useI18n();
  const [status, setStatus] = useState("");
  const days = eachDayOfInterval({ start: from, end: addDays(from, DAYS - 1) });

  const dated = tasks.filter((t) => taskRange(t));
  const undated = tasks.filter((t) => !taskRange(t) && t.status !== "done");

  const groups = useMemo(() => {
    if (!groupByProject)
      return [{ key: "all", project: undefined as Project | undefined, tasks: dated }];
    const g = new Map<string, Task[]>();
    dated.forEach((t) =>
      g.set(t.project_id ?? "none", [...(g.get(t.project_id ?? "none") ?? []), t]),
    );
    return [...g.entries()].map(([key, ts]) => ({
      key,
      project: projects.find((p) => p.id === key),
      tasks: ts,
    }));
  }, [dated, projects, groupByProject]);

  // j/k (↑/↓ while focused) move between task rows, Enter/o open the task. The row label is the
  // navigable item; the bar keeps its own arrow keys (move/resize by day) and is not resized here.
  const navColumns = useMemo(() => [groups.flatMap((g) => g.tasks.map((t) => t.id))], [groups]);
  const { containerProps, nav } = useKeyboardNav({
    columns: navColumns,
    kind: "task",
    onOpen: openTask,
  });

  function begin(e: React.PointerEvent, t: Task, mode: Drag["mode"]) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const d = { id: t.id, mode, x0: e.clientX, delta: 0 };
    dragRef.current = d;
    setDrag(d);
  }
  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.x0) / W);
    if (delta !== d.delta) {
      dragRef.current = { ...d, delta };
      setDrag(dragRef.current);
    }
  }
  function end(t: Task) {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.delta === 0) {
      if (d.mode === "move") openTask(t.id);
      return;
    }
    apply(t, d.mode, d.delta);
  }

  /** Shifts the bar (`move`) or one of its edges by `delta` days; returns false if rejected. */
  function apply(t: Task, mode: Drag["mode"], delta: number): boolean {
    const r = taskRange(t)!;
    const startIso = t.start_date ?? t.due_date;
    const dueIso = t.due_date ?? t.start_date;
    const span = differenceInCalendarDays(r.end, r.start);
    if (mode === "move") {
      update(t.id, {
        start_date: shiftIso(startIso, delta),
        due_date: shiftIso(dueIso, delta),
        reminded: false,
      });
      return true;
    }
    if (mode === "end" && span + delta >= 0) {
      update(t.id, { start_date: startIso, due_date: shiftIso(dueIso, delta), reminded: false });
      return true;
    }
    if (mode === "start" && span - delta >= 0) {
      update(t.id, { start_date: shiftIso(startIso, delta), due_date: dueIso });
      return true;
    }
    return false;
  }

  /** ←/→ move the bar a day, Shift+←/→ change the due date, Enter/Space open the editor. */
  function onBarKey(e: React.KeyboardEvent, t: Task) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openTask(t.id);
      return;
    }
    const a = timelineKeyAction(e);
    if (!a) return;
    e.preventDefault();
    const r = taskRange(t)!;
    if (!apply(t, a.mode, a.delta)) {
      setStatus(tl("taskTlDueBeforeStart"));
      return;
    }
    const start = a.mode === "move" ? addDays(r.start, a.delta) : r.start;
    const end = addDays(r.end, a.delta);
    setStatus(`${t.title}: ${rangeLabel(start, end)}.`);
  }

  function barGeom(t: Task) {
    const r = taskRange(t)!;
    let s = differenceInCalendarDays(r.start, from);
    let e = differenceInCalendarDays(r.end, from);
    if (drag?.id === t.id) {
      if (drag.mode !== "end") s += drag.delta;
      if (drag.mode !== "start") e += drag.delta;
    }
    return { left: s * W, width: Math.max(1, e - s + 1) * W, visible: e >= 0 && s < DAYS };
  }

  const todayOffset = differenceInCalendarDays(startOfDay(new Date()), from);
  const msInRange = milestones.filter((m) => m.due_date);
  const launches = projects.filter((p) => p.launch_date);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setFrom((f) => addDays(f, -14))}
          aria-label={tl("taskTlBack")}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setFrom(startOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 }))}
        >
          {tl("taskGroupToday")}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setFrom((f) => addDays(f, 14))}
          aria-label={tl("taskTlForward")}
        >
          <ChevronRight />
        </Button>
        <span className="ml-2 text-sm font-medium capitalize">
          {format(from, "d MMM", { locale: dateFns })} –{" "}
          {format(addDays(from, DAYS - 1), "d MMM yyyy", { locale: dateFns })}
        </span>
      </div>

      <div
        {...containerProps}
        role="group"
        aria-label={tl("kbTimelineLabel")}
        className="scrollbar-subtle overflow-x-auto rounded-2xl border bg-card"
      >
        <div className="relative" style={{ width: DAYS * W + 180 }}>
          {/* header */}
          <div className="sticky top-0 z-10 flex border-b bg-card">
            <div className="sticky left-0 z-20 w-[180px] shrink-0 border-r bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
              {tl("taskTlTasks")}
            </div>
            {days.map((d) => (
              <div
                key={d.toISOString()}
                className={cn(
                  "flex shrink-0 flex-col items-center py-1 text-[10px]",
                  isWeekend(d) && "bg-secondary/50",
                  isToday(d) && "text-primary font-semibold",
                )}
                style={{ width: W }}
              >
                <span className="text-muted-foreground">
                  {format(d, "EEEEE", { locale: dateFns })}
                </span>
                <span>{format(d, "d")}</span>
              </div>
            ))}
          </div>

          {/* milestones/launch row */}
          {(msInRange.length > 0 || launches.length > 0) && (
            <Row label={tl("taskTlMilestones")}>
              {msInRange.map((m) => {
                const off = differenceInCalendarDays(new Date(`${m.due_date}T00:00:00`), from);
                if (off < 0 || off >= DAYS) return null;
                return (
                  <span
                    key={m.id}
                    title={m.title}
                    className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap text-[10px]"
                    style={{ left: off * W + 10 }}
                  >
                    <Diamond
                      className={cn(
                        "h-3.5 w-3.5",
                        m.done ? "fill-success text-success" : "fill-warning text-warning",
                      )}
                    />
                    {m.title}
                  </span>
                );
              })}
              {launches.map((p) => {
                const off = differenceInCalendarDays(new Date(`${p.launch_date}T00:00:00`), from);
                if (off < 0 || off >= DAYS) return null;
                return (
                  <span
                    key={p.id}
                    className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap text-[10px] font-medium"
                    style={{ left: off * W + 10 }}
                  >
                    <Rocket className="h-3.5 w-3.5 text-primary" /> {p.name}
                  </span>
                );
              })}
            </Row>
          )}

          {groups.map((g) => (
            <div key={g.key}>
              {groupByProject && (
                <div
                  className="sticky left-0 flex items-center gap-2 border-b bg-secondary/40 px-3 py-1.5 text-xs font-semibold"
                  style={{ width: 180 }}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      g.project ? color(g.project.color).dot : "bg-muted-foreground",
                    )}
                  />
                  <span className="truncate">{g.project?.name ?? "Tanpa proyek"}</span>
                </div>
              )}
              {g.tasks.map((t) => {
                const geo = barGeom(t);
                const tone = g.project
                  ? color(g.project.color).bar
                  : color(projects.find((p) => p.id === t.project_id)?.color).bar;
                return (
                  <Row
                    key={t.id}
                    label={t.title}
                    onLabel={() => openTask(t.id)}
                    done={t.status === "done"}
                    navId={t.id}
                    nav={nav}
                  >
                    {geo.visible && (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`${t.title}, ${rangeLabel(taskRange(t)!.start, taskRange(t)!.end)}`}
                        aria-describedby={hintId}
                        onKeyDown={(e) => onBarKey(e, t)}
                        onPointerDown={(e) => begin(e, t, "move")}
                        onPointerMove={moveDrag}
                        onPointerUp={() => end(t)}
                        className={cn(
                          "group absolute top-1.5 bottom-1.5 flex cursor-grab touch-none select-none items-center rounded-md px-2 text-[11px] font-medium text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                          tone,
                          t.status === "done" && "opacity-50",
                          drag?.id === t.id && "cursor-grabbing ring-2 ring-ring",
                        )}
                        style={{ left: geo.left + 2, width: geo.width - 4 }}
                      >
                        <span className="truncate">{t.title}</span>
                        <span
                          onPointerDown={(e) => begin(e, t, "start")}
                          onPointerMove={moveDrag}
                          onPointerUp={() => end(t)}
                          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md hover:bg-foreground/20"
                        />
                        <span
                          onPointerDown={(e) => begin(e, t, "end")}
                          onPointerMove={moveDrag}
                          onPointerUp={() => end(t)}
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md hover:bg-foreground/20"
                        />
                      </div>
                    )}
                  </Row>
                );
              })}
            </div>
          ))}

          {todayOffset >= 0 && todayOffset < DAYS && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-primary/60"
              style={{ left: 180 + todayOffset * W + W / 2 }}
            />
          )}
          {dated.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Belum ada tugas bertanggal. Beri tanggal mulai/tenggat agar muncul di sini.
            </p>
          )}
        </div>
      </div>

      <p id={hintId} className="text-xs text-muted-foreground">
        Panah kiri atau kanan memindahkan tugas satu hari. Shift dengan panah kiri atau kanan
        mengubah tenggat. Enter membuka tugas.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {undated.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {undated.length} tugas belum punya tanggal sehingga tidak tampil di timeline.
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  children,
  onLabel,
  done,
  navId,
  nav,
}: {
  label: string;
  children: React.ReactNode;
  onLabel?: (() => void) | undefined;
  done?: boolean | undefined;
  navId?: string | undefined;
  nav?: NavState | undefined;
}) {
  return (
    <div className="flex border-b last:border-b-0">
      <button
        onClick={onLabel}
        {...(navId && nav
          ? navAttrs(navId, nav.selectedId === navId, nav.tabStopId === navId)
          : {})}
        className={cn(
          "sticky left-0 z-[5] w-[180px] shrink-0 truncate border-r bg-card px-3 py-2 text-left text-xs hover:text-primary",
          navId && nav && NAV_ITEM_CLASS,
          done && "text-muted-foreground line-through",
        )}
      >
        {label}
      </button>
      <div className="relative h-9 flex-1">{children}</div>
    </div>
  );
}

const rangeLabel = (start: Date, end: Date) => {
  const locale = currentDateLocale();
  return start.getTime() === end.getTime()
    ? format(start, "d MMMM yyyy", { locale })
    : tr("taskTlRange", {
        start: format(start, "d MMMM", { locale }),
        end: format(end, "d MMMM yyyy", { locale }),
      });
};
