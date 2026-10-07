import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from "react";

import {
  findPos,
  matchShortcut,
  moveSelection,
  NAV_MOVES,
  resolveSelection,
  shouldIgnoreShortcut,
  type NavSelection,
} from "@/lib/shortcuts";

export type NavKind = "task" | "note";

// The item selected in the list on screen, read by the Cmd+K palette for its contextual actions.
let active: { kind: NavKind; id: string } | null = null;
export function getActiveSelection() {
  return active;
}

type Options = {
  /** Ids in display order, one array per column (a plain list is one column). */
  columns: readonly (readonly string[])[];
  /** Lets the palette offer actions for the selected item. */
  kind?: NavKind | undefined;
  enabled?: boolean | undefined;
  onOpen: (id: string) => void;
  onToggle?: ((id: string) => void) | undefined;
  /** Defaults to `onOpen` (the task dialog is the editor). */
  onEdit?: ((id: string) => void) | undefined;
};

/**
 * Keyboard-first list/kanban navigation (shortcuts in src/lib/shortcuts.ts): j/k (and h/l
 * between columns) move a visible selection from anywhere on the page, arrows/Home/End/Enter
 * work while focus is in the list, o/Enter open, e edits and x toggles. Uses a roving tabindex:
 * the selected item is the list's only tab stop and receives focus when the selection moves.
 * Letters are ignored while typing, while a dialog/menu is open and during a kanban drag.
 */
export function useKeyboardNav({
  columns,
  kind,
  enabled = true,
  onOpen,
  onToggle,
  onEdit,
}: Options) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sel, setSel] = useState<NavSelection>(null);
  const resolved = useMemo(() => resolveSelection(columns, sel), [columns, sel]);
  const pendingFocus = useRef(false);

  const latest = useRef({ columns, resolved, onOpen, onToggle, onEdit });
  useLayoutEffect(() => {
    latest.current = { columns, resolved, onOpen, onToggle, onEdit };
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container || shouldIgnoreShortcut(e)) return;
      const m = matchShortcut(e, "list");
      if (!m) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const inList = !!target && container.contains(target);
      if (m.binding.inList && !inList) return;
      // dnd-kit marks the card being dragged with aria-pressed; arrows/Enter/Esc belong to it.
      if (container.querySelector("[aria-pressed=true]")) return;
      const { columns, resolved, onOpen, onToggle, onEdit } = latest.current;

      const move = NAV_MOVES[m.id];
      if (move) {
        const next = moveSelection(columns, resolved, move);
        if (!next) return;
        e.preventDefault();
        pendingFocus.current = true;
        setSel(next);
        return;
      }
      if (!resolved) return;
      if (m.id === "navClear") {
        setSel(null);
        if (inList) target?.blur();
        return;
      }
      // Enter on a control inside the row (its checkbox) keeps the control's own action.
      if (m.binding.key === "Enter" && !target?.hasAttribute("data-nav-id")) return;
      const run =
        m.id === "navOpen" ? onOpen : m.id === "navToggle" ? onToggle : (onEdit ?? onOpen);
      if (!run) return;
      e.preventDefault();
      run(resolved.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  const selectedId = resolved?.id ?? null;
  // Focus and reveal the item after a keyboard move (also after `x` hides it and the
  // selection lands on its neighbour, as long as focus was in the list).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !selectedId) return;
    // Focus left on <body> means the focused item just unmounted (e.g. done and hidden).
    const focusInside =
      container.contains(document.activeElement) || document.activeElement === document.body;
    if (!pendingFocus.current && !focusInside) return;
    pendingFocus.current = false;
    const el = container.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(selectedId)}"]`);
    if (!el) return;
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    if (!kind) return;
    active = selectedId ? { kind, id: selectedId } : null;
    return () => {
      if (active?.id === selectedId) active = null;
    };
  }, [kind, selectedId]);

  // Clicking or tabbing into an item selects it, so the keys continue from there.
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-nav-id]");
    const id = item?.dataset["navId"];
    if (!id || id === latest.current.resolved?.id) return;
    const pos = findPos(latest.current.columns, id);
    if (pos) setSel({ id, pos });
  };

  const firstId = columns.find((c) => c.length > 0)?.[0] ?? null;
  return {
    containerProps: { ref: containerRef, onFocus },
    /** The selected item; `tabStopId` is the one item reachable with Tab. */
    nav: { selectedId, tabStopId: selectedId ?? firstId },
  };
}

export type NavState = ReturnType<typeof useKeyboardNav>["nav"];

/** Attributes for one navigable item (booleans, so memoised rows keep their props stable). */
export function navAttrs(id: string, selected: boolean, tabStop: boolean) {
  return {
    "data-nav-id": id,
    "data-selected": selected ? "true" : undefined,
    "aria-current": selected ? ("true" as const) : undefined,
    tabIndex: tabStop ? 0 : -1,
  };
}

/** Selection ring shared by task rows, kanban cards and note cards. */
export const NAV_ITEM_CLASS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:border-primary/60 data-[selected=true]:ring-2 data-[selected=true]:ring-ring/60";
