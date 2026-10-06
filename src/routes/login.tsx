import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Brain } from "lucide-react";
import { toast } from "sonner";

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activity";
import { demoCredentials, isDemo } from "@/lib/app-mode";
import { APP_HOME, safeRedirect } from "@/lib/auth";
import {
  publicPageHead,
  redirectSignedInVisitor,
  signupAllowed,
  useRedirectSignedInVisitor,
} from "@/lib/landing";
import { toastError } from "@/lib/errors";
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
  head: () =>
    publicPageHead({
      title: "Masuk — Second Brain",
      description: "Masuk ke Second Brain, asisten catatan dan tugas pribadi Anda.",
      path: "/login",
    }),
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
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  function fillDemo() {
    setMode("login");
    setEmail(demoAccount.email);
    setPassword(demoAccount.password);
  }

  async function signIn(credentials: { email: string; password: string }) {
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (error) throw error;
    void logActivity("signed_in", "auth", data.user.id, {}, "auth");
    if (redirect) await navigate({ href: redirect, replace: true });
    else await navigate({ to: APP_HOME, replace: true });
  }

  async function signInAsDemo() {
    fillDemo();
    setLoading(true);
    try {
      await signIn(demoAccount);
    } catch (err) {
      toastError(err, "Gagal masuk");
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
        toast.success("Akun dibuat! Cek email Anda untuk konfirmasi, lalu masuk.");
        setMode("login");
      }
    } catch (err) {
      toastError(err, "Gagal masuk");
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
        variant="ghost"
        size="sm"
        className="absolute top-4 left-4 h-11 px-3 text-muted-foreground hover:text-foreground sm:top-6 sm:left-6"
      >
        <Link to="/" aria-label={t("loginBackHomeLabel")}>
          <ArrowLeft aria-hidden />
          {t("loginBackHome")}
        </Link>
      </Button>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Link
            to="/"
            aria-label={t("loginLogoLabel")}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            <Brain className="h-6 w-6" aria-hidden />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Second Brain</h1>
          <p className="text-sm text-muted-foreground">
            Buang semua pikiran ke sini. Biar AI yang merapikan.
          </p>
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
              <button
                type="button"
                onClick={fillDemo}
                disabled={loading}
                className="rounded-lg border border-current/30 bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
              >
                {t("demoAutofill")}
              </button>
              <button
                type="button"
                onClick={() => void signInAsDemo()}
                disabled={loading}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
              >
                {t("demoSignIn")}
              </button>
            </div>
          </section>
        ) : null}

        {/* Password reset: emails a link to /auth/set-password. Off in the demo (shared account). */}
        {mode === "forgot" && !demo ? (
          <section
            aria-labelledby="forgot-title"
            className="space-y-3 rounded-2xl border bg-card p-6 shadow-sm"
          >
            <h2 id="forgot-title" className="text-base font-semibold">
              {t("authForgotTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("authForgotIntro")}</p>
            <ForgotPasswordForm initialEmail={email} />
            <button
              type="button"
              onClick={() => setMode("login")}
              className="w-full rounded-sm text-center text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t("authForgotBack")}
            </button>
          </section>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-2xl border bg-card p-6 shadow-sm"
          >
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="anda@email.com"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium" htmlFor="password">
                  Kata sandi
                </label>
                {mode === "login" && !demo ? (
                  <button
                    type="button"
                    onClick={() => setMode("forgot")}
                    className="rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {t("authForgotLink")}
                  </button>
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
                placeholder="Minimal 6 karakter"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
            </button>
            {allowSignup ? (
              <button
                type="button"
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
                className="w-full rounded-sm text-center text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
              </button>
            ) : demo ? null : (
              <p className="text-center text-xs text-muted-foreground">
                Pendaftaran ditutup. Akun dibuat oleh pemilik instance; minta undangan untuk
                bergabung.
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
