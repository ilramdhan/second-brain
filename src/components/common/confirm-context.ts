import { createContext, useContext } from "react";
import type { LucideIcon } from "lucide-react";

/** Colour and default icon of a prompt: red trash, amber warning triangle or neutral info. */
export type ConfirmTone = "danger" | "warning" | "info";

/** Options of one confirmation prompt (see `useConfirm`). */
export type ConfirmOptions = {
  /**
   * Short action question, e.g. "Hapus aturan?" / "Delete rule?". Rendered as the dialog title,
   * so keep it to a few words; the details go into `description`.
   */
  title: string;
  /**
   * What happens if the user confirms, e.g. "“Rapat” akan dihapus permanen. Ini tidak bisa
   * dibatalkan." Required: every prompt explains its consequence (also the accessible description).
   */
  description: string;
  /** Icon colour; defaults to `danger` when `destructive`, otherwise `info`. */
  tone?: ConfirmTone | undefined;
  /** Icon override (lucide); defaults to Trash2 / TriangleAlert / Info by `tone`. */
  icon?: LucideIcon | undefined;
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
 * const ok = await confirm({
 *   title: t("noteTrashConfirmTitle"),
 *   description: t("noteTrashConfirmDesc", { title }),
 *   destructive: true,
 * });
 * if (!ok) return;
 * ```
 *
 * Resolves `true` only when the user presses the confirm button; Esc, the cancel button, a click
 * outside and an unmounting provider all resolve `false`. Needs `ConfirmProvider` above it
 * (mounted by the authenticated app shell).
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}
