import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toastError } from "@/lib/errors";
import { routeTree } from "./routeTree.gen";

/** Cached data counts as fresh for a minute; mutations update the cache directly. */
export const QUERY_STALE_TIME = 60_000;

/**
 * Failed reads surface as one error toast (deduped by id, so a page whose five queries fail at
 * once shows one toast). Writes do not use `useMutation`: they toast in `useCrud` /
 * `useTaskActions` via `toastError`, so there is no mutation default and no double toast.
 * Queries can opt out with `meta: { silent: true }`.
 */
export function onQueryError(
  error: unknown,
  query: { meta?: Record<string, unknown> | undefined },
) {
  if (typeof window === "undefined" || query.meta?.["silent"]) return;
  toastError(error, undefined, { id: "query-error" });
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: onQueryError }),
    defaultOptions: {
      queries: {
        // Without these every page mount and every alt-tab refetched all tables (select *).
        staleTime: QUERY_STALE_TIME,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export const getRouter = () => {
  const queryClient = createQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Hovering a nav link downloads the route's code-split chunk ahead of the click; the
    // preloaded match then stays fresh as long as the query cache does.
    defaultPreload: "intent",
    defaultPreloadStaleTime: QUERY_STALE_TIME,
  });

  return router;
};
