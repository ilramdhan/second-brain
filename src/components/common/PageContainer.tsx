import { cn } from "@/lib/utils";

/**
 * Every authenticated page shares one frame (`max-w-6xl mx-auto`) so the page header and the
 * left content edge line up across pages. `contentWidth="readable"` keeps text-heavy pages
 * (settings, inbox, automations, error screens) comfortable to read with a left-aligned
 * `max-w-3xl` column inside that same frame, so its left edge still matches every other page.
 */
export function PageContainer({
  children,
  contentWidth = "full",
  className,
}: {
  children: React.ReactNode;
  contentWidth?: "full" | "readable";
  className?: string;
}) {
  return (
    <div
      data-page-frame=""
      className={cn("mx-auto w-full max-w-6xl px-4 py-6 sm:px-5 md:px-6 md:py-8", className)}
    >
      {contentWidth === "readable" ? (
        <div data-page-column="readable" className="w-full max-w-3xl">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
