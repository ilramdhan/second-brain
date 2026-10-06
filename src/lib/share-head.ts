import { robotsFor } from "@/lib/app-mode";
import { OG_IMAGE, SITE_NAME } from "@/lib/landing";
import type { PublicShare } from "@/lib/share";

/**
 * `<head>` of a public share page (`/s/$token`): title and Open Graph from the shared item,
 * `noindex` unless the owner allowed indexing (and always in the demo), no canonical URL (the
 * token is a secret, so the address must not be advertised), and `no-referrer`.
 */
export function shareHead(share: PublicShare | null) {
  const title = share ? `${share.title} — ${SITE_NAME}` : `${SITE_NAME}`;
  const description = share?.summary || SITE_NAME;
  const robots = share?.allowIndexing ? robotsFor("index, follow") : "noindex, nofollow";
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: robots },
      { name: "referrer", content: "no-referrer" },
      { property: "og:type", content: "article" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: share?.title ?? SITE_NAME },
      { property: "og:description", content: description },
      { property: "og:image", content: OG_IMAGE.url },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: share?.title ?? SITE_NAME },
      { name: "twitter:description", content: description },
    ],
  };
}
