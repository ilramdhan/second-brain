import { useEffect, useId, useState } from "react";
import type { Factor } from "@supabase/supabase-js";

import { TotpCodeInput } from "@/components/auth/TotpCodeInput";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/errors";
import { normalizeTotpCode, totpErrorKey, verifiedTotpFactors, verifyTotp } from "@/lib/mfa";
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
        <button
          type="submit"
          disabled={loading || !factorId}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? t("authSending") : t("mfaVerify")}
        </button>
      </form>
      <button
        type="button"
        onClick={() => void cancel()}
        className="w-full rounded-sm text-center text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {t("mfaCancel")}
      </button>
    </section>
  );
}
