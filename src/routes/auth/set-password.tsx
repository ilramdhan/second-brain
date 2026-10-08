import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { Brain, Check, Circle } from "lucide-react";
import { toast } from "sonner";

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { supabase } from "@/integrations/supabase/client";
import { isDemo } from "@/lib/app-mode";
import { APP_HOME, LOGIN_PATH } from "@/lib/auth";
import { toastError } from "@/lib/errors";
import {
  invitedProjectPath,
  MAX_PASSWORD_LENGTH,
  parseAuthLinkParams,
  passwordStrength,
  type AuthLinkKind,
  type PasswordCheck,
} from "@/lib/password";
import { headT, pageTitle } from "@/lib/page-head";
import { usePreferences, type MessageKey } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth/set-password")({
  head: (ctx) => ({
    meta: [
      { title: pageTitle(headT(ctx)("metaSetPasswordTitle")) },
      { name: "description", content: headT(ctx)("metaSetPasswordDesc") },
      // A one-time landing page for email links: never indexed, never shared.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SetPasswordPage,
});

type State =
  | { step: "checking" }
  | { step: "demo" }
  | { step: "invalid" }
  | { step: "ready"; kind: AuthLinkKind; email: string; projectPath: string | null };

/**
 * Resolves the session an email link carries. supabase-js reads implicit links
 * (`#access_token=…&type=invite|recovery`) by itself when the client initializes and clears the
 * hash, so the URL is parsed first. PKCE `?code=` links are exchanged here. (`?token_hash=` links
 * from custom templates are not supported: the templates must use `{{ .ConfirmationURL }}`.)
 */
async function resolveLink(href: string): Promise<State> {
  const link = parseAuthLinkParams(href);
  // Only a real email link unlocks the form: opening the page directly (or with a link that
  // failed) must not let whoever holds a stored session change its password.
  if (link.error || !(link.hasTokens || link.code)) return { step: "invalid" };
  if (link.code) {
    // Supabase may already have exchanged a PKCE code during init; a second exchange then fails.
    const { data: existing } = await supabase.auth.getSession();
    if (!existing.session) {
      const result = await supabase.auth.exchangeCodeForSession(link.code);
      if (result.error) return { step: "invalid" };
    }
    const url = new URL(href);
    for (const key of ["code", "type"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }
  const { data, error } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (error || !user?.email) return { step: "invalid" };
  // A rejected implicit link leaves any older stored session in place: never use that one.
  if (link.hasTokens && link.tokenSubject !== user.id) return { step: "invalid" };
  return {
    step: "ready",
    kind: link.kind,
    email: user.email,
    projectPath: invitedProjectPath(user.user_metadata),
  };
}

function SetPasswordPage() {
  const { t } = usePreferences();
  // The demo account is shared: nobody may set its password (the database refuses as well).
  const demo = isDemo();
  const [state, setState] = useState<State>(demo ? { step: "demo" } : { step: "checking" });

  useEffect(() => {
    if (demo) return;
    let active = true;
    // Captured before the Supabase client is first touched, which strips the hash.
    const href = window.location.href;
    resolveLink(href)
      .catch(() => ({ step: "invalid" }) as const)
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, [demo]);

  const title =
    state.step === "invalid"
      ? t("setPwInvalidTitle")
      : state.step === "ready" && state.kind === "invite"
        ? t("setPwTitleInvite")
        : t("setPwTitleRecovery");

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
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          {state.step === "checking" ? (
            <p role="status" className="text-center text-sm text-muted-foreground">
              {t("setPwChecking")}
            </p>
          ) : state.step === "demo" ? (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                {t("setPwDemo")}
              </p>
              <LoginLink />
            </>
          ) : state.step === "invalid" ? (
            <>
              <p role="alert" className="text-sm text-muted-foreground">
                {t("setPwInvalidBody")}
              </p>
              <ForgotPasswordForm submitLabel={t("setPwRequestNew")} />
              <LoginLink />
            </>
          ) : (
            <PasswordForm state={state} />
          )}
        </div>
      </div>
    </main>
  );
}

function LoginLink() {
  const { t } = usePreferences();
  return (
    <Link
      to={LOGIN_PATH}
      className="block rounded-sm text-center text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {t("setPwGoLogin")}
    </Link>
  );
}

const HINTS: [PasswordCheck, MessageKey][] = [
  ["length", "setPwHintLength"],
  ["letters", "setPwHintLetters"],
  ["numbers", "setPwHintNumbers"],
  ["symbols", "setPwHintSymbols"],
];
const STRENGTH_KEYS: MessageKey[] = [
  "setPwStrength1",
  "setPwStrength1",
  "setPwStrength2",
  "setPwStrength3",
  "setPwStrength4",
];
const STRENGTH_COLORS = ["bg-muted", "bg-red-500", "bg-amber-500", "bg-lime-600", "bg-emerald-600"];

/** Supabase `updateUser` errors with a message written for people. */
function passwordErrorKey(error: { code?: string | undefined }): MessageKey | undefined {
  if (error.code === "same_password") return "setPwSamePassword";
  if (error.code === "weak_password") return "setPwWeakServer";
  return undefined;
}

function PasswordForm({ state }: { state: Extract<State, { step: "ready" }> }) {
  const { t } = usePreferences();
  const navigate = useNavigate();
  const id = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const strength = passwordStrength(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = touched && !strength.acceptable;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!strength.acceptable || password !== confirm) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        const key = passwordErrorKey(error);
        if (key) toast.error(t(key));
        else toastError(error);
        return;
      }
      // Turn pending project invites into memberships now, so the project opens right away.
      const { data: accepted, error: acceptError } = await supabase.rpc("accept_project_invites");
      if (acceptError) console.error("Accepting project invites failed", acceptError.message);
      toast.success(t("setPwSaved"));
      const target = (accepted ?? 0) > 0 && state.projectPath ? state.projectPath : APP_HOME;
      await navigate({ href: target, replace: true });
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {state.kind === "invite" ? t("setPwIntroInvite") : t("setPwIntroRecovery")}{" "}
        <span className="font-medium break-all text-foreground">{state.email}</span>
      </p>
      {/* Lets password managers save the new password under the right account. */}
      <input type="email" autoComplete="username" value={state.email} readOnly hidden aria-hidden />
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`${id}-new`}>
          {t("setPwNew")}
        </label>
        <input
          id={`${id}-new`}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          required
          maxLength={MAX_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => password && setTouched(true)}
          aria-invalid={tooShort || undefined}
          aria-describedby={`${id}-hints${tooShort ? ` ${id}-short` : ""}`}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {tooShort ? (
          <p id={`${id}-short`} className="text-xs text-destructive">
            {t("setPwTooShort")}
          </p>
        ) : null}
      </div>
      <div id={`${id}-hints`} className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((n) => (
              <span
                key={n}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  strength.score >= n ? STRENGTH_COLORS[strength.score] : "bg-muted",
                )}
              />
            ))}
          </div>
          <span className="min-w-12 text-right text-xs text-muted-foreground" aria-live="polite">
            {password ? `${t("setPwStrength")}: ${t(STRENGTH_KEYS[strength.score]!)}` : ""}
          </span>
        </div>
        <ul aria-label={t("setPwHintsLabel")} className="grid grid-cols-2 gap-x-3 gap-y-1">
          {HINTS.map(([check, key]) => (
            <li
              key={check}
              className={cn(
                "flex items-center gap-1.5 text-xs",
                strength.checks[check] ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {strength.checks[check] ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              ) : (
                <Circle className="h-3 w-3" aria-hidden />
              )}
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`${id}-confirm`}>
          {t("setPwConfirm")}
        </label>
        <input
          id={`${id}-confirm`}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          required
          maxLength={MAX_PASSWORD_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? `${id}-mismatch` : undefined}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {mismatch ? (
          <p id={`${id}-mismatch`} className="text-xs text-destructive">
            {t("setPwMismatch")}
          </p>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        {t("setPwShow")}
      </label>
      <Button
        className="w-full"
        type="submit"
        disabled={loading || !strength.acceptable || password !== confirm}
      >
        {loading ? t("authSending") : t("setPwSubmit")}
      </Button>
    </form>
  );
}
