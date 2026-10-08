import { useSyncExternalStore } from "react";

import {
  applyOverrides,
  getEffectiveShortcuts,
  subscribeShortcuts,
  type Shortcut,
} from "@/lib/shortcuts";

const DEFAULTS = applyOverrides({});

/**
 * The shortcuts in effect on this device (defaults + keys remapped in Settings → Pintasan).
 * Re-renders when a key is changed or reset. During SSR the defaults are used.
 */
export function useShortcuts(): readonly Shortcut[] {
  return useSyncExternalStore(subscribeShortcuts, getEffectiveShortcuts, () => DEFAULTS);
}
