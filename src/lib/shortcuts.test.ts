import { afterEach, describe, expect, it } from "vitest";

import {
  bindingKeys,
  isOverlayOpen,
  isTypingTarget,
  matchesCommand,
  matchShortcut,
  moveSelection,
  resolveSelection,
  SHORTCUTS,
} from "./shortcuts";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("matchShortcut", () => {
  it("matches global shortcuts", () => {
    expect(matchShortcut(key("k", { metaKey: true }), "global")?.id).toBe("palette");
    expect(matchShortcut(key("K", { ctrlKey: true }), "global")?.id).toBe("palette");
    expect(matchShortcut(key("q"), "global")?.id).toBe("quickTask");
    expect(matchShortcut(key("Q", { shiftKey: true }), "global")?.id).toBe("quickTask");
    expect(matchShortcut(key("?", { shiftKey: true }), "global")?.id).toBe("cheatSheet");
  });

  it("keeps browser and modifier combos alone", () => {
    expect(matchShortcut(key("k"), "global")).toBeNull();
    expect(matchShortcut(key("q", { ctrlKey: true }), "global")).toBeNull();
    expect(matchShortcut(key("j", { altKey: true }), "list")).toBeNull();
    expect(matchShortcut(key("J", { shiftKey: true }), "list")).toBeNull();
  });

  it("maps list keys and marks arrows/Enter as list-only", () => {
    expect(matchShortcut(key("j"), "list")?.id).toBe("navNext");
    expect(matchShortcut(key("k"), "list")?.id).toBe("navPrev");
    expect(matchShortcut(key("h"), "list")?.id).toBe("navLeft");
    expect(matchShortcut(key("l"), "list")?.id).toBe("navRight");
    expect(matchShortcut(key("o"), "list")?.id).toBe("navOpen");
    expect(matchShortcut(key("x"), "list")?.id).toBe("navToggle");
    expect(matchShortcut(key("e"), "list")?.id).toBe("navEdit");
    const down = matchShortcut(key("ArrowDown"), "list");
    expect(down?.id).toBe("navNext");
    expect(down?.binding.inList).toBe(true);
    expect(matchShortcut(key("Enter"), "list")?.binding.inList).toBe(true);
  });

  it("gives every shortcut a binding and unique keys per scope", () => {
    for (const scope of ["global", "list"] as const) {
      const seen = SHORTCUTS.filter((s) => s.scope === scope).flatMap((s) =>
        s.bindings.map((b) => `${b.mod ? "mod+" : ""}${b.key.toLowerCase()}`),
      );
      expect(new Set(seen).size).toBe(seen.length);
    }
  });
});

describe("input guard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("treats text fields and contenteditable as typing", () => {
    document.body.innerHTML = `<input id="i"><textarea id="t"></textarea><select id="s"></select>
      <div contenteditable="true"><p id="p">x</p></div><button id="b"></button>`;
    for (const id of ["i", "t", "s", "p"]) {
      expect(isTypingTarget(document.getElementById(id))).toBe(true);
    }
    expect(isTypingTarget(document.getElementById("b"))).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("detects open dialogs and menus", () => {
    expect(isOverlayOpen()).toBe(false);
    document.body.innerHTML = `<div role="dialog"></div>`;
    expect(isOverlayOpen()).toBe(true);
    document.body.innerHTML = `<div role="menu"></div>`;
    expect(isOverlayOpen()).toBe(true);
  });
});

describe("list navigation", () => {
  const cols = [["a", "b", "c"], [], ["d"]];

  it("starts at the first item on any move", () => {
    expect(moveSelection(cols, null, "next")).toEqual({ id: "a", pos: { col: 0, row: 0 } });
    expect(moveSelection(cols, null, "last")).toEqual({ id: "c", pos: { col: 0, row: 2 } });
    expect(moveSelection([[], []], null, "next")).toBeNull();
  });

  it("moves within a column and stops at the ends", () => {
    const a = { id: "a", pos: { col: 0, row: 0 } };
    const b = moveSelection(cols, a, "next");
    expect(b?.id).toBe("b");
    expect(moveSelection(cols, a, "prev")?.id).toBe("a");
    expect(moveSelection(cols, { id: "c", pos: { col: 0, row: 2 } }, "next")?.id).toBe("c");
    expect(moveSelection(cols, b, "first")?.id).toBe("a");
    expect(moveSelection(cols, b, "last")?.id).toBe("c");
  });

  it("jumps across columns, skipping empty ones and clamping the row", () => {
    const c = { id: "c", pos: { col: 0, row: 2 } };
    expect(moveSelection(cols, c, "right")).toEqual({ id: "d", pos: { col: 2, row: 0 } });
    expect(moveSelection(cols, { id: "d", pos: { col: 2, row: 0 } }, "left")?.id).toBe("a");
    expect(moveSelection(cols, c, "left")?.id).toBe("c");
  });

  it("follows an item that moved, or takes its neighbour when it left", () => {
    // "b" moved to another column (status change on the board)
    expect(resolveSelection([["a", "c"], ["b"]], { id: "b", pos: { col: 0, row: 1 } })).toEqual({
      id: "b",
      pos: { col: 1, row: 0 },
    });
    // "b" was hidden (done): the row now at its position is selected
    expect(resolveSelection([["a", "c"]], { id: "b", pos: { col: 0, row: 1 } })?.id).toBe("c");
    expect(resolveSelection([["a"]], { id: "b", pos: { col: 0, row: 1 } })?.id).toBe("a");
    expect(resolveSelection([[]], { id: "b", pos: { col: 0, row: 0 } })).toBeNull();
  });
});

describe("display helpers", () => {
  it("formats bindings per platform", () => {
    expect(bindingKeys({ key: "k", mod: true }, true)).toEqual(["⌘", "K"]);
    expect(bindingKeys({ key: "k", mod: true }, false)).toEqual(["Ctrl", "K"]);
    expect(bindingKeys({ key: "ArrowDown" }, false)).toEqual(["↓"]);
    expect(bindingKeys({ key: "Enter" }, false)).toEqual(["Enter"]);
  });

  it("filters palette commands by every word", () => {
    expect(matchesCommand("Buka Laporan", "")).toBe(true);
    expect(matchesCommand("Buka Laporan", "lap  buka")).toBe(true);
    expect(matchesCommand("Buka Laporan", "buka catatan")).toBe(false);
  });
});
