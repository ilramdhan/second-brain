import { describe, expect, it } from "vitest";

import { BackupError, chunk, MAX_ROWS_PER_TABLE, planUpserts, prepareBackup } from "./backup";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";
const T2 = "44444444-4444-4444-8444-444444444444";

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
