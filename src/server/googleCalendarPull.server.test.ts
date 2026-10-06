import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import type { GoogleEvent } from "./googleCalendarMapping.server";
import {
  eventsListUrl,
  pullCalendar,
  type PullDeps,
  type PullStore,
  type PullTask,
} from "./googleCalendarPull.server";

const linked = (over: Partial<PullTask> = {}): PullTask => ({
  id: "t1",
  title: "Rapat",
  description: null,
  start_date: null,
  due_date: "2026-10-10T03:00:00.000Z",
  time_block_end: null,
  updated_at: "2026-10-07T01:00:00.000Z",
  google_event_id: "ev1",
  google_etag: '"e1"',
  google_synced_at: "2026-10-07T01:00:00.000Z",
  ...over,
});

const ev = (over: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: "ev1",
  status: "confirmed",
  etag: '"e2"',
  updated: "2026-10-07T02:00:00.000Z",
  summary: "Rapat",
  start: { dateTime: "2026-10-11T03:00:00Z" },
  end: { dateTime: "2026-10-11T03:30:00Z" },
  ...over,
});

type Page = {
  status?: number;
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

/** Mocked fetch answering events.list calls with `pages` in order; records the URLs. */
function mockFetch(pages: Page[]) {
  const urls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const page = pages.shift();
    if (!page) throw new Error("unexpected fetch");
    const { status = 200, ...body } = page;
    return new Response(JSON.stringify(body), { status });
  });
  return { fetch: fn as unknown as typeof fetch, urls };
}

function setup(opts: {
  pages: Page[];
  syncToken?: string | null;
  importEvents?: boolean;
  tasks?: PullTask[];
}) {
  const { fetch, urls } = mockFetch(opts.pages);
  const state = {
    syncToken: opts.syncToken ?? null,
    savedTokens: [] as (string | null)[],
    patches: [] as { id: string; patch: unknown }[],
    marks: [] as { id: string; fields: unknown }[],
    imported: [] as unknown[],
    pushed: [] as string[],
  };
  const store: PullStore = {
    connection: async () => ({ syncToken: state.syncToken, importEvents: !!opts.importEvents }),
    saveSyncToken: async (_u, t) => {
      state.syncToken = t;
      state.savedTokens.push(t);
    },
    linkedTasks: async () => opts.tasks ?? [linked()],
    applyPatch: async (_u, task, patch) => {
      state.patches.push({ id: task.id, patch });
      return "2026-10-07T05:00:00.000Z";
    },
    mark: async (id, fields) => {
      state.marks.push({ id, fields });
    },
    importTask: async (_u, task) => {
      state.imported.push(task);
      return { id: "new" };
    },
    push: async (_u, task) => {
      state.pushed.push(task.id);
      return { id: task.google_event_id ?? "evX", etag: '"pushed"' };
    },
  };
  const deps: PullDeps = {
    fetch,
    accessToken: async () => "tok",
    store,
    now: () => new Date("2026-10-07T00:00:00Z"),
    tz: "Asia/Jakarta",
  };
  return { deps, state, urls };
}

describe("eventsListUrl", () => {
  it("sends the same parameters on full and incremental syncs", () => {
    const full = new URL(eventsListUrl({}));
    const inc = new URL(eventsListUrl({ syncToken: "s1" }));
    expect(full.searchParams.get("showDeleted")).toBe("true");
    expect(full.searchParams.has("syncToken")).toBe(false);
    expect(inc.searchParams.get("syncToken")).toBe("s1");
    expect(inc.searchParams.has("timeMin")).toBe(false);
  });
});

describe("pullCalendar", () => {
  it("full sync without a token, pages through and stores nextSyncToken", async () => {
    const { deps, state, urls } = setup({
      pages: [
        { items: [], nextPageToken: "p2" },
        { items: [ev()], nextSyncToken: "s2" },
      ],
    });
    const r = await pullCalendar("u1", deps);
    expect(r.full_sync).toBe(true);
    expect(new URL(urls[1]!).searchParams.get("pageToken")).toBe("p2");
    expect(state.patches).toEqual([
      { id: "t1", patch: { due_date: "2026-10-11T03:00:00.000Z", reminded: false } },
    ]);
    // Pulled change marked as synced → never re-pushed; etag remembered for echo detection.
    expect(state.marks).toEqual([
      { id: "t1", fields: { google_etag: '"e2"', google_synced_at: "2026-10-07T05:00:00.000Z" } },
    ]);
    expect(state.syncToken).toBe("s2");
  });

  it("uses the stored sync token incrementally", async () => {
    const { deps, urls } = setup({ syncToken: "s1", pages: [{ items: [], nextSyncToken: "s2" }] });
    const r = await pullCalendar("u1", deps);
    expect(r.full_sync).toBe(false);
    expect(new URL(urls[0]!).searchParams.get("syncToken")).toBe("s1");
  });

  it("410 GONE drops the token and does a full resync", async () => {
    const { deps, state, urls } = setup({
      syncToken: "old",
      pages: [{ status: 410 }, { items: [ev()], nextSyncToken: "fresh" }],
    });
    const r = await pullCalendar("u1", deps);
    expect(r.resynced).toBe(true);
    expect(r.full_sync).toBe(true);
    expect(new URL(urls[1]!).searchParams.has("syncToken")).toBe(false);
    expect(state.savedTokens).toEqual([null, "fresh"]);
    expect(state.patches).toHaveLength(1);
  });

  it("skips echoes of our own push (same etag)", async () => {
    const { deps, state } = setup({
      pages: [{ items: [ev({ etag: '"e1"' })], nextSyncToken: "s2" }],
    });
    const r = await pullCalendar("u1", deps);
    expect(r.echoes).toBe(1);
    expect(state.patches).toEqual([]);
    expect(state.marks).toEqual([]);
    expect(state.pushed).toEqual([]);
  });

  it("conflict: newer local task wins and is pushed back", async () => {
    const { deps, state } = setup({
      tasks: [linked({ updated_at: "2026-10-07T03:00:00.000Z" })],
      pages: [{ items: [ev({ updated: "2026-10-07T02:00:00.000Z" })], nextSyncToken: "s2" }],
    });
    const r = await pullCalendar("u1", deps);
    expect(state.patches).toEqual([]);
    expect(state.pushed).toEqual(["t1"]);
    expect(r.items[0]!.action).toBe("pushed");
    expect(state.marks[0]!.fields).toMatchObject({ google_etag: '"pushed"' });
  });

  it("conflict: newer Google change wins but the older local edit stays pending", async () => {
    const { deps, state } = setup({
      tasks: [linked({ updated_at: "2026-10-07T01:30:00.000Z" })],
      pages: [{ items: [ev({ updated: "2026-10-07T02:00:00.000Z" })], nextSyncToken: "s2" }],
    });
    await pullCalendar("u1", deps);
    expect(state.patches).toHaveLength(1);
    expect(state.marks[0]!.fields).toEqual({ google_etag: '"e2"' });
  });

  it("cancelled linked event clears the link and keeps the task dates", async () => {
    const { deps, state } = setup({
      pages: [{ items: [{ id: "ev1", status: "cancelled", etag: '"e3"' }], nextSyncToken: "s2" }],
    });
    const r = await pullCalendar("u1", deps);
    expect(r.items[0]!.action).toBe("unlinked");
    expect(state.patches).toEqual([]);
    expect(state.marks[0]!.fields).toMatchObject({ google_event_id: null, google_etag: null });
  });

  it("imports unlinked events only when opted in", async () => {
    const other = ev({ id: "ev9", summary: "Dokter" });
    const off = setup({ pages: [{ items: [other], nextSyncToken: "s" }] });
    await pullCalendar("u1", off.deps);
    expect(off.state.imported).toEqual([]);

    const on = setup({ importEvents: true, pages: [{ items: [other], nextSyncToken: "s" }] });
    const r = await pullCalendar("u1", on.deps);
    expect(on.state.imported).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ action: "imported", task_id: "new" });
  });

  it("does not advance the sync token when an event failed", async () => {
    const { deps, state } = setup({ pages: [{ items: [ev()], nextSyncToken: "s2" }] });
    deps.store.applyPatch = async () => {
      throw new Error("boom");
    };
    const r = await pullCalendar("u1", deps);
    expect(r.items[0]).toMatchObject({ ok: false, error: "boom" });
    expect(state.savedTokens).toEqual([]);
  });

  it("propagates other API errors", async () => {
    const { deps } = setup({ syncToken: "s1", pages: [{ status: 500 }] });
    await expect(pullCalendar("u1", deps)).rejects.toThrow(/500/);
  });
});
