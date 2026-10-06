import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { ilikePattern } from "@/lib/query-cache";

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
