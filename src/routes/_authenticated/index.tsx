import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isBefore,
  isToday,
  startOfDay,
  subDays,
} from "date-fns";
import { id as localeId } from "date-fns/locale";
import { ArrowRight, Diamond, Inbox as InboxIcon, Plus, Rocket } from "lucide-react";

import { useTaskDialog } from "@/components/tasks/TaskDialogProvider";
import { TaskRow } from "@/components/tasks/TaskItem";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { color } from "@/lib/constants";
import {
  taskRange,
  useMe,
  useMilestones,
  useProjects,
  useTasks,
  type Project,
  type Task,
} from "@/lib/data";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/common/PageContainer";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Hari Ini — Second Brain" },
      {
        name: "description",
        content:
          "Agenda harian: tugas terlambat, jatuh tempo hari ini, minggu ini, dan milestone terdekat.",
      },
      { property: "og:title", content: "Hari Ini — Second Brain" },
      { property: "og:description", content: "Asisten catatan dan tugas pribadi dengan AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: tasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const { data: milestones = [] } = useMilestones();
  const { data: me } = useMe();
  const { newTask } = useTaskDialog();
  const { data: inboxCount = 0 } = useQuery({
    queryKey: ["inbox-count"],
    queryFn: async () =>
      (
        await supabase
          .from("inbox_items")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
      ).count ?? 0,
  });

  const today = startOfDay(new Date());
  const top = tasks.filter((t) => !t.parent_id);
  const open = top.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.due_date && isBefore(new Date(t.due_date), today));
  const todayList = open.filter((t) => {
    const r = taskRange(t);
    return r && r.start <= today && r.end >= today && !overdue.includes(t);
  });
  const week = open.filter(
    (t) =>
      t.due_date &&
      new Date(t.due_date) >= addDays(today, 1) &&
      new Date(t.due_date) < addDays(today, 8) &&
      !todayList.includes(t),
  );
  const doneWeek = top.filter(
    (t) => t.completed_at && new Date(t.completed_at) >= subDays(today, 7),
  ).length;
  const inProgress = open.filter((t) => t.status === "in_progress" || t.status === "review");

  const upcomingMarks = [
    ...milestones
      .filter((m) => !m.done && m.due_date)
      .map((m) => ({
        id: m.id,
        title: m.title,
        date: m.due_date!,
        kind: "ms" as const,
        project: projects.find((p) => p.id === m.project_id),
      })),
    ...projects
      .filter((p) => p.launch_date)
      .map((p) => ({
        id: p.id,
        title: `Launch ${p.name}`,
        date: p.launch_date!,
        kind: "launch" as const,
        project: p,
      })),
  ]
    .filter((x) => differenceInCalendarDays(new Date(`${x.date}T00:00:00`), today) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const name = (me?.email ?? "").split("@")[0];

  return (
    <PageContainer>
      <header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div className="min-w-0">
          <p className="text-sm capitalize text-muted-foreground">
            {format(new Date(), "EEEE, d MMMM yyyy", { locale: localeId })}
          </p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            Halo{name ? `, ${name}` : ""}
          </h1>
        </div>
        <Button
          size="sm"
          onClick={() =>
            newTask({ due_date: new Date(`${format(today, "yyyy-MM-dd")}T17:00:00`).toISOString() })
          }
        >
          <Plus /> Tugas hari ini
        </Button>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Hari ini" value={todayList.length} />
        <Stat
          label="Terlambat"
          value={overdue.length}
          tone={overdue.length ? "text-priority-high" : undefined}
        />
        <Stat label="Sedang dikerjakan" value={inProgress.length} />
        <Stat label="Selesai 7 hari" value={doneWeek} tone="text-success" />
      </div>

      {inboxCount > 0 && (
        <Link
          to="/inbox"
          className="mb-6 flex items-center justify-between rounded-xl border bg-inbox px-4 py-3 text-sm font-medium text-inbox-foreground"
        >
          <span className="flex items-center gap-2">
            <InboxIcon className="h-4 w-4" />
            {inboxCount} catatan menunggu dirapikan di Inbox
          </span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section
            title="Terlambat"
            tasks={overdue}
            tone="text-priority-high"
            projects={projects}
            all={tasks}
          />
          <Section
            title="Hari ini"
            tasks={todayList}
            projects={projects}
            all={tasks}
            empty="Tidak ada tugas untuk hari ini. Nikmati harimu, atau tarik sesuatu dari Upcoming."
          />
          <Section title="7 hari ke depan" tasks={week} projects={projects} all={tasks} />
        </div>
        <aside className="space-y-4">
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Milestone & launch terdekat</h2>
            <ul className="space-y-2.5">
              {upcomingMarks.map((m) => (
                <li key={m.id + m.kind} className="flex items-start gap-2 text-sm">
                  {m.kind === "launch" ? (
                    <Rocket className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <Diamond className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {isToday(new Date(`${m.date}T00:00:00`))
                        ? "Hari ini"
                        : `${differenceInCalendarDays(new Date(`${m.date}T00:00:00`), today)} hari lagi`}
                      {m.project && m.kind === "ms" && ` · ${m.project.name}`}
                    </p>
                  </div>
                </li>
              ))}
              {upcomingMarks.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  Belum ada. Tambahkan di halaman detail proyek.
                </li>
              )}
            </ul>
          </section>
          <section className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Proyek aktif</h2>
              <Link to="/projects" className="text-xs text-muted-foreground hover:text-foreground">
                Semua
              </Link>
            </div>
            <ul className="space-y-3">
              {projects
                .filter((p) => p.status === "active" && p.para_type === "project")
                .slice(0, 5)
                .map((p) => {
                  const ts = top.filter((t) => t.project_id === p.id);
                  const pct = ts.length
                    ? Math.round((ts.filter((t) => t.status === "done").length / ts.length) * 100)
                    : 0;
                  return (
                    <li key={p.id}>
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: p.id }}
                        className="block"
                      >
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="truncate font-medium">{p.name}</span>
                          <span className="text-muted-foreground">{pct}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn("h-full rounded-full", color(p.color).bar)}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </section>
        </aside>
      </div>
    </PageContainer>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string | undefined }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", tone)}>{value}</p>
    </div>
  );
}

function Section({
  title,
  tasks,
  tone,
  projects,
  all,
  empty,
}: {
  title: string;
  tasks: Task[];
  tone?: string | undefined;
  projects: Project[];
  all: Task[];
  empty?: string | undefined;
}) {
  if (tasks.length === 0 && !empty) return null;
  return (
    <section>
      <h2 className={cn("mb-2 text-sm font-semibold", tone)}>
        {title} <span className="font-normal text-muted-foreground">{tasks.length || ""}</span>
      </h2>
      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} projects={projects} allTasks={all} />
          ))}
        </ul>
      )}
    </section>
  );
}
