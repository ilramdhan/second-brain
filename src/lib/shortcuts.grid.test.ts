import { afterEach, describe, expect, it } from "vitest";

import {
  activeBindings,
  gridColumns,
  isCharacterKeyBinding,
  matchShortcut,
  moveCalendarDay,
  moveSelection,
  setSingleKeyShortcutsEnabled,
  SHORTCUTS,
  SINGLE_KEY_STORAGE_KEY,
  singleKeyShortcutsEnabled,
  type NavSelection,
} from "./shortcuts";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("grid navigation", () => {
  // 3 columns, 7 cards:  a b c / d e f / g
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const cols = gridColumns(ids, 3);
  const walk = (start: NavSelection, ...moves: Parameters<typeof moveSelection>[2][]) =>
    moves.reduce<NavSelection>((sel, m) => moveSelection(cols, sel, m), start)?.id;
  const sel = (id: string): NavSelection => {
    const i = ids.indexOf(id);
    return { id, pos: { col: i % 3, row: Math.floor(i / 3) } };
  };

  it("lays items out column by column", () => {
    expect(cols).toEqual([
      ["a", "d", "g"],
      ["b", "e"],
      ["c", "f"],
    ]);
    expect(gridColumns(ids, 1)).toEqual([ids]);
    expect(gridColumns(["a"], 3)).toEqual([["a"]]);
    expect(gridColumns([], 2)).toEqual([[]]);
  });

  it("moves by a row with up/down and within the row with left/right", () => {
    expect(walk(sel("b"), "next")).toBe("e");
    expect(walk(sel("e"), "prev")).toBe("b");
    expect(walk(sel("e"), "left")).toBe("d");
    expect(walk(sel("e"), "right")).toBe("f");
    expect(walk(sel("a"), "next", "next")).toBe("g");
  });

  it("stops at the edges and clamps a short last row", () => {
    expect(walk(sel("a"), "prev")).toBe("a");
    expect(walk(sel("a"), "left")).toBe("a");
    expect(walk(sel("c"), "right")).toBe("c");
    expect(walk(sel("e"), "next")).toBe("e");
    // g is alone on the last row: right goes to the last row's neighbour column (clamped)
    expect(walk(sel("g"), "right")).toBe("e");
  });

  it("picks the first card when nothing is selected", () => {
    expect(walk(null, "next")).toBe("a");
  });
});

describe("calendar grid", () => {
  const day = new Date(2026, 2, 31); // Tue 31 Mar 2026

  it("moves a day left/right and a week up/down across month ends", () => {
    expect(moveCalendarDay(day, "calRight")).toEqual(new Date(2026, 3, 1));
    expect(moveCalendarDay(day, "calLeft")).toEqual(new Date(2026, 2, 30));
    expect(moveCalendarDay(day, "calDown")).toEqual(new Date(2026, 3, 7));
    expect(moveCalendarDay(day, "calUp")).toEqual(new Date(2026, 2, 24));
    expect(moveCalendarDay(day, "calToday")).toEqual(day);
  });

  it("binds h/j/k/l, arrows, Enter, t, [ and ]", () => {
    expect(matchShortcut(key("h"), "calendar", true)?.id).toBe("calLeft");
    expect(matchShortcut(key("ArrowDown"), "calendar", true)?.id).toBe("calDown");
    expect(matchShortcut(key("Enter"), "calendar", true)?.id).toBe("calNewTask");
    expect(matchShortcut(key("t"), "calendar", true)?.id).toBe("calToday");
    expect(matchShortcut(key("["), "calendar", true)?.id).toBe("calPrev");
    expect(matchShortcut(key("]"), "calendar", true)?.id).toBe("calNext");
  });

  it("has unique keys", () => {
    const seen = SHORTCUTS.filter((s) => s.scope === "calendar").flatMap((s) =>
      s.bindings.map((b) => b.key.toLowerCase()),
    );
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("single-key shortcut toggle (WCAG 2.1.4)", () => {
  afterEach(() => {
    setSingleKeyShortcutsEnabled(true);
    localStorage.clear();
  });

  it("is on by default and persists the off state", () => {
    expect(singleKeyShortcutsEnabled()).toBe(true);
    setSingleKeyShortcutsEnabled(false);
    expect(singleKeyShortcutsEnabled()).toBe(false);
    expect(localStorage.getItem(SINGLE_KEY_STORAGE_KEY)).toBe("off");
    setSingleKeyShortcutsEnabled(true);
    expect(localStorage.getItem(SINGLE_KEY_STORAGE_KEY)).toBeNull();
  });

  it("classifies printable keys without a modifier as character keys", () => {
    expect(isCharacterKeyBinding({ key: "q" })).toBe(true);
    expect(isCharacterKeyBinding({ key: "?" })).toBe(true);
    expect(isCharacterKeyBinding({ key: "[" })).toBe(true);
    expect(isCharacterKeyBinding({ key: "k", mod: true })).toBe(false);
    expect(isCharacterKeyBinding({ key: "ArrowDown", inList: true })).toBe(false);
    expect(isCharacterKeyBinding({ key: "Escape" })).toBe(false);
  });

  it("off: letters stop matching, Cmd/Ctrl combos and focused-list keys keep working", () => {
    setSingleKeyShortcutsEnabled(false);
    expect(matchShortcut(key("q"), "global")).toBeNull();
    expect(matchShortcut(key("?", { shiftKey: true }), "global")).toBeNull();
    expect(matchShortcut(key("j"), "list")).toBeNull();
    expect(matchShortcut(key("x"), "list")).toBeNull();
    expect(matchShortcut(key("t"), "calendar")).toBeNull();
    expect(matchShortcut(key("k", { metaKey: true }), "global")?.id).toBe("palette");
    expect(matchShortcut(key("ArrowDown"), "list")?.id).toBe("navNext");
    expect(matchShortcut(key("Enter"), "list")?.id).toBe("navOpen");
    expect(matchShortcut(key("Escape"), "list")?.id).toBe("navClear");
    expect(matchShortcut(key("ArrowLeft"), "calendar")?.id).toBe("calLeft");
  });

  it("hides switched-off bindings from the cheat-sheet", () => {
    const next = SHORTCUTS.find((s) => s.id === "navNext")!;
    expect(activeBindings(next, true).map((b) => b.key)).toEqual(["j", "ArrowDown"]);
    expect(activeBindings(next, false).map((b) => b.key)).toEqual(["ArrowDown"]);
    const quick = SHORTCUTS.find((s) => s.id === "quickTask")!;
    expect(activeBindings(quick, false)).toEqual([]);
  });
});
