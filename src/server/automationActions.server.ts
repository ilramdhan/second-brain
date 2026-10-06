// Action helpers shared by the note rule engine (noteAutomationEngine.server.ts) and scheduled
// rules (scheduledAutomations.server.ts). `supabase` is either the caller's RLS client or the
// service-role client acting for `userId`; every lookup is scoped to `userId` explicitly so both
// behave the same. Writes go straight to the database and never evaluate rules again (the
// engine-wide "actions never re-trigger rules" invariant).
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import type { Action, CreateTaskAction } from "@/lib/automation-types";
import { zonedTime } from "@/lib/cron";

type Client = SupabaseClient<Database>;

/**
 * Run-time validation of rule actions. Rules are user-written rows (PostgREST accepts any jsonb),
 * so the engines re-check every action before acting on it instead of trusting the form.
 */
const projectId = z.guid().nullish();
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_field"),
    field: z.enum(["priority", "status", "assignee_name"]),
    value: z.string().max(200),
  }),
  z.object({ type: z.literal("add_tag"), value: z.string().min(1).max(60) }),
  z.object({ type: z.literal("shift_due"), days: z.number().int().min(-365).max(365) }),
  z.object({ type: z.literal("comment"), text: z.string().max(2000) }),
  z.object({ type: z.literal("telegram"), text: z.string().max(2000) }),
  z.object({ type: z.literal("webhook"), url: z.string().max(2000) }),
  z.object({ type: z.literal("link_project"), project_id: z.guid() }),
  z.object({
    type: z.literal("create_task"),
    title: z.string().min(1).max(200),
    priority: z.enum(["high", "medium", "low"]).optional(),
    project_id: projectId,
    due_in_days: z.number().int().min(0).max(365).nullish(),
  }),
  z.object({
    type: z.literal("move_overdue"),
    project_id: projectId,
    // Never "done": completion must go through `complete_task` (blocked check + recurrence).
    status: z.enum(["todo", "in_progress", "review"]),
  }),
  z.object({
    type: z.literal("digest"),
    kind: z.enum(["morning", "overdue", "evening", "weekly"]),
    channel: z.enum(["telegram", "webhook"]),
    url: z.string().max(2000).optional(),
  }),
]);

/** Parses one stored action; returns null (and the caller logs it) when it is malformed. */
export function parseAction(raw: unknown): Action | null {
  const parsed = actionSchema.safeParse(raw);
  return parsed.success ? (parsed.data as Action) : null;
}

/** Replaces `{{key}}` placeholders; unknown keys stay as written. */
export function fillTemplate(tpl: string, values: Record<string, string>) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (all, key: string) => values[key] ?? all);
}

/** Whether `userId` owns or is a member of the (not trashed) project. */
export async function projectAccessible(supabase: Client, userId: string, id: string) {
  const { data: project } = await supabase
    .from("projects")
    .select("id,user_id,name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!project) return null;
  if (project.user_id === userId) return project;
  const { data: member } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return member ? project : null;
}

/**
 * Inserts the task of a `create_task` action for `userId`. The project must be reachable by the
 * user. The new task does not run task rules (actions never re-trigger rules).
 */
export async function createTaskFromAction(
  supabase: Client,
  userId: string,
  action: CreateTaskAction,
  ctx: {
    values: Record<string, string>;
    tz: string;
    now: Date;
    projectId?: string | null;
    description?: string | null;
  },
): Promise<{ id: string; title: string }> {
  const project = action.project_id ?? ctx.projectId ?? null;
  if (project && !(await projectAccessible(supabase, userId, project)))
    throw new Error("Proyek tidak ditemukan");
  const title = fillTemplate(action.title, ctx.values).trim().slice(0, 200) || "Tugas";
  const due =
    action.due_in_days === null || action.due_in_days === undefined
      ? null
      : zonedTime(ctx.now, ctx.tz, action.due_in_days, 17).toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title,
      priority: action.priority ?? "medium",
      project_id: project,
      due_date: due,
      description: ctx.description ?? null,
      tags: ["otomasi"],
    })
    .select("id,title")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Gagal membuat tugas");
  return data;
}

/** Sends a Telegram message to the user's linked chat; throws when unlinked or on failure. */
export async function telegramToUser(
  supabase: Client,
  userId: string,
  text: string,
  options: { parse_mode?: "HTML"; reply_markup?: unknown } = {},
) {
  const { data: prof } = await supabase
    .from("profiles")
    .select("telegram_chat_id")
    .eq("id", userId)
    .maybeSingle();
  if (!prof?.telegram_chat_id) throw new Error("Akun Telegram belum ditautkan");
  const { sendTelegram } = await import("@/lib/telegram.server");
  const err = await sendTelegram(prof.telegram_chat_id, text, options);
  if (err) throw new Error(err);
}

/** Absolute app URL for `path`, or null without a known origin. */
export function appUrl(origin: string | null, path: string) {
  if (!origin) return null;
  try {
    return new URL(path, origin).toString();
  } catch {
    return null;
  }
}
