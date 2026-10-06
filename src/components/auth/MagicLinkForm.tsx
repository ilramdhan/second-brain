import { useId, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { authCallbackUrl, isRateLimited, rememberAuthRedirect } from "@/lib/auth-methods";
import { toastError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/password";
import { usePreferences } from "@/lib/preferences";

/**
 * Emails a one-time sign-in link to /auth/callback. `shouldCreateUser: false` keeps public
 * sign-up closed: an unknown address gets no account (Supabase answers `otp_disabled` /
 * "Signups not allowed for otp"). Whatever the outcome, the visitor sees the same generic
 * message, so the form cannot be used to find out which addresses have an account.
 */
export function MagicLinkForm({
  initialEmail = "",
  redirect,
}: {
  initialEmail?: string;
  redirect?: string | undefined;
}) {
  const { t } = usePreferences();
  const id = useId();
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [invalid, setInvalid] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = normalizeEmail(email);
    setInvalid(!value);
    if (!value) return;
    setLoading(true);
    try {
      rememberAuthRedirect(redirect);
      const { error } = await supabase.auth.signInWithOtp({
        email: value,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: authCallbackUrl(window.location.origin),
        },
      });
      if (error && isRateLimited(error)) {
        toastError(error);
        return;
      }
      if (error) console.warn("signInWithOtp failed:", error.code ?? error.status);
      setSent(true);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">
        {t("authMagicSent")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`${id}-email`}>
          {t("authEmailLabel")}
        </label>
        <input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="anda@email.com"
        />
        {invalid ? (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {t("authEmailInvalid")}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? t("authSending") : t("authMagicSubmit")}
      </button>
    </form>
  );
}
