import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { ilikePattern } from "@/lib/query-cache";
import { getSemanticStatus, semanticSearchFn } from "@/lib/semantic.functions";
import { flushSemanticSync } from "@/lib/semantic-sync";

export type SearchHit = { id: string; title: string };
export type SearchResults = { tasks: SearchHit[]; projects: SearchHit[]; notes: SearchHit[] };
const SEARCH_LIMIT = 20;

/**
 * Lightweight title search for the command menu: `id,title` only, capped per entity, filtered
 * in Postgres (`ilike`). An empty term returns the most recently updated rows. Unlike
 * useTasks/useNotes it never downloads whole tables (descriptions, note blocks/content).
 */
export function useSearch(term: string, enabled = true) {
  const t = term.trim();
  return useQuery({
    queryKey: ["search", t],
    enabled,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<SearchResults> => {
      const pattern = ilikePattern(t);
      let tasks = supabase
        .from("tasks")
        .select("id,title")
        .is("deleted_at", null)
        .is("archived_at", null)
        .is("parent_id", null);
      let projects = supabase.from("projects").select("id,name").is("deleted_at", null);
      let notes = supabase
        .from("notes")
        .select("id,title")
        .is("deleted_at", null)
        .is("archived_at", null);
      if (t) {
        tasks = tasks.ilike("title", pattern);
        projects = projects.ilike("name", pattern);
        notes = notes.ilike("title", pattern);
      }
      const [tr, pr, nr] = await Promise.all([
        tasks.order("updated_at", { ascending: false }).limit(SEARCH_LIMIT),
        projects.order("name").limit(SEARCH_LIMIT),
        notes.order("updated_at", { ascending: false }).limit(SEARCH_LIMIT),
      ]);
      const error = tr.error ?? pr.error ?? nr.error;
      if (error) throw error;
      return {
        tasks: tr.data ?? [],
        projects: (pr.data ?? []).map((p) => ({ id: p.id, title: p.name })),
        notes: nr.data ?? [],
      };
    },
  });
}

export type { SemanticHit } from "@/lib/semantic";

/**
 * Whether semantic search is available (AI provider configured, or the demo's hashed
 * embeddings). Cached for the session; on any error the palette stays in keyword mode.
 */
export function useSemanticStatus(enabled = true) {
  const status = useServerFn(getSemanticStatus);
  return useQuery({
    queryKey: ["search", "semantic-status"],
    enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: () => status(),
  });
}

/**
 * Semantic (embedding) search over tasks and notes the user can read. Before searching it
 * flushes the debounced index sync so the latest edits are embedded. Disabled for terms shorter
 * than two characters.
 */
export function useSemanticSearch(term: string, enabled = true) {
  const t = term.trim();
  const search = useServerFn(semanticSearchFn);
  return useQuery({
    queryKey: ["search", "semantic", t],
    enabled: enabled && t.length >= 2,
    staleTime: 30_000,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      await flushSemanticSync();
      return search({ data: { query: t, limit: 20 } });
    },
  });
}
