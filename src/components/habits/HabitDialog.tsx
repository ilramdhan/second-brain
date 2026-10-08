import { useState } from "react";

import { Segmented } from "@/components/reports/ReportFilters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COLORS } from "@/lib/constants";
import type { Habit, Project } from "@/lib/data";
import { ALL_DAYS, weekdayLabels, WORKDAYS, type ScheduleType } from "@/lib/habits";
import { useI18n } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { optionLabel } from "@/lib/option-labels";

export type HabitDraft = {
  name: string;
  color: string;
  project_id: string | null;
  schedule_type: ScheduleType;
  weekdays_mask: number;
  times_per_week: number;
  target: number;
};

const EMPTY: HabitDraft = {
  name: "",
  color: "teal",
  project_id: null,
  schedule_type: "daily",
  weekdays_mask: WORKDAYS,
  times_per_week: 3,
  target: 1,
};
const NONE = "none";

const draftOf = (h: Habit): HabitDraft => ({
  name: h.name,
  color: h.color,
  project_id: h.project_id,
  schedule_type: (["daily", "weekdays", "weekly"] as const).includes(
    h.schedule_type as ScheduleType,
  )
    ? (h.schedule_type as ScheduleType)
    : "daily",
  weekdays_mask: h.weekdays_mask,
  times_per_week: h.times_per_week,
  target: h.target,
});

/** Create or edit a habit: name, schedule (daily / weekdays / N× per week), target, colour, project. */
export function HabitDialog({
  open,
  onOpenChange,
  habit,
  projects,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: Habit | null;
  projects: Pick<Project, "id" | "name">[];
  onSave: (draft: HabitDraft) => Promise<void> | void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Keyed: every opening starts from the habit (or an empty draft) again. */}
        {open && (
          <HabitForm
            key={habit?.id ?? "new"}
            habit={habit}
            projects={projects}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function HabitForm({
  habit,
  projects,
  onSave,
  onClose,
}: {
  habit: Habit | null;
  projects: Pick<Project, "id" | "name">[];
  onSave: (draft: HabitDraft) => Promise<void> | void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [d, setD] = useState<HabitDraft>(() => (habit ? draftOf(habit) : EMPTY));
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<HabitDraft>) => setD((x) => ({ ...x, ...p }));
  const valid = d.name.trim().length > 0 && (d.schedule_type !== "weekdays" || d.weekdays_mask > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await onSave({ ...d, name: d.name.trim() });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>{habit ? t("admHabitEdit") : t("admHabitNew")}</DialogTitle>
        <DialogDescription>{t("admHabitDescription")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("admName")}</span>
          <Input
            autoFocus
            maxLength={200}
            value={d.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={t("admHabitPlaceholder")}
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("admSchedule")}</legend>
          <Segmented
            label={t("admSchedule")}
            value={d.schedule_type}
            onChange={(v) => set({ schedule_type: v as ScheduleType })}
            options={[
              { value: "daily", label: t("admSchedDaily") },
              { value: "weekdays", label: t("admSchedSpecific") },
              { value: "weekly", label: t("admSchedNWeek") },
            ]}
          />
          {d.schedule_type === "weekdays" && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("admDay")}>
              {weekdayLabels().map((label, i) => {
                const on = (d.weekdays_mask & (1 << i)) !== 0;
                return (
                  // eslint-disable-next-line no-restricted-syntax -- exception: round weekday toggle
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ weekdays_mask: d.weekdays_mask ^ (1 << i) })}
                    className={cn(
                      "h-11 w-11 rounded-full border text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      on ? "border-primary bg-primary text-primary-foreground" : "bg-card",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
              <Button
                type="button"
                variant="tertiary"
                onClick={() =>
                  set({ weekdays_mask: d.weekdays_mask === WORKDAYS ? ALL_DAYS : WORKDAYS })
                }
              >
                {d.weekdays_mask === WORKDAYS ? t("admAllDays") : t("admSchedWorkdays")}
              </Button>
            </div>
          )}
          {d.schedule_type === "weekly" && (
            <NumberField
              label={t("admTimesPerWeek")}
              value={d.times_per_week}
              min={1}
              max={7}
              onChange={(v) => set({ times_per_week: v })}
            />
          )}
        </fieldset>
        <NumberField
          label={t("admTargetPerDay")}
          value={d.target}
          min={1}
          max={100}
          onChange={(v) => set({ target: v })}
        />
        <div className="space-y-1.5">
          <span className="text-sm font-medium" id="habit-color">
            {t("admColor")}
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="habit-color">
            {Object.entries(COLORS).map(([key, c]) => (
              // eslint-disable-next-line no-restricted-syntax -- exception: colour swatch
              <button
                key={key}
                type="button"
                aria-pressed={d.color === key}
                aria-label={optionLabel(t, "color", key, c.label)}
                onClick={() => set({ color: key })}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  d.color === key && "ring-2 ring-foreground/60",
                )}
              >
                <span className={cn("h-6 w-6 rounded-full", c.dot)} />
              </button>
            ))}
          </div>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("admProjectOptional")}</span>
          <Select
            value={d.project_id ?? NONE}
            onValueChange={(v) => set({ project_id: v === NONE ? null : v })}
          >
            <SelectTrigger className="h-11 sm:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("admNoProject")}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("admCancel")}
        </Button>
        <Button type="submit" disabled={!valid || saving}>
          {habit ? t("admSave") : t("admAdd")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        className="w-28"
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
    </label>
  );
}
