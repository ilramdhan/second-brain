import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Brain, Mail } from "lucide-react";
import { toast } from "sonner";

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { MagicLinkForm } from "@/components/auth/MagicLinkForm";
import { MfaChallenge } from "@/components/auth/MfaChallenge";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity";
import { DemoNotice } from "@/components/demo/DemoBanner";
import { demoCredentials, isDemo } from "@/lib/app-mode";
import { APP_HOME, safeRedirect } from "@/lib/auth";
import {
  authCallbackUrl,
  googleAuthEnabled,
  magicLinkEnabled,
  rememberAuthRedirect,
} from "@/lib/auth-methods";
import {
  publicPageHead,
  redirectSignedInVisitor,
  signupAllowed,
  useRedirectSignedInVisitor,
} from "@/lib/landing";
import { toastError } from "@/lib/errors";
import { needsMfaChallenge, sessionAssurance } from "@/lib/mfa";
import { headLocale, headT, pageTitle } from "@/lib/page-head";
import { usePreferences } from "@/lib/preferences";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  // `redirect` is the page the auth guard bounced the visitor from; only same-origin paths.
  validateSearch: (s: Record<string, unknown>): { redirect?: string | undefined } => ({
    redirect: safeRedirect(s["redirect"]),
  }),
  // A visitor who is already signed in skips the form (client-side navigations; the first SSR
  // load is covered by useRedirectSignedInVisitor after hydration).
  beforeLoad: ({ search }) => redirectSignedInVisitor(search.redirect),
  head: (ctx) => {
    const t = headT(ctx);
    return publicPageHead({
      title: pageTitle(t("metaLoginTitle")),
      description: t("metaLoginDesc"),
      path: "/login",
      locale: headLocale(ctx),
    });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { t } = usePreferences();
  const { redirect } = Route.useSearch();
  useRedirectSignedInVisitor(redirect);
  // The public demo (VITE_APP_MODE=demo) shows its shared account and never offers sign-up.
  const demo = isDemo();
  const demoAccount = demoCredentials();
  // Self-service sign-up is hidden unless VITE_ALLOW_SIGNUP=true (see signupAllowed()).
  const allowSignup = !demo && signupAllowed();
  // Passwordless methods (Phase 9.2): Google behind VITE_AUTH_GOOGLE=true, magic link on unless
  // VITE_AUTH_MAGIC_LINK=false. Both are off in the demo (shared account).
  const google = googleAuthEnabled();
  const magic = magicLinkEnabled();
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "magic" | "mfa">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // A session that still needs its TOTP code (password just entered, back from Google or a magic
  // link via /auth/callback, or a reload mid-way) shows the challenge instead of the form.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        if (active && needsMfaChallenge(await sessionAssurance())) setMode("mfa");
      } catch {
        // No Supabase env or storage blocked: stay on the form.
      }
    })();
    // "Batal dan keluar" on the TOTP step (or a sign-out elsewhere) returns to the form.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && active) setMode("login");
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function enterApp(userId: string | undefined) {
    if (userId) void logActivity("signed_in", "auth", userId, {}, "auth");
    if (redirect) await navigate({ href: redirect, replace: true });
    else await navigate({ to: APP_HOME, replace: true });
  }

  async function finishMfa() {
    const { data } = await supabase.auth.getSession();
    await enterApp(data.session?.user.id);
  }

  async function signInWithGoogle() {
    setLoading(true);
    try {
      rememberAuthRedirect(redirect);
      // Leaves for Google; Supabase returns to /auth/callback with `?code=` or `?error=`. A Google
      // account without an app account is rejected there while sign-ups are closed.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: authCallbackUrl(window.location.origin) },
      });
      if (error) throw error;
    } catch (err) {
      toastError(err, t("authSignInFailed"));
      setLoading(false);
    }
  }

  function fillDemo() {
    setMode("login");
    setEmail(demoAccount.email);
    setPassword(demoAccount.password);
  }

  async function signIn(credentials: { email: string; password: string }) {
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (error) throw error;
    // Users with a verified TOTP factor still need their code (session is aal1 until then).
    if (needsMfaChallenge(await sessionAssurance())) {
      setMode("mfa");
      return;
    }
    await enterApp(data.user.id);
  }

  async function signInAsDemo() {
    fillDemo();
    setLoading(true);
    try {
      await signIn(demoAccount);
    } catch (err) {
      toastError(err, t("authSignInFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        await signIn({ email, password });
      } else if (allowSignup) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success(t("authSignedUp"));
        setMode("login");
      }
    } catch (err) {
      toastError(err, t("authSignInFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4 pt-20 pb-10">
      {/* Back to the landing: first in the tab order, pinned top-left on the page gutter
          (outside the card), 44px tap target. */}
      <Button
        asChild
        variant="tertiary"
        className="absolute top-4 left-4 px-3 text-muted-foreground hover:text-foreground sm:top-6 sm:left-6"
      >
        <Link to="/" aria-label={t("loginBackHomeLabel")}>
          <ArrowLeft aria-hidden />
          {t("loginBackHome")}
        </Link>
      </Button>
      <div className="w-full max-w-sm">
        <DemoNotice active={demo} className="mb-6" />
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Link
            to="/"
            aria-label={t("loginLogoLabel")}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            <Brain className="h-6 w-6" aria-hidden />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Second Brain</h1>
          <p className="text-sm text-muted-foreground">{t("authLoginTagline")}</p>
        </div>

        {demo ? (
          <section
            aria-labelledby="demo-account"
            className="mb-4 space-y-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <p id="demo-account">
              {t("demoLoginHint")}{" "}
              <span className="font-mono font-medium">
                {demoAccount.email} / {demoAccount.password}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={fillDemo}
                disabled={loading}
              >
                {t("demoAutofill")}
              </Button>
              <Button
                size="sm"
                type="button"
                onClick={() => void signInAsDemo()}
                disabled={loading}
              >
                {t("demoSignIn")}
              </Button>
            </div>
          </section>
        ) : null}

        {mode === "mfa" ? (
          <MfaChallenge onVerified={finishMfa} />
        ) : mode === "magic" && magic ? (
          <section
            aria-labelledby="magic-title"
            className="space-y-3 rounded-2xl border bg-card p-6 shadow-sm"
          >
            <h2 id="magic-title" className="text-base font-semibold">
              {t("authMagicTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("authMagicIntro")}</p>
            <MagicLinkForm initialEmail={email} redirect={redirect} />
            <Button
              variant="tertiary"
              className="w-full font-normal text-muted-foreground"
              type="button"
              onClick={() => setMode("login")}
            >
              {t("authUsePassword")}
            </Button>
          </section>
        ) : /* Password reset: emails a link to /auth/set-password. Off in the demo (shared account). */
        mode === "forgot" && !demo ? (
          <section
            aria-labelledby="forgot-title"
            className="space-y-3 rounded-2xl border bg-card p-6 shadow-sm"
          >
            <h2 id="forgot-title" className="text-base font-semibold">
              {t("authForgotTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("authForgotIntro")}</p>
            <ForgotPasswordForm initialEmail={email} />
            <Button
              variant="tertiary"
              className="w-full font-normal text-muted-foreground"
              type="button"
              onClick={() => setMode("login")}
            >
              {t("authForgotBack")}
            </Button>
          </section>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-2xl border bg-card p-6 shadow-sm"
          >
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="email">
                {t("authEmailLabel")}
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder={t("authEmailPlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium" htmlFor="password">
                  {t("authPasswordLabel")}
                </label>
                {mode === "login" && !demo ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="px-0 font-normal text-muted-foreground hover:text-foreground"
                    type="button"
                    onClick={() => setMode("forgot")}
                  >
                    {t("authForgotLink")}
                  </Button>
                ) : null}
              </div>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder={t("authPasswordPlaceholder")}
              />
            </div>
            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? t("authProcessing") : mode === "login" ? t("authSignIn") : t("authSignUp")}
            </Button>
            {mode === "login" && (google || magic) ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
                  <span className="h-px flex-1 bg-border" />
                  {t("authOr")}
                  <span className="h-px flex-1 bg-border" />
                </div>
                {google ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    type="button"
                    onClick={() => void signInWithGoogle()}
                    disabled={loading}
                  >
                    <GoogleIcon />
                    {t("authGoogle")}
                  </Button>
                ) : null}
                {magic ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    type="button"
                    onClick={() => setMode("magic")}
                    disabled={loading}
                  >
                    <Mail aria-hidden />
                    {t("authMagicLink")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {allowSignup ? (
              <Button
                variant="tertiary"
                className="w-full font-normal text-muted-foreground"
                type="button"
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
              >
                {mode === "login" ? t("authToSignUp") : t("authToSignIn")}
              </Button>
            ) : demo ? null : (
              <p className="text-center text-xs text-muted-foreground">{t("authSignupClosed")}</p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}

/** Google "G" mark (brand colours, decorative: the button text names the provider). */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.5 5.5 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.65Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.6 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75Z"
      />
    </svg>
  );
}
