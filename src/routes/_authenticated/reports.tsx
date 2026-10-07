import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { RouteError } from "@/components/common/RouteError";
import { FocusBreakdown } from "@/components/reports/FocusReport";
import { ALL, ReportFilters } from "@/components/reports/ReportFilters";
import { BurndownChart, ReportTiles, TrendCharts } from "@/components/reports/ReportSections";
import {
  milestonesQuery,
  preloadQueries,
  projectsQuery,
  tasksQuery,
  useMilestones,
  useProjects,
  useReportDaily,
  useTasks,
  useTimeEntries,
} from "@/lib/data";
import { usePreferences } from "@/lib/preferences";
import { localIsoDate, rangeFor, type BurndownUnit, type RangeDays } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Laporan — Second Brain" },
      {
        name: "description",
        content: "Fokus, burndown dan throughput tugas per 7, 30 atau 90 hari, per proyek.",
      },
      { property: "og:title", content: "Laporan — Second Brain" },
      {
        property: "og:description",
        content: "Fokus, burndown dan throughput tugas per 7, 30 atau 90 hari, per proyek.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) =>
    preloadQueries(context.queryClient, projectsQuery, tasksQuery, milestonesQuery),
  component: ReportsPage,
  errorComponent: RouteError,
});

/** The browser's zone: "today" and every daily bucket are cut there (like `complete_task`). */
const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function ReportsPage() {
  const { t: tt } = usePreferences();
  const [range, setRange] = useState<RangeDays>(30);
  const [projectId, setProjectId] = useState(ALL);
  const [milestoneId, setMilestoneId] = useState(ALL);
  const [unit, setUnit] = useState<BurndownUnit>("tasks");
  const { data: projects = [] } = useProjects();
  const { data: milestones = [] } = useMilestones();
  const { data: tasks = [] } = useTasks();

  const tz = browserTz();
  const today = localIsoDate(new Date(), tz);
  const { from, to } = rangeFor(range, today);
  const project = projectId === ALL ? null : projectId;
  const milestone = milestoneId === ALL ? null : milestoneId;
  const report = useReportDaily({ from, to, tz, projectId: project, milestoneId: milestone });
  const entries = useTimeEntries(from, to);
  const rows = report.data ?? [];

  // Burndown target: the milestone's due date, else the project's.
  const ms = milestone ? milestones.find((m) => m.id === milestone) : null;
  const pr = project ? projects.find((p) => p.id === project) : null;
  const due = ms?.due_date ?? (pr?.due_date ? localIsoDate(new Date(pr.due_date), tz) : null);
  const dueLabel = ms ? ms.title : pr?.due_date ? pr.name : null;

  // Focus breakdown (own time entries; breaks excluded; scoped to the project filter).
  const projectOf = (e: { project_id: string | null; task_id: string | null }) =>
    e.project_id ?? tasks.find((t) => t.id === e.task_id)?.project_id ?? null;
  const focus = (entries.data ?? []).filter(
    (e) => e.mode !== "break" && (!project || projectOf(e) === project),
  );
  const focusTotal = focus.reduce((s, e) => s + e.duration_seconds, 0);
  const sum = (key: (e: (typeof focus)[number]) => string | null) =>
    [
      ...focus.reduce((m, e) => {
        const k = key(e);
        if (k !== null) m.set(k, (m.get(k) ?? 0) + e.duration_seconds);
        return m;
      }, new Map<string, number>()),
    ].sort((a, b) => b[1] - a[1]);

  const refetching = report.isPlaceholderData || entries.isPlaceholderData;

  return (
    <PageContainer>
      <PageHeader title={tt("reports")} subtitle={tt("admReportsSubtitle", { days: range })} />
      <ReportFilters
        range={range}
        onRange={setRange}
        projectId={projectId}
        onProject={(id) => {
          setProjectId(id);
          setMilestoneId(ALL);
        }}
        milestoneId={milestoneId}
        onMilestone={setMilestoneId}
        unit={unit}
        onUnit={setUnit}
        projects={projects}
        milestones={milestones}
      />
      {report.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">{tt("admLoading")}</p>
      ) : report.isError ? (
        <p className="mt-6 text-sm text-destructive">{tt("admReportsFailed")}</p>
      ) : (
        <div
          className={cn("space-y-4 transition-opacity", refetching && "opacity-60")}
          aria-busy={refetching}
        >
          <ReportTiles rows={rows} />
          <BurndownChart rows={rows} unit={unit} due={due} dueLabel={dueLabel} today={today} />
          <TrendCharts rows={rows} days={range} />
          {focusTotal > 0 && (
            <FocusBreakdown
              total={focusTotal}
              byProject={sum((e) => projectOf(e) ?? "none").map(([pid, sec]) => {
                const p = projects.find((x) => x.id === pid);
                return { id: pid, sec, label: p?.name ?? tt("admNoProject"), color: p?.color };
              })}
              byTask={sum((e) => e.task_id)
                .slice(0, 10)
                .map(([tid, sec]) => {
                  const t = tasks.find((x) => x.id === tid);
                  return {
                    id: tid,
                    sec,
                    label: t?.title ?? tt("admDeletedTask"),
                    suffix: t?.estimate_minutes
                      ? ` / ${tt("admEstimateSuffix", { min: t.estimate_minutes })}`
                      : undefined,
                  };
                })}
            />
          )}
        </div>
      )}
    </PageContainer>
  );
}
