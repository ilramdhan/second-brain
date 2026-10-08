// Translated labels for the task enums in src/lib/constants.ts (whose `label` stays the
// Indonesian default for code that is not locale-aware). Thin wrapper over src/lib/option-labels.
import type { MessageKey } from "@/lib/preferences";
import { optionLabel } from "@/lib/option-labels";

type T = (key: MessageKey) => string;

/** Label of a status / priority / recurrence id in the active locale (falls back to `fallback`). */
export function enumLabel(
  t: T,
  kind: "status" | "priority" | "recurrence",
  id: string,
  fallback: string,
): string {
  return optionLabel(t, kind, id, fallback);
}
