import { addDays, format, startOfDay } from "date-fns";

import type { Task } from "@/features/tasks/types";

export const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
/** Date-only string (yyyy-MM-dd) → ISO timestamp at 17:00 local time. */
export const dateToIso = (s: string, hour = 17) =>
  s ? new Date(`${s}T${String(hour).padStart(2, "0")}:00:00`).toISOString() : null;
export const isoToDate = (iso: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd") : "");

export function taskRange(t: Pick<Task, "start_date" | "due_date">) {
  const s = t.start_date ?? t.due_date;
  const e = t.due_date ?? t.start_date;
  if (!s || !e) return null;
  const start = startOfDay(new Date(s));
  const end = startOfDay(new Date(e));
  return start <= end ? { start, end } : { start: end, end: start };
}

export function shiftIso(iso: string | null, days: number) {
  return iso ? addDays(new Date(iso), days).toISOString() : null;
}
