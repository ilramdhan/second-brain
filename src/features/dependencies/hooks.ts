import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { DEP_COLS, depsQuery } from "@/features/dependencies/api";
import type { Dependency } from "@/features/dependencies/types";
import { qk } from "@/features/shared/query-keys";
import { getUid } from "@/features/shared/session";
import { supabase } from "@/integrations/supabase/client";
import { insertRow, removeRows } from "@/lib/query-cache";
import { toastError } from "@/lib/errors";
import { createsDependencyCycle } from "@/lib/task-rules";

export function useDeps() {
  return useQuery(depsQuery);
}

export function useDependencyActions() {
  const qc = useQueryClient();
  async function add(blocker_id: string, blocked_id: string) {
    const deps = qc.getQueryData<Dependency[]>(qk.deps) ?? [];
    // reject cycles: blocked_id must not (transitively) block blocker_id
    const cycle = await createsDependencyCycle(blocker_id, blocked_id, (ids) =>
      deps.filter((d) => ids.includes(d.blocker_id)).map((d) => d.blocked_id),
    );
    if (cycle) {
      toast.error("Tidak bisa: akan membuat ketergantungan melingkar");
      return;
    }
    const user_id = await getUid();
    const { data, error } = await supabase
      .from("task_dependencies")
      .insert({ blocker_id, blocked_id, user_id })
      .select(DEP_COLS)
      .single();
    if (error) {
      toastError(error);
      return;
    }
    qc.setQueryData<Dependency[]>(qk.deps, (o) => insertRow(o, data));
  }
  async function remove(id: string) {
    const prev = qc.getQueryData<Dependency[]>(qk.deps);
    qc.setQueryData<Dependency[]>(qk.deps, (o) => removeRows(o, (d) => d.id === id));
    const { error } = await supabase.from("task_dependencies").delete().eq("id", id);
    if (error) {
      qc.setQueryData(qk.deps, prev);
      toastError(error);
    }
  }
  return { add, remove };
}
