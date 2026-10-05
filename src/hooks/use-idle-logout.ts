import { useEffect } from "react";

export const IDLE_KEY = "second-brain-idle-minutes";
export const getIdleMinutes = () => {
  if (typeof window === "undefined") return 0;
  const v = Number(localStorage.getItem(IDLE_KEY) ?? "0");
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
