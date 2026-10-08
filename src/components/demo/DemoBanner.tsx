import { ExternalLink, FlaskConical, X } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { useEffect, useState } from "react";

import { DEMO_GITHUB_URL, isDemo, prodUrl } from "@/lib/app-mode";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/** sessionStorage flag: the notice stays hidden for this tab session only. */
export const DEMO_NOTICE_KEY = "second-brain-demo-notice-dismissed";
/** Self-hosting guide linked from the notice. */
export const SELF_HOST_URL = `${DEMO_GITHUB_URL}#deployment-to-vercel`;

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DEMO_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Alert card at the top of every page of the demo deployment (`VITE_APP_MODE=demo`): app
 * shell, landing and login. It says the data is sample data reset daily at 00:00 WIB and that
 * some features are off, and links to the self-hosting guide and to production.
 *
 * Dismissing hides it for the current browser session only (sessionStorage), so it is back on
 * the next visit. It renders on the server (the flag is read after mount) to avoid a layout
 * shift on first paint; a dismissed notice disappears right after hydration. Amber-950 on
 * amber-50 (and amber-50 on amber-950/60 in dark mode) keeps body text and links above AA.
 * Renders nothing outside the demo.
 */
export function DemoBanner({
  active = isDemo(),
  className,
}: {
  active?: boolean;
  className?: string;
}) {
  const { t } = usePreferences();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is client-only.
    if (readDismissed()) setDismissed(true);
  }, []);
  if (!active || dismissed) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DEMO_NOTICE_KEY, "1");
    } catch {
      // Storage blocked (private mode): hide for this page view only.
    }
    setDismissed(true);
  }

  const link =
    "-my-2.5 inline-flex min-h-11 items-center gap-1 rounded-sm font-medium underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:my-0 sm:min-h-0";
  return (
    <aside
      aria-label={t("demoBannerLabel")}
      className={cn(
        "relative rounded-2xl border border-amber-300 bg-amber-50 p-4 pr-12 text-sm text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-950/60 dark:text-amber-50",
        className,
      )}
    >
      <div className="flex gap-3">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{t("demoNoticeTitle")}</p>
          <p className="text-pretty">{t("demoNoticeBody")}</p>
          <p className="flex flex-wrap gap-x-5 pt-1">
            <a href={SELF_HOST_URL} target="_blank" rel="noopener" className={link}>
              {t("demoNoticeSelfHost")}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
            <a href={prodUrl()} target="_blank" rel="noopener" className={link}>
              {t("demoBannerProd")}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </p>
        </div>
      </div>
      <IconButton
        label={t("demoNoticeDismiss")}
        onClick={dismiss}
        className="absolute top-1.5 right-1.5 size-11 hover:bg-amber-100 dark:hover:bg-amber-900/60"
      >
        <X aria-hidden />
      </IconButton>
    </aside>
  );
}

/** Alias with the new name; `DemoBanner` stays exported for existing imports. */
export const DemoNotice = DemoBanner;
