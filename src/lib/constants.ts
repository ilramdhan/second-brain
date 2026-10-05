export const TASK_STATUS = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "Dikerjakan" },
  { id: "review", label: "Review" },
  { id: "done", label: "Selesai" },
] as const;

export const PRIORITY = [
  { id: "high", label: "Tinggi", className: "bg-priority-high/10 text-priority-high", dot: "bg-priority-high" },
  { id: "medium", label: "Sedang", className: "bg-priority-medium/15 text-priority-medium", dot: "bg-priority-medium" },
  { id: "low", label: "Rendah", className: "bg-secondary text-muted-foreground", dot: "bg-priority-low" },
] as const;

export const NOTE_STATUS = [
  { id: "idea", label: "Ide" },
  { id: "draft", label: "Draf" },
  { id: "final", label: "Final" },
] as const;

export const PROJECT_STATUS = [
  { id: "planning", label: "Perencanaan" },
  { id: "active", label: "Aktif" },
  { id: "on_hold", label: "Ditunda" },
  { id: "done", label: "Selesai" },
] as const;

export const PARA = [
  { id: "project", label: "Projects", desc: "Pekerjaan dengan tujuan & tenggat" },
  { id: "area", label: "Areas", desc: "Tanggung jawab berkelanjutan" },
  { id: "resource", label: "Resources", desc: "Referensi & bahan belajar" },
  { id: "archive", label: "Archives", desc: "Sudah selesai / tidak aktif" },
] as const;

export const RECURRENCE = [
  { id: "none", label: "Tidak berulang" },
  { id: "daily", label: "Setiap hari" },
  { id: "weekly", label: "Setiap minggu" },
  { id: "monthly", label: "Setiap bulan" },
] as const;

// Literal class names so Tailwind keeps them.
export const COLORS: Record<string, { dot: string; soft: string; bar: string; label: string }> = {
  teal: { dot: "bg-tone-teal", soft: "bg-tone-teal/15 text-tone-teal", bar: "bg-tone-teal", label: "Teal" },
  blue: { dot: "bg-tone-blue", soft: "bg-tone-blue/15 text-tone-blue", bar: "bg-tone-blue", label: "Biru" },
  amber: { dot: "bg-tone-amber", soft: "bg-tone-amber/15 text-tone-amber", bar: "bg-tone-amber", label: "Kuning" },
  rose: { dot: "bg-tone-rose", soft: "bg-tone-rose/15 text-tone-rose", bar: "bg-tone-rose", label: "Merah" },
  violet: { dot: "bg-tone-violet", soft: "bg-tone-violet/15 text-tone-violet", bar: "bg-tone-violet", label: "Ungu" },
  green: { dot: "bg-tone-green", soft: "bg-tone-green/15 text-tone-green", bar: "bg-tone-green", label: "Hijau" },
  slate: { dot: "bg-tone-slate", soft: "bg-tone-slate/15 text-tone-slate", bar: "bg-tone-slate", label: "Abu" },
};

export const color = (c?: string | null) => COLORS[c ?? "teal"] ?? COLORS["teal"]!;
export const priorityOf = (p: string) => PRIORITY.find((x) => x.id === p) ?? PRIORITY[1];
export const labelOf = (list: readonly { id: string; label: string }[], id: string) =>
  list.find((x) => x.id === id)?.label ?? id;
