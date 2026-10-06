// POST /api/public/n8n/calendar/sync — two-way Google Calendar sync for each connected user.
//
// direction=pull|both: Google → app first (googleCalendarPull.server.ts: incremental events.list
// with the stored sync token, last-write-wins, optional import of unlinked events).
// direction=push|both: app → Google. mode=linked (default) only updates tasks the user already
// sent to Google ("Kirim ke Google Calendar", google_event_id set) and removes events of
// trashed/archived/undated tasks; mode=all also creates events for every dated task changed in
// the window. A task is pushed only when it changed after its last sync (`updated_at` >
// `google_synced_at`), so a change that just came from Google is never echoed back.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import {
  CalendarNotConnectedError,
  deleteTaskEvent,
  pushedFields,
  upsertTaskEvent,
} from "../googleCalendar.server";
import { needsPush } from "../googleCalendarMapping.server";
import { pullCalendar, type PullItem } from "../googleCalendarPull.server";
import { GOOGLE_CALENDAR_CONNECTOR } from "../googleOAuth.server";

export type SyncResult = {
  task_id: string;
  title: string;
  ok: boolean;
  action: string;
  error?: string;
};

export type SyncDirection = "push" | "pull" | "both";

export type PullSummary = {
  user_id: string;
  ok: boolean;
  full_sync?: boolean;
  resynced?: boolean;
  events?: number;
  echoes?: number;
  error?: string;
};

/** Pulls Google changes for one user; never throws (the error is part of the summary). */
export async function pullForUser(userId: string, items: PullItem[]): Promise<PullSummary> {
  try {
    const r = await pullCalendar(userId);
    items.push(...r.items);
    return {
      user_id: userId,
      ok: r.items.every((i) => i.ok),
      full_sync: r.full_sync,
      resynced: r.resynced,
      events: r.events,
      echoes: r.echoes,
    };
  } catch (e) {
    return { user_id: userId, ok: false, error: e instanceof Error ? e.message : "error" };
  }
}

export async function syncCalendars(opts: {
  sinceMinutes: number;
  limit: number;
  userId?: string;
  mode: "linked" | "all";
  direction?: SyncDirection;
}) {
  const direction = opts.direction ?? "both";
  let users = supabaseAdmin
    .from("app_user_connections")
    .select("user_id")
    .eq("connector_id", GOOGLE_CALENDAR_CONNECTOR);
  if (opts.userId) users = users.eq("user_id", opts.userId);
  const { data: connections, error } = await users;
  if (error) throw new Error(error.message);

  // Google → app first: conflicts are resolved there, and tasks it updates are marked as synced
  // so the push below skips them.
  const pulled: PullSummary[] = [];
  const pullItems: PullItem[] = [];
  if (direction !== "push")
    for (const { user_id } of connections ?? []) pulled.push(await pullForUser(user_id, pullItems));

  const since = new Date(Date.now() - opts.sinceMinutes * 60_000).toISOString();
  const results: SyncResult[] = [];
  for (const { user_id } of direction === "pull" ? [] : (connections ?? [])) {
    if (results.length >= opts.limit) break;
    let query = supabaseAdmin
      .from("tasks")
      .select(
        "id,title,description,start_date,due_date,time_block_end,updated_at,google_event_id,google_synced_at,deleted_at,archived_at",
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
          await supabaseAdmin
            .from("tasks")
            .update({ google_event_id: null, google_etag: null, google_synced_at: null })
            .eq("id", task.id);
          results.push({ task_id: task.id, title: task.title, ok: true, action: "deleted" });
        } else {
          if (task.google_event_id && !needsPush(task)) continue; // unchanged or came from Google
          const event = await upsertTaskEvent(user_id, task);
          await supabaseAdmin
            .from("tasks")
            .update(pushedFields(event, task.updated_at))
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

  const pullFailed =
    pullItems.filter((i) => !i.ok).length + pulled.filter((p) => !p.ok && p.error).length;
  return {
    direction,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    users: connections?.length ?? 0,
    results,
    pull: {
      users: pulled,
      applied: pullItems.filter((i) => i.ok && i.action !== "skipped").length,
      failed: pullFailed,
      results: pullItems,
    },
  };
}
