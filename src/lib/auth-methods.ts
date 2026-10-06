// Client-safe helpers for the passwordless sign-in methods (Phase 9.2): Google via the Supabase
// Google provider and email magic links, both landing on /auth/callback. Public sign-up stays
// closed: magic links never create users (`shouldCreateUser: false`) and Supabase itself rejects
// a new Google identity when "Allow new users to sign up" is off.
import { isDemo } from "@/lib/app-mode";
import { safeRedirect } from "@/lib/auth";
import type { MessageKey } from "@/lib/preferences";

/** Where Google and magic-link sign-ins return (must be in Supabase Auth → Redirect URLs). */
export const AUTH_CALLBACK_PATH = "/auth/callback";

const flag = (raw: unknown) => (typeof raw === "string" ? raw.trim().toLowerCase() : "");

/** "Masuk dengan Google": only when `VITE_AUTH_GOOGLE=true` and never in the demo. */
export function googleAuthEnabled(
  raw: unknown = import.meta.env["VITE_AUTH_GOOGLE"],
  demo: boolean = isDemo(),
): boolean {
  return !demo && flag(raw) === "true";
}

/** Email magic link: on unless `VITE_AUTH_MAGIC_LINK=false`; never in the demo (shared account). */
export function magicLinkEnabled(
  raw: unknown = import.meta.env["VITE_AUTH_MAGIC_LINK"],
  demo: boolean = isDemo(),
): boolean {
  return !demo && flag(raw) !== "false";
}

/** Absolute callback URL on the current origin (the Redirect URL allow-list entry). */
export function authCallbackUrl(origin: string): string {
  return `${origin}${AUTH_CALLBACK_PATH}`;
}

// The post-login target is kept in localStorage instead of the callback query string, so the
// Redirect URL allow-list entry can be the exact `/auth/callback` URL (a query string would need a
// wildcard entry). A magic link opened in another browser simply lands on /today.
const REDIRECT_KEY = "second-brain-auth-redirect";

export function rememberAuthRedirect(target: string | undefined): void {
  try {
    if (target && safeRedirect(target)) localStorage.setItem(REDIRECT_KEY, target);
    else localStorage.removeItem(REDIRECT_KEY);
  } catch {
    // Storage blocked (private mode): the sign-in still works and lands on /today.
  }
}

/** Reads and forgets the remembered target (validated again: storage is user-controlled). */
export function takeAuthRedirect(): string | undefined {
  try {
    const value = localStorage.getItem(REDIRECT_KEY);
    localStorage.removeItem(REDIRECT_KEY);
    return safeRedirect(value);
  } catch {
    return undefined;
  }
}

type AuthErrorLike = { status?: number | undefined; code?: string | undefined };

/** Rate limits are the only email-link errors shown: they say nothing about whether an account exists. */
export function isRateLimited(error: AuthErrorLike): boolean {
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  );
}

/**
 * Friendly message for an error Supabase reported to /auth/callback (`error`, `error_code`,
 * `error_description` in the query or hash). A Google account without an app account comes back
 * as `signup_disabled` ("Signups not allowed for this instance") when sign-ups are off.
 */
export function authCallbackErrorKey(error: { code: string; description: string }): MessageKey {
  const code = error.code.toLowerCase();
  const description = error.description.toLowerCase();
  if (
    code === "signup_disabled" ||
    code === "user_not_found" ||
    code === "otp_disabled" ||
    /signups? not allowed|user not found/.test(description)
  ) {
    return "authCallbackNotRegistered";
  }
  if (
    code === "otp_expired" ||
    code === "flow_state_expired" ||
    /expired|invalid/.test(description)
  )
    return "authCallbackExpired";
  if (code === "access_denied" && !description) return "authCallbackCancelled";
  if (/cancel|denied the request/.test(description)) return "authCallbackCancelled";
  if (
    code === "provider_disabled" ||
    /provider is not enabled|unsupported provider/.test(description)
  )
    return "authCallbackProviderOff";
  return "authCallbackFailed";
}
