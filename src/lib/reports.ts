// Pure helpers for /reports (focus, burndown, throughput). The database returns one row per
// calendar day (`report_daily`, migration 0026, days in the browser's time zone); everything
// here is calendar math on `YYYY-MM-DD` strings in UTC, so it never depends on the machine's
// zone or on DST.

import { currentLocale, tr } from "@/lib/preferences";

export type DailyRow = {
  day: string;
  created: number;
  completed: number;
  completed_minutes: number;
  open_tasks: number;
  open_minutes: number;
  focus_seconds: number;
  planned_minutes: number;
};

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export type BucketMode = "day" | "week";

const DAY_MS = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Calendar date `n` days after `iso`. */
export const addDays = (iso: string, n: number) => fmt(parse(iso) + n * DAY_MS);
/** Whole days from `a` to `b` (positive when `b` is later). */
export const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY_MS);
/** Monday of the ISO week containing `iso`. */
export function weekStart(iso: string) {
  const wd = (new Date(parse(iso)).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(iso, -wd);
}

/** Calendar date of `date` in `tz` (default: the browser's zone). */
export function localIsoDate(date: Date = new Date(), tz?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The last `days` calendar days ending today (inclusive). */
export function rangeFor(days: number, today: string) {
  return { from: addDays(today, -(days - 1)), to: today };
}

/** Daily columns for a week; weekly ones beyond, so a 90-day chart stays readable on a phone. */
export const bucketModeFor = (days: number): BucketMode => (days <= 30 ? "day" : "week");

export type Bucket = {
  /** First day of the bucket (the day itself, or the Monday of the week). */
  start: string;
  /** Number of days of the range inside the bucket (partial first/last weeks). */
  days: number;
  created: number;
  completed: number;
  completedMinutes: number;
  focusSeconds: number;
  plannedMinutes: number;
};

/** Sums daily rows into day or ISO-week buckets, in date order, without gaps. */
export function bucketize(rows: readonly DailyRow[], mode: BucketMode): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of [...rows].sort((a, b) => a.day.localeCompare(b.day))) {
    const start = mode === "day" ? r.day : weekStart(r.day);
    const b = map.get(start) ?? {
      start,
      days: 0,
      created: 0,
      completed: 0,
      completedMinutes: 0,
      focusSeconds: 0,
      plannedMinutes: 0,
    };
    b.days += 1;
    b.created += r.created;
    b.completed += r.completed;
    b.completedMinutes += r.completed_minutes;
    b.focusSeconds += r.focus_seconds;
    b.plannedMinutes += r.planned_minutes;
    map.set(start, b);
  }
  return [...map.values()];
}

export type Totals = {
  created: number;
  completed: number;
  completedMinutes: number;
  focusSeconds: number;
  plannedMinutes: number;
  /** Completed tasks per 7 days over the range. */
  perWeek: number;
};

export function totals(rows: readonly DailyRow[]): Totals {
  const sum = (k: keyof Omit<DailyRow, "day">) => rows.reduce((s, r) => s + r[k], 0);
  const completed = sum("completed");
  return {
    created: sum("created"),
    completed,
    completedMinutes: sum("completed_minutes"),
    focusSeconds: sum("focus_seconds"),
    plannedMinutes: sum("planned_minutes"),
    perWeek: rows.length ? Math.round((completed / rows.length) * 7 * 10) / 10 : 0,
  };
}

export type BurndownUnit = "tasks" | "minutes";
export type BurndownPoint = { day: string; remaining: number | null; ideal: number | null };

/**
 * Remaining work per day (open tasks or their estimated minutes at the end of each day) plus an
 * ideal line from the remaining work on the first day straight down to zero on `due`. When `due`
 * lies after the range, the x axis is extended to it (at most `maxAhead` days past `today`) so
 * the ideal line reaches zero; remaining work is only known up to today. Without a due date, or
 * with one before the first day, there is no ideal line.
 */
export function burndown(
  rows: readonly DailyRow[],
  opts: { unit: BurndownUnit; due?: string | null; today: string; maxAhead?: number },
): BurndownPoint[] {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const first = sorted[0];
  if (!first) return [];
  const value = (r: DailyRow) => (opts.unit === "tasks" ? r.open_tasks : r.open_minutes);
  const start = first.day;
  const last = sorted.at(-1)!.day;
  const due = opts.due && opts.due >= start ? opts.due : null;
  const limit = addDays(opts.today, opts.maxAhead ?? 90);
  const end = due && due > last ? (due < limit ? due : limit) : last;
  const byDay = new Map(sorted.map((r) => [r.day, value(r)]));
  const span = due ? daysBetween(start, due) : 0;
  const top = value(first);
  const points: BurndownPoint[] = [];
  for (let i = 0, day = start; day <= end; i++, day = addDays(start, i)) {
    const remaining = day <= opts.today ? (byDay.get(day) ?? null) : null;
    const ideal = due
      ? span === 0
        ? 0
        : Math.max(0, Math.round(top * (1 - Math.min(i, span) / span) * 10) / 10)
      : null;
    points.push({ day, remaining, ideal });
  }
  return points;
}

/** A clean axis maximum (1, 2, 5 × 10ⁿ) at or above `max`, with its evenly spaced ticks. */
export function niceScale(max: number, count = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { max: top, ticks };
}

/** "3 j 45 m" / "25 m" ("3 h 45 m" in English; also used by the focus breakdown). */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  const mu = tr("admMinuteUnit");
  return h ? `${h} ${tr("admHourUnit")} ${m} ${mu}` : `${m} ${mu}`;
}

/** "1,5 j" style compact hours for axis ticks and tiles ("1.5 h" in English). */
export function formatHours(min: number): string {
  const h = min / 60;
  const n = `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10}`;
  return `${currentLocale() === "en" ? n : n.replace(".", ",")} ${tr("admHourUnit")}`;
}
