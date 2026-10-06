import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { addWeeks, endOfWeek, format, startOfWeek } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { FocusBreakdown, FocusEmpty, FocusSummary } from "@/components/reports/FocusReport";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useProjects, useTasks } from "@/lib/data";
import { preloadQueries, projectsQuery, tasksQuery } from "@/lib/data";
import { RouteError } from "@/components/common/RouteError";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Laporan Fokus Mingguan — Second Brain" },
      { name: "description", content: "Ringkasan waktu fokus per proyek dan tugas setiap minggu." },
      { property: "og:title", content: "Laporan Fokus Mingguan — Second Brain" },
      {
        property: "og:description",
        content: "Ringkasan waktu fokus per proyek dan tugas setiap minggu.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => preloadQueries(context.queryClient, projectsQuery, tasksQuery),
  component: ReportsPage,
  errorComponent: RouteError,
});

function ReportsPage() {
  const [offset, setOffset] = useState(0);
  const from = startOfWeek(addWeeks(new Date(), offset), { weekStartsOn: 1 });
  const to = endOfWeek(from, { weekStartsOn: 1 });
  const { data: projects = [] } = useProjects();
  const { data: tasks = [] } = useTasks();
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["time-entries", from.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("id,task_id,project_id,duration_seconds,started_at,mode")
        .gte("started_at", from.toISOString())
        .lte("started_at", to.toISOString());
      if (error) throw error;
      return data;
    },
  });
  const focus = entries.filter((e) => e.mode !== "break");
  const total = focus.reduce((s, e) => s + e.duration_seconds, 0);
  const projectOf = (e: (typeof focus)[number]) =>
    e.project_id ?? tasks.find((t) => t.id === e.task_id)?.project_id ?? null;
  const byProject = [
    ...focus.reduce((m, e) => {
      const k = projectOf(e) ?? "none";
      m.set(k, (m.get(k) ?? 0) + e.duration_seconds);
      return m;
    }, new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);
  const byTask = [
    ...focus.reduce((m, e) => {
      if (!e.task_id) return m;
      m.set(e.task_id, (m.get(e.task_id) ?? 0) + e.duration_seconds);
      return m;
    }, new Map<string, number>()),
  ]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const key = format(d, "yyyy-MM-dd");
    return {
      d,
      sec: focus
        .filter((e) => format(new Date(e.started_at), "yyyy-MM-dd") === key)
        .reduce((s, e) => s + e.duration_seconds, 0),
    };
  });

  return (
    <PageContainer>
      <PageHeader
        title="Laporan Fokus"
        subtitle={`${format(from, "d MMM", { locale: localeId })} – ${format(to, "d MMM yyyy", { locale: localeId })}`}
        actions={
          <div className="flex gap-1" role="group" aria-label="Pilih minggu">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
              onClick={() => setOffset(offset - 1)}
              aria-label="Minggu sebelumnya"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              onClick={() => setOffset(0)}
              disabled={offset === 0}
            >
              Minggu ini
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
              onClick={() => setOffset(offset + 1)}
              disabled={offset >= 0}
              aria-label="Minggu berikutnya"
            >
              <ChevronRight />
            </Button>
          </div>
        }
      />
      <FocusSummary total={total} sessions={focus.length} days={days} />
      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Memuat…</p>
      ) : total === 0 ? (
        <FocusEmpty />
      ) : (
        <FocusBreakdown
          total={total}
          byProject={byProject.map(([pid, sec]) => {
            const p = projects.find((x) => x.id === pid);
            return { id: pid, sec, label: p?.name ?? "Tanpa proyek", color: p?.color };
          })}
          byTask={byTask.map(([tid, sec]) => {
            const t = tasks.find((x) => x.id === tid);
            return {
              id: tid,
              sec,
              label: t?.title ?? "Tugas terhapus",
              suffix: t?.estimate_minutes ? ` / est. ${t.estimate_minutes} m` : undefined,
            };
          })}
        />
      )}
    </PageContainer>
  );
}
