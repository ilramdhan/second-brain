import { describe, expect, it } from "vitest";

import {
  conditionValueLabel,
  scheduleStatus,
  scheduleTriggerLabel,
  UNKNOWN_PROJECT_LABEL,
} from "./automation-display";

const PID = "0b6c5c1e-2a43-4f7e-9d43-5b0d6c1f2a11";

describe("conditionValueLabel", () => {
  it("shows the project name, never the raw id", () => {
    const projects = [{ id: PID, name: "Aplikasi Kasir" }];
    expect(conditionValueLabel({ field: "project_id", value: PID }, projects)).toBe(
      "Aplikasi Kasir",
    );
  });

  it("falls back to a neutral label for a project the viewer cannot see", () => {
    const label = conditionValueLabel({ field: "project_id", value: PID }, []);
    expect(label).toBe(UNKNOWN_PROJECT_LABEL);
    expect(label).not.toContain(PID);
  });

  it("translates status and priority, passes other values through", () => {
    expect(conditionValueLabel({ field: "status", value: "done" }, [])).not.toBe("done");
    expect(conditionValueLabel({ field: "priority", value: "high" }, [])).not.toBe("high");
    expect(conditionValueLabel({ field: "tag", value: "bug" }, [])).toBe("bug");
  });
});

describe("scheduleStatus", () => {
  const rule = { enabled: true, schedule_cron: "0 8 * * 1", schedule_tz: "Asia/Jakarta" };

  it("shows the next run when one is stored", () => {
    expect(scheduleStatus({ ...rule, next_run_at: "2026-10-12T01:00:00Z" })).toMatch(/berikutnya/);
  });

  it("a valid schedule without next_run_at is not reported as invalid", () => {
    expect(scheduleStatus({ ...rule, next_run_at: null })).toBe(" · belum dijadwalkan");
    expect(scheduleStatus({ enabled: true, next_run_at: null })).toBe(" · belum dijadwalkan");
  });

  it("only a cron or time zone that fails to parse is invalid", () => {
    expect(scheduleStatus({ ...rule, schedule_cron: "99 * * * *" })).toBe(" · jadwal tidak valid");
    expect(scheduleStatus({ ...rule, schedule_tz: "Mars/Olympus" })).toBe(" · jadwal tidak valid");
  });

  it("disabled rules show nothing", () => {
    expect(scheduleStatus({ ...rule, enabled: false })).toBe("");
  });
});

describe("scheduleTriggerLabel", () => {
  it("describes the cron, and stays neutral when none is stored", () => {
    expect(scheduleTriggerLabel({ schedule_cron: "0 8 * * 1", schedule_tz: "Asia/Jakarta" })).toBe(
      "⏰ Setiap Senin pukul 08:00 (Asia/Jakarta)",
    );
    expect(scheduleTriggerLabel({ schedule_cron: null, schedule_tz: null })).toBe("⏰ Terjadwal");
  });
});
