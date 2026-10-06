// Google → app direction of the Google Calendar sync (plan item 9.3).
//
// `pullCalendar` lists the events that changed in the user's primary calendar since the last pull
// (Calendar API events.list with the stored `syncToken`; no token = full sync) and applies them:
//
//   * Event linked to a task (`tasks.google_event_id`): the conflict rule in
//     googleCalendarMapping.server.ts decides. `echo` (same etag as our own last write) is skipped;
//     `apply` copies the title and schedule into the task through the server-side task rules
//     (dependent auto-shift, reminder reset, `runAutomationRules`); `keep_local` (the task changed
//     after Google did) pushes the task back to Google right away.
//   * Cancelled (deleted) linked event: the link is cleared and the task keeps its dates. A
//     deadline is app data, deleting the calendar block should not silently drop it; the task can
//     be sent to Google again from the task dialog.
//   * Unlinked event: imported as a task only when the user opted in ("Impor acara Google sebagai
//     tugas", `app_user_connections.import_events`) and the event is importable (see mapping).
//
// A 410 GONE answer means Google expired the sync token: the token is dropped and the pull starts
// again as a full sync (once). The new `nextSyncToken` is stored only when every event of the
// pull was applied, so a failed event is retried next time (applying is idempotent thanks to the
// etag/`google_synced_at` markers).
//
// All I/O goes through `PullDeps`, so tests run the whole flow with a mocked fetch and an
// in-memory store; `pullCalendar` without deps uses the service-role database adapter below.
import type { Tables } from "@/integrations/supabase/types";

import { appTimezone } from "./n8n/time.server";
import {
  decide,
  eventTaskId,
  eventToNewTask,
  eventToTaskPatch,
  importable,
  needsPush,
  type GoogleEvent,
  type SyncedTask,
  type TaskPatch,
} from "./googleCalendarMapping.server";

export const EVENTS_PAGE_SIZE = 2500;
export const MAX_PAGES = 20;

/** Full linked task row the pull works with (push needs description too). */
export type PullTask = SyncedTask & Pick<Tables<"tasks">, "description">;

export type PullConnection = { syncToken: string | null; importEvents: boolean };

export type PullStore = {
  connection(userId: string): Promise<PullConnection | null>;
  saveSyncToken(userId: string, syncToken: string | null): Promise<void>;
  /** Live tasks the user can reach that are linked to an event, keyed by nothing (list). */
  linkedTasks(userId: string): Promise<PullTask[]>;
  /** Applies a Google change through the task rules; returns the new `updated_at`. */
  applyPatch(userId: string, task: PullTask, patch: TaskPatch): Promise<string>;
  /** Bookkeeping only (`google_*` columns); never touches `updated_at`. */
  mark(
    taskId: string,
    fields: Partial<Pick<Tables<"tasks">, "google_event_id" | "google_etag" | "google_synced_at">>,
  ): Promise<void>;
  importTask(
    userId: string,
    task: ReturnType<typeof eventToNewTask>,
    event: GoogleEvent,
  ): Promise<{ id: string }>;
  /** Pushes a task that won a conflict back to Google; returns the event etag. */
  push(userId: string, task: PullTask): Promise<{ id: string; etag: string | null }>;
};

export type PullDeps = {
  fetch: typeof fetch;
  accessToken(userId: string): Promise<string>;
  store: PullStore;
  now?: () => Date;
  tz?: string;
};

export type PullItem = {
  event_id: string;
  task_id: string | null;
  title: string;
  ok: boolean;
  action: "updated" | "imported" | "unlinked" | "pushed" | "skipped";
  error?: string;
};

export type PullResult = {
  full_sync: boolean;
  resynced: boolean;
  events: number;
  echoes: number;
  items: PullItem[];
};

export class SyncTokenGoneError extends Error {
  constructor() {
    super("Google Calendar sync token kedaluwarsa (410).");
    this.name = "SyncTokenGoneError";
  }
}

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/**
 * One events.list page. The same parameters are sent on full and incremental syncs (Google
 * requires the set to stay identical); `showDeleted` is needed to see cancelled events.
 */
export function eventsListUrl(opts: { syncToken?: string | null; pageToken?: string | null }) {
  const url = new URL(EVENTS_URL);
  url.searchParams.set("maxResults", String(EVENTS_PAGE_SIZE));
  url.searchParams.set("showDeleted", "true");
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);
  else if (opts.syncToken) url.searchParams.set("syncToken", opts.syncToken);
  return url.toString();
}

type EventsPage = { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };

/** Every changed event since `syncToken` (all pages) and the next sync token. */
export async function listChangedEvents(
  doFetch: typeof fetch,
  token: string,
  syncToken: string | null,
): Promise<{ events: GoogleEvent[]; nextSyncToken: string | null }> {
  const events: GoogleEvent[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await doFetch(eventsListUrl({ syncToken, pageToken }), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 410) throw new SyncTokenGoneError();
    if (!res.ok) throw new Error(`Google Calendar gagal [${res.status}]`);
    const body = (await res.json()) as EventsPage;
    events.push(...(body.items ?? []).filter((e) => e && typeof e.id === "string"));
    if (body.nextPageToken) {
      pageToken = body.nextPageToken;
      continue;
    }
    return { events, nextSyncToken: body.nextSyncToken ?? null };
  }
  throw new Error(
    `Google Calendar: lebih dari ${MAX_PAGES} halaman event, sinkronisasi dihentikan.`,
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "error");

export async function pullCalendar(userId: string, deps?: PullDeps): Promise<PullResult> {
  const d = deps ?? (await defaultPullDeps());
  const now = (d.now ?? (() => new Date()))();
  const tz = d.tz ?? appTimezone();
  const connection = await d.store.connection(userId);
  if (!connection) {
    const { CalendarNotConnectedError } = await import("./googleCalendar.server");
    throw new CalendarNotConnectedError();
  }
  const token = await d.accessToken(userId);

  let resynced = false;
  let syncToken = connection.syncToken;
  let listed: Awaited<ReturnType<typeof listChangedEvents>>;
  try {
    listed = await listChangedEvents(d.fetch, token, syncToken);
  } catch (e) {
    if (!(e instanceof SyncTokenGoneError) || !syncToken) throw e;
    // Token expired at Google: forget it and start over with a full sync.
    await d.store.saveSyncToken(userId, null);
    resynced = true;
    syncToken = null;
    listed = await listChangedEvents(d.fetch, token, null);
  }

  const byEvent = new Map<string, PullTask>();
  for (const t of await d.store.linkedTasks(userId))
    if (t.google_event_id) byEvent.set(t.google_event_id, t);

  const items: PullItem[] = [];
  let echoes = 0;
  for (const event of listed.events) {
    const task = byEvent.get(event.id) ?? null;
    try {
      if (task) {
        const decision = decide(task, event);
        if (decision === "echo") {
          echoes++;
          continue;
        }
        if (decision === "keep_local") {
          const pushed = await d.store.push(userId, task);
          await d.store.mark(task.id, {
            google_event_id: pushed.id,
            google_etag: pushed.etag,
            google_synced_at: task.updated_at,
          });
          items.push({
            event_id: event.id,
            task_id: task.id,
            title: task.title,
            ok: true,
            action: "pushed",
          });
          continue;
        }
        if (event.status === "cancelled") {
          await d.store.mark(task.id, {
            google_event_id: null,
            google_etag: null,
            google_synced_at: task.updated_at,
          });
          items.push({
            event_id: event.id,
            task_id: task.id,
            title: task.title,
            ok: true,
            action: "unlinked",
          });
          continue;
        }
        const patch = eventToTaskPatch(task, event, tz);
        if (!patch) {
          // Nothing the app syncs changed (e.g. a guest list): just remember the new etag. A
          // pending local change stays pending (google_synced_at untouched) and is pushed later.
          await d.store.mark(task.id, { google_etag: event.etag ?? null });
          items.push({
            event_id: event.id,
            task_id: task.id,
            title: task.title,
            ok: true,
            action: "skipped",
          });
          continue;
        }
        const dirty = needsPush(task);
        const updatedAt = await d.store.applyPatch(userId, task, patch);
        await d.store.mark(task.id, {
          google_etag: event.etag ?? null,
          // A change that came from Google is not pushed back. If the task also had an older
          // local edit (Google won the conflict), keep it pending so the merged task is pushed.
          ...(dirty ? {} : { google_synced_at: updatedAt }),
        });
        items.push({
          event_id: event.id,
          task_id: task.id,
          title: patch.title ?? task.title,
          ok: true,
          action: "updated",
        });
      } else if (connection.importEvents && importable(event, now, tz) && !eventTaskId(event)) {
        const created = await d.store.importTask(userId, eventToNewTask(event, tz), event);
        items.push({
          event_id: event.id,
          task_id: created.id,
          title: event.summary ?? "",
          ok: true,
          action: "imported",
        });
      }
    } catch (e) {
      items.push({
        event_id: event.id,
        task_id: task?.id ?? null,
        title: task?.title ?? event.summary ?? "",
        ok: false,
        action: task ? "updated" : "imported",
        error: errorText(e),
      });
    }
  }

  // Advance only when everything applied, so a failed event is retried on the next pull.
  if (listed.nextSyncToken && items.every((i) => i.ok))
    await d.store.saveSyncToken(userId, listed.nextSyncToken);

  return {
    full_sync: syncToken === null,
    resynced,
    events: listed.events.length,
    echoes,
    items,
  };
}

/* ---------------- service-role adapter ---------------- */

const LINKED_COLUMNS =
  "id,title,description,start_date,due_date,time_block_end,updated_at,google_event_id,google_etag,google_synced_at";

async function defaultPullDeps(): Promise<PullDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const gcal = await import("./googleCalendar.server");
  const { GOOGLE_CALENDAR_CONNECTOR } = await import("./googleOAuth.server");
  const svc = await import("./n8n/service.server");

  const store: PullStore = {
    async connection(userId) {
      const { data } = await supabaseAdmin
        .from("app_user_connections")
        .select("sync_token,import_events")
        .eq("user_id", userId)
        .eq("connector_id", GOOGLE_CALENDAR_CONNECTOR)
        .maybeSingle();
      return data ? { syncToken: data.sync_token, importEvents: data.import_events } : null;
    },
    async saveSyncToken(userId, syncToken) {
      const { error } = await supabaseAdmin
        .from("app_user_connections")
        .update({ sync_token: syncToken, last_pulled_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("connector_id", GOOGLE_CALENDAR_CONNECTOR);
      if (error) throw new Error(`sync token save failed: ${error.message}`);
    },
    async linkedTasks(userId) {
      const projects = await svc.accessibleProjectIds(userId);
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .select(LINKED_COLUMNS)
        .not("google_event_id", "is", null)
        .or(svc.scopeFilter(userId, projects))
        .is("deleted_at", null)
        .is("archived_at", null);
      if (error) throw new Error(`linked tasks failed: ${error.message}`);
      return data ?? [];
    },
    async applyPatch(userId, task, patch) {
      const before = await svc.findTask(userId, task.id);
      if (!before) throw new Error("Tugas tidak ditemukan.");
      return svc.updateTaskFromCalendar(userId, before, patch, null);
    },
    async mark(taskId, fields) {
      const { error } = await supabaseAdmin.from("tasks").update(fields).eq("id", taskId);
      if (error) throw new Error(`task mark failed: ${error.message}`);
    },
    async importTask(userId, task, event) {
      const created = await svc.createTask(
        userId,
        { ...task, google_event_id: event.id, google_etag: event.etag ?? null },
        null,
      );
      await supabaseAdmin
        .from("tasks")
        .update({ google_synced_at: created.updated_at })
        .eq("id", created.id);
      return created;
    },
    async push(userId, task) {
      return gcal.upsertTaskEvent(userId, task);
    },
  };
  return { fetch: (...args) => fetch(...args), accessToken: gcal.getAccessToken, store };
}
