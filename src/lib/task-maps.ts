/**
 * Lookup maps for task lists, built once per data change by the list parent instead of
 * scanning all tasks/deps inside every row (O(n) instead of O(n²)). Pure, no React.
 */
import { addDays, differenceInCalendarDays, format, startOfDay } from "date-fns";

type TaskLike = {
  id: string;
  parent_id: string | null;
  status: string;
  start_date: string | null;
  due_date: string | null;
};
type DepLike = { blocker_id: string; blocked_id: string };

export function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** parent id → its subtasks, in list order. */
export function subtasksByParent<T extends TaskLike>(tasks: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of tasks) {
    if (!t.parent_id) continue;
    const list = m.get(t.parent_id);
    if (list) list.push(t);
    else m.set(t.parent_id, [t]);
  }
  return m;
}

/**
 * blocked task id → its blockers that are not done yet (same rule as `openBlockers` in
 * src/lib/data.ts). Done tasks are never reported as blocked; missing blockers are ignored.
 */
export function openBlockersByTask<T extends TaskLike>(
  deps: readonly DepLike[],
  tasks: readonly T[] | Map<string, T>,
): Map<string, T[]> {
  const index = tasks instanceof Map ? tasks : byId(tasks);
  const m = new Map<string, T[]>();
  for (const d of deps) {
    const blocked = index.get(d.blocked_id);
    const blocker = index.get(d.blocker_id);
    if (!blocked || blocked.status === "done" || !blocker || blocker.status === "done") continue;
    const list = m.get(d.blocked_id);
    if (list) list.push(blocker);
    else m.set(d.blocked_id, [blocker]);
  }
  return m;
}

export const dayKeyOf = (d: Date) => format(d, "yyyy-MM-dd");

/** Inclusive day span of a task (start..due, either may be missing), or null if undated. */
function span(t: Pick<TaskLike, "start_date" | "due_date">) {
  const s = t.start_date ?? t.due_date;
  const e = t.due_date ?? t.start_date;
  if (!s || !e) return null;
  const a = startOfDay(new Date(s));
  const b = startOfDay(new Date(e));
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/**
 * yyyy-MM-dd → tasks touching that day (each task on every day of its range, capped at a year).
 * Pushes in place instead of copying the day's array per task.
 */
export function tasksByDay<T extends TaskLike>(tasks: readonly T[], maxDays = 366) {
  const m = new Map<string, T[]>();
  for (const t of tasks) {
    const r = span(t);
    if (!r) continue;
    const days = Math.min(differenceInCalendarDays(r.end, r.start), maxDays);
    for (let i = 0; i <= days; i++) {
      const k = dayKeyOf(addDays(r.start, i));
      const list = m.get(k);
      if (list) list.push(t);
      else m.set(k, [t]);
    }
  }
  return m;
}

/** Buckets for the Upcoming view, one pass over the tasks. Keys of `days` are yyyy-MM-dd. */
export function upcomingBuckets<T extends TaskLike>(
  tasks: readonly T[],
  today: Date,
  dayCount = 14,
) {
  const start = startOfDay(today);
  const end = addDays(start, dayCount);
  const overdue: T[] = [];
  const later: T[] = [];
  const noDate: T[] = [];
  const days = new Map<string, T[]>();
  for (const t of tasks) {
    if (!t.due_date) {
      noDate.push(t);
      continue;
    }
    const due = new Date(t.due_date);
    if (due < start) overdue.push(t);
    else if (due >= end) later.push(t);
    else {
      const k = dayKeyOf(due);
      const list = days.get(k);
      if (list) list.push(t);
      else days.set(k, [t]);
    }
  }
  return { overdue, days, later, noDate };
}
