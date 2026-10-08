import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRunDetail, runDetailTextId } from "@/lib/automation-run-detail";
import type { Action, Condition, Trigger } from "@/lib/automation-types";

/** Indonesian rendering of a stored (coded) run detail. */
const text = (row: Row | undefined) => runDetailTextId(String(row?.["detail"]));

const sendTelegram = vi.fn<(chat: string, text: string) => Promise<string | null>>();
const safeWebhookPost = vi.fn<(url: string, body: unknown) => Promise<{ status: number }>>();
vi.mock("@/lib/telegram.server", () => ({ sendTelegram }));
vi.mock("@/server/ssrf.server", () => ({ safeWebhookPost }));

const { runAutomationRules } = await import("./automationEngine.server");

type Row = Record<string, unknown>;
type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };

/** Minimal chainable stand-in for the supabase-js query builder (select/eq/update/insert). */
function fakeSupabase(db: {
  automations: Row[];
  tasks: Row[];
  projects?: Row[];
  profiles?: Row[];
  failUpdate?: string;
}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const rows = () =>
      ((db as unknown as Record<string, Row[]>)[table] ?? []).filter((r) =>
        call.filters.every(([k, v]) => r[k] === v),
      );
    const result = () => {
      if (call.op === "update" && table === "tasks" && db.failUpdate)
        return { data: null, error: { message: db.failUpdate } };
      if (call.op === "update" && table === "tasks")
        for (const r of rows()) Object.assign(r, call.payload);
      return { data: call.op === "select" ? rows() : null, error: null };
    };
    const builder = {
      select: () => builder,
      eq: (k: string, v: unknown) => (call.filters.push([k, v]), builder),
      update: (p: unknown) => ((call.op = "update"), (call.payload = p), builder),
      insert: (p: unknown) => ((call.op = "insert"), (call.payload = p), builder),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(ok, ko),
    };
    return builder;
  };
  return { client: { from } as never, calls };
}

const USER = "u1";
const baseTask = (extra: Row = {}): Row => ({
  id: "t1",
  user_id: USER,
  title: "Write spec",
  status: "in_progress",
  priority: "high",
  assignee_name: "Budi",
  assignee_id: "a1",
  due_date: "2026-03-01T10:00:00.000Z",
  project_id: "p1",
  tags: ["Kerja"],
  description: "secret",
  ...extra,
});
const rule = (
  trigger: Trigger,
  actions: Action[],
  conditions: Condition[] = [],
  extra: Row = {},
): Row => ({
  id: `r-${Math.random()}`,
  user_id: USER,
  enabled: true,
  name: "Rule",
  run_count: 2,
  trigger,
  conditions,
  actions,
  ...extra,
});
const tag: Action = { type: "add_tag", value: "#auto" };

async function run(
  rules: Row[],
  event: Parameters<typeof runAutomationRules>[2],
  opts: { task?: Row; profiles?: Row[]; failUpdate?: string } = {},
) {
  const task = opts.task ?? baseTask();
  const fake = fakeSupabase({
    automations: rules,
    tasks: [task],
    projects: [{ id: "p1", name: "Website" }],
    profiles: opts.profiles ?? [],
    ...(opts.failUpdate ? { failUpdate: opts.failUpdate } : {}),
  });
  const res = await runAutomationRules(fake.client, USER, event, "https://app.example.com");
  const runs = fake.calls.filter((c) => c.table === "automation_runs").map((c) => c.payload as Row);
  return { res, task, calls: fake.calls, runs };
}

beforeEach(() => {
  sendTelegram.mockReset();
  safeWebhookPost.mockReset();
});

describe("runAutomationRules: trigger matching", () => {
  it("does nothing without enabled rules or without the task", async () => {
    expect((await run([], { event: "created", taskId: "t1" })).res).toEqual({
      ran: 0,
      changed: false,
    });
    expect(
      (await run([rule({ type: "task_created" }, [tag])], { event: "created", taskId: "nope" }))
        .res,
    ).toEqual({ ran: 0, changed: false });
  });

  it("scopes the rules query to the user and enabled rules", async () => {
    const { calls } = await run([], { event: "created", taskId: "t1" });
    expect(calls[0]).toMatchObject({
      table: "automations",
      filters: [
        ["user_id", USER],
        ["enabled", true],
      ],
    });
  });

  it("task_created fires only on created", async () => {
    const r = [rule({ type: "task_created" }, [tag])];
    expect((await run(r, { event: "created", taskId: "t1" })).res.ran).toBe(1);
    expect(
      (await run(r, { event: "updated", taskId: "t1", before: { status: "todo" } })).res.ran,
    ).toBe(0);
  });

  it("update triggers need a before snapshot with a changed field", async () => {
    const r = [rule({ type: "status_changed" }, [tag])];
    expect((await run(r, { event: "updated", taskId: "t1" })).res.ran).toBe(0);
    expect((await run(r, { event: "created", taskId: "t1", before: {} })).res.ran).toBe(0);
    expect((await run(r, { event: "updated", taskId: "t1", before: {} })).res.ran).toBe(0);
    expect(
      (await run(r, { event: "updated", taskId: "t1", before: { status: "in_progress" } })).res.ran,
    ).toBe(0);
    expect(
      (await run(r, { event: "updated", taskId: "t1", before: { status: "todo" } })).res.ran,
    ).toBe(1);
  });

  it("honours the `to` value of status/priority triggers", async () => {
    const before = { status: "todo", priority: "low" };
    const ev = { event: "updated" as const, taskId: "t1", before };
    expect((await run([rule({ type: "status_changed", to: "done" }, [tag])], ev)).res.ran).toBe(0);
    expect(
      (await run([rule({ type: "status_changed", to: "in_progress" }, [tag])], ev)).res.ran,
    ).toBe(1);
    expect((await run([rule({ type: "priority_changed", to: "high" }, [tag])], ev)).res.ran).toBe(
      1,
    );
  });

  it("due_changed compares due_date", async () => {
    const r = [rule({ type: "due_changed" }, [tag])];
    const ev = (due: string | null) => ({
      event: "updated" as const,
      taskId: "t1",
      before: { due_date: due },
    });
    expect((await run(r, ev("2026-03-01T10:00:00.000Z"))).res.ran).toBe(0);
    expect((await run(r, ev("2026-02-01T10:00:00.000Z"))).res.ran).toBe(1);
  });

  it("assignee_changed looks at both the name and the id", async () => {
    const r = [rule({ type: "assignee_changed" }, [tag])];
    const ev = (before: Row) => ({ event: "updated" as const, taskId: "t1", before });
    expect((await run(r, ev({ assignee_name: "Budi", assignee_id: "a1" }))).res.ran).toBe(0);
    expect((await run(r, ev({ assignee_name: "Budi", assignee_id: "a2" }))).res.ran).toBe(1);
    expect((await run(r, ev({ assignee_name: "Ani", assignee_id: "a1" }))).res.ran).toBe(1);
  });
});

describe("runAutomationRules: conditions", () => {
  const created = { event: "created" as const, taskId: "t1" };
  const ran = async (conditions: Condition[]) =>
    (await run([rule({ type: "task_created" }, [tag], conditions)], created)).res.ran;

  it("eq / neq / contains on fields are case-insensitive and trimmed", async () => {
    expect(await ran([{ field: "priority", op: "eq", value: " HIGH " }])).toBe(1);
    expect(await ran([{ field: "priority", op: "eq", value: "low" }])).toBe(0);
    expect(await ran([{ field: "status", op: "neq", value: "done" }])).toBe(1);
    expect(await ran([{ field: "status", op: "neq", value: "in_progress" }])).toBe(0);
    expect(await ran([{ field: "assignee_name", op: "contains", value: "bud" }])).toBe(1);
    expect(await ran([{ field: "assignee_name", op: "contains", value: "ani" }])).toBe(0);
  });

  it("tag conditions accept a leading # and support neq", async () => {
    expect(await ran([{ field: "tag", op: "eq", value: "#kerja" }])).toBe(1);
    expect(await ran([{ field: "tag", op: "contains", value: "kerja" }])).toBe(1);
    expect(await ran([{ field: "tag", op: "neq", value: "kerja" }])).toBe(0);
    expect(await ran([{ field: "tag", op: "eq", value: "home" }])).toBe(0);
  });

  it("all conditions must match", async () => {
    expect(
      await ran([
        { field: "priority", op: "eq", value: "high" },
        { field: "tag", op: "eq", value: "home" },
      ]),
    ).toBe(0);
  });
});

describe("runAutomationRules: actions", () => {
  const created = { event: "created" as const, taskId: "t1" };

  it("set_field status=done sets completed_at; assignee_name clears assignee_id", async () => {
    const { res, task, runs } = await run(
      [
        rule({ type: "task_created" }, [
          { type: "set_field", field: "status", value: "done" },
          { type: "set_field", field: "assignee_name", value: "Ani" },
        ]),
      ],
      created,
    );
    expect(res).toEqual({ ran: 1, changed: true });
    expect(task).toMatchObject({ status: "done", assignee_name: "Ani", assignee_id: null });
    expect(typeof task["completed_at"]).toBe("string");
    expect(runs[0]).toMatchObject({ ok: true, user_id: USER, task_id: "t1" });
    expect(parseRunDetail(runs[0]!["detail"] as string)).toEqual({
      v: 1,
      kind: "task",
      subject: "Write spec",
      steps: [
        { code: "setField", params: { field: "status", value: "done" } },
        { code: "setField", params: { field: "assignee_name", value: "Ani" } },
      ],
    });
    expect(text(runs[0])).toBe("Write spec → Status → Selesai; Penanggung jawab → Ani");
  });

  it("set_field status other than done clears completed_at", async () => {
    const { task } = await run(
      [rule({ type: "task_created" }, [{ type: "set_field", field: "status", value: "todo" }])],
      created,
      { task: baseTask({ completed_at: "x" }) },
    );
    expect(task["completed_at"]).toBeNull();
  });

  it("add_tag de-duplicates and strips #; shift_due moves the date and resets reminded", async () => {
    const { task } = await run(
      [
        rule({ type: "task_created" }, [
          { type: "add_tag", value: "#Kerja" },
          { type: "add_tag", value: " new " },
          { type: "shift_due", days: 2 },
        ]),
      ],
      created,
    );
    expect(task["tags"]).toEqual(["Kerja", "new"]);
    expect(task["due_date"]).toBe("2026-03-03T10:00:00.000Z");
    expect(task["reminded"]).toBe(false);
  });

  it("shift_due without a due date writes an empty patch", async () => {
    const { calls } = await run(
      [rule({ type: "task_created" }, [{ type: "shift_due", days: 1 }])],
      created,
      { task: baseTask({ due_date: null }) },
    );
    expect(calls.find((c) => c.table === "tasks" && c.op === "update")?.payload).toEqual({});
  });

  it("comment fills the template and is inserted as the user", async () => {
    const { calls, res } = await run(
      [
        rule({ type: "task_created" }, [
          {
            type: "comment",
            text: "{{title}}|{{status}}|{{priority}}|{{assignee}}|{{project}}|{{due}}",
          },
        ]),
      ],
      created,
      { task: baseTask({ due_date: null, assignee_name: null, project_id: null }) },
    );
    expect(res.changed).toBe(true);
    expect(calls.find((c) => c.table === "task_comments")?.payload).toEqual({
      task_id: "t1",
      user_id: USER,
      content: "🤖 Write spec|in_progress|high|-|-|-",
    });
  });

  it("telegram needs a linked chat and reports send errors", async () => {
    const tg = [rule({ type: "task_created" }, [{ type: "telegram", text: "Hi {{project}}" }])];
    const unlinked = await run(tg, created);
    expect(unlinked.runs[0]).toMatchObject({ ok: false });
    expect(text(unlinked.runs[0])).toContain("gagal: akun Telegram belum ditautkan");
    expect(sendTelegram).not.toHaveBeenCalled();

    sendTelegram.mockResolvedValueOnce(null);
    const ok = await run(tg, created, { profiles: [{ id: USER, telegram_chat_id: "42" }] });
    expect(sendTelegram).toHaveBeenCalledWith("42", "Hi Website");
    expect(ok.runs[0]).toMatchObject({ ok: true });
    expect(text(ok.runs[0])).toBe("Write spec → terkirim ke Telegram");
    expect(ok.res.changed).toBe(false);

    sendTelegram.mockResolvedValueOnce("Bot blocked");
    const failed = await run(tg, created, { profiles: [{ id: USER, telegram_chat_id: "42" }] });
    expect(text(failed.runs[0])).toContain("gagal: Bot blocked");
  });

  it("webhook sends a minimal payload (no internal ids or description)", async () => {
    safeWebhookPost.mockResolvedValueOnce({ status: 200 });
    await run(
      [
        rule(
          { type: "task_created" },
          [{ type: "webhook", url: "https://hook.example.com/x" }],
          [],
          { name: "Notify" },
        ),
      ],
      created,
    );
    const [url, body] = safeWebhookPost.mock.calls[0]!;
    expect(url).toBe("https://hook.example.com/x");
    expect(body).toEqual({
      text: "[Notify] Write spec — status in_progress, prioritas high",
      content: "[Notify] Write spec — status in_progress, prioritas high",
      rule: "Notify",
      event: "created",
      project: "Website",
      task: {
        id: "t1",
        title: "Write spec",
        status: "in_progress",
        priority: "high",
        due_date: "2026-03-01T10:00:00.000Z",
        project_id: "p1",
        tags: ["Kerja"],
        url: "https://app.example.com/projects/p1",
      },
    });
  });

  it("a failing action marks the run as failed but continues with the next action", async () => {
    safeWebhookPost.mockRejectedValueOnce(new Error("Webhook 500"));
    const { runs, calls } = await run(
      [
        rule({ type: "task_created" }, [
          { type: "webhook", url: "https://hook.example.com/x" },
          { type: "comment", text: "after" },
        ]),
      ],
      created,
    );
    expect(runs[0]).toMatchObject({ ok: false });
    expect(text(runs[0])).toBe(
      "Write spec → gagal: webhook menjawab HTTP 500; komentar ditambahkan",
    );
    // The webhook URL never reaches the run log.
    expect(String(runs[0]!["detail"])).not.toContain("hook.example.com");
    expect(calls.some((c) => c.table === "task_comments")).toBe(true);
  });

  it("surfaces database errors from task updates", async () => {
    const { runs, res } = await run([rule({ type: "task_created" }, [tag])], created, {
      failUpdate: "permission denied",
    });
    expect(res).toEqual({ ran: 1, changed: false });
    expect(text(runs[0])).toBe("Write spec → gagal: permission denied");
  });

  it("bumps run_count and last_run_at for every rule that ran", async () => {
    const r = rule({ type: "task_created" }, [tag], [], { id: "r1", run_count: 7 });
    const { calls } = await run([r], created);
    const bump = calls.find((c) => c.table === "automations" && c.op === "update");
    expect(bump).toMatchObject({ filters: [["id", "r1"]], payload: { run_count: 8 } });
  });

  it("later rules see changes made by earlier rules", async () => {
    const first = rule({ type: "task_created" }, [
      { type: "set_field", field: "priority", value: "low" },
    ]);
    const second = rule(
      { type: "task_created" },
      [tag],
      [{ field: "priority", op: "eq", value: "low" }],
    );
    expect((await run([first, second], created)).res.ran).toBe(2);
  });
});

describe("runAutomationRules: demo mode", () => {
  const created = { event: "created" as const, taskId: "t1" };
  afterEach(() => vi.unstubAllEnvs());

  it("skips telegram and webhook actions without failing the rule", async () => {
    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("VITE_APP_MODE", "demo");
    const { res, task, runs } = await run(
      [
        rule({ type: "task_created" }, [
          { type: "telegram", text: "Hi" },
          { type: "webhook", url: "https://hook.example.com/x" },
          tag,
        ]),
      ],
      created,
      { profiles: [{ id: USER, telegram_chat_id: "42" }] },
    );
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(safeWebhookPost).not.toHaveBeenCalled();
    expect(res).toEqual({ ran: 1, changed: true });
    expect(task["tags"]).toContain("auto");
    expect(runs[0]).toMatchObject({ ok: true });
    expect(text(runs[0])).toBe(
      "Write spec → Telegram dilewati (demo); webhook dilewati (demo); tag #auto ditambahkan",
    );
  });
});
