import { describe, expect, it } from "vitest";

import { dueShiftMs, parseCompleteResult, pickColumns } from "@/lib/task-rules";

describe("dueShiftMs", () => {
  it("returns the positive delta when a due date moves later", () => {
    expect(dueShiftMs("2026-01-01T10:00:00Z", "2026-01-02T10:00:00Z")).toBe(86_400_000);
  });
  it("ignores earlier, unchanged, missing or invalid dates", () => {
    expect(dueShiftMs("2026-01-02T10:00:00Z", "2026-01-01T10:00:00Z")).toBe(0);
    expect(dueShiftMs("2026-01-01T10:00:00Z", "2026-01-01T10:00:00Z")).toBe(0);
    expect(dueShiftMs(null, "2026-01-01T10:00:00Z")).toBe(0);
    expect(dueShiftMs("2026-01-01T10:00:00Z", undefined)).toBe(0);
    expect(dueShiftMs("2026-01-01T10:00:00Z", "nope")).toBe(0);
  });
});

describe("parseCompleteResult", () => {
  const task = { id: "t1", title: "A", status: "done" };
  it("reads an ok result with recurrence and unblocked tasks", () => {
    const r = parseCompleteResult({
      status: "ok",
      task,
      recurring: { id: "t2", title: "A", status: "todo" },
      unblocked: [{ id: "t3", title: "B" }],
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.task.id).toBe("t1");
    expect(r.recurring?.id).toBe("t2");
    expect(r.unblocked).toEqual([{ id: "t3", title: "B" }]);
  });
  it("defaults missing recurring/unblocked", () => {
    const r = parseCompleteResult({ status: "ok", task, recurring: null });
    expect(r).toMatchObject({ status: "ok", recurring: null, unblocked: [] });
  });
  it("reads blocked and already_done results", () => {
    expect(parseCompleteResult({ status: "blocked", blocker: "Desain" })).toEqual({
      status: "blocked",
      blocker: "Desain",
    });
    expect(parseCompleteResult({ status: "already_done", task }).status).toBe("already_done");
  });
  it("throws on an unexpected shape", () => {
    expect(() => parseCompleteResult(null)).toThrow();
    expect(() => parseCompleteResult({ status: "ok" })).toThrow();
  });
});

describe("pickColumns", () => {
  it("keeps only listed columns that exist on the row", () => {
    expect(pickColumns({ id: "a", title: "T", reminded: true }, "id,title,status")).toEqual({
      id: "a",
      title: "T",
    });
  });
});
