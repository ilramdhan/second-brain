import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/** Cached data counts as fresh for a minute; mutations update the cache directly. */
export const QUERY_STALE_TIME = 60_000;

export function createQueryClient() {
  return new QueryClient({
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
