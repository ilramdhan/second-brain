// Pure Google Calendar ↔ task mapping and conflict rules for the two-way sync (plan item 9.3).
// No I/O here: googleCalendarPull.server.ts fetches the changed events and applies the decisions.
//
// Echo prevention: every push stores the event `etag` Google returned in `tasks.google_etag`, and
// `tasks.google_synced_at` = the task `updated_at` that was pushed (or pulled). A pulled event
// whose etag equals the stored one is our own write coming back and is skipped; a task whose
// `updated_at` did not move past `google_synced_at` has no local change and is not pushed again.
//
// Conflicts are last-write-wins per task: when both sides changed since the last sync, the newer
// of Google's `updated` and the task's `updated_at` wins.
import type { Tables } from "@/integrations/supabase/types";

import { startOfZonedDay } from "./n8n/time.server";

export type GoogleEventTime = { dateTime?: string; date?: string; timeZone?: string };

/** The subset of a Calendar API event resource the sync reads. */
export type GoogleEvent = {
  id: string;
  status?: string;
  etag?: string;
  updated?: string;
  summary?: string;
  description?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  recurrence?: string[];
  recurringEventId?: string;
  eventType?: string;
  extendedProperties?: { private?: Record<string, string> };
};

export type SyncedTask = Pick<
  Tables<"tasks">,
  | "id"
  | "title"
  | "start_date"
  | "due_date"
  | "time_block_end"
  | "updated_at"
  | "google_event_id"
  | "google_etag"
  | "google_synced_at"
>;

/** Default length of an event for a task without an end (mirrors `taskToEvent`). */
export const DEFAULT_BLOCK_MS = 30 * 60_000;
const MINUTE = 60_000;

const ms = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Task id an app-created event carries (`extendedProperties.private.second_brain_task_id`). */
export function eventTaskId(event: GoogleEvent): string | null {
  return event.extendedProperties?.private?.["second_brain_task_id"] ?? null;
}

/** True when the task changed after its last sync with Google (or was never synced). */
export function needsPush(task: Pick<SyncedTask, "updated_at" | "google_synced_at">) {
  const synced = ms(task.google_synced_at);
  if (synced === null) return true;
  return (ms(task.updated_at) ?? 0) > synced;
}

/** Start of a Google time: `dateTime`, or local midnight of an all-day `date` in `tz`. */
function timeMs(t: GoogleEventTime | undefined, tz: string): number | null {
  if (!t) return null;
  if (t.dateTime) return ms(t.dateTime);
  if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    return startOfZonedDay(new Date(`${t.date}T12:00:00Z`), tz).getTime();
  return null;
}

/**
 * Event range in ms. All-day events (`date`) start at local midnight in `tz`; their exclusive end
 * date becomes 23:59 of the last day, so a one-day event stays on that day in the app.
 */
export function eventRange(event: GoogleEvent, tz: string): { start: number; end: number } | null {
  const start = timeMs(event.start, tz);
  if (start === null) return null;
  let end = timeMs(event.end, tz);
  if (end !== null && !event.end?.dateTime && event.end?.date) end -= MINUTE;
  if (end === null || end <= start) end = event.start?.dateTime ? start + DEFAULT_BLOCK_MS : start;
  return { start, end };
}

type DateField = "start_date" | "due_date" | "time_block_end";

/**
 * Which task columns produced the event's start and end in `taskToEvent`: start = start_date ??
 * due_date; end = time_block_end or due_date when after the start, otherwise start + 30 min
 * (`end: null`).
 */
export function taskEventSources(task: Pick<SyncedTask, DateField>) {
  const startField: DateField | null = task.start_date
    ? "start_date"
    : task.due_date
      ? "due_date"
      : null;
  const start = ms(startField ? task[startField] : null);
  let endField: DateField | null = null;
  if (start !== null) {
    const tbe = ms(task.time_block_end);
    const due = ms(task.due_date);
    if (tbe !== null && tbe > start) endField = "time_block_end";
    else if (due !== null && due > start && startField !== "due_date") endField = "due_date";
  }
  const end = endField ? ms(task[endField]) : start === null ? null : start + DEFAULT_BLOCK_MS;
  return { startField, endField, start, end };
}

const iso = (t: number) => new Date(t).toISOString();

export type TaskPatch = Partial<
  Pick<Tables<"tasks">, "title" | DateField | "reminded" | "google_etag">
>;

/**
 * Task changes that make the task match `event` (null when it already matches). Only the title
 * and the schedule are synced; descriptions stay app-owned. The column that produced the event
 * start gets the new start, the column that produced the end gets the new end, and a due date
 * that was not part of the event moves with the start so the task keeps its shape.
 */
export function eventToTaskPatch(task: SyncedTask, event: GoogleEvent, tz: string) {
  const patch: TaskPatch = {};
  const title = event.summary?.trim().slice(0, 300);
  if (title && title !== task.title) patch.title = title;

  const range = eventRange(event, tz);
  if (range) {
    const src = taskEventSources(task);
    if (src.start !== range.start || src.end !== range.end) {
      if (!src.startField) {
        patch.start_date = iso(range.start);
        patch.due_date = iso(range.end);
      } else {
        patch[src.startField] = iso(range.start);
        if (src.endField) patch[src.endField] = iso(range.end);
        else if (range.end !== range.start + DEFAULT_BLOCK_MS && range.end > range.start)
          patch.time_block_end = iso(range.end);
        const due = ms(task.due_date);
        if (src.startField === "start_date" && src.endField !== "due_date" && due !== null)
          patch.due_date = iso(due + (range.start - src.start!));
      }
      if (patch.due_date !== undefined && ms(patch.due_date) !== ms(task.due_date))
        patch.reminded = false;
      else delete patch.due_date;
      for (const f of ["start_date", "time_block_end"] as const)
        if (patch[f] !== undefined && ms(patch[f]) === ms(task[f])) delete patch[f];
    }
  }
  return Object.keys(patch).length ? patch : null;
}

export type PullDecision =
  /** our own push coming back (same etag) */
  | "echo"
  /** Google changed the event and wins: apply it to the task */
  | "apply"
  /** both changed and the task is newer: keep the task and push it */
  | "keep_local";

/** Conflict rule for a changed event linked to `task` (last write wins). */
export function decide(task: SyncedTask, event: GoogleEvent): PullDecision {
  if (task.google_etag && event.etag && event.etag === task.google_etag) return "echo";
  if (!needsPush(task)) return "apply";
  const local = ms(task.updated_at) ?? 0;
  const remote = ms(event.updated) ?? 0;
  return local > remote ? "keep_local" : "apply";
}

/**
 * Whether an unlinked event may become a task when the user opted into importing: a confirmed,
 * regular (not birthday/focus/out-of-office), non-recurring event that has not ended yet and was
 * not created by the app (an app event without a task means the task was deleted).
 */
export function importable(event: GoogleEvent, now: Date, tz: string) {
  if (event.status === "cancelled") return false;
  if (event.eventType && event.eventType !== "default") return false;
  if (event.recurrence?.length || event.recurringEventId) return false;
  if (eventTaskId(event)) return false;
  const range = eventRange(event, tz);
  return Boolean(range && range.end >= now.getTime());
}

/** New task for an imported event (start → start_date, end → due_date, like workflow 07). */
export function eventToNewTask(event: GoogleEvent, tz: string) {
  const range = eventRange(event, tz)!;
  return {
    title: event.summary?.trim().slice(0, 300) || "(Tanpa judul)",
    description: event.description?.trim().slice(0, 20_000) || null,
    start_date: iso(range.start),
    due_date: iso(range.end > range.start ? range.end : range.start),
  };
}
