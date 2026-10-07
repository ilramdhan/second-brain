import { useState, type ReactNode } from "react";
import { Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { TONE_BG, TONE_STROKE, type ChartPoint, type ChartSeries } from "./types";

/*
 * Shared chart chrome for /reports and /habits (dataviz rules): a title, a legend whenever there
 * are two or more series (line keys for lines, swatches for bars; text always in text tokens),
 * the plot, and a table twin. The table is always in the DOM for screen readers (`sr-only`) and
 * can be shown visually with the "Tabel" toggle, so no value is reachable only by hovering.
 */
export function ChartCard({
  id,
  title,
  subtitle,
  series,
  points,
  format,
  kind,
  className,
  children,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode | undefined;
  series: ChartSeries[];
  points: ChartPoint[];
  format: (v: number) => string;
  kind: "bar" | "line";
  className?: string | undefined;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section
      className={cn("min-w-0 rounded-2xl border bg-card p-4 sm:p-5", className)}
      aria-labelledby={`${id}-title`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-semibold">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 shrink-0 text-muted-foreground sm:h-8"
          aria-pressed={showTable}
          aria-controls={`${id}-table`}
          onClick={() => setShowTable((v) => !v)}
        >
          <Table2 aria-hidden /> Tabel
        </Button>
      </div>
      {series.length > 1 && <Legend series={series} kind={kind} />}
      {children}
      <div className={showTable ? "mt-3 max-h-72 overflow-auto" : "sr-only"}>
        <table id={`${id}-table`} className="w-full text-left text-xs">
          <caption className="sr-only">{title}</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                Periode
              </th>
              {series.map((s) => (
                <th key={s.key} scope="col" className="py-1 pr-3 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {points.map((p) => (
              <tr key={p.key} className="border-t">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {p.long}
                </th>
                {series.map((s) => {
                  const v = p.values[s.key];
                  return (
                    <td key={s.key} className="py-1 pr-3 text-right">
                      {v === null || v === undefined ? "–" : format(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Legend({ series, kind }: { series: ChartSeries[]; kind: "bar" | "line" }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          {kind === "bar" ? (
            <span className={cn("h-2.5 w-2.5 rounded-sm", TONE_BG[s.tone])} aria-hidden />
          ) : (
            <svg width="16" height="4" aria-hidden className="overflow-visible">
              <line
                x1="0"
                x2="16"
                y1="2"
                y2="2"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "4 3" : undefined}
                className={TONE_STROKE[s.tone]}
              />
            </svg>
          )}
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The hover/focus readout: values lead (strong), series names follow, each keyed by a short line
 * of its colour. Rendered in a fixed slot above the plot, so it never covers the marks and works
 * the same for touch, mouse and keyboard.
 */
export function Readout({
  point,
  series,
  format,
  hint,
}: {
  point: ChartPoint | null;
  series: ChartSeries[];
  format: (v: number) => string;
  hint: string;
}) {
  return (
    <div className="mb-2 min-h-10 text-xs" aria-live="polite">
      {point ? (
        <>
          <p className="text-muted-foreground">{point.long}</p>
          <p className="flex flex-wrap gap-x-3">
            {series.map((s) => {
              const v = point.values[s.key];
              return (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className={cn("h-0.5 w-3 rounded-full", TONE_BG[s.tone])} aria-hidden />
                  <strong className="font-semibold text-foreground tabular-nums">
                    {v === null || v === undefined ? "–" : format(v)}
                  </strong>
                  <span className="text-muted-foreground">{s.label}</span>
                </span>
              );
            })}
          </p>
        </>
      ) : (
        <p className="pt-2 text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
