import { useCallback, useEffect, useId, useState } from "react";
import type { Factor } from "@supabase/supabase-js";
import { ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { TotpCodeInput } from "@/components/auth/TotpCodeInput";
import { RecoveryCodes } from "@/components/settings/RecoveryCodes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { isDemo } from "@/lib/app-mode";
import { toastError } from "@/lib/errors";
import { normalizeTotpCode, totpErrorKey, verifyTotp } from "@/lib/mfa";
import { usePreferences } from "@/lib/preferences";

type Enrollment = { factorId: string; qrCode: string; secret: string };

type PanelState =
  | { step: "loading" }
  | { step: "error" }
  | { step: "ready"; factors: Factor[] }
  | { step: "enrolling"; factors: Factor[]; enrollment: Enrollment };

/** Friendly name for a new factor: unique per user (Supabase rejects duplicates). */
function newFactorName(existing: Factor[]): string {
  const base = "Authenticator";
  const names = new Set(existing.map((f) => f.friendly_name));
  let n = existing.length + 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Settings → Keamanan: TOTP two-factor authentication with Supabase MFA. Enrollment shows the QR
 * code (an SVG data URL from Supabase) and the secret for manual entry, and only counts once a
 * code is verified. Removing a factor asks for a current code first, so a stolen unlocked session
 * cannot quietly turn 2FA off. Not available in the demo (the account is shared; the database
 * refuses enrollment for it as well, migration 0022).
 */
export function SecurityPanel() {
  const { t, intl } = usePreferences();
  const demo = isDemo();
  const [state, setState] = useState<PanelState>({ step: "loading" });
  const [removing, setRemoving] = useState<Factor | null>(null);
  // Set when 2FA was just turned on: the first batch of recovery codes is created right away.
  const [freshlyEnabled, setFreshlyEnabled] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setState({ step: "error" });
      return [];
    }
    // Abandoned enrollments (QR shown, never verified) are cleaned up so they do not pile up.
    const all = data.all ?? [];
    for (const f of all) {
      if (f.factor_type === "totp" && f.status === "unverified") {
        void supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const factors = (data.totp ?? []).filter((f) => f.status === "verified");
    setState({ step: "ready", factors });
    return factors;
  }, []);

  useEffect(() => {
    if (demo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the Supabase request resolves.
    void load();
  }, [demo, load]);

  async function startEnroll(factors: Factor[]) {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: newFactorName(factors),
    });
    if (error) {
      toastError(error);
      return;
    }
    setState({
      step: "enrolling",
      factors,
      enrollment: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret },
    });
  }

  async function cancelEnroll(enrollment: Enrollment, factors: Factor[]) {
    setState({ step: "ready", factors });
    await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
  }

  const factors = state.step === "ready" || state.step === "enrolling" ? state.factors : [];
  const on = factors.length > 0;

  return (
    <section aria-labelledby="security-title" className="mb-4 rounded-2xl border bg-card p-5">
      <h2 id="security-title" className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> {t("securityTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("securityIntro")}</p>

      {demo ? (
        <p role="status" className="mt-4 rounded-lg bg-secondary px-3 py-2 text-sm">
          {t("mfaDemo")}
        </p>
      ) : state.step === "loading" ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {t("mfaLoading")}
        </p>
      ) : state.step === "error" ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {t("mfaLoadError")}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <p role="status" className="text-sm font-medium">
            {on ? t("mfaStatusOn") : t("mfaStatusOff")}
          </p>
          {on ? (
            <ul aria-label={t("mfaFactorsLabel")} className="divide-y rounded-xl border">
              {factors.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{f.friendly_name || "TOTP"}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("mfaAddedOn")} {new Date(f.created_at).toLocaleDateString(intl)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoving(f)}
                    className="text-destructive hover:text-destructive"
                    aria-label={`${t("mfaRemove")}: ${f.friendly_name || "TOTP"}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("mfaRemove")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {state.step === "enrolling" ? (
            <EnrollForm
              enrollment={state.enrollment}
              onCancel={() => void cancelEnroll(state.enrollment, state.factors)}
              onDone={async () => {
                toast.success(t("mfaEnrolled"));
                if (!on) setFreshlyEnabled(true);
                await load();
              }}
            />
          ) : (
            <Button onClick={() => void startEnroll(factors)} variant={on ? "outline" : "default"}>
              {on ? t("mfaAddAnother") : t("mfaEnable")}
            </Button>
          )}
          {on ? <RecoveryCodes autoGenerate={freshlyEnabled} /> : null}
        </div>
      )}

      <RemoveFactorDialog
        factor={removing}
        onClose={() => setRemoving(null)}
        onRemoved={async () => {
          setRemoving(null);
          toast.success(t("mfaRemoved"));
          await load();
        }}
      />
    </section>
  );
}

function EnrollForm({
  enrollment,
  onCancel,
  onDone,
}: {
  enrollment: Enrollment;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = usePreferences();
  const id = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = normalizeTotpCode(code);
    if (!value) {
      setError(t("mfaCodeFormat"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Verifying the first code activates the factor and upgrades this session to aal2.
      await verifyTotp(enrollment.factorId, value);
      await onDone();
    } catch (err) {
      const key = totpErrorKey(err);
      if (key) setError(t(key));
      else toastError(err);
    } finally {
      setLoading(false);
    }
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      toast.success(t("mfaCopied"));
    } catch {
      // Clipboard blocked: the key stays visible and selectable.
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t("mfaEnable")}
      className="space-y-3 rounded-xl border p-4"
    >
      <p className="text-sm">{t("mfaScan")}</p>
      <img
        src={enrollment.qrCode}
        alt={t("mfaQrAlt")}
        width={176}
        height={176}
        className="mx-auto h-44 w-44 rounded-lg bg-white p-2"
      />
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground" id={`${id}-secret-label`}>
          {t("mfaSecretLabel")}
        </p>
        <div className="flex items-center gap-2">
          <code
            aria-labelledby={`${id}-secret-label`}
            className="min-w-0 flex-1 rounded-md bg-secondary px-2 py-1.5 font-mono text-xs break-all select-all"
          >
            {enrollment.secret}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={() => void copySecret()}>
            {t("mfaCopySecret")}
          </Button>
        </div>
      </div>
      <TotpCodeInput
        id={`${id}-code`}
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        error={error}
        disabled={loading}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? t("authSending") : t("mfaConfirm")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
          {t("mfaCancelEnroll")}
        </Button>
      </div>
    </form>
  );
}

function RemoveFactorDialog({
  factor,
  onClose,
  onRemoved,
}: {
  factor: Factor | null;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) {
  const { t } = usePreferences();
  const id = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factor) return;
    const value = normalizeTotpCode(code);
    if (!value) {
      setError(t("mfaCodeFormat"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Re-verify first: proves the authenticator is at hand and keeps the session at aal2,
      // which Supabase requires to unenroll a verified factor.
      await verifyTotp(factor.id, value);
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (unenrollError) throw unenrollError;
      // Refresh so the access token no longer lists the removed factor.
      await supabase.auth.refreshSession();
      setCode("");
      await onRemoved();
    } catch (err) {
      const key = totpErrorKey(err);
      if (key) setError(t(key));
      else toastError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={factor !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCode("");
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("mfaRemoveTitle")}</DialogTitle>
          <DialogDescription>{t("mfaRemoveIntro")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-3">
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
          <Button type="submit" variant="destructive" disabled={loading} className="w-full">
            {loading ? t("authSending") : t("mfaRemoveConfirm")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
