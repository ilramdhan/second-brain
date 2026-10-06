import { createFileRoute } from "@tanstack/react-router";

import { PRIVACY_DESCRIPTION } from "@/components/legal/content";
import { LegalPage } from "@/components/legal/LegalPage";
import { publicPageHead } from "@/lib/landing";

/** Public, server-rendered privacy policy (indexed; listed in public/sitemap.xml). */
export const Route = createFileRoute("/privacy")({
  head: () =>
    publicPageHead({
      title: "Kebijakan Privasi — Second Brain",
      description: PRIVACY_DESCRIPTION,
      path: "/privacy",
    }),
  component: () => <LegalPage kind="privacy" />,
});
