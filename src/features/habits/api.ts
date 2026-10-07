import { queryOptions } from "@tanstack/react-query";

import type { Habit, HabitLog } from "@/features/habits/types";
import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { addDays, localIsoDate } from "@/lib/reports";

// Archive/trash flags are always null in the list (filtered out), so they are not selected.
export const HABIT_COLS =
  "id,user_id,project_id,name,description,color,icon,schedule_type,weekdays_mask,times_per_week,target,position,created_at,updated_at";
export const HABIT_LOG_COLS = "id,habit_id,date,count,note";

/** How far back check-ins are loaded: streaks and rates look at most this far. */
export const HABIT_HISTORY_DAYS = 400;

/** The caller's active habits (RLS: own rows only; not archived, not trashed). */
export const habitsQuery = queryOptions({
  queryKey: qk.habits,
  queryFn: async (): Promise<Habit[]> => {
    const { data, error } = await supabase
      .from("habits")
      .select(HABIT_COLS)
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("position")
      .order("created_at");
    if (error) throw error;
    return data;
  },
});

/** Check-ins of the last HABIT_HISTORY_DAYS local days, every habit (paged past 1000 rows). */
export const habitLogsQuery = queryOptions({
  queryKey: qk.habitLogs,
  queryFn: async (): Promise<HabitLog[]> => {
    const since = addDays(localIsoDate(), -HABIT_HISTORY_DAYS);
    const rows: HabitLog[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("habit_logs")
        .select(HABIT_LOG_COLS)
        .gte("date", since)
        .order("date")
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  },
});
