import { useState, type KeyboardEvent } from "react";

/**
 * Hover/focus position shared by the charts: pointer and touch set it per column, the plot is one
 * tab stop whose arrow keys (Home/End too) move it, Escape or leaving clears it.
 */
export function useActiveIndex(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  function onKeyDown(e: KeyboardEvent) {
    const cur = active ?? count - 1;
    let next: number;
    if (e.key === "ArrowRight") next = active === null ? count - 1 : clamp(cur + 1);
    else if (e.key === "ArrowLeft") next = active === null ? count - 1 : clamp(cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else if (e.key === "Escape") return setActive(null);
    else return;
    e.preventDefault();
    setActive(next);
  }
  return {
    active: active !== null && active < count ? active : null,
    setActive,
    plotProps: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => setActive((a) => a ?? count - 1),
      onBlur: () => setActive(null),
      onPointerLeave: () => setActive(null),
    },
  };
}
