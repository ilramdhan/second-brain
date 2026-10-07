import { niceScale } from "@/lib/reports";
import { cn } from "@/lib/utils";

import { ChartCard, Readout } from "./ChartCard";
import { labelIndexes, TONE_BG, TONE_STROKE, type ChartPoint, type ChartSeries } from "./types";
import { useActiveIndex } from "./useActiveIndex";

const PLOT_H = 160;
const W = 1000; // viewBox width; the SVG stretches, strokes stay 2px (non-scaling-stroke)

/**
 * Line chart (2px lines, round joins; a dashed series is a projection such as the ideal burndown).
 * A vertical crosshair snaps to the nearest x for pointer and keyboard; the readout lists every
 * series there. `null` values leave a gap (e.g. future days of a burndown). The last value of the
 * first series gets an end dot with a surface ring and a direct label.
 */
export function LineChart({
  id,
  title,
  subtitle,
  series,
  points,
  format,
  tickFormat = format,
  tickUnit = 1,
  hint = "Arahkan atau ketuk grafik untuk detail.",
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
  const n = points.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => PLOT_H - (v / scale.max) * PLOT_H;
  const labelled = new Set(labelIndexes(n, 6));

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      const v = p.values[s.key];
      if (v === null || v === undefined) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return { s, d };
  });
  const lead = series[0];
  const lastIdx = lead
    ? points.reduce((last, p, i) => (p.values[lead.key] != null ? i : last), -1)
    : -1;
  const lastVal = lastIdx >= 0 && lead ? points[lastIdx]!.values[lead.key]! : null;

  function pick(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || n === 0) return;
    setActive(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
  }

  return (
    <ChartCard
      id={id}
      title={title}
      subtitle={subtitle}
      series={series}
      points={points}
      format={format}
      kind="line"
      className={className}
    >
      <Readout
        point={active === null ? null : points[active]!}
        series={series}
        format={format}
        hint={hint}
      />
      <div className="flex gap-2">
        <div
          className="relative w-9 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums"
          style={{ height: PLOT_H }}
          aria-hidden
        >
          {scale.ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 leading-none"
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
            onPointerMove={pick}
            onPointerDown={pick}
            className="relative touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ height: PLOT_H }}
          >
            <svg
              viewBox={`0 0 ${W} ${PLOT_H}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
              aria-hidden
            >
              {scale.ticks.map((t) => (
                <line
                  key={t}
                  x1={0}
                  x2={W}
                  y1={y(t)}
                  y2={y(t)}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={1}
                  className={t === 0 ? "stroke-chart-axis" : "stroke-chart-grid"}
                />
              ))}
              {active !== null && (
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1={0}
                  y2={PLOT_H}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={1}
                  className="stroke-muted-foreground/50"
                />
              )}
              {paths.map(({ s, d }) => (
                <path
                  key={s.key}
                  d={d}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? "6 5" : undefined}
                  vectorEffect="non-scaling-stroke"
                  className={TONE_STROKE[s.tone]}
                />
              ))}
            </svg>
            {/* Dots are HTML so they stay round while the SVG stretches. */}
            {active !== null &&
              series.map((s) => {
                const v = points[active]?.values[s.key];
                return v === null || v === undefined ? null : (
                  <Dot key={s.key} left={x(active) / W} top={y(v)} tone={s.tone} />
                );
              })}
            {active === null && lead && lastVal !== null && (
              <>
                <Dot left={x(lastIdx) / W} top={y(lastVal)} tone={lead.tone} />
                <span
                  className="absolute -translate-x-full pr-2 text-[10px] font-medium whitespace-nowrap text-foreground tabular-nums"
                  style={{ left: `${(x(lastIdx) / W) * 100}%`, top: y(lastVal) - 16 }}
                  aria-hidden
                >
                  {format(lastVal)}
                </span>
              </>
            )}
          </div>
          <div className="relative mt-1 h-3 text-[10px] text-muted-foreground" aria-hidden>
            {points.map((p, i) =>
              labelled.has(i) ? (
                <span
                  key={p.key}
                  className={cn(
                    "absolute whitespace-nowrap",
                    i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2",
                  )}
                  style={{ left: `${(x(i) / W) * 100}%` }}
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

function Dot({ left, top, tone }: { left: number; top: number; tone: ChartSeries["tone"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
        TONE_BG[tone],
      )}
      style={{ left: `${left * 100}%`, top }}
    />
  );
}
