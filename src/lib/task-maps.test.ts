import { describe, expect, it } from "vitest";

import { openBlockers, type Dependency, type Task } from "@/lib/data";
import {
  byId,
  openBlockersByTask,
  subtasksByParent,
  tasksByDay,
  upcomingBuckets,
} from "@/lib/task-maps";

const t = (id: string, extra: Partial<Task> = {}) =>
  ({
    id,
    parent_id: null,
    status: "todo",
    start_date: null,
    due_date: null,
    title: id,
    ...extra,
  }) as Task;
const dep = (blocker_id: string, blocked_id: string) =>
  ({ id: `${blocker_id}>${blocked_id}`, blocker_id, blocked_id }) as Dependency;
// Local-time ISO so the day keys do not depend on the test machine's time zone.
const at = (day: string, hour = 12) =>
  new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`).toISOString();

describe("subtasksByParent", () => {
  it("groups subtasks under their parent in list order", () => {
    const m = subtasksByParent([
      t("p"),
      t("s1", { parent_id: "p" }),
      t("x"),
      t("s2", { parent_id: "p" }),
    ]);
    expect(m.get("p")!.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(m.has("x")).toBe(false);
  });
});

describe("openBlockersByTask", () => {
  const tasks = [t("a"), t("b", { status: "done" }), t("c"), t("d", { status: "done" })];
  const deps = [dep("a", "c"), dep("b", "c"), dep("a", "d"), dep("ghost", "c")];

  it("lists only unfinished blockers of unfinished tasks", () => {
    const m = openBlockersByTask(deps, tasks);
    expect(m.get("c")!.map((x) => x.id)).toEqual(["a"]);
    expect(m.has("d")).toBe(false);
    expect(m.has("a")).toBe(false);
  });
  it("agrees with openBlockers for every unfinished task", () => {
    const m = openBlockersByTask(deps, byId(tasks));
    for (const task of tasks.filter((x) => x.status !== "done"))
      expect((m.get(task.id) ?? []).map((x) => x.id)).toEqual(
        openBlockers(task.id, deps, tasks).map((x) => x.id),
      );
  });
});

describe("tasksByDay", () => {
  it("puts a task on every day of its range and skips undated tasks", () => {
    const m = tasksByDay([
      t("r", { start_date: at("2026-10-05"), due_date: at("2026-10-07") }),
      t("one", { due_date: at("2026-10-06") }),
      t("none"),
    ]);
    expect([...m.keys()].sort()).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(m.get("2026-10-06")!.map((x) => x.id)).toEqual(["r", "one"]);
  });
  it("caps very long ranges", () => {
    const m = tasksByDay(
      [t("long", { start_date: at("2020-01-01"), due_date: at("2030-01-01") })],
      10,
    );
    expect(m.size).toBe(11);
  });
});

describe("upcomingBuckets", () => {
  it("splits tasks into overdue, per day, later and undated in one pass", () => {
    const today = new Date(at("2026-10-05", 9));
    const b = upcomingBuckets(
      [
        t("late", { due_date: at("2026-10-04") }),
        t("today", { due_date: at("2026-10-05", 17) }),
        t("d3", { due_date: at("2026-10-08") }),
        t("far", { due_date: at("2026-10-19") }),
        t("nodate"),
      ],
      today,
    );
    expect(b.overdue.map((x) => x.id)).toEqual(["late"]);
    expect(b.days.get("2026-10-05")!.map((x) => x.id)).toEqual(["today"]);
    expect(b.days.get("2026-10-08")!.map((x) => x.id)).toEqual(["d3"]);
    expect(b.later.map((x) => x.id)).toEqual(["far"]);
    expect(b.noDate.map((x) => x.id)).toEqual(["nodate"]);
  });
});
