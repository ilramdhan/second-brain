/** Lists longer than this are windowed; shorter ones render every row exactly as before. */
export const VIRTUALIZE_THRESHOLD = 200;

export function shouldVirtualize(count: number, threshold = VIRTUALIZE_THRESHOLD): boolean {
  return count > threshold;
}

/** Splits `items` into rows of `size` (used to window a responsive card grid row by row). */
export function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return rows;
}

/**
 * Adds `pinned` (the row holding keyboard focus) to a visible index range so the focused
 * element is not unmounted when it scrolls out of view. Keeps the result sorted so DOM order,
 * and therefore Tab order, follows list order.
 */
export function withPinnedIndex(indexes: number[], pinned: number | null, count: number): number[] {
  if (pinned == null || pinned < 0 || pinned >= count || indexes.includes(pinned)) return indexes;
  return [...indexes, pinned].sort((a, b) => a - b);
}
