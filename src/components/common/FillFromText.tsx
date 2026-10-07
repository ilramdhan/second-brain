import { useState } from "react";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";

import { DemoExamples } from "@/components/demo/DemoExamples";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isDemo } from "@/lib/app-mode";
import { fillSummary, type FillResult } from "@/lib/capture-fields";
import type { DemoExample } from "@/lib/demo-examples";
import { toastError } from "@/lib/errors";

/**
 * Collapsible "Isi dari teks" panel above a create form: the user pastes or describes the item,
 * `onFill` asks the server for a draft and applies it to the form fields. Never saves anything.
 */
export function FillFromText<R extends FillResult>({
  examples,
  placeholder,
  labels,
  onFill,
  onApply,
  extraSummary,
}: {
  examples: readonly DemoExample[];
  placeholder: string;
  labels: Record<string, string>;
  onFill: (text: string) => Promise<R>;
  onApply: (result: R) => void;
  extraSummary?: (result: R) => string[];
}) {
  const demo = isDemo();
  const [open, setOpen] = useState(demo);
  const [text, setText] = useState(() => (demo ? (examples[0]?.text ?? "") : ""));
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function fill() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await onFill(text.slice(0, 4000));
      onApply(r);
      setSummary(fillSummary(r, labels, extraSummary?.(r)));
    } catch (err) {
      toastError(err, "Gagal mengisi dari teks");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-secondary/40 p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-xs font-medium"
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        Isi dari teks (AI)
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            rows={3}
            placeholder={placeholder}
            aria-label="Teks untuk mengisi formulir"
          />
          <DemoExamples
            examples={examples}
            selected={examples.find((e) => e.text === text)?.key ?? null}
            onPick={(e) => setText(e.text)}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={fill}
            disabled={busy || !text.trim()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Isi formulir
          </Button>
          {summary && (
            <p role="status" className="text-xs text-muted-foreground">
              {summary}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
