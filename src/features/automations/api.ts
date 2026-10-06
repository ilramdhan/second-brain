import { queryOptions } from "@tanstack/react-query";

import { qk } from "@/features/shared/query-keys";
import { supabase } from "@/integrations/supabase/client";

export const AUTOMATION_COLS =
  "id,user_id,name,enabled,trigger,conditions,actions,run_count,last_run_at,created_at,schedule_cron,schedule_tz,next_run_at";

export const automationsQuery = queryOptions({
  queryKey: qk.automations,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("automations")
      .select(AUTOMATION_COLS)
      .order("created_at");
    if (error) throw error;
    return data;
  },
});
