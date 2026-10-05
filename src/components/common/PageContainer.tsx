import { cn } from "@/lib/utils";

const widths = { narrow: "max-w-3xl", standard: "max-w-6xl", wide: "max-w-[90rem]" } as const;

export function PageContainer({ children, size = "standard", className }: { children: React.ReactNode; size?: keyof typeof widths; className?: string }) {
  return <div className={cn("mx-auto w-full px-4 py-6 sm:px-5 md:px-6 md:py-8", widths[size], className)}>{children}</div>;
}