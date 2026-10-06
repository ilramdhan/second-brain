import { cloneElement, useId, type ReactElement } from "react";

import { isDemo } from "@/lib/app-mode";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

type ControlProps = {
  disabled?: boolean;
  tabIndex?: number;
  "aria-disabled"?: boolean;
  onClick?: unknown;
};

/**
 * Wraps a control (usually a `<Button>`) that is switched off in the demo. Outside the demo it
 * renders the child unchanged. In the demo the child is disabled and taken out of the tab order,
 * and the wrapper takes its place: it is focusable, shows the reason as a native tooltip
 * (`title`) and announces it to screen readers through `aria-describedby` plus visually hidden
 * text, because a disabled button alone is skipped by the keyboard and explains nothing.
 *
 * This is only a hint; the server rejects the action as well (`assertNotDemo`).
 */
export function DemoDisabled({
  children,
  reason,
  active = isDemo(),
  className,
}: {
  children: ReactElement<ControlProps>;
  reason?: string;
  active?: boolean;
  className?: string;
}) {
  const { t } = usePreferences();
  const id = useId();
  if (!active) return children;
  const text = reason ?? t("demoDisabled");
  return (
    <span
      tabIndex={0}
      title={text}
      aria-describedby={id}
      data-demo-disabled=""
      className={cn(
        "inline-flex cursor-not-allowed rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {cloneElement(children, {
        disabled: true,
        "aria-disabled": true,
        tabIndex: -1,
        onClick: undefined,
      })}
      <span id={id} className="sr-only">
        {text}
      </span>
    </span>
  );
}
