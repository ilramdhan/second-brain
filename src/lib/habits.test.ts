import { describe, expect, it } from "vitest";

import {
  ALL_DAYS,
  completion,
  describeSchedule,
  isScheduled,
  isoWeekday,
  streaks,
  weekDays,
  weeklyCompletion,
  WORKDAYS,
  type HabitLike,
  type LogLike,
} from "@/lib/habits";
import { addDays } from "@/lib/reports";

const TODAY = "2026-10-07"; // Wednesday
const habit = (p: Partial<HabitLike> = {}): HabitLike => ({
  id: "h",
  created_at: "2026-09-01T00:00:00Z",
  schedule_type: "daily",
  weekdays_mask: ALL_DAYS,
  times_per_week: 3,
  target: 1,
  ...p,
});
const logs = (dates: string[], count = 1, habit_id = "h"): LogLike[] =>
  dates.map((date) => ({ habit_id, date, count }));
const back = (n: number) => addDays(TODAY, -n);

describe("schedules", () => {
  it("knows ISO weekdays and masks", () => {
    expect(isoWeekday("2026-10-05")).toBe(0); // Monday
    expect(isoWeekday("2026-10-11")).toBe(6); // Sunday
    const mwf = habit({ schedule_type: "weekdays", weekdays_mask: 0b0010101 });
    expect(isScheduled(mwf, "2026-10-05")).toBe(true);
    expect(isScheduled(mwf, "2026-10-06")).toBe(false);
    expect(isScheduled(habit({ schedule_type: "weekly" }), "2026-10-06")).toBe(true);
  });

  it("describes schedules", () => {
    expect(describeSchedule(habit())).toBe("Setiap hari");
    expect(describeSchedule(habit({ schedule_type: "weekdays", weekdays_mask: WORKDAYS }))).toBe(
      "Hari kerja",
    );
    expect(describeSchedule(habit({ schedule_type: "weekdays", weekdays_mask: 0b0010101 }))).toBe(
      "Sen, Rab, Jum",
    );
    expect(describeSchedule(habit({ schedule_type: "weekly", times_per_week: 3, target: 2 }))).toBe(
      "3× per minggu · 2× per hari",
    );
  });
});

describe("streaks: daily", () => {
  it("counts back from today and keeps the streak while today is not over", () => {
    const l = logs([back(1), back(2), back(3), back(5), back(6)]);
    expect(streaks(habit(), l, TODAY, "2026-09-01")).toEqual({
      current: 3,
      longest: 3,
      unit: "day",
    });
    expect(streaks(habit(), [...l, ...logs([TODAY])], TODAY, "2026-09-01").current).toBe(4);
  });

  it("breaks after a missed day", () => {
    expect(streaks(habit(), logs([back(2), back(3)]), TODAY, "2026-09-01").current).toBe(0);
  });

  it("only counts days that reach the target", () => {
    const h = habit({ target: 2 });
    const l = [...logs([back(1)], 2), ...logs([back(2)], 1)];
    expect(streaks(h, l, TODAY, "2026-09-01")).toMatchObject({ current: 1, longest: 1 });
  });

  it("skips unscheduled days for weekday habits", () => {
    // Mon/Wed/Fri: Wed 7 Oct (today, open), Mon 5, Fri 2, Wed 30 Sep done; Tue/Thu ignored.
    const h = habit({ schedule_type: "weekdays", weekdays_mask: 0b0010101 });
    const l = logs(["2026-10-05", "2026-10-02", "2026-09-30"]);
    expect(streaks(h, l, TODAY, "2026-09-01")).toMatchObject({ current: 3, longest: 3 });
  });

  it("ignores logs of other habits and finds the longest run", () => {
    const l = [
      ...logs([back(20), back(19), back(18), back(17), back(10)]),
      ...logs([back(1), back(2)], 1, "other"),
    ];
    expect(streaks(habit(), l, TODAY, "2026-09-01")).toMatchObject({ current: 0, longest: 4 });
  });
});

describe("streaks: N times per week", () => {
  const h = habit({ schedule_type: "weekly", times_per_week: 2 });
  it("counts whole weeks and keeps the running week open", () => {
    // Weeks starting 21 Sep, 28 Sep: 2 each; this week (5 Oct): 1 so far.
    const l = logs(["2026-09-22", "2026-09-24", "2026-09-28", "2026-10-01", "2026-10-06"]);
    expect(streaks(h, l, TODAY, "2026-09-01")).toEqual({ current: 2, longest: 2, unit: "week" });
    const more = [...l, ...logs([TODAY])];
    expect(streaks(h, more, TODAY, "2026-09-01")).toMatchObject({ current: 3, longest: 3 });
  });

  it("breaks on a short past week", () => {
    const l = logs(["2026-09-22", "2026-09-24", "2026-09-29"]);
    expect(streaks(h, l, TODAY, "2026-09-01")).toMatchObject({ current: 0, longest: 1 });
  });
});

describe("completion", () => {
  it("daily: done ÷ scheduled, today only once done", () => {
    const l = logs([back(1), back(3)]);
    expect(completion(habit(), l, { from: back(6), to: TODAY }, TODAY, "2026-09-01")).toEqual({
      done: 2,
      due: 6,
      rate: 2 / 6,
    });
    const withToday = [...l, ...logs([TODAY])];
    expect(
      completion(habit(), withToday, { from: back(6), to: TODAY }, TODAY, "2026-09-01").due,
    ).toBe(7);
  });

  it("starts at the habit's first day and is null before it", () => {
    const r = completion(habit(), logs([TODAY]), { from: back(30), to: TODAY }, TODAY, back(1));
    expect(r).toEqual({ done: 1, due: 2, rate: 0.5 });
    expect(
      completion(habit(), [], { from: back(30), to: back(10) }, TODAY, back(1)).rate,
    ).toBeNull();
  });

  it("weekly: caps each week at the goal, the running week counts what is done", () => {
    const h = habit({ schedule_type: "weekly", times_per_week: 2 });
    // Week of 28 Sep: 3 done (capped at 2); this week: 1 done so far.
    const l = logs(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-05"]);
    const r = completion(h, l, { from: "2026-09-28", to: TODAY }, TODAY, "2026-09-01");
    expect(r).toEqual({ done: 3, due: 3, rate: 1 });
  });

  it("aggregates all habits per week", () => {
    const habits = [habit(), habit({ id: "b" })];
    const l = [...logs([back(1), back(2)]), ...logs([back(1)], 1, "b")];
    const weeks = weeklyCompletion(habits, l, TODAY, 2, () => "2026-09-01");
    expect(weeks.map((w) => w.week)).toEqual(["2026-09-28", "2026-10-05"]);
    // This week: Mon + Tue for two habits = 4 due; 3 done.
    expect(weeks[1]).toMatchObject({ done: 3, due: 4 });
    expect(weeks[0]).toMatchObject({ done: 0, due: 14, rate: 0 });
  });
});

describe("weekDays", () => {
  it("returns Monday..Sunday of this or another week", () => {
    expect(weekDays(TODAY)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(weekDays(TODAY, -1)[0]).toBe("2026-09-28");
  });
});
