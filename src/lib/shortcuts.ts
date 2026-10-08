import type { MessageKey } from "@/lib/preferences";

/**
 * Keyboard shortcuts: one list shared by the handlers (app shell, list/kanban navigation) and the
 * `?` cheat-sheet, so what the sheet shows is exactly what the keys do. `SHORTCUTS` holds the
 * defaults; `getEffectiveShortcuts()` adds this device's remapped keys (Settings → Pintasan) and
 * is what the handlers match against. Pure functions plus a tiny subscribe/get store; the React
 * wiring lives in src/hooks/use-shortcuts.ts, src/routes/_authenticated.tsx and
 * src/hooks/use-keyboard-nav.ts.
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
  | "navClear"
  | "calLeft"
  | "calRight"
  | "calUp"
  | "calDown"
  | "calNewTask"
  | "calToday"
  | "calPrev"
  | "calNext";

export type ShortcutScope = "global" | "list" | "calendar";

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
  {
    id: "calLeft",
    scope: "calendar",
    bindings: [{ key: "h" }, { key: "ArrowLeft", inList: true }],
    label: "kbCalLeft",
  },
  {
    id: "calRight",
    scope: "calendar",
    bindings: [{ key: "l" }, { key: "ArrowRight", inList: true }],
    label: "kbCalRight",
  },
  {
    id: "calUp",
    scope: "calendar",
    bindings: [{ key: "k" }, { key: "ArrowUp", inList: true }],
    label: "kbCalUp",
  },
  {
    id: "calDown",
    scope: "calendar",
    bindings: [{ key: "j" }, { key: "ArrowDown", inList: true }],
    label: "kbCalDown",
  },
  {
    id: "calNewTask",
    scope: "calendar",
    bindings: [{ key: "Enter", inList: true }],
    label: "kbCalNewTask",
  },
  { id: "calToday", scope: "calendar", bindings: [{ key: "t" }], label: "kbCalToday" },
  { id: "calPrev", scope: "calendar", bindings: [{ key: "[" }], label: "kbCalPrev" },
  { id: "calNext", scope: "calendar", bindings: [{ key: "]" }], label: "kbCalNext" },
];

// ---------------------------------------------------------------------------------------------
// Single-key shortcuts can be switched off (WCAG 2.1.4 Character Key Shortcuts): Settings →
// "Pintasan satu tombol". Off disables every binding that is one printable character without
// Ctrl/⌘ (Q, ?, j/k/h/l, o, e, x, t, [, ]); Ctrl/⌘ combos and the arrow/Enter/Home/End/Esc keys
// of a focused list or grid keep working. Stored per device, like the theme.

export const SINGLE_KEY_STORAGE_KEY = "second-brain-single-key-shortcuts";

/** A character key shortcut in the 2.1.4 sense: one printable character, no modifier. */
export function isCharacterKeyBinding(b: Binding): boolean {
  return !b.mod && b.key.length === 1;
}

// Cached so storage is read once, and so the choice holds for the session even when storage
// is blocked.
let singleKeys: boolean | null = null;

/** Whether single-key shortcuts are on (default) on this device. */
export function singleKeyShortcutsEnabled(): boolean {
  if (singleKeys === null) {
    try {
      singleKeys = localStorage.getItem(SINGLE_KEY_STORAGE_KEY) !== "off";
    } catch {
      singleKeys = true;
    }
  }
  return singleKeys;
}

export function setSingleKeyShortcutsEnabled(enabled: boolean): void {
  singleKeys = enabled;
  try {
    if (enabled) localStorage.removeItem(SINGLE_KEY_STORAGE_KEY);
    else localStorage.setItem(SINGLE_KEY_STORAGE_KEY, "off");
  } catch {
    // storage blocked: the setting lasts for this session only
  }
}

/** The bindings of `s` that are active with single keys on or off (for the cheat-sheet). */
export function activeBindings(s: Shortcut, singleKeys: boolean): readonly Binding[] {
  return singleKeys ? s.bindings : s.bindings.filter((b) => !isCharacterKeyBinding(b));
}

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
  singleKeys: boolean = singleKeyShortcutsEnabled(),
  shortcuts: readonly Shortcut[] = getEffectiveShortcuts(),
): { id: ShortcutId; binding: Binding } | null {
  for (const s of shortcuts) {
    if (s.scope !== scope) continue;
    const binding = activeBindings(s, singleKeys).find((b) => matchesBinding(e, b));
    if (binding) return { id: s.id, binding };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Remapping (WCAG 2.1.4): every single-key binding (one printable character, no Ctrl/⌘, not a
// focused-list key) can be given another key in Settings → Pintasan. Ctrl/⌘ combos and the
// arrow/Enter/Home/End/Esc keys stay fixed. Overrides are stored per device as JSON
// `{ [ShortcutId]: key }`; invalid, stale or conflicting entries are ignored when read.

export const SHORTCUT_OVERRIDES_STORAGE_KEY = "second-brain-shortcut-overrides";

export type ShortcutOverrides = Partial<Record<ShortcutId, string>>;

/** A binding the user may move to another key. */
export function isRemappableBinding(b: Binding): boolean {
  return isCharacterKeyBinding(b) && !b.inList;
}

/** The binding of `s` that can be remapped, if any (each shortcut has at most one). */
export function remappableBinding(s: Shortcut): Binding | undefined {
  return s.bindings.find(isRemappableBinding);
}

export function isRemappable(s: Shortcut): boolean {
  return !!remappableBinding(s);
}

/** Lower-cases letters so `Q` and `q` are one key; symbols are kept as typed (`?`, `[`). */
export function normalizeShortcutKey(key: string): string {
  return key.toLowerCase();
}

/**
 * Whether a key press can become a single-key shortcut: one printable, non-space character with
 * no Ctrl/⌘/Alt. Rejects modifiers alone, Tab, Escape, Enter, Space, arrows, F-keys, dead keys.
 */
export function isAllowedShortcutKey(
  e: Pick<KeyLike, "key"> & Partial<Pick<KeyLike, "metaKey" | "ctrlKey" | "altKey">>,
): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return [...e.key].length === 1 && e.key.trim() !== "";
}

/** SHORTCUTS with `overrides` applied (the remappable binding gets the new key). */
export function applyOverrides(
  overrides: ShortcutOverrides,
  base: readonly Shortcut[] = SHORTCUTS,
): Shortcut[] {
  return base.map((s) => {
    const key = overrides[s.id];
    if (!key) return s;
    return {
      ...s,
      bindings: s.bindings.map((b) => (isRemappableBinding(b) ? { ...b, key } : b)),
    };
  });
}

function scopesClash(a: ShortcutScope, b: ShortcutScope): boolean {
  return a === b || a === "global" || b === "global";
}

/**
 * The shortcut that already uses `key` where `id` would also fire: the same scope, or global
 * (global clashes with every scope). Only Ctrl/⌘-free bindings count.
 */
export function findConflict(
  id: ShortcutId,
  key: string,
  shortcuts: readonly Shortcut[],
): Shortcut | null {
  const target = shortcuts.find((s) => s.id === id);
  if (!target) return null;
  const k = normalizeShortcutKey(key);
  return (
    shortcuts.find(
      (s) =>
        s.id !== id &&
        scopesClash(s.scope, target.scope) &&
        s.bindings.some((b) => !b.mod && normalizeShortcutKey(b.key) === k),
    ) ?? null
  );
}

export type RemapResult =
  | { ok: true; overrides: ShortcutOverrides }
  | { ok: false; reason: "notRemappable" | "forbidden" }
  | { ok: false; reason: "conflict"; conflict: Shortcut };

/** `overrides` with `id` moved to `key`, or why that is refused (no swapping). */
export function remapShortcut(
  overrides: ShortcutOverrides,
  id: ShortcutId,
  key: string,
): RemapResult {
  const base = SHORTCUTS.find((s) => s.id === id);
  const original = base && remappableBinding(base);
  if (!base || !original) return { ok: false, reason: "notRemappable" };
  if (!isAllowedShortcutKey({ key })) return { ok: false, reason: "forbidden" };
  const k = normalizeShortcutKey(key);
  const conflict = findConflict(id, k, applyOverrides(overrides));
  if (conflict) return { ok: false, reason: "conflict", conflict };
  const next: ShortcutOverrides = { ...overrides };
  if (normalizeShortcutKey(original.key) === k) delete next[id];
  else next[id] = k;
  return { ok: true, overrides: next };
}

/** Stored overrides, dropping anything unknown, invalid or conflicting (applied in order). */
export function parseOverrides(raw: string | null): ShortcutOverrides {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  let result: ShortcutOverrides = {};
  for (const [id, key] of Object.entries(data as Record<string, unknown>)) {
    if (typeof key !== "string") continue;
    if (!SHORTCUTS.some((s) => s.id === id)) continue;
    const r = remapShortcut(result, id as ShortcutId, key);
    if (r.ok) result = r.overrides;
  }
  return result;
}

// Store: read once, kept in memory (so the choice holds for the session even when storage is
// blocked), with listeners so React views re-render (`useShortcuts`).
let overridesCache: ShortcutOverrides | null = null;
let effectiveCache: { from: ShortcutOverrides; shortcuts: readonly Shortcut[] } | null = null;
const listeners = new Set<() => void>();

export function getShortcutOverrides(): ShortcutOverrides {
  if (overridesCache === null) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SHORTCUT_OVERRIDES_STORAGE_KEY);
    } catch {
      // storage blocked: defaults
    }
    overridesCache = parseOverrides(raw);
  }
  return overridesCache;
}

/** The bindings in effect on this device (defaults + overrides); stable between changes. */
export function getEffectiveShortcuts(): readonly Shortcut[] {
  const overrides = getShortcutOverrides();
  if (effectiveCache?.from !== overrides) {
    effectiveCache = { from: overrides, shortcuts: applyOverrides(overrides) };
  }
  return effectiveCache.shortcuts;
}

export function subscribeShortcuts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function writeOverrides(next: ShortcutOverrides): void {
  overridesCache = next;
  try {
    if (Object.keys(next).length === 0) localStorage.removeItem(SHORTCUT_OVERRIDES_STORAGE_KEY);
    else localStorage.setItem(SHORTCUT_OVERRIDES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the change lasts for this session only
  }
  listeners.forEach((l) => l());
}

/** Moves `id` to `key` on this device, unless the key is forbidden or already used. */
export function setShortcutKey(id: ShortcutId, key: string): RemapResult {
  const r = remapShortcut(getShortcutOverrides(), id, key);
  if (r.ok) writeOverrides(r.overrides);
  return r;
}

export function resetShortcut(id: ShortcutId): void {
  const current = getShortcutOverrides();
  if (!(id in current)) return;
  const next = { ...current };
  delete next[id];
  writeOverrides(next);
}

export function resetAllShortcuts(): void {
  writeOverrides({});
}

/** Test helper: forget the in-memory copy so the next read goes back to storage. */
export function reloadShortcutOverrides(): void {
  overridesCache = null;
  listeners.forEach((l) => l());
}

/** Display form of the remappable key of `id` (e.g. "Q"), for hints next to buttons. */
export function shortcutKeyLabel(
  id: ShortcutId,
  shortcuts: readonly Shortcut[] = getEffectiveShortcuts(),
): string | null {
  const s = shortcuts.find((x) => x.id === id);
  const b = s && remappableBinding(s);
  return b ? bindingKeys(b, false).join(" ") : null;
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

/**
 * A 2-D grid (the notes grid) as navigation columns: item `i` sits in column `i % cols`, row
 * `floor(i / cols)`. With `moveSelection`, j/k (↑/↓) then move by a whole row (±cols in reading
 * order) and h/l (←/→) to the neighbouring card in the same row.
 */
export function gridColumns(ids: readonly string[], cols: number): string[][] {
  const n = Math.max(1, Math.floor(cols));
  const columns: string[][] = Array.from(
    { length: Math.min(n, Math.max(ids.length, 1)) },
    () => [],
  );
  ids.forEach((id, i) => columns[i % n]!.push(id));
  return columns;
}

/** Calendar grid moves (weeks start on Monday): the day offset each shortcut applies. */
export const CALENDAR_MOVES: Partial<Record<ShortcutId, number>> = {
  calLeft: -1,
  calRight: 1,
  calUp: -7,
  calDown: 7,
};

/** The day `shortcut` moves the focused calendar cell to (local midnight, DST-safe). */
export function moveCalendarDay(day: Date, id: ShortcutId): Date {
  const offset = CALENDAR_MOVES[id] ?? 0;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
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
