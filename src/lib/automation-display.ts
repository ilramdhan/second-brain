// Pure helpers for rendering automation rules in the list (no React, unit-tested).
import { labelOf, PRIORITY, TASK_STATUS } from "@/lib/constants";
import { describeCron, isValidCron, isValidTimeZone } from "@/lib/cron";
import type { Condition } from "@/lib/automation-types";

/** Shown instead of a project id the viewer cannot read (deleted, or not shared with them). */
export const UNKNOWN_PROJECT_LABEL = "proyek tidak tersedia";

/**
 * Human value of a condition chip. Ids are never shown: `project_id` resolves to the project's
 * name, or a neutral fallback when the project is not in the viewer's list.
 */
export function conditionValueLabel(
  c: Pick<Condition, "field" | "value">,
  projects: readonly { id: string; name: string }[],
): string {
  if (c.field === "project_id")
    return projects.find((p) => p.id === c.value)?.name ?? UNKNOWN_PROJECT_LABEL;
  if (c.field === "status") return labelOf(TASK_STATUS, c.value);
  if (c.field === "priority") return labelOf(PRIORITY, c.value);
  return c.value;
}

type ScheduleRule = {
  enabled: boolean;
  schedule_cron?: string | null;
  schedule_tz?: string | null;
  next_run_at?: string | null;
};

/** Trigger chip of a scheduled rule; neutral when no cron is stored. */
export function scheduleTriggerLabel(rule: Pick<ScheduleRule, "schedule_cron" | "schedule_tz">) {
  if (!rule.schedule_cron) return "⏰ Terjadwal";
  return `⏰ ${describeCron(rule.schedule_cron)}${rule.schedule_tz ? ` (${rule.schedule_tz})` : ""}`;
}

/**
 * Status suffix of a scheduled rule. "jadwal tidak valid" only when the cron or time zone really
 * fails to parse; a valid rule without a stored `next_run_at` (never saved through
 * `scheduleAutomation`, e.g. inserted directly) reads "belum dijadwalkan".
 */
export function scheduleStatus(rule: ScheduleRule): string {
  if (!rule.enabled) return "";
  if (rule.next_run_at)
    return ` · berikutnya ${new Date(rule.next_run_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`;
  if (!rule.schedule_cron) return " · belum dijadwalkan";
  const valid =
    isValidCron(rule.schedule_cron) && (!rule.schedule_tz || isValidTimeZone(rule.schedule_tz));
  return valid ? " · belum dijadwalkan" : " · jadwal tidak valid";
}
