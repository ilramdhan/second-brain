/**
 * Pure helpers for the TanStack Query cache used by `src/lib/data.ts`. Kept free of Supabase
 * and React imports so they can be unit-tested.
 */

type WithId = { id: string };

/** `%term%` for a PostgREST `ilike` filter, with LIKE wildcards in the term escaped. */
export function ilikePattern(term: string): string {
  return `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Merges `patch` into the row with `id`. Returns the same array when no row matches. */
export function patchRows<T extends WithId>(
  list: readonly T[] | undefined,
  id: string,
  patch: Partial<T>,
): T[] | undefined {
  if (!list) return list;
  let hit = false;
  const next = list.map((r) => {
    if (r.id !== id) return r;
    hit = true;
    return { ...r, ...patch };
  });
  return hit ? next : (list as T[]);
}

/**
 * Patches whatever a query under an entity key holds: a list of rows, a single row (detail
 * query) or nothing yet. Rows with a different id are left untouched.
 */
export function patchCached(data: unknown, id: string, patch: object): unknown {
  if (Array.isArray(data)) return patchRows(data as WithId[], id, patch);
  if (data && typeof data === "object" && (data as WithId).id === id) return { ...data, ...patch };
  return data;
}

/** Removes rows matching `drop`. Returns the same array when nothing was removed. */
export function removeRows<T>(
  list: readonly T[] | undefined,
  drop: (row: T) => boolean,
): T[] | undefined {
  if (!list) return list;
  const next = list.filter((r) => !drop(r));
  return next.length === list.length ? (list as T[]) : next;
}

/**
 * Inserts `row` at `index` (default: end), or replaces the row with the same id in place so a
 * create that races a refetch never shows the row twice.
 */
export function insertRow<T extends WithId>(
  list: readonly T[] | undefined,
  row: T,
  index?: number,
): T[] {
  const base = list ?? [];
  if (base.some((r) => r.id === row.id)) return base.map((r) => (r.id === row.id ? row : r));
  const next = [...base];
  next.splice(index ?? next.length, 0, row);
  return next;
}

/** Index right after the pinned notes (the notes list is ordered pinned first, newest first). */
export function afterPinned(list: readonly { pinned: boolean }[] | undefined): number {
  if (!list) return 0;
  const i = list.findIndex((n) => !n.pinned);
  return i === -1 ? list.length : i;
}

/** Copy of `obj` without `keys`. */
export function omitKeys<T extends object, K extends string>(obj: T, keys: readonly K[]) {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out as Omit<T, K>;
}

/** Copy of `obj` with only `keys` that are present on it. */
export function pickKeys<T extends object, K extends keyof T>(obj: T, keys: readonly K[]) {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}
