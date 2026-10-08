import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/legal/LegalPage";
import { publicPageHead } from "@/lib/landing";
import { headLocale, headT, pageTitle } from "@/lib/page-head";

/** Public, server-rendered terms of use (indexed; listed in public/sitemap.xml). */
export const Route = createFileRoute("/terms")({
  head: (ctx) => {
    const t = headT(ctx);
    return publicPageHead({
      title: pageTitle(t("metaTermsTitle")),
      description: t("metaTermsDesc"),
      path: "/terms",
      locale: headLocale(ctx),
    });
  },
  component: () => <LegalPage kind="terms" />,
});
