import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { Landing } from "@/components/landing/Landing";
import { APP_HOME_PATH, isSignedIn, landingHead, redirectSignedInVisitor } from "@/lib/landing";

export const Route = createFileRoute("/")({
  // Server-rendered for SEO and a fast first paint. The check is a no-op on the server (the
  // session lives in browser storage) and covers client-side navigations to `/`.
  beforeLoad: redirectSignedInVisitor,
  // Title, description, canonical, Open Graph/Twitter card and JSON-LD: see landingHead().
  head: landingHead,
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
