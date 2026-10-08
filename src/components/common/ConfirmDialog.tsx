import { useCallback, useEffect, useRef, useState } from "react";
import { Info, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/preferences";
import { cn } from "@/lib/utils";

import {
  ConfirmContext,
  type ConfirmFn,
  type ConfirmOptions,
  type ConfirmTone,
} from "./confirm-context";

type Pending = { resolve: (ok: boolean) => void };

/** Default icon and tinted circle per tone. */
const TONES = {
  danger: { icon: Trash2, className: "bg-destructive/10 text-destructive" },
  warning: { icon: TriangleAlert, className: "bg-warning/15 text-warning" },
  info: { icon: Info, className: "bg-primary/10 text-primary" },
} as const satisfies Record<ConfirmTone, { icon: unknown; className: string }>;

/**
 * Accessible confirmation modal (alert dialog) used instead of `window.confirm()`.
 *
 * Layout: a tinted icon circle next to a short action title and a description of the consequence
 * (stacked and centred on phones), then Cancel (secondary) + the action (danger/primary).
 *
 * - Focus starts on the cancel button, so a stray Enter never confirms a destructive action.
 * - No corner close button: Cancel, Esc and a click on the overlay all cancel; Enter/Space
 *   activate the focused button (native `<button>` behaviour).
 * - The description is the dialog's accessible description (`aria-describedby`).
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
  const tone = TONES[options?.tone ?? (destructive ? "danger" : "info")];
  const Icon = options?.icon ?? tone.icon;
  const confirmLabel = options?.confirmLabel ?? (destructive ? t("confirmDelete") : t("confirmOk"));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onResult(false)}>
      <DialogContent
        role="alertdialog"
        className="gap-0 sm:max-w-md"
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <div className="flex flex-col items-center gap-3 pt-6 pb-5 text-center sm:flex-row sm:items-start sm:gap-4 sm:text-left">
          <span
            data-slot="confirm-icon"
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full",
              tone.className,
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1.5 sm:pt-0.5">
            <DialogTitle className="text-base leading-snug sm:text-lg">
              {options?.title}
            </DialogTitle>
            <DialogDescription className="break-words">{options?.description}</DialogDescription>
          </div>
        </div>
        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            fluid
            onClick={() => onResult(false)}
          >
            {options?.cancelLabel ?? t("confirmCancel")}
          </Button>
          <Button
            type="button"
            variant={destructive ? "danger" : "primary"}
            fluid
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
