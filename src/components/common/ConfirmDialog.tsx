import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/preferences";

import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from "./confirm-context";

type Pending = { resolve: (ok: boolean) => void };

/**
 * Accessible confirmation modal used instead of `window.confirm()`.
 *
 * - Focus starts on the cancel button, so a stray Enter never confirms a destructive action.
 * - Esc, the close button and a click on the overlay cancel; Enter/Space activate the focused
 *   button (native `<button>` behaviour).
 * - Destructive prompts use the red `danger` button variant.
 */
export function ConfirmDialog({
  open,
  options,
  onResult,
}: {
  open: boolean;
  options: ConfirmOptions | null;
  onResult: (ok: boolean) => void;
}) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const destructive = options?.destructive ?? false;
  const confirmLabel = options?.confirmLabel ?? (destructive ? t("confirmDelete") : t("confirmOk"));
  const describe = options?.description ? {} : { "aria-describedby": undefined };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onResult(false)}>
      <DialogContent
        role="alertdialog"
        className="sm:max-w-md"
        closeLabel={t("confirmClose")}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancelRef.current?.focus();
        }}
        {...describe}
      >
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
          {options?.description ? (
            <DialogDescription>{options.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancelRef} type="button" variant="secondary" onClick={() => onResult(false)}>
            {options?.cancelLabel ?? t("confirmCancel")}
          </Button>
          <Button
            type="button"
            variant={destructive ? "danger" : "primary"}
            onClick={() => onResult(true)}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Provides `useConfirm()` to its subtree and renders the single shared `ConfirmDialog`. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Kept after closing so the text doesn't vanish during the close animation.
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const pending = useRef<Pending | null>(null);

  const settle = useCallback((ok: boolean) => {
    const current = pending.current;
    pending.current = null;
    setOpen(false);
    current?.resolve(ok);
  }, []);

  const confirm = useCallback<ConfirmFn>((next) => {
    // A newer prompt replaces an unanswered one; the older caller gets "cancel".
    pending.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = { resolve };
      setOptions(next);
      setOpen(true);
    });
  }, []);

  // Never leave a caller awaiting forever when the provider goes away (sign-out, navigation).
  useEffect(
    () => () => {
      pending.current?.resolve(false);
      pending.current = null;
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog open={open} options={options} onResult={settle} />
    </ConfirmContext.Provider>
  );
}
