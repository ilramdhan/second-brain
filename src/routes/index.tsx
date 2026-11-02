import { createFileRoute, redirect } from "@tanstack/react-router";

import { Landing } from "@/components/landing/Landing";
import { landingPageEnabled, landingHead, redirectSignedInVisitor, useRedirectSignedInVisitor } from "@/lib/landing";
import { headLocale } from "@/lib/page-head";

export const Route = createFileRoute("/")({
  // Server-rendered for SEO and a fast first paint. The check is a no-op on the server (the
  // session lives in browser storage) and covers client-side navigations to /.
  beforeLoad: async () => {
    if (!landingPageEnabled()) {
      const { LOGIN_PATH } = await import("@/lib/auth");
      throw redirect({ to: LOGIN_PATH, replace: true });
    }
    await redirectSignedInVisitor();
  },
  // Title, description, canonical, Open Graph/Twitter card and JSON-LD: see landingHead().
  head: (ctx) => landingHead(headLocale(ctx)),
  component: LandingPage,
});

function LandingPage() {
  useRedirectSignedInVisitor();
  return <Landing />;
}