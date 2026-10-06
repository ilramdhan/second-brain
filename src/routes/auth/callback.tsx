import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Brain } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity";
import { authCallbackErrorKey, takeAuthRedirect } from "@/lib/auth-methods";
import { APP_HOME, LOGIN_PATH, safeRedirect } from "@/lib/auth";
import { needsMfaChallenge, sessionAssurance } from "@/lib/mfa";
import { parseAuthLinkParams } from "@/lib/password";
import { usePreferences, type MessageKey } from "@/lib/preferences";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [
      { title: "Masuk — Second Brain" },
      // A one-time landing page for OAuth and magic-link redirects: never indexed.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AuthCallbackPage,
});

export type CallbackResult =
  | { kind: "error"; key: MessageKey }
  /** Signed in; `mfa` is true when the TOTP step on /login must still run. */
  | { kind: "signed-in"; target: string; mfa: boolean };

/**
 * Finishes a Google (Supabase OAuth) or magic-link sign-in. Supabase redirects here with
 *   - an error (`?error=…&error_code=…` or the same in the hash), e.g. `signup_disabled` when a
 *     Google account has no app account and sign-ups are closed;
 *   - a PKCE `?code=`, exchanged here (`exchangeCodeForSession`) unless supabase-js already did
 *     it during client init (detectSessionInUrl);
 *   - implicit tokens in the hash, which supabase-js stores by itself on init.
 * `href` must be captured before the Supabase client is first used, because it clears the URL.
 */
export async function resolveCallback(href: string): Promise<CallbackResult> {
  const link = parseAuthLinkParams(href);
  if (link.error) return { kind: "error", key: authCallbackErrorKey(link.error) };
  if (link.code) {
    const { data: existing } = await supabase.auth.getSession();
    if (!existing.session) {
      const { error } = await supabase.auth.exchangeCodeForSession(link.code);
      if (error) {
        return {
          kind: "error",
          key: authCallbackErrorKey({ code: error.code ?? "", description: error.message }),
        };
      }
    }
  }
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session) return { kind: "error", key: "authCallbackExpired" };
  // A rejected implicit link leaves any older stored session in place: never use that one.
  if (link.hasTokens && link.tokenSubject && link.tokenSubject !== session.user.id) {
    return { kind: "error", key: "authCallbackExpired" };
  }
  const mfa = needsMfaChallenge(await sessionAssurance());
  // The target was remembered by /login before leaving for Google or the email.
  const target = takeAuthRedirect() ?? APP_HOME;
  return { kind: "signed-in", target, mfa };
}

function AuthCallbackPage() {
  const { t } = usePreferences();
  const navigate = useNavigate();
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  useEffect(() => {
    let active = true;
    const href = window.location.href;
    resolveCallback(href)
      .catch((): CallbackResult => ({ kind: "error", key: "authCallbackFailed" }))
      .then(async (result) => {
        if (!active) return;
        // Remove `?code=` / `#…` from the address bar and history.
        window.history.replaceState(window.history.state, "", window.location.pathname);
        if (result.kind === "error") {
          setErrorKey(result.key);
          return;
        }
        if (result.mfa) {
          // /login shows the TOTP step for a signed-in aal1 session, then continues to `target`.
          await navigate({
            to: LOGIN_PATH,
            search: { redirect: safeRedirect(result.target) },
            replace: true,
          });
          return;
        }
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) void logActivity("signed_in", "auth", session.user.id, {}, "auth");
        await navigate({ href: result.target, replace: true });
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Link
            to="/"
            aria-label={t("loginLogoLabel")}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            <Brain className="h-6 w-6" aria-hidden />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {errorKey ? t("authCallbackErrorTitle") : t("authCallbackTitle")}
          </h1>
        </div>
        <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          {errorKey ? (
            <>
              <p role="alert" className="text-sm text-foreground">
                {t(errorKey)}
              </p>
              <Link
                to={LOGIN_PATH}
                className="block w-full rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {t("setPwGoLogin")}
              </Link>
            </>
          ) : (
            <p role="status" className="text-center text-sm text-muted-foreground">
              {t("authCallbackChecking")}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
