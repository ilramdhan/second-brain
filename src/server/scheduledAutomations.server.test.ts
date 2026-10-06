import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Action } from "@/lib/automation-types";
import { fakeSupabase } from "@/test/fake-supabase";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const sendTelegram = vi.fn<(chat: string, text: string, o?: unknown) => Promise<string | null>>();
vi.mock("@/lib/telegram.server", () => ({ sendTelegram }));
const loadDigestData = vi.fn();
vi.mock("./n8n/digest.server", () => ({ loadDigestData }));

const { computeNextRun, runDueAutomations } = await import("./scheduledAutomations.server");

type Row = Record<string, unknown>;
const U1 = "u1";
const U2 = "u2";
const P1 = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-07T01:02:00Z"); // 08:02 WIB, Wednesday

const sched = (extra: Row = {}): Row => ({
  id: "r1",
  user_id: U1,
  name: "Pagi",
  enabled: true,
  run_count: 0,
  trigger: { type: "schedule" },
  conditions: [],
  actions: [{ type: "create_task", title: "Review {{weekday}}", due_in_days: 0 }] as Action[],
  schedule_cron: "0 8 * * *",
  schedule_tz: null,
  next_run_at: "2026-10-07T01:00:00.000Z",
  last_run_at: null,
  ...extra,
});

function setup(automations: Row[], extra: Record<string, Row[]> = {}) {
  return fakeSupabase({
    automations,
    tasks: [],
    automation_runs: [],
    projects: [{ id: P1, user_id: U1, name: "Web", deleted_at: null }],
    project_members: [],
    profiles: [{ id: U1, telegram_chat_id: "42" }],
    ...extra,
  });
}

beforeEach(() => {
  vi.stubEnv("APP_TIMEZONE", "Asia/Jakarta");
  sendTelegram.mockReset().mockResolvedValue(null);
  loadDigestData.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("computeNextRun", () => {
  const base = { enabled: true, trigger: { type: "schedule" }, schedule_tz: null };
  it("uses the rule's zone or the fallback", () => {
    expect(computeNextRun({ ...base, schedule_cron: "0 8 * * *" }, NOW, "Asia/Jakarta")).toBe(
      "2026-10-08T01:00:00.000Z",
    );
    expect(
      computeNextRun(
        { ...base, schedule_cron: "0 8 * * *", schedule_tz: "Europe/London" },
        NOW,
        "Asia/Jakarta",
      ),
    ).toBe("2026-10-07T07:00:00.000Z");
  });
  it("null for disabled, non-schedule or cron-less rules; throws on invalid", () => {
    expect(
      computeNextRun({ ...base, enabled: false, schedule_cron: "0 8 * * *" }, NOW, "UTC"),
    ).toBeNull();
    expect(
      computeNextRun(
        { ...base, trigger: { type: "task_created" }, schedule_cron: null },
        NOW,
        "UTC",
      ),
    ).toBeNull();
    expect(() => computeNextRun({ ...base, schedule_cron: "61 * * * *" }, NOW, "UTC")).toThrow();
    expect(() =>
      computeNextRun({ ...base, schedule_cron: "0 8 * * *", schedule_tz: "Nope/Zone" }, NOW, "UTC"),
    ).toThrow();
  });
});

describe("runDueAutomations (tick)", () => {
  it("runs due rules for their owner and computes the next run", async () => {
    const f = setup([sched()]);
    const res = await runDueAutomations({ now: NOW }, f.client);
    expect(res).toMatchObject({ due: 1, ran: 1, skipped: 0, failed: 0 });
    expect(f.db["tasks"]![0]).toMatchObject({
      user_id: U1,
      title: "Review Rabu",
      due_date: "2026-10-07T10:00:00.000Z",
    });
    const r = f.db["automations"]![0]!;
    expect(r["next_run_at"]).toBe("2026-10-08T01:00:00.000Z");
    expect(r["last_run_at"]).toBe(NOW.toISOString());
    expect(r["run_count"]).toBe(1);
    expect(f.db["automation_runs"]![0]).toMatchObject({
      user_id: U1,
      automation_id: "r1",
      ok: true,
    });
  });

  it("is idempotent: a second (or retried) tick in the same window does nothing", async () => {
    const f = setup([sched()]);
    await runDueAutomations({ now: NOW }, f.client);
    const again = await runDueAutomations({ now: new Date(NOW.getTime() + 60_000) }, f.client);
    expect(again).toMatchObject({ due: 0, ran: 0 });
    expect(f.db["tasks"]).toHaveLength(1);
    expect(f.db["automation_runs"]).toHaveLength(1);
  });

  it("a concurrent tick that lost the claim skips the rule", async () => {
    const f = setup([sched()]);
    // Simulate another tick claiming the window between our read and our claim.
    const from = (f.client as unknown as { from: (t: string) => unknown }).from;
    let reads = 0;
    const client = {
      from: (t: string) => {
        const b = from(t) as Record<string, (...a: unknown[]) => unknown>;
        if (t === "automations" && reads++ === 0) {
          const origThen = b["then"]!;
          b["then"] = (ok: unknown, ko: unknown) =>
            (origThen as (a: unknown, b: unknown) => Promise<unknown>)((v: unknown) => {
              f.db["automations"]![0]!["next_run_at"] = "2026-10-08T01:00:00.000Z";
              return (ok as (x: unknown) => unknown)(v);
            }, ko);
        }
        return b;
      },
    } as never;
    const res = await runDueAutomations({ now: NOW }, client);
    expect(res).toMatchObject({ due: 1, ran: 0, skipped: 1 });
    expect(f.db["tasks"]).toHaveLength(0);
  });

  it("ignores rules not yet due, disabled or without next_run_at; missed windows run once", async () => {
    const f = setup([
      sched({ id: "future", next_run_at: "2026-10-08T01:00:00.000Z" }),
      sched({ id: "off", enabled: false }),
      sched({ id: "none", next_run_at: null }),
      sched({ id: "late", next_run_at: "2026-10-01T01:00:00.000Z" }),
    ]);
    const res = await runDueAutomations({ now: NOW }, f.client);
    expect(res.results.map((r) => r.rule_id)).toEqual(["late"]);
    // Next run is the first window after now, not the next missed one.
    expect(res.results[0]!.next_run_at).toBe("2026-10-08T01:00:00.000Z");
  });

  it("an invalid stored cron stops the schedule and logs a failure", async () => {
    const f = setup([sched({ schedule_cron: "bogus" })]);
    const res = await runDueAutomations({ now: NOW }, f.client);
    expect(res).toMatchObject({ ran: 1, failed: 1 });
    expect(f.db["automations"]![0]!["next_run_at"]).toBeNull();
    expect(f.db["tasks"]).toHaveLength(0);
  });

  it("move_overdue is scoped to the owner (or a reachable project) and never sets done", async () => {
    const overdue = "2026-10-01T00:00:00.000Z";
    const t = (id: string, extra: Row) => ({
      id,
      status: "in_progress",
      due_date: overdue,
      deleted_at: null,
      archived_at: null,
      project_id: null,
      ...extra,
    });
    const f = setup(
      [
        sched({ actions: [{ type: "move_overdue", status: "todo" }] }),
        sched({
          id: "r2",
          user_id: U2,
          actions: [{ type: "move_overdue", project_id: P1, status: "review" }],
        }),
      ],
      {
        tasks: [
          t("mine", { user_id: U1 }),
          t("done", { user_id: U1, status: "done" }),
          t("future", { user_id: U1, due_date: "2026-12-01T00:00:00.000Z" }),
          t("theirs", { user_id: U2 }),
          t("proj", { user_id: U1, project_id: P1 }),
        ],
      },
    );
    const res = await runDueAutomations({ now: NOW }, f.client);
    const status = Object.fromEntries(f.db["tasks"]!.map((x) => [x["id"], x["status"]]));
    expect(status).toEqual({
      mine: "todo",
      done: "done",
      future: "in_progress",
      theirs: "in_progress",
      // U2 is not a member of P1 (owned by U1), so its rule fails instead of touching it.
      proj: "todo",
    });
    expect(res.results.find((r) => r.rule_id === "r2")!.ok).toBe(false);
  });

  it("digest goes to the owner's Telegram; skipped in demo (but the tick never runs there)", async () => {
    loadDigestData.mockResolvedValue({
      today: [],
      overdue: [
        {
          id: "t",
          title: "Lapor",
          due_date: "2026-10-01T00:00:00Z",
          priority: "high",
          status: "todo",
        },
      ],
      tomorrow: [],
      completedToday: [],
      inboxPending: 0,
    });
    const f = setup([
      sched({ actions: [{ type: "digest", kind: "overdue", channel: "telegram" }] }),
    ]);
    await runDueAutomations({ now: NOW }, f.client);
    expect(loadDigestData).toHaveBeenCalledWith("overdue", U1, NOW, "Asia/Jakarta");
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(sendTelegram.mock.calls[0]![0]).toBe("42");

    vi.stubEnv("APP_MODE", "demo");
    const g = setup([
      sched({ actions: [{ type: "digest", kind: "overdue", channel: "telegram" }] }),
    ]);
    const res = await runDueAutomations({ now: NOW }, g.client);
    expect(res.results[0]!.detail).toContain("dilewati (demo)");
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("limits to one user when asked", async () => {
    const f = setup([sched(), sched({ id: "r2", user_id: U2 })]);
    const res = await runDueAutomations({ now: NOW, userId: U2 }, f.client);
    expect(res.results.map((r) => r.user_id)).toEqual([U2]);
  });
});
