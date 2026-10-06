import { useQuery } from "@tanstack/react-query";

import { automationsQuery } from "@/features/automations/api";
import type { Automation } from "@/features/automations/types";
import { useCrud } from "@/features/shared/crud";
import { qk } from "@/features/shared/query-keys";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export function useAutomations() {
  return useQuery(automationsQuery);
}

export const useAutomationActions = () =>
  useCrud<Automation, TablesInsert<"automations">, TablesUpdate<"automations">>(
    "automations",
    qk.automations,
  );
