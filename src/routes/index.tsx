import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { Landing } from "@/components/landing/Landing";
import { APP_HOME_PATH, isSignedIn, redirectSignedInVisitor, SITE_URL } from "@/lib/landing";

const TITLE = "Second Brain — tugas & catatan dengan AI";
const DESCRIPTION =
  "Tangkap ide, biarkan AI merapikannya, lalu kelola tugas (list, kanban, kalender, timeline), catatan berblok, dan proyek tim. Open source, PWA.";

export const Route = createFileRoute("/")({
  // Server-rendered for SEO and a fast first paint. The check is a no-op on the server (the
  // session lives in browser storage) and covers client-side navigations to `/`.
  beforeLoad: redirectSignedInVisitor,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE_URL}/` },
      { property: "og:image", content: `${SITE_URL}/icon-512.png` },
      { property: "og:site_name", content: "Second Brain" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/` }],
  }),
  component: LandingPage,
});

function LandingPage() {
  const navigate = useNavigate();
  // `beforeLoad` already ran on the server for the first page load and is not repeated during
  // hydration, so a signed-in visitor opening an old `/` bookmark is forwarded from here.
  useEffect(() => {
    let active = true;
    void isSignedIn().then((signedIn) => {
      if (active && signedIn) void navigate({ to: APP_HOME_PATH, replace: true });
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  return <Landing />;
}
