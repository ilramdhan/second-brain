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
import { cn } from "@/lib/utils";

import { asDate, bucketPoints, burndownPoints } from "./points";

const count = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");

/** KPI row: the numbers the charts below break down (dataviz: a number, not a one-bar chart). */
export function ReportTiles({ rows }: { rows: readonly DailyRow[] }) {
  const t = totals(rows);
  const tiles = [
    { label: "Selesai", value: count(t.completed), sub: `${count(t.perWeek)} per minggu` },
    { label: "Dibuat", value: count(t.created), sub: "tugas baru" },
    { label: "Fokus", value: formatMinutes(t.focusSeconds / 60), sub: "dari timer fokus" },
    {
      label: "Estimasi selesai",
      value: formatMinutes(t.completedMinutes),
      sub: `${formatMinutes(t.plannedMinutes)} time-block`,
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

const THROUGHPUT: ChartSeries[] = [
  { key: "completed", label: "Selesai", tone: "chart-1" },
  { key: "created", label: "Dibuat", tone: "chart-2" },
];
const FOCUS: ChartSeries[] = [
  { key: "focus", label: "Fokus (timer)", tone: "chart-1" },
  { key: "done", label: "Estimasi tugas selesai", tone: "chart-2" },
];

/** Throughput (completed vs created) and focus (timer vs estimates of finished work). */
export function TrendCharts({ rows, days }: { rows: readonly DailyRow[]; days: number }) {
  const mode = bucketModeFor(days);
  const buckets = bucketize(rows, mode);
  const per = mode === "week" ? "per minggu" : "per hari";
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <BarChart
        id="throughput"
        title="Throughput"
        subtitle={`Tugas selesai vs dibuat ${per}`}
        series={THROUGHPUT}
        points={bucketPoints(buckets, mode, (b) => ({
          completed: b.completed,
          created: b.created,
        }))}
        format={count}
      />
      <BarChart
        id="focus"
        title="Fokus"
        subtitle={`Jam fokus dan estimasi pekerjaan selesai ${per}`}
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
  const pts = burndown(rows, { unit, due, today });
  const hasIdeal = pts.some((p) => p.ideal !== null);
  const series: ChartSeries[] = [
    {
      key: "remaining",
      label: unit === "tasks" ? "Tugas terbuka" : "Estimasi terbuka",
      tone: "chart-1",
    },
    ...(hasIdeal ? [{ key: "ideal", label: "Ideal", tone: "muted" as const, dashed: true }] : []),
  ];
  const fmt = unit === "tasks" ? count : formatMinutes;
  const subtitle =
    due && dueLabel
      ? `Target ${dueLabel}: ${asDate(due).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`
      : "Pilih proyek atau milestone bertenggat untuk garis ideal.";
  return (
    <LineChart
      id="burndown"
      title="Burndown"
      subtitle={subtitle}
      series={series}
      points={burndownPoints(pts)}
      format={fmt}
      tickFormat={unit === "tasks" ? count : formatHours}
      tickUnit={unit === "tasks" ? 1 : 60}
      className={cn(className)}
    />
  );
}
