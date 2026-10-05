/**
 * Pure helpers for the TanStack Query cache used by `src/lib/data.ts`. Kept free of Supabase
 * and React imports so they can be unit-tested.
 */

/** `%term%` for a PostgREST `ilike` filter, with LIKE wildcards in the term escaped. */
export function ilikePattern(term: string): string {
  return `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
