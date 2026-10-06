import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Route-loader helper: starts the given queries (cache hits resolve immediately) without
 * blocking the navigation, so the fetch runs while the route chunk loads and renders. Errors
 * are swallowed here; the page's own `useQuery` surfaces them.
 */
export function preloadQueries(
  queryClient: QueryClient,
  // Each entry is one of the feature query option objects (`tasksQuery`, `noteQuery(id)`, ...).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...queries: Array<{ queryKey: QueryKey; queryFn?: any; staleTime?: any }>
) {
  for (const q of queries)
    queryClient.ensureQueryData(q as Parameters<QueryClient["ensureQueryData"]>[0]).catch(() => {});
}
