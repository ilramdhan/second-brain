import { createContext, useContext } from "react";

/** Options of one confirmation prompt (see `useConfirm`). */
export type ConfirmOptions = {
  /** The question, e.g. "Delete this rule?". Rendered as the dialog title. */
  title: string;
  /** Optional extra explanation under the title. */
  description?: string | undefined;
  /** Confirm button label (default "Konfirmasi"/"Confirm", or "Hapus"/"Delete" when destructive). */
  confirmLabel?: string | undefined;
  /** Cancel button label (default "Batal"/"Cancel"). */
  cancelLabel?: string | undefined;
  /** Red confirm button for actions that delete or invalidate something. */
  destructive?: boolean | undefined;
};

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

// Keep one context instance across hot reloads so provider and consumers always match.
const g = globalThis as unknown as { __confirmCtx?: React.Context<ConfirmFn | null> };
export const ConfirmContext = (g.__confirmCtx ??= createContext<ConfirmFn | null>(null));

/**
 * Promise-based replacement for the browser's `window.confirm()`:
 *
 * ```ts
 * const confirm = useConfirm();
 * if (!(await confirm({ title: t("noteTrashConfirm"), destructive: true }))) return;
 * ```
 *
 * Resolves `true` only when the user presses the confirm button; Esc, the close button, a click
 * outside and an unmounting provider all resolve `false`. Needs `ConfirmProvider` above it
 * (mounted by the authenticated app shell).
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}
