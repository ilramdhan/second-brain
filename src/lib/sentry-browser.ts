// Lazy chunk: the Sentry browser SDK and web-vitals. Only loaded by src/lib/monitoring.ts when
// VITE_SENTRY_DSN is set. Uses `@sentry/browser` with a hand-picked integration list (no
// TanStack/React integration, no tracing, no replay) to keep the chunk small.
import {
  breadcrumbsIntegration,
  captureException,
  dedupeIntegration,
  globalHandlersIntegration,
  httpContextIntegration,
  init,
  linkedErrorsIntegration,
  metrics,
  setUser,
  withScope,
  type ErrorEvent,
} from "@sentry/browser";

import type { ErrorContext } from "./error-reporting";
import { parseSampleRate, scrubBreadcrumb, scrubEvent } from "./monitoring-config";
import { observeWebVitals } from "./web-vitals";

export function initSentry(dsn: string) {
  init({
    dsn,
    environment:
      (import.meta.env["VITE_SENTRY_ENVIRONMENT"] as string | undefined) || import.meta.env.MODE,
    release: (import.meta.env["VITE_SENTRY_RELEASE"] as string | undefined) || undefined,
    tracesSampleRate: parseSampleRate(
      import.meta.env["VITE_SENTRY_TRACES_SAMPLE_RATE"] as string | undefined,
    ),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    defaultIntegrations: false,
    integrations: [
      // DOM click/input breadcrumbs can contain note/task text and console args are free-form:
      // keep only navigation and request breadcrumbs (URLs are stripped of query strings).
      breadcrumbsIntegration({ dom: false, fetch: true, history: true, xhr: true }),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      httpContextIntegration(),
    ],
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });

  observeWebVitals((vital) => {
    metrics.distribution(`web_vitals.${vital.name.toLowerCase()}`, vital.value, {
      unit: vital.name === "CLS" ? "none" : "millisecond",
      attributes: { rating: vital.rating, route: vital.route, navigation: vital.navigationType },
    });
  });
}

/** Sends an error reported through `reportError` (boundaries) or caught before the SDK loaded. */
export function captureReported(error: unknown, context: ErrorContext) {
  withScope((scope) => {
    const { boundary, mechanism, route, routeId, ...rest } = context;
    if (typeof boundary === "string") scope.setTag("boundary", boundary);
    if (typeof mechanism === "string") scope.setTag("mechanism", mechanism);
    if (typeof route === "string") scope.setTag("route", route);
    if (typeof routeId === "string") scope.setTag("route_id", routeId);
    if (Object.keys(rest).length) scope.setContext("report", rest);
    captureException(error);
  });
}

export function setSentryUser(id: string | null) {
  setUser(id ? { id } : null);
}
