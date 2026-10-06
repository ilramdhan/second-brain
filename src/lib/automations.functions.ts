import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { NoteSnapshot, TaskSnapshot } from "@/lib/automation-types";
import { MAX_CRON_LENGTH } from "@/lib/cron";

const snapshot = z.object({
  status: z.string().nullish(),
  priority: z.string().nullish(),
  assignee_name: z.string().nullish(),
  assignee_id: z.string().nullish(),
  due_date: z.string().nullish(),
});

function requestOrigin() {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return null;
  }
}

const noteSnapshot = z.object({
  title: z.string().max(300).nullish(),
  tags: z.array(z.string().max(100)).max(100).nullish(),
  project_id: z.guid().nullish(),
});

const taskEvent = z.object({
  event: z.enum(["created", "updated"]),
  taskId: z.guid(),
  before: snapshot.optional(),
});
const noteEvent = z.object({
  entity: z.literal("note"),
  event: z.enum(["created", "updated"]),
  noteId: z.guid(),
  before: noteSnapshot.optional(),
});

/**
 * Evaluates the caller's rules for one task event (`{event, taskId, before?}`, from
 * useTaskActions) or note event (`{entity: "note", event, noteId, before?}`, from
 * useNoteActions). Runs with the caller's RLS client.
 */
export const runAutomations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.union([noteEvent, taskEvent]).parse(d))
  .handler(async ({ data, context }) => {
    if ("entity" in data) {
      const { runNoteAutomationRules } = await import("@/server/noteAutomationEngine.server");
      return runNoteAutomationRules(
        context.supabase,
        context.userId,
        {
          event: data.event,
          noteId: data.noteId,
          before: data.before as NoteSnapshot | undefined,
        },
        requestOrigin(),
      );
    }
    const { runAutomationRules } = await import("@/server/automationEngine.server");
    return runAutomationRules(
      context.supabase,
      context.userId,
      { event: data.event, taskId: data.taskId, before: data.before as TaskSnapshot | undefined },
      requestOrigin(),
    );
  });

/**
 * Validates a rule's schedule (cron + time zone) with the local parser and stores `next_run_at`
 * (null for non-schedule or disabled rules). Called after every save/toggle of a rule; the n8n
 * tick only runs rules with a `next_run_at`. Runs with the caller's RLS client (own rules only).
 */
export const scheduleAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.guid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rule, error } = await context.supabase
      .from("automations")
      .select("id,enabled,trigger,schedule_cron,schedule_tz")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rule) throw new Error("Aturan tidak ditemukan");
    const { computeNextRun } = await import("@/server/scheduledAutomations.server");
    const { appTimezone } = await import("@/server/n8n/time.server");
    const { CronError } = await import("@/lib/cron");
    if ((rule.schedule_cron?.length ?? 0) > MAX_CRON_LENGTH)
      throw new Error("Cron terlalu panjang");
    let next: string | null;
    try {
      next = computeNextRun(rule, new Date(), appTimezone());
    } catch (e) {
      // Invalid schedule: stop it (no next run) and tell the user why.
      await context.supabase.from("automations").update({ next_run_at: null }).eq("id", rule.id);
      if (e instanceof CronError) throw new Error(`Jadwal tidak valid: ${e.message}`, { cause: e });
      throw e;
    }
    const { error: upd } = await context.supabase
      .from("automations")
      .update({ next_run_at: next })
      .eq("id", rule.id);
    if (upd) throw new Error(upd.message);
    return { next_run_at: next };
  });

/** Notifies the people on tasks that just became unblocked (Telegram, best-effort). */
export const notifyUnblocked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ taskIds: z.array(z.guid()).max(50), blockerTitle: z.string().max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // The public demo sends no Telegram messages; skipping keeps task completion working.
    const { isDemoMode } = await import("@/server/demo/mode.server");
    if (isDemoMode()) {
      console.info("[demo] notifyUnblocked: Telegram dilewati (demo)");
      return { sent: 0 };
    }
    const { data: tasks } = await context.supabase
      .from("tasks")
      .select("id,title,user_id,assignee_id")
      .in("id", data.taskIds);
    if (!tasks?.length) return { sent: 0 };
    const recipients = [...new Set(tasks.flatMap((t) => [t.assignee_id ?? t.user_id]))];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id,telegram_chat_id")
      .in("id", recipients);
    const { sendTelegram } = await import("@/lib/telegram.server");
    let sent = 0;
    for (const t of tasks) {
      const chat = profs?.find((p) => p.id === (t.assignee_id ?? t.user_id))?.telegram_chat_id;
      if (!chat) continue;
      const err = await sendTelegram(
        chat,
        `🔓 "${t.title}" sudah bisa dikerjakan — "${data.blockerTitle}" selesai.`,
      );
      if (!err) sent++;
    }
    return { sent };
  });
