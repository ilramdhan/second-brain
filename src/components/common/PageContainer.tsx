import { cn } from "@/lib/utils";

/**
 * Every authenticated page shares one frame (`max-w-6xl mx-auto`) so the page header and the
 * content use the same left and right edges on every page. Content fills the whole frame;
 * individual elements that must stay narrow (single inputs, long prose) limit themselves.
 */
export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-page-frame=""
      className={cn("mx-auto w-full max-w-6xl px-4 py-6 sm:px-5 md:px-6 md:py-8", className)}
    >
      {children}
    </div>
  );
}
