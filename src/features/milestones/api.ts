import { queryOptions } from "@tanstack/react-query";

import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";

export const MILESTONE_COLS = "id,user_id,project_id,title,description,due_date,done,created_at";

export const milestonesQuery = queryOptions({
  queryKey: qk.milestones,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("milestones")
      .select(MILESTONE_COLS)
      .order("due_date", { nullsFirst: false });
    if (error) throw error;
    return data;
  },
});
