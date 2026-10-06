import { useQuery } from "@tanstack/react-query";

import { milestonesQuery } from "@/features/milestones/api";
import type { Milestone } from "@/features/milestones/types";
import { useCrud } from "@/features/shared/crud";
import { qk } from "@/features/shared/query-keys";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export function useMilestones() {
  return useQuery(milestonesQuery);
}

export const useMilestoneActions = () =>
  useCrud<Milestone, TablesInsert<"milestones">, TablesUpdate<"milestones">>(
    "milestones",
    qk.milestones,
  );
