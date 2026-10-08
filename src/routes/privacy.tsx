import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/legal/LegalPage";
import { publicPageHead } from "@/lib/landing";
import { headLocale, headT, pageTitle } from "@/lib/page-head";

/** Public, server-rendered privacy policy (indexed; listed in public/sitemap.xml). */
export const Route = createFileRoute("/privacy")({
  head: (ctx) => {
    const t = headT(ctx);
    return publicPageHead({
      title: pageTitle(t("metaPrivacyTitle")),
      description: t("metaPrivacyDesc"),
      path: "/privacy",
      locale: headLocale(ctx),
    });
  },
  component: () => <LegalPage kind="privacy" />,
});
