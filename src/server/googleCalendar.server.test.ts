import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { taskToEvent } from "./googleCalendar.server";

const task = {
  id: "t1",
  title: "Rapat",
  description: null,
  start_date: "2026-10-06T03:00:00.000Z",
  due_date: null,
  time_block_end: null,
  google_event_id: null,
};

describe("taskToEvent", () => {
  it("defaults to a 30 minute block and tags the task id", () => {
    const event = taskToEvent(task);
    expect(event.start.dateTime).toBe("2026-10-06T03:00:00.000Z");
    expect(event.end.dateTime).toBe("2026-10-06T03:30:00.000Z");
    expect(event.extendedProperties.private.second_brain_task_id).toBe("t1");
  });
  it("uses time_block_end when after start", () => {
    expect(taskToEvent({ ...task, time_block_end: "2026-10-06T05:00:00.000Z" }).end.dateTime).toBe(
      "2026-10-06T05:00:00.000Z",
    );
  });
  it("requires a date", () => {
    expect(() => taskToEvent({ ...task, start_date: null })).toThrow(/tanggal/);
  });
});
