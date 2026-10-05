import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, addMonths, addWeeks, format, startOfDay } from "date-fns";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { notifyUnblocked, runAutomations } from "@/lib/automations.functions";
import type { Trigger } from "@/lib/automation-types";

export type Task = Tables<"tasks">;
export type Project = Tables<"projects">;
export type Note = Tables<"notes">;
export type Milestone = Tables<"milestones">;
export type Dependency = Tables<"task_dependencies">;
export type Automation = Tables<"automations">;
export type Person = { user_id: string; display_name: string | null; email: string; role: string };

export const qk = {
  tasks: ["tasks"] as const,
  projects: ["projects"] as const,
  notes: ["notes"] as const,
  milestones: ["milestones"] as const,
  deps: ["deps"] as const,
  automations: ["automations"] as const,
};

export async function getUid() {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Sesi berakhir, silakan masuk lagi");
  return id;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getSession()).data.session?.user ?? null,
    staleTime: Infinity,
  });
}

export function useTasks() {
  return useQuery({
    queryKey: qk.tasks,
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*").is("deleted_at", null).is("archived_at", null).order("position").order("created_at");
      if (error) throw error;
      return data;
    },
  });
}
export function useProjects() {
  return useQuery({
    queryKey: qk.projects,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").is("deleted_at", null).order("position").order("name");
      if (error) throw error;
      return data;
    },
  });
}
export function useNotes() {
  return useQuery({
    queryKey: qk.notes,
    queryFn: async () => {
      const { data, error } = await supabase.from("notes").select("*").is("deleted_at", null).is("archived_at", null).order("pinned", { ascending: false }).order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
export function useMilestones() {
  return useQuery({
    queryKey: qk.milestones,
    queryFn: async () => {
      const { data, error } = await supabase.from("milestones").select("*").order("due_date", { nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });
}
export function useDeps() {
  return useQuery({
    queryKey: qk.deps,
    queryFn: async () => {
      const { data, error } = await supabase.from("task_dependencies").select("*");
      if (error) throw error;
      return data;
    },
  });
}
export function useAutomations() {
  return useQuery({
    queryKey: qk.automations,
    queryFn: async () => {
      const { data, error } = await supabase.from("automations").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

/** Tasks that block `taskId` and are not done yet. */
export function openBlockers(taskId: string, deps: Dependency[], tasks: Task[]) {
  return deps
    .filter((d) => d.blocked_id === taskId)
    .map((d) => tasks.find((t) => t.id === d.blocker_id))
    .filter((t): t is Task => !!t && t.status !== "done");
}

export function usePeople(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["people", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_project_people", { _project_id: projectId! });
      if (error) throw error;
      return (data ?? []) as Person[];
    },
  });
}

type TableName = "tasks" | "projects" | "notes" | "milestones" | "automations";

function useCrud<Row extends { id: string }, Ins, Upd>(table: TableName, key: readonly string[]) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = () => supabase.from(table) as any;

  async function create(input: Omit<Ins, "user_id">): Promise<Row | null> {
    const user_id = await getUid();
    const { data, error } = await from().insert({ ...input, user_id }).select().single();
    if (error) {
      toast.error(error.message);
      return null;
    }
    await invalidate();
    return data as Row;
  }
  async function update(id: string, patch: Upd) {
    qc.setQueryData<Row[]>(key, (old) => old?.map((r) => (r.id === id ? ({ ...r, ...patch } as Row) : r)));
    const withTs = table === "milestones" || table === "automations" ? patch : { ...patch, updated_at: new Date().toISOString() };
    const { error } = await from().update(withTs).eq("id", id);
    if (error) toast.error(error.message);
    invalidate();
  }
  async function remove(id: string) {
    qc.setQueryData<Row[]>(key, (old) => old?.filter((r) => r.id !== id));
    const soft = table === "tasks" || table === "notes" || table === "projects";
    const now = new Date().toISOString();
    const { error } = soft ? await from().update({ deleted_at: now }).eq("id", id) : await from().delete().eq("id", id);
    if (!error && table === "tasks") await from().update({ deleted_at: now }).eq("parent_id", id).is("deleted_at", null);
    if (error) toast.error(error.message);
    else if (soft) toast.message("Dipindah ke Tempat Sampah — bisa dikembalikan dalam 30 hari");
    invalidate();
    qc.invalidateQueries({ queryKey: ["bin"] });
  }
  async function archive(id: string) {
    qc.setQueryData<Row[]>(key, (old) => old?.filter((r) => r.id !== id));
    const { error } = await from().update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); else toast.message("Diarsipkan");
    invalidate();
    qc.invalidateQueries({ queryKey: ["bin"] });
  }
  return { create, update, remove, archive, invalidate };
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
    const snap = before && { status: before.status, priority: before.priority, assignee_name: before.assignee_name, assignee_id: before.assignee_id, due_date: before.due_date };
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

  async function update(id: string, patch: TablesUpdate<"tasks">) {
    const tasks = getTasks();
    const before = tasks.find((t) => t.id === id);
    await crud.update(id, patch);
    if (!before) return;
    // Auto-shift dependents when a blocker's deadline is pushed later.
    if (patch.due_date && before.due_date) {
      const delta = new Date(patch.due_date).getTime() - new Date(before.due_date).getTime();
      if (delta > 0) {
        const deps = getDeps();
        const seen = new Set([id]);
        const queue = [id];
        let shifted = 0;
        while (queue.length) {
          const cur = queue.shift()!;
          for (const d of deps.filter((x) => x.blocker_id === cur)) {
            if (seen.has(d.blocked_id)) continue;
            seen.add(d.blocked_id);
            queue.push(d.blocked_id);
            const t = tasks.find((x) => x.id === d.blocked_id);
            if (!t || t.status === "done" || (!t.due_date && !t.start_date)) continue;
            const mv = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + delta).toISOString() : null);
            await crud.update(t.id, { start_date: mv(t.start_date), due_date: mv(t.due_date), reminded: false });
            shifted++;
          }
        }
        if (shifted) toast.message(`${shifted} tugas yang bergantung ikut digeser`);
      }
    }
    automate("updated", { ...before, ...patch } as Task, before);
  }

  async function setStatus(task: Task, status: string) {
    const done = status === "done";
    if (status !== "todo") {
      const blockers = openBlockers(task.id, getDeps(), getTasks());
      if (blockers.length) {
        toast.error(`Terkunci: tunggu "${blockers[0]!.title}" selesai dulu`);
        return;
      }
    }
    await update(task.id, { status, completed_at: done ? new Date().toISOString() : null });
    if (done && task.status !== "done") {
      const tasks = getTasks().map((t) => (t.id === task.id ? { ...t, status: "done" } : t));
      const deps = getDeps();
      const freed = deps
        .filter((d) => d.blocker_id === task.id)
        .map((d) => d.blocked_id)
        .filter((bid) => openBlockers(bid, deps, tasks).length === 0);
      if (freed.length) {
        const names = freed.map((f) => tasks.find((t) => t.id === f)?.title).filter(Boolean);
        toast.success(`Tidak terkunci lagi: ${names.join(", ")}`);
        notify({ data: { taskIds: freed, blockerTitle: task.title } }).catch(() => {});
      }
    }
    if (done && task.status !== "done" && task.recurrence && task.due_date) {
      const shift = (d: string | null) => {
        if (!d) return null;
        const x = new Date(d);
        const n = task.recurrence === "daily" ? addDays(x, 1) : task.recurrence === "weekly" ? addWeeks(x, 1) : addMonths(x, 1);
        return n.toISOString();
      };
      await create({
        title: task.title,
        description: task.description,
        priority: task.priority,
        project_id: task.project_id,
        milestone_id: task.milestone_id,
        assignee_id: task.assignee_id,
        assignee_name: task.assignee_name,
        tags: task.tags,
        recurrence: task.recurrence,
        start_date: shift(task.start_date),
        due_date: shift(task.due_date),
      });
      toast.success("Tugas berulang berikutnya dibuat");
    }
  }
  return { ...crud, create, update, setStatus };
}

export function useDependencyActions() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: qk.deps });
  async function add(blocker_id: string, blocked_id: string) {
    const deps = qc.getQueryData<Dependency[]>(qk.deps) ?? [];
    // reject cycles: blocked_id must not (transitively) block blocker_id
    const stack = [blocked_id];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === blocker_id) { toast.error("Tidak bisa: akan membuat ketergantungan melingkar"); return; }
      if (seen.has(cur)) continue;
      seen.add(cur);
      deps.filter((d) => d.blocker_id === cur).forEach((d) => stack.push(d.blocked_id));
    }
    const user_id = await getUid();
    const { error } = await supabase.from("task_dependencies").insert({ blocker_id, blocked_id, user_id });
    if (error) toast.error(error.message);
    inv();
  }
  async function remove(id: string) {
    qc.setQueryData<Dependency[]>(qk.deps, (o) => o?.filter((d) => d.id !== id));
    const { error } = await supabase.from("task_dependencies").delete().eq("id", id);
    if (error) toast.error(error.message);
    inv();
  }
  return { add, remove };
}

export const useProjectActions = () =>
  useCrud<Project, TablesInsert<"projects">, TablesUpdate<"projects">>("projects", qk.projects);
export const useNoteActions = () => useCrud<Note, TablesInsert<"notes">, TablesUpdate<"notes">>("notes", qk.notes);
export const useMilestoneActions = () =>
  useCrud<Milestone, TablesInsert<"milestones">, TablesUpdate<"milestones">>("milestones", qk.milestones);

/* ---------- date helpers ---------- */
export const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
/** Date-only string (yyyy-MM-dd) → ISO timestamp at 17:00 local time. */
export const dateToIso = (s: string, hour = 17) => (s ? new Date(`${s}T${String(hour).padStart(2, "0")}:00:00`).toISOString() : null);
export const isoToDate = (iso: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd") : "");

export function taskRange(t: Pick<Task, "start_date" | "due_date">) {
  const s = t.start_date ?? t.due_date;
  const e = t.due_date ?? t.start_date;
  if (!s || !e) return null;
  const start = startOfDay(new Date(s));
  const end = startOfDay(new Date(e));
  return start <= end ? { start, end } : { start: end, end: start };
}

export function shiftIso(iso: string | null, days: number) {
  return iso ? addDays(new Date(iso), days).toISOString() : null;
}

export const useAutomationActions = () =>
  useCrud<Automation, TablesInsert<"automations">, TablesUpdate<"automations">>("automations", qk.automations);
