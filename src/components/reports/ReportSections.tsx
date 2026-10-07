import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import type { ChartSeries } from "@/components/charts/types";
import {
  bucketize,
  bucketModeFor,
  burndown,
  formatHours,
  formatMinutes,
  totals,
  type BurndownUnit,
  type DailyRow,
} from "@/lib/reports";
import { useI18n } from "@/lib/preferences";
import { cn } from "@/lib/utils";

import { asDate, bucketPoints, burndownPoints } from "./points";

const count = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
const countEn = (v: number) => String(Math.round(v * 10) / 10);
/** Number formatter with the active locale's decimal separator. */
const useCount = () => (useI18n().locale === "en" ? countEn : count);

/** KPI row: the numbers the charts below break down (dataviz: a number, not a one-bar chart). */
export function ReportTiles({ rows }: { rows: readonly DailyRow[] }) {
  const { t: tr } = useI18n();
  const num = useCount();
  const t = totals(rows);
  const tiles = [
    {
      label: tr("admDone"),
      value: num(t.completed),
      sub: tr("admPerWeekCount", { n: num(t.perWeek) }),
    },
    { label: tr("admCreated"), value: num(t.created), sub: tr("admNewTasks") },
    {
      label: tr("admFocus"),
      value: formatMinutes(t.focusSeconds / 60),
      sub: tr("admFromTimer"),
    },
    {
      label: tr("admEstimateDone"),
      value: formatMinutes(t.completedMinutes),
      sub: tr("admTimeBlock", { d: formatMinutes(t.plannedMinutes) }),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((x) => (
        <section key={x.label} className="min-w-0 rounded-2xl border bg-card p-4">
          <h2 className="text-xs text-muted-foreground">{x.label}</h2>
          <p className="mt-1 truncate text-2xl font-semibold">{x.value}</p>
          <p className="truncate text-xs text-muted-foreground">{x.sub}</p>
        </section>
      ))}
    </div>
  );
}

/** Throughput (completed vs created) and focus (timer vs estimates of finished work). */
export function TrendCharts({ rows, days }: { rows: readonly DailyRow[]; days: number }) {
  const { t } = useI18n();
  const num = useCount();
  const mode = bucketModeFor(days);
  const buckets = bucketize(rows, mode);
  const per = mode === "week" ? t("admPerWeek") : t("admPerDay");
  const THROUGHPUT: ChartSeries[] = [
    { key: "completed", label: t("admDone"), tone: "chart-1" },
    { key: "created", label: t("admCreated"), tone: "chart-2" },
  ];
  const FOCUS: ChartSeries[] = [
    { key: "focus", label: t("admFocusTimer"), tone: "chart-1" },
    { key: "done", label: t("admEstimateDoneTasks"), tone: "chart-2" },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <BarChart
        id="throughput"
        title="Throughput"
        subtitle={t("admThroughputSubtitle", { per })}
        series={THROUGHPUT}
        points={bucketPoints(buckets, mode, (b) => ({
          completed: b.completed,
          created: b.created,
        }))}
        format={num}
      />
      <BarChart
        id="focus"
        title={t("admFocus")}
        subtitle={t("admFocusSubtitle", { per })}
        series={FOCUS}
        points={bucketPoints(buckets, mode, (b) => ({
          focus: b.focusSeconds / 60,
          done: b.completedMinutes,
        }))}
        format={formatMinutes}
        tickFormat={formatHours}
        tickUnit={60}
      />
    </div>
  );
}

/**
 * Burndown of the selected scope: remaining open tasks (or their estimated minutes) per day and
 * an ideal line to the due date (milestone, else project), when there is one.
 */
export function BurndownChart({
  rows,
  unit,
  due,
  dueLabel,
  today,
  className,
}: {
  rows: readonly DailyRow[];
  unit: BurndownUnit;
  due: string | null;
  dueLabel: string | null;
  today: string;
  className?: string | undefined;
}) {
  const { t, intl } = useI18n();
  const num = useCount();
  const pts = burndown(rows, { unit, due, today });
  const hasIdeal = pts.some((p) => p.ideal !== null);
  const series: ChartSeries[] = [
    {
      key: "remaining",
      label: unit === "tasks" ? t("admOpenTasks") : t("admOpenEstimate"),
      tone: "chart-1",
    },
    ...(hasIdeal ? [{ key: "ideal", label: "Ideal", tone: "muted" as const, dashed: true }] : []),
  ];
  const fmt = unit === "tasks" ? num : formatMinutes;
  const subtitle =
    due && dueLabel
      ? t("admBurndownTarget", {
          label: dueLabel,
          date: asDate(due).toLocaleDateString(intl, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        })
      : t("admBurndownHint");
  return (
    <LineChart
      id="burndown"
      title="Burndown"
      subtitle={subtitle}
      series={series}
      points={burndownPoints(pts)}
      format={fmt}
      tickFormat={unit === "tasks" ? num : formatHours}
      tickUnit={unit === "tasks" ? 1 : 60}
      className={cn(className)}
    />
  );
}
