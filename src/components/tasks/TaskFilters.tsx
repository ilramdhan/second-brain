import { addDays, isBefore, isToday, startOfDay } from "date-fns";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITY } from "@/lib/constants";
import type { Project, Task } from "@/lib/data";

export type TaskFilter = {
  q: string;
  project: string;
  priority: string;
  tag: string;
  due: string;
  assignee: string;
};
export const EMPTY_FILTER: TaskFilter = {
  q: "",
  project: "all",
  priority: "all",
  tag: "all",
  due: "all",
  assignee: "all",
};

export function applyTaskFilter(tasks: Task[], f: TaskFilter, uid?: string) {
  const today = startOfDay(new Date());
  const week = addDays(today, 7);
  const q = f.q.trim().toLowerCase();
  return tasks.filter((t) => {
    if (q && !`${t.title} ${t.description ?? ""} ${t.tags.join(" ")}`.toLowerCase().includes(q))
      return false;
    if (f.project !== "all" && (f.project === "none" ? t.project_id : t.project_id !== f.project))
      return false;
    if (f.priority !== "all" && t.priority !== f.priority) return false;
    if (f.tag !== "all" && !t.tags.includes(f.tag)) return false;
    if (
      f.assignee === "me" &&
      t.assignee_id !== uid &&
      !(t.user_id === uid && !t.assignee_id && !t.assignee_name)
    )
      return false;
    if (f.due !== "all") {
      const d = t.due_date ? new Date(t.due_date) : null;
      if (f.due === "nodate" && d) return false;
      if (f.due === "today" && !(d && isToday(d))) return false;
      if (f.due === "overdue" && !(d && isBefore(d, today) && t.status !== "done")) return false;
      if (f.due === "week" && !(d && d >= today && d < week)) return false;
    }
    return true;
  });
}

export function TaskFilters({
  value,
  onChange,
  projects,
  tags,
  hideProject,
}: {
  value: TaskFilter;
  onChange: (f: TaskFilter) => void;
  projects: Project[];
  tags: string[];
  hideProject?: boolean | undefined;
}) {
  const set = (k: keyof TaskFilter) => (v: string) => onChange({ ...value, [k]: v });
  const dirty = JSON.stringify(value) !== JSON.stringify(EMPTY_FILTER);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-56">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.q}
          onChange={(e) => set("q")(e.target.value)}
          placeholder="Cari tugas…"
          className="h-9 pl-8"
        />
      </div>
      {!hideProject && (
        <FilterSelect
          value={value.project}
          onChange={set("project")}
          items={[
            ["all", "Semua proyek"],
            ["none", "Tanpa proyek"],
            ...projects.map((p) => [p.id, p.name] as [string, string]),
          ]}
        />
      )}
      <FilterSelect
        value={value.due}
        onChange={set("due")}
        items={[
          ["all", "Semua tanggal"],
          ["today", "Hari ini"],
          ["week", "7 hari ke depan"],
          ["overdue", "Terlambat"],
          ["nodate", "Tanpa tanggal"],
        ]}
      />
      <FilterSelect
        value={value.priority}
        onChange={set("priority")}
        items={[
          ["all", "Semua prioritas"],
          ...PRIORITY.map((p) => [p.id, p.label] as [string, string]),
        ]}
      />
      {tags.length > 0 && (
        <FilterSelect
          value={value.tag}
          onChange={set("tag")}
          items={[["all", "Semua tag"], ...tags.map((t) => [t, `#${t}`] as [string, string])]}
        />
      )}
      <FilterSelect
        value={value.assignee}
        onChange={set("assignee")}
        items={[
          ["all", "Semua orang"],
          ["me", "Tugas saya"],
        ]}
      />
      {dirty && (
        <button
          onClick={() => onChange(EMPTY_FILTER)}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" /> Reset
        </button>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (v: string) => void;
  items: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[8.5rem] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
