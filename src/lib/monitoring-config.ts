// Shared, dependency-free pieces of the optional Sentry integration (browser and server).
//
// Privacy rules (see SECURITY.md → "Error monitoring"): events carry the error, stack, route and
// the Supabase user id only. Request bodies, headers, cookies, query strings, IP addresses,
// e-mail addresses and note/task content never leave the app. `scrubEvent` and
// `scrubBreadcrumb` enforce that as the last step before anything is sent.
//
// The types below are structural subsets of Sentry's `Event` / `Breadcrumb`, so this module stays
// importable without the SDK (it is part of the entry bundle).

/** Parses a sample rate env value; anything missing or invalid means 0 (off). */
export function parseSampleRate(value: string | undefined): number {
  if (value == null || value.trim() === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Normalizes a DSN env value; empty/whitespace means "monitoring disabled". */
export function readDsn(value: string | undefined): string | undefined {
  const dsn = value?.trim();
  return dsn ? dsn : undefined;
}

/** Strips query string and fragment (Supabase REST filters can contain search text). */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

// Keys whose values may hold user content or credentials. Matched case-insensitively against
// every key in `extra`, `contexts` and breadcrumb `data`.
const SENSITIVE_KEY =
  /^(title|content|body|blocks|description|text|notes?|markdown|message_text|caption|prompt|input|transcript|email|e-mail|phone|full_name|display_name|password|token|access_token|refresh_token|authorization|cookie|api[-_]?key|secret|data|payload|query|variables)$/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Masks e-mail addresses inside free text (exception messages can echo them). */
export function maskEmails(text: string): string {
  return text.replace(EMAIL, "[email]");
}

function scrubRecord(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== "object") {
    return typeof value === "string" ? maskEmails(value) : value;
  }
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => scrubRecord(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrubRecord(v, depth + 1);
  }
  return out;
}

export type MonitoringEvent = {
  message?: string;
  request?: {
    url?: string;
    method?: string;
    data?: unknown;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
    env?: unknown;
    [key: string]: unknown;
  };
  user?: { id?: string | number; [key: string]: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | undefined>;
  breadcrumbs?: MonitoringBreadcrumb[];
  exception?: { values?: { value?: string; [key: string]: unknown }[] };
  server_name?: string;
  [key: string]: unknown;
};

export type MonitoringBreadcrumb = {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Removes everything that could identify a person or reveal their notes/tasks. Mutates and
 * returns the event (Sentry's `beforeSend` contract).
 */
export function scrubEvent<E extends object>(input: E): E {
  const event = input as MonitoringEvent;
  if (event.request) {
    const { url, method } = event.request;
    event.request = {
      ...(url ? { url: stripQuery(url) } : {}),
      ...(method ? { method } : {}),
    };
  }
  if (event.user) {
    const id = event.user.id;
    event.user = id != null ? { id } : {};
    if (id == null) delete event.user;
  }
  delete event.server_name;
  if (event.message) event.message = maskEmails(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = maskEmails(ex.value);
  }
  if (event.extra) event.extra = scrubRecord(event.extra) as Record<string, unknown>;
  if (event.contexts) {
    event.contexts = scrubRecord(event.contexts) as NonNullable<MonitoringEvent["contexts"]>;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is MonitoringBreadcrumb => b != null);
  }
  return input;
}

/** Console and DOM breadcrumbs can quote content (log args, aria-labels): drop them. */
export function scrubBreadcrumb<B extends object>(input: B): B | null {
  const breadcrumb = input as MonitoringBreadcrumb;
  const category = breadcrumb.category ?? "";
  if (category === "console" || category.startsWith("ui.")) return null;
  if (breadcrumb.message) breadcrumb.message = maskEmails(stripQueryInText(breadcrumb.message));
  if (breadcrumb.data) {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(breadcrumb.data)) {
      if (k === "url" || k === "from" || k === "to") {
        data[k] = typeof v === "string" ? stripQuery(v) : v;
      } else if (k === "method" || k === "status_code" || k === "reason") {
        data[k] = v;
      }
      // Everything else (request/response bodies, sizes, args) is dropped.
    }
    breadcrumb.data = data;
  }
  return input;
}

function stripQueryInText(text: string): string {
  return text.replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1");
}
