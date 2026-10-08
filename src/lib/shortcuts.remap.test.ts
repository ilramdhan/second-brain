import { afterEach, describe, expect, it } from "vitest";

import {
  applyOverrides,
  findConflict,
  getEffectiveShortcuts,
  isAllowedShortcutKey,
  isRemappable,
  matchShortcut,
  parseOverrides,
  reloadShortcutOverrides,
  remapShortcut,
  resetAllShortcuts,
  resetShortcut,
  setShortcutKey,
  SHORTCUT_OVERRIDES_STORAGE_KEY,
  shortcutKeyLabel,
  SHORTCUTS,
  subscribeShortcuts,
} from "./shortcuts";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

afterEach(() => {
  resetAllShortcuts();
  localStorage.clear();
  reloadShortcutOverrides();
});

describe("remapping: what can change", () => {
  it("only offers single-key bindings, not Ctrl/⌘ combos or list-only keys", () => {
    const remappable = SHORTCUTS.filter(isRemappable).map((s) => s.id);
    expect(remappable).toEqual(
      expect.arrayContaining(["quickTask", "cheatSheet", "navNext", "navToggle", "calToday"]),
    );
    for (const id of ["palette", "navFirst", "navLast", "navClear", "calNewTask"]) {
      expect(remappable).not.toContain(id);
    }
    expect(remapShortcut({}, "palette", "p")).toEqual({ ok: false, reason: "notRemappable" });
  });

  it("rejects forbidden keys", () => {
    for (const k of ["Shift", "Control", "Tab", "Escape", "Enter", " ", "ArrowUp", "F5", "Dead"]) {
      expect(isAllowedShortcutKey({ key: k })).toBe(false);
    }
    expect(isAllowedShortcutKey({ key: "p", ctrlKey: true })).toBe(false);
    expect(isAllowedShortcutKey({ key: "p", metaKey: true })).toBe(false);
    expect(isAllowedShortcutKey({ key: "p", altKey: true })).toBe(false);
    expect(isAllowedShortcutKey({ key: "p" })).toBe(true);
    expect(isAllowedShortcutKey({ key: "/" })).toBe(true);
    expect(remapShortcut({}, "quickTask", "Tab")).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("remapping: conflicts", () => {
  const conflictOf = (r: ReturnType<typeof remapShortcut>) =>
    !r.ok && r.reason === "conflict" ? r.conflict.id : null;

  it("rejects keys used in the same scope, case-insensitively", () => {
    expect(conflictOf(remapShortcut({}, "navToggle", "J"))).toBe("navNext");
    expect(conflictOf(remapShortcut({}, "calPrev", "]"))).toBe("calNext");
  });

  it("treats global as clashing with every scope, both ways", () => {
    expect(conflictOf(remapShortcut({}, "navEdit", "q"))).toBe("quickTask");
    expect(conflictOf(remapShortcut({}, "quickTask", "t"))).toBe("calToday");
    expect(conflictOf(remapShortcut({}, "cheatSheet", "x"))).toBe("navToggle");
  });

  it("lets list and calendar reuse each other's keys", () => {
    expect(remapShortcut({}, "calToday", "o").ok).toBe(true);
    expect(remapShortcut({}, "navToggle", "t").ok).toBe(true);
  });

  it("ignores Ctrl/⌘ combos when looking for clashes", () => {
    // ⌘K does not block a plain k; the list's k (navPrev) does.
    expect(findConflict("quickTask", "k", SHORTCUTS)?.id).toBe("navPrev");
    expect(
      findConflict(
        "calToday",
        "k",
        SHORTCUTS.filter((s) => s.id !== "calUp"),
      ),
    ).toBeNull();
  });

  it("frees the old key once moved (no swap needed)", () => {
    const first = remapShortcut({}, "navToggle", "z");
    expect(first.ok).toBe(true);
    expect(remapShortcut(first.ok ? first.overrides : {}, "navEdit", "x").ok).toBe(true);
  });
});

describe("remapping: merge and storage", () => {
  it("merges overrides into the effective bindings and drops a no-op remap", () => {
    expect(remapShortcut({}, "quickTask", "N")).toEqual({
      ok: true,
      overrides: { quickTask: "n" },
    });
    const merged = applyOverrides({ quickTask: "n", navNext: "s" });
    expect(merged.find((s) => s.id === "quickTask")!.bindings[0]).toEqual({
      key: "n",
      anyShift: true,
    });
    expect(merged.find((s) => s.id === "navNext")!.bindings.map((b) => b.key)).toEqual([
      "s",
      "ArrowDown",
    ]);
    expect(matchShortcut(key("n"), "global", true, merged)?.id).toBe("quickTask");
    expect(matchShortcut(key("q"), "global", true, merged)).toBeNull();
    expect(matchShortcut(key("ArrowDown"), "list", true, merged)?.id).toBe("navNext");
    expect(remapShortcut({ quickTask: "n" }, "quickTask", "Q")).toEqual({
      ok: true,
      overrides: {},
    });
  });

  it("ignores invalid, stale or conflicting stored overrides", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("not json")).toEqual({});
    expect(parseOverrides("[1,2]")).toEqual({});
    expect(parseOverrides('"q"')).toEqual({});
    expect(
      parseOverrides(
        JSON.stringify({
          quickTask: "n",
          gone: "z",
          palette: "p",
          navNext: 5,
          navToggle: "Tab",
          navEdit: "n",
          cheatSheet: "/",
        }),
      ),
    ).toEqual({ quickTask: "n", cheatSheet: "/" });
  });

  it("reads stored overrides on first use", () => {
    localStorage.setItem(SHORTCUT_OVERRIDES_STORAGE_KEY, JSON.stringify({ quickTask: "n" }));
    reloadShortcutOverrides();
    expect(matchShortcut(key("n"), "global")?.id).toBe("quickTask");
  });

  it("persists per device and notifies subscribers", () => {
    let calls = 0;
    const off = subscribeShortcuts(() => calls++);
    const before = getEffectiveShortcuts();
    expect(setShortcutKey("quickTask", "n").ok).toBe(true);
    expect(calls).toBe(1);
    expect(getEffectiveShortcuts()).not.toBe(before);
    expect(getEffectiveShortcuts()).toBe(getEffectiveShortcuts());
    expect(JSON.parse(localStorage.getItem(SHORTCUT_OVERRIDES_STORAGE_KEY)!)).toEqual({
      quickTask: "n",
    });
    expect(matchShortcut(key("n"), "global")?.id).toBe("quickTask");
    expect(shortcutKeyLabel("quickTask")).toBe("N");

    expect(setShortcutKey("navEdit", "n").ok).toBe(false);
    expect(calls).toBe(1);

    resetShortcut("quickTask");
    expect(calls).toBe(2);
    expect(localStorage.getItem(SHORTCUT_OVERRIDES_STORAGE_KEY)).toBeNull();
    expect(matchShortcut(key("q"), "global")?.id).toBe("quickTask");
    off();
  });
});
