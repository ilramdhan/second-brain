import { useQuery, useQueryClient } from "@tanstack/react-query";

import { HABIT_LOG_COLS, habitLogsQuery, habitsQuery } from "@/features/habits/api";
import type { Habit, HabitLog } from "@/features/habits/types";
import { useCrud } from "@/features/shared/crud";
import { qk } from "@/features/shared/query-keys";
import { getUid } from "@/features/shared/session";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { toastError } from "@/lib/errors";

export function useHabits() {
  return useQuery(habitsQuery);
}

export function useHabitLogs() {
  return useQuery(habitLogsQuery);
}

/** Create/update/archive/trash habits (soft delete like tasks and notes; /archive restores). */
export const useHabitActions = () =>
  useCrud<Habit, TablesInsert<"habits">, TablesUpdate<"habits">>("habits", qk.habits);

/**
 * Check-ins. `setCount(habit, date, n)` writes the day's count (an upsert on habit + date; 0
 * deletes the row) with an optimistic cache update, rolled back on error. `toggle` is the
 * one-tap check-in: below the target it adds one, at the target it clears the day.
 */
export function useHabitLogActions() {
  const qc = useQueryClient();

  async function setCount(habit: Pick<Habit, "id">, date: string, count: number) {
    const prev = qc.getQueryData<HabitLog[]>(qk.habitLogs);
    const rest = (prev ?? []).filter((l) => !(l.habit_id === habit.id && l.date === date));
    const old = prev?.find((l) => l.habit_id === habit.id && l.date === date);
    qc.setQueryData<HabitLog[]>(
      qk.habitLogs,
      count > 0
        ? [
            ...rest,
            {
              id: old?.id ?? `tmp-${habit.id}-${date}`,
              habit_id: habit.id,
              date,
              count,
              note: old?.note ?? null,
            },
          ]
        : rest,
    );
    try {
      if (count > 0) {
        const user_id = await getUid();
        const { data, error } = await supabase
          .from("habit_logs")
          .upsert(
            { habit_id: habit.id, user_id, date, count, updated_at: new Date().toISOString() },
            { onConflict: "habit_id,date" },
          )
          .select(HABIT_LOG_COLS)
          .single();
        if (error) throw error;
        qc.setQueryData<HabitLog[]>(qk.habitLogs, (cur) =>
          (cur ?? []).filter((l) => !(l.habit_id === habit.id && l.date === date)).concat(data),
        );
      } else {
        const { error } = await supabase
          .from("habit_logs")
          .delete()
          .eq("habit_id", habit.id)
          .eq("date", date);
        if (error) throw error;
      }
    } catch (error) {
      qc.setQueryData(qk.habitLogs, prev);
      toastError(error);
      void qc.invalidateQueries({ queryKey: qk.habitLogs });
    }
  }

  function countOf(habitId: string, date: string) {
    return (
      qc
        .getQueryData<HabitLog[]>(qk.habitLogs)
        ?.find((l) => l.habit_id === habitId && l.date === date)?.count ?? 0
    );
  }

  function toggle(habit: Pick<Habit, "id" | "target">, date: string) {
    const current = countOf(habit.id, date);
    const target = Math.max(1, habit.target);
    return setCount(habit, date, current >= target ? 0 : current + 1);
  }

  return { setCount, toggle };
}
