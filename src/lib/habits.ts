// Pure habit math for /habits: schedules, streaks and completion rates (migration 0025).
// Days are `YYYY-MM-DD` calendar dates in the user's zone (the client writes `habit_logs.date`
// with `localIsoDate()`), and all math is UTC calendar math on those strings.
import { addDays, daysBetween, weekStart } from "@/lib/reports";

export type ScheduleType = "daily" | "weekdays" | "weekly";

export type HabitSchedule = {
  schedule_type: string;
  /** ISO weekdays, bit 0 = Monday ... bit 6 = Sunday. */
  weekdays_mask: number;
  times_per_week: number;
  target: number;
};
export type HabitLike = HabitSchedule & { id: string; created_at: string };
export type LogLike = { habit_id: string; date: string; count: number };

export const ALL_DAYS = 0b1111111;
export const WORKDAYS = 0b0011111;
/** Monday-first short weekday labels (Indonesian). */
export const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;

/** ISO weekday index of a date, 0 = Monday ... 6 = Sunday. */
export const isoWeekday = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

export const scheduleType = (h: HabitSchedule): ScheduleType =>
  h.schedule_type === "weekdays" || h.schedule_type === "weekly" ? h.schedule_type : "daily";

/** Whether the habit is due on a given day (weekly habits may be done on any day). */
export function isScheduled(h: HabitSchedule, iso: string) {
  return scheduleType(h) !== "weekdays" || (h.weekdays_mask & (1 << isoWeekday(iso))) !== 0;
}

/** Done days of one habit: date → count, only days that reach the target. */
export function doneDays(h: HabitSchedule & { id: string }, logs: readonly LogLike[]) {
  const set = new Set<string>();
  for (const l of logs)
    if (l.habit_id === h.id && l.count >= Math.max(1, h.target)) set.add(l.date);
  return set;
}

/** Human summary of a schedule, e.g. "Setiap hari", "Sen, Rab, Jum", "3× per minggu". */
export function describeSchedule(h: HabitSchedule) {
  const type = scheduleType(h);
  const target = h.target > 1 ? ` · ${h.target}× per hari` : "";
  if (type === "weekly") return `${h.times_per_week}× per minggu${target}`;
  if (type === "daily" || h.weekdays_mask === ALL_DAYS) return `Setiap hari${target}`;
  if (h.weekdays_mask === WORKDAYS) return `Hari kerja${target}`;
  const days = WEEKDAY_LABELS.filter((_, i) => h.weekdays_mask & (1 << i)).join(", ");
  return `${days}${target}`;
}

export type Streak = { current: number; longest: number; unit: "day" | "week" };

/**
 * Current and longest streak up to `today`.
 *   daily / weekdays: consecutive scheduled days that were done; unscheduled days are skipped,
 *     and today does not break the streak until it is over (an unchecked today is "not yet").
 *   weekly: consecutive ISO weeks with at least `times_per_week` done days; the running week
 *     only counts once it reaches the goal and never breaks the streak while it is running.
 * Days before `since` (the habit's first local day) are ignored.
 */
export function streaks(
  h: HabitSchedule & { id: string },
  logs: readonly LogLike[],
  today: string,
  since: string,
): Streak {
  const done = doneDays(h, logs);
  const first = [since, ...done].sort()[0]!;
  if (scheduleType(h) === "weekly") {
    const goal = Math.max(1, h.times_per_week);
    const perWeek = new Map<string, number>();
    for (const d of done)
      if (d <= today) perWeek.set(weekStart(d), (perWeek.get(weekStart(d)) ?? 0) + 1);
    const thisWeek = weekStart(today);
    let longest = 0;
    let run = 0;
    for (let w = weekStart(first); w <= thisWeek; w = addDays(w, 7)) {
      if ((perWeek.get(w) ?? 0) >= goal) longest = Math.max(longest, ++run);
      else if (w !== thisWeek) run = 0;
    }
    let current = 0;
    let w = (perWeek.get(thisWeek) ?? 0) >= goal ? thisWeek : addDays(thisWeek, -7);
    while ((perWeek.get(w) ?? 0) >= goal) {
      current++;
      w = addDays(w, -7);
    }
    return { current, longest, unit: "week" };
  }

  let longest = 0;
  let run = 0;
  for (let d = first; d <= today; d = addDays(d, 1)) {
    if (!isScheduled(h, d)) continue;
    if (done.has(d)) longest = Math.max(longest, ++run);
    else if (d !== today) run = 0;
  }
  let current = 0;
  for (let d = today; d >= first; d = addDays(d, -1)) {
    if (!isScheduled(h, d)) continue;
    if (done.has(d)) current++;
    else if (d !== today) break;
  }
  return { current, longest, unit: "day" };
}

export type Rate = { done: number; due: number; rate: number | null };

/**
 * Completion over [from, to] (inclusive, clipped to `since` and `today`).
 *   daily / weekdays: done scheduled days ÷ scheduled days; today counts only once it is done.
 *   weekly: per ISO week min(done days, goal) ÷ goal, the goal scaled by the share of the week
 *     inside the range (rounded up); the running week counts only what is already done.
 */
export function completion(
  h: HabitSchedule & { id: string },
  logs: readonly LogLike[],
  range: { from: string; to: string },
  today: string,
  since: string,
): Rate {
  const from = range.from > since ? range.from : since;
  const to = range.to < today ? range.to : today;
  if (to < from) return { done: 0, due: 0, rate: null };
  const done = doneDays(h, logs);
  let hit = 0;
  let due = 0;
  if (scheduleType(h) === "weekly") {
    const goal = Math.max(1, h.times_per_week);
    for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
      const lo = w < from ? from : w;
      const hi = addDays(w, 6) > to ? to : addDays(w, 6);
      let n = 0;
      for (let d = lo; d <= hi; d = addDays(d, 1)) if (done.has(d)) n++;
      const share = (daysBetween(lo, hi) + 1) / 7;
      const scaled = Math.max(1, Math.ceil(goal * share));
      const running = hi === today && addDays(w, 6) > today;
      const g = running ? Math.min(scaled, n) : scaled;
      hit += Math.min(n, g);
      due += g;
    }
  } else {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!isScheduled(h, d)) continue;
      if (done.has(d)) {
        hit++;
        due++;
      } else if (d !== today) due++;
    }
  }
  return { done: hit, due, rate: due ? hit / due : null };
}

/** Completion of all habits together per ISO week (last `weeks` weeks ending this week). */
export function weeklyCompletion(
  habits: readonly HabitLike[],
  logs: readonly LogLike[],
  today: string,
  weeks: number,
  sinceOf: (h: HabitLike) => string,
): { week: string; done: number; due: number; rate: number | null }[] {
  const thisWeek = weekStart(today);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const week = addDays(thisWeek, -7 * i);
    let done = 0;
    let due = 0;
    for (const h of habits) {
      const r = completion(h, logs, { from: week, to: addDays(week, 6) }, today, sinceOf(h));
      done += r.done;
      due += r.due;
    }
    out.push({ week, done, due, rate: due ? done / due : null });
  }
  return out;
}

/** The 7 days (Monday first) of the week containing `today`, shifted by `offset` weeks. */
export function weekDays(today: string, offset = 0) {
  const start = addDays(weekStart(today), offset * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
