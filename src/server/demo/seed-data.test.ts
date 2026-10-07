import { describe, expect, it } from "vitest";

import { linksOf, loadBlocks, noteIndexFields, toMarkdown, type Block } from "@/lib/blocks";
import { DEMO_INBOX_ITEMS, DEMO_MEETING_NOTE, DEMO_PROJECT_NAMES } from "@/lib/demo-examples";
import type { Json } from "@/integrations/supabase/types";
import { isValidCron } from "@/lib/cron";
import { completion, streaks } from "@/lib/habits";
import { addDays, bucketize, burndown, type DailyRow } from "@/lib/reports";

import {
  buildDemoSeed,
  DEMO_SEED_INSERT_ORDER,
  demoUuid,
  type DemoSeed,
  type DemoSeedTable,
} from "./seed-data";

const USER = "11111111-1111-4111-8111-111111111111";
const RINA = "22222222-2222-4222-8222-222222222222";
const BUDI = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-10-06"; // a Tuesday
const DAY = 86_400_000;

const seed = buildDemoSeed({ userId: USER, today: TODAY, teammates: { rina: RINA, budi: BUDI } });
const tables = Object.keys(seed).filter((k) => k !== "profile") as DemoSeedTable[];

/** Local (Asia/Jakarta, UTC+7) calendar day offset of an ISO instant from TODAY. */
const dayOffset = (iso: string) =>
  Math.round(
    (Date.parse(new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10)) -
      Date.parse(TODAY)) /
      DAY,
  );

const live = <T extends { deleted_at?: string | null; archived_at?: string | null }>(rows: T[]) =>
  rows.filter((r) => !r.deleted_at && !r.archived_at);

describe("buildDemoSeed: structure", () => {
  it("inserts every table, parents first", () => {
    expect([...DEMO_SEED_INSERT_ORDER].sort()).toEqual([...tables].sort());
    const pos = (t: DemoSeedTable) => DEMO_SEED_INSERT_ORDER.indexOf(t);
    expect(pos("projects")).toBeLessThan(pos("milestones"));
    expect(pos("milestones")).toBeLessThan(pos("tasks"));
    expect(pos("tasks")).toBeLessThan(pos("task_dependencies"));
    expect(pos("notes")).toBeLessThan(pos("note_versions"));
    expect(pos("automations")).toBeLessThan(pos("automation_runs"));
    expect(pos("canvas_nodes")).toBeLessThan(pos("canvas_edges"));
    expect(DEMO_SEED_INSERT_ORDER.at(-1)).toBe("activity_logs");
  });

  it("gives every row of a table the same keys (PostgREST bulk insert)", () => {
    for (const table of tables) {
      const rows = seed[table] as object[];
      const keys = new Set(rows.map((r) => Object.keys(r).sort().join(",")));
      expect(keys.size, table).toBeLessThanOrEqual(1);
    }
  });

  it("uses unique, valid uuids", () => {
    const ids = tables.flatMap((t) => (seed[t] as { id?: string }[]).map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("owns every row by the demo user (comments/members may be teammates)", () => {
    for (const table of tables) {
      for (const row of seed[table] as { user_id?: string | null }[]) {
        if (table === "project_members") expect([RINA, BUDI]).toContain(row.user_id);
        else if (table === "task_comments") expect([USER, RINA, BUDI]).toContain(row.user_id);
        else expect(row.user_id, table).toBe(USER);
      }
    }
  });

  it("stays well below the demo row limits of migration 0019", () => {
    const limits: Partial<Record<DemoSeedTable, number>> = {
      tasks: 300,
      notes: 150,
      projects: 20,
      inbox_items: 100,
      milestones: 60,
      task_comments: 300,
      task_dependencies: 200,
      automations: 20,
      canvas_boards: 10,
      canvas_nodes: 300,
      canvas_edges: 300,
      templates: 30,
      time_entries: 300,
      habits: 30,
      habit_logs: 1000,
      project_members: 10,
    };
    for (const [table, limit] of Object.entries(limits)) {
      expect(seed[table as DemoSeedTable].length, table).toBeLessThanOrEqual(limit! / 2);
    }
  });

  it("respects the CHECK constraints", () => {
    for (const t of seed.tasks) {
      expect(["todo", "in_progress", "review", "done"]).toContain(t.status);
      expect(["high", "medium", "low"]).toContain(t.priority);
      expect([null, "daily", "weekly", "monthly"]).toContain(t.recurrence);
      expect(t.title.length).toBeLessThanOrEqual(200);
    }
    for (const p of seed.projects) {
      expect(["planning", "active", "on_hold", "done"]).toContain(p.status);
      expect(["project", "area", "resource", "archive"]).toContain(p.para_type);
    }
    for (const n of seed.notes) {
      expect(["idea", "draft", "final"]).toContain(n.status);
      expect(Array.from(n.excerpt ?? "").length).toBeLessThanOrEqual(200);
    }
    for (const i of seed.inbox_items) {
      expect([
        "manual",
        "telegram",
        "voice",
        "ocr",
        "email",
        "google_calendar",
        "webhook",
      ]).toContain(i.source);
      expect(["pending", "processed", "archived"]).toContain(i.status);
    }
    for (const d of seed.task_dependencies) expect(d.blocker_id).not.toBe(d.blocked_id);
    for (const t of seed.templates) expect(["task", "note"]).toContain(t.kind);
  });

  it("references only rows of the seed", () => {
    const ids = (t: DemoSeedTable) => new Set((seed[t] as { id?: string }[]).map((r) => r.id));
    const projects = ids("projects");
    const tasks = ids("tasks");
    const optional = (set: Set<string | undefined>, v: string | null | undefined) =>
      v == null || set.has(v);
    for (const p of seed.projects) expect(optional(projects, p.parent_id)).toBe(true);
    for (const t of seed.tasks) {
      expect(optional(projects, t.project_id)).toBe(true);
      expect(optional(tasks, t.parent_id)).toBe(true);
      expect(optional(ids("milestones"), t.milestone_id)).toBe(true);
    }
    for (const m of seed.milestones) expect(projects.has(m.project_id)).toBe(true);
    for (const d of seed.task_dependencies) {
      expect(tasks.has(d.blocker_id) && tasks.has(d.blocked_id)).toBe(true);
    }
    for (const c of seed.task_comments) expect(tasks.has(c.task_id)).toBe(true);
    for (const e of seed.time_entries) expect(optional(tasks, e.task_id)).toBe(true);
    for (const r of seed.automation_runs) {
      expect(optional(ids("automations"), r.automation_id)).toBe(true);
      expect(optional(tasks, r.task_id)).toBe(true);
    }
    for (const v of seed.note_versions) expect(ids("notes").has(v.note_id)).toBe(true);
    const nodes = ids("canvas_nodes");
    for (const e of seed.canvas_edges)
      expect(nodes.has(e.source_id) && nodes.has(e.target_id)).toBe(true);
    for (const n of seed.canvas_nodes) {
      expect(ids("canvas_boards").has(n.board_id)).toBe(true);
      if (n.ref_id) expect(tasks.has(n.ref_id)).toBe(true);
    }
    for (const m of seed.project_members) expect(projects.has(m.project_id)).toBe(true);
  });
});

describe("buildDemoSeed: every page has data", () => {
  const tasks = live(seed.tasks).filter((t) => !t.parent_id);
  const open = tasks.filter((t) => t.status !== "done");

  it("today: due today, overdue, in progress, done this week, time blocks", () => {
    expect(open.filter((t) => t.due_date && dayOffset(t.due_date) === 0).length).toBeGreaterThan(1);
    expect(open.filter((t) => t.due_date && dayOffset(t.due_date) < 0).length).toBeGreaterThan(0);
    expect(open.filter((t) => t.status === "in_progress").length).toBeGreaterThan(0);
    expect(
      tasks.filter((t) => t.completed_at && dayOffset(t.completed_at) >= -7).length,
    ).toBeGreaterThan(1);
    expect(seed.tasks.some((t) => t.time_block_end)).toBe(true);
  });

  it("tasks: every status and priority, subtasks, recurrence, next week, unscheduled", () => {
    for (const s of ["todo", "in_progress", "review", "done"]) {
      expect(
        tasks.some((t) => t.status === s),
        s,
      ).toBe(true);
    }
    for (const p of ["high", "medium", "low"])
      expect(tasks.some((t) => t.priority === p)).toBe(true);
    expect(seed.tasks.some((t) => t.parent_id)).toBe(true);
    for (const r of ["daily", "weekly", "monthly"]) {
      expect(
        seed.tasks.some((t) => t.recurrence === r),
        r,
      ).toBe(true);
    }
    expect(
      open.some((t) => t.due_date && dayOffset(t.due_date) >= 1 && dayOffset(t.due_date) <= 7),
    ).toBe(true);
    expect(open.some((t) => !t.due_date && !t.start_date)).toBe(true);
    // Timeline: ranges with a start and a due date.
    expect(open.filter((t) => t.start_date && t.due_date).length).toBeGreaterThan(8);
    expect(seed.tasks.some((t) => t.assignee_id === RINA)).toBe(true);
  });

  it("dependencies: blocked tasks whose blocker is still open", () => {
    const status = new Map(seed.tasks.map((t) => [t.id, t.status]));
    expect(
      seed.task_dependencies.some(
        (d) => status.get(d.blocker_id) !== "done" && status.get(d.blocked_id) !== "done",
      ),
    ).toBe(true);
  });

  it("projects: the AI fixture names, PARA types, statuses, milestones, members, sub-project", () => {
    const names = seed.projects.map((p) => p.name);
    for (const name of DEMO_PROJECT_NAMES) expect(names).toContain(name);
    for (const para of ["project", "area", "resource", "archive"]) {
      expect(seed.projects.some((p) => p.para_type === para)).toBe(true);
    }
    for (const s of ["planning", "active", "on_hold", "done"]) {
      expect(
        seed.projects.some((p) => p.status === s),
        s,
      ).toBe(true);
    }
    expect(seed.projects.some((p) => p.parent_id)).toBe(true);
    expect(seed.projects.some((p) => p.launch_date)).toBe(true);
    expect(seed.milestones.some((m) => m.done)).toBe(true);
    expect(seed.milestones.some((m) => !m.done)).toBe(true);
    expect(seed.project_members.length).toBeGreaterThan(0);
  });

  it("projects: no members when the teammate accounts are missing", () => {
    const solo = buildDemoSeed({ userId: USER, today: TODAY });
    expect(solo.project_members).toEqual([]);
    expect(solo.task_comments.every((c) => c.user_id === USER)).toBe(true);
    expect(solo.tasks.every((t) => t.assignee_id === null || t.assignee_id === USER)).toBe(true);
  });

  it("inbox: the AI examples pending, a clarified item and processed history", () => {
    const pending = seed.inbox_items.filter((i) => i.status === "pending");
    for (const ex of DEMO_INBOX_ITEMS) {
      expect(pending.some((i) => i.content === ex.content && i.source === ex.source)).toBe(true);
    }
    expect(seed.inbox_items.some((i) => i.ai_summary)).toBe(true);
    expect(seed.inbox_items.some((i) => i.status === "processed")).toBe(true);
  });

  it("notes: meeting note, tags, query blocks, properties, pinned", () => {
    const meeting = seed.notes.find((n) => n.title === DEMO_MEETING_NOTE.title);
    expect(meeting?.content).toBe(DEMO_MEETING_NOTE.content);
    const blocks = seed.notes.flatMap((n) => n.blocks as unknown as Block[]);
    expect(blocks.some((b) => b.type === "query")).toBe(true);
    expect(blocks.some((b) => b.type === "embed")).toBe(true);
    expect(seed.notes.some((n) => n.pinned)).toBe(true);
    expect(seed.notes.some((n) => Object.keys((n.properties ?? {}) as object).length)).toBe(true);
    expect(seed.note_versions.length).toBeGreaterThan(0);
  });

  it("notes: content and index columns are derived from the blocks", () => {
    for (const n of seed.notes) {
      const blocks = n.blocks as unknown as Block[];
      expect(n.content).toBe(toMarkdown(blocks));
      expect({ links: n.links, refs: n.refs, excerpt: n.excerpt }).toEqual(
        noteIndexFields(blocks, n.content),
      );
      // The editor's loader keeps the blocks unchanged (stable ids, same types).
      expect(loadBlocks({ blocks: n.blocks as Json, content: n.content ?? "" })).toEqual(blocks);
    }
  });

  it("notes: every [[link]] and ((ref)) resolves; the graph is connected and dense", () => {
    const notes = live(seed.notes);
    const titles = new Set(notes.map((n) => n.title.trim().toLowerCase()));
    const blockIds = new Set(
      notes.flatMap((n) => (n.blocks as unknown as Block[]).map((b) => b.id)),
    );
    let edges = 0;
    const linked = new Set<string>();
    for (const n of notes) {
      const { titles: links, refs } = linksOf(n.blocks as unknown as Block[]);
      for (const l of links) expect(titles, `${n.title} → [[${l}]]`).toContain(l);
      for (const r of refs) expect(blockIds, `${n.title} → ((${r}))`).toContain(r);
      edges += links.size + refs.size;
      if (links.size + refs.size) linked.add(n.id!);
    }
    expect(edges).toBeGreaterThanOrEqual(20);
    expect(linked.size).toBeGreaterThanOrEqual(notes.length - 2);
    // Backlinks: some note is linked to by at least three others.
    const counts = new Map<string, number>();
    for (const n of notes) for (const l of n.links ?? []) counts.set(l, (counts.get(l) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(3);
  });

  it("archive and trash: tasks, notes and a project, younger than the 30-day purge", () => {
    expect(seed.tasks.some((t) => t.archived_at)).toBe(true);
    expect(seed.tasks.some((t) => t.deleted_at)).toBe(true);
    expect(seed.notes.some((n) => n.archived_at)).toBe(true);
    expect(seed.notes.some((n) => n.deleted_at)).toBe(true);
    expect(seed.projects.some((p) => p.deleted_at)).toBe(true);
    for (const row of [...seed.tasks, ...seed.notes, ...seed.projects]) {
      for (const at of [row.deleted_at, "archived_at" in row ? row.archived_at : null]) {
        if (at) expect(dayOffset(at)).toBeGreaterThan(-30);
      }
    }
  });

  it("reports: focus time in each of the last 8 weeks", () => {
    const weeks = new Set(seed.time_entries.map((e) => Math.floor(-dayOffset(e.started_at) / 7)));
    for (let w = 0; w < 8; w++) expect(weeks, `week -${w}`).toContain(w);
    expect(seed.time_entries.every((e) => e.duration_seconds! > 0 && e.mode === "focus")).toBe(
      true,
    );
    // Completed tasks spread over the 8 weeks too.
    const doneWeeks = new Set(
      seed.tasks
        .filter((t) => t.completed_at)
        .map((t) => Math.floor(-dayOffset(t.completed_at!) / 7)),
    );
    expect(doneWeeks.size).toBeGreaterThanOrEqual(6);
  });

  it("reports: 2+ tasks completed in each of the last 8 weeks, a burndown with an ideal line", () => {
    // Build the rows report_daily would return (UTC+7 days) from the seed and run the helpers.
    const live = seed.tasks.filter((t) => !t.deleted_at);
    const days = Array.from({ length: 56 }, (_, i) => addDays(TODAY, i - 55));
    const rows: DailyRow[] = days.map((day) => {
      const end = Date.parse(`${addDays(day, 1)}T00:00:00+07:00`);
      const on = (iso: string | null | undefined) =>
        !!iso && new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10) === day;
      const open = live.filter(
        (t) =>
          t.project_id === seed.projects[0]!.id &&
          Date.parse(t.created_at!) < end &&
          (!t.completed_at || Date.parse(t.completed_at) >= end),
      );
      return {
        day,
        created: live.filter((t) => on(t.created_at)).length,
        completed: live.filter((t) => on(t.completed_at)).length,
        completed_minutes: 0,
        open_tasks: open.length,
        open_minutes: open.reduce((s, t) => s + (t.estimate_minutes ?? 0), 0),
        focus_seconds: 0,
        planned_minutes: 0,
      };
    });
    const weeks = bucketize(rows, "week").filter((b) => b.days === 7);
    expect(weeks.length).toBeGreaterThanOrEqual(7);
    for (const w of weeks) expect(w.completed, w.start).toBeGreaterThanOrEqual(2);
    const kasir = seed.projects[0]!;
    const pts = burndown(rows.slice(-30), {
      unit: "tasks",
      due: kasir.due_date!.slice(0, 10),
      today: TODAY,
    });
    expect(pts.some((p) => p.ideal !== null)).toBe(true);
    expect(pts.filter((p) => p.remaining !== null).every((p) => p.remaining! > 0)).toBe(true);
  });

  it("habits: every schedule type, ~6 weeks of check-ins, live streaks", () => {
    expect(new Set(seed.habits.map((h) => h.schedule_type))).toEqual(
      new Set(["daily", "weekdays", "weekly"]),
    );
    expect(seed.habits.some((h) => (h.target ?? 1) > 1)).toBe(true);
    const span = Math.max(
      ...seed.habit_logs.map((l) => -Math.round((Date.parse(l.date) - Date.parse(TODAY)) / DAY)),
    );
    expect(span).toBeGreaterThanOrEqual(40);
    const keys = new Set(seed.habit_logs.map((l) => `${l.habit_id}:${l.date}`));
    expect(keys.size).toBe(seed.habit_logs.length); // unique per habit and day
    const habitIds = new Set(seed.habits.map((h) => h.id));
    for (const l of seed.habit_logs) {
      expect(habitIds).toContain(l.habit_id);
      expect(l.date <= TODAY).toBe(true);
      expect(l.count).toBeGreaterThan(0);
    }
    const logs = seed.habit_logs.map((l) => ({
      habit_id: l.habit_id,
      date: l.date,
      count: l.count!,
    }));
    const asHabit = (h: (typeof seed.habits)[number]) => ({
      id: h.id!,
      schedule_type: h.schedule_type!,
      weekdays_mask: h.weekdays_mask!,
      times_per_week: h.times_per_week!,
      target: h.target!,
    });
    const since = (h: (typeof seed.habits)[number]) => addDays(TODAY, dayOffset(h.created_at!));
    const current = seed.habits.map((h) => streaks(asHabit(h), logs, TODAY, since(h)).current);
    expect(current.filter((c) => c > 0).length).toBeGreaterThanOrEqual(3);
    for (const h of seed.habits) {
      const r = completion(
        asHabit(h),
        logs,
        { from: addDays(TODAY, -29), to: TODAY },
        TODAY,
        since(h),
      );
      expect(r.rate, h.name).toBeGreaterThan(0.5);
    }
  });

  it("canvas, templates, automations with runs, activity", () => {
    expect(seed.canvas_boards).toHaveLength(1);
    expect(seed.canvas_nodes.length).toBeGreaterThan(4);
    expect(seed.canvas_edges.length).toBeGreaterThan(4);
    expect(new Set(seed.templates.map((t) => t.kind))).toEqual(new Set(["task", "note"]));
    expect(seed.automations.some((a) => a.enabled)).toBe(true);
    expect(seed.automations.some((a) => !a.enabled)).toBe(true);
    for (const a of seed.automations) {
      const runs = seed.automation_runs.filter((r) => r.automation_id === a.id);
      expect(a.run_count).toBe(runs.length);
    }
    expect(seed.automation_runs.length).toBeGreaterThan(3);
    // 9.4: one scheduled rule (never due on the demo) and one note-trigger rule.
    const scheduled = seed.automations.filter(
      (a) => (a.trigger as { type: string }).type === "schedule",
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({ schedule_cron: "0 8 * * 1", schedule_tz: "Asia/Jakarta" });
    // Regression: the seed stored next_run_at = null, which the list showed as "jadwal tidak
    // valid". It now stores what scheduleAutomation would: next Monday 08:00 WIB after today.
    expect(isValidCron(scheduled[0]!.schedule_cron!)).toBe(true);
    expect(scheduled[0]!.next_run_at).toBe("2026-10-12T01:00:00.000Z");
    // Conditions on project_id reference a seeded project (the UI resolves it to a name).
    const projectIds = new Set(seed.projects.map((p) => p.id));
    for (const a of seed.automations)
      for (const c of a.conditions as { field: string; value: string }[])
        if (c.field === "project_id") expect(projectIds.has(c.value)).toBe(true);
    expect(
      seed.automations.some((a) => (a.trigger as { type: string }).type === "note_tagged"),
    ).toBe(true);
    for (const a of seed.automations)
      if ((a.trigger as { type: string }).type !== "schedule") expect(a.schedule_cron).toBeNull();
    expect(seed.activity_logs.length).toBeGreaterThan(10);
    expect(new Set(seed.activity_logs.map((l) => l.action))).toEqual(
      new Set(["insert", "update", "delete"]),
    );
  });
});

describe("buildDemoSeed: dates, cycles, determinism", () => {
  it("dates are relative to the reset day", () => {
    const later = buildDemoSeed({
      userId: USER,
      today: "2026-11-20",
      teammates: { rina: RINA, budi: BUDI },
    });
    const shift = Date.parse("2026-11-20") - Date.parse(TODAY);
    seed.tasks.forEach((t, i) => {
      const u = later.tasks[i]!;
      for (const k of ["due_date", "start_date", "completed_at", "deleted_at"] as const) {
        if (t[k])
          expect(Date.parse(u[k]!) - Date.parse(t[k]!), `${t.title} ${k}`).toBe(
            // Weekly recurrence lands on the next Sunday, which depends on the weekday.
            t.recurrence === "weekly" && k === "due_date"
              ? Date.parse(u[k]!) - Date.parse(t[k]!)
              : shift,
          );
      }
    });
    seed.projects.forEach((p, i) => {
      if (p.due_date)
        expect(Date.parse(later.projects[i]!.due_date!) - Date.parse(p.due_date)).toBe(shift);
    });
  });

  it("times of day are local to APP_TIMEZONE", () => {
    const olahraga = seed.tasks.find((t) => t.title.startsWith("Olahraga"))!;
    // 06:00 WIB = 23:00 UTC the day before.
    expect(olahraga.start_date).toBe("2026-10-05T23:00:00.000Z");
    const utc = buildDemoSeed({ userId: USER, today: TODAY, tz: "UTC" });
    expect(utc.tasks.find((t) => t.title.startsWith("Olahraga"))!.start_date).toBe(
      "2026-10-06T06:00:00.000Z",
    );
  });

  it("has no dependency cycles", () => {
    const next = new Map<string, string[]>();
    for (const d of seed.task_dependencies) {
      next.set(d.blocker_id, [...(next.get(d.blocker_id) ?? []), d.blocked_id]);
    }
    const state = new Map<string, 1 | 2>();
    const visit = (n: string): boolean => {
      if (state.get(n) === 1) return false;
      if (state.get(n) === 2) return true;
      state.set(n, 1);
      const ok = (next.get(n) ?? []).every(visit);
      state.set(n, 2);
      return ok;
    };
    for (const n of next.keys()) expect(visit(n)).toBe(true);
  });

  it("blocked tasks start after their blockers are due", () => {
    const byId = new Map(seed.tasks.map((t) => [t.id, t]));
    for (const d of seed.task_dependencies) {
      const a = byId.get(d.blocker_id)!;
      const b = byId.get(d.blocked_id)!;
      if (a.due_date && b.start_date)
        expect(Date.parse(b.start_date)).toBeGreaterThanOrEqual(Date.parse(a.due_date) - DAY);
    }
  });

  it("is deterministic", () => {
    const again: DemoSeed = buildDemoSeed({
      userId: USER,
      today: TODAY,
      teammates: { rina: RINA, budi: BUDI },
    });
    expect(again).toEqual(seed);
    expect(demoUuid(USER, "x")).toBe(demoUuid(USER, "x"));
    expect(demoUuid(USER, "x")).not.toBe(demoUuid(RINA, "x"));
  });

  it("rejects a malformed date", () => {
    expect(() => buildDemoSeed({ userId: USER, today: "06/10/2026" })).toThrow(/invalid date/);
  });
});
