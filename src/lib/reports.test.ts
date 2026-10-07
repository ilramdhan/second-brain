import { describe, expect, it } from "vitest";

import {
  addDays,
  bucketize,
  bucketModeFor,
  burndown,
  daysBetween,
  formatHours,
  formatMinutes,
  localIsoDate,
  niceScale,
  rangeFor,
  totals,
  weekStart,
  type DailyRow,
} from "@/lib/reports";

const row = (day: string, p: Partial<DailyRow> = {}): DailyRow => ({
  day,
  created: 0,
  completed: 0,
  completed_minutes: 0,
  open_tasks: 0,
  open_minutes: 0,
  focus_seconds: 0,
  planned_minutes: 0,
  ...p,
});

describe("calendar math", () => {
  it("adds days across month, year and DST-free boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    // Europe's DST switch (25 Oct 2026) changes nothing: dates are UTC calendar math.
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
  });

  it("finds the ISO week's Monday", () => {
    expect(weekStart("2026-10-07")).toBe("2026-10-05"); // Wednesday
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday belongs to the week before
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });

  it("uses the requested time zone for 'today'", () => {
    const instant = new Date("2026-10-06T18:30:00Z"); // 01:30 on 7 Oct in Jakarta
    expect(localIsoDate(instant, "Asia/Jakarta")).toBe("2026-10-07");
    expect(localIsoDate(instant, "America/New_York")).toBe("2026-10-06");
    expect(localIsoDate(instant, "UTC")).toBe("2026-10-06");
  });

  it("builds inclusive ranges ending today", () => {
    expect(rangeFor(7, "2026-10-07")).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(rangeFor(30, "2026-10-07").from).toBe("2026-09-08");
    expect(bucketModeFor(7)).toBe("day");
    expect(bucketModeFor(30)).toBe("day");
    expect(bucketModeFor(90)).toBe("week");
  });
});

describe("bucketize / totals (throughput, focus)", () => {
  const rows = [
    row("2026-10-04", { completed: 1, created: 2, focus_seconds: 600 }), // Sunday
    row("2026-10-05", { completed: 2, completed_minutes: 60 }), // Monday
    row("2026-10-07", { created: 3, planned_minutes: 90 }),
    row("2026-10-06", { completed: 1, focus_seconds: 1200 }),
  ];

  it("sums per day in date order", () => {
    const b = bucketize(rows, "day");
    expect(b.map((x) => x.start)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(b[1]).toMatchObject({ completed: 2, completedMinutes: 60, days: 1 });
  });

  it("sums per ISO week with the partial-week day count", () => {
    const b = bucketize(rows, "week");
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ start: "2026-09-28", days: 1, completed: 1, created: 2 });
    expect(b[1]).toMatchObject({
      start: "2026-10-05",
      days: 3,
      completed: 3,
      created: 3,
      focusSeconds: 1200,
      plannedMinutes: 90,
    });
  });

  it("totals and the weekly throughput rate", () => {
    const t = totals(rows);
    expect(t).toMatchObject({ created: 5, completed: 4, focusSeconds: 1800, plannedMinutes: 90 });
    expect(t.perWeek).toBe(7); // 4 done in 4 days
    expect(totals([]).perWeek).toBe(0);
  });
});

describe("burndown", () => {
  const rows = [
    row("2026-10-01", { open_tasks: 10, open_minutes: 300 }),
    row("2026-10-02", { open_tasks: 8, open_minutes: 240 }),
    row("2026-10-03", { open_tasks: 9, open_minutes: 250 }),
  ];

  it("draws remaining work and an ideal line down to zero on the due date", () => {
    const pts = burndown(rows, { unit: "tasks", due: "2026-10-06", today: "2026-10-03" });
    expect(pts.map((p) => p.day)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
    ]);
    expect(pts.map((p) => p.remaining)).toEqual([10, 8, 9, null, null, null]);
    expect(pts[0]!.ideal).toBe(10);
    expect(pts.at(-1)!.ideal).toBe(0);
    expect(pts[2]!.ideal).toBe(6); // 10 × (1 − 2/5)
  });

  it("uses estimated minutes when asked", () => {
    const pts = burndown(rows, { unit: "minutes", due: "2026-10-03", today: "2026-10-03" });
    expect(pts.map((p) => p.remaining)).toEqual([300, 240, 250]);
    expect(pts.map((p) => p.ideal)).toEqual([300, 150, 0]);
  });

  it("has no ideal line without a due date or with one before the range", () => {
    for (const due of [null, "2026-09-01"]) {
      const pts = burndown(rows, { unit: "tasks", due, today: "2026-10-03" });
      expect(pts).toHaveLength(3);
      expect(pts.every((p) => p.ideal === null)).toBe(true);
    }
  });

  it("caps how far a distant due date stretches the axis", () => {
    const pts = burndown(rows, {
      unit: "tasks",
      due: "2027-06-01",
      today: "2026-10-03",
      maxAhead: 10,
    });
    expect(pts.at(-1)!.day).toBe("2026-10-13");
    expect(pts.at(-1)!.ideal).toBeGreaterThan(0);
  });

  it("is empty without rows", () => {
    expect(burndown([], { unit: "tasks", today: "2026-10-03" })).toEqual([]);
  });
});

describe("niceScale and formatting", () => {
  it("rounds axis maxima to 1/2/5 steps", () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceScale(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceScale(37).max).toBe(40);
    expect(niceScale(0.3).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("formats durations", () => {
    expect(formatMinutes(25)).toBe("25 m");
    expect(formatMinutes(225)).toBe("3 j 45 m");
    expect(formatHours(90)).toBe("1,5 j");
    expect(formatHours(720)).toBe("12 j");
  });
});
