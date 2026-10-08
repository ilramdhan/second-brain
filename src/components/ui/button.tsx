import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * Button system: one place for every clickable action outside the Radix primitives.
 *
 * Variants (pick by role, not by look):
 * - `primary`      the single main action of an area (save, create, send). One per dialog/form/header.
 * - `secondary`    companion actions next to a primary one (cancel, "fill from text", export).
 * - `tertiary`     repeated or low-emphasis actions in rows, toolbars and menus (icon buttons).
 * - `danger`       the confirm button of a destructive action (delete forever, sign out everywhere).
 * - `danger-ghost` light-weight delete/remove in a row or list (trash icon, "remove").
 * - `link`         inline navigation inside text.
 *
 * Legacy shadcn names stay as aliases so older call sites keep compiling and render identically:
 * `default` → primary, `outline` → secondary, `ghost` → tertiary, `destructive` → danger.
 *
 * Sizes: `sm` (h-8), `md` (h-9, default), `lg` (h-10), `icon` (36px), `icon-sm` (32px), and
 * `inline` (text-sized, for `link` buttons inside a sentence).
 * On touch screens (`coarse:` = `@media (pointer: coarse)`, phones and the installed PWA) `md`,
 * `lg` and `icon` grow to 44px; `sm` and `icon-sm` keep their look but get an invisible 44×44 px
 * hit area (`tap-area`, see styles.css) so they still meet WCAG 2.5.8.
 */

const PRIMARY = "bg-primary text-primary-foreground shadow hover:bg-primary/90";
const SECONDARY =
  "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground";
const TERTIARY = "hover:bg-accent hover:text-accent-foreground";
const DANGER = "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: PRIMARY,
        secondary: SECONDARY,
        tertiary: TERTIARY,
        danger: DANGER,
        "danger-ghost": "text-destructive hover:bg-destructive/10 hover:text-destructive",
        link: "text-primary underline-offset-4 hover:underline",
        // Compatibility aliases (prefer the semantic names in new code).
        default: PRIMARY,
        outline: SECONDARY,
        ghost: TERTIARY,
        destructive: DANGER,
      },
      size: {
        sm: "h-8 px-3 text-xs tap-area",
        md: "h-9 px-4 py-2 coarse:min-h-11",
        lg: "h-10 px-8 coarse:min-h-11",
        icon: "size-9 coarse:size-11",
        "icon-sm": "size-8 tap-area",
        /** Text-sized, no padding: `link` buttons inside a sentence (WCAG 2.5.8 inline exception). */
        inline: "h-auto p-0 text-[length:inherit] align-baseline",
      },
      /** Full width on phones, natural width from `sm` up (form submit buttons). */
      fluid: {
        true: "w-full sm:w-auto",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      fluid: false,
    },
  },
);

/**
 * Focus ring for the few elements that are buttons semantically but not visually (clickable cards,
 * list rows, calendar cells, drag handles). Everything else uses `Button`/`IconButton`.
 */
const pressableFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fluid, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, fluid, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export interface IconButtonProps extends Omit<ButtonProps, "aria-label"> {
  /** Accessible name; also shown as the native tooltip. Required: an icon alone has no name. */
  label: string;
}

/**
 * Icon-only button (row actions, toolbars, close/remove). `label` becomes `aria-label` and
 * `title`. Defaults to `tertiary` + `icon`; use `size="icon-sm"` in dense rows (it keeps a 44px
 * touch target) and `variant="danger-ghost"` for remove/delete.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, title, variant = "tertiary", size = "icon", type = "button", ...props }, ref) => (
    <Button
      ref={ref}
      type={type}
      variant={variant}
      size={size}
      aria-label={label}
      title={title ?? label}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";

export interface ResponsiveButtonProps extends Omit<ButtonProps, "children" | "asChild"> {
  /** Icon element, always visible. */
  icon: React.ReactNode;
  /** Text shown from `sm` up; below `sm` it stays in the DOM as screen-reader text and tooltip. */
  label: string;
}

/**
 * Header/toolbar action: icon only on phones (< sm, square like `icon`), icon + text from `sm`.
 * The label is always the accessible name (visually hidden on phones, not removed).
 */
const ResponsiveButton = React.forwardRef<HTMLButtonElement, ResponsiveButtonProps>(
  ({ icon, label, title, className, size = "md", type = "button", ...props }, ref) => (
    <Button
      ref={ref}
      type={type}
      size={size}
      title={title ?? label}
      className={cn("max-sm:size-9 max-sm:px-0 max-sm:coarse:size-11", className)}
      {...props}
    >
      {icon}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Button>
  ),
);
ResponsiveButton.displayName = "ResponsiveButton";

/** Row of buttons that wraps neatly on phones instead of overflowing. */
function ButtonGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="group" className={cn("flex flex-wrap items-center gap-2", className)} {...props} />
  );
}

export { Button, ButtonGroup, IconButton, ResponsiveButton, buttonVariants, pressableFocus };
