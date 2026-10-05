import { describe, expect, it } from "vitest";

import { appTimezone, parseTaskTextInZone, startOfZonedDay, tzOffsetMs } from "./time.server";

describe("time zone helpers", () => {
  it("falls back to Asia/Jakarta for invalid zones", () => {
    expect(appTimezone({})).toBe("Asia/Jakarta");
    expect(appTimezone({ APP_TIMEZONE: "Mars/Base" })).toBe("Asia/Jakarta");
    expect(appTimezone({ APP_TIMEZONE: "Europe/Berlin" })).toBe("Europe/Berlin");
  });

  it("computes the offset and local midnight", () => {
    const now = new Date("2026-10-05T20:00:00Z"); // 03:00 on Oct 6 in Jakarta
    expect(tzOffsetMs(now, "Asia/Jakarta")).toBe(7 * 3_600_000);
    expect(startOfZonedDay(now, "Asia/Jakarta").toISOString()).toBe("2026-10-05T17:00:00.000Z");
    expect(startOfZonedDay(now, "Asia/Jakarta", 1).toISOString()).toBe("2026-10-06T17:00:00.000Z");
  });

  it("parses natural-language dates in the app zone", () => {
    const now = new Date("2026-10-05T20:00:00Z"); // Tue Oct 6, 03:00 WIB
    const parsed = parseTaskTextInZone("Rapat besok jam 10", now, "Asia/Jakarta");
    expect(parsed.title).toBe("Rapat");
    expect(parsed.due?.toISOString()).toBe("2026-10-07T03:00:00.000Z"); // Wed 10:00 WIB
  });
});
