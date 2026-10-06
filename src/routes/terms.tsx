import { createFileRoute } from "@tanstack/react-router";

import { TERMS_DESCRIPTION } from "@/components/legal/content";
import { LegalPage } from "@/components/legal/LegalPage";
import { publicPageHead } from "@/lib/landing";

/** Public, server-rendered terms of use (indexed; listed in public/sitemap.xml). */
export const Route = createFileRoute("/terms")({
  head: () =>
    publicPageHead({
      title: "Ketentuan Penggunaan — Second Brain",
      description: TERMS_DESCRIPTION,
      path: "/terms",
    }),
  component: () => <LegalPage kind="terms" />,
});
