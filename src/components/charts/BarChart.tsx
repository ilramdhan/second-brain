import { niceScale } from "@/lib/reports";
import { cn } from "@/lib/utils";

import { ChartCard, Readout } from "./ChartCard";
import { labelIndexes, TONE_BG, type ChartPoint, type ChartSeries } from "./types";
import { useActiveIndex } from "./useActiveIndex";

const PLOT_H = 160; // px, the axis band below is extra (never clipped)

/**
 * Column chart, one or two series side by side (dataviz marks: <= 24px wide, 4px rounded top,
 * square at the baseline, 2px gap between neighbours, hairline grid, clean 1/2/5 ticks). Each
 * column's whole slot is the hit target; the readout shows every series at that x. The largest
 * value of the first series is labelled directly; the table twin carries the rest.
 */
export function BarChart({
  id,
  title,
  subtitle,
  series,
  points,
  format,
  tickFormat = format,
  tickUnit = 1,
  hint = "Arahkan atau ketuk kolom untuk detail.",
  className,
}: {
  id: string;
  title: string;
  subtitle?: React.ReactNode | undefined;
  series: ChartSeries[];
  points: ChartPoint[];
  format: (v: number) => string;
  tickFormat?: ((v: number) => string) | undefined;
  /** Ticks land on clean multiples of this (60: whole hours for minute values). */
  tickUnit?: number | undefined;
  hint?: string;
  className?: string | undefined;
}) {
  const { active, setActive, plotProps } = useActiveIndex(points.length);
  const max = Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
  const base = niceScale(max / tickUnit);
  const scale = { max: base.max * tickUnit, ticks: base.ticks.map((t) => t * tickUnit) };
  const first = series[0]?.key ?? "";
  const peak = points.reduce(
    (best, p, i) => ((p.values[first] ?? 0) > (points[best]?.values[first] ?? 0) ? i : best),
    0,
  );
  const labelled = new Set(labelIndexes(points.length));
  const h = (v: number | null | undefined) => ((v ?? 0) / scale.max) * PLOT_H;

  return (
    <ChartCard
      id={id}
      title={title}
      subtitle={subtitle}
      series={series}
      points={points}
      format={format}
      kind="bar"
      className={className}
    >
      <Readout
        point={active === null ? null : points[active]!}
        series={series}
        format={format}
        hint={hint}
      />
      <div className="flex gap-2">
        {/* y axis */}
        <div
          className="relative w-9 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums"
          style={{ height: PLOT_H }}
          aria-hidden
        >
          {scale.ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ bottom: (t / scale.max) * PLOT_H - 5 }}
            >
              {tickFormat(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            {...plotProps}
            role="group"
            aria-label={`${title}: gunakan panah kiri/kanan untuk menelusuri`}
            data-testid={`${id}-plot`}
            className="relative rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ height: PLOT_H }}
          >
            {scale.ticks.map((t) => (
              <div
                key={t}
                aria-hidden
                className={cn(
                  "absolute inset-x-0 h-px",
                  t === 0 ? "bg-chart-axis" : "bg-chart-grid",
                )}
                style={{ bottom: (t / scale.max) * PLOT_H }}
              />
            ))}
            <div className="absolute inset-0 flex">
              {points.map((p, i) => (
                <div
                  key={p.key}
                  aria-hidden
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                  className={cn(
                    "relative flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 px-px",
                    active === i && "bg-muted/60",
                  )}
                >
                  {i === peak && (p.values[first] ?? 0) > 0 && (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 text-[10px] font-medium whitespace-nowrap text-foreground tabular-nums"
                      style={{ bottom: h(p.values[first]) + 2 }}
                    >
                      {format(p.values[first]!)}
                    </span>
                  )}
                  {series.map((s) => (
                    <div
                      key={s.key}
                      className={cn("w-full max-w-6 rounded-t-[4px]", TONE_BG[s.tone])}
                      style={{
                        height: h(p.values[s.key]),
                        minHeight: (p.values[s.key] ?? 0) > 0 ? 2 : 0,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          {/* x axis */}
          <div className="relative mt-1 h-3 text-[10px] text-muted-foreground" aria-hidden>
            {points.map((p, i) =>
              labelled.has(i) ? (
                <span
                  key={p.key}
                  className={cn(
                    "absolute whitespace-nowrap",
                    points.length === 1
                      ? "-translate-x-1/2"
                      : i === 0
                        ? ""
                        : i === points.length - 1
                          ? "-translate-x-full"
                          : "-translate-x-1/2",
                  )}
                  style={{
                    left:
                      points.length === 1 || (i > 0 && i < points.length - 1)
                        ? `${((i + 0.5) / points.length) * 100}%`
                        : i === 0
                          ? 0
                          : "100%",
                  }}
                >
                  {p.label}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
