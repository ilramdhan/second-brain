// Optional browser monitoring (plan item 8.1): Sentry error reporting + Core Web Vitals.
//
// This module is in the entry bundle, so it stays tiny and SDK-free:
//   * No `VITE_SENTRY_DSN` → nothing is loaded and nothing leaves the browser. In `vite dev` the
//     web-vitals library is lazy-loaded and metrics go to `console.debug`.
//   * With a DSN, `@sentry/browser` (+ web-vitals) is a separate chunk loaded after the page is
//     idle, or immediately when the first error is reported. Errors reported before that are
//     queued and flushed once the SDK is up.
// The SDK plugs into `setErrorReporter`, so the error boundaries stay untouched.
import { setErrorReporter, type ErrorContext } from "./error-reporting";
import { readDsn } from "./monitoring-config";

type Loaded = typeof import("./sentry-browser");
type Pending = { error: unknown; context: ErrorContext };

const MAX_QUEUE = 20;

let started = false;
let loader: Promise<Loaded | undefined> | undefined;
let pending: Pending[] = [];
let userId: string | null = null;
let removeEarlyListeners: (() => void) | undefined;

export function clientDsn(): string | undefined {
  return readDsn(import.meta.env["VITE_SENTRY_DSN"] as string | undefined);
}

function load(dsn: string): Promise<Loaded | undefined> {
  loader ??= import("./sentry-browser")
    .then((mod) => {
      mod.initSentry(dsn);
      mod.setSentryUser(userId);
      removeEarlyListeners?.();
      for (const item of pending) mod.captureReported(item.error, item.context);
      pending = [];
      setErrorReporter((error, context) => mod.captureReported(error, context));
      return mod;
    })
    .catch((error: unknown) => {
      // Ad blockers often block the chunk or the ingest host; the app must keep working.
      console.warn("[monitoring] Sentry failed to load", error);
      pending = [];
      setErrorReporter(undefined);
      return undefined;
    });
  return loader;
}

function queue(error: unknown, context: ErrorContext) {
  if (pending.length < MAX_QUEUE) pending.push({ error, context });
}

function afterFirstPaint(cb: () => void) {
  const run = () => {
    const ric = (
      window as Window & { requestIdleCallback?: (cb: () => void, o?: object) => number }
    ).requestIdleCallback;
    if (ric) ric(cb, { timeout: 5000 });
    else setTimeout(cb, 1500);
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}

/**
 * Starts monitoring once per page (call from a client-only effect). Returns whether Sentry is
 * enabled for this build.
 */
export function initMonitoring(): boolean {
  if (typeof window === "undefined" || started) return clientDsn() != null;
  started = true;
  const dsn = clientDsn();

  if (!dsn) {
    if (import.meta.env.DEV) {
      void import("./web-vitals")
        .then((m) => m.observeWebVitals((metric) => console.debug("[web-vitals]", metric)))
        .catch(() => undefined);
    }
    return false;
  }

  // Until the SDK is loaded: queue boundary reports and uncaught errors, and load right away.
  setErrorReporter((error, context) => {
    queue(error, context);
    void load(dsn);
  });
  const onError = (event: ErrorEvent) => {
    queue(event.error ?? new Error(event.message), { mechanism: "window.onerror" });
    void load(dsn);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    queue(event.reason, { mechanism: "unhandledrejection" });
    void load(dsn);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  removeEarlyListeners = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    removeEarlyListeners = undefined;
  };

  afterFirstPaint(() => void load(dsn));
  return true;
}

/** Associates events with the signed-in user's id (never e-mail or name); `null` clears it. */
export function setMonitoringUser(id: string | null) {
  userId = id;
  if (!loader) return;
  void loader.then((mod) => mod?.setSentryUser(id));
}

/** Test hook. */
export function resetMonitoringForTests() {
  started = false;
  loader = undefined;
  pending = [];
  userId = null;
  removeEarlyListeners?.();
  setErrorReporter(undefined);
}

/** Test hook: number of errors waiting for the SDK. */
export function pendingCountForTests() {
  return pending.length;
}
