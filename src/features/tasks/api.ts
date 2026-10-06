import { queryOptions } from "@tanstack/react-query";

import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";

// Columns the client never reads are left out: soft-delete/archive flags (always null in the
// lists), reminder bookkeeping and the Google event id (server-side only).
export const TASK_COLS =
  "id,user_id,project_id,parent_id,milestone_id,title,description,status,priority,tags,assignee_id,assignee_name,start_date,due_date,time_block_end,estimate_minutes,recurrence,position,completed_at,created_at,updated_at";

export const tasksQuery = queryOptions({
  queryKey: qk.tasks,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select(TASK_COLS)
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("position")
      .order("created_at");
    if (error) throw error;
    return data;
  },
});
