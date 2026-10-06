import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { addWeeks, endOfWeek, format, startOfWeek } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Timer } from "lucide-react";

import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { color } from "@/lib/constants";
import { useProjects, useTasks } from "@/lib/data";
import { cn } from "@/lib/utils";
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

const fmt = (sec: number) => {
  const h = Math.floor(sec / 3600),
    m = Math.round((sec % 3600) / 60);
  return h ? `${h} j ${m} m` : `${m} m`;
};

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
  const maxDay = Math.max(1, ...days.map((x) => x.sec));

  return (
    <PageContainer>
      <PageHeader
        title="Laporan Fokus"
        subtitle={`${format(from, "d MMM", { locale: localeId })} – ${format(to, "d MMM yyyy", { locale: localeId })}`}
        actions={
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setOffset(offset - 1)}
              aria-label="Minggu sebelumnya"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(0)}
              disabled={offset === 0}
            >
              Minggu ini
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setOffset(offset + 1)}
              disabled={offset >= 0}
              aria-label="Minggu berikutnya"
            >
              <ChevronRight />
            </Button>
          </div>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-md border bg-card p-5">
          <p className="text-xs text-muted-foreground">Total fokus</p>
          <p className="mt-1 text-2xl font-semibold">{fmt(total)}</p>
          <p className="text-xs text-muted-foreground">{focus.length} sesi</p>
        </section>
        <section className="rounded-md border bg-card p-5 md:col-span-2">
          <p className="mb-3 text-xs text-muted-foreground">Per hari</p>
          <div className="flex h-28 items-end gap-2">
            {days.map(({ d, sec }) => (
              <div key={d.toISOString()} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-sm bg-primary/70"
                  style={{ height: `${(sec / maxDay) * 88}px`, minHeight: sec ? 4 : 0 }}
                  title={fmt(sec)}
                />
                <span className="text-[10px] capitalize text-muted-foreground">
                  {format(d, "EEE", { locale: localeId })}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Memuat…</p>
      ) : total === 0 ? (
        <div className="mt-6 rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          <Timer className="mx-auto mb-2 h-6 w-6" />
          Belum ada sesi fokus minggu ini. Mulai timer dari detail tugas.
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded-md border bg-card p-5">
            <h2 className="mb-3 font-semibold">Per proyek</h2>
            <ul className="space-y-3">
              {byProject.map(([pid, sec]) => {
                const p = projects.find((x) => x.id === pid);
                return (
                  <li key={pid}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="flex items-center gap-2 truncate">
                        {p && <span className={cn("h-2 w-2 rounded-full", color(p.color).dot)} />}
                        {p?.name ?? "Tanpa proyek"}
                      </span>
                      <span className="text-muted-foreground">
                        {fmt(sec)} · {Math.round((sec / total) * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(sec / total) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="rounded-md border bg-card p-5">
            <h2 className="mb-3 font-semibold">Tugas teratas</h2>
            <ul className="divide-y">
              {byTask.map(([tid, sec]) => {
                const t = tasks.find((x) => x.id === tid);
                return (
                  <li key={tid} className="flex justify-between gap-3 py-2 text-sm">
                    <span className="truncate">{t?.title ?? "Tugas terhapus"}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {fmt(sec)}
                      {t?.estimate_minutes ? ` / est. ${t.estimate_minutes} m` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </PageContainer>
  );
}
