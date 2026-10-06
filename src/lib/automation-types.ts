// Shared (client + server) shapes for the automation rule engine.
//
// A rule has one of three scopes, decided by its trigger type:
//   * task rules      task_created … due_changed   → evaluated by `runAutomationRules`
//   * note rules      note_created/updated/tagged  → evaluated by `runNoteAutomationRules`
//   * scheduled rules schedule (cron + time zone)  → run by the n8n tick (`runDueAutomations`)
// Actions always write directly to the database, so they never trigger rules again.
export type TaskTriggerType =
  "task_created" | "status_changed" | "priority_changed" | "assignee_changed" | "due_changed";
export type NoteTriggerType = "note_created" | "note_updated" | "note_tagged";
export type TriggerType = TaskTriggerType | NoteTriggerType | "schedule";
/**
 * `to`: target status/priority for status_changed/priority_changed, or the tag that must be added
 * for note_tagged (empty = any tag). Schedule rules keep their cron/time zone in the
 * `schedule_cron`/`schedule_tz` columns (migration 0023), not here.
 */
export type Trigger = { type: TriggerType; to?: string | undefined };
export type RuleScope = "task" | "note" | "schedule";

export type Condition = {
  field: "priority" | "status" | "project_id" | "tag" | "assignee_name" | "title";
  op: "eq" | "neq" | "contains";
  value: string;
};

/** Task to create (scheduled rules and note rules). `title` supports placeholders. */
export type CreateTaskAction = {
  type: "create_task";
  title: string;
  priority?: "high" | "medium" | "low" | undefined;
  project_id?: string | null | undefined;
  /** Due at 17:00 local time this many days after the run (null = no due date). */
  due_in_days?: number | null | undefined;
};
export type DigestKind = "morning" | "overdue" | "evening" | "weekly";

export type Action =
  | { type: "set_field"; field: "priority" | "status" | "assignee_name"; value: string }
  | { type: "add_tag"; value: string }
  | { type: "shift_due"; days: number }
  | { type: "comment"; text: string }
  | { type: "telegram"; text: string }
  | { type: "webhook"; url: string }
  | { type: "link_project"; project_id: string }
  | CreateTaskAction
  | {
      type: "move_overdue";
      /** Project whose overdue tasks move; empty = the rule owner's own tasks. */
      project_id?: string | null | undefined;
      status: "todo" | "in_progress" | "review";
    }
  | { type: "digest"; kind: DigestKind; channel: "telegram" | "webhook"; url?: string | undefined };

export const TASK_TRIGGER_TYPES: readonly TaskTriggerType[] = [
  "task_created",
  "status_changed",
  "priority_changed",
  "assignee_changed",
  "due_changed",
];
export const NOTE_TRIGGER_TYPES: readonly NoteTriggerType[] = [
  "note_created",
  "note_updated",
  "note_tagged",
];

export function scopeOf(type: TriggerType | string | undefined): RuleScope {
  if (type === "schedule") return "schedule";
  if ((NOTE_TRIGGER_TYPES as readonly string[]).includes(type ?? "")) return "note";
  return "task";
}
export const isTaskTrigger = (type: string | undefined) =>
  (TASK_TRIGGER_TYPES as readonly string[]).includes(type ?? "");
export const isNoteTrigger = (type: string | undefined) =>
  (NOTE_TRIGGER_TYPES as readonly string[]).includes(type ?? "");

export const TRIGGERS: {
  id: TriggerType;
  label: string;
  scope: RuleScope;
  hasTo?: "status" | "priority" | "tag";
}[] = [
  { id: "task_created", label: "Tugas dibuat", scope: "task" },
  { id: "status_changed", label: "Status berubah", scope: "task", hasTo: "status" },
  { id: "priority_changed", label: "Prioritas berubah", scope: "task", hasTo: "priority" },
  { id: "assignee_changed", label: "Penanggung jawab berubah", scope: "task" },
  { id: "due_changed", label: "Tenggat berubah", scope: "task" },
  { id: "note_created", label: "Catatan dibuat", scope: "note" },
  { id: "note_updated", label: "Catatan diubah", scope: "note" },
  { id: "note_tagged", label: "Tag ditambahkan ke catatan", scope: "note", hasTo: "tag" },
  { id: "schedule", label: "Terjadwal (cron)", scope: "schedule" },
];

export const SCOPE_LABELS: Record<RuleScope, string> = {
  task: "Tugas",
  note: "Catatan",
  schedule: "Jadwal",
};

export const CONDITION_FIELDS = [
  { id: "priority", label: "Prioritas" },
  { id: "status", label: "Status" },
  { id: "project_id", label: "Proyek" },
  { id: "tag", label: "Tag" },
  { id: "assignee_name", label: "Penanggung jawab" },
  { id: "title", label: "Judul" },
] as const;

/** Condition fields per scope (scheduled rules have no conditions). */
export const CONDITION_FIELDS_BY_SCOPE: Record<RuleScope, readonly Condition["field"][]> = {
  task: ["priority", "status", "project_id", "tag", "assignee_name", "title"],
  note: ["tag", "title", "project_id"],
  schedule: [],
};

export const ACTION_TYPES = [
  { id: "set_field", label: "Ubah isi tugas" },
  { id: "add_tag", label: "Tambah tag" },
  { id: "shift_due", label: "Geser tenggat" },
  { id: "comment", label: "Tambah komentar" },
  { id: "link_project", label: "Tautkan ke proyek" },
  { id: "create_task", label: "Buat tugas" },
  { id: "move_overdue", label: "Pindahkan tugas terlambat" },
  { id: "digest", label: "Kirim ringkasan" },
  { id: "telegram", label: "Kirim ke Telegram" },
  { id: "webhook", label: "Kirim webhook" },
] as const;

/** Action types per scope. */
export const ACTIONS_BY_SCOPE: Record<RuleScope, readonly Action["type"][]> = {
  task: ["set_field", "add_tag", "shift_due", "comment", "telegram", "webhook"],
  note: ["add_tag", "link_project", "create_task", "telegram", "webhook"],
  schedule: ["create_task", "move_overdue", "digest"],
};

export const DIGEST_KINDS: { id: DigestKind; label: string }[] = [
  { id: "morning", label: "Rencana hari ini" },
  { id: "overdue", label: "Tugas terlambat" },
  { id: "evening", label: "Ringkasan sore" },
  { id: "weekly", label: "Ringkasan mingguan" },
];

export type TaskSnapshot = {
  status?: string | null;
  priority?: string | null;
  assignee_name?: string | null;
  assignee_id?: string | null;
  due_date?: string | null;
};

/** Note fields the note triggers compare (`before` of an update). */
export type NoteSnapshot = {
  title?: string | null;
  tags?: string[] | null;
  project_id?: string | null;
};

/** How long a `note_updated` rule waits before it fires again for the same note (autosave). */
export const NOTE_UPDATED_COOLDOWN_MS = 30 * 60_000;

/** Tags present in `after` but not in `before` (case-insensitive, without `#`). */
export function addedTags(before: readonly string[] | null | undefined, after: readonly string[]) {
  const norm = (t: string) => t.replace(/^#/, "").trim().toLowerCase();
  const had = new Set((before ?? []).map(norm));
  return after.map(norm).filter((t) => t && !had.has(t));
}

/** Client-side pre-check: does any enabled rule care about this note event? */
export function noteEventRelevant(
  rules: readonly { enabled: boolean; trigger: unknown }[],
  event: "created" | "updated",
  tagsAdded: number,
) {
  return rules.some((r) => {
    if (!r.enabled) return false;
    const type = (r.trigger as Trigger | null)?.type;
    if (event === "created")
      return type === "note_created" || (type === "note_tagged" && tagsAdded > 0);
    return type === "note_updated" || (type === "note_tagged" && tagsAdded > 0);
  });
}
