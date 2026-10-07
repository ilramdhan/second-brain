import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/errors";
import { generateRecoveryCodes, recoveryCodesStatus } from "@/lib/mfa.functions";
import { usePreferences } from "@/lib/preferences";

/**
 * Settings → Keamanan, shown while TOTP is on: number of unused recovery codes and a button to
 * create a new batch. The codes are shown exactly once (copy / download as .txt); the server only
 * keeps their hashes (migration 0027). `autoGenerate` creates the first batch right after 2FA was
 * turned on.
 */
export function RecoveryCodes({ autoGenerate = false }: { autoGenerate?: boolean }) {
  const { t } = usePreferences();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const result = await generateRecoveryCodes();
      setCodes(result.codes);
      setRemaining(result.codes.length);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (autoGenerate) {
      void generate();
      return;
    }
    recoveryCodesStatus()
      .then((status) => setRemaining(status.remaining))
      .catch(() => setRemaining(null));
  }, [autoGenerate, generate]);

  function confirmRegenerate() {
    if (remaining && !window.confirm(t("mfaCodesRegenerateConfirm"))) return;
    void generate();
  }

  const text = codes ? `${t("mfaCodesFileHeader")}\n\n${codes.join("\n")}\n` : "";

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("mfaCopied"));
    } catch {
      // Clipboard blocked: the codes stay visible and selectable.
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "second-brain-recovery-codes.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="recovery-codes-title" className="space-y-3 rounded-xl border p-4">
      <h3 id="recovery-codes-title" className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4 text-primary" aria-hidden /> {t("mfaCodesTitle")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("mfaCodesIntro")}</p>
      {codes ? (
        <div className="space-y-3">
          <p role="alert" className="rounded-lg bg-secondary px-3 py-2 text-sm font-medium">
            {t("mfaCodesShowOnce")}
          </p>
          <ul
            aria-label={t("mfaCodesTitle")}
            className="grid grid-cols-2 gap-2 font-mono text-sm select-all"
          >
            {codes.map((code) => (
              <li key={code} className="rounded-md bg-secondary px-2 py-1.5 text-center">
                {code}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyAll()}>
              {t("mfaCodesCopy")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={download}>
              {t("mfaCodesDownload")}
            </Button>
            <Button type="button" size="sm" onClick={() => setCodes(null)}>
              {t("mfaCodesDone")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {remaining !== null ? (
            <p role="status" className="text-sm">
              {t("mfaCodesRemaining", { n: remaining })}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={confirmRegenerate}
          >
            {remaining ? t("mfaCodesRegenerate") : t("mfaCodesGenerate")}
          </Button>
        </div>
      )}
    </section>
  );
}
