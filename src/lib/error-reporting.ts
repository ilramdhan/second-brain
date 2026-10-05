// Client-side error reporting for React/TanStack error boundaries.
//
// Errors always go to the console. A monitoring SDK (e.g. Sentry) can be plugged in later by
// calling `setErrorReporter` once at startup, without touching the boundaries that report.

export type ErrorContext = Record<string, unknown>;
export type ErrorReporter = (error: unknown, context: ErrorContext) => void;

let reporter: ErrorReporter | undefined;

/** Registers (or clears, with `undefined`) the external reporter that receives every error. */
export function setErrorReporter(next: ErrorReporter | undefined) {
  reporter = next;
}

/** Short, readable description; a thrown Response would otherwise print "[object Response]". */
export function describeError(error: unknown): string {
  if (error instanceof Response) {
    return `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Reports an error caught by a boundary. Never throws. */
export function reportError(error: unknown, context: ErrorContext = {}) {
  const fullContext: ErrorContext = {
    ...(typeof window !== "undefined" ? { route: window.location.pathname } : {}),
    ...context,
  };
  console.error(`[error] ${describeError(error)}`, fullContext, error);
  try {
    reporter?.(error, fullContext);
  } catch (reporterError) {
    console.error("[error] reporter failed", reporterError);
  }
}
