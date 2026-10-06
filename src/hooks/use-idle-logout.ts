import { useEffect } from "react";

import { isDemo } from "@/lib/app-mode";

export const IDLE_KEY = "second-brain-idle-minutes";
/** Idle timeouts offered on the shared demo account (no "never", no 4 hours). */
export const DEMO_IDLE_OPTIONS = [15, 30, 60];
export const DEMO_DEFAULT_IDLE = 30;

export const getIdleMinutes = (demo: boolean = isDemo()) => {
  if (typeof window === "undefined") return demo ? DEMO_DEFAULT_IDLE : 0;
  const v = Number(localStorage.getItem(IDLE_KEY) ?? "0");
  if (demo) return DEMO_IDLE_OPTIONS.includes(v) ? v : DEMO_DEFAULT_IDLE;
  return Number.isFinite(v) ? v : 0;
};

/** Signs the user out after N idle minutes (0 = off). Activity in any tab resets the timer. */
export function useIdleLogout(onTimeout: () => void) {
  useEffect(() => {
    const STAMP = "second-brain-last-active";
    let last = 0;
    const touch = () => {
      const now = Date.now();
      if (now - last > 5000) {
        last = now;
        localStorage.setItem(STAMP, String(now));
      }
    };
    touch();
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const id = window.setInterval(() => {
      const minutes = getIdleMinutes();
      if (!minutes) return;
      const lastActive = Number(localStorage.getItem(STAMP) ?? Date.now());
      if (Date.now() - lastActive > minutes * 60_000) onTimeout();
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(id);
    };
  }, [onTimeout]);
}
