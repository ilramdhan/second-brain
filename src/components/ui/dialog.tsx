"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * Mobile-first dialog shell (shared by every CRUD modal, the quick capture/task dialogs and the
 * command palette):
 *
 * - The content box is an inset, rounded card (12px margin on phones, centred card from `sm`)
 *   whose height is capped to the dynamic viewport minus the safe-area insets, so it never sits
 *   under a notch or the home indicator of an installed PWA.
 * - The content box itself is the scroll container. `DialogHeader` (title + close button) and
 *   `DialogFooter` (actions) are `position: sticky`, so the title and the save/cancel buttons
 *   stay visible while a long form scrolls between them.
 * - The close button lives in a zero-height sticky row that is visually first (`order-first`)
 *   but last in the DOM, so Radix still moves focus to the first form field on open.
 *
 * The horizontal padding is the `--dialog-px` custom property (1rem, 1.5rem from `sm`). Header,
 * footer and the close row pull themselves to the card edges with `-mx-(--dialog-px)`, so a
 * consumer that changes the padding sets the variable instead (e.g. `[--dialog-px:0px] p-0`).
 */

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/** Max height of a dialog: the dynamic viewport minus a 12px margin and the safe-area insets. */
export const DIALOG_MAX_HEIGHT =
  "max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] sm:max-h-[calc(100dvh-4rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Accessible name of the close button (defaults to the Indonesian "Tutup"). */
    closeLabel?: string;
  }
>(({ className, children, closeLabel = "Tutup", ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-slot="dialog-content"
      className={cn(
        "fixed top-[50%] left-[50%] z-50 flex w-[calc(100%-1.5rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border bg-background px-(--dialog-px) pb-5 shadow-xl duration-200 [--dialog-px:1rem] sm:pb-6 sm:[--dialog-px:1.5rem]",
        DIALOG_MAX_HEIGHT,
        // A sticky footer carries its own bottom padding.
        "has-[>[data-slot=dialog-footer]]:pb-0",
        // Touch-sized form fields on phones (44px), desktop density from `sm`.
        "max-sm:[&_[data-slot=input]]:h-11 max-sm:[&_[data-slot=select-trigger]]:h-11",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
      {/* Zero-height sticky row: the button floats over the sticky header's top-right corner.
          `-mb-4` cancels the flex gap so the header starts at the very top. */}
      <div className="pointer-events-none sticky top-0 z-20 order-first -mx-(--dialog-px) -mb-4 h-0 shrink-0">
        <DialogPrimitive.Close className="pointer-events-auto absolute top-2.5 right-1.5 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none sm:top-3.5 sm:right-3">
          <X className="h-4 w-4" aria-hidden />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>
      </div>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

/** Sticky title area; leaves room on the right for the close button. */
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-header"
    className={cn(
      "sticky top-0 z-10 -mx-(--dialog-px) flex shrink-0 flex-col gap-1.5 border-b bg-background pt-5 pr-14 pb-3 pl-(--dialog-px) text-left sm:pt-6",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

/**
 * Sticky action bar. Phones: full-width buttons stacked with the primary action on top (put it
 * last in the DOM: `flex-col-reverse`), 44px tall. From `sm`: one right-aligned row. A group
 * marked `sm:mr-auto` (e.g. destructive actions) sits on the left from `sm` and below on phones.
 */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-footer"
    className={cn(
      "sticky bottom-0 z-10 -mx-(--dialog-px) mt-auto flex shrink-0 flex-col-reverse gap-2 border-t bg-background px-(--dialog-px) pt-3 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3 sm:pb-5",
      "[&>button]:h-11 [&>button]:w-full sm:[&>button]:h-9 sm:[&>button]:w-auto",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg leading-tight font-semibold tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
