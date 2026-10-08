// Translated labels for the option lists in src/lib/constants.ts. Their `label` fields stay the
// Indonesian default (the server's AI/regex matchers and the demo seed read them); every UI that
// shows an option goes through `optionLabel` with the active locale's `t`.
import type { MessageKey } from "@/lib/i18n";

export type OptionKind =
  "status" | "priority" | "recurrence" | "noteStatus" | "projectStatus" | "para" | "color";

const KEYS: Record<OptionKind, Record<string, MessageKey>> = {
  status: {
    todo: "taskStatusTodo",
    in_progress: "taskStatusInProgress",
    review: "taskStatusReview",
    done: "taskStatusDone",
  },
  priority: { high: "taskPriorityHigh", medium: "taskPriorityMedium", low: "taskPriorityLow" },
  recurrence: {
    none: "taskRecurrenceNone",
    daily: "taskRecurrenceDaily",
    weekly: "taskRecurrenceWeekly",
    monthly: "taskRecurrenceMonthly",
  },
  noteStatus: { idea: "noteStatusIdea", draft: "noteStatusDraft", final: "noteStatusFinal" },
  projectStatus: {
    planning: "wsProjectStatusPlanning",
    active: "wsProjectStatusActive",
    on_hold: "wsProjectStatusOnHold",
    done: "wsProjectStatusDone",
  },
  para: {
    project: "wsParaProject",
    area: "wsParaArea",
    resource: "wsParaResource",
    archive: "wsParaArchive",
  },
  color: {
    teal: "wsColorTeal",
    blue: "wsColorBlue",
    amber: "wsColorAmber",
    rose: "wsColorRose",
    violet: "wsColorViolet",
    green: "wsColorGreen",
    slate: "wsColorSlate",
  },
};

type T = (key: MessageKey) => string;

/** Label of an option id in the active locale; `fallback` (or the raw id) when it is unknown. */
export function optionLabel(t: T, kind: OptionKind, id: string, fallback: string = id): string {
  const key = KEYS[kind][id];
  return key ? t(key) : fallback;
}

/** `{ id, label }` columns/options of a constants list, translated (Kanban columns, selects). */
export function translatedOptions(
  t: T,
  kind: OptionKind,
  list: readonly { id: string; label: string }[],
): { id: string; label: string }[] {
  return list.map((o) => ({ id: o.id, label: optionLabel(t, kind, o.id, o.label) }));
}
