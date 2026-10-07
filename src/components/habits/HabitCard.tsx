import { Archive, Check, Flame, MoreHorizontal, Pencil, Trash2, Trophy } from "lucide-react";

import { asDate } from "@/components/reports/points";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { color } from "@/lib/constants";
import type { Habit, HabitLog } from "@/lib/data";
import { completion, describeSchedule, isScheduled, streaks, weekdayLabels } from "@/lib/habits";
import { useI18n } from "@/lib/preferences";
import { addDays } from "@/lib/reports";
import { cn } from "@/lib/utils";

const dayName = (iso: string, intl: string) =>
  asDate(iso).toLocaleDateString(intl, { weekday: "long", day: "numeric", month: "long" });

/**
 * One habit: today's check-in button (a 48px target; with a target above 1 every tap adds one
 * and a full day clears), the week grid (tap any past day to fix it), current/longest streak and
 * the 30-day completion. Done state is never colour-only: a check icon and the text say it too.
 */
export function HabitCard({
  habit,
  logs,
  today,
  since,
  week,
  projectName,
  onToggle,
  onEdit,
  onArchive,
  onDelete,
}: {
  habit: Habit;
  logs: readonly HabitLog[];
  today: string;
  since: string;
  week: readonly string[];
  projectName?: string | null | undefined;
  onToggle: (date: string) => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { t, intl } = useI18n();
  const labels = weekdayLabels();
  const tone = color(habit.color);
  const target = Math.max(1, habit.target);
  const countOn = (d: string) =>
    logs.find((l) => l.habit_id === habit.id && l.date === d)?.count ?? 0;
  const todayCount = countOn(today);
  const doneToday = todayCount >= target;
  const streak = streaks(habit, logs, today, since);
  const rate = completion(habit, logs, { from: addDays(today, -29), to: today }, today, since);
  const unit = streak.unit === "week" ? t("admStreakWeek") : t("admStreakDay");

  return (
    <li className="min-w-0 rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggle(today)}
          aria-pressed={doneToday}
          aria-label={
            doneToday
              ? t("admCheckinDone", { name: habit.name })
              : t("admCheckin", { name: habit.name, count: todayCount, target })
          }
          className={cn(
            "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
            doneToday
              ? cn("border-transparent text-background", tone.bar)
              : "border-muted-foreground/40",
          )}
        >
          {doneToday ? (
            <Check className="h-6 w-6" aria-hidden />
          ) : target > 1 ? (
            <span className="text-xs font-semibold tabular-nums" aria-hidden>
              {todayCount}/{target}
            </span>
          ) : null}
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">{habit.name}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {describeSchedule(habit)}
            {projectName ? ` · ${projectName}` : ""}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Flame className="h-3.5 w-3.5" aria-hidden />
              <strong className="font-semibold text-foreground">{streak.current}</strong> {unit}{" "}
              {t("admStreak")}
            </span>
            <span className="flex items-center gap-1">
              <Trophy className="h-3.5 w-3.5" aria-hidden />
              {t("admLongest")}{" "}
              <strong className="font-semibold text-foreground">{streak.longest}</strong>
            </span>
            <span>
              {t("admLast30")}{" "}
              <strong className="font-semibold text-foreground">
                {rate.rate === null ? "–" : `${Math.round(rate.rate * 100)}%`}
              </strong>
            </span>
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              aria-label={t("admActionsFor", { name: habit.name })}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden /> {t("admEdit")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchive}>
              <Archive aria-hidden /> {t("admArchiveAction")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-destructive">
              <Trash2 aria-hidden /> {t("admDelete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ol className="mt-3 grid grid-cols-7 gap-1" aria-label={t("admWeekOf", { name: habit.name })}>
        {week.map((d, i) => {
          const n = countOn(d);
          const done = n >= target;
          const future = d > today;
          const before = d < since;
          const off = !isScheduled(habit, d);
          return (
            <li key={d}>
              <button
                type="button"
                disabled={future || before}
                onClick={() => onToggle(d)}
                aria-pressed={done}
                aria-label={`${dayName(d, intl)}: ${done ? t("admDayDone") : n > 0 ? `${n}/${target}` : off ? t("admDayOff") : t("admDayNotYet")}`}
                className={cn(
                  "flex h-11 w-full flex-col items-center justify-center rounded-lg border text-[10px] leading-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40",
                  done
                    ? cn("border-transparent font-medium text-background", tone.bar)
                    : off
                      ? "border-dashed text-muted-foreground"
                      : "bg-card text-muted-foreground",
                  d === today && !done && "border-foreground/50",
                )}
              >
                <span aria-hidden>{labels[i]}</span>
                <span aria-hidden className="tabular-nums">
                  {done ? <Check className="mx-auto h-3 w-3" /> : asDate(d).getDate()}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </li>
  );
}
