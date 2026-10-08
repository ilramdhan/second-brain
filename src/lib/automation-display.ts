// Pure helpers for rendering automation rules in the list (no React, unit-tested). Every helper
// takes the UI locale (default Indonesian) so the page can pass the active one.
import type { Condition } from "@/lib/automation-types";
import { describeCron, isValidCron, isValidTimeZone } from "@/lib/cron";
import { format, intlLocale, messages, type Locale, type MessageKey } from "@/lib/i18n";
import { optionLabel } from "@/lib/option-labels";

const t = (locale: Locale, key: MessageKey, vars?: Record<string, string | number>) =>
  format(messages[locale][key], vars);

/** Shown instead of a project id the viewer cannot read (deleted, or not shared with them). */
export const UNKNOWN_PROJECT_LABEL = messages.id.autoUnknownProject;

/**
 * Human value of a condition chip. Ids are never shown: `project_id` resolves to the project's
 * name, or a neutral fallback when the project is not in the viewer's list.
 */
export function conditionValueLabel(
  c: Pick<Condition, "field" | "value">,
  projects: readonly { id: string; name: string }[],
  locale: Locale = "id",
): string {
  if (c.field === "project_id")
    return projects.find((p) => p.id === c.value)?.name ?? t(locale, "autoUnknownProject");
  if (c.field === "status" || c.field === "priority")
    return optionLabel((key) => t(locale, key), c.field, c.value);
  return c.value;
}

type ScheduleRule = {
  enabled: boolean;
  schedule_cron?: string | null;
  schedule_tz?: string | null;
  next_run_at?: string | null;
};

/** Trigger chip of a scheduled rule; neutral when no cron is stored. */
export function scheduleTriggerLabel(
  rule: Pick<ScheduleRule, "schedule_cron" | "schedule_tz">,
  locale: Locale = "id",
) {
  if (!rule.schedule_cron) return `⏰ ${t(locale, "autoScheduled")}`;
  return `⏰ ${describeCron(rule.schedule_cron, locale)}${rule.schedule_tz ? ` (${rule.schedule_tz})` : ""}`;
}

/**
 * Status suffix of a scheduled rule. "jadwal tidak valid" only when the cron or time zone really
 * fails to parse; a valid rule without a stored `next_run_at` (never saved through
 * `scheduleAutomation`, e.g. inserted directly) reads "belum dijadwalkan".
 */
export function scheduleStatus(rule: ScheduleRule, locale: Locale = "id"): string {
  if (!rule.enabled) return "";
  if (rule.next_run_at) {
    const when = new Date(rule.next_run_at).toLocaleString(intlLocale(locale), {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return ` · ${t(locale, "autoNextRun", { when })}`;
  }
  if (!rule.schedule_cron) return ` · ${t(locale, "autoNotScheduled")}`;
  const valid =
    isValidCron(rule.schedule_cron) && (!rule.schedule_tz || isValidTimeZone(rule.schedule_tz));
  return ` · ${t(locale, valid ? "autoNotScheduled" : "autoInvalidSchedule")}`;
}
