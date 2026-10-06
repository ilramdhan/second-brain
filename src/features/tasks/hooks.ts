import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { useAutomations } from "@/features/automations/hooks";
import { openBlockers } from "@/features/dependencies/api";
import type { Dependency } from "@/features/dependencies/types";
import { restore, snapshot, useCrud } from "@/features/shared/crud";
import { qk } from "@/features/shared/query-keys";
import { TASK_COLS, tasksQuery } from "@/features/tasks/api";
import type { Task } from "@/features/tasks/types";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { notifyUnblocked, runAutomations } from "@/lib/automations.functions";
import type { Trigger } from "@/lib/automation-types";
import { insertRow, patchCached } from "@/lib/query-cache";
import {
  dueShiftMs,
  parseCompleteResult,
  pickColumns,
  type CompleteTaskOutcome,
} from "@/lib/task-rules";

export function useTasks() {
  return useQuery(tasksQuery);
}

export function useTaskActions() {
  const qc = useQueryClient();
  const crud = useCrud<Task, TablesInsert<"tasks">, TablesUpdate<"tasks">>("tasks", qk.tasks);
  const { data: rules = [] } = useAutomations();
  const run = useServerFn(runAutomations);
  const notify = useServerFn(notifyUnblocked);
  const getTasks = () => qc.getQueryData<Task[]>(qk.tasks) ?? [];
  const getDeps = () => qc.getQueryData<Dependency[]>(qk.deps) ?? [];

  function automate(event: "created" | "updated", task: Task, before?: Task) {
    const relevant = rules.some((r) => {
      if (!r.enabled) return false;
      const t = r.trigger as unknown as Trigger;
      if (event === "created") return t.type === "task_created";
      return t.type !== "task_created";
    });
    if (!relevant) return;
    const snap = before && {
      status: before.status,
      priority: before.priority,
      assignee_name: before.assignee_name,
      assignee_id: before.assignee_id,
      due_date: before.due_date,
    };
    run({ data: { event, taskId: task.id, ...(snap ? { before: snap } : {}) } })
      .then((r) => {
        if (r.ran) {
          toast.message(`Otomasi dijalankan (${r.ran})`);
          qc.invalidateQueries({ queryKey: qk.tasks });
          qc.invalidateQueries({ queryKey: ["comments", task.id] });
          qc.invalidateQueries({ queryKey: qk.automations });
        }
      })
      .catch((e) => console.error("automation failed", e));
  }

  async function create(input: Omit<TablesInsert<"tasks">, "user_id">) {
    const row = await crud.create(input);
    if (row) automate("created", row);
    return row;
  }

  /** Patches every cached task query (list and detail) holding row `id`. */
  function patchTaskCache(id: string, patch: object) {
    for (const [k, data] of qc.getQueriesData({ queryKey: qk.tasks })) {
      const next = patchCached(data, id, patch);
      if (next !== data) qc.setQueryData(k, next);
    }
  }

  async function update(id: string, patch: TablesUpdate<"tasks">) {
    const before = getTasks().find((t) => t.id === id);
    await crud.update(id, patch);
    if (!before) return;
    // Auto-shift dependents when a blocker's deadline is pushed later: one transactional RPC
    // (migration 0017) shared with the n8n service; the returned rows patch the cache.
    const delta = dueShiftMs(before.due_date, patch.due_date);
    if (delta > 0) {
      const { data, error } = await supabase.rpc("shift_task_dependents", {
        _task_id: id,
        _delta_ms: delta,
      });
      if (error) {
        toast.error(error.message);
        void crud.invalidate();
      } else if (data?.length) {
        for (const row of data) patchTaskCache(row.id, row);
        toast.message(`${data.length} tugas yang bergantung ikut digeser`);
      }
    }
    automate("updated", { ...before, ...patch } as Task, before);
  }

  /**
   * Marks a task done through the `complete_task` RPC (migration 0017): blocked check, status
   * update, unblocked dependents and the next recurring occurrence in one transaction. The
   * cache is patched optimistically and rolled back when the task turns out to be blocked.
   */
  async function complete(task: Task) {
    const snap = snapshot(qc, qk.tasks);
    const now = new Date().toISOString();
    patchTaskCache(task.id, { status: "done", completed_at: now, updated_at: now });
    const { data, error } = await supabase.rpc("complete_task", {
      _task_id: task.id,
      _tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    let result: CompleteTaskOutcome;
    try {
      if (error) throw new Error(error.message);
      result = parseCompleteResult(data);
    } catch (e) {
      restore(qc, snap);
      toast.error(e instanceof Error ? e.message : String(e));
      void crud.invalidate();
      return;
    }
    if (result.status === "blocked") {
      restore(qc, snap);
      toast.error(`Terkunci: tunggu "${result.blocker}" selesai dulu`);
      return;
    }
    patchTaskCache(task.id, pickColumns(result.task, TASK_COLS));
    if (result.status === "already_done") return;
    automate("updated", { ...task, status: "done" }, task);
    if (result.unblocked.length) {
      toast.success(`Tidak terkunci lagi: ${result.unblocked.map((u) => u.title).join(", ")}`);
      notify({
        data: { taskIds: result.unblocked.map((u) => u.id), blockerTitle: task.title },
      }).catch(() => {});
    }
    if (result.recurring) {
      const next = pickColumns(result.recurring, TASK_COLS) as Task;
      qc.setQueryData<Task[]>(qk.tasks, (old) => insertRow(old, next));
      automate("created", next);
      toast.success("Tugas berulang berikutnya dibuat");
    }
  }

  async function setStatus(task: Task, status: string) {
    if (status === "done" && task.status !== "done") return complete(task);
    if (status !== "todo") {
      const blockers = openBlockers(task.id, getDeps(), getTasks());
      if (blockers.length) {
        toast.error(`Terkunci: tunggu "${blockers[0]!.title}" selesai dulu`);
        return;
      }
    }
    await update(task.id, {
      status,
      completed_at: status === "done" ? new Date().toISOString() : null,
    });
  }
  return { ...crud, create, update, setStatus };
}
