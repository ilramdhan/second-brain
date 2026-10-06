/**
 * Keyboard and screen-reader support for drag & drop (WCAG 2.1.1 / 4.1.3).
 *
 * `@dnd-kit/sortable` is not installed, so instead of `sortableKeyboardCoordinates` the
 * kanban and calendar use {@link droppableKeyboardCoordinates}: arrow keys jump the dragged
 * item straight to the next droppable (column or day) rather than nudging it by pixels.
 */
import {
  KeyboardCode,
  type Announcements,
  type KeyboardCoordinateGetter,
  type KeyboardSensorOptions,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { addDays, format } from "date-fns";
import { id as localeId } from "date-fns/locale";

const ARROWS: string[] = [
  KeyboardCode.Left,
  KeyboardCode.Right,
  KeyboardCode.Up,
  KeyboardCode.Down,
];

/**
 * Returns the id of the droppable an arrow key should move to from `current`
 * (`null` when there is nowhere to go in that direction).
 */
export type NextDroppable = (current: string, code: string) => string | null;

/**
 * Builds a KeyboardSensor coordinate getter that centres the dragged item over the droppable
 * chosen by `next`. `fallback` gives the starting droppable before the item is over anything
 * (normally the column/day it was picked up from).
 */
export function droppableKeyboardCoordinates(
  next: NextDroppable,
  fallback: (active: UniqueIdentifier) => string | null,
): KeyboardCoordinateGetter {
  return (event, { active, context, currentCoordinates }) => {
    if (!ARROWS.includes(event.code)) return undefined;
    event.preventDefault();
    const current = context.over?.id != null ? String(context.over.id) : fallback(active);
    const target = current ? next(current, event.code) : null;
    const rect = target ? context.droppableRects.get(target) : undefined;
    if (!rect) return currentCoordinates;
    const w = context.collisionRect?.width ?? 0;
    const h = context.collisionRect?.height ?? 0;
    return {
      x: rect.left + Math.max(0, (rect.width - w) / 2),
      y: rect.top + Math.max(0, Math.min(rect.height - h, 32)),
    };
  };
}

/** Kanban: ←/→ move between columns in display order. */
export function columnNavigator(columnIds: readonly string[]): NextDroppable {
  return (current, code) => {
    const i = columnIds.indexOf(current);
    if (i < 0) return null;
    const j = code === KeyboardCode.Right ? i + 1 : code === KeyboardCode.Left ? i - 1 : -1;
    return columnIds[j] ?? null;
  };
}

/** Calendar: ←/→ move one day, ↑/↓ one week. Droppable ids are `yyyy-MM-dd` day keys. */
export const dayNavigator: NextDroppable = (current, code) => {
  const step =
    code === KeyboardCode.Right
      ? 1
      : code === KeyboardCode.Left
        ? -1
        : code === KeyboardCode.Down
          ? 7
          : code === KeyboardCode.Up
            ? -7
            : 0;
  if (!step || !/^\d{4}-\d{2}-\d{2}$/.test(current)) return null;
  return format(addDays(new Date(`${current}T00:00:00`), step), "yyyy-MM-dd");
};

/**
 * Space picks up and drops, Escape cancels. Enter is deliberately left out of `start` so it can
 * open the item (the same as a click); while dragging it still drops.
 */
export const KEYBOARD_CODES: NonNullable<KeyboardSensorOptions["keyboardCodes"]> = {
  start: [KeyboardCode.Space],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space, KeyboardCode.Enter],
};

export const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "Tekan spasi untuk mengambil item. Saat dipindahkan, gunakan tombol panah untuk memilih " +
    "tujuan, lalu tekan spasi lagi untuk meletakkan atau Escape untuk membatalkan. " +
    "Tekan Enter untuk membuka item.",
};

/** Indonesian live-region messages for a DndContext. */
export function dndAnnouncements({
  itemName,
  targetName,
}: {
  itemName: (active: { id: UniqueIdentifier; data: { current?: unknown } }) => string;
  targetName: (overId: UniqueIdentifier) => string;
}): Announcements {
  return {
    onDragStart: ({ active }) => `${itemName(active)} diambil.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${itemName(active)} berada di atas ${targetName(over.id)}.`
        : `${itemName(active)} tidak berada di atas area tujuan.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${itemName(active)} diletakkan di ${targetName(over.id)}.`
        : `${itemName(active)} dilepas tanpa perubahan.`,
    onDragCancel: ({ active }) => `Pemindahan ${itemName(active)} dibatalkan.`,
  };
}

/** Human-readable Indonesian date for a `yyyy-MM-dd` key (e.g. "Senin, 6 Oktober 2026"). */
export const dayLabel = (key: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(key)
    ? format(new Date(`${key}T00:00:00`), "EEEE, d MMMM yyyy", { locale: localeId })
    : key;

/**
 * Timeline bar keyboard model: ←/→ move the whole bar a day, Shift+←/→ move the due date
 * (resize). Returns `null` for keys the bar doesn't handle.
 */
export function timelineKeyAction(e: {
  key: string;
  shiftKey: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): { mode: "move" | "end"; delta: number } | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!delta) return null;
  return { mode: e.shiftKey ? "end" : "move", delta };
}
