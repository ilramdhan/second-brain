import type { MessageKey } from "@/lib/preferences";

/**
 * Keyboard shortcuts: one list shared by the handlers (app shell, list/kanban navigation) and the
 * `?` cheat-sheet, so what the sheet shows is exactly what the keys do. Pure functions only; the
 * React wiring lives in src/routes/_authenticated.tsx and src/hooks/use-keyboard-nav.ts.
 */

export type ShortcutId =
  | "palette"
  | "quickTask"
  | "cheatSheet"
  | "navNext"
  | "navPrev"
  | "navLeft"
  | "navRight"
  | "navFirst"
  | "navLast"
  | "navOpen"
  | "navToggle"
  | "navEdit"
  | "navClear";

export type ShortcutScope = "global" | "list";

export type Binding = {
  /** `KeyboardEvent.key`, compared case-insensitively. */
  key: string;
  /** Ctrl on Windows/Linux, ⌘ on macOS. */
  mod?: boolean;
  /** Letter bindings refuse Shift ("J" is not "j") unless this is set. */
  anyShift?: boolean;
  /** Only while keyboard focus is inside the list, so arrows/Enter keep their normal meaning elsewhere. */
  inList?: boolean;
};

export type Shortcut = {
  id: ShortcutId;
  scope: ShortcutScope;
  bindings: readonly Binding[];
  label: MessageKey;
};

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "palette", scope: "global", bindings: [{ key: "k", mod: true }], label: "kbPalette" },
  {
    id: "quickTask",
    scope: "global",
    bindings: [{ key: "q", anyShift: true }],
    label: "quickTask",
  },
  { id: "cheatSheet", scope: "global", bindings: [{ key: "?" }], label: "kbCheatSheet" },
  {
    id: "navNext",
    scope: "list",
    bindings: [{ key: "j" }, { key: "ArrowDown", inList: true }],
    label: "kbNavNext",
  },
  {
    id: "navPrev",
    scope: "list",
    bindings: [{ key: "k" }, { key: "ArrowUp", inList: true }],
    label: "kbNavPrev",
  },
  {
    id: "navLeft",
    scope: "list",
    bindings: [{ key: "h" }, { key: "ArrowLeft", inList: true }],
    label: "kbNavLeft",
  },
  {
    id: "navRight",
    scope: "list",
    bindings: [{ key: "l" }, { key: "ArrowRight", inList: true }],
    label: "kbNavRight",
  },
  { id: "navFirst", scope: "list", bindings: [{ key: "Home", inList: true }], label: "kbNavFirst" },
  { id: "navLast", scope: "list", bindings: [{ key: "End", inList: true }], label: "kbNavLast" },
  {
    id: "navOpen",
    scope: "list",
    bindings: [{ key: "Enter", inList: true }, { key: "o" }],
    label: "kbNavOpen",
  },
  { id: "navToggle", scope: "list", bindings: [{ key: "x" }], label: "kbNavToggle" },
  { id: "navEdit", scope: "list", bindings: [{ key: "e" }], label: "kbNavEdit" },
  { id: "navClear", scope: "list", bindings: [{ key: "Escape" }], label: "kbNavClear" },
];

type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function matchesBinding(e: KeyLike, b: Binding): boolean {
  if (e.altKey) return false;
  if ((e.metaKey || e.ctrlKey) !== !!b.mod) return false;
  if (/^[a-z]$/i.test(b.key) && e.shiftKey && !b.anyShift) return false;
  return e.key.toLowerCase() === b.key.toLowerCase();
}

/** The shortcut of `scope` this event triggers, with the binding that matched. */
export function matchShortcut(
  e: KeyLike,
  scope: ShortcutScope,
): { id: ShortcutId; binding: Binding } | null {
  for (const s of SHORTCUTS) {
    if (s.scope !== scope) continue;
    const binding = s.bindings.find((b) => matchesBinding(e, b));
    if (binding) return { id: s.id, binding };
  }
  return null;
}

/** Text fields where letters must type, not run shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable || el.closest?.("[contenteditable=''],[contenteditable='true']")) {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** A dialog, sheet, menu or open select owns the keyboard while it is shown. */
export function isOverlayOpen(doc: Document = document): boolean {
  return !!doc.querySelector(
    "[role=dialog],[role=alertdialog],[role=menu],[role=listbox][data-state=open]",
  );
}

/** True when a single-key shortcut must not run for this event. */
export function shouldIgnoreShortcut(e: KeyboardEvent, doc: Document = document): boolean {
  return e.defaultPrevented || e.isComposing || isTypingTarget(e.target) || isOverlayOpen(doc);
}

const KEY_LABELS: Record<string, string> = {
  ArrowDown: "↓",
  ArrowUp: "↑",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
};

/** Display form of a binding, e.g. `["Ctrl", "K"]` or `["⌘", "K"]`. */
export function bindingKeys(b: Binding, mac: boolean): string[] {
  const key = KEY_LABELS[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : b.key);
  return b.mod ? [mac ? "⌘" : "Ctrl", key] : [key];
}

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
}

// ---------------------------------------------------------------------------------------------
// List / kanban navigation: items are ids laid out in columns (a list is one column).

export type NavMove = "next" | "prev" | "left" | "right" | "first" | "last";

export const NAV_MOVES: Partial<Record<ShortcutId, NavMove>> = {
  navNext: "next",
  navPrev: "prev",
  navLeft: "left",
  navRight: "right",
  navFirst: "first",
  navLast: "last",
};

export type NavPos = { col: number; row: number };
export type NavSelection = { id: string; pos: NavPos } | null;

export function findPos(columns: readonly (readonly string[])[], id: string): NavPos | null {
  for (let col = 0; col < columns.length; col++) {
    const row = columns[col]!.indexOf(id);
    if (row >= 0) return { col, row };
  }
  return null;
}

/**
 * The selected id that is still on screen. If the selected item left the list (marked done with
 * "show done" off, filtered out), the item now at its old position is selected instead, so `x`
 * on a row moves on to the next one.
 */
export function resolveSelection(
  columns: readonly (readonly string[])[],
  sel: NavSelection,
): NavSelection {
  if (!sel) return null;
  const pos = findPos(columns, sel.id);
  if (pos) return { id: sel.id, pos };
  const column = columns[sel.pos.col] ?? [];
  if (column.length > 0) {
    const row = Math.min(sel.pos.row, column.length - 1);
    return { id: column[row]!, pos: { col: sel.pos.col, row } };
  }
  const col = columns.findIndex((c) => c.length > 0);
  return col >= 0 ? { id: columns[col]![0]!, pos: { col, row: 0 } } : null;
}

/** Where `move` takes the selection; with nothing selected, any move picks the first item. */
export function moveSelection(
  columns: readonly (readonly string[])[],
  sel: NavSelection,
  move: NavMove,
): NavSelection {
  const current = resolveSelection(columns, sel);
  if (!current) {
    const col = columns.findIndex((c) => c.length > 0);
    if (col < 0) return null;
    const column = columns[col]!;
    const row = move === "last" ? column.length - 1 : 0;
    return { id: column[row]!, pos: { col, row } };
  }
  const { col, row } = current.pos;
  const column = columns[col]!;
  const at = (c: number, r: number): NavSelection => ({
    id: columns[c]![r]!,
    pos: { col: c, row: r },
  });
  switch (move) {
    case "next":
      return at(col, Math.min(row + 1, column.length - 1));
    case "prev":
      return at(col, Math.max(row - 1, 0));
    case "first":
      return at(col, 0);
    case "last":
      return at(col, column.length - 1);
    case "left":
    case "right": {
      const step = move === "left" ? -1 : 1;
      for (let c = col + step; c >= 0 && c < columns.length; c += step) {
        const target = columns[c]!;
        if (target.length > 0) return at(c, Math.min(row, target.length - 1));
      }
      return current;
    }
  }
}

/** Command-palette filter: the label contains every typed word (case-insensitive). */
export function matchesCommand(label: string, term: string): boolean {
  const hay = label.toLowerCase();
  return term
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
