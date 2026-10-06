import { describe, expect, it } from "vitest";

import {
  decide,
  eventRange,
  eventToNewTask,
  eventToTaskPatch,
  importable,
  needsPush,
  taskEventSources,
  type GoogleEvent,
  type SyncedTask,
} from "./googleCalendarMapping.server";

const TZ = "Asia/Jakarta";

const task = (over: Partial<SyncedTask> = {}): SyncedTask => ({
  id: "t1",
  title: "Rapat",
  start_date: null,
  due_date: "2026-10-10T03:00:00.000Z",
  time_block_end: null,
  updated_at: "2026-10-07T01:00:00.000Z",
  google_event_id: "ev1",
  google_etag: '"e1"',
  google_synced_at: "2026-10-07T01:00:00.000Z",
  ...over,
});

const event = (over: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: "ev1",
  status: "confirmed",
  etag: '"e2"',
  updated: "2026-10-07T02:00:00.000Z",
  summary: "Rapat",
  start: { dateTime: "2026-10-10T03:00:00Z" },
  end: { dateTime: "2026-10-10T03:30:00Z" },
  ...over,
});

describe("eventRange", () => {
  it("reads timed events", () => {
    expect(eventRange(event(), TZ)).toEqual({
      start: Date.parse("2026-10-10T03:00:00Z"),
      end: Date.parse("2026-10-10T03:30:00Z"),
    });
  });
  it("maps an all-day event to local midnight .. 23:59 of the last day", () => {
    const r = eventRange(
      event({ start: { date: "2026-10-10" }, end: { date: "2026-10-11" } }),
      TZ,
    )!;
    expect(new Date(r.start).toISOString()).toBe("2026-10-09T17:00:00.000Z");
    expect(new Date(r.end).toISOString()).toBe("2026-10-10T16:59:00.000Z");
  });
  it("returns null without a start", () => {
    const { start: _start, ...noStart } = event();
    expect(eventRange(noStart as GoogleEvent, TZ)).toBeNull();
  });
});

describe("taskEventSources", () => {
  it("mirrors taskToEvent: due-only task is a 30 minute block", () => {
    const s = taskEventSources(task());
    expect(s.startField).toBe("due_date");
    expect(s.endField).toBeNull();
    expect(s.end! - s.start!).toBe(30 * 60_000);
  });
  it("start + later due → start/due", () => {
    const s = taskEventSources(task({ start_date: "2026-10-10T01:00:00.000Z" }));
    expect([s.startField, s.endField]).toEqual(["start_date", "due_date"]);
  });
});

describe("eventToTaskPatch", () => {
  it("returns null when nothing synced changed", () => {
    expect(eventToTaskPatch(task(), event(), TZ)).toBeNull();
  });
  it("copies a new title", () => {
    expect(eventToTaskPatch(task(), event({ summary: "Rapat tim" }), TZ)).toEqual({
      title: "Rapat tim",
    });
  });
  it("moves a due-only task and resets the reminder", () => {
    const patch = eventToTaskPatch(
      task(),
      event({
        start: { dateTime: "2026-10-11T03:00:00Z" },
        end: { dateTime: "2026-10-11T03:30:00Z" },
      }),
      TZ,
    );
    expect(patch).toEqual({ due_date: "2026-10-11T03:00:00.000Z", reminded: false });
  });
  it("keeps a longer block in time_block_end", () => {
    const patch = eventToTaskPatch(
      task(),
      event({ end: { dateTime: "2026-10-10T05:00:00Z" } }),
      TZ,
    );
    expect(patch).toEqual({ time_block_end: "2026-10-10T05:00:00.000Z" });
  });
  it("updates start and due of a ranged task", () => {
    const t = task({ start_date: "2026-10-10T01:00:00.000Z" });
    const patch = eventToTaskPatch(
      t,
      event({
        start: { dateTime: "2026-10-12T01:00:00Z" },
        end: { dateTime: "2026-10-12T04:00:00Z" },
      }),
      TZ,
    );
    expect(patch).toEqual({
      start_date: "2026-10-12T01:00:00.000Z",
      due_date: "2026-10-12T04:00:00.000Z",
      reminded: false,
    });
  });
  it("moves the due date with the start when the block end is time_block_end", () => {
    const t = task({
      start_date: "2026-10-10T01:00:00.000Z",
      time_block_end: "2026-10-10T02:00:00.000Z",
      due_date: "2026-10-15T00:00:00.000Z",
    });
    const patch = eventToTaskPatch(
      t,
      event({
        start: { dateTime: "2026-10-11T01:00:00Z" },
        end: { dateTime: "2026-10-11T02:00:00Z" },
      }),
      TZ,
    );
    expect(patch).toEqual({
      start_date: "2026-10-11T01:00:00.000Z",
      time_block_end: "2026-10-11T02:00:00.000Z",
      due_date: "2026-10-16T00:00:00.000Z",
      reminded: false,
    });
  });
});

describe("conflict rule (decide / needsPush)", () => {
  it("skips our own write coming back (same etag)", () => {
    expect(decide(task(), event({ etag: '"e1"' }))).toBe("echo");
  });
  it("applies Google changes when the task is unchanged since the last sync", () => {
    expect(decide(task(), event())).toBe("apply");
  });
  it("last write wins: newer task keeps local", () => {
    const t = task({ updated_at: "2026-10-07T03:00:00.000Z" });
    expect(decide(t, event({ updated: "2026-10-07T02:00:00.000Z" }))).toBe("keep_local");
  });
  it("last write wins: newer Google change is applied", () => {
    const t = task({ updated_at: "2026-10-07T03:00:00.000Z" });
    expect(decide(t, event({ updated: "2026-10-07T04:00:00.000Z" }))).toBe("apply");
  });
  it("needsPush only after a local change", () => {
    expect(needsPush(task())).toBe(false);
    expect(needsPush(task({ google_synced_at: null }))).toBe(true);
    expect(needsPush(task({ updated_at: "2026-10-07T01:00:01.000Z" }))).toBe(true);
  });
});

describe("import", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  it("accepts a future one-off event", () => {
    expect(importable(event(), now, TZ)).toBe(true);
  });
  it("rejects cancelled, recurring, special, past and app-created events", () => {
    expect(importable(event({ status: "cancelled" }), now, TZ)).toBe(false);
    expect(importable(event({ recurringEventId: "r" }), now, TZ)).toBe(false);
    expect(importable(event({ eventType: "birthday" }), now, TZ)).toBe(false);
    const past = {
      start: { dateTime: "2026-10-01T00:00:00Z" },
      end: { dateTime: "2026-10-01T01:00:00Z" },
    };
    expect(importable(event(past), now, TZ)).toBe(false);
    expect(
      importable(
        event({ extendedProperties: { private: { second_brain_task_id: "x" } } }),
        now,
        TZ,
      ),
    ).toBe(false);
  });
  it("maps start → start_date and end → due_date", () => {
    expect(eventToNewTask(event({ summary: " Demo ", description: "x" }), TZ)).toEqual({
      title: "Demo",
      description: "x",
      start_date: "2026-10-10T03:00:00.000Z",
      due_date: "2026-10-10T03:30:00.000Z",
    });
  });
});
