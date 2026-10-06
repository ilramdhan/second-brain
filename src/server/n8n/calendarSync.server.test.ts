import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal chainable PostgREST stand-in: every query resolves to the rows registered for its table.
const rows: Record<string, unknown[]> = {};
const updates: { table: string; patch: unknown; id: unknown }[] = [];
function query(table: string) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ["select", "eq", "not", "gte", "order", "limit"]) q[m] = chain;
  q["update"] = (patch: unknown) => ({
    eq: async (_c: string, id: unknown) => {
      updates.push({ table, patch, id });
      return { error: null };
    },
  });
  q["then"] = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rows[table] ?? [], error: null });
  return q;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => query(t) },
}));

const upsertTaskEvent = vi.fn(async () => ({ id: "ev1", etag: '"new"' }));
vi.mock("../googleCalendar.server", async (orig) => ({
  ...(await orig<typeof import("../googleCalendar.server")>()),
  upsertTaskEvent: (...a: unknown[]) => upsertTaskEvent(...(a as [])),
  deleteTaskEvent: vi.fn(async () => {}),
}));
const pullCalendar = vi.fn(async () => ({
  full_sync: false,
  resynced: false,
  events: 1,
  echoes: 0,
  items: [{ event_id: "ev2", task_id: "t2", title: "x", ok: true, action: "updated" as const }],
}));
vi.mock("../googleCalendarPull.server", () => ({
  pullCalendar: (...a: unknown[]) => pullCalendar(...(a as [])),
}));

import { calendarSyncSchema } from "./schemas.server";
import { syncCalendars } from "./calendarSync.server";

const base = {
  title: "Rapat",
  description: null,
  start_date: null,
  due_date: "2026-10-10T03:00:00.000Z",
  time_block_end: null,
  deleted_at: null,
  archived_at: null,
};

beforeEach(() => {
  updates.length = 0;
  upsertTaskEvent.mockClear();
  pullCalendar.mockClear();
  rows["app_user_connections"] = [{ user_id: "u1" }];
  rows["tasks"] = [
    // changed locally after the last sync → pushed
    {
      ...base,
      id: "t1",
      google_event_id: "ev1",
      updated_at: "2026-10-07T02:00:00.000Z",
      google_synced_at: "2026-10-07T01:00:00.000Z",
    },
    // just pulled from Google (synced_at == updated_at) → not echoed back
    {
      ...base,
      id: "t2",
      google_event_id: "ev2",
      updated_at: "2026-10-07T02:00:00.000Z",
      google_synced_at: "2026-10-07T02:00:00.000Z",
    },
  ];
});

describe("calendarSyncSchema", () => {
  it("defaults to a two-way sync and accepts push/pull", () => {
    expect(calendarSyncSchema.parse({}).direction).toBe("both");
    expect(calendarSyncSchema.parse({ direction: "push" }).direction).toBe("push");
    expect(() => calendarSyncSchema.parse({ direction: "sideways" })).toThrow();
  });
});

describe("syncCalendars", () => {
  it("pulls first, then pushes only tasks changed since their last sync", async () => {
    const r = await syncCalendars({ sinceMinutes: 45, limit: 200, mode: "linked" });
    expect(pullCalendar).toHaveBeenCalledWith("u1");
    expect(upsertTaskEvent).toHaveBeenCalledTimes(1);
    expect(r.results.map((x) => x.task_id)).toEqual(["t1"]);
    expect(updates).toEqual([
      {
        table: "tasks",
        id: "t1",
        patch: {
          google_event_id: "ev1",
          google_etag: '"new"',
          google_synced_at: "2026-10-07T02:00:00.000Z",
        },
      },
    ]);
    expect(r.pull.applied).toBe(1);
  });

  it("direction=push skips the pull; direction=pull skips the push", async () => {
    await syncCalendars({ sinceMinutes: 45, limit: 200, mode: "linked", direction: "push" });
    expect(pullCalendar).not.toHaveBeenCalled();
    upsertTaskEvent.mockClear();
    await syncCalendars({ sinceMinutes: 45, limit: 200, mode: "linked", direction: "pull" });
    expect(pullCalendar).toHaveBeenCalledTimes(1);
    expect(upsertTaskEvent).not.toHaveBeenCalled();
  });

  it("reports a failed pull without stopping the push", async () => {
    pullCalendar.mockRejectedValueOnce(new Error("Google Calendar gagal [500]"));
    const r = await syncCalendars({ sinceMinutes: 45, limit: 200, mode: "linked" });
    expect(r.pull.users[0]).toMatchObject({ ok: false, error: "Google Calendar gagal [500]" });
    expect(r.pull.failed).toBe(1);
    expect(r.synced).toBe(1);
  });
});
