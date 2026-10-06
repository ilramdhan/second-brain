import { ExternalLink, FlaskConical } from "lucide-react";

import { DEMO_GITHUB_URL, isDemo, prodUrl } from "@/lib/app-mode";
import { usePreferences } from "@/lib/preferences";

/**
 * Notice at the top of the app shell on the demo deployment (`VITE_APP_MODE=demo`): data is
 * reset daily and some integrations are off. Renders nothing elsewhere.
 */
export function DemoBanner({ active = isDemo() }: { active?: boolean }) {
  const { t } = usePreferences();
  if (!active) return null;
  return (
    <aside
      aria-label={t("demoBannerLabel")}
      className="border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex min-w-0 flex-1 items-center gap-1.5">
          <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t("demoBannerText")}</span>
        </p>
        <span className="flex items-center gap-3">
          <a
            href={prodUrl()}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 rounded-sm font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("demoBannerProd")}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          <a
            href={DEMO_GITHUB_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 rounded-sm font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("demoBannerGithub")}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </span>
      </div>
    </aside>
  );
}
