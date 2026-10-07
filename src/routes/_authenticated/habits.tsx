import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus, Repeat } from "lucide-react";
import { useState } from "react";

import { BarChart } from "@/components/charts/BarChart";
import { PageContainer } from "@/components/common/PageContainer";
import { PageHeader } from "@/components/common/PageHeader";
import { RouteError } from "@/components/common/RouteError";
import { HabitCard } from "@/components/habits/HabitCard";
import { HabitDialog, type HabitDraft } from "@/components/habits/HabitDialog";
import { asDate } from "@/components/reports/points";
import { Button } from "@/components/ui/button";
import {
  habitLogsQuery,
  habitsQuery,
  preloadQueries,
  projectsQuery,
  useHabitActions,
  useHabitLogActions,
  useHabitLogs,
  useHabits,
  useProjects,
  type Habit,
} from "@/lib/data";
import { weekDays, weeklyCompletion } from "@/lib/habits";
import { usePreferences } from "@/lib/preferences";
import { addDays, localIsoDate } from "@/lib/reports";

export const Route = createFileRoute("/_authenticated/habits")({
  head: () => ({
    meta: [
      { title: "Kebiasaan — Second Brain" },
      {
        name: "description",
        content: "Check-in kebiasaan harian, streak dan tingkat konsistensi.",
      },
      { property: "og:title", content: "Kebiasaan — Second Brain" },
      {
        property: "og:description",
        content: "Check-in kebiasaan harian, streak dan tingkat konsistensi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) =>
    preloadQueries(context.queryClient, habitsQuery, habitLogsQuery, projectsQuery),
  component: HabitsPage,
  errorComponent: RouteError,
});

const WEEKS = 8;
const pct = (v: number) => `${Math.round(v)}%`;

function HabitsPage() {
  const { t, intl } = usePreferences();
  const { data: habits = [], isLoading } = useHabits();
  const { data: logs = [] } = useHabitLogs();
  const { data: projects = [] } = useProjects();
  const actions = useHabitActions();
  const logActions = useHabitLogActions();
  const [editing, setEditing] = useState<Habit | null>(null);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);

  const today = localIsoDate();
  const week = weekDays(today, offset);
  // A habit's first local day: check-ins before it (and streak/rate days) do not count.
  const sinceOf = (h: Pick<Habit, "created_at">) => localIsoDate(new Date(h.created_at));
  const weekly = weeklyCompletion(habits, logs, today, WEEKS, sinceOf);
  const doneToday = habits.filter((h) =>
    logs.some((l) => l.habit_id === h.id && l.date === today && l.count >= Math.max(1, h.target)),
  ).length;

  async function save(d: HabitDraft) {
    if (editing) await actions.update(editing.id, d);
    else await actions.create({ ...d, position: habits.length });
  }
  const edit = (h: Habit | null) => {
    setEditing(h);
    setOpen(true);
  };

  return (
    <PageContainer>
      <PageHeader
        title={t("habits")}
        subtitle={
          habits.length
            ? t("admHabitsDoneToday", { done: doneToday, total: habits.length })
            : t("admHabitsSubtitle")
        }
        actions={
          <Button className="h-11 sm:h-9" onClick={() => edit(null)}>
            <Plus aria-hidden /> {t("habits")}
          </Button>
        }
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("admLoading")}</p>
      ) : habits.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground sm:p-8">
          <Repeat className="mx-auto mb-2 h-6 w-6" aria-hidden />
          {t("admHabitsEmpty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <section aria-labelledby="habits-week" className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 id="habits-week" className="text-sm font-medium text-muted-foreground">
                {offset === 0
                  ? t("admThisWeek")
                  : `${asDate(week[0]!).toLocaleDateString(intl, { day: "numeric", month: "short" })} – ${asDate(week[6]!).toLocaleDateString(intl, { day: "numeric", month: "short" })}`}
              </h2>
              <div className="flex gap-1" role="group" aria-label={t("admPickWeek")}>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 sm:h-9 sm:w-9"
                  aria-label={t("admPrevWeek")}
                  onClick={() => setOffset(offset - 1)}
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 sm:h-9 sm:w-9"
                  aria-label={t("admNextWeek")}
                  disabled={offset >= 0}
                  onClick={() => setOffset(offset + 1)}
                >
                  <ChevronRight aria-hidden />
                </Button>
              </div>
            </div>
            <ul className="space-y-3">
              {habits.map((h) => (
                <HabitCard
                  key={h.id}
                  habit={h}
                  logs={logs}
                  today={today}
                  since={sinceOf(h)}
                  week={week}
                  projectName={projects.find((p) => p.id === h.project_id)?.name}
                  onToggle={(d) => void logActions.toggle(h, d)}
                  onEdit={() => edit(h)}
                  onArchive={() => void actions.archive(h.id)}
                  onDelete={() => void actions.remove(h.id)}
                />
              ))}
            </ul>
          </section>
          <BarChart
            id="habit-rate"
            title={t("admConsistency")}
            subtitle={t("admConsistencySubtitle", { weeks: WEEKS })}
            series={[{ key: "rate", label: t("admDone"), tone: "chart-1" }]}
            points={weekly.map((w) => ({
              key: w.week,
              label: asDate(w.week).toLocaleDateString(intl, {
                day: "numeric",
                month: "numeric",
              }),
              long: `${t("admWeekRange", { from: asDate(w.week).toLocaleDateString(intl, { day: "numeric", month: "short" }), to: asDate(addDays(w.week, 6)).toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric" }) })} (${w.done}/${w.due})`,
              values: { rate: w.rate === null ? null : w.rate * 100 },
            }))}
            format={pct}
            className="self-start"
          />
        </div>
      )}
      <HabitDialog
        open={open}
        onOpenChange={setOpen}
        habit={editing}
        projects={projects}
        onSave={save}
      />
    </PageContainer>
  );
}
