// Shared (client + server) shapes for the automation rule engine.
export type TriggerType =
  "task_created" | "status_changed" | "priority_changed" | "assignee_changed" | "due_changed";
export type Trigger = { type: TriggerType; to?: string | undefined };
export type Condition = {
  field: "priority" | "status" | "project_id" | "tag" | "assignee_name";
  op: "eq" | "neq" | "contains";
  value: string;
};
export type Action =
  | { type: "set_field"; field: "priority" | "status" | "assignee_name"; value: string }
  | { type: "add_tag"; value: string }
  | { type: "shift_due"; days: number }
  | { type: "comment"; text: string }
  | { type: "telegram"; text: string }
  | { type: "webhook"; url: string };

export const TRIGGERS: { id: TriggerType; label: string; hasTo?: "status" | "priority" }[] = [
  { id: "task_created", label: "Tugas dibuat" },
  { id: "status_changed", label: "Status berubah", hasTo: "status" },
  { id: "priority_changed", label: "Prioritas berubah", hasTo: "priority" },
  { id: "assignee_changed", label: "Penanggung jawab berubah" },
  { id: "due_changed", label: "Tenggat berubah" },
];

export const CONDITION_FIELDS = [
  { id: "priority", label: "Prioritas" },
  { id: "status", label: "Status" },
  { id: "project_id", label: "Proyek" },
  { id: "tag", label: "Tag" },
  { id: "assignee_name", label: "Penanggung jawab" },
] as const;

export const ACTION_TYPES = [
  { id: "set_field", label: "Ubah isi tugas" },
  { id: "add_tag", label: "Tambah tag" },
  { id: "shift_due", label: "Geser tenggat" },
  { id: "comment", label: "Tambah komentar" },
  { id: "telegram", label: "Kirim ke Telegram" },
  { id: "webhook", label: "Kirim webhook" },
] as const;

export type TaskSnapshot = {
  status?: string | null;
  priority?: string | null;
  assignee_name?: string | null;
  assignee_id?: string | null;
  due_date?: string | null;
};
