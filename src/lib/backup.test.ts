import { describe, expect, it } from "vitest";

import {
  BACKUP_TABLES,
  BackupError,
  chunk,
  MAX_ROWS_PER_TABLE,
  planHabitLogs,
  planUpserts,
  prepareBackup,
} from "./backup";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";
const T2 = "44444444-4444-4444-8444-444444444444";
const H1 = "55555555-5555-4555-8555-555555555555";
const H2 = "66666666-6666-4666-8666-666666666666";
const L1 = "77777777-7777-4777-8777-777777777777";
const L2 = "88888888-8888-4888-8888-888888888888";
const L3 = "99999999-9999-4999-8999-999999999999";

describe("prepareBackup", () => {
  it("forces user_id to the current user and drops unknown columns", () => {
    const out = prepareBackup(
      {
        version: 1,
        tables: {
          tasks: [
            {
              id: T1,
              title: "Tulis laporan",
              user_id: OTHER,
              status: "todo",
              tags: ["a"],
              due_date: "2026-10-05T12:00:00.123456+00:00",
              evil_column: "x",
              role: "service_role",
            },
          ],
        },
      },
      ME,
    );
    expect(out.tasks).toEqual([
      {
        id: T1,
        title: "Tulis laporan",
        status: "todo",
        tags: ["a"],
        due_date: "2026-10-05T12:00:00.123456+00:00",
        user_id: ME,
      },
    ]);
    expect(out.projects).toEqual([]);
  });

  it("keeps a scheduled rule's cron and zone but never its next run", () => {
    const out = prepareBackup(
      {
        version: 1,
        tables: {
          automations: [
            {
              id: T1,
              name: "Pagi",
              trigger: { type: "schedule" },
              schedule_cron: "0 8 * * 1",
              schedule_tz: "Asia/Jakarta",
              next_run_at: "2026-10-12T01:00:00Z",
            },
          ],
        },
      },
      ME,
    );
    expect(out.automations[0]).toEqual({
      id: T1,
      name: "Pagi",
      trigger: { type: "schedule" },
      schedule_cron: "0 8 * * 1",
      schedule_tz: "Asia/Jakarta",
      user_id: ME,
    });
  });

  it("rejects unknown formats and malformed rows", () => {
    expect(() => prepareBackup({ version: 2, tables: {} }, ME)).toThrow(BackupError);
    expect(() => prepareBackup(null, ME)).toThrow("Format backup");
    expect(() => prepareBackup({ version: 1, tables: { tasks: {} } }, ME)).toThrow("tidak valid");
    expect(() =>
      prepareBackup({ version: 1, tables: { tasks: [{ id: "nope", title: "x" }] } }, ME),
    ).toThrow("Baris 1 di tasks tidak valid (id)");
    expect(() =>
      prepareBackup({ version: 1, tables: { tasks: [{ id: T1, title: "x".repeat(1001) }] } }, ME),
    ).toThrow("title");
    expect(() =>
      prepareBackup(
        { version: 1, tables: { tasks: [{ id: T1, title: "x", due_date: "kemarin" }] } },
        ME,
      ),
    ).toThrow("due_date");
  });

  it("rejects duplicate ids and oversized tables", () => {
    expect(() =>
      prepareBackup(
        {
          version: 1,
          tables: {
            notes: [
              { id: T1, title: "a" },
              { id: T1, title: "b" },
            ],
          },
        },
        ME,
      ),
    ).toThrow("ID ganda");
    const many = Array.from({ length: MAX_ROWS_PER_TABLE + 1 }, () => ({ id: T1, title: "x" }));
    expect(() => prepareBackup({ version: 1, tables: { tasks: many } }, ME)).toThrow(
      "terlalu besar",
    );
  });
});

describe("planUpserts", () => {
  it("updates own rows, inserts unseen ids and skips rows owned by others", () => {
    const rows = [
      { id: T1, user_id: ME, title: "mine" },
      { id: T2, user_id: ME, title: "theirs" },
      { id: ME, user_id: ME, title: "new" },
    ];
    const plan = planUpserts(
      rows,
      [
        { id: T1, user_id: ME },
        { id: T2, user_id: OTHER },
      ],
      ME,
    );
    expect(plan.update.map((r) => r.id)).toEqual([T1]);
    expect(plan.insert.map((r) => r.id)).toEqual([ME]);
    expect(plan.skipped).toBe(1);
  });
});

describe("chunk", () => {
  it("splits arrays", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("n8n backup envelope", () => {
  const task = { id: T1, title: "x" };
  it("restores the entry of the current user", () => {
    const file = {
      version: 1,
      format: "second-brain-backup",
      users: [
        { version: 1, user_id: OTHER, tables: { tasks: [{ id: T2, title: "other" }] } },
        { version: 1, user_id: ME, tables: { tasks: [task] } },
      ],
    };
    expect(prepareBackup(file, ME).tasks.map((t) => t.id)).toEqual([T1]);
  });
  it("uses a single-user backup for any account", () => {
    const file = { version: 1, users: [{ version: 1, user_id: OTHER, tables: { tasks: [task] } }] };
    expect(prepareBackup(file, ME).tasks[0]).toMatchObject({ id: T1, user_id: ME });
  });
  it("rejects multi-user backups without the current user", () => {
    const file = {
      version: 1,
      users: [
        { version: 1, user_id: OTHER, tables: {} },
        { version: 1, user_id: T2, tables: {} },
      ],
    };
    expect(() => prepareBackup(file, ME)).toThrow("tidak berisi data akun Anda");
  });
});

describe("habits in backups", () => {
  it("restores habits before their logs, after projects", () => {
    const order = BACKUP_TABLES as readonly string[];
    expect(order.indexOf("projects")).toBeLessThan(order.indexOf("habits"));
    expect(order.indexOf("habits")).toBeLessThan(order.indexOf("habit_logs"));
  });

  it("sanitizes habits and logs and forces the owner", () => {
    const out = prepareBackup(
      {
        version: 1,
        tables: {
          habits: [
            {
              id: H1,
              user_id: OTHER,
              name: "Olahraga",
              schedule_type: "weekdays",
              weekdays_mask: 31,
              target: 2,
              archived_at: null,
              streak: 99,
            },
          ],
          habit_logs: [
            { id: L1, habit_id: H1, user_id: OTHER, date: "2026-10-01", count: 2, note: "pagi" },
          ],
        },
      },
      ME,
    );
    expect(out.habits).toEqual([
      {
        id: H1,
        name: "Olahraga",
        schedule_type: "weekdays",
        weekdays_mask: 31,
        target: 2,
        archived_at: null,
        user_id: ME,
      },
    ]);
    expect(out.habit_logs).toEqual([
      { id: L1, habit_id: H1, date: "2026-10-01", count: 2, note: "pagi", user_id: ME },
    ]);
  });

  it("rejects invalid habits and duplicate habit days", () => {
    const habit = { id: H1, name: "x" };
    expect(() =>
      prepareBackup({ version: 1, tables: { habits: [{ ...habit, schedule_type: "x" }] } }, ME),
    ).toThrow("Baris 1 di habits tidak valid (schedule_type)");
    expect(() =>
      prepareBackup({ version: 1, tables: { habits: [{ ...habit, target: 0 }] } }, ME),
    ).toThrow("target");
    expect(() =>
      prepareBackup(
        {
          version: 1,
          tables: { habit_logs: [{ id: L1, habit_id: H1, date: "2026-10-01T00:00:00Z" }] },
        },
        ME,
      ),
    ).toThrow("(date)");
    expect(() =>
      prepareBackup(
        {
          version: 1,
          tables: {
            habit_logs: [
              { id: L1, habit_id: H1, date: "2026-10-01" },
              { id: L2, habit_id: H1, date: "2026-10-01" },
            ],
          },
        },
        ME,
      ),
    ).toThrow("Log ganda");
  });

  it("still imports backups made before habits existed", () => {
    const out = prepareBackup({ version: 1, tables: { tasks: [{ id: T1, title: "x" }] } }, ME);
    expect(out.tasks).toHaveLength(1);
    expect(out.habits).toEqual([]);
    expect(out.habit_logs).toEqual([]);
  });

  it("restores habits from n8n backups", () => {
    const file = {
      version: 1,
      format: "second-brain-backup",
      users: [
        {
          version: 1,
          user_id: ME,
          tables: {
            habits: [{ id: H1, name: "Baca" }],
            habit_logs: [{ id: L1, habit_id: H1, date: "2026-10-02" }],
            inbox_items: [{ id: T1 }],
          },
        },
      ],
    };
    const out = prepareBackup(file, ME);
    expect(out.habits.map((h) => h.id)).toEqual([H1]);
    expect(out.habit_logs.map((l) => l.id)).toEqual([L1]);
  });
});

describe("planHabitLogs", () => {
  const log = (id: string, habit_id: string, date: string) => ({
    id,
    habit_id,
    date,
    count: 1,
    user_id: ME,
  });

  it("skips logs of habits the user does not own", () => {
    const plan = planHabitLogs(
      [log(L1, H1, "2026-10-01"), log(L2, H2, "2026-10-01")],
      new Set([H1]),
      [],
    );
    expect(plan.rows.map((r) => r.id)).toEqual([L1]);
    expect(plan.skipped).toBe(1);
  });

  it("merges into the existing check-in of the same habit and day", () => {
    const plan = planHabitLogs(
      [log(L1, H1, "2026-10-01"), log(L2, H1, "2026-10-02")],
      new Set([H1]),
      [
        { id: L3, habit_id: H1, date: "2026-10-01" },
        { id: L2, habit_id: H1, date: "2026-10-02" },
      ],
    );
    expect(plan.rows).toEqual([
      { ...log(L1, H1, "2026-10-01"), id: L3 },
      log(L2, H1, "2026-10-02"),
    ]);
    expect(plan.skipped).toBe(0);
  });

  it("never moves an existing log to another habit or day", () => {
    const plan = planHabitLogs([log(L1, H1, "2026-10-03")], new Set([H1]), [
      { id: L1, habit_id: H1, date: "2026-10-01" },
    ]);
    expect(plan.rows).toEqual([]);
    expect(plan.skipped).toBe(1);
  });
});
