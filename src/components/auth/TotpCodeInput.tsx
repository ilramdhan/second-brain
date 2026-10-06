import { usePreferences } from "@/lib/preferences";

/**
 * One-time-code field for a 6-digit TOTP code: numeric keypad on phones, one-time-code autofill
 * (iOS/Android, password managers), and an error linked through aria-describedby.
 */
export function TotpCodeInput({
  id,
  value,
  onChange,
  error,
  autoFocus = false,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const { t } = usePreferences();
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {t("mfaCodeLabel")}
      </label>
      <input
        id={id}
        name="otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 \-]*"
        maxLength={9}
        required
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.4em] outline-none focus:ring-2 focus:ring-ring"
        placeholder="000000"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
