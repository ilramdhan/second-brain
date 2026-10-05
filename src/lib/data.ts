import { useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, addMonths, addWeeks, format, startOfDay } from "date-fns";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { notifyUnblocked, runAutomations } from "@/lib/automations.functions";
import type { Trigger } from "@/lib/automation-types";
import {
  afterPinned,
  ilikePattern,
  insertRow,
  omitKeys,
  patchCached,
  pickKeys,
  removeRows,
} from "@/lib/query-cache";

/* ---------- column lists (no `select *`) ---------- */
// Columns the client never reads are left out: soft-delete/archive flags (always null in the
// lists), reminder bookkeeping and the Google event id (server-side only).
export const TASK_COLS =
  "id,user_id,project_id,parent_id,milestone_id,title,description,status,priority,tags,assignee_id,assignee_name,start_date,due_date,time_block_end,estimate_minutes,recurrence,position,completed_at,created_at,updated_at";
export const PROJECT_COLS =
  "id,user_id,parent_id,name,description,color,para_type,status,start_date,due_date,launch_date,position,created_at,updated_at";
export const MILESTONE_COLS = "id,user_id,project_id,title,description,due_date,done,created_at";
export const DEP_COLS = "id,blocker_id,blocked_id";
export const AUTOMATION_COLS =
  "id,user_id,name,enabled,trigger,conditions,actions,run_count,last_run_at,created_at";
// Notes list: everything except `blocks` (the jsonb source of truth, roughly the markdown
// mirror again plus per-block JSON). `content` stays for card previews and search; a true
// server-side excerpt needs a generated column (migration, out of scope for Phase 3).
export const NOTE_LIST_COLS =
  "id,title,content,tags,status,pinned,project_id,position,properties,created_at,updated_at";
export const NOTE_DETAIL_COLS = `${NOTE_LIST_COLS},blocks`;
/** Only what backlinks, the block index (transclusion/refs) and the graph need. */
export const NOTE_BLOCK_COLS = "id,title,tags,project_id,blocks,content";

export type Task = Omit<
  Tables<"tasks">,
  "deleted_at" | "archived_at" | "reminded" | "google_event_id"
>;
export type Project = Omit<Tables<"projects">, "deleted_at">;
/** Full note row (editor, inserts). */
export type Note = Tables<"notes">;
/** Row in the notes list cache (`qk.notes`): no `blocks`. */
export type NoteSummary = Pick<
  Note,
  | "id"
  | "title"
  | "content"
  | "tags"
  | "status"
  | "pinned"
  | "project_id"
  | "position"
  | "properties"
  | "created_at"
  | "updated_at"
>;
export type NoteDetail = NoteSummary & Pick<Note, "blocks">;
export type NoteBlocks = Pick<Note, "id" | "title" | "tags" | "project_id" | "blocks" | "content">;
export type Milestone = Tables<"milestones">;
export type Dependency = Pick<Tables<"task_dependencies">, "id" | "blocker_id" | "blocked_id">;
export type Automation = Tables<"automations">;
export type Person = { user_id: string; display_name: string | null; email: string; role: string };

export const qk = {
  tasks: ["tasks"] as const,
  projects: ["projects"] as const,
  notes: ["notes"] as const,
  note: (id: string) => ["notes", "detail", id] as const,
  noteBlocks: ["notes", "blocks"] as const,
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
}
export function useProjects() {
  return useQuery({
    queryKey: qk.projects,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select(PROJECT_COLS)
        .is("deleted_at", null)
        .order("position")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}
export function useNotes() {
  return useQuery({
    queryKey: qk.notes,
    queryFn: async (): Promise<NoteSummary[]> => {
      const { data, error } = await supabase
        .from("notes")
        .select(NOTE_LIST_COLS)
        .is("deleted_at", null)
        .is("archived_at", null)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
/** One note with its blocks, for the editor. `null` when missing, trashed or archived. */
export function useNote(id: string) {
  return useQuery({
    queryKey: qk.note(id),
    queryFn: async (): Promise<NoteDetail | null> => {
      const { data, error } = await supabase
        .from("notes")
        .select(NOTE_DETAIL_COLS)
        .eq("id", id)
        .is("deleted_at", null)
        .is("archived_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
/**
 * Blocks of every visible note, for backlinks, block refs/embeds and the graph. Only the note
 * editor and graph routes subscribe to it, so other pages never download note bodies.
 */
export function useNoteBlocks() {
  return useQuery({
    queryKey: qk.noteBlocks,
    queryFn: async (): Promise<NoteBlocks[]> => {
      const { data, error } = await supabase
        .from("notes")
        .select(NOTE_BLOCK_COLS)
        .is("deleted_at", null)
        .is("archived_at", null);
      if (error) throw error;
      return data;
    },
  });
}
export function useMilestones() {
  return useQuery({
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
}
export function useDeps() {
  return useQuery({
    queryKey: qk.deps,
    queryFn: async () => {
      const { data, error } = await supabase.from("task_dependencies").select(DEP_COLS);
      if (error) throw error;
      return data;
    },
  });
}
export function useAutomations() {
  return useQuery({
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
}

export type SearchHit = { id: string; title: string };
export type SearchResults = { tasks: SearchHit[]; projects: SearchHit[]; notes: SearchHit[] };
const SEARCH_LIMIT = 20;

/**
 * Lightweight title search for the command menu: `id,title` only, capped per entity, filtered
 * in Postgres (`ilike`). An empty term returns the most recently updated rows. Unlike
 * useTasks/useNotes it never downloads whole tables (descriptions, note blocks/content).
 */
export function useSearch(term: string, enabled = true) {
  const t = term.trim();
  return useQuery({
    queryKey: ["search", t],
    enabled,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<SearchResults> => {
      const pattern = ilikePattern(t);
      let tasks = supabase
        .from("tasks")
        .select("id,title")
        .is("deleted_at", null)
        .is("archived_at", null)
        .is("parent_id", null);
      let projects = supabase.from("projects").select("id,name").is("deleted_at", null);
      let notes = supabase
        .from("notes")
        .select("id,title")
        .is("deleted_at", null)
        .is("archived_at", null);
      if (t) {
        tasks = tasks.ilike("title", pattern);
        projects = projects.ilike("name", pattern);
        notes = notes.ilike("title", pattern);
      }
      const [tr, pr, nr] = await Promise.all([
        tasks.order("updated_at", { ascending: false }).limit(SEARCH_LIMIT),
        projects.order("name").limit(SEARCH_LIMIT),
        notes.order("updated_at", { ascending: false }).limit(SEARCH_LIMIT),
      ]);
      const error = tr.error ?? pr.error ?? nr.error;
      if (error) throw error;
      return {
        tasks: tr.data ?? [],
        projects: (pr.data ?? []).map((p) => ({ id: p.id, title: p.name })),
        notes: nr.data ?? [],
      };
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
      const { data, error } = await supabase.rpc("list_project_people", {
        _project_id: projectId!,
      });
      if (error) throw error;
      return (data ?? []) as Person[];
    },
  });
}

type TableName = "tasks" | "projects" | "notes" | "milestones" | "automations";

const COLS: Record<TableName, string> = {
  tasks: TASK_COLS,
  projects: PROJECT_COLS,
  notes: NOTE_LIST_COLS,
  milestones: MILESTONE_COLS,
  automations: AUTOMATION_COLS,
};
const NOTE_BLOCK_FIELDS = ["id", "title", "tags", "project_id", "blocks", "content"] as const;

type Snapshot = [QueryKey, unknown][];
/** Every cached query under `key` (list, detail, blocks...), for rollback. */
const snapshot = (qc: QueryClient, key: readonly string[]): Snapshot =>
  qc.getQueriesData({ queryKey: key });
const restore = (qc: QueryClient, snap: Snapshot) =>
  snap.forEach(([k, data]) => qc.setQueryData(k, data));

/**
 * What a patch looks like in a given cached query: the notes list (qk.notes) never holds
 * `blocks`, the blocks cache only holds its own fields, everything else takes it whole.
 */
function patchFor(table: TableName, queryKey: QueryKey, patch: object): object {
  if (table !== "notes") return patch;
  if (queryKey.length === 1) return omitKeys(patch as Record<string, unknown>, ["blocks"]);
  if (queryKey[1] === "blocks")
    return pickKeys(patch as Record<string, unknown>, NOTE_BLOCK_FIELDS as unknown as string[]);
  return patch;
}

/**
 * Create/update/remove/archive for one entity. The cache is updated directly (optimistic for
 * update/remove/archive, with the inserted row for create); on failure the snapshot is
 * restored and the entity refetched. Successful writes never refetch whole lists.
 */
function useCrud<Row extends { id: string }, Ins, Upd>(table: TableName, key: readonly string[]) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = () => supabase.from(table) as any;

  /** Applies `fn` to every cached query under the entity key. */
  function mapCached(fn: (data: unknown, queryKey: QueryKey) => unknown) {
    for (const [k, data] of qc.getQueriesData({ queryKey: key })) {
      const next = fn(data, k);
      if (next !== data) qc.setQueryData(k, next);
    }
  }
  function fail(snap: Snapshot, message: string) {
    restore(qc, snap);
    toast.error(message);
    void invalidate();
  }

  async function create(input: Omit<Ins, "user_id">): Promise<Row | null> {
    const user_id = await getUid();
    const { data, error } = await from()
      .insert({ ...input, user_id })
      .select(COLS[table])
      .single();
    if (error) {
      toast.error(error.message);
      return null;
    }
    const row = data as Row;
    qc.setQueryData<Row[]>(key, (old) =>
      insertRow(
        old,
        row,
        table === "notes" ? afterPinned(old as unknown as { pinned: boolean }[]) : undefined,
      ),
    );
    if (table === "notes" && qc.getQueryData(qk.noteBlocks)) {
      const blocks = (input as { blocks?: unknown }).blocks ?? [];
      qc.setQueryData<NoteBlocks[]>(qk.noteBlocks, (old) =>
        insertRow(old, {
          ...pickKeys(row as unknown as NoteSummary, [
            "id",
            "title",
            "tags",
            "project_id",
            "content",
          ]),
          blocks,
        } as NoteBlocks),
      );
    }
    return row;
  }
  async function update(id: string, patch: Upd) {
    const withTs =
      table === "milestones" || table === "automations"
        ? patch
        : { ...patch, updated_at: new Date().toISOString() };
    const snap = snapshot(qc, key);
    mapCached((data, k) => patchCached(data, id, patchFor(table, k, withTs as object)));
    const { error } = await from().update(withTs).eq("id", id);
    if (error) fail(snap, error.message);
  }
  async function hide(id: string, patch: Record<string, string>, done: string) {
    const snap = snapshot(qc, key);
    // Trashing a task trashes its subtasks too (archiving does not).
    const cascade = table === "tasks" && "deleted_at" in patch;
    mapCached((data) =>
      Array.isArray(data)
        ? removeRows(
            data as { id: string; parent_id?: string | null }[],
            (r) => r.id === id || (cascade && r.parent_id === id),
          )
        : data,
    );
    const { error } = await from().update(patch).eq("id", id);
    if (!error && cascade) await from().update(patch).eq("parent_id", id).is("deleted_at", null);
    if (error) fail(snap, error.message);
    else {
      toast.message(done);
      // The open detail page navigates away itself; mark its cache stale for the next visit
      // without refetching it now.
      void qc.invalidateQueries({ queryKey: [...key, "detail", id], refetchType: "none" });
    }
    void qc.invalidateQueries({ queryKey: ["bin"] });
  }
  async function remove(id: string) {
    const soft = table === "tasks" || table === "notes" || table === "projects";
    if (soft)
      return hide(
        id,
        { deleted_at: new Date().toISOString() },
        "Dipindah ke Tempat Sampah — bisa dikembalikan dalam 30 hari",
      );
    const snap = snapshot(qc, key);
    mapCached((data) =>
      Array.isArray(data) ? removeRows(data as Row[], (r) => r.id === id) : data,
    );
    const { error } = await from().delete().eq("id", id);
    if (error) fail(snap, error.message);
  }
  async function archive(id: string) {
    return hide(id, { archived_at: new Date().toISOString() }, "Diarsipkan");
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
            const mv = (iso: string | null) =>
              iso ? new Date(new Date(iso).getTime() + delta).toISOString() : null;
            await crud.update(t.id, {
              start_date: mv(t.start_date),
              due_date: mv(t.due_date),
              reminded: false,
            });
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
        const n =
          task.recurrence === "daily"
            ? addDays(x, 1)
            : task.recurrence === "weekly"
              ? addWeeks(x, 1)
              : addMonths(x, 1);
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
  async function add(blocker_id: string, blocked_id: string) {
    const deps = qc.getQueryData<Dependency[]>(qk.deps) ?? [];
    // reject cycles: blocked_id must not (transitively) block blocker_id
    const stack = [blocked_id];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === blocker_id) {
        toast.error("Tidak bisa: akan membuat ketergantungan melingkar");
        return;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      deps.filter((d) => d.blocker_id === cur).forEach((d) => stack.push(d.blocked_id));
    }
    const user_id = await getUid();
    const { data, error } = await supabase
      .from("task_dependencies")
      .insert({ blocker_id, blocked_id, user_id })
      .select(DEP_COLS)
      .single();
    if (error) {
      toast.error(error.message);
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
      toast.error(error.message);
    }
  }
  return { add, remove };
}

export const useProjectActions = () =>
  useCrud<Project, TablesInsert<"projects">, TablesUpdate<"projects">>("projects", qk.projects);
export const useNoteActions = () =>
  useCrud<NoteSummary, TablesInsert<"notes">, TablesUpdate<"notes">>("notes", qk.notes);
export const useMilestoneActions = () =>
  useCrud<Milestone, TablesInsert<"milestones">, TablesUpdate<"milestones">>(
    "milestones",
    qk.milestones,
  );

/* ---------- date helpers ---------- */
export const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
/** Date-only string (yyyy-MM-dd) → ISO timestamp at 17:00 local time. */
export const dateToIso = (s: string, hour = 17) =>
  s ? new Date(`${s}T${String(hour).padStart(2, "0")}:00:00`).toISOString() : null;
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
  useCrud<Automation, TablesInsert<"automations">, TablesUpdate<"automations">>(
    "automations",
    qk.automations,
  );
