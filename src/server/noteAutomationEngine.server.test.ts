import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDetailTextId } from "@/lib/automation-run-detail";
import type { Action, Condition, Trigger } from "@/lib/automation-types";
import { fakeSupabase } from "@/test/fake-supabase";

const sendTelegram = vi.fn<(chat: string, text: string) => Promise<string | null>>();
const safeWebhookPost = vi.fn<(url: string, body: unknown) => Promise<{ status: number }>>();
vi.mock("@/lib/telegram.server", () => ({ sendTelegram }));
vi.mock("@/server/ssrf.server", () => ({ safeWebhookPost }));

const { noteConditionMatches, noteTriggerMatches, runNoteAutomationRules } =
  await import("./noteAutomationEngine.server");
const { runAutomationRules } = await import("./automationEngine.server");

const USER = "u1";
const P1 = "11111111-1111-4111-8111-111111111111";
const P_OTHER = "22222222-2222-4222-8222-222222222222";
type Row = Record<string, unknown>;

const note = (extra: Row = {}): Row => ({
  id: "n1",
  user_id: USER,
  title: "Rapat mingguan",
  tags: ["rapat"],
  project_id: null,
  excerpt: "",
  deleted_at: null,
  archived_at: null,
  ...extra,
});
let seq = 0;
const rule = (trigger: Trigger, actions: Action[], conditions: Condition[] = []): Row => ({
  id: `r${++seq}`,
  user_id: USER,
  enabled: true,
  name: "Rule",
  run_count: 0,
  trigger,
  conditions,
  actions,
});

function setup(rules: Row[], extra: Record<string, Row[]> = {}) {
  return fakeSupabase({
    automations: rules,
    notes: [note()],
    projects: [
      { id: P1, user_id: USER, name: "Website", deleted_at: null },
      { id: P_OTHER, user_id: "someone-else", name: "Secret", deleted_at: null },
    ],
    project_members: [],
    automation_runs: [],
    tasks: [],
    profiles: [{ id: USER, telegram_chat_id: "42" }],
    ...extra,
  });
}

beforeEach(() => {
  sendTelegram.mockReset().mockResolvedValue(null);
  safeWebhookPost.mockReset().mockResolvedValue({ status: 200 });
});

describe("note trigger matching (pure)", () => {
  const n = { tags: ["Rapat", "kerja"] };
  it("created / updated", () => {
    expect(noteTriggerMatches({ type: "note_created" }, { event: "created", noteId: "n" }, n)).toBe(
      true,
    );
    expect(noteTriggerMatches({ type: "note_created" }, { event: "updated", noteId: "n" }, n)).toBe(
      false,
    );
    expect(noteTriggerMatches({ type: "note_updated" }, { event: "updated", noteId: "n" }, n)).toBe(
      true,
    );
    expect(noteTriggerMatches({ type: "task_created" }, { event: "created", noteId: "n" }, n)).toBe(
      false,
    );
  });

  it("note_tagged fires only for newly added tags (optionally a specific one)", () => {
    const upd = (before: string[]) => ({
      event: "updated" as const,
      noteId: "n",
      before: { tags: before },
    });
    expect(noteTriggerMatches({ type: "note_tagged" }, upd(["rapat"]), n)).toBe(true);
    expect(noteTriggerMatches({ type: "note_tagged" }, upd(["rapat", "kerja"]), n)).toBe(false);
    expect(noteTriggerMatches({ type: "note_tagged", to: "#kerja" }, upd(["rapat"]), n)).toBe(true);
    expect(noteTriggerMatches({ type: "note_tagged", to: "rapat" }, upd(["rapat"]), n)).toBe(false);
    // An update without the previous tags cannot tell what was added.
    expect(noteTriggerMatches({ type: "note_tagged" }, { event: "updated", noteId: "n" }, n)).toBe(
      false,
    );
    // A created note "adds" all its tags.
    expect(
      noteTriggerMatches(
        { type: "note_tagged", to: "kerja" },
        { event: "created", noteId: "n" },
        n,
      ),
    ).toBe(true);
  });

  it("conditions: tag, title contains, project", () => {
    const x = { tags: ["Rapat"], title: "Notulen Rapat Q3", project_id: P1 };
    expect(noteConditionMatches({ field: "tag", op: "eq", value: "#rapat" }, x)).toBe(true);
    expect(noteConditionMatches({ field: "tag", op: "neq", value: "rapat" }, x)).toBe(false);
    expect(noteConditionMatches({ field: "tag", op: "contains", value: "rap" }, x)).toBe(true);
    expect(noteConditionMatches({ field: "title", op: "contains", value: " q3 " }, x)).toBe(true);
    expect(noteConditionMatches({ field: "title", op: "eq", value: "x" }, x)).toBe(false);
    expect(noteConditionMatches({ field: "project_id", op: "eq", value: P1 }, x)).toBe(true);
    expect(noteConditionMatches({ field: "priority", op: "eq", value: "high" }, x)).toBe(false);
  });
});

describe("runNoteAutomationRules", () => {
  it("ignores task and schedule rules and trashed notes", async () => {
    const f = setup([rule({ type: "task_created" }, [{ type: "add_tag", value: "x" }])]);
    expect(
      await runNoteAutomationRules(f.client, USER, { event: "created", noteId: "n1" }, null),
    ).toEqual({ ran: 0, changed: false });
    const g = setup([rule({ type: "note_created" }, [{ type: "add_tag", value: "x" }])], {
      notes: [note({ deleted_at: "2026-01-01" })],
    });
    expect(
      (await runNoteAutomationRules(g.client, USER, { event: "created", noteId: "n1" }, null)).ran,
    ).toBe(0);
  });

  it("add tag, link project, create task; logs the run with the note id", async () => {
    const r = rule(
      { type: "note_created" },
      [
        { type: "add_tag", value: "#Tindak-Lanjut" },
        { type: "link_project", project_id: P1 },
        { type: "create_task", title: "Follow up: {{title}} ({{project}})", due_in_days: 1 },
      ],
      [{ field: "title", op: "contains", value: "rapat" }],
    );
    const f = setup([r]);
    const now = new Date("2026-10-07T03:00:00Z");
    const res = await runNoteAutomationRules(
      f.client,
      USER,
      { event: "created", noteId: "n1" },
      "https://app.example.com",
      now,
    );
    expect(res).toEqual({ ran: 1, changed: true });
    const n = f.db["notes"]![0]!;
    expect(n["tags"]).toEqual(["rapat", "tindak-lanjut"]);
    expect(n["project_id"]).toBe(P1);
    const task = f.db["tasks"]![0]!;
    expect(task).toMatchObject({
      user_id: USER,
      title: "Follow up: Rapat mingguan (Website)",
      project_id: P1,
      due_date: "2026-10-08T10:00:00.000Z",
      description: "Dari catatan: https://app.example.com/notes/n1",
    });
    expect(f.db["automation_runs"]![0]).toMatchObject({ note_id: "n1", ok: true });
    expect(f.db["automations"]![0]!["run_count"]).toBe(1);
  });

  it("refuses projects the user cannot reach and malformed actions", async () => {
    const f = setup([
      rule({ type: "note_created" }, [
        { type: "link_project", project_id: P_OTHER },
        { type: "create_task", title: "" } as Action,
      ]),
    ]);
    await runNoteAutomationRules(f.client, USER, { event: "created", noteId: "n1" }, null);
    expect(f.db["notes"]![0]!["project_id"]).toBeNull();
    expect(f.db["tasks"]).toHaveLength(0);
    const run = f.db["automation_runs"]![0]!;
    expect(run["ok"]).toBe(false);
    expect(runDetailTextId(String(run["detail"]))).toBe(
      "Rapat mingguan → gagal: proyek tidak ditemukan; gagal: aksi tidak valid",
    );
  });

  it("note_updated has a per-note cooldown (autosave)", async () => {
    const r = rule({ type: "note_updated" }, [{ type: "telegram", text: "Diubah: {{title}}" }]);
    const f = setup([r]);
    const t0 = new Date("2026-10-07T03:00:00Z");
    const ev = { event: "updated" as const, noteId: "n1", before: { tags: ["rapat"] } };
    expect((await runNoteAutomationRules(f.client, USER, ev, null, t0)).ran).toBe(1);
    // The fake stamps created_at with the real clock; pin it to t0.
    f.db["automation_runs"]![0]!["created_at"] = t0.toISOString();
    const t1 = new Date(t0.getTime() + 5 * 60_000);
    expect((await runNoteAutomationRules(f.client, USER, ev, null, t1)).ran).toBe(0);
    const t2 = new Date(t0.getTime() + 31 * 60_000);
    expect((await runNoteAutomationRules(f.client, USER, ev, null, t2)).ran).toBe(1);
    expect(sendTelegram).toHaveBeenCalledWith("42", "Diubah: Rapat mingguan", {});
  });

  it("webhook payload is minimal (no body, no user ids)", async () => {
    const f = setup([rule({ type: "note_created" }, [{ type: "webhook", url: "https://x.test" }])]);
    await runNoteAutomationRules(f.client, USER, { event: "created", noteId: "n1" }, null);
    const body = safeWebhookPost.mock.calls[0]![1] as Row;
    expect(JSON.stringify(body)).not.toContain(USER);
    expect(body["note"]).toEqual({
      id: "n1",
      title: "Rapat mingguan",
      tags: ["rapat"],
      project_id: null,
      url: null,
    });
  });

  describe("demo mode", () => {
    beforeEach(() => vi.stubEnv("APP_MODE", "demo"));
    afterEach(() => vi.unstubAllEnvs());
    it("skips telegram and webhook", async () => {
      const f = setup([
        rule({ type: "note_created" }, [
          { type: "telegram", text: "x" },
          { type: "webhook", url: "https://x.test" },
        ]),
      ]);
      await runNoteAutomationRules(f.client, USER, { event: "created", noteId: "n1" }, null);
      expect(sendTelegram).not.toHaveBeenCalled();
      expect(safeWebhookPost).not.toHaveBeenCalled();
      expect(f.db["automation_runs"]![0]!["ok"]).toBe(true);
    });
  });
});

describe("actions never re-trigger rules", () => {
  it("a tag added by a rule does not fire note_tagged; a created task runs no task rules", async () => {
    const tagRule = rule({ type: "note_created" }, [
      { type: "add_tag", value: "auto" },
      { type: "create_task", title: "T" },
    ]);
    const onTagged = rule({ type: "note_tagged", to: "auto" }, [{ type: "add_tag", value: "x" }]);
    const onTask = rule({ type: "task_created" }, [{ type: "add_tag", value: "loop" }]);
    const f = setup([tagRule, onTagged, onTask]);
    const res = await runNoteAutomationRules(
      f.client,
      USER,
      { event: "created", noteId: "n1" },
      null,
    );
    expect(res.ran).toBe(1);
    expect(f.db["notes"]![0]!["tags"]).toEqual(["rapat", "auto"]);
    expect(f.db["tasks"]![0]!["tags"]).toEqual(["otomasi"]);
    expect(f.db["automation_runs"]).toHaveLength(1);
    // The only writes are the note, the task, the run log and the rule's counter: no other
    // rule was evaluated or touched.
    const writes = f.calls.filter((c) => c.op !== "select").map((c) => c.table);
    expect(writes.sort()).toEqual(["automation_runs", "automations", "notes", "tasks"]);
  });

  it("task rules ignore note and schedule rules", async () => {
    const f = fakeSupabase({
      automations: [
        rule({ type: "note_created" }, [{ type: "add_tag", value: "x" }]),
        rule({ type: "schedule" }, [{ type: "create_task", title: "x" }]),
      ],
      tasks: [{ id: "t1", user_id: USER, title: "T", tags: [], project_id: null }],
    });
    expect(
      await runAutomationRules(f.client, USER, { event: "created", taskId: "t1" }, null),
    ).toEqual({ ran: 0, changed: false });
  });
});
