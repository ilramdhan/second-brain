// One place that turns any thrown value (PostgrestError, AuthError, server function error,
// network failure, thrown Response...) into a short, friendly message for a toast.
//
// Raw Postgres/PostgREST text ("new row violates row-level security policy...") never reaches
// the user; app-authored messages thrown by server functions ("Tugas harus memiliki tanggal
// mulai atau tenggat.") are already meant for people and pass through unchanged.

import { toast } from "sonner";

import { translate, type MessageKey } from "@/lib/preferences";

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  details?: unknown;
  hint?: unknown;
};

/** Postgres SQLSTATE / PostgREST codes → message key. */
const CODE_KEYS: Record<string, MessageKey> = {
  "42501": "errForbidden", // insufficient_privilege (RLS)
  "23505": "errDuplicate", // unique_violation
  "23503": "errReference", // foreign_key_violation
  "23502": "errInvalid", // not_null_violation
  "23514": "errInvalid", // check_violation
  "22P02": "errInvalid", // invalid_text_representation (bad uuid...)
  "22007": "errInvalid", // invalid_datetime_format
  "22008": "errInvalid", // datetime_field_overflow
  "22023": "errInvalid", // invalid_parameter_value
  "57014": "errTimeout", // query_canceled (statement timeout)
  PGRST116: "errNotFound", // .single() matched no row
  PGRST301: "errSession", // JWT expired / invalid
  PGRST303: "errSession",
};

/** Message patterns (checked in order) for errors that carry no useful code. */
const PATTERNS: [RegExp, MessageKey][] = [
  [/AI belum dikonfigurasi/i, "errAiNotConfigured"],
  [/Missing Supabase environment variable/i, "errConfig"],
  [/failed to fetch|networkerror|network request failed|load failed|fetch failed/i, "errNetwork"],
  [/^Unauthorized\b/i, "errSession"],
  [/jwt expired|invalid jwt|refresh token/i, "errSession"],
  [/only the owner or the project owner/i, "errOwnerOnly"],
  [/not a member of|row-level security|permission denied/i, "errForbidden"],
  [/not authenticated|auth session missing/i, "errSession"],
  [/invalid login credentials/i, "errInvalidLogin"],
  [/email not confirmed/i, "errEmailNotConfirmed"],
  [/user already registered/i, "errUserExists"],
  [/rate limit|too many requests/i, "errRateLimit"],
  [/timed? ?out|timeout/i, "errTimeout"],
];

/**
 * Demo-mode messages written for people (Phase 10): "Tidak tersedia di demo…" from
 * `assertNotDemo` and "Batas demo: …" from the demo row limits / write quota (database triggers,
 * raised as P0001) and the per-IP limiter. They are shown as-is, even when they arrive inside a
 * PostgREST error, because they tell the visitor exactly which demo limit they hit.
 */
const DEMO_MESSAGE = /^(Tidak tersedia di demo|Batas demo\b)/i;

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as ErrorLike).message === "string")
    return (error as ErrorLike).message as string;
  return "";
}

/** The visitor-facing demo message carried by `error`, if any. */
export function demoMessage(error: unknown): string | undefined {
  const text = rawMessage(error).trim();
  return DEMO_MESSAGE.test(text) ? text.slice(0, 300) : undefined;
}

/** Text that looks like an internal/technical error rather than a message for people. */
const TECHNICAL =
  /violates|constraint|relation "|column "|syntax error|function .*\(|duplicate key|^\w+Error\b|undefined|null|stack|PGRST|SQLSTATE|\bat\s+\S+\.(ts|js)/i;

function statusKey(status: number): MessageKey | undefined {
  if (status === 401) return "errSession";
  if (status === 403) return "errForbidden";
  if (status === 404) return "errNotFound";
  if (status === 408 || status === 504) return "errTimeout";
  if (status === 409) return "errDuplicate";
  if (status === 429) return "errRateLimit";
  return undefined;
}

/** The "Missing Supabase environment variable(s)" error the Supabase clients throw. */
export function isConfigError(error: unknown): boolean {
  return error instanceof Error && /Missing Supabase environment variable/i.test(error.message);
}

/** Message key for a known error class, or `undefined` when the error is not recognised. */
export function errorKey(error: unknown): MessageKey | undefined {
  if (demoMessage(error)) return undefined;
  if (error instanceof Response) return statusKey(error.status);
  if (!error || typeof error !== "object") {
    return typeof error === "string" ? PATTERNS.find(([re]) => re.test(error))?.[1] : undefined;
  }
  const e = error as ErrorLike;
  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" ? e.message : "";

  if (name === "AbortError" || name === "TimeoutError") return "errTimeout";
  if (name === "AiNotConfiguredError") return "errAiNotConfigured";
  if (name === "AuthRetryableFetchError") return "errNetwork";
  if (name === "AuthSessionMissingError") return "errSession";
  // Supabase auth errors carry a string code ("invalid_credentials", "email_not_confirmed"...).
  if (e.code === "invalid_credentials") return "errInvalidLogin";
  if (e.code === "email_not_confirmed") return "errEmailNotConfirmed";
  if (e.code === "user_already_exists") return "errUserExists";

  const byPattern = PATTERNS.find(([re]) => re.test(message))?.[1];
  // The AI rate limiter's own message names the exact budget; keep it.
  if (name === "RateLimitError" || /^Batas penggunaan AI/.test(message)) return undefined;
  if (byPattern) return byPattern;

  if (typeof e.code === "string" && CODE_KEYS[e.code]) return CODE_KEYS[e.code];
  if (typeof e.status === "number") return statusKey(e.status);
  return undefined;
}

/** A PostgREST/Postgres error: its message is technical and must not be shown verbatim. */
function isDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as ErrorLike;
  return (
    e.name === "PostgrestError" ||
    (typeof e.code === "string" && /^([0-9A-Z]{5}|PGRST\d+)$/.test(e.code) && "details" in e)
  );
}

/**
 * Friendly, localized message for any thrown value. `fallback` is used when the error is not
 * recognised and its own text is not fit to show (database errors, technical messages).
 */
export function errorMessage(error: unknown, fallback?: string): string {
  const demo = demoMessage(error);
  if (demo) return demo;
  const key = errorKey(error);
  if (key) return translate(key);
  const generic = fallback ?? translate("errGeneric");
  if (isDatabaseError(error)) return generic;

  const text = rawMessage(error).trim();
  if (!text || text.length > 200 || TECHNICAL.test(text)) return generic;
  return text;
}

/** Shows the friendly message for `error` as an error toast and returns it. */
export function toastError(
  error: unknown,
  fallback?: string,
  options?: { id?: string | number },
): string {
  const message = errorMessage(error, fallback);
  if (import.meta.env.DEV) console.warn("[toastError]", error);
  toast.error(message, options);
  return message;
}
