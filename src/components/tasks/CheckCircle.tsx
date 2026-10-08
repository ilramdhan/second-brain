import { Check } from "lucide-react";

import { useI18n } from "@/lib/preferences";
import { cn } from "@/lib/utils";

export function CheckCircle({
  done,
  onClick,
  className,
}: {
  done: boolean;
  onClick: () => void;
  className?: string | undefined;
}) {
  const { t } = useI18n();
  return (
    // eslint-disable-next-line no-restricted-syntax -- exception: round checkbox-like toggle
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={done ? t("taskMarkUndone") : t("taskMarkDone")}
      className={cn(
        "relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors before:absolute before:-inset-[13px] before:content-['']",
        done
          ? "border-success bg-success text-success-foreground"
          : "border-input hover:border-primary",
        className,
      )}
    >
      {done && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  );
}
