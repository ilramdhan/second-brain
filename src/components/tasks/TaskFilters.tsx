import { addDays, isBefore, isToday, startOfDay } from "date-fns";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { useI18n } from "@/lib/preferences";
import { enumLabel } from "@/components/tasks/labels";

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
  const { t } = useI18n();
  const set = (k: keyof TaskFilter) => (v: string) => onChange({ ...value, [k]: v });
  const dirty = JSON.stringify(value) !== JSON.stringify(EMPTY_FILTER);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-56">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.q}
          onChange={(e) => set("q")(e.target.value)}
          placeholder={t("taskFilterSearch")}
          className="h-9 pl-8"
        />
      </div>
      {!hideProject && (
        <FilterSelect
          value={value.project}
          onChange={set("project")}
          items={[
            ["all", t("taskFilterAllProjects")],
            ["none", t("taskNoProject")],
            ...projects.map((p) => [p.id, p.name] as [string, string]),
          ]}
        />
      )}
      <FilterSelect
        value={value.due}
        onChange={set("due")}
        items={[
          ["all", t("taskFilterAllDates")],
          ["today", t("taskGroupToday")],
          ["week", t("taskFilterNext7")],
          ["overdue", t("taskGroupOverdue")],
          ["nodate", t("taskGroupNoDate")],
        ]}
      />
      <FilterSelect
        value={value.priority}
        onChange={set("priority")}
        items={[
          ["all", t("taskFilterAllPriorities")],
          ...PRIORITY.map(
            (p) => [p.id, enumLabel(t, "priority", p.id, p.label)] as [string, string],
          ),
        ]}
      />
      {tags.length > 0 && (
        <FilterSelect
          value={value.tag}
          onChange={set("tag")}
          items={[
            ["all", t("taskFilterAllTags")],
            ...tags.map((tag) => [tag, `#${tag}`] as [string, string]),
          ]}
        />
      )}
      <FilterSelect
        value={value.assignee}
        onChange={set("assignee")}
        items={[
          ["all", t("taskFilterAllPeople")],
          ["me", t("taskFilterMine")],
        ]}
      />
      {dirty && (
        <Button
          variant="tertiary"
          size="sm"
          className="px-2 text-muted-foreground"
          onClick={() => onChange(EMPTY_FILTER)}
        >
          <X /> {t("taskFilterReset")}
        </Button>
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
