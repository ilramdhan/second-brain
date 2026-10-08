import { useEffect, useId, useState } from "react";
import type { Factor } from "@supabase/supabase-js";
import { toast } from "sonner";

import { TotpCodeInput } from "@/components/auth/TotpCodeInput";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/errors";
import { normalizeTotpCode, totpErrorKey, verifiedTotpFactors, verifyTotp } from "@/lib/mfa";
import { redeemRecoveryCode } from "@/lib/mfa.functions";
import { usePreferences } from "@/lib/preferences";

/**
 * TOTP step of the sign-in: shown on /login when the session is `aal1` but the user has a
 * verified factor (`nextLevel === "aal2"`). On success the session is `aal2` and `onVerified`
 * continues into the app; "Batal" signs the half-finished session out.
 */
export function MfaChallenge({ onVerified }: { onVerified: () => Promise<void> | void }) {
  const { t } = usePreferences();
  const id = useId();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [recovery, setRecovery] = useState("");

  useEffect(() => {
    let active = true;
    verifiedTotpFactors()
      .then((list) => {
        if (!active) return;
        setFactors(list);
        setFactorId(list[0]?.id ?? "");
      })
      .catch((err: unknown) => {
        if (active) setFactors([]);
        toastError(err);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = normalizeTotpCode(code);
    if (!value) {
      setError(t("mfaCodeFormat"));
      return;
    }
    if (!factorId) return;
    setLoading(true);
    setError(null);
    try {
      await verifyTotp(factorId, value);
      await onVerified();
    } catch (err) {
      const key = totpErrorKey(err);
      if (key) setError(t(key));
      else toastError(err);
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function submitRecovery(e: React.FormEvent) {
    e.preventDefault();
    const value = recovery.replace(/[\s-]/g, "");
    if (value.length !== 8) {
      setError(t("mfaRecoveryFormat"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await redeemRecoveryCode({ data: { code: recovery } });
      if (!result.ok) {
        setError(t(result.reason === "rate_limited" ? "mfaTooMany" : "mfaRecoveryInvalid"));
        setRecovery("");
        return;
      }
      // The factors are gone: refresh so the session no longer asks for aal2, then continue.
      // Deleting a verified factor may also revoke the user's sessions (GoTrue); then this
      // browser signs out locally and the visitor signs in again, now without a TOTP step.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        toast.success(t("mfaRecoveryDoneSignIn"), { duration: 10_000 });
        await supabase.auth.signOut({ scope: "local" });
        return;
      }
      toast.success(t("mfaRecoveryDone"), { duration: 10_000 });
      await onVerified();
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: boolean) {
    setUseRecovery(next);
    setError(null);
    setCode("");
    setRecovery("");
  }

  async function cancel() {
    // Local scope: only this half-signed-in browser session is dropped.
    await supabase.auth.signOut({ scope: "local" });
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-3 rounded-2xl border bg-card p-6 shadow-sm"
    >
      <h2 id={`${id}-title`} className="text-base font-semibold">
        {t("mfaTitle")}
      </h2>
      {useRecovery ? (
        <>
          <p className="text-sm text-muted-foreground">{t("mfaRecoveryIntro")}</p>
          <form onSubmit={submitRecovery} noValidate className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor={`${id}-recovery`}>
                {t("mfaRecoveryLabel")}
              </label>
              <input
                id={`${id}-recovery`}
                name="recovery-code"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={32}
                required
                autoFocus
                disabled={loading}
                value={recovery}
                onChange={(e) => {
                  setRecovery(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-recovery-error` : undefined}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-center font-mono text-lg tracking-widest uppercase outline-none focus:ring-2 focus:ring-ring"
                placeholder="XXXX-XXXX"
              />
              {error ? (
                <p id={`${id}-recovery-error`} role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? t("authSending") : t("mfaRecoverySubmit")}
            </Button>
          </form>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("mfaIntro")}</p>
          <form onSubmit={submit} noValidate className="space-y-3">
            {factors && factors.length > 1 ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor={`${id}-factor`}>
                  {t("mfaFactorLabel")}
                </label>
                <select
                  id={`${id}-factor`}
                  value={factorId}
                  onChange={(e) => setFactorId(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  {factors.map((f, i) => (
                    <option key={f.id} value={f.id}>
                      {f.friendly_name || `${t("mfaFactorLabel")} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <TotpCodeInput
              id={`${id}-code`}
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
              error={error}
              autoFocus
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !factorId} size="lg" className="w-full">
              {loading ? t("authSending") : t("mfaVerify")}
            </Button>
          </form>
        </>
      )}
      <Button
        type="button"
        variant="link"
        className="w-full"
        onClick={() => switchMode(!useRecovery)}
        disabled={loading}
      >
        {useRecovery ? t("mfaUseTotp") : t("mfaUseRecovery")}
      </Button>
      <Button
        type="button"
        variant="tertiary"
        className="w-full text-muted-foreground"
        onClick={() => void cancel()}
      >
        {t("mfaCancel")}
      </Button>
    </section>
  );
}
