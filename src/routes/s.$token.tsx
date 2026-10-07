import { createFileRoute, notFound } from "@tanstack/react-router";

import { PublicSharePage, PublicShareUnavailable } from "@/components/share/PublicSharePage";
import { getPublicShare } from "@/lib/shares.functions";
import { shareHead, shareRobots } from "@/lib/share-head";

/**
 * Public read-only page of a shared note or project (Phase 9.5). Server-rendered from a sanitized
 * DTO (src/server/publicShare.server.ts); every invalid, revoked or expired token is the same
 * 404. Not indexed unless the owner allowed it, and `no-referrer` keeps the token out of the
 * Referer header of outbound links. The service worker never caches `/s/*` (vite.config.ts).
 */
export const Route = createFileRoute("/s/$token")({
  loader: async ({ params }) => {
    const result = await getPublicShare({ data: { token: params.token } });
    if (result.status === "not_found") throw notFound();
    return result;
  },
  // Revoking must take effect on the next request: never reuse a loaded share.
  staleTime: 0,
  gcTime: 0,
  head: ({ loaderData }) => shareHead(loaderData?.status === "ok" ? loaderData.share : null),
  // The header repeats the meta tag so crawlers that skip HTML (and the 404 page) see it too.
  headers: ({ loaderData }) => ({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
    "x-robots-tag": shareRobots(loaderData?.status === "ok" ? loaderData.share : null),
  }),
  component: SharedPage,
  notFoundComponent: () => <PublicShareUnavailable />,
  errorComponent: () => <PublicShareUnavailable />,
});

function SharedPage() {
  const result = Route.useLoaderData();
  if (result.status !== "ok") return <PublicShareUnavailable rateLimited />;
  return <PublicSharePage share={result.share} />;
}
