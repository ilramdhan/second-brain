import type { Tables } from "@/integrations/supabase/types";

/** A habit as the list loads it (`HABIT_COLS`: no archive/trash flags). */
export type Habit = Omit<Tables<"habits">, "archived_at" | "deleted_at">;
export type HabitLog = Pick<Tables<"habit_logs">, "id" | "habit_id" | "date" | "count" | "note">;
