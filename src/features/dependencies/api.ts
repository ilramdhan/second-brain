import { queryOptions } from "@tanstack/react-query";

import type { Dependency } from "@/features/dependencies/types";
import { qk } from "@/features/shared/query-keys";
import type { Task } from "@/features/tasks/types";
import { supabase } from "@/integrations/supabase/client";

export const DEP_COLS = "id,blocker_id,blocked_id";

export const depsQuery = queryOptions({
  queryKey: qk.deps,
  queryFn: async () => {
    const { data, error } = await supabase.from("task_dependencies").select(DEP_COLS);
    if (error) throw error;
    return data;
  },
});

/** Tasks that block `taskId` and are not done yet. */
export function openBlockers(taskId: string, deps: Dependency[], tasks: Task[]) {
  return deps
    .filter((d) => d.blocked_id === taskId)
    .map((d) => tasks.find((t) => t.id === d.blocker_id))
    .filter((t): t is Task => !!t && t.status !== "done");
}
