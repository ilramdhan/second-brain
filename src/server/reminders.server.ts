// Deadline reminder selection shared by POST /api/public/hooks/reminders (legacy cron, sends
// Telegram itself) and POST /api/public/n8n/reminders (returns messages for n8n to send).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DueReminder = {
  task: {
    id: string;
    user_id: string;
    title: string;
    due_date: string;
    priority: string;
    status: string;
  };
  chatId: string;
};

/**
 * Open, not yet reminded, not trashed/archived tasks due before now + leadMs (and, unless
 * includeOverdue, not already past due), whose owner linked Telegram.
 */
export async function findDueReminders(opts: {
  leadMs: number;
  includeOverdue: boolean;
  limit: number;
  now?: Date;
}): Promise<DueReminder[]> {
  const now = opts.now ?? new Date();
  let query = supabaseAdmin
    .from("tasks")
    .select("id, user_id, title, due_date, priority, status")
    .neq("status", "done")
    .eq("reminded", false)
    .is("deleted_at", null)
    .is("archived_at", null)
    .not("due_date", "is", null)
    .lte("due_date", new Date(now.getTime() + opts.leadMs).toISOString());
  if (!opts.includeOverdue) query = query.gte("due_date", now.toISOString());
  const { data: tasks, error } = await query.order("due_date").limit(opts.limit);
  if (error) throw new Error(`reminders query failed: ${error.message}`);
  if (!tasks?.length) return [];

  const userIds = [...new Set(tasks.map((t) => t.user_id))];
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, telegram_chat_id")
    .in("id", userIds);
  const chatByUser = new Map(
    (profiles ?? []).filter((p) => p.telegram_chat_id).map((p) => [p.id, p.telegram_chat_id!]),
  );
  return tasks.flatMap((task) => {
    const chatId = chatByUser.get(task.user_id);
    return chatId ? [{ task: { ...task, due_date: task.due_date! }, chatId }] : [];
  });
}

export async function markReminded(taskIds: string[]) {
  if (!taskIds.length) return;
  const { error } = await supabaseAdmin.from("tasks").update({ reminded: true }).in("id", taskIds);
  if (error) throw new Error(`mark reminded failed: ${error.message}`);
}
