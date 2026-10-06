// Client-safe helpers for the email-link flows (project invites, password reset) and the
// /auth/set-password page. No Supabase import here, so the pure parts are trivial to test.

/** Path of the page every invite and reset email links to (add it to Supabase Redirect URLs). */
export const SET_PASSWORD_PATH = "/auth/set-password";

/** Minimum password length accepted by the set-password form. */
export const MIN_PASSWORD_LENGTH = 8;
/** Upper bound (bcrypt only uses the first 72 bytes; Supabase rejects longer passwords). */
export const MAX_PASSWORD_LENGTH = 72;
/** Same cap as the server function's zod schema and `project_invites` checks. */
export const MAX_EMAIL_LENGTH = 320;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-cased, trimmed email, or null when it is not a plausible address. */
export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return value.length <= MAX_EMAIL_LENGTH && EMAIL.test(value) ? value : null;
}

export type PasswordCheck = "length" | "letters" | "numbers" | "symbols";
export type PasswordStrength = {
  /** 0 (empty) to 4 (long, mixed). */
  score: 0 | 1 | 2 | 3 | 4;
  /** Which hints are satisfied, in display order. */
  checks: Record<PasswordCheck, boolean>;
  /** The form accepts the password (minimum length, not longer than the maximum). */
  acceptable: boolean;
};

/**
 * Local strength estimate for the hints under the password field. It only guides the user;
 * Supabase Auth enforces its own policy (_Authentication → Providers → Email → password
 * requirements) and its error is shown when it rejects the password.
 */
export function passwordStrength(password: string): PasswordStrength {
  const checks: Record<PasswordCheck, boolean> = {
    length: password.length >= MIN_PASSWORD_LENGTH,
    letters: /[a-z]/.test(password) && /[A-Z]/.test(password),
    numbers: /\d/.test(password),
    symbols: /[^A-Za-z0-9]/.test(password),
  };
  const variety = [checks.letters, checks.numbers, checks.symbols].filter(Boolean).length;
  // 1: too short · 2: long enough · 3: plus two kinds of variety · 4: plus all three or 14+ chars.
  let score = password.length > 0 ? 1 : 0;
  if (checks.length) {
    score = 2 + (variety >= 2 ? 1 : 0) + (variety === 3 || password.length >= 14 ? 1 : 0);
  }
  return {
    score: Math.min(4, score) as PasswordStrength["score"],
    checks,
    acceptable: checks.length && password.length <= MAX_PASSWORD_LENGTH,
  };
}

export type AuthLinkKind = "invite" | "recovery" | "unknown";
export type AuthLinkParams = {
  /** What the email link was for (`type` in the hash or query). */
  kind: AuthLinkKind;
  /** Error reported by Supabase in the redirect (`#error=…&error_code=otp_expired`). */
  error: { code: string; description: string } | null;
  /** PKCE code (`?code=`), when the project uses the PKCE flow. */
  code: string | null;
  /** Implicit-flow tokens are present in the hash (supabase-js stores them on init). */
  hasTokens: boolean;
  /** `sub` of the access token in the hash, to check the stored session belongs to the link. */
  tokenSubject: string | null;
};

/** `sub` claim of a JWT, without verifying it (the auth server already did). */
export function jwtSubject(token: string | null): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Reads what a Supabase email link put in the URL: implicit tokens or errors in the hash
 * (`#access_token=…&type=invite`, `#error_code=otp_expired`), or a PKCE `?code=` /
 * in the query. Must run before the Supabase client initializes, because
 * supabase-js clears the hash once it has read it.
 */
export function parseAuthLinkParams(href: string): AuthLinkParams {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const query = url.searchParams;
  const get = (key: string) => hash.get(key) ?? query.get(key);
  const type = get("type");
  const kind: AuthLinkKind =
    type === "invite" || type === "signup"
      ? "invite"
      : type === "recovery"
        ? "recovery"
        : "unknown";
  const errorCode = get("error_code") ?? get("error");
  return {
    kind,
    error: errorCode
      ? { code: errorCode, description: (get("error_description") ?? "").slice(0, 300) }
      : null,
    code: query.get("code"),
    hasTokens: hash.has("access_token"),
    tokenSubject: jwtSubject(hash.get("access_token")),
  };
}

/** Same-origin project path from the invite metadata, or null. */
export function invitedProjectPath(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const id = (metadata as Record<string, unknown>)["invited_project_id"];
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? `/projects/${id}`
    : null;
}
