import { describe, expect, it } from "vitest";

import { addedTags, noteEventRelevant, scopeOf } from "./automation-types";

describe("automation-types helpers", () => {
  it("scopeOf", () => {
    expect(scopeOf("task_created")).toBe("task");
    expect(scopeOf("note_tagged")).toBe("note");
    expect(scopeOf("schedule")).toBe("schedule");
    expect(scopeOf(undefined)).toBe("task");
  });

  it("addedTags is case-insensitive and ignores #", () => {
    expect(addedTags(["Rapat"], ["#rapat", "Kerja", ""])).toEqual(["kerja"]);
    expect(addedTags(null, ["a"])).toEqual(["a"]);
  });

  it("noteEventRelevant only calls the server when a note rule could fire", () => {
    const r = (type: string, enabled = true) => ({ enabled, trigger: { type } });
    expect(noteEventRelevant([r("task_created"), r("schedule")], "created", 1)).toBe(false);
    expect(noteEventRelevant([r("note_created", false)], "created", 0)).toBe(false);
    expect(noteEventRelevant([r("note_created")], "created", 0)).toBe(true);
    expect(noteEventRelevant([r("note_created")], "updated", 0)).toBe(false);
    expect(noteEventRelevant([r("note_tagged")], "updated", 0)).toBe(false);
    expect(noteEventRelevant([r("note_tagged")], "updated", 1)).toBe(true);
    expect(noteEventRelevant([r("note_updated")], "updated", 0)).toBe(true);
  });
});
