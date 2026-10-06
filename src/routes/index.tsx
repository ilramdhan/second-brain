import { createFileRoute } from "@tanstack/react-router";

import { Landing } from "@/components/landing/Landing";
import { landingHead, redirectSignedInVisitor, useRedirectSignedInVisitor } from "@/lib/landing";

export const Route = createFileRoute("/")({
  // Server-rendered for SEO and a fast first paint. The check is a no-op on the server (the
  // session lives in browser storage) and covers client-side navigations to `/`.
  beforeLoad: () => redirectSignedInVisitor(),
  // Title, description, canonical, Open Graph/Twitter card and JSON-LD: see landingHead().
  head: landingHead,
  component: LandingPage,
});

function LandingPage() {
  useRedirectSignedInVisitor();
  return <Landing />;
}
