import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangle, RotateCw, Sun } from "lucide-react";
import { useEffect } from "react";

import { PageContainer } from "@/components/common/PageContainer";
import { Button } from "@/components/ui/button";
import { describeError, reportError } from "@/lib/error-reporting";
import { errorKey } from "@/lib/errors";
import { usePreferences } from "@/lib/preferences";

/**
 * Error boundary for one page of the authenticated app. It renders inside the app shell (the
 * `_authenticated` layout stays mounted), so the sidebar and Cmd+K keep working when a single
 * page throws. Retry re-runs the route's loaders (`router.invalidate`) and resets the boundary.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const { t } = usePreferences();
  const routeId = router.state.matches.at(-1)?.routeId;

  useEffect(() => {
    reportError(error, { boundary: "route_error_component", routeId });
  }, [error, routeId]);

  const key = errorKey(error);

  return (
    <PageContainer>
      <div
        role="alert"
        className="mx-auto mt-10 max-w-md rounded-lg border bg-card p-6 text-center shadow-sm"
      >
        <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-foreground">{t("routeErrorTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{key ? t(key) : t("routeErrorBody")}</p>
        {import.meta.env.DEV && (
          <pre className="mt-4 max-h-40 overflow-auto rounded bg-muted p-2 text-left text-xs text-muted-foreground">
            {describeError(error)}
          </pre>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              void router.invalidate();
              reset();
            }}
          >
            <RotateCw className="mr-1 h-4 w-4" />
            {t("retry")}
          </Button>
          <Button variant="outline" asChild>
            <Link to="/today" onClick={() => reset()}>
              <Sun className="mr-1 h-4 w-4" />
              {t("backToToday")}
            </Link>
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
