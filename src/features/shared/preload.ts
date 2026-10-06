import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Route-loader helper: starts the given queries (cache hits resolve immediately) without
 * blocking the navigation, so the fetch runs while the route chunk loads and renders. Errors
 * are swallowed here; the page's own `useQuery` surfaces them.
 */
export function preloadQueries(
  queryClient: QueryClient,
  // Each entry is one of the feature query option objects (`tasksQuery`, `noteQuery(id)`, ...).
  // Only the key is read here; the rest is handed to `ensureQueryData` as is.
  ...queries: Array<{ queryKey: QueryKey; queryFn?: unknown; staleTime?: unknown }>
) {
  for (const q of queries)
    queryClient.ensureQueryData(q as Parameters<QueryClient["ensureQueryData"]>[0]).catch(() => {});
}
