import { describe, expect, it } from "vitest";

import {
  afterPinned,
  ilikePattern,
  insertRow,
  omitKeys,
  patchCached,
  patchRows,
  pickKeys,
  removeRows,
} from "@/lib/query-cache";

const rows = () => [
  { id: "a", title: "A", pinned: true },
  { id: "b", title: "B", pinned: false },
  { id: "c", title: "C", pinned: false },
];

describe("ilikePattern", () => {
  it("wraps the trimmed term in wildcards", () => {
    expect(ilikePattern("  rapat ")).toBe("%rapat%");
  });
  it("escapes LIKE wildcards and backslashes typed by the user", () => {
    expect(ilikePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });
});

describe("patchRows", () => {
  it("merges the patch into the matching row only", () => {
    const list = rows();
    const next = patchRows(list, "b", { title: "B2" })!;
    expect(next[1]).toEqual({ id: "b", title: "B2", pinned: false });
    expect(next[0]).toBe(list[0]);
    expect(next[2]).toBe(list[2]);
  });
  it("returns the same array when the id is unknown (no re-render)", () => {
    const list = rows();
    expect(patchRows(list, "zz", { title: "x" })).toBe(list);
  });
  it("passes undefined through (query not loaded yet)", () => {
    expect(patchRows(undefined, "a", {})).toBeUndefined();
  });
});

describe("patchCached", () => {
  it("patches lists and single detail rows", () => {
    expect((patchCached(rows(), "a", { title: "X" }) as { title: string }[])[0]!.title).toBe("X");
    expect(patchCached({ id: "a", title: "A" }, "a", { title: "X" })).toEqual({
      id: "a",
      title: "X",
    });
  });
  it("leaves other detail rows, null and undefined alone", () => {
    const other = { id: "b", title: "B" };
    expect(patchCached(other, "a", { title: "X" })).toBe(other);
    expect(patchCached(null, "a", {})).toBeNull();
    expect(patchCached(undefined, "a", {})).toBeUndefined();
  });
});

describe("removeRows", () => {
  it("drops matching rows, e.g. a task and its subtasks", () => {
    const list = [
      { id: "p", parent_id: null },
      { id: "s", parent_id: "p" },
      { id: "o", parent_id: null },
    ];
    expect(removeRows(list, (t) => t.id === "p" || t.parent_id === "p")).toEqual([
      { id: "o", parent_id: null },
    ]);
  });
  it("returns the same array when nothing matches", () => {
    const list = rows();
    expect(removeRows(list, () => false)).toBe(list);
  });
});

describe("insertRow", () => {
  it("appends by default and inserts at an index", () => {
    expect(insertRow(rows(), { id: "d", title: "D", pinned: false }).map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(insertRow(rows(), { id: "d", title: "D", pinned: false }, 1).map((r) => r.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });
  it("replaces an existing row instead of duplicating it", () => {
    const next = insertRow(rows(), { id: "b", title: "B!", pinned: false });
    expect(next).toHaveLength(3);
    expect(next[1]!.title).toBe("B!");
  });
  it("creates the list when the query has no data yet", () => {
    expect(insertRow(undefined, { id: "x" })).toEqual([{ id: "x" }]);
  });
});

describe("afterPinned", () => {
  it("points after the pinned block", () => {
    expect(afterPinned(rows())).toBe(1);
    expect(afterPinned([{ pinned: true }])).toBe(1);
    expect(afterPinned([])).toBe(0);
    expect(afterPinned(undefined)).toBe(0);
  });
});

describe("omitKeys / pickKeys", () => {
  it("omits and picks fields", () => {
    const note = { id: "n", title: "T", blocks: [1], content: "c" };
    expect(omitKeys(note, ["blocks"])).toEqual({ id: "n", title: "T", content: "c" });
    expect(pickKeys(note, ["id", "blocks"])).toEqual({ id: "n", blocks: [1] });
    expect(pickKeys({ title: "x" } as Partial<typeof note>, ["id", "title"])).toEqual({
      title: "x",
    });
  });
});
