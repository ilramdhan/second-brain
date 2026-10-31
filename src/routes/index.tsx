import { createFileRoute, redirect } from "@tanstack/react-router";

import { Landing } from "@/components/landing/Landing";
import { landingHead, redirectSignedInVisitor, useRedirectSignedInVisitor, useRedirectIfLandingDisabled } from "@/lib/landing";
import { headLocale } from "@/lib/page-head";
import { getLandingEnabledFromCookie } from "@/lib/preferences-ssr";

export const Route = createFileRoute("/")({
  // Server-rendered for SEO and a fast first paint. The check is a no-op on the server (the
  // session lives in browser storage) and covers client-side navigations to `/`.
  beforeLoad: async () => {
    // Check landing enabled from cookie (works server-side and client-side)
    const landingEnabled = await getLandingEnabledFromCookie();
    if (!landingEnabled) {
      // Server-side: always redirect (can't check session on server)
      // Client-side: only redirect if not signed in
      if (typeof window === "undefined") {
        const { LOGIN_PATH } = await import("@/lib/auth");
        throw redirect({ to: LOGIN_PATH, replace: true });
      } else {
        const { isSignedIn } = await import("@/lib/auth");
        if (!(await isSignedIn())) {
          const { LOGIN_PATH } = await import("@/lib/auth");
          throw redirect({ to: LOGIN_PATH, replace: true });
        }
      }
    }
    await redirectSignedInVisitor();
  },
  // Title, description, canonical, Open Graph/Twitter card and JSON-LD: see landingHead().
  head: (ctx) => landingHead(headLocale(ctx)),
  component: LandingPage,
});

function LandingPage() {
  useRedirectIfLandingDisabled();
  useRedirectSignedInVisitor();
  return <Landing />;
}
