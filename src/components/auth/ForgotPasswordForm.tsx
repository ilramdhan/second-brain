import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/errors";
import { normalizeEmail, SET_PASSWORD_PATH } from "@/lib/password";
import { usePreferences } from "@/lib/preferences";

/** Rate limits are the only reset errors shown: they say nothing about whether the email exists. */
function isRateLimited(error: { status?: number | undefined; code?: string | undefined }) {
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  );
}

/**
 * Asks Supabase Auth to email a password link to /auth/set-password. The answer is the same
 * generic message whether or not the address has an account (no email enumeration). Also used by
 * /auth/set-password to request a fresh link after an expired invite or reset link: a recovery
 * link confirms an invited account as well.
 */
export function ForgotPasswordForm({
  initialEmail = "",
  submitLabel,
}: {
  initialEmail?: string;
  submitLabel?: string;
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
      const { error } = await supabase.auth.resetPasswordForEmail(value, {
        redirectTo: `${window.location.origin}${SET_PASSWORD_PATH}`,
      });
      if (error && isRateLimited(error)) {
        toastError(error);
        return;
      }
      // Any other outcome (unknown address included) gets the same generic message.
      if (error) console.warn("resetPasswordForEmail failed:", error.code ?? error.status);
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
        {t("authForgotSent")}
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
      <Button type="submit" disabled={loading} size="lg" className="w-full">
        {loading ? t("authSending") : (submitLabel ?? t("authForgotSubmit"))}
      </Button>
    </form>
  );
}
