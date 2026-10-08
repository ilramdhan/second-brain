import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { isDemo } from "@/lib/app-mode";
import { demoLabel, type DemoExample } from "@/lib/demo-examples";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

/**
 * Demo-only strip under an AI form: the "Mode demo: respons contoh" hint plus "Contoh" chips that
 * load an example input (src/lib/demo-examples.ts). Renders nothing outside the demo. `children`
 * holds extra actions such as the voice/OCR "Pakai contoh" buttons.
 */
export function DemoExamples({
  examples = [],
  onPick,
  selected,
  active = isDemo(),
  className,
  children,
}: {
  /** Omit for a hint-only strip (forms whose input comes from elsewhere, like the Inbox). */
  examples?: readonly DemoExample[];
  onPick?: (example: DemoExample) => void;
  /** Key of the example currently in the form, if any (shown as pressed). */
  selected?: string | null;
  active?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const { t, locale } = usePreferences();
  if (!active) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <span className="flex items-center gap-1 font-medium text-primary">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {t("demoAiHint")}
      </span>
      {examples.length > 0 && (
        <span
          role="group"
          aria-label={t("demoAiExamples")}
          className="flex flex-wrap items-center gap-1.5"
        >
          <span className="text-muted-foreground">{t("demoAiExamples")}:</span>
          {examples.map((example) => (
            // eslint-disable-next-line no-restricted-syntax -- exception: example chip (pill toggle, tap-target)
            <button
              key={example.key}
              type="button"
              onClick={() => onPick?.(example)}
              aria-pressed={selected === example.key}
              className={cn(
                "tap-target rounded-full border px-2.5 py-0.5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                selected === example.key && "border-primary bg-primary/10 text-primary",
              )}
            >
              {demoLabel(example.label, locale)}
            </button>
          ))}
        </span>
      )}
      {children}
    </div>
  );
}
