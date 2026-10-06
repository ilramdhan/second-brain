// Domain operations for the n8n endpoints. They use the service-role client (no user JWT exists
// for an n8n call), so every function takes the resolved `userId` and scopes each query to the
// rows that user could reach through RLS: own rows plus tasks/notes of projects they own or are a
// member of. Soft-deleted and archived rows are excluded like the list hooks in src/lib/data.ts.
// Task writes go through the same rules as `useTaskActions`: blocked check, dependent auto-shift,
// recurrence, unblock notifications and `runAutomationRules`. Auto-shift and completion
// (blocked check + recurrence) are the Postgres RPCs from migration 0017, called by both sides.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json, Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { loadBlocks, noteIndexFields, toMarkdown } from "@/lib/blocks";
import { parseCompleteResult } from "@/lib/task-rules";

import { runAutomationRules, type AutomationEvent } from "../automationEngine.server";
import { appTimezone } from "./time.server";

export type Task = Tables<"tasks">;
const TASK_COLUMNS = "*";

/* ---------------- users ---------------- */

export async function userIdByChat(chatId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  return data?.id ?? null;
}

export async function userIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("n8n_user_id_by_email", { _email: email });
  if (error) throw new Error(`user lookup failed: ${error.message}`);
  return (data as string | null) ?? null;
}

/** Profiles linked to Telegram (id + chat). Optionally a single user. */
export async function linkedProfiles(userId?: string) {
  let query = supabaseAdmin
    .from("profiles")
    .select("id, telegram_chat_id")
    .not("telegram_chat_id", "is", null);
  if (userId) query = query.eq("id", userId);
  const { data, error } = await query.limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ userId: p.id, chatId: p.telegram_chat_id! }));
}

/* ---------------- idempotency ---------------- */

/**
 * Claims (source, externalId). Returns the stored response when the key was already processed
 * (a retry), otherwise null and the caller must `storeEventResponse` once done.
 */
export async function claimEvent(
  source: string,
  externalId: string,
  userId: string | null,
): Promise<{ duplicate: false } | { duplicate: true; response: Json | null }> {
  const { data, error } = await supabaseAdmin
    .from("n8n_events")
    .upsert(
      { source, external_id: externalId, user_id: userId },
      { onConflict: "source,external_id", ignoreDuplicates: true },
    )
    .select("source");
  if (error) throw new Error(`idempotency failed: ${error.message}`);
  if (data && data.length) return { duplicate: false };
  const { data: existing } = await supabaseAdmin
    .from("n8n_events")
    .select("response")
    .eq("source", source)
    .eq("external_id", externalId)
    .maybeSingle();
  return { duplicate: true, response: existing?.response ?? null };
}

export async function storeEventResponse(source: string, externalId: string, response: unknown) {
  await supabaseAdmin
    .from("n8n_events")
    .update({ response: response as Json })
    .eq("source", source)
    .eq("external_id", externalId);
}

/** Releases a claim after a failure so n8n's retry can process the event again. */
export async function releaseEvent(source: string, externalId: string) {
  await supabaseAdmin
    .from("n8n_events")
    .delete()
    .eq("source", source)
    .eq("external_id", externalId)
    .is("response", null);
}

/* ---------------- access scope ---------------- */

/** Ids of projects the user owns or is a member of (not trashed). */
export async function accessibleProjectIds(userId: string): Promise<string[]> {
  const [{ data: owned }, { data: member }] = await Promise.all([
    supabaseAdmin.from("projects").select("id").eq("user_id", userId).is("deleted_at", null),
    supabaseAdmin.from("project_members").select("project_id").eq("user_id", userId),
  ]);
  return [
    ...new Set([...(owned ?? []).map((p) => p.id), ...(member ?? []).map((m) => m.project_id)]),
  ];
}

/** PostgREST `or` filter: own rows, or rows in an accessible project. */
export function scopeFilter(userId: string, projectIds: string[]) {
  return projectIds.length
    ? `user_id.eq.${userId},project_id.in.(${projectIds.join(",")})`
    : `user_id.eq.${userId}`;
}

export async function findTask(userId: string, taskId: string): Promise<Task | null> {
  const projects = await accessibleProjectIds(userId);
  const { data } = await supabaseAdmin
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("id", taskId)
    .or(scopeFilter(userId, projects))
    .is("deleted_at", null)
    .maybeSingle();
  return data ?? null;
}

export type TaskQuery = {
  open?: boolean;
  dueFrom?: Date;
  dueBefore?: Date;
  completedFrom?: Date;
  search?: string;
  limit?: number;
};

export async function listTasks(userId: string, q: TaskQuery, projects?: string[]) {
  const scope = projects ?? (await accessibleProjectIds(userId));
  let query = supabaseAdmin
    .from("tasks")
    .select("id,title,due_date,priority,status,tags,project_id,user_id,assignee_id")
    .or(scopeFilter(userId, scope))
    .is("deleted_at", null)
    .is("archived_at", null);
  if (q.open) query = query.neq("status", "done");
  if (q.dueFrom) query = query.gte("due_date", q.dueFrom.toISOString());
  if (q.dueBefore) query = query.lt("due_date", q.dueBefore.toISOString());
  if (q.completedFrom)
    query = query.eq("status", "done").gte("completed_at", q.completedFrom.toISOString());
  if (q.search) query = query.ilike("title", `%${escapeLike(q.search)}%`);
  const { data, error } = await query
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(q.limit ?? 50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function escapeLike(value: string) {
  return value.replace(/[\\%_,()]/g, (c) => `\\${c}`);
}

/* ---------------- tasks ---------------- */

export async function resolveProjectId(userId: string, name: string | null | undefined) {
  if (!name) return null;
  const ids = await accessibleProjectIds(userId);
  if (!ids.length) return null;
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id,name")
    .in("id", ids)
    .is("deleted_at", null);
  const key = name.toLowerCase().replace(/\s+/g, "");
  return data?.find((p) => p.name.toLowerCase().replace(/\s+/g, "") === key)?.id ?? null;
}

export async function createTask(
  userId: string,
  input: Omit<TablesInsert<"tasks">, "user_id">,
  origin: string | null,
): Promise<Task> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .insert({ ...input, user_id: userId })
    .select(TASK_COLUMNS)
    .single();
  if (error || !data) throw new Error(`task insert failed: ${error?.message}`);
  await runAutomationRules(
    supabaseAdmin,
    userId,
    { event: "created", taskId: data.id },
    origin,
  ).catch((e) => console.error("[n8n] automations failed", e));
  return data;
}

function snapshotOf(t: Task) {
  return {
    status: t.status,
    priority: t.priority,
    assignee_name: t.assignee_name,
    assignee_id: t.assignee_id,
    due_date: t.due_date,
  };
}

async function updateTaskRow(
  userId: string,
  before: Task,
  patch: TablesUpdate<"tasks">,
  origin: string | null,
) {
  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", before.id);
  if (error) throw new Error(`task update failed: ${error.message}`);
  await runAutomationRules(
    supabaseAdmin,
    userId,
    { event: "updated", taskId: before.id, before: snapshotOf(before) },
    origin,
  ).catch((e) => console.error("[n8n] automations failed", e));
}

/**
 * Shifts not-done dependents (transitively) by `deltaMs` through the `shift_task_dependents`
 * RPC (migration 0017), the same function `useTaskActions.update` calls. Scoped to `userId`.
 */
async function shiftDependents(userId: string, rootId: string, deltaMs: number) {
  const { data, error } = await supabaseAdmin.rpc("shift_task_dependents", {
    _task_id: rootId,
    _delta_ms: deltaMs,
    _user_id: userId,
  });
  if (error) throw new Error(`dependent shift failed: ${error.message}`);
  return data?.length ?? 0;
}

export type CompleteResult =
  | { ok: true; task: Task; recurring: Task | null; unblocked: string[] }
  | { ok: false; reason: "blocked"; blocker: string }
  | { ok: false; reason: "already_done"; task: Task };

/** Marks a task done with the same side effects as useTaskActions.setStatus("done"). */
export async function completeTask(
  userId: string,
  task: Task,
  origin: string | null,
): Promise<CompleteResult> {
  if (task.status === "done") return { ok: false, reason: "already_done", task };
  // Blocked check, status update, unblocked dependents and the next recurring occurrence run in
  // one transaction in `complete_task` (migration 0017), shared with useTaskActions.setStatus.
  const { data, error } = await supabaseAdmin.rpc("complete_task", {
    _task_id: task.id,
    _tz: appTimezone(),
    _user_id: userId,
  });
  if (error) throw new Error(`task complete failed: ${error.message}`);
  const result = parseCompleteResult(data);
  if (result.status === "blocked") return { ok: false, reason: "blocked", blocker: result.blocker };
  if (result.status === "already_done") return { ok: false, reason: "already_done", task };

  const runRules = (event: AutomationEvent) =>
    runAutomationRules(supabaseAdmin, userId, event, origin).catch((e) =>
      console.error("[n8n] automations failed", e),
    );
  await runRules({ event: "updated", taskId: task.id, before: snapshotOf(task) });

  // Unblocked dependents → Telegram notification (best effort).
  const unblocked = result.unblocked.map((u) => u.id);
  if (unblocked.length) await notifyUnblockedServer(unblocked, task.title);

  if (result.recurring) await runRules({ event: "created", taskId: result.recurring.id });
  return { ok: true, task: result.task, recurring: result.recurring, unblocked };
}

async function notifyUnblockedServer(taskIds: string[], blockerTitle: string) {
  const { isDemoMode } = await import("@/server/demo/mode.server");
  if (isDemoMode()) return; // no Telegram in the public demo
  const { data: tasks } = await supabaseAdmin
    .from("tasks")
    .select("id,title,user_id,assignee_id")
    .in("id", taskIds);
  if (!tasks?.length) return;
  const recipients = [...new Set(tasks.map((t) => t.assignee_id ?? t.user_id))];
  const { data: profs } = await supabaseAdmin
    .from("profiles")
    .select("id,telegram_chat_id")
    .in("id", recipients);
  const { sendTelegram } = await import("@/lib/telegram.server");
  for (const t of tasks) {
    const chat = profs?.find((p) => p.id === (t.assignee_id ?? t.user_id))?.telegram_chat_id;
    if (chat)
      await sendTelegram(
        chat,
        `🔓 "${t.title}" sudah bisa dikerjakan — "${blockerTitle}" selesai.`,
      );
  }
}

/** Moves the due date by `minutes` (and dependents with it), resetting the reminder. */
export async function snoozeTask(
  userId: string,
  task: Task,
  minutes: number,
  origin: string | null,
) {
  const base = task.due_date ? new Date(task.due_date) : new Date();
  const from = Math.max(base.getTime(), Date.now());
  const due = new Date(from + minutes * 60_000);
  const delta = due.getTime() - base.getTime();
  await updateTaskRow(
    userId,
    task,
    {
      due_date: due.toISOString(),
      start_date: task.start_date
        ? new Date(new Date(task.start_date).getTime() + delta).toISOString()
        : null,
      reminded: false,
    },
    origin,
  );
  if (task.due_date && delta > 0) await shiftDependents(userId, task.id, delta);
  return due;
}

/* ---------------- notes & inbox ---------------- */

/**
 * Creates a note with `blocks` as source of truth, the mirrored markdown `content` and the
 * derived `links`/`refs`/`excerpt` (migration 0018).
 */
export async function createNote(
  userId: string,
  title: string,
  body: string,
  extra: { tags?: string[]; project_id?: string | null } = {},
) {
  const blocks = loadBlocks({ blocks: [], content: body });
  const content = toMarkdown(blocks);
  const { data, error } = await supabaseAdmin
    .from("notes")
    .insert({
      user_id: userId,
      title: title.slice(0, 300) || "Catatan",
      blocks: blocks as unknown as Json,
      content,
      ...noteIndexFields(blocks, content),
      tags: extra.tags ?? [],
      project_id: extra.project_id ?? null,
    })
    .select("id,title")
    .single();
  if (error || !data) throw new Error(`note insert failed: ${error?.message}`);
  return data;
}

export type InboxSource = TablesInsert<"inbox_items">["source"];

export async function createInboxItem(
  userId: string,
  content: string,
  source: NonNullable<InboxSource>,
  aiSummary: string | null = null,
) {
  const { data, error } = await supabaseAdmin
    .from("inbox_items")
    .insert({ user_id: userId, content: content.slice(0, 20_000), source, ai_summary: aiSummary })
    .select("id,content")
    .single();
  if (error || !data) throw new Error(`inbox insert failed: ${error?.message}`);
  return data;
}

export async function findInboxItem(userId: string, id: string) {
  const { data } = await supabaseAdmin
    .from("inbox_items")
    .select("id,content,status,ai_summary")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

export async function pendingInbox(userId: string, offset: number, limit: number) {
  const { data, count } = await supabaseAdmin
    .from("inbox_items")
    .select("id,content,created_at", { count: "exact" })
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  return { items: data ?? [], total: count ?? 0 };
}

export async function setInboxStatus(userId: string, id: string, status: "processed" | "archived") {
  await supabaseAdmin.from("inbox_items").update({ status }).eq("id", id).eq("user_id", userId);
}

export async function deleteInboxItem(userId: string, id: string) {
  await supabaseAdmin.from("inbox_items").delete().eq("id", id).eq("user_id", userId);
}

export async function searchNotes(userId: string, q: string, limit = 5) {
  const projects = await accessibleProjectIds(userId);
  const pattern = `%${escapeLike(q)}%`;
  const { data } = await supabaseAdmin
    .from("notes")
    .select("id,title")
    .or(scopeFilter(userId, projects))
    .or(`title.ilike.${pattern},content.ilike.${pattern}`)
    .is("deleted_at", null)
    .is("archived_at", null)
    .limit(limit);
  return data ?? [];
}

/* ---------------- AI ---------------- */

/**
 * Summarizes text with the app's AI provider (AI_*), charged to the user's AI budget. Returns null
 * when AI is not configured or the budget is exhausted (callers fall back to the raw text).
 */
export async function summarizeForUser(userId: string, text: string): Promise<string | null> {
  const { assertAiAvailable, aiText } = await import("@/lib/ai.server");
  try {
    await assertAiAvailable();
  } catch {
    return null;
  }
  const { AI_RATE_LIMIT } = await import("../rateLimit.server");
  const { data: allowed, error } = await supabaseAdmin.rpc("consume_rate_limit_for", {
    _user_id: userId,
    _bucket: AI_RATE_LIMIT.bucket,
    _max: AI_RATE_LIMIT.max,
    _window_seconds: AI_RATE_LIMIT.windowSeconds,
  });
  if (error || allowed !== true) return null;
  try {
    const summary = await aiText(
      new Request("https://n8n.internal/summarize"),
      "Ringkas teks berikut dalam bahasa Indonesia: 3–6 poin singkat, lalu satu baris 'Tindak lanjut:' bila ada. Jangan menambah informasi.",
      [{ role: "user", content: text.slice(0, 50_000) }],
      "summary",
    );
    return summary.trim().slice(0, 4000) || null;
  } catch (e) {
    console.error("[n8n] summarize failed", e instanceof Error ? e.message : e);
    return null;
  }
}
