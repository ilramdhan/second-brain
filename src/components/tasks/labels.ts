// Translated labels for the task enums in src/lib/constants.ts (whose `label` stays the
// Indonesian default for code that is not locale-aware).
import type { MessageKey } from "@/lib/preferences";

const KEYS: Record<string, MessageKey> = {
  "status:todo": "taskStatusTodo",
  "status:in_progress": "taskStatusInProgress",
  "status:review": "taskStatusReview",
  "status:done": "taskStatusDone",
  "priority:high": "taskPriorityHigh",
  "priority:medium": "taskPriorityMedium",
  "priority:low": "taskPriorityLow",
  "recurrence:none": "taskRecurrenceNone",
  "recurrence:daily": "taskRecurrenceDaily",
  "recurrence:weekly": "taskRecurrenceWeekly",
  "recurrence:monthly": "taskRecurrenceMonthly",
};

type T = (key: MessageKey) => string;

/** Label of a status / priority / recurrence id in the active locale (falls back to `fallback`). */
export function enumLabel(
  t: T,
  kind: "status" | "priority" | "recurrence",
  id: string,
  fallback: string,
): string {
  const key = KEYS[`${kind}:${id}`];
  return key ? t(key) : fallback;
}
