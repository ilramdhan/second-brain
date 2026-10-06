import { describe, expect, it } from "vitest";

import {
  CronError,
  cronToPreset,
  describeCron,
  isValidCron,
  localDate,
  nextRun,
  nextRuns,
  parseCron,
  presetToCron,
  zonedTime,
} from "./cron";

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("parseCron", () => {
  it("parses lists, ranges, steps and names", () => {
    const s = parseCron("*/15 9-17/4 1,15 JAN-mar mon-FRI");
    expect(s.minute.values).toEqual([0, 15, 30, 45]);
    expect(s.hour.values).toEqual([9, 13, 17]);
    expect(s.dom.values).toEqual([1, 15]);
    expect(s.month.values).toEqual([1, 2, 3]);
    expect(s.dow.values).toEqual([1, 2, 3, 4, 5]);
    expect(s.minute.any).toBe(false);
  });

  it("treats 7 as Sunday, a/n as a..max and expands macros", () => {
    expect(parseCron("0 0 * * 7").dow.values).toEqual([0]);
    expect(parseCron("5/20 * * * *").minute.values).toEqual([5, 25, 45]);
    expect(parseCron("@daily").expr).toBe("0 0 * * *");
    expect(parseCron("  0   8 *  * 1 ").expr).toBe("0 8 * * 1");
  });

  it.each([
    "",
    "* * * *",
    "* * * * * *",
    "60 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "* * * 13 *",
    "* * * * 8",
    "5-1 * * * *",
    "*/0 * * * *",
    "a * * * *",
    "1,,2 * * * *",
    "1-2-3 * * * *",
    "1/2/3 * * * *",
    "x".repeat(121),
  ])("rejects %j", (expr) => {
    expect(() => parseCron(expr)).toThrow(CronError);
    expect(isValidCron(expr)).toBe(false);
  });
});

describe("nextRuns in Asia/Jakarta (UTC+7, no DST)", () => {
  const tz = "Asia/Jakarta";
  // Wednesday 2026-10-07 10:30 WIB = 03:30 UTC
  const now = new Date("2026-10-07T03:30:00Z");

  it("daily at 08:00 → tomorrow 01:00 UTC; strictly after `after`", () => {
    expect(iso(nextRun("0 8 * * *", tz, now))).toBe("2026-10-08T01:00:00.000Z");
    expect(iso(nextRun("30 10 * * *", tz, now))).toBe("2026-10-08T03:30:00.000Z");
    expect(iso(nextRun("31 10 * * *", tz, now))).toBe("2026-10-07T03:31:00.000Z");
  });

  it("weekly on Monday 09:00 and the next three runs", () => {
    expect(nextRuns("0 9 * * 1", tz, now, 3).map(iso)).toEqual([
      "2026-10-12T02:00:00.000Z",
      "2026-10-19T02:00:00.000Z",
      "2026-10-26T02:00:00.000Z",
    ]);
  });

  it("monthly on the 31st skips short months", () => {
    expect(nextRuns("0 0 31 * *", tz, now, 3).map(iso)).toEqual([
      "2026-10-30T17:00:00.000Z",
      "2026-12-30T17:00:00.000Z",
      "2027-01-30T17:00:00.000Z",
    ]);
  });

  it("day-of-month OR day-of-week when both are restricted", () => {
    // 1st of the month or any Friday.
    expect(nextRuns("0 12 1 * 5", tz, now, 3).map(iso)).toEqual([
      "2026-10-09T05:00:00.000Z",
      "2026-10-16T05:00:00.000Z",
      "2026-10-23T05:00:00.000Z",
    ]);
  });

  it("every 15 minutes", () => {
    expect(nextRuns("*/15 * * * *", tz, now, 2).map(iso)).toEqual([
      "2026-10-07T03:45:00.000Z",
      "2026-10-07T04:00:00.000Z",
    ]);
  });

  it("never-firing schedules return nothing; bad zones throw", () => {
    expect(nextRun("0 0 30 2 *", tz, now)).toBeNull();
    expect(() => nextRun("0 0 * * *", "Mars/Olympus", now)).toThrow(CronError);
  });
});

describe("nextRuns across DST (Europe/Amsterdam)", () => {
  const tz = "Europe/Amsterdam";

  it("uses the summer and winter offsets", () => {
    // 2026-03-29: clocks go 02:00 → 03:00 (CET+1 → CEST+2).
    expect(nextRuns("0 9 * * *", tz, new Date("2026-03-28T12:00:00Z"), 2).map(iso)).toEqual([
      "2026-03-29T07:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
    ]);
  });

  it("skips a local time that does not exist (spring forward)", () => {
    // 02:30 does not exist on 2026-03-29.
    expect(iso(nextRun("30 2 * * *", tz, new Date("2026-03-28T12:00:00Z")))).toBe(
      "2026-03-30T00:30:00.000Z",
    );
  });

  it("runs a repeated local time once (fall back)", () => {
    // 2026-10-25: 03:00 → 02:00, so 02:30 happens twice; only the first counts.
    const runs = nextRuns("30 2 * * *", tz, new Date("2026-10-24T12:00:00Z"), 2).map(iso);
    expect(runs).toEqual(["2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z"]);
  });

  it("America/New_York weekly run keeps local 08:00", () => {
    // DST ends 2026-11-01 in the US.
    expect(
      nextRuns("0 8 * * 1", "America/New_York", new Date("2026-10-20T00:00:00Z"), 3).map(iso),
    ).toEqual(["2026-10-26T12:00:00.000Z", "2026-11-02T13:00:00.000Z", "2026-11-09T13:00:00.000Z"]);
  });
});

describe("presets and descriptions", () => {
  it("round-trips the presets", () => {
    for (const p of [
      { kind: "daily", hour: 7, minute: 5 },
      { kind: "weekly", hour: 9, minute: 0, day: 1 },
      { kind: "monthly", hour: 18, minute: 30, date: 15 },
    ] as const) {
      expect(cronToPreset(presetToCron(p))).toEqual(p);
    }
    expect(cronToPreset("*/5 * * * *")).toEqual({ kind: "custom", cron: "*/5 * * * *" });
  });

  it("describes presets and custom expressions in Indonesian", () => {
    expect(describeCron("0 8 * * *")).toBe("Setiap hari pukul 08:00");
    expect(describeCron("0 9 * * 1")).toBe("Setiap Senin pukul 09:00");
    expect(describeCron("30 18 15 * *")).toBe("Setiap tanggal 15 pukul 18:30");
    expect(describeCron("*/15 * * * *")).toBe("Setiap 15 menit");
    expect(describeCron("0 8 * * 1-5")).toBe("Pukul 08:00, hari Senin, Selasa, Rabu, Kamis, Jumat");
    expect(describeCron("0 0 1 1 *")).toBe("Pukul 00:00, tanggal 1, bulan Januari");
    expect(describeCron("nope")).toMatch(/^Tidak valid/);
  });
});

describe("zone helpers", () => {
  it("localDate and zonedTime", () => {
    const at = new Date("2026-10-07T18:00:00Z"); // 01:00 on the 8th in Jakarta
    expect(localDate(at, "Asia/Jakarta")).toBe("2026-10-08");
    expect(zonedTime(at, "Asia/Jakarta", 2, 17).toISOString()).toBe("2026-10-10T10:00:00.000Z");
  });
});
