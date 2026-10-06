import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { automationsQuery } from "@/features/automations/api";
import type { Automation } from "@/features/automations/types";
import { useCrud } from "@/features/shared/crud";
import { qk } from "@/features/shared/query-keys";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { scheduleAutomation } from "@/lib/automations.functions";
import { toastError } from "@/lib/errors";
import { patchCached } from "@/lib/query-cache";

export function useAutomations() {
  return useQuery(automationsQuery);
}

/**
 * CRUD for rules. After a create/update the server recomputes `next_run_at` (cron validated by
 * the server's parser, `scheduleAutomation`), so the n8n tick only sees valid, enabled schedules.
 */
export function useAutomationActions() {
  const qc = useQueryClient();
  const crud = useCrud<Automation, TablesInsert<"automations">, TablesUpdate<"automations">>(
    "automations",
    qk.automations,
  );
  const schedule = useServerFn(scheduleAutomation);

  /** Returns false (and shows the reason) when the schedule is invalid. */
  async function reschedule(id: string) {
    try {
      const { next_run_at } = await schedule({ data: { id } });
      qc.setQueryData(qk.automations, (old: unknown) => patchCached(old, id, { next_run_at }));
      return true;
    } catch (e) {
      qc.setQueryData(qk.automations, (old: unknown) =>
        patchCached(old, id, { next_run_at: null }),
      );
      toastError(e);
      return false;
    }
  }

  async function create(input: Omit<TablesInsert<"automations">, "user_id">) {
    const row = await crud.create(input);
    if (row) await reschedule(row.id);
    return row;
  }
  async function update(id: string, patch: TablesUpdate<"automations">) {
    await crud.update(id, patch);
    await reschedule(id);
  }
  return { ...crud, create, update, reschedule };
}
