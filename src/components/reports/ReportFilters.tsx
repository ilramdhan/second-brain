import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Milestone, Project } from "@/lib/data";
import { useI18n } from "@/lib/preferences";
import { RANGES, type BurndownUnit, type RangeDays } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const ALL = "all";

/**
 * The one filter row above every report (dataviz: range first, then dimensions; filters scope
 * all charts below them). Range presets are a segmented control with 44px targets on phones.
 */
export function ReportFilters({
  range,
  onRange,
  projectId,
  onProject,
  milestoneId,
  onMilestone,
  unit,
  onUnit,
  projects,
  milestones,
}: {
  range: RangeDays;
  onRange: (r: RangeDays) => void;
  projectId: string;
  onProject: (id: string) => void;
  milestoneId: string;
  onMilestone: (id: string) => void;
  unit: BurndownUnit;
  onUnit: (u: BurndownUnit) => void;
  projects: Pick<Project, "id" | "name">[];
  milestones: Pick<Milestone, "id" | "title" | "project_id">[];
}) {
  const { t } = useI18n();
  const projectMilestones = milestones.filter((m) => m.project_id === projectId);
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t("admReportFilters")}
    >
      <Segmented
        label={t("admRange")}
        value={String(range)}
        onChange={(v) => onRange(Number(v) as RangeDays)}
        options={RANGES.map((d) => ({ value: String(d), label: t("admRangeDays", { n: d }) }))}
      />
      <Select value={projectId} onValueChange={onProject}>
        <SelectTrigger className="h-11 w-full min-w-0 sm:h-9 sm:w-52" aria-label={t("projects")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("admAllProjects")}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {projectId !== ALL && projectMilestones.length > 0 && (
        <Select value={milestoneId} onValueChange={onMilestone}>
          <SelectTrigger className="h-11 w-full min-w-0 sm:h-9 sm:w-52" aria-label="Milestone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("admAllMilestones")}</SelectItem>
            {projectMilestones.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Segmented
        label={t("admBurndownUnit")}
        value={unit}
        onChange={(v) => onUnit(v as BurndownUnit)}
        options={[
          { value: "tasks", label: t("tasks") },
          { value: "minutes", label: t("admUnitEstimate") },
        ]}
      />
    </div>
  );
}

export function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-11 rounded-md px-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-8",
            value === o.value
              ? "bg-secondary font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
