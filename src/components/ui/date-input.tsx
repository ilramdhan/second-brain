import * as React from "react";
import { Calendar, CalendarClock, Clock, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * Native date/time fields with a consistent look:
 *
 * - The browser's own picker indicator is hidden (WebKit/Blink `::-webkit-calendar-picker-indicator`)
 *   and a lucide icon sits at the right edge instead, so every form shows the icon in the same
 *   place. Firefox's date button can't be hidden and already sits at the right edge, so
 *   `styles.css` drops our icon there (never two icons).
 * - The whole field opens the picker on click (`showPicker()`, guarded: it throws outside a user
 *   gesture, in cross-origin iframes and on older browsers, where we fall back to plain focus).
 *   Keyboard entry of the segments keeps working as usual.
 * - Same height as `Input` (36px), 44px on touch screens (`coarse:`), right padding for the icon,
 *   and `min-w-0` so "dd/mm/yyyy" isn't cut off in a 390px column.
 *
 * No extra dependency: the value is the native string (`yyyy-MM-dd`, `HH:mm`,
 * `yyyy-MM-ddTHH:mm`), exactly what the callers already store.
 */

type NativeProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** Classes for the wrapper (width, visibility, grid placement); `className` styles the input. */
  wrapperClassName?: string | undefined;
};

const FIELD =
  "flex h-9 w-full min-w-0 cursor-pointer rounded-md border border-input bg-transparent py-1 pr-9 pl-3 text-base tabular-nums shadow-sm transition-colors coarse:h-11 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm " +
  // Hide the native indicator but keep the field clickable; our icon replaces it.
  "[&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-inner-spin-button]:hidden " +
  "[&::-webkit-date-and-time-value]:text-left [&::-webkit-datetime-edit]:p-0";

/** Opens the native picker if the browser allows it; otherwise the field just gets focus. */
export function openPicker(input: HTMLInputElement) {
  if (input.disabled || input.readOnly) return;
  try {
    input.showPicker();
  } catch {
    input.focus();
  }
}

function makeField(type: "date" | "time" | "datetime-local", Icon: LucideIcon, name: string) {
  const Field = React.forwardRef<HTMLInputElement, NativeProps>(
    ({ className, wrapperClassName, onClick, ...props }, ref) => (
      <div data-slot="date-input" className={cn("relative w-full min-w-0", wrapperClassName)}>
        <input
          ref={ref}
          type={type}
          data-slot="input"
          className={cn(FIELD, className)}
          onClick={(e) => {
            onClick?.(e);
            if (!e.defaultPrevented) openPicker(e.currentTarget);
          }}
          {...props}
        />
        <Icon
          data-slot="date-input-icon"
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground",
            props.disabled && "opacity-50",
          )}
        />
      </div>
    ),
  );
  Field.displayName = name;
  return Field;
}

/** `<input type="date">` (`yyyy-MM-dd`) with a calendar icon at the right edge. */
export const DateInput = makeField("date", Calendar, "DateInput");
/** `<input type="time">` (`HH:mm`) with a clock icon at the right edge. */
export const TimeInput = makeField("time", Clock, "TimeInput");
/** `<input type="datetime-local">` (`yyyy-MM-ddTHH:mm`) with a calendar-clock icon. */
export const DateTimeInput = makeField("datetime-local", CalendarClock, "DateTimeInput");
