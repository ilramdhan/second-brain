import { describe, expect, it } from "vitest";
import type { SensorContext } from "@dnd-kit/core";

import {
  columnNavigator,
  dayLabel,
  dayNavigator,
  dndAnnouncements,
  droppableKeyboardCoordinates,
  timelineKeyAction,
} from "./dnd-a11y";

const key = (code: string) => ({ code, preventDefault() {} }) as unknown as KeyboardEvent;
const rect = (left: number, top: number, width = 100, height = 200) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe("columnNavigator", () => {
  const next = columnNavigator(["todo", "in_progress", "done"]);
  it("moves left and right in display order", () => {
    expect(next("todo", "ArrowRight")).toBe("in_progress");
    expect(next("in_progress", "ArrowLeft")).toBe("todo");
  });
  it("stops at the edges and ignores vertical keys", () => {
    expect(next("done", "ArrowRight")).toBeNull();
    expect(next("todo", "ArrowLeft")).toBeNull();
    expect(next("todo", "ArrowDown")).toBeNull();
  });
});

describe("dayNavigator", () => {
  it("moves a day with ←/→ and a week with ↑/↓", () => {
    expect(dayNavigator("2026-10-31", "ArrowRight")).toBe("2026-11-01");
    expect(dayNavigator("2026-10-01", "ArrowLeft")).toBe("2026-09-30");
    expect(dayNavigator("2026-10-06", "ArrowDown")).toBe("2026-10-13");
    expect(dayNavigator("2026-10-06", "ArrowUp")).toBe("2026-09-29");
  });
  it("ignores non-day ids", () => {
    expect(dayNavigator("todo", "ArrowRight")).toBeNull();
  });
});

describe("droppableKeyboardCoordinates", () => {
  const getter = droppableKeyboardCoordinates(columnNavigator(["a", "b"]), () => "a");
  const context = {
    over: null,
    collisionRect: rect(10, 20, 80, 40),
    droppableRects: new Map([
      ["a", rect(0, 0)],
      ["b", rect(200, 0)],
    ]),
  } as unknown as SensorContext;

  it("centres the item over the next droppable", () => {
    const c = getter(key("ArrowRight"), {
      active: "x",
      context,
      currentCoordinates: { x: 10, y: 20 },
    });
    expect(c).toEqual({ x: 210, y: 32 });
  });
  it("stays put when there is no droppable in that direction", () => {
    const c = getter(key("ArrowLeft"), {
      active: "x",
      context,
      currentCoordinates: { x: 1, y: 2 },
    });
    expect(c).toEqual({ x: 1, y: 2 });
  });
  it("leaves other keys to the sensor", () => {
    expect(
      getter(key("Space"), { active: "x", context, currentCoordinates: { x: 0, y: 0 } }),
    ).toBeUndefined();
  });
});

describe("dndAnnouncements", () => {
  const a = dndAnnouncements({
    itemName: (x) => `Tugas ${String(x.id)}`,
    targetName: (id) => `kolom ${String(id)}`,
  });
  const active = { id: "1", data: { current: undefined } } as never;
  it("announces in Indonesian", () => {
    expect(a.onDragStart({ active })).toBe("Tugas 1 diambil.");
    expect(a.onDragEnd({ active, over: { id: "done" } as never })).toBe(
      "Tugas 1 diletakkan di kolom done.",
    );
    expect(a.onDragCancel({ active, over: null })).toBe("Pemindahan Tugas 1 dibatalkan.");
  });
});

describe("dayLabel", () => {
  it("formats a day key in Indonesian", () => {
    expect(dayLabel("2026-10-06")).toBe("Selasa, 6 Oktober 2026");
  });
});

describe("timelineKeyAction", () => {
  it("maps arrows to move and Shift+arrows to resize", () => {
    expect(timelineKeyAction({ key: "ArrowRight", shiftKey: false })).toEqual({
      mode: "move",
      delta: 1,
    });
    expect(timelineKeyAction({ key: "ArrowLeft", shiftKey: true })).toEqual({
      mode: "end",
      delta: -1,
    });
  });
  it("ignores other keys and modifier chords", () => {
    expect(timelineKeyAction({ key: "ArrowUp", shiftKey: false })).toBeNull();
    expect(timelineKeyAction({ key: "ArrowRight", shiftKey: false, metaKey: true })).toBeNull();
  });
});
