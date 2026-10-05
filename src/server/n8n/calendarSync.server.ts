// POST /api/public/n8n/calendar/sync — pushes task changes to each connected user's Google
// Calendar. mode=linked (default) only updates tasks the user already sent to Google ("Kirim ke
// Google Calendar", google_event_id set) and removes events of trashed/archived/undated tasks;
// mode=all also creates events for every dated task changed in the window.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import {
  CalendarNotConnectedError,
  deleteTaskEvent,
  upsertTaskEvent,
} from "../googleCalendar.server";
import { GOOGLE_CALENDAR_CONNECTOR } from "../googleOAuth.server";

export type SyncResult = {
  task_id: string;
  title: string;
  ok: boolean;
  action: string;
  error?: string;
};

export async function syncCalendars(opts: {
  sinceMinutes: number;
  limit: number;
  userId?: string;
  mode: "linked" | "all";
}) {
  let users = supabaseAdmin
    .from("app_user_connections")
    .select("user_id")
    .eq("connector_id", GOOGLE_CALENDAR_CONNECTOR);
  if (opts.userId) users = users.eq("user_id", opts.userId);
  const { data: connections, error } = await users;
  if (error) throw new Error(error.message);

  const since = new Date(Date.now() - opts.sinceMinutes * 60_000).toISOString();
  const results: SyncResult[] = [];
  for (const { user_id } of connections ?? []) {
    if (results.length >= opts.limit) break;
    let query = supabaseAdmin
      .from("tasks")
      .select(
        "id,title,description,start_date,due_date,time_block_end,google_event_id,deleted_at,archived_at",
      )
      .eq("user_id", user_id)
      .gte("updated_at", since);
    if (opts.mode === "linked") query = query.not("google_event_id", "is", null);
    const { data: tasks } = await query.order("updated_at").limit(opts.limit - results.length);
    for (const task of tasks ?? []) {
      const gone = Boolean(
        task.deleted_at || task.archived_at || !(task.start_date ?? task.due_date),
      );
      try {
        if (gone) {
          if (!task.google_event_id) continue;
          await deleteTaskEvent(user_id, task.google_event_id);
          await supabaseAdmin.from("tasks").update({ google_event_id: null }).eq("id", task.id);
          results.push({ task_id: task.id, title: task.title, ok: true, action: "deleted" });
        } else {
          const eventId = await upsertTaskEvent(user_id, task);
          if (eventId !== task.google_event_id)
            await supabaseAdmin
              .from("tasks")
              .update({ google_event_id: eventId })
              .eq("id", task.id);
          results.push({
            task_id: task.id,
            title: task.title,
            ok: true,
            action: task.google_event_id ? "updated" : "created",
          });
        }
      } catch (e) {
        results.push({
          task_id: task.id,
          title: task.title,
          ok: false,
          action: gone ? "delete" : "upsert",
          error: e instanceof Error ? e.message : "error",
        });
        if (e instanceof CalendarNotConnectedError) break; // revoked: skip this user's other tasks
      }
    }
  }
  return {
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    users: connections?.length ?? 0,
    results,
  };
}
